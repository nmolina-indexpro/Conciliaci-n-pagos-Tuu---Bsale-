// /lib/seguridad.js
// Controles de seguridad compartidos por las funciones /api (runtime Node):
//   - sesionVigente: la sesión del token + el estado ACTUAL del usuario en la base (activo, vencimiento, rol).
//   - exigirAdmin: corta con 403 si la sesión no es de admin (el frontend solo oculta los botones; el servidor es quien manda).
//   - limitarMemoria / limitarDb: límites de uso por usuario o por IP.

import { getSql } from './db.js';
import { usuarioDesdeRequest } from './auth-node.js';

// ── Sesión vigente ───────────────────────────────────────────────────
// El token firmado dura 7 días y lleva el rol de cuando se inició sesión: sin esto, un usuario desactivado (o al que se le quitó el
// rol admin) seguiría con acceso hasta que venza el token. Se consulta la base con una caché corta por usuario (no una consulta por
// cada llamada). Si la base falla se deja pasar con lo que trae el token, igual que hace middleware.ts, para no dejar a todos afuera.
const TTL_ESTADO_MS = 60 * 1000;
const TTL_ESTADO_ERROR_MS = 10 * 1000;
const estadoPorUsuario = new Map();

export async function sesionVigente(req) {
  const s = usuarioDesdeRequest(req);
  if (!s) return null;
  if (!s.uid) return s;
  const ahora = Date.now();
  let c = estadoPorUsuario.get(s.uid);
  if (!c || ahora >= c.vence) {
    try {
      const sql = await getSql();
      const { rows } = await sql`SELECT activo, rol, expira_en FROM usuarios WHERE id = ${s.uid};`;
      c = { vence: ahora + TTL_ESTADO_MS, ok: true, fila: rows[0] || null };
    } catch {
      c = { vence: ahora + TTL_ESTADO_ERROR_MS, ok: false, fila: null };
    }
    if (estadoPorUsuario.size > 500) estadoPorUsuario.clear();
    estadoPorUsuario.set(s.uid, c);
  }
  if (!c.ok) return s;
  const f = c.fila;
  if (!f || !f.activo) return null;
  if (f.expira_en && new Date(f.expira_en).getTime() <= ahora) return null;
  return { ...s, rol: f.rol };
}

export function olvidarEstadoUsuario(uid) {
  estadoPorUsuario.delete(uid);
}

export function exigirAdmin(sesion, res) {
  if (sesion && sesion.rol === 'admin') return true;
  res.status(403).json({ error: 'Esta acción requiere rol de administrador' });
  return false;
}

// ── Límites de uso ───────────────────────────────────────────────────
// Memoria: sirve para frenar ráfagas desde una instancia (barato, sin base). No es exacto entre instancias distintas de Vercel.
const ventanasMemoria = new Map();

export function limitarMemoria(clave, max, ventanaMs) {
  const ahora = Date.now();
  let v = ventanasMemoria.get(clave);
  if (!v || ahora - v.inicio >= ventanaMs) {
    v = { inicio: ahora, n: 0 };
    ventanasMemoria.set(clave, v);
    if (ventanasMemoria.size > 5000) {
      for (const [k, x] of ventanasMemoria) if (ahora - x.inicio > 3600000) ventanasMemoria.delete(k);
    }
  }
  v.n++;
  return { permitido: v.n <= max, reintentarEnSeg: Math.max(1, Math.ceil((v.inicio + ventanaMs - ahora) / 1000)) };
}

// Base de datos: contador exacto entre instancias, para lo caro (IA, correos, mensajes de WhatsApp).
let tablaLimitesLista = false;
async function asegurarTablaLimites(sql) {
  if (tablaLimitesLista) return;
  await sql`
    CREATE TABLE IF NOT EXISTS limites_uso (
      clave TEXT NOT NULL,
      ventana BIGINT NOT NULL,
      cuenta INTEGER NOT NULL DEFAULT 0,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (clave, ventana)
    );
  `;
  tablaLimitesLista = true;
}

export async function limitarDb(sql, clave, max, ventanaSeg) {
  await asegurarTablaLimites(sql);
  const ventana = Math.floor(Date.now() / 1000 / ventanaSeg);
  const { rows } = await sql`
    INSERT INTO limites_uso (clave, ventana, cuenta) VALUES (${clave}, ${ventana}, 1)
    ON CONFLICT (clave, ventana) DO UPDATE SET cuenta = limites_uso.cuenta + 1
    RETURNING cuenta;
  `;
  if (Math.random() < 0.01) await sql`DELETE FROM limites_uso WHERE creado_en < now() - interval '2 days';`;
  const segundosRestantes = ventanaSeg - (Math.floor(Date.now() / 1000) % ventanaSeg);
  return { permitido: rows[0].cuenta <= max, reintentarEnSeg: Math.max(1, segundosRestantes) };
}

export function ipCliente(req) {
  const h = req.headers || {};
  const xff = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  return String(h['x-real-ip'] || xff || 'desconocida').slice(0, 64);
}

// Responde 429 y devuelve true si el límite se pasó.
export function respuestaLimite(res, resultado, mensaje = 'Demasiadas solicitudes. Espera un momento antes de volver a intentar.') {
  res.setHeader('Retry-After', String(resultado.reintentarEnSeg));
  res.status(429).json({ error: mensaje, reintentar_en_segundos: resultado.reintentarEnSeg });
}

// ── Reglas por recurso de api/negocio.js ─────────────────────────────
// Escrituras que el frontend ya ofrece SOLO a admin (botones ocultos con rolActual === 'admin'): aquí el servidor las exige también.
// Forma: { recurso: ['POST', 'PUT', ...] }. Una acción que cualquier usuario ve en pantalla NO va aquí.
export const ESCRITURA_SOLO_ADMIN = {
  'transito-envios': ['POST', 'PUT', 'DELETE'],
  'transito-envio-eventos': ['POST', 'DELETE'],
};

// Recursos que gastan dinero o cuota (IA, correos, mensajes de WhatsApp, APIs externas): tope por usuario, contado en la base.
// Forma: { recurso: [máximo, ventana en segundos] }.
export const RECURSOS_COSTOSOS = {
  'whatsapp-analizar': [60, 300],
  'whatsapp-analizar-pendientes': [60, 300],
  'whatsapp-reanalizar-desactualizadas': [30, 300],
  'whatsapp-enviar-mensaje': [60, 300],
  'comparador-cotizacion-imagen': [30, 300],
  'identificacion-modelo-foto': [30, 300],
  'indexpro-enviar-presentacion': [30, 300],
  'indexscale-enviar-presentacion': [30, 300],
  'indexscale-enviar-recontacto': [30, 300],
  'insumos-st-avisar': [30, 300],
  'notificacion-probar': [20, 300],
  'google-ads-analisis': [30, 300],
  'search-console': [60, 300],
  'instagram': [60, 300],
};

const LIMITE_GENERAL = [600, 60000]; // llamadas por minuto y usuario (una página normal hace decenas, no cientos)

// Se llama justo después de validar la sesión. Devuelve null si puede seguir, o { status, cuerpo, reintentarEnSeg } si se debe cortar.
export async function controlarAcceso(req, sesion, recurso) {
  const clave = String(sesion.uid || sesion.email);
  const general = limitarMemoria('u:' + clave, LIMITE_GENERAL[0], LIMITE_GENERAL[1]);
  if (!general.permitido) {
    return { status: 429, reintentarEnSeg: general.reintentarEnSeg, cuerpo: { error: 'Demasiadas solicitudes. Espera un momento antes de volver a intentar.', reintentar_en_segundos: general.reintentarEnSeg } };
  }

  const metodosAdmin = ESCRITURA_SOLO_ADMIN[recurso];
  if (metodosAdmin && metodosAdmin.includes(req.method) && sesion.rol !== 'admin') {
    return { status: 403, cuerpo: { error: 'Esta acción requiere rol de administrador' } };
  }

  const costoso = RECURSOS_COSTOSOS[recurso];
  if (costoso && req.method !== 'GET') {
    try {
      const sql = await getSql();
      const r = await limitarDb(sql, `${recurso}:${clave}`, costoso[0], costoso[1]);
      if (!r.permitido) {
        return { status: 429, reintentarEnSeg: r.reintentarEnSeg, cuerpo: { error: 'Se alcanzó el límite de uso de esta acción. Intenta de nuevo en unos minutos.', reintentar_en_segundos: r.reintentarEnSeg } };
      }
    } catch { /* si la base falla, no se bloquea la acción por el contador */ }
  }
  return null;
}

// Recursos públicos (sin sesión) y su tope por IP en memoria: [máximo, ventana en ms]. Solo los que NO llevan clave de servicio: los que
// llama el Worker de Cloudflare llegan todos desde las mismas IP de Cloudflare y un tope por IP cortaría a visitantes legítimos.
export const LIMITES_PUBLICOS_POR_IP = {
  'auth-recuperar-password': [10, 15 * 60000],
  'auth-resetear-password': [10, 15 * 60000],
  'cotizacion-web': [60, 60000],
  'indexscale-pixel': [300, 60000],
};

export function controlarPublicoPorIp(req, recurso) {
  const regla = LIMITES_PUBLICOS_POR_IP[recurso];
  if (!regla) return null;
  const r = limitarMemoria(`ip:${recurso}:${ipCliente(req)}`, regla[0], regla[1]);
  return r.permitido ? null : r;
}

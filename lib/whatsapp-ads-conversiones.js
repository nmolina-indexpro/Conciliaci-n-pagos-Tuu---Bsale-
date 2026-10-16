// /lib/whatsapp-ads-conversiones.js
// ══════════════════════════════════════════════════════════════════════
// Conversión REAL de Google Ads: mensaje de WhatsApp recibido.
// ══════════════════════════════════════════════════════════════════════
// Hoy Google Ads cuenta como "conversión" un toque en el botón o en el ícono de WhatsApp del sitio; eso NO confirma que el cliente
// haya enviado el mensaje. Como la venta es consultiva, lo que importa es el mensaje.
//
// Cómo se mide:
//   1) Al tocar un botón de WhatsApp, una etiqueta del sitio (Tag Manager) crea un código corto, lo agrega al texto precargado
//      ("... (ref K7P4Q2)") y avisa al ERP, por el Worker, el código con el gclid (o gbraid/wbraid) de la visita.
//   2) Cuando llega el mensaje (tabla whatsapp_mensajes, dirección 'in') y trae ese código, se vincula.
//   3) Un cron sube a Google Ads la conversión offline por clic (Data Manager API, events:ingest) con ese gclid.
// Si el cliente borra el código antes de enviar, no hay vínculo y no se sube nada: se subcuenta, nunca se inventa.
//
// No guarda datos personales: solo el código, los identificadores de clic de Google, la página y el dispositivo.
// Variables de entorno propias: GOOGLE_ADS_WHATSAPP_CONVERSION_ID (id numérico de la acción de conversión "WhatsApp - mensaje recibido
// (ERP)") y GOOGLE_DATAMANAGER_REFRESH_TOKEN (permiso de Data Manager API); el resto son las mismas GOOGLE_ADS_* del resumen semanal.

import { fetchWithTimeout } from './google-ads-resumen.js';

// Sin 0/O/1/I para que se pueda dictar o leer sin confundir.
export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LARGO_CODIGO = 6;
const RE_CODIGO = new RegExp(`^[${ALFABETO_CODIGO}]{${LARGO_CODIGO}}$`);
// En el mensaje: "ref K7P4Q2", "(ref: K7P4Q2)", "REF-k7p4q2", etc.
const RE_REF_EN_TEXTO = new RegExp(`\\bref[\\s:#-]{0,3}([${ALFABETO_CODIGO}]{${LARGO_CODIGO}})\\b`, 'i');
const RE_ID_CLIC = /^[A-Za-z0-9_-]{20,200}$/;
export const VENTANA_DIAS = 28; // Google acepta hasta 90 días; con 28 hay margen bajo la ventana de 30 de la acción
export const MAX_INTENTOS = 5;
export const RETENCION_DIAS = 120;

export function normalizarCodigo(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return RE_CODIGO.test(s) ? s : null;
}

export function extraerCodigoDeTexto(texto) {
  const m = RE_REF_EN_TEXTO.exec(String(texto ?? ''));
  return m ? normalizarCodigo(m[1]) : null;
}

function limpiarId(v) {
  const s = String(v ?? '').trim();
  return RE_ID_CLIC.test(s) ? s : null;
}

function limpiarTexto(v, largo) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, largo);
  return s || null;
}

// body: { codigo, gclid?, gbraid?, wbraid?, pagina?, dispositivo? } -- lo manda el Worker (con la clave) a pedido del sitio.
export function validarClic(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo inválido' };
  const codigo = normalizarCodigo(body.codigo);
  if (!codigo) return { ok: false, error: 'Código inválido' };
  const gclid = limpiarId(body.gclid);
  const gbraid = limpiarId(body.gbraid);
  const wbraid = limpiarId(body.wbraid);
  if (!gclid && !gbraid && !wbraid) return { ok: false, error: 'Sin identificador de clic de Google' };
  let pagina = limpiarTexto(body.pagina, 200);
  if (pagina) pagina = pagina.replace(/[?#].*$/, ''); // sin parámetros de la URL
  return {
    ok: true,
    fila: {
      codigo, gclid, gbraid, wbraid, pagina,
      dispositivo: ['movil', 'escritorio'].includes(body.dispositivo) ? body.dispositivo : null,
    },
  };
}

export async function asegurarTablaWaClicsAds(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS wa_clics_ads (
      id SERIAL PRIMARY KEY,
      codigo TEXT NOT NULL UNIQUE,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      gclid TEXT,
      gbraid TEXT,
      wbraid TEXT,
      pagina TEXT,
      dispositivo TEXT,
      mensaje_id INTEGER,
      mensaje_en TIMESTAMPTZ,
      subida_en TIMESTAMPTZ,
      intentos INTEGER NOT NULL DEFAULT 0,
      ultimo_error TEXT
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS wa_clics_ads_creado ON wa_clics_ads (creado_en);`;
}

export async function guardarClic(sql, fila) {
  await asegurarTablaWaClicsAds(sql);
  await sql.query(
    `INSERT INTO wa_clics_ads (codigo, gclid, gbraid, wbraid, pagina, dispositivo) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (codigo) DO NOTHING`,
    [fila.codigo, fila.gclid, fila.gbraid, fila.wbraid, fila.pagina, fila.dispositivo],
  );
}

// Busca en los mensajes recibidos los que traen un código de clic todavía sin vincular.
export async function vincularMensajes(sql) {
  const pendientes = await sql.query(
    `SELECT codigo FROM wa_clics_ads WHERE mensaje_id IS NULL AND creado_en >= now() - make_interval(days => $1)`,
    [VENTANA_DIAS],
  );
  if (!pendientes.rows.length) return { pendientes: 0, vinculados: 0 };
  const codigos = new Set(pendientes.rows.map((r) => r.codigo));
  const msgs = await sql.query(
    `SELECT id, marca_tiempo, contenido_texto FROM whatsapp_mensajes
     WHERE direccion = 'in' AND marca_tiempo >= now() - make_interval(days => $1) AND contenido_texto ~* 'ref[[:space:]:#-]{0,3}[A-Za-z0-9]{6}'
     ORDER BY marca_tiempo ASC LIMIT 2000`,
    [VENTANA_DIAS + 2],
  );
  let vinculados = 0;
  for (const m of msgs.rows) {
    const codigo = extraerCodigoDeTexto(m.contenido_texto);
    if (!codigo || !codigos.has(codigo)) continue;
    const r = await sql.query(
      `UPDATE wa_clics_ads SET mensaje_id = $1, mensaje_en = $2 WHERE codigo = $3 AND mensaje_id IS NULL`,
      [m.id, m.marca_tiempo, codigo],
    );
    if (r.rowCount) vinculados++;
    codigos.delete(codigo);
  }
  return { pendientes: pendientes.rows.length, vinculados };
}

// "2026-10-14 15:04:05+00:00" -- el formato que pide uploadClickConversions.
export function fechaGoogle(d) {
  const f = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${f.getUTCFullYear()}-${p(f.getUTCMonth() + 1)}-${p(f.getUTCDate())} ${p(f.getUTCHours())}:${p(f.getUTCMinutes())}:${p(f.getUTCSeconds())}+00:00`;
}

export function faltanVariablesConversion(env = process.env) {
  return ['GOOGLE_ADS_WHATSAPP_CONVERSION_ID'].filter((k) => !String(env[k] || '').trim());
}

// Google ya no deja que integraciones NUEVAS suban conversiones por clic con la API de Google Ads (UploadClickConversions responde
// CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE): hay que usar la Data Manager API (events:ingest). Pide su propio permiso OAuth
// (https://www.googleapis.com/auth/datamanager), por eso usa un refresh token aparte: GOOGLE_DATAMANAGER_REFRESH_TOKEN.
// Misma aplicación OAuth (GOOGLE_ADS_CLIENT_ID / _SECRET) y misma cuenta; no necesita developer token.
export function tokenDataManager(env = process.env) {
  return String(env.GOOGLE_DATAMANAGER_REFRESH_TOKEN || '').trim();
}

// Arma el evento de una fila. La conversión no puede quedar antes del clic: se usa la hora del mensaje, y si por desfase de relojes
// quedara antes del registro del clic, un segundo después de este.
export function armarEvento(fila) {
  const clic = new Date(fila.creado_en).getTime();
  const msg = new Date(fila.mensaje_en).getTime();
  const ids = {};
  if (fila.gclid) ids.gclid = fila.gclid;
  else if (fila.gbraid) ids.gbraid = fila.gbraid;
  else ids.wbraid = fila.wbraid;
  return {
    destinationReferences: ['ads'],
    eventTimestamp: new Date(Math.max(msg, clic + 1000)).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    transactionId: fila.codigo, // Google descarta repetidos con el mismo transactionId
    eventSource: 'WEB',
    conversionValue: 1,
    currency: 'CLP',
    adIdentifiers: ids,
  };
}

// Un solo destino: la acción de conversión "WhatsApp - mensaje recibido (ERP)" de la cuenta de IndexStore (entrando por la MCC).
export function armarSolicitud(filas, env = process.env, validateOnly = false) {
  const limpiar = (v) => String(v).replace(/\D/g, '');
  return {
    destinations: [{
      reference: 'ads',
      loginAccount: { accountType: 'GOOGLE_ADS', accountId: limpiar(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) },
      operatingAccount: { accountType: 'GOOGLE_ADS', accountId: limpiar(env.GOOGLE_ADS_DEFAULT_CUSTOMER_ID) },
      productDestinationId: limpiar(env.GOOGLE_ADS_WHATSAPP_CONVERSION_ID),
    }],
    events: filas.map(armarEvento),
    ...(validateOnly ? { validateOnly: true } : {}),
  };
}

async function tokenDeAcceso(env) {
  const r = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: tokenDataManager(env),
      grant_type: 'refresh_token',
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw new Error(`Google rechazó el token de Data Manager (${r.status}): ${data.error_description || data.error || 'sin detalle'}`);
  }
  return data.access_token;
}

// La Data Manager API falla el pedido completo si un evento es inválido (no hay errores parciales): por eso se envía UN evento por
// pedido, así un identificador de clic malo no arrastra a los demás. El volumen es bajo (unos pocos mensajes al día).
export async function subirConversiones(sql, env = process.env, { soloValidar = false } = {}) {
  const filas = (await sql.query(
    `SELECT id, codigo, creado_en, gclid, gbraid, wbraid, mensaje_en FROM wa_clics_ads
     WHERE mensaje_id IS NOT NULL AND subida_en IS NULL AND intentos < $1
       AND creado_en >= now() - make_interval(days => $2) ORDER BY mensaje_en ASC LIMIT 100`,
    [MAX_INTENTOS, VENTANA_DIAS],
  )).rows;
  if (!filas.length) return { a_subir: 0, subidas: 0, con_error: 0 };
  if (!tokenDataManager(env)) {
    return { a_subir: filas.length, subidas: 0, con_error: 0, error: 'Falta GOOGLE_DATAMANAGER_REFRESH_TOKEN en Vercel (permiso de Data Manager API)' };
  }

  const token = await tokenDeAcceso(env);
  let subidas = 0;
  const motivos = new Set();
  for (const f of filas) {
    let msg = null;
    try {
      const r = await fetchWithTimeout('https://datamanager.googleapis.com/v1/events:ingest', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(armarSolicitud([f], env, soloValidar)),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Google suele traer qué campo falla en error.details (violaciones de campo / códigos); se anota recortado, sin datos del cliente.
        const detalle = data?.error?.details ? ` | detalle: ${JSON.stringify(data.error.details).replace(/"gclid":"[^"]*"/g, '"gclid":"…"').slice(0, 400)}` : '';
        msg = `HTTP ${r.status} ${data?.error?.status || ''}: ${String(data?.error?.message || 'sin detalle').slice(0, 220)}${detalle}`.trim();
      }
    } catch (e) {
      msg = `Sin respuesta de Google: ${String(e.message || e).slice(0, 120)}`;
    }
    if (msg) {
      motivos.add(msg);
      if (!soloValidar) await sql.query(`UPDATE wa_clics_ads SET intentos = intentos + 1, ultimo_error = $2 WHERE id = $1`, [f.id, msg]);
    } else {
      subidas++;
      if (!soloValidar) await sql.query(`UPDATE wa_clics_ads SET subida_en = now(), ultimo_error = NULL WHERE id = $1`, [f.id]);
    }
  }
  // Motivos de Google (sin datos del cliente) para poder revisar en el registro por qué una conversión no se aceptó.
  return { a_subir: filas.length, subidas, con_error: filas.length - subidas, ...(soloValidar ? { solo_validar: true } : {}), ...(motivos.size ? { motivos: [...motivos].slice(0, 3) } : {}) };
}

// Solo cantidades (sin montos): cuántos toques de botón con código, cuántos terminaron en mensaje y cuántos se subieron a Google.
export async function resumenWaClics(sql, dias) {
  await asegurarTablaWaClicsAds(sql);
  const r = await sql.query(
    `SELECT count(*)::int AS toques, count(mensaje_id)::int AS con_mensaje, count(subida_en)::int AS subidas,
            count(*) FILTER (WHERE ultimo_error IS NOT NULL AND subida_en IS NULL)::int AS con_error
     FROM wa_clics_ads WHERE creado_en >= now() - make_interval(days => $1)`,
    [dias],
  );
  return r.rows[0];
}

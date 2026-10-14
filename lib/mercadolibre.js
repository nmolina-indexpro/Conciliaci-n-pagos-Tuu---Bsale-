// /lib/mercadolibre.js
// ══════════════════════════════════════════════════════════════════════
// Conexión con la API de Mercado Libre (Chile) -- SOLO LECTURA.
// ══════════════════════════════════════════════════════════════════════
// Pedido del usuario: vincular el ERP a Mercado Libre para medir la eficiencia de las ventas y sus datos. Por ahora solo se mide:
// nada se escribe en Mercado Libre (ni precios, ni stock, ni publicaciones).
//
// Cómo funciona la conexión (OAuth 2.0 "authorization code"):
//   1) Un administrador aprieta "Conectar" en la página Mercado Libre del ERP -> se lo manda a auth.mercadolibre.cl para que acepte.
//   2) Mercado Libre vuelve a mercadolibre-callback.html con un código de un solo uso ("code") y el "state" que se mandó.
//   3) El servidor cambia ese código por un access_token (dura ~6 horas) y un refresh_token. Cada vez que se usa el refresh_token,
//      Mercado Libre entrega uno NUEVO y el anterior queda inválido: por eso ambos se guardan en la base (tabla mercadolibre_conexion)
//      y se renuevan solos antes de vencer.
// Variables de entorno (Vercel): ML_APP_ID, ML_CLIENT_SECRET y, opcional, ML_REDIRECT_URI (por defecto la de abajo; tiene que ser
// IDÉNTICA a la que se registra en la aplicación de Mercado Libre). El "state" se firma con AUTH_SECRET.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ML_AUTH_URL = 'https://auth.mercadolibre.cl/authorization';
export const ML_API = 'https://api.mercadolibre.com';
export const REDIRECT_POR_DEFECTO = 'https://erp.indexstore.cl/mercadolibre-callback.html';
const MARGEN_RENOVACION_MS = 5 * 60 * 1000; // se renueva el acceso si le quedan menos de 5 minutos
const VIGENCIA_STATE_MS = 10 * 60 * 1000;

export function configML(env = process.env) {
  const appId = String(env.ML_APP_ID || '').trim();
  const secret = String(env.ML_CLIENT_SECRET || '').trim();
  return { appId, secret, redirect: String(env.ML_REDIRECT_URI || '').trim() || REDIRECT_POR_DEFECTO, configurado: Boolean(appId && secret) };
}

// ---- "state": evita que alguien más complete una autorización a nombre de otro (CSRF) ----
function firma(clave, texto) {
  return createHmac('sha256', clave).update(texto).digest('hex');
}
export function firmarEstado(uid, clave, ahora = Date.now()) {
  if (!clave) throw new Error('Falta AUTH_SECRET para firmar la autorización');
  const base = `${uid}.${ahora}`;
  return `${base}.${firma(clave, base)}`;
}
export function verificarEstado(estado, uid, clave, ahora = Date.now()) {
  if (!clave || typeof estado !== 'string') return false;
  const partes = estado.split('.');
  if (partes.length !== 3) return false;
  const [uidEstado, ts, f] = partes;
  if (uidEstado !== String(uid)) return false;
  const edad = ahora - Number(ts);
  if (!Number.isFinite(edad) || edad < 0 || edad > VIGENCIA_STATE_MS) return false;
  const esperada = Buffer.from(firma(clave, `${uidEstado}.${ts}`));
  const recibida = Buffer.from(String(f));
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

export function urlAutorizacion(cfg, estado) {
  const p = new URLSearchParams({ response_type: 'code', client_id: cfg.appId, redirect_uri: cfg.redirect, state: estado });
  return `${ML_AUTH_URL}?${p.toString()}`;
}

// ---- tabla (una sola fila: la cuenta vendedora conectada) ----
export async function asegurarTablaMercadoLibre(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS mercadolibre_conexion (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      ml_user_id TEXT,
      nickname TEXT,
      site_id TEXT,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expira_en TIMESTAMPTZ NOT NULL,
      scope TEXT,
      conectado_por TEXT,
      conectado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
}
export async function leerConexion(sql) {
  const { rows } = await sql`SELECT ml_user_id, nickname, site_id, access_token, refresh_token, expira_en, scope, conectado_por, conectado_en FROM mercadolibre_conexion WHERE id = 1;`;
  return rows[0] || null;
}
export async function borrarConexion(sql) {
  await sql`DELETE FROM mercadolibre_conexion WHERE id = 1;`;
}
async function guardarTokens(sql, t, { conectadoPor = null, nuevo = false, ahora = Date.now() } = {}) {
  const expira = new Date(ahora + Number(t.expires_in || 21600) * 1000).toISOString();
  if (nuevo) {
    await sql`
      INSERT INTO mercadolibre_conexion (id, ml_user_id, access_token, refresh_token, expira_en, scope, conectado_por, conectado_en, actualizado_en)
      VALUES (1, ${t.user_id != null ? String(t.user_id) : null}, ${t.access_token}, ${t.refresh_token}, ${expira}::timestamptz, ${t.scope || null}, ${conectadoPor}, now(), now())
      ON CONFLICT (id) DO UPDATE SET ml_user_id = EXCLUDED.ml_user_id, access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
        expira_en = EXCLUDED.expira_en, scope = EXCLUDED.scope, conectado_por = EXCLUDED.conectado_por, conectado_en = now(), actualizado_en = now(),
        nickname = NULL, site_id = NULL;`;
  } else {
    await sql`
      UPDATE mercadolibre_conexion SET access_token = ${t.access_token}, refresh_token = ${t.refresh_token || null}, expira_en = ${expira}::timestamptz,
        scope = COALESCE(${t.scope || null}, scope), actualizado_en = now() WHERE id = 1;`;
  }
}

// ---- llamadas a la API (fetchFn inyectable para pruebas) ----
async function pedirToken(cfg, cuerpo, fetchFn) {
  const r = await fetchFn(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.secret, ...cuerpo }).toString(),
  });
  const texto = await r.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { /* respuesta no JSON */ }
  if (!r.ok || !datos || !datos.access_token) {
    // Nunca se devuelve ni se registra el código ni los tokens: solo lo que Mercado Libre explica del error.
    const motivo = datos && (datos.message || datos.error_description || datos.error) ? String(datos.message || datos.error_description || datos.error) : `HTTP ${r.status}`;
    const e = new Error(`Mercado Libre rechazó la solicitud (${motivo})`);
    e.status = r.status;
    throw e;
  }
  return datos;
}
export async function conectarConCodigo(sql, cfg, code, { conectadoPor, fetchFn = fetch, ahora = Date.now() } = {}) {
  const t = await pedirToken(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirect }, fetchFn);
  await guardarTokens(sql, t, { conectadoPor, nuevo: true, ahora });
  // nickname y sitio de la cuenta, para mostrarlos en la página
  const yo = await leerGet(t.access_token, '/users/me', fetchFn);
  await sql`UPDATE mercadolibre_conexion SET nickname = ${yo.nickname || null}, site_id = ${yo.site_id || null}, ml_user_id = ${yo.id != null ? String(yo.id) : null} WHERE id = 1;`;
  return yo;
}
// Devuelve un access_token vigente (renovándolo si falta poco). Si Mercado Libre rechaza la renovación, la conexión hay que rehacerla.
export async function tokenValido(sql, cfg, { fetchFn = fetch, ahora = Date.now() } = {}) {
  const c = await leerConexion(sql);
  if (!c) { const e = new Error('Mercado Libre no está conectado'); e.codigo = 'sin_conexion'; throw e; }
  if (new Date(c.expira_en).getTime() - ahora > MARGEN_RENOVACION_MS) return { token: c.access_token, conexion: c };
  try {
    const t = await pedirToken(cfg, { grant_type: 'refresh_token', refresh_token: c.refresh_token }, fetchFn);
    await guardarTokens(sql, t, { ahora });
    return { token: t.access_token, conexion: c };
  } catch (err) {
    // El refresh_token es de un solo uso: si otra solicitud en paralelo ya lo renovó, esta falla pero la conexión quedó vigente.
    const c2 = await leerConexion(sql);
    if (c2 && c2.refresh_token !== c.refresh_token && new Date(c2.expira_en).getTime() - ahora > MARGEN_RENOVACION_MS) return { token: c2.access_token, conexion: c2 };
    err.codigo = 'renovacion_fallida';
    throw err;
  }
}
async function leerGet(token, ruta, fetchFn) {
  const r = await fetchFn(`${ML_API}${ruta}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  const texto = await r.text();
  let datos = null;
  try { datos = JSON.parse(texto); } catch { /* no JSON */ }
  if (!r.ok) {
    const e = new Error(`Mercado Libre respondió HTTP ${r.status}${datos && datos.message ? ': ' + datos.message : ''}`);
    e.status = r.status;
    throw e;
  }
  return datos || {};
}
// GET de solo lectura con el acceso de la cuenta conectada.
export async function leerML(sql, cfg, ruta, { fetchFn = fetch, ahora = Date.now() } = {}) {
  const { token } = await tokenValido(sql, cfg, { fetchFn, ahora });
  return leerGet(token, ruta, fetchFn);
}

// Prueba de lectura: datos básicos de la cuenta, su reputación y cuántas publicaciones activas tiene.
export async function probarLectura(sql, cfg, opciones = {}) {
  const yo = await leerML(sql, cfg, '/users/me', opciones);
  let publicacionesActivas = null;
  try {
    const lista = await leerML(sql, cfg, `/users/${encodeURIComponent(yo.id)}/items/search?status=active&limit=1`, opciones);
    publicacionesActivas = lista && lista.paging && typeof lista.paging.total === 'number' ? lista.paging.total : null;
  } catch { /* se informa vacío: algunas cuentas no exponen este dato */ }
  const rep = yo.seller_reputation || {};
  const ventas = (rep.transactions && rep.transactions.completed) ?? null;
  return {
    id: yo.id, nickname: yo.nickname || null, siteId: yo.site_id || null, tipoUsuario: (yo.user_type) || null,
    nivelReputacion: rep.level_id || null, estadoMercadoLider: rep.power_seller_status || null,
    ventasCompletadas: ventas, publicacionesActivas, enlace: yo.permalink || null,
  };
}

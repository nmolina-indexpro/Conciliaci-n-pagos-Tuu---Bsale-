// /lib/instagram.js
// ═════════════════════════════════════════════════════════════════════
// Página "Instagram" (Análisis): cómo le va a la cuenta de Instagram de IndexStore. Solo lectura (Instagram Graph API de Meta).
// Variables de entorno (Vercel):
//   INSTAGRAM_ACCESS_TOKEN  token con permisos instagram_basic, instagram_manage_insights, pages_show_list y pages_read_engagement.
//                           Lo ideal es el de un "usuario del sistema" de Meta Business (no vence); uno personal dura 60 días.
//   INSTAGRAM_USER_ID       (opcional) id de la cuenta profesional de Instagram. Si falta, se busca solo a partir de las páginas de Facebook
//                           a las que da acceso el token (usa la primera cuenta de Instagram que encuentre, o la de INSTAGRAM_USERNAME).
//   INSTAGRAM_USERNAME      (opcional) para elegir una cuenta cuando el token ve varias, por ejemplo "indexstore.cl".
//   INSTAGRAM_API_VERSION   (opcional) por defecto v21.0.
//
// Secciones (una por pestaña):
//   resumen         perfil, alcance, vistas, visitas al perfil, clics al sitio, interacciones y cuentas que interactuaron contra el período
//                   anterior, más alcance por día y nuevos seguidores por día.
//   publicaciones   las publicaciones del período con alcance, guardados, compartidos, interacciones y tasa de interacción.
//   audiencia       dónde viven (país y ciudad), edad y género de los seguidores.
// Las funciones de armado son puras y exportadas (se prueban con datos simulados).
// ═════════════════════════════════════════════════════════════════════

export const VERSION_API = 'v21.0';
export const MAX_DIAS_RANGO = 90;        // Instagram entrega los totales en ventanas de hasta 30 días: se piden por tramos
export const DIAS_TRAMO = 30;
export const MAX_PUBLICACIONES = 40;
export const TIMEOUT_MS = 20000;
export const RETRASO_DIAS = 1;           // el día de hoy aún está incompleto

// Métricas de totales (metric_type=total_value). Cada una se pide por separado: si una cuenta no admite una, no se cae todo.
export const METRICAS_TOTALES = [
  ['reach', 'Alcance'],
  ['views', 'Vistas'],
  ['profile_views', 'Visitas al perfil'],
  ['website_clicks', 'Clics al sitio web'],
  ['accounts_engaged', 'Cuentas que interactuaron'],
  ['total_interactions', 'Interacciones'],
];

const num = (v) => Number(v || 0);
const redondear = (n, d = 0) => { const f = 10 ** d; return Math.round(num(n) * f) / f; };

// ── Fechas ───────────────────────────────────────────────────────────
export const esFechaDia = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const diasEntre = (desde, hasta) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000) + 1;
export const fechaChile = (ahora = new Date()) => ahora.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

// Rango pedido (por defecto los últimos 28 días hasta ayer) y el período anterior de la misma duración.
export function validarRango(desde, hasta, ahora = new Date()) {
  const tope = sumarDias(fechaChile(ahora), -RETRASO_DIAS);
  let h = esFechaDia(hasta) ? hasta : tope;
  if (h > tope) h = tope;
  const d = esFechaDia(desde) ? desde : sumarDias(h, -27);
  if (d > h) return { error: 'La fecha "desde" no puede ser posterior a "hasta"' };
  const dias = diasEntre(d, h);
  if (dias > MAX_DIAS_RANGO) return { error: `El rango no puede superar ${MAX_DIAS_RANGO} días` };
  const antHasta = sumarDias(d, -1);
  return { desde: d, hasta: h, dias, anterior: { desde: sumarDias(antHasta, -(dias - 1)), hasta: antHasta } };
}
// Parte un rango en tramos de hasta 30 días: [{ desde, hasta }]
export function tramos(desde, hasta, maxDias = DIAS_TRAMO) {
  const salida = [];
  let ini = desde;
  while (ini <= hasta) {
    const fin = sumarDias(ini, maxDias - 1) < hasta ? sumarDias(ini, maxDias - 1) : hasta;
    salida.push({ desde: ini, hasta: fin });
    ini = sumarDias(fin, 1);
  }
  return salida;
}
const unix = (fecha) => Math.floor(Date.parse(`${fecha}T00:00:00Z`) / 1000);

// ── Conexión ─────────────────────────────────────────────────────────
export function configuracion(env = process.env) {
  return {
    token: String(env.INSTAGRAM_ACCESS_TOKEN || '').trim(),
    usuarioId: String(env.INSTAGRAM_USER_ID || '').trim(),
    usuario: String(env.INSTAGRAM_USERNAME || '').trim().replace(/^@/, '').toLowerCase(),
    version: String(env.INSTAGRAM_API_VERSION || '').trim() || VERSION_API,
  };
}
export async function fetchWithTimeout(url, opciones = {}, ms = TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opciones, signal: ctl.signal }); } finally { clearTimeout(t); }
}

// Mensaje claro para los errores típicos de Meta.
export function explicarErrorMeta(error) {
  const e = error || {};
  const msg = String(e.message || '');
  if (e.code === 190 || /access token|session has expired|token/i.test(msg) && e.type === 'OAuthException') {
    return `El token de Instagram venció o no es válido. Genera uno nuevo (lo mejor es un usuario del sistema de Meta Business, que no vence) y actualiza INSTAGRAM_ACCESS_TOKEN en Vercel. (${msg.slice(0, 140)})`;
  }
  if (e.code === 10 || e.code === 200 || /permission/i.test(msg)) {
    return `Al token le faltan permisos o acceso a la cuenta. Necesita instagram_basic, instagram_manage_insights, pages_show_list y pages_read_engagement, y la Página de Facebook vinculada a Instagram asignada al usuario del sistema. (${msg.slice(0, 140)})`;
  }
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return `Meta limitó las consultas por un rato; vuelve a intentar en unos minutos. (${msg.slice(0, 100)})`;
  return msg || 'Meta devolvió un error sin detalle';
}

export async function graph(cfg, ruta, params = {}) {
  const q = new URLSearchParams({ ...params, access_token: cfg.token });
  const r = await fetchWithTimeout(`https://graph.facebook.com/${cfg.version}/${ruta}?${q.toString()}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) { const e = new Error(explicarErrorMeta(d.error || { message: `Meta respondió ${r.status}` })); e.codigo = d.error?.code; e.meta = d.error || null; throw e; }
  return d;
}

// Encuentra la cuenta de Instagram: la configurada, o la primera (o la de INSTAGRAM_USERNAME) ligada a una Página del token.
export async function resolverCuenta(cfg) {
  const campos = 'id,username,name,followers_count,follows_count,media_count,profile_picture_url,biography,website';
  if (cfg.usuarioId) return graph(cfg, cfg.usuarioId, { fields: campos });
  const d = await graph(cfg, 'me/accounts', { fields: `name,instagram_business_account{${campos}}`, limit: '50' });
  const cuentas = (d.data || []).filter((p) => p.instagram_business_account).map((p) => ({ ...p.instagram_business_account, pagina: p.name }));
  if (!cuentas.length) throw new Error('El token no ve ninguna cuenta de Instagram. La cuenta debe ser profesional (empresa o creador), estar vinculada a una Página de Facebook y esa Página asignada al usuario del sistema.');
  return (cfg.usuario && cuentas.find((c) => String(c.username || '').toLowerCase() === cfg.usuario)) || cuentas[0];
}

// ── Armado (puro) ────────────────────────────────────────────────────
// Suma el valor de una métrica de totales entre varios tramos. respuestas: [{ data: [{ name, total_value: { value } }] }] | null
export function sumarTotal(respuestas) {
  let hubo = false, total = 0;
  for (const r of respuestas || []) {
    const v = r?.data?.[0]?.total_value?.value;
    if (v != null) { hubo = true; total += num(v); }
  }
  return hubo ? total : null;
}
export function variacionPct(actual, anterior) {
  return actual != null && anterior != null && anterior > 0 ? (actual - anterior) / anterior : null;
}
// Serie diaria: respuestas con data[0].values = [{ value, end_time }]. La fecha del día es el día anterior al end_time (cierra a medianoche del Pacífico).
export function armarSerie(respuestas) {
  const m = new Map();
  for (const r of respuestas || []) {
    for (const v of r?.data?.[0]?.values || []) {
      if (!v.end_time) continue;
      const dia = new Date(Date.parse(v.end_time) - 12 * 3600 * 1000).toISOString().slice(0, 10);
      m.set(dia, (m.get(dia) || 0) + num(v.value));
    }
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([fecha, valor]) => ({ fecha, valor }));
}
// Publicaciones con sus métricas: interacciones / alcance = tasa de interacción.
export function armarPublicaciones(medios, insightsPorId) {
  return (medios || []).map((m) => {
    const i = insightsPorId?.[m.id] || {};
    const alcance = i.reach ?? null;
    const interacciones = i.total_interactions ?? (num(m.like_count) + num(m.comments_count));
    return {
      id: m.id, fecha: (m.timestamp || '').slice(0, 10), tipo: nombreTipo(m), enlace: m.permalink || null, texto: String(m.caption || '').replace(/\s+/g, ' ').slice(0, 140),
      me_gusta: num(m.like_count), comentarios: num(m.comments_count), alcance, vistas: i.views ?? null, guardados: i.saved ?? null, compartidos: i.shares ?? null,
      interacciones, tasa: alcance > 0 ? redondear(interacciones / alcance, 4) : null,
    };
  });
}
export function nombreTipo(m) {
  if (m.media_product_type === 'REELS') return 'Reel';
  if (m.media_product_type === 'STORY') return 'Historia';
  if (m.media_type === 'CAROUSEL_ALBUM') return 'Carrusel';
  if (m.media_type === 'VIDEO') return 'Video';
  return 'Foto';
}
// Desglose de audiencia (follower_demographics): data[0].total_value.breakdowns[0].results = [{ dimension_values: [..], value }]
export function armarDesglose(respuesta, etiquetar = (v) => v.join(' · ')) {
  const filas = respuesta?.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
  const total = filas.reduce((s, f) => s + num(f.value), 0);
  return filas.map((f) => ({ etiqueta: etiquetar(f.dimension_values || []), valor: num(f.value), pct: total > 0 ? redondear(num(f.value) / total, 4) : null })).sort((a, b) => b.valor - a.valor);
}
export const NOMBRES_GENERO = { F: 'Mujeres', M: 'Hombres', U: 'Sin especificar' };
export function resumirPorTipo(publicaciones) {
  const t = new Map();
  for (const p of publicaciones) {
    const x = t.get(p.tipo) || { tipo: p.tipo, publicaciones: 0, alcance: 0, interacciones: 0, con_alcance: 0 };
    x.publicaciones += 1; x.interacciones += p.interacciones;
    if (p.alcance != null) { x.alcance += p.alcance; x.con_alcance += 1; }
    t.set(p.tipo, x);
  }
  return [...t.values()].map((x) => ({ tipo: x.tipo, publicaciones: x.publicaciones, alcance_promedio: x.con_alcance ? Math.round(x.alcance / x.con_alcance) : null, interacciones_promedio: Math.round(x.interacciones / x.publicaciones) })).sort((a, b) => b.publicaciones - a.publicaciones);
}

// ── Secciones ────────────────────────────────────────────────────────
async function totalMetrica(cfg, cuenta, metrica, periodo) {
  const respuestas = await Promise.allSettled(tramos(periodo.desde, periodo.hasta).map((t) =>
    graph(cfg, `${cuenta.id}/insights`, { metric: metrica, period: 'day', metric_type: 'total_value', since: String(unix(t.desde)), until: String(unix(sumarDias(t.hasta, 1))) })));
  const buenas = respuestas.filter((x) => x.status === 'fulfilled').map((x) => x.value);
  if (!buenas.length) return { valor: null, error: respuestas[0]?.reason?.message || 'sin datos' };
  return { valor: sumarTotal(buenas), error: null };
}

export async function seccionResumen(cfg, cuenta, rango) {
  const metricas = await Promise.all(METRICAS_TOTALES.map(async ([clave, nombre]) => {
    const [act, ant] = await Promise.all([totalMetrica(cfg, cuenta, clave, rango), totalMetrica(cfg, cuenta, clave, rango.anterior)]);
    return { clave, nombre, actual: act.valor, anterior: ant.valor, variacion: variacionPct(act.valor, ant.valor), error: act.error };
  }));
  // Series diarias: el alcance admite cualquier tramo; "follower_count" (nuevos seguidores) solo los últimos 30 días.
  const unaSerie = async (metrica, periodo) => {
    const r = await Promise.allSettled(tramos(periodo.desde, periodo.hasta).map((t) =>
      graph(cfg, `${cuenta.id}/insights`, { metric: metrica, period: 'day', since: String(unix(t.desde)), until: String(unix(sumarDias(t.hasta, 1))) })));
    return armarSerie(r.filter((x) => x.status === 'fulfilled').map((x) => x.value));
  };
  const desde30 = rango.dias > 30 ? sumarDias(rango.hasta, -29) : rango.desde;
  const [alcanceDia, seguidoresDia] = await Promise.all([unaSerie('reach', rango), unaSerie('follower_count', { desde: desde30, hasta: rango.hasta })]);
  return {
    cuenta: { usuario: cuenta.username, nombre: cuenta.name, seguidores: num(cuenta.followers_count), siguiendo: num(cuenta.follows_count), publicaciones: num(cuenta.media_count), foto: cuenta.profile_picture_url || null, pagina: cuenta.pagina || null },
    metricas, alcance_diario: alcanceDia, nuevos_seguidores_diario: seguidoresDia, nuevos_seguidores_total: seguidoresDia.reduce((s, x) => s + x.valor, 0),
  };
}

const CAMPOS_MEDIO = 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count';
async function insightsDeMedio(cfg, medio) {
  // Las métricas disponibles cambian según el tipo; se prueba la lista completa y, si Meta la rechaza, una más corta.
  for (const lista of ['reach,saved,shares,total_interactions,views', 'reach,saved,shares,total_interactions', 'reach,saved']) {
    try {
      const d = await graph(cfg, `${medio.id}/insights`, { metric: lista });
      return Object.fromEntries((d.data || []).map((x) => [x.name, x.values?.[0]?.value ?? x.total_value?.value ?? null]));
    } catch { /* se prueba la siguiente */ }
  }
  return {};
}
export async function seccionPublicaciones(cfg, cuenta, rango) {
  const medios = [];
  let ruta = `${cuenta.id}/media`, params = { fields: CAMPOS_MEDIO, limit: '50' };
  for (let pagina = 0; pagina < 4; pagina += 1) {
    const d = await graph(cfg, ruta, params);
    for (const m of d.data || []) if ((m.timestamp || '').slice(0, 10) >= rango.desde && (m.timestamp || '').slice(0, 10) <= rango.hasta) medios.push(m);
    const ultimo = (d.data || []).at(-1);
    if (!d.paging?.next || !ultimo || (ultimo.timestamp || '').slice(0, 10) < rango.desde || medios.length >= MAX_PUBLICACIONES) break;
    const sig = new URL(d.paging.next);
    ruta = sig.pathname.replace(new RegExp(`^/${cfg.version}/`), ''); params = Object.fromEntries([...sig.searchParams].filter(([k]) => k !== 'access_token'));
  }
  const elegidos = medios.slice(0, MAX_PUBLICACIONES);
  const ins = {};
  for (let i = 0; i < elegidos.length; i += 6) await Promise.all(elegidos.slice(i, i + 6).map(async (m) => { ins[m.id] = await insightsDeMedio(cfg, m); }));
  const publicaciones = armarPublicaciones(elegidos, ins);
  return { publicaciones, por_tipo: resumirPorTipo(publicaciones), total_en_rango: medios.length };
}

export async function seccionAudiencia(cfg, cuenta) {
  const pedir = (breakdown) => graph(cfg, `${cuenta.id}/insights`, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown }).catch((e) => ({ error: e.message }));
  const [pais, ciudad, edad, genero] = await Promise.all(['country', 'city', 'age', 'gender'].map(pedir));
  const o = (r, f) => (r.error ? { error: r.error } : { filas: armarDesglose(r, f).slice(0, 15) });
  return { pais: o(pais, (v) => v[0]), ciudad: o(ciudad, (v) => v[0]), edad: o(edad, (v) => v[0]), genero: o(genero, (v) => NOMBRES_GENERO[v[0]] || v[0]) };
}

// Punto de entrada de la API del ERP.
export async function consultarInstagram({ seccion, desde, hasta, env = process.env, ahora = new Date() }) {
  const cfg = configuracion(env);
  if (!cfg.token) return { sin_configurar: true };
  const cuenta = await resolverCuenta(cfg);
  const cabecera = { seccion, cuenta: { usuario: cuenta.username, id: cuenta.id }, generado_en: new Date().toISOString() };
  if (seccion === 'audiencia') return { ...cabecera, ...(await seccionAudiencia(cfg, cuenta)) };
  const rango = validarRango(desde, hasta, ahora);
  if (rango.error) return { error: rango.error };
  const periodo = { desde: rango.desde, hasta: rango.hasta, anterior: rango.anterior, dias: rango.dias };
  if (seccion === 'publicaciones') return { ...cabecera, ...periodo, ...(await seccionPublicaciones(cfg, cuenta, rango)) };
  return { ...cabecera, seccion: 'resumen', ...periodo, ...(await seccionResumen(cfg, cuenta, rango)) };
}

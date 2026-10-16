// /lib/google-ads-analisis.js
// ═════════════════════════════════════════════════════════════════════
// Página "Google Ads" (Análisis): cinco métricas para decidir qué hacer con las campañas. Solo lectura: no cambia nada en la cuenta.
// Como la venta de IndexStore es consultiva, lo que importa es el MENSAJE de WhatsApp real (lo confirma el ERP, tabla wa_clics_ads), no
// los toques en el botón ni las conversiones que cuenta Google.
//   1) Costo por mensaje real de WhatsApp, por campaña (gasto de Google Ads / mensajes confirmados por el ERP).
//   2) Dónde se va la inversión: gasto por red (Búsqueda, Display, YouTube, Performance Max...) y qué campañas gastan en Display.
//   3) Conversiones de Google vs mensajes reales: qué acciones inflan el número de conversiones.
//   4) Cuota de impresiones perdida en Búsqueda (por presupuesto y por ranking): cuánta demanda se está dejando pasar.
//   5) Búsquedas que gastan sin convertir: candidatas a palabra negativa.
// Las consultas usan lib/google-ads-resumen.js (misma conexión y variables GOOGLE_ADS_*). Las funciones de armado son puras y exportadas.
// ═════════════════════════════════════════════════════════════════════
import { consultarGaql, obtenerAccessToken, faltanVariablesGoogleAds, fechaChile } from './google-ads-resumen.js';
import { esFechaDia } from './rango-fechas.js';

export const MAX_DIAS_RANGO = 400;
export const MIN_CLICS_TERMINO = 1;   // un término cuenta como "gasto sin convertir" desde el primer clic con costo
export const MAX_TERMINOS = 25;
export const UMBRAL_DISPLAY_ALERTA = 0.3; // si Display se lleva más de esto del gasto, se avisa

const num = (v) => Number(v || 0);
const dinero = (micros) => num(micros) / 1e6;
const redondear = (n, d = 0) => { const f = 10 ** d; return Math.round(num(n) * f) / f; };

export const NOMBRES_RED = {
  SEARCH: 'Búsqueda de Google', SEARCH_PARTNERS: 'Socios de búsqueda', CONTENT: 'Display (sitios y apps asociados)',
  YOUTUBE: 'YouTube', YOUTUBE_SEARCH: 'Búsqueda de YouTube', YOUTUBE_WATCH: 'YouTube', MIXED: 'Mixta (Performance Max y Shopping)',
  GOOGLE_TV: 'Google TV', GMAIL: 'Gmail', DISCOVER: 'Discover', UNKNOWN: 'Sin clasificar', UNSPECIFIED: 'Sin clasificar',
};
export const NOMBRES_TIPO_CAMPANA = {
  SEARCH: 'Búsqueda', PERFORMANCE_MAX: 'Performance Max', SHOPPING: 'Shopping', DISPLAY: 'Display', VIDEO: 'Video', DEMAND_GEN: 'Demand Gen', SMART: 'Inteligente', LOCAL: 'Local',
};
// La acción de conversión que sube el ERP cuando llega un mensaje real ("WhatsApp - mensaje recibido (ERP)").
export const RE_ACCION_MENSAJE_REAL = /mensaje\s+recibido|\(erp\)/i;

// ── Consultas GAQL ───────────────────────────────────────────────────
export function consultasGaql(desde, hasta) {
  const fechas = `segments.date BETWEEN '${desde}' AND '${hasta}'`;
  return {
    campanas: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
               FROM campaign WHERE ${fechas} AND metrics.impressions > 0`,
    redes: `SELECT campaign.id, campaign.name, segments.ad_network_type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
            FROM campaign WHERE ${fechas} AND metrics.impressions > 0`,
    acciones: `SELECT segments.conversion_action_name, metrics.conversions
               FROM campaign WHERE ${fechas} AND metrics.conversions > 0`,
    cuota: `SELECT campaign.id, campaign.name, metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share, metrics.cost_micros, metrics.impressions, metrics.clicks
            FROM campaign WHERE ${fechas} AND campaign.advertising_channel_type = 'SEARCH' AND campaign.status = 'ENABLED' AND metrics.impressions > 0`,
    terminos: `SELECT search_term_view.search_term, campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
               FROM search_term_view WHERE ${fechas} AND metrics.cost_micros > 0 ORDER BY metrics.cost_micros DESC LIMIT 1000`,
  };
}

// ── 1) Costo por mensaje real ────────────────────────────────────────
// erpFilas: [{ campana_id, campana, toques, mensajes }] (wa_clics_ads agrupado por campaña); null si no se pudo leer.
export function armarCostoPorMensaje(filasCampanas, erpFilas) {
  const campanas = new Map();
  for (const f of filasCampanas) {
    const id = String(f.campaign?.id);
    const x = campanas.get(id) || { id, nombre: f.campaign?.name || id, tipo: NOMBRES_TIPO_CAMPANA[f.campaign?.advertisingChannelType] || f.campaign?.advertisingChannelType || '', estado: f.campaign?.status || '', gasto: 0, clics: 0, impresiones: 0, conv_google: 0, toques: 0, mensajes: 0 };
    x.gasto += dinero(f.metrics?.costMicros); x.clics += num(f.metrics?.clicks); x.impresiones += num(f.metrics?.impressions); x.conv_google += num(f.metrics?.conversions);
    campanas.set(id, x);
  }
  const porNombre = new Map([...campanas.values()].map((c) => [c.nombre.trim().toLowerCase(), c]));
  const sinCampana = { id: '', nombre: 'Sin campaña identificada (clic de iPhone o aún sin atribuir)', tipo: '', estado: '', gasto: 0, clics: 0, impresiones: 0, conv_google: 0, toques: 0, mensajes: 0 };
  for (const e of erpFilas || []) {
    const c = (e.campana_id && campanas.get(String(e.campana_id))) || (e.campana && porNombre.get(String(e.campana).trim().toLowerCase())) || sinCampana;
    c.toques += num(e.toques); c.mensajes += num(e.mensajes);
  }
  const filas = [...campanas.values(), ...(sinCampana.toques || sinCampana.mensajes ? [sinCampana] : [])].map((c) => ({
    ...c, gasto: redondear(c.gasto), conv_google: redondear(c.conv_google, 1),
    costo_por_mensaje: c.mensajes > 0 && c.gasto > 0 ? redondear(c.gasto / c.mensajes) : null,
  })).sort((a, b) => b.gasto - a.gasto);
  const t = filas.reduce((s, c) => ({ gasto: s.gasto + c.gasto, clics: s.clics + c.clics, toques: s.toques + c.toques, mensajes: s.mensajes + c.mensajes }), { gasto: 0, clics: 0, toques: 0, mensajes: 0 });
  return {
    filas, erp_disponible: erpFilas != null,
    totales: { ...t, costo_por_mensaje: t.mensajes > 0 ? redondear(t.gasto / t.mensajes) : null, costo_por_clic: t.clics > 0 ? redondear(t.gasto / t.clics) : null },
  };
}

// ── 2) Gasto por red ─────────────────────────────────────────────────
export function armarGastoPorRed(filas) {
  const redes = new Map(), displayPorCampana = new Map();
  let total = 0;
  for (const f of filas) {
    const clave = f.segments?.adNetworkType || 'UNKNOWN';
    const x = redes.get(clave) || { red: clave, nombre: NOMBRES_RED[clave] || clave, gasto: 0, impresiones: 0, clics: 0, conversiones: 0 };
    const g = dinero(f.metrics?.costMicros);
    x.gasto += g; x.impresiones += num(f.metrics?.impressions); x.clics += num(f.metrics?.clicks); x.conversiones += num(f.metrics?.conversions);
    redes.set(clave, x); total += g;
    if (clave === 'CONTENT') displayPorCampana.set(f.campaign?.name || String(f.campaign?.id), (displayPorCampana.get(f.campaign?.name || String(f.campaign?.id)) || 0) + g);
  }
  const lista = [...redes.values()].map((r) => ({
    ...r, gasto: redondear(r.gasto), conversiones: redondear(r.conversiones, 1),
    pct_gasto: total > 0 ? r.gasto / total : 0, ctr: r.impresiones > 0 ? r.clics / r.impresiones : null, costo_por_clic: r.clics > 0 ? redondear(r.gasto / r.clics) : null,
  })).sort((a, b) => b.gasto - a.gasto);
  const display = redes.get('CONTENT');
  const pctDisplay = display && total > 0 ? display.gasto / total : 0;
  return {
    redes: lista, gasto_total: redondear(total), pct_display: pctDisplay, alerta_display: pctDisplay >= UMBRAL_DISPLAY_ALERTA,
    campanas_en_display: [...displayPorCampana.entries()].map(([nombre, gasto]) => ({ nombre, gasto: redondear(gasto) })).filter((c) => c.gasto > 0).sort((a, b) => b.gasto - a.gasto).slice(0, 5),
  };
}

// ── 3) Conversiones de Google vs mensajes reales ─────────────────────
export function armarConversiones(filasAcciones, erpTotales) {
  const m = new Map();
  for (const f of filasAcciones) {
    const nombre = f.segments?.conversionActionName || '(sin nombre)';
    m.set(nombre, (m.get(nombre) || 0) + num(f.metrics?.conversions));
  }
  const acciones = [...m.entries()].map(([nombre, conversiones]) => ({ nombre, conversiones: redondear(conversiones, 1), es_mensaje_real: RE_ACCION_MENSAJE_REAL.test(nombre) })).sort((a, b) => b.conversiones - a.conversiones);
  const total = acciones.reduce((s, a) => s + a.conversiones, 0);
  const reales = acciones.filter((a) => a.es_mensaje_real).reduce((s, a) => s + a.conversiones, 0);
  return {
    acciones, conversiones_google: redondear(total, 1), conversiones_mensaje_real: redondear(reales, 1),
    pct_sin_mensaje: total > 0 ? (total - reales) / total : null,
    toques_erp: erpTotales ? num(erpTotales.toques) : null, mensajes_erp: erpTotales ? num(erpTotales.mensajes) : null,
  };
}

// ── 4) Cuota de impresiones perdida (Búsqueda) ───────────────────────
export function armarCuota(filas) {
  const campanas = filas.map((f) => {
    const m = f.metrics || {};
    const cuota = m.searchImpressionShare != null ? num(m.searchImpressionShare) : null;
    const presupuesto = m.searchBudgetLostImpressionShare != null ? num(m.searchBudgetLostImpressionShare) : null;
    const ranking = m.searchRankLostImpressionShare != null ? num(m.searchRankLostImpressionShare) : null;
    return { id: String(f.campaign?.id), nombre: f.campaign?.name || String(f.campaign?.id), gasto: redondear(dinero(m.costMicros)), impresiones: num(m.impressions), clics: num(m.clicks), cuota, perdida_presupuesto: presupuesto, perdida_ranking: ranking };
  }).sort((a, b) => (b.perdida_presupuesto || 0) - (a.perdida_presupuesto || 0));
  const masPerdidaPresupuesto = campanas.find((c) => (c.perdida_presupuesto || 0) >= 0.05) || null;
  const masPerdidaRanking = [...campanas].sort((a, b) => (b.perdida_ranking || 0) - (a.perdida_ranking || 0)).find((c) => (c.perdida_ranking || 0) >= 0.05) || null;
  return { campanas, mayor_perdida_presupuesto: masPerdidaPresupuesto, mayor_perdida_ranking: masPerdidaRanking };
}

// ── 5) Búsquedas que gastan sin convertir ────────────────────────────
export function armarTerminosSinConvertir(filas, max = MAX_TERMINOS) {
  const m = new Map();
  for (const f of filas) {
    const termino = String(f.searchTermView?.searchTerm || '').trim();
    if (!termino) continue;
    const clave = `${termino.toLowerCase()}|${f.campaign?.id}`;
    const x = m.get(clave) || { termino, campana: f.campaign?.name || String(f.campaign?.id), gasto: 0, clics: 0, impresiones: 0, conversiones: 0 };
    x.gasto += dinero(f.metrics?.costMicros); x.clics += num(f.metrics?.clicks); x.impresiones += num(f.metrics?.impressions); x.conversiones += num(f.metrics?.conversions);
    m.set(clave, x);
  }
  const todos = [...m.values()];
  const sin = todos.filter((x) => x.conversiones === 0 && x.clics >= MIN_CLICS_TERMINO && x.gasto > 0).sort((a, b) => b.gasto - a.gasto);
  const gastoTotalTerminos = todos.reduce((s, x) => s + x.gasto, 0);
  const gastoSin = sin.reduce((s, x) => s + x.gasto, 0);
  return {
    terminos: sin.slice(0, max).map((x) => ({ ...x, gasto: redondear(x.gasto) })),
    cantidad: sin.length, gasto_sin_convertir: redondear(gastoSin),
    pct_del_gasto_en_busquedas: gastoTotalTerminos > 0 ? gastoSin / gastoTotalTerminos : null,
    nota: 'Solo campañas que muestran búsquedas (Búsqueda y Shopping): las búsquedas dentro de Performance Max no se detallan aquí.',
  };
}

// ── Lectura del ERP: toques y mensajes reales por campaña ────────────
export async function mensajesPorCampana(sql, desde, hasta) {
  const r = await sql.query(
    `SELECT campana_id, campana, count(*)::int AS toques, count(mensaje_id)::int AS mensajes
       FROM wa_clics_ads WHERE (creado_en AT TIME ZONE 'America/Santiago')::date BETWEEN $1::date AND $2::date GROUP BY 1, 2`,
    [desde, hasta],
  );
  return r.rows;
}

export function validarRango(desde, hasta, ahora = new Date()) {
  const hoy = fechaChile(ahora);
  if (!esFechaDia(desde) || !esFechaDia(hasta)) return { error: 'Fechas inválidas (usa AAAA-MM-DD)' };
  if (desde > hasta) return { error: 'La fecha "desde" no puede ser posterior a "hasta"' };
  if (hasta > hoy) hasta = hoy;
  if (desde > hoy) return { error: 'El período empieza en el futuro' };
  if ((Date.parse(hasta) - Date.parse(desde)) / 86400000 > MAX_DIAS_RANGO) return { error: `El período no puede superar ${MAX_DIAS_RANGO} días` };
  return { desde, hasta };
}

// Arma el análisis completo. Cada bloque falla por separado (error propio) para que la página muestre lo que sí se pudo leer.
// deps permite probarlo sin llamar a Google ni a la base: { env, consultar, token, sql, leerErp }.
export async function analizarGoogleAds({ desde, hasta, env = process.env, sql = null, consultar = consultarGaql, obtenerToken = obtenerAccessToken, leerErp = mensajesPorCampana }) {
  const faltan = faltanVariablesGoogleAds(env);
  if (faltan.length) return { sin_configurar: true, faltan };
  const token = await obtenerToken(env);
  const q = consultasGaql(desde, hasta);
  const llamar = (clave) => consultar(env, token, q[clave]);
  const [campanas, redes, acciones, cuota, terminos, erp] = await Promise.allSettled([
    llamar('campanas'), llamar('redes'), llamar('acciones'), llamar('cuota'), llamar('terminos'),
    sql ? leerErp(sql, desde, hasta) : Promise.reject(new Error('Sin conexión a la base del ERP')),
  ]);
  const err = (r) => (r.status === 'rejected' ? String(r.reason?.message || r.reason).slice(0, 220) : null);
  const erpFilas = erp.status === 'fulfilled' ? erp.value : null;
  const erpTotales = erpFilas ? erpFilas.reduce((s, x) => ({ toques: s.toques + num(x.toques), mensajes: s.mensajes + num(x.mensajes) }), { toques: 0, mensajes: 0 }) : null;
  return {
    desde, hasta, moneda: 'CLP', generado_en: new Date().toISOString(),
    errores: { costo_por_mensaje: err(campanas), redes: err(redes), conversiones: err(acciones), cuota: err(cuota), terminos: err(terminos), erp: err(erp) },
    costo_por_mensaje: campanas.status === 'fulfilled' ? armarCostoPorMensaje(campanas.value, erpFilas) : null,
    redes: redes.status === 'fulfilled' ? armarGastoPorRed(redes.value) : null,
    conversiones: acciones.status === 'fulfilled' ? armarConversiones(acciones.value, erpTotales) : null,
    cuota: cuota.status === 'fulfilled' ? armarCuota(cuota.value) : null,
    terminos: terminos.status === 'fulfilled' ? armarTerminosSinConvertir(terminos.value) : null,
  };
}

// /lib/google-ads-resumen.js
// ══════════════════════════════════════════════════════════════════════
// Resumen semanal de Google Ads (últimos 15 y 30 días) -- notificación
// "google-ads-resumen-semanal" (ver lib/notificaciones.js y el cron de
// los domingos en vercel.json).
// ══════════════════════════════════════════════════════════════════════
// Lee la cuenta de Google Ads directo de su API REST (sin librerías: Vercel
// Hobby no tiene Python y este proyecto no usa bundler) con los mismos
// nombres de variables de entorno que el .env del conector local
// (google-ads-mcp), para poder copiarlas tal cual a Vercel:
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
//   GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID (la MCC) y
//   GOOGLE_ADS_DEFAULT_CUSTOMER_ID (la cuenta de IndexStore).
//
// Regla del usuario (12-oct-2026): las notificaciones NO llevan datos
// financieros. Por eso el correo, por defecto, trae solo cantidades (clics,
// conversiones, compras), tasas y variaciones en %, SIN montos en pesos
// (gasto, costo por conversión, ventas). Con GOOGLE_ADS_RESUMEN_INCLUIR_MONTOS=1
// se agregan -- pensado solo para cuando el único suscriptor es el dueño.
//
// Todo el armado (fechas, agregación, alertas, HTML) son funciones puras
// exportadas, para poder probarlas sin llamar a Google.

import { tarjetas, avisos as avisosBase, seccion, tabla, armarCorreo } from './correo-base.js';

const VARIABLES_REQUERIDAS = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
  'GOOGLE_ADS_DEFAULT_CUSTOMER_ID',
];
const TIMEOUT_MS = 25000;
const ZONA = 'America/Santiago';
const SIN_MONTOS_NOTA = 'Esta notificación no incluye montos en pesos (regla de notificaciones del ERP).';

export function faltanVariablesGoogleAds(env = process.env) {
  return VARIABLES_REQUERIDAS.filter((k) => !String(env[k] || '').trim());
}

export async function fetchWithTimeout(url, opciones, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opciones, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function obtenerAccessToken(env) {
  const r = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw new Error(`Google rechazó el token de acceso (${r.status}): ${data.error_description || data.error || 'sin detalle'}`);
  }
  return data.access_token;
}

// searchStream devuelve un arreglo de lotes { results: [...] }; se aplanan.
export async function consultarGaql(env, token, query) {
  const version = env.GOOGLE_ADS_API_VERSION || 'v25';
  const cliente = String(env.GOOGLE_ADS_DEFAULT_CUSTOMER_ID).replace(/-/g, '');
  const r = await fetchWithTimeout(`https://googleads.googleapis.com/${version}/customers/${cliente}/googleAds:searchStream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN,
      'login-customer-id': String(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/-/g, ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = data?.error?.details?.[0]?.errors?.[0]?.message || data?.error?.message || `HTTP ${r.status}`;
    throw new Error(`Google Ads API: ${msg}`);
  }
  return (Array.isArray(data) ? data : []).flatMap((lote) => lote.results || []);
}

// ── Fechas (siempre en hora de Chile) ────────────────────────────────

const aISO = (ms) => new Date(ms).toISOString().slice(0, 10);
const sumarDias = (iso, n) => aISO(Date.parse(`${iso}T00:00:00Z`) + n * 86400000);

export function fechaChile(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(ahora); // AAAA-MM-DD
}

// Las ventanas terminan AYER: el día en curso está incompleto.
export function calcularVentanas(hoy) {
  const fin = sumarDias(hoy, -1);
  return {
    hoy,
    fin,
    w15: [sumarDias(fin, -14), fin],
    prev15: [sumarDias(fin, -29), sumarDias(fin, -15)],
    w30: [sumarDias(fin, -29), fin],
    desde7: sumarDias(hoy, -7),
  };
}

// ── Agregación ───────────────────────────────────────────────────────

const num = (v) => Number(v || 0);

export function agregarCampanas(filas) {
  const m = new Map();
  for (const f of filas) {
    const id = String(f.campaign?.id);
    const x = m.get(id) || { id, nombre: f.campaign?.name || id, estado: f.campaign?.status || '', clics: 0, impr: 0, costo: 0, conv: 0 };
    x.clics += num(f.metrics?.clicks);
    x.impr += num(f.metrics?.impressions);
    x.costo += num(f.metrics?.costMicros) / 1e6;
    x.conv += num(f.metrics?.conversions);
    m.set(id, x);
  }
  return m;
}

export function agregarCompras(filas) {
  const m = new Map();
  for (const f of filas) {
    const id = String(f.campaign?.id);
    const x = m.get(id) || { compras: 0, valor: 0 };
    x.compras += num(f.metrics?.conversions);
    x.valor += num(f.metrics?.conversionsValue);
    m.set(id, x);
  }
  return m;
}

export function totalizar(camps, compras) {
  const t = { clics: 0, impr: 0, costo: 0, conv: 0, compras: 0, valor: 0 };
  for (const c of camps.values()) { t.clics += c.clics; t.impr += c.impr; t.costo += c.costo; t.conv += c.conv; }
  for (const c of compras.values()) { t.compras += c.compras; t.valor += c.valor; }
  t.ctr = t.impr ? (t.clics / t.impr) * 100 : 0;
  t.tasa = t.clics ? (t.conv / t.clics) * 100 : 0;
  t.costoConv = t.conv ? t.costo / t.conv : null;
  return t;
}

// Une las tres ventanas por campaña. cambiosBudget: filas de change_event.
export function construirResumen({ ventanas, camp, compras, cambiosBudget }) {
  const ids = new Set([...camp.w15.keys(), ...camp.prev15.keys(), ...camp.w30.keys()]);
  const vacio = { clics: 0, impr: 0, costo: 0, conv: 0 };
  const campanas = [];
  for (const id of ids) {
    const a = camp.w15.get(id) || vacio;
    const p = camp.prev15.get(id) || vacio;
    const m = camp.w30.get(id) || vacio;
    const ref = camp.w30.get(id) || camp.w15.get(id) || camp.prev15.get(id);
    if (!(m.clics > 0 || a.clics > 0 || p.clics > 0)) continue;
    campanas.push({
      id,
      nombre: ref.nombre,
      estado: ref.estado,
      a: { ...a, compras: compras.w15.get(id)?.compras || 0, valor: compras.w15.get(id)?.valor || 0 },
      p: { ...p, compras: compras.prev15.get(id)?.compras || 0 },
      m: { ...m, compras: compras.w30.get(id)?.compras || 0, valor: compras.w30.get(id)?.valor || 0 },
    });
  }
  campanas.sort((x, y) => y.a.conv - x.a.conv);

  const cambiosPorCampana = new Map();
  for (const c of cambiosBudget || []) {
    const id = String(c.changeEvent?.campaign || '').split('/').pop();
    if (id) cambiosPorCampana.set(id, (cambiosPorCampana.get(id) || 0) + 1);
  }
  return {
    ventanas,
    totales: {
      w15: totalizar(camp.w15, compras.w15),
      prev15: totalizar(camp.prev15, compras.prev15),
      w30: totalizar(camp.w30, compras.w30),
    },
    campanas,
    cambiosPresupuesto: {
      total: [...cambiosPorCampana.values()].reduce((s, n) => s + n, 0),
      campanas: cambiosPorCampana.size,
      inestables: campanas.filter((c) => (cambiosPorCampana.get(c.id) || 0) >= 3)
        .map((c) => ({ nombre: c.nombre, cambios: cambiosPorCampana.get(c.id) })),
    },
  };
}

const pct = (actual, previo) => (previo ? Math.round(((actual - previo) / previo) * 100) : null);

// Alertas por cantidades (nunca por montos): ver regla de notificaciones.
export function detectarAlertas(resumen) {
  const alertas = [];
  const { w15, prev15 } = resumen.totales;
  const dConv = pct(w15.conv, prev15.conv);
  if (dConv !== null && dConv <= -25 && prev15.conv >= 30) {
    alertas.push({ nivel: 'aviso', texto: `Las conversiones de la cuenta cayeron ${Math.abs(dConv)}% frente a los 15 días previos (${fmt(prev15.conv)} → ${fmt(w15.conv)}).` });
  }
  const dCompras = pct(w15.compras, prev15.compras);
  if (dCompras !== null && dCompras <= -30 && prev15.compras >= 5) {
    alertas.push({ nivel: 'aviso', texto: `Las compras atribuidas bajaron ${Math.abs(dCompras)}% (${fmt(prev15.compras)} → ${fmt(w15.compras)}).` });
  }
  for (const c of resumen.campanas) {
    const { a, p } = c;
    const d = pct(a.conv, p.conv);
    if (p.conv >= 20 && d !== null && d <= -30) {
      alertas.push({ nivel: 'aviso', texto: `${c.nombre}: conversiones ${d}% vs. los 15 días previos (${fmt(p.conv)} → ${fmt(a.conv)}).` });
    }
    if (a.clics >= 100 && a.conv === 0) {
      alertas.push({ nivel: 'aviso', texto: `${c.nombre}: ${fmt(a.clics)} clics y ninguna conversión en 15 días.` });
    }
    const tasaA = a.clics ? a.conv / a.clics : 0;
    const tasaP = p.clics ? p.conv / p.clics : 0;
    if (a.clics >= 100 && p.clics >= 100 && tasaP > 0 && tasaA <= tasaP * 0.7 && !(p.conv >= 20 && d !== null && d <= -30)) {
      alertas.push({ nivel: 'aviso', texto: `${c.nombre}: la tasa de conversión bajó de ${fmt(tasaP * 100, 1)}% a ${fmt(tasaA * 100, 1)}%.` });
    }
    if (c.estado !== 'ENABLED' && a.clics > 0) {
      alertas.push({ nivel: 'info', texto: `${c.nombre}: está ${c.estado === 'PAUSED' ? 'pausada' : 'eliminada'} y tuvo ${fmt(a.clics)} clics en el período.` });
    }
    if (p.clics === 0 && a.clics >= 50) {
      alertas.push({ nivel: 'info', texto: `${c.nombre}: campaña nueva (sin actividad en los 15 días previos), ${fmt(a.conv)} conversiones.` });
    }
  }
  const inestables = resumen.cambiosPresupuesto.inestables;
  if (inestables.length) {
    alertas.push({ nivel: 'info', texto: `${inestables.length} campaña${inestables.length === 1 ? '' : 's'} con 3 o más cambios de presupuesto en los últimos 7 días (cada cambio grande reinicia el aprendizaje de la puja): ${inestables.map((i) => `${i.nombre} (${i.cambios})`).join(', ')}.` });
  }
  return alertas.sort((x, y) => (x.nivel === y.nivel ? 0 : x.nivel === 'aviso' ? -1 : 1));
}

// ── Formato ──────────────────────────────────────────────────────────

function fmt(n, dec = 0) {
  return Number(n).toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
const pesos = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ddmm = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
const ddmmaaaa = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const diaSemana = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-CL', { weekday: 'long', timeZone: 'UTC' });

function variacion(actual, previo, { buenoSiSube = true, neutro = false, minBase = 0 } = {}) {
  const p = pct(actual, previo);
  if (p === null) return '<span style="color:#6B7280;">—</span>';
  if (previo < minBase) return '<span style="color:#6B7280;">sin base</span>'; // base previa tan chica que el % no dice nada
  if (p === 0) return '<span style="color:#6B7280;">＝ igual</span>';
  const sube = p > 0;
  const color = neutro ? '#6B7280' : (sube === buenoSiSube ? '#15803D' : '#DC2626');
  return `<span style="color:${color};">${sube ? '▲' : '▼'} ${sube ? '+' : ''}${p}%</span>`;
}

export function armarCorreoGoogleAds(resumen, { incluirMontos = false } = {}) {
  const { w15, prev15, w30 } = resumen.totales;
  const v = resumen.ventanas;
  const cifra = (x, d = 0) => fmt(x, d);
  const filaCuenta = (nombre, a, p, m, f, opts) => [nombre, f(a), f(p), variacion(a, p, opts), f(m)];
  const filas = [
    filaCuenta('Clics', w15.clics, prev15.clics, w30.clics, (x) => fmt(x), { neutro: true }),
    filaCuenta('CTR', w15.ctr, prev15.ctr, w30.ctr, (x) => `${fmt(x, 2)}%`, { neutro: true }),
    filaCuenta('Conversiones', w15.conv, prev15.conv, w30.conv, (x) => fmt(x)),
    filaCuenta('Tasa de conversión (conv./clics)', w15.tasa, prev15.tasa, w30.tasa, (x) => `${fmt(x, 1)}%`),
    filaCuenta('Compras atribuidas', w15.compras, prev15.compras, w30.compras, (x) => fmt(x)),
  ];
  if (incluirMontos) {
    filas.push(filaCuenta('Gasto', w15.costo, prev15.costo, w30.costo, pesos, { neutro: true }));
    filas.push(filaCuenta('Costo por conversión', w15.costoConv || 0, prev15.costoConv || 0, w30.costoConv || 0, pesos, { buenoSiSube: false }));
    filas.push(filaCuenta('Ventas atribuidas', w15.valor, prev15.valor, w30.valor, pesos));
  }

  const alertas = detectarAlertas(resumen);
  const tonoVar = (a, p) => { const d = pct(a, p); return d === null ? 'gris' : d > 0 ? 'verde' : d < 0 ? 'rojo' : 'gris'; };
  const subVar = (a, p) => { const d = pct(a, p); return d === null ? 'sin base previa' : `${d > 0 ? '▲ +' : d < 0 ? '▼ ' : '＝ '}${d}% vs. 15 días previos`; };
  const kpis = tarjetas([
    { etiqueta: '🎯 Conversiones', cifra: cifra(w15.conv), sub: subVar(w15.conv, prev15.conv), tono: tonoVar(w15.conv, prev15.conv) },
    { etiqueta: '🖱️ Clics', cifra: cifra(w15.clics), sub: subVar(w15.clics, prev15.clics), tono: 'azul' },
    { etiqueta: '📈 Tasa de conversión', cifra: `${fmt(w15.tasa, 1)}%`, sub: `antes ${fmt(prev15.tasa, 1)}%`, tono: tonoVar(w15.tasa, prev15.tasa) },
    { etiqueta: '🛒 Compras atribuidas', cifra: cifra(w15.compras), sub: subVar(w15.compras, prev15.compras), tono: tonoVar(w15.compras, prev15.compras) },
  ]);
  const bloqueAlertas = alertas.length
    ? avisosBase(alertas.map((a) => ({ tono: a.nivel === 'aviso' ? 'naranja' : 'azul', texto: `${a.nivel === 'aviso' ? '⚠️' : 'ℹ️'} ${esc(a.texto)}` })), '🚨 Para revisar')
    : `<div style="margin-top:16px;background:#E3F6EA;border-radius:12px;padding:14px 18px;font-size:13.5px;color:#12713A;">✅ <b>Sin alertas esta semana.</b></div>`;

  const colsCamp = [{ titulo: 'Campaña' }, { titulo: 'Estado' }, { titulo: 'Conv. 15 días', alinear: 'right' }, { titulo: 'vs. previos', alinear: 'right' }, { titulo: 'Tasa conv.', alinear: 'right' }, { titulo: 'Compras 30 días', alinear: 'right' }];
  if (incluirMontos) colsCamp.push({ titulo: 'Gasto 15 días', alinear: 'right' }, { titulo: 'Costo/conv.', alinear: 'right' });
  const filasCamp = resumen.campanas.map((c) => {
    const tasa = c.a.clics ? (c.a.conv / c.a.clics) * 100 : 0;
    const estado = c.estado === 'ENABLED' ? 'Activa' : c.estado === 'PAUSED' ? 'Pausada' : 'Eliminada';
    const fila = [`<b>${esc(c.nombre)}</b>`, `<span style="color:${c.estado === 'ENABLED' ? '#15803D' : '#6B7280'};font-weight:700;">${estado}</span>`, fmt(c.a.conv), variacion(c.a.conv, c.p.conv, { minBase: 5 }), `${fmt(tasa, 1)}%`, fmt(c.m.compras)];
    if (incluirMontos) fila.push(pesos(c.a.costo), pesos(c.a.conv ? c.a.costo / c.a.conv : null));
    return fila;
  });

  const cuerpo = kpis + bloqueAlertas
    + seccion('📊 La cuenta', `Últimos 15 días: ${ddmm(v.w15[0])} al ${ddmm(v.w15[1])} · 15 días previos: ${ddmm(v.prev15[0])} al ${ddmm(v.prev15[1])} · últimos 30 días: ${ddmm(v.w30[0])} al ${ddmm(v.w30[1])}.`,
      tabla([{ titulo: 'Indicador' }, { titulo: 'Últimos 15 días', alinear: 'right' }, { titulo: '15 días previos', alinear: 'right' }, { titulo: 'Variación', alinear: 'right' }, { titulo: 'Últimos 30 días', alinear: 'right' }], filas))
    + seccion('📣 Por campaña', 'Ordenadas por conversiones de los últimos 15 días.', tabla(colsCamp, filasCamp));
  const html = armarCorreo({
    etiqueta: 'IndexStore · Google Ads', titulo: 'Resumen semanal', subtitulo: `${diaSemana(v.hoy)} ${ddmmaaaa(v.hoy)} · datos hasta el ${diaSemana(v.fin)} ${ddmmaaaa(v.fin)} (el día en curso no se cuenta)`,
    cuerpo, boton: null,
    leyenda: `fuente: API de Google Ads, cuenta IndexStore. "Conversiones" incluye contactos de WhatsApp y compras; "Compras atribuidas" son solo las compras que Google registra. Verde = mejora frente a los 15 días previos, rojo = empeora.${incluirMontos ? '' : ` ${SIN_MONTOS_NOTA}`}`,
  });

  const asunto = `📈 Google Ads — resumen semanal (${diaSemana(v.hoy)} ${ddmm(v.hoy)}): ${fmt(w15.conv)} conversiones en 15 días`;
  return { asunto, html };
}

// ── Orquestación (única parte que llama a Google) ────────────────────

export async function generarResumenGoogleAds(env = process.env, ahora = new Date()) {
  const ventanas = calcularVentanas(fechaChile(ahora));
  const token = await obtenerAccessToken(env);
  const q = (query) => consultarGaql(env, token, query);
  const sqlCamp = ([a, b]) => `SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${a}' AND '${b}'`;
  const sqlCompras = ([a, b]) => `SELECT campaign.id, segments.conversion_action_category, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${a}' AND '${b}' AND segments.conversion_action_category = PURCHASE`;
  const sqlCambios = `SELECT change_event.change_date_time, change_event.change_resource_type, change_event.campaign FROM change_event WHERE change_event.change_date_time >= '${ventanas.desde7} 00:00:00' AND change_event.change_date_time <= '${ventanas.hoy} 23:59:59' AND change_event.change_resource_type = CAMPAIGN_BUDGET ORDER BY change_event.change_date_time DESC LIMIT 1000`;

  const [c15, cPrev, c30, p15, pPrev, p30, cambios] = await Promise.all([
    q(sqlCamp(ventanas.w15)), q(sqlCamp(ventanas.prev15)), q(sqlCamp(ventanas.w30)),
    q(sqlCompras(ventanas.w15)), q(sqlCompras(ventanas.prev15)), q(sqlCompras(ventanas.w30)),
    q(sqlCambios).catch(() => []), // el historial de cambios es accesorio: si falla, el resumen sale igual
  ]);
  return construirResumen({
    ventanas,
    camp: { w15: agregarCampanas(c15), prev15: agregarCampanas(cPrev), w30: agregarCampanas(c30) },
    compras: { w15: agregarCompras(p15), prev15: agregarCompras(pPrev), w30: agregarCompras(p30) },
    cambiosBudget: cambios,
  });
}

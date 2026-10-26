// /lib/search-console.js
// ═════════════════════════════════════════════════════════════════════
// Página "Search Console" (Análisis): cómo aparece indexstore.cl en Google de forma orgánica. Solo lectura.
// Se conecta con la MISMA cuenta de servicio de Google Analytics (GOOGLE_ANALYTICS_CLIENT_EMAIL / GOOGLE_ANALYTICS_PRIVATE_KEY);
// basta agregar su correo como usuario de la propiedad en Search Console y activar "Google Search Console API" en el proyecto de Google Cloud.
// Variables opcionales: SEARCH_CONSOLE_SITE (por defecto "sc-domain:indexstore.cl"; con propiedad de prefijo de URL, "https://indexstore.cl/"),
// SEARCH_CONSOLE_CLIENT_EMAIL / SEARCH_CONSOLE_PRIVATE_KEY (si se quiere otra cuenta de servicio distinta a la de Analytics).
//
// Secciones (una por pestaña, se piden recién al abrirlas):
//   resumen        clics, impresiones, CTR y posición contra el período anterior, serie diaria, dispositivos y tipo de página.
//   consultas      búsquedas que traen tráfico, con cambio contra el período anterior.
//   paginas        páginas que traen tráfico, con cambio contra el período anterior.
//   oportunidades  CTR bajo para su posición, búsquedas en posición 4-15 y canibalización (varias URLs para la misma búsqueda).
//   landings       las landings casi sin enlaces internos (auditoría SEO del 25-oct-2026): totales y sus consultas principales.
//   indexacion     propiedades visibles, sitemaps enviados y el inspector de URL.
// Las funciones de armado son puras y exportadas (se prueban con datos simulados).
// ═════════════════════════════════════════════════════════════════════
import { sign as firmarRsaSha256 } from 'node:crypto';

export const SCOPE_SEARCH_CONSOLE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const SITIO_POR_DEFECTO = 'sc-domain:indexstore.cl';
export const DOMINIO = 'indexstore.cl';
export const MAX_DIAS_RANGO = 480;       // Search Console conserva 16 meses
export const RETRASO_DIAS = 3;           // los datos de los últimos 2-3 días aún no están completos
export const MAX_FILAS_PAGINA = 25000;   // máximo por solicitud de la API
export const MAX_FILAS_TOTAL = 50000;    // tope de filas consulta+página que se traen
export const TIMEOUT_MS = 25000;

// Landings casi sin enlaces internos (ver memoria de la auditoría SEO). Se muestran siempre en la pestaña "Landings".
export const LANDINGS_HUERFANAS = [
  '/pages/cargadores-para-notebook-indexstore',
  '/pages/pantallas-para-notebook-indexstore',
  '/pages/baterias-para-notebok-indexstore',
  '/pages/pantallas-para-notebook-lenovo-indexstore',
  '/pages/pantallas-para-notebook-hp-indexstore',
  '/pages/pantallas-para-notebook-asus-indexstore',
  '/pages/pantallas-para-notebook-acer-indexstore',
  '/pages/pantallas-para-notebook-dell-indexstore',
  '/pages/bateria-para-notebok-hp-indexstore',
  '/pages/cargador-para-notebok-hp-indexstore',
  '/pages/cargador-para-notebok-acer-indexstore',
  '/pages/cargador-para-notebok-asus-indexstore',
  '/pages/pantalla-para-notebook-instalacion-20minutos',
  '/pages/cargadores-para-notebook',
  '/pages/cargadores-notebook-originales-daxis',
  '/pages/soluciones-informaticas-integrales-lenovo',
  '/pages/soluciones-informaticas-integrales-asus',
  '/pages/soluciones-informaticas-integrales-hp',
  '/pages/soluciones-informaticas-integrales-acer',
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
export function fechaChile(ahora = new Date()) {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

// Rango pedido (o los últimos 28 días que ya tienen datos) y el período anterior de la misma duración, pegado justo antes.
export function validarRango(desde, hasta, ahora = new Date()) {
  const tope = sumarDias(fechaChile(ahora), -RETRASO_DIAS);
  const h = esFechaDia(hasta) ? hasta : tope;
  const d = esFechaDia(desde) ? desde : sumarDias(h, -27);
  if (d > h) return { error: 'La fecha "desde" no puede ser posterior a "hasta"' };
  const dias = diasEntre(d, h);
  if (dias > MAX_DIAS_RANGO) return { error: `El rango no puede superar ${MAX_DIAS_RANGO} días` };
  const antHasta = sumarDias(d, -1);
  return { desde: d, hasta: h, dias, anterior: { desde: sumarDias(antHasta, -(dias - 1)), hasta: antHasta } };
}

// ── Autenticación (cuenta de servicio) ───────────────────────────────
const base64Url = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

export function credencialesSearchConsole(env = process.env) {
  const email = String(env.SEARCH_CONSOLE_CLIENT_EMAIL || env.GOOGLE_ANALYTICS_CLIENT_EMAIL || '').trim();
  const clave = String(env.SEARCH_CONSOLE_PRIVATE_KEY || env.GOOGLE_ANALYTICS_PRIVATE_KEY || '').trim().replace(/\\n/g, '\n');
  return { email, clave };
}
export function sitioSearchConsole(env = process.env) {
  return String(env.SEARCH_CONSOLE_SITE || '').trim() || SITIO_POR_DEFECTO;
}

export async function fetchWithTimeout(url, opciones = {}, ms = TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opciones, signal: ctl.signal }); } finally { clearTimeout(t); }
}

export async function obtenerAccessToken(env = process.env) {
  const { email, clave } = credencialesSearchConsole(env);
  if (!email || !clave) throw new Error('Faltan GOOGLE_ANALYTICS_CLIENT_EMAIL / GOOGLE_ANALYTICS_PRIVATE_KEY (o SEARCH_CONSOLE_CLIENT_EMAIL / SEARCH_CONSOLE_PRIVATE_KEY)');
  const ahora = Math.floor(Date.now() / 1000);
  const encabezado = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cuerpo = base64Url(JSON.stringify({ iss: email, scope: SCOPE_SEARCH_CONSOLE, aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }));
  const sinFirmar = `${encabezado}.${cuerpo}`;
  const jwt = `${sinFirmar}.${base64Url(firmarRsaSha256('RSA-SHA256', Buffer.from(sinFirmar), clave))}`;
  const r = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  }, 15000);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Google rechazó las credenciales de la cuenta de servicio');
  return data.access_token;
}

// Mensaje claro cuando Google responde con error (lo más común: falta dar acceso o activar la API).
export function explicarErrorGoogle(estado, data, email) {
  const msg = data?.error?.message || data?.error_description || '';
  if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(msg) || data?.error?.status === 'PERMISSION_DENIED' && /API/i.test(msg)) {
    return `La API de Search Console no está activada en el proyecto de Google Cloud de la cuenta de servicio. Actívala en "APIs y servicios > Biblioteca > Google Search Console API". (${msg.slice(0, 160)})`;
  }
  if (estado === 403 || estado === 404) {
    return `La cuenta de servicio no tiene acceso a la propiedad. En Search Console: Configuración > Usuarios y permisos > Agregar usuario, con el correo ${email || '(el de la cuenta de servicio)'} y permiso "Completo" o "Restringido". (${msg.slice(0, 160)})`;
  }
  return msg || `Google respondió ${estado}`;
}

async function llamarGoogle(token, url, opciones, email) {
  const r = await fetchWithTimeout(url, {
    ...opciones,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opciones?.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(explicarErrorGoogle(r.status, data, email)); e.estado = r.status; throw e; }
  return data;
}

// Una consulta a Search Analytics. dimensiones: ['query'], ['page'], ['date'], ['device'], ['query','page']...
// pais: código ISO-3 ("CHL") o null para todos los países. Pagina de a 25.000 filas hasta `max`.
export async function consultarAnalitica(token, sitio, { desde, hasta, dimensiones, pais = null, max = MAX_FILAS_PAGINA, filtros = [] }, email) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(sitio)}/searchAnalytics/query`;
  const grupo = [...filtros];
  if (pais) grupo.push({ dimension: 'country', operator: 'equals', expression: String(pais).toLowerCase() });
  const filas = [];
  for (let inicio = 0; inicio < max; inicio += MAX_FILAS_PAGINA) {
    const limite = Math.min(MAX_FILAS_PAGINA, max - inicio);
    const cuerpo = { startDate: desde, endDate: hasta, dimensions: dimensiones, rowLimit: limite, startRow: inicio, dataState: 'final' };
    if (grupo.length) cuerpo.dimensionFilterGroups = [{ groupType: 'and', filters: grupo }];
    const d = await llamarGoogle(token, url, { method: 'POST', body: JSON.stringify(cuerpo) }, email);
    const lote = d.rows || [];
    filas.push(...lote);
    if (lote.length < limite) break;
  }
  return filas;
}

// ── Utilidades de armado ─────────────────────────────────────────────
// Ruta de una URL del sitio ("https://indexstore.cl/pages/x?y=1" -> "/pages/x"); si no se puede leer, devuelve el texto tal cual.
export function rutaDe(url) {
  try { const u = new URL(url); return (u.pathname.replace(/\/+$/, '') || '/'); } catch { return String(url || ''); }
}
export function clasificarUrl(url) {
  const r = rutaDe(url);
  if (r === '/') return 'Inicio';
  if (r.startsWith('/products/')) return 'Fichas de producto';
  if (r.startsWith('/collections/')) return 'Colecciones';
  if (r.startsWith('/pages/')) return 'Páginas (landings)';
  if (r.startsWith('/blogs/')) return 'Artículos del blog';
  return 'Otras';
}

// Fila de la API -> { clave: [...], clics, impresiones, ctr, posicion }
export function normalizarFila(f) {
  return { claves: f.keys || [], clics: num(f.clicks), impresiones: num(f.impressions), ctr: num(f.ctr), posicion: num(f.position) };
}

// Suma de filas; la posición se promedia ponderada por impresiones (así se calcula en Search Console).
export function sumarFilas(filas) {
  let clics = 0, impresiones = 0, posImp = 0;
  for (const f of filas) { clics += f.clics; impresiones += f.impresiones; posImp += f.posicion * f.impresiones; }
  return { clics, impresiones, ctr: impresiones > 0 ? clics / impresiones : 0, posicion: impresiones > 0 ? posImp / impresiones : 0 };
}
// Total de un grupo con el total devuelto por la API cuando no hay dimensiones (más exacto que sumar filas truncadas).
export function totalDe(filasSinDimension) {
  const f = (filasSinDimension || [])[0];
  return f ? { clics: num(f.clicks), impresiones: num(f.impressions), ctr: num(f.ctr), posicion: num(f.position) } : { clics: 0, impresiones: 0, ctr: 0, posicion: 0 };
}
// Variación contra el período anterior. En la posición, un número MENOR es mejor, así que el cambio se entrega tal cual (negativo = mejoró).
export function variacion(actual, anterior) {
  const pct = (a, b) => (b > 0 ? (a - b) / b : null);
  return {
    clics: pct(actual.clics, anterior.clics), impresiones: pct(actual.impresiones, anterior.impresiones),
    ctr: actual.ctr - anterior.ctr, posicion: anterior.posicion > 0 && actual.posicion > 0 ? actual.posicion - anterior.posicion : null,
  };
}

// Cruza dos períodos por clave (consulta o página). Devuelve ordenado por clics y luego impresiones.
export function compararPeriodos(filasActual, filasAnterior, nombreClave, transformar = (x) => x) {
  const ant = new Map();
  for (const f of filasAnterior) ant.set(transformar(f.claves[0]), f);
  const salida = filasActual.map((f) => {
    const k = transformar(f.claves[0]);
    const a = ant.get(k);
    return {
      [nombreClave]: k, clics: f.clics, impresiones: f.impresiones, ctr: redondear(f.ctr, 4), posicion: redondear(f.posicion, 1),
      clics_ant: a ? a.clics : 0, impresiones_ant: a ? a.impresiones : 0, posicion_ant: a ? redondear(a.posicion, 1) : null,
      dif_clics: f.clics - (a ? a.clics : 0),
    };
  });
  return salida.sort((x, y) => y.clics - x.clics || y.impresiones - x.impresiones);
}

// Agrupa filas de página por tipo de URL.
export function agruparPorTipo(filasPagActual, filasPagAnterior) {
  const tipos = new Map();
  const acum = (filas, campo) => {
    for (const f of filas) {
      const t = clasificarUrl(f.claves[0]);
      const x = tipos.get(t) || { tipo: t, act: [], ant: [], paginas: 0, paginas_con_clics: 0 };
      x[campo].push(f);
      if (campo === 'act') { x.paginas += 1; if (f.clics > 0) x.paginas_con_clics += 1; }
      tipos.set(t, x);
    }
  };
  acum(filasPagActual, 'act'); acum(filasPagAnterior, 'ant');
  return [...tipos.values()].map((x) => {
    const a = sumarFilas(x.act), b = sumarFilas(x.ant);
    return { tipo: x.tipo, ...redondearTotales(a), clics_ant: b.clics, impresiones_ant: b.impresiones, paginas: x.paginas, paginas_con_clics: x.paginas_con_clics };
  }).sort((p, q) => q.clics - p.clics);
}
function redondearTotales(t) { return { clics: t.clics, impresiones: t.impresiones, ctr: redondear(t.ctr, 4), posicion: redondear(t.posicion, 1) }; }

// ── Oportunidades ────────────────────────────────────────────────────
// CTR típico por posición en resultados orgánicos (referencia general; el valor real de cada sitio varía). Posición 1 ≈ 28 %, 10 ≈ 2 %.
export function ctrEsperado(posicion) {
  const p = Math.max(1, num(posicion));
  const tabla = [0.28, 0.15, 0.10, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
  if (p <= 10) {
    const i = Math.floor(p) - 1, fr = p - Math.floor(p);
    return tabla[i] + (tabla[Math.min(i + 1, 9)] - tabla[i]) * fr;
  }
  return Math.max(0.002, 0.018 * (10 / p));
}

// filasQP: filas normalizadas con claves [consulta, url].
export const UMBRALES = { ctr_bajo_impresiones: 100, casi_primera_impresiones: 50, canib_total_impresiones: 50, canib_min_impresiones_url: 10, max_filas_tabla: 40 };

export function armarOportunidades(filasQP, u = UMBRALES) {
  const ctrBajo = [], casiPrimera = [];
  for (const f of filasQP) {
    const [consulta, url] = f.claves;
    const base = { consulta, url: rutaDe(url), clics: f.clics, impresiones: f.impresiones, ctr: redondear(f.ctr, 4), posicion: redondear(f.posicion, 1) };
    if (f.posicion <= 10 && f.impresiones >= u.ctr_bajo_impresiones) {
      const esperado = ctrEsperado(f.posicion);
      const perdidos = f.impresiones * esperado - f.clics;
      if (f.ctr < esperado * 0.6 && perdidos >= 3) ctrBajo.push({ ...base, ctr_esperado: redondear(esperado, 4), clics_perdidos: Math.round(perdidos) });
    }
    if (f.posicion > 3.5 && f.posicion <= 15 && f.impresiones >= u.casi_primera_impresiones) {
      const potencial = f.impresiones * ctrEsperado(3) - f.clics;
      if (potencial >= 3) casiPrimera.push({ ...base, clics_potenciales: Math.round(potencial) });
    }
  }
  ctrBajo.sort((a, b) => b.clics_perdidos - a.clics_perdidos);
  casiPrimera.sort((a, b) => b.clics_potenciales - a.clics_potenciales);
  return {
    ctr_bajo: ctrBajo.slice(0, u.max_filas_tabla), total_ctr_bajo: ctrBajo.length, clics_perdidos_ctr: ctrBajo.reduce((s, x) => s + x.clics_perdidos, 0),
    casi_primera: casiPrimera.slice(0, u.max_filas_tabla), total_casi_primera: casiPrimera.length, clics_potenciales: casiPrimera.reduce((s, x) => s + x.clics_potenciales, 0),
    canibalizacion: detectarCanibalizacion(filasQP, u),
  };
}

// Búsquedas en las que dos o más URLs distintas del sitio aparecen (y reparten el tráfico).
export function detectarCanibalizacion(filasQP, u = UMBRALES) {
  const porConsulta = new Map();
  for (const f of filasQP) {
    if (f.impresiones < u.canib_min_impresiones_url) continue;
    const [consulta, url] = f.claves;
    const lista = porConsulta.get(consulta) || [];
    lista.push({ url: rutaDe(url), clics: f.clics, impresiones: f.impresiones, posicion: redondear(f.posicion, 1) });
    porConsulta.set(consulta, lista);
  }
  const salida = [];
  for (const [consulta, urls] of porConsulta) {
    if (urls.length < 2) continue;
    const imp = urls.reduce((s, x) => s + x.impresiones, 0);
    if (imp < u.canib_total_impresiones) continue;
    urls.sort((a, b) => b.clics - a.clics || b.impresiones - a.impresiones);
    salida.push({ consulta, impresiones: imp, clics: urls.reduce((s, x) => s + x.clics, 0), n_urls: urls.length, urls: urls.slice(0, 4) });
  }
  salida.sort((a, b) => b.impresiones - a.impresiones);
  return { total: salida.length, filas: salida.slice(0, u.max_filas_tabla) };
}

// ── Landings ─────────────────────────────────────────────────────────
// filasPagAct / filasPagAnt: filas con clave [url]; filasQP: filas con claves [consulta, url]; rutas: lista de rutas a revisar.
export function armarLandings(rutas, filasPagAct, filasPagAnt, filasQP, topConsultas = 15) {
  const poRuta = (filas) => { const m = new Map(); for (const f of filas) { const r = rutaDe(f.claves[0]); const x = m.get(r) || []; x.push(f); m.set(r, x); } return m; };
  const act = poRuta(filasPagAct), ant = poRuta(filasPagAnt);
  const qpPorRuta = new Map(), qpPorConsulta = new Map();
  for (const f of filasQP) {
    const [consulta, url] = f.claves; const r = rutaDe(url);
    const a = qpPorRuta.get(r) || []; a.push({ consulta, clics: f.clics, impresiones: f.impresiones, posicion: redondear(f.posicion, 1) }); qpPorRuta.set(r, a);
    const b = qpPorConsulta.get(consulta) || []; b.push({ url: r, clics: f.clics, impresiones: f.impresiones }); qpPorConsulta.set(consulta, b);
  }
  return rutas.map((ruta) => {
    const a = sumarFilas(act.get(ruta) || []), b = sumarFilas(ant.get(ruta) || []);
    const consultas = (qpPorRuta.get(ruta) || []).sort((x, y) => y.clics - x.clics || y.impresiones - x.impresiones).slice(0, topConsultas).map((c) => {
      const otras = (qpPorConsulta.get(c.consulta) || []).filter((o) => o.url !== ruta && o.impresiones >= UMBRALES.canib_min_impresiones_url).sort((x, y) => y.impresiones - x.impresiones);
      return { ...c, tambien_en: otras.length ? otras[0].url : null, otras_urls: otras.length };
    });
    return { ruta, ...redondearTotales(a), clics_ant: b.clics, impresiones_ant: b.impresiones, posicion_ant: redondear(b.posicion, 1), consultas };
  }).sort((x, y) => y.clics - x.clics || y.impresiones - x.impresiones);
}

// Ruta que el usuario escribe a mano: debe ser una ruta del sitio, sin espacios ni caracteres raros.
export function validarRutaExtra(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  let ruta = s;
  try { if (/^https?:\/\//i.test(s)) { const u = new URL(s); if (!u.hostname.endsWith(DOMINIO)) return null; ruta = u.pathname; } } catch { return null; }
  ruta = ruta.replace(/\/+$/, '') || '/';
  return /^\/[A-Za-z0-9\-._~%/]*$/.test(ruta) && ruta.length <= 200 ? ruta : null;
}

// ── Secciones (consultan la API y arman la respuesta) ────────────────
function contexto(env, pais) {
  return { sitio: sitioSearchConsole(env), email: credencialesSearchConsole(env).email, pais: pais === 'todos' ? null : (pais || 'CHL') };
}

export async function seccionResumen(token, rango, ctx) {
  const base = { dimensiones: [], pais: ctx.pais };
  const [totAct, totAnt, serie, disp, pagAct, pagAnt] = await Promise.all([
    consultarAnalitica(token, ctx.sitio, { ...base, desde: rango.desde, hasta: rango.hasta, max: 1 }, ctx.email),
    consultarAnalitica(token, ctx.sitio, { ...base, desde: rango.anterior.desde, hasta: rango.anterior.hasta, max: 1 }, ctx.email),
    consultarAnalitica(token, ctx.sitio, { ...base, dimensiones: ['date'], desde: rango.desde, hasta: rango.hasta }, ctx.email),
    consultarAnalitica(token, ctx.sitio, { ...base, dimensiones: ['device'], desde: rango.desde, hasta: rango.hasta }, ctx.email),
    consultarAnalitica(token, ctx.sitio, { ...base, dimensiones: ['page'], desde: rango.desde, hasta: rango.hasta }, ctx.email),
    consultarAnalitica(token, ctx.sitio, { ...base, dimensiones: ['page'], desde: rango.anterior.desde, hasta: rango.anterior.hasta }, ctx.email),
  ]);
  const actual = totalDe(totAct), anterior = totalDe(totAnt);
  const NOMBRES_DISP = { DESKTOP: 'Computador', MOBILE: 'Celular', TABLET: 'Tablet' };
  return {
    actual: redondearTotales(actual), previo: redondearTotales(anterior), variacion: variacion(actual, anterior),
    serie: serie.map(normalizarFila).map((f) => ({ fecha: f.claves[0], clics: f.clics, impresiones: f.impresiones, ctr: redondear(f.ctr, 4), posicion: redondear(f.posicion, 1) })).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    dispositivos: disp.map(normalizarFila).map((f) => ({ dispositivo: NOMBRES_DISP[f.claves[0]] || f.claves[0], ...redondearTotales(f) })).sort((a, b) => b.clics - a.clics),
    tipos: agruparPorTipo(pagAct.map(normalizarFila), pagAnt.map(normalizarFila)),
    paginas_truncadas: pagAct.length >= MAX_FILAS_PAGINA,
  };
}

export async function seccionConsultas(token, rango, ctx) {
  const comun = { dimensiones: ['query'], pais: ctx.pais, max: 5000 };
  const [act, ant] = await Promise.all([
    consultarAnalitica(token, ctx.sitio, { ...comun, desde: rango.desde, hasta: rango.hasta }, ctx.email),
    consultarAnalitica(token, ctx.sitio, { ...comun, desde: rango.anterior.desde, hasta: rango.anterior.hasta }, ctx.email),
  ]);
  const filas = compararPeriodos(act.map(normalizarFila), ant.map(normalizarFila), 'consulta');
  return { total: filas.length, filas: filas.slice(0, 500), sin_clics: filas.filter((f) => f.clics === 0).length };
}

export async function seccionPaginas(token, rango, ctx) {
  const comun = { dimensiones: ['page'], pais: ctx.pais };
  const [act, ant] = await Promise.all([
    consultarAnalitica(token, ctx.sitio, { ...comun, desde: rango.desde, hasta: rango.hasta }, ctx.email),
    consultarAnalitica(token, ctx.sitio, { ...comun, desde: rango.anterior.desde, hasta: rango.anterior.hasta }, ctx.email),
  ]);
  const filas = compararPeriodos(act.map(normalizarFila), ant.map(normalizarFila), 'url', rutaDe).map((f) => ({ ...f, tipo: clasificarUrl(f.url) }));
  return { total: filas.length, filas: filas.slice(0, 500) };
}

async function filasConsultaPagina(token, rango, ctx) {
  const filas = await consultarAnalitica(token, ctx.sitio, { dimensiones: ['query', 'page'], pais: ctx.pais, desde: rango.desde, hasta: rango.hasta, max: MAX_FILAS_TOTAL }, ctx.email);
  return filas.map(normalizarFila);
}

export async function seccionOportunidades(token, rango, ctx) {
  const qp = await filasConsultaPagina(token, rango, ctx);
  return { ...armarOportunidades(qp), filas_leidas: qp.length, truncado: qp.length >= MAX_FILAS_TOTAL, umbrales: UMBRALES };
}

export async function seccionLandings(token, rango, ctx, extra = []) {
  const rutas = [...new Set([...LANDINGS_HUERFANAS, ...extra])];
  const comun = { dimensiones: ['page'], pais: ctx.pais };
  const [pagAct, pagAnt, qp] = await Promise.all([
    consultarAnalitica(token, ctx.sitio, { ...comun, desde: rango.desde, hasta: rango.hasta }, ctx.email),
    consultarAnalitica(token, ctx.sitio, { ...comun, desde: rango.anterior.desde, hasta: rango.anterior.hasta }, ctx.email),
    filasConsultaPagina(token, rango, ctx),
  ]);
  return { landings: armarLandings(rutas, pagAct.map(normalizarFila), pagAnt.map(normalizarFila), qp), extra, truncado: qp.length >= MAX_FILAS_TOTAL };
}

export async function seccionIndexacion(token, ctx) {
  const apiSitio = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(ctx.sitio)}`;
  const [sitios, sitemaps] = await Promise.all([
    llamarGoogle(token, 'https://www.googleapis.com/webmasters/v3/sites', { method: 'GET' }, ctx.email).catch((e) => ({ error: e.message })),
    llamarGoogle(token, `${apiSitio}/sitemaps`, { method: 'GET' }, ctx.email).catch((e) => ({ error: e.message })),
  ]);
  return {
    sitio: ctx.sitio, cuenta: ctx.email,
    propiedades: sitios.error ? { error: sitios.error } : (sitios.siteEntry || []).map((s) => ({ sitio: s.siteUrl, permiso: s.permissionLevel })),
    sitemaps: sitemaps.error ? { error: sitemaps.error } : (sitemaps.sitemap || []).map((s) => ({
      ruta: s.path, ultima_lectura: s.lastDownloaded || null, pendiente: Boolean(s.isPending), es_indice: Boolean(s.isSitemapsIndex), errores: num(s.errors), advertencias: num(s.warnings),
      contenidos: (s.contents || []).map((c) => ({ tipo: c.type, enviadas: num(c.submitted), indexadas: c.indexed == null ? null : num(c.indexed) })),
    })),
  };
}

// Inspección de una URL del sitio (cuota de Google: 2.000 al día por propiedad, 600 por minuto).
export async function inspeccionarUrl(token, ctx, url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return { error: 'La URL no es válida (debe empezar con https://)' }; }
  if (u.protocol !== 'https:' || !(u.hostname === DOMINIO || u.hostname.endsWith(`.${DOMINIO}`))) return { error: `Solo se pueden inspeccionar URLs de ${DOMINIO}` };
  if (ctx.sitio.startsWith('http') && !u.href.startsWith(ctx.sitio)) return { error: `La propiedad de Search Console es ${ctx.sitio}: solo se pueden inspeccionar URLs que empiecen con esa dirección` };
  const d = await llamarGoogle(token, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST', body: JSON.stringify({ inspectionUrl: u.href, siteUrl: ctx.sitio, languageCode: 'es-CL' }),
  }, ctx.email);
  const r = d.inspectionResult || {}, i = r.indexStatusResult || {};
  return {
    url: u.href, veredicto: i.verdict || null, estado: i.coverageState || null, indexacion: i.indexingState || null, robots: i.robotsTxtState || null,
    ultimo_rastreo: i.lastCrawlTime || null, rastreado_como: i.crawledAs || null, canonica_declarada: i.userCanonical || null, canonica_google: i.googleCanonical || null,
    sitemaps: i.sitemap || [], enlaces_desde: (i.referringUrls || []).slice(0, 10),
    amigable_movil: r.mobileUsabilityResult?.verdict || null,
    resultados_enriquecidos: (r.richResultsResult?.detectedItems || []).map((x) => ({ tipo: x.richResultType, elementos: (x.items || []).length })),
    enlace_google: r.inspectionResultLink || null,
  };
}

// Si SEARCH_CONSOLE_SITE no está definida, usa la propiedad de indexstore.cl que la cuenta realmente ve:
// primero la de dominio, luego la de prefijo de URL (https://www.indexstore.cl/ o https://indexstore.cl/). Si no ve ninguna, queda la de dominio por defecto.
export function elegirPropiedad(entradas) {
  const urls = (entradas || []).map((e) => e.siteUrl).filter(Boolean);
  const delSitio = urls.filter((u) => u.includes(DOMINIO));
  return delSitio.find((u) => u === SITIO_POR_DEFECTO) || delSitio.find((u) => u.startsWith('sc-domain:')) || delSitio.find((u) => u.startsWith('https://www.')) || delSitio[0] || null;
}
async function resolverSitio(token, ctx, env) {
  if (String(env.SEARCH_CONSOLE_SITE || '').trim()) return ctx;
  try {
    const d = await llamarGoogle(token, 'https://www.googleapis.com/webmasters/v3/sites', { method: 'GET' }, ctx.email);
    const elegida = elegirPropiedad(d.siteEntry);
    return elegida ? { ...ctx, sitio: elegida } : ctx;
  } catch { return ctx; }
}

// Punto de entrada de la API del ERP.
export async function consultarSearchConsole({ seccion, desde, hasta, pais, extra, url, env = process.env, ahora = new Date() }) {
  let ctx = contexto(env, pais);
  if (!ctx.email || !credencialesSearchConsole(env).clave) return { sin_configurar: true };
  const token = await obtenerAccessToken(env);
  ctx = await resolverSitio(token, ctx, env);
  if (seccion === 'indexacion') return { seccion, ...(await seccionIndexacion(token, ctx)) };
  if (seccion === 'inspeccion') return { seccion, ...(await inspeccionarUrl(token, ctx, url)) };
  const rango = validarRango(desde, hasta, ahora);
  if (rango.error) return { error: rango.error };
  const cabecera = { seccion, desde: rango.desde, hasta: rango.hasta, anterior: rango.anterior, dias: rango.dias, pais: ctx.pais || 'todos', sitio: ctx.sitio, generado_en: new Date().toISOString() };
  if (seccion === 'consultas') return { ...cabecera, ...(await seccionConsultas(token, rango, ctx)) };
  if (seccion === 'paginas') return { ...cabecera, ...(await seccionPaginas(token, rango, ctx)) };
  if (seccion === 'oportunidades') return { ...cabecera, ...(await seccionOportunidades(token, rango, ctx)) };
  if (seccion === 'landings') return { ...cabecera, ...(await seccionLandings(token, rango, ctx, extra || [])) };
  return { ...cabecera, seccion: 'resumen', ...(await seccionResumen(token, rango, ctx)) };
}

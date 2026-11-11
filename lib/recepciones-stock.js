// /lib/recepciones-stock.js
// ══════════════════════════════════════════════════════════════════════
// Notificación 'recepciones-stock-diario': ingresos de mercadería de Bsale (Stock > Recepciones)
// ══════════════════════════════════════════════════════════════════════
// Cada recepción de Bsale es un ingreso de productos a bodega (casi siempre una factura o guía de un proveedor). Este módulo arma UN correo
// consolidado con lo que se ingresó el día anterior: por recepción, el proveedor, el documento y cada producto con su miniatura de Shopify.
// Se manda a la mañana siguiente (cron diario) y solo si hubo ingresos. SIN montos ni costos (regla de las notificaciones del ERP): solo
// productos y cantidades.
//
// Qué recepciones entran: las de fecha de ingreso <= ayer (hora de Chile) que todavía no se avisaron (tabla recepciones_stock_avisadas), dentro
// de una ventana corta (ayer y los 2 días anteriores) para recoger una recepción registrada con fecha atrasada sin arrastrar el historial.
// Las funciones de armado son puras (sin red ni base de datos) para poder probarlas; la lectura de Bsale y Shopify va aparte.

import { esc, num, plural, fechaLarga, fechaCorta, tarjetas, avisos, seccion, tabla, masEnElErp, chip, armarCorreo, hoyChile } from './correo-base.js';

export const BASE_BSALE = 'https://api.bsale.io/v1';
export const VENTANA_DIAS = 2; // además de "ayer"
export const MAX_RECEPCIONES_EN_CORREO = 15;
export const MAX_PRODUCTOS_POR_RECEPCION = 25;

// Mismos nombres que usan Compras y Facturas por pagar (api/bsale-sku-report.js, api/bsale-facturas-por-pagar.js): si cambia uno, cambiar acá también.
const PROVEEDORES_CONOCIDOS = [
  { patron: /coimco/i, nombre: 'COIMCO' },
  { patron: /laptop\s*center/i, nombre: 'Laptop Center' },
  { patron: /intcomex/i, nombre: 'Intcomex' },
  { patron: /daxis/i, nombre: 'Daxis' },
  { patron: /synnex/i, nombre: 'Synnex' },
  { patron: /ingram/i, nombre: 'Ingram Micro' },
  { patron: /dos\s*(mundos?|mudos)|\bdm\b/i, nombre: 'Comercial Dos Mundos' },
];

// Ingresos internos (no vienen de un proveedor): servicio técnico, insumos, compra de vitrina.
const RE_INTERNO = /servicio\s*t[eé]cnico|insumos?\s*st|vitrina/i;

// 'AAAA-MM-DD' -> día anterior / posterior (sin zonas horarias: solo calendario).
export function sumarDias(iso, dias) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  f.setUTCDate(f.getUTCDate() + dias);
  return f.toISOString().slice(0, 10);
}

export function fechaDeRecepcion(rec) {
  if (rec && rec.rawAdmissionDate) return String(rec.rawAdmissionDate).slice(0, 10);
  if (rec && rec.admissionDate) return new Date(Number(rec.admissionDate) * 1000).toISOString().slice(0, 10);
  return null;
}

export function identificarProveedorRecepcion(rec) {
  const nota = String((rec && rec.note) || '').trim();
  const documento = String((rec && rec.document) || '').trim();
  const numero = String((rec && rec.documentNumber) || '').trim();
  const texto = `${nota} ${documento} ${numero}`;
  for (const p of PROVEEDORES_CONOCIDOS) if (p.patron.test(texto)) return { nombre: p.nombre, interno: false, identificado: true };
  if (RE_INTERNO.test(texto)) return { nombre: nota || numero || 'Ingreso interno', interno: true, identificado: true };
  // "Sin Documento Nº <texto>": el texto libre que se escribió en el número es lo más parecido a un proveedor.
  if (nota) return { nombre: nota, interno: false, identificado: true };
  if (/^sin documento/i.test(documento) && numero) return { nombre: numero, interno: false, identificado: true };
  return { nombre: 'Proveedor no indicado', interno: false, identificado: false };
}

export function textoDocumento(rec) {
  const documento = String((rec && rec.document) || '').trim() || 'Sin documento';
  const numero = String((rec && rec.documentNumber) || '').trim();
  return numero ? `${documento} N° ${numero}` : documento;
}

// ── Selección ────────────────────────────────────────────────────────
// recepciones: de la API de Bsale (con details). avisadas: Set de ids ya enviados. Devuelve las que entran al correo, la más reciente primero.
export function seleccionarRecepciones(recepciones, { ayer, avisadas = new Set(), ignorarAvisadas = false, desde = null }) {
  const piso = desde || sumarDias(ayer, -VENTANA_DIAS);
  return (recepciones || [])
    .filter((r) => {
      if (/nota de cr[eé]dito/i.test(r.document || '')) return false; // reverso de stock, no un ingreso
      const f = fechaDeRecepcion(r);
      if (!f || f > ayer || f < piso) return false;
      if (!ignorarAvisadas && avisadas.has(Number(r.id))) return false;
      return Array.isArray(r.details && r.details.items) && r.details.items.length > 0;
    })
    .sort((a, b) => (fechaDeRecepcion(b) || '').localeCompare(fechaDeRecepcion(a) || '') || Number(b.id) - Number(a.id));
}

// ── Correo ───────────────────────────────────────────────────────────
function urlMiniatura(url) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  return url + (url.includes('?') ? '&' : '?') + 'width=96';
}

const celdaFoto = (url, alt) => {
  const u = urlMiniatura(url);
  return u
    ? `<img src="${esc(u)}" alt="${esc(alt)}" width="48" height="48" style="display:block;width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #d3dff3;background:#f5f8fe;">`
    : `<div style="width:48px;height:48px;line-height:48px;text-align:center;border-radius:6px;border:1px dashed #cbd5e1;color:#94a3b8;font-size:11px;">sin foto</div>`;
};

// infoVariantes: { [variantId]: { sku, nombre } }; miniaturas: { [SKU]: urlImagen }
export function lineasDeRecepcion(rec, infoVariantes = {}) {
  const porVariante = new Map();
  for (const d of (rec.details && rec.details.items) || []) {
    const id = d.variant && d.variant.id != null ? String(d.variant.id) : `d${d.id}`;
    const info = infoVariantes[id] || {};
    const previo = porVariante.get(id);
    const cantidad = Number(d.quantity) || 0;
    if (previo) { previo.cantidad += cantidad; continue; }
    porVariante.set(id, { variantId: id, sku: info.sku || '', nombre: info.nombre || String(d.comment || '').trim() || 'Producto sin nombre en Bsale', cantidad });
  }
  return [...porVariante.values()];
}

export function armarCorreoRecepciones({ recepciones, infoVariantes = {}, miniaturas = {}, desde, hasta, urlBase }) {
  const bloques = recepciones.map((rec) => {
    const prov = identificarProveedorRecepcion(rec);
    const lineas = lineasDeRecepcion(rec, infoVariantes);
    return { rec, prov, lineas, unidades: lineas.reduce((s, l) => s + l.cantidad, 0), fecha: fechaDeRecepcion(rec) };
  });
  const skusDistintos = new Set(bloques.flatMap((b) => b.lineas.map((l) => l.sku || l.variantId)));
  const unidades = bloques.reduce((s, b) => s + b.unidades, 0);
  const proveedores = new Set(bloques.filter((b) => !b.prov.interno && b.prov.identificado).map((b) => b.prov.nombre));
  const sinProveedor = bloques.filter((b) => !b.prov.identificado).length;
  const periodo = desde === hasta ? fechaLarga(hasta) : `${fechaLarga(desde)} al ${fechaLarga(hasta)}`;

  const mostrados = bloques.slice(0, MAX_RECEPCIONES_EN_CORREO);
  const secciones = mostrados.map((b) => {
    const visibles = b.lineas.slice(0, MAX_PRODUCTOS_POR_RECEPCION);
    const filas = visibles.map((l) => [
      celdaFoto(l.sku ? miniaturas[String(l.sku).toUpperCase()] : null, l.nombre),
      `<span style="font-family:Consolas,Menlo,monospace;font-size:12px;">${esc(l.sku || '—')}</span>`,
      esc(l.nombre),
      `<b>${num(l.cantidad)}</b>`,
    ]);
    const pie = b.lineas.length > visibles.length ? masEnElErp(b.lineas.length - visibles.length, 'Bsale (Stock > Recepciones)') : null;
    const titulo = `${esc(b.prov.nombre)} ${b.prov.interno ? chip('ingreso interno', 'gris') : ''}`;
    const desc = `${esc(textoDocumento(b.rec))} · ingresó el ${esc(fechaCorta(b.fecha))} · ${num(b.lineas.length)} ${plural(b.lineas.length, 'producto', 'productos')} · ${num(b.unidades)} ${plural(b.unidades, 'unidad', 'unidades')}`;
    return seccion(titulo, desc, tabla(
      [{ titulo: 'Foto', ancho: 62 }, { titulo: 'SKU' }, { titulo: 'Producto' }, { titulo: 'Cant.', alinear: 'right', ancho: 48 }],
      filas, { pie },
    ));
  });
  if (bloques.length > mostrados.length) secciones.push(`<p style="margin:14px 0 0;font-size:12.5px;color:#64748b;">${masEnElErp(bloques.length - mostrados.length, 'Bsale (Stock > Recepciones)')}</p>`);

  const cuerpo = tarjetas([
    { etiqueta: 'Ingresos', cifra: num(bloques.length), sub: plural(bloques.length, 'recepción registrada', 'recepciones registradas'), tono: 'azul' },
    { etiqueta: 'Proveedores', cifra: num(proveedores.size), sub: bloques.some((b) => b.prov.interno) ? 'sin contar ingresos internos' : 'distintos', tono: 'verde' },
    { etiqueta: 'Productos', cifra: num(skusDistintos.size), sub: 'distintos', tono: 'gris' },
    { etiqueta: 'Unidades', cifra: num(unidades), sub: 'en total', tono: 'gris' },
  ])
    + avisos([sinProveedor ? { tono: 'amarillo', texto: `<b>${num(sinProveedor)}</b> ${plural(sinProveedor, 'ingreso no indica', 'ingresos no indican')} el proveedor. Escríbelo en la nota de la recepción en Bsale para que aparezca acá.` } : null], sinProveedor ? 'Requiere atención' : null)
    + secciones.join('');

  const asunto = `Ingresos de mercadería ${desde === hasta ? 'del ' + fechaLarga(hasta) : 'del ' + fechaCorta(desde) + ' al ' + fechaCorta(hasta)}: ${num(bloques.length)} ${plural(bloques.length, 'recepción', 'recepciones')}, ${num(unidades)} ${plural(unidades, 'unidad', 'unidades')}`;
  const html = armarCorreo({
    etiqueta: 'IndexStore · Compras',
    titulo: 'Ingresos de mercadería a bodega',
    subtitulo: periodo,
    cuerpo,
    boton: { url: `${urlBase}/compras.html`, texto: 'Abrir Compras en el ERP' },
    leyenda: 'cada bloque es una recepción de stock registrada en Bsale (Stock &gt; Recepciones). El proveedor sale de la nota o del texto del documento; si no aparece, figura como «Proveedor no indicado». No incluye montos ni costos.',
  });
  return { asunto, html, ingresos: bloques.length, unidades, productos: skusDistintos.size };
}

// ── Lectura de Bsale ─────────────────────────────────────────────────
async function bsaleGet(path, token, intentos = 3) {
  for (let i = 0; i < intentos; i++) {
    const r = await fetch(`${BASE_BSALE}${path}`, { headers: { access_token: token, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (r.status === 429 && i < intentos - 1) { await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); continue; }
    if (!r.ok) throw new Error(`Bsale HTTP ${r.status} en ${path.split('?')[0]}`);
    return r.json();
  }
}

// Las recepciones más recientes (Bsale las entrega de la más antigua a la más nueva: se leen las últimas páginas), con su detalle completo.
export async function leerRecepcionesRecientes(token, { paginas = 4, tam = 50, leer = bsaleGet } = {}) {
  const primera = await leer(`/stocks/receptions.json?limit=1&offset=0`, token);
  const total = Number(primera && primera.count) || 0;
  const offsets = [];
  for (let off = Math.max(0, total - tam * paginas); off < total; off += tam) offsets.push(off);
  const lotes = [];
  for (const off of offsets) lotes.push(await leer(`/stocks/receptions.json?expand=details&limit=${tam}&offset=${off}`, token));
  let recs = lotes.flatMap((p) => (p && p.items) || []);
  // Una recepción con más de 25 líneas trae el resto aparte.
  for (const r of recs.filter((x) => x.details && x.details.next).slice(0, 20)) {
    try {
      const resto = await leer(`/stocks/receptions/${r.id}/details.json?limit=50&offset=25`, token);
      r.details.items = [...(r.details.items || []), ...((resto && resto.items) || [])];
    } catch { /* se muestran las primeras 25 líneas */ }
  }
  return recs;
}

// { [variantId]: { sku, nombre } } -- código y nombre del producto de cada variante.
export async function leerInfoVariantes(ids, token, { leer = bsaleGet } = {}) {
  const lista = [...new Set(ids.map(String))];
  const out = {};
  const hacer = async (id) => {
    try {
      const v = await leer(`/variants/${encodeURIComponent(id)}.json?expand=[product]`, token);
      const producto = v && v.product && typeof v.product === 'object' ? v.product : null;
      const base = String((producto && producto.name) || '').trim();
      const detalle = String((v && v.description) || '').trim();
      const nombre = base && detalle && !base.toLowerCase().includes(detalle.toLowerCase()) ? `${base} - ${detalle}` : (base || detalle);
      out[id] = { sku: String((v && v.code) || '').trim(), nombre };
    } catch { out[id] = {}; }
  };
  for (let i = 0; i < lista.length; i += 6) await Promise.all(lista.slice(i, i + 6).map(hacer));
  return out;
}

// ── Miniaturas de Shopify ────────────────────────────────────────────
// graphql(query, variables) -> cuerpo de la respuesta (ver shopifyGraphQLConReintento en api/negocio.js).
const CONSULTA_MINIATURAS = `query($q: String!) { productVariants(first: 100, query: $q) { edges { node { sku image { url } product { featuredImage { url } } } } } }`;
export async function leerMiniaturas(skus, graphql) {
  const lista = [...new Set((skus || []).map((s) => String(s || '').trim()).filter((s) => /^[A-Za-z0-9._-]{1,60}$/.test(s)))];
  const out = {};
  for (let i = 0; i < lista.length; i += 40) {
    const q = lista.slice(i, i + 40).map((s) => `sku:${s}`).join(' OR ');
    try {
      const body = await graphql(CONSULTA_MINIATURAS, { q });
      for (const { node } of (body && body.data && body.data.productVariants && body.data.productVariants.edges) || []) {
        const url = (node.image && node.image.url) || (node.product && node.product.featuredImage && node.product.featuredImage.url);
        if (node.sku && url) out[String(node.sku).toUpperCase()] = url;
      }
    } catch { /* sin miniaturas de este lote: el correo sale igual con "sin foto" */ }
  }
  return out;
}

// ── Base de datos: qué recepciones ya se avisaron ────────────────────
let tablaLista = false;
export async function asegurarTablaRecepcionesAvisadas(sql) {
  if (tablaLista) return;
  await sql`CREATE TABLE IF NOT EXISTS recepciones_stock_avisadas (recepcion_id INTEGER PRIMARY KEY, avisada_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  tablaLista = true;
}
export async function recepcionesYaAvisadas(sql) {
  await asegurarTablaRecepcionesAvisadas(sql);
  const { rows } = await sql`SELECT recepcion_id FROM recepciones_stock_avisadas WHERE avisada_en > now() - interval '30 days';`;
  return new Set(rows.map((r) => Number(r.recepcion_id)));
}
export async function marcarRecepcionesAvisadas(sql, ids) {
  if (!ids.length) return;
  await asegurarTablaRecepcionesAvisadas(sql);
  await sql`INSERT INTO recepciones_stock_avisadas (recepcion_id) SELECT unnest(${ids}::int[]) ON CONFLICT (recepcion_id) DO NOTHING;`;
  await sql`DELETE FROM recepciones_stock_avisadas WHERE avisada_en < now() - interval '90 days';`;
}

export const ayerChile = (ahora = new Date()) => sumarDias(hoyChile(ahora), -1);

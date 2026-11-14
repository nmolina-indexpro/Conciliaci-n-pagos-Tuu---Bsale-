// /lib/detalle-ventas.js
// ═════════════════════════════════════════════════════════════════
// Detalle de ventas (Comercial): las ventas de Bsale por producto, vendedor, sucursal, marca y tipo de producto, con comparativos entre períodos.
// Parecido al reporte "Detalle de ventas" de Bsale, pero con comparación contra el período anterior y el mismo período del año pasado.
//
// Las líneas se guardan en ventas_detalle (una fila por documento y SKU, monto NETO) y se leen de Bsale mes a mes (ver el sync en api/negocio.js).
// A diferencia de bsale_ventas_sku, aquí SÍ entran los servicios y los envíos (Bsale los cuenta en sus totales) y se guarda el vendedor, la sucursal y el canal.
// Tipo de producto y costo salen del catálogo y de los costos que ya lee el Comparativo de ventas (comparativo_*); la marca, de lib/comparativo-ventas.js.
// Esta parte es la lógica pura (sin red) y las consultas a la base; los manejadores están en api/negocio.js.
// ═════════════════════════════════════════════════════════════════
import { unaVez } from './una-vez.js';
import { costoEnFecha, detectarMarca, SIN_MARCA } from './comparativo-ventas.js';
import { asegurarTablaComparativoVentas } from './db.js';

export const VENDEDOR_WEB = 'Venta web';
export const SIN_TIPO = 'Sin tipo';
export const SIN_SUCURSAL = 'Sin sucursal';
export const MAX_MESES_CONSULTA = 26;
const RE_MERCADO_LIBRE = /mercado\s*libre/i;
const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

export async function asegurarTablaVentasDetalle(sql) { return unaVez('asegurarTablaVentasDetalle', () => _asegurarTablaVentasDetalle(sql)); }
async function _asegurarTablaVentasDetalle(sql) {
  await sql`CREATE TABLE IF NOT EXISTS ventas_detalle (
    documento_id INTEGER NOT NULL, sku TEXT NOT NULL, periodo TEXT NOT NULL, fecha DATE NOT NULL, nombre TEXT,
    cantidad NUMERIC NOT NULL DEFAULT 0, monto NUMERIC NOT NULL DEFAULT 0, vendedor TEXT, sucursal_id TEXT, tipo_doc TEXT,
    canal_ml BOOLEAN NOT NULL DEFAULT false, online BOOLEAN NOT NULL DEFAULT false, sincronizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (documento_id, sku));`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ventas_detalle_fecha ON ventas_detalle (fecha);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ventas_detalle_periodo ON ventas_detalle (periodo);`;
  await sql`CREATE TABLE IF NOT EXISTS ventas_detalle_sucursales (id TEXT PRIMARY KEY, nombre TEXT NOT NULL);`;
}

export const mesValido = (m) => RE_MES.test(String(m || ''));
export const diaValido = (d) => RE_DIA.test(String(d || '')) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));

// ---------------------------------------------------------------- de un documento de Bsale a líneas
const pagosDe = (doc) => (Array.isArray(doc.payments) ? doc.payments : doc.payments && Array.isArray(doc.payments.items) ? doc.payments.items : []);
const oficinaId = (doc) => {
  const o = doc && doc.office;
  if (!o) return null;
  return String(o.id ?? (o.href ? String(o.href).split('/').pop().replace('.json', '') : '') ?? '') || null;
};
export const nombreVendedor = (doc, vendedores) => {
  const id = doc.user && (doc.user.id ?? String(doc.user.href || '').split('/').pop().replace('.json', ''));
  if (id == null || id === '') return VENDEDOR_WEB;
  const n = vendedores && (vendedores.get(Number(id)) || vendedores.get(id));
  const nombre = String(n || `Usuario #${id}`).replace(/\s+/g, ' ').trim();
  return /^venta\s+web$/i.test(nombre) ? VENDEDOR_WEB : nombre;
};

// docs: documentos de Bsale con details, payments, user y document_type expandidos. periodo 'AAAA-MM': solo cuenta ese mes (el rango pedido trae un margen).
// esVentaReal(document_type) -> boolean (no notas de crédito ni cotizaciones). Devuelve { ids: todos los documentos vistos, filas: líneas vigentes agrupadas por documento y SKU }.
export function lineasDeDocumentos(docs, periodo, { vendedores = new Map(), esVentaReal = () => true } = {}) {
  const ids = [], filas = new Map();
  for (const doc of docs || []) {
    if (doc.id == null) continue;
    ids.push(Number(doc.id));
    if (doc.state !== 0 || doc.cancellationStatus || !esVentaReal(doc.document_type)) continue;
    const fecha = doc.emissionDate ? new Date(Number(doc.emissionDate) * 1000).toISOString().slice(0, 10) : null;
    if (!fecha || !fecha.startsWith(periodo)) continue;
    const vendedor = nombreVendedor(doc, vendedores);
    const sucursal = oficinaId(doc);
    const canalMl = pagosDe(doc).some((p) => RE_MERCADO_LIBRE.test(String(p.name || (p.payment_type && p.payment_type.name) || '')));
    const tipoDoc = String((doc.document_type && doc.document_type.name) || '').trim() || null;
    const items = (doc.details && doc.details.items) || [];
    items.forEach((det, i) => {
      const codigoVar = String((det.variant && det.variant.code) || '').trim().toUpperCase();
      const nombre = String((det.variant && det.variant.description) || det.comment || det.note || codigoVar || 'Línea sin nombre').replace(/\s+/g, ' ').trim();
      // Una línea sin código (texto libre) se agrupa por su nombre, para que no se pierda de los totales.
      const sku = codigoVar || ('SIN-CODIGO: ' + nombre.toUpperCase().slice(0, 60));
      const k = `${doc.id}|${sku}`;
      const f = filas.get(k) || { documento: Number(doc.id), sku, periodo, fecha, nombre, cantidad: 0, monto: 0, vendedor, sucursal, tipoDoc, canalMl, online: vendedor === VENDEDOR_WEB };
      const cant = Number(det.quantity) || 0;
      f.cantidad += cant; f.monto += cant * (Number(det.netUnitValue) || 0); // neto, sin IVA
      filas.set(k, f);
    });
  }
  return { ids, filas: [...filas.values()] };
}

// Guarda las líneas de un lote de documentos. Antes borra lo que ya había de esos documentos: así un documento anulado o corregido desde la lectura anterior no deja líneas viejas.
export async function guardarLineas(sql, { ids, filas }) {
  await asegurarTablaVentasDetalle(sql);
  for (let i = 0; i < ids.length; i += 1000) await sql.query('DELETE FROM ventas_detalle WHERE documento_id = ANY($1::int[])', [ids.slice(i, i + 1000)]);
  for (let i = 0; i < filas.length; i += 1000) {
    const l = filas.slice(i, i + 1000);
    await sql.query(
      `INSERT INTO ventas_detalle (documento_id, sku, periodo, fecha, nombre, cantidad, monto, vendedor, sucursal_id, tipo_doc, canal_ml, online)
       SELECT * FROM UNNEST ($1::int[], $2::text[], $3::text[], $4::date[], $5::text[], $6::numeric[], $7::numeric[], $8::text[], $9::text[], $10::text[], $11::boolean[], $12::boolean[])
       ON CONFLICT (documento_id, sku) DO UPDATE SET periodo = EXCLUDED.periodo, fecha = EXCLUDED.fecha, nombre = EXCLUDED.nombre, cantidad = EXCLUDED.cantidad, monto = EXCLUDED.monto,
         vendedor = EXCLUDED.vendedor, sucursal_id = EXCLUDED.sucursal_id, tipo_doc = EXCLUDED.tipo_doc, canal_ml = EXCLUDED.canal_ml, online = EXCLUDED.online, sincronizado_en = now()`,
      [l.map((f) => f.documento), l.map((f) => f.sku), l.map((f) => f.periodo), l.map((f) => f.fecha), l.map((f) => f.nombre), l.map((f) => f.cantidad), l.map((f) => f.monto),
        l.map((f) => f.vendedor), l.map((f) => f.sucursal), l.map((f) => f.tipoDoc), l.map((f) => f.canalMl), l.map((f) => f.online)]);
  }
}
export async function guardarSucursales(sql, lista) {
  await asegurarTablaVentasDetalle(sql);
  const l = (lista || []).filter((o) => o && o.id != null && o.name);
  if (!l.length) return;
  await sql.query('INSERT INTO ventas_detalle_sucursales (id, nombre) SELECT * FROM UNNEST ($1::text[], $2::text[]) ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre', [l.map((o) => String(o.id)), l.map((o) => String(o.name))]);
}

// ---------------------------------------------------------------- lectura para la página
// Los meses entre dos días (inclusive): ['2026-09', '2026-10', ...].
export function mesesEntre(desde, hasta) {
  const lista = [];
  let [a, m] = desde.slice(0, 7).split('-').map(Number);
  const [fa, fm] = hasta.slice(0, 7).split('-').map(Number);
  while (a < fa || (a === fa && m <= fm)) { lista.push(`${a}-${String(m).padStart(2, '0')}`); m++; if (m === 13) { m = 1; a++; } }
  return lista;
}

// Estado de lectura de cada mes: { [periodo]: { completo, hecho, total, actualizadoEn, documentos } }.
export async function estadoMeses(sql, meses) {
  await asegurarTablaVentasDetalle(sql);
  await asegurarTablaComparativoVentas(sql); // guarda el avance de la lectura por mes (comparativo_estado)
  const { rows: est } = await sql.query(`SELECT clave, offset_a, total_a, completo, actualizado_en FROM comparativo_estado WHERE clave = ANY($1::text[])`, [meses.map((m) => 'vd-' + m)]);
  const { rows: cnt } = await sql.query(`SELECT periodo, count(DISTINCT documento_id)::int AS documentos, max(sincronizado_en) AS ultima FROM ventas_detalle WHERE periodo = ANY($1::text[]) GROUP BY periodo`, [meses]);
  const salida = {};
  for (const m of meses) {
    const e = est.find((x) => x.clave === 'vd-' + m), c = cnt.find((x) => x.periodo === m);
    salida[m] = { completo: !!(e && e.completo), hecho: e ? e.offset_a : 0, total: e ? e.total_a : null, actualizadoEn: (e && e.actualizado_en) || null, documentos: c ? c.documentos : 0, ultimaLinea: c ? c.ultima : null };
  }
  return salida;
}

// Líneas entre dos días ya listas para la página: diccionarios (SKU, vendedor, sucursal) + líneas como arreglos cortos.
// linea = [fecha, documento, índiceSku, índiceVendedor, índiceSucursal, banderas (1 = Mercado Libre, 2 = venta online), cantidad, neto, costo | null]
// Solo los administradores reciben el costo (el margen revela el costo de compra).
export async function leerDetalle(sql, desde, hasta, { esAdmin = false } = {}) {
  await asegurarTablaVentasDetalle(sql);
  const { rows } = await sql.query(
    `SELECT documento_id, sku, fecha::text AS fecha, nombre, cantidad::float AS cantidad, monto::float AS monto, vendedor, sucursal_id, canal_ml, online
       FROM ventas_detalle WHERE fecha >= $1::date AND fecha <= $2::date ORDER BY fecha, documento_id`, [desde, hasta]);
  const skus = [...new Set(rows.map((r) => r.sku))];
  let tipos = new Map(), marcas = new Map(), costos = new Map();
  if (skus.length) {
    try {
      const { rows: t } = await sql.query(
        `SELECT c.sku, ti.nombre AS tipo FROM comparativo_catalogo c JOIN comparativo_productos p ON p.id = c.producto_id LEFT JOIN comparativo_tipos ti ON ti.id = p.tipo_id WHERE c.sku = ANY($1::text[])`, [skus]);
      tipos = new Map(t.map((x) => [x.sku, x.tipo]));
      const { rows: m } = await sql.query('SELECT sku, marca FROM comparativo_marcas_sku WHERE sku = ANY($1::text[])', [skus]);
      marcas = new Map(m.map((x) => [x.sku, x.marca]));
      if (esAdmin) {
        const { rows: k } = await sql.query('SELECT sku, promedio::float AS promedio, historial FROM comparativo_costos WHERE sku = ANY($1::text[]) AND NOT sin_costo', [skus]);
        costos = new Map(k.map((x) => [x.sku, { promedio: x.promedio, historial: Array.isArray(x.historial) ? x.historial : [] }]));
      }
    } catch (e) { /* el catálogo todavía no se lee: todo queda "Sin tipo" y sin costo */ }
  }
  const { rows: of } = await sql.query('SELECT id, nombre FROM ventas_detalle_sucursales');
  const nombreSucursal = new Map(of.map((o) => [o.id, o.nombre]));
  const dic = { skus: [], vendedores: [], sucursales: [] }, idx = { skus: new Map(), vendedores: new Map(), sucursales: new Map() };
  const poner = (clave, valor, crear) => { const m = idx[clave]; if (!m.has(valor)) { m.set(valor, dic[clave].length); dic[clave].push(crear()); } return m.get(valor); };
  const nombrePorSku = new Map();
  for (const r of rows) if (!nombrePorSku.has(r.sku)) nombrePorSku.set(r.sku, r.nombre);
  let conCosto = 0, neto = 0, netoConCosto = 0;
  const lineas = rows.map((r) => {
    const si = poner('skus', r.sku, () => ({ sku: r.sku, nombre: nombrePorSku.get(r.sku) || r.sku, marca: marcas.get(r.sku) || detectarMarca(nombrePorSku.get(r.sku) || r.sku), tipo: tipos.get(r.sku) || SIN_TIPO }));
    const vi = poner('vendedores', r.vendedor || VENDEDOR_WEB, () => r.vendedor || VENDEDOR_WEB);
    const sid = r.sucursal_id || '';
    const oi = poner('sucursales', sid, () => (sid ? nombreSucursal.get(sid) || `Sucursal #${sid}` : SIN_SUCURSAL));
    let costo = null;
    if (esAdmin) { const u = costoEnFecha(costos.get(r.sku), r.fecha); costo = u != null ? Math.round(u * r.cantidad * 100) / 100 : null; }
    neto += r.monto; if (costo != null) { conCosto++; netoConCosto += r.monto; }
    return [r.fecha, r.documento_id, si, vi, oi, (r.canal_ml ? 1 : 0) | (r.online ? 2 : 0), r.cantidad, Math.round(r.monto * 100) / 100, costo];
  });
  return { desde, hasta, dic, lineas, cobertura: esAdmin ? { lineasConCosto: conCosto, lineas: lineas.length, pctVenta: neto > 0 ? Math.round((netoConCosto / neto) * 1000) / 10 : null } : null };
}

export { SIN_MARCA };

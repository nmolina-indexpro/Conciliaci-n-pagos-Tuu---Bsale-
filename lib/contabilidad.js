// /lib/contabilidad.js
// Página Contabilidad (Finanzas), primera versión: egresos según las facturas de compra (DTE recibidos) que Bsale guarda en "documentos de terceros".
// Parte pura (sin red ni base de datos) para poder probarla: tipos de documento, categorías y sugerencia de categoría según el nombre del proveedor.

// Códigos del SII de los documentos que llegan como compra. Las notas de crédito restan; las de débito suman.
export const TIPOS_DTE = {
  '30': 'Factura', '32': 'Factura exenta', '33': 'Factura electrónica', '34': 'Factura exenta electrónica', '43': 'Liquidación-factura',
  '45': 'Factura de compra', '46': 'Factura de compra electrónica', '55': 'Nota de débito', '56': 'Nota de débito electrónica',
  '60': 'Nota de crédito', '61': 'Nota de crédito electrónica',
};
export const tipoDte = codigo => TIPOS_DTE[String(codigo)] || (codigo ? `Documento ${codigo}` : 'Documento');
export const signoDte = codigo => (['60', '61'].includes(String(codigo)) ? -1 : 1);

// Categorías del registro. "detalle" es libre (con sugerencias): "Servicio" -> "Luz", "Arriendo" -> "Oficina", "Banco / entidad financiera" -> "Seguro"...
export const CATEGORIAS = [
  { id: 'producto', nombre: 'Proveedor de productos', icono: '📦', detalles: [] },
  { id: 'insumo', nombre: 'Proveedor de insumos', icono: '🧰', detalles: [] },
  { id: 'servicio', nombre: 'Servicio', icono: '💡', detalles: ['Luz', 'Agua', 'Gas', 'Internet / Teléfono', 'Software / hosting', 'Otro servicio'] },
  { id: 'arriendo', nombre: 'Arriendo', icono: '🏢', detalles: ['Oficina', 'Bodega', 'Local'] },
  { id: 'financiera', nombre: 'Banco / entidad financiera', icono: '🏦', detalles: ['Banco', 'Seguro', 'Fintech', 'Leasing / factoring', 'Medios de pago'] },
  { id: 'otro', nombre: 'Otros', icono: '🧾', detalles: [] },
];
export const CATEGORIA_IDS = CATEGORIAS.map(c => c.id);
export const nombreCategoria = id => (CATEGORIAS.find(c => c.id === id) || {}).nombre || 'Sin categorizar';

const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = s => sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Reglas por nombre (se aplican en orden; la primera que calza gana). Son solo una sugerencia: lo que la persona categorice manda.
const REGLAS = [
  { re: /\b(coi[mn]co|laptop\s*center|intcomex|dm\s*2?\s*mundos|dm2mundos|daxis|synnex|ingram|tecnoglobal)\b/, categoria: 'producto' },
  { re: /\b(dimerc|dipay|dipac|card\s*paper|cardpaper)\b/, categoria: 'insumo' },
  { re: /\b(enel|chilectra|cge|saesa|frontel|edelmag|luz)\b/, categoria: 'servicio', detalle: 'Luz' },
  { re: /\b(aguas|esval|essbio|essal|smapa|agua)\b/, categoria: 'servicio', detalle: 'Agua' },
  { re: /\b(metrogas|abastible|lipigas|gasco|gas)\b/, categoria: 'servicio', detalle: 'Gas' },
  { re: /\b(entel|movistar|claro|wom|vtr|gtd|telefonica|netline|mundo\s*pacifico|internet)\b/, categoria: 'servicio', detalle: 'Internet / Teléfono' },
  { re: /\b(google|microsoft|amazon|aws|shopify|zoho|cloudflare|vercel|digitalocean|godaddy|nic\s*chile|hosting)\b/, categoria: 'servicio', detalle: 'Software / hosting' },
  { re: /\b(arriendos?|inmobiliaria|propiedades|gastos\s*comunes|administradora)\b/, categoria: 'arriendo', detalle: 'Oficina' },
  { re: /\b(seguros?|aseguradora|mapfre|liberty|hdi)\b/, categoria: 'financiera', detalle: 'Seguro' },
  { re: /\b(transbank|getnet|webpay|khipu|flow|mercado\s*pago|redcompra)\b/, categoria: 'financiera', detalle: 'Medios de pago' },
  { re: /\b(tenpo|mach|fintual|fintech|toku|fpay)\b/, categoria: 'financiera', detalle: 'Fintech' },
  { re: /\b(banco|bci|santander|itau|scotiabank|bice|security|bbva|consorcio)\b/, categoria: 'financiera', detalle: 'Banco' },
  { re: /\b(factoring|leasing|financiera|financiero)\b/, categoria: 'financiera', detalle: 'Leasing / factoring' },
];
export function sugerirCategoria(nombre) {
  const t = norm(nombre);
  if (!t) return null;
  for (const r of REGLAS) if (r.re.test(t)) return { categoria: r.categoria, detalle: r.detalle || null };
  return null;
}

// override: fila de contabilidad_proveedores ({ categoria, detalle }) o null. Devuelve la categoría que se muestra y si fue una sugerencia automática.
export function categoriaEfectiva(nombreProveedor, override) {
  if (override && CATEGORIA_IDS.includes(override.categoria)) return { categoria: override.categoria, detalle: override.detalle || null, auto: false };
  const s = sugerirCategoria(nombreProveedor);
  return s ? { ...s, auto: true } : { categoria: null, detalle: null, auto: false };
}

// Un documento tal como lo entrega Bsale (third_party_documents) -> fila para guardar. null si no sirve (anulado, de venta, sin folio).
export function filaDesdeBsale(d, ahoraISO) {
  if (!d || d.id == null) return null;
  const fechaDe = u => (u ? new Date(u * 1000).toISOString().slice(0, 10) : null);
  const fecha = fechaDe(d.emissionDate);
  const anio = Number(d.year) || (fecha ? Number(fecha.slice(0, 4)) : null), mes = Number(d.month) || (fecha ? Number(fecha.slice(5, 7)) : null);
  if (!anio || !mes) return null;
  const libro = String(d.bookType || 'compra').toLowerCase();
  if (libro.includes('venta')) return null;
  const n = v => Number(v) || 0;
  return {
    id: Number(d.id), rut: String(d.clientCode || '').trim().toUpperCase(), proveedor: String(d.clientActivity || '').trim() || (d.clientCode ? `RUT ${d.clientCode}` : 'Sin identificar'),
    numero: d.number != null ? String(d.number) : null, codigo: d.codeSii != null ? String(d.codeSii) : null, fecha,
    periodo: `${anio}-${String(mes).padStart(2, '0')}`, neto: n(d.netAmount), exento: n(d.exemptAmount), iva: n(d.ivaAmount), total: n(d.totalAmount),
    anulado: d.canceled === 1 || d.canceled === true, incluir: d.include === undefined ? true : d.include === 1 || d.include === true, urlPdf: d.urlPdf || null, sincronizado: ahoraISO || null,
  };
}

// docs: filas ya con signo y categoría. Resumen del mes: total, neto, IVA, por categoría y lo que falta categorizar.
export function resumir(docs) {
  const t = { total: 0, neto: 0, iva: 0, exento: 0, documentos: docs.length, sinCategoria: { n: 0, total: 0 }, porCategoria: new Map() };
  for (const d of docs) {
    const s = d.signo;
    t.total += s * d.total; t.neto += s * d.neto; t.iva += s * d.iva; t.exento += s * d.exento;
    const clave = d.categoria || 'sin';
    const c = t.porCategoria.get(clave) || { categoria: clave, nombre: d.categoria ? nombreCategoria(d.categoria) : 'Sin categorizar', total: 0, neto: 0, documentos: 0 };
    c.total += s * d.total; c.neto += s * d.neto; c.documentos += 1;
    t.porCategoria.set(clave, c);
    if (!d.categoria) { t.sinCategoria.n += 1; t.sinCategoria.total += s * d.total; }
  }
  const redondear = v => Math.round(v);
  return {
    total: redondear(t.total), neto: redondear(t.neto), iva: redondear(t.iva), exento: redondear(t.exento), documentos: t.documentos,
    sinCategoria: { n: t.sinCategoria.n, total: redondear(t.sinCategoria.total) },
    porCategoria: [...t.porCategoria.values()].map(c => ({ ...c, total: redondear(c.total), neto: redondear(c.neto) })).sort((a, b) => b.total - a.total),
  };
}

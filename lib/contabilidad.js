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

// ═════════════════════════════════════════════════════════════════
// ANÁLISIS: comparación entre meses, compras relevantes y hallazgos automáticos
// ═════════════════════════════════════════════════════════════════
// docs: filas de varios meses, ya con signo y categoría: { periodo, clave, proveedor, numero, fecha, categoria, detalle, signo, total, neto, iva, codigo }.
// periodos: ['2026-05', ..., '2026-10'] en orden; "mes" es el que se analiza y los anteriores con datos son la base de comparación.
// Un mes sin documentos se considera "sin datos" (no traído), no un mes de gasto cero: no entra en promedios.
const suma = (a, f) => a.reduce((t, x) => t + f(x), 0);
const pctVar = (actual, base) => (base > 0 ? Math.round(((actual - base) / base) * 1000) / 10 : null);
const r0 = v => Math.round(v);
const es = v => Number(v).toLocaleString('es-CL');

export function analizarContabilidad(docs, periodos, mes) {
  const porMes = periodos.map(p => {
    const d = docs.filter(x => x.periodo === p);
    return { mes: p, conDatos: d.length > 0, documentos: d.length, total: r0(suma(d, x => x.signo * x.total)), neto: r0(suma(d, x => x.signo * x.neto)), iva: r0(suma(d, x => x.signo * x.iva)) };
  });
  porMes.forEach((m, i) => {
    const previo = [...porMes.slice(0, i)].reverse().find(x => x.conDatos);
    m.variacionPct = m.conDatos && previo ? pctVar(m.total, previo.total) : null;
  });
  const actual = porMes.find(m => m.mes === mes) || { mes, conDatos: false, documentos: 0, total: 0, neto: 0, iva: 0 };
  const previos = porMes.filter(m => m.mes !== mes && m.conDatos && m.mes < mes);
  const mesAnterior = [...porMes].filter(m => m.mes < mes).reverse().find(m => m.conDatos) || null;
  const promedioPrevio = previos.length ? r0(suma(previos, m => m.total) / previos.length) : null;
  const periodosPrevios = previos.map(m => m.mes);
  const docsMes = docs.filter(d => d.periodo === mes);

  // ── por categoría y mes ──
  const idsCat = [...new Set(docs.map(d => d.categoria || 'sin'))];
  const categorias = idsCat.map(id => {
    const delMes = {};
    periodos.forEach(p => { delMes[p] = r0(suma(docs.filter(d => d.periodo === p && (d.categoria || 'sin') === id), x => x.signo * x.total)); });
    const base = previos.length ? r0(suma(periodosPrevios, p => delMes[p]) / previos.length) : null;
    return { categoria: id, nombre: id === 'sin' ? 'Sin categorizar' : nombreCategoria(id), porMes: delMes, actual: delMes[mes] || 0, promedioPrevio: base, variacionPct: base != null ? pctVar(delMes[mes] || 0, base) : null };
  }).sort((a, b) => b.actual - a.actual);

  // ── por proveedor ──
  const claves = [...new Set(docs.map(d => d.clave))];
  const proveedores = claves.map(clave => {
    const ds = docs.filter(d => d.clave === clave), m = ds.filter(d => d.periodo === mes), pr = ds.filter(d => periodosPrevios.includes(d.periodo));
    const totalMes = r0(suma(m, x => x.signo * x.total)), totalPrev = suma(pr, x => x.signo * x.total);
    const mesesPresentes = new Set(pr.map(d => d.periodo)).size;
    return {
      clave, proveedor: ds[0].proveedor, categoria: ds[0].categoria || null, detalle: ds[0].detalle || null, documentos: m.length, total: totalMes,
      participacion: actual.total > 0 ? Math.round((totalMes / actual.total) * 1000) / 10 : 0,
      promedioPrevio: previos.length ? r0(totalPrev / previos.length) : null, mesesPresentes, mesesBase: previos.length,
      variacionPct: previos.length && totalPrev > 0 ? pctVar(totalMes, totalPrev / previos.length) : null,
      mediaFactura: pr.length ? r0(suma(pr, x => x.signo * x.total) / pr.length) : null,
    };
  });
  const delMes = proveedores.filter(p => p.documentos > 0).sort((a, b) => b.total - a.total);
  const mayoresFacturas = docsMes.filter(d => d.signo > 0).sort((a, b) => b.total - a.total).slice(0, 8)
    .map(d => ({ proveedor: d.proveedor, numero: d.numero, tipo: d.tipo, fecha: d.fecha, total: r0(d.total), categoria: d.categoria || null, detalle: d.detalle || null }));

  // ── hallazgos ──
  const hallazgos = [];
  const add = (severidad, tipo, titulo, detalle) => hallazgos.push({ severidad, tipo, titulo, detalle });
  const pesoMin = actual.total * 0.05;
  const nPrev = `${previos.length} ${previos.length === 1 ? 'mes anterior' : 'meses anteriores'}`;
  if (promedioPrevio != null && actual.conDatos) {
    const v = pctVar(actual.total, promedioPrevio);
    if (v != null && Math.abs(v) >= 20) add(v > 0 ? 'media' : 'info', 'mes_vs_promedio', `Los egresos del mes ${v > 0 ? 'subieron' : 'bajaron'} ${es(Math.abs(v))}% frente al promedio de ${nPrev}`, `Este mes ${es(r0(actual.total))} contra un promedio de ${es(promedioPrevio)}.`);
  }
  if (previos.length) {
    for (const p of delMes) {
      if (p.mesesPresentes === 0 && p.total >= pesoMin && actual.total > 0) add('media', 'proveedor_nuevo', `Proveedor nuevo: ${p.proveedor}`, `No aparecía en ${nPrev} y este mes pesa ${es(p.participacion)}% de los egresos (${es(p.total)}).`);
      else if (p.mesesPresentes > 0 && p.variacionPct != null && p.variacionPct >= 50 && p.total - p.promedioPrevio >= pesoMin * 0.6) add('media', 'proveedor_sube', `${p.proveedor} subió ${es(p.variacionPct)}%`, `Este mes ${es(p.total)} contra un promedio mensual de ${es(p.promedioPrevio)}.`);
    }
    // recurrentes que no facturaron este mes (típico de servicios y arriendo: puede faltar recibir la factura)
    for (const p of proveedores) {
      const critico = ['servicio', 'arriendo'].includes(p.categoria);
      // un servicio o el arriendo que no llega se avisa aunque sea chico; los demás proveedores solo si pesaban al menos 2% de los egresos
      if (p.documentos > 0 || p.mesesPresentes < Math.max(2, Math.ceil(previos.length * 0.6)) || (!critico && !(p.promedioPrevio > (promedioPrevio || 0) * 0.02))) continue;
      add(critico ? 'alta' : 'media', 'proveedor_ausente', `${p.proveedor} no ha facturado este mes`, `Facturó en ${p.mesesPresentes} de ${nPrev} (promedio ${es(p.promedioPrevio)} al mes). ${critico ? 'Es un gasto recurrente: revisa si falta recibir la factura.' : 'Revisa si falta una factura o si dejó de ser proveedor.'}`);
    }
    // una factura muy por encima de lo habitual de ese proveedor
    for (const d of docsMes.filter(x => x.signo > 0)) {
      const p = proveedores.find(x => x.clave === d.clave);
      if (p && p.mediaFactura > 0 && d.total >= p.mediaFactura * 3 && d.total >= pesoMin) add('media', 'factura_atipica', `Factura mucho mayor a lo habitual: ${d.proveedor} N° ${d.numero || 's/n'}`, `${es(r0(d.total))}, cuando sus facturas de ${nPrev} promedian ${es(p.mediaFactura)}.`);
    }
  }
  // posibles duplicadas dentro del mes: mismo proveedor y mismo folio, o mismo proveedor y mismo monto con folios distintos
  const vistos = new Map();
  for (const d of docsMes.filter(x => x.signo > 0)) {
    for (const [k, tipo] of [[`${d.clave}|f|${d.codigo}|${d.numero}`, 'el mismo folio'], [`${d.clave}|m|${r0(d.total)}`, 'el mismo monto']]) {
      if (!vistos.has(k)) vistos.set(k, { d, n: 0, tipo });
      vistos.get(k).n++;
    }
  }
  const yaAvisadas = new Set();
  for (const v of vistos.values()) {
    if (v.n < 2 || v.d.total <= 0) continue;
    const id = `${v.d.clave}|${v.tipo}|${r0(v.d.total)}`;
    if (yaAvisadas.has(id)) continue;
    yaAvisadas.add(id);
    add('alta', 'posible_duplicada', `Posible factura duplicada: ${v.d.proveedor}`, `${v.n} documentos con ${v.tipo} (${es(r0(v.d.total))}) en el mismo mes. Revisa que no se haya registrado dos veces.`);
  }
  const top3 = delMes.slice(0, 3), conc = actual.total > 0 ? Math.round((suma(top3, p => p.total) / actual.total) * 1000) / 10 : 0;
  if (delMes.length >= 4 && conc >= 60) add('info', 'concentracion', `Los 3 proveedores principales concentran ${es(conc)}% de los egresos`, top3.map(p => `${p.proveedor} (${es(p.participacion)}%)`).join(', ') + '.');
  const nc = docsMes.filter(d => d.signo < 0);
  if (nc.length) add('info', 'notas_credito', `${nc.length} ${nc.length === 1 ? 'nota de crédito' : 'notas de crédito'} este mes`, `Restan ${es(r0(suma(nc, x => x.total)))} a los egresos (${[...new Set(nc.map(x => x.proveedor))].slice(0, 3).join(', ')}).`);
  const sin = categorias.find(c => c.categoria === 'sin');
  if (sin && actual.total > 0 && sin.actual / actual.total >= 0.1) add('media', 'sin_categoria', `${Math.round((sin.actual / actual.total) * 100)}% de los egresos está sin categorizar`, `${es(sin.actual)} por clasificar: el análisis por categoría es más fiel mientras menos quede sin clasificar.`);
  for (const c of categorias) {
    if (c.categoria === 'sin' || c.variacionPct == null || actual.total <= 0) continue;
    if (Math.abs(c.variacionPct) >= 30 && Math.abs(c.actual - c.promedioPrevio) >= actual.total * 0.03) add('info', 'categoria_cambia', `${c.nombre}: ${c.variacionPct > 0 ? 'sube' : 'baja'} ${es(Math.abs(c.variacionPct))}% frente a su promedio`, `Este mes ${es(c.actual)} contra ${es(c.promedioPrevio)} de promedio.`);
  }
  const orden = { alta: 0, media: 1, info: 2 };
  hallazgos.sort((a, b) => orden[a.severidad] - orden[b.severidad]);

  return {
    mes, periodos, porMes, actual, mesAnterior, promedioPrevio, mesesBase: previos.length,
    variacionVsPromedio: promedioPrevio != null && actual.conDatos ? pctVar(actual.total, promedioPrevio) : null,
    variacionVsAnterior: mesAnterior && actual.conDatos ? pctVar(actual.total, mesAnterior.total) : null,
    ivaPromedioPrevio: previos.length ? r0(suma(previos, m => m.iva) / previos.length) : null,
    concentracionTop3: conc, categorias, proveedores: delMes.slice(0, 12), mayoresFacturas, hallazgos,
  };
}

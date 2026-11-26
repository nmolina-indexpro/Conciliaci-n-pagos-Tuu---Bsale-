// /lib/ventas-conciliar.js
// ═════════════════════════════════════════════════════════════════
// Conciliación del Detalle de ventas contra Bsale: compara, documento por documento, lo que dice Bsale EN VIVO (documents.json con sus detalles) con lo que tiene guardado el ERP
// (ventas_detalle), para encontrar de dónde sale una diferencia entre "Ventas totales" del ERP y las de Bsale.
// Función pura (sin red ni base de datos): el manejador de api/negocio.js (?recurso=ventas-detalle-conciliar, solo administradores) le entrega los documentos y lo guardado.
//
// Qué mira por documento (solo documentos vigentes que cuentan como venta o nota de crédito; las cotizaciones y los anulados no entran):
//   · bsale:    neto y total del documento tal como los informa Bsale (netAmount / totalAmount). Las notas de crédito restan.
//   · lineas:   suma del netAmount de cada línea según Bsale.
//   · unitario: cantidad x netUnitValue de cada línea (lo que calcula el ERP al leer un mes) -> si es MAYOR que "lineas", Bsale aplicó descuentos de línea que el ERP no descuenta.
//   · erp:      lo que hay guardado en ventas_detalle para ese documento (neto).
// ═════════════════════════════════════════════════════════════════
export const IVA = 1.19;
const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// docs: documentos de Bsale (con document_type y details expandidos). erpPorDoc: Map(documento_id -> neto guardado en el ERP). clasificar(document_type) -> 'venta' | 'nc' | null.
export function conciliarDocumentos(docs, erpPorDoc, clasificar, { maxDiferencias = 40 } = {}) {
  const filas = [];
  const vistos = new Set();
  for (const d of docs || []) {
    if (d.id == null) continue;
    vistos.add(Number(d.id));
    const clase = clasificar(d.document_type);
    const vigente = d.state === 0 && !d.cancellationStatus;
    const signo = clase === 'nc' ? -1 : 1;
    const items = (d.details && d.details.items) || [];
    let lineas = 0, unitario = 0, descuento = 0, lineasSinNeto = 0;
    for (const x of items) {
      const n = num(x.netAmount);
      const u = (Number(x.quantity) || 0) * (Number(x.netUnitValue) || 0);
      unitario += u;
      if (n == null) { lineasSinNeto++; lineas += u; } else lineas += n;
      descuento += Number(x.netDiscount) || 0;
    }
    const fecha = d.emissionDate ? new Date(Number(d.emissionDate) * 1000).toISOString().slice(0, 10) : null;
    filas.push({
      id: Number(d.id), folio: d.number != null ? String(d.number) : '', fecha, tipo: String((d.document_type && d.document_type.name) || 'Sin tipo').trim(), clase, vigente,
      cuenta: vigente && clase != null, // lo que el ERP cuenta como venta o nota de crédito
      bsaleNeto: redondear(signo * (num(d.netAmount) ?? lineas)), bsaleTotal: redondear(signo * (num(d.totalAmount) ?? (num(d.netAmount) ?? lineas) * IVA)),
      lineas: redondear(signo * lineas), unitario: redondear(signo * unitario), descuento: redondear(signo * descuento), lineasSinNeto,
      erp: redondear(erpPorDoc.get(Number(d.id)) || 0), nLineas: items.length,
    });
  }
  const cuentan = filas.filter((f) => f.cuenta);
  const suma = (l, c) => redondear(l.reduce((s, f) => s + f[c], 0));
  // por tipo de documento
  const tipos = new Map();
  for (const f of cuentan) {
    if (!tipos.has(f.tipo)) tipos.set(f.tipo, { tipo: f.tipo, nc: f.clase === 'nc', docs: 0, bsaleTotal: 0, erpTotal: 0 });
    const t = tipos.get(f.tipo); t.docs++; t.bsaleTotal += f.bsaleTotal; t.erpTotal += f.erp * IVA;
  }
  // documentos que el ERP tiene guardados y Bsale ya no cuenta (anulados después, tipos que no cuentan) y documentos de Bsale que el ERP no tiene
  const soloErp = [...erpPorDoc.entries()].filter(([id, m]) => !vistos.has(id) && Math.abs(m) >= 1); // guardados en el ERP pero Bsale ya no los devuelve en esas fechas
  const diferencias = cuentan.filter((f) => Math.abs(f.bsaleNeto - f.erp) >= 1).sort((a, b) => Math.abs(b.bsaleNeto - b.erp) - Math.abs(a.bsaleNeto - a.erp));
  const sobrantes = filas.filter((f) => !f.cuenta && Math.abs(f.erp) >= 1); // el ERP los tiene guardados pero hoy no cuentan (anulados o tipo que no cuenta)
  const netoBsale = suma(cuentan, 'bsaleNeto'), totalBsale = suma(cuentan, 'bsaleTotal'), netoErp = suma(cuentan, 'erp');
  const ncDocs = cuentan.filter((f) => f.clase === 'nc').length;
  return {
    documentos: filas.length, cuentan: cuentan.length, notasCredito: ncDocs, anulados: filas.filter((f) => !f.vigente).length, sinClasificar: filas.filter((f) => f.vigente && f.clase == null).length,
    bsale: { neto: netoBsale, total: totalBsale }, erp: { neto: netoErp, total: redondear(netoErp * IVA) },
    diferencia: { neto: redondear(netoErp - netoBsale), total: redondear(netoErp * IVA - totalBsale) },
    // si "unitario" > "lineas": Bsale descontó en las líneas algo que el ERP (cantidad x valor unitario) no descuenta
    descuentoDeLinea: { unitario: suma(cuentan, 'unitario'), lineasBsale: suma(cuentan, 'lineas'), diferenciaNeto: redondear(suma(cuentan, 'unitario') - suma(cuentan, 'lineas')), declarado: suma(cuentan, 'descuento'), documentos: cuentan.filter((f) => Math.abs(f.unitario - f.lineas) >= 1).length },
    // si "lineas" != "bsale" (neto del documento): Bsale informa distinto el documento que la suma de sus líneas (por ejemplo, un descuento global)
    lineasVsDocumento: { diferenciaNeto: redondear(suma(cuentan, 'lineas') - netoBsale), documentos: cuentan.filter((f) => Math.abs(f.lineas - f.bsaleNeto) >= 1).length },
    porTipo: [...tipos.values()].map((t) => ({ ...t, bsaleTotal: redondear(t.bsaleTotal), erpTotal: redondear(t.erpTotal) })).sort((a, b) => (a.nc - b.nc) || (b.bsaleTotal - a.bsaleTotal)),
    diferencias: diferencias.slice(0, maxDiferencias).map(({ id, folio, fecha, tipo, bsaleNeto, bsaleTotal, lineas, unitario, erp, descuento }) => ({ id, folio, fecha, tipo, bsaleNeto, bsaleTotal, lineas, unitario, erp, descuento, diferencia: redondear(erp - bsaleNeto) })),
    nDiferencias: diferencias.length,
    sobrantes: sobrantes.slice(0, 20).map(({ id, folio, fecha, tipo, vigente, clase, erp }) => ({ id, folio, fecha, tipo, vigente, cuentaComoVenta: clase != null, erp })),
    soloEnErp: soloErp.slice(0, 20).map(([id, m]) => ({ id, neto: redondear(m) })),
  };
}

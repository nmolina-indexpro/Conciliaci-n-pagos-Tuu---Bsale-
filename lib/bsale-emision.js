// /lib/bsale-emision.js
// ══════════════════════════════════════════════════════════════════════
// Documentos de Bsale a partir de un pedido de Shopify -- reemplazo de la app "Bsale (Chile)" de Lobo Creaciones.
// Esta primera versión SOLO ARMA el documento que se emitiría (modo sombra) y lo compara con el que ya emitió la app; no emite nada.
// Funciones puras (sin red) para poder probarlas sin Bsale ni Shopify.
// ══════════════════════════════════════════════════════════════════════

export const IVA = 0.19;

export const rutLimpio = r => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();
export function rutValido(r) { // dígito verificador (módulo 11)
  const s = rutLimpio(r);
  if (s.length < 8 || s.length > 9) return false;
  const cuerpo = s.slice(0, -1), dv = s.slice(-1);
  let suma = 0, mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const res = 11 - (suma % 11);
  return dv === (res === 11 ? '0' : res === 10 ? 'K' : String(res));
}
export const rutConGuion = r => { const s = rutLimpio(r); return s ? s.slice(0, -1) + '-' + s.slice(-1) : ''; };

const num = x => Math.round(Number(x) || 0);
const redondear = (x, dec) => Math.round(x * 10 ** dec) / 10 ** dec;

// Boleta o factura: factura solo si el cliente la pidió Y los datos tributarios están completos y con RUT válido; si no, boleta.
export function tipoDocumento(atributos) {
  const a = {};
  for (const x of atributos || []) a[x.key] = x.value;
  if (String(a.tipo_documento || '').toUpperCase() !== 'FACTURA') return { tipo: 'boleta', atributos: a };
  const faltan = ['rut', 'razon_social', 'giro', 'region', 'comuna', 'direccion_tributaria'].filter(k => !String(a[k] || '').trim());
  if (faltan.length) return { tipo: 'boleta', motivo: 'pidió factura pero faltan datos: ' + faltan.join(', '), atributos: a };
  if (!rutValido(a.rut)) return { tipo: 'boleta', motivo: 'pidió factura pero el RUT no es válido', atributos: a };
  return { tipo: 'factura', atributos: a };
}

// Líneas del documento: una por producto (con el descuento ya aplicado) y una por el envío, con valores NETOS (sin IVA).
// El pedido trae precios con IVA incluido; el neto de cada línea se calcula sobre el total de la línea para que la suma cuadre con lo cobrado.
export function lineasDelPedido(pedido) {
  const lineas = [];
  for (const li of pedido.lineItems || []) {
    const cantidad = Number(li.quantity) || 0; if (!cantidad) continue;
    const bruto = num(li.originalTotalSet?.shopMoney?.amount) - (li.discountAllocations || []).reduce((s, d) => s + num(d.allocatedAmountSet?.shopMoney?.amount), 0);
    lineas.push({ tipo: 'producto', sku: li.sku || null, glosa: li.name || li.title || '', cantidad, brutoLinea: bruto, netoUnitario: redondear(bruto / cantidad / (1 + IVA), 2) });
  }
  for (const sl of pedido.shippingLines || []) {
    const bruto = num(sl.discountedPriceSet?.shopMoney?.amount ?? sl.originalPriceSet?.shopMoney?.amount);
    if (bruto <= 0) continue;
    lineas.push({ tipo: 'envio', sku: null, glosa: 'Envío: ' + (sl.title || ''), cantidad: 1, brutoLinea: bruto, netoUnitario: redondear(bruto / (1 + IVA), 2) });
  }
  return lineas;
}

// Documento que el ERP emitiría. "ctx" trae los ids de Bsale ya resueltos (tipos, sucursal, medio de pago, lista de precios, vendedor).
export function armarDocumento(pedido, ctx = {}) {
  const t = tipoDocumento(pedido.customAttributes);
  const a = t.atributos;
  const lineas = lineasDelPedido(pedido);
  const totalPedido = num(pedido.currentTotalPriceSet?.shopMoney?.amount);
  const factura = t.tipo === 'factura';
  const fact = pedido.billingAddress || {};
  const cli = pedido.customer || {};
  const rutBoleta = !factura && rutValido(fact.company) ? rutConGuion(fact.company) : null; // en la boleta el RUT sale del campo "Empresa" del checkout
  const cliente = factura
    ? { code: rutConGuion(a.rut), company: String(a.razon_social).trim(), activity: String(a.giro).trim(), address: String(a.direccion_tributaria).trim(), municipality: String(a.comuna).trim(), city: String(a.region).trim(), email: pedido.email || cli.email || null, phone: a.telefono || null }
    : { code: rutBoleta, firstName: fact.firstName || cli.firstName || null, lastName: fact.lastName || cli.lastName || null, address: fact.address1 || null, municipality: fact.city || null, city: fact.province || null, email: pedido.email || cli.email || null, phone: fact.phone || null };
  return {
    tipo: t.tipo, motivo: t.motivo || null,
    documentTypeId: factura ? ctx.idFactura : ctx.idBoleta,
    officeId: ctx.officeId || null, priceListId: ctx.listaId || null, sellerId: ctx.vendedorId || null,
    declareSii: 1, sendEmail: 1, emissionDate: ctx.emissionDate || null,
    client: cliente,
    details: lineas.map(l => ({ tipo: l.tipo, code: l.sku, comment: l.glosa.slice(0, 250), quantity: l.cantidad, netUnitValue: l.netoUnitario, brutoLinea: l.brutoLinea, taxId: '[1]' })),
    payments: [{ paymentTypeId: ctx.medioPagoId || null, amount: totalPedido }],
    totalEsperado: totalPedido,
    referencia: pedido.name,
  };
}

// Total que Bsale calcularía con estas líneas (neto * 1,19 por línea, redondeado al peso), para ver cuánto se aleja de lo cobrado.
export function totalBsaleCalculado(doc) {
  return doc.details.reduce((s, d) => s + Math.round(d.netUnitValue * d.quantity * (1 + IVA)), 0);
}

// Compara el documento que armaría el ERP con el que emitió la app (ya leído de Bsale). "app" = { tipo, total, cliente:{rut,razon}, detalles:[{sku,cantidad,total,glosa}], medioPago, vendedor, oficina }
export function compararConApp(doc, app, tolerancia = 1) {
  const dif = [];
  const ok = (campo, erp, ap, bien) => dif.push({ campo, erp, app: ap, ok: bien });
  ok('Tipo de documento', doc.tipo, app.tipo, doc.tipo === app.tipo);
  ok('Total', doc.totalEsperado, app.total, Math.abs(doc.totalEsperado - app.total) <= tolerancia);
  const calc = totalBsaleCalculado(doc);
  ok('Total que daría Bsale con mis líneas', calc, app.total, Math.abs(calc - app.total) <= tolerancia);
  if (doc.tipo === 'factura') {
    ok('RUT del cliente', doc.client.code, app.cliente.rut, rutLimpio(doc.client.code) === rutLimpio(app.cliente.rut));
    ok('Razón social', doc.client.company, app.cliente.razon, String(doc.client.company || '').trim().toUpperCase() === String(app.cliente.razon || '').trim().toUpperCase());
  } else if (doc.client.code || app.cliente.rut) {
    ok('RUT del cliente (boleta)', doc.client.code || '—', app.cliente.rut || '—', rutLimpio(doc.client.code) === rutLimpio(app.cliente.rut));
  }
  const productos = doc.details.filter(d => d.tipo === 'producto'), envios = doc.details.filter(d => d.tipo === 'envio');
  const detallesApp = app.detalles || [];
  ok('Cantidad de líneas', productos.length + envios.length, detallesApp.length, productos.length + envios.length === detallesApp.length);
  for (const p of productos) {
    const m = detallesApp.find(d => d.sku && d.sku === p.code);
    ok('Línea ' + (p.code || p.comment.slice(0, 30)), p.quantity + ' u. · $' + p.brutoLinea, m ? m.cantidad + ' u. · $' + m.total : 'no está', !!m && m.cantidad === p.quantity && Math.abs(m.total - p.brutoLinea) <= tolerancia);
  }
  if (envios.length) {
    const eApp = detallesApp.filter(d => !d.sku);
    const brutoEnvio = envios.reduce((s, e) => s + e.brutoLinea, 0), brutoEnvioApp = eApp.reduce((s, d) => s + d.total, 0);
    ok('Envío', '$' + brutoEnvio, eApp.length ? '$' + brutoEnvioApp : 'no está', eApp.length > 0 && Math.abs(brutoEnvio - brutoEnvioApp) <= tolerancia);
  }
  return dif;
}

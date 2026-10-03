// /lib/bsale-cotizacion.js
// Armado y validación de una cotización para crearla en Bsale (POST /v1/documents.json).
// Sin imports a propósito: funciones puras, se prueban aisladas y las usa api/negocio.js.
//
// OJO: el formato del POST sigue la documentación de la API de Bsale, pero este código se
// probó solo con respuestas simuladas. La primera cotización real hay que revisarla en Bsale
// (por eso existe el "simulacro", que valida todo con consultas de lectura y no crea nada).

export const IVA_PCT = 19;
export const DIAS_VIGENCIA_POR_DEFECTO = 7;
export const MAX_ITEMS = 40;

const redondear = n => Math.round(Number(n) || 0);

// Valida y limpia las líneas que manda la pantalla. Devuelve { items, errores }.
export function normalizarItems(items) {
  const errores = [];
  if (!Array.isArray(items) || items.length === 0) return { items: [], errores: ['Agrega al menos un producto'] };
  if (items.length > MAX_ITEMS) errores.push(`Máximo ${MAX_ITEMS} líneas por cotización`);
  const limpios = items.slice(0, MAX_ITEMS).map((it, i) => {
    const n = i + 1;
    const variantId = Number(it?.variantId);
    const cantidad = Number(it?.cantidad);
    const precioNeto = Number(it?.precioNeto);
    const descuentoPct = Number(it?.descuentoPct ?? 0);
    if (!Number.isInteger(variantId) || variantId <= 0) errores.push(`Línea ${n}: falta el producto de Bsale (variante)`);
    if (!(cantidad > 0) || !Number.isFinite(cantidad)) errores.push(`Línea ${n}: la cantidad debe ser mayor a 0`);
    if (!(precioNeto >= 0) || !Number.isFinite(precioNeto)) errores.push(`Línea ${n}: precio neto no válido`);
    if (!(descuentoPct >= 0 && descuentoPct <= 100)) errores.push(`Línea ${n}: el descuento debe estar entre 0 y 100`);
    return {
      variantId, cantidad, precioNeto, descuentoPct: descuentoPct || 0,
      codigo: String(it?.codigo || '').slice(0, 60), descripcion: String(it?.descripcion || '').slice(0, 200),
    };
  });
  return { items: limpios, errores };
}

export function totalLinea(it) {
  return redondear(it.cantidad * it.precioNeto * (1 - (it.descuentoPct || 0) / 100));
}

// Neto, IVA y total en pesos enteros (CLP).
export function calcularTotales(items) {
  const neto = items.reduce((s, it) => s + totalLinea(it), 0);
  const iva = redondear(neto * IVA_PCT / 100);
  return { neto, iva, total: neto + iva };
}

// Cuerpo del POST /v1/documents.json.
export function armarPayloadCotizacion({ tipoDocumentoId, oficinaId, listaPreciosId, clienteId, items, ivaId, ahoraSeg, diasVigencia, comentario }) {
  const dias = Number.isFinite(Number(diasVigencia)) && Number(diasVigencia) > 0 ? Math.min(90, Math.round(Number(diasVigencia))) : DIAS_VIGENCIA_POR_DEFECTO;
  const payload = {
    documentTypeId: tipoDocumentoId,
    officeId: oficinaId,
    emissionDate: ahoraSeg,
    expirationDate: ahoraSeg + dias * 86400,
    declareSii: 0, // una cotización no se declara al SII
    clientId: clienteId,
    details: items.map(it => {
      const d = { variantId: it.variantId, quantity: it.cantidad, netUnitValue: it.precioNeto };
      if (it.descuentoPct > 0) d.discount = it.descuentoPct;
      if (ivaId) d.taxId = `[${ivaId}]`;
      return d;
    }),
  };
  if (listaPreciosId) payload.priceListId = listaPreciosId;
  if (comentario && String(comentario).trim()) payload.comment = String(comentario).trim().slice(0, 500);
  return payload;
}

// Últimos 9 dígitos de un teléfono (misma clave de cruce que el resto del ERP).
export function ultimos9(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : '';
}

// RUT chileno "12.345.678-5" -> "12345678-5" (formato en que Bsale guarda "code").
export function normalizarRut(txt) {
  const t = String(txt || '').replace(/[.\s]/g, '').toUpperCase();
  return /^\d{7,8}-?[\dK]$/.test(t) ? (t.includes('-') ? t : t.slice(0, -1) + '-' + t.slice(-1)) : null;
}

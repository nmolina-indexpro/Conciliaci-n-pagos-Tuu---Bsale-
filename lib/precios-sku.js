// /lib/precios-sku.js
// ══════════════════════════════════════════════════════════════════════
// Precio de antes y de ahora de un SKU, para el correo "Cambios en productos estancados" (marca "Variación de precio").
// ══════════════════════════════════════════════════════════════════════
// El ERP registra cada día el precio de lista (con IVA) de cada SKU en Bsale y en la tienda (Shopify) y guarda un cambio cuando difiere del día anterior
// (tablas precios_sku_ultimo y precios_sku_cambios, ver registrarPreciosSku en api/negocio.js). Funciones puras (sin red ni base de datos).
//
// Fuentes, en este orden:
//   'registro' -> cambio detectado por el registro diario de precios (antes y ahora reales);
//   'aviso'    -> aviso de precio de Bsale (webhook) de los últimos días, que trae el precio que tenía la tienda y el nuevo;
//   'actual'   -> solo se conoce el precio de hoy (todavía no hay un cambio registrado: el "antes" no existe).

// cambio: { fuente, precio_anterior, precio_nuevo, detectado_en } | null   (el más reciente; Bsale tiene prioridad sobre la tienda)
// aviso:  { de, a, recibido_en } | null
// actual: { fuente, precio } | null
export function elegirPrecioSku({ cambio = null, aviso = null, actual = null } = {}) {
  const n = v => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
  if (cambio && n(cambio.precio_anterior) != null && n(cambio.precio_nuevo) != null) {
    return { antes: n(cambio.precio_anterior), ahora: n(cambio.precio_nuevo), fuente: cambio.fuente, origen: 'registro', cuando: cambio.detectado_en || null };
  }
  if (aviso && n(aviso.de) != null && n(aviso.a) != null && n(aviso.de) !== n(aviso.a)) {
    return { antes: n(aviso.de), ahora: n(aviso.a), fuente: 'bsale', origen: 'aviso', cuando: aviso.recibido_en || null };
  }
  if (actual && n(actual.precio) != null) return { antes: null, ahora: n(actual.precio), fuente: actual.fuente || null, origen: 'actual', cuando: null };
  return null;
}

// Variación porcentual redondeada (null si no hay base)
export function variacionPrecio(antes, ahora) {
  if (antes == null || ahora == null || Number(antes) === 0) return null;
  return Math.round(((Number(ahora) - Number(antes)) / Number(antes)) * 1000) / 10;
}

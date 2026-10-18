// /lib/productos-nuevos.js
// Productos Nuevos (Análisis): lo que el vendedor anota cuando un cliente pide un repuesto que no tenemos asociado. Funciones puras, para poder probarlas.
//   - resolverEntradaProducto: el vendedor pega UN solo dato (el link del producto en indexstore.cl o el SKU) y de ahí salen los dos
//     (SKU + link + título), usando el mapa SKU -> producto de Shopify que ya arma el recurso shopify-urls-sku.
//   - columnaCompatibilidad: a qué columna de notebook_compatibilidad (la base de modelos del sitio) va el SKU según el tipo de producto.

export const COLUMNA_COMPAT_POR_TIPO = { bateria: 'sku_bateria', pantalla: 'sku_pantalla', cargador: 'sku_cargador' };
export function columnaCompatibilidad(tipo) { return COLUMNA_COMPAT_POR_TIPO[tipo] || null; }

// Saca el "handle" de un link de producto ("https://www.indexstore.cl/products/pantalla-...?variant=123", "/products/xxx", "indexstore.cl/products/xxx#a").
export function handleDesdeLink(texto) {
  const m = String(texto || '').match(/\/products\/([a-z0-9][a-z0-9\-_%.]*)/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).toLowerCase(); } catch { return m[1].toLowerCase(); }
}

export function esLink(texto) {
  return /^(https?:\/\/|www\.)\S+$/i.test(String(texto || '').trim()) || /\/products\/\S+/i.test(String(texto || '').trim());
}

// urls: { [sku]: { url, adminUrl, status, titulo, handle } }  (ver manejarShopifyUrlsSku). Devuelve null si no encuentra nada.
export function resolverEntradaProducto(entrada, urls) {
  const texto = String(entrada || '').trim();
  if (!texto || !urls) return null;
  const arma = (sku, e, extra = {}) => ({ sku, url: e.url || null, titulo: e.titulo || null, estado: e.status || null, ...extra });
  if (esLink(texto)) {
    const handle = handleDesdeLink(texto);
    if (!handle) return null;
    const skus = Object.keys(urls).filter((k) => String(urls[k].handle || '').toLowerCase() === handle);
    if (!skus.length) return null;
    // un producto puede tener varias variantes (varios SKU): se devuelve la primera y se avisa
    return arma(skus[0], urls[skus[0]], { origen: 'link', variantes: skus.length > 1 ? skus : null });
  }
  const clave = Object.keys(urls).find((k) => k.toLowerCase() === texto.toLowerCase());
  return clave ? arma(clave, urls[clave], { origen: 'sku' }) : null;
}

// Lo que se guarda a partir de lo que escribió el vendedor, haya o no Shopify para resolverlo: si no se pudo resolver, se conserva lo escrito
// (el link tal cual si era un link, o el texto como SKU), para no perder el dato.
export function datosProductoIdentificado(entrada, resuelto) {
  const texto = String(entrada || '').trim();
  if (!texto) return { sku: null, link: null, titulo: null };
  if (resuelto) return { sku: resuelto.sku, link: resuelto.url || (esLink(texto) ? texto : null), titulo: resuelto.titulo || null };
  return esLink(texto) ? { sku: null, link: texto, titulo: null } : { sku: texto.toUpperCase(), link: null, titulo: null };
}

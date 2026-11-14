// /lib/pedidos-pantalla-catalogo.js
// Búsqueda de productos del catálogo de la tienda (Shopify) para el formulario de Pantallas a pedido: devuelve SKU, modelo (título), foto, enlace y stock,
// para elegir el producto en vez de escribirlo. Solo lee. Recibe gql(query, variables), el mismo ayudante de GraphQL de Descuentos web y Envío gratis
// (así se prueba sin Shopify).

const SIN_VARIANTE = /^default title$/i;

// Texto de búsqueda de Shopify: cada palabra con comodín al final (así "pavilion 15" encuentra "HP Pavilion 15-eg0010la"); si es una sola palabra,
// también se busca como comienzo de SKU. Se quitan los caracteres que Shopify toma como operadores.
export function consultaDeBusqueda(texto) {
  const palabras = String(texto || '').trim().split(/\s+/).slice(0, 6).map((w) => w.replace(/[^\p{L}\p{N}._-]/gu, '')).filter(Boolean);
  if (!palabras.length) return '';
  const terminos = palabras.map((w) => w + '*').join(' ');
  return palabras.length === 1 ? `(${terminos}) OR sku:${palabras[0]}*` : terminos;
}

// Una fila por variante con SKU (o una por producto si no tiene): [{ sku, titulo, variante, imagen, url, precio, stock, estado, tipo }]
export async function buscarProductos(gql, texto, { max = 12 } = {}) {
  const q = consultaDeBusqueda(texto);
  if (String(texto || '').trim().length < 2 || !q) return [];
  const r = await gql(
    `query($q: String!, $n: Int!) { products(first: $n, query: $q, sortKey: RELEVANCE) { nodes {
       title status productType onlineStoreUrl featuredImage { url }
       variants(first: 8) { nodes { sku title price inventoryQuantity image { url } } } } } }`,
    { q, n: max });
  if (r && r.errors && r.errors.length && !(r.data && r.data.products)) throw new Error('Shopify no entregó los productos: ' + r.errors.map((e) => e.message).join('; ').slice(0, 200));
  const filas = [];
  for (const p of (r && r.data && r.data.products && r.data.products.nodes) || []) {
    const variantes = ((p.variants && p.variants.nodes) || []).filter((v) => v.sku);
    const base = { titulo: p.title, url: p.onlineStoreUrl || null, estado: p.status, tipo: p.productType || null };
    if (!variantes.length) { filas.push({ ...base, sku: null, variante: '', imagen: (p.featuredImage && p.featuredImage.url) || null, precio: null, stock: null }); continue; }
    for (const v of variantes) {
      filas.push({ ...base, sku: v.sku, variante: v.title && !SIN_VARIANTE.test(v.title) ? v.title : '', imagen: (v.image && v.image.url) || (p.featuredImage && p.featuredImage.url) || null, precio: v.price != null ? Number(v.price) : null, stock: v.inventoryQuantity ?? null });
    }
  }
  return filas.slice(0, max * 2);
}

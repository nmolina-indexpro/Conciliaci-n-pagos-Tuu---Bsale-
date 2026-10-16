// /lib/envio-gratis-shopify.js
// ══════════════════════════════════════════════════════════════════════
// Envío gratis por producto: la marca "🚚 Envío gratis" de Productos estancados se refleja en Shopify como la etiqueta "envio-gratis"
// en TODAS las publicaciones (productos) que tienen ese SKU. El aviso de la ficha del producto y el descuento de envío miran esa etiqueta.
// "gql" = función (query, variables) -> respuesta de la Admin API de Shopify (ver descuentosWebGql en api/negocio.js).
// ══════════════════════════════════════════════════════════════════════
export const ETIQUETA_ENVIO_GRATIS = 'envio-gratis';

const skuSeguro = s => /^[A-Za-z0-9._\-]+$/.test(String(s || ''));
const tieneEtiqueta = p => (p.tags || []).some(t => String(t).toLowerCase() === ETIQUETA_ENVIO_GRATIS);

// Productos (publicaciones) de Shopify que usan ese SKU en alguna variante.
export async function publicacionesDeSku(gql, sku) {
  if (!skuSeguro(sku)) return [];
  const body = await gql(
    `query($q: String!) { productVariants(first: 100, query: $q) { nodes { sku product { id handle title status tags } } } }`,
    { q: `sku:'${sku}'` },
  );
  const productos = new Map();
  for (const v of (body.data && body.data.productVariants && body.data.productVariants.nodes) || []) {
    if (v.sku !== sku || !v.product) continue;
    productos.set(v.product.id, v.product);
  }
  return [...productos.values()];
}

export async function estadoDeSku(gql, sku) {
  const pubs = await publicacionesDeSku(gql, sku);
  return { publicaciones: pubs.length, etiquetadas: pubs.filter(tieneEtiqueta).length };
}

// Pone (activar = true) o quita la etiqueta en todas las publicaciones del SKU. Solo toca las que hace falta.
export async function aplicarEtiquetaEnvioGratis(gql, sku, activar) {
  const pubs = await publicacionesDeSku(gql, sku);
  const mutacion = activar
    ? 'mutation($id: ID!, $t: [String!]!) { tagsAdd(id: $id, tags: $t) { userErrors { message } } }'
    : 'mutation($id: ID!, $t: [String!]!) { tagsRemove(id: $id, tags: $t) { userErrors { message } } }';
  let cambiadas = 0; const errores = [];
  for (const p of pubs) {
    if (tieneEtiqueta(p) === !!activar) continue;
    const r = await gql(mutacion, { id: p.id, t: [ETIQUETA_ENVIO_GRATIS] });
    const ue = (r.data && (r.data.tagsAdd || r.data.tagsRemove) && (r.data.tagsAdd || r.data.tagsRemove).userErrors) || [];
    if (ue.length || r.errors) errores.push((ue[0] && ue[0].message) || 'error de Shopify'); else cambiadas++;
  }
  return { publicaciones: pubs.length, cambiadas, errores };
}

// Publicaciones que tienen la etiqueta puesta (con su primer SKU), para detectar las que ya no corresponden.
export async function productosConEtiqueta(gql) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    const body = await gql(
      `query($c: String) { products(first: 100, after: $c, query: "tag:${ETIQUETA_ENVIO_GRATIS}") { nodes { id handle title variants(first: 3) { nodes { sku } } } pageInfo { hasNextPage endCursor } } }`,
      { c: cursor },
    );
    const con = body.data && body.data.products;
    if (!con) break;
    for (const p of con.nodes) out.push({ id: p.id, handle: p.handle, title: p.title, skus: (p.variants.nodes || []).map(v => v.sku).filter(Boolean) });
    if (!con.pageInfo.hasNextPage) break;
    cursor = con.pageInfo.endCursor;
  }
  return out;
}

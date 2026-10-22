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
  // "producto" = título de la publicación en Shopify (ej. "Cargador para notebook HP ..."); la ficha de Bsale solo describe la variante (voltaje, conector).
  return { publicaciones: pubs.length, etiquetadas: pubs.filter(tieneEtiqueta).length, productos: [...new Set(pubs.map(p => p.title).filter(Boolean))] };
}

// Pone (activar = true) o quita la etiqueta en todas las publicaciones del SKU.
// Se manda la orden a TODAS las publicaciones, aunque la lectura diga que ya están como se quiere: agregar o quitar una etiqueta es idempotente, y esa lectura
// puede venir atrasada (el índice de búsqueda de Shopify o un cambio anterior todavía en vuelo). Antes se saltaba la orden cuando "ya estaba": al marcar y desmarcar
// seguido, la lectura aún no veía la etiqueta recién puesta, no se quitaba, y quedaba envío gratis en la web sin estar marcado en el ERP.
export async function aplicarEtiquetaEnvioGratis(gql, sku, activar) {
  const pubs = await publicacionesDeSku(gql, sku);
  const mutacion = activar
    ? 'mutation($id: ID!, $t: [String!]!) { tagsAdd(id: $id, tags: $t) { userErrors { message } } }'
    : 'mutation($id: ID!, $t: [String!]!) { tagsRemove(id: $id, tags: $t) { userErrors { message } } }';
  let cambiadas = 0; const errores = [];
  for (const p of pubs) {
    const necesitabaCambio = tieneEtiqueta(p) !== !!activar; // según la lectura (que puede venir atrasada): solo para informar cuántas cambiaron
    const r = await gql(mutacion, { id: p.id, t: [ETIQUETA_ENVIO_GRATIS] });
    const ue = (r.data && (r.data.tagsAdd || r.data.tagsRemove) && (r.data.tagsAdd || r.data.tagsRemove).userErrors) || [];
    if (ue.length || r.errors) errores.push((ue[0] && ue[0].message) || 'error de Shopify'); else if (necesitabaCambio) cambiadas++;
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

// ---- Descuento automático de envío gratis (usa la función publicada "envio-gratis-etiqueta"; ver GUIA-ENVIO-GRATIS.md) ----
export const FUNCION_HANDLE_ENVIO = 'envio-gratis-etiqueta';
export const TITULO_DESCUENTO_ENVIO = 'Envío gratis (productos con etiqueta)';

// ¿Está publicada la función? ¿Ya existe el descuento automático que la usa?
export async function estadoDescuentoEnvio(gql) {
  const out = { funcion: { publicada: null, error: null }, descuento: { existe: false, estado: null, id: null }, errorDescuento: null };
  try {
    const r = await gql(`{ shopifyFunctions(first: 50) { nodes { id title apiType } } }`, {});
    const f = (r.data && r.data.shopifyFunctions && r.data.shopifyFunctions.nodes || []).find(x => /envio.?gratis/i.test(x.title || ''));
    out.funcion = { publicada: Boolean(f), error: null };
  } catch (e) { out.funcion = { publicada: null, error: String(e.message || e).slice(0, 160) }; }
  try {
    const r = await gql(`{ automaticDiscountNodes(first: 50) { nodes { id automaticDiscount { __typename ... on DiscountAutomaticApp { title status } } } } }`, {});
    const d = (r.data && r.data.automaticDiscountNodes && r.data.automaticDiscountNodes.nodes || []).find(n => n.automaticDiscount && n.automaticDiscount.title === TITULO_DESCUENTO_ENVIO);
    if (d) out.descuento = { existe: true, estado: d.automaticDiscount.status || null, id: d.id };
  } catch (e) { out.errorDescuento = String(e.message || e).slice(0, 160); }
  return out;
}

// Crea el descuento automático de envío. Se combina con descuentos de producto y de pedido (por ejemplo el de volumen), pero no con otro de envío.
export async function crearDescuentoEnvioGratis(gql) {
  const r = await gql(
    `mutation($d: DiscountAutomaticAppInput!) { discountAutomaticAppCreate(automaticAppDiscount: $d) { automaticAppDiscount { discountId } userErrors { field message } } }`,
    { d: { title: TITULO_DESCUENTO_ENVIO, functionHandle: FUNCION_HANDLE_ENVIO, discountClasses: ['SHIPPING'], startsAt: new Date().toISOString(), combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: false } } },
  );
  const errs = (r.data && r.data.discountAutomaticAppCreate && r.data.discountAutomaticAppCreate.userErrors) || [];
  if (errs.length) throw new Error(errs.map(e => e.message).join('; '));
  return (r.data && r.data.discountAutomaticAppCreate && r.data.discountAutomaticAppCreate.automaticAppDiscount && r.data.discountAutomaticAppCreate.automaticAppDiscount.discountId) || null;
}

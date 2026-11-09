// /lib/pedidos-pantalla-shopify.js
// Parte de Shopify de "Pantallas a pedido": crear el producto de abono, revisar los pedidos que lo contienen y registrar los avisos (webhooks) de pedidos.
// Todas las funciones reciben gql(query, variables), el mismo ayudante de GraphQL que usan Descuentos web y Envío gratis (así se prueban sin Shopify).
import { normalizarOrdenGraphql } from './pedidos-pantalla.js';

export const TOPICOS_PEDIDOS = ['ORDERS_CREATE', 'ORDERS_PAID', 'ORDERS_CANCELLED'];

const errores = (r, clave) => ((r && r.data && r.data[clave] && r.data[clave].userErrors) || []).map((e) => e.message).filter(Boolean);
const peso = (n) => '$' + Math.round(n).toLocaleString('es-CL');

// Texto que ve el cliente en la ficha del producto de abono (queda como BORRADOR: se revisa y publica en Shopify).
export function descripcionAbono({ monto, dias }) {
  return `<p>Con este abono encargamos para ti una pantalla de notebook que <b>no tenemos en stock</b> y que importamos a pedido.</p>
<ul>
<li><b>Abono:</b> ${peso(monto)}. Se descuenta del valor final de la pantalla.</li>
<li><b>Plazo estimado:</b> unos ${dias} días desde que confirmamos tu pedido.</li>
<li>Después de pagar te contactamos para confirmar el modelo exacto y el precio final.</li>
</ul>
<p>Indica abajo el modelo de tu notebook y, si lo tienes, el número de parte de la pantalla.</p>`;
}

// Productos de abono que hay en la tienda (por el prefijo de SKU). [{ id, titulo, handle, estado, variantes: [{ id, sku, precio }] }]
export async function buscarProductosAbono(gql, prefijo) {
  const r = await gql(`query($q: String!) { products(first: 20, query: $q) { nodes { id title handle status variants(first: 10) { nodes { id sku price } } } } }`, { q: `sku:${prefijo}*` });
  const p = String(prefijo).toUpperCase();
  return ((r.data && r.data.products && r.data.products.nodes) || [])
    .map((n) => ({ id: n.id, titulo: n.title, handle: n.handle, estado: n.status, variantes: ((n.variants && n.variants.nodes) || []).filter((v) => String(v.sku || '').toUpperCase().startsWith(p)).map((v) => ({ id: v.id, sku: v.sku, precio: Number(v.price) })) }))
    .filter((n) => n.variantes.length);
}

// Crea el producto de abono como BORRADOR (no se ve en la tienda hasta publicarlo en Shopify): sin inventario, sin envío y con el SKU = prefijo-monto.
export async function crearProductoAbono(gql, { monto, prefijo, dias, titulo }) {
  const m = Math.round(Number(monto));
  if (!(m >= 1000 && m <= 500000)) throw new Error('El monto del abono debe estar entre $1.000 y $500.000');
  const sku = `${String(prefijo).toUpperCase()}-${m}`;
  const existentes = await buscarProductosAbono(gql, sku);
  if (existentes.some((p) => p.variantes.some((v) => String(v.sku).toUpperCase() === sku))) throw new Error(`Ya existe un producto de abono con el SKU ${sku}`);
  const crear = await gql(
    `mutation($input: ProductInput!) { productCreate(input: $input) { product { id handle variants(first: 1) { nodes { id } } } userErrors { field message } } }`,
    { input: { title: titulo || `Abono: pantalla de notebook a pedido (${peso(m)})`, descriptionHtml: descripcionAbono({ monto: m, dias }), vendor: 'IndexStore', productType: 'Abono pantalla a pedido', status: 'DRAFT', tags: ['a-pedido', 'abono-pantalla'] } });
  const e1 = errores(crear, 'productCreate');
  if (e1.length) throw new Error('Shopify no creó el producto: ' + e1.join('; '));
  const producto = crear.data && crear.data.productCreate && crear.data.productCreate.product;
  const varianteId = producto && producto.variants && producto.variants.nodes && producto.variants.nodes[0] && producto.variants.nodes[0].id;
  if (!producto || !varianteId) throw new Error('Shopify creó el producto pero no devolvió su variante');
  const precio = await gql(
    `mutation($pid: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $pid, variants: $v) { productVariants { id sku price } userErrors { field message } } }`,
    { pid: producto.id, v: [{ id: varianteId, price: String(m), inventoryPolicy: 'CONTINUE', inventoryItem: { sku, tracked: false, requiresShipping: false } }] });
  const e2 = errores(precio, 'productVariantsBulkUpdate');
  if (e2.length) throw new Error(`El producto se creó (${producto.handle}) pero no se le pudo poner el precio y el SKU: ` + e2.join('; '));
  return { id: producto.id, handle: producto.handle, sku, monto: m };
}

// Pedidos de la tienda que contienen el producto de abono, desde una fecha ('AAAA-MM-DD'). Ordenes normalizadas (ver normalizarOrdenGraphql).
export async function ordenesConAbono(gql, prefijo, desde, { maxPaginas = 4 } = {}) {
  const out = []; let after = null; const p = String(prefijo).toUpperCase();
  for (let pag = 0; pag < maxPaginas; pag++) {
    const r = await gql(
      `query($q: String!, $after: String) { orders(first: 50, after: $after, sortKey: CREATED_AT, reverse: true, query: $q) { pageInfo { hasNextPage endCursor } nodes {
         id name createdAt cancelledAt displayFinancialStatus note email phone customer { firstName lastName email phone } shippingAddress { name phone }
         lineItems(first: 20) { nodes { id sku title quantity originalUnitPriceSet { shopMoney { amount } } customAttributes { key value } } } } } }`,
      { q: `sku:${prefijo}* created_at:>=${desde}`, after });
    if (r.errors && r.errors.length && !(r.data && r.data.orders)) throw new Error('Shopify no entregó los pedidos: ' + r.errors.map((e) => e.message).join('; '));
    const o = r.data && r.data.orders;
    for (const n of (o && o.nodes) || []) {
      const orden = normalizarOrdenGraphql(n);
      if (orden && orden.lineas.some((l) => l.sku.toUpperCase().startsWith(p))) out.push(orden);
    }
    if (!(o && o.pageInfo && o.pageInfo.hasNextPage)) break;
    after = o.pageInfo.endCursor;
  }
  return out;
}

// Avisos (webhooks) de pedidos nuevos, pagados y cancelados hacia la URL del ERP.
export async function estadoWebhooksPedidos(gql, urlEsperada) {
  const r = await gql(`{ webhookSubscriptions(first: 100) { nodes { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`, {});
  const nodos = (r.data && r.data.webhookSubscriptions && r.data.webhookSubscriptions.nodes) || [];
  const propios = nodos.filter((n) => n.endpoint && n.endpoint.callbackUrl === urlEsperada).map((n) => n.topic);
  return { registrados: TOPICOS_PEDIDOS.filter((t) => propios.includes(t)), faltan: TOPICOS_PEDIDOS.filter((t) => !propios.includes(t)) };
}
export async function registrarWebhooksPedidos(gql, url) {
  const { faltan } = await estadoWebhooksPedidos(gql, url);
  const creados = [], fallos = [];
  for (const topico of faltan) {
    const r = await gql(`mutation($t: WebhookSubscriptionTopic!, $u: URL!) { webhookSubscriptionCreate(topic: $t, webhookSubscription: { callbackUrl: $u, format: JSON }) { webhookSubscription { id } userErrors { message } } }`, { t: topico, u: url });
    const e = errores(r, 'webhookSubscriptionCreate');
    if (e.length) fallos.push(`${topico}: ${e.join('; ')}`); else creados.push(topico);
  }
  return { creados, fallos };
}

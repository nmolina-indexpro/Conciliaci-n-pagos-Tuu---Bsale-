// Descuentos por volumen de la tienda (página "Descuentos web" del ERP).
//
// Cómo funciona (ver también la guía de traspaso del buscador/cotizador):
//  - En Shopify hay descuentos automáticos por cantidad ("Volumen 3+ ...", "Volumen 5+ ...") que solo aplican a las colecciones
//    automáticas "etiqueta = descuento-vol-3" y "etiqueta = descuento-vol-5". No se combinan con nada más.
//  - Este módulo decide QUÉ productos llevan cada etiqueta según su stock: un tramo solo se ofrece si quedan al menos
//    "reserva" unidades más que las que pide el tramo (tramo de 3 con reserva 2 => stock >= 5; tramo de 5 => stock >= 7).
//  - Los productos son los "reales" (los que se agregan al carro y tienen SKU de Bsale: tipo de producto + etiqueta "sku-madre"),
//    no las fichas por modelo, que solo apuntan a ellos.
//  - El costo sale de Bsale (costo promedio de la variante); si no se puede leer, se usa el que se escriba a mano en la página.
// La lógica pura (tramos, etiquetas, margen) va aparte para poder probarla sin Shopify.

import { createHmac } from 'node:crypto';

// Clave del aviso de stock de Shopify (va en la URL del webhook): se deriva de un secreto que ya existe, así no hace falta otra variable.
// El aviso solo dispara una revisión (el stock se lee de Shopify, nada del cuerpo del aviso se usa), por eso basta con una clave en la URL.
export function claveAviso(secreto) {
  if (!secreto) return '';
  return createHmac('sha256', String(secreto)).update('descuentos-web-aviso').digest('hex').slice(0, 32);
}

export const CONFIG_DEFECTO = {
  activo: false,                       // si es true, el ERP sincroniza solo (aviso de stock y revisión diaria); el botón manual siempre funciona
  tramos: [{ cantidad: 3, porcentaje: 10 }, { cantidad: 5, porcentaje: 15 }],
  reserva: 2,                          // unidades que deben sobrar por encima de lo que pide el tramo
  margen_minimo: 30,                   // % sobre el precio neto (sin IVA); solo informativo, no bloquea
  tipo_producto: 'Cargadores y adaptadores de alimentación',
  etiqueta_producto: 'sku-madre',
  prefijo_etiqueta: 'descuento-vol-',
  prefijo_titulo: 'Volumen',           // los descuentos automáticos de Shopify deben llamarse "Volumen ..." para medirlos en los pedidos
  costos_manual: {},                   // { SKU: costo neto } cuando Bsale no entrega el costo
};

const IVA = 1.19;

const entero = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// Entero dentro del rango, o 0 si no sirve (un tramo de 1 unidad o de 90% no se corrige: se descarta).
const dentro = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : 0; };

// Deja la configuración siempre válida: tramos ordenados, sin repetir cantidad, porcentajes razonables.
export function normalizarConfig(entrada) {
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const base = CONFIG_DEFECTO;
  const vistos = new Set();
  const tramos = (Array.isArray(e.tramos) ? e.tramos : base.tramos)
    .map((t) => ({ cantidad: dentro(t?.cantidad, 2, 50), porcentaje: dentro(t?.porcentaje, 1, 60) }))
    .filter((t) => t.cantidad >= 2 && t.porcentaje >= 1 && !vistos.has(t.cantidad) && vistos.add(t.cantidad))
    .sort((a, b) => a.cantidad - b.cantidad)
    .slice(0, 4);
  const texto = (v, def, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : def);
  const costos = {};
  for (const [sku, v] of Object.entries(e.costos_manual && typeof e.costos_manual === 'object' ? e.costos_manual : {})) {
    const c = Math.round(Number(v));
    if (/^[A-Za-z0-9_.-]{1,40}$/.test(sku) && Number.isFinite(c) && c > 0 && c < 100000000) costos[sku] = c;
  }
  return {
    activo: e.activo === true,
    tramos: tramos.length ? tramos : base.tramos,
    reserva: entero(e.reserva, 0, 10, base.reserva),
    margen_minimo: entero(e.margen_minimo, 0, 90, base.margen_minimo),
    tipo_producto: texto(e.tipo_producto, base.tipo_producto, 120),
    etiqueta_producto: texto(e.etiqueta_producto, base.etiqueta_producto, 60),
    prefijo_etiqueta: texto(e.prefijo_etiqueta, base.prefijo_etiqueta, 40),
    prefijo_titulo: texto(e.prefijo_titulo, base.prefijo_titulo, 40),
    costos_manual: costos,
  };
}

export const nombreEtiqueta = (cfg, cantidad) => `${cfg.prefijo_etiqueta}${cantidad}`;

// Tramos que se ofrecen con este stock: solo si sobran "reserva" unidades después de cubrir el tramo.
export function tramosOfrecidos(stock, cfg) {
  const s = Number.isFinite(Number(stock)) ? Number(stock) : 0;
  return cfg.tramos.filter((t) => s >= t.cantidad + cfg.reserva);
}

export function etiquetasDeseadas(stock, cfg) {
  return tramosOfrecidos(stock, cfg).map((t) => nombreEtiqueta(cfg, t.cantidad));
}

// Qué etiquetas hay que poner y quitar. Solo toca las que empiezan con el prefijo del módulo (nunca otras etiquetas del producto).
export function diferenciaEtiquetas(actuales, deseadas, cfg) {
  const mias = (actuales || []).filter((t) => t.toLowerCase().startsWith(cfg.prefijo_etiqueta.toLowerCase()));
  const tengo = new Set(mias.map((t) => t.toLowerCase()));
  const quiero = new Set(deseadas.map((t) => t.toLowerCase()));
  return {
    agregar: deseadas.filter((t) => !tengo.has(t.toLowerCase())),
    quitar: mias.filter((t) => !quiero.has(t.toLowerCase())),
  };
}

// Margen sobre el precio neto (los precios de la tienda incluyen IVA; el costo de Bsale es neto).
export function calcularMargen(precioConIva, costoNeto, pct) {
  const precio = precioConIva * (1 - pct / 100);
  const neto = precio / IVA;
  if (!costoNeto || !neto) return { precio: Math.round(precio), neto: Math.round(neto), utilidad: null, margen: null };
  return { precio: Math.round(precio), neto: Math.round(neto), utilidad: Math.round(neto - costoNeto), margen: Math.round(((neto - costoNeto) / neto) * 1000) / 10 };
}

// Descuento más alto que mantiene el margen mínimo (0 si ni sin descuento se llega).
export function descuentoMaximo(precioConIva, costoNeto, margenMinimo) {
  if (!costoNeto || !precioConIva) return null;
  const netoMinimo = costoNeto / (1 - margenMinimo / 100);
  const tope = (1 - netoMinimo / (precioConIva / IVA)) * 100;
  return Math.max(0, Math.floor(tope));
}

export function analizarProducto(p, cfg) {
  const stock = p.activo ? p.stock : 0;
  const deseadas = etiquetasDeseadas(stock, cfg);
  const dif = diferenciaEtiquetas(p.tags, deseadas, cfg);
  const costo = p.costo ?? null;
  // Datos para la ficha: los tramos que se ofrecen, en un metacampo del producto (descuentos.tramos). La ficha del cliente lo lee,
  // así el porcentaje y la cantidad salen de esta página y no hay que repetirlos en el tema.
  const metaDeseado = JSON.stringify(tramosOfrecidos(stock, cfg).map((t) => ({ cantidad: t.cantidad, porcentaje: t.porcentaje })));
  let metaActual = '[]';
  try { metaActual = JSON.stringify(JSON.parse(p.meta_tramos || '[]')); } catch { metaActual = '?'; }
  return {
    ...p,
    meta_deseado: metaDeseado,
    meta_cambio: metaActual !== metaDeseado,
    stock_efectivo: stock,
    ofrecidos: tramosOfrecidos(stock, cfg),
    etiquetas_deseadas: deseadas,
    agregar: dif.agregar,
    quitar: dif.quitar,
    margenes: [{ cantidad: 1, porcentaje: 0, ...calcularMargen(p.precio, costo, 0) }]
      .concat(cfg.tramos.map((t) => ({ cantidad: t.cantidad, porcentaje: t.porcentaje, ...calcularMargen(p.precio, costo, t.porcentaje) }))),
    descuento_maximo: descuentoMaximo(p.precio, costo, cfg.margen_minimo),
  };
}

// ---------------------------------------------------------------- Shopify

const gidNumero = (gid) => String(gid || '').split('/').pop();

export async function permisosShopify(gql) {
  try {
    const r = await gql(`{ currentAppInstallation { accessScopes { handle } } }`, {});
    const scopes = (r.data?.currentAppInstallation?.accessScopes || []).map((s) => s.handle);
    return {
      ok: scopes.includes('write_products'),
      write_products: scopes.includes('write_products'),
      read_inventory: scopes.includes('read_inventory') || scopes.includes('write_inventory'),
      read_orders: scopes.includes('read_orders'),
      write_discounts: scopes.includes('write_discounts'),
      read_discounts: scopes.includes('read_discounts') || scopes.includes('write_discounts'),
      scopes,
    };
  } catch (e) {
    return { ok: false, write_products: false, read_inventory: false, read_orders: false, write_discounts: false, read_discounts: false, scopes: [], error: e.message };
  }
}

export async function listarProductos(gql, cfg) {
  const q = `product_type:"${cfg.tipo_producto.replace(/"/g, '')}" AND tag:${cfg.etiqueta_producto.replace(/[^\w-]/g, '')} AND status:active`; // solo productos activos: archivados y borradores no se consideran
  const query = `
    query($q: String!, $cursor: String) {
      products(first: 100, after: $cursor, query: $q) {
        edges { node { id title handle status tags totalInventory metaTramos: metafield(namespace: "descuentos", key: "tramos") { value } variants(first: 5) { edges { node { sku price } } } } }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  const out = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    const r = await gql(query, { q, cursor });
    const c = r.data?.products;
    if (!c) break;
    for (const { node: n } of c.edges) {
      if (n.status !== 'ACTIVE') continue;
      const v = (n.variants?.edges || []).map((e) => e.node);
      out.push({
        id: n.id,
        id_numero: gidNumero(n.id),
        titulo: n.title,
        handle: n.handle,
        activo: n.status === 'ACTIVE',
        estado: n.status,
        tags: n.tags || [],
        meta_tramos: n.metaTramos?.value ?? null,
        stock: Number(n.totalInventory) || 0,
        sku: v.map((x) => x.sku).find(Boolean) || null,
        precio: v.length ? Number(v[0].price) : 0,
      });
    }
    if (!c.pageInfo.hasNextPage) break;
    cursor = c.pageInfo.endCursor;
  }
  return out;
}

export const tieneCambios = (p) => p.agregar.length > 0 || p.quitar.length > 0 || p.meta_cambio === true;

// Cambia solo las etiquetas y el metacampo de tramos. Devuelve un resultado por producto (nunca lanza por un producto malo).
export async function aplicarEtiquetas(gql, cambios) {
  const resultados = [];
  for (const c of cambios) {
    const r = { id_numero: c.id_numero, titulo: c.titulo, agregar: c.agregar, quitar: c.quitar, ficha: c.meta_cambio === true, ok: true, error: null };
    try {
      for (const [mutacion, tags] of [['tagsAdd', c.agregar], ['tagsRemove', c.quitar]]) {
        if (!tags.length) continue;
        const resp = await gql(`mutation($id: ID!, $tags: [String!]!) { ${mutacion}(id: $id, tags: $tags) { userErrors { message } } }`, { id: c.id, tags });
        const errs = resp.data?.[mutacion]?.userErrors || [];
        if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
      }
      if (c.meta_cambio) {
        const resp = await gql(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message } } }`, { m: [{ ownerId: c.id, namespace: 'descuentos', key: 'tramos', type: 'json', value: c.meta_deseado }] });
        const errs = resp.data?.metafieldsSet?.userErrors || [];
        if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
      }
    } catch (e) {
      r.ok = false;
      r.error = e.message;
    }
    resultados.push(r);
  }
  return resultados;
}

// Aviso de Shopify cuando cambia el stock: así las etiquetas siguen al stock sin esperar a la revisión diaria.
export async function estadoWebhook(gql, urlEsperada) {
  const r = await gql(`{ webhookSubscriptions(first: 50, topics: INVENTORY_LEVELS_UPDATE) { nodes { id endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`, {});
  const nodos = r.data?.webhookSubscriptions?.nodes || [];
  const propio = nodos.find((n) => n.endpoint?.callbackUrl === urlEsperada);
  return { registrado: Boolean(propio), id: propio?.id || null, otros: nodos.length - (propio ? 1 : 0) };
}

export async function registrarWebhook(gql, url) {
  const r = await gql(
    `mutation($u: URL!) { webhookSubscriptionCreate(topic: INVENTORY_LEVELS_UPDATE, webhookSubscription: { callbackUrl: $u, format: JSON }) { webhookSubscription { id } userErrors { message } } }`,
    { u: url },
  );
  const errs = r.data?.webhookSubscriptionCreate?.userErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
  return r.data?.webhookSubscriptionCreate?.webhookSubscription?.id || null;
}


// ---------------------------------------------------------------- Descuento por función (cobra por producto, no por el total del carro)

// Handle de la extensión de función (se define al crearla con Shopify CLI). El descuento se crea apuntando a este nombre.
export const FUNCION_HANDLE = 'descuento-volumen';
export const TITULO_DESCUENTO_FUNCION = 'Volumen por cantidad';

// Qué hay en Shopify: si la función está publicada y qué descuentos automáticos existen ("Volumen ..." nativos o por función).
export async function estadoDescuentos(gql, cfg) {
  const out = { funcion: { publicada: null, id: null, error: null }, descuentos: [], errorDescuentos: null, colecciones: [], errorColecciones: null };
  try {
    const r = await gql(`{ collections(first: 20, query: "title:Descuento volumen*") { nodes { id title productsCount { count } } } }`, {});
    out.colecciones = (r.data?.collections?.nodes || []).map((n) => ({ titulo: n.title, productos: n.productsCount?.count ?? null }));
  } catch (e) {
    out.errorColecciones = e.message;
  }
  try {
    const r = await gql(`{ shopifyFunctions(first: 50) { nodes { id title apiType } } }`, {});
    const fns = r.data?.shopifyFunctions?.nodes || [];
    const f = fns.find((x) => /volumen/i.test(x.title || '') || /descuento-volumen/i.test(x.title || ''));
    out.funcion = { publicada: Boolean(f), id: f?.id || null, titulo: f?.title || null, error: null };
  } catch (e) {
    out.funcion = { publicada: null, id: null, error: e.message };
  }
  try {
    const r = await gql(`{ automaticDiscountNodes(first: 50) { nodes { id automaticDiscount { __typename ... on DiscountAutomaticBasic { title status } ... on DiscountAutomaticApp { title status } } } } }`, {});
    const pref = cfg.prefijo_titulo.toLowerCase();
    out.descuentos = (r.data?.automaticDiscountNodes?.nodes || [])
      .map((n) => ({ id: n.id, tipo: n.automaticDiscount?.__typename === 'DiscountAutomaticApp' ? 'funcion' : 'nativo', titulo: n.automaticDiscount?.title || '', estado: n.automaticDiscount?.status || '' }))
      .filter((d) => d.titulo.toLowerCase().startsWith(pref));
  } catch (e) {
    out.errorDescuentos = e.message;
  }
  return out;
}

// Crea el descuento automático que usa la función: sin combinaciones con nada más, para que no se sume a otros descuentos.
export async function crearDescuentoFuncion(gql, titulo = TITULO_DESCUENTO_FUNCION) {
  const r = await gql(
    `mutation($d: DiscountAutomaticAppInput!) { discountAutomaticAppCreate(automaticAppDiscount: $d) { automaticAppDiscount { discountId } userErrors { field message } } }`,
    { d: { title: titulo, functionHandle: FUNCION_HANDLE, discountClasses: ['PRODUCT'], startsAt: new Date().toISOString(), combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false } } },
  );
  const errs = r.data?.discountAutomaticAppCreate?.userErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
  return r.data?.discountAutomaticAppCreate?.automaticAppDiscount?.discountId || null;
}

// ---------------------------------------------------------------- Bsale

// Costo de la última compra de cada variante, mirando las recepciones más recientes de Bsale (las más nuevas están al final de la lista).
// Sirve cuando el costo promedio viene en 0 porque el producto no tiene stock.
async function ultimosCostosCompra(idsVariante, token, base) {
  const h = { access_token: token, Accept: 'application/json' };
  const quiero = new Set(idsVariante.map(String));
  const primera = await (await fetch(`${base}/stocks/receptions.json?limit=1&offset=0`, { headers: h, signal: AbortSignal.timeout(12000) })).json();
  const total = Number(primera?.count) || 0;
  const pagina = 50, paginas = 10; // las ~500 recepciones más recientes
  const offsets = [];
  for (let off = Math.max(0, total - pagina * paginas); off < total; off += pagina) offsets.push(off);
  const respuestas = await Promise.all(offsets.map(async (off) => {
    try {
      const r = await fetch(`${base}/stocks/receptions.json?expand=details&limit=${pagina}&offset=${off}`, { headers: h, signal: AbortSignal.timeout(20000) });
      return (await r.json())?.items || [];
    } catch { return []; }
  }));
  const out = {};
  for (const rec of respuestas.flat()) {
    if (/nota de cr[eé]dito/i.test(rec.document || '')) continue; // el reverso de una compra no es un costo
    const fecha = Number(rec.admissionDate) || 0;
    for (const det of rec.details?.items || []) {
      const id = String(det.variant?.id ?? '');
      const costo = Number(det.cost);
      if (!quiero.has(id) || !(costo > 0)) continue;
      if (!out[id] || fecha >= out[id].fecha) out[id] = { costo: Math.round(costo), fecha };
    }
  }
  return out;
}

// Devuelve { costos: { SKU: { costo, origen } }, motivos: { SKU: texto } }. "motivos" explica por qué un SKU quedó sin costo.
export async function costosBsale(skus, token, base = 'https://api.bsale.io/v1') {
  const costos = {}, motivos = {}, ids = {};
  const lista = [...new Set(skus.filter(Boolean))];
  if (!token) { lista.forEach((s) => { motivos[s] = 'Falta BSALE_ACCESS_TOKEN en el servidor'; }); return { costos, motivos }; }
  const h = { access_token: token, Accept: 'application/json' };
  await Promise.all(lista.map(async (sku) => {
    try {
      const rv = await fetch(`${base}/variants.json?code=${encodeURIComponent(sku)}&limit=1`, { headers: h, signal: AbortSignal.timeout(9000) });
      const id = (await rv.json())?.items?.[0]?.id;
      if (!id) { motivos[sku] = 'Bsale no tiene una variante con este SKU'; return; }
      ids[sku] = id;
      const rc = await fetch(`${base}/variants/${id}/costs.json`, { headers: h, signal: AbortSignal.timeout(9000) });
      const prom = Number((await rc.json())?.averageCost);
      if (Number.isFinite(prom) && prom > 0) costos[sku] = { costo: Math.round(prom), origen: 'Bsale (promedio)' };
      else motivos[sku] = 'Bsale tiene costo promedio 0 (producto sin stock)';
    } catch (e) {
      motivos[sku] = 'No se pudo consultar Bsale: ' + String(e.message).slice(0, 80);
    }
  }));
  const faltan = lista.filter((s) => ids[s] && !costos[s]);
  if (faltan.length) {
    try {
      const compras = await ultimosCostosCompra(faltan.map((s) => ids[s]), token, base);
      for (const s of faltan) {
        const c = compras[String(ids[s])];
        if (c) {
          const f = c.fecha ? new Date(c.fecha * 1000).toISOString().slice(0, 10) : '';
          costos[s] = { costo: c.costo, origen: 'Bsale (última compra' + (f ? ' ' + f : '') + ')' };
          delete motivos[s];
        } else motivos[s] += ' y no aparece en las últimas recepciones';
      }
    } catch (e) {
      faltan.forEach((s) => { motivos[s] += '; tampoco se pudieron leer las recepciones'; });
    }
  }
  return { costos, motivos };
}

// ---------------------------------------------------------------- Resultados (pedidos de la tienda)

// Lee los pedidos recientes y suma lo vendido con los descuentos "Volumen ...": pedidos, unidades, descuento entregado y venta.
export async function resultadosPedidos(gql, cfg, dias) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  const query = `
    query($q: String!, $cursor: String) {
      orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {
        edges { node {
          id createdAt
          lineItems(first: 50) { edges { node {
            quantity sku
            originalTotalSet { shopMoney { amount } }
            discountAllocations { allocatedAmountSet { shopMoney { amount } } discountApplication { ... on AutomaticDiscountApplication { title } ... on DiscountCodeApplication { code } } }
          } } }
        } }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  const pref = cfg.prefijo_titulo.toLowerCase();
  const porTramo = {};
  const pedidos = new Set();
  const dias_con = {};
  let pedidosTotal = 0, cursor = null, truncado = false;
  for (let i = 0; i < 15; i++) {
    const r = await gql(query, { q: `created_at:>=${desde}`, cursor });
    const c = r.data?.orders;
    if (!c) break;
    for (const { node: o } of c.edges) {
      pedidosTotal++;
      for (const { node: li } of o.lineItems.edges) {
        for (const a of li.discountAllocations || []) {
          const titulo = a.discountApplication?.title;
          if (!titulo || !titulo.toLowerCase().startsWith(pref)) continue;
          const bruto = Number(li.originalTotalSet?.shopMoney?.amount) || 0;
          const pct = bruto > 0 ? Math.round(((Number(a.allocatedAmountSet?.shopMoney?.amount) || 0) / bruto) * 100) : null;
          const tramoCfg = pct == null ? null : cfg.tramos.find((x) => Math.abs(x.porcentaje - pct) <= 1);
          const etiqueta = tramoCfg ? `${cfg.prefijo_titulo} ${tramoCfg.cantidad}+ (${tramoCfg.porcentaje}%)` : titulo;
          const t = (porTramo[etiqueta] ||= { titulo: etiqueta, pedidos: new Set(), unidades: 0, descuento: 0, venta_bruta: 0 });
          t.pedidos.add(o.id);
          t.unidades += Number(li.quantity) || 0;
          t.descuento += Number(a.allocatedAmountSet?.shopMoney?.amount) || 0;
          t.venta_bruta += Number(li.originalTotalSet?.shopMoney?.amount) || 0;
          pedidos.add(o.id);
          const dia = o.createdAt.slice(0, 10);
          dias_con[dia] = (dias_con[dia] || 0) + (Number(li.quantity) || 0);
        }
      }
    }
    if (!c.pageInfo.hasNextPage) break;
    if (i === 14) truncado = true;
    cursor = c.pageInfo.endCursor;
  }
  const tramos = Object.values(porTramo).map((t) => ({ titulo: t.titulo, pedidos: t.pedidos.size, unidades: t.unidades, descuento: Math.round(t.descuento), venta_bruta: Math.round(t.venta_bruta) }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
  const sum = (k) => tramos.reduce((s, t) => s + t[k], 0);
  return {
    desde, dias,
    pedidos_tienda: pedidosTotal,
    pedidos_con_descuento: pedidos.size,
    unidades: sum('unidades'),
    descuento: sum('descuento'),
    venta_bruta: sum('venta_bruta'),
    venta_neta: sum('venta_bruta') - sum('descuento'),
    porTramo: tramos,
    porDia: Object.entries(dias_con).sort().map(([dia, unidades]) => ({ dia, unidades })),
    truncado,
  };
}

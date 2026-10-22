// Orden de las colecciones de Shopify por stock: primero los productos con más stock, al final los agotados.
// Shopify no trae esa opción de orden, así que se deja cada colección en orden MANUAL y se reordena desde aquí (cron + botón).
// Lógica pura (sin red) + un ejecutor que habla con la Admin API por GraphQL (gql(query, variables) -> respuesta).

// Colecciones técnicas de apps (índices de búsqueda/filtros): no se tocan.
export const COLECCIONES_EXCLUIDAS = ['cloud-search-all-products', 'globofilter-best-selling-products-index', 'all'];
export const MAX_MOVIMIENTOS = 250; // tope de Shopify por llamada a collectionReorderProducts

// Grupo 0: con stock (de mayor a menor). Grupo 1: sin inventario controlado (servicios, etc.), disponible pero sin cantidad. Grupo 2: agotados.
export function claveOrden(p) {
  const rastrea = p.rastrea !== false;
  const stock = Number(p.stock) || 0;
  if (!rastrea) return { grupo: 1, stock: 0 };
  if (stock > 0) return { grupo: 0, stock };
  return { grupo: 2, stock: 0 };
}

// productos: [{ id, stock, rastrea }] en el orden previo (sirve de desempate: a igual stock se respeta el orden que ya tenía la colección).
export function ordenObjetivo(productos) {
  return productos
    .map((p, i) => ({ id: p.id, i, ...claveOrden(p) }))
    .sort((a, b) => a.grupo - b.grupo || b.stock - a.stock || a.i - b.i)
    .map(p => p.id);
}

// Movimientos para pasar del orden actual al objetivo (cada uno se aplica en secuencia sobre el resultado del anterior).
// Se recorre el objetivo de principio a fin: si la posición i no tiene el producto que corresponde, se trae ese producto a i.
export function calcularMovimientos(actual, objetivo) {
  const arr = actual.slice();
  const movs = [];
  for (let i = 0; i < objetivo.length; i++) {
    if (arr[i] === objetivo[i]) continue;
    const j = arr.indexOf(objetivo[i], i + 1);
    if (j < 0) continue; // el producto ya no está en la colección
    arr.splice(j, 1); arr.splice(i, 0, objetivo[i]);
    movs.push({ id: objetivo[i], newPosition: String(i) });
  }
  return movs;
}

// Aplica los movimientos como los aplica Shopify (para comprobar el resultado en pruebas).
export function aplicarMovimientos(actual, movs) {
  const arr = actual.slice();
  for (const m of movs) {
    const j = arr.indexOf(m.id); if (j < 0) continue;
    arr.splice(j, 1); arr.splice(Math.min(Number(m.newPosition), arr.length), 0, m.id);
  }
  return arr;
}

const Q_COLECCIONES = `query($after: String) { collections(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id title handle sortOrder productsCount { count } } } }`;
const Q_PRODUCTOS = `query($id: ID!, $after: String) { collection(id: $id) { products(first: 250, after: $after, sortKey: COLLECTION_DEFAULT) { pageInfo { hasNextPage endCursor } nodes { id totalInventory tracksInventory } } } }`;
const M_MANUAL = `mutation($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id sortOrder } userErrors { field message } } }`;
const M_REORDENAR = `mutation($id: ID!, $moves: [MoveInput!]!) { collectionReorderProducts(id: $id, moves: $moves) { job { id done } userErrors { field message } } }`;
const Q_JOB = `query($id: ID!) { job(id: $id) { id done } }`;

export async function listarColecciones(gql) {
  const out = []; let after = null;
  for (let n = 0; n < 10; n++) {
    const r = await gql(Q_COLECCIONES, { after });
    const c = r && r.data && r.data.collections; if (!c) throw new Error('Shopify no devolvió las colecciones');
    out.push(...c.nodes);
    if (!c.pageInfo.hasNextPage) break; after = c.pageInfo.endCursor;
  }
  return out.filter(c => !COLECCIONES_EXCLUIDAS.includes(c.handle));
}

export async function leerProductos(gql, id) {
  const out = []; let after = null;
  for (let n = 0; n < 60; n++) {
    const r = await gql(Q_PRODUCTOS, { id, after });
    const p = r && r.data && r.data.collection && r.data.collection.products; if (!p) throw new Error('Shopify no devolvió los productos de la colección');
    out.push(...p.nodes.map(x => ({ id: x.id, stock: x.totalInventory, rastrea: x.tracksInventory })));
    if (!p.pageInfo.hasNextPage) break; after = p.pageInfo.endCursor;
  }
  return out;
}

async function esperarJob(gql, id, hasta) {
  while (Date.now() < hasta) {
    const r = await gql(Q_JOB, { id });
    if (r && r.data && r.data.job && r.data.job.done) return true;
    await new Promise(res => setTimeout(res, 700));
  }
  return false;
}

// Ordena UNA colección. opciones: { aplicar, hasta } (hasta = hora límite en ms; si se acaba, deja lo avanzado para la próxima vuelta).
// Devuelve { handle, productos, movimientos, hechos, completa, cambioOrden, error? }.
export async function ordenarColeccion(gql, col, { aplicar = true, hasta = Infinity } = {}) {
  const res = { handle: col.handle, productos: 0, movimientos: 0, hechos: 0, completa: true, cambioOrden: false };
  const previo = await leerProductos(gql, col.id); // con el orden que tenía: sirve de desempate
  res.productos = previo.length;
  if (!previo.length) return res;
  const objetivo = ordenObjetivo(previo);
  if (col.sortOrder !== 'MANUAL') {
    res.cambioOrden = true;
    if (!aplicar) { res.movimientos = calcularMovimientos(previo.map(p => p.id), objetivo).length; return res; }
    const u = await gql(M_MANUAL, { input: { id: col.id, sortOrder: 'MANUAL' } });
    const errs = u && u.data && u.data.collectionUpdate && u.data.collectionUpdate.userErrors;
    if (!u || !u.data || (errs && errs.length)) throw new Error('No pude dejar la colección en orden manual: ' + JSON.stringify(errs || u).slice(0, 200));
  }
  const actual = col.sortOrder === 'MANUAL' ? previo.map(p => p.id) : (await leerProductos(gql, col.id)).map(p => p.id);
  const movs = calcularMovimientos(actual, objetivo);
  res.movimientos = movs.length;
  if (!aplicar) return res;
  for (let i = 0; i < movs.length; i += MAX_MOVIMIENTOS) {
    if (Date.now() > hasta) { res.completa = false; break; }
    const lote = movs.slice(i, i + MAX_MOVIMIENTOS);
    const r = await gql(M_REORDENAR, { id: col.id, moves: lote });
    const d = r && r.data && r.data.collectionReorderProducts;
    if (!d || (d.userErrors && d.userErrors.length)) throw new Error('Shopify rechazó el reordenamiento: ' + JSON.stringify((d && d.userErrors) || r).slice(0, 200));
    if (d.job && !d.job.done && !(await esperarJob(gql, d.job.id, hasta))) { res.hechos += lote.length; res.completa = false; break; }
    res.hechos += lote.length;
  }
  if (res.hechos < res.movimientos) res.completa = false;
  return res;
}

// Recorre las colecciones (las que hace más tiempo no se revisan primero) hasta que se acaba el tiempo. "estado" = { handle: ultimaRevisionMs }.
export async function ordenarColecciones(gql, { aplicar = true, presupuestoMs = 45000, estado = {}, soloHandle = null } = {}) {
  const hasta = Date.now() + presupuestoMs;
  let cols = await listarColecciones(gql);
  if (soloHandle) cols = cols.filter(c => c.handle === soloHandle);
  cols.sort((a, b) => (estado[a.handle] || 0) - (estado[b.handle] || 0));
  const resultados = [];
  for (const c of cols) {
    if (Date.now() > hasta) break;
    try {
      const r = await ordenarColeccion(gql, c, { aplicar, hasta });
      resultados.push(r);
    } catch (e) { resultados.push({ handle: c.handle, error: String(e && e.message || e) }); }
  }
  return { resultados, pendientes: cols.length - resultados.length, total: cols.length };
}

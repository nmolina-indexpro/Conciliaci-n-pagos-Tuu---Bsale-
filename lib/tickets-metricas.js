// /lib/tickets-metricas.js
// Métricas del módulo de Tickets y la vista Cliente 360. Las consultas a Shopify y Bsale llegan inyectadas (`gql`, `bsaleGet`): sin red acá.

import { TIPOS, ESTADOS, ORIGENES, ORIGEN_ETIQUETA, TIPO_ETIQUETA, asegurarTablasTickets, ultimos9, normalizarRut, normalizarEmail } from './tickets.js';

const TZ = 'America/Santiago';
const SQL_RANGO = (col, a, b) => `${col} >= (${a}::date)::timestamp AT TIME ZONE '${TZ}' AND ${col} < ((${b}::date + 1))::timestamp AT TIME ZONE '${TZ}'`;
const fechaOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const cierra = (tipo, estado) => !!(ESTADOS[tipo] || []).find((e) => e.clave === estado)?.cierra;
const sinResolucion = (tipo, estado) => !!(ESTADOS[tipo] || []).find((e) => e.clave === estado)?.sinResolucion;
const redondeo = (n, d = 0) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 10 ** d) / 10 ** d);

// Fecha de hoy en Chile, YYYY-MM-DD (y desplazada n días).
export function fechaChile(dias = 0, ahora = Date.now()) {
  return new Date(ahora + dias * 86400000).toLocaleDateString('en-CA', { timeZone: TZ });
}

// ---------------- Conversión de lead a pedido ----------------
// Un lead "convierte" si el mismo correo o teléfono hizo un pedido en Shopify dentro de los 7 días siguientes al lead.
export const DIAS_CONVERSION = 7;
const PEDIDOS_POR_PAGINA = 250, PAGINAS_MAX = 10;
export async function pedidosEnRango(gql, desdeISO, hastaISO) {
  const pedidos = []; let after = null, truncado = false;
  for (let pagina = 0; pagina < PAGINAS_MAX; pagina++) {
    const r = await gql(
      `query($q: String!, $after: String) { orders(first: ${PEDIDOS_POR_PAGINA}, query: $q, after: $after) { pageInfo { hasNextPage endCursor } nodes { id name createdAt email phone shippingAddress { phone } } } }`,
      { q: `created_at:>='${desdeISO}' created_at:<'${hastaISO}'`, after });
    const con = r?.data?.orders;
    if (!con) throw new Error('Shopify no devolvió pedidos');
    for (const o of con.nodes) pedidos.push({ id: o.id, nombre: o.name, creado: new Date(o.createdAt).getTime(), email: normalizarEmail(o.email), tels: [o.phone, o.shippingAddress?.phone].map(ultimos9).filter((x) => x.length >= 8) });
    if (!con.pageInfo?.hasNextPage) break;
    after = con.pageInfo.endCursor;
    if (pagina === PAGINAS_MAX - 1) truncado = true;
  }
  return { pedidos, truncado };
}
export function cruzarLeadsConPedidos(leads, pedidos, dias = DIAS_CONVERSION) {
  const porEmail = new Map(), porTel = new Map();
  for (const p of pedidos) {
    if (p.email) (porEmail.get(p.email) || porEmail.set(p.email, []).get(p.email)).push(p);
    for (const t of p.tels) (porTel.get(t) || porTel.set(t, []).get(t)).push(p);
  }
  const resultado = {};
  for (const l of leads) {
    const ini = new Date(l.creado_en).getTime(), fin = ini + dias * 86400000;
    const cand = [...(l.email ? porEmail.get(l.email) || [] : []), ...(l.telefono9 ? porTel.get(l.telefono9) || [] : [])];
    const convierte = cand.some((p) => p.creado > ini && p.creado <= fin);
    const o = (resultado[l.origen] ||= { leads: 0, convertidos: 0 });
    o.leads++; if (convierte) o.convertidos++;
  }
  return resultado;
}

// ---------------- Métricas ----------------
export async function calcularMetricas(sql, { desde, hasta, gql = null, ahora = Date.now() } = {}) {
  await asegurarTablasTickets(sql);
  if (!fechaOk(hasta)) hasta = fechaChile(0, ahora);
  if (!fechaOk(desde)) desde = fechaChile(-29, ahora);
  const rango = SQL_RANGO('t.creado_en', '$1', '$2');
  const p = [desde, hasta];

  const { rows: grupos } = await sql.query(`SELECT t.tipo, t.origen, t.estado, count(*)::int AS n FROM tickets t WHERE ${rango} GROUP BY 1, 2, 3`, p);
  const porTipo = {}, porOrigen = {};
  for (const tipo of TIPOS) porTipo[tipo] = { tipo, etiqueta: TIPO_ETIQUETA[tipo], total: 0, abiertos: 0, resueltos: 0, sinResolucion: 0 };
  for (const g of grupos) {
    const t = porTipo[g.tipo]; if (!t) continue;
    t.total += g.n;
    if (!cierra(g.tipo, g.estado)) t.abiertos += g.n; else if (sinResolucion(g.tipo, g.estado)) t.sinResolucion += g.n; else t.resueltos += g.n;
    const o = (porOrigen[g.origen] ||= { origen: g.origen, etiqueta: ORIGEN_ETIQUETA[g.origen] || g.origen, total: 0, porTipo: {} });
    o.total += g.n; o.porTipo[g.tipo] = (o.porTipo[g.tipo] || 0) + g.n;
  }

  // Tiempo de cierre (solo tickets resueltos: lo que cierra "sin resolución" se cuenta aparte)
  const pares = []; for (const tipo of TIPOS) for (const e of ESTADOS[tipo]) if (e.cierra && e.sinResolucion) pares.push([tipo, e.clave]);
  const pp = p.slice(); const exclu = pares.map(([tp, es]) => { pp.push(tp, es); return `(t.tipo = $${pp.length - 1} AND t.estado = $${pp.length})`; }).join(' OR ');
  const { rows: cierres } = await sql.query(
    `SELECT t.tipo, count(*)::int AS n, avg(extract(epoch FROM (t.cerrado_en - t.creado_en))) AS prom_s,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (t.cerrado_en - t.creado_en))) AS mediana_s
     FROM tickets t WHERE ${rango} AND t.cerrado_en IS NOT NULL ${exclu ? `AND NOT (${exclu})` : ''} GROUP BY t.tipo`, pp);
  for (const c of cierres) if (porTipo[c.tipo]) Object.assign(porTipo[c.tipo], { cierre_prom_h: redondeo(c.prom_s / 3600, 1), cierre_mediana_h: redondeo(c.mediana_s / 3600, 1) });

  // Primer contacto con el cliente en los leads
  const { rows: pc } = await sql.query(
    `SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY d) AS mediana_s FROM (
       SELECT extract(epoch FROM (min(e.creado_en) - t.creado_en)) AS d FROM tickets t JOIN tk_eventos e ON e.ticket_id = t.id AND e.tipo = 'contacto_cliente'
       WHERE t.tipo = 'lead' AND ${rango} GROUP BY t.id, t.creado_en) x`, p);
  const primerContacto = { leads_contactados: pc[0].n, mediana_min: pc[0].mediana_s == null ? null : redondeo(Math.max(0, pc[0].mediana_s) / 60, 0) };

  // Tasa de abandono en postventa: abandonados / (cerrados + abandonados)
  const pv = (grupos.filter((g) => g.tipo === 'postventa'));
  const ab = pv.filter((g) => g.estado === 'abandonado').reduce((s, g) => s + g.n, 0), ce = pv.filter((g) => g.estado === 'cerrado').reduce((s, g) => s + g.n, 0);
  const tasaAbandono = { abandonados: ab, cerrados: ce, tasa: ab + ce ? redondeo((ab / (ab + ce)) * 100, 1) : null };

  // Carga por agente: lo abierto hoy (sin importar el rango) y lo cerrado dentro del rango
  const pa = [desde, hasta];
  const { rows: carga } = await sql.query(
    `SELECT t.agente_id, COALESCE(NULLIF(u.nombre, ''), u.email) AS nombre,
            count(*) FILTER (WHERE t.cerrado_en IS NULL)::int AS abiertos,
            count(*) FILTER (WHERE t.cerrado_en IS NULL AND t.ultimo_movimiento_en < now() - interval '24 hours')::int AS sin_movimiento,
            count(*) FILTER (WHERE ${SQL_RANGO('t.cerrado_en', '$1', '$2')})::int AS cerrados
     FROM tickets t LEFT JOIN usuarios u ON u.id = t.agente_id
     WHERE t.cerrado_en IS NULL OR ${SQL_RANGO('t.cerrado_en', '$1', '$2')} GROUP BY 1, 2 ORDER BY abiertos DESC, cerrados DESC`, pa);
  const cargaPorAgente = carga.map((c) => ({ agente_id: c.agente_id, nombre: c.nombre || 'Sin asignar', abiertos: c.abiertos, sin_movimiento: c.sin_movimiento, cerrados: c.cerrados }));

  // Conversión de lead a pedido (consulta a Shopify)
  let conversion = { disponible: false };
  if (gql) {
    try {
      const { rows: leads } = await sql.query(
        `SELECT t.origen, t.creado_en, c.email, c.telefono9 FROM tickets t JOIN tk_clientes c ON c.id = t.cliente_id
         WHERE t.tipo = 'lead' AND ${rango} AND (c.email IS NOT NULL OR COALESCE(c.telefono9, '') <> '')`, p);
      const ini = new Date(`${desde}T00:00:00-03:00`).toISOString(), fin = new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + (DIAS_CONVERSION + 1) * 86400000).toISOString();
      const { pedidos, truncado } = await pedidosEnRango(gql, ini, fin);
      const r = cruzarLeadsConPedidos(leads, pedidos);
      const filas = Object.entries(r).map(([origen, v]) => ({ origen, etiqueta: ORIGEN_ETIQUETA[origen] || origen, ...v, tasa: v.leads ? redondeo((v.convertidos / v.leads) * 100, 1) : null })).sort((a, b) => b.leads - a.leads);
      const tl = filas.reduce((s, f) => s + f.leads, 0), tc = filas.reduce((s, f) => s + f.convertidos, 0);
      conversion = { disponible: true, dias: DIAS_CONVERSION, leads: tl, convertidos: tc, tasa: tl ? redondeo((tc / tl) * 100, 1) : null, porOrigen: filas, pedidos_revisados: pedidos.length, truncado };
    } catch (e) { conversion = { disponible: false, error: String(e.message || e).slice(0, 200) }; }
  }

  return {
    desde, hasta, total: Object.values(porTipo).reduce((s, t) => s + t.total, 0),
    porTipo: Object.values(porTipo), porOrigen: Object.values(porOrigen).sort((a, b) => b.total - a.total),
    primerContacto, tasaAbandono, cargaPorAgente, conversion,
  };
}

// ---------------- Cliente 360 ----------------
const CAMPOS_PEDIDO = 'id name createdAt displayFinancialStatus displayFulfillmentStatus cancelledAt currentTotalPriceSet { shopMoney { amount } }';
const mapPedido = (o) => ({ id: String(o.id).replace(/^gid:\/\/shopify\/Order\//, ''), nombre: o.name, creado_en: o.createdAt, pago: o.displayFinancialStatus || null, despacho: o.displayFulfillmentStatus || null, cancelado: !!o.cancelledAt, total: Number(o.currentTotalPriceSet?.shopMoney?.amount) || null });

export async function pedidosDelCliente(gql, { email, shopifyIds = [] }) {
  const vistos = new Map();
  if (email) {
    const r = await gql(`query($q: String!) { orders(first: 20, query: $q) { nodes { ${CAMPOS_PEDIDO} } } }`, { q: `email:${email}` });
    for (const o of r?.data?.orders?.nodes || []) vistos.set(String(o.id), mapPedido(o));
  }
  const ids = shopifyIds.filter(Boolean).map((i) => 'gid://shopify/Order/' + i).slice(0, 20);
  if (ids.length) {
    const r = await gql(`query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { ${CAMPOS_PEDIDO} } } }`, { ids });
    for (const o of r?.data?.nodes || []) if (o && o.id) vistos.set(String(o.id), mapPedido(o));
  }
  return [...vistos.values()].sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en));
}

export async function documentosDelCliente(bsaleGet, cliente, { ahora = Date.now() } = {}) {
  let clienteId = cliente.bsale_client_id || null;
  const buscar = async (ruta) => (await bsaleGet(ruta))?.items?.[0]?.id || null;
  if (!clienteId && cliente.rut) clienteId = await buscar(`/clients.json?code=${encodeURIComponent(cliente.rut)}&limit=1`);
  if (!clienteId && cliente.email) clienteId = await buscar(`/clients.json?email=${encodeURIComponent(cliente.email)}&limit=1`);
  if (!clienteId) return { clienteId: null, documentos: [] };
  // Sin rango de fechas Bsale no devuelve los documentos en orden cronológico: se pide el último año.
  const fin = Math.floor(ahora / 1000), ini = fin - 365 * 86400;
  const r = await bsaleGet(`/documents.json?clientid=${clienteId}&emissiondaterange=[${ini},${fin}]&expand=[document_type]&limit=50`);
  const docs = (r?.items || []).map((d) => ({
    id: String(d.id), numero: String(d.number), tipo: d.document_type?.name || 'Documento', fecha: d.emissionDate ? new Date(Number(d.emissionDate) * 1000).toISOString().slice(0, 10) : null,
    total: Math.round(Number(d.totalAmount) || 0) || null, anulado: d.state != null && Number(d.state) !== 0, url: d.urlPublicView || d.urlPdf || null,
    esNotaCredito: /CR[EÉ]DITO/i.test(d.document_type?.name || ''),
  })).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return { clienteId: String(clienteId), documentos: docs.slice(0, 20) };
}

export async function cliente360(sql, clienteId, { gql = null, bsaleGet = null } = {}) {
  await asegurarTablasTickets(sql);
  const { rows } = await sql.query('SELECT * FROM tk_clientes WHERE id = $1', [clienteId]);
  const cliente = rows[0];
  if (!cliente) return { error: 'Cliente no encontrado', status: 404 };
  const { rows: tickets } = await sql.query(
    `SELECT t.id, t.numero, t.tipo, t.estado, t.asunto, t.origen, t.creado_en, t.cerrado_en, os.numero_os, p.numero_pedido, p.nota_credito_numero, p.shopify_order_id
     FROM tickets t LEFT JOIN tk_ordenes_servicio os ON os.ticket_id = t.id LEFT JOIN tk_postventa p ON p.ticket_id = t.id WHERE t.cliente_id = $1 ORDER BY t.creado_en DESC LIMIT 100`, [clienteId]);
  const ficha = { cliente, tickets: tickets.map((t) => ({ ...t, cerrado: cierra(t.tipo, t.estado) })), pedidos: [], documentos: [], errores: {} };
  if (gql) {
    try { ficha.pedidos = await pedidosDelCliente(gql, { email: cliente.email, shopifyIds: tickets.map((t) => t.shopify_order_id) }); }
    catch (e) { ficha.errores.shopify = String(e.message || e).slice(0, 150); }
  } else ficha.errores.shopify = 'Shopify no está configurado en el servidor';
  if (bsaleGet) {
    try { const d = await documentosDelCliente(bsaleGet, cliente); ficha.documentos = d.documentos; ficha.bsale_client_id = d.clienteId; }
    catch (e) { ficha.errores.bsale = String(e.message || e).slice(0, 150); }
  } else ficha.errores.bsale = 'Bsale no está configurado en el servidor';
  if (!cliente.email) ficha.avisos = ['Sin correo en la ficha: los pedidos de Shopify solo se encuentran si algún ticket los tiene enlazados.'];
  return ficha;
}

// Manejador del recurso `tickets-metricas` (sesión): GET ?desde=&hasta=[&sin_conversion=1] -> métricas; GET ?cliente=ID -> Cliente 360.
export async function manejarTicketsMetricas(req, res, sesion, { getSql, gql, bsaleGet }) {
  try {
    const sql = await getSql();
    const g = async () => { try { return gql ? await gql() : null; } catch { return null; } };
    if (req.query.cliente !== undefined) {
      const id = Number(req.query.cliente);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Cliente no válido' });
      const f = await cliente360(sql, id, { gql: await g(), bsaleGet });
      if (f.error) return res.status(f.status || 400).json({ error: f.error });
      return res.status(200).json({ ficha: f });
    }
    const m = await calcularMetricas(sql, { desde: req.query.desde, hasta: req.query.hasta, gql: req.query.sin_conversion ? null : await g() });
    return res.status(200).json({ metricas: m });
  } catch (err) {
    return res.status(200).json({ error: 'Error en las métricas de tickets', detail: String(err.message || err).slice(0, 300) });
  }
}

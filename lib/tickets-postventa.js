// /lib/tickets-postventa.js
// Ficha de postventa: datos del pedido en Shopify (productos, estado de despacho, seguimiento), documentos de Bsale (boleta, factura, nota de venta)
// y registro de la nota de crédito. Las consultas a Shopify y a Bsale llegan inyectadas (`gql`, `bsaleGet`): sin red acá, para poder probarlo.
//
// OJO: la EMISIÓN de una nota de crédito en Bsale NO está acá. Es un documento tributario irreversible (se declara al SII) y el ERP hoy solo emite
// nota de venta, boleta y factura con un interruptor y confirmación escrita (ver manejarBsaleEmitir). Acá la NC se emite en Bsale y se REGISTRA en el ticket.

import { registrarEvento, asegurarTablasTickets } from './tickets.js';

const RE_ETIQUETA_DOC = /^(BO|FA|NV)-(\d+)$/i;
const NOMBRE_PREFIJO = { BO: 'Boleta', FA: 'Factura', NV: 'Nota de venta' };

const CONSULTA_PEDIDO = `
  fragment CamposPedido on Order {
    id name createdAt tags cancelledAt displayFinancialStatus displayFulfillmentStatus
    currentTotalPriceSet { shopMoney { amount } }
    shippingAddress { name city province phone }
    lineItems(first: 20) { nodes { title sku quantity } }
    fulfillments(first: 5) { status displayStatus createdAt deliveredAt trackingInfo { number url company } }
  }`;

export async function pedidoDeShopify(gql, { shopifyOrderId, numero }) {
  let nodo = null;
  if (shopifyOrderId) {
    const r = await gql(`${CONSULTA_PEDIDO} query($id: ID!) { node(id: $id) { ... on Order { ...CamposPedido } } }`, { id: 'gid://shopify/Order/' + shopifyOrderId });
    nodo = r?.data?.node?.name ? r.data.node : null;
  }
  if (!nodo && numero) {
    const n = String(numero).replace(/^#/, '');
    const r = await gql(`${CONSULTA_PEDIDO} query($q: String!) { orders(first: 1, query: $q) { nodes { ...CamposPedido } } }`, { q: `name:${n}` });
    nodo = r?.data?.orders?.nodes?.[0] || null;
    // El N° que escribe el cliente (o que traía Zoho) puede ser el de la boleta o factura: las etiquetas BO-/FA-/NV- del pedido lo guardan.
    if (!nodo && /^[0-9]{3,9}$/.test(n)) {
      const r2 = await gql(`${CONSULTA_PEDIDO} query($q: String!) { orders(first: 1, query: $q) { nodes { ...CamposPedido } } }`, { q: `tag:BO-${n} OR tag:FA-${n} OR tag:NV-${n}` });
      nodo = r2?.data?.orders?.nodes?.[0] || null;
    }
  }
  if (!nodo) return null;
  const tags = nodo.tags || [];
  return {
    shopify_order_id: String(nodo.id).replace(/^gid:\/\/shopify\/Order\//, ''), nombre: nodo.name, creado_en: nodo.createdAt, cancelado: !!nodo.cancelledAt,
    estado_pago: nodo.displayFinancialStatus || null, estado_despacho: nodo.displayFulfillmentStatus || null,
    total: Number(nodo.currentTotalPriceSet?.shopMoney?.amount) || null,
    envio_a: nodo.shippingAddress ? [nodo.shippingAddress.name, nodo.shippingAddress.city].filter(Boolean).join(' · ') : null,
    productos: (nodo.lineItems?.nodes || []).map((i) => ({ titulo: i.title, sku: i.sku || null, cantidad: i.quantity })),
    envios: (nodo.fulfillments || []).map((f) => ({ estado: f.displayStatus || f.status, creado_en: f.createdAt, entregado_en: f.deliveredAt || null,
      seguimiento: (f.trackingInfo || []).map((t) => ({ numero: t.number || null, url: t.url || null, empresa: t.company || null })) })),
    etiquetas_documento: tags.map((t) => RE_ETIQUETA_DOC.exec(String(t).trim())).filter(Boolean).map((m) => ({ prefijo: m[1].toUpperCase(), numero: m[2] })),
  };
}

// Busca en Bsale un documento por número. `prefijo` (BO / FA / NV) acota el tipo; sin prefijo se acepta cualquiera que no sea nota de crédito.
export async function documentoDeBsale(bsaleGet, numero, prefijo = null) {
  const r = await bsaleGet(`/documents.json?number=${encodeURIComponent(numero)}&expand=[document_type,client]&limit=10`);
  const candidatos = (r?.items || []).filter((d) => {
    const tipo = String(d.document_type?.name || '').toUpperCase();
    if (/CR[EÉ]DITO/.test(tipo)) return false;
    if (prefijo === 'BO') return /BOLETA/.test(tipo);
    if (prefijo === 'FA') return /FACTURA/.test(tipo);
    if (prefijo === 'NV') return /NOTA.*VENTA/.test(tipo);
    return true;
  });
  const d = candidatos[0];
  if (!d) return null;
  return {
    id: String(d.id), numero: String(d.number), tipo: d.document_type?.name || (prefijo ? NOMBRE_PREFIJO[prefijo] : 'Documento'),
    fecha: d.emissionDate ? new Date(Number(d.emissionDate) * 1000).toISOString().slice(0, 10) : null,
    total: Math.round(Number(d.totalAmount) || 0) || null, anulado: d.state != null && Number(d.state) !== 0, url: d.urlPublicView || d.urlPdf || null,
    cliente_email: String(d.client?.email || '').toLowerCase() || null, cliente_rut: String(d.client?.code || '').replace(/[^0-9kK]/g, '').toUpperCase() || null,
  };
}
// ¿El documento es de este cliente? Por correo o por RUT (el RUT del cliente de Bsale viene como "código").
function documentoEsDelCliente(doc, cliente) {
  if (!doc || !cliente) return false;
  const rut = String(cliente.rut || '').replace(/[^0-9kK]/g, '').toUpperCase();
  return !!((doc.cliente_email && cliente.email && doc.cliente_email === String(cliente.email).toLowerCase()) || (doc.cliente_rut && rut && doc.cliente_rut === rut));
}

// Reúne todo lo que se sabe del pedido de un ticket de postventa. Completa en el ticket el id del pedido y el N° de documento si estaban vacíos.
// Cada fuente falla por separado: si Shopify o Bsale no responden, se informa el error de esa parte y se muestra lo demás.
export async function fichaPostventa(sql, ticketId, { gql, bsaleGet }) {
  const { rows } = await sql.query('SELECT * FROM tk_postventa WHERE ticket_id = $1', [ticketId]);
  const pv = rows[0];
  if (!pv) return { error: 'El ticket no es de postventa', status: 400 };
  const ficha = { numero_pedido: pv.numero_pedido, nota_credito_numero: pv.nota_credito_numero, pedido: null, documentos: [], errores: {} };
  if (!pv.numero_pedido && !pv.shopify_order_id && !pv.numero_documento) return { ...ficha, sinPedido: true };

  if (gql) {
    try { ficha.pedido = await pedidoDeShopify(gql, { shopifyOrderId: pv.shopify_order_id, numero: pv.numero_pedido || pv.numero_documento }); }
    catch (e) { ficha.errores.shopify = String(e.message || e).slice(0, 150); }
  } else ficha.errores.shopify = 'Shopify no está configurado en el servidor';

  const candidatos = [];
  for (const e of ficha.pedido?.etiquetas_documento || []) candidatos.push({ prefijo: e.prefijo, numero: e.numero });
  // El campo de Zoho "Número Pedido, Boleta o Factura" casi siempre trae el N° de la BOLETA o factura (los pedidos de Shopify se llaman #10269; las boletas, 45678), y a
  // menudo la venta fue en tienda y no existe en Shopify. Ese N° se busca en Bsale pero solo se da por bueno si el cliente del documento coincide (correo o RUT) con el del
  // ticket; si no, se muestra como "Sin confirmar" (un documento con ese número podría ser de otro cliente).
  const { rows: cli } = await sql.query('SELECT c.email, c.rut FROM tickets t JOIN tk_clientes c ON c.id = t.cliente_id WHERE t.id = $1', [ticketId]);
  const cliente = cli[0] || null;
  for (const num of [pv.numero_documento, ficha.pedido ? null : pv.numero_pedido]) {
    if (num && !candidatos.some((c) => c.numero === num)) candidatos.push({ prefijo: null, numero: num, sinConfirmar: true, porTexto: true });
  }
  if (bsaleGet) {
    const vistos = new Set();
    for (const c of candidatos.slice(0, 4)) {
      try {
        const d = await documentoDeBsale(bsaleGet, c.numero, c.prefijo);
        if (d && vistos.has(d.id)) continue;
        if (d) { vistos.add(d.id); const delCliente = c.porTexto && documentoEsDelCliente(d, cliente); ficha.documentos.push({ ...d, cliente_email: undefined, cliente_rut: undefined, sinConfirmar: !!c.sinConfirmar && !delCliente, coincideCliente: delCliente || undefined }); }
        else if (!c.porTexto) ficha.documentos.push({ numero: c.numero, tipo: c.prefijo ? NOMBRE_PREFIJO[c.prefijo] : 'Documento', noEncontrado: true });
      } catch (e) { ficha.errores.bsale = String(e.message || e).slice(0, 150); break; }
    }
  } else if (candidatos.length) ficha.errores.bsale = 'Bsale no está configurado en el servidor';

  // Completar lo que faltaba en el ticket (solo con documentos confirmados por las etiquetas del pedido)
  const confirmados = ficha.documentos.filter((d) => d.id && !d.anulado && !d.sinConfirmar); // por etiqueta del pedido o porque el cliente del documento coincide
  const doc = confirmados.find((d) => /BOLETA|FACTURA/i.test(d.tipo || '')) || confirmados[0];
  const sets = []; const vals = [ticketId];
  if (ficha.pedido && !pv.shopify_order_id) { vals.push(ficha.pedido.shopify_order_id); sets.push(`shopify_order_id = $${vals.length}`); }
  if (ficha.pedido && !pv.numero_pedido) { vals.push(String(ficha.pedido.nombre).replace(/^#/, '')); sets.push(`numero_pedido = $${vals.length}`); }
  if (doc && !pv.bsale_document_id) { vals.push(doc.id); sets.push(`bsale_document_id = $${vals.length}`); }
  if (doc && !pv.numero_documento) { vals.push(doc.numero); sets.push(`numero_documento = $${vals.length}`); }
  if (sets.length) await sql.query(`UPDATE tk_postventa SET ${sets.join(', ')} WHERE ticket_id = $1`, vals);
  return ficha;
}

// Registra en el ticket la nota de crédito ya emitida en Bsale. Se busca en Bsale para confirmar que existe; si Bsale no responde, se guarda igual y se avisa.
export async function registrarNotaCredito(sql, ticketId, numero, { bsaleGet }, autor) {
  const n = String(numero || '').replace(/\D/g, '');
  if (!n || n.length > 12) return { error: 'Escribe el número de la nota de crédito', status: 400 };
  const { rows } = await sql.query('SELECT nota_credito_numero FROM tk_postventa WHERE ticket_id = $1', [ticketId]);
  if (!rows[0]) return { error: 'El ticket no es de postventa', status: 400 };
  if (rows[0].nota_credito_numero && rows[0].nota_credito_numero !== n) return { error: `Este ticket ya tiene la nota de crédito N° ${rows[0].nota_credito_numero}`, status: 409 };
  let verificada = null, aviso = null;
  if (bsaleGet) {
    try {
      const r = await bsaleGet(`/documents.json?number=${encodeURIComponent(n)}&expand=[document_type]&limit=10`);
      const nc = (r?.items || []).find((d) => /CR[EÉ]DITO/i.test(d.document_type?.name || ''));
      if (!nc) return { error: `En Bsale no existe una nota de crédito con el N° ${n}. Revisa el número o emítela primero en Bsale.`, status: 404 };
      verificada = { numero: String(nc.number), total: Math.round(Number(nc.totalAmount) || 0) || null, url: nc.urlPublicView || nc.urlPdf || null };
    } catch (e) { aviso = 'No se pudo confirmar en Bsale (' + String(e.message || e).slice(0, 100) + '); se guardó sin verificar'; }
  } else aviso = 'Bsale no está configurado en el servidor: se guardó sin verificar';
  await sql.query('UPDATE tk_postventa SET nota_credito_numero = $2 WHERE ticket_id = $1', [ticketId, n]);
  await sql.query('UPDATE tickets SET actualizado_en = now(), ultimo_movimiento_en = now() WHERE id = $1', [ticketId]);
  await registrarEvento(sql, ticketId, { tipo: 'actualizacion', autor, contenido: `Nota de crédito N° ${n} registrada${verificada ? ' (verificada en Bsale)' : ''}${verificada?.url ? ' — ' + verificada.url : ''}` });
  return { ok: true, numero: n, verificada, aviso };
}

// Manejador del recurso `tickets-postventa` (sesión): GET ?id= -> ficha; POST { accion: 'nc', id, numero } -> registra la nota de crédito.
export async function manejarTicketsPostventa(req, res, sesion, { getSql, gql, bsaleGet }) {
  try {
    const sql = await getSql();
    await asegurarTablasTickets(sql);
    const autor = { id: sesion.uid ? Number(sesion.uid) : null, nombre: sesion.nombre || sesion.email };
    const id = Number(req.method === 'GET' ? req.query.id : (req.body || {}).id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Falta el ticket' });
    const g = async () => { try { return gql ? await gql() : null; } catch { return null; } };
    if (req.method === 'GET') {
      const f = await fichaPostventa(sql, id, { gql: await g(), bsaleGet });
      if (f.error) return res.status(f.status || 400).json({ error: f.error });
      return res.status(200).json({ ficha: f });
    }
    if (req.method === 'POST' && (req.body || {}).accion === 'nc') {
      const r = await registrarNotaCredito(sql, id, req.body.numero, { bsaleGet }, autor);
      if (r.error) return res.status(r.status || 400).json({ error: r.error });
      return res.status(200).json(r);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(200).json({ error: 'Error en la ficha de postventa', detail: String(err.message || err).slice(0, 300) });
  }
}

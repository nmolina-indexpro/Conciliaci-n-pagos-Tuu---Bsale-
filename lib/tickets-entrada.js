// /lib/tickets-entrada.js
// Entradas automáticas al módulo de Tickets: formularios públicos (landings, postventa, NAS) y carritos abandonados de Shopify.
// Todo ticket entra por crearTicket (lib/tickets.js); acá solo se validan, normalizan y deduplican los datos de cada canal.
// Sin imports de red: las consultas a Shopify llegan inyectadas (`gql`), para poder probarlo sin credenciales.

import { crearTicket, normalizarTelefono, normalizarEmail, ultimos9, registrarEvento, buscarOCrearCliente, asegurarTablasTickets } from './tickets.js';

// ---------------- Formularios ----------------
export const FORMULARIOS = {
  pantallas: { tipo: 'lead', origen: 'landing_pantallas', etiqueta: 'Landing de pantallas' },
  cargadores: { tipo: 'lead', origen: 'landing_cargadores', etiqueta: 'Landing de cargadores' },
  nas: { tipo: 'lead', origen: 'nas', etiqueta: 'Formulario NAS' },
  postventa: { tipo: 'postventa', origen: 'sitio_postventa', etiqueta: 'Formulario de postventa' },
};

// Orígenes (sitios) desde los que un navegador puede enviar los formularios. Se pueden sumar más con TICKETS_ORIGENES_EXTRA (separados por coma).
const ORIGENES_BASE = ['https://indexstore.cl', 'https://www.indexstore.cl', 'https://indexpro.cl', 'https://www.indexpro.cl'];
export function origenPermitido(origin, extra = process.env.TICKETS_ORIGENES_EXTRA) {
  if (!origin) return false;
  const o = String(origin).trim().replace(/\/+$/, '').toLowerCase();
  if (ORIGENES_BASE.includes(o)) return true;
  if (/^https:\/\/[a-z0-9-]+\.myshopify\.com$/.test(o)) return true; // vistas previas del tema de Shopify
  return String(extra || '').split(',').map((s) => s.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean).includes(o);
}

function limpio(v, max) { const t = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').trim(); return t ? t.slice(0, max) : ''; }
function contarEnlaces(t) { return (String(t).match(/https?:\/\/|www\./gi) || []).length; }

// Devuelve { descartar: true } si parece spam (se responde "ok" sin crear nada para no darle pistas al robot), { error } si faltan datos,
// o { datos } listos para crearTicket.
export function validarFormulario(body, { ahora = Date.now() } = {}) {
  const b = body || {};
  const f = FORMULARIOS[String(b.formulario || '').toLowerCase()];
  if (!f) return { error: 'Formulario no reconocido' };
  // Anti-spam: campo trampa que una persona no ve (web) y tiempo mínimo entre abrir el formulario y enviarlo (t = ms desde que cargó).
  if (limpio(b.web, 200)) return { descartar: true, motivo: 'honeypot' };
  const t = Number(b.t);
  if (Number.isFinite(t) && t >= 0 && t < 2000) return { descartar: true, motivo: 'demasiado_rapido' };
  const mensaje = limpio(String(b.mensaje ?? '').replace(/\r/g, ''), 2000);
  if (contarEnlaces(mensaje) > 2) return { descartar: true, motivo: 'enlaces' };

  const nombre = limpio(b.nombre, 200);
  const telefono = normalizarTelefono(b.telefono);
  const email = normalizarEmail(b.email);
  if (b.telefono && String(b.telefono).replace(/\D/g, '').length < 8) return { error: 'El teléfono no parece válido' };
  if (b.email && !email) return { error: 'El correo no parece válido' };
  if (!telefono && !email) return { error: 'Necesitamos un teléfono o un correo para contactarte' };

  const atribucion = {};
  for (const k of ['pagina', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid']) { const v = limpio(b[k], 300); if (v) atribucion[k] = v; }

  const base = { tipo: f.tipo, origen: f.origen, cliente: { nombre, telefono, email, rut: limpio(b.rut, 20) } };
  if (f.tipo === 'lead') {
    const producto = limpio(b.producto || b.modelo, 200);
    const complemento = [limpio(b.marca, 80), limpio(b.cantidad, 40) && 'Cantidad: ' + limpio(b.cantidad, 40), limpio(b.empresa, 120) && 'Empresa: ' + limpio(b.empresa, 120)].filter(Boolean);
    const desc = [mensaje, ...complemento].filter(Boolean).join('\n');
    return { datos: { ...base, asunto: producto ? `${producto}${nombre ? ' — ' + nombre : ''}` : `${f.etiqueta}${nombre ? ' — ' + nombre : ''}`, descripcion: desc,
      lead: { producto_interes: producto, origen_detalle: f.origen, atribucion } } };
  }
  // postventa
  const pedido = limpio(b.pedido, 40).replace(/^#/, '');
  if (!pedido) return { error: 'Indica el número de pedido' };
  if (!mensaje) return { error: 'Cuéntanos qué pasó con tu pedido' };
  return { datos: { ...base, asunto: `Postventa pedido ${pedido}${nombre ? ' — ' + nombre : ''}`, descripcion: mensaje,
    postventa: { motivo: limpio(b.motivo, 40), tipo_producto: limpio(b.tipo_producto, 40), numero_pedido: pedido } } };
}

// ---------------- Verificación del pedido en Shopify (postventa) ----------------
// Busca el pedido por número. No se devuelve nada de eso al público: solo se usa para enlazar el ticket y avisar al equipo si el contacto no calza.
export async function verificarPedidoShopify(gql, numero, { telefono, email }) {
  const consulta = `query($q: String!) { orders(first: 1, query: $q) { nodes { id name email phone shippingAddress { phone } } } }`;
  let r = await gql(consulta, { q: `name:${numero}` });
  let nodo = r?.data?.orders?.nodes?.[0];
  // El cliente puede escribir el N° de su boleta o factura en vez del del pedido (#10269): las etiquetas BO-/FA-/NV- del pedido lo guardan.
  if (!nodo && /^[0-9]{3,9}$/.test(String(numero))) {
    r = await gql(consulta, { q: `tag:BO-${numero} OR tag:FA-${numero} OR tag:NV-${numero}` });
    nodo = r?.data?.orders?.nodes?.[0];
  }
  if (!nodo) return { encontrado: false };
  const emails = [nodo.email].map((x) => String(x || '').toLowerCase()).filter(Boolean);
  const tels = [nodo.phone, nodo.shippingAddress?.phone].map(ultimos9).filter((x) => x.length >= 8);
  const coincide = (email && emails.includes(email)) || (telefono && tels.includes(ultimos9(telefono)));
  return { encontrado: true, shopify_order_id: String(nodo.id).replace(/^gid:\/\/shopify\/Order\//, ''), nombre_pedido: nodo.name, coincide: !!coincide };
}

// ---------------- Procesar un formulario ----------------
const VENTANA_DUPLICADO_MIN = 15;
export async function procesarFormulario(sql, body, { gql = null } = {}) {
  const v = validarFormulario(body);
  if (v.descartar) return { ok: true, descartado: v.motivo, status: 200 };
  if (v.error) return { error: v.error, status: 400 };
  const d = v.datos;
  await asegurarTablasTickets(sql);
  const autor = { id: null, nombre: 'Formulario web' };

  // Doble envío: si el mismo cliente ya dejó un ticket abierto igual hace poco, se anota en ese y no se crea otro.
  const cliente = await buscarOCrearCliente(sql, d.cliente);
  if (cliente) {
    const { rows } = d.tipo === 'lead'
      ? await sql.query(`SELECT t.id, t.numero FROM tickets t WHERE t.cliente_id = $1 AND t.tipo = 'lead' AND t.origen = $2 AND t.cerrado_en IS NULL AND t.creado_en > now() - ($3 || ' minutes')::interval ORDER BY t.id DESC LIMIT 1`, [cliente.id, d.origen, String(VENTANA_DUPLICADO_MIN)])
      : await sql.query(`SELECT t.id, t.numero FROM tickets t JOIN tk_postventa p ON p.ticket_id = t.id WHERE t.cliente_id = $1 AND p.numero_pedido = $2 AND t.cerrado_en IS NULL AND t.creado_en > now() - interval '24 hours' ORDER BY t.id DESC LIMIT 1`, [cliente.id, d.postventa.numero_pedido]);
    if (rows[0]) {
      await registrarEvento(sql, rows[0].id, { tipo: 'contacto_cliente', autor, contenido: 'El cliente volvió a enviar el formulario' + (d.descripcion ? ':\n' + d.descripcion : '') });
      await sql.query('UPDATE tickets SET ultimo_movimiento_en = now() WHERE id = $1', [rows[0].id]);
      return { ok: true, numero: rows[0].numero, duplicado: true, status: 200 };
    }
  }

  let verificacion = null;
  if (d.tipo === 'postventa' && gql) {
    try { verificacion = await verificarPedidoShopify(gql, d.postventa.numero_pedido, { telefono: d.cliente.telefono, email: normalizarEmail(d.cliente.email) }); }
    catch (e) { verificacion = { error: String(e.message || e).slice(0, 150) }; }
    if (verificacion && verificacion.shopify_order_id) d.postventa.shopify_order_id = verificacion.shopify_order_id;
  }
  const r = await crearTicket(sql, d, autor);
  if (r.error) return { error: r.error, status: r.status || 400 };
  if (d.tipo === 'postventa') {
    const nota = !gql ? null
      : verificacion?.error ? 'No se pudo verificar el pedido en Shopify (' + verificacion.error + ')'
      : !verificacion?.encontrado ? `El pedido ${d.postventa.numero_pedido} no se encontró en Shopify: revisar el número con el cliente`
      : verificacion.coincide ? `Pedido ${verificacion.nombre_pedido} verificado en Shopify (el contacto coincide)`
      : `Pedido ${verificacion.nombre_pedido} encontrado en Shopify, pero el teléfono o el correo no coincide con el del pedido: confirmar la identidad antes de dar datos`;
    if (nota) await registrarEvento(sql, r.ticket.id, { tipo: 'actualizacion', autor, contenido: nota });
  }
  return { ok: true, numero: r.ticket.numero, status: 200 };
}

// ---------------- Carritos abandonados de Shopify ----------------
// Shopify no avisa "este carrito se abandonó" por webhook (checkouts/update se dispara en cada cambio), así que se consulta la lista de carritos
// abandonados con contacto y se crea un lead por cada uno nuevo. La tarea programada lo repite varias veces al día; no duplica (por id de checkout).
export const MINUTOS_PARA_ABANDONO = 60;
export const CONSULTA_CARRITOS = `
  query($q: String!, $after: String) {
    abandonedCheckouts(first: 50, query: $q, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name createdAt updatedAt completedAt abandonedCheckoutUrl
        customer { displayName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } }
        shippingAddress { name phone }
        billingAddress { name phone }
        totalPriceSet { shopMoney { amount } }
        lineItems(first: 10) { nodes { title quantity sku variantTitle } }
      }
    }
  }`;

export function normalizarCarrito(n) {
  const c = n.customer || {};
  const items = (n.lineItems?.nodes || []).map((i) => ({ titulo: limpio(i.title, 150), cantidad: Number(i.quantity) || 1, sku: limpio(i.sku, 60), variante: limpio(i.variantTitle, 80) })).filter((i) => i.titulo);
  return {
    checkout_id: String(n.id).replace(/^gid:\/\/shopify\/AbandonedCheckout\//, ''),
    creado_en: n.createdAt, actualizado_en: n.updatedAt, completado: !!n.completedAt, url: n.abandonedCheckoutUrl || null,
    // Shopify pone el correo como "nombre" cuando el cliente no lo escribió: en ese caso se usa el de la dirección, y si no hay, queda sin nombre.
    nombre: limpio((c.displayName && !c.displayName.includes('@') ? c.displayName : null) || n.shippingAddress?.name || n.billingAddress?.name, 200),
    email: normalizarEmail(c.defaultEmailAddress?.emailAddress),
    telefono: normalizarTelefono(c.defaultPhoneNumber?.phoneNumber || n.shippingAddress?.phone || n.billingAddress?.phone),
    total: Number(n.totalPriceSet?.shopMoney?.amount) || null, items,
  };
}

export async function crearLeadDeCarrito(sql, k) {
  if (k.completado) return { omitido: 'completado' };
  if (!k.email && !k.telefono) return { omitido: 'sin_contacto' };
  if (!k.items.length) return { omitido: 'sin_productos' };
  const { rows } = await sql.query('SELECT 1 FROM tk_leads WHERE shopify_checkout_id = $1 LIMIT 1', [k.checkout_id]);
  if (rows[0]) return { omitido: 'ya_existe' };
  const lista = k.items.map((i) => `• ${i.cantidad} × ${i.titulo}${i.variante ? ' (' + i.variante + ')' : ''}${i.sku ? ' — ' + i.sku : ''}`).join('\n');
  const principal = k.items[0].titulo + (k.items.length > 1 ? ` y ${k.items.length - 1} más` : '');
  const r = await crearTicket(sql, {
    tipo: 'lead', origen: 'carrito_abandonado', asunto: `Carrito abandonado — ${principal}`, creado_en: k.actualizado_en || k.creado_en,
    descripcion: `El cliente dejó este carrito sin comprar:\n${lista}${k.url ? '\n\nEnlace para retomar la compra: ' + k.url : ''}`,
    cliente: { nombre: k.nombre, email: k.email, telefono: k.telefono },
    lead: { producto_interes: principal, origen_detalle: 'carrito_abandonado', shopify_checkout_id: k.checkout_id, monto_estimado: k.total },
  }, { id: null, nombre: 'Shopify' });
  return r.error ? { error: r.error } : { creado: r.ticket.numero };
}

// `gql(consulta, variables)` debe devolver { data, errors }. Recorre hasta 4 páginas (200 carritos) de las últimas `horas` horas.
export async function sincronizarCarritos(sql, gql, { horas = 48, ahora = Date.now() } = {}) {
  await asegurarTablasTickets(sql);
  const desde = new Date(ahora - horas * 3600000).toISOString();
  const resumen = { revisados: 0, creados: 0, omitidos: {}, numeros: [] };
  let after = null;
  for (let pagina = 0; pagina < 4; pagina++) {
    const r = await gql(CONSULTA_CARRITOS, { q: `updated_at:>=${desde}`, after });
    if (r.errors && r.errors.length) throw new Error('Shopify: ' + r.errors.map((e) => e.message).join('; ').slice(0, 300));
    const con = r.data?.abandonedCheckouts;
    if (!con) throw new Error('Shopify no devolvió carritos abandonados');
    for (const nodo of con.nodes) {
      resumen.revisados++;
      const k = normalizarCarrito(nodo);
      // Un carrito recién tocado todavía puede estar comprándose: se espera una hora sin cambios.
      if (ahora - new Date(k.actualizado_en).getTime() < MINUTOS_PARA_ABANDONO * 60000) { resumen.omitidos.reciente = (resumen.omitidos.reciente || 0) + 1; continue; }
      const res = await crearLeadDeCarrito(sql, k);
      if (res.creado) { resumen.creados++; resumen.numeros.push(res.creado); }
      else { const m = res.omitido || 'error'; resumen.omitidos[m] = (resumen.omitidos[m] || 0) + 1; }
    }
    if (!con.pageInfo?.hasNextPage) break;
    after = con.pageInfo.endCursor;
  }
  return resumen;
}

// ---------------- Respuesta HTTP del recurso público ----------------
export function cabecerasCors(req, res) {
  const origin = req.headers?.origin;
  if (origin && origenPermitido(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return true;
  }
  return false;
}

export async function manejarTicketsPublico(req, res, { getSql, gql }) {
  const permitido = cabecerasCors(req, res);
  if (req.method === 'OPTIONS') return res.status(permitido ? 204 : 403).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers?.origin && !permitido) return res.status(403).json({ error: 'Origen no permitido' });
  // Cuerpo JSON (lo normal) o application/x-www-form-urlencoded.
  let b = req.body && typeof req.body === 'object' && Object.keys(req.body).length ? req.body : null;
  if (!b && req.rawBody) { try { b = Object.fromEntries(new URLSearchParams(req.rawBody)); } catch { b = null; } }
  try {
    const sql = await getSql();
    let g = null;
    if (String(b?.formulario || '').toLowerCase() === 'postventa' && gql) { try { g = await gql(); } catch { g = null; } }
    const r = await procesarFormulario(sql, b || {}, { gql: g });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    return res.status(200).json({ ok: true, numero: r.descartado ? undefined : r.numero });
  } catch (err) {
    console.error('tickets-publico error', err);
    return res.status(500).json({ error: 'No pudimos registrar tu solicitud. Intenta de nuevo en unos minutos o escríbenos por WhatsApp.' });
  }
}

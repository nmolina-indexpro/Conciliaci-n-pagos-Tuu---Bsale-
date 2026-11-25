// /lib/whatsapp-pedidos.js
// Consulta de un pedido de la tienda web (Shopify) para el bot de WhatsApp: estado de pago, de despacho y número de seguimiento del courier.
//
// PRIVACIDAD (regla central): el bot solo entrega datos de un pedido si el pedido es de la misma persona que escribe. Se verifica comparando el
// teléfono del WhatsApp del cliente (lo pone el servidor, nunca la IA) con los teléfonos del pedido. Si no calza, no se entrega NINGÚN dato
// —ni siquiera si el pedido existe— y el bot responde que lo revisará internamente. Nunca sale el nombre, el correo ni la dirección.
// La consulta a Shopify llega inyectada (`gql`): sin red acá, para poder probarlo.

export const NUMERO_PEDIDO_MIN = 3;
export const NUMERO_PEDIDO_MAX = 9;

// Solo dígitos, entre 3 y 9: acepta «#39281», «pedido 39281», «39281». null si no parece un número de pedido.
export function normalizarNumeroPedido(valor) {
  const d = String(valor ?? '').replace(/\D/g, '');
  return d.length >= NUMERO_PEDIDO_MIN && d.length <= NUMERO_PEDIDO_MAX ? d : null;
}

// Últimos 9 dígitos de un teléfono (así «+56 9 8765 4321», «56987654321» y «987654321» son el mismo). '' si no es un teléfono.
export function ultimos9(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(-9) : '';
}

export function telefonosDelPedido(nodo) {
  const t = [nodo?.phone, nodo?.shippingAddress?.phone, nodo?.billingAddress?.phone].map(ultimos9).filter(Boolean);
  return [...new Set(t)];
}

const PAGO = {
  PAID: 'pagado', PENDING: 'pago pendiente', AUTHORIZED: 'pago autorizado', PARTIALLY_PAID: 'pago parcial', PARTIALLY_REFUNDED: 'reembolso parcial',
  REFUNDED: 'reembolsado', VOIDED: 'anulado', EXPIRED: 'pago expirado',
};
const DESPACHO = {
  FULFILLED: 'despachado (ya está con el courier)', UNFULFILLED: 'aún no despachado', PARTIALLY_FULFILLED: 'despachado en forma parcial', IN_PROGRESS: 'en preparación',
  ON_HOLD: 'en espera', SCHEDULED: 'programado', PENDING_FULFILLMENT: 'en preparación', OPEN: 'en preparación', RESTOCKED: 'devuelto a bodega',
};

export const INSTRUCCION_NO_VERIFICADO = 'No se pudo verificar que este pedido sea de esta persona: NO entregues ningún dato del pedido ni confirmes si existe. Dile, con empatía, que revisaremos internamente el caso y le responderemos en unos minutos, en horario hábil. Deja escalar=true.';

// Transforma el pedido de Shopify en lo ÚNICO que ve la IA. Pura (se prueba sin red).
export function armarRespuestaPedido(nodo, telefonoCliente, numero) {
  const tel = ultimos9(telefonoCliente);
  const verificado = !!nodo && !!tel && telefonosDelPedido(nodo).includes(tel);
  if (!verificado) return { numero_pedido: numero || null, verificado: false, instruccion: INSTRUCCION_NO_VERIFICADO };

  const envios = (nodo.fulfillments || []).flatMap(f => (f.trackingInfo || []).map(t => ({
    courier: String(t.company || '').trim(), numero_seguimiento: String(t.number || '').trim(), enlace: String(t.url || '').trim(),
    estado: String(f.displayStatus || f.status || '').trim(), entregado: !!f.deliveredAt,
  }))).filter(e => e.numero_seguimiento || e.enlace).slice(0, 3);

  const cancelado = !!nodo.cancelledAt;
  const pago = PAGO[nodo.displayFinancialStatus] || String(nodo.displayFinancialStatus || '').toLowerCase() || 'sin dato';
  const despacho = DESPACHO[nodo.displayFulfillmentStatus] || String(nodo.displayFulfillmentStatus || '').toLowerCase() || 'sin dato';
  const pagado = nodo.displayFinancialStatus === 'PAID';
  const sinDespachar = ['UNFULFILLED', 'IN_PROGRESS', 'PENDING_FULFILLMENT', 'OPEN', 'ON_HOLD', 'SCHEDULED'].includes(nodo.displayFulfillmentStatus);

  let instruccion;
  if (cancelado) instruccion = 'El pedido figura cancelado: no des más datos; di que revisaremos internamente el caso y le responderemos en unos minutos, en horario hábil. Deja escalar=true.';
  else if (envios.length) instruccion = 'Entrega el courier, el número de seguimiento y el enlace TAL COMO VIENEN aquí (nunca de memoria) y no prometas fechas de llegada. Si hay varios envíos, indícalos todos.';
  else if (!pagado) instruccion = 'No figura el pago confirmado: no acuses al cliente; di que revisaremos internamente el caso y le responderemos en unos minutos, en horario hábil. Deja escalar=true.';
  else if (sinDespachar) instruccion = 'El pedido está pagado y aún no sale: según la política, los pedidos con el pago confirmado antes de las 11:00 se entregan al courier el mismo día hábil (máximo 24 horas hábiles). No prometas fecha; di que revisaremos internamente el caso y le responderemos en unos minutos, en horario hábil. Deja escalar=true.';
  else instruccion = 'El pedido está despachado pero no tiene número de seguimiento visible: no inventes uno; di que revisaremos internamente el caso y le responderemos en unos minutos, en horario hábil. Deja escalar=true.';

  return {
    numero_pedido: numero || null, verificado: true, cancelado, pago, despacho, tiene_seguimiento: envios.length > 0, envios, instruccion,
  };
}

const CAMPOS = `
  fragment CamposPedido on Order {
    id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus phone
    shippingAddress { phone } billingAddress { phone }
    fulfillments(first: 5) { status displayStatus deliveredAt trackingInfo { number url company } }
  }`;

// Busca el pedido en Shopify por su número (y, si no aparece, por las etiquetas BO-/FA-/NV- que guardan el número de boleta, factura o nota de venta)
// y arma lo que ve la IA. `gql(query, variables)` devuelve el cuerpo de la respuesta de Shopify ({ data }).
export async function consultarPedidoParaCliente(gql, numeroCrudo, telefonoCliente) {
  const n = normalizarNumeroPedido(numeroCrudo);
  if (!n) return { verificado: false, encontrado: false, instruccion: 'El número de pedido no es válido: pídele al cliente que lo revise y te lo envíe de nuevo (solo dígitos).' };
  const consulta = (filtro) => gql(`${CAMPOS} query($q: String!) { orders(first: 1, query: $q) { nodes { ...CamposPedido } } }`, { q: filtro });
  let nodo = (await consulta(`name:${n}`))?.data?.orders?.nodes?.[0] || null;
  if (!nodo) nodo = (await consulta(`tag:BO-${n} OR tag:FA-${n} OR tag:NV-${n}`))?.data?.orders?.nodes?.[0] || null;
  // Un pedido que no existe y uno que no es de esta persona se responden igual (no se confirma ni se descarta nada).
  return armarRespuestaPedido(nodo, telefonoCliente, n);
}

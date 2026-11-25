// Consulta de pedidos para el bot de WhatsApp: verificación por teléfono, qué ve la IA y qué nunca debe ver.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarNumeroPedido, ultimos9, telefonosDelPedido, armarRespuestaPedido, consultarPedidoParaCliente, INSTRUCCION_NO_VERIFICADO,
} from '../../lib/whatsapp-pedidos.js';

const pedido = (extra = {}) => ({
  id: 'gid://shopify/Order/1', name: '#39281', createdAt: '2026-11-20T12:00:00Z', cancelledAt: null, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED',
  phone: '+56 9 8765 4321', shippingAddress: { phone: null, name: 'María Pérez', city: 'Ñuñoa', address1: 'Calle Falsa 123' }, billingAddress: null,
  fulfillments: [{ status: 'SUCCESS', displayStatus: 'En tránsito', deliveredAt: null, trackingInfo: [{ number: 'STK123456789', company: 'Starken', url: 'https://www.starken.cl/seguimiento?codigo=STK123456789' }] }],
  ...extra,
});
const TEL = '56987654321'; // el mismo teléfono que el del pedido, en formato de WhatsApp

test('normalizarNumeroPedido y ultimos9 aceptan los formatos habituales y descartan lo que no sirve', () => {
  assert.equal(normalizarNumeroPedido('#39281'), '39281');
  assert.equal(normalizarNumeroPedido('pedido N° 39281'), '39281');
  assert.equal(normalizarNumeroPedido(39281), '39281');
  for (const malo of ['', null, undefined, '12', '1234567890', 'abc']) assert.equal(normalizarNumeroPedido(malo), null, String(malo));
  assert.equal(ultimos9('+56 9 8765 4321'), '987654321');
  assert.equal(ultimos9('56987654321'), '987654321');
  assert.equal(ultimos9('987654321'), '987654321');
  assert.equal(ultimos9('123'), '');
  assert.deepEqual(telefonosDelPedido(pedido({ shippingAddress: { phone: '9 8765 4321' }, billingAddress: { phone: '+56 2 2231 1946' } })), ['987654321', '222311946']);
});

test('con el teléfono verificado entrega courier, número de seguimiento y enlace, y nada más', () => {
  const r = armarRespuestaPedido(pedido(), TEL, '39281');
  assert.equal(r.verificado, true);
  assert.equal(r.tiene_seguimiento, true);
  assert.deepEqual(r.envios, [{ courier: 'Starken', numero_seguimiento: 'STK123456789', enlace: 'https://www.starken.cl/seguimiento?codigo=STK123456789', estado: 'En tránsito', entregado: false }]);
  assert.equal(r.pago, 'pagado');
  assert.match(r.despacho, /despachado/);
  assert.match(r.instruccion, /TAL COMO VIENEN/);
  // nunca sale nada personal: ni nombre, ni dirección, ni teléfono, ni correo
  const texto = JSON.stringify(r);
  for (const privado of ['María', 'Pérez', 'Ñuñoa', 'Calle Falsa', '8765', '987654321', '@']) assert.ok(!texto.includes(privado), `se filtró "${privado}"`);
});

test('sin verificación no se entrega ningún dato, exista o no el pedido', () => {
  const ajeno = armarRespuestaPedido(pedido(), '56911112222', '39281');
  const inexistente = armarRespuestaPedido(null, TEL, '39281');
  const sinTelefono = armarRespuestaPedido(pedido(), '', '39281');
  for (const r of [ajeno, inexistente, sinTelefono]) {
    assert.deepEqual(r, { numero_pedido: '39281', verificado: false, instruccion: INSTRUCCION_NO_VERIFICADO });
  }
  assert.match(INSTRUCCION_NO_VERIFICADO, /NO entregues ningún dato/);
  assert.match(INSTRUCCION_NO_VERIFICADO, /revisaremos internamente el caso/);
  // un pedido ajeno y uno inexistente son idénticos para la IA: no sirve para averiguar qué pedidos existen
  assert.deepEqual(ajeno, inexistente);
});

test('cada situación del pedido trae su instrucción y no inventa datos', () => {
  const sinSeguimientoPagado = armarRespuestaPedido(pedido({ displayFulfillmentStatus: 'UNFULFILLED', fulfillments: [] }), TEL, '1');
  assert.equal(sinSeguimientoPagado.tiene_seguimiento, false);
  assert.match(sinSeguimientoPagado.instruccion, /pagado y aún no sale/);
  assert.match(sinSeguimientoPagado.instruccion, /11:00/);
  assert.match(sinSeguimientoPagado.instruccion, /escalar=true/);

  const despachadoSinNumero = armarRespuestaPedido(pedido({ fulfillments: [{ status: 'SUCCESS', trackingInfo: [] }] }), TEL, '1');
  assert.match(despachadoSinNumero.instruccion, /no inventes uno/);

  const pagoPendiente = armarRespuestaPedido(pedido({ displayFinancialStatus: 'PENDING', displayFulfillmentStatus: 'UNFULFILLED', fulfillments: [] }), TEL, '1');
  assert.match(pagoPendiente.instruccion, /no acuses al cliente/);
  assert.equal(pagoPendiente.pago, 'pago pendiente');

  const cancelado = armarRespuestaPedido(pedido({ cancelledAt: '2026-11-21T10:00:00Z' }), TEL, '1');
  assert.equal(cancelado.cancelado, true);
  assert.match(cancelado.instruccion, /figura cancelado/);

  // solo el enlace, sin número, también cuenta como seguimiento; y se limita a 3 envíos
  const soloEnlace = armarRespuestaPedido(pedido({ fulfillments: [{ trackingInfo: [{ number: '', company: 'OTS', url: 'https://ots.cl/x' }] }] }), TEL, '1');
  assert.equal(soloEnlace.envios.length, 1);
  const muchos = armarRespuestaPedido(pedido({ fulfillments: Array.from({ length: 5 }, (_, i) => ({ trackingInfo: [{ number: `N${i}`, company: 'Starken' }] })) }), TEL, '1');
  assert.equal(muchos.envios.length, 3);
});

test('consultarPedidoParaCliente busca por número, luego por etiqueta de documento, y valida el número', async () => {
  const consultas = [];
  const gql = nodos => async (q, v) => { consultas.push(v.q); return { data: { orders: { nodes: nodos.shift() || [] } } }; };

  let r = await consultarPedidoParaCliente(gql([[pedido()]]), '#39281', TEL);
  assert.deepEqual(consultas, ['name:39281']);
  assert.equal(r.verificado, true);

  consultas.length = 0;
  r = await consultarPedidoParaCliente(gql([[], [pedido()]]), 'pedido 39281', TEL);
  assert.deepEqual(consultas, ['name:39281', 'tag:BO-39281 OR tag:FA-39281 OR tag:NV-39281'], 'si no hay pedido con ese número, prueba con el de la boleta o factura');
  assert.equal(r.verificado, true);

  r = await consultarPedidoParaCliente(gql([[], []]), '39281', TEL);
  assert.equal(r.verificado, false);

  consultas.length = 0;
  r = await consultarPedidoParaCliente(gql([]), 'abc', TEL);
  assert.equal(r.encontrado, false);
  assert.match(r.instruccion, /no es válido/);
  assert.equal(consultas.length, 0, 'un número inválido no consulta a Shopify');
});

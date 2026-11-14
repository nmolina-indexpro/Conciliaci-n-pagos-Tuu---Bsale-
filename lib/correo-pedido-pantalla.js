// /lib/correo-pedido-pantalla.js
// Aviso por correo de un pedido de pantalla a pedido que quedó anotado y está pendiente de compra: hay que generar la compra al proveedor internacional.
// Función pura (sin red ni base de datos) con el diseño estándar de lib/correo-base.js. Sin montos, ventas ni costos: solo si hay abono o no, y con qué medio.
import { esc, num, plural, chip, tabla, masEnElErp, tarjetas, avisos, seccion, armarCorreo } from './correo-base.js';
import { MEDIOS_ABONO, DIAS_RECORDATORIO } from './pedidos-pantalla.js';

const dia = (v) => (!v ? null : String(v instanceof Date ? v.toISOString() : v).slice(0, 10));
const fechaCorta = (iso) => { const [a, m, d] = iso.split('-'); return `${d}-${m}-${a}`; };
export const numeroPedido = (id) => 'PP-' + String(id || 0).padStart(4, '0');

export function armarCorreoPedidoPantalla(p, { urlBase = 'https://erp.indexstore.cl', ejemplo = false } = {}) {
  const numero = numeroPedido(p.id);
  const prometida = dia(p.fecha_prometida);
  const abono = p.abono_realizado ? `Con abono (${esc((MEDIOS_ABONO[p.abono_medio] || 'medio sin indicar').toLowerCase())})` : 'Sin abono';
  const kpis = tarjetas([
    { etiqueta: '🧾 Pedido', cifra: esc(numero), sub: esc(p.cliente_nombre || 'cliente sin nombre'), tono: 'azul' },
    { etiqueta: '💻 Producto', cifra: esc(p.modelo || '—'), sub: p.producto_sku ? 'SKU ' + esc(p.producto_sku) : 'sin SKU del catálogo', tono: 'azul' },
    { etiqueta: '⏱️ Espera prometida', cifra: p.dias_estimados ? `${esc(p.dias_estimados)} días` : '—', sub: prometida ? 'hasta el ' + esc(fechaCorta(prometida)) : 'sin fecha', tono: 'gris' },
    { etiqueta: '💳 Abono', cifra: p.abono_realizado ? 'Sí' : 'No', sub: abono, tono: p.abono_realizado ? 'verde' : 'amarillo' },
  ]);
  const notas = [{ tono: 'azul', texto: '<b>Hay un pedido pendiente de compra:</b> hay que generar la compra de esta pantalla al proveedor internacional.' }];
  if (!p.abono_realizado) notas.push({ tono: 'amarillo', texto: 'El cliente todavía no ha dejado abono.' });
  if (p.requiere_factura) notas.push({ tono: 'azul', texto: 'El cliente pide factura (los datos de facturación están en el pedido).' });
  const contacto = [p.cliente_telefono ? `WhatsApp: ${esc(p.cliente_telefono)}` : null, p.cliente_email ? `Correo: ${esc(p.cliente_email)}` : null, p.cliente_comuna ? `Comuna: ${esc(p.cliente_comuna)}` : null].filter(Boolean);
  const cuerpo = kpis + avisos(notas) + (contacto.length ? seccion('Contacto del cliente', 'Por si hay que confirmar el modelo o avisarle de la compra.', `<p style="margin:0;font-size:14px;line-height:1.6;">${contacto.join('<br>')}</p>`) : '');
  const html = armarCorreo({
    etiqueta: 'IndexStore · Compras',
    titulo: 'Pantalla a pedido nueva: hay que ejecutar la compra',
    subtitulo: `${esc(numero)}${p.actualizado_por ? ' · anotado por ' + esc(p.actualizado_por) : ''}${ejemplo ? ' · EJEMPLO' : ''}`,
    cuerpo,
    boton: { url: `${urlBase}/pedidos-pantallas.html`, texto: 'Ver el pedido en el ERP' },
    leyenda: `este aviso sale una sola vez por pedido, cuando se anota. Si pasan ${DIAS_RECORDATORIO} días y sigue sin comprarse, llega un recordatorio (y se repite cada ${DIAS_RECORDATORIO} días hasta que se marque como comprado). El seguimiento (compra, tránsito, llegada, entrega) se lleva en Compras > Pantallas a pedido.`,
  });
  const asunto = `Nuevo pedido de pantalla: ejecutar la compra · ${p.modelo || 'modelo por confirmar'} · ${numero}${ejemplo ? ' · EJEMPLO' : ''}`;
  return { asunto, html };
}

// Recordatorio: pedidos que llevan {DIAS_RECORDATORIO} o más días pendientes de compra (nadie ha ejecutado la compra al proveedor). Un solo correo con todos, el más antiguo primero. Sin montos.
const MAX_FILAS_RECORDATORIO = 15;

export function armarCorreoRecordatorioPedidosPantalla(pedidos, { urlBase = 'https://erp.indexstore.cl', ejemplo = false } = {}) {
  const lista = pedidos || [];
  const masViejo = lista.reduce((m, p) => Math.max(m, Number(p.dias_sin_cambio) || 0), 0);
  const conAbono = lista.filter((p) => p.abono_realizado).length;
  const kpis = tarjetas([
    { etiqueta: '🛒 Compra sin ejecutar', cifra: num(lista.length), sub: `${plural(lista.length, 'pedido lleva', 'pedidos llevan')} ${DIAS_RECORDATORIO} días o más sin comprarse`, tono: lista.length ? 'rojo' : 'verde' },
    { etiqueta: '📅 Más antiguo', cifra: masViejo ? `${num(masViejo)} días` : '—', sub: 'pendiente de compra', tono: 'gris' },
    { etiqueta: '💳 Con abono', cifra: num(conAbono), sub: conAbono ? 'el cliente ya dejó abono' : 'ninguno con abono', tono: conAbono ? 'amarillo' : 'gris' },
  ]);
  const notas = [];
  if (lista.length) notas.push({ tono: 'rojo', texto: `<b>${num(lista.length)} ${plural(lista.length, 'pedido sigue', 'pedidos siguen')} sin comprar:</b> hay que generar la compra al proveedor internacional y marcarlo «Comprado» en el ERP.` });
  notas.push({ tono: 'azul', texto: 'Si la compra ya se hizo y no se actualizó, basta con cambiar el estado del pedido: el recordatorio deja de salir.' });
  const visibles = lista.slice(0, MAX_FILAS_RECORDATORIO);
  const filas = visibles.map((p) => [
    `<b>${esc(numeroPedido(p.id))}</b>`,
    esc(p.cliente_nombre || '—'),
    esc(p.modelo || '—') + (p.producto_sku ? `<br><span style="color:#64748b;font-size:12px;">${esc(p.producto_sku)}</span>` : ''),
    p.abono_realizado ? chip('Con abono', 'amarillo') : chip('Sin abono', 'gris'),
    `${num(p.dias_sin_cambio)} días`,
  ]);
  const pie = lista.length > visibles.length ? masEnElErp(lista.length - visibles.length, 'Compras > Pantallas a pedido') : null;
  const cuerpo = kpis + avisos(notas) + seccion('Pedidos pendientes de compra', 'Del que lleva más tiempo esperando al que menos.',
    tabla([{ titulo: 'Pedido' }, { titulo: 'Cliente' }, { titulo: 'Producto' }, { titulo: 'Abono' }, { titulo: 'Sin comprar', alinear: 'right' }], filas, { pie }));
  const html = armarCorreo({
    etiqueta: 'IndexStore · Compras',
    titulo: 'Recordatorio: pedidos de pantalla pendientes de compra',
    subtitulo: `${num(lista.length)} ${plural(lista.length, 'pedido', 'pedidos')} con ${DIAS_RECORDATORIO} días o más sin comprarse${ejemplo ? ' · EJEMPLO' : ''}`,
    cuerpo,
    boton: { url: `${urlBase}/pedidos-pantallas.html`, texto: 'Abrir Pantallas a pedido' },
    leyenda: `se revisa cada mañana. Un pedido entra aquí cuando lleva ${DIAS_RECORDATORIO} días o más pendiente de compra, y el recordatorio se repite cada ${DIAS_RECORDATORIO} días hasta que se marque como comprado (o se cancele).`,
  });
  const asunto = `Recordatorio: ${num(lista.length)} ${plural(lista.length, 'pedido de pantalla', 'pedidos de pantalla')} sin comprar${ejemplo ? ' · EJEMPLO' : ''}`;
  return { asunto, html };
}

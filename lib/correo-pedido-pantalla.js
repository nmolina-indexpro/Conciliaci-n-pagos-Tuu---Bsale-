// /lib/correo-pedido-pantalla.js
// Aviso por correo de un pedido de pantalla a pedido que quedó anotado y está pendiente de compra: hay que generar la compra al proveedor internacional.
// Función pura (sin red ni base de datos) con el diseño estándar de lib/correo-base.js. Sin montos, ventas ni costos: solo si hay abono o no, y con qué medio.
import { esc, num, plural, chip, tabla, masEnElErp, tarjetas, avisos, seccion, armarCorreo } from './correo-base.js';
import { MEDIOS_ABONO, ETIQUETA_ESTADO, DIAS_RECORDATORIO } from './pedidos-pantalla.js';

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
    leyenda: `este aviso sale una sola vez por pedido, cuando se anota. Si pasan ${DIAS_RECORDATORIO} días sin que cambie de estado, llega un recordatorio (y se repite cada ${DIAS_RECORDATORIO} días mientras siga igual). El seguimiento (compra, tránsito, llegada, entrega) se lleva en Compras > Pantallas a pedido.`,
  });
  const asunto = `Nuevo pedido de pantalla: ejecutar la compra · ${p.modelo || 'modelo por confirmar'} · ${numero}${ejemplo ? ' · EJEMPLO' : ''}`;
  return { asunto, html };
}

// Recordatorio: pedidos activos que llevan {DIAS_RECORDATORIO} o más días sin cambiar de estado. Un solo correo con todos (los pendientes de compra primero). Sin montos.
const QUE_HACER = {
  pendiente_compra: { texto: 'Ejecutar la compra al proveedor y marcarlo «Comprado»', tono: 'rojo' },
  comprado: { texto: 'Si ya salió el envío, marcarlo «En tránsito»', tono: 'amarillo' },
  en_transito: { texto: 'Si ya llegó, marcarlo «Recibido»', tono: 'amarillo' },
  recibido: { texto: 'Entregarlo al cliente y marcarlo «Entregado»', tono: 'azul' },
};
const MAX_FILAS_RECORDATORIO = 15;

export function armarCorreoRecordatorioPedidosPantalla(pedidos, { urlBase = 'https://erp.indexstore.cl', ejemplo = false } = {}) {
  const lista = pedidos || [];
  const sinCompra = lista.filter((p) => p.estado === 'pendiente_compra');
  const masViejo = lista.reduce((m, p) => Math.max(m, Number(p.dias_sin_cambio) || 0), 0);
  const kpis = tarjetas([
    { etiqueta: '⏰ Sin cambio de estado', cifra: num(lista.length), sub: `${plural(lista.length, 'pedido lleva', 'pedidos llevan')} ${DIAS_RECORDATORIO} días o más igual`, tono: lista.length ? 'amarillo' : 'verde' },
    { etiqueta: '🛒 Compra sin ejecutar', cifra: num(sinCompra.length), sub: sinCompra.length ? 'pendientes de compra al proveedor' : 'ninguno pendiente de compra', tono: sinCompra.length ? 'rojo' : 'verde' },
    { etiqueta: '📅 Más antiguo', cifra: masViejo ? `${num(masViejo)} días` : '—', sub: 'sin cambiar de estado', tono: 'gris' },
  ]);
  const notas = [];
  if (sinCompra.length) notas.push({ tono: 'rojo', texto: `<b>${num(sinCompra.length)} ${plural(sinCompra.length, 'pedido sigue', 'pedidos siguen')} pendiente${sinCompra.length === 1 ? '' : 's'} de compra:</b> hay que generar la compra al proveedor internacional.` });
  notas.push({ tono: 'azul', texto: 'Si el pedido ya avanzó pero no se actualizó, basta con cambiar su estado en el ERP: el recordatorio deja de salir.' });
  const visibles = lista.slice(0, MAX_FILAS_RECORDATORIO);
  const filas = visibles.map((p) => {
    const q = QUE_HACER[p.estado] || { texto: 'Revisar el pedido', tono: 'gris' };
    return [
      `<b>${esc(numeroPedido(p.id))}</b>`,
      esc(p.cliente_nombre || '—'),
      esc(p.modelo || '—') + (p.producto_sku ? `<br><span style="color:#64748b;font-size:12px;">${esc(p.producto_sku)}</span>` : ''),
      chip(esc(ETIQUETA_ESTADO[p.estado] || p.estado), q.tono),
      `${num(p.dias_sin_cambio)} días`,
      esc(q.texto),
    ];
  });
  const pie = lista.length > visibles.length ? masEnElErp(lista.length - visibles.length, 'Compras > Pantallas a pedido') : null;
  const cuerpo = kpis + avisos(notas) + seccion('Pedidos sin movimiento', 'Del que lleva más tiempo en espera de compra al que menos.',
    tabla([{ titulo: 'Pedido' }, { titulo: 'Cliente' }, { titulo: 'Producto' }, { titulo: 'Estado' }, { titulo: 'Sin cambio', alinear: 'right' }, { titulo: 'Qué hacer' }], filas, { pie }));
  const html = armarCorreo({
    etiqueta: 'IndexStore · Compras',
    titulo: 'Recordatorio: pedidos de pantalla sin cambio de estado',
    subtitulo: `${num(lista.length)} ${plural(lista.length, 'pedido', 'pedidos')} con ${DIAS_RECORDATORIO} días o más sin avance${ejemplo ? ' · EJEMPLO' : ''}`,
    cuerpo,
    boton: { url: `${urlBase}/pedidos-pantallas.html`, texto: 'Abrir Pantallas a pedido' },
    leyenda: `se revisa cada mañana. Un pedido entra aquí cuando lleva ${DIAS_RECORDATORIO} días o más sin cambiar de estado, y el recordatorio se repite cada ${DIAS_RECORDATORIO} días hasta que alguien lo actualice (o lo entregue o cancele).`,
  });
  const pendientes = sinCompra.length;
  const asunto = `Recordatorio: ${num(lista.length)} ${plural(lista.length, 'pedido de pantalla', 'pedidos de pantalla')} sin cambio de estado${pendientes ? ` (${num(pendientes)} por comprar)` : ''}${ejemplo ? ' · EJEMPLO' : ''}`;
  return { asunto, html };
}

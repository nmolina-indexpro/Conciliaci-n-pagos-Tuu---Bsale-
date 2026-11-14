// /lib/correo-pedido-pantalla.js
// Aviso por correo de un pedido de pantalla a pedido que quedó anotado y está pendiente de compra: hay que generar la compra al proveedor internacional.
// Función pura (sin red ni base de datos) con el diseño estándar de lib/correo-base.js. Sin montos, ventas ni costos: solo si hay abono o no, y con qué medio.
import { esc, tarjetas, avisos, seccion, armarCorreo } from './correo-base.js';
import { MEDIOS_ABONO } from './pedidos-pantalla.js';

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
    titulo: 'Pantalla a pedido: pendiente de compra',
    subtitulo: `${esc(numero)}${p.actualizado_por ? ' · anotado por ' + esc(p.actualizado_por) : ''}${ejemplo ? ' · EJEMPLO' : ''}`,
    cuerpo,
    boton: { url: `${urlBase}/pedidos-pantallas.html`, texto: 'Ver el pedido en el ERP' },
    leyenda: 'este aviso sale una sola vez por pedido, cuando se anota. El seguimiento (compra, tránsito, llegada, entrega) se lleva en Compras > Pantallas a pedido.',
  });
  const asunto = `Pantalla a pedido pendiente de compra: ${p.modelo || 'modelo por confirmar'} · ${numero}${ejemplo ? ' · EJEMPLO' : ''}`;
  return { asunto, html };
}

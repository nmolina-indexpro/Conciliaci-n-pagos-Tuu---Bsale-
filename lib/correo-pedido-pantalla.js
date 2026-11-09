// /lib/correo-pedido-pantalla.js
// Aviso por correo de un pedido de pantalla a pedido que quedó "por comprar": el cliente pagó el abono y hay que generar la compra al proveedor
// internacional. Función pura (sin red ni base de datos) con el diseño estándar de lib/correo-base.js. Sin montos, ventas ni costos.
import { esc, tarjetas, avisos, seccion, armarCorreo } from './correo-base.js';

export function armarCorreoPedidoPantalla(p, { urlBase = 'https://erp.indexstore.cl', ejemplo = false } = {}) {
  const orden = p.orden_nombre || 'sin número';
  const sinModelo = !p.modelo || !String(p.modelo).trim();
  const kpis = tarjetas([
    { etiqueta: '🧾 Pedido', cifra: esc(orden), sub: esc(p.cliente_nombre || 'cliente sin nombre'), tono: 'azul' },
    { etiqueta: '💻 Modelo', cifra: sinModelo ? '—' : esc(p.modelo), sub: p.numero_parte ? 'N° de parte: ' + esc(p.numero_parte) : 'sin número de parte', tono: sinModelo ? 'amarillo' : 'azul' },
    { etiqueta: '⏱️ Plazo ofrecido', cifra: p.dias_estimados ? `${p.dias_estimados} días` : '—', sub: 'desde que se compra', tono: 'gris' },
  ]);
  const notas = [{ tono: 'azul', texto: '<b>El cliente ya pagó el abono:</b> hay que generar la compra de esta pantalla al proveedor internacional.' }];
  if (sinModelo) notas.push({ tono: 'amarillo', texto: 'El cliente no indicó el modelo en el pedido: contáctalo para confirmarlo antes de comprar.' });
  const contacto = [p.cliente_telefono ? `Teléfono: ${esc(p.cliente_telefono)}` : null, p.cliente_email ? `Correo: ${esc(p.cliente_email)}` : null].filter(Boolean);
  const cuerpo = kpis + avisos(notas) + (contacto.length ? seccion('Contacto del cliente', 'Para confirmar el modelo o avisarle de la compra.', `<p style="margin:0;font-size:14px;line-height:1.6;">${contacto.join('<br>')}</p>`) : '');
  const html = armarCorreo({
    etiqueta: 'IndexStore · Compras',
    titulo: 'Pantalla a pedido: hay que generar la compra',
    subtitulo: `${esc(orden)}${ejemplo ? ' · EJEMPLO' : ''}`,
    cuerpo,
    boton: { url: `${urlBase}/pedidos-pantallas.html`, texto: 'Ver el pedido en el ERP' },
    leyenda: 'este aviso sale una sola vez por pedido, cuando el abono queda pagado. El seguimiento (compra, llegada, entrega) se lleva en Compras > Pantallas a pedido.',
  });
  const asunto = `Pantalla a pedido por comprar: ${sinModelo ? 'modelo por confirmar' : p.modelo} · ${orden}${ejemplo ? ' · EJEMPLO' : ''}`;
  return { asunto, html };
}

// /lib/correo-cotizacion-web.js
// Aviso por correo al equipo comercial cuando un cliente crea una cotización en indexstore.cl (/pages/cotizar): quién es, qué cotizó y cómo contactarlo,
// para poder hacerle seguimiento sin esperar a que pague. Función pura de armado (sin red ni base de datos) con el diseño estándar de lib/correo-base.js.
// Sin montos, ventas ni costos: solo productos y cantidades. La notificación se administra en Usuarios > Notificaciones (tipo 'cotizacion-web-nueva').
import { esc, num, plural, tarjetas, avisos, seccion, tabla, masEnElErp, armarCorreo } from './correo-base.js';
import { obtenerSuscriptoresEmail, notificacionDebeEnviarse, marcarNotificacionEnviada } from './notificaciones.js';
import { asegurarTablaNotificaciones } from './db.js';

export const TIPO_AVISO_COTIZACION_WEB = 'cotizacion-web-nueva';
const MAX_FILAS = 15;

const cuando = (v) => (v ? new Date(v).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const urlSegura = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);

// fila: fila de cotizaciones_web. lineas: los productos (sku, titulo, cantidad); si no se pasan se usan los guardados en la fila.
export function armarCorreoCotizacionWebNueva(fila, lineas, { urlBase = 'https://erp.indexstore.cl', ejemplo = false } = {}) {
  const productos = (lineas || fila.items || []).filter(l => l && l.titulo);
  const unidades = productos.reduce((t, l) => t + (Number(l.cantidad) || 0), 0);
  const numero = fila.bsale_numero ? `N° ${fila.bsale_numero}` : 'sin número';
  const retiro = !fila.envio_nombre || /retiro/i.test(String(fila.envio_nombre));
  const kpis = tarjetas([
    { etiqueta: '🧾 Cotización', cifra: esc(numero), sub: 'creada en Bsale', tono: 'azul' },
    { etiqueta: '🏢 Cliente', cifra: esc(fila.razon_social || fila.nombre || '—'), sub: fila.razon_social && fila.nombre ? esc(fila.nombre) : '', tono: 'azul' },
    { etiqueta: '🛒 Productos', cifra: num(productos.length), sub: `${num(unidades)} ${plural(unidades, 'unidad', 'unidades')}`, tono: 'gris' },
    { etiqueta: retiro ? '🏬 Retiro' : '🚚 Despacho', cifra: esc(fila.comuna || '—'), sub: esc(fila.envio_nombre || 'Retiro en tienda'), tono: 'gris' },
  ]);
  const notas = [{ tono: 'azul', texto: '<b>Un cliente creó una cotización en la web.</b> Recibió el enlace por correo y tiene 3 días para pagarla; es un buen momento para escribirle o llamarlo.' }];
  const contacto = [
    fila.nombre ? `Nombre: ${esc(fila.nombre)}` : null,
    fila.email ? `Correo: ${esc(fila.email)}` : null,
    fila.telefono ? `Teléfono: ${esc(fila.telefono)}` : null,
    fila.rut ? `RUT: ${esc(fila.rut)}` : null,
    `Vigente hasta: ${esc(cuando(fila.vence_en))}`,
  ].filter(Boolean);
  const bsale = urlSegura(fila.bsale_url);
  const filas = productos.slice(0, MAX_FILAS).map(l => [esc(l.sku || '—'), esc(l.titulo), esc(num(Number(l.cantidad) || 0))]);
  const cuerpo = kpis + avisos(notas) +
    seccion('Qué cotizó', 'Los productos y cantidades de la cotización.', tabla([{ titulo: 'SKU' }, { titulo: 'Producto' }, { titulo: 'Cant.', alinear: 'right', ancho: 60 }], filas, { pie: productos.length > MAX_FILAS ? masEnElErp(productos.length - MAX_FILAS) : null })) +
    seccion('Contacto', 'Para hacerle seguimiento.', `<p style="margin:0;font-size:14px;line-height:1.6;">${contacto.join('<br>')}${bsale ? `<br><a href="${esc(bsale)}">Ver la cotización en Bsale</a>` : ''}</p>`);
  const html = armarCorreo({
    etiqueta: 'IndexStore · Comercial',
    titulo: 'Nueva cotización web',
    subtitulo: `${esc(numero)} · ${esc(fila.razon_social || fila.nombre || 'cliente')}${ejemplo ? ' · EJEMPLO' : ''}`,
    cuerpo,
    boton: { url: `${urlBase}/cotizaciones-web.html`, texto: 'Ver las cotizaciones web en el ERP' },
    leyenda: 'este aviso sale cada vez que un cliente crea una cotización en indexstore.cl. Ahí mismo puedes dejar el estado de seguimiento y un comentario de cada cotización.',
  });
  const asunto = `Nueva cotización web ${numero} · ${fila.razon_social || fila.nombre || 'cliente'}${ejemplo ? ' · EJEMPLO' : ''}`;
  return { asunto, html };
}

// Manda el aviso a quienes estén suscritos (Usuarios > Notificaciones). Nunca debe hacer fallar la creación de la cotización: quien lo llama lo envuelve en try/catch.
export async function avisarCotizacionWebNueva({ sql, enviarCorreo }, fila, lineas) {
  await asegurarTablaNotificaciones(sql);
  if (!(await notificacionDebeEnviarse(sql, TIPO_AVISO_COTIZACION_WEB))) return { enviado: false, motivo: 'notificación inactiva' };
  const destinatarios = await obtenerSuscriptoresEmail(sql, TIPO_AVISO_COTIZACION_WEB);
  if (!destinatarios.length) return { enviado: false, motivo: 'sin destinatarios' };
  const { asunto, html } = armarCorreoCotizacionWebNueva(fila, lineas);
  let enviados = 0; const errores = [];
  for (const para of destinatarios) {
    const r = await enviarCorreo({ para, asunto, html });
    if (r && r.enviado) enviados++; else errores.push(String((r && r.motivo) || 'sin motivo').slice(0, 200));
  }
  if (enviados > 0) await marcarNotificacionEnviada(sql, TIPO_AVISO_COTIZACION_WEB, { asunto, html });
  return { enviado: enviados > 0, enviados, errores };
}

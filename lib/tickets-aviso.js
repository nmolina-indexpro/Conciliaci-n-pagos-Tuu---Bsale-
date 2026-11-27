// /lib/tickets-aviso.js
// Aviso por correo al equipo cuando un cliente escribe a soporteti@indexpro.cl: "Nicolás Molina ha creado un nuevo ticket" / "Nicolás Molina respondió el ticket".
// Reemplaza al aviso en inglés de Zoho Desk ("… has submitted a new ticket"): sale del ERP, en español, y el botón "Ver ticket" abre el ticket en el ERP.
// Es una notificación más de Usuarios > Notificaciones (tipo 'tickets-soporte-ti'): ahí se elige quién la recibe. Se arma con lib/correo-base.js (diseño estándar del ERP).
// Funciones puras para armar el correo; el envío nunca hace fallar la recepción del correo del cliente.

import { armarCorreo, datos, avisos, esc } from './correo-base.js';
import { enviarCorreo } from './mailer.js';
import { asegurarTablaNotificaciones } from './db.js';
import { notificacionDebeEnviarse, obtenerSuscriptoresEmail, marcarNotificacionEnviada } from './notificaciones.js';

export const TIPO_AVISO_TI = 'tickets-soporte-ti';
export const URL_ERP = 'https://erp.indexstore.cl';

const fechaHora = (iso) => new Date(iso || Date.now()).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const recorta = (t, n) => { const s = String(t ?? '').trim(); return s.length > n ? s.slice(0, n).trimEnd() + '…' : s; };

// aviso: { evento: 'creado' | 'respuesta', ticketId, numero, asunto, cliente: { nombre, email }, texto, fecha, reabierto, adjuntos, ejemplo }
export function armarCorreoTicketTI(aviso, { urlBase = URL_ERP } = {}) {
  const nombre = String(aviso.cliente?.nombre || '').trim() || String(aviso.cliente?.email || 'Un cliente');
  const creado = aviso.evento !== 'respuesta';
  const accion = creado ? 'ha creado un nuevo ticket' : 'respondió el ticket';
  const asuntoTicket = recorta(aviso.asunto || 'Solicitud de soporte', 120);
  const asunto = `${nombre} ${accion} · #${aviso.numero} ${asuntoTicket}`;
  const url = `${urlBase}/tickets.html#t=${encodeURIComponent(aviso.ticketId)}`;
  const mensaje = recorta(aviso.texto, 1500);
  const cuerpo =
    (aviso.reabierto ? avisos([{ tono: 'naranja', texto: 'El ticket estaba <b>cerrado</b> y se <b>reabrió</b> con esta respuesta.' }]) : '')
    + datos([
      ['Ticket', `<b>#${esc(aviso.numero)}</b> · ${esc(asuntoTicket)}`],
      ['Cliente', `${esc(nombre)}${aviso.cliente?.email ? ` · ${esc(aviso.cliente.email)}` : ''}`],
      ['Tiquetera', 'Soporte TI'],
      ['Adjuntos', aviso.adjuntos ? `${Number(aviso.adjuntos)} archivo(s)` : ''],
    ])
    + `<h3 style="margin:22px 0 6px;font-size:14px;color:#0b2a5b;">${creado ? 'Mensaje del cliente' : 'Respuesta del cliente'}</h3>`
    + `<div style="background:#f5f8fe;border-left:4px solid #0b57d0;border-radius:8px;padding:12px 14px;font-size:13.5px;line-height:1.55;color:#1b2a41;white-space:pre-wrap;">${esc(mensaje) || '<i>(sin texto)</i>'}</div>`;
  const html = armarCorreo({
    etiqueta: 'IndexStore · Soporte TI',
    titulo: creado ? 'Nuevo ticket de soporte' : 'Respuesta en un ticket de soporte',
    subtitulo: `${esc(nombre)} ${accion} el ${fechaHora(aviso.fecha)}.`,
    cuerpo,
    boton: { url, texto: 'Ver ticket' },
  });
  return { asunto: aviso.ejemplo ? `[PRUEBA] ${asunto}` : asunto, html };
}

// Envía el aviso a los inscritos de 'tickets-soporte-ti'. Nunca lanza: devuelve { enviados, motivo }.
export async function notificarTicketTI(sql, aviso, { urlBase = URL_ERP, enviar = enviarCorreo } = {}) {
  try {
    await asegurarTablaNotificaciones(sql);
    if (!(await notificacionDebeEnviarse(sql, TIPO_AVISO_TI))) return { enviados: 0, motivo: 'notificación apagada' };
    const destinatarios = await obtenerSuscriptoresEmail(sql, TIPO_AVISO_TI);
    if (!destinatarios.length) return { enviados: 0, motivo: 'sin destinatarios' };
    const { asunto, html } = armarCorreoTicketTI(aviso, { urlBase });
    let ok = 0;
    for (const para of destinatarios) { const r = await enviar({ para, asunto, html }); if (r && r.enviado) ok++; }
    if (ok > 0) await marcarNotificacionEnviada(sql, TIPO_AVISO_TI, { asunto, html });
    return { enviados: ok, destinatarios: destinatarios.length };
  } catch (e) {
    console.warn('[tickets-aviso]', e.message);
    return { enviados: 0, motivo: String(e.message || e).slice(0, 150) };
  }
}

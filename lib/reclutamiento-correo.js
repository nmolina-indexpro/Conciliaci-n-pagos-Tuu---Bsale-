// /lib/reclutamiento-correo.js
// Correos de la agenda de entrevistas (Electrónica > Postulantes). Funciones puras con las piezas de lib/correo-base.js.
//  · armarCorreoConfirmacion: al postulante, cuando elige o cambia su horario (con el enlace de la videollamada).
//  · armarCorreoAvisoReserva: al equipo (Usuarios > Notificaciones, tipo 'entrevistas-reserva'). Sin montos ni datos financieros.
import { esc, armarCorreo, datos, avisos } from './correo-base.js';
import { textoFechaHora, primerNombre, horaChile, CARGO_POR_DEFECTO } from './reclutamiento.js';

const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

export function armarCorreoConfirmacion({ postulante, inicio, fin, enlaceVideo, urlAgenda, aviso = '' }) {
  const cuando = cap(textoFechaHora(inicio));
  const cuerpo = `<p style="margin:0 0 12px;font-size:14.5px;line-height:1.6;">Hola, ${esc(primerNombre(postulante.nombre))}: tu entrevista por videollamada quedó agendada.</p>`
    + datos([
      ['Cuándo', `<b>${esc(cuando)}</b> (hora de Chile) · hasta las ${esc(horaChile(fin))}`],
      ['Cargo', esc(postulante.cargo || CARGO_POR_DEFECTO)],
      ['Videollamada', enlaceVideo ? `<a href="${esc(enlaceVideo)}" style="color:#0b57d0;font-weight:600;">${esc(enlaceVideo)}</a>` : 'Te enviaremos el enlace antes de la entrevista.'],
    ])
    + avisos([{ tono: 'azul', texto: 'Conéctate unos minutos antes, con buena luz y sonido. Conviene tener a mano ejemplos de reparaciones que hayas hecho (síntoma, qué mediste y qué cambiaste).' }, aviso ? { tono: 'gris', texto: esc(aviso) } : null].filter(Boolean));
  const html = armarCorreo({
    etiqueta: 'IndexStore · Entrevista', titulo: 'Tu entrevista quedó agendada', subtitulo: esc(`${cuando} (hora de Chile)`), cuerpo,
    botones: urlAgenda ? [{ url: urlAgenda, texto: 'Ver o cambiar mi horario' }] : [],
    pie: `<b style="color:#0b2a5b;">IndexStore · Reclutamiento</b><br>Recibes este correo porque elegiste un horario de entrevista para el cargo de ${esc(postulante.cargo || CARGO_POR_DEFECTO)}. Si no fuiste tú, puedes ignorarlo.`,
  });
  return { asunto: `Entrevista agendada: ${cuando}`, html };
}

// Correo al postulante cuando el equipo agrega o cambia el enlace de la videollamada de SU entrevista.
export function armarCorreoEnlaceVideo({ postulante, inicio, fin, enlaceVideo, urlAgenda }) {
  const cuando = cap(textoFechaHora(inicio));
  const cuerpo = `<p style="margin:0 0 12px;font-size:14.5px;line-height:1.6;">Hola, ${esc(primerNombre(postulante.nombre))}: este es el enlace de la videollamada de tu entrevista.</p>`
    + datos([
      ['Cuándo', `<b>${esc(cuando)}</b> (hora de Chile) · hasta las ${esc(horaChile(fin))}`],
      ['Videollamada', `<a href="${esc(enlaceVideo)}" style="color:#0b57d0;font-weight:600;">${esc(enlaceVideo)}</a>`],
    ]);
  const html = armarCorreo({
    etiqueta: 'IndexStore · Entrevista', titulo: 'Enlace de tu videollamada', subtitulo: esc(`${cuando} (hora de Chile)`), cuerpo,
    botones: [{ url: enlaceVideo, texto: 'Abrir la videollamada' }, ...(urlAgenda ? [{ url: urlAgenda, texto: 'Ver o cambiar mi horario' }] : [])],
    pie: `<b style="color:#0b2a5b;">IndexStore · Reclutamiento</b><br>Recibes este correo porque tienes una entrevista agendada. Si no fuiste tú, puedes ignorarlo.`,
  });
  return { asunto: `Enlace de tu videollamada: ${cuando}`, html };
}

// tipo: 'reserva' | 'cambio' | 'cancelacion'
export function armarCorreoAvisoReserva({ postulante, inicio, inicioAnterior = null, tipo = 'reserva', urlErp, sinEnlace = false }) {
  const cuando = inicio ? cap(textoFechaHora(inicio)) : '';
  const titulo = tipo === 'cancelacion' ? 'Un postulante canceló su entrevista' : tipo === 'cambio' ? 'Un postulante cambió su horario' : 'Un postulante agendó su entrevista';
  const filas = [
    ['Postulante', `<b>${esc(postulante.nombre)}</b>`],
    ['Cargo', esc(postulante.cargo || CARGO_POR_DEFECTO)],
    tipo === 'cancelacion' ? ['Horario cancelado', esc(cap(textoFechaHora(inicioAnterior || inicio)))] : ['Nuevo horario', `<b>${esc(cuando)}</b> (hora de Chile)`],
    tipo === 'cambio' && inicioAnterior ? ['Horario anterior', esc(cap(textoFechaHora(inicioAnterior)))] : null,
    ['Correo', postulante.email ? esc(postulante.email) : ''],
    ['Teléfono', postulante.telefono ? esc(postulante.telefono) : ''],
  ].filter(Boolean);
  const cuerpo = datos(filas) + (sinEnlace && tipo !== 'cancelacion' ? avisos([{ tono: 'naranja', texto: '<b>Falta el enlace de la videollamada</b> de esta entrevista: créalo (por ejemplo en Google Meet) y agrégalo en Postulantes; ahí mismo puedes avisarle al postulante.' }]) : '');
  const html = armarCorreo({
    etiqueta: 'IndexStore · Reclutamiento', titulo, subtitulo: tipo === 'cancelacion' ? '' : esc(`${cuando} · videollamada`), cuerpo,
    boton: { url: `${urlErp}/electronica.html#postulantes`, texto: 'Abrir Postulantes en el ERP' },
    leyenda: 'Los horarios se administran en Servicio Técnico > Electrónica > Postulantes. Quién recibe este aviso se cambia en Usuarios > Notificaciones.',
  });
  return { asunto: `${titulo}: ${postulante.nombre}${cuando ? ' · ' + cuando : ''}`, html };
}

// /lib/zoho-cotizaciones.js
// Vincula los tickets de Zoho Desk (servicio técnico: la correspondencia con el cliente no pasa por los
// buzones de correo del ERP) con una cotización de Bsale. Funciones puras, sin imports ni red.
//
// Cómo se relaciona un ticket con una cotización:
//   - EXACTO: el texto del ticket (resolución, asunto, hilos) menciona el número de la cotización
//     ("Cot. 9754", "Cotización N° 9754"...). Es lo que deja el técnico al cerrar la orden de servicio.
//   - CLIENTE: el ticket es del mismo correo del cliente pero no menciona esta cotización (otra orden del
//     mismo cliente, o una orden todavía abierta que no cita la cotización). Se muestra, pero marcado.

const RE_COTIZACION = /\bcot(?:iz(?:aci[oó]n)?)?\.?\s*(?:n[°ºo]\.?\s*)?#?\s*(\d{3,7})\b/gi;

// Números de cotización citados en un texto libre. Devuelve un arreglo de strings sin repetir.
export function numerosCotizacionEnTexto(texto) {
  const hallados = new Set();
  const t = String(texto || '');
  RE_COTIZACION.lastIndex = 0;
  let m;
  while ((m = RE_COTIZACION.exec(t)) !== null) hallados.add(m[1]);
  return [...hallados];
}

export function textoPlano(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(div|p|li|tr)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;|&#34;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ').trim();
}

function direccionDeHilo(h) {
  return h.direction === 'out' ? 'saliente' : 'entrante';
}

// Hilos públicos de un ticket, listos para mostrar. Quedan fuera: las notas internas (type 'comment') y el hilo
// de descripción (la ficha de ingreso que genera el sistema al abrir la orden), que no es una comunicación.
// Ver `ingresoEn` para la fecha de apertura.
export function normalizarHilosTicket(ticket, conversaciones, { largoResumen = 220 } = {}) {
  const hilos = [];
  let ingresoEn = ticket?.createdTime || null;
  for (const c of conversaciones || []) {
    if (!c || c.type !== 'thread') continue;
    if (c.isDescriptionThread) { ingresoEn = c.createdTime || ingresoEn; continue; }
    if (c.visibility && c.visibility !== 'public') continue;
    if (c.status && c.status !== 'SUCCESS') continue; // borradores / envíos fallidos
    hilos.push({
      id: c.id,
      ticketId: ticket?.id || null,
      ticketNumero: ticket?.ticketNumber || null,
      direccion: direccionDeHilo(c),
      fecha: c.createdTime || null,
      autor: c.author?.name || c.author?.email || null,
      correoAutor: c.author?.email || null,
      resumen: textoPlano(c.summary).slice(0, largoResumen),
      adjuntos: Number(c.attachmentCount || 0),
      canal: c.channel || null,
    });
  }
  hilos.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  return { hilos, ingresoEn };
}

// Decide cómo se relaciona un ticket con la cotización (numero = número de documento en Bsale).
export function vinculoTicketConCotizacion(ticket, hilos, numeroCotizacion) {
  const num = String(numeroCotizacion || '').replace(/\D/g, '');
  if (!num) return { tipo: 'cliente', motivo: 'Mismo cliente' };
  const fuentes = [
    ['la resolución', ticket?.resolution],
    ['el asunto', ticket?.subject],
    ['la descripción', textoPlano(ticket?.description)],
    ...(hilos || []).map(h => ['un mensaje', h.resumen]),
  ];
  for (const [donde, texto] of fuentes) {
    if (numerosCotizacionEnTexto(texto).includes(num)) return { tipo: 'exacto', motivo: `Cita la cotización ${num} en ${donde}` };
  }
  return { tipo: 'cliente', motivo: 'Mismo cliente (no cita esta cotización)' };
}

// Métricas por cotización a partir de todos los hilos de los tickets vinculados.
export function resumenComunicacion(hilos) {
  const salientes = hilos.filter(h => h.direccion === 'saliente');
  const entrantes = hilos.filter(h => h.direccion === 'entrante');
  const ultimo = hilos.reduce((m, h) => Math.max(m, h.fecha ? new Date(h.fecha).getTime() : 0), 0);
  const ultimoEntrante = entrantes.reduce((m, h) => Math.max(m, h.fecha ? new Date(h.fecha).getTime() : 0), 0);
  const ultimoSaliente = salientes.reduce((m, h) => Math.max(m, h.fecha ? new Date(h.fecha).getTime() : 0), 0);
  return {
    salientes: salientes.length,
    entrantes: entrantes.length,
    ultimoContacto: ultimo ? new Date(ultimo).toISOString() : null,
    ultimoEntrante: ultimoEntrante ? new Date(ultimoEntrante).toISOString() : null,
    ultimoSaliente: ultimoSaliente ? new Date(ultimoSaliente).toISOString() : null,
    // el cliente escribió después de nuestro último mensaje: queda pendiente responderle
    pendienteDeRespuesta: ultimoEntrante > ultimoSaliente,
  };
}

// Arma la respuesta completa: tickets (exactos primero, luego del cliente, más nuevos primero) + hilos mezclados.
// `datos` = [{ ticket, conversaciones }]
export function armarComunicacionZoho(datos, numeroCotizacion) {
  const tickets = [];
  let todos = [];
  for (const { ticket, conversaciones } of datos) {
    const { hilos, ingresoEn } = normalizarHilosTicket(ticket, conversaciones);
    const vinculo = vinculoTicketConCotizacion(ticket, hilos, numeroCotizacion);
    const hilosTicket = hilos.map(h => ({ ...h, vinculo: vinculo.tipo }));
    tickets.push({
      id: ticket.id,
      numero: ticket.ticketNumber,
      asunto: ticket.subject || '',
      estado: ticket.status || '',
      cerrado: ticket.statusType === 'Closed',
      creado: ingresoEn,
      agente: ticket.assignee ? `${ticket.assignee.firstName || ''} ${ticket.assignee.lastName || ''}`.trim() : null,
      motivoIngreso: ticket.cf?.cf_motivo_ingreso || null,
      resolucion: ticket.resolution || null,
      url: ticket.webUrl || null,
      vinculo: vinculo.tipo,
      motivoVinculo: vinculo.motivo,
      salientes: hilosTicket.filter(h => h.direccion === 'saliente').length,
      entrantes: hilosTicket.filter(h => h.direccion === 'entrante').length,
    });
    todos = todos.concat(hilosTicket);
  }
  tickets.sort((a, b) => (a.vinculo === b.vinculo ? 0 : a.vinculo === 'exacto' ? -1 : 1) || new Date(b.creado || 0) - new Date(a.creado || 0));
  todos.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
  const exactos = todos.filter(h => h.vinculo === 'exacto');
  return {
    tickets,
    hilos: todos,
    // si hay tickets que citan la cotización, el resumen se calcula solo con ellos; si no, con todos los del cliente
    resumen: resumenComunicacion(exactos.length ? exactos : todos),
    resumenCliente: resumenComunicacion(todos),
    basadoEnExactos: exactos.length > 0,
  };
}

export const CASILLA_ZOHO = 'Zoho Desk';

// Convierte los hilos de Zoho en filas de cotizaciones_correos (mismo formato que los correos detectados por IMAP),
// para que cuenten solos en "último contacto", en los estados automáticos y en Rendimiento.
//   - cliente_email: el correo del cliente (contacto del ticket).
//   - cotizacion_id: solo si el ticket cita el número de una cotización de ESE cliente; si no, queda null y el cruce
//     se hace por correo del cliente (igual que con los correos normales).
// `cotizaciones` = [{ id, numero }] de las cotizaciones de ese correo.
export function filasCorreosDesdeZoho(datos, cotizaciones, correoCliente) {
  const filas = [];
  const porNumero = new Map((cotizaciones || []).map(c => [String(c.numero).replace(/\D/g, ''), c.id]));
  for (const { ticket, conversaciones } of datos || []) {
    const { hilos } = normalizarHilosTicket(ticket, conversaciones, { largoResumen: 400 });
    const citados = new Set([
      ...numerosCotizacionEnTexto(ticket?.resolution), ...numerosCotizacionEnTexto(ticket?.subject),
      ...hilos.flatMap(h => numerosCotizacionEnTexto(h.resumen)),
    ]);
    const cotId = [...citados].map(n => porNumero.get(n)).find(Boolean) || null;
    for (const h of hilos) {
      if (!h.fecha) continue;
      filas.push({
        messageId: `zoho:${h.id}`,
        direccion: h.direccion,
        clienteEmail: String(correoCliente || '').toLowerCase(),
        cotizacionId: cotId,
        asunto: `${ticket?.subject || 'Ticket'} (#${ticket?.ticketNumber || ''})`.trim(),
        fecha: h.fecha,
        contenido: h.resumen || null,
      });
    }
  }
  return filas;
}

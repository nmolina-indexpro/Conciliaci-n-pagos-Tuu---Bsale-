// /lib/whatsapp-mensajes-accion.js
// Opciones del menú de cada mensaje del chat (Responder, Reaccionar, Descargar, Reenviar). Aquí solo hay lógica pura y probada: cómo se arma lo que se manda a
// la API de WhatsApp (Meta), qué emojis se pueden usar, cómo se resume un mensaje citado y cómo se llama el archivo al descargarlo.
// El envío, la descarga y el guardado viven en api/negocio.js (manejarWhatsappMensajeAccion y manejarWhatsappMedia).

// Reacciones que ofrece el menú (las mismas seis que WhatsApp muestra primero).
export const EMOJIS_REACCION = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// Tipo del ERP -> tipo de la API de WhatsApp. Lo que no está acá (stickers, ubicaciones…) no se puede reenviar.
export const TIPO_META_DESDE_TIPO = { imagen: 'image', audio: 'audio', video: 'video', documento: 'document' };

// Devuelve el emoji válido ('' quita la reacción) o lanza un Error con un mensaje listo para mostrar.
export function validarEmojiReaccion(entrada) {
  const e = String(entrada ?? '').trim();
  if (e === '') return '';
  if (!EMOJIS_REACCION.includes(e)) throw new Error('Esa reacción no está disponible.');
  return e;
}

// Qué se muestra como "mensaje citado" cuando una respuesta apunta a otro mensaje.
export function citaDeMensaje(m) {
  if (!m) return null;
  const texto = String(m.contenido_texto ?? m.texto ?? '').replace(/\s+/g, ' ').trim();
  const tipo = m.tipo || 'texto';
  const etiqueta = { imagen: '📷 Foto', audio: '🎤 Audio', video: '🎥 Video', documento: '📄 Documento' }[tipo];
  const cuerpo = texto ? (etiqueta ? `${etiqueta} · ${texto}` : texto) : (etiqueta || '[mensaje]');
  return { direccion: m.direccion === 'out' ? 'out' : 'in', texto: cuerpo.slice(0, 140), tipo };
}

// Cuerpo de un mensaje normal (texto o archivo ya subido a Meta). respuestaAWaId = id de WhatsApp del mensaje que se cita.
export function armarCuerpoMensaje({ para, tipo, texto, mediaId, nombreArchivo, respuestaAWaId }) {
  if (!para) throw new Error('Falta el destinatario.');
  const cuerpo = { messaging_product: 'whatsapp', to: String(para) };
  if (tipo === 'texto' || !tipo) {
    const t = String(texto ?? '').trim().slice(0, 4096);
    if (!t) throw new Error('El mensaje está vacío.');
    cuerpo.type = 'text';
    cuerpo.text = { body: t };
  } else {
    const tipoMeta = TIPO_META_DESDE_TIPO[tipo];
    if (!tipoMeta) throw new Error('Ese tipo de mensaje no se puede reenviar.');
    if (!mediaId) throw new Error('Falta el archivo.');
    cuerpo.type = tipoMeta;
    cuerpo[tipoMeta] = { id: String(mediaId) };
    const pie = String(texto ?? '').trim().slice(0, 1024);
    if (pie && (tipoMeta === 'image' || tipoMeta === 'video' || tipoMeta === 'document')) cuerpo[tipoMeta].caption = pie;
    if (tipoMeta === 'document' && nombreArchivo) cuerpo[tipoMeta].filename = String(nombreArchivo).slice(0, 240);
  }
  if (respuestaAWaId) cuerpo.context = { message_id: String(respuestaAWaId) };
  return cuerpo;
}

// Reacción a un mensaje del cliente. emoji '' = quitar la reacción.
export function armarCuerpoReaccion({ para, mensajeWaId, emoji }) {
  if (!para || !mensajeWaId) throw new Error('Falta el mensaje al que se reacciona.');
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: String(para), type: 'reaction', reaction: { message_id: String(mensajeWaId), emoji: validarEmojiReaccion(emoji) } };
}

const EXTENSION_POR_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'application/zip': 'zip',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};
export function extensionDeMime(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  return EXTENSION_POR_MIME[base] || '';
}

// Nombre del archivo que baja el navegador: WhatsApp-<tipo>-<día>-<id>.<ext>, sin caracteres raros.
export function nombreArchivoDescarga({ tipo, mime, mensajeId, fecha }) {
  const dia = (fecha ? new Date(fecha) : new Date()).toISOString().slice(0, 10);
  const etiqueta = { imagen: 'imagen', audio: 'audio', video: 'video', documento: 'documento' }[tipo] || 'archivo';
  const ext = extensionDeMime(mime);
  const id = String(mensajeId ?? '').replace(/[^\w-]/g, '').slice(0, 12);
  return `WhatsApp-${etiqueta}-${dia}${id ? '-' + id : ''}${ext ? '.' + ext : ''}`;
}

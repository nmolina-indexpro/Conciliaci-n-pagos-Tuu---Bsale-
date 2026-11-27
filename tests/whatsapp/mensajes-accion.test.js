// Opciones del menú de cada mensaje (responder, reaccionar, descargar, reenviar): lógica pura de lib/whatsapp-mensajes-accion.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMOJIS_REACCION, validarEmojiReaccion, citaDeMensaje, armarCuerpoMensaje, armarCuerpoReaccion, extensionDeMime, nombreArchivoDescarga,
} from '../../lib/whatsapp-mensajes-accion.js';

test('reacciones: solo los seis emojis del menú; vacío quita la reacción', () => {
  assert.equal(EMOJIS_REACCION.length, 6);
  for (const e of EMOJIS_REACCION) assert.equal(validarEmojiReaccion(e), e);
  assert.equal(validarEmojiReaccion(''), '');
  assert.equal(validarEmojiReaccion(null), '');
  assert.throws(() => validarEmojiReaccion('💩'), /no está disponible/);
});

test('cita: texto, foto con pie, documento sin texto y mensaje que no existe', () => {
  assert.deepEqual(citaDeMensaje({ direccion: 'in', tipo: 'texto', contenido_texto: '  Hola\n  buenas  ' }), { direccion: 'in', texto: 'Hola buenas', tipo: 'texto' });
  assert.equal(citaDeMensaje({ direccion: 'out', tipo: 'imagen', contenido_texto: 'mira' }).texto, '📷 Foto · mira');
  assert.equal(citaDeMensaje({ direccion: 'in', tipo: 'imagen', contenido_texto: null }).texto, '📷 Foto');
  assert.equal(citaDeMensaje({ direccion: 'in', tipo: 'documento' }).texto, '📄 Documento');
  assert.equal(citaDeMensaje({ direccion: 'in', tipo: 'texto', contenido_texto: 'x'.repeat(500) }).texto.length, 140);
  assert.equal(citaDeMensaje(undefined), null);
});

test('mensaje de texto: cuerpo de la API, con y sin cita', () => {
  assert.deepEqual(armarCuerpoMensaje({ para: '56912345678', tipo: 'texto', texto: ' Hola ' }),
    { messaging_product: 'whatsapp', to: '56912345678', type: 'text', text: { body: 'Hola' } });
  const conCita = armarCuerpoMensaje({ para: '56912345678', tipo: 'texto', texto: 'Sí', respuestaAWaId: 'wamid.ABC' });
  assert.deepEqual(conCita.context, { message_id: 'wamid.ABC' });
  assert.throws(() => armarCuerpoMensaje({ para: '56912345678', tipo: 'texto', texto: '   ' }), /vacío/);
  assert.throws(() => armarCuerpoMensaje({ tipo: 'texto', texto: 'x' }), /destinatario/);
  assert.equal(armarCuerpoMensaje({ para: '1', tipo: 'texto', texto: 'a'.repeat(5000) }).text.body.length, 4096);
});

test('reenviar archivos: imagen con pie, documento con nombre, audio sin pie y tipos no soportados', () => {
  assert.deepEqual(armarCuerpoMensaje({ para: '1', tipo: 'imagen', mediaId: '99', texto: 'etiqueta' }).image, { id: '99', caption: 'etiqueta' });
  assert.deepEqual(armarCuerpoMensaje({ para: '1', tipo: 'documento', mediaId: '7', texto: '', nombreArchivo: 'cotizacion.pdf' }).document, { id: '7', filename: 'cotizacion.pdf' });
  assert.deepEqual(armarCuerpoMensaje({ para: '1', tipo: 'audio', mediaId: '5', texto: 'no lleva pie' }).audio, { id: '5' });
  assert.throws(() => armarCuerpoMensaje({ para: '1', tipo: 'imagen', texto: 'x' }), /Falta el archivo/);
  assert.throws(() => armarCuerpoMensaje({ para: '1', tipo: 'sticker', mediaId: '1' }), /no se puede reenviar/);
});

test('reacción: cuerpo de la API, y quitarla con emoji vacío', () => {
  assert.deepEqual(armarCuerpoReaccion({ para: '56912345678', mensajeWaId: 'wamid.X', emoji: '👍' }),
    { messaging_product: 'whatsapp', recipient_type: 'individual', to: '56912345678', type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '👍' } });
  assert.equal(armarCuerpoReaccion({ para: '1', mensajeWaId: 'wamid.X', emoji: '' }).reaction.emoji, '');
  assert.throws(() => armarCuerpoReaccion({ para: '1', emoji: '👍' }), /Falta el mensaje/);
  assert.throws(() => armarCuerpoReaccion({ para: '1', mensajeWaId: 'w', emoji: '🤡' }), /no está disponible/);
});

test('descarga: extensión según el tipo del archivo y nombre sin caracteres raros', () => {
  assert.equal(extensionDeMime('image/jpeg'), 'jpg');
  assert.equal(extensionDeMime('application/pdf; charset=binary'), 'pdf');
  assert.equal(extensionDeMime('algo/raro'), '');
  assert.equal(nombreArchivoDescarga({ tipo: 'imagen', mime: 'image/jpeg', mensajeId: 123, fecha: '2026-11-24T21:00:00Z' }), 'WhatsApp-imagen-2026-11-24-123.jpg');
  assert.equal(nombreArchivoDescarga({ tipo: 'documento', mime: 'application/pdf', mensajeId: '../../x y', fecha: '2026-11-24T21:00:00Z' }), 'WhatsApp-documento-2026-11-24-xy.pdf');
  assert.equal(nombreArchivoDescarga({ tipo: 'otro', mime: '', fecha: '2026-11-24T21:00:00Z' }), 'WhatsApp-archivo-2026-11-24');
});

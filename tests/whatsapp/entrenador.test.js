// Chat "Entrenar a la IA": validación, llamada a Gemini (simulada), casos candidatos, capturas y aprobación, con Postgres real en memoria (PGlite).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { reiniciarUnaVez } from '../../lib/una-vez.js';
import { aprobarCandidato } from '../../lib/whatsapp-bot-aprendizaje.js';
import { asegurarTablaEjemplosBot, listarEjemplos } from '../../lib/whatsapp-bot-ejemplos.js';
import {
  asegurarTablaEntrenador, validarEntrada, normalizarRespuestaIA, llamarGeminiEntrenador, construirSystemEntrenador, procesarMensajeEntrenador,
  listarMensajes, obtenerImagen, resumenEntrenador, MAX_IMAGEN_BYTES, MAX_TEXTO, MAX_APRENDIZAJES, HERRAMIENTA_ENTRENADOR,
} from '../../lib/whatsapp-entrenador.js';

async function crearBase() {
  const db = new PGlite();
  await db.waitReady;
  const salida = r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  const sql = async (strings, ...v) => salida(await db.query(strings.reduce((a, s, i) => a + s + (i < v.length ? `$${i + 1}` : ''), ''), v));
  sql.query = async (t, p = []) => salida(await db.query(t, p));
  reiniciarUnaVez();
  await asegurarTablaEntrenador(sql);
  await asegurarTablaEjemplosBot(sql);
  return { db, sql };
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const CONFIG = { conocimiento: 'IndexStore. Instalación gratis en tienda. Escritorio 12 años. https://www.indexstore.cl/pages/garantia', tono: 'cercano', reglasExtra: '' };
const APRENDIZAJE_OK = {
  pregunta_cliente: '¿Hacen instalación de la pantalla?',
  respuesta_modelo: 'Sí, la instalación es gratis en nuestra tienda de Providencia. ¿Quieres que te confirme el stock de tu modelo?',
  regla: 'Mencionar siempre que la instalación en tienda es gratis.', categoria: 'pantallas', riesgo: 'bajo',
};
const respuestaGemini = args => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'responder_entrenamiento', args } }] } }] }), text: async () => '' });
const fetchGemini = (args, estado = null) => {
  const llamadas = [];
  const fn = async (url, opts) => {
    llamadas.push({ url, opts, cuerpo: JSON.parse(opts.body) });
    return estado ? { ok: false, status: estado, text: async () => JSON.stringify({ error: { message: 'cuota agotada' } }), json: async () => ({}) } : respuestaGemini(args);
  };
  fn.llamadas = llamadas;
  return fn;
};

test('validarEntrada: exige texto o captura, tipo y tamaño de imagen', () => {
  assert.throws(() => validarEntrada({}), /texto o adjunta/i);
  assert.throws(() => validarEntrada({ texto: 'x'.repeat(MAX_TEXTO + 1) }), /demasiado largo/);
  assert.throws(() => validarEntrada({ imagen: { mime: 'application/pdf', datos: 'AAAA' } }), /JPG, PNG o WebP/);
  assert.throws(() => validarEntrada({ imagen: { mime: 'image/png', datos: '' } }), /vacía/);
  assert.throws(() => validarEntrada({ imagen: { mime: 'image/png', datos: Buffer.alloc(MAX_IMAGEN_BYTES + 1).toString('base64') } }), /pesada/);
  const v = validarEntrada({ texto: '  hola \r\n mundo ', imagen: { mime: 'IMAGE/PNG', datos: 'data:image/png;base64,' + PNG.toString('base64') } });
  assert.equal(v.texto, 'hola \n mundo');
  assert.equal(v.imagen.mime, 'image/png');
  assert.deepEqual([...v.imagen.bytes], [...PNG]);
  assert.equal(validarEntrada({ imagen: { mime: 'image/png', datos: PNG.toString('base64') } }).texto, ''); // solo captura
});

test('normalizarRespuestaIA: anonimiza, descarta lo corto, limita la cantidad y sube el riesgo si hay precios o enlaces no verificados', () => {
  const r = normalizarRespuestaIA({
    respuesta_chat: 'Aprendí 3 cosas',
    aprendizajes: [
      { ...APRENDIZAJE_OK, pregunta_cliente: '¿Cuánto sale? escríbeme a juan@correo.cl o al +56 9 1234 5678', riesgo: 'bajo' },
      { pregunta_cliente: 'hola', respuesta_modelo: 'Hola, ¿en qué te ayudo con tu notebook hoy?', categoria: 'otro', riesgo: 'bajo' },        // pregunta demasiado corta
      { pregunta_cliente: '¿Cuánto cuesta la pantalla?', respuesta_modelo: 'La pantalla cuesta $45.990 con instalación incluida en tienda.', categoria: 'inventada', riesgo: 'bajo' },
      { pregunta_cliente: '¿Tienen garantía?', respuesta_modelo: 'Sí, mira las condiciones en https://www.indexstore.cl/pages/garantia y cuéntame tu caso.', categoria: 'garantías', riesgo: 'medio' },
      { pregunta_cliente: '¿Y si no es la pantalla?', respuesta_modelo: 'Mira https://sitio-externo.com/oferta para ver otra opción disponible.', categoria: 'otro' },
    ],
  }, { conocimiento: CONFIG.conocimiento });
  assert.equal(r.respuestaChat, 'Aprendí 3 cosas');
  assert.equal(r.aprendizajes.length, 4); // se descartó la pregunta corta
  const [a, b, c, d] = r.aprendizajes;
  assert.match(a.pregunta, /\[correo\]/);
  assert.match(a.pregunta, /\[teléfono\]/);
  assert.doesNotMatch(a.pregunta, /juan@|1234/);
  assert.equal(b.riesgo, 'alto'); assert.match(b.alertas.join(' '), /Precio no verificado/); assert.equal(b.categoria, 'otro'); // categoría inventada -> otro
  assert.equal(c.riesgo, 'medio'); assert.deepEqual(c.alertas, []); // el enlace oficial de la base no es un problema
  assert.match(d.respuesta, /\[enlace\]/); assert.doesNotMatch(d.respuesta, /sitio-externo/); // los enlaces ajenos a indexstore.cl se quitan antes de guardar
  const muchos = normalizarRespuestaIA({ respuesta_chat: 'ok', aprendizajes: Array.from({ length: 9 }, (_, i) => ({ ...APRENDIZAJE_OK, pregunta_cliente: `Pregunta número ${i} del cliente` })) }, {});
  assert.equal(muchos.aprendizajes.length, MAX_APRENDIZAJES);
  assert.equal(normalizarRespuestaIA({}, {}).respuestaChat, 'Listo, lo revisé.');
});

test('el system prompt incluye el protocolo, la base y la regla de no copiar datos personales', () => {
  const s = construirSystemEntrenador({ conocimiento: 'BASE-XYZ', tono: 'TONO-ABC', reglasExtra: 'REGLA-123' });
  for (const trozo of ['BASE-XYZ', 'TONO-ABC', 'REGLA-123', 'PROTOCOLO COMERCIAL', 'NO copies datos personales', 'NO escribas precios']) assert.ok(s.includes(trozo), trozo);
});

test('llamarGeminiEntrenador arma la petición con la captura, el historial y la herramienta obligatoria', async () => {
  const f = fetchGemini({ respuesta_chat: 'ok', aprendizajes: [] });
  const args = await llamarGeminiEntrenador({
    apiKey: 'clave-de-prueba', modelo: 'gemini-x', system: 'SISTEMA', fetchFn: f, texto: 'mira esto',
    imagen: { mime: 'image/png', bytes: PNG },
    historial: [{ rol: 'usuario', texto: 'hola' }, { rol: 'ia', texto: 'hola, dime' }, { rol: 'usuario', texto: '', tieneImagen: true }],
  });
  assert.equal(args.respuesta_chat, 'ok');
  const { url, opts, cuerpo } = f.llamadas[0];
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
  assert.equal(opts.headers['x-goog-api-key'], 'clave-de-prueba');
  assert.equal(cuerpo.system_instruction.parts[0].text, 'SISTEMA');
  assert.deepEqual(cuerpo.contents.map(c => c.role), ['user', 'model', 'user', 'user']);
  assert.match(cuerpo.contents[2].parts[0].text, /captura/); // una captura anterior sin texto se indica
  const ultimo = cuerpo.contents[3].parts;
  assert.equal(ultimo[0].text, 'mira esto');
  assert.equal(ultimo[1].inline_data.mime_type, 'image/png');
  assert.equal(ultimo[1].inline_data.data, PNG.toString('base64'));
  assert.equal(cuerpo.tools[0].function_declarations[0].name, HERRAMIENTA_ENTRENADOR.name);
  assert.equal(cuerpo.tool_config.function_calling_config.mode, 'ANY');
  // sin llamada a la herramienta: se usa el texto libre y no se registra nada
  const libre = await llamarGeminiEntrenador({ apiKey: 'k', modelo: 'm', system: 's', texto: 'x', fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Respuesta libre' }] } }] }) }) });
  assert.deepEqual(libre, { respuesta_chat: 'Respuesta libre', aprendizajes: [] });
  await assert.rejects(() => llamarGeminiEntrenador({ apiKey: 'k', modelo: 'm', system: 's', texto: 'x', fetchFn: fetchGemini({}, 429) }), /sin cupo.*cuota agotada/);
  await assert.rejects(() => llamarGeminiEntrenador({ apiKey: 'k', modelo: 'm', system: 's', texto: 'x', fetchFn: fetchGemini({}, 500) }), /error \(500\)/);
  await assert.rejects(() => llamarGeminiEntrenador({ apiKey: 'k', modelo: 'm', system: 's', texto: 'x', fetchFn: async () => ({ ok: true, json: async () => ({ candidates: [] }) }) }), /no devolvió respuesta/);
});

test('un mensaje con captura queda guardado, la IA responde y cada aprendizaje es un caso pendiente; al aprobarlo se crea la pregunta modelo', async () => {
  const { db, sql } = await crearBase();
  const f = fetchGemini({ respuesta_chat: 'Entendido: la instalación en tienda es gratis.', aprendizajes: [APRENDIZAJE_OK, { ...APRENDIZAJE_OK, pregunta_cliente: '¿Cuánto demora la instalación?', respuesta_modelo: 'Depende del equipo; te confirmo el tiempo cuando me digas el modelo exacto. ¿Cuál es?', riesgo: 'alto' }] });
  const r = await procesarMensajeEntrenador(sql, {
    usuario: 'Nicolás', entrada: { texto: 'Siempre di que la instalación es gratis', imagen: { mime: 'image/png', datos: PNG.toString('base64') } },
    config: CONFIG, apiKey: 'k', modelo: 'gemini-x', fetchFn: f,
  });
  assert.deepEqual({ ok: r.ok, aprendizajes: r.aprendizajes }, { ok: true, aprendizajes: 2 });

  const chat = await listarMensajes(sql);
  assert.deepEqual(chat.map(m => m.rol), ['usuario', 'ia']);
  assert.equal(chat[0].usuario, 'Nicolás');
  assert.equal(chat[0].conImagen, true);
  assert.equal(chat[1].texto, 'Entendido: la instalación en tienda es gratis.');
  assert.equal(chat[1].aprendizajes.length, 2);
  assert.ok(chat[1].aprendizajes.every(a => a.estado === 'pendiente'));
  assert.equal(chat[1].aprendizajes[1].riesgo, 'alto');
  assert.match(f.llamadas[0].cuerpo.system_instruction.parts[0].text, /Instalación gratis en tienda/); // la IA ve la base de conocimiento

  const { rows: casos } = await sql.query(`SELECT tipo, estado, problema FROM whatsapp_bot_candidatos ORDER BY id;`);
  assert.equal(casos.length, 2);
  assert.ok(casos.every(c => c.tipo === 'entrenador' && c.estado === 'pendiente'));
  assert.match(casos[0].problema, /Nicolás.*chat de entrenamiento.*instalación es gratis/);

  const img = await obtenerImagen(sql, chat[0].id);
  assert.equal(img.mime, 'image/png');
  assert.deepEqual([...img.bytes], [...PNG]);
  assert.equal(await obtenerImagen(sql, chat[1].id), null); // el mensaje de la IA no tiene imagen
  assert.equal(await obtenerImagen(sql, 'abc'), null);

  let res = await resumenEntrenador(sql);
  assert.equal(res.pendientes, 2);
  assert.equal(res.ultimoRol, 'ia');

  // aprobar el primero (como en Bot WhatsApp > Aprendizaje): se crea la pregunta modelo con origen "entrenador"
  const a = chat[1].aprendizajes[0];
  const ok = await aprobarCandidato(sql, a.id, { pregunta: a.pregunta, respuesta: a.respuesta }, 'Nicolás');
  assert.ok(ok.ok);
  const ejemplos = await listarEjemplos(sql);
  assert.equal(ejemplos.length, 1);
  assert.equal(ejemplos[0].origen, 'entrenador');
  assert.equal((await listarMensajes(sql))[1].aprendizajes[0].estado, 'aprobado');
  res = await resumenEntrenador(sql);
  assert.deepEqual([res.pendientes, res.aprobados], [1, 1]);
  await db.close();
});

test('si la IA falla, el mensaje queda y aparece un aviso de error que no se manda como contexto; si el mensaje no sirve, no se guarda nada', async () => {
  const { db, sql } = await crearBase();
  const r = await procesarMensajeEntrenador(sql, { usuario: 'Ana', entrada: { texto: 'primer mensaje' }, config: CONFIG, apiKey: 'k', modelo: 'm', fetchFn: fetchGemini({}, 429) });
  assert.equal(r.ok, false);
  assert.match(r.error, /sin cupo/);
  let chat = await listarMensajes(sql);
  assert.deepEqual(chat.map(m => [m.rol, m.esError]), [['usuario', false], ['ia', true]]);
  assert.match(chat[1].texto, /No pude procesar tu mensaje/);
  assert.equal((await sql.query('SELECT COUNT(*)::int AS n FROM whatsapp_bot_candidatos;')).rows[0].n, 0);

  const f = fetchGemini({ respuesta_chat: 'ok', aprendizajes: [] });
  await procesarMensajeEntrenador(sql, { usuario: 'Ana', entrada: { texto: 'segundo mensaje' }, config: CONFIG, apiKey: 'k', modelo: 'm', fetchFn: f });
  const contexto = f.llamadas[0].cuerpo.contents.map(c => c.parts[0].text);
  assert.deepEqual(contexto, ['primer mensaje', 'segundo mensaje']); // el aviso de error no se le pasa a la IA

  await assert.rejects(() => procesarMensajeEntrenador(sql, { usuario: 'Ana', entrada: {}, config: CONFIG, apiKey: 'k', modelo: 'm', fetchFn: f }), /texto o adjunta/);
  assert.equal((await listarMensajes(sql)).length, 4); // nada nuevo se guardó
  await db.close();
});

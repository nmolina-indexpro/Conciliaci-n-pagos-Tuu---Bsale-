// /lib/whatsapp-entrenador.js
// Chat de entrenamiento del asistente IA ("Entrenar a la IA", fijado arriba de la lista de chats de Clientes WhatsApp).
// El administrador le escribe textos y le manda capturas de pantalla (conversaciones, páginas de productos, correos...). Gemini los lee, responde en el chat qué entendió y
// propone "aprendizajes" (preguntas y respuestas modelo con su regla). Cada aprendizaje queda como caso candidato (tipo 'entrenador') en
// Comercial > Bot WhatsApp > Aprendizaje, anonimizado y revisado. NADA llega al bot hasta que una persona lo aprueba; al aprobar se crea la pregunta y respuesta modelo
// que el bot usa en sus borradores (ver lib/whatsapp-bot-aprendizaje.js). Solo el administrador puede usar este chat.

import { unaVez } from './una-vez.js';
import { asegurarTablaCandidatosBot, anonimizarTexto, CATEGORIAS_KB, RIESGOS_CANDIDATO } from './whatsapp-bot-aprendizaje.js';
import { revisarPropuesta, limpiarSaltosDeLinea, PROTOCOLO_COMERCIAL, REGLAS_NO_PROMETER } from './whatsapp-bot.js';

export const MAX_TEXTO = 4000;
export const MAX_IMAGEN_BYTES = 1_200_000; // el navegador la reduce antes de enviarla; esto es el tope que acepta el servidor
export const MIME_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_APRENDIZAJES = 5;
export const MENSAJES_CONTEXTO = 8;   // mensajes anteriores que ve la IA para seguir la conversación
export const MENSAJES_VISIBLES = 60;  // mensajes que muestra el chat

// ---------------- Tabla ----------------
export function asegurarTablaEntrenador(sql) {
  return unaVez('asegurarTablaEntrenador', async () => {
    await asegurarTablaCandidatosBot(sql);
    await sql`
      CREATE TABLE IF NOT EXISTS whatsapp_entrenador_mensajes (
        id SERIAL PRIMARY KEY,
        rol TEXT NOT NULL,
        usuario TEXT,
        texto TEXT,
        imagen BYTEA,
        imagen_mime TEXT,
        candidatos JSONB,
        es_error BOOLEAN NOT NULL DEFAULT false,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
      );`;
    await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_entrenador_creado ON whatsapp_entrenador_mensajes (creado_en DESC);`;
  });
}

// ---------------- Entrada ----------------
// Devuelve { texto, imagen: { mime, bytes } | null } o lanza Error con un mensaje listo para mostrar.
export function validarEntrada(entrada) {
  const texto = String(entrada?.texto ?? '').replace(/\r\n/g, '\n').trim();
  let imagen = null;
  if (entrada?.imagen) {
    const mime = String(entrada.imagen.mime || '').toLowerCase();
    if (!MIME_IMAGEN.includes(mime)) throw new Error('La imagen debe ser JPG, PNG o WebP.');
    const base64 = String(entrada.imagen.datos || '').replace(/^data:[^,]*,/, '');
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length) throw new Error('La imagen llegó vacía.');
    if (bytes.length > MAX_IMAGEN_BYTES) throw new Error(`La imagen es demasiado pesada (${Math.round(bytes.length / 1024)} KB; máximo ${Math.round(MAX_IMAGEN_BYTES / 1024)} KB).`);
    imagen = { mime, bytes };
  }
  if (!texto && !imagen) throw new Error('Escribe un texto o adjunta una captura.');
  if (texto.length > MAX_TEXTO) throw new Error(`El texto es demasiado largo (${texto.length} de ${MAX_TEXTO} caracteres).`);
  return { texto, imagen };
}

// ---------------- Instrucciones para la IA ----------------
export function construirSystemEntrenador({ conocimiento = '', tono = '', reglasExtra = '' } = {}) {
  return `Eres el asistente comercial de IndexStore (indexstore.cl) en WhatsApp. En este chat te entrena el administrador de IndexStore: te escribe textos y te manda capturas de pantalla (conversaciones de WhatsApp con clientes, páginas de productos, correos, políticas...) para enseñarte cómo atender mejor.

TU TRABAJO en cada mensaje:
1. Entiende qué quiere enseñarte (una respuesta mejor, una regla, un dato de la tienda, un caso).
2. Si la captura es una conversación, identifica qué preguntó el cliente y cuál fue la mejor respuesta; mejórala siguiendo el protocolo comercial de abajo.
3. Responde al administrador en "respuesta_chat": en español de Chile, breve y cercano (máximo 500 caracteres): qué entendiste y qué aprendiste. Si algo no está claro, pregunta en vez de adivinar y no registres aprendizajes.
4. Registra en "aprendizajes" (máximo ${MAX_APRENDIZAJES}) cada cosa concreta que sirva para atender clientes: una pregunta típica de un cliente, la respuesta modelo que debe dar el asistente, y la regla general que se aprende. Si el administrador solo conversa o te hace una pregunta, deja "aprendizajes" vacío.

REGLAS DE ORO:
- La respuesta modelo solo puede afirmar lo que está en la BASE DE CONOCIMIENTO o lo que el administrador te dijo de forma explícita en este chat. No inventes datos, plazos, garantías ni condiciones.
- NO escribas precios ni enlaces de productos en la respuesta modelo (el asistente consulta el catálogo en vivo para precio, stock y enlace): usa una frase como «te confirmo el precio y el stock actual». Los enlaces oficiales de indexstore.cl que estén en la base sí se pueden usar.
- NO copies datos personales de las capturas (nombres de clientes, teléfonos, correos, RUT, direcciones, números de pedido): omítelos o usa [cliente].
- ${REGLAS_NO_PROMETER}
- La respuesta modelo debe sonar como WhatsApp: corta, ordenada y terminar con una pregunta que avance la venta, salvo que la conversación haya terminado.

Cada aprendizaje tiene: pregunta_cliente (cómo la escribiría un cliente, generalizada), respuesta_modelo (lo que debe responder el asistente), regla (la enseñanza general en una frase), categoria (módulo de la base de conocimiento) y riesgo (bajo, medio o alto: alto si toca precios, plazos, garantías, devoluciones o promesas).

PROTOCOLO COMERCIAL (cómo se atiende y vende):
${PROTOCOLO_COMERCIAL}
${tono ? `\nTONO DE MARCA:\n${tono}\n` : ''}${reglasExtra ? `\nREGLAS EXTRA DE LA EMPRESA:\n${reglasExtra}\n` : ''}
BASE DE CONOCIMIENTO:
${conocimiento}`;
}

// Declaración de la herramienta para Gemini (la IA siempre responde llamándola).
export const HERRAMIENTA_ENTRENADOR = {
  name: 'responder_entrenamiento',
  description: 'Responde al administrador en el chat y registra los aprendizajes de este mensaje. Se llama una sola vez.',
  parameters: {
    type: 'OBJECT',
    properties: {
      respuesta_chat: { type: 'STRING', description: 'Lo que le dices al administrador: qué entendiste y qué aprendiste (o la pregunta que necesitas).' },
      aprendizajes: {
        type: 'ARRAY',
        description: `Aprendizajes concretos (0 a ${MAX_APRENDIZAJES}). Vacío si solo se conversa o si falta información.`,
        items: {
          type: 'OBJECT',
          properties: {
            pregunta_cliente: { type: 'STRING', description: 'Pregunta típica de un cliente, generalizada y sin datos personales.' },
            respuesta_modelo: { type: 'STRING', description: 'Respuesta que debe dar el asistente, lista para WhatsApp, sin precios ni enlaces de productos.' },
            regla: { type: 'STRING', description: 'La enseñanza general en una frase.' },
            categoria: { type: 'STRING', enum: CATEGORIAS_KB },
            riesgo: { type: 'STRING', enum: RIESGOS_CANDIDATO },
          },
          required: ['pregunta_cliente', 'respuesta_modelo', 'categoria', 'riesgo'],
        },
      },
    },
    required: ['respuesta_chat', 'aprendizajes'],
  },
};

// ---------------- Normalizar lo que devuelve la IA (puro) ----------------
const limpiar = (s, max) => anonimizarTexto(limpiarSaltosDeLinea(s)).slice(0, max);

export function normalizarRespuestaIA(args, { conocimiento = '' } = {}) {
  const respuestaChat = limpiarSaltosDeLinea(args?.respuesta_chat).slice(0, 900) || 'Listo, lo revisé.';
  const lista = Array.isArray(args?.aprendizajes) ? args.aprendizajes : [];
  const aprendizajes = [];
  for (const a of lista) {
    if (aprendizajes.length >= MAX_APRENDIZAJES) break;
    const pregunta = limpiar(a?.pregunta_cliente, 300);
    const respuesta = limpiar(a?.respuesta_modelo, 900);
    if (pregunta.length < 8 || respuesta.length < 20) continue; // una pregunta o respuesta tan corta no enseña nada
    // La revisión automática del bot: precios, enlaces o números que no están en la base de conocimiento, descuentos, reservas.
    const alertas = revisarPropuesta({ texto: respuesta, productos: [], conocimiento });
    aprendizajes.push({
      pregunta, respuesta, regla: limpiar(a?.regla, 300),
      categoria: CATEGORIAS_KB.includes(a?.categoria) ? a.categoria : 'otro',
      riesgo: alertas.length ? 'alto' : (RIESGOS_CANDIDATO.includes(a?.riesgo) ? a.riesgo : 'medio'),
      alertas,
    });
  }
  return { respuestaChat, aprendizajes };
}

// ---------------- Llamada a Gemini ----------------
function partesDeMensaje(m) {
  return [{ text: m.texto || (m.tieneImagen ? '(el administrador envió una captura)' : '') }];
}
export async function llamarGeminiEntrenador({ apiKey, modelo, system, historial = [], texto, imagen, fetchFn = fetch, timeoutMs = 30000 }) {
  const contents = historial.map(m => ({ role: m.rol === 'ia' ? 'model' : 'user', parts: partesDeMensaje(m) }));
  const partes = [{ text: texto || 'Mira esta captura y dime qué aprendiste.' }];
  if (imagen) partes.push({ inline_data: { mime_type: imagen.mime, data: Buffer.from(imagen.bytes).toString('base64') } });
  contents.push({ role: 'user', parts: partes });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let r;
  try {
    r = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        tools: [{ function_declarations: [HERRAMIENTA_ENTRENADOR] }],
        tool_config: { function_calling_config: { mode: 'ANY', allowed_function_names: [HERRAMIENTA_ENTRENADOR.name] } },
        generationConfig: { maxOutputTokens: 4096 },
      }),
    });
  } catch (err) {
    throw new Error(err?.name === 'AbortError' ? 'Gemini tardó demasiado en responder. Intenta de nuevo.' : `No se pudo conectar con Gemini: ${err?.message || err}`);
  } finally {
    clearTimeout(t);
  }
  if (!r.ok) {
    const cuerpo = await r.text().catch(() => '');
    let detalle = cuerpo.slice(0, 200);
    try { const j = JSON.parse(cuerpo); if (j?.error?.message) detalle = String(j.error.message).slice(0, 200); } catch { /* no es JSON */ }
    throw new Error(r.status === 429 ? `Gemini sin cupo por ahora. Google dice: «${detalle}».` : `Gemini respondió con error (${r.status}): ${detalle}`);
  }
  const d = await r.json();
  const partesIA = d.candidates?.[0]?.content?.parts || [];
  const llamada = partesIA.find(p => p.functionCall);
  if (llamada) return llamada.functionCall.args || {};
  const textoLibre = partesIA.map(p => p.text || '').join('').trim(); // si el modelo contesta sin la herramienta, se muestra tal cual y no se registra nada
  if (textoLibre) return { respuesta_chat: textoLibre, aprendizajes: [] };
  throw new Error('Gemini no devolvió respuesta. Intenta de nuevo.');
}

// ---------------- Guardar y leer ----------------
export async function guardarMensajeUsuario(sql, { usuario, texto, imagen }) {
  const { rows } = await sql.query(
    `INSERT INTO whatsapp_entrenador_mensajes (rol, usuario, texto, imagen, imagen_mime) VALUES ('usuario', $1, $2, $3, $4) RETURNING id;`,
    [usuario || null, texto || null, imagen ? imagen.bytes : null, imagen ? imagen.mime : null]);
  return rows[0].id;
}
export async function guardarMensajeIA(sql, { texto, candidatos = [], esError = false }) {
  const { rows } = await sql.query(
    `INSERT INTO whatsapp_entrenador_mensajes (rol, texto, candidatos, es_error) VALUES ('ia', $1, $2::jsonb, $3) RETURNING id;`,
    [texto, JSON.stringify(candidatos), esError]);
  return rows[0].id;
}

// Cada aprendizaje queda como caso candidato pendiente de aprobar (anonimizado y con su revisión). Devuelve los ids.
export async function guardarAprendizajes(sql, aprendizajes, { textoEntrenador = '', usuario = null, modelo = null } = {}) {
  const ids = [];
  const origen = `Enseñado${usuario ? ' por ' + usuario : ''} en el chat de entrenamiento` + (textoEntrenador ? `: «${anonimizarTexto(textoEntrenador).slice(0, 160)}»` : ' (con una captura).');
  for (const a of aprendizajes) {
    const { rows } = await sql.query(
      `INSERT INTO whatsapp_bot_candidatos (tipo, mensaje_cliente, pregunta_propuesta, respuesta_propuesta, problema, regla, categoria, riesgo, alertas, modelo_ia)
       VALUES ('entrenador', $1, $1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING id;`,
      [a.pregunta, a.respuesta, origen, a.regla || null, a.categoria, a.riesgo, JSON.stringify(a.alertas || []), modelo]);
    ids.push(rows[0].id);
  }
  return ids;
}

export async function listarMensajes(sql, limite = MENSAJES_VISIBLES) {
  const { rows } = await sql.query(
    `SELECT id, rol, usuario, texto, (imagen IS NOT NULL) AS con_imagen, candidatos, es_error, creado_en FROM (
       SELECT * FROM whatsapp_entrenador_mensajes ORDER BY id DESC LIMIT $1) t ORDER BY id ASC;`, [Math.min(200, Math.max(1, Number(limite) || MENSAJES_VISIBLES))]);
  const ids = [...new Set(rows.flatMap(r => (Array.isArray(r.candidatos) ? r.candidatos : [])))];
  const estados = new Map();
  if (ids.length) {
    const { rows: cs } = await sql.query(
      `SELECT id, estado, pregunta_propuesta, respuesta_propuesta, regla, categoria, riesgo, alertas, nota FROM whatsapp_bot_candidatos WHERE id = ANY($1::int[]);`, [ids]);
    for (const c of cs) estados.set(c.id, c);
  }
  return rows.map(r => ({
    id: r.id, rol: r.rol, usuario: r.usuario || null, texto: r.texto || '', conImagen: r.con_imagen === true, esError: r.es_error === true, creadoEn: r.creado_en,
    aprendizajes: (Array.isArray(r.candidatos) ? r.candidatos : []).map(id => estados.get(id)).filter(Boolean).map(c => ({
      id: c.id, estado: c.estado, pregunta: c.pregunta_propuesta, respuesta: c.respuesta_propuesta, regla: c.regla || '', categoria: c.categoria || '', riesgo: c.riesgo || '',
      alertas: Array.isArray(c.alertas) ? c.alertas : [], nota: c.nota || '',
    })),
  }));
}

export async function obtenerImagen(sql, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const { rows } = await sql.query('SELECT imagen, imagen_mime FROM whatsapp_entrenador_mensajes WHERE id = $1 AND imagen IS NOT NULL;', [n]);
  return rows[0] ? { bytes: Buffer.from(rows[0].imagen), mime: rows[0].imagen_mime || 'image/jpeg' } : null;
}

export async function resumenEntrenador(sql) {
  const { rows } = await sql.query(
    `SELECT (SELECT COUNT(*)::int FROM whatsapp_bot_candidatos WHERE tipo = 'entrenador' AND estado = 'pendiente') AS pendientes,
            (SELECT COUNT(*)::int FROM whatsapp_bot_candidatos WHERE tipo = 'entrenador' AND estado = 'aprobado') AS aprobados,
            (SELECT MAX(creado_en) FROM whatsapp_entrenador_mensajes) AS ultimo_en,
            (SELECT COALESCE(NULLIF(texto, ''), '📷 Captura') FROM whatsapp_entrenador_mensajes ORDER BY id DESC LIMIT 1) AS ultimo_texto,
            (SELECT rol FROM whatsapp_entrenador_mensajes ORDER BY id DESC LIMIT 1) AS ultimo_rol;`);
  const r = rows[0];
  return { pendientes: r.pendientes, aprobados: r.aprobados, ultimoEn: r.ultimo_en || null, ultimoTexto: String(r.ultimo_texto || '').slice(0, 140), ultimoRol: r.ultimo_rol || null };
}

// ---------------- Un mensaje completo: guardar, consultar a la IA, registrar aprendizajes ----------------
// config = { conocimiento, tono, reglasExtra }. Si la IA falla, el mensaje del administrador queda guardado y se agrega un aviso de error en el chat.
export async function procesarMensajeEntrenador(sql, { usuario, entrada, config, apiKey, modelo, fetchFn }) {
  const v = validarEntrada(entrada); // lanza Error con el motivo si la entrada no sirve
  await asegurarTablaEntrenador(sql);
  const { rows: previos } = await sql.query(
    `SELECT rol, texto, (imagen IS NOT NULL) AS tiene_imagen FROM whatsapp_entrenador_mensajes WHERE es_error = false ORDER BY id DESC LIMIT $1;`, [MENSAJES_CONTEXTO]);
  const historial = previos.reverse().map(m => ({ rol: m.rol, texto: m.texto || '', tieneImagen: m.tiene_imagen }));
  await guardarMensajeUsuario(sql, { usuario, texto: v.texto, imagen: v.imagen });
  try {
    const args = await llamarGeminiEntrenador({
      apiKey, modelo, fetchFn, historial, texto: v.texto, imagen: v.imagen,
      system: construirSystemEntrenador(config || {}),
    });
    const r = normalizarRespuestaIA(args, { conocimiento: config?.conocimiento || '' });
    const ids = await guardarAprendizajes(sql, r.aprendizajes, { textoEntrenador: v.texto, usuario, modelo });
    await guardarMensajeIA(sql, { texto: r.respuestaChat, candidatos: ids });
    return { ok: true, aprendizajes: ids.length };
  } catch (err) {
    await guardarMensajeIA(sql, { texto: `No pude procesar tu mensaje: ${String(err?.message || err).slice(0, 300)}`, esError: true });
    return { ok: false, error: String(err?.message || err), aprendizajes: 0 };
  }
}

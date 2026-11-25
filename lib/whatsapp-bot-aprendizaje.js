// /lib/whatsapp-bot-aprendizaje.js
// Aprendizaje del bot de WhatsApp (paso 2). Dos fuentes de "casos candidatos" que una persona revisa antes de que pasen a ser preguntas y respuestas modelo:
//   · correccion    — un ejecutivo editó el borrador del bot antes de enviarlo (borrador del bot -> texto enviado).
//   · conversacion  — un intercambio real del historial (mensaje del cliente -> respuesta de un ejecutivo), analizado por la IA, que propone una
//                     respuesta optimizada, el problema detectado y una regla generalizable.
// Todo texto que se guarda aquí va ANONIMIZADO (teléfonos, correos, RUT, nombre del cliente, enlaces ajenos). Nada pasa al bot sin aprobación humana.

import { unaVez } from './una-vez.js';
import { crearEjemplo } from './whatsapp-bot-ejemplos.js';

export const TIPOS_CANDIDATO = ['correccion', 'conversacion', 'entrenador']; // entrenador: lo que el administrador le enseña al asistente en el chat "Entrenar a la IA" (lib/whatsapp-entrenador.js)
export const ESTADOS_CANDIDATO = ['pendiente', 'aprobado', 'rechazado'];
export const RIESGOS_CANDIDATO = ['bajo', 'medio', 'alto'];
// Módulos de la base de conocimiento (ver docs/bot-whatsapp/base-conocimiento.md) a los que puede pertenecer un caso.
export const CATEGORIAS_KB = [
  'cargadores', 'baterías', 'pantallas', 'teclados y repuestos', 'servicio técnico', 'limpieza y mantenimiento', 'bisagras', 'compatibilidad',
  'precios y disponibilidad', 'garantías', 'despachos y retiros', 'productos a pedido', 'recontactación', 'objeciones', 'derivación', 'otro',
];
export const MENSAJE_MIN = 15;     // un mensaje de cliente más corto que esto ("hola", "ok") no enseña nada
export const RESPUESTA_MIN = 60;   // una respuesta del ejecutivo más corta que esto tampoco

// ---------- Anonimización ----------

const escapar = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Reemplaza datos personales por marcas. Se queda con los enlaces de indexstore.cl (son información oficial). Los nombres del cliente se pasan en
// "nombres" (nombre del contacto de WhatsApp): se cambian por [cliente].
export function anonimizarTexto(texto, { nombres = [] } = {}) {
  let t = String(texto ?? '');
  t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[correo]');
  t = t.replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[RUT]');
  t = t.replace(/(?:\+?56[\s-]?)?\b9[\s-]?\d{4}[\s-]?\d{4}\b/g, '[teléfono]');
  t = t.replace(/https?:\/\/[^\s)]+/gi, u => (/^https?:\/\/(www\.)?indexstore\.cl(\/|$)/i.test(u) ? u : '[enlace]'));
  t = t.replace(/\b\d{8,}\b/g, '[número]');
  const partes = new Set();
  for (const n of nombres) for (const p of String(n || '').split(/\s+/)) if (p.length >= 3 && /^\p{L}+$/u.test(p)) partes.add(p);
  for (const p of partes) t = t.replace(new RegExp(`(?<![\\p{L}\\d])${escapar(p)}(?![\\p{L}\\d])`, 'giu'), '[cliente]');
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Cambios del ejecutivo sobre el borrador ----------

// Describe, sin IA, qué cambió el ejecutivo respecto del borrador del bot (para saber qué enseñarle).
export function describirCambio(textoBot, textoFinal) {
  const a = String(textoBot ?? ''), b = String(textoFinal ?? '');
  const partes = [];
  const la = a.length, lb = b.length;
  if (la && lb) {
    const d = Math.round(((lb - la) / la) * 100);
    if (d <= -25) partes.push(`acortó el mensaje (de ${la} a ${lb} caracteres)`);
    else if (d >= 25) partes.push(`alargó el mensaje (de ${la} a ${lb} caracteres)`);
  }
  const cuenta = (s, re) => (s.match(re) || []).length;
  const url = /https?:\/\/\S+/g, precio = /\$\s?\d/g, pregunta = /\?/g;
  if (cuenta(b, url) > cuenta(a, url)) partes.push('agregó enlace(s)'); else if (cuenta(b, url) < cuenta(a, url)) partes.push('quitó enlace(s)');
  if (cuenta(b, precio) > cuenta(a, precio)) partes.push('agregó precio(s)'); else if (cuenta(b, precio) < cuenta(a, precio)) partes.push('quitó precio(s)');
  if (cuenta(b, pregunta) > cuenta(a, pregunta)) partes.push('agregó una pregunta'); else if (cuenta(b, pregunta) < cuenta(a, pregunta)) partes.push('quitó una pregunta');
  if (b.split('\n').length > a.split('\n').length + 1) partes.push('ordenó el mensaje en más líneas');
  return partes.length ? `El ejecutivo ${partes.join(', ')}.` : 'El ejecutivo reescribió partes del texto.';
}

// ---------- Elegir el intercambio de una conversación real ----------

// De los mensajes de una conversación (en orden) saca el primer intercambio útil: lo que escribió el cliente (hasta 3 mensajes seguidos) y la
// primera respuesta de un ejecutivo con contenido (hasta 2 mensajes seguidos). null si no hay un intercambio que sirva para entrenar.
export function extraerIntercambio(mensajes) {
  // Los mensajes que envió el propio bot no son una respuesta de un ejecutivo: no se aprende de lo que el bot se dijo a sí mismo.
  const lista = (Array.isArray(mensajes) ? mensajes : []).filter(m => m && (m.direccion === 'in' || m.direccion === 'out') && m.origen !== 'bot');
  const texto = m => String(m.contenido_texto ?? '').trim();
  let i = 0;
  while (i < lista.length && lista[i].direccion !== 'in') i++;
  const cliente = [];
  const respuesta = [];
  for (; i < lista.length; i++) {
    const m = lista[i];
    if (m.direccion === 'in') {
      if (respuesta.length) break;                       // el cliente volvió a escribir: el intercambio ya terminó
      if (texto(m) && cliente.length < 3) cliente.push(texto(m));
    } else if (texto(m)) {
      if (!cliente.length) continue;
      if (!respuesta.length && texto(m).length < RESPUESTA_MIN) continue;   // saludos o "ya te reviso": no sirven como respuesta modelo
      if (respuesta.length >= 2) break;
      respuesta.push(texto(m));
    }
  }
  const c = cliente.join('\n'), r = respuesta.join('\n\n');
  if (c.length < MENSAJE_MIN || r.length < RESPUESTA_MIN) return null;
  return { cliente: c, respuesta: r };
}

// ---------- Tabla y operaciones ----------

export function asegurarTablaCandidatosBot(sql) {
  return unaVez('asegurarTablaCandidatosBot', () => _asegurar(sql));
}
async function _asegurar(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_bot_candidatos (
      id SERIAL PRIMARY KEY,
      tipo TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      conversacion_id INTEGER,
      borrador_id INTEGER,
      mensaje_cliente TEXT NOT NULL,
      respuesta_original TEXT,
      pregunta_propuesta TEXT,
      respuesta_propuesta TEXT,
      problema TEXT,
      regla TEXT,
      categoria TEXT,
      riesgo TEXT,
      alertas JSONB,
      modelo_ia TEXT,
      nota TEXT,
      ejemplo_id INTEGER,
      resuelto_por TEXT,
      resuelto_en TIMESTAMPTZ,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  // Un borrador corregido genera un solo candidato, y una conversación real se analiza una sola vez.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_bot_candidatos_borrador ON whatsapp_bot_candidatos (borrador_id) WHERE borrador_id IS NOT NULL;`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_bot_candidatos_conv ON whatsapp_bot_candidatos (conversacion_id) WHERE tipo = 'conversacion';`;
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_bot_candidatos_estado ON whatsapp_bot_candidatos (estado, creado_en DESC);`;
}

const COLUMNAS = `id, tipo, estado, conversacion_id, borrador_id, mensaje_cliente, respuesta_original, pregunta_propuesta, respuesta_propuesta, problema, regla,
  categoria, riesgo, alertas, modelo_ia, nota, ejemplo_id, resuelto_por, resuelto_en, creado_en`;
const aFila = r => ({
  id: r.id, tipo: r.tipo, estado: r.estado, conversacionId: r.conversacion_id, borradorId: r.borrador_id, mensajeCliente: r.mensaje_cliente,
  respuestaOriginal: r.respuesta_original || '', preguntaPropuesta: r.pregunta_propuesta || r.mensaje_cliente, respuestaPropuesta: r.respuesta_propuesta || '',
  problema: r.problema || '', regla: r.regla || '', categoria: r.categoria || '', riesgo: r.riesgo || '', alertas: Array.isArray(r.alertas) ? r.alertas : [],
  modeloIa: r.modelo_ia || null, nota: r.nota || '', ejemploId: r.ejemplo_id || null, resueltoPor: r.resuelto_por || null, resueltoEn: r.resuelto_en || null, creadoEn: r.creado_en,
});

// Corrección de un ejecutivo: el borrador del bot que se envió editado. Devuelve el id, o null si ya existía un candidato para ese borrador.
export async function crearCandidatoCorreccion(sql, { conversacionId, borradorId, mensajeCliente, textoBot, textoFinal, nombres = [] }) {
  const cliente = anonimizarTexto(mensajeCliente, { nombres });
  const bot = anonimizarTexto(textoBot, { nombres });
  const final = anonimizarTexto(textoFinal, { nombres });
  if (!cliente || !final) return null;
  const { rows } = await sql.query(
    `INSERT INTO whatsapp_bot_candidatos (tipo, conversacion_id, borrador_id, mensaje_cliente, respuesta_original, pregunta_propuesta, respuesta_propuesta, problema)
     VALUES ('correccion', $1, $2, $3, $4, $3, $5, $6) ON CONFLICT DO NOTHING RETURNING id;`,
    [conversacionId || null, borradorId || null, cliente, bot, final, describirCambio(bot, final)]
  );
  return rows[0]?.id || null;
}

// Intercambio real analizado por la IA. Si la IA dice que no sirve, queda como rechazado (para no volver a analizar esa conversación).
export async function crearCandidatoConversacion(sql, d) {
  const util = d.util !== false;
  const { rows } = await sql.query(
    `INSERT INTO whatsapp_bot_candidatos (tipo, estado, conversacion_id, mensaje_cliente, respuesta_original, pregunta_propuesta, respuesta_propuesta, problema, regla, categoria, riesgo, alertas, modelo_ia, nota, resuelto_por, resuelto_en)
     VALUES ('conversacion', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15) ON CONFLICT DO NOTHING RETURNING id;`,
    [util ? 'pendiente' : 'rechazado', d.conversacionId, d.mensajeCliente, d.respuestaOriginal || null, d.preguntaPropuesta || d.mensajeCliente, d.respuestaPropuesta || null,
      d.problema || null, d.regla || null, CATEGORIAS_KB.includes(d.categoria) ? d.categoria : 'otro', RIESGOS_CANDIDATO.includes(d.riesgo) ? d.riesgo : 'medio',
      JSON.stringify(d.alertas || []), d.modeloIa || null, util ? null : 'La IA lo descartó: no sirve para entrenar.', util ? null : 'IA', util ? null : new Date().toISOString()]
  );
  return rows[0]?.id || null;
}

export async function listarCandidatos(sql, { estado = 'pendiente', tipo = '', limite = 100 } = {}) {
  const cond = [], params = [];
  if (ESTADOS_CANDIDATO.includes(estado)) { params.push(estado); cond.push(`estado = $${params.length}`); }
  if (TIPOS_CANDIDATO.includes(tipo)) { params.push(tipo); cond.push(`tipo = $${params.length}`); }
  params.push(Math.min(300, Math.max(1, Number(limite) || 100)));
  const { rows } = await sql.query(
    `SELECT ${COLUMNAS} FROM whatsapp_bot_candidatos ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
     ORDER BY CASE riesgo WHEN 'alto' THEN 0 WHEN 'medio' THEN 1 ELSE 2 END, creado_en DESC LIMIT $${params.length};`, params);
  return rows.map(aFila);
}

export async function resumenCandidatos(sql) {
  const { rows } = await sql.query(
    `SELECT COUNT(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes,
            COUNT(*) FILTER (WHERE estado = 'pendiente' AND tipo = 'correccion')::int AS pendientes_correccion,
            COUNT(*) FILTER (WHERE estado = 'pendiente' AND tipo = 'conversacion')::int AS pendientes_conversacion,
            COUNT(*) FILTER (WHERE estado = 'pendiente' AND tipo = 'entrenador')::int AS pendientes_entrenador,
            COUNT(*) FILTER (WHERE estado = 'aprobado')::int AS aprobados,
            COUNT(*) FILTER (WHERE estado = 'rechazado')::int AS rechazados
     FROM whatsapp_bot_candidatos;`);
  return rows[0];
}

const idValido = id => { const n = Number(id); return Number.isInteger(n) && n > 0 ? n : null; };

// Aprobar = crear la pregunta modelo (con lo que la persona dejó escrito, que puede haber editado) y marcar el candidato como aprobado.
export async function aprobarCandidato(sql, id, { pregunta, respuesta, etiquetas } = {}, usuario) {
  const n = idValido(id);
  if (!n) return { ok: false, estado: 400, error: 'Falta el id del caso.' };
  const { rows } = await sql.query('SELECT id, tipo, estado, categoria FROM whatsapp_bot_candidatos WHERE id = $1;', [n]);
  const c = rows[0];
  if (!c) return { ok: false, estado: 404, error: 'El caso ya no existe.' };
  if (c.estado !== 'pendiente') return { ok: false, estado: 409, error: `Este caso ya fue ${c.estado}.` };
  const r = await crearEjemplo(sql, { pregunta, respuesta, etiquetas: etiquetas || c.categoria || '', origen: c.tipo === 'correccion' ? 'correccion' : c.tipo === 'entrenador' ? 'entrenador' : 'conversacion' }, usuario);
  if (!r.ok) return r;
  await sql.query(`UPDATE whatsapp_bot_candidatos SET estado = 'aprobado', ejemplo_id = $2, resuelto_por = $3, resuelto_en = now() WHERE id = $1;`, [n, r.ejemplo.id, usuario || null]);
  return { ok: true, ejemplo: r.ejemplo };
}

export async function rechazarCandidato(sql, id, usuario, nota) {
  const n = idValido(id);
  if (!n) return { ok: false, estado: 400, error: 'Falta el id del caso.' };
  const { rows } = await sql.query(
    `UPDATE whatsapp_bot_candidatos SET estado = 'rechazado', nota = COALESCE($3, nota), resuelto_por = $2, resuelto_en = now() WHERE id = $1 AND estado = 'pendiente' RETURNING id;`,
    [n, usuario || null, nota ? String(nota).slice(0, 400) : null]
  );
  if (!rows.length) return { ok: false, estado: 404, error: 'El caso ya no existe o ya fue resuelto.' };
  return { ok: true };
}

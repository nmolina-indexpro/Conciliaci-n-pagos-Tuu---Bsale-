// /lib/whatsapp-bot-ejemplos.js
// Preguntas y respuestas modelo del bot de WhatsApp (panel de entrenamiento). Cualquier usuario las crea, corrige y desactiva; borrarlas del todo es de administrador.
// El bot las recibe como guía de contenido y de estilo (ver construirSystemBot y elegirPreguntasModelo en lib/whatsapp-bot.js); el precio, el stock y el enlace de un
// producto siguen saliendo solo del catálogo.

import { unaVez } from './una-vez.js';

export const PREGUNTA_MAX = 300;
export const RESPUESTA_MAX = 900;
export const ETIQUETAS_MAX = 120;
export const ORIGENES_EJEMPLO = ['manual', 'probador', 'correccion', 'importado', 'conversacion'];
export const IMPORTAR_MAX = 200;

// Devuelve { pregunta, respuesta, etiquetas, origen } limpio o lanza Error con un mensaje listo para mostrar.
export function validarEjemplo(entrada) {
  const limpiar = s => String(s ?? '').replace(/\r\n/g, '\n').trim();
  const pregunta = limpiar(entrada?.pregunta);
  const respuesta = limpiar(entrada?.respuesta);
  const etiquetas = limpiar(entrada?.etiquetas).replace(/\s+/g, ' ');
  if (!pregunta) throw new Error('Escribe la pregunta o situación del cliente.');
  if (!respuesta) throw new Error('Escribe la respuesta que debe dar el bot.');
  if (pregunta.length > PREGUNTA_MAX) throw new Error(`La pregunta es demasiado larga (${pregunta.length} de ${PREGUNTA_MAX} caracteres).`);
  if (respuesta.length > RESPUESTA_MAX) throw new Error(`La respuesta es demasiado larga (${respuesta.length} de ${RESPUESTA_MAX} caracteres): el bot responde mensajes cortos.`);
  if (etiquetas.length > ETIQUETAS_MAX) throw new Error(`Las etiquetas son demasiado largas (máximo ${ETIQUETAS_MAX} caracteres).`);
  const origen = ORIGENES_EJEMPLO.includes(entrada?.origen) ? entrada.origen : 'manual';
  return { pregunta, respuesta, etiquetas, origen };
}

export function asegurarTablaEjemplosBot(sql) {
  return unaVez('asegurarTablaEjemplosBot', () => _asegurar(sql));
}
async function _asegurar(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_bot_ejemplos (
      id SERIAL PRIMARY KEY,
      pregunta TEXT NOT NULL,
      respuesta TEXT NOT NULL,
      etiquetas TEXT,
      origen TEXT NOT NULL DEFAULT 'manual',
      activo BOOLEAN NOT NULL DEFAULT true,
      creado_por TEXT,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado_por TEXT,
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_bot_ejemplos_activo ON whatsapp_bot_ejemplos (activo);`;
}

const COLUMNAS = 'id, pregunta, respuesta, etiquetas, origen, activo, creado_por, creado_en, actualizado_por, actualizado_en';
const aFila = r => ({
  id: r.id, pregunta: r.pregunta, respuesta: r.respuesta, etiquetas: r.etiquetas || '', origen: r.origen, activo: !!r.activo,
  creadoPor: r.creado_por || null, creadoEn: r.creado_en, actualizadoPor: r.actualizado_por || r.creado_por || null, actualizadoEn: r.actualizado_en,
});

export async function listarEjemplos(sql, { soloActivos = false } = {}) {
  const { rows } = soloActivos
    ? await sql.query(`SELECT ${COLUMNAS} FROM whatsapp_bot_ejemplos WHERE activo = true ORDER BY id ASC;`)
    : await sql.query(`SELECT ${COLUMNAS} FROM whatsapp_bot_ejemplos ORDER BY activo DESC, id DESC;`);
  return rows.map(aFila);
}

const idValido = id => { const n = Number(id); return Number.isInteger(n) && n > 0 ? n : null; };

// Cada función devuelve { ok:true, ejemplo } o { ok:false, estado, error } para que el handler solo traduzca a HTTP.
export async function crearEjemplo(sql, entrada, usuario) {
  let v; try { v = validarEjemplo(entrada); } catch (e) { return { ok: false, estado: 400, error: e.message }; }
  const { rows } = await sql.query(
    `INSERT INTO whatsapp_bot_ejemplos (pregunta, respuesta, etiquetas, origen, creado_por, actualizado_por) VALUES ($1, $2, $3, $4, $5, $5) RETURNING ${COLUMNAS};`,
    [v.pregunta, v.respuesta, v.etiquetas || null, v.origen, usuario || null]
  );
  return { ok: true, ejemplo: aFila(rows[0]) };
}

export async function actualizarEjemplo(sql, id, entrada, usuario) {
  const n = idValido(id);
  if (!n) return { ok: false, estado: 400, error: 'Falta el id del ejemplo.' };
  let v; try { v = validarEjemplo(entrada); } catch (e) { return { ok: false, estado: 400, error: e.message }; }
  const { rows } = await sql.query(
    `UPDATE whatsapp_bot_ejemplos SET pregunta = $2, respuesta = $3, etiquetas = $4, actualizado_por = $5, actualizado_en = now() WHERE id = $1 RETURNING ${COLUMNAS};`,
    [n, v.pregunta, v.respuesta, v.etiquetas || null, usuario || null]
  );
  if (!rows.length) return { ok: false, estado: 404, error: 'El ejemplo ya no existe.' };
  return { ok: true, ejemplo: aFila(rows[0]) };
}

export async function cambiarActivoEjemplo(sql, id, activo, usuario) {
  const n = idValido(id);
  if (!n) return { ok: false, estado: 400, error: 'Falta el id del ejemplo.' };
  const { rows } = await sql.query(
    `UPDATE whatsapp_bot_ejemplos SET activo = $2, actualizado_por = $3, actualizado_en = now() WHERE id = $1 RETURNING ${COLUMNAS};`,
    [n, activo === true, usuario || null]
  );
  if (!rows.length) return { ok: false, estado: 404, error: 'El ejemplo ya no existe.' };
  return { ok: true, ejemplo: aFila(rows[0]) };
}

// Carga varios ejemplos de una vez (casos iniciales de entrenamiento). Valida cada uno, omite los que ya existen (misma pregunta) y devuelve
// cuántos entraron, cuántos se omitieron y los errores por fila, para que una fila mala no impida cargar las demás.
export async function importarEjemplos(sql, lista, usuario) {
  if (!Array.isArray(lista) || !lista.length) return { ok: false, estado: 400, error: 'No hay ejemplos para importar.' };
  if (lista.length > IMPORTAR_MAX) return { ok: false, estado: 400, error: `Se pueden importar hasta ${IMPORTAR_MAX} ejemplos por vez.` };
  const { rows } = await sql.query('SELECT lower(pregunta) AS p FROM whatsapp_bot_ejemplos;');
  const existentes = new Set(rows.map(r => r.p));
  let importados = 0, omitidos = 0;
  const errores = [];
  for (let i = 0; i < lista.length; i++) {
    let v; try { v = validarEjemplo({ ...(lista[i] || {}), origen: 'importado' }); } catch (e) { errores.push({ fila: i + 1, error: e.message }); continue; }
    const clave = v.pregunta.toLowerCase();
    if (existentes.has(clave)) { omitidos++; continue; }
    await sql.query(
      'INSERT INTO whatsapp_bot_ejemplos (pregunta, respuesta, etiquetas, origen, creado_por, actualizado_por) VALUES ($1, $2, $3, $4, $5, $5);',
      [v.pregunta, v.respuesta, v.etiquetas || null, v.origen, usuario || null]
    );
    existentes.add(clave); importados++;
  }
  return { ok: true, resultado: { importados, omitidos, errores } };
}

export async function eliminarEjemplo(sql, id) {
  const n = idValido(id);
  if (!n) return { ok: false, estado: 400, error: 'Falta el id del ejemplo.' };
  const { rows } = await sql.query('DELETE FROM whatsapp_bot_ejemplos WHERE id = $1 RETURNING id;', [n]);
  if (!rows.length) return { ok: false, estado: 404, error: 'El ejemplo ya no existe.' };
  return { ok: true };
}

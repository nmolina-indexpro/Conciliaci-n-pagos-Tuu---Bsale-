// Panel de entrenamiento del bot de WhatsApp: prompt (tono, reglas, saludo, preguntas modelo), elección de preguntas parecidas,
// preguntas y respuestas modelo (CRUD contra Postgres real en memoria) y la migración de la configuración.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { reiniciarUnaVez } from '../../lib/una-vez.js';
import { asegurarTablaWhatsappBot } from '../../lib/db.js';
import {
  construirSystemBot, elegirPreguntasModelo, momentoDentroDeHorario, dentroDeHorarioBot, normalizarPropuesta,
  HORARIO_BOT_DEFECTO, SALUDO_DEFECTO, CONOCIMIENTO_DEFECTO,
} from '../../lib/whatsapp-bot.js';
import {
  asegurarTablaEjemplosBot, listarEjemplos, crearEjemplo, actualizarEjemplo, cambiarActivoEjemplo, eliminarEjemplo,
  validarEjemplo, PREGUNTA_MAX, RESPUESTA_MAX,
} from '../../lib/whatsapp-bot-ejemplos.js';

async function crearBase() {
  const db = new PGlite();
  await db.waitReady;
  const salida = r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  const sql = async (strings, ...valores) => salida(await db.query(strings.reduce((a, s, i) => a + s + (i < valores.length ? `$${i + 1}` : ''), ''), valores));
  sql.query = async (texto, params = []) => salida(await db.query(texto, params));
  reiniciarUnaVez();
  return { db, sql };
}

const base = { conocimiento: CONOCIMIENTO_DEFECTO, horario: HORARIO_BOT_DEFECTO };

test('el prompt incluye tono, reglas adicionales y preguntas modelo cuando existen, y nada de eso cuando no', () => {
  const vacio = construirSystemBot({ ...base });
  for (const t of ['REGLAS ADICIONALES', 'Indicaciones de tono', 'PREGUNTAS FRECUENTES']) assert.ok(!vacio.includes(t), `no debería traer "${t}"`);

  const lleno = construirSystemBot({
    ...base, tono: 'Habla de usted', reglasExtra: 'No hablar de la competencia',
    preguntasModelo: [{ pregunta: '¿Tienen servicio técnico?', respuesta: 'Sí, en Providencia.' }],
  });
  assert.match(lleno, /REGLAS ADICIONALES DEL NEGOCIO[\s\S]*No hablar de la competencia/);
  assert.match(lleno, /Indicaciones de tono del negocio: Habla de usted/);
  assert.match(lleno, /P: ¿Tienen servicio técnico\?\nR: Sí, en Providencia\./);
});

test('el saludo solo se pide en el primer mensaje del bot', () => {
  const primera = construirSystemBot({ ...base, primeraRespuestaBot: true, saludo: SALUDO_DEFECTO });
  assert.match(primera, /Empieza con este saludo de bienvenida/);
  assert.ok(primera.includes(SALUDO_DEFECTO));
  const siguiente = construirSystemBot({ ...base, primeraRespuestaBot: false, saludo: SALUDO_DEFECTO });
  assert.ok(!siguiente.includes('saludo de bienvenida'));
  assert.match(siguiente, /sin volver a presentarte/);
  const sinSaludo = construirSystemBot({ ...base, primeraRespuestaBot: true });
  assert.match(sinSaludo, /saluda y di que eres el asistente virtual/);
});

test('elegirPreguntasModelo devuelve todas si son pocas y las más parecidas si son muchas', () => {
  const pocas = [{ pregunta: 'a', respuesta: 'x' }, { pregunta: 'b', respuesta: 'y' }];
  assert.equal(elegirPreguntasModelo(pocas, 'cualquier cosa').length, 2);

  const muchas = Array.from({ length: 12 }, (_, i) => ({ pregunta: `tema${i} genérico`, respuesta: `r${i}` }));
  muchas.push({ pregunta: '¿Hacen despacho a regiones?', respuesta: 'Sí, por Starken.', etiquetas: 'envío' });
  const elegidas = elegirPreguntasModelo(muchas, 'Hola, hacen despacho a regiones?', 4);
  assert.equal(elegidas[0].respuesta, 'Sí, por Starken.');
  assert.ok(elegidas.length <= 4);
  // sin palabras en común con ninguna: no se le llena el prompt con preguntas al azar
  assert.deepEqual(elegirPreguntasModelo(muchas, 'zzz qqq', 4), []);
  // ignora registros incompletos
  assert.equal(elegirPreguntasModelo([{ pregunta: 'x' }, null], 'x').length, 0);
});

test('momentoDentroDeHorario encuentra un instante dentro de las ventanas del bot', () => {
  const t = momentoDentroDeHorario(new Date('2026-11-23T15:00:00Z'), HORARIO_BOT_DEFECTO);
  assert.ok(t instanceof Date);
  assert.equal(dentroDeHorarioBot(t, HORARIO_BOT_DEFECTO), true);
  assert.equal(momentoDentroDeHorario(new Date(), [{ dias: [1], desde: '10:00', hasta: '10:05' }]) instanceof Date, true);
});

test('lo que escribió el equipo en una respuesta modelo cuenta como respaldado en la revisión de precios y enlaces', () => {
  const texto = 'Los despachos salen por Starken, $3.990. Más info en https://indexstore.cl/envios';
  const sin = normalizarPropuesta({ texto, confianza: 'alta', escalar: false }, { productos: [], conocimiento: CONOCIMIENTO_DEFECTO });
  assert.equal(sin.escalar, true);
  assert.ok(sin.alertas.some(a => /Precio no verificado/.test(a)) && sin.alertas.some(a => /Enlace no verificado/.test(a)));
  const con = normalizarPropuesta({ texto, confianza: 'alta', escalar: false }, { productos: [], conocimiento: `${CONOCIMIENTO_DEFECTO}\n${texto}` });
  assert.equal(con.escalar, false);
  assert.deepEqual(con.alertas, []);
});

test('validarEjemplo exige pregunta y respuesta y limita el largo', () => {
  assert.throws(() => validarEjemplo({ pregunta: '  ', respuesta: 'x' }), /pregunta/i);
  assert.throws(() => validarEjemplo({ pregunta: 'x', respuesta: '' }), /respuesta/i);
  assert.throws(() => validarEjemplo({ pregunta: 'x'.repeat(PREGUNTA_MAX + 1), respuesta: 'y' }), /pregunta es demasiado larga/i);
  assert.throws(() => validarEjemplo({ pregunta: 'x', respuesta: 'y'.repeat(RESPUESTA_MAX + 1) }), /respuesta es demasiado larga/i);
  assert.deepEqual(validarEjemplo({ pregunta: ' ¿Hola?\r\n', respuesta: ' Sí ', etiquetas: ' a   b ', origen: 'raro' }), { pregunta: '¿Hola?', respuesta: 'Sí', etiquetas: 'a b', origen: 'manual' });
  assert.equal(validarEjemplo({ pregunta: 'x', respuesta: 'y', origen: 'probador' }).origen, 'probador');
});

test('preguntas modelo: crear, corregir, desactivar y borrar contra la base', async () => {
  const { db, sql } = await crearBase();
  try {
    await asegurarTablaEjemplosBot(sql);
    assert.deepEqual(await listarEjemplos(sql), []);

    const c1 = await crearEjemplo(sql, { pregunta: '¿Dónde están?', respuesta: 'En La Concepción 81.' }, 'Ana');
    assert.equal(c1.ok, true);
    assert.equal(c1.ejemplo.creadoPor, 'Ana');
    assert.equal(c1.ejemplo.activo, true);
    const c2 = await crearEjemplo(sql, { pregunta: '¿Instalan?', respuesta: 'Sí, pantallas gratis.', etiquetas: 'instalación', origen: 'probador' }, 'Luis');
    assert.equal((await crearEjemplo(sql, { pregunta: '', respuesta: 'x' }, 'Ana')).estado, 400);

    const a = await actualizarEjemplo(sql, c1.ejemplo.id, { pregunta: '¿Dónde están ubicados?', respuesta: 'La Concepción 81, of. 1904.' }, 'Luis');
    assert.equal(a.ok, true);
    assert.equal(a.ejemplo.actualizadoPor, 'Luis');
    assert.equal(a.ejemplo.creadoPor, 'Ana');
    assert.equal((await actualizarEjemplo(sql, 99999, { pregunta: 'x', respuesta: 'y' }, 'Luis')).estado, 404);
    assert.equal((await actualizarEjemplo(sql, 'abc', { pregunta: 'x', respuesta: 'y' }, 'Luis')).estado, 400);

    assert.equal((await cambiarActivoEjemplo(sql, c2.ejemplo.id, false, 'Ana')).ejemplo.activo, false);
    assert.deepEqual((await listarEjemplos(sql, { soloActivos: true })).map(e => e.id), [c1.ejemplo.id]);
    assert.equal((await listarEjemplos(sql)).length, 2);

    assert.equal((await eliminarEjemplo(sql, c2.ejemplo.id)).ok, true);
    assert.equal((await eliminarEjemplo(sql, c2.ejemplo.id)).estado, 404);
    assert.equal((await listarEjemplos(sql)).length, 1);
  } finally { await db.close(); }
});

test('la migración de la configuración del bot agrega tono, reglas y saludo sin perder la fila existente', async () => {
  const { db, sql } = await crearBase();
  try {
    await sql`CREATE TABLE whatsapp_conversaciones (id SERIAL PRIMARY KEY);`; // la tabla de borradores la referencia
    // configuración "vieja", antes de las columnas nuevas
    await sql`CREATE TABLE whatsapp_bot_config (id INTEGER PRIMARY KEY DEFAULT 1, modo TEXT NOT NULL DEFAULT 'sombra', horario JSONB, conocimiento TEXT, actualizado_por TEXT, actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
    await sql`INSERT INTO whatsapp_bot_config (id, modo, conocimiento, actualizado_por) VALUES (1, 'sombra', 'Texto previo del negocio', 'Admin');`;

    await asegurarTablaWhatsappBot(sql);
    const { rows: [c] } = await sql`SELECT modo, conocimiento, actualizado_por, tono, reglas_extra, saludo_activo, saludo_cuando, saludo_texto FROM whatsapp_bot_config WHERE id = 1;`;
    assert.equal(c.conocimiento, 'Texto previo del negocio');
    assert.equal(c.actualizado_por, 'Admin');
    assert.equal(c.tono, null);
    assert.equal(c.saludo_activo, false);
    assert.equal(c.saludo_cuando, 'fuera_horario');

    await sql`UPDATE whatsapp_bot_config SET saludo_activo = true, saludo_cuando = 'siempre', saludo_texto = 'Hola' WHERE id = 1;`;
    reiniciarUnaVez();
    await asegurarTablaWhatsappBot(sql); // idempotente
    const { rows: [d] } = await sql`SELECT saludo_activo, saludo_cuando, saludo_texto FROM whatsapp_bot_config WHERE id = 1;`;
    assert.deepEqual({ ...d }, { saludo_activo: true, saludo_cuando: 'siempre', saludo_texto: 'Hola' });
  } finally { await db.close(); }
});

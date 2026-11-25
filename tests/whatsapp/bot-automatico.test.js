// Envío automático del bot (modo prueba): números de prueba y reglas de seguridad que deciden si un borrador se envía solo.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODOS_BOT, normalizarNumerosPrueba, esNumeroDePrueba, evaluarEnvioAutomatico, normalizarPropuesta, CONOCIMIENTO_DEFECTO,
  TOPE_DIARIO_DEFECTO, TOPE_POR_HORA_CONVERSACION, SILENCIO_EJECUTIVO_HORAS,
} from '../../lib/whatsapp-bot.js';

const bueno = { texto: 'Hola, ¿me envías el modelo exacto?', confianza: 'alta', alertas: [] };
const base = { modo: 'prueba', esNumeroPrueba: true, borrador: bueno };

test('la migración agrega los números de prueba, el tope diario y el resultado del envío automático sin perder la configuración existente', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { reiniciarUnaVez } = await import('../../lib/una-vez.js');
  const { asegurarTablaWhatsappBot } = await import('../../lib/db.js');
  const db = new PGlite();
  await db.waitReady;
  const salida = r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  const sql = async (strings, ...valores) => salida(await db.query(strings.reduce((a, s, i) => a + s + (i < valores.length ? `$${i + 1}` : ''), ''), valores));
  sql.query = async (texto, params = []) => salida(await db.query(texto, params));
  reiniciarUnaVez();
  try {
    await sql`CREATE TABLE whatsapp_conversaciones (id SERIAL PRIMARY KEY);`;
    await sql`CREATE TABLE whatsapp_bot_config (id INTEGER PRIMARY KEY DEFAULT 1, modo TEXT NOT NULL DEFAULT 'sombra', horario JSONB, conocimiento TEXT, actualizado_por TEXT, actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
    await sql`INSERT INTO whatsapp_bot_config (id, modo, conocimiento) VALUES (1, 'sombra', 'Texto previo del negocio');`;
    await asegurarTablaWhatsappBot(sql);
    const { rows: [c] } = await sql`SELECT modo, conocimiento, numeros_prueba, tope_diario FROM whatsapp_bot_config WHERE id = 1;`;
    assert.equal(c.modo, 'sombra');
    assert.equal(c.conocimiento, 'Texto previo del negocio');
    assert.equal(c.numeros_prueba, null);
    assert.equal(c.tope_diario, TOPE_DIARIO_DEFECTO);
    await sql`UPDATE whatsapp_bot_config SET modo = 'prueba', numeros_prueba = ${JSON.stringify(['56987654321'])}::jsonb, tope_diario = 10 WHERE id = 1;`;
    await sql`INSERT INTO whatsapp_conversaciones DEFAULT VALUES;`;
    await sql`INSERT INTO whatsapp_bot_borradores (conversacion_id, texto, origen, estado, auto_resultado) VALUES (1, 'hola', 'auto', 'enviado_automatico', 'Enviado. Confianza alta y sin alertas.');`;
    const { rows: [b] } = await sql`SELECT estado, origen, auto_resultado FROM whatsapp_bot_borradores WHERE conversacion_id = 1;`;
    assert.deepEqual({ ...b }, { estado: 'enviado_automatico', origen: 'auto', auto_resultado: 'Enviado. Confianza alta y sin alertas.' });
    const { rows: [d] } = await sql`SELECT modo, numeros_prueba, tope_diario FROM whatsapp_bot_config WHERE id = 1;`;
    assert.equal(d.modo, 'prueba');
    assert.deepEqual(d.numeros_prueba, ['56987654321']);
  } finally { await db.close(); }
});

test('los modos del bot son apagado, sombra y prueba; todavía no existe un modo que responda a todos los clientes', () => {
  assert.deepEqual(MODOS_BOT, ['apagado', 'sombra', 'prueba']);
  assert.ok(!MODOS_BOT.includes('automatico'));
});

test('normalizarNumerosPrueba acepta varios formatos, quita repetidos y valida', () => {
  assert.deepEqual(normalizarNumerosPrueba('+56 9 8765 4321\n56987654321\n 912345678 '), ['56987654321', '912345678']);
  assert.deepEqual(normalizarNumerosPrueba(['56911112222', '+56 9 1111 2222']), ['56911112222']);
  assert.deepEqual(normalizarNumerosPrueba('56911112222, 56933334444; 56955556666'), ['56911112222', '56933334444', '56955556666']);
  assert.deepEqual(normalizarNumerosPrueba(''), []);
  assert.deepEqual(normalizarNumerosPrueba(null), []);
  assert.throws(() => normalizarNumerosPrueba('12345'), /no parece un número de WhatsApp/);
  assert.throws(() => normalizarNumerosPrueba('56911112222\nhola'), /«hola»/);
  assert.throws(() => normalizarNumerosPrueba(Array.from({ length: 11 }, (_, i) => `5691111${1000 + i}`)), /hasta 10/);
});

test('esNumeroDePrueba compara por los últimos 9 dígitos, sin importar el formato', () => {
  const lista = ['56987654321'];
  assert.equal(esNumeroDePrueba('56987654321', lista), true);
  assert.equal(esNumeroDePrueba('+56 9 8765 4321', lista), true);
  assert.equal(esNumeroDePrueba('987654321', lista), true);
  assert.equal(esNumeroDePrueba('56987654322', lista), false, 'un dígito distinto');
  assert.equal(esNumeroDePrueba('56987654321', []), false);
  assert.equal(esNumeroDePrueba('', lista), false);
  assert.equal(esNumeroDePrueba('123', ['123']), false, 'números demasiado cortos no cuentan');
  assert.equal(esNumeroDePrueba('56987654321', null), false);
});

test('se envía solo con modo prueba, número autorizado, confianza alta y sin alertas', () => {
  assert.deepEqual(evaluarEnvioAutomatico(base), { enviar: true, motivo: 'Confianza alta y sin alertas.' });
});

test('ante cualquier duda NO se envía y se explica por qué', () => {
  const no = (extra, patron) => {
    const r = evaluarEnvioAutomatico({ ...base, ...extra });
    assert.equal(r.enviar, false, JSON.stringify(extra));
    assert.match(r.motivo, patron);
  };
  no({ modo: 'sombra' }, /no está en modo prueba/);
  no({ modo: 'apagado' }, /no está en modo prueba/);
  no({ modo: 'automatico' }, /no está en modo prueba/);
  no({ esNumeroPrueba: false }, /no está en la lista de prueba/);
  no({ hayRespuestaHumanaReciente: true }, new RegExp(`menos de ${SILENCIO_EJECUTIVO_HORAS} horas: el bot se calla`));
  no({ enviadosHoy: TOPE_DIARIO_DEFECTO }, /tope diario de 30/);
  no({ enviadosHoy: 5, topeDiario: 5 }, /tope diario de 5/);
  no({ enviadosUltimaHora: TOPE_POR_HORA_CONVERSACION }, /en la última hora/);
  no({ borrador: { ...bueno, confianza: 'media' } }, /Confianza media/);
  no({ borrador: { ...bueno, confianza: 'baja' } }, /Confianza baja/);
  no({ borrador: { ...bueno, confianza: undefined } }, /Confianza sin dato/);
  no({ borrador: { ...bueno, alertas: ['Precio no verificado: $1.000'] } }, /revisión automática marcó: Precio no verificado/);
  no({ borrador: { ...bueno, texto: '   ' } }, /no escribió ningún texto/);
  no({ borrador: null }, /no escribió ningún texto/);
});

test('bajo el tope todavía se envía, y el tope diario se puede cambiar', () => {
  assert.equal(evaluarEnvioAutomatico({ ...base, enviadosHoy: TOPE_DIARIO_DEFECTO - 1 }).enviar, true);
  assert.equal(evaluarEnvioAutomatico({ ...base, enviadosHoy: 100, topeDiario: 200 }).enviar, true);
  assert.equal(evaluarEnvioAutomatico({ ...base, enviadosUltimaHora: TOPE_POR_HORA_CONVERSACION - 1 }).enviar, true);
});

test('lo que el bot envía solo sigue pasando por la revisión: con alertas el borrador no llega a enviarse', () => {
  // el bot inventa un precio: la revisión lo marca, baja la confianza y obliga a escalar -> evaluarEnvioAutomatico lo frena
  const p = normalizarPropuesta({ texto: 'La pantalla cuesta $12.345', confianza: 'alta', escalar: false }, { conocimiento: CONOCIMIENTO_DEFECTO });
  assert.equal(p.confianza, 'baja');
  assert.equal(evaluarEnvioAutomatico({ ...base, borrador: p }).enviar, false);
  // y un mensaje de espera correcto (regla del estado de un pedido) sí puede enviarse aunque pida ejecutivo: es justamente un mensaje de espera
  const espera = normalizarPropuesta({ texto: 'Entiendo, quieres saber dónde está tu pedido N° 12345.\n\nRevisaremos internamente el caso y te responderemos en unos minutos, en horario hábil.', confianza: 'alta', escalar: true }, { conocimiento: CONOCIMIENTO_DEFECTO });
  assert.equal(espera.escalar, true);
  assert.equal(evaluarEnvioAutomatico({ ...base, borrador: espera }).enviar, true);
});

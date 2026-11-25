// Etiquetas, archivados, mensajes sin leer e indicador del bot de la bandeja de WhatsApp, con las consultas reales sobre Postgres en memoria (PGlite).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { asegurarTablaWhatsapp, asegurarTablaWhatsappBot } from '../../lib/db.js';
import { reiniciarUnaVez } from '../../lib/una-vez.js';
import {
  asegurarBandejaWhatsapp, listarEtiquetas, crearEtiqueta, actualizarEtiqueta, eliminarEtiqueta, asignarEtiqueta, marcarLeida, accionConversacion,
  sqlArchivada, sqlNoLeidos, sqlBotEstado, sqlEtiquetasJson, ETIQUETAS_INICIALES, normalizarColor,
  marcarLeidaEnWhatsapp, marcarLeidaYSincronizar,
} from '../../lib/whatsapp-bandeja.js';

async function crearBase() {
  const db = new PGlite({ extensions: { citext } });
  await db.waitReady;
  const salida = r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  const sql = async (strings, ...v) => salida(await db.query(strings.reduce((a, s, i) => a + s + (i < v.length ? `$${i + 1}` : ''), ''), v));
  sql.query = async (t, p = []) => salida(await db.query(t, p));
  await db.query('CREATE TABLE usuarios (id SERIAL PRIMARY KEY, nombre TEXT, email TEXT, activo BOOLEAN DEFAULT true)');
  reiniciarUnaVez();
  await asegurarTablaWhatsapp(sql);
  await asegurarTablaWhatsappBot(sql);
  await asegurarBandejaWhatsapp(sql);
  return { db, sql };
}

let n = 0;
async function conversacion(sql, mensajes = [], iniciada = '2026-11-01T10:00:00Z') {
  n++;
  const { rows: [ct] } = await sql`INSERT INTO whatsapp_contactos (whatsapp_id, telefono, nombre) VALUES (${'t' + n}, ${'t' + n}, ${'C' + n}) RETURNING id;`;
  const { rows: [c] } = await sql`INSERT INTO whatsapp_conversaciones (contacto_id, iniciada_en) VALUES (${ct.id}, ${iniciada}) RETURNING id;`;
  for (const [i, m] of mensajes.entries()) {
    await sql`INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, origen, contenido_texto) VALUES (${c.id}, ${`m${n}-${i}`}, ${m.en}, ${m.dir}, ${m.origen || 'api'}, 'x');`;
  }
  return c.id;
}
const campo = async (sql, expr, id) => (await sql.query(`SELECT ${expr} AS v FROM whatsapp_conversaciones c WHERE c.id = $1`, [id])).rows[0].v;
const iso = ms => new Date(ms).toISOString();

test('las etiquetas del equipo se siembran una sola vez, con color, y no reaparecen si se borran', async () => {
  const { db, sql } = await crearBase();
  let lista = await listarEtiquetas(sql);
  assert.deepEqual(lista.map(e => e.nombre), ETIQUETAS_INICIALES.map(e => e.nombre));
  assert.equal(lista[0].nombre, 'POST-VENTA');
  assert.equal(lista[1].color, '#E5163F');
  for (const e of lista) assert.ok((await eliminarEtiqueta(sql, e.id)).ok);
  reiniciarUnaVez();
  await asegurarBandejaWhatsapp(sql);
  assert.equal((await listarEtiquetas(sql)).length, 0);
  await db.close();
});

test('una etiqueta que ya existía sin color recibe color al crearse la columna, sin duplicarse', async () => {
  const { db, sql } = await crearBase();
  await sql`ALTER TABLE whatsapp_etiquetas DROP COLUMN color;`;
  await sql`ALTER TABLE whatsapp_etiquetas DROP COLUMN orden;`;
  await sql`DELETE FROM whatsapp_etiquetas;`;
  await sql`INSERT INTO whatsapp_etiquetas (nombre) VALUES ('SIN STOCK'), ('propia');`;
  reiniciarUnaVez();
  await asegurarBandejaWhatsapp(sql);
  const lista = await listarEtiquetas(sql);
  assert.equal(lista.filter(e => e.nombre === 'SIN STOCK').length, 1);
  assert.equal(lista.find(e => e.nombre === 'SIN STOCK').color, '#3FC1B0');
  assert.equal(lista.find(e => e.nombre === 'propia').color, '#8696A0'); // sin color definido: gris
  await db.close();
});

test('crear, editar y eliminar etiquetas; no se repite el nombre aunque cambien las mayúsculas', async () => {
  const { db, sql } = await crearBase();
  const c = await crearEtiqueta(sql, { nombre: '  Garantía   extendida ', color: '#ff0000' });
  assert.ok(c.ok);
  assert.equal(c.etiqueta.nombre, 'Garantía extendida');
  assert.equal(c.etiqueta.color, '#FF0000');
  assert.equal((await crearEtiqueta(sql, { nombre: 'SIN stock', color: '#000000' })).estado, 409);
  assert.equal((await crearEtiqueta(sql, { nombre: '   ' })).estado, 400);
  assert.equal((await crearEtiqueta(sql, { nombre: 'x'.repeat(41) })).estado, 400);
  assert.equal(normalizarColor('rojo'), '#8696A0');
  const e = await actualizarEtiqueta(sql, c.etiqueta.id, { nombre: 'Garantía', color: '#00A884' });
  assert.ok(e.ok);
  assert.equal(e.etiqueta.color, '#00A884');
  assert.equal((await actualizarEtiqueta(sql, c.etiqueta.id, { nombre: 'post-venta' })).estado, 409);
  assert.equal((await actualizarEtiqueta(sql, 99999, { nombre: 'zz' })).estado, 404);
  assert.ok((await eliminarEtiqueta(sql, c.etiqueta.id)).ok);
  assert.equal((await eliminarEtiqueta(sql, c.etiqueta.id)).estado, 404);
  await db.close();
});

test('asignar y quitar etiquetas de una conversación; al eliminar la etiqueta se quita de las conversaciones', async () => {
  const { db, sql } = await crearBase();
  const id = await conversacion(sql, [{ en: '2026-11-02T10:00:00Z', dir: 'in' }]);
  const [postventa, stock] = await listarEtiquetas(sql);
  let r = await asignarEtiqueta(sql, id, postventa.id, true, 'Ana');
  assert.ok(r.ok);
  r = await asignarEtiqueta(sql, id, stock.id, true, 'Ana');
  assert.deepEqual(r.etiquetas.map(e => e.nombre), ['POST-VENTA', stock.nombre]);
  assert.equal(r.etiquetas[0].color, '#1E63C9');
  r = await asignarEtiqueta(sql, id, postventa.id, true, 'Ana'); // repetir no duplica
  assert.equal(r.etiquetas.length, 2);
  r = await asignarEtiqueta(sql, id, postventa.id, false, 'Ana');
  assert.deepEqual(r.etiquetas.map(e => e.nombre), [stock.nombre]);
  assert.equal((await listarEtiquetas(sql)).find(e => e.id === stock.id).total, 1);
  await eliminarEtiqueta(sql, stock.id);
  assert.deepEqual(await campo(sql, sqlEtiquetasJson('c'), id), []);
  assert.equal((await asignarEtiqueta(sql, 99999, stock.id, true, 'Ana')).estado, 404);
  const { rows: aud } = await sql`SELECT detalle FROM whatsapp_auditoria WHERE conversacion_id = ${id} ORDER BY id;`;
  assert.ok(aud.some(a => /etiqueta agregada: POST-VENTA/.test(a.detalle)));
  await db.close();
});

test('archivar saca la conversación de la bandeja y un mensaje nuevo (del cliente o nuestro) la devuelve', async () => {
  const { db, sql } = await crearBase();
  const id = await conversacion(sql, [{ en: iso(Date.now() - 3600000), dir: 'in' }]);
  assert.equal(await campo(sql, sqlArchivada('c'), id), false);
  assert.ok((await accionConversacion(sql, id, 'archivar')).ok);
  assert.equal(await campo(sql, sqlArchivada('c'), id), true);
  await sql`INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, contenido_texto) VALUES (${id}, 'nuevo-1', ${iso(Date.now() + 1000)}, 'in', 'hola otra vez');`;
  assert.equal(await campo(sql, sqlArchivada('c'), id), false, 'llegó un mensaje: vuelve sola');
  await accionConversacion(sql, id, 'archivar');
  assert.equal(await campo(sql, sqlArchivada('c'), id), true);
  assert.ok((await accionConversacion(sql, id, 'desarchivar')).ok);
  assert.equal(await campo(sql, sqlArchivada('c'), id), false);
  assert.equal((await accionConversacion(sql, 99999, 'archivar')).estado, 404);
  assert.equal((await accionConversacion(sql, id, 'borrar')).estado, 400);
  // una conversación sin mensajes también se puede archivar
  const vacia = await conversacion(sql, []);
  await accionConversacion(sql, vacia, 'archivar');
  assert.equal(await campo(sql, sqlArchivada('c'), vacia), true);
  await db.close();
});

test('cuenta los mensajes sin leer; abrir la conversación o responder los da por atendidos; "no leído" manual se apaga al abrir', async () => {
  const { db, sql } = await crearBase();
  const t = Date.now();
  const id = await conversacion(sql, [
    { en: iso(t - 5 * 60000), dir: 'in' }, { en: iso(t - 4 * 60000), dir: 'in' }, { en: iso(t - 3 * 60000), dir: 'in' },
  ]);
  assert.equal(await campo(sql, sqlNoLeidos('c'), id), 3);
  assert.ok((await marcarLeida(sql, id)).ok);
  assert.equal(await campo(sql, sqlNoLeidos('c'), id), 0);
  await sql`INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, contenido_texto) VALUES (${id}, 'n1', ${iso(t + 2000)}, 'in', 'a');`;
  await sql`INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, contenido_texto) VALUES (${id}, 'n2', ${iso(t + 3000)}, 'in', 'b');`;
  assert.equal(await campo(sql, sqlNoLeidos('c'), id), 2);
  // respondemos (aunque sea desde el celular): lo anterior queda atendido
  await sql`INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, origen, contenido_texto) VALUES (${id}, 'o1', ${iso(t + 4000)}, 'out', 'app', 'respuesta');`;
  assert.equal(await campo(sql, sqlNoLeidos('c'), id), 0);
  // "marcar como no leído"
  assert.ok((await accionConversacion(sql, id, 'no_leida')).ok);
  assert.equal(await campo(sql, 'c.no_leida_manual', id), true);
  await marcarLeida(sql, id);
  assert.equal(await campo(sql, 'c.no_leida_manual', id), false);
  assert.equal((await marcarLeida(sql, 99999)).estado, 404);
  await db.close();
});

test('indicador del bot: borrador pendiente = en curso; respuesta enviada con el bot = respondida', async () => {
  const { db, sql } = await crearBase();
  const t = Date.now();
  const insertarBorrador = (id, estado, creado) => sql`INSERT INTO whatsapp_bot_borradores (conversacion_id, texto, estado, creado_en) VALUES (${id}, 'borrador', ${estado}, ${creado});`;

  const sin = await conversacion(sql, [{ en: iso(t - 60000), dir: 'in' }]);
  assert.equal(await campo(sql, sqlBotEstado('c'), sin), null);

  const pendiente = await conversacion(sql, [{ en: iso(t - 60000), dir: 'in' }]);
  await insertarBorrador(pendiente, 'pendiente', iso(t - 30000));
  assert.equal(await campo(sql, sqlBotEstado('c'), pendiente), 'en_curso');
  // un humano contesta después: el borrador ya no está "en curso"
  await sql`INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, contenido_texto) VALUES (${pendiente}, 'x1', ${iso(t)}, 'out', 'r');`;
  assert.equal(await campo(sql, sqlBotEstado('c'), pendiente), null);

  const descartado = await conversacion(sql, [{ en: iso(t - 60000), dir: 'in' }]);
  await insertarBorrador(descartado, 'descartado', iso(t - 30000));
  assert.equal(await campo(sql, sqlBotEstado('c'), descartado), null);

  const enviado = await conversacion(sql, [{ en: iso(t - 60000), dir: 'in' }, { en: iso(t - 20000), dir: 'out' }]);
  await insertarBorrador(enviado, 'enviado_editado', iso(t - 30000));
  assert.equal(await campo(sql, sqlBotEstado('c'), enviado), 'respondida');

  // pendiente nuevo sobre una conversación ya atendida con el bot: prima "en curso"
  await sql`INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, contenido_texto) VALUES (${enviado}, 'y1', ${iso(t - 10000)}, 'in', 'otra duda');`;
  await insertarBorrador(enviado, 'pendiente', iso(t - 5000));
  assert.equal(await campo(sql, sqlBotEstado('c'), enviado), 'en_curso');

  // envío automático futuro: un mensaje con origen 'bot'
  const auto = await conversacion(sql, [{ en: iso(t - 60000), dir: 'in' }, { en: iso(t - 50000), dir: 'out', origen: 'bot' }]);
  assert.equal(await campo(sql, sqlBotEstado('c'), auto), 'respondida');
  await db.close();
});

// ---- Sincronizar la lectura con WhatsApp ----
const credenciales = { accessToken: 'token-de-prueba', phoneNumberId: '12345' };
const fetchSimulado = (respuesta = { ok: true, json: { success: true } }) => {
  const llamadas = [];
  const fn = async (url, opts) => { llamadas.push({ url, opts, cuerpo: JSON.parse(opts.body) }); return { ok: respuesta.ok, status: respuesta.ok ? 200 : 400, json: async () => respuesta.json }; };
  fn.llamadas = llamadas;
  return fn;
};

test('el aviso de lectura usa el endpoint oficial de Meta con el id del mensaje', async () => {
  const f = fetchSimulado();
  const r = await marcarLeidaEnWhatsapp({ ...credenciales, messageId: 'wamid.ABC', fetchFn: f });
  assert.ok(r.ok);
  assert.equal(f.llamadas.length, 1);
  assert.equal(f.llamadas[0].url, 'https://graph.facebook.com/v21.0/12345/messages');
  assert.deepEqual(f.llamadas[0].cuerpo, { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.ABC' });
  assert.equal(f.llamadas[0].opts.headers.Authorization, 'Bearer token-de-prueba');
  assert.equal((await marcarLeidaEnWhatsapp({ phoneNumberId: '1', messageId: 'x', fetchFn: f })).motivo, 'sin_credenciales');
  assert.equal((await marcarLeidaEnWhatsapp({ ...credenciales, messageId: null, fetchFn: f })).motivo, 'sin_mensaje');
  const rechazado = await marcarLeidaEnWhatsapp({ ...credenciales, messageId: 'x', fetchFn: fetchSimulado({ ok: false, json: { error: { message: 'Parameter value is not valid' } } }) });
  assert.equal(rechazado.motivo, 'rechazado');
  const caido = await marcarLeidaEnWhatsapp({ ...credenciales, messageId: 'x', fetchFn: async () => { throw new Error('sin red'); } });
  assert.equal(caido.motivo, 'error_red');
});

test('al leer en el ERP se avisa a WhatsApp con el ÚLTIMO mensaje del cliente, solo si había mensajes sin leer', async () => {
  const { db, sql } = await crearBase();
  const t = Date.now();
  const id = await conversacion(sql, [{ en: iso(t - 3 * 60000), dir: 'in' }, { en: iso(t - 2 * 60000), dir: 'in' }]);
  const f = fetchSimulado();
  let r = await marcarLeidaYSincronizar(sql, id, { ...credenciales, fetchFn: f });
  assert.ok(r.ok);
  assert.equal(r.whatsapp, 'enviado');
  assert.equal(f.llamadas.length, 1);
  assert.match(f.llamadas[0].cuerpo.message_id, /-1$/); // el segundo mensaje (el más reciente)
  assert.equal(await campo(sql, sqlNoLeidos('c'), id), 0);
  // ya estaba leída: no se vuelve a avisar
  r = await marcarLeidaYSincronizar(sql, id, { ...credenciales, fetchFn: f });
  assert.equal(r.whatsapp, 'no_aplica');
  assert.equal(f.llamadas.length, 1);
  // si Meta falla, igual queda leída en el ERP
  await sql`INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, contenido_texto) VALUES (${id}, 'nuevo-x', ${iso(t + 5000)}, 'in', 'hola');`;
  r = await marcarLeidaYSincronizar(sql, id, { ...credenciales, fetchFn: fetchSimulado({ ok: false, json: { error: { message: 'token vencido' } } }) });
  assert.ok(r.ok);
  assert.equal(r.whatsapp, 'rechazado');
  assert.equal(await campo(sql, sqlNoLeidos('c'), id), 0);
  // sin credenciales configuradas también queda leída
  await sql`INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, contenido_texto) VALUES (${id}, 'nuevo-y', ${iso(t + 9000)}, 'in', 'hola 2');`;
  r = await marcarLeidaYSincronizar(sql, id, { fetchFn: f });
  assert.equal(r.whatsapp, 'sin_credenciales');
  assert.equal((await marcarLeidaYSincronizar(sql, 999999, credenciales)).estado, 404);
  await db.close();
});

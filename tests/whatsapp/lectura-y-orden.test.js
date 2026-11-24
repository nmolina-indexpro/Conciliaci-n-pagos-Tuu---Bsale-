// Estado de lectura y orden de la bandeja de WhatsApp, con la migración real de lib/db.js sobre Postgres en memoria (PGlite).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { asegurarTablaWhatsapp } from '../../lib/db.js';
import { reiniciarUnaVez } from '../../lib/una-vez.js';

async function crearBase() {
  const db = new PGlite({ extensions: { citext } });
  await db.waitReady;
  const salida = r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  const sql = async (strings, ...v) => salida(await db.query(strings.reduce((a, s, i) => a + s + (i < v.length ? `$${i + 1}` : ''), ''), v));
  sql.query = async (t, p = []) => salida(await db.query(t, p));
  await db.query('CREATE TABLE usuarios (id SERIAL PRIMARY KEY, nombre TEXT, email TEXT, activo BOOLEAN DEFAULT true)');
  reiniciarUnaVez();
  return { db, sql };
}

// Misma consulta que usa el handler whatsapp-marcar-leida
const marcarLeida = (sql, id) => sql`
  UPDATE whatsapp_conversaciones
  SET leida_hasta = GREATEST(now(), COALESCE((SELECT MAX(m.marca_tiempo) FROM whatsapp_mensajes m WHERE m.conversacion_id = whatsapp_conversaciones.id), now()))
  WHERE id = ${id} RETURNING leida_hasta;`;

async function crearConversacion(sql, tel, iniciada, mensajes) {
  const { rows: [ct] } = await sql`INSERT INTO whatsapp_contactos (whatsapp_id, telefono, nombre) VALUES (${tel}, ${tel}, ${'C' + tel}) RETURNING id;`;
  const { rows: [c] } = await sql`INSERT INTO whatsapp_conversaciones (contacto_id, iniciada_en) VALUES (${ct.id}, ${iniciada}) RETURNING id;`;
  for (const [i, m] of mensajes.entries()) {
    await sql`INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, contenido_texto) VALUES (${c.id}, ${tel + '-' + i}, ${m.en}, ${m.dir}, 'x');`;
  }
  return c.id;
}

test('al crear la columna leida_hasta, lo que ya existía queda como leído; lo nuevo, no', async () => {
  const { db, sql } = await crearBase();
  await asegurarTablaWhatsapp(sql);
  const vieja = await crearConversacion(sql, '1', '2026-01-01T10:00:00Z', [{ en: '2026-01-01T10:00:00Z', dir: 'in' }]);
  // simula la base de antes del cambio: sin la columna, con una conversación existente
  await sql`ALTER TABLE whatsapp_conversaciones DROP COLUMN leida_hasta;`;
  reiniciarUnaVez();
  await asegurarTablaWhatsapp(sql);
  const { rows: a } = await sql`SELECT leida_hasta FROM whatsapp_conversaciones WHERE id = ${vieja};`;
  assert.ok(a[0].leida_hasta, 'la conversación existente quedó como leída');
  // una conversación posterior a la migración arranca sin leer, y una nueva migración (otra instancia) no la toca
  const nueva = await crearConversacion(sql, '2', '2026-11-24T10:00:00Z', [{ en: '2026-11-24T10:00:00Z', dir: 'in' }]);
  reiniciarUnaVez();
  await asegurarTablaWhatsapp(sql);
  const { rows: b } = await sql`SELECT leida_hasta FROM whatsapp_conversaciones WHERE id = ${nueva};`;
  assert.equal(b[0].leida_hasta, null);
  await db.close();
});

test('marcar como leída deja la conversación leída aunque el mensaje venga con hora adelantada', async () => {
  const { db, sql } = await crearBase();
  await asegurarTablaWhatsapp(sql);
  const futuro = new Date(Date.now() + 5000).toISOString();
  const id = await crearConversacion(sql, '3', '2026-11-24T10:00:00Z', [{ en: futuro, dir: 'in' }]);
  const { rows } = await marcarLeida(sql, id);
  assert.ok(new Date(rows[0].leida_hasta).getTime() >= new Date(futuro).getTime());
  assert.equal((await marcarLeida(sql, 999999)).rows.length, 0);
  await db.close();
});

test('la bandeja se ordena por el último mensaje, no por cuándo empezó la conversación', async () => {
  const { db, sql } = await crearBase();
  await asegurarTablaWhatsapp(sql);
  const antigua = await crearConversacion(sql, '4', '2026-01-01T10:00:00Z', [{ en: '2026-11-24T15:00:00Z', dir: 'in' }]); // empezó en enero, escribió hoy
  const reciente = await crearConversacion(sql, '5', '2026-11-20T10:00:00Z', [{ en: '2026-11-20T10:05:00Z', dir: 'in' }]);
  const sinMensajes = await crearConversacion(sql, '6', '2026-11-22T10:00:00Z', []);
  const { rows } = await sql.query(`
    SELECT c.id FROM whatsapp_conversaciones c
    ORDER BY COALESCE((SELECT MAX(m.marca_tiempo) FROM whatsapp_mensajes m WHERE m.conversacion_id = c.id), c.iniciada_en) DESC, c.id DESC`);
  assert.deepEqual(rows.map(r => r.id), [antigua, sinMensajes, reciente]);
  await db.close();
});

test('la huella de novedades cambia con un mensaje nuevo y con una lectura', async () => {
  const { db, sql } = await crearBase();
  await asegurarTablaWhatsapp(sql);
  const huella = async () => {
    const { rows: [p] } = await sql`
      SELECT (SELECT MAX(marca_tiempo) FROM whatsapp_mensajes) AS mensajes, (SELECT MAX(updated_at) FROM whatsapp_conversaciones) AS editadas,
             (SELECT MAX(leida_hasta) FROM whatsapp_conversaciones) AS leidas, (SELECT COUNT(*)::int FROM whatsapp_conversaciones) AS total;`;
    const f = x => (x ? new Date(x).getTime() : 0);
    return [f(p.mensajes), f(p.editadas), f(p.leidas), p.total].join('-');
  };
  const h0 = await huella();
  const id = await crearConversacion(sql, '7', '2026-11-24T10:00:00Z', [{ en: '2026-11-24T10:00:00Z', dir: 'in' }]);
  const h1 = await huella();
  assert.notEqual(h1, h0);
  await marcarLeida(sql, id);
  assert.notEqual(await huella(), h1);
  await db.close();
});

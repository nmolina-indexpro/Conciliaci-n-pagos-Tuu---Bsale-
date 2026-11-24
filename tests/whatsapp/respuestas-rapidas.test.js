// Respuestas rápidas de WhatsApp: siembra única, validación y CRUD contra Postgres real en memoria (PGlite).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { reiniciarUnaVez } from '../../lib/una-vez.js';
import {
  asegurarTablaRespuestasRapidas, listarRespuestas, crearRespuesta, actualizarRespuesta, eliminarRespuesta,
  normalizarAtajo, validarRespuesta, RESPUESTAS_INICIALES, TEXTO_MAX,
} from '../../lib/whatsapp-respuestas-rapidas.js';

async function crearBase() {
  const db = new PGlite();
  await db.waitReady;
  const salida = r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  const sql = async (strings, ...valores) => salida(await db.query(strings.reduce((a, s, i) => a + s + (i < valores.length ? `$${i + 1}` : ''), ''), valores));
  sql.query = async (texto, params = []) => salida(await db.query(texto, params));
  reiniciarUnaVez();
  return { db, sql };
}

test('normalizarAtajo quita la barra, los espacios y los símbolos', () => {
  assert.equal(normalizarAtajo('/Recontactar Pantalla'), 'RecontactarPantalla');
  assert.equal(normalizarAtajo('  //bisagras!! '), 'bisagras');
  assert.equal(normalizarAtajo('garantía_2-años'), 'garantía_2-años');
  assert.equal(normalizarAtajo(null), '');
});

test('validarRespuesta exige atajo y texto, y limita el largo', () => {
  assert.throws(() => validarRespuesta({ atajo: '/', texto: 'hola' }), /atajo/i);
  assert.throws(() => validarRespuesta({ atajo: 'a', texto: '   ' }), /texto/i);
  assert.throws(() => validarRespuesta({ atajo: 'a', texto: 'x'.repeat(TEXTO_MAX + 1) }), /largo/i);
  assert.deepEqual(validarRespuesta({ atajo: '/Hola', texto: ' uno\r\ndos ' }), { atajo: 'Hola', texto: 'uno\ndos' });
});

test('la tabla se crea con las 4 respuestas iniciales y no se vuelven a sembrar si se borran', async () => {
  const { db, sql } = await crearBase();
  await asegurarTablaRespuestasRapidas(sql);
  let lista = await listarRespuestas(sql);
  assert.equal(lista.length, RESPUESTAS_INICIALES.length);
  assert.deepEqual(lista.map(r => r.atajo.toLowerCase()), ['bisagras', 'losiento', 'pantalladisponible', 'recontactarpantalla']);
  assert.match(lista.find(r => r.atajo === 'PantallaDISPONIBLE').texto, /Precio: \$\n/);

  for (const r of lista) assert.ok((await eliminarRespuesta(sql, r.id)).ok);
  reiniciarUnaVez(); // como una instancia nueva tras un despliegue
  await asegurarTablaRespuestasRapidas(sql);
  assert.equal((await listarRespuestas(sql)).length, 0);
  await db.close();
});

test('crear, editar y eliminar; el atajo no se repite aunque cambien las mayúsculas', async () => {
  const { db, sql } = await crearBase();
  await asegurarTablaRespuestasRapidas(sql);
  const c = await crearRespuesta(sql, { atajo: '/Gracias', texto: 'Gracias por escribirnos' }, 'Ana');
  assert.ok(c.ok);
  assert.equal(c.respuesta.atajo, 'Gracias');

  const dup = await crearRespuesta(sql, { atajo: 'gracias', texto: 'otra' }, 'Ana');
  assert.equal(dup.ok, false);
  assert.equal(dup.estado, 409);

  const vacio = await crearRespuesta(sql, { atajo: 'x', texto: '' }, 'Ana');
  assert.equal(vacio.estado, 400);

  const e = await actualizarRespuesta(sql, c.respuesta.id, { atajo: 'Gracias2', texto: 'Texto nuevo' }, 'Patricio');
  assert.ok(e.ok);
  assert.equal(e.respuesta.texto, 'Texto nuevo');
  assert.equal(e.respuesta.actualizadoPor, 'Patricio');

  // editar a un atajo que ya usa otra respuesta
  const choque = await actualizarRespuesta(sql, c.respuesta.id, { atajo: 'BISAGRAS', texto: 'x' }, 'Ana');
  assert.equal(choque.estado, 409);

  assert.equal((await actualizarRespuesta(sql, 99999, { atajo: 'z', texto: 'z' }, 'Ana')).estado, 404);
  assert.ok((await eliminarRespuesta(sql, c.respuesta.id)).ok);
  assert.equal((await eliminarRespuesta(sql, c.respuesta.id)).estado, 404);
  assert.equal((await eliminarRespuesta(sql, 'abc')).estado, 400);
  await db.close();
});

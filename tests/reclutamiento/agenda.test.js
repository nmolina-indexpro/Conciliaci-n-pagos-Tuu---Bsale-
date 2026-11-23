// Reclutamiento: lógica de espacios (pura) y las consultas SQL de la agenda contra Postgres real en memoria (PGlite).
// Las consultas de abajo son las mismas que usa api/negocio.js (manejarAgendaPublica / manejarReclutamiento): si cambian allá, actualizar acá.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearBase } from '../mailing/_pg.js';
import { asegurarTablaReclutamiento } from '../../lib/db.js';
import { configInicial, normalizarConfig, generarEspacios, chileAUtc, fechaChile, horaChile, normalizarPostulante, normalizarTelefono, nuevoToken } from '../../lib/reclutamiento.js';

const AHORA = new Date('2026-11-23T20:00:00Z'); // lunes 23-nov-2026, 17:00 en Chile (UTC-3)

test('configuración inicial: martes a viernes 10:30-15:30, 60 min, hasta fin de mes', () => {
  const c = configInicial('2026-11-23');
  assert.deepEqual(c.dias, [2, 3, 4, 5]); assert.equal(c.fecha_hasta, '2026-11-30'); assert.equal(normalizarConfig(c).ok, true);
});

test('espacios: 24 h de anticipación, solo martes a viernes, 5 por día', () => {
  const v = normalizarConfig(configInicial('2026-11-23'));
  const esp = generarEspacios(v.config, AHORA);
  assert.deepEqual([...new Set(esp.map(e => e.fecha))], ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']); // el lunes 30 no entra
  assert.equal(esp.filter(e => e.estado === 'pronto').length, 5);   // martes 24: dentro de las próximas 24 h
  assert.equal(esp.filter(e => e.estado === 'libre').length, 15);
  assert.deepEqual(esp.filter(e => e.fecha === '2026-11-25').map(e => e.hora), ['10:30', '11:30', '12:30', '13:30', '14:30']);
  assert.equal(esp[5].inicio, '2026-11-25T13:30:00.000Z'); assert.equal(horaChile(esp[5].inicio), '10:30'); assert.equal(fechaChile(esp[5].inicio), '2026-11-25');
});

test('horario de verano e invierno de Chile', () => {
  assert.equal(chileAUtc('2026-11-25', '10:30').toISOString(), '2026-11-25T13:30:00.000Z'); // UTC-3
  assert.equal(chileAUtc('2026-07-15', '12:00').toISOString(), '2026-07-15T16:00:00.000Z'); // UTC-4
});

test('configuración inválida se rechaza', () => {
  const c = configInicial('2026-11-23');
  assert.equal(normalizarConfig({ ...c, desde: '16:00' }).ok, false);
  assert.equal(normalizarConfig({ ...c, dias: [] }).ok, false);
  assert.equal(normalizarConfig({ ...c, enlace_video: 'javascript:alert(1)' }).ok, false);
  assert.equal(normalizarConfig({ ...c, duracion_min: 5 }).ok, false);
});

test('postulante: normaliza teléfono y valida correo', () => {
  assert.equal(normalizarTelefono('957011597'), '+56 9 5701 1597');
  assert.equal(normalizarTelefono('+56962013831'), '+56 9 6201 3831');
  assert.equal(normalizarPostulante({ nombre: 'Ana Pérez', email: 'no-es-correo' }).ok, false);
  assert.equal(normalizarPostulante({ nombre: 'Ana Pérez', email: 'ANA@Correo.cl' }).postulante.email, 'ana@correo.cl');
  assert.equal(nuevoToken().length, 24);
});

test('SQL: importar, reservar, cambiar y bloquear en Postgres real', async () => {
  const { sql, cerrar } = await crearBase();
  try {
    await asegurarTablaReclutamiento(sql);
    // importar (misma consulta de búsqueda y de inserción que el handler)
    const alta = async (p) => {
      const { rows: ex } = await sql`SELECT id FROM reclutamiento_postulantes WHERE (${p.indeed_id}::text IS NOT NULL AND indeed_id = ${p.indeed_id}) OR (${p.email}::text IS NOT NULL AND lower(email) = ${p.email}) LIMIT 1;`;
      if (ex[0]) return { id: ex[0].id, nuevo: false };
      const { rows } = await sql`INSERT INTO reclutamiento_postulantes (token, nombre, email, telefono, ubicacion, cargo, origen, indeed_id, url_perfil, fecha_postulacion, estado_indeed, respuestas, resumen, notas)
        VALUES (${nuevoToken()}, ${p.nombre}, ${p.email}, ${p.telefono}, ${p.ubicacion}, ${p.cargo}, ${p.origen}, ${p.indeed_id}, ${p.url_perfil}, ${p.fecha_postulacion}::date, ${p.estado_indeed}, ${JSON.stringify(p.respuestas)}::jsonb, ${p.resumen}, ${p.notas}) RETURNING id;`;
      return { id: rows[0].id, nuevo: true };
    };
    const a = normalizarPostulante({ nombre: 'Ana Pérez', email: 'ana@correo.cl', indeed_id: 'abc123', fecha_postulacion: '2026-11-20', respuestas: { experiencia: '4' } }).postulante;
    const b = normalizarPostulante({ nombre: 'Beto Soto', email: '', fecha_postulacion: '2026-11-21' }).postulante;
    const ra = await alta(a), rb = await alta(b);
    assert.equal(ra.nuevo, true); assert.equal(rb.nuevo, true);
    assert.equal((await alta(a)).nuevo, false, 'reimportar el mismo postulante no lo duplica');
    assert.equal((await alta({ ...a, indeed_id: null })).nuevo, false, 'también se reconoce por correo');

    const v = normalizarConfig(configInicial('2026-11-23')); const esp = generarEspacios(v.config, AHORA).filter(e => e.estado === 'libre');
    const reservar = async (pid, e) => sql`INSERT INTO reclutamiento_reservas (postulante_id, inicio, fin) VALUES (${pid}, ${e.inicio}, ${e.fin});`;
    await reservar(ra.id, esp[0]);
    // otra persona no puede tomar el mismo espacio
    await assert.rejects(() => reservar(rb.id, esp[0]), /duplicate key|unique/i);
    // una persona no puede tener dos reservas a la vez
    await assert.rejects(() => reservar(ra.id, esp[1]), /duplicate key|unique/i);
    // cambio de horario: se cancela la anterior y se crea la nueva; el espacio viejo queda libre para otros
    await sql`UPDATE reclutamiento_reservas SET estado = 'cancelada', cancelado_en = now(), cancelado_por = 'postulante (cambio)' WHERE postulante_id = ${ra.id} AND estado = 'confirmada';`;
    await reservar(ra.id, esp[1]);
    await reservar(rb.id, esp[0]);
    const { rows: conf } = await sql`SELECT postulante_id, inicio FROM reclutamiento_reservas WHERE estado = 'confirmada' ORDER BY postulante_id;`;
    assert.equal(conf.length, 2);
    // ocupados + bloqueos alimentan generarEspacios
    await sql`INSERT INTO reclutamiento_bloqueos (inicio, creado_por) VALUES (${esp[5].inicio}, 'test') ON CONFLICT DO NOTHING;`;
    const { rows: oc } = await sql`SELECT r.inicio, p.nombre FROM reclutamiento_reservas r JOIN reclutamiento_postulantes p ON p.id = r.postulante_id WHERE r.estado = 'confirmada' AND r.inicio > now() - interval '2 days';`;
    const { rows: bl } = await sql`SELECT inicio FROM reclutamiento_bloqueos WHERE inicio > now() - interval '2 days';`;
    const todos = generarEspacios(v.config, AHORA, { ocupados: new Set(oc.map(r => new Date(r.inicio).toISOString())), bloqueados: new Set(bl.map(r => new Date(r.inicio).toISOString())) });
    assert.equal(todos.filter(e => e.estado === 'ocupado').length, 2); assert.equal(todos.filter(e => e.estado === 'bloqueado').length, 1);
    assert.equal(todos.filter(e => e.estado === 'libre').length, 12);
    // configuración (upsert) y consulta con join para la lista del administrador
    await sql`INSERT INTO reclutamiento_config (id, config, actualizado_por) VALUES (1, ${JSON.stringify(v.config)}::jsonb, 'x') ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, actualizado_en = now();`;
    const { rows: cfg } = await sql`SELECT config FROM reclutamiento_config WHERE id = 1;`; assert.equal(normalizarConfig(cfg[0].config).ok, true);
    const { rows: lista } = await sql`SELECT p.id, p.nombre, p.fecha_postulacion, r.inicio AS reserva_inicio FROM reclutamiento_postulantes p LEFT JOIN reclutamiento_reservas r ON r.postulante_id = p.id AND r.estado = 'confirmada' ORDER BY p.fecha_postulacion DESC NULLS LAST, p.id;`;
    assert.equal(lista.length, 2); assert.ok(lista.every(x => x.reserva_inicio));
    // eliminar un postulante borra sus reservas (derecho a borrado)
    await sql`DELETE FROM reclutamiento_postulantes WHERE id = ${rb.id};`;
    const { rows: res } = await sql`SELECT count(*)::int AS n FROM reclutamiento_reservas WHERE postulante_id = ${rb.id};`; assert.equal(res[0].n, 0);
  } finally { await cerrar(); }
});

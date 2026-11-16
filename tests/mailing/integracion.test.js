// Pruebas de integración del módulo de Mailing contra Postgres real en memoria (PGlite): migración, importación, lanzamiento, worker, eventos de SES y baja.
// Ejecutar: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { crearBase, crearContacto, crearLista, crearCampana, uuid } from './_pg.js';
import { asegurarTablasMailing } from '../../lib/db.js';
import { reiniciarUnaVez } from '../../lib/una-vez.js';
import { importarCsv } from '../../lib/mailing/importar.js';
import { lanzarCampana, TAMANO_LOTE } from '../../lib/mailing/lanzar.js';
import { procesarLote, crearRepoSql } from '../../lib/mailing/worker.js';
import { normalizarEventoSes, aplicarEventoSes } from '../../lib/mailing/eventos-ses.js';
import { darDeBaja, manejarBaja } from '../../lib/mailing/baja.js';
import { crearTokenBaja } from '../../lib/mailing/token-baja.js';
import { ErrorSes } from '../../lib/mailing/ses.js';

process.env.MK_UNSUB_SECRET = 'secreto-de-prueba-largo-1234567890';
process.env.MK_PUBLIC_BASE_URL = 'https://erp.indexstore.cl';

const SIN_ESPERA = { esperar: async () => {} };
const escalar = async (sql, texto, params = []) => Object.values((await sql.query(texto, params)).rows[0])[0];

// `enviar` falso: registra a quién se le mandó y devuelve un MessageId.
function enviadorFalso(opciones = {}) {
  const enviados = [];
  const fn = async datos => {
    if (opciones.falla) { const e = opciones.falla(datos); if (e) throw e; }
    enviados.push(datos);
    return { messageId: `ses-${enviados.length}-${datos.para}` };
  };
  fn.enviados = enviados;
  return fn;
}
const encoladorFalso = () => { const lotes = []; const fn = async m => { lotes.push(...m); }; fn.lotes = lotes; return fn; };

test('migración: idempotente (se puede correr varias veces, también en instancias nuevas)', async () => {
  const { sql, cerrar } = await crearBase();
  reiniciarUnaVez();
  await asegurarTablasMailing(sql);
  reiniciarUnaVez();
  await asegurarTablasMailing(sql);
  assert.equal(await escalar(sql, `SELECT count(*)::int FROM information_schema.tables WHERE table_name LIKE 'mk\\_%'`), 9);
  await cerrar();
});

test('importación: deduplica, separa inválidos, no reactiva bajas ni pisa datos, y mk_suppressions manda', async () => {
  const { sql, cerrar } = await crearBase();
  // Ya existe uno dado de baja (con nombre) y uno suprimido por rebote que todavía no está como contacto.
  await sql`INSERT INTO mk_contacts (email, first_name, status) VALUES ('baja@x.cl', 'Original', 'unsubscribed')`;
  await sql`INSERT INTO mk_suppressions (email, reason, detail) VALUES ('rebote@x.cl', 'hard_bounce', 'previo')`;

  const csv = [
    'Contact Email,First Name,Last Name,Company,Tags,Comuna',
    'ana@x.cl,Ana,Pérez,ACME,"vip, baterias",Santiago',
    'ANA@X.CL,,,,,',
    'mal-correo,Juan,,,,',
    'baja@x.cl,Nuevo Nombre,,,,',
    'rebote@x.cl,Rebotado,,,,',
    '"Luis <luis@x.cl>",Luis,,,,Maipú',
  ].join('\n');
  const r = await importarCsv(sql, csv, { tipo: 'contactos' });
  assert.equal(r.ok, true);
  assert.equal(r.filas, 6);
  assert.equal(r.invalidos, 1);
  assert.equal(r.duplicados_en_archivo, 1);
  assert.equal(r.contactos_nuevos, 3); // ana, rebote, luis
  assert.equal(r.contactos_existentes, 1); // baja@x.cl

  const { rows } = await sql`SELECT email::text AS email, first_name, status::text AS status, tags, attributes FROM mk_contacts ORDER BY email`;
  const por = Object.fromEntries(rows.map(f => [f.email, f]));
  assert.equal(por['baja@x.cl'].status, 'unsubscribed', 'una baja no se reactiva al reimportar');
  assert.equal(por['baja@x.cl'].first_name, 'Original', 'los datos existentes no se pisan');
  assert.equal(por['rebote@x.cl'].status, 'bounced', 'mk_suppressions manda sobre el alta nueva');
  assert.equal(por['ana@x.cl'].status, 'subscribed');
  assert.deepEqual(por['ana@x.cl'].tags.sort(), ['baterias', 'vip']);
  assert.equal(por['ana@x.cl'].attributes.Comuna, 'Santiago');
  assert.equal(por['luis@x.cl'].first_name, 'Luis');

  // Reimportar el mismo archivo no duplica nada.
  const r2 = await importarCsv(sql, csv, { tipo: 'contactos' });
  assert.equal(r2.contactos_nuevos, 0);
  assert.equal(await escalar(sql, 'SELECT count(*)::int FROM mk_contacts'), 4);
  await cerrar();
});

test('importación de supresiones: marca contactos existentes y guarda las de correos desconocidos', async () => {
  const { sql, cerrar } = await crearBase();
  await crearContacto(sql, 'a@x.cl'); await crearContacto(sql, 'b@x.cl'); await crearContacto(sql, 'c@x.cl');
  const r = await importarCsv(sql, 'Email,Reason\na@x.cl,Unsubscribed\nb@x.cl,Hard Bounce\nz@x.cl,Spam complaint\nc@x.cl,otra cosa', { tipo: 'supresiones' });
  assert.equal(r.ok, true);
  assert.equal(r.invalidos, 1, 'una fila sin motivo reconocible se informa y no se suprime a ciegas');
  assert.equal(r.supresiones_nuevas, 3);
  const estados = Object.fromEntries((await sql`SELECT email::text AS email, status::text AS status FROM mk_contacts`).rows.map(f => [f.email, f.status]));
  assert.deepEqual(estados, { 'a@x.cl': 'unsubscribed', 'b@x.cl': 'bounced', 'c@x.cl': 'subscribed' });
  assert.equal(await escalar(sql, `SELECT count(*)::int FROM mk_suppressions WHERE email = 'z@x.cl'`), 1);
  // Al importar después a z@x.cl como contacto, queda complained.
  await importarCsv(sql, 'Email\nz@x.cl', { tipo: 'contactos' });
  assert.equal(await escalar(sql, `SELECT status::text FROM mk_contacts WHERE email = 'z@x.cl'`), 'complained');
  // Con categoría por defecto, el archivo sin columna de motivo se acepta.
  const r2 = await importarCsv(sql, 'Email\nc@x.cl', { tipo: 'supresiones', categoria: 'unsubscribe' });
  assert.equal(r2.invalidos, 0);
  assert.equal(await escalar(sql, `SELECT status::text FROM mk_contacts WHERE email = 'c@x.cl'`), 'unsubscribed');
  await cerrar();
});

test('lanzamiento: la audiencia excluye suprimidos, no suscritos y listas excluidas; reintentar no duplica', async () => {
  const { sql, cerrar } = await crearBase();
  const ok1 = await crearContacto(sql, 'ok1@x.cl'); const ok2 = await crearContacto(sql, 'ok2@x.cl');
  const baja = await crearContacto(sql, 'baja@x.cl', { estado: 'unsubscribed' });
  const rebote = await crearContacto(sql, 'rebote@x.cl', { estado: 'bounced' });
  const suprimido = await crearContacto(sql, 'suprimido@x.cl'); // contacto «subscribed» pero con supresión global (estados desincronizados)
  await sql`INSERT INTO mk_suppressions (email, reason) VALUES ('suprimido@x.cl', 'complaint')`;
  const excluido = await crearContacto(sql, 'excluido@x.cl');
  const lista = await crearLista(sql, 'clientes', [ok1, ok2, baja, rebote, suprimido, excluido]);
  const listaExcl = await crearLista(sql, 'no-molestar', [excluido]);
  const id = await crearCampana(sql, { listas: [lista], excluidas: [listaExcl] });

  const encolar = encoladorFalso();
  const r = await lanzarCampana(sql, id, { encolar });
  assert.equal(r.status, 200);
  assert.equal(r.destinatarios, 2);
  const quienes = (await sql`SELECT email::text AS email FROM mk_sends WHERE campaign_id = ${id} ORDER BY email`).rows.map(x => x.email);
  assert.deepEqual(quienes, ['ok1@x.cl', 'ok2@x.cl']);

  const c = (await sql`SELECT status::text AS status, total_recipients, html_snapshot FROM mk_campaigns WHERE id = ${id}`).rows[0];
  assert.equal(c.status, 'sending');
  assert.equal(c.total_recipients, 2);
  assert.match(c.html_snapshot, /date de baja aquí/, 'si la plantilla no trae {{unsubscribe_url}} se agrega el pie de baja');

  // Segunda llamada (doble clic / reintento): la campaña ya fue reclamada.
  assert.equal((await lanzarCampana(sql, id, { encolar })).status, 409);
  // Aun forzando el estado para repetir el armado, unique(campaign_id, contact_id) impide duplicar.
  await sql`UPDATE mk_campaigns SET status = 'scheduled' WHERE id = ${id}`;
  assert.equal((await lanzarCampana(sql, id, { encolar })).status, 200);
  assert.equal(await escalar(sql, `SELECT count(*)::int FROM mk_sends WHERE campaign_id = $1`, [id]), 2);
  await cerrar();
});

test('lanzamiento: encola ceil(n/50) lotes escalonados con id de deduplicación, y una audiencia vacía falla sin encolar', async () => {
  const { sql, cerrar } = await crearBase();
  const ids = [];
  for (let i = 0; i < 120; i++) ids.push(await crearContacto(sql, `u${i}@x.cl`));
  const lista = await crearLista(sql, 'grande', ids);
  const id = await crearCampana(sql, { listas: [lista], rate: 14 });
  const encolar = encoladorFalso();
  const r = await lanzarCampana(sql, id, { encolar, ahora: 1_000_000 });
  assert.equal(r.lotes, 3);
  assert.equal(encolar.lotes.length, 3);
  assert.deepEqual(encolar.lotes.map(l => l.retrasoSeg), [0, Math.floor(TAMANO_LOTE / 14), Math.floor((2 * TAMANO_LOTE) / 14)]);
  assert.equal(new Set(encolar.lotes.map(l => l.idDedup)).size, 3);
  assert.match(encolar.lotes[0].destino, /recurso=mk-worker-enviar-lote$/);

  const vacia = await crearLista(sql, 'vacia', []);
  const id2 = await crearCampana(sql, { listas: [vacia] });
  const e2 = encoladorFalso();
  const r2 = await lanzarCampana(sql, id2, { encolar: e2 });
  assert.equal(r2.status, 422);
  assert.equal(e2.lotes.length, 0);
  assert.equal(await escalar(sql, `SELECT status::text FROM mk_campaigns WHERE id = $1`, [id2]), 'failed');

  // Si QStash falla, la campaña queda en pausa (relanzable) y se informa.
  const lista3 = await crearLista(sql, 'tres', [ids[0]]);
  const id3 = await crearCampana(sql, { listas: [lista3] });
  const r3 = await lanzarCampana(sql, id3, { encolar: async () => { throw new Error('QStash caído'); } });
  assert.equal(r3.status, 502);
  assert.equal(await escalar(sql, `SELECT status::text FROM mk_campaigns WHERE id = $1`, [id3]), 'paused');
  const r4 = await lanzarCampana(sql, id3, { encolar: encoladorFalso() });
  assert.equal(r4.status, 200);
  assert.equal(r4.reanudada, true);
  await cerrar();
});

test('worker: cada destinatario recibe UN solo correo, aunque el lote se repita o corra en paralelo', async () => {
  const { sql, cerrar } = await crearBase();
  const ids = [];
  for (let i = 0; i < 120; i++) ids.push(await crearContacto(sql, `u${i}@x.cl`, { nombre: i === 0 ? 'Ana' : null }));
  const lista = await crearLista(sql, 'grande', ids);
  const id = await crearCampana(sql, { listas: [lista] });
  await lanzarCampana(sql, id, { encolar: encoladorFalso() });

  const repo = crearRepoSql(sql);
  const enviar = enviadorFalso();
  // 3 lotes concurrentes + un 4.º lote «de reintento» de QStash al mismo tiempo.
  const resultados = await Promise.all([1, 2, 3, 4].map(() => procesarLote(repo, { campaignId: id, enviar, ...SIN_ESPERA })));
  assert.equal(enviar.enviados.length, 120);
  assert.equal(new Set(enviar.enviados.map(e => e.para)).size, 120, 'ningún correo repetido');
  assert.equal(resultados.reduce((a, r) => a + r.reclamados, 0), 120);

  // Un lote extra que llega tarde (QStash reintenta) ya no encuentra nada que enviar.
  const tarde = await procesarLote(repo, { campaignId: id, enviar, ...SIN_ESPERA });
  assert.equal(enviar.enviados.length, 120);
  assert.ok(tarde.omitido || tarde.reclamados === 0);

  const c = (await sql`SELECT status::text AS status, total_sent, finished_at FROM mk_campaigns WHERE id = ${id}`).rows[0];
  assert.equal(c.status, 'sent');
  assert.equal(c.total_sent, 120);
  assert.ok(c.finished_at);
  assert.equal(await escalar(sql, `SELECT count(*)::int FROM mk_sends WHERE campaign_id = $1 AND status = 'sent' AND ses_message_id IS NOT NULL`, [id]), 120);

  // Personalización y encabezados de baja.
  const ana = enviar.enviados.find(e => e.para === 'u0@x.cl');
  assert.match(ana.html, /Hola Ana/);
  assert.equal(enviar.enviados.find(e => e.para === 'u1@x.cl').asunto, 'Oferta para ti', 'valor por defecto cuando no hay nombre');
  assert.match(ana.urlBaja, /^https:\/\/erp\.indexstore\.cl\/u\/[\w-]+\.[\w-]+$/);
  assert.ok(ana.html.includes(ana.urlBaja), 'el enlace de baja del cuerpo es el mismo del encabezado List-Unsubscribe');
  assert.ok(!/\{\{/.test(ana.html), 'no queda ninguna variable sin reemplazar');
  await cerrar();
});

test('worker: re-cruza supresiones justo antes de enviar (baja posterior al lanzamiento)', async () => {
  const { sql, cerrar } = await crearBase();
  const a = await crearContacto(sql, 'a@x.cl'); const b = await crearContacto(sql, 'b@x.cl'); const c = await crearContacto(sql, 'c@x.cl');
  const lista = await crearLista(sql, 'l', [a, b, c]);
  const id = await crearCampana(sql, { listas: [lista] });
  await lanzarCampana(sql, id, { encolar: encoladorFalso() });
  assert.equal(await escalar(sql, `SELECT count(*)::int FROM mk_sends WHERE campaign_id = $1`, [id]), 3);

  // Después del lanzamiento: a se da de baja (supresión) y b rebota (estado del contacto, sin fila de supresión).
  await sql`INSERT INTO mk_suppressions (email, reason) VALUES ('a@x.cl', 'unsubscribe')`;
  await sql`UPDATE mk_contacts SET status = 'bounced' WHERE email = 'b@x.cl'`;

  const enviar = enviadorFalso();
  const r = await procesarLote(crearRepoSql(sql), { campaignId: id, enviar, ...SIN_ESPERA });
  assert.deepEqual(enviar.enviados.map(e => e.para), ['c@x.cl']);
  assert.equal(r.suprimidos, 2);
  const estados = Object.fromEntries((await sql`SELECT email::text AS email, status::text AS status FROM mk_sends WHERE campaign_id = ${id}`).rows.map(f => [f.email, f.status]));
  assert.deepEqual(estados, { 'a@x.cl': 'suppressed', 'b@x.cl': 'suppressed', 'c@x.cl': 'sent' });
  assert.equal(await escalar(sql, `SELECT status::text FROM mk_campaigns WHERE id = $1`, [id]), 'sent', 'los suprimidos no dejan la campaña abierta');
  await cerrar();
});

test('worker: campaña pausada o cancelada no envía; error temporal reintenta sin duplicar; permanente falla; error de cuenta pausa', async () => {
  const { sql, cerrar } = await crearBase();
  const ids = [];
  for (const e of ['ok@x.cl', 'temporal@x.cl', 'malo@x.cl']) ids.push(await crearContacto(sql, e));
  const lista = await crearLista(sql, 'l', ids);
  const id = await crearCampana(sql, { listas: [lista] });
  await lanzarCampana(sql, id, { encolar: encoladorFalso() });
  const repo = crearRepoSql(sql);

  await sql`UPDATE mk_campaigns SET status = 'paused' WHERE id = ${id}`;
  const e0 = enviadorFalso();
  assert.match((await procesarLote(repo, { campaignId: id, enviar: e0, ...SIN_ESPERA })).omitido, /paused/);
  assert.equal(e0.enviados.length, 0);
  await sql`UPDATE mk_campaigns SET status = 'sending' WHERE id = ${id}`;

  const enviar = enviadorFalso({ falla: d => (d.para === 'temporal@x.cl' ? new ErrorSes('SES 503', 'temporal') : d.para === 'malo@x.cl' ? new ErrorSes('MessageRejected', 'permanente') : null) });
  const r = await procesarLote(repo, { campaignId: id, enviar, ...SIN_ESPERA });
  assert.deepEqual(enviar.enviados.map(e => e.para), ['ok@x.cl']);
  assert.equal(r.fallidos, 1); assert.equal(r.reintentos, 1); assert.equal(r.cerrada, false);
  const estados = Object.fromEntries((await sql`SELECT email::text AS email, status::text AS status, attempts FROM mk_sends WHERE campaign_id = ${id}`).rows.map(f => [f.email, `${f.status}/${f.attempts}`]));
  assert.deepEqual(estados, { 'ok@x.cl': 'sent/1', 'temporal@x.cl': 'queued/1', 'malo@x.cl': 'failed/1' });

  // Mientras dura el retraso, otro lote no lo toma. Pasado el retraso, se envía una sola vez.
  assert.equal((await procesarLote(repo, { campaignId: id, enviar, ...SIN_ESPERA })).reclamados, 0);
  await sql`UPDATE mk_sends SET queued_at = now() - interval '1 second' WHERE status = 'queued'`;
  const e2 = enviadorFalso();
  const r2 = await procesarLote(repo, { campaignId: id, enviar: e2, ...SIN_ESPERA });
  assert.deepEqual(e2.enviados.map(e => e.para), ['temporal@x.cl']);
  assert.equal(r2.cerrada, true);

  // Error de credenciales/cuenta: se detiene todo, lo no procesado vuelve a la cola y la campaña queda en pausa.
  const dos = [await crearContacto(sql, 'p1@x.cl'), await crearContacto(sql, 'p2@x.cl')];
  const id2 = await crearCampana(sql, { listas: [await crearLista(sql, 'l2', dos)] });
  await lanzarCampana(sql, id2, { encolar: encoladorFalso() });
  const r3 = await procesarLote(repo, { campaignId: id2, enviar: enviadorFalso({ falla: () => new ErrorSes('SES 403 AccessDenied', 'config') }), ...SIN_ESPERA });
  assert.ok(r3.pausada);
  const c2 = (await sql`SELECT status::text AS status, pause_reason FROM mk_campaigns WHERE id = ${id2}`).rows[0];
  assert.equal(c2.status, 'paused');
  assert.match(c2.pause_reason, /AccessDenied/);
  assert.equal(await escalar(sql, `SELECT count(*)::int FROM mk_sends WHERE campaign_id = $1 AND status = 'queued'`, [id2]), 2, 'nadie quedó marcado como enviado');
  await cerrar();
});

// ── Eventos de SES ───────────────────────────────────────────────────
function notif(tipo, messageId, extra = {}) {
  return { eventType: tipo, mail: { messageId, timestamp: '2026-11-16T12:00:00.000Z', destination: [extra.correo || 'x@x.cl'] }, ...extra.cuerpo };
}

async function campanaEnviada(sql, correos) {
  const ids = []; for (const e of correos) ids.push(await crearContacto(sql, e));
  const id = await crearCampana(sql, { listas: [await crearLista(sql, 'l' + uuid(), ids)] });
  await lanzarCampana(sql, id, { encolar: encoladorFalso() });
  await procesarLote(crearRepoSql(sql), { campaignId: id, enviar: enviadorFalso(), ...SIN_ESPERA });
  const mid = Object.fromEntries((await sql`SELECT email::text AS email, ses_message_id FROM mk_sends WHERE campaign_id = ${id}`).rows.map(f => [f.email, f.ses_message_id]));
  return { id, mid };
}
const aplicar = (sql, n) => aplicarEventoSes(sql, normalizarEventoSes(n));

test('eventos SES: entrega, aperturas y clics cuentan una vez aunque SNS reentregue', async () => {
  const { sql, cerrar } = await crearBase();
  const { id, mid } = await campanaEnviada(sql, ['a@x.cl', 'b@x.cl']);
  const entrega = notif('Delivery', mid['a@x.cl'], { cuerpo: { delivery: { timestamp: '2026-11-16T12:00:05.000Z', recipients: ['a@x.cl'] } } });
  assert.equal((await aplicar(sql, entrega)).aplicado, true);
  assert.equal((await aplicar(sql, entrega)).aplicado, false, 'misma entrega reentregada: no se guarda dos veces');
  await aplicar(sql, notif('Open', mid['a@x.cl'], { cuerpo: { open: { timestamp: '2026-11-16T13:00:00.000Z', userAgent: 'Mozilla' } } }));
  await aplicar(sql, notif('Open', mid['a@x.cl'], { cuerpo: { open: { timestamp: '2026-11-16T14:00:00.000Z', userAgent: 'Mozilla' } } }));
  await aplicar(sql, notif('Click', mid['a@x.cl'], { cuerpo: { click: { timestamp: '2026-11-16T14:05:00.000Z', link: 'https://indexstore.cl/oferta' } } }));
  await aplicar(sql, notif('Click', mid['a@x.cl'], { cuerpo: { click: { timestamp: '2026-11-16T14:06:00.000Z', link: 'https://indexstore.cl/otra' } } }));
  const c = (await sql`SELECT total_delivered, unique_opens, unique_clicks FROM mk_campaigns WHERE id = ${id}`).rows[0];
  assert.deepEqual({ ...c }, { total_delivered: 1, unique_opens: 1, unique_clicks: 1 });
  assert.equal(await escalar(sql, `SELECT count(*)::int FROM mk_events WHERE type = 'open'`), 2, 'los eventos crudos sí se guardan todos');
  const s = (await sql`SELECT status::text AS status FROM mk_sends WHERE ses_message_id = ${mid['a@x.cl']}`).rows[0];
  assert.equal(s.status, 'delivered');
  assert.equal(await escalar(sql, `SELECT last_click_at IS NOT NULL FROM mk_contacts WHERE email = 'a@x.cl'`), true);
  await cerrar();
});

test('eventos SES: rebote permanente y queja suprimen al instante; el rebote transitorio no', async () => {
  const { sql, cerrar } = await crearBase();
  const { id, mid } = await campanaEnviada(sql, ['dura@x.cl', 'blanda@x.cl', 'queja@x.cl']);
  await aplicar(sql, notif('Bounce', mid['blanda@x.cl'], { correo: 'blanda@x.cl', cuerpo: { bounce: { bounceType: 'Transient', bounceSubType: 'MailboxFull', timestamp: '2026-11-16T12:01:00.000Z', bouncedRecipients: [{ emailAddress: 'blanda@x.cl' }] } } }));
  assert.equal(await escalar(sql, `SELECT count(*)::int FROM mk_suppressions`), 0);

  const dura = notif('Bounce', mid['dura@x.cl'], { correo: 'dura@x.cl', cuerpo: { bounce: { bounceType: 'Permanent', bounceSubType: 'General', timestamp: '2026-11-16T12:02:00.000Z', bouncedRecipients: [{ emailAddress: 'DURA@x.cl' }] } } });
  await aplicar(sql, dura); await aplicar(sql, dura);
  await aplicar(sql, notif('Complaint', mid['queja@x.cl'], { correo: 'queja@x.cl', cuerpo: { complaint: { timestamp: '2026-11-16T12:03:00.000Z', complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'queja@x.cl' }] } } }));

  const sup = Object.fromEntries((await sql`SELECT email::text AS email, reason FROM mk_suppressions`).rows.map(f => [f.email, f.reason]));
  assert.deepEqual(sup, { 'dura@x.cl': 'hard_bounce', 'queja@x.cl': 'complaint' });
  const est = Object.fromEntries((await sql`SELECT email::text AS email, status::text AS status FROM mk_contacts`).rows.map(f => [f.email, f.status]));
  assert.deepEqual(est, { 'dura@x.cl': 'bounced', 'blanda@x.cl': 'subscribed', 'queja@x.cl': 'complained' });
  const c = (await sql`SELECT total_bounced, total_complaints FROM mk_campaigns WHERE id = ${id}`).rows[0];
  assert.deepEqual({ ...c }, { total_bounced: 1, total_complaints: 1 }, 'el rebote reentregado no suma dos veces');

  // La siguiente campaña ya no los incluye.
  const todos = (await sql`SELECT id FROM mk_contacts`).rows.map(r => r.id);
  const id2 = await crearCampana(sql, { listas: [await crearLista(sql, 'otra', todos)] });
  await lanzarCampana(sql, id2, { encolar: encoladorFalso() });
  assert.deepEqual((await sql`SELECT email::text AS email FROM mk_sends WHERE campaign_id = ${id2}`).rows.map(r => r.email), ['blanda@x.cl']);
  await cerrar();
});

test('eventos SES: pausa automática de la campaña si los rebotes superan el 5 % (con muestra suficiente)', async () => {
  const { sql, cerrar } = await crearBase();
  const { id, mid } = await campanaEnviada(sql, ['a@x.cl', 'b@x.cl']);
  const rebote = correo => notif('Bounce', mid[correo], { correo, cuerpo: { bounce: { bounceType: 'Permanent', timestamp: '2026-11-16T12:02:00.000Z', bouncedRecipients: [{ emailAddress: correo }] } } });
  // Con 2 envíos reales no hay muestra: una campaña chica no se pausa por un rebote.
  await sql`UPDATE mk_campaigns SET status = 'sending', finished_at = NULL WHERE id = ${id}`;
  assert.equal((await aplicar(sql, rebote('a@x.cl'))).pausada, false);
  // Con 1000 envíos y 60 rebotes (6 %) sí.
  await sql`UPDATE mk_campaigns SET total_sent = 1000, total_bounced = 59 WHERE id = ${id}`;
  assert.equal((await aplicar(sql, rebote('b@x.cl'))).pausada, true);
  const c = (await sql`SELECT status::text AS status, pause_reason FROM mk_campaigns WHERE id = ${id}`).rows[0];
  assert.equal(c.status, 'paused');
  assert.match(c.pause_reason, /Rebotes/);
  await cerrar();
});

test('eventos SES: un evento de un mensaje desconocido se guarda sin efectos', async () => {
  const { sql, cerrar } = await crearBase();
  const r = await aplicar(sql, notif('Delivery', 'mensaje-ajeno', { cuerpo: { delivery: { timestamp: '2026-11-16T12:00:00.000Z' } } }));
  assert.equal(r.envio_conocido, false);
  assert.equal(r.aplicado, true);
  await cerrar();
});

// ── Baja ─────────────────────────────────────────────────────────────
function respuestaFalsa() {
  const r = { cabeceras: {}, estado: null, cuerpo: null, setHeader(k, v) { this.cabeceras[k] = v; }, status(n) { this.estado = n; return this; }, send(b) { this.cuerpo = b; return this; }, json(b) { this.cuerpo = b; return this; } };
  return r;
}

test('baja: GET solo confirma (un escáner no da de baja); POST suprime; es idempotente y cuenta una vez', async () => {
  const { sql, cerrar } = await crearBase();
  const { id, mid } = await campanaEnviada(sql, ['a@x.cl', 'b@x.cl']);
  const contactoA = await escalar(sql, `SELECT id FROM mk_contacts WHERE email = 'a@x.cl'`);
  const token = crearTokenBaja(contactoA, id);
  const getSql = async () => sql;

  const g = respuestaFalsa();
  await manejarBaja({ method: 'GET', query: { token }, headers: {} }, g, { getSql });
  assert.equal(g.estado, 200);
  assert.match(g.cuerpo, /Sí, darme de baja/);
  assert.equal(await escalar(sql, `SELECT status::text FROM mk_contacts WHERE email = 'a@x.cl'`), 'subscribed', 'el GET no dio de baja');

  const p = respuestaFalsa();
  await manejarBaja({ method: 'POST', query: { token }, headers: { 'content-type': 'application/x-www-form-urlencoded' }, rawBody: 'List-Unsubscribe=One-Click' }, p, { getSql });
  assert.equal(p.estado, 200);
  assert.equal(p.cuerpo, 'OK', 'el one-click del cliente de correo recibe un 200 simple');
  const p2 = respuestaFalsa();
  await manejarBaja({ method: 'POST', query: { token }, headers: { accept: 'text/html' } }, p2, { getSql });
  assert.match(p2.cuerpo, /Listo, te diste de baja/);

  assert.equal(await escalar(sql, `SELECT status::text FROM mk_contacts WHERE email = 'a@x.cl'`), 'unsubscribed');
  assert.equal(await escalar(sql, `SELECT reason FROM mk_suppressions WHERE email = 'a@x.cl'`), 'unsubscribe');
  assert.equal(await escalar(sql, `SELECT total_unsubscribes FROM mk_campaigns WHERE id = $1`, [id]), 1, 'dos POST seguidos cuentan una sola baja');
  assert.equal(await escalar(sql, `SELECT status::text FROM mk_contacts WHERE email = 'b@x.cl'`), 'subscribed');

  const mala = respuestaFalsa();
  await manejarBaja({ method: 'POST', query: { token: token.slice(0, -3) + 'xxx' }, headers: {} }, mala, { getSql });
  assert.equal(mala.estado, 400);
  assert.equal(await escalar(sql, `SELECT count(*)::int FROM mk_suppressions`), 1);
  await cerrar();
});

test('baja: contacto inexistente no revela nada y no falla', async () => {
  const { sql, cerrar } = await crearBase();
  assert.deepEqual(await darDeBaja(sql, { contactId: uuid(), campaignId: null }), { ok: true, desconocido: true });
  await cerrar();
});

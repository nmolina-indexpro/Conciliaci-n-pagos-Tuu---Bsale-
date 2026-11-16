// Pruebas de la capa administrativa del módulo de Mailing (lo que usa la pantalla): panel, listas, plantillas, campañas, estimación, prueba, reporte, contactos y cron de programadas.
// Corren contra Postgres en memoria (PGlite). Ejecutar: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { crearBase, crearContacto, crearLista, crearCampana, uuid } from './_pg.js';
import { despachar } from '../../lib/mailing/admin.js';
import { lanzarCampana } from '../../lib/mailing/lanzar.js';
import { procesarLote, crearRepoSql } from '../../lib/mailing/worker.js';
import { normalizarEventoSes, aplicarEventoSes } from '../../lib/mailing/eventos-ses.js';
import { importarCsv } from '../../lib/mailing/importar.js';
import { manejarMailingPublico, manejarMailingAdmin } from '../../lib/mailing/manejar.js';

process.env.MK_UNSUB_SECRET = 'secreto-de-prueba-largo-1234567890';
process.env.MK_PUBLIC_BASE_URL = 'https://erp.indexstore.cl';
delete process.env.MK_FROM_DOMAINS;

const SIN_ESPERA = { esperar: async () => {} };
const escalar = async (sql, texto, params = []) => Object.values((await sql.query(texto, params)).rows[0])[0];
const encoladorFalso = () => { const lotes = []; const fn = async m => { lotes.push(...m); }; fn.lotes = lotes; return fn; };
const call = (sql, recurso, body, extra = {}) => despachar(recurso, { metodo: body === undefined ? 'GET' : 'POST', body, sql, ...extra });

async function plantillaBase(sql) {
  const r = await call(sql, 'mk-plantillas', { accion: 'guardar', name: 'Base', subject: 'Hola {{first_name|cliente}}', preheader: 'Mira esto', html: '<html><body><p>Hola {{first_name|cliente}}</p><a href="https://indexstore.cl/x">ver</a></body></html>' });
  assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
  return r.cuerpo.id;
}
const datosCampana = (template_id, lists, extra = {}) => ({ accion: 'guardar', name: 'Camp', template_id, subject: 'Oferta', from_name: 'IndexStore', from_email: 'ofertas@news.indexstore.cl', lists, exclude_lists: [], rate_per_sec: 1000, ...extra });

test('listas: crear, nombre repetido, renombrar y no eliminar si una campaña sin terminar la usa', async () => {
  const { sql, cerrar } = await crearBase();
  const a = await call(sql, 'mk-listas', { accion: 'crear', name: 'Clientes', description: 'todos' });
  assert.equal(a.status, 200);
  assert.equal((await call(sql, 'mk-listas', { accion: 'crear', name: 'Clientes' })).status, 409);
  assert.equal((await call(sql, 'mk-listas', { accion: 'crear', name: '  ' })).status, 400);
  assert.equal((await call(sql, 'mk-listas', { accion: 'renombrar', id: a.cuerpo.id, name: 'Clientes B2C' })).status, 200);

  const t = await plantillaBase(sql);
  const c = await call(sql, 'mk-campanas', datosCampana(t, [a.cuerpo.id]));
  assert.equal(c.status, 200);
  const bloqueada = await call(sql, 'mk-listas', { accion: 'eliminar', id: a.cuerpo.id });
  assert.equal(bloqueada.status, 409);
  await call(sql, 'mk-campanas', { accion: 'cancelar', id: c.cuerpo.id });
  assert.equal((await call(sql, 'mk-listas', { accion: 'eliminar', id: a.cuerpo.id })).status, 200);
  await cerrar();
});

test('plantillas: valida, detecta variables, vista previa con pie de baja y no se elimina si hay campañas', async () => {
  const { sql, cerrar } = await crearBase();
  assert.equal((await call(sql, 'mk-plantillas', { accion: 'guardar', name: '', subject: 'x', html: '<p>x</p>' })).status, 400);
  assert.equal((await call(sql, 'mk-plantillas', { accion: 'guardar', name: 'x', subject: 'x', html: ' ' })).status, 400);
  assert.equal((await call(sql, 'mk-plantillas', { accion: 'guardar', name: 'x', subject: 'x', html: 'a'.repeat(400_001) })).status, 400);
  const id = await plantillaBase(sql);
  assert.deepEqual((await sql.query('SELECT variables FROM mk_templates WHERE id = $1', [id])).rows[0].variables, ['first_name']);
  const leida = await despachar('mk-plantillas', { metodo: 'GET', query: { id }, sql });
  assert.equal(leida.cuerpo.plantilla.name, 'Base');
  const vista = await call(sql, 'mk-plantillas', { accion: 'vista', html: '<body><p>Hola {{first_name|cliente}} {{desconocida}}</p></body>', preheader: 'Pre', subject: 'Hola {{first_name}}' });
  assert.match(vista.cuerpo.html, /Hola Camila/);
  assert.match(vista.cuerpo.html, /date de baja aquí/);
  assert.ok(!/\{\{/.test(vista.cuerpo.html));
  assert.equal(vista.cuerpo.asunto, 'Hola Camila');

  const lista = await crearLista(sql, 'l', []);
  await call(sql, 'mk-campanas', datosCampana(id, [lista]));
  assert.equal((await call(sql, 'mk-plantillas', { accion: 'eliminar', id })).status, 409);
  await cerrar();
});

test('campañas: valida remitente, listas y plantilla; solo se edita en borrador o programada', async () => {
  const { sql, cerrar } = await crearBase();
  const t = await plantillaBase(sql);
  const lista = await crearLista(sql, 'l', []);
  const otra = await crearLista(sql, 'o', []);
  assert.equal((await call(sql, 'mk-campanas', datosCampana(t, [lista], { from_email: 'no-es-correo' }))).status, 400);
  assert.equal((await call(sql, 'mk-campanas', datosCampana(t, [lista], { reply_to: 'malo' }))).status, 400);
  assert.equal((await call(sql, 'mk-campanas', datosCampana(t, []))).status, 400);
  assert.equal((await call(sql, 'mk-campanas', datosCampana(t, [uuid()]))).status, 400, 'lista inexistente');
  assert.equal((await call(sql, 'mk-campanas', datosCampana(t, [lista], { exclude_lists: [lista] }))).status, 400, 'la misma lista en ambos lados');
  assert.equal((await call(sql, 'mk-campanas', datosCampana(uuid(), [lista]))).status, 400, 'plantilla inexistente');
  assert.equal((await call(sql, 'mk-campanas', datosCampana(t, [lista], { name: '' }))).status, 400);

  process.env.MK_FROM_DOMAINS = 'news.indexstore.cl, news.indexpro.cl';
  assert.equal((await call(sql, 'mk-campanas', datosCampana(t, [lista], { from_email: 'x@gmail.com' }))).status, 400, 'dominio no permitido');
  assert.equal((await call(sql, 'mk-campanas', datosCampana(t, [lista], { from_email: 'OFERTAS@News.IndexPro.cl' }))).status, 200);
  delete process.env.MK_FROM_DOMAINS;

  const ok = await call(sql, 'mk-campanas', datosCampana(t, [lista], { rate_per_sec: 9999 }));
  assert.equal(await escalar(sql, 'SELECT rate_per_sec FROM mk_campaigns WHERE id = $1', [ok.cuerpo.id]), 200, 'la velocidad se acota');
  const ed = await call(sql, 'mk-campanas', datosCampana(t, [lista, otra], { id: ok.cuerpo.id, name: 'Editada' }));
  assert.equal(ed.status, 200);
  assert.equal(await escalar(sql, 'SELECT name FROM mk_campaigns WHERE id = $1', [ok.cuerpo.id]), 'Editada');
  await sql.query(`UPDATE mk_campaigns SET status = 'sent' WHERE id = $1`, [ok.cuerpo.id]);
  assert.equal((await call(sql, 'mk-campanas', datosCampana(t, [lista], { id: ok.cuerpo.id }))).status, 409);
  await cerrar();
});

test('campañas: programar exige fecha futura, se puede quitar y no se programa lo ya enviado', async () => {
  const { sql, cerrar } = await crearBase();
  const t = await plantillaBase(sql); const lista = await crearLista(sql, 'l', []);
  const id = (await call(sql, 'mk-campanas', datosCampana(t, [lista]))).cuerpo.id;
  const ahora = Date.parse('2026-11-16T12:00:00Z');
  assert.equal((await call(sql, 'mk-campanas', { accion: 'programar', id, scheduled_at: 'basura' }, { ahora })).status, 400);
  assert.equal((await call(sql, 'mk-campanas', { accion: 'programar', id, scheduled_at: '2026-11-16T12:00:30Z' }, { ahora })).status, 400, 'menos de un minuto');
  assert.equal((await call(sql, 'mk-campanas', { accion: 'programar', id, scheduled_at: '2026-11-17T12:00:00Z' }, { ahora })).status, 200);
  assert.equal(await escalar(sql, 'SELECT status::text FROM mk_campaigns WHERE id = $1', [id]), 'scheduled');
  assert.equal((await call(sql, 'mk-campanas', { accion: 'desprogramar', id })).status, 200);
  assert.equal(await escalar(sql, 'SELECT status::text FROM mk_campaigns WHERE id = $1', [id]), 'draft');
  assert.equal((await call(sql, 'mk-campanas', { accion: 'desprogramar', id })).status, 409);
  const dup = await call(sql, 'mk-campanas', { accion: 'duplicar', id });
  assert.equal(await escalar(sql, 'SELECT name FROM mk_campaigns WHERE id = $1', [dup.cuerpo.id]), 'Camp (copia)');
  assert.equal((await call(sql, 'mk-campanas', { accion: 'eliminar', id })).status, 200);
  assert.equal((await call(sql, 'mk-campanas', { accion: 'cancelar', id: uuid() })).status, 404);
  assert.equal((await call(sql, 'mk-campanas', { accion: 'inventada', id: dup.cuerpo.id })).status, 400);
  await cerrar();
});

test('estimar: coincide exactamente con a quién se le arma el envío al lanzar', async () => {
  const { sql, cerrar } = await crearBase();
  const t = await plantillaBase(sql);
  const ok = [await crearContacto(sql, 'a@x.cl'), await crearContacto(sql, 'b@x.cl')];
  const baja = await crearContacto(sql, 'baja@x.cl', { estado: 'unsubscribed' });
  const sup = await crearContacto(sql, 'sup@x.cl'); await sql.query(`INSERT INTO mk_suppressions (email, reason) VALUES ('sup@x.cl', 'complaint')`);
  const excl = await crearContacto(sql, 'excl@x.cl');
  const dosListas = await crearLista(sql, 'l1', [ok[0], baja, sup, excl]); const l2 = await crearLista(sql, 'l2', [ok[0], ok[1]]); // ok[0] está en las dos: cuenta una vez
  const noMolestar = await crearLista(sql, 'nm', [excl]);
  const id = (await call(sql, 'mk-campanas', datosCampana(t, [dosListas, l2], { exclude_lists: [noMolestar] }))).cuerpo.id;
  const e = await call(sql, 'mk-campana-estimar', { id });
  assert.deepEqual(e.cuerpo, { ok: true, miembros: 4, enviables: 2, excluidos: 2 });
  const r = await lanzarCampana(sql, id, { encolar: encoladorFalso() });
  assert.equal(r.destinatarios, e.cuerpo.enviables);
  await cerrar();
});

test('prueba: envía a correos internos con [PRUEBA], enlace de baja inofensivo y topes', async () => {
  const { sql, cerrar } = await crearBase();
  const t = await plantillaBase(sql); const lista = await crearLista(sql, 'l', []);
  const id = (await call(sql, 'mk-campanas', datosCampana(t, [lista]))).cuerpo.id;
  const enviados = [];
  const enviar = async d => { if (d.para === 'falla@x.cl') throw new Error('SES 403'); enviados.push(d); return { messageId: 'm' }; };

  const r = await call(sql, 'mk-campana-probar', { id, para: 'yo@x.cl, YO@x.cl, falla@x.cl' }, { enviar });
  assert.equal(r.status, 200);
  assert.deepEqual(r.cuerpo.resultados.map(x => [x.para, x.enviado]), [['yo@x.cl', true], ['falla@x.cl', false]]);
  assert.equal(r.cuerpo.todos_enviados, false);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].asunto, '[PRUEBA] Oferta');
  assert.match(enviados[0].html, /Hola Camila/);
  assert.match(enviados[0].urlBaja, /^https:\/\/erp\.indexstore\.cl\/u\//);
  assert.ok(enviados[0].html.includes(enviados[0].urlBaja));

  assert.equal((await call(sql, 'mk-campana-probar', { id, para: '' }, { enviar })).status, 400);
  assert.equal((await call(sql, 'mk-campana-probar', { id, para: 'malo' }, { enviar })).status, 400);
  assert.equal((await call(sql, 'mk-campana-probar', { id, para: ['a@x.cl', 'b@x.cl', 'c@x.cl', 'd@x.cl', 'e@x.cl', 'f@x.cl'] }, { enviar })).status, 400);
  assert.equal(enviados.length, 1, 'ninguna de las rechazadas envió algo');

  // El enlace de baja de la prueba no afecta a nadie: no hay contacto con ese id.
  const dato = (await import('../../lib/mailing/token-baja.js')).verificarTokenBaja(enviados[0].urlBaja.split('/u/')[1]);
  assert.equal(await escalar(sql, 'SELECT count(*)::int FROM mk_contacts WHERE id = $1', [dato.contactId]), 0);
  await cerrar();
});

test('reporte: totales, tasas, enlaces más clicados, rebotes y estados', async () => {
  const { sql, cerrar } = await crearBase();
  const t = await plantillaBase(sql);
  const ids = []; for (const e of ['a@x.cl', 'b@x.cl', 'c@x.cl', 'd@x.cl']) ids.push(await crearContacto(sql, e));
  const id = (await call(sql, 'mk-campanas', datosCampana(t, [await crearLista(sql, 'l', ids)]))).cuerpo.id;
  await lanzarCampana(sql, id, { encolar: encoladorFalso() });
  await procesarLote(crearRepoSql(sql), { campaignId: id, enviar: async d => ({ messageId: 'mid-' + d.para }), ...SIN_ESPERA });
  const ev = (tipo, correo, cuerpo) => aplicarEventoSes(sql, normalizarEventoSes({ eventType: tipo, mail: { messageId: 'mid-' + correo, timestamp: '2026-11-16T12:00:00.000Z', destination: [correo] }, ...cuerpo }));
  for (const c of ['a@x.cl', 'b@x.cl', 'c@x.cl']) await ev('Delivery', c, { delivery: { timestamp: '2026-11-16T12:00:05.000Z' } });
  await ev('Open', 'a@x.cl', { open: { timestamp: '2026-11-16T13:10:00.000Z' } });
  await ev('Click', 'a@x.cl', { click: { timestamp: '2026-11-16T13:11:00.000Z', link: 'https://indexstore.cl/x' } });
  await ev('Click', 'b@x.cl', { click: { timestamp: '2026-11-16T13:12:00.000Z', link: 'https://indexstore.cl/x' } });
  await ev('Bounce', 'd@x.cl', { bounce: { bounceType: 'Permanent', timestamp: '2026-11-16T12:01:00.000Z', bouncedRecipients: [{ emailAddress: 'd@x.cl' }] } });

  const r = (await despachar('mk-campana-reporte', { query: { id }, sql })).cuerpo;
  assert.deepEqual(r.totales, { destinatarios: 4, enviados: 4, entregados: 3, rebotes: 1, quejas: 0, aperturas: 1, clics: 2, bajas: 0 });
  assert.equal(r.tasas.entrega, 75); assert.equal(r.tasas.rebote, 25); assert.equal(r.tasas.apertura, 33.3); assert.equal(r.tasas.clic, 66.7);
  assert.deepEqual(r.enlaces, [{ url: 'https://indexstore.cl/x', clics: 2, personas: 2 }]);
  assert.deepEqual(r.problemas.map(p => [p.email, p.tipo]), [['d@x.cl', 'bounce']]);
  assert.equal(r.estados.bounced, 1); assert.equal(r.estados.delivered, 3);
  assert.equal(r.curva.length, 1);
  assert.equal((await despachar('mk-campana-reporte', { query: { id: uuid() }, sql })).status, 404);
  assert.equal((await despachar('mk-campana-reporte', { query: { id: 'x' }, sql })).status, 404);
  await cerrar();
});

test('panel y búsqueda de contactos', async () => {
  const { sql, cerrar } = await crearBase();
  const a = await crearContacto(sql, 'ana@x.cl', { nombre: 'Ana' });
  await crearContacto(sql, 'baja@x.cl', { estado: 'unsubscribed' });
  await sql.query(`INSERT INTO mk_suppressions (email, reason, detail) VALUES ('baja@x.cl', 'unsubscribe', 'campaña'), ('fantasma@x.cl', 'hard_bounce', NULL)`);
  const lista = await crearLista(sql, 'Clientes', [a]);
  const p = (await despachar('mk-panel', { sql })).cuerpo;
  assert.deepEqual(p.contactos, { total: 2, subscribed: 1, unsubscribed: 1 });
  assert.equal(p.supresiones.total, 2);
  assert.equal(p.listas.find(l => l.id === lista).miembros, 1);
  assert.equal(p.listas.find(l => l.id === lista).suscritos, 1);
  assert.equal(typeof p.config.ses, 'boolean');
  assert.ok(!JSON.stringify(p.config).includes(process.env.MK_UNSUB_SECRET), 'el panel no filtra secretos');

  const b = (await despachar('mk-contactos', { query: { q: 'BAJA' }, sql })).cuerpo;
  assert.equal(b.contactos[0].email, 'baja@x.cl'); assert.equal(b.contactos[0].supresion, 'unsubscribe');
  const f = (await despachar('mk-contactos', { query: { q: 'fantasma' }, sql })).cuerpo;
  assert.equal(f.contactos.length, 0); assert.equal(f.solo_suprimidos[0].email, 'fantasma@x.cl');
  assert.deepEqual((await despachar('mk-contactos', { query: { q: 'ana' }, sql })).cuerpo.contactos[0].listas, ['Clientes']);
  assert.equal((await despachar('mk-contactos', { query: { q: 'a' }, sql })).status, 400);
  assert.equal((await despachar('mk-contactos', { query: { q: '%%%' }, sql })).cuerpo.contactos.length, 0, 'los comodines se escapan');
  await cerrar();
});

test('importar con lista: suma a la lista solo los contactos del archivo y es repetible', async () => {
  const { sql, cerrar } = await crearBase();
  const lista = await crearLista(sql, 'Zoho', []);
  const csv = 'Email,Nombre\na@x.cl,Ana\nb@x.cl,Beto\nmalo,Zz';
  const r1 = await importarCsv(sql, csv, { tipo: 'contactos', listaId: lista });
  assert.equal(r1.agregados_a_lista, 2);
  const r2 = await importarCsv(sql, csv, { tipo: 'contactos', listaId: lista });
  assert.equal(r2.agregados_a_lista, 0);
  assert.equal(await escalar(sql, 'SELECT count(*)::int FROM mk_list_members WHERE list_id = $1', [lista]), 2);
  assert.equal((await importarCsv(sql, csv, { tipo: 'contactos', listaId: uuid() })).ok, false);
  await cerrar();
});

// ── Puertas HTTP ─────────────────────────────────────────────────────
function respuesta() {
  const r = { estado: null, cuerpo: null, status(n) { this.estado = n; return this; }, json(b) { this.cuerpo = b; return this; }, setHeader() {}, send(b) { this.cuerpo = b; return this; } };
  return r;
}

test('HTTP: la pantalla es solo para administradores', async () => {
  const { sql, cerrar } = await crearBase();
  const getSql = async () => sql;
  for (const sesion of [null, { rol: 'usuario' }]) {
    const res = respuesta();
    await manejarMailingAdmin({ method: 'GET', query: { recurso: 'mk-panel' }, body: {} }, res, sesion, { getSql });
    assert.equal(res.estado, 403);
  }
  const res = respuesta();
  await manejarMailingAdmin({ method: 'GET', query: { recurso: 'mk-panel' }, body: {} }, res, { rol: 'admin' }, { getSql });
  assert.equal(res.estado, 200);
  const r405 = respuesta();
  await manejarMailingAdmin({ method: 'DELETE', query: { recurso: 'mk-listas' }, body: {} }, r405, { rol: 'admin' }, { getSql });
  assert.equal(r405.estado, 405);
  await cerrar();
});

test('cron de programadas: exige CRON_SECRET y solo lanza las que ya cumplieron su hora (usa la cola real de QStash simulada)', async () => {
  const { sql, cerrar } = await crearBase();
  const getSql = async () => sql;
  const t = await plantillaBase(sql);
  const c1 = await crearContacto(sql, 'a@x.cl'); const lista = await crearLista(sql, 'l', [c1]);
  const vencida = (await call(sql, 'mk-campanas', datosCampana(t, [lista], { name: 'vencida' }))).cuerpo.id;
  const futura = (await call(sql, 'mk-campanas', datosCampana(t, [lista], { name: 'futura' }))).cuerpo.id;
  const borrador = (await call(sql, 'mk-campanas', datosCampana(t, [lista], { name: 'borrador' }))).cuerpo.id;
  await sql.query(`UPDATE mk_campaigns SET status = 'scheduled', scheduled_at = now() - interval '5 minutes' WHERE id = $1`, [vencida]);
  await sql.query(`UPDATE mk_campaigns SET status = 'scheduled', scheduled_at = now() + interval '2 hours' WHERE id = $1`, [futura]);

  process.env.CRON_SECRET = 'cron-secreto'; process.env.QSTASH_TOKEN = 'qs-token';
  const fetchOriginal = globalThis.fetch; const llamadas = [];
  globalThis.fetch = async (url, init) => { llamadas.push({ url: String(url), cuerpo: JSON.parse(init.body) }); return new Response('[]', { status: 201 }); };
  try {
    const sin = respuesta();
    await manejarMailingPublico({ method: 'GET', query: { recurso: 'mk-programadas-cron' }, headers: {} }, sin, { getSql });
    assert.equal(sin.estado, 401);
    const mala = respuesta();
    await manejarMailingPublico({ method: 'GET', query: { recurso: 'mk-programadas-cron' }, headers: { authorization: 'Bearer otro' } }, mala, { getSql });
    assert.equal(mala.estado, 401);

    const res = respuesta();
    await manejarMailingPublico({ method: 'GET', query: { recurso: 'mk-programadas-cron' }, headers: { authorization: 'Bearer cron-secreto' } }, res, { getSql });
    assert.equal(res.estado, 200);
    assert.equal(res.cuerpo.revisadas, 1);
    assert.equal(res.cuerpo.lanzadas[0].id, vencida);
    assert.equal(llamadas.length, 1);
    assert.match(llamadas[0].url, /\/v2\/batch$/);
    assert.equal(llamadas[0].cuerpo[0].destination, 'https://erp.indexstore.cl/api/negocio?recurso=mk-worker-enviar-lote');
    const estado = id => escalar(sql, 'SELECT status::text FROM mk_campaigns WHERE id = $1', [id]);
    assert.equal(await estado(vencida), 'sending');
    assert.equal(await estado(futura), 'scheduled');
    assert.equal(await estado(borrador), 'draft');
  } finally { globalThis.fetch = fetchOriginal; delete process.env.CRON_SECRET; delete process.env.QSTASH_TOKEN; }
  await cerrar();
});

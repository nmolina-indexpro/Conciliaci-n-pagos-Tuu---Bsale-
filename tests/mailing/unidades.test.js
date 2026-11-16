// Pruebas de las piezas puras del módulo de Mailing: correos, CSV, plantillas, eventos de SES, audiencia y reglas del envío por SES.
// Ejecutar: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarEmail, emailValido, excluirSuprimidos } from '../../lib/mailing/email.js';
import { parsearCsv, leerFilasCsv } from '../../lib/mailing/csv.js';
import { prepararImportacion, categoriaSupresion } from '../../lib/mailing/importar.js';
import { personalizar, congelarHtml, htmlATexto } from '../../lib/mailing/plantilla.js';
import { normalizarEventoSes, motivoDePausa } from '../../lib/mailing/eventos-ses.js';
import { validarAudiencia, planDeLotes } from '../../lib/mailing/lanzar.js';
import { armarSolicitud, remitente, clasificarRespuesta } from '../../lib/mailing/ses.js';

test('correos: normaliza y valida', () => {
  assert.equal(normalizarEmail('  Juan <JUAN@Correo.CL> '), 'juan@correo.cl');
  assert.equal(normalizarEmail('"ana@x.cl";'), 'ana@x.cl');
  for (const bueno of ['a@b.cl', 'nombre.apellido+tag@empresa.com.cl']) assert.equal(emailValido(bueno), true, bueno);
  for (const malo of ['', 'sin-arroba', 'a@b', 'a@@b.cl', '.a@b.cl', 'a..b@c.cl', 'a b@c.cl', 'a@-b.cl', 'x'.repeat(70) + '@b.cl']) assert.equal(emailValido(malo), false, malo);
});

test('excluirSuprimidos separa sin importar mayúsculas', () => {
  const { enviables, excluidos } = excluirSuprimidos([{ email: 'A@x.cl' }, { email: 'b@x.cl' }], new Set(['a@x.cl']));
  assert.deepEqual(enviables.map(d => d.email), ['b@x.cl']);
  assert.deepEqual(excluidos.map(d => d.email), ['A@x.cl']);
});

test('CSV: comillas, saltos de línea dentro de campos, BOM, ; y tabulaciones', () => {
  assert.deepEqual(parsearCsv('﻿a,b\r\n"x, y","línea1\nlínea2"\r\n'), [['a', 'b'], ['x, y', 'línea1\nlínea2']]);
  assert.deepEqual(parsearCsv('a;b\n1;2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parsearCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parsearCsv('a,"di ""hola"""\n'), [['a', 'di "hola"']]);
  assert.deepEqual(parsearCsv(''), []);
});

test('CSV: reconoce columnas de Zoho en inglés y español y exige la del correo', () => {
  const r = leerFilasCsv('Contact Email,First Name,Last Name,Empresa,Ciudad\na@x.cl,Ana,Soto,ACME,Santiago');
  assert.equal(r.filas[0].email, 'a@x.cl');
  assert.equal(r.filas[0].company_name, 'ACME');
  assert.deepEqual(r.filas[0].extra, { Ciudad: 'Santiago' });
  assert.match(leerFilasCsv('Nombre,Teléfono\nAna,123').error, /columna del correo/);
  assert.match(leerFilasCsv('').error, /vacío/);
});

test('importación (pura): deduplica por correo normalizado, junta datos del duplicado y separa inválidos', () => {
  const p = prepararImportacion('Email,Nombre,Etiquetas\nAna@X.cl,,vip\nana@x.cl,Ana,"vip; vip, otra"\nroto,Luis,\n', { tipo: 'contactos' });
  assert.equal(p.contactos.length, 1);
  assert.equal(p.contactos[0].first_name, 'Ana', 'completa el dato vacío con el de la fila repetida');
  assert.deepEqual(p.contactos[0].tags, ['vip']);
  assert.equal(p.duplicados, 1);
  assert.equal(p.invalidos.length, 1);
  assert.equal(p.contactos[0].consent_source, 'zoho_import');
});

test('importación (pura): tope de filas por llamada', () => {
  const filas = ['Email', ...Array.from({ length: 20001 }, (_, i) => `u${i}@x.cl`)].join('\n');
  assert.match(prepararImportacion(filas).error, /Demasiadas filas/);
});

test('categorías de supresión de Zoho', () => {
  for (const [t, c] of [['Unsubscribed', 'unsubscribe'], ['Baja', 'unsubscribe'], ['Hard Bounce', 'hard_bounce'], ['rebotado', 'hard_bounce'], ['Spam complaint', 'complaint'], ['queja', 'complaint'], ['??', null], ['', null]]) {
    assert.equal(categoriaSupresion(t), c, t);
  }
});

test('plantilla: escapa HTML, valor por defecto y nunca deja {{...}} sin resolver', () => {
  const vars = { first_name: '<b>Ana & "Co"</b>', last_name: '', unsubscribe_url: 'https://erp/u/a.b?x=1&y=2' };
  assert.equal(personalizar('Hola {{first_name}}', vars), 'Hola &lt;b&gt;Ana &amp; &quot;Co&quot;&lt;/b&gt;');
  assert.equal(personalizar('Hola {{ last_name | cliente }}!', vars), 'Hola cliente!');
  assert.equal(personalizar('{{desconocida}}-{{company_name}}-', vars), '--');
  assert.equal(personalizar('<a href="{{unsubscribe_url}}">', vars), '<a href="https://erp/u/a.b?x=1&y=2">', 'las URL no se escapan');
  assert.equal(personalizar('Asunto {{first_name}}', { first_name: 'A & B' }, { html: false }), 'Asunto A & B', 'el asunto no es HTML');
});

test('plantilla: preheader oculto y pie de baja obligatorio (Ley 19.496) si falta el enlace', () => {
  const sin = congelarHtml({ html: '<html><body><p>Hola</p></body></html>', preheader: 'Oferta <hoy>', fromName: 'IndexStore', fromEmail: 'o@news.indexstore.cl' });
  assert.match(sin, /<body[^>]*><div style="display:none[^>]*>Oferta &lt;hoy&gt;<\/div>/);
  assert.match(sin, /correo publicitario enviado por IndexStore \(o@news\.indexstore\.cl\)/);
  assert.match(sin, /href="\{\{unsubscribe_url\}\}"/);
  assert.ok(sin.indexOf('date de baja') < sin.indexOf('</body>'));
  const con = congelarHtml({ html: '<p>Chao <a href="{{unsubscribe_url}}">baja</a></p>', fromName: 'X', fromEmail: 'x@y.cl' });
  assert.equal((con.match(/unsubscribe_url/g) || []).length, 1, 'no se duplica el enlace si la plantilla ya lo trae');
});

test('htmlATexto: versión de texto con los enlaces visibles', () => {
  assert.equal(htmlATexto('<style>p{}</style><p>Hola <b>Ana</b></p><p><a href="https://x.cl/o">Ver oferta</a></p>'), 'Hola Ana\nVer oferta (https://x.cl/o)');
});

test('eventos SES: normaliza cada tipo y genera clave estable para deduplicar', () => {
  const base = { mail: { messageId: 'm1', timestamp: '2026-11-16T12:00:00.000Z', destination: ['a@x.cl'] } };
  const e = normalizarEventoSes({ eventType: 'Bounce', ...base, bounce: { bounceType: 'Permanent', timestamp: '2026-11-16T12:01:00.000Z', bouncedRecipients: [{ emailAddress: 'A@x.cl' }] } });
  assert.equal(e.tipo, 'bounce'); assert.equal(e.bounceType, 'Permanent'); assert.deepEqual(e.destinatarios, ['a@x.cl']);
  assert.equal(normalizarEventoSes({ eventType: 'Click', ...base, click: { link: 'https://x.cl', timestamp: '2026-11-16T12:02:00.000Z' } }).url, 'https://x.cl');
  assert.equal(normalizarEventoSes({ notificationType: 'Complaint', ...base, complaint: { complainedRecipients: [{ emailAddress: 'a@x.cl' }] } }).tipo, 'complaint');
  assert.equal(normalizarEventoSes({ eventType: 'Rendering Failure', ...base, failure: { errorMessage: 'x' } }).tipo, 'rendering_failure');
  assert.equal(normalizarEventoSes({ eventType: 'DeliveryDelay', ...base }).tipo, 'delivery_delay');
  assert.equal(normalizarEventoSes({ eventType: 'Raro', ...base }), null);
  assert.equal(normalizarEventoSes({ eventType: 'Delivery' }), null, 'sin messageId no hay a qué asociarlo');
  const a = normalizarEventoSes({ eventType: 'Delivery', ...base, delivery: { timestamp: '2026-11-16T12:00:05.000Z' } });
  const b = normalizarEventoSes({ eventType: 'Delivery', ...base, delivery: { timestamp: '2026-11-16T12:00:05.000Z' } });
  assert.equal(a.clave, b.clave);
});

test('pausa automática: rebotes > 5 % o quejas > 0,1 %, solo con muestra suficiente', () => {
  assert.equal(motivoDePausa({ enviados: 100, rebotes: 50, quejas: 5 }), null, 'muestra chica');
  assert.equal(motivoDePausa({ enviados: 1000, rebotes: 50, quejas: 0 }), null, 'justo 5 % no pausa');
  assert.match(motivoDePausa({ enviados: 1000, rebotes: 51, quejas: 0 }), /Rebotes 5\.1 %/);
  assert.equal(motivoDePausa({ enviados: 1000, rebotes: 0, quejas: 1 }), null, 'justo 0,1 % no pausa');
  assert.match(motivoDePausa({ enviados: 1000, rebotes: 0, quejas: 2 }), /Quejas/);
});

test('audiencia y lotes', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(validarAudiencia({ lists: [id], exclude_lists: [] }), { listas: [id], excluidas: [] });
  assert.match(validarAudiencia({ lists: [] }).error, /sin listas|no tiene listas/);
  assert.match(validarAudiencia({ lists: [id], segments: ['x'] }).error, /segmentos/i);
  assert.match(validarAudiencia({ lists: ['no-uuid'] }).error, /inválidos/);
  assert.deepEqual(planDeLotes(0), []);
  assert.deepEqual(planDeLotes(10000, { ratePorSeg: 14 }).slice(-1)[0], { indice: 199, retrasoSeg: Math.floor((199 * 50) / 14) });
  assert.equal(planDeLotes(10000).length, 200);
  assert.equal(planDeLotes(51).length, 2);
});

test('SES: solicitud con encabezados de baja en un clic y remitente codificado', () => {
  const s = armarSolicitud({ para: 'a@x.cl', nombreRemitente: 'Index Store', correoRemitente: 'o@news.indexstore.cl', asunto: 'Hola', html: '<p>x</p>', texto: 'x', urlBaja: 'https://erp/u/t', configurationSet: 'mk-marketing', responderA: 'v@indexstore.cl' });
  assert.equal(s.FromEmailAddress, '"Index Store" <o@news.indexstore.cl>');
  assert.deepEqual(s.Content.Simple.Headers, [{ Name: 'List-Unsubscribe', Value: '<https://erp/u/t>' }, { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' }]);
  assert.equal(s.ConfigurationSetName, 'mk-marketing');
  assert.deepEqual(s.ReplyToAddresses, ['v@indexstore.cl']);
  assert.match(remitente('Cámaras Ñandú', 'o@x.cl'), /^=\?UTF-8\?B\?.+\?= <o@x\.cl>$/);
  assert.equal(remitente('', 'o@x.cl'), 'o@x.cl');
});

test('SES: clasificación de errores', () => {
  assert.equal(clasificarRespuesta(429, {}), 'throttle');
  assert.equal(clasificarRespuesta(400, { __type: 'com.amazon#TooManyRequestsException' }), 'throttle');
  assert.equal(clasificarRespuesta(403, {}), 'config');
  assert.equal(clasificarRespuesta(400, { __type: 'AccountSuspendedException' }), 'config');
  assert.equal(clasificarRespuesta(503, {}), 'temporal');
  assert.equal(clasificarRespuesta(400, { __type: 'MessageRejected' }), 'permanente');
});

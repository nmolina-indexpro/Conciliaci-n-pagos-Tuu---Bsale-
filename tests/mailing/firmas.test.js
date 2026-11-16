// Pruebas de las verificaciones de seguridad del módulo de Mailing: token de baja, firma SNS, firma QStash y firma SigV4.
// Ejecutar: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { crearTokenBaja, verificarTokenBaja, urlBaja } from '../../lib/mailing/token-baja.js';
import { verificarMensajeSns, urlCertificadoValida, cadenaAFirmar } from '../../lib/mailing/firma-sns.js';
import { verificarFirmaQstash } from '../../lib/mailing/firma-qstash.js';
import { firmarSigV4 } from '../../lib/mailing/sigv4.js';

const SECRETO = 'secreto-de-prueba-largo-1234567890';

test('token de baja: ida y vuelta con y sin campaña', () => {
  const c = randomUUID(); const k = randomUUID();
  assert.deepEqual(verificarTokenBaja(crearTokenBaja(c, k, SECRETO), SECRETO), { contactId: c, campaignId: k });
  assert.deepEqual(verificarTokenBaja(crearTokenBaja(c, null, SECRETO), SECRETO), { contactId: c, campaignId: null });
});

test('token de baja: rechaza token alterado, otro secreto, basura y secreto ausente', () => {
  const c = randomUUID(); const k = randomUUID();
  const t = crearTokenBaja(c, k, SECRETO);
  const [carga, firma] = t.split('.');
  const otroContacto = Buffer.from(`${randomUUID()}.${k}`).toString('base64url');
  assert.equal(verificarTokenBaja(`${otroContacto}.${firma}`, SECRETO), null, 'carga cambiada con la firma original');
  assert.equal(verificarTokenBaja(`${carga}.${firma.slice(0, -2)}AA`, SECRETO), null, 'firma alterada');
  assert.equal(verificarTokenBaja(t, 'otro-secreto'), null);
  assert.equal(verificarTokenBaja('basura', SECRETO), null);
  assert.equal(verificarTokenBaja('a.b.c', SECRETO), null);
  assert.equal(verificarTokenBaja('x'.repeat(500), SECRETO), null);
  assert.equal(verificarTokenBaja(t, ''), null, 'sin secreto no se acepta nada');
  assert.throws(() => crearTokenBaja('no-es-uuid', null, SECRETO));
  assert.throws(() => crearTokenBaja(c, null, ''));
});

test('urlBaja arma /u/:token sobre la base pública', () => {
  assert.equal(urlBaja('abc', 'https://erp.indexstore.cl/'), 'https://erp.indexstore.cl/u/abc');
});

// ── SNS ──────────────────────────────────────────────────────────────
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pemPublica = publicKey.export({ type: 'spki', format: 'pem' });
const URL_CERT = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc123.pem';

function mensajeSns(extra = {}, version = '1') {
  const m = { Type: 'Notification', MessageId: randomUUID(), TopicArn: 'arn:aws:sns:us-east-1:111122223333:mk-eventos', Message: '{"eventType":"Delivery"}', Timestamp: '2026-11-16T12:00:00.000Z', SignatureVersion: version, SigningCertURL: URL_CERT, ...extra };
  const f = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
  f.update(cadenaAFirmar(m), 'utf8');
  m.Signature = f.sign(privateKey, 'base64');
  return m;
}
const certFalso = async () => pemPublica;

test('SNS: acepta firma válida v1 y v2', async () => {
  assert.equal(await verificarMensajeSns(mensajeSns({}, '1'), { obtenerCertificado: certFalso, topicEsperado: '' }), true);
  assert.equal(await verificarMensajeSns(mensajeSns({}, '2'), { obtenerCertificado: certFalso, topicEsperado: '' }), true);
});

test('SNS: rechaza mensaje alterado, sin firma, versión desconocida y tópico ajeno', async () => {
  const m = mensajeSns();
  assert.equal(await verificarMensajeSns({ ...m, Message: '{"eventType":"Bounce"}' }, { obtenerCertificado: certFalso, topicEsperado: '' }), false);
  const { Signature, ...sinFirma } = m;
  assert.equal(await verificarMensajeSns(sinFirma, { obtenerCertificado: certFalso, topicEsperado: '' }), false);
  assert.equal(await verificarMensajeSns({ ...m, SignatureVersion: '3' }, { obtenerCertificado: certFalso, topicEsperado: '' }), false);
  assert.equal(await verificarMensajeSns(m, { obtenerCertificado: certFalso, topicEsperado: 'arn:aws:sns:us-east-1:999:otro' }), false);
  assert.equal(await verificarMensajeSns(m, { obtenerCertificado: certFalso, topicEsperado: m.TopicArn }), true);
  assert.equal(await verificarMensajeSns(null, { obtenerCertificado: certFalso }), false);
});

test('SNS: firma hecha con OTRA clave no pasa', async () => {
  const otra = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const m = mensajeSns();
  const f = createSign('RSA-SHA1'); f.update(cadenaAFirmar(m), 'utf8');
  const ajena = { ...m, Signature: f.sign(otra.privateKey, 'base64') };
  assert.equal(await verificarMensajeSns(ajena, { obtenerCertificado: certFalso, topicEsperado: '' }), false);
});

test('SNS: SigningCertURL solo de amazonaws.com por https (no se descarga nada de un host ajeno)', async () => {
  assert.equal(urlCertificadoValida(URL_CERT), true);
  for (const mala of ['http://sns.us-east-1.amazonaws.com/x.pem', 'https://evil.com/x.pem', 'https://sns.us-east-1.amazonaws.com.evil.com/x.pem',
    'https://evil.com/sns.us-east-1.amazonaws.com/x.pem', 'https://user@sns.us-east-1.amazonaws.com/x.pem', 'https://sns.us-east-1.amazonaws.com/x.txt', 'no es url']) {
    assert.equal(urlCertificadoValida(mala), false, mala);
  }
  let descargo = false;
  const m = mensajeSns({ SigningCertURL: 'https://evil.com/cert.pem' });
  assert.equal(await verificarMensajeSns(m, { obtenerCertificado: async () => { descargo = true; return pemPublica; }, topicEsperado: '' }), false);
  assert.equal(descargo, false);
});

// ── QStash ───────────────────────────────────────────────────────────
const URL_WORKER = 'https://erp.indexstore.cl/api/negocio?recurso=mk-worker-enviar-lote';
const CLAVE_ACTUAL = 'clave-actual'; const CLAVE_SIGUIENTE = 'clave-siguiente';
function jwtQstash({ cuerpo, url = URL_WORKER, clave = CLAVE_ACTUAL, exp = Math.floor(Date.now() / 1000) + 300, nbf = Math.floor(Date.now() / 1000) - 10, iss = 'Upstash' }) {
  const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cab = b({ alg: 'HS256', typ: 'JWT' });
  const carga = b({ iss, sub: url, exp, nbf, iat: nbf, jti: randomUUID(), body: createHash('sha256').update(cuerpo).digest('base64url') });
  return `${cab}.${carga}.${createHmac('sha256', clave).update(`${cab}.${carga}`).digest('base64url')}`;
}
const CLAVES = [CLAVE_ACTUAL, CLAVE_SIGUIENTE];
const CUERPO = JSON.stringify({ campaign_id: randomUUID(), lote: 0 });

test('QStash: acepta firma válida con la clave actual o la siguiente', () => {
  assert.equal(verificarFirmaQstash({ firma: jwtQstash({ cuerpo: CUERPO }), cuerpo: CUERPO, url: URL_WORKER, claves: CLAVES }), true);
  assert.equal(verificarFirmaQstash({ firma: jwtQstash({ cuerpo: CUERPO, clave: CLAVE_SIGUIENTE }), cuerpo: CUERPO, url: URL_WORKER, claves: CLAVES }), true);
});

test('QStash: rechaza cuerpo distinto, otra URL, vencida, no vigente, otra clave, sin firma y emisor falso', () => {
  const f = jwtQstash({ cuerpo: CUERPO });
  const base = { cuerpo: CUERPO, url: URL_WORKER, claves: CLAVES };
  assert.equal(verificarFirmaQstash({ ...base, firma: f, cuerpo: CUERPO + ' ' }), false, 'cuerpo alterado');
  assert.equal(verificarFirmaQstash({ ...base, firma: f, url: 'https://erp.indexstore.cl/api/negocio?recurso=mk-baja' }), false, 'firma para otro destino');
  assert.equal(verificarFirmaQstash({ ...base, firma: jwtQstash({ cuerpo: CUERPO, exp: Math.floor(Date.now() / 1000) - 5 }) }), false, 'vencida');
  assert.equal(verificarFirmaQstash({ ...base, firma: jwtQstash({ cuerpo: CUERPO, nbf: Math.floor(Date.now() / 1000) + 3600 }) }), false, 'aún no vigente');
  assert.equal(verificarFirmaQstash({ ...base, firma: jwtQstash({ cuerpo: CUERPO, clave: 'ajena' }) }), false, 'otra clave');
  assert.equal(verificarFirmaQstash({ ...base, firma: jwtQstash({ cuerpo: CUERPO, iss: 'Otro' }) }), false, 'emisor');
  assert.equal(verificarFirmaQstash({ ...base, firma: undefined }), false);
  assert.equal(verificarFirmaQstash({ ...base, firma: 'a.b' }), false);
  assert.equal(verificarFirmaQstash({ ...base, firma: f, claves: [] }), false, 'sin claves configuradas no se acepta nada');
});

// ── SigV4 ────────────────────────────────────────────────────────────
test('SigV4: coincide con el vector «get-vanilla» de la batería oficial de AWS', () => {
  const h = firmarSigV4({
    method: 'GET', url: 'https://example.amazonaws.com/', region: 'us-east-1', service: 'service',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', fecha: new Date('2015-08-30T12:36:00Z'),
  });
  assert.equal(h['x-amz-date'], '20150830T123600Z');
  assert.equal(h.Authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
});

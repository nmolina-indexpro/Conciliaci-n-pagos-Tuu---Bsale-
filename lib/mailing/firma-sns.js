// /lib/mailing/firma-sns.js
// Verificación de mensajes de Amazon SNS (webhook de eventos de SES). Un mensaje sin firma válida NO se procesa.
// Referencia: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html

import { createVerify } from 'node:crypto';

const HOST_CERT = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

// El certificado solo se descarga de un host de SNS por HTTPS: si no, cualquiera podría apuntar SigningCertURL a su propio servidor.
export function urlCertificadoValida(valor) {
  let u;
  try { u = new URL(String(valor)); } catch { return false; }
  return u.protocol === 'https:' && HOST_CERT.test(u.hostname) && !u.username && !u.password && (!u.port || u.port === '443') && u.pathname.endsWith('.pem');
}

const CAMPOS = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

export function cadenaAFirmar(msg) {
  const campos = CAMPOS[msg.Type];
  if (!campos) return null;
  let s = '';
  for (const c of campos) {
    if (c === 'Subject' && msg.Subject === undefined) continue; // Subject es opcional
    if (msg[c] === undefined) return null;
    s += `${c}\n${msg[c]}\n`;
  }
  return s;
}

const cacheCert = new Map(); // url -> { pem, vence }

async function descargarCertificado(url) {
  const c = cacheCert.get(url);
  if (c && c.vence > Date.now()) return c.pem;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`certificado SNS: HTTP ${r.status}`);
    const pem = await r.text();
    if (cacheCert.size > 10) cacheCert.clear();
    cacheCert.set(url, { pem, vence: Date.now() + 6 * 3600 * 1000 });
    return pem;
  } finally { clearTimeout(t); }
}

// Devuelve true solo si la firma calza. `obtenerCertificado(url)` se puede inyectar (pruebas); por defecto descarga de AWS.
export async function verificarMensajeSns(msg, { obtenerCertificado = descargarCertificado, topicEsperado = process.env.MK_SNS_TOPIC_ARN } = {}) {
  try {
    if (!msg || typeof msg !== 'object') return false;
    if (!msg.Signature || !urlCertificadoValida(msg.SigningCertURL)) return false;
    const algoritmo = msg.SignatureVersion === '1' ? 'RSA-SHA1' : msg.SignatureVersion === '2' ? 'RSA-SHA256' : null;
    if (!algoritmo) return false;
    if (topicEsperado && msg.TopicArn !== topicEsperado) return false;
    const texto = cadenaAFirmar(msg);
    if (texto === null) return false;
    const pem = await obtenerCertificado(msg.SigningCertURL);
    const v = createVerify(algoritmo);
    v.update(texto, 'utf8');
    return v.verify(pem, msg.Signature, 'base64');
  } catch {
    return false;
  }
}

// La confirmación de suscripción solo se abre hacia un host de SNS.
export function urlSuscripcionValida(valor) {
  let u;
  try { u = new URL(String(valor)); } catch { return false; }
  return u.protocol === 'https:' && HOST_CERT.test(u.hostname);
}

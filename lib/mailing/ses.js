// /lib/mailing/ses.js
// Envío por Amazon SES API v2 (SendEmail) firmado con SigV4, sin SDK. Incluye los encabezados de baja en un clic (RFC 8058).

import { firmarSigV4 } from './sigv4.js';

export class ErrorSes extends Error {
  // tipo: 'throttle' (reintentar más tarde) | 'temporal' (5xx / red) | 'permanente' (este correo no sale) | 'config' (credenciales/cuenta: detener todo)
  constructor(mensaje, tipo, estado) { super(mensaje); this.tipo = tipo; this.estado = estado; }
}

// "Nombre" <correo>; un nombre con tildes u otros no-ASCII va codificado (RFC 2047) para no depender del cliente de correo.
export function remitente(nombre, correo) {
  const n = String(nombre || '').replace(/[\r\n]/g, ' ').trim();
  if (!n) return correo;
  if (/^[\x20-\x7e]*$/.test(n)) return `"${n.replace(/(["\\])/g, '\\$1')}" <${correo}>`;
  return `=?UTF-8?B?${Buffer.from(n, 'utf8').toString('base64')}?= <${correo}>`;
}

export function clasificarRespuesta(estado, cuerpo) {
  const tipo = String(cuerpo?.__type || cuerpo?.Type || cuerpo?.code || '').split('#').pop();
  if (estado === 429 || /Throttl|TooManyRequests|LimitExceeded|SendingQuota/i.test(tipo)) return 'throttle';
  if (estado === 401 || estado === 403 || /AccessDenied|InvalidSignature|UnrecognizedClient|ExpiredToken|AccountSuspended|SendingPaused|MailFromDomainNotVerified|ConfigurationSetDoesNotExist|NotFound/i.test(tipo)) return 'config';
  if (estado >= 500) return 'temporal';
  return 'permanente'; // MessageRejected, BadRequestException (correo inválido, etc.)
}

export function armarSolicitud({ para, nombreRemitente, correoRemitente, responderA, asunto, html, texto, urlBaja, configurationSet }) {
  return {
    FromEmailAddress: remitente(nombreRemitente, correoRemitente),
    Destination: { ToAddresses: [para] },
    ...(responderA ? { ReplyToAddresses: [responderA] } : {}),
    Content: {
      Simple: {
        Subject: { Data: asunto, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' }, ...(texto ? { Text: { Data: texto, Charset: 'UTF-8' } } : {}) },
        Headers: [
          { Name: 'List-Unsubscribe', Value: `<${urlBaja}>` },
          { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
        ],
      },
    },
    ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
  };
}

export async function enviarCorreoSes(datos, { env = process.env, fetchFn = fetch, ahora = new Date() } = {}) {
  const region = env.AWS_REGION || 'us-east-1';
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) throw new ErrorSes('Faltan AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY', 'config');
  const cuerpo = JSON.stringify(armarSolicitud({ ...datos, configurationSet: datos.configurationSet ?? env.SES_CONFIGURATION_SET }));
  const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
  const headers = firmarSigV4({
    method: 'POST', url, headers: { 'content-type': 'application/json' }, body: cuerpo, region, service: 'ses',
    accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN, fecha: ahora,
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  let r;
  try {
    r = await fetchFn(url, { method: 'POST', headers, body: cuerpo, signal: ctrl.signal });
  } catch (e) {
    throw new ErrorSes(`SES no respondió: ${e.name === 'AbortError' ? 'tiempo agotado' : e.message}`, 'temporal');
  } finally { clearTimeout(t); }
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* respuesta no JSON */ }
  if (!r.ok) throw new ErrorSes(`SES ${r.status}: ${(json?.message || json?.Message || texto || '').slice(0, 200)}`, clasificarRespuesta(r.status, json), r.status);
  if (!json?.MessageId) throw new ErrorSes('SES respondió sin MessageId', 'temporal', r.status);
  return { messageId: json.MessageId };
}

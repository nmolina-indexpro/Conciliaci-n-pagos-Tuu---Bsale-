// /lib/mailing/sigv4.js
// Firma AWS Signature Version 4 con node:crypto (sin SDK de AWS: el ERP no usa dependencias para esto). Se usa para llamar a SES v2.

import { createHash, createHmac } from 'node:crypto';

const sha256Hex = d => createHash('sha256').update(d).digest('hex');
const hmac = (clave, d) => createHmac('sha256', clave).update(d).digest();

// Codificación de URI de AWS: todo salvo A-Za-z0-9-_.~ (la ruta se codifica por segmentos, así las barras se conservan).
const codificar = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function fechaAmz(d = new Date()) {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20150830T123600Z
}

// Devuelve los encabezados a enviar (incluye host-less: fetch pone Host solo), x-amz-date, x-amz-security-token (si hay) y Authorization.
export function firmarSigV4({ method, url, headers = {}, body = '', region, service, accessKeyId, secretAccessKey, sessionToken, fecha = new Date() }) {
  const u = new URL(url);
  const amzDate = fechaAmz(fecha);
  const dia = amzDate.slice(0, 8);

  const todos = { ...headers, host: u.host, 'x-amz-date': amzDate };
  if (sessionToken) todos['x-amz-security-token'] = sessionToken;
  const normalizados = Object.entries(todos).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const encabezadosCanon = normalizados.map(([k, v]) => `${k}:${v}\n`).join('');
  const firmados = normalizados.map(([k]) => k).join(';');

  const consulta = [...u.searchParams.entries()].map(([k, v]) => [codificar(k), codificar(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const rutaCanon = u.pathname.split('/').map(p => codificar(decodeURIComponent(p))).join('/') || '/';
  const canonica = [method.toUpperCase(), rutaCanon, consulta, encabezadosCanon, firmados, sha256Hex(body)].join('\n');

  const ambito = `${dia}/${region}/${service}/aws4_request`;
  const aFirmar = ['AWS4-HMAC-SHA256', amzDate, ambito, sha256Hex(canonica)].join('\n');
  const kFecha = hmac('AWS4' + secretAccessKey, dia);
  const kRegion = hmac(kFecha, region);
  const kServicio = hmac(kRegion, service);
  const kFirma = hmac(kServicio, 'aws4_request');
  const firma = createHmac('sha256', kFirma).update(aFirmar).digest('hex');

  const salida = { ...headers, 'x-amz-date': amzDate, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${ambito}, SignedHeaders=${firmados}, Signature=${firma}` };
  if (sessionToken) salida['x-amz-security-token'] = sessionToken;
  return salida;
}

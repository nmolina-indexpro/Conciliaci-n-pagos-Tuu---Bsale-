// /lib/mailing/token-baja.js
// Token de baja firmado con HMAC-SHA256 (contact_id + campaign_id), sin tabla de tokens. Secreto: MK_UNSUB_SECRET.
// Formato: base64url("<contact_id>.<campaign_id|->") + "." + base64url(hmac). No caduca: la baja debe funcionar siempre.

import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const b64u = buf => Buffer.from(buf).toString('base64url');

function firmar(carga, secreto) {
  return createHmac('sha256', secreto).update(carga).digest();
}

export function crearTokenBaja(contactId, campaignId, secreto = process.env.MK_UNSUB_SECRET) {
  if (!secreto) throw new Error('MK_UNSUB_SECRET no está configurada');
  if (!UUID.test(String(contactId))) throw new Error('contact_id inválido');
  const camp = campaignId ? String(campaignId) : '-';
  if (camp !== '-' && !UUID.test(camp)) throw new Error('campaign_id inválido');
  const carga = b64u(`${contactId}.${camp}`);
  return `${carga}.${b64u(firmar(carga, secreto))}`;
}

// Devuelve { contactId, campaignId|null } o null si el token no es válido (formato, firma o secreto ausente).
export function verificarTokenBaja(token, secreto = process.env.MK_UNSUB_SECRET) {
  if (!secreto || typeof token !== 'string' || token.length > 300) return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const [carga, firma] = partes;
  let recibida;
  try { recibida = Buffer.from(firma, 'base64url'); } catch { return null; }
  const esperada = firmar(carga, secreto);
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;
  let texto;
  try { texto = Buffer.from(carga, 'base64url').toString('utf8'); } catch { return null; }
  const [contactId, camp] = texto.split('.');
  if (!UUID.test(contactId || '')) return null;
  if (camp !== '-' && !UUID.test(camp || '')) return null;
  return { contactId, campaignId: camp === '-' ? null : camp };
}

export function urlBaja(token, base = process.env.MK_PUBLIC_BASE_URL || 'https://erp.indexstore.cl') {
  return `${String(base).replace(/\/+$/, '')}/u/${token}`;
}

// /lib/whatsapp-referencia.js
// Número de referencia de las conversaciones que llegan desde Meta (anuncios de "Click to WhatsApp", publicaciones o reels de Instagram/Facebook).
// Los mensajes del botón del sitio llevan un código visible "(ref ABC123)" que agrega el propio sitio. Desde un anuncio de Meta el mensaje lo arma
// WhatsApp, así que no se puede agregar un texto por cliente; en su lugar el ERP le asigna a cada conversación un código corto "M-XXXXXX" derivado
// del identificador de clic que Meta entrega con el primer mensaje (ctwa_clid) o, si no viene, del id del mensaje. Se muestra en la ficha y se puede buscar.
import { createHash } from 'node:crypto';

export function codigoReferenciaMeta(base) {
  const b = String(base || '').trim();
  if (!b) return null;
  return 'M-' + createHash('sha1').update(b).digest('hex').slice(0, 6).toUpperCase();
}

// Datos del primer mensaje con "referral" de Meta -> lo que se guarda aparte del origen (fuente_*): el clic y el código.
export function referenciaDesdeMensaje(m) {
  const r = m && m.referral;
  if (!r) return null;
  const clid = r.ctwa_clid ? String(r.ctwa_clid) : null;
  const ref = codigoReferenciaMeta(clid || m.id);
  return ref ? { clid, ref } : null;
}

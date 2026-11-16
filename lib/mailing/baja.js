// /lib/mailing/baja.js
// Baja de suscripción: GET /u/:token (página con confirmación; un escáner de correo que abre el enlace NO da de baja) y
// POST /u/:token (baja inmediata: one-click de Gmail/Apple Mail con «List-Unsubscribe=One-Click», o el botón de la página).

import { verificarTokenBaja } from './token-baja.js';
import { escaparHtml } from './plantilla.js';

export async function darDeBaja(sql, { contactId, campaignId }) {
  const { rows: [c] } = await sql`SELECT email::text AS email FROM mk_contacts WHERE id = ${contactId}`;
  if (!c) return { ok: true, desconocido: true }; // contacto borrado: no se revela nada, la persona ve el mismo «listo»
  const ins = await sql`
    INSERT INTO mk_suppressions (email, reason, detail) VALUES (${c.email}, 'unsubscribe', ${campaignId ? 'campaña ' + campaignId : 'enlace de baja'})
    ON CONFLICT (email) DO NOTHING RETURNING email`;
  await sql`UPDATE mk_contacts SET status = 'unsubscribed', unsubscribed_at = COALESCE(unsubscribed_at, now()), updated_at = now() WHERE id = ${contactId} AND status IN ('subscribed', 'pending')`;
  if (ins.rows.length && campaignId) await sql`UPDATE mk_campaigns SET total_unsubscribes = COALESCE(total_unsubscribes, 0) + 1 WHERE id = ${campaignId}`;
  return { ok: true, nueva: ins.rows.length > 0 };
}

const ESTILO = 'body{margin:0;background:#f3f4f6;font:16px/1.5 Arial,Helvetica,sans-serif;color:#111827}main{max-width:440px;margin:12vh auto;background:#fff;border-radius:12px;padding:32px 24px;box-shadow:0 1px 4px rgba(0,0,0,.08);text-align:center}h1{font-size:20px;margin:0 0 12px}p{margin:0 0 20px;color:#4b5563}button{background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:12px 24px;font-size:16px;cursor:pointer}';
const pagina = (titulo, cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escaparHtml(titulo)}</title><style>${ESTILO}</style></head><body><main>${cuerpo}</main></body></html>`;

export const paginaConfirmar = token => pagina('Darse de baja', `<h1>¿Quieres dejar de recibir nuestros correos?</h1><p>Confirma y no te volveremos a escribir.</p><form method="post" action="/u/${escaparHtml(token)}"><button type="submit">Sí, darme de baja</button></form>`);
export const paginaListo = () => pagina('Baja confirmada', '<h1>Listo, te diste de baja</h1><p>No recibirás más correos de nuestras campañas. Puede tardar unos minutos en reflejarse.</p>');
export const paginaInvalida = () => pagina('Enlace no válido', '<h1>Este enlace no es válido</h1><p>Si quieres darte de baja, usa el enlace de un correo reciente nuestro o escríbenos respondiendo ese correo.</p>');

function responder(res, estado, html) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(estado).send(html);
}

export async function manejarBaja(req, res, { getSql }) {
  const token = String(req.query.token || '');
  const datos = verificarTokenBaja(token);
  if (req.method === 'GET') return datos ? responder(res, 200, paginaConfirmar(token)) : responder(res, 400, paginaInvalida());
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!datos) return responder(res, 400, paginaInvalida());
  try {
    const sql = await getSql();
    await darDeBaja(sql, datos);
  } catch (e) {
    console.error('[mk-baja] error', e.message);
    return res.status(500).send('Error'); // el cliente de correo puede reintentar el one-click
  }
  // Un navegador (botón de la página) ve la confirmación; el one-click del cliente de correo solo necesita un 200.
  if (String(req.headers.accept || '').includes('text/html')) return responder(res, 200, paginaListo());
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send('OK');
}

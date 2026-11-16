// /lib/mailing/lanzar.js
// Lanzamiento de una campaña: congela el HTML, arma mk_sends (excluyendo supresiones) y encola los lotes en QStash.
// Es seguro reintentarlo: la campaña se «reclama» con un UPDATE atómico, mk_sends tiene unique(campaign_id, contact_id) y cada lote lleva id de deduplicación.

import { congelarHtml } from './plantilla.js';
import { encolarLotes } from './firma-qstash.js';

export const TAMANO_LOTE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function urlWorker(base = process.env.MK_PUBLIC_BASE_URL || 'https://erp.indexstore.cl') {
  return `${String(base).replace(/\/+$/, '')}/api/negocio?recurso=mk-worker-enviar-lote`;
}

// Valida la audiencia guardada en la campaña ({"lists":[uuid], "exclude_lists":[uuid], "segments":[]}). Los segmentos dinámicos son de la fase 4.
export function validarAudiencia(a) {
  const listas = Array.isArray(a?.lists) ? a.lists : [];
  const excluidas = Array.isArray(a?.exclude_lists) ? a.exclude_lists : [];
  if (Array.isArray(a?.segments) && a.segments.length) return { error: 'Los segmentos dinámicos aún no están disponibles: arma la audiencia con listas.' };
  if (!listas.length) return { error: 'La campaña no tiene listas de destinatarios' };
  if ([...listas, ...excluidas].some(id => !UUID.test(String(id)))) return { error: 'La audiencia contiene identificadores de lista inválidos' };
  return { listas, excluidas };
}

// Retrasos escalonados para no pasar el límite de envío de SES aunque varios lotes corran en paralelo.
export function planDeLotes(pendientes, { ratePorSeg = 14, tamano = TAMANO_LOTE } = {}) {
  const n = Math.ceil(pendientes / tamano);
  return Array.from({ length: n }, (_, i) => ({ indice: i, retrasoSeg: Math.floor((i * tamano) / Math.max(1, ratePorSeg)) }));
}

// Cuántos recibirían la campaña si se lanzara ahora (misma regla que el INSERT de lanzarCampana): miembros de las listas, sin las listas excluidas,
// y de ellos solo los suscritos que no están en la supresión global.
export async function estimarAudiencia(sql, audience) {
  const aud = validarAudiencia(audience);
  if (aud.error) return { error: aud.error };
  const { rows: [r] } = await sql`
    WITH m AS (
      SELECT DISTINCT c.id, c.status, c.email FROM mk_contacts c JOIN mk_list_members x ON x.contact_id = c.id
       WHERE x.list_id = ANY(${aud.listas}::uuid[])
         AND NOT EXISTS (SELECT 1 FROM mk_list_members y WHERE y.contact_id = c.id AND y.list_id = ANY(${aud.excluidas}::uuid[]))
    )
    SELECT count(*)::int AS miembros,
           count(*) FILTER (WHERE status = 'subscribed' AND NOT EXISTS (SELECT 1 FROM mk_suppressions s WHERE s.email = m.email))::int AS enviables
      FROM m`;
  return { miembros: r.miembros, enviables: r.enviables, excluidos: r.miembros - r.enviables };
}

export async function lanzarCampana(sql, campaignId, { encolar = encolarLotes, base, ahora = Date.now() } = {}) {
  if (!UUID.test(String(campaignId || ''))) return { status: 400, error: 'Falta el id de la campaña' };
  const { rows: [c] } = await sql`SELECT * FROM mk_campaigns WHERE id = ${campaignId}`;
  if (!c) return { status: 404, error: 'Campaña no encontrada' };
  if (!['draft', 'scheduled', 'paused'].includes(c.status)) return { status: 409, error: `La campaña está en estado «${c.status}» y no se puede lanzar` };
  const reanudar = c.status === 'paused';

  let listas = []; let excluidas = [];
  if (!reanudar) {
    const aud = validarAudiencia(c.audience);
    if (aud.error) return { status: 400, error: aud.error };
    ({ listas, excluidas } = aud);
  }

  // HTML final congelado (solo la primera vez; al reanudar se conserva el mismo).
  let html = c.html_snapshot;
  if (!html) {
    if (!c.template_id) return { status: 400, error: 'La campaña no tiene plantilla' };
    const { rows: [t] } = await sql`SELECT html, preheader FROM mk_templates WHERE id = ${c.template_id}`;
    if (!t) return { status: 400, error: 'La plantilla de la campaña no existe' };
    html = congelarHtml({ html: t.html, preheader: t.preheader, fromName: c.from_name, fromEmail: c.from_email });
  }

  // Reclamo atómico: si dos llamadas llegan a la vez, solo una pasa.
  const { rows: [reclamada] } = await sql`
    UPDATE mk_campaigns SET status = 'sending', started_at = COALESCE(started_at, now()), html_snapshot = ${html}, pause_reason = NULL
     WHERE id = ${campaignId} AND status IN ('draft', 'scheduled', 'paused') RETURNING id, rate_per_sec`;
  if (!reclamada) return { status: 409, error: 'La campaña ya fue lanzada por otra llamada' };

  if (!reanudar) {
    await sql`
      INSERT INTO mk_sends (campaign_id, contact_id, email)
      SELECT ${campaignId}, c.id, c.email FROM mk_contacts c
       WHERE c.status = 'subscribed'
         AND EXISTS (SELECT 1 FROM mk_list_members m WHERE m.contact_id = c.id AND m.list_id = ANY(${listas}::uuid[]))
         AND NOT EXISTS (SELECT 1 FROM mk_list_members x WHERE x.contact_id = c.id AND x.list_id = ANY(${excluidas}::uuid[]))
         AND NOT EXISTS (SELECT 1 FROM mk_suppressions s WHERE s.email = c.email)
      ON CONFLICT (campaign_id, contact_id) DO NOTHING`;
    await sql`UPDATE mk_campaigns SET total_recipients = (SELECT count(*) FROM mk_sends WHERE campaign_id = ${campaignId}) WHERE id = ${campaignId}`;
  }

  const { rows: [{ pendientes }] } = await sql`SELECT count(*)::int AS pendientes FROM mk_sends WHERE campaign_id = ${campaignId} AND status = 'queued'`;
  if (pendientes === 0) {
    await sql`UPDATE mk_campaigns SET status = ${reanudar ? 'sent' : 'failed'}, finished_at = now(), pause_reason = ${reanudar ? null : 'La audiencia quedó vacía (sin suscritos o todos suprimidos)'} WHERE id = ${campaignId}`;
    return { status: reanudar ? 200 : 422, ok: reanudar, error: reanudar ? undefined : 'La audiencia quedó vacía: no hay contactos suscritos en esas listas', destinatarios: 0, lotes: 0 };
  }

  const plan = planDeLotes(pendientes, { ratePorSeg: reclamada.rate_per_sec || 14 });
  const nonce = Math.floor(ahora / 60000); // un reintento del mismo lanzamiento dentro del minuto no duplica lotes
  try {
    await encolar(plan.map(p => ({ destino: urlWorker(base), cuerpo: { campaign_id: campaignId, lote: p.indice }, retrasoSeg: p.retrasoSeg, idDedup: `mk-${campaignId}-${nonce}-${p.indice}` })));
  } catch (e) {
    await sql`UPDATE mk_campaigns SET status = 'paused', pause_reason = ${('No se pudo encolar: ' + e.message).slice(0, 300)} WHERE id = ${campaignId} AND status = 'sending'`;
    return { status: 502, error: 'No se pudieron encolar los lotes: ' + e.message + '. La campaña quedó en pausa; vuelve a lanzarla.' };
  }
  return { status: 200, ok: true, reanudada: reanudar, destinatarios: pendientes, lotes: plan.length };
}

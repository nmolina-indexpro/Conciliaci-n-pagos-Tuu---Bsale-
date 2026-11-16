// /lib/mailing/eventos-ses.js
// Eventos de SES (configuration set -> SNS -> webhook): normalización (pura) y aplicación en la base.
// Las actualizaciones son idempotentes (cada una solo cuenta si cambia el estado), así que SNS puede reentregar el mismo evento sin duplicar totales.

import { createHash } from 'node:crypto';
import { normalizarEmail } from './email.js';

const TIPOS = {
  send: 'send', delivery: 'delivery', bounce: 'bounce', complaint: 'complaint', open: 'open', click: 'click', reject: 'reject',
  'rendering failure': 'rendering_failure', renderingfailure: 'rendering_failure', deliverydelay: 'delivery_delay', 'delivery delay': 'delivery_delay',
};

// Acepta el formato de «event publishing» (eventType) y el antiguo de notificaciones de feedback (notificationType).
export function normalizarEventoSes(mensaje) {
  const m = typeof mensaje === 'string' ? JSON.parse(mensaje) : mensaje;
  const tipo = TIPOS[String(m?.eventType || m?.notificationType || '').toLowerCase()];
  const messageId = m?.mail?.messageId;
  if (!tipo || !messageId) return null;

  const detalle = { delivery: m.delivery, bounce: m.bounce, complaint: m.complaint, open: m.open, click: m.click, reject: m.reject, rendering_failure: m.failure, delivery_delay: m.deliveryDelay, send: m.send }[tipo] || {};
  const ocurrio = new Date(detalle.timestamp || m.mail?.timestamp || Date.now());
  const destinatarios = (tipo === 'bounce' ? detalle.bouncedRecipients?.map(r => r.emailAddress)
    : tipo === 'complaint' ? detalle.complainedRecipients?.map(r => r.emailAddress)
    : detalle.recipients || m.mail?.destination || []).map(normalizarEmail).filter(Boolean);
  const ev = {
    tipo, messageId,
    ocurrio: Number.isNaN(ocurrio.getTime()) ? new Date() : ocurrio,
    url: tipo === 'click' ? String(detalle.link || '').slice(0, 2000) || null : null,
    bounceType: tipo === 'bounce' ? detalle.bounceType || null : null,
    userAgent: detalle.userAgent ? String(detalle.userAgent).slice(0, 300) : null,
    error: tipo === 'reject' ? detalle.reason : tipo === 'rendering_failure' ? detalle.errorMessage : null,
    destinatarios,
    payload: m,
  };
  ev.clave = claveEvento(ev);
  return ev;
}

export function claveEvento(ev) {
  return createHash('sha1').update([ev.messageId, ev.tipo, ev.ocurrio.toISOString(), ev.url || '', ev.destinatarios.join(',')].join('|')).digest('hex');
}

// Pausa automática: rebotes > 5 % o quejas > 0,1 % de lo enviado. Con muy pocos envíos las tasas no significan nada, por eso el mínimo.
export const UMBRALES_PAUSA = { minimoEnviados: 200, maxRebote: 0.05, maxQueja: 0.001 };
export function motivoDePausa({ enviados, rebotes, quejas }, u = UMBRALES_PAUSA) {
  if (!enviados || enviados < u.minimoEnviados) return null;
  if (rebotes / enviados > u.maxRebote) return `Rebotes ${(rebotes / enviados * 100).toFixed(1)} % (límite ${u.maxRebote * 100} %)`;
  if (quejas / enviados > u.maxQueja) return `Quejas ${(quejas / enviados * 100).toFixed(2)} % (límite ${u.maxQueja * 100} %)`;
  return null;
}

// Aplica el evento. Devuelve { aplicado, envio_conocido, pausada }.
export async function aplicarEventoSes(sql, ev) {
  const { rows: [envio] } = await sql`SELECT id, campaign_id, contact_id, email::text AS email FROM mk_sends WHERE ses_message_id = ${ev.messageId}`;
  const resultado = { envio_conocido: !!envio, pausada: false };
  const ts = ev.ocurrio.toISOString();

  if (envio) {
    const sumar = async (columna) => { // los nombres de columna son constantes de este archivo, nunca datos
      await sql.query(`UPDATE mk_campaigns SET ${columna} = COALESCE(${columna}, 0) + 1 WHERE id = $1`, [envio.campaign_id]);
    };
    let revisarPausa = false;

    if (ev.tipo === 'delivery') {
      const r = await sql`UPDATE mk_sends SET status = 'delivered', delivered_at = ${ts} WHERE id = ${envio.id} AND status IN ('queued', 'sent') RETURNING id`;
      if (r.rows.length) await sumar('total_delivered');
    } else if (ev.tipo === 'bounce' && ev.bounceType === 'Permanent') {
      const r = await sql`UPDATE mk_sends SET status = 'bounced', error = ${'rebote permanente'} WHERE id = ${envio.id} AND status NOT IN ('bounced', 'complained') RETURNING id`;
      if (r.rows.length) await sumar('total_bounced');
      // Supresión al instante (aunque el envío ya estuviera marcado: el correo sigue siendo inválido).
      const correos = ev.destinatarios.length ? ev.destinatarios : [normalizarEmail(envio.email)];
      await sql`INSERT INTO mk_suppressions (email, reason, detail) SELECT e, 'hard_bounce', ${'SES: ' + (ev.payload?.bounce?.bounceSubType || 'Permanent')} FROM unnest(${correos}::text[]) AS e ON CONFLICT (email) DO NOTHING`;
      await sql`UPDATE mk_contacts SET status = 'bounced', updated_at = now() WHERE email = ANY(${correos}::text[]::citext[]) AND status IN ('subscribed', 'pending')`;
      revisarPausa = true;
    } else if (ev.tipo === 'complaint') {
      const r = await sql`UPDATE mk_sends SET status = 'complained' WHERE id = ${envio.id} AND status <> 'complained' RETURNING id`;
      if (r.rows.length) await sumar('total_complaints');
      const correos = ev.destinatarios.length ? ev.destinatarios : [normalizarEmail(envio.email)];
      await sql`INSERT INTO mk_suppressions (email, reason, detail) SELECT e, 'complaint', ${'SES: ' + (ev.payload?.complaint?.complaintFeedbackType || 'complaint')} FROM unnest(${correos}::text[]) AS e ON CONFLICT (email) DO NOTHING`;
      await sql`UPDATE mk_contacts SET status = 'complained', updated_at = now() WHERE email = ANY(${correos}::text[]::citext[]) AND status <> 'complained'`;
      revisarPausa = true;
    } else if (ev.tipo === 'open') {
      const r = await sql`UPDATE mk_sends SET first_open_at = ${ts} WHERE id = ${envio.id} AND first_open_at IS NULL RETURNING id`;
      if (r.rows.length) await sumar('unique_opens');
      await sql`UPDATE mk_contacts SET last_open_at = ${ts} WHERE id = ${envio.contact_id} AND (last_open_at IS NULL OR last_open_at < ${ts})`;
    } else if (ev.tipo === 'click') {
      const r = await sql`UPDATE mk_sends SET first_click_at = ${ts} WHERE id = ${envio.id} AND first_click_at IS NULL RETURNING id`;
      if (r.rows.length) await sumar('unique_clicks');
      await sql`UPDATE mk_contacts SET last_click_at = ${ts} WHERE id = ${envio.contact_id} AND (last_click_at IS NULL OR last_click_at < ${ts})`;
    } else if (ev.tipo === 'reject' || ev.tipo === 'rendering_failure') {
      await sql`UPDATE mk_sends SET status = 'failed', error = ${String(ev.error || ev.tipo).slice(0, 300)} WHERE id = ${envio.id} AND status IN ('queued', 'sent')`;
    }

    if (revisarPausa) {
      const { rows: [c] } = await sql`SELECT total_sent, total_bounced, total_complaints FROM mk_campaigns WHERE id = ${envio.campaign_id}`;
      const motivo = c && motivoDePausa({ enviados: c.total_sent, rebotes: c.total_bounced, quejas: c.total_complaints });
      if (motivo) {
        const p = await sql`UPDATE mk_campaigns SET status = 'paused', pause_reason = ${motivo} WHERE id = ${envio.campaign_id} AND status = 'sending' RETURNING id`;
        resultado.pausada = p.rows.length > 0;
      }
    }
  }

  // El evento crudo se guarda al final: si algo de arriba falló, SNS reintenta y se vuelve a aplicar (todo es idempotente).
  const ins = await sql`
    INSERT INTO mk_events (send_id, ses_message_id, type, url, bounce_type, user_agent, payload, occurred_at, event_key)
    VALUES (${envio?.id ?? null}, ${ev.messageId}, ${ev.tipo}, ${ev.url}, ${ev.bounceType}, ${ev.userAgent}, ${JSON.stringify(ev.payload)}::jsonb, ${ts}, ${ev.clave})
    ON CONFLICT (event_key) DO NOTHING RETURNING id`;
  resultado.aplicado = ins.rows.length > 0;
  return resultado;
}

// /lib/mailing/worker.js
// Worker de envío por lotes (lo llama QStash). La lógica está separada de la base y de SES mediante un «repo» y una función `enviar` inyectables,
// para poder probarla sin red. crearRepoSql() es la implementación real.
//
// Garantías:
//  - Los lotes son intercambiables: cada uno RECLAMA hasta 50 destinatarios en estado queued con un «arriendo» (queued_at = ahora + 5 min), de modo que
//    dos lotes simultáneos o un reintento de QStash nunca toman al mismo destinatario.
//  - Antes de enviar se vuelve a cruzar con supresiones y con el estado del contacto.
//  - Un destinatario ya enviado no vuelve a quedar en queued: no hay reenvío en reintentos.

import { personalizar, htmlATexto } from './plantilla.js';
import { crearTokenBaja, urlBaja } from './token-baja.js';
import { normalizarEmail } from './email.js';
import { enviarCorreoSes } from './ses.js';
import { TAMANO_LOTE, urlWorker } from './lanzar.js';
import { encolarLotes } from './firma-qstash.js';

export const ARRIENDO_SEG = 300;
export const MAX_INTENTOS = 3;
const dormir = ms => new Promise(r => setTimeout(r, ms));

export function varsDeContacto(d, campaignId, { secreto, base } = {}) {
  const token = crearTokenBaja(d.contact_id, campaignId, secreto);
  return { vars: { first_name: d.first_name, last_name: d.last_name, company_name: d.company_name, email: d.email, unsubscribe_url: urlBaja(token, base) }, urlBaja: urlBaja(token, base) };
}

// repo: campana(id), reclamar(id, n, arriendoSeg), suprimidosDe(emails)->Set, marcarSuprimidos(ids), marcarEnviados([{id, messageId}]), marcarFallido(id, msg),
//       liberar(id, retrasoSeg, msg), liberarTodos(ids), pausar(id, motivo), cerrarSiTermino(id)->bool, pendientes(id)->int
export async function procesarLote(repo, { campaignId, enviar = enviarCorreoSes, esperar = dormir, secreto, base } = {}) {
  const camp = await repo.campana(campaignId);
  if (!camp) return { omitido: 'campaña inexistente' };
  if (camp.status !== 'sending') return { omitido: `campaña en estado ${camp.status}` };

  const reclamados = await repo.reclamar(campaignId, TAMANO_LOTE, ARRIENDO_SEG);
  const res = { reclamados: reclamados.length, enviados: 0, suprimidos: 0, fallidos: 0, reintentos: 0, cerrada: false, seguimiento: false };
  if (!reclamados.length) {
    res.cerrada = await repo.cerrarSiTermino(campaignId);
    res.seguimiento = !res.cerrada && (await repo.pendientes(campaignId)) > 0; // solo quedan destinatarios con arriendo vigente: hay que volver a mirar
    return res;
  }

  // Cruce final con supresiones justo antes de enviar.
  const suprimidos = await repo.suprimidosDe(reclamados.map(r => r.email));
  const bloqueados = reclamados.filter(r => r.contact_status !== 'subscribed' || suprimidos.has(normalizarEmail(r.email)));
  const bloqueadosIds = new Set(bloqueados.map(r => r.id));
  if (bloqueados.length) await repo.marcarSuprimidos(bloqueados.map(r => r.id));
  res.suprimidos = bloqueados.length;
  const aEnviar = reclamados.filter(r => !bloqueadosIds.has(r.id));

  const porSeg = Math.max(1, camp.rate_per_sec || 14);
  let detenido = null;
  let hechos = 0; // destinatarios de aEnviar ya resueltos (enviados, fallidos o devueltos a la cola)
  for (let i = 0; i < aEnviar.length && !detenido; i += porSeg) {
    const inicio = Date.now();
    const grupo = aEnviar.slice(i, i + porSeg);
    hechos = i + grupo.length;
    const resultados = await Promise.allSettled(grupo.map(async d => {
      const { vars, urlBaja: enlace } = varsDeContacto(d, campaignId, { secreto, base });
      const r = await enviar({
        para: d.email, nombreRemitente: camp.from_name, correoRemitente: camp.from_email, responderA: camp.reply_to,
        asunto: personalizar(camp.subject, vars, { html: false }), html: personalizar(camp.html_snapshot, vars), texto: htmlATexto(personalizar(camp.html_snapshot, vars)), urlBaja: enlace,
      });
      return r.messageId;
    }));
    const ok = [];
    for (let j = 0; j < grupo.length; j++) {
      const d = grupo[j]; const r = resultados[j];
      if (r.status === 'fulfilled') { ok.push({ id: d.id, messageId: r.value }); continue; }
      const tipo = r.reason?.tipo || 'temporal'; const msg = String(r.reason?.message || r.reason).slice(0, 300);
      if (tipo === 'config') { detenido = msg; await repo.liberar(d.id, 60, msg); res.reintentos++; }
      else if (tipo === 'permanente' || d.attempts >= MAX_INTENTOS) { await repo.marcarFallido(d.id, msg); res.fallidos++; }
      else { await repo.liberar(d.id, tipo === 'throttle' ? 30 * d.attempts : 60 * d.attempts, msg); res.reintentos++; }
    }
    if (ok.length) { await repo.marcarEnviados(ok); res.enviados += ok.length; }
    const resto = 1000 - (Date.now() - inicio);
    if (!detenido && i + porSeg < aEnviar.length && resto > 0) await esperar(resto); // respeta rate_per_sec
  }
  if (detenido) {
    // Problema de credenciales/cuenta: no tiene sentido seguir intentando; lo no procesado vuelve a la cola con la campaña en pausa.
    const enCurso = aEnviar.slice(hechos).map(d => d.id);
    if (enCurso.length) await repo.liberarTodos(enCurso);
    await repo.pausar(campaignId, `SES rechazó el envío: ${detenido}`.slice(0, 300));
    res.pausada = detenido;
    return res;
  }
  res.cerrada = await repo.cerrarSiTermino(campaignId);
  return res;
}

export function crearRepoSql(sql) {
  return {
    async campana(id) {
      const { rows: [c] } = await sql`SELECT id, status, subject, html_snapshot, from_name, from_email, reply_to, rate_per_sec FROM mk_campaigns WHERE id = ${id}`;
      return c || null;
    },
    async reclamar(id, n, arriendoSeg) {
      const { rows } = await sql`
        WITH elegidos AS (
          SELECT id FROM mk_sends WHERE campaign_id = ${id} AND status = 'queued' AND queued_at <= now() ORDER BY id LIMIT ${n} FOR UPDATE SKIP LOCKED
        ), actualizados AS (
          UPDATE mk_sends s SET attempts = s.attempts + 1, queued_at = now() + make_interval(secs => ${arriendoSeg}) FROM elegidos e WHERE s.id = e.id
          RETURNING s.id, s.contact_id, s.email, s.attempts
        )
        SELECT a.id, a.contact_id, a.email::text AS email, a.attempts, c.first_name, c.last_name, c.company_name, c.status::text AS contact_status
          FROM actualizados a JOIN mk_contacts c ON c.id = a.contact_id ORDER BY a.id`;
      return rows;
    },
    async suprimidosDe(emails) {
      if (!emails.length) return new Set();
      const { rows } = await sql`SELECT email::text AS email FROM mk_suppressions WHERE email = ANY(${emails}::text[]::citext[])`;
      return new Set(rows.map(r => normalizarEmail(r.email)));
    },
    async marcarSuprimidos(ids) { await sql`UPDATE mk_sends SET status = 'suppressed', error = 'suprimido antes de enviar' WHERE id = ANY(${ids}::bigint[]) AND status = 'queued'`; },
    async marcarEnviados(lista) {
      // El estado solo pasa a sent si seguía en queued (un evento de entrega rápido pudo adelantarse); el contador cuenta igual.
      const { rows } = await sql`
        UPDATE mk_sends s SET ses_message_id = u.mid, sent_at = now(), error = NULL, status = CASE WHEN s.status = 'queued' THEN 'sent'::mk_send_status ELSE s.status END
          FROM unnest(${lista.map(x => x.id)}::bigint[], ${lista.map(x => x.messageId)}::text[]) AS u(id, mid)
         WHERE s.id = u.id RETURNING s.campaign_id, s.contact_id`;
      if (rows.length) {
        await sql`UPDATE mk_campaigns SET total_sent = COALESCE(total_sent, 0) + ${rows.length} WHERE id = ${rows[0].campaign_id}`;
        await sql`UPDATE mk_contacts SET last_sent_at = now() WHERE id = ANY(${rows.map(r => r.contact_id)}::uuid[])`;
      }
    },
    async marcarFallido(id, msg) { await sql`UPDATE mk_sends SET status = 'failed', error = ${msg} WHERE id = ${id}`; },
    async liberar(id, retrasoSeg, msg) { await sql`UPDATE mk_sends SET queued_at = now() + make_interval(secs => ${retrasoSeg}), error = ${msg} WHERE id = ${id} AND status = 'queued'`; },
    async liberarTodos(ids) { await sql`UPDATE mk_sends SET queued_at = now() WHERE id = ANY(${ids}::bigint[]) AND status = 'queued'`; },
    async pausar(id, motivo) { await sql`UPDATE mk_campaigns SET status = 'paused', pause_reason = ${motivo} WHERE id = ${id} AND status = 'sending'`; },
    async cerrarSiTermino(id) {
      const { rows } = await sql`
        UPDATE mk_campaigns SET status = 'sent', finished_at = now()
         WHERE id = ${id} AND status = 'sending' AND NOT EXISTS (SELECT 1 FROM mk_sends WHERE campaign_id = ${id} AND status = 'queued') RETURNING id`;
      return rows.length > 0;
    },
    async pendientes(id) {
      const { rows: [r] } = await sql`SELECT count(*)::int AS n FROM mk_sends WHERE campaign_id = ${id} AND status = 'queued'`;
      return r.n;
    },
  };
}

// Si solo quedan destinatarios con arriendo vigente (otro lote cayó a medias), se programa un lote de seguimiento después de que venza el arriendo.
export async function programarSeguimiento(campaignId, { encolar = encolarLotes, base, ahora = Date.now() } = {}) {
  await encolar([{ destino: urlWorker(base), cuerpo: { campaign_id: campaignId, lote: 'seguimiento' }, retrasoSeg: ARRIENDO_SEG + 15, idDedup: `mk-${campaignId}-seg-${Math.floor(ahora / (ARRIENDO_SEG * 1000))}` }]);
}

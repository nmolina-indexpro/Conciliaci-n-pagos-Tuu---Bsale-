// /lib/mailing/manejar.js
// Puertas de entrada del módulo de Mailing dentro de api/negocio.js (no se crean funciones nuevas: el plan Hobby permite 12 y ya están usadas).
//   Públicas (sin sesión; cada una se autentica sola):  mk-webhook-ses (firma SNS) · mk-worker-enviar-lote (firma QStash) · mk-baja (token HMAC)
//   Con sesión (solo administradores, ver ESCRITURA_SOLO_ADMIN):  mk-contactos-importar · mk-campana-lanzar

import { verificarMensajeSns, urlSuscripcionValida } from './firma-sns.js';
import { verificarFirmaQstash } from './firma-qstash.js';
import { normalizarEventoSes, aplicarEventoSes } from './eventos-ses.js';
import { importarCsv } from './importar.js';
import { lanzarCampana, urlWorker } from './lanzar.js';
import { procesarLote, crearRepoSql, programarSeguimiento } from './worker.js';
import { manejarBaja } from './baja.js';
import { asegurarTablasMailing } from '../db.js';

export const RECURSOS_MAILING_PUBLICOS = ['mk-webhook-ses', 'mk-worker-enviar-lote', 'mk-baja'];
export const esRecursoMailing = r => typeof r === 'string' && r.startsWith('mk-');

export async function manejarMailingPublico(req, res, { getSql }) {
  const recurso = req.query.recurso;
  if (recurso === 'mk-baja') return manejarBaja(req, res, { getSql: async () => { const s = await getSql(); await asegurarTablasMailing(s); return s; } });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (recurso === 'mk-webhook-ses') return await webhookSes(req, res, getSql);
    if (recurso === 'mk-worker-enviar-lote') return await workerEnviarLote(req, res, getSql);
  } catch (e) {
    console.error(`[${recurso}] error`, e.message);
    return res.status(500).json({ error: 'Error interno' }); // 5xx: SNS y QStash reintentan
  }
  return res.status(404).json({ error: 'Recurso no encontrado' });
}

async function webhookSes(req, res, getSql) {
  const msg = req.body;
  if (!(await verificarMensajeSns(msg))) {
    console.warn('[mk-webhook-ses] rechazado: firma SNS inválida');
    return res.status(403).json({ error: 'Firma inválida' });
  }
  if (msg.Type === 'SubscriptionConfirmation') {
    if (!urlSuscripcionValida(msg.SubscribeURL)) return res.status(400).json({ error: 'SubscribeURL no válida' });
    const r = await fetch(msg.SubscribeURL);
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok, suscripcion: 'confirmada' });
  }
  if (msg.Type !== 'Notification') return res.status(200).json({ ok: true, ignorado: msg.Type });

  let contenido;
  try { contenido = JSON.parse(msg.Message); } catch { return res.status(200).json({ ok: true, ignorado: 'mensaje no JSON' }); }
  const ev = normalizarEventoSes(contenido);
  if (!ev) return res.status(200).json({ ok: true, ignorado: 'evento no reconocido' });
  const sql = await getSql();
  await asegurarTablasMailing(sql);
  const r = await aplicarEventoSes(sql, ev);
  return res.status(200).json({ ok: true, tipo: ev.tipo, ...r });
}

async function workerEnviarLote(req, res, getSql) {
  const url = urlWorker();
  const valida = verificarFirmaQstash({ firma: req.headers['upstash-signature'], cuerpo: req.rawBody ?? '', url });
  if (!valida) {
    console.warn('[mk-worker-enviar-lote] rechazado: firma QStash inválida');
    return res.status(401).json({ error: 'Firma inválida' });
  }
  const campaignId = req.body?.campaign_id;
  if (!campaignId) return res.status(400).json({ error: 'Falta campaign_id' });
  const sql = await getSql();
  await asegurarTablasMailing(sql);
  const r = await procesarLote(crearRepoSql(sql), { campaignId });
  if (r.seguimiento) await programarSeguimiento(campaignId).catch(e => console.error('[mk-worker] no se pudo programar seguimiento', e.message));
  return res.status(200).json({ ok: true, ...r });
}

export async function manejarMailingAdmin(req, res, sesion, { getSql }) {
  const recurso = req.query.recurso;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sesion || sesion.rol !== 'admin') return res.status(403).json({ error: 'Esta acción requiere rol de administrador' });
  try {
    const sql = await getSql();
    await asegurarTablasMailing(sql);
    if (recurso === 'mk-contactos-importar') {
      // Acepta JSON { csv, tipo, categoria, origen } o el CSV directo (Content-Type: text/csv). Partir archivos grandes en tandas de ≤ 5000 filas (límite de 4,5 MB por petición en Vercel).
      const crudo = String(req.headers['content-type'] || '').includes('text/csv');
      const texto = crudo ? req.rawBody : req.body?.csv;
      if (!texto || typeof texto !== 'string') return res.status(400).json({ error: 'Falta el CSV' });
      const tipo = (crudo ? req.query.tipo : req.body.tipo) === 'supresiones' ? 'supresiones' : 'contactos';
      const categoria = ['unsubscribe', 'hard_bounce', 'complaint'].includes(crudo ? req.query.categoria : req.body.categoria) ? (crudo ? req.query.categoria : req.body.categoria) : null;
      const origen = /^[a-z_]{2,30}$/.test(String((crudo ? req.query.origen : req.body.origen) || '')) ? (crudo ? req.query.origen : req.body.origen) : 'zoho_import';
      const r = await importarCsv(sql, texto, { tipo, categoria, origen });
      return res.status(r.ok ? 200 : 400).json(r);
    }
    if (recurso === 'mk-campana-lanzar') {
      const id = req.query.id || req.body?.id;
      const { status, ...cuerpo } = await lanzarCampana(sql, id);
      return res.status(status).json(cuerpo);
    }
  } catch (e) {
    console.error(`[${recurso}] error`, e);
    return res.status(500).json({ error: e.message });
  }
  return res.status(404).json({ error: 'Recurso no encontrado' });
}

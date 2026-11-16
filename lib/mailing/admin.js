// /lib/mailing/admin.js
// Operaciones de la pantalla de Mailing (solo administradores): panel, listas, plantillas, campañas, estimación, envío de prueba, reporte y búsqueda de contactos.
// `despachar` no toca req/res: recibe { metodo, query, body, sql, enviar } y devuelve { status, cuerpo }, así se prueba sin servidor.

import { randomUUID } from 'node:crypto';
import { emailValido, normalizarEmail } from './email.js';
import { congelarHtml, personalizar, htmlATexto } from './plantilla.js';
import { estimarAudiencia, validarAudiencia } from './lanzar.js';
import { crearTokenBaja, urlBaja } from './token-baja.js';
import { enviarCorreoSes } from './ses.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ok = (cuerpo = {}) => ({ status: 200, cuerpo: { ok: true, ...cuerpo } });
const mal = (status, error) => ({ status, cuerpo: { error } });
const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const MAX_HTML = 400_000;
const MAX_PRUEBA = 5;
const ESTADOS_EDITABLES = ['draft', 'scheduled'];
const VARS_MUESTRA = { first_name: 'Camila', last_name: 'Soto', company_name: 'Empresa Ejemplo', email: 'camila@ejemplo.cl', unsubscribe_url: '#' };

// Dominios desde los que se puede enviar (MK_FROM_DOMAINS="news.indexstore.cl,news.indexpro.cl"). Sin la variable no se restringe.
export function remitenteValido(correo, env = process.env) {
  if (!emailValido(correo)) return false;
  const dominios = String(env.MK_FROM_DOMAINS || '').split(/[,\s]+/).map(d => d.trim().toLowerCase()).filter(Boolean);
  return !dominios.length || dominios.includes(normalizarEmail(correo).split('@')[1]);
}

export function estadoConfiguracion(env = process.env) {
  return {
    ses: !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),
    configuration_set: env.SES_CONFIGURATION_SET || null,
    cola: !!(env.QSTASH_TOKEN && env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY),
    eventos: !!env.MK_SNS_TOPIC_ARN,
    baja: !!env.MK_UNSUB_SECRET,
    programadas: !!env.CRON_SECRET,
    dominios_remitente: String(env.MK_FROM_DOMAINS || '').split(/[,\s]+/).filter(Boolean),
    base_publica: env.MK_PUBLIC_BASE_URL || 'https://erp.indexstore.cl',
  };
}

async function panel(sql) {
  const [contactos, supresiones, listas, plantillas, campanas] = await Promise.all([
    sql`SELECT status::text AS estado, count(*)::int AS n FROM mk_contacts GROUP BY status`,
    sql`SELECT reason, count(*)::int AS n FROM mk_suppressions GROUP BY reason`,
    sql`SELECT l.id, l.name, l.description, l.created_at, count(m.contact_id)::int AS miembros, (count(*) FILTER (WHERE c.status = 'subscribed'))::int AS suscritos
          FROM mk_lists l LEFT JOIN mk_list_members m ON m.list_id = l.id LEFT JOIN mk_contacts c ON c.id = m.contact_id GROUP BY l.id ORDER BY l.name`,
    sql`SELECT id, name, subject, preheader, updated_at FROM mk_templates ORDER BY updated_at DESC`,
    sql`SELECT id, name, status::text AS status, subject, from_name, from_email, reply_to, template_id, audience, scheduled_at, started_at, finished_at, rate_per_sec,
               total_recipients, total_sent, total_delivered, total_bounced, total_complaints, unique_opens, unique_clicks, total_unsubscribes, pause_reason, created_at
          FROM mk_campaigns ORDER BY created_at DESC LIMIT 100`,
  ]);
  const porEstado = Object.fromEntries(contactos.rows.map(r => [r.estado, r.n]));
  return ok({
    contactos: { total: Object.values(porEstado).reduce((a, b) => a + b, 0), ...porEstado },
    supresiones: { total: supresiones.rows.reduce((a, r) => a + r.n, 0), por_motivo: Object.fromEntries(supresiones.rows.map(r => [r.reason, r.n])) },
    listas: listas.rows, plantillas: plantillas.rows, campanas: campanas.rows, config: estadoConfiguracion(),
  });
}

// ── Listas ───────────────────────────────────────────────────────────
async function listas(sql, b) {
  const nombre = texto(b.name, 120);
  if (b.accion === 'crear' || b.accion === 'renombrar') {
    if (!nombre) return mal(400, 'La lista necesita un nombre');
    try {
      if (b.accion === 'crear') {
        const { rows: [l] } = await sql`INSERT INTO mk_lists (name, description) VALUES (${nombre}, ${texto(b.description, 300) || null}) RETURNING id`;
        return ok({ id: l.id });
      }
      if (!UUID.test(b.id || '')) return mal(400, 'Lista inválida');
      const r = await sql`UPDATE mk_lists SET name = ${nombre}, description = ${texto(b.description, 300) || null} WHERE id = ${b.id} RETURNING id`;
      return r.rows.length ? ok() : mal(404, 'Lista no encontrada');
    } catch (e) {
      if (/unique|duplicate/i.test(e.message)) return mal(409, 'Ya existe una lista con ese nombre');
      throw e;
    }
  }
  if (b.accion === 'eliminar') {
    if (!UUID.test(b.id || '')) return mal(400, 'Lista inválida');
    const { rows: [u] } = await sql`SELECT count(*)::int AS n FROM mk_campaigns WHERE status IN ('draft', 'scheduled', 'sending', 'paused') AND audience::text LIKE ${'%' + b.id + '%'}`;
    if (u.n) return mal(409, `La lista se usa en ${u.n} campaña(s) sin terminar; cámbialas antes de eliminarla`);
    await sql`DELETE FROM mk_lists WHERE id = ${b.id}`; // los contactos no se borran, solo su pertenencia a la lista
    return ok();
  }
  return mal(400, 'Acción no válida');
}

// ── Plantillas ───────────────────────────────────────────────────────
function validarPlantilla(b) {
  const name = texto(b.name, 120); const subject = texto(b.subject, 200); const html = String(b.html ?? '');
  if (!name) return { error: 'La plantilla necesita un nombre' };
  if (!subject) return { error: 'La plantilla necesita un asunto' };
  if (!html.trim()) return { error: 'El HTML está vacío' };
  if (html.length > MAX_HTML) return { error: 'El HTML es demasiado grande (máximo 400 KB)' };
  const variables = [...new Set([...(subject + html).matchAll(/\{\{\s*([a-z_]+)/gi)].map(m => m[1].toLowerCase()))];
  return { name, subject, html, preheader: texto(b.preheader, 200) || null, variables };
}

async function plantillas(sql, { metodo, query, body: b }) {
  if (metodo === 'GET') {
    if (!UUID.test(query.id || '')) return mal(400, 'Plantilla inválida');
    const { rows: [t] } = await sql`SELECT id, name, subject, preheader, html, updated_at FROM mk_templates WHERE id = ${query.id}`;
    return t ? ok({ plantilla: t }) : mal(404, 'Plantilla no encontrada');
  }
  if (b.accion === 'vista') {
    const html = String(b.html ?? '');
    if (html.length > MAX_HTML) return mal(400, 'El HTML es demasiado grande');
    const final = congelarHtml({ html, preheader: texto(b.preheader, 200), fromName: 'IndexStore', fromEmail: 'ofertas@news.indexstore.cl' });
    return ok({ html: personalizar(final, VARS_MUESTRA), asunto: personalizar(texto(b.subject, 200), VARS_MUESTRA, { html: false }) });
  }
  if (b.accion === 'eliminar') {
    if (!UUID.test(b.id || '')) return mal(400, 'Plantilla inválida');
    const { rows: [u] } = await sql`SELECT count(*)::int AS n FROM mk_campaigns WHERE template_id = ${b.id}`;
    if (u.n) return mal(409, `La plantilla la usan ${u.n} campaña(s); no se puede eliminar`);
    await sql`DELETE FROM mk_templates WHERE id = ${b.id}`;
    return ok();
  }
  if (b.accion === 'guardar') {
    const v = validarPlantilla(b);
    if (v.error) return mal(400, v.error);
    if (b.id) {
      if (!UUID.test(b.id)) return mal(400, 'Plantilla inválida');
      const r = await sql`UPDATE mk_templates SET name = ${v.name}, subject = ${v.subject}, preheader = ${v.preheader}, html = ${v.html}, variables = ${v.variables}::text[], updated_at = now() WHERE id = ${b.id} RETURNING id`;
      return r.rows.length ? ok({ id: b.id }) : mal(404, 'Plantilla no encontrada');
    }
    const { rows: [t] } = await sql`INSERT INTO mk_templates (name, subject, preheader, html, variables) VALUES (${v.name}, ${v.subject}, ${v.preheader}, ${v.html}, ${v.variables}::text[]) RETURNING id`;
    return ok({ id: t.id });
  }
  return mal(400, 'Acción no válida');
}

// ── Campañas ─────────────────────────────────────────────────────────
async function cargarCampana(sql, id) {
  if (!UUID.test(id || '')) return null;
  const { rows: [c] } = await sql`SELECT * FROM mk_campaigns WHERE id = ${id}`;
  return c || null;
}

async function guardarCampana(sql, b) {
  const name = texto(b.name, 120); const subject = texto(b.subject, 200);
  const fromEmail = normalizarEmail(b.from_email); const replyTo = texto(b.reply_to, 200);
  if (!name) return mal(400, 'La campaña necesita un nombre');
  if (!subject) return mal(400, 'La campaña necesita un asunto');
  if (!remitenteValido(fromEmail)) return mal(400, 'El correo del remitente no es válido' + (process.env.MK_FROM_DOMAINS ? ` (dominios permitidos: ${process.env.MK_FROM_DOMAINS})` : ''));
  if (replyTo && !emailValido(replyTo)) return mal(400, 'El correo de respuesta no es válido');
  if (!UUID.test(b.template_id || '')) return mal(400, 'Elige una plantilla');
  const { rows: [t] } = await sql`SELECT id FROM mk_templates WHERE id = ${b.template_id}`;
  if (!t) return mal(400, 'La plantilla elegida no existe');
  const lists = Array.isArray(b.lists) ? b.lists : []; const exclude_lists = Array.isArray(b.exclude_lists) ? b.exclude_lists : [];
  const aud = validarAudiencia({ lists, exclude_lists });
  if (aud.error) return mal(400, aud.error);
  const { rows: existentes } = await sql`SELECT id FROM mk_lists WHERE id = ANY(${[...new Set([...lists, ...exclude_lists])]}::uuid[])`;
  if (existentes.length !== new Set([...lists, ...exclude_lists]).size) return mal(400, 'Alguna lista elegida ya no existe');
  if (lists.some(id => exclude_lists.includes(id))) return mal(400, 'Una misma lista no puede estar en destinatarios y en excluidas');
  const rate = Math.min(200, Math.max(1, parseInt(b.rate_per_sec, 10) || 14));
  const audiencia = JSON.stringify({ lists, exclude_lists });
  const fromName = texto(b.from_name, 80) || 'IndexStore';

  if (b.id) {
    const c = await cargarCampana(sql, b.id);
    if (!c) return mal(404, 'Campaña no encontrada');
    if (!ESTADOS_EDITABLES.includes(c.status)) return mal(409, 'Solo se pueden editar campañas en borrador o programadas');
    await sql`UPDATE mk_campaigns SET name = ${name}, template_id = ${b.template_id}, subject = ${subject}, from_name = ${fromName}, from_email = ${fromEmail}, reply_to = ${replyTo || null},
              audience = ${audiencia}::jsonb, rate_per_sec = ${rate} WHERE id = ${b.id}`;
    return ok({ id: b.id });
  }
  const { rows: [n] } = await sql`INSERT INTO mk_campaigns (name, template_id, subject, from_name, from_email, reply_to, audience, rate_per_sec)
    VALUES (${name}, ${b.template_id}, ${subject}, ${fromName}, ${fromEmail}, ${replyTo || null}, ${audiencia}::jsonb, ${rate}) RETURNING id`;
  return ok({ id: n.id });
}

async function accionCampana(sql, b, ahora) {
  const c = await cargarCampana(sql, b.id);
  if (!c) return mal(404, 'Campaña no encontrada');
  switch (b.accion) {
    case 'programar': {
      const cuando = new Date(b.scheduled_at);
      if (Number.isNaN(cuando.getTime())) return mal(400, 'Fecha de envío inválida');
      if (cuando.getTime() < ahora + 60_000) return mal(400, 'La fecha de envío debe ser futura');
      if (!ESTADOS_EDITABLES.includes(c.status)) return mal(409, 'Solo se programan campañas en borrador');
      await sql`UPDATE mk_campaigns SET status = 'scheduled', scheduled_at = ${cuando.toISOString()} WHERE id = ${c.id}`;
      return ok();
    }
    case 'desprogramar': {
      const r = await sql`UPDATE mk_campaigns SET status = 'draft', scheduled_at = NULL WHERE id = ${c.id} AND status = 'scheduled' RETURNING id`;
      return r.rows.length ? ok() : mal(409, 'La campaña no está programada');
    }
    case 'pausar': {
      const r = await sql`UPDATE mk_campaigns SET status = 'paused', pause_reason = 'Pausada manualmente' WHERE id = ${c.id} AND status = 'sending' RETURNING id`;
      return r.rows.length ? ok() : mal(409, 'La campaña no se está enviando');
    }
    case 'cancelar': {
      const r = await sql`UPDATE mk_campaigns SET status = 'cancelled', finished_at = now() WHERE id = ${c.id} AND status IN ('draft', 'scheduled', 'sending', 'paused') RETURNING id`;
      return r.rows.length ? ok() : mal(409, 'La campaña ya terminó');
    }
    case 'duplicar': {
      const { rows: [n] } = await sql`INSERT INTO mk_campaigns (name, template_id, subject, from_name, from_email, reply_to, audience, rate_per_sec)
        SELECT ${texto(c.name + ' (copia)', 120)}, template_id, subject, from_name, from_email, reply_to, audience, rate_per_sec FROM mk_campaigns WHERE id = ${c.id} RETURNING id`;
      return ok({ id: n.id });
    }
    case 'eliminar': {
      if (!['draft', 'cancelled'].includes(c.status) || c.total_sent > 0) return mal(409, 'Solo se eliminan borradores o campañas canceladas que no enviaron nada');
      await sql`DELETE FROM mk_campaigns WHERE id = ${c.id}`;
      return ok();
    }
    default: return mal(400, 'Acción no válida');
  }
}

async function estimar(sql, b) {
  const c = await cargarCampana(sql, b.id);
  if (!c) return mal(404, 'Campaña no encontrada');
  const e = await estimarAudiencia(sql, c.audience);
  return e.error ? mal(400, e.error) : ok(e);
}

// Envío de prueba a correos internos: usa la plantilla tal como saldrá (preheader y pie de baja incluidos) con datos de muestra y un enlace de baja que no afecta a nadie.
async function probar(sql, b, enviar) {
  const c = await cargarCampana(sql, b.id);
  if (!c) return mal(404, 'Campaña no encontrada');
  const para = [...new Set((Array.isArray(b.para) ? b.para : String(b.para || '').split(/[,;\s]+/)).map(normalizarEmail).filter(Boolean))];
  if (!para.length) return mal(400, 'Indica al menos un correo de prueba');
  if (para.length > MAX_PRUEBA) return mal(400, `Máximo ${MAX_PRUEBA} correos de prueba por envío`);
  const invalidos = para.filter(e => !emailValido(e));
  if (invalidos.length) return mal(400, 'Correo inválido: ' + invalidos.join(', '));
  let html = c.html_snapshot;
  if (!html) {
    const { rows: [t] } = await sql`SELECT html, preheader FROM mk_templates WHERE id = ${c.template_id}`;
    if (!t) return mal(400, 'La plantilla de la campaña no existe');
    html = congelarHtml({ html: t.html, preheader: t.preheader, fromName: c.from_name, fromEmail: c.from_email });
  }
  const enlace = urlBaja(crearTokenBaja(randomUUID(), null)); // contacto inexistente: el enlace de la prueba no da de baja a nadie
  const vars = { ...VARS_MUESTRA, unsubscribe_url: enlace };
  const resultados = [];
  for (const destino of para) {
    try {
      const html2 = personalizar(html, { ...vars, email: destino });
      await enviar({ para: destino, nombreRemitente: c.from_name, correoRemitente: c.from_email, responderA: c.reply_to, asunto: '[PRUEBA] ' + personalizar(c.subject, vars, { html: false }), html: html2, texto: htmlATexto(html2), urlBaja: enlace });
      resultados.push({ para: destino, enviado: true });
    } catch (e) {
      resultados.push({ para: destino, enviado: false, error: String(e.message || e).slice(0, 200) });
    }
  }
  return ok({ resultados, todos_enviados: resultados.every(r => r.enviado) });
}

// ── Reporte ──────────────────────────────────────────────────────────
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

async function reporte(sql, id) {
  const c = await cargarCampana(sql, id);
  if (!c) return mal(404, 'Campaña no encontrada');
  const [estados, enlaces, problemas, fallidos, curva] = await Promise.all([
    sql`SELECT status::text AS estado, count(*)::int AS n FROM mk_sends WHERE campaign_id = ${c.id} GROUP BY status`,
    sql`SELECT e.url, count(*)::int AS clics, count(DISTINCT e.send_id)::int AS personas FROM mk_events e JOIN mk_sends s ON s.id = e.send_id
         WHERE s.campaign_id = ${c.id} AND e.type = 'click' AND e.url IS NOT NULL GROUP BY e.url ORDER BY clics DESC LIMIT 10`,
    sql`SELECT s.email::text AS email, e.type::text AS tipo, e.bounce_type, e.occurred_at FROM mk_events e JOIN mk_sends s ON s.id = e.send_id
         WHERE s.campaign_id = ${c.id} AND (e.type = 'complaint' OR (e.type = 'bounce' AND e.bounce_type = 'Permanent')) ORDER BY e.occurred_at DESC LIMIT 50`,
    sql`SELECT email::text AS email, error FROM mk_sends WHERE campaign_id = ${c.id} AND status = 'failed' ORDER BY id LIMIT 20`,
    sql`SELECT date_trunc('hour', e.occurred_at) AS hora, count(*) FILTER (WHERE e.type = 'open')::int AS aperturas, count(*) FILTER (WHERE e.type = 'click')::int AS clics
          FROM mk_events e JOIN mk_sends s ON s.id = e.send_id WHERE s.campaign_id = ${c.id} AND e.type IN ('open', 'click') GROUP BY 1 ORDER BY 1 LIMIT 120`,
  ]);
  const t = c;
  return ok({
    campana: { id: c.id, name: c.name, status: c.status, subject: c.subject, from_email: c.from_email, started_at: c.started_at, finished_at: c.finished_at, pause_reason: c.pause_reason },
    totales: { destinatarios: t.total_recipients, enviados: t.total_sent, entregados: t.total_delivered, rebotes: t.total_bounced, quejas: t.total_complaints, aperturas: t.unique_opens, clics: t.unique_clicks, bajas: t.total_unsubscribes },
    tasas: {
      entrega: pct(t.total_delivered, t.total_sent), rebote: pct(t.total_bounced, t.total_sent), queja: pct(t.total_complaints, t.total_sent),
      apertura: pct(t.unique_opens, t.total_delivered), clic: pct(t.unique_clicks, t.total_delivered), baja: pct(t.total_unsubscribes, t.total_delivered),
    },
    estados: Object.fromEntries(estados.rows.map(r => [r.estado, r.n])),
    enlaces: enlaces.rows, problemas: problemas.rows, fallidos: fallidos.rows, curva: curva.rows,
  });
}

// ── Contactos ────────────────────────────────────────────────────────
async function buscarContacto(sql, q) {
  const buscado = normalizarEmail(q);
  if (buscado.length < 3) return mal(400, 'Escribe al menos 3 caracteres');
  const like = '%' + buscado.replace(/[%_\\]/g, m => '\\' + m) + '%';
  const { rows } = await sql`
    SELECT c.id, c.email::text AS email, c.first_name, c.last_name, c.company_name, c.status::text AS status, c.source, c.tags, c.consent_source, c.consent_at, c.unsubscribed_at, c.last_sent_at, c.last_open_at,
           s.reason AS supresion, s.detail AS supresion_detalle, s.created_at AS suprimido_el,
           COALESCE((SELECT array_agg(l.name ORDER BY l.name) FROM mk_list_members m JOIN mk_lists l ON l.id = m.list_id WHERE m.contact_id = c.id), '{}') AS listas
      FROM mk_contacts c LEFT JOIN mk_suppressions s ON s.email = c.email WHERE c.email::text LIKE ${like} ORDER BY c.email LIMIT 20`;
  // Un correo suprimido que ni siquiera es contacto también se informa.
  const { rows: solo } = await sql`SELECT email::text AS email, reason, detail, created_at FROM mk_suppressions WHERE email::text LIKE ${like} AND email NOT IN (SELECT email FROM mk_contacts) LIMIT 5`;
  return ok({ contactos: rows, solo_suprimidos: solo });
}

// ── Despacho ─────────────────────────────────────────────────────────
export async function despachar(recurso, { metodo = 'GET', query = {}, body = {}, sql, enviar = enviarCorreoSes, ahora = Date.now() }) {
  const lectura = metodo === 'GET';
  if (recurso === 'mk-panel') return lectura ? panel(sql) : mal(405, 'Method not allowed');
  if (recurso === 'mk-campana-reporte') return lectura ? reporte(sql, query.id) : mal(405, 'Method not allowed');
  if (recurso === 'mk-contactos') return lectura ? buscarContacto(sql, query.q) : mal(405, 'Method not allowed');
  if (recurso === 'mk-plantillas') return (lectura || metodo === 'POST') ? plantillas(sql, { metodo, query, body }) : mal(405, 'Method not allowed');
  if (metodo !== 'POST') return mal(405, 'Method not allowed');
  if (recurso === 'mk-listas') return listas(sql, body);
  if (recurso === 'mk-campanas') return body.accion === 'guardar' ? guardarCampana(sql, body) : accionCampana(sql, body, ahora);
  if (recurso === 'mk-campana-estimar') return estimar(sql, { id: body.id || query.id });
  if (recurso === 'mk-campana-probar') return probar(sql, body, enviar);
  return null;
}

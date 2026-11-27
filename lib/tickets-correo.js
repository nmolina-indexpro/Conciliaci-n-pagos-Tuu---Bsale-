// /lib/tickets-correo.js
// Correo entrante -> tickets de Soporte TI. Todo correo que llega a soporteti@indexpro.cl crea un ticket (o se suma al ticket de su conversación).
// Un Google Apps Script instalado en el buzón (ver docs/tickets-correo-soporte-ti.md y docs/apps-script-soporteti.gs) revisa los correos nuevos cada minuto y los envía acá.
// Seguridad: clave secreta TICKETS_CORREO_KEY (header x-api-key). Sin imports de red.

import crypto from 'crypto';
import { crearTicket, buscarOCrearCliente, normalizarEmail, recortarCita, asegurarTablasTickets, agregarAdjunto, registrarEvento } from './tickets.js';

export const DIRECCION_SOPORTE = 'soporteti@indexpro.cl';
const MAX_CORREOS_POR_ENVIO = 5;

export function claveValida(recibida, esperada) {
  if (!esperada || !recibida) return false;
  const a = Buffer.from(String(recibida)), b = Buffer.from(String(esperada));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// "Re: RE: Fwd: Algo [#27010]" -> "Algo [#27010]"
export function limpiarAsunto(asunto) {
  let t = String(asunto ?? '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 6; i++) { const n = t.replace(/^(?:re|rv|fw|fwd|r)\s*:\s*/i, ''); if (n === t) break; t = n; }
  return t.slice(0, 200);
}
// Un correo que cita un ticket ("[#27010]" o "#27010") se suma a ese ticket.
export function numeroDeAsunto(asunto) {
  const m = /\[#\s*(\d{4,7})\s*\]/.exec(String(asunto ?? '')) || /#\s*(\d{5,7})\b/.exec(String(asunto ?? ''));
  return m ? Number(m[1]) : null;
}
// Respuestas automáticas, rebotes y avisos del propio buzón: no crean tickets.
export function esAutomatico(m) {
  const de = String(m.de?.email || '').toLowerCase();
  if (m.auto === true) return true;
  if (de === DIRECCION_SOPORTE) return true;
  if (/^(mailer-daemon|postmaster)@/i.test(de)) return true;
  return /^(delivery status notification|undeliverable|returned mail|automatic reply|respuesta autom[aá]tica|out of office|fuera de (la )?oficina|autoreply)/i.test(String(m.asunto || '').trim());
}

async function sumarAdjuntos(sql, ticketId, m, autor) {
  let guardados = 0; const fallidos = [...(m.adjuntosOmitidos || [])];
  for (const a of m.adjuntos || []) {
    const r = await agregarAdjunto(sql, ticketId, { nombre: a.nombre, mime: a.tipo, datos: a.base64 }, autor).catch(() => ({ error: 'fallo' }));
    if (r.ok) guardados++; else fallidos.push(a.nombre);
  }
  return { guardados, fallidos };
}
const notaAdjuntos = (fallidos) => (fallidos.length ? `\n[No se pudieron guardar estos adjuntos (pesan más de 2 MB o no se pudieron leer): ${fallidos.join(', ').slice(0, 300)}]` : '');

// Un correo que Zoho ya recibió (soporteti@ se reenvía a Zoho) y que la copia ya trajo al ERP: mismo remitente, mismo asunto y creado el mismo día.
async function buscarEquivalenteZoho(sql, email, asuntoLimpio, fechaISO) {
  const { rows } = await sql.query(
    `SELECT t.id, t.numero, t.asunto FROM tickets t JOIN tk_clientes c ON c.id = t.cliente_id
     WHERE t.tipo = 'soporte_ti' AND t.zoho_ticket_id IS NOT NULL AND t.correo_hilo IS NULL AND c.email = $1 AND abs(extract(epoch FROM (t.creado_en - $2::timestamptz))) < 86400
     ORDER BY t.creado_en DESC LIMIT 20`, [email, fechaISO]);
  return rows.find((r) => limpiarAsunto(r.asunto).toLowerCase() === asuntoLimpio.toLowerCase()) || null;
}

// Procesa UN correo: lo crea como ticket nuevo o lo suma a uno existente. Devuelve { accion: creado | agregado | duplicado | ignorado | error, numero }.
export async function procesarCorreo(sql, m) {
  await asegurarTablasTickets(sql);
  const id = String(m?.id || '').slice(0, 200);
  const email = normalizarEmail(m?.de?.email);
  if (!id) return { accion: 'error', error: 'Falta el id del mensaje' };
  const { rows: previo } = await sql.query('SELECT t.numero FROM tk_correos c LEFT JOIN tickets t ON t.id = c.ticket_id WHERE c.mensaje_id = $1', [id]);
  if (previo[0]) return { accion: 'duplicado', numero: previo[0].numero ?? null };
  if (esAutomatico(m)) {
    await sql.query(`INSERT INTO tk_correos (mensaje_id, resultado) VALUES ($1, 'ignorado') ON CONFLICT DO NOTHING`, [id]);
    return { accion: 'ignorado' };
  }
  if (!email) return { accion: 'error', error: 'El correo no trae remitente válido' };

  const nombre = String(m.de?.nombre || '').replace(/["<>]/g, '').trim().slice(0, 200) || null;
  const cuerpo = recortarCita(m.texto).slice(0, 6000) || '(correo sin texto)';
  const asunto = limpiarAsunto(m.asunto) || 'Solicitud de soporte';
  const fecha = m.fecha && !Number.isNaN(new Date(m.fecha).getTime()) ? new Date(m.fecha).toISOString() : new Date().toISOString();
  const autor = { id: null, nombre: nombre || email };
  const avisoBase = { cliente: { nombre, email }, texto: cuerpo, fecha };

  // ¿Pertenece a un ticket que ya existe? Por el N° citado en el asunto o por el hilo de Gmail.
  let ticket = null;
  const num = numeroDeAsunto(m.asunto);
  if (num) { const { rows } = await sql.query(`SELECT id, numero, estado, asunto FROM tickets WHERE tipo = 'soporte_ti' AND numero = $1`, [num]); ticket = rows[0] || null; }
  if (!ticket && m.hilo) { const { rows } = await sql.query(`SELECT id, numero, estado, asunto FROM tickets WHERE tipo = 'soporte_ti' AND correo_hilo = $1 ORDER BY id DESC LIMIT 1`, [String(m.hilo)]); ticket = rows[0] || null; }

  if (ticket) {
    await sql.query(`INSERT INTO tk_eventos (ticket_id, tipo, autor_nombre, contenido, creado_en) VALUES ($1, 'contacto_cliente', $2, $3, $4::timestamptz)`,
      [ticket.id, autor.nombre, `Correo recibido de ${email}\n${cuerpo}`, fecha]);
    const adj = await sumarAdjuntos(sql, ticket.id, m, autor);
    if (adj.fallidos.length) await registrarEvento(sql, ticket.id, { tipo: 'actualizacion', autor, contenido: notaAdjuntos(adj.fallidos).trim() });
    await sql.query('UPDATE tickets SET actualizado_en = now(), ultimo_movimiento_en = now() WHERE id = $1', [ticket.id]);
    const reabierto = ticket.estado === 'cerrado';
    if (reabierto) {
      // El cliente escribió de nuevo sobre un ticket cerrado: se reabre.
      await sql.query(`UPDATE tickets SET estado = 'abierto', cerrado_en = NULL WHERE id = $1`, [ticket.id]);
      await registrarEvento(sql, ticket.id, { tipo: 'cambio_estado', autor, contenido: 'Reabierto: el cliente respondió por correo', estadoAnterior: 'cerrado', estadoNuevo: 'abierto' });
    }
    await sql.query(`INSERT INTO tk_correos (mensaje_id, ticket_id, resultado) VALUES ($1, $2, 'agregado') ON CONFLICT DO NOTHING`, [id, ticket.id]);
    return { accion: 'agregado', numero: ticket.numero, aviso: { ...avisoBase, evento: 'respuesta', ticketId: ticket.id, numero: ticket.numero, asunto: ticket.asunto, reabierto, adjuntos: adj.guardados + adj.fallidos.length } };
  }

  // ¿Ya existe el mismo correo copiado desde Zoho? Entonces es ese ticket (su texto ya está como descripción): solo se le anota el hilo, para que las respuestas se sumen a él.
  const gemelo = await buscarEquivalenteZoho(sql, email, asunto, fecha);
  if (gemelo) {
    if (m.hilo) await sql.query('UPDATE tickets SET correo_hilo = $2 WHERE id = $1', [gemelo.id, String(m.hilo)]);
    const adj = await sumarAdjuntos(sql, gemelo.id, m, autor);
    if (adj.fallidos.length) await registrarEvento(sql, gemelo.id, { tipo: 'actualizacion', autor, contenido: notaAdjuntos(adj.fallidos).trim() });
    await sql.query(`INSERT INTO tk_correos (mensaje_id, ticket_id, resultado) VALUES ($1, $2, 'enlazado') ON CONFLICT DO NOTHING`, [id, gemelo.id]);
    return { accion: 'agregado', numero: gemelo.numero, enlazado: true, aviso: { ...avisoBase, evento: 'creado', ticketId: gemelo.id, numero: gemelo.numero, asunto: gemelo.asunto, adjuntos: adj.guardados + adj.fallidos.length } };
  }

  const r = await crearTicket(sql, { tipo: 'soporte_ti', origen: 'correo', asunto, descripcion: cuerpo, creado_en: fecha, cliente: { nombre, email } }, { id: null, nombre: 'Correo entrante' });
  if (r.error) return { accion: 'error', error: r.error };
  const t = r.ticket;
  if (m.hilo) await sql.query('UPDATE tickets SET correo_hilo = $2 WHERE id = $1', [t.id, String(m.hilo)]);
  const adj = await sumarAdjuntos(sql, t.id, m, autor);
  if (adj.fallidos.length) await registrarEvento(sql, t.id, { tipo: 'actualizacion', autor, contenido: notaAdjuntos(adj.fallidos).trim() });
  await sql.query(`INSERT INTO tk_correos (mensaje_id, ticket_id, resultado) VALUES ($1, $2, 'creado') ON CONFLICT DO NOTHING`, [id, t.id]);
  return { accion: 'creado', numero: t.numero, aviso: { ...avisoBase, evento: 'creado', ticketId: t.id, numero: t.numero, asunto, adjuntos: adj.guardados + adj.fallidos.length } };
}

// Recurso público `tickets-correo` (POST, clave en x-api-key): { mensajes: [ { id, hilo, de: {nombre, email}, para, asunto, fecha, texto, auto, adjuntos: [{nombre, tipo, base64}], adjuntosOmitidos: [nombres] } ] }
export async function manejarTicketsCorreo(req, res, { getSql, notificar = null }) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const esperada = process.env.TICKETS_CORREO_KEY;
  if (!esperada) return res.status(200).json({ error: 'TICKETS_CORREO_KEY no está configurada en Vercel' });
  if (!claveValida(req.headers['x-api-key'], esperada)) return res.status(401).json({ error: 'Clave inválida' });
  const b = req.body || {};
  const lista = (Array.isArray(b.mensajes) ? b.mensajes : b.id ? [b] : []).slice(0, MAX_CORREOS_POR_ENVIO);
  if (!lista.length) return res.status(400).json({ error: 'No vino ningún mensaje' });
  try {
    const sql = await getSql();
    const resultados = [];
    for (const m of lista) {
      try {
        const { aviso, ...r } = await procesarCorreo(sql, m);
        resultados.push({ id: m.id, ...r });
        // Aviso al equipo (en español, desde el ERP). Nunca hace fallar la recepción del correo.
        if (aviso && notificar) { try { await notificar(sql, aviso); } catch (e) { console.warn('[tickets-correo] aviso:', e.message); } }
      }
      catch (e) { resultados.push({ id: m?.id, accion: 'error', error: String(e.message || e).slice(0, 150) }); }
    }
    return res.status(200).json({ ok: true, resultados });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo procesar el correo', detail: String(err.message || err).slice(0, 200) });
  }
}

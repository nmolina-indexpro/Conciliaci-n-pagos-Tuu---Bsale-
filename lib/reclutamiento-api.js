// /lib/reclutamiento-api.js
// Reclutamiento: postulantes de Indeed + agenda de entrevistas por videollamada (ERP > Servicio Técnico > Electrónica > Postulantes).
// Los dos manejadores se montan en api/negocio.js (NO es una función serverless nueva: el plan está al tope de funciones):
//   · agendaPublica   -> ?recurso=agenda-publica  (SIN sesión: el postulante con su token; solo ve su nombre de pila y los espacios libres y puede elegir, cambiar o cancelar SU horario)
//   · reclutamiento   -> ?recurso=reclutamiento   (sesión de ADMINISTRADOR: datos personales de los postulantes, calendario y bloqueos)
// Reciben sus dependencias (`deps`) para poder probarlos contra Postgres real en memoria (tests/reclutamiento/api.test.js).
// Lógica pura: lib/reclutamiento.js · correos: lib/reclutamiento-correo.js · tablas: lib/db.js (asegurarTablaReclutamiento).
import { asegurarTablaReclutamiento } from './db.js';
import { ESTADOS_POSTULANTE, configInicial, normalizarConfig, generarEspacios, normalizarPostulante, nuevoToken, primerNombre, urlAgenda, fechaChile, normalizarTelefono } from './reclutamiento.js';
import { armarCorreoConfirmacion, armarCorreoAvisoReserva, armarCorreoEnlaceVideo } from './reclutamiento-correo.js';

const EMAIL_OK = e => /^[^@\s]{1,80}@[^@\s]{1,100}\.[^@\s]{2,}$/.test(e);

async function cargarConfig(sql) {
  const { rows } = await sql`SELECT config FROM reclutamiento_config WHERE id = 1;`;
  if (rows[0]) { const v = normalizarConfig(rows[0].config); if (v.ok) return v.config; }
  const inicial = configInicial(fechaChile(new Date()));
  await sql`INSERT INTO reclutamiento_config (id, config, actualizado_por) VALUES (1, ${JSON.stringify(inicial)}::jsonb, 'sistema') ON CONFLICT (id) DO NOTHING;`;
  return inicial;
}
async function espaciosDe(sql, config, ahora) {
  const { rows: oc } = await sql`SELECT r.inicio, p.nombre FROM reclutamiento_reservas r JOIN reclutamiento_postulantes p ON p.id = r.postulante_id WHERE r.estado = 'confirmada' AND r.inicio > now() - interval '2 days';`;
  const { rows: bl } = await sql`SELECT inicio FROM reclutamiento_bloqueos WHERE inicio > now() - interval '2 days';`;
  const { rows: hb } = await sql`SELECT inicio FROM reclutamiento_habilitados WHERE inicio > now() - interval '2 days';`;
  const quien = new Map(oc.map(r => [new Date(r.inicio).toISOString(), r.nombre]));
  const espacios = generarEspacios(config, ahora, { ocupados: new Set(quien.keys()), bloqueados: new Set(bl.map(r => new Date(r.inicio).toISOString())), habilitados: new Set(hb.map(r => new Date(r.inicio).toISOString())) });
  return { espacios, quien };
}
// Aviso al equipo (Usuarios > Notificaciones, tipo 'entrevistas-reserva'). Nunca hace fallar la operación principal.
async function avisarEquipo(sql, deps, datos) {
  try {
    await deps.asegurarTablaNotificaciones(sql);
    if (!(await deps.notificacionDebeEnviarse(sql, 'entrevistas-reserva'))) return { enviado: false };
    const destinatarios = await deps.obtenerSuscriptoresEmail(sql, 'entrevistas-reserva');
    if (!destinatarios.length) return { enviado: false };
    const { asunto, html } = armarCorreoAvisoReserva({ ...datos, urlErp: deps.urlBase });
    for (const para of destinatarios) await deps.enviarCorreo({ para, asunto, html });
    await deps.marcarNotificacionEnviada(sql, 'entrevistas-reserva', { asunto, html });
    return { enviado: true };
  } catch (e) { return { enviado: false, motivo: String(e.message || e) }; }
}

export async function agendaPublica(req, res, deps) {
  try {
    const sql = await deps.getSql();
    await asegurarTablaReclutamiento(sql);
    const b = req.body || {};
    const token = String((req.method === 'GET' ? req.query.t : b.t) || '').trim();
    if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return res.status(404).json({ error: 'Este enlace no es válido' });
    const { rows: ps } = await sql`SELECT id, nombre, email, telefono, cargo FROM reclutamiento_postulantes WHERE token = ${token};`;
    const p = ps[0];
    if (!p) return res.status(404).json({ error: 'Este enlace no es válido o ya no está disponible' });
    const config = await cargarConfig(sql), ahora = deps.ahora ? deps.ahora() : new Date();
    const { rows: rv } = await sql`SELECT id, inicio, fin, enlace_video FROM reclutamiento_reservas WHERE postulante_id = ${p.id} AND estado = 'confirmada';`;
    const reserva = rv[0] ? { id: rv[0].id, inicio: new Date(rv[0].inicio).toISOString(), fin: new Date(rv[0].fin).toISOString(), enlace_video: rv[0].enlace_video || config.enlace_video || null } : null;
    const puedeCambiar = !!reserva && new Date(reserva.inicio).getTime() >= ahora.getTime() + config.anticipacion_horas * 3600000;
    const { espacios } = await espaciosDe(sql, config, ahora);

    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true, nombre: primerNombre(p.nombre), cargo: p.cargo, activa: config.activa, aviso: config.aviso, duracion_min: config.duracion_min, anticipacion_horas: config.anticipacion_horas,
        tieneCorreo: !!p.email, espacios: espacios.filter(e => e.estado === 'libre').map(({ inicio, fin, fecha, hora }) => ({ inicio, fin, fecha, hora })),
        reserva: reserva ? { ...reserva, puedeCambiar } : null,
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (b.accion === 'cancelar') {
      if (!reserva) return res.status(409).json({ error: 'No tienes una entrevista agendada' });
      if (!puedeCambiar) return res.status(409).json({ error: `Con menos de ${config.anticipacion_horas} horas de anticipación ya no se puede cambiar desde aquí: escríbenos por Indeed.` });
      await sql`UPDATE reclutamiento_reservas SET estado = 'cancelada', cancelado_en = now(), cancelado_por = 'postulante' WHERE id = ${reserva.id};`;
      await sql`UPDATE reclutamiento_postulantes SET estado = 'invitado', actualizado_en = now() WHERE id = ${p.id} AND estado = 'agendado';`;
      await avisarEquipo(sql, deps, { postulante: p, inicio: null, inicioAnterior: reserva.inicio, tipo: 'cancelacion' });
      return res.status(200).json({ ok: true, cancelada: true });
    }

    if (b.accion !== 'reservar') return res.status(400).json({ error: 'Acción inválida' });
    if (!config.activa) return res.status(409).json({ error: 'La agenda no está disponible por ahora. Intenta más tarde.' });
    const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
    if (email && !EMAIL_OK(email)) return res.status(400).json({ error: 'El correo no es válido' });
    if (!email && !p.email) return res.status(400).json({ error: 'Escribe tu correo para enviarte la confirmación y el enlace de la videollamada' });
    const slot = espacios.find(e => e.estado === 'libre' && e.inicio === String(b.inicio || ''));
    if (!slot) return res.status(409).json({ error: 'Ese horario ya no está disponible. Elige otro.' });
    if (reserva && !puedeCambiar) return res.status(409).json({ error: `Con menos de ${config.anticipacion_horas} horas de anticipación ya no se puede cambiar desde aquí: escríbenos por Indeed.` });

    // Cambio de horario: se libera la reserva anterior y se crea la nueva; si la nueva falla (otra persona ganó el espacio), se restaura la anterior.
    if (reserva) await sql`UPDATE reclutamiento_reservas SET estado = 'cancelada', cancelado_en = now(), cancelado_por = 'postulante (cambio)' WHERE id = ${reserva.id};`;
    try {
      await sql`INSERT INTO reclutamiento_reservas (postulante_id, inicio, fin) VALUES (${p.id}, ${slot.inicio}, ${slot.fin});`;
    } catch (e) {
      if (reserva) { try { await sql`UPDATE reclutamiento_reservas SET estado = 'confirmada', cancelado_en = NULL, cancelado_por = NULL WHERE id = ${reserva.id};`; } catch { /* ya lo tomó otra persona */ } }
      if (/duplicate key|unique/i.test(String(e.message || e))) return res.status(409).json({ error: 'Ese horario acaba de ser tomado por otra persona. Elige otro.' });
      throw e;
    }
    const emailFinal = email || p.email, telefono = b.telefono ? normalizarTelefono(b.telefono) : p.telefono;
    await sql`UPDATE reclutamiento_postulantes SET estado = 'agendado', email = ${emailFinal}, telefono = ${telefono}, actualizado_en = now() WHERE id = ${p.id};`;
    const postulante = { ...p, email: emailFinal, telefono };
    let correo = { enviado: false };
    try {
      const c = armarCorreoConfirmacion({ postulante, inicio: slot.inicio, fin: slot.fin, enlaceVideo: config.enlace_video, urlAgenda: urlAgenda(deps.urlBase, token), aviso: config.aviso });
      correo = await deps.enviarCorreo({ para: emailFinal, asunto: c.asunto, html: c.html });
    } catch (e) { correo = { enviado: false, motivo: String(e.message || e) }; }
    await avisarEquipo(sql, deps, { postulante, inicio: slot.inicio, inicioAnterior: reserva ? reserva.inicio : null, tipo: reserva ? 'cambio' : 'reserva', sinEnlace: !config.enlace_video });
    return res.status(200).json({ ok: true, reserva: { inicio: slot.inicio, fin: slot.fin, enlace_video: config.enlace_video || null, puedeCambiar: true }, correoEnviado: correo.enviado !== false });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo completar la operación. Intenta de nuevo en unos minutos.', detail: String(err.message || err) });
  }
}

export async function reclutamiento(req, res, sesion, deps) {
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede ver a los postulantes' });
  try {
    const sql = await deps.getSql();
    await asegurarTablaReclutamiento(sql);
    const autor = sesion.nombre || sesion.email || null;
    if (req.method === 'GET') {
      const config = await cargarConfig(sql), ahora = deps.ahora ? deps.ahora() : new Date();
      const { rows } = await sql`SELECT p.id, p.token, p.nombre, p.email, p.telefono, p.ubicacion, p.cargo, p.origen, p.url_perfil, p.fecha_postulacion, p.estado_indeed, p.respuestas, p.resumen, p.notas, p.estado,
          r.inicio AS reserva_inicio, r.fin AS reserva_fin, r.enlace_video AS reserva_enlace
        FROM reclutamiento_postulantes p LEFT JOIN reclutamiento_reservas r ON r.postulante_id = p.id AND r.estado = 'confirmada'
        ORDER BY p.fecha_postulacion DESC NULLS LAST, p.id;`;
      const { espacios, quien } = await espaciosDe(sql, config, ahora);
      return res.status(200).json({
        ok: true, config, urlBase: deps.urlBase,
        postulantes: rows.map(r => ({ ...r, fecha_postulacion: r.fecha_postulacion ? fechaChile(new Date(r.fecha_postulacion).getTime() + 12 * 3600000) : null, reserva_inicio: r.reserva_inicio ? new Date(r.reserva_inicio).toISOString() : null, reserva_fin: r.reserva_fin ? new Date(r.reserva_fin).toISOString() : null, enlace: urlAgenda(deps.urlBase, r.token) })),
        espacios: espacios.map(e => ({ ...e, postulante: quien.get(e.inicio) || null })),
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};

    if (b.accion === 'importar' || b.accion === 'crear') {
      const lista = b.accion === 'crear' ? [b.postulante] : (Array.isArray(b.postulantes) ? b.postulantes : []);
      if (!lista.length) return res.status(400).json({ error: 'No hay postulantes para importar' });
      if (lista.length > 300) return res.status(400).json({ error: 'Se pueden importar hasta 300 postulantes por vez' });
      let importados = 0, actualizados = 0; const errores = [];
      for (const bruto of lista) {
        const v = normalizarPostulante(bruto);
        if (!v.ok) { errores.push(v.error); continue; }
        const p = v.postulante;
        const { rows: ex } = await sql`SELECT id FROM reclutamiento_postulantes WHERE (${p.indeed_id}::text IS NOT NULL AND indeed_id = ${p.indeed_id}) OR (${p.email}::text IS NOT NULL AND lower(email) = ${p.email}) LIMIT 1;`;
        if (ex[0]) {
          await sql`UPDATE reclutamiento_postulantes SET nombre = ${p.nombre}, email = COALESCE(${p.email}, email), telefono = COALESCE(${p.telefono}, telefono), ubicacion = COALESCE(${p.ubicacion}, ubicacion), cargo = ${p.cargo},
            url_perfil = COALESCE(${p.url_perfil}, url_perfil), fecha_postulacion = COALESCE(${p.fecha_postulacion}::date, fecha_postulacion), estado_indeed = COALESCE(${p.estado_indeed}, estado_indeed),
            respuestas = ${JSON.stringify(p.respuestas)}::jsonb, resumen = COALESCE(${p.resumen}, resumen), notas = COALESCE(${p.notas}, notas), actualizado_en = now() WHERE id = ${ex[0].id};`;
          actualizados++;
        } else {
          await sql`INSERT INTO reclutamiento_postulantes (token, nombre, email, telefono, ubicacion, cargo, origen, indeed_id, url_perfil, fecha_postulacion, estado_indeed, respuestas, resumen, notas)
            VALUES (${nuevoToken()}, ${p.nombre}, ${p.email}, ${p.telefono}, ${p.ubicacion}, ${p.cargo}, ${p.origen}, ${p.indeed_id}, ${p.url_perfil}, ${p.fecha_postulacion}::date, ${p.estado_indeed}, ${JSON.stringify(p.respuestas)}::jsonb, ${p.resumen}, ${p.notas});`;
          importados++;
        }
      }
      return res.status(200).json({ ok: true, importados, actualizados, errores });
    }

    if (b.accion === 'actualizar') {
      const id = Number(b.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Postulante inválido' });
      const { rows: ex } = await sql`SELECT id, estado, email, telefono, notas, nombre FROM reclutamiento_postulantes WHERE id = ${id};`;
      if (!ex[0]) return res.status(404).json({ error: 'No existe ese postulante' });
      const estado = 'estado' in b ? String(b.estado) : ex[0].estado;
      if (!ESTADOS_POSTULANTE.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
      const email = 'email' in b ? String(b.email || '').trim().toLowerCase() : ex[0].email;
      if (email && !EMAIL_OK(email)) return res.status(400).json({ error: 'El correo no es válido' });
      const telefono = 'telefono' in b ? (b.telefono ? normalizarTelefono(b.telefono) : null) : ex[0].telefono;
      const notas = 'notas' in b ? (String(b.notas || '').trim().slice(0, 1000) || null) : ex[0].notas;
      await sql`UPDATE reclutamiento_postulantes SET estado = ${estado}, email = ${email || null}, telefono = ${telefono}, notas = ${notas}, actualizado_en = now() WHERE id = ${id};`;
      return res.status(200).json({ ok: true });
    }
    if (b.accion === 'regenerar_token') {
      const id = Number(b.id); if (!Number.isInteger(id)) return res.status(400).json({ error: 'Postulante inválido' });
      const token = nuevoToken();
      await sql`UPDATE reclutamiento_postulantes SET token = ${token}, actualizado_en = now() WHERE id = ${id};`;
      return res.status(200).json({ ok: true, enlace: urlAgenda(deps.urlBase, token) });
    }
    if (b.accion === 'eliminar') {
      const id = Number(b.id); if (!Number.isInteger(id)) return res.status(400).json({ error: 'Postulante inválido' });
      await sql`DELETE FROM reclutamiento_postulantes WHERE id = ${id};`;
      return res.status(200).json({ ok: true });
    }
    if (b.accion === 'cancelar_reserva') {
      const id = Number(b.id); if (!Number.isInteger(id)) return res.status(400).json({ error: 'Postulante inválido' });
      await sql`UPDATE reclutamiento_reservas SET estado = 'cancelada', cancelado_en = now(), cancelado_por = ${autor} WHERE postulante_id = ${id} AND estado = 'confirmada';`;
      await sql`UPDATE reclutamiento_postulantes SET estado = 'invitado', actualizado_en = now() WHERE id = ${id} AND estado = 'agendado';`;
      return res.status(200).json({ ok: true });
    }
    if (b.accion === 'enlace_reserva') {
      const id = Number(b.id); if (!Number.isInteger(id)) return res.status(400).json({ error: 'Postulante inválido' });
      const enlace = String(b.enlace || '').trim();
      if (enlace && !/^https?:\/\/\S{4,290}$/i.test(enlace)) return res.status(400).json({ error: 'El enlace debe empezar con http:// o https://' });
      const { rows: rs } = await sql`SELECT r.id, r.inicio, r.fin, p.nombre, p.email, p.cargo, p.token FROM reclutamiento_reservas r JOIN reclutamiento_postulantes p ON p.id = r.postulante_id WHERE r.postulante_id = ${id} AND r.estado = 'confirmada';`;
      if (!rs[0]) return res.status(409).json({ error: 'Esta persona no tiene una entrevista agendada' });
      await sql`UPDATE reclutamiento_reservas SET enlace_video = ${enlace || null} WHERE id = ${rs[0].id};`;
      let avisado = false;
      if (b.avisar) {
        if (!enlace) return res.status(400).json({ error: 'Escribe el enlace antes de avisarle al postulante' });
        if (!rs[0].email) return res.status(409).json({ error: 'Esta persona no tiene correo: pega el enlace en un mensaje de Indeed' });
        const c = armarCorreoEnlaceVideo({ postulante: rs[0], inicio: new Date(rs[0].inicio).toISOString(), fin: new Date(rs[0].fin).toISOString(), enlaceVideo: enlace, urlAgenda: urlAgenda(deps.urlBase, rs[0].token) });
        const r = await deps.enviarCorreo({ para: rs[0].email, asunto: c.asunto, html: c.html });
        avisado = r.enviado !== false;
        if (!avisado) return res.status(200).json({ ok: true, avisado: false, aviso: 'Se guardó el enlace, pero no se pudo enviar el correo' });
      }
      return res.status(200).json({ ok: true, avisado });
    }
    if (b.accion === 'config') {
      const v = normalizarConfig(b.config);
      if (!v.ok) return res.status(400).json({ error: v.error });
      await sql`INSERT INTO reclutamiento_config (id, config, actualizado_por, actualizado_en) VALUES (1, ${JSON.stringify(v.config)}::jsonb, ${autor}, now())
        ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now();`;
      return res.status(200).json({ ok: true, config: v.config });
    }
    // Ofrecer un espacio que está dentro del plazo de anticipación («pronto»), o quitarle esa excepción.
    if (b.accion === 'habilitar' || b.accion === 'deshabilitar') {
      const config = await cargarConfig(sql);
      const { espacios } = await espaciosDe(sql, config, deps.ahora ? deps.ahora() : new Date());
      const e = espacios.find(x => x.inicio === String(b.inicio || ''));
      if (!e) return res.status(400).json({ error: 'Ese espacio no existe en el calendario' });
      if (b.accion === 'habilitar') await sql`INSERT INTO reclutamiento_habilitados (inicio, creado_por) VALUES (${e.inicio}, ${autor}) ON CONFLICT DO NOTHING;`;
      else await sql`DELETE FROM reclutamiento_habilitados WHERE inicio = ${e.inicio};`;
      return res.status(200).json({ ok: true });
    }
    // Ofrecer un día solo desde cierta hora: los espacios desde esa hora quedan abiertos (aunque estén dentro del plazo de anticipación) y los anteriores se bloquean.
    // hora '00:00' = todo el día. No toca los espacios que ya tienen una entrevista.
    if (b.accion === 'dia_desde') {
      const fecha = String(b.fecha || ''), hora = String(b.hora || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return res.status(400).json({ error: 'Fecha u hora inválida' });
      const config = await cargarConfig(sql);
      const { espacios } = await espaciosDe(sql, config, deps.ahora ? deps.ahora() : new Date());
      const delDia = espacios.filter(x => x.fecha === fecha);
      if (!delDia.length) return res.status(400).json({ error: 'Ese día no está en el calendario' });
      for (const e of delDia) {
        if (e.estado === 'ocupado') continue;
        if (e.hora < hora) {
          await sql`INSERT INTO reclutamiento_bloqueos (inicio, creado_por) VALUES (${e.inicio}, ${autor}) ON CONFLICT DO NOTHING;`;
          await sql`DELETE FROM reclutamiento_habilitados WHERE inicio = ${e.inicio};`;
        } else {
          await sql`DELETE FROM reclutamiento_bloqueos WHERE inicio = ${e.inicio};`;
          await sql`INSERT INTO reclutamiento_habilitados (inicio, creado_por) VALUES (${e.inicio}, ${autor}) ON CONFLICT DO NOTHING;`;
        }
      }
      return res.status(200).json({ ok: true });
    }
    if (b.accion === 'bloquear' || b.accion === 'desbloquear') {
      const config = await cargarConfig(sql);
      const { espacios } = await espaciosDe(sql, config, deps.ahora ? deps.ahora() : new Date());
      const e = espacios.find(x => x.inicio === String(b.inicio || ''));
      if (!e) return res.status(400).json({ error: 'Ese espacio no existe en el calendario' });
      if (b.accion === 'bloquear') {
        if (e.estado === 'ocupado') return res.status(409).json({ error: 'Ese espacio tiene una entrevista agendada: cancela primero la reserva' });
        await sql`INSERT INTO reclutamiento_bloqueos (inicio, creado_por) VALUES (${e.inicio}, ${autor}) ON CONFLICT DO NOTHING;`;
      } else await sql`DELETE FROM reclutamiento_bloqueos WHERE inicio = ${e.inicio};`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Acción inválida' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en Reclutamiento', detail: String(err.message || err) });
  }
}

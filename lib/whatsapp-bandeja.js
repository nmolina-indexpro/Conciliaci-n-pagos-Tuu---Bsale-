// /lib/whatsapp-bandeja.js
// Bandeja de WhatsApp estilo WhatsApp Business: chats archivados, etiquetas con color, contador de mensajes sin leer e indicador del bot.
// Las consultas SQL que usa la lista viven acá (y no sueltas en api/negocio.js) para poder probarlas contra Postgres real en las pruebas.

import { unaVez } from './una-vez.js';

const COLOR_SIN_DEFINIR = '#8696A0';

// Etiquetas iniciales (las del WhatsApp Business del equipo). Se siembran una sola vez; después se administran en Configuración.
export const ETIQUETAS_INICIALES = [
  { nombre: 'POST-VENTA', color: '#1E63C9' },
  { nombre: 'SERVICIO TÉCNICO', color: '#E5163F' },
  { nombre: 'VENTA CONCRETADA', color: '#BCD7FA' },
  { nombre: 'NO TRABAJAMOS PRODUCTO', color: '#3FC1B0' },
  { nombre: 'Carrito abandonado', color: '#6B6B6B' },
  { nombre: 'SIN STOCK', color: '#3FC1B0' },
  { nombre: 'Perdida o sin respuesta', color: '#3FC1B0' },
  { nombre: 'PRODUCTO A PEDIDO', color: '#F8A8C8' },
  { nombre: 'Recontacto x Llamada', color: '#F2386F' },
];

// Paleta que ofrece el selector de color (parecida a la de WhatsApp Business)
export const COLORES_ETIQUETA = [
  '#1E63C9', '#BCD7FA', '#2D9CDB', '#00BCD4', '#3FC1B0', '#00A884', '#25D366', '#8BC34A', '#F7C948', '#F5A623',
  '#FF7A59', '#E5163F', '#F2386F', '#F8A8C8', '#9B59B6', '#B08968', '#795548', '#6B6B6B', '#8696A0', '#111B21',
];

export const NOMBRE_ETIQUETA_MAX = 40;
export const normalizarColor = c => (/^#[0-9a-fA-F]{6}$/.test(String(c || '').trim()) ? String(c).trim().toUpperCase() : COLOR_SIN_DEFINIR);

// ---------------- Fragmentos SQL (alias de la tabla de conversaciones: por defecto "c") ----------------

// Archivada "de verdad": se archivó y desde entonces no hubo ningún mensaje (del cliente o nuestro). Si llega o se envía un mensaje, la conversación
// vuelve sola a la bandeja, como en WhatsApp -- sin tocar el código que recibe los mensajes.
export const sqlArchivada = (a = 'c') => `(${a}.archivada_en IS NOT NULL AND COALESCE((SELECT MAX(m.marca_tiempo) FROM whatsapp_mensajes m WHERE m.conversacion_id = ${a}.id), ${a}.iniciada_en) <= ${a}.archivada_en)`;

// Mensajes del cliente sin leer: llegaron después de la última vez que se abrió la conversación y después de nuestra última respuesta
// (una respuesta nuestra, incluso desde el celular, da por atendido lo anterior). Las respuestas del bot automático NO cuentan: lo que atendió solo el bot
// sigue «sin leer» hasta que una persona abre la conversación o responde, así el equipo ve por la mañana qué quedó pendiente.
export const sqlNoLeidos = (a = 'c') => `(SELECT COUNT(*)::int FROM whatsapp_mensajes m WHERE m.conversacion_id = ${a}.id AND m.direccion = 'in'
  AND m.marca_tiempo > GREATEST(COALESCE(${a}.leida_hasta, '-infinity'::timestamptz),
    COALESCE((SELECT MAX(o.marca_tiempo) FROM whatsapp_mensajes o WHERE o.conversacion_id = ${a}.id AND o.direccion = 'out' AND COALESCE(o.origen, '') <> 'bot'), '-infinity'::timestamptz)))`;

// Participación del bot: 'en_curso' = tiene un borrador pendiente de revisión (preparado después de nuestro último mensaje);
// 'respondida' = se envió una respuesta que salió del bot (tal cual o editada) o un mensaje marcado con origen 'bot' (envío automático, cuando exista).
export const sqlBotEstado = (a = 'c') => `(CASE
  WHEN EXISTS (SELECT 1 FROM whatsapp_bot_borradores b WHERE b.conversacion_id = ${a}.id AND b.estado IN ('pendiente', 'insertado')
    AND b.creado_en > COALESCE((SELECT MAX(o.marca_tiempo) FROM whatsapp_mensajes o WHERE o.conversacion_id = ${a}.id AND o.direccion = 'out'), '-infinity'::timestamptz)) THEN 'en_curso'
  WHEN EXISTS (SELECT 1 FROM whatsapp_bot_borradores b WHERE b.conversacion_id = ${a}.id AND b.estado IN ('enviado_igual', 'enviado_editado'))
    OR EXISTS (SELECT 1 FROM whatsapp_mensajes m WHERE m.conversacion_id = ${a}.id AND m.origen = 'bot') THEN 'respondida'
  END)`;

export const sqlEtiquetasJson = (a = 'c') => `COALESCE((SELECT json_agg(json_build_object('id', e.id, 'nombre', e.nombre, 'color', COALESCE(e.color, '${COLOR_SIN_DEFINIR}')) ORDER BY e.orden, e.nombre)
  FROM whatsapp_conversacion_etiquetas ce JOIN whatsapp_etiquetas e ON e.id = ce.etiqueta_id WHERE ce.conversacion_id = ${a}.id), '[]'::json)`;

// ---------------- Migración ----------------
// Requiere que ya exista lo de asegurarTablaWhatsapp (conversaciones y etiquetas).
export function asegurarBandejaWhatsapp(sql) {
  return unaVez('asegurarBandejaWhatsapp', () => _asegurar(sql));
}
async function _asegurar(sql) {
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS archivada_en TIMESTAMPTZ;`;
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS no_leida_manual BOOLEAN NOT NULL DEFAULT false;`;
  const { rows: tieneColor } = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_etiquetas' AND column_name = 'color';`;
  await sql`ALTER TABLE whatsapp_etiquetas ADD COLUMN IF NOT EXISTS color TEXT;`;
  await sql`ALTER TABLE whatsapp_etiquetas ADD COLUMN IF NOT EXISTS orden INTEGER NOT NULL DEFAULT 0;`;
  if (!tieneColor.length) {
    // Primera vez: se siembran las etiquetas del equipo (si alguna ya existía con ese nombre, solo se le pone color y orden). Después no se vuelven a crear.
    for (const [i, e] of ETIQUETAS_INICIALES.entries()) {
      await sql`INSERT INTO whatsapp_etiquetas (nombre, color, orden) VALUES (${e.nombre}, ${e.color}, ${i + 1})
        ON CONFLICT (nombre) DO UPDATE SET color = COALESCE(whatsapp_etiquetas.color, EXCLUDED.color), orden = EXCLUDED.orden;`;
    }
  }
}

// ---------------- Etiquetas: administración ----------------
const aEtiqueta = r => ({ id: r.id, nombre: r.nombre, color: r.color || COLOR_SIN_DEFINIR, orden: r.orden, total: r.total ?? 0 });

export async function listarEtiquetas(sql) {
  const { rows } = await sql`
    SELECT e.id, e.nombre, e.color, e.orden, (SELECT COUNT(*)::int FROM whatsapp_conversacion_etiquetas ce WHERE ce.etiqueta_id = e.id) AS total
    FROM whatsapp_etiquetas e ORDER BY e.orden ASC, e.nombre ASC;`;
  return rows.map(aEtiqueta);
}

function validarEtiqueta(entrada) {
  const nombre = String(entrada?.nombre ?? '').replace(/\s+/g, ' ').trim();
  if (!nombre) throw new Error('El nombre de la etiqueta es obligatorio.');
  if (nombre.length > NOMBRE_ETIQUETA_MAX) throw new Error(`El nombre es demasiado largo (máximo ${NOMBRE_ETIQUETA_MAX} caracteres).`);
  return { nombre, color: normalizarColor(entrada?.color) };
}
const esDuplicado = err => String(err?.code || '') === '23505' || /duplicate key|unique/i.test(String(err?.message || err));

export async function crearEtiqueta(sql, entrada) {
  let v; try { v = validarEtiqueta(entrada); } catch (e) { return { ok: false, estado: 400, error: e.message }; }
  const { rows: igual } = await sql`SELECT 1 FROM whatsapp_etiquetas WHERE lower(nombre) = lower(${v.nombre});`;
  if (igual.length) return { ok: false, estado: 409, error: `Ya existe la etiqueta «${v.nombre}».` };
  try {
    const { rows } = await sql`INSERT INTO whatsapp_etiquetas (nombre, color, orden) VALUES (${v.nombre}, ${v.color}, COALESCE((SELECT MAX(orden) FROM whatsapp_etiquetas), 0) + 1) RETURNING id, nombre, color, orden;`;
    return { ok: true, etiqueta: aEtiqueta(rows[0]) };
  } catch (err) {
    if (esDuplicado(err)) return { ok: false, estado: 409, error: `Ya existe la etiqueta «${v.nombre}».` };
    throw err;
  }
}

export async function actualizarEtiqueta(sql, id, entrada) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, estado: 400, error: 'Falta el id de la etiqueta.' };
  let v; try { v = validarEtiqueta(entrada); } catch (e) { return { ok: false, estado: 400, error: e.message }; }
  const { rows: igual } = await sql`SELECT 1 FROM whatsapp_etiquetas WHERE lower(nombre) = lower(${v.nombre}) AND id <> ${n};`;
  if (igual.length) return { ok: false, estado: 409, error: `Ya existe la etiqueta «${v.nombre}».` };
  try {
    const { rows } = await sql`UPDATE whatsapp_etiquetas SET nombre = ${v.nombre}, color = ${v.color} WHERE id = ${n} RETURNING id, nombre, color, orden;`;
    if (!rows.length) return { ok: false, estado: 404, error: 'La etiqueta ya no existe.' };
    return { ok: true, etiqueta: aEtiqueta(rows[0]) };
  } catch (err) {
    if (esDuplicado(err)) return { ok: false, estado: 409, error: `Ya existe la etiqueta «${v.nombre}».` };
    throw err;
  }
}

export async function eliminarEtiqueta(sql, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, estado: 400, error: 'Falta el id de la etiqueta.' };
  const { rows } = await sql`DELETE FROM whatsapp_etiquetas WHERE id = ${n} RETURNING id;`; // las asignaciones se borran en cascada
  if (!rows.length) return { ok: false, estado: 404, error: 'La etiqueta ya no existe.' };
  return { ok: true };
}

// Asigna o quita una etiqueta de una conversación; devuelve las etiquetas que quedan en ella.
export async function asignarEtiqueta(sql, conversacionId, etiquetaId, asignar, usuario) {
  const cid = Number(conversacionId), eid = Number(etiquetaId);
  if (!Number.isInteger(cid) || cid <= 0 || !Number.isInteger(eid) || eid <= 0) return { ok: false, estado: 400, error: 'Falta la conversación o la etiqueta.' };
  const { rows: e } = await sql`SELECT nombre FROM whatsapp_etiquetas WHERE id = ${eid};`;
  if (!e.length) return { ok: false, estado: 404, error: 'La etiqueta ya no existe.' };
  const { rows: c } = await sql`SELECT id FROM whatsapp_conversaciones WHERE id = ${cid};`;
  if (!c.length) return { ok: false, estado: 404, error: 'Conversación no encontrada.' };
  if (asignar) await sql`INSERT INTO whatsapp_conversacion_etiquetas (conversacion_id, etiqueta_id) VALUES (${cid}, ${eid}) ON CONFLICT DO NOTHING;`;
  else await sql`DELETE FROM whatsapp_conversacion_etiquetas WHERE conversacion_id = ${cid} AND etiqueta_id = ${eid};`;
  await sql`UPDATE whatsapp_conversaciones SET updated_at = now() WHERE id = ${cid};`; // cambia la "huella" de novedades: los demás ven la etiqueta enseguida
  await sql`INSERT INTO whatsapp_auditoria (conversacion_id, usuario_email, accion, detalle) VALUES (${cid}, ${usuario || null}, 'etiquetas', ${(asignar ? 'etiqueta agregada: ' : 'etiqueta quitada: ') + e[0].nombre});`;
  const { rows } = await sql.query(`SELECT ${sqlEtiquetasJson('c')} AS etiquetas FROM whatsapp_conversaciones c WHERE c.id = $1`, [cid]);
  return { ok: true, etiquetas: rows[0].etiquetas };
}

// ---------------- Acciones sobre una conversación ----------------
// Da por leída la conversación. Se guarda GREATEST(ahora, último mensaje) para que un mensaje con hora algo adelantada (reloj de Meta) no quede como no leído.
export async function marcarLeida(sql, id) {
  const { rows } = await sql`
    UPDATE whatsapp_conversaciones
    SET leida_hasta = GREATEST(now(), COALESCE((SELECT MAX(m.marca_tiempo) FROM whatsapp_mensajes m WHERE m.conversacion_id = whatsapp_conversaciones.id), now())),
        no_leida_manual = false
    WHERE id = ${id}
    RETURNING leida_hasta;`;
  return rows[0] ? { ok: true, leidaHasta: new Date(rows[0].leida_hasta).toISOString() } : { ok: false, estado: 404, error: 'Conversación no encontrada' };
}

// ---------------- Sincronizar la lectura con WhatsApp ----------------
// Cuando alguien lee una conversación en el ERP, se le avisa a WhatsApp (API oficial de Meta: status "read" con el id del último mensaje del cliente;
// Meta marca también los anteriores). Así el chat queda leído también del lado de WhatsApp (el cliente ve los ticks azules).
// Al revés NO se puede: cuando alguien lee un chat en la app de WhatsApp Business, Meta no envía ningún aviso al ERP (no existe ese evento).
// Lo que sí llega desde la app son los mensajes que se responden desde ahí; esos dan por atendidos los anteriores (ver sqlNoLeidos).
export async function marcarLeidaEnWhatsapp({ accessToken, phoneNumberId, messageId, fetchFn = fetch, timeoutMs = 6000 }) {
  if (!accessToken || !phoneNumberId) return { ok: false, motivo: 'sin_credenciales' };
  if (!messageId) return { ok: false, motivo: 'sin_mensaje' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchFn(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
      signal: ctrl.signal,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) return { ok: false, motivo: 'rechazado', detalle: d.error?.message || `HTTP ${r.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: 'error_red', detalle: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

// Cuántos mensajes sin leer tiene la conversación y el id (wamid) del último mensaje del cliente
export async function leerPendienteDeLectura(sql, id) {
  const { rows } = await sql.query(`
    SELECT ${sqlNoLeidos('c')} AS no_leidos,
           (SELECT m.whatsapp_message_id FROM whatsapp_mensajes m WHERE m.conversacion_id = c.id AND m.direccion = 'in' AND m.whatsapp_message_id IS NOT NULL
            ORDER BY m.marca_tiempo DESC LIMIT 1) AS wamid
    FROM whatsapp_conversaciones c WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

// Marca como leída en el ERP y, si había mensajes sin leer, avisa a WhatsApp. Si el aviso falla, la lectura en el ERP igual queda guardada.
// resultado.whatsapp: 'enviado' | 'no_aplica' (no había nada sin leer) | 'sin_credenciales' | 'sin_mensaje' | 'rechazado' | 'error_red'
export async function marcarLeidaYSincronizar(sql, id, { accessToken, phoneNumberId, fetchFn } = {}) {
  const pendiente = await leerPendienteDeLectura(sql, id);
  const r = await marcarLeida(sql, id);
  if (!r.ok) return r;
  let whatsapp = 'no_aplica';
  if (pendiente && pendiente.no_leidos > 0) {
    const s = await marcarLeidaEnWhatsapp({ accessToken, phoneNumberId, messageId: pendiente.wamid, fetchFn });
    whatsapp = s.ok ? 'enviado' : s.motivo;
    if (!s.ok && s.detalle) console.error('[whatsapp-marcar-leida] Meta no aceptó el aviso de lectura', id, s.motivo, String(s.detalle).slice(0, 300));
  }
  return { ...r, whatsapp };
}

export const ACCIONES_CONVERSACION =['archivar', 'desarchivar', 'no_leida'];
export async function accionConversacion(sql, id, accion) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, estado: 400, error: 'Falta id' };
  if (!ACCIONES_CONVERSACION.includes(accion)) return { ok: false, estado: 400, error: 'Acción inválida' };
  let rows;
  if (accion === 'archivar') ({ rows } = await sql`UPDATE whatsapp_conversaciones SET archivada_en = GREATEST(now(), COALESCE((SELECT MAX(m.marca_tiempo) FROM whatsapp_mensajes m WHERE m.conversacion_id = whatsapp_conversaciones.id), now())), updated_at = now() WHERE id = ${n} RETURNING id;`);
  else if (accion === 'desarchivar') ({ rows } = await sql`UPDATE whatsapp_conversaciones SET archivada_en = NULL, updated_at = now() WHERE id = ${n} RETURNING id;`);
  else ({ rows } = await sql`UPDATE whatsapp_conversaciones SET no_leida_manual = true, updated_at = now() WHERE id = ${n} RETURNING id;`);
  return rows.length ? { ok: true } : { ok: false, estado: 404, error: 'Conversación no encontrada' };
}

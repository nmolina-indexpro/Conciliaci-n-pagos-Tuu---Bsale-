// /lib/chat.js
// Chat en vivo propio del ERP (reemplazo de Zoho SalesIQ, fase 1). Ver el plan en la conversación del proyecto.
// - El visitante (widget del sitio) habla SIEMPRE primero con el asistente guiado (lib/chat-bot.js), que averigua la necesidad.
// - Si hay un ejecutivo en línea, el chat pasa a la cola y alguien lo toma (la conversación sigue "natural": el ejecutivo ve lo que ya contó el cliente).
// - Si no hay nadie (o nadie lo toma a tiempo), se pide un contacto y el lead queda en Tickets (origen "chat").
// Tablas con prefijo ch_. Sin imports de red ni de @vercel/postgres: recibe `sql` ya resuelto (patrón de lib/tickets.js).
// Tiempo real SIN websockets (plan Hobby de Vercel): el widget y la bandeja consultan cada pocos segundos (ver los intervalos en cada cliente).

import { createHash, randomBytes } from 'node:crypto';
import { unaVez } from './una-vez.js';
import { asegurarTablasTickets, crearTicket, normalizarTelefono, normalizarEmail } from './tickets.js';
import { cabecerasCors } from './tickets-entrada.js';
import { ipCliente, limitarMemoria } from './seguridad.js';
import { NOMBRE_ASISTENTE, TIPOS, etiquetaTipo, primerNombre, mensajeInicial, siguientePaso, sinAtender } from './chat-bot.js';

// ---------------- Constantes ----------------
export const ESTADOS_AGENTE = [
  { clave: 'disponible', etiqueta: 'Disponible' },
  { clave: 'ocupado', etiqueta: 'Ocupado' },
  { clave: 'descanso', etiqueta: 'Descanso' },
  { clave: 'desconectado', etiqueta: 'Desconectado' },
];
export const LATIDO_VIGENTE_SEG = 90;        // un ejecutivo cuenta como "en línea" si su bandeja avisó hace menos que esto
export const MAX_CHATS_POR_AGENTE = 3;       // con más chats activos que esto, no se le deriva otro
export const COLA_MAX_SEG = 120;             // tiempo que espera un chat en cola antes de pasar a "dejar contacto"
export const INACTIVO_BOT_MIN = 10;          // el visitante dejó de consultar mientras hablaba con el asistente o esperaba
export const INACTIVO_ACTIVO_MIN = 20;       // ídem con un ejecutivo ya atendiendo
export const MAX_MENSAJE = 1000;
export const MAX_MENSAJES_VISITANTE = 150;   // por sesión
export const MAX_ADJUNTOS_SESION = 5;
export const MAX_ADJUNTO_BYTES = 3 * 1024 * 1024; // Vercel limita el cuerpo a 4,5 MB y el archivo viaja en base64 (+33%)
const ABIERTOS = ['bot', 'cola', 'activo'];
const CERRADOS = ['cerrado', 'perdido'];

function limpio(v, max) { const t = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').trim(); return t ? t.slice(0, max) : ''; }
function entero(v) { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; }
function contarEnlaces(t) { return (String(t).match(/https?:\/\/|www\./gi) || []).length; }
function nombreCorto(n) { return primerNombre(n) || 'Ejecutivo'; }

// ---------------- Migraciones ----------------
export async function asegurarTablasChat(sql) { return unaVez('asegurarTablasChat', () => _asegurarTablasChat(sql)); }
async function _asegurarTablasChat(sql) {
  await asegurarTablasTickets(sql); // ch_sesiones.ticket_id apunta a tickets (y esto asegura también la tabla usuarios)
  await sql.query(`CREATE TABLE IF NOT EXISTS ch_sesiones (
    id SERIAL PRIMARY KEY, token TEXT NOT NULL UNIQUE, huella TEXT,
    nombre TEXT, email TEXT, telefono TEXT,
    estado TEXT NOT NULL DEFAULT 'bot', paso TEXT NOT NULL DEFAULT 'tipo', datos JSONB NOT NULL DEFAULT '{}'::jsonb,
    agente_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL, ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
    pagina_inicial TEXT, pagina_actual TEXT, paginas JSONB NOT NULL DEFAULT '[]'::jsonb, producto_titulo TEXT, producto_url TEXT, referrer TEXT,
    atribucion JSONB, dispositivo TEXT, etiquetas JSONB NOT NULL DEFAULT '[]'::jsonb,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(), ultimo_visitante_en TIMESTAMPTZ NOT NULL DEFAULT now(), ultimo_mensaje_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    cola_desde TIMESTAMPTZ, tomado_en TIMESTAMPTZ, primera_respuesta_seg INTEGER, cerrado_en TIMESTAMPTZ, motivo_cierre TEXT,
    ultimo_leido_agente INTEGER NOT NULL DEFAULT 0, avisado_cola_en TIMESTAMPTZ)`);
  await sql`CREATE INDEX IF NOT EXISTS ch_sesiones_estado_idx ON ch_sesiones (estado);`;
  await sql`CREATE INDEX IF NOT EXISTS ch_sesiones_agente_idx ON ch_sesiones (agente_id, estado);`;
  await sql`CREATE INDEX IF NOT EXISTS ch_sesiones_creado_idx ON ch_sesiones (creado_en DESC);`;
  await sql.query(`CREATE TABLE IF NOT EXISTS ch_mensajes (
    id SERIAL PRIMARY KEY, sesion_id INTEGER NOT NULL REFERENCES ch_sesiones(id) ON DELETE CASCADE,
    autor TEXT NOT NULL, usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL, autor_nombre TEXT,
    texto TEXT, tipo TEXT NOT NULL DEFAULT 'texto', opciones JSONB, adjunto_id INTEGER, imagen_url TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql`CREATE INDEX IF NOT EXISTS ch_mensajes_sesion_idx ON ch_mensajes (sesion_id, id);`;
  // Fotos que manda el cliente (o el ejecutivo): guardadas en la propia base, como los adjuntos de Tickets.
  await sql.query(`CREATE TABLE IF NOT EXISTS ch_adjuntos (
    id SERIAL PRIMARY KEY, sesion_id INTEGER NOT NULL REFERENCES ch_sesiones(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, contenido BYTEA NOT NULL, autor TEXT, creado_en TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await sql`CREATE INDEX IF NOT EXISTS ch_adjuntos_sesion_idx ON ch_adjuntos (sesion_id);`;
  await sql`CREATE TABLE IF NOT EXISTS ch_respuestas_rapidas (
    id SERIAL PRIMARY KEY, titulo TEXT NOT NULL, texto TEXT NOT NULL, activo BOOLEAN NOT NULL DEFAULT true, creado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  await sql`CREATE TABLE IF NOT EXISTS ch_agentes_estado (
    usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE, estado TEXT NOT NULL DEFAULT 'desconectado',
    latido_en TIMESTAMPTZ NOT NULL DEFAULT now(), desde TIMESTAMPTZ NOT NULL DEFAULT now());`;
  // Cada cambio de estado de un ejecutivo (sirve más adelante para el informe de disponibilidad).
  await sql`CREATE TABLE IF NOT EXISTS ch_agentes_historial (
    id SERIAL PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, estado TEXT NOT NULL, desde TIMESTAMPTZ NOT NULL DEFAULT now());`;
  await sql`CREATE INDEX IF NOT EXISTS ch_agentes_historial_idx ON ch_agentes_historial (usuario_id, desde);`;
  const { rows } = await sql`SELECT count(*)::int AS n FROM ch_respuestas_rapidas;`;
  if (!rows[0].n) {
    await sql`INSERT INTO ch_respuestas_rapidas (titulo, texto) VALUES
      ('Un momento', 'Un momento por favor, estoy revisando 🙏'),
      ('Pedir modelo', '¿Me confirmas el modelo exacto de tu equipo? Está en la etiqueta de la parte trasera, donde dice "model".')`;
  }
}

// ---------------- Mensajes ----------------
export async function agregarMensaje(sql, sesionId, m) {
  const { rows } = await sql.query(
    `INSERT INTO ch_mensajes (sesion_id, autor, usuario_id, autor_nombre, texto, tipo, opciones, adjunto_id, imagen_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) RETURNING *`,
    [sesionId, m.autor, m.usuario_id ?? null, m.autor_nombre ?? null, m.texto ?? null, m.tipo || 'texto', m.opciones ? JSON.stringify(m.opciones) : null, m.adjunto_id ?? null, m.imagen_url ?? null]);
  if (m.autor !== 'nota') await sql.query('UPDATE ch_sesiones SET ultimo_mensaje_en = now() WHERE id = $1', [sesionId]);
  return rows[0];
}

function mensajePublico(m) {
  return {
    id: m.id, autor: m.autor, tipo: m.tipo,
    nombre: m.autor === 'agente' ? nombreCorto(m.autor_nombre) : m.autor === 'bot' ? NOMBRE_ASISTENTE : null,
    texto: m.texto, opciones: m.opciones || null, adjunto: m.adjunto_id || null, imagen_url: m.imagen_url || null, en: m.creado_en,
  };
}

// ---------------- Ejecutivos ----------------
// Hay alguien a quien derivar: disponible, con la bandeja abierta (latido reciente) y con cupo.
export async function ejecutivosDisponibles(sql) {
  const { rows } = await sql.query(
    `SELECT e.usuario_id, (SELECT count(*) FROM ch_sesiones s WHERE s.agente_id = e.usuario_id AND s.estado = 'activo')::int AS activos
       FROM ch_agentes_estado e JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.estado = 'disponible' AND u.activo = true AND e.latido_en > now() - ($1 || ' seconds')::interval`, [String(LATIDO_VIGENTE_SEG)]);
  return rows.filter((r) => r.activos < MAX_CHATS_POR_AGENTE).length;
}

export async function latidoAgente(sql, usuarioId) {
  await sql.query(
    `INSERT INTO ch_agentes_estado (usuario_id, estado, latido_en) VALUES ($1, 'desconectado', now())
     ON CONFLICT (usuario_id) DO UPDATE SET latido_en = now()`, [usuarioId]);
}
export async function cambiarEstadoAgente(sql, usuarioId, estado) {
  if (!ESTADOS_AGENTE.some((e) => e.clave === estado)) return { error: 'Estado no válido', status: 400 };
  const { rows } = await sql.query('SELECT estado FROM ch_agentes_estado WHERE usuario_id = $1', [usuarioId]);
  if (rows[0] && rows[0].estado === estado) { await latidoAgente(sql, usuarioId); return { ok: true, sinCambio: true }; }
  await sql.query(
    `INSERT INTO ch_agentes_estado (usuario_id, estado, latido_en, desde) VALUES ($1, $2, now(), now())
     ON CONFLICT (usuario_id) DO UPDATE SET estado = $2, latido_en = now(), desde = now()`, [usuarioId, estado]);
  await sql.query('INSERT INTO ch_agentes_historial (usuario_id, estado) VALUES ($1, $2)', [usuarioId, estado]);
  return { ok: true };
}
async function listarAgentes(sql) {
  const { rows } = await sql.query(
    `SELECT u.id, COALESCE(NULLIF(u.nombre, ''), u.email) AS nombre, e.estado, (e.latido_en > now() - ($1 || ' seconds')::interval) AS en_linea,
            (SELECT count(*) FROM ch_sesiones s WHERE s.agente_id = u.id AND s.estado = 'activo')::int AS activos
       FROM ch_agentes_estado e JOIN usuarios u ON u.id = e.usuario_id
      WHERE u.activo = true AND e.latido_en > now() - interval '12 hours' ORDER BY nombre`, [String(LATIDO_VIGENTE_SEG)]);
  return rows;
}

// ---------------- Sesiones ----------------
const COLS_ADMIN = `s.id, s.nombre, s.email, s.telefono, s.estado, s.paso, s.datos, s.agente_id, s.ticket_id, s.pagina_inicial, s.pagina_actual, s.paginas,
  s.producto_titulo, s.producto_url, s.referrer, s.atribucion, s.dispositivo, s.etiquetas, s.creado_en, s.ultimo_visitante_en, s.ultimo_mensaje_en, s.cola_desde,
  s.tomado_en, s.primera_respuesta_seg, s.cerrado_en, s.motivo_cierre, s.ultimo_leido_agente`;

export function huellaVisitante(req) {
  const h = req.headers || {};
  const sal = process.env.VISITOR_SALT || process.env.AUTH_SECRET || 'chat';
  const dia = new Date().toISOString().slice(0, 10);
  return createHash('sha256').update([ipCliente(req), String(h['user-agent'] || ''), dia, sal].join('|')).digest('hex').slice(0, 32);
}
function dispositivoDe(b, req) {
  const d = limpio(b.dispositivo, 12).toLowerCase();
  if (d === 'movil' || d === 'escritorio') return d;
  return /Mobi|Android|iPhone|iPad/i.test(String(req?.headers?.['user-agent'] || '')) ? 'movil' : 'escritorio';
}

export async function sesionPorToken(sql, token) {
  const t = limpio(token, 64);
  if (!/^[0-9a-f]{32}$/.test(t)) return null;
  const { rows } = await sql.query(
    `SELECT s.*, COALESCE(NULLIF(u.nombre, ''), u.email) AS agente_nombre FROM ch_sesiones s LEFT JOIN usuarios u ON u.id = s.agente_id WHERE s.token = $1`, [t]);
  return rows[0] || null;
}

// Valida los datos del formulario previo del widget. Devuelve { descartar } (robot), { error } o { datos }.
export function validarInicio(b, { ahora = Date.now() } = {}) {
  b = b || {};
  if (limpio(b.web, 200)) return { descartar: 'honeypot' };
  const t = Number(b.t);
  if (Number.isFinite(t) && t >= 0 && t < 1200) return { descartar: 'demasiado_rapido' };
  const nombre = limpio(b.nombre, 80);
  if (!nombre || nombre.length < 2) return { error: 'Cuéntanos tu nombre para empezar' };
  if (contarEnlaces(nombre) || /[<>]/.test(nombre)) return { descartar: 'nombre_sospechoso' };
  const email = b.email ? normalizarEmail(b.email) : null;
  if (b.email && !email) return { error: 'El correo no parece válido' };
  if (b.telefono && String(b.telefono).replace(/\D/g, '').length < 8) return { error: 'El teléfono no parece válido' };
  const telefono = b.telefono ? normalizarTelefono(b.telefono) : null;
  const atribucion = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid']) { const v = limpio(b[k], 300); if (v) atribucion[k] = v; }
  return { datos: { nombre, email, telefono, atribucion, pagina: limpio(b.pagina, 500), referrer: limpio(b.referrer, 300), producto_titulo: limpio(b.producto_titulo, 200), producto_url: limpio(b.producto_url, 500) } };
}

export async function iniciarSesion(sql, d, { huella = null, dispositivo = 'escritorio' } = {}) {
  const token = randomBytes(16).toString('hex');
  const { rows } = await sql.query(
    `INSERT INTO ch_sesiones (token, huella, nombre, email, telefono, estado, paso, pagina_inicial, pagina_actual, paginas, producto_titulo, producto_url, referrer, atribucion, dispositivo)
     VALUES ($1, $2, $3, $4, $5, 'bot', 'tipo', $6, $6, $7::jsonb, $8, $9, $10, $11::jsonb, $12) RETURNING *`,
    [token, huella, d.nombre, d.email, d.telefono, d.pagina || null, JSON.stringify(d.pagina ? [d.pagina] : []), d.producto_titulo || null, d.producto_url || null, d.referrer || null,
      Object.keys(d.atribucion || {}).length ? JSON.stringify(d.atribucion) : null, dispositivo]);
  const s = rows[0];
  const ini = mensajeInicial(s.nombre);
  await agregarMensaje(sql, s.id, { autor: 'bot', autor_nombre: NOMBRE_ASISTENTE, texto: ini.texto, opciones: ini.opciones });
  return s;
}

// Aplica lo que decidió el asistente: guarda sus mensajes, el nuevo paso, y deriva / deja el lead / cierra. El UPDATE lleva la condición del estado
// con que se leyó la sesión: si un ejecutivo la tomó mientras tanto, no se pisa su cambio.
async function aplicarResultadoBot(sql, s, r) {
  const c = r.contacto || {};
  const email = normalizarEmail(c.email) || s.email;
  const telefono = c.telefono ? normalizarTelefono(c.telefono) : s.telefono;
  const sinAtenderCola = !!(r.datos && r.datos.desde_cola);
  let estado = 'bot'; let motivo = null;
  if (r.accion === 'derivar') estado = 'cola';
  else if (r.accion === 'crear_lead_y_cerrar') { estado = sinAtenderCola ? 'perdido' : 'cerrado'; motivo = sinAtenderCola ? 'sin_atender' : 'sin_ejecutivos'; }
  else if (r.accion === 'cerrar_sin_lead') { estado = sinAtenderCola ? 'perdido' : 'cerrado'; motivo = 'sin_contacto'; }
  const { rows } = await sql.query(
    `UPDATE ch_sesiones SET paso = $2, datos = $3::jsonb, email = $4, telefono = $5, estado = $6, motivo_cierre = COALESCE($7::text, motivo_cierre),
            cola_desde = CASE WHEN $6 = 'cola' AND cola_desde IS NULL THEN now() ELSE cola_desde END,
            cerrado_en = CASE WHEN $7::text IS NOT NULL THEN now() ELSE cerrado_en END, ultimo_mensaje_en = now()
      WHERE id = $1 AND estado = $8 RETURNING *`,
    [s.id, r.paso, JSON.stringify(r.datos || {}), email, telefono, estado, motivo, s.estado]);
  if (!rows[0]) return (await sesionPorToken(sql, s.token)) || s; // otro proceso la cambió primero
  for (const m of r.mensajes || []) await agregarMensaje(sql, s.id, { autor: 'bot', autor_nombre: NOMBRE_ASISTENTE, texto: m.texto, opciones: m.opciones || null, imagen_url: m.imagen_url || null });
  const nueva = rows[0];
  if (r.accion === 'crear_lead_y_cerrar') await crearLeadDeChat(sql, nueva);
  return nueva;
}

// ---------------- Lead en Tickets ----------------
export async function crearLeadDeChat(sql, s, { autor = { id: null, nombre: 'Chat web' } } = {}) {
  if (s.ticket_id) return { omitido: 'ya_existe', ticketId: s.ticket_id };
  const email = normalizarEmail(s.email); const telefono = s.telefono ? normalizarTelefono(s.telefono) : null;
  if (!email && !telefono) return { omitido: 'sin_contacto' };
  const d = s.datos || {};
  const tipoEt = etiquetaTipo(d.tipo) || 'Consulta por chat';
  const producto = [d.tipo && d.tipo !== 'otra' && d.tipo !== 'postventa' ? tipoEt : null, d.modelo].filter(Boolean).join(' ') || (d.detalle ? String(d.detalle).slice(0, 80) : tipoEt);
  const { rows: ms } = await sql.query(`SELECT autor, texto, tipo FROM ch_mensajes WHERE sesion_id = $1 AND autor IN ('visitante', 'agente', 'bot') ORDER BY id`, [s.id]);
  const conv = ms.map((m) => `${m.autor === 'visitante' ? 'Cliente' : m.autor === 'agente' ? 'Ejecutivo' : 'Asistente'}: ${m.tipo === 'imagen' ? '[foto]' : String(m.texto || '').replace(/\s+/g, ' ')}`).join('\n');
  const necesidad = [tipoEt && d.tipo ? `Necesita: ${tipoEt}` : null, d.modelo ? `Modelo: ${d.modelo}` : null, d.pedido ? `Pedido: ${d.pedido}` : null, d.detalle ? `Detalle: ${d.detalle}` : null, d.foto ? 'Envió una foto (ver el chat)' : null].filter(Boolean).join('\n');
  const descripcion = [`Chat web #${s.id}${s.pagina_inicial ? ' — empezó en ' + s.pagina_inicial : ''}`, necesidad, 'Conversación:', conv].filter(Boolean).join('\n').slice(0, 3900);
  const nombre = s.nombre || '';
  const postventa = d.tipo === 'postventa' && d.pedido;
  const datos = postventa
    ? { tipo: 'postventa', origen: 'chat', asunto: `Postventa pedido ${d.pedido}${nombre ? ' — ' + nombre : ''}`, descripcion, cliente: { nombre, email, telefono }, postventa: { motivo: 'otra', numero_pedido: String(d.pedido) } }
    : { tipo: 'lead', origen: 'chat', asunto: `${producto}${nombre ? ' — ' + nombre : ''}`, descripcion, cliente: { nombre, email, telefono },
        lead: { producto_interes: producto, origen_detalle: 'chat', atribucion: { ...(s.atribucion || {}), pagina: s.pagina_inicial || undefined, referrer: s.referrer || undefined } } };
  const r = await crearTicket(sql, datos, autor);
  if (r.error) return { error: r.error };
  await sql.query('UPDATE ch_sesiones SET ticket_id = $2 WHERE id = $1 AND ticket_id IS NULL', [s.id, r.ticket.id]);
  return { creado: r.ticket.numero, ticketId: r.ticket.id };
}

// ---------------- Lado visitante ----------------
async function estadoPublico(sql, s, desde = 0) {
  const { rows } = await sql.query(
    `SELECT id, autor, autor_nombre, texto, tipo, opciones, adjunto_id, imagen_url, creado_en FROM ch_mensajes WHERE sesion_id = $1 AND id > $2 AND autor <> 'nota' ORDER BY id LIMIT 100`,
    [s.id, Number(desde) || 0]);
  const cerrado = CERRADOS.includes(s.estado);
  return {
    ok: true, estado: s.estado, paso: s.paso, cerrado, mensajes: rows.map(mensajePublico), ultimo_id: rows.length ? rows[rows.length - 1].id : Number(desde) || 0,
    agente: s.estado === 'activo' && s.agente_nombre ? { nombre: nombreCorto(s.agente_nombre) } : null,
  };
}

// Si el chat lleva demasiado en cola sin que nadie lo tome, el propio sondeo del visitante hace de reloj: se pide el contacto o se deja el lead.
async function revisarCola(sql, s) {
  if (s.estado !== 'cola' || !s.cola_desde) return s;
  if ((Date.now() - new Date(s.cola_desde).getTime()) / 1000 < COLA_MAX_SEG) return s;
  return aplicarResultadoBot(sql, s, sinAtender(s));
}

// Actualiza la página actual, el producto que mira y las últimas 5 páginas visitadas. Usa los parámetros $2 (página), $3 (título) y $4 (enlace del producto).
function actualizarPaginaSql() { return `pagina_actual = COALESCE(NULLIF($2::text, ''), pagina_actual), producto_titulo = COALESCE(NULLIF($3::text, ''), producto_titulo), producto_url = COALESCE(NULLIF($4::text, ''), producto_url),
  paginas = CASE WHEN NULLIF($2::text, '') IS NOT NULL AND NOT (paginas ? $2::text) THEN (CASE WHEN jsonb_array_length(paginas) >= 5 THEN paginas - 0 ELSE paginas END) || to_jsonb($2::text) ELSE paginas END`; }

// Un chat solo se vuelve lead si la persona alcanzó a contar qué necesita (no si solo abrió la ventana y se fue).
function tieneNecesidad(s) { return !!(s && s.datos && s.datos.tipo); }

export async function accionIniciar(sql, b, req) {
  const existente = b.token ? await sesionPorToken(sql, b.token) : null;
  if (existente && ABIERTOS.includes(existente.estado)) return { ...(await estadoPublico(sql, existente, 0)), token: existente.token, reanudada: true };
  const v = validarInicio(b);
  if (v.descartar) return { ok: true, descartado: true };
  if (v.error) return { error: v.error, status: 400 };
  const s = await iniciarSesion(sql, v.datos, { huella: huellaVisitante(req), dispositivo: dispositivoDe(b, req) });
  return { ...(await estadoPublico(sql, s, 0)), token: s.token, ejecutivos_en_linea: (await ejecutivosDisponibles(sql)) > 0 };
}

export async function accionLeer(sql, b) {
  const { rows } = await sql.query(
    `UPDATE ch_sesiones SET ultimo_visitante_en = now(), ${actualizarPaginaSql()} WHERE token = $1 RETURNING id`,
    [limpio(b.token, 64), limpio(b.pagina, 500), limpio(b.producto_titulo, 200), limpio(b.producto_url, 500)]);
  if (!rows[0]) return { error: 'Sesión no encontrada', status: 404 };
  let s = await sesionPorToken(sql, b.token);
  s = await revisarCola(sql, s);
  const out = await estadoPublico(sql, s, b.desde);
  if (s.estado === 'activo' && !out.agente) out.agente = { nombre: 'Ejecutivo' };
  return out;
}

export async function accionEnviar(sql, b, req) {
  let s = await sesionPorToken(sql, b.token);
  if (!s) return { error: 'Sesión no encontrada', status: 404 };
  if (CERRADOS.includes(s.estado)) return { ...(await estadoPublico(sql, s, b.desde)), cerrado: true };
  const { rows: cuenta } = await sql.query(`SELECT count(*)::int AS n FROM ch_mensajes WHERE sesion_id = $1 AND autor = 'visitante'`, [s.id]);
  if (cuenta[0].n >= MAX_MENSAJES_VISITANTE) return { error: 'Llegaste al máximo de mensajes de esta conversación. Escríbenos por WhatsApp para seguir.', status: 429 };
  // Un botón del asistente (tipo de producto o "hablar con un ejecutivo") llega como `opcion`; lo demás es texto escrito.
  const opcionPedida = limpio(b.opcion, 30);
  const etiquetaOpcion = opcionPedida === 'ejecutivo' ? 'Quiero hablar con un ejecutivo' : etiquetaTipo(opcionPedida);
  const opcion = etiquetaOpcion ? opcionPedida : '';
  const texto = opcion ? etiquetaOpcion : limpio(String(b.texto ?? '').replace(/\r/g, ''), MAX_MENSAJE);
  if (!texto) return { error: 'Escribe un mensaje', status: 400 };
  if (contarEnlaces(texto) > 3) return { error: 'Tu mensaje tiene demasiados enlaces', status: 400 };
  await agregarMensaje(sql, s.id, { autor: 'visitante', autor_nombre: s.nombre, texto });
  await sql.query(`UPDATE ch_sesiones SET ultimo_visitante_en = now(), ${actualizarPaginaSql()} WHERE id = $1`, [s.id, limpio(b.pagina, 500), limpio(b.producto_titulo, 200), limpio(b.producto_url, 500)]);
  if (s.estado === 'bot') {
    const r = siguientePaso(s, { texto: opcion ? '' : texto, opcion: opcion || null, imagen: false }, { hayEjecutivos: (await ejecutivosDisponibles(sql)) > 0 });
    if (r.mensajes.length || r.accion || r.paso !== s.paso) s = await aplicarResultadoBot(sql, s, r);
  }
  const fresca = (await sesionPorToken(sql, s.token)) || s;
  return await estadoPublico(sql, fresca, b.desde);
}

// Tipo real de la imagen por sus primeros bytes (no se confía en lo que diga el navegador).
export function tipoImagen(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf.slice(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf.slice(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
async function guardarAdjunto(sql, sesionId, { nombre, datos }, autor) {
  const b64 = String(datos || '').replace(/^data:[^,]*,/, '');
  if (!b64) return { error: 'Falta la imagen', status: 400 };
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { error: 'La imagen está vacía', status: 400 };
  if (buf.length > MAX_ADJUNTO_BYTES) return { error: 'La imagen pesa más de 3 MB', status: 413 };
  const mime = tipoImagen(buf);
  if (!mime) return { error: 'Solo se pueden enviar fotos (JPG, PNG, WebP o GIF)', status: 400 };
  const n = limpio(String(nombre || 'foto').replace(/[\\/"]/g, '_'), 120) || 'foto';
  const { rows } = await sql.query('INSERT INTO ch_adjuntos (sesion_id, nombre, mime, bytes, contenido, autor) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [sesionId, n, mime, buf.length, buf, autor]);
  return { id: rows[0].id, nombre: n };
}

export async function accionAdjuntoVisitante(sql, b) {
  let s = await sesionPorToken(sql, b.token);
  if (!s) return { error: 'Sesión no encontrada', status: 404 };
  if (CERRADOS.includes(s.estado)) return { ...(await estadoPublico(sql, s, b.desde)), cerrado: true };
  const { rows } = await sql.query('SELECT count(*)::int AS n FROM ch_adjuntos WHERE sesion_id = $1', [s.id]);
  if (rows[0].n >= MAX_ADJUNTOS_SESION) return { error: 'Ya enviaste varias fotos. Si necesitas mandar más, escríbenos por WhatsApp.', status: 429 };
  const a = await guardarAdjunto(sql, s.id, b, 'visitante');
  if (a.error) return a;
  await agregarMensaje(sql, s.id, { autor: 'visitante', autor_nombre: s.nombre, texto: a.nombre, tipo: 'imagen', adjunto_id: a.id });
  await sql.query('UPDATE ch_sesiones SET ultimo_visitante_en = now() WHERE id = $1', [s.id]);
  if (s.estado === 'bot') {
    const r = siguientePaso(s, { texto: '', imagen: true }, { hayEjecutivos: (await ejecutivosDisponibles(sql)) > 0 });
    if (r.mensajes.length || r.accion || r.paso !== s.paso) s = await aplicarResultadoBot(sql, s, r);
  }
  return await estadoPublico(sql, (await sesionPorToken(sql, s.token)) || s, b.desde);
}

// El visitante cierra el chat. Si ya había dejado su contacto y nadie lo atendió, igual queda el lead.
export async function accionCerrarVisitante(sql, b) {
  const s = await sesionPorToken(sql, b.token);
  if (!s) return { error: 'Sesión no encontrada', status: 404 };
  if (!CERRADOS.includes(s.estado)) {
    const { rows } = await sql.query(
      `UPDATE ch_sesiones SET estado = $2, motivo_cierre = 'visitante', cerrado_en = now() WHERE id = $1 AND estado = $3 RETURNING *`,
      [s.id, s.estado === 'cola' ? 'perdido' : 'cerrado', s.estado]);
    if (rows[0] && s.estado !== 'activo' && tieneNecesidad(rows[0])) await crearLeadDeChat(sql, rows[0]);
  }
  return { ok: true, cerrado: true };
}

// Adjunto visto desde el widget: solo con el token de la sesión a la que pertenece.
async function servirAdjunto(sql, res, adjuntoId, sesionId) {
  const { rows } = await sql.query('SELECT nombre, mime, contenido FROM ch_adjuntos WHERE id = $1' + (sesionId ? ' AND sesion_id = $2' : ''), sesionId ? [adjuntoId, sesionId] : [adjuntoId]);
  const a = rows[0];
  if (!a) return res.status(404).json({ error: 'Adjunto no encontrado' });
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).send(a.contenido);
}

// ---------------- Cierre por inactividad ----------------
let ultimoBarrido = 0;
export async function cerrarInactivas(sql, { forzar = false } = {}) {
  if (!forzar && Date.now() - ultimoBarrido < 30000) return 0;
  ultimoBarrido = Date.now();
  const { rows } = await sql.query(
    `UPDATE ch_sesiones SET estado = CASE WHEN estado = 'cola' THEN 'perdido' ELSE 'cerrado' END, motivo_cierre = 'inactivo', cerrado_en = now()
      WHERE (estado IN ('bot', 'cola') AND ultimo_visitante_en < now() - ($1 || ' minutes')::interval)
         OR (estado = 'activo' AND ultimo_visitante_en < now() - ($2 || ' minutes')::interval)
      RETURNING *`, [String(INACTIVO_BOT_MIN), String(INACTIVO_ACTIVO_MIN)]);
  // Quien alcanzó a dejar su contacto y nadie atendió, no se pierde: queda como lead.
  for (const s of rows) if (!s.agente_id && (s.email || s.telefono) && tieneNecesidad(s)) { try { await crearLeadDeChat(sql, s); } catch (e) { console.error('chat lead inactivo', e); } }
  return rows.length;
}

// ---------------- Lado ejecutivo ----------------
export async function tomarChat(sql, id, agente) {
  const { rows } = await sql.query(
    `UPDATE ch_sesiones SET estado = 'activo', agente_id = $2, tomado_en = COALESCE(tomado_en, now()) WHERE id = $1 AND (estado IN ('bot', 'cola') OR (estado = 'activo' AND agente_id = $2)) RETURNING *, (SELECT estado FROM ch_sesiones WHERE id = $1) AS estado_previo`,
    [id, agente.id]);
  if (!rows[0]) {
    const { rows: x } = await sql.query('SELECT estado, agente_id FROM ch_sesiones WHERE id = $1', [id]);
    if (!x[0]) return { error: 'Chat no encontrado', status: 404 };
    if (x[0].estado === 'activo') return { error: 'Otro ejecutivo ya tomó este chat', status: 409 };
    return { error: 'Este chat ya terminó', status: 409 };
  }
  // Al tomarlo ve todo lo que ya se habló con el asistente: desde ahí solo cuentan como "sin leer" los mensajes nuevos.
  await sql.query('UPDATE ch_sesiones SET ultimo_leido_agente = GREATEST(ultimo_leido_agente, COALESCE((SELECT max(id) FROM ch_mensajes WHERE sesion_id = $1), 0)) WHERE id = $1', [id]);
  if (rows[0].estado_previo !== 'activo') await agregarMensaje(sql, id, { autor: 'sistema', usuario_id: agente.id, autor_nombre: agente.nombre, texto: `${nombreCorto(agente.nombre)} se unió al chat` });
  return { ok: true };
}

export async function responderChat(sql, id, texto, agente) {
  const t = limpio(String(texto ?? '').replace(/\r/g, ''), MAX_MENSAJE * 2);
  if (!t) return { error: 'Escribe un mensaje', status: 400 };
  const { rows } = await sql.query('SELECT estado, agente_id, cola_desde, creado_en, primera_respuesta_seg FROM ch_sesiones WHERE id = $1', [id]);
  const s = rows[0];
  if (!s) return { error: 'Chat no encontrado', status: 404 };
  if (s.estado !== 'activo') return { error: CERRADOS.includes(s.estado) ? 'Este chat ya terminó' : 'Toma el chat antes de responder', status: 409 };
  if (s.agente_id !== agente.id) return { error: 'Este chat lo atiende otro ejecutivo', status: 403 };
  const m = await agregarMensaje(sql, id, { autor: 'agente', usuario_id: agente.id, autor_nombre: agente.nombre, texto: t });
  await sql.query('UPDATE ch_sesiones SET ultimo_leido_agente = GREATEST(ultimo_leido_agente, $2) WHERE id = $1', [id, m.id]); // si respondió, leyó todo lo anterior
  if (s.primera_respuesta_seg == null) {
    await sql.query(`UPDATE ch_sesiones SET primera_respuesta_seg = GREATEST(0, extract(epoch FROM (now() - COALESCE(cola_desde, creado_en)))::int) WHERE id = $1 AND primera_respuesta_seg IS NULL`, [id]);
  }
  return { ok: true, mensaje: m };
}

export async function notaInterna(sql, id, texto, agente) {
  const t = limpio(texto, 2000);
  if (!t) return { error: 'Escribe la nota', status: 400 };
  const { rows } = await sql.query('SELECT 1 FROM ch_sesiones WHERE id = $1', [id]);
  if (!rows[0]) return { error: 'Chat no encontrado', status: 404 };
  await agregarMensaje(sql, id, { autor: 'nota', usuario_id: agente.id, autor_nombre: agente.nombre, texto: t });
  return { ok: true };
}

export async function transferirChat(sql, id, agenteDestino, agente) {
  const { rows } = await sql.query(`SELECT estado, agente_id FROM ch_sesiones WHERE id = $1`, [id]);
  const s = rows[0];
  if (!s) return { error: 'Chat no encontrado', status: 404 };
  if (s.estado !== 'activo') return { error: 'Solo se puede transferir un chat en atención', status: 409 };
  if (s.agente_id !== agente.id) return { error: 'Este chat lo atiende otro ejecutivo', status: 403 };
  const { rows: u } = await sql.query(`SELECT id, COALESCE(NULLIF(nombre, ''), email) AS nombre FROM usuarios WHERE id = $1 AND activo = true`, [agenteDestino]);
  if (!u[0]) return { error: 'Ejecutivo no válido', status: 400 };
  if (u[0].id === agente.id) return { error: 'El chat ya es tuyo', status: 400 };
  await sql.query('UPDATE ch_sesiones SET agente_id = $2 WHERE id = $1', [id, u[0].id]);
  await agregarMensaje(sql, id, { autor: 'nota', usuario_id: agente.id, autor_nombre: agente.nombre, texto: `Transferido de ${agente.nombre} a ${u[0].nombre}` });
  await agregarMensaje(sql, id, { autor: 'sistema', usuario_id: u[0].id, autor_nombre: u[0].nombre, texto: `${nombreCorto(u[0].nombre)} se unió al chat` });
  return { ok: true };
}

export async function cerrarChat(sql, id, agente, { crearTicketSiHayContacto = false } = {}) {
  const { rows } = await sql.query(
    `UPDATE ch_sesiones SET estado = 'cerrado', motivo_cierre = 'ejecutivo', cerrado_en = now() WHERE id = $1 AND estado IN ('bot', 'cola', 'activo') RETURNING *`, [id]);
  if (!rows[0]) return { error: 'Este chat ya terminó o no existe', status: 409 };
  await agregarMensaje(sql, id, { autor: 'sistema', usuario_id: agente.id, autor_nombre: agente.nombre, texto: 'El chat finalizó. ¡Gracias por escribirnos!' });
  let ticket = null;
  if (crearTicketSiHayContacto) ticket = await crearLeadDeChat(sql, rows[0], { autor: { id: agente.id, nombre: agente.nombre } });
  return { ok: true, ticket };
}

export async function actualizarContacto(sql, id, b) {
  const email = b.email ? normalizarEmail(b.email) : null;
  if (b.email && !email) return { error: 'El correo no parece válido', status: 400 };
  if (b.telefono && String(b.telefono).replace(/\D/g, '').length < 8) return { error: 'El teléfono no parece válido', status: 400 };
  const telefono = b.telefono ? normalizarTelefono(b.telefono) : null;
  const nombre = limpio(b.nombre, 80) || null;
  const { rows } = await sql.query(
    `UPDATE ch_sesiones SET nombre = COALESCE($2, nombre), email = COALESCE($3, email), telefono = COALESCE($4, telefono) WHERE id = $1 RETURNING id`, [id, nombre, email, telefono]);
  return rows[0] ? { ok: true } : { error: 'Chat no encontrado', status: 404 };
}

export async function ponerEtiquetas(sql, id, etiquetas) {
  const lista = [...new Set((Array.isArray(etiquetas) ? etiquetas : []).map((e) => limpio(e, 30)).filter(Boolean))].slice(0, 8);
  const { rows } = await sql.query('UPDATE ch_sesiones SET etiquetas = $2::jsonb WHERE id = $1 RETURNING id', [id, JSON.stringify(lista)]);
  return rows[0] ? { ok: true, etiquetas: lista } : { error: 'Chat no encontrado', status: 404 };
}

export async function enviarImagenEjecutivo(sql, id, b, agente) {
  const { rows } = await sql.query('SELECT estado, agente_id FROM ch_sesiones WHERE id = $1', [id]);
  const s = rows[0];
  if (!s) return { error: 'Chat no encontrado', status: 404 };
  if (s.estado !== 'activo' || s.agente_id !== agente.id) return { error: 'Toma el chat antes de enviar una imagen', status: 409 };
  const a = await guardarAdjunto(sql, id, b, 'agente');
  if (a.error) return a;
  await agregarMensaje(sql, id, { autor: 'agente', usuario_id: agente.id, autor_nombre: agente.nombre, texto: a.nombre, tipo: 'imagen', adjunto_id: a.id });
  return { ok: true };
}

export async function guardarRespuestaRapida(sql, b) {
  const titulo = limpio(b.titulo, 60); const texto = limpio(b.texto, 1000);
  if (!titulo || !texto) return { error: 'Falta el título o el texto', status: 400 };
  const id = entero(b.id);
  if (id) { const { rows } = await sql.query('UPDATE ch_respuestas_rapidas SET titulo = $2, texto = $3 WHERE id = $1 RETURNING id', [id, titulo, texto]); return rows[0] ? { ok: true } : { error: 'No encontrada', status: 404 }; }
  await sql.query('INSERT INTO ch_respuestas_rapidas (titulo, texto) VALUES ($1, $2)', [titulo, texto]);
  return { ok: true };
}

// ---------------- Lecturas de la bandeja ----------------
const VISTAS = {
  cola: { where: `s.estado = 'cola'`, orden: 's.cola_desde ASC' },
  mios: { where: `s.estado = 'activo' AND s.agente_id = $1`, orden: 's.ultimo_mensaje_en DESC' },
  activos: { where: `s.estado IN ('bot', 'cola', 'activo')`, orden: `CASE s.estado WHEN 'cola' THEN 0 WHEN 'activo' THEN 1 ELSE 2 END, s.ultimo_mensaje_en DESC` },
  cerrados: { where: `s.estado IN ('cerrado', 'perdido')`, orden: 's.cerrado_en DESC NULLS LAST' },
};
export async function listarSesiones(sql, yoId, { vista = 'activos', q = '' } = {}) {
  const v = VISTAS[vista] || VISTAS.activos;
  const params = [yoId];
  let filtro = '';
  const busca = limpio(q, 60);
  if (busca) { params.push('%' + busca.toLowerCase() + '%'); filtro = ` AND (lower(coalesce(s.nombre, '')) LIKE $2 OR lower(coalesce(s.email, '')) LIKE $2 OR coalesce(s.telefono, '') LIKE $2 OR lower(coalesce(s.datos->>'modelo', '')) LIKE $2)`; }
  const { rows } = await sql.query(
    `SELECT ${COLS_ADMIN}, COALESCE(NULLIF(u.nombre, ''), u.email) AS agente_nombre, (s.agente_id = $1::int) AS mio,
            (SELECT texto FROM ch_mensajes m WHERE m.sesion_id = s.id AND m.autor IN ('visitante', 'agente', 'bot') ORDER BY m.id DESC LIMIT 1) AS ultimo_texto,
            (SELECT autor FROM ch_mensajes m WHERE m.sesion_id = s.id AND m.autor IN ('visitante', 'agente', 'bot') ORDER BY m.id DESC LIMIT 1) AS ultimo_autor,
            (SELECT count(*) FROM ch_mensajes m WHERE m.sesion_id = s.id AND m.autor = 'visitante' AND m.id > s.ultimo_leido_agente)::int AS sin_leer
       FROM ch_sesiones s LEFT JOIN usuarios u ON u.id = s.agente_id
      WHERE ${v.where}${filtro} ORDER BY ${v.orden} LIMIT ${vista === 'cerrados' ? 100 : 200}`, params);
  return rows;
}
export async function contadores(sql, yoId) {
  const { rows } = await sql.query(
    `SELECT count(*) FILTER (WHERE estado = 'cola')::int AS cola,
            count(*) FILTER (WHERE estado = 'activo' AND agente_id = $1)::int AS mios,
            count(*) FILTER (WHERE estado IN ('bot', 'cola', 'activo'))::int AS activos,
            count(*) FILTER (WHERE estado = 'perdido' AND cerrado_en > now() - interval '24 hours')::int AS perdidos_24h
       FROM ch_sesiones WHERE creado_en > now() - interval '30 days'`, [yoId]);
  return rows[0];
}
export async function leerSesionAdmin(sql, id, desde = 0) {
  const { rows } = await sql.query(
    `SELECT ${COLS_ADMIN}, COALESCE(NULLIF(u.nombre, ''), u.email) AS agente_nombre, t.numero AS ticket_numero
       FROM ch_sesiones s LEFT JOIN usuarios u ON u.id = s.agente_id LEFT JOIN tickets t ON t.id = s.ticket_id WHERE s.id = $1`, [id]);
  const s = rows[0];
  if (!s) return null;
  const { rows: ms } = await sql.query(
    `SELECT id, autor, usuario_id, autor_nombre, texto, tipo, opciones, adjunto_id, imagen_url, creado_en FROM ch_mensajes WHERE sesion_id = $1 AND id > $2 ORDER BY id LIMIT 500`, [id, Number(desde) || 0]);
  const ultimo = ms.length ? ms[ms.length - 1].id : null;
  if (ultimo) await sql.query('UPDATE ch_sesiones SET ultimo_leido_agente = GREATEST(ultimo_leido_agente, $2) WHERE id = $1', [id, ultimo]);
  return { sesion: s, mensajes: ms, ultimo_id: ultimo ?? Number(desde) ?? 0 };
}

// Métricas por rango de fechas (día de Chile). Todo desde ch_sesiones: una consulta por tabla.
export async function metricas(sql, { desde, hasta } = {}) {
  const hoy = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const d2 = /^\d{4}-\d{2}-\d{2}$/.test(String(hasta || '')) ? hasta : fmt(hoy);
  const d1 = /^\d{4}-\d{2}-\d{2}$/.test(String(desde || '')) ? desde : fmt(new Date(hoy.getTime() - 29 * 86400000));
  const rango = `s.creado_en >= ($1::date)::timestamp AT TIME ZONE 'America/Santiago' AND s.creado_en < (($2::date) + 1)::timestamp AT TIME ZONE 'America/Santiago'`;
  const p = [d1, d2];
  const [tot, hora, agente, pagina, tipo, disp] = await Promise.all([
    sql.query(`SELECT count(*)::int AS chats,
        count(*) FILTER (WHERE s.estado = 'perdido')::int AS perdidos,
        count(*) FILTER (WHERE s.tomado_en IS NOT NULL)::int AS atendidos,
        count(*) FILTER (WHERE s.tomado_en IS NULL AND s.estado IN ('cerrado', 'perdido'))::int AS solo_asistente,
        count(*) FILTER (WHERE s.ticket_id IS NOT NULL)::int AS con_lead,
        count(*) FILTER (WHERE s.estado IN ('bot', 'cola', 'activo'))::int AS abiertos,
        round((percentile_cont(0.5) WITHIN GROUP (ORDER BY s.primera_respuesta_seg))::numeric)::int AS primera_respuesta_mediana_seg,
        round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (s.cerrado_en - s.creado_en))) FILTER (WHERE s.tomado_en IS NOT NULL AND s.cerrado_en IS NOT NULL))::numeric)::int AS duracion_mediana_seg
      FROM ch_sesiones s WHERE ${rango}`, p),
    sql.query(`SELECT extract(hour FROM s.creado_en AT TIME ZONE 'America/Santiago')::int AS hora, count(*)::int AS chats, count(*) FILTER (WHERE s.estado = 'perdido')::int AS perdidos
      FROM ch_sesiones s WHERE ${rango} GROUP BY 1 ORDER BY 1`, p),
    sql.query(`SELECT u.id, COALESCE(NULLIF(u.nombre, ''), u.email) AS nombre, count(*)::int AS chats,
        round((percentile_cont(0.5) WITHIN GROUP (ORDER BY s.primera_respuesta_seg))::numeric)::int AS primera_respuesta_mediana_seg
      FROM ch_sesiones s JOIN usuarios u ON u.id = s.agente_id WHERE ${rango} AND s.tomado_en IS NOT NULL GROUP BY u.id, 2 ORDER BY chats DESC`, p),
    sql.query(`SELECT split_part(coalesce(s.pagina_inicial, '(sin dato)'), '?', 1) AS pagina, count(*)::int AS chats, count(*) FILTER (WHERE s.tomado_en IS NOT NULL)::int AS atendidos
      FROM ch_sesiones s WHERE ${rango} GROUP BY 1 ORDER BY chats DESC LIMIT 15`, p),
    sql.query(`SELECT coalesce(s.datos->>'tipo', '(sin elegir)') AS tipo, count(*)::int AS chats FROM ch_sesiones s WHERE ${rango} GROUP BY 1 ORDER BY chats DESC`, p),
    sql.query(`SELECT coalesce(s.dispositivo, '(sin dato)') AS dispositivo, count(*)::int AS chats FROM ch_sesiones s WHERE ${rango} GROUP BY 1 ORDER BY chats DESC`, p),
  ]);
  return { desde: d1, hasta: d2, resumen: tot.rows[0], por_hora: hora.rows, por_agente: agente.rows, por_pagina: pagina.rows,
    por_tipo: tipo.rows.map((r) => ({ ...r, etiqueta: etiquetaTipo(r.tipo) || r.tipo })), por_dispositivo: disp.rows };
}

// ---------------- HTTP: recurso público (el widget del sitio) ----------------
export async function manejarChatPublico(req, res, { getSql }) {
  try {
    if (req.method === 'GET' && req.query.adjunto !== undefined) {
      const sql = await getSql(); await asegurarTablasChat(sql);
      const s = await sesionPorToken(sql, req.query.token);
      const id = entero(req.query.adjunto);
      if (!s || !id) return res.status(404).json({ error: 'Adjunto no encontrado' });
      return await servirAdjunto(sql, res, id, s.id);
    }
    const permitido = cabecerasCors(req, res);
    if (req.method === 'OPTIONS') return res.status(permitido ? 204 : 403).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (req.headers?.origin && !permitido) return res.status(403).json({ error: 'Origen no permitido' });
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const accion = String(b.accion || '');
    if (accion === 'iniciar') {
      const lim = limitarMemoria(`chat-iniciar:${ipCliente(req)}`, 10, 3600000);
      if (!lim.permitido) return res.status(429).json({ error: 'Hiciste varios intentos seguidos. Escríbenos por WhatsApp o prueba de nuevo en un rato.' });
    }
    const sql = await getSql();
    await asegurarTablasChat(sql);
    let r;
    if (accion === 'iniciar') { await cerrarInactivas(sql); r = await accionIniciar(sql, b, req); }
    else if (accion === 'leer') r = await accionLeer(sql, b);
    else if (accion === 'enviar') r = await accionEnviar(sql, b, req);
    else if (accion === 'adjunto') r = await accionAdjuntoVisitante(sql, b);
    else if (accion === 'cerrar') r = await accionCerrarVisitante(sql, b);
    else if (accion === 'estado') r = { ok: true, ejecutivos_en_linea: (await ejecutivosDisponibles(sql)) > 0 };
    else return res.status(400).json({ error: 'Acción no válida' });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    return res.status(200).json(r);
  } catch (err) {
    console.error('chat-publico error', err);
    return res.status(500).json({ error: 'No pudimos conectar el chat. Escríbenos por WhatsApp o intenta de nuevo en unos minutos.' });
  }
}

// ---------------- HTTP: recurso del ERP (la bandeja, con sesión) ----------------
export function configuracionPublica() {
  return { estados_agente: ESTADOS_AGENTE, tipos: TIPOS, max_chats_por_agente: MAX_CHATS_POR_AGENTE, cola_max_seg: COLA_MAX_SEG, asistente: NOMBRE_ASISTENTE };
}

export async function manejarChatAdmin(req, res, sesion, getSql) {
  try {
    const sql = await getSql();
    await asegurarTablasChat(sql);
    const yo = { id: sesion.uid ? Number(sesion.uid) : null, nombre: sesion.nombre || sesion.email };
    if (!yo.id) return res.status(400).json({ error: 'Usuario no válido' });

    if (req.method === 'GET') {
      if (req.query.adjunto !== undefined) {
        const id = entero(req.query.adjunto);
        if (!id) return res.status(404).json({ error: 'Adjunto no encontrado' });
        return await servirAdjunto(sql, res, id, null);
      }
      if (req.query.metricas !== undefined) return res.status(200).json(await metricas(sql, { desde: req.query.desde, hasta: req.query.hasta }));
      if (req.query.id !== undefined) {
        const id = entero(req.query.id);
        if (!id) return res.status(400).json({ error: 'Chat no válido' });
        const r = await leerSesionAdmin(sql, id, req.query.desde);
        return r ? res.status(200).json(r) : res.status(404).json({ error: 'Chat no encontrado' });
      }
      // Bandeja: una sola llamada que también hace de "latido" (avisa que este ejecutivo tiene la bandeja abierta).
      await latidoAgente(sql, yo.id);
      await cerrarInactivas(sql);
      const [sesiones, cont, agentes, miEstado, { rows: rapidas }] = await Promise.all([
        listarSesiones(sql, yo.id, { vista: String(req.query.vista || 'activos'), q: req.query.q }),
        contadores(sql, yo.id), listarAgentes(sql),
        sql.query('SELECT estado FROM ch_agentes_estado WHERE usuario_id = $1', [yo.id]),
        sql.query('SELECT id, titulo, texto FROM ch_respuestas_rapidas WHERE activo = true ORDER BY id'),
      ]);
      return res.status(200).json({ ahora: new Date().toISOString(), yo: { ...yo, estado: miEstado.rows[0]?.estado || 'desconectado' }, contadores: cont, sesiones, agentes, rapidas, config: configuracionPublica() });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const accion = String(b.accion || '');
      const id = entero(b.id);
      let r;
      if (accion === 'estado') r = await cambiarEstadoAgente(sql, yo.id, String(b.estado || ''));
      else if (accion === 'rapida_guardar') r = await guardarRespuestaRapida(sql, b);
      else if (accion === 'rapida_borrar') { await sql.query('UPDATE ch_respuestas_rapidas SET activo = false WHERE id = $1', [entero(b.id) || 0]); r = { ok: true }; }
      else if (!id) return res.status(400).json({ error: 'Falta el chat' });
      else if (accion === 'tomar') r = await tomarChat(sql, id, yo);
      else if (accion === 'responder') r = await responderChat(sql, id, b.texto, yo);
      else if (accion === 'nota') r = await notaInterna(sql, id, b.texto, yo);
      else if (accion === 'transferir') r = await transferirChat(sql, id, entero(b.agente_id), yo);
      else if (accion === 'cerrar') r = await cerrarChat(sql, id, yo, { crearTicketSiHayContacto: !!b.crear_ticket });
      else if (accion === 'contacto') r = await actualizarContacto(sql, id, b);
      else if (accion === 'etiquetas') r = await ponerEtiquetas(sql, id, b.etiquetas);
      else if (accion === 'adjunto') r = await enviarImagenEjecutivo(sql, id, b, yo);
      else if (accion === 'crear_ticket') {
        const { rows } = await sql.query('SELECT * FROM ch_sesiones WHERE id = $1', [id]);
        if (!rows[0]) return res.status(404).json({ error: 'Chat no encontrado' });
        const t = await crearLeadDeChat(sql, rows[0], { autor: { id: yo.id, nombre: yo.nombre } });
        r = t.error ? t : t.omitido === 'sin_contacto' ? { error: 'Falta un teléfono o un correo del cliente para crear el ticket', status: 400 }
          : { ok: true, ticket: t, yaExistia: t.omitido === 'ya_existe' };
      } else return res.status(400).json({ error: 'Acción no válida' });
      if (r.error) return res.status(r.status || 400).json({ error: r.error });
      return res.status(200).json({ ok: true, ...r });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('chat error', err);
    return res.status(200).json({ error: 'Error en el Chat en vivo', detail: String(err.message || err).slice(0, 300) });
  }
}

// /lib/tickets.js
// Módulo de Tickets del ERP (reemplazo de Zoho Desk, fase 1). Ver la especificación "Módulo de Tickets ERP IndexStore".
// Un ticket común (tabla tickets) + una tabla de detalle 1 a 1 por tipo (tk_leads, tk_postventa, tk_ordenes_servicio).
// Los agentes son los usuarios del ERP (tabla usuarios): no hay una tabla de agentes aparte.
// Las tablas llevan prefijo tk_ para no chocar con las que ya existen en el ERP (clientes de Bsale, cotizaciones, etc.).
// Sin imports de red ni de @vercel/postgres: recibe `sql` ya resuelto (patrón de lib/db.js).

import { unaVez } from './una-vez.js';

// ---------------- Listas cerradas ----------------
export const TIPOS = ['lead', 'postventa', 'servicio_tecnico'];
export const TIPO_ETIQUETA = { lead: 'Lead de venta', postventa: 'Postventa', servicio_tecnico: 'Servicio técnico' };

// Estados por tipo. `cierra` = el ticket queda cerrado; `sinResolucion` = cierra sin resolverse (se cuenta aparte en las métricas).
// Se mantienen los nombres que el equipo ya usa en Zoho. "abierto" es la entrada sin asignar.
export const ESTADOS = {
  lead: [
    { clave: 'abierto', etiqueta: 'Abierto' },
    { clave: 'cerrado_contactado', etiqueta: 'Contactado', cierra: true },
    { clave: 'cerrado_sin_datos', etiqueta: 'Sin datos de contacto', cierra: true, sinResolucion: true },
  ],
  postventa: [
    { clave: 'abierto', etiqueta: 'Abierto' },
    { clave: 'designado', etiqueta: 'Designado' },
    { clave: 'por_transferir', etiqueta: 'Por transferir' },
    { clave: 'cerrado', etiqueta: 'Cerrado', cierra: true },
    { clave: 'abandonado', etiqueta: 'Abandonado', cierra: true, sinResolucion: true },
  ],
  servicio_tecnico: [
    { clave: 'abierto', etiqueta: 'Recibido' },
    { clave: 'designado', etiqueta: 'Designado' },
    { clave: 'extension', etiqueta: 'Extensión' },
    { clave: 'por_retirar', etiqueta: 'Por retirar' },
    { clave: 'entregado', etiqueta: 'Entregado', cierra: true },
    { clave: 'cerrado', etiqueta: 'Cerrado', cierra: true, sinResolucion: true },
  ],
};
export const PRIORIDADES = ['baja', 'media', 'alta'];
export const ORIGENES = ['landing_pantallas', 'landing_cargadores', 'carrito_abandonado', 'zohobot', 'chat', 'nas', 'sitio_postventa', 'meson', 'telefono', 'whatsapp', 'correo', 'manual', 'migracion_zoho', 'otro'];
export const ORIGEN_ETIQUETA = {
  landing_pantallas: 'Landing pantallas', landing_cargadores: 'Landing cargadores', carrito_abandonado: 'Carrito abandonado', zohobot: 'ZohoBot', chat: 'Chat',
  nas: 'Formulario NAS', sitio_postventa: 'Formulario postventa', meson: 'Mesón', telefono: 'Teléfono', whatsapp: 'WhatsApp', correo: 'Correo', manual: 'Manual',
  migracion_zoho: 'Migración Zoho', otro: 'Otro',
};
export const CANALES_CONTACTO = ['whatsapp', 'correo', 'telefono'];
export const MOTIVOS_POSTVENTA = [
  { clave: 'problema_pedido_producto', etiqueta: 'Problemas de pedidos/productos' },
  { clave: 'cancelacion', etiqueta: 'Cancelación de compra' },
  { clave: 'seguimiento', etiqueta: 'Seguimiento de pedido' },
  { clave: 'cambio_direccion', etiqueta: 'Cambio de dirección' },
  { clave: 'otra', etiqueta: 'Otras consultas' },
];
export const TIPOS_PRODUCTO = [
  { clave: 'cargador', etiqueta: 'Cargador' }, { clave: 'bateria', etiqueta: 'Batería' }, { clave: 'pantalla', etiqueta: 'Pantalla' },
  { clave: 'vitrina', etiqueta: 'Vitrina' }, { clave: 'servicio', etiqueta: 'Servicio' }, { clave: 'otro', etiqueta: 'Otro' },
];
// Un ticket sin movimiento por tantas horas se resalta en la bandeja.
export const HORAS_SIN_MOVIMIENTO = 24;

const NUMERO_INICIAL_TICKET = 26633; // el correlativo continúa el de Zoho Desk (último: 26632)
const NUMERO_INICIAL_OS = 3162;      // órdenes de servicio: continúa el N° 3161 de Zoho (se usa en el paso de servicio técnico)

export function estadoDe(tipo, clave) { return (ESTADOS[tipo] || []).find((e) => e.clave === clave) || null; }
export function estadoInicial() { return 'abierto'; }

// ---------------- Normalización ----------------
// Teléfono chileno a formato +56XXXXXXXXX. Si no se reconoce, se devuelve lo que haya (solo dígitos y +).
export function normalizarTelefono(valor) {
  const d = String(valor ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 9 && d[0] === '9') return '+56' + d;
  if (d.length === 8) return '+569' + d;
  if (d.length === 11 && d.startsWith('56')) return '+' + d;
  if (d.length === 12 && d.startsWith('569')) return '+' + d.slice(0, 11);
  if (d.length === 9) return '+56' + d;
  return '+' + d;
}
export function normalizarEmail(valor) {
  const e = String(valor ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.slice(0, 200) : null;
}
export function ultimos9(valor) { return String(valor ?? '').replace(/\D/g, '').slice(-9); }
function texto(v, max = 500) { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null; }
function textoLargo(v, max = 4000) { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; }
function entre(v, lista, defecto = null) { return lista.includes(v) ? v : defecto; }
function claveDe(lista, v) { return (Array.isArray(lista) && lista.some((x) => x && x.clave) ? lista.map((x) => x.clave) : lista).includes(v) ? v : null; }

// "Caragdor" -> cargador: el tipo de producto era texto libre en Zoho; acá es una lista cerrada. Se usa también en la migración.
export function normalizarTipoProducto(valor) {
  const t = String(valor ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (!t) return null;
  if (/carg|cagr|charg|^c[a-z]{0,3}gd/.test(t)) return 'cargador';
  if (/bat|bater/.test(t)) return 'bateria';
  if (/pant|displ|screen|lcd|led/.test(t)) return 'pantalla';
  if (/vitrin/.test(t)) return 'vitrina';
  if (/serv|repar|tecn/.test(t)) return 'servicio';
  return 'otro';
}

// ---------------- Migraciones ----------------
export async function asegurarTablasTickets(sql) { return unaVez('asegurarTablasTickets', () => _asegurarTablasTickets(sql)); }
async function _asegurarTablasTickets(sql) {
  await sql.query(`CREATE SEQUENCE IF NOT EXISTS tk_ticket_numero_seq START ${NUMERO_INICIAL_TICKET}`);
  await sql.query(`CREATE SEQUENCE IF NOT EXISTS tk_os_numero_seq START ${NUMERO_INICIAL_OS}`);
  await sql`CREATE TABLE IF NOT EXISTS tk_clientes (
    id SERIAL PRIMARY KEY, rut TEXT, nombre TEXT, email TEXT, telefono TEXT, telefono9 TEXT,
    shopify_customer_id TEXT, bsale_client_id TEXT, zoho_contact_id TEXT, creado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  await sql`CREATE INDEX IF NOT EXISTS tk_clientes_email_idx ON tk_clientes (email);`;
  await sql`CREATE INDEX IF NOT EXISTS tk_clientes_tel9_idx ON tk_clientes (telefono9);`;
  await sql`CREATE INDEX IF NOT EXISTS tk_clientes_rut_idx ON tk_clientes (rut);`;
  await sql.query(`CREATE TABLE IF NOT EXISTS tickets (
    id SERIAL PRIMARY KEY, numero INTEGER NOT NULL UNIQUE DEFAULT nextval('tk_ticket_numero_seq'),
    tipo TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'abierto', prioridad TEXT NOT NULL DEFAULT 'media',
    cliente_id INTEGER REFERENCES tk_clientes(id) ON DELETE SET NULL, agente_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    origen TEXT NOT NULL DEFAULT 'manual', asunto TEXT, descripcion TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(), actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_movimiento_en TIMESTAMPTZ NOT NULL DEFAULT now(), cerrado_en TIMESTAMPTZ, zoho_ticket_id TEXT UNIQUE)`);
  await sql`CREATE INDEX IF NOT EXISTS tickets_tipo_estado_idx ON tickets (tipo, estado);`;
  await sql`CREATE INDEX IF NOT EXISTS tickets_agente_estado_idx ON tickets (agente_id, estado);`;
  await sql`CREATE INDEX IF NOT EXISTS tickets_cliente_idx ON tickets (cliente_id);`;
  await sql`CREATE INDEX IF NOT EXISTS tickets_creado_idx ON tickets (creado_en DESC);`;
  await sql`CREATE TABLE IF NOT EXISTS tk_leads (
    ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE, producto_interes TEXT, origen_detalle TEXT,
    canal_contacto TEXT, shopify_checkout_id TEXT, monto_estimado NUMERIC);`;
  // Página, campaña y gclid con los que llegó el lead (sirve para medir qué anuncios traen leads reales y, más adelante, subir la conversión).
  await sql`ALTER TABLE tk_leads ADD COLUMN IF NOT EXISTS atribucion JSONB;`;
  await sql`CREATE INDEX IF NOT EXISTS tk_leads_checkout_idx ON tk_leads (shopify_checkout_id);`;
  await sql`CREATE TABLE IF NOT EXISTS tk_postventa (
    ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE, motivo TEXT, tipo_producto TEXT, shopify_order_id TEXT, numero_pedido TEXT,
    bsale_document_id TEXT, numero_documento TEXT, nota_credito_numero TEXT, resolucion TEXT, resumen_resolucion TEXT);`;
  await sql`CREATE INDEX IF NOT EXISTS tk_postventa_shopify_idx ON tk_postventa (shopify_order_id);`;
  await sql`CREATE TABLE IF NOT EXISTS tk_servicios (
    codigo TEXT PRIMARY KEY, nombre TEXT NOT NULL, precio_clp INTEGER, tiempo_estimado_h NUMERIC, activo BOOLEAN NOT NULL DEFAULT true);`;
  await sql`CREATE TABLE IF NOT EXISTS tk_ordenes_servicio (
    ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE, numero_os INTEGER UNIQUE, servicio_codigo TEXT REFERENCES tk_servicios(codigo),
    equipo_tipo TEXT, marca TEXT, modelo TEXT, numero_serie TEXT, accesorios_recibidos TEXT, motivo_ingreso TEXT, diagnostico TEXT,
    retiro_inmediato BOOLEAN NOT NULL DEFAULT false, presupuesto_clp INTEGER, aprobado_cliente BOOLEAN, bsale_document_id TEXT,
    fecha_entrega_estimada DATE, fecha_entrega DATE);`;
  await sql`CREATE TABLE IF NOT EXISTS tk_eventos (
    id SERIAL PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, tipo TEXT NOT NULL,
    autor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL, autor_nombre TEXT, contenido TEXT, estado_anterior TEXT, estado_nuevo TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  await sql`CREATE INDEX IF NOT EXISTS tk_eventos_ticket_idx ON tk_eventos (ticket_id, creado_en);`;
  // Adjuntos guardados en la propia base (bytea): sin servicio de archivos aparte. Tope por archivo: ver MAX_ADJUNTO_BYTES.
  await sql`CREATE TABLE IF NOT EXISTS tk_adjuntos (
    id SERIAL PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, evento_id INTEGER REFERENCES tk_eventos(id) ON DELETE SET NULL,
    nombre TEXT NOT NULL, mime TEXT, bytes INTEGER NOT NULL, contenido BYTEA NOT NULL, autor_nombre TEXT, creado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  await sql`CREATE INDEX IF NOT EXISTS tk_adjuntos_ticket_idx ON tk_adjuntos (ticket_id);`;
}

// ---------------- Adjuntos ----------------
// Vercel limita el cuerpo de una petición a 4,5 MB y el archivo viaja en base64 (+33%): 3 MB reales es el máximo seguro.
// La página reduce las fotos antes de subirlas.
export const MAX_ADJUNTO_BYTES = 3 * 1024 * 1024;
const MIME_INLINE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'];
export async function agregarAdjunto(sql, id, { nombre, mime, datos }, autor) {
  const n = String(nombre || 'archivo').replace(/[\\/\r\n"]/g, '_').slice(0, 150);
  const b64 = String(datos || '').replace(/^data:[^,]*,/, '');
  if (!b64) return { error: 'Falta el archivo', status: 400 };
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return { error: 'El archivo está vacío', status: 400 };
  if (buf.length > MAX_ADJUNTO_BYTES) return { error: 'El archivo pesa más de 3 MB', status: 413 };
  const { rows } = await sql.query('UPDATE tickets SET actualizado_en = now(), ultimo_movimiento_en = now() WHERE id = $1 RETURNING id', [id]);
  if (!rows[0]) return { error: 'Ticket no encontrado', status: 404 };
  const m = MIME_INLINE.includes(String(mime)) ? String(mime) : 'application/octet-stream';
  const { rows: ev } = await sql.query(
    `INSERT INTO tk_eventos (ticket_id, tipo, autor_id, autor_nombre, contenido) VALUES ($1, 'adjunto', $2, $3, $4) RETURNING id`, [id, autor?.id ?? null, autor?.nombre ?? null, n]);
  await sql.query('INSERT INTO tk_adjuntos (ticket_id, evento_id, nombre, mime, bytes, contenido, autor_nombre) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, ev[0].id, n, m, buf.length, buf, autor?.nombre ?? null]);
  return { ok: true };
}
export async function leerAdjunto(sql, adjuntoId) {
  const { rows } = await sql.query('SELECT nombre, mime, contenido FROM tk_adjuntos WHERE id = $1', [adjuntoId]);
  return rows[0] || null;
}
export function esMimeInline(m) { return MIME_INLINE.includes(m); }

// ---------------- Clientes ----------------
// Busca por email o por los últimos 9 dígitos del teléfono; si no existe lo crea. Completa los datos que le falten a un cliente existente.
export async function buscarOCrearCliente(sql, d) {
  const email = normalizarEmail(d.email);
  const telefono = normalizarTelefono(d.telefono);
  const tel9 = telefono ? ultimos9(telefono) : '';
  const nombre = texto(d.nombre, 200);
  const rut = texto(d.rut, 20);
  if (!email && !tel9 && !nombre && !rut) return null;
  let fila = null;
  if (email || tel9) {
    const { rows } = await sql.query(
      'SELECT * FROM tk_clientes WHERE ($1::text IS NOT NULL AND email = $1) OR ($2::text <> \'\' AND telefono9 = $2) ORDER BY id LIMIT 1',
      [email, tel9]);
    fila = rows[0] || null;
  }
  if (fila) {
    const { rows } = await sql.query(
      `UPDATE tk_clientes SET nombre = COALESCE(nombre, $2), email = COALESCE(email, $3), telefono = COALESCE(telefono, $4), telefono9 = COALESCE(NULLIF(telefono9, ''), $5),
              rut = COALESCE(rut, $6) WHERE id = $1 RETURNING *`,
      [fila.id, nombre, email, telefono, tel9 || null, rut]);
    return rows[0];
  }
  const { rows } = await sql.query(
    'INSERT INTO tk_clientes (nombre, email, telefono, telefono9, rut) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [nombre, email, telefono, tel9 || null, rut]);
  return rows[0];
}

// ---------------- Eventos ----------------
export async function registrarEvento(sql, ticketId, { tipo, autor, contenido = null, estadoAnterior = null, estadoNuevo = null }) {
  await sql.query(
    'INSERT INTO tk_eventos (ticket_id, tipo, autor_id, autor_nombre, contenido, estado_anterior, estado_nuevo) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [ticketId, tipo, autor?.id ?? null, autor?.nombre ?? null, contenido, estadoAnterior, estadoNuevo]);
}

// ---------------- Crear ----------------
// Punto único de entrada de todo ticket (formularios, webhooks, ingreso manual). Valida, busca o crea el cliente y registra el origen.
// `datos`: { tipo, cliente: {nombre,email,telefono,rut}, asunto, descripcion, prioridad, origen, agente_id, lead:{...}, postventa:{...} }
export async function crearTicket(sql, datos, autor = null) {
  const tipo = entre(datos.tipo, TIPOS);
  if (!tipo) return { error: 'Tipo de ticket no válido', status: 400 };
  const origen = entre(datos.origen, ORIGENES, 'manual');
  const c = datos.cliente || {};
  const cliente = await buscarOCrearCliente(sql, c);
  const asunto = texto(datos.asunto, 200) || (tipo === 'lead' ? `Consulta de ${cliente?.nombre || 'cliente'}` : null);
  if (!asunto) return { error: 'Falta el asunto del ticket', status: 400 };
  const prioridad = entre(datos.prioridad, PRIORIDADES, 'media');
  const agenteId = Number.isInteger(Number(datos.agente_id)) && Number(datos.agente_id) > 0 ? Number(datos.agente_id) : null;
  const { rows } = await sql.query(
    `INSERT INTO tickets (tipo, estado, prioridad, cliente_id, agente_id, origen, asunto, descripcion, zoho_ticket_id, creado_en)
     VALUES ($1, 'abierto', $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now())) RETURNING *`,
    [tipo, prioridad, cliente?.id ?? null, agenteId, origen, asunto, textoLargo(datos.descripcion), texto(datos.zoho_ticket_id, 40), datos.creado_en || null]);
  const t = rows[0];
  if (tipo === 'lead') {
    const l = datos.lead || {};
    await sql.query(
      'INSERT INTO tk_leads (ticket_id, producto_interes, origen_detalle, canal_contacto, shopify_checkout_id, monto_estimado, atribucion) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)',
      [t.id, texto(l.producto_interes, 200), entre(l.origen_detalle, ORIGENES, origen), entre(l.canal_contacto, CANALES_CONTACTO), texto(l.shopify_checkout_id, 80),
        Number.isFinite(Number(l.monto_estimado)) && l.monto_estimado !== '' && l.monto_estimado != null ? Number(l.monto_estimado) : null,
        l.atribucion && Object.keys(l.atribucion).length ? JSON.stringify(l.atribucion) : null]);
  } else if (tipo === 'postventa') {
    const p = datos.postventa || {};
    await sql.query(
      'INSERT INTO tk_postventa (ticket_id, motivo, tipo_producto, shopify_order_id, numero_pedido, numero_documento) VALUES ($1, $2, $3, $4, $5, $6)',
      [t.id, claveDe(MOTIVOS_POSTVENTA, p.motivo), claveDe(TIPOS_PRODUCTO, p.tipo_producto) || normalizarTipoProducto(p.tipo_producto), texto(p.shopify_order_id, 40), texto(p.numero_pedido, 40), texto(p.numero_documento, 40)]);
  }
  // (servicio_tecnico: su detalle se crea en el paso de órdenes de servicio)
  await registrarEvento(sql, t.id, { tipo: 'cambio_estado', autor, contenido: 'Ticket creado', estadoNuevo: 'abierto' });
  if (t.agente_id) await registrarEvento(sql, t.id, { tipo: 'asignacion', autor, contenido: 'Asignado al crear' });
  return { ok: true, ticket: t };
}

// ---------------- Cambios ----------------
export async function cambiarEstado(sql, id, nuevo, autor, { canal = null, nota = null } = {}) {
  const { rows } = await sql.query('SELECT * FROM tickets WHERE id = $1', [id]);
  const t = rows[0];
  if (!t) return { error: 'Ticket no encontrado', status: 404 };
  const est = estadoDe(t.tipo, nuevo);
  if (!est) return { error: 'Estado no válido para este tipo de ticket', status: 400 };
  if (t.estado === nuevo) return { ok: true, ticket: t, sinCambio: true };
  if (t.tipo === 'lead' && nuevo === 'cerrado_contactado') {
    const canalOk = entre(canal, CANALES_CONTACTO);
    if (!canalOk) return { error: 'Indica por qué canal se contactó (WhatsApp, correo o teléfono)', status: 400 };
    await sql.query('UPDATE tk_leads SET canal_contacto = $2 WHERE ticket_id = $1', [id, canalOk]);
  }
  const { rows: r2 } = await sql.query(
    `UPDATE tickets SET estado = $2, actualizado_en = now(), ultimo_movimiento_en = now(), cerrado_en = CASE WHEN $3 THEN COALESCE(cerrado_en, now()) ELSE NULL END
     WHERE id = $1 RETURNING *`, [id, nuevo, !!est.cierra]);
  await registrarEvento(sql, id, { tipo: 'cambio_estado', autor, contenido: texto(nota, 1000), estadoAnterior: t.estado, estadoNuevo: nuevo });
  return { ok: true, ticket: r2[0] };
}

export async function asignarAgente(sql, id, agenteId, autor) {
  const { rows } = await sql.query('SELECT id, agente_id FROM tickets WHERE id = $1', [id]);
  if (!rows[0]) return { error: 'Ticket no encontrado', status: 404 };
  let nombre = 'Sin asignar';
  if (agenteId != null) {
    const { rows: u } = await sql.query('SELECT id, COALESCE(NULLIF(nombre, \'\'), email) AS nombre FROM usuarios WHERE id = $1 AND activo = true', [agenteId]);
    if (!u[0]) return { error: 'Agente no válido', status: 400 };
    nombre = u[0].nombre;
  }
  if ((rows[0].agente_id ?? null) === (agenteId ?? null)) return { ok: true, sinCambio: true };
  const { rows: r2 } = await sql.query('UPDATE tickets SET agente_id = $2, actualizado_en = now(), ultimo_movimiento_en = now() WHERE id = $1 RETURNING *', [id, agenteId]);
  await registrarEvento(sql, id, { tipo: 'asignacion', autor, contenido: agenteId == null ? 'Asignación quitada' : `Asignado a ${nombre}` });
  return { ok: true, ticket: r2[0] };
}

export async function agregarComentario(sql, id, contenido, autor, tipo = 'comentario_interno') {
  const c = textoLargo(contenido, 4000);
  if (!c) return { error: 'El comentario está vacío', status: 400 };
  const { rows } = await sql.query('UPDATE tickets SET actualizado_en = now(), ultimo_movimiento_en = now() WHERE id = $1 RETURNING id', [id]);
  if (!rows[0]) return { error: 'Ticket no encontrado', status: 404 };
  await registrarEvento(sql, id, { tipo: entre(tipo, ['comentario_interno', 'contacto_cliente'], 'comentario_interno'), autor, contenido: c });
  return { ok: true };
}

export async function cambiarPrioridad(sql, id, prioridad, autor) {
  const p = entre(prioridad, PRIORIDADES);
  if (!p) return { error: 'Prioridad no válida', status: 400 };
  const { rows } = await sql.query('UPDATE tickets SET prioridad = $2, actualizado_en = now() WHERE id = $1 RETURNING *', [id, p]);
  if (!rows[0]) return { error: 'Ticket no encontrado', status: 404 };
  await registrarEvento(sql, id, { tipo: 'actualizacion', autor, contenido: `Prioridad cambiada a ${p}` });
  return { ok: true, ticket: rows[0] };
}

// Campos propios del tipo (producto de interés, motivo, pedido, etc.), editables desde el detalle.
export async function actualizarDetalle(sql, id, cambios, autor) {
  const { rows } = await sql.query('SELECT id, tipo FROM tickets WHERE id = $1', [id]);
  const t = rows[0];
  if (!t) return { error: 'Ticket no encontrado', status: 404 };
  const c = cambios || {};
  if (t.tipo === 'lead') {
    await sql.query(
      `UPDATE tk_leads SET producto_interes = COALESCE($2, producto_interes), canal_contacto = COALESCE($3, canal_contacto) WHERE ticket_id = $1`,
      [id, 'producto_interes' in c ? texto(c.producto_interes, 200) : null, entre(c.canal_contacto, CANALES_CONTACTO)]);
  } else if (t.tipo === 'postventa') {
    await sql.query(
      `UPDATE tk_postventa SET motivo = COALESCE($2, motivo), tipo_producto = COALESCE($3, tipo_producto), numero_pedido = COALESCE($4, numero_pedido),
              numero_documento = COALESCE($5, numero_documento), resumen_resolucion = COALESCE($6, resumen_resolucion) WHERE ticket_id = $1`,
      [id, claveDe(MOTIVOS_POSTVENTA, c.motivo), claveDe(TIPOS_PRODUCTO, c.tipo_producto), 'numero_pedido' in c ? texto(c.numero_pedido, 40) : null,
        'numero_documento' in c ? texto(c.numero_documento, 40) : null, 'resumen_resolucion' in c ? textoLargo(c.resumen_resolucion, 2000) : null]);
  }
  await sql.query('UPDATE tickets SET actualizado_en = now() WHERE id = $1', [id]);
  await registrarEvento(sql, id, { tipo: 'actualizacion', autor, contenido: 'Datos del ticket actualizados' });
  return { ok: true };
}

// ---------------- Consultas ----------------
const SELECT_LISTA = `
  SELECT t.id, t.numero, t.tipo, t.estado, t.prioridad, t.origen, t.asunto, t.creado_en, t.actualizado_en, t.ultimo_movimiento_en, t.cerrado_en,
         t.agente_id, COALESCE(NULLIF(u.nombre, ''), u.email) AS agente_nombre,
         c.id AS cliente_id, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.email AS cliente_email,
         l.producto_interes, p.tipo_producto, p.numero_pedido, p.motivo
  FROM tickets t
  LEFT JOIN usuarios u ON u.id = t.agente_id
  LEFT JOIN tk_clientes c ON c.id = t.cliente_id
  LEFT JOIN tk_leads l ON l.ticket_id = t.id
  LEFT JOIN tk_postventa p ON p.ticket_id = t.id`;

function cierraEstado(tipo, clave) { const e = estadoDe(tipo, clave); return !!(e && e.cierra); }
function marcarFlags(f) {
  const cerrado = cierraEstado(f.tipo, f.estado);
  const horas = (Date.now() - new Date(f.ultimo_movimiento_en).getTime()) / 3600000;
  return { ...f, cerrado, sin_asignar: !cerrado && !f.agente_id, sin_movimiento: !cerrado && horas >= HORAS_SIN_MOVIMIENTO };
}

export async function listarTickets(sql, q = {}, sesion = null) {
  const where = []; const params = [];
  const p = (v) => { params.push(v); return '$' + params.length; };
  const aplicarComunes = () => {
    if (entre(q.tipo, TIPOS)) where.push(`t.tipo = ${p(q.tipo)}`);
    if (q.agente === 'sin') where.push('t.agente_id IS NULL');
    else if (q.agente === 'yo' && sesion?.uid) where.push(`t.agente_id = ${p(Number(sesion.uid))}`);
    else if (Number.isInteger(Number(q.agente)) && Number(q.agente) > 0) where.push(`t.agente_id = ${p(Number(q.agente))}`);
    if (entre(q.origen, ORIGENES)) where.push(`t.origen = ${p(q.origen)}`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.desde || '')) where.push(`t.creado_en >= (${p(q.desde)}::date)::timestamp AT TIME ZONE 'America/Santiago'`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.hasta || '')) where.push(`t.creado_en < ((${p(q.hasta)}::date + 1)::timestamp AT TIME ZONE 'America/Santiago')`);
    const busca = String(q.q || '').trim().slice(0, 80);
    if (busca) {
      const like = p('%' + busca.replace(/[%_\\]/g, (m) => '\\' + m) + '%');
      const dig = busca.replace(/\D/g, '');
      const condNum = /^\d{3,}$/.test(busca) ? ` OR t.numero::text = ${p(busca)}` : '';
      const condTel = dig.length >= 6 ? ` OR c.telefono9 LIKE ${p('%' + dig.slice(-9) + '%')}` : '';
      where.push(`(t.asunto ILIKE ${like} OR c.nombre ILIKE ${like} OR c.email ILIKE ${like} OR p.numero_pedido ILIKE ${like}${condNum}${condTel})`);
    }
  };
  aplicarComunes();
  const baseWhere = where.slice(); const baseParams = params.slice();
  // Los contadores por estado se calculan con todos los filtros MENOS el de estado.
  const { rows: cuentas } = await sql.query(
    `SELECT t.tipo, t.estado, count(*)::int AS n FROM tickets t LEFT JOIN tk_clientes c ON c.id = t.cliente_id LEFT JOIN tk_postventa p ON p.ticket_id = t.id
     ${baseWhere.length ? 'WHERE ' + baseWhere.join(' AND ') : ''} GROUP BY t.tipo, t.estado`, baseParams);
  if (q.estado === 'abiertos' || q.estado === 'cerrados') {
    const quiereCerrados = q.estado === 'cerrados';
    const pares = []; for (const tipo of TIPOS) for (const e of ESTADOS[tipo]) if (!!e.cierra === quiereCerrados) pares.push([tipo, e.clave]);
    where.push('(' + pares.map(([tp, es]) => `(t.tipo = ${p(tp)} AND t.estado = ${p(es)})`).join(' OR ') + ')');
  } else if (q.estado && q.estado !== 'todos') where.push(`t.estado = ${p(String(q.estado))}`);
  const limite = Math.min(Math.max(parseInt(q.limite, 10) || 300, 1), 1000);
  const { rows } = await sql.query(
    `${SELECT_LISTA} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.creado_en DESC LIMIT ${limite}`, params);
  const tickets = rows.map(marcarFlags);
  const porEstado = {}; let total = 0;
  for (const c of cuentas) { porEstado[c.estado] = (porEstado[c.estado] || 0) + c.n; total += c.n; }
  let abiertosTotal = 0, sinAsignar = 0, sinMovimiento = 0;
  const { rows: pend } = await sql.query(`SELECT t.tipo, t.estado, t.agente_id, t.ultimo_movimiento_en FROM tickets t`);
  for (const r of pend) {
    if (cierraEstado(r.tipo, r.estado)) continue;
    abiertosTotal++;
    if (!r.agente_id) sinAsignar++;
    if ((Date.now() - new Date(r.ultimo_movimiento_en).getTime()) / 3600000 >= HORAS_SIN_MOVIMIENTO) sinMovimiento++;
  }
  return { tickets, contadores: { porEstado, total, abiertos: abiertosTotal, sinAsignar, sinMovimiento }, truncado: rows.length >= limite };
}

export async function leerTicket(sql, id) {
  const { rows } = await sql.query(`${SELECT_LISTA} WHERE t.id = $1`, [id]);
  if (!rows[0]) return null;
  const base = marcarFlags(rows[0]);
  const { rows: tk } = await sql.query('SELECT descripcion, zoho_ticket_id FROM tickets WHERE id = $1', [id]);
  const { rows: cli } = base.cliente_id ? await sql.query('SELECT * FROM tk_clientes WHERE id = $1', [base.cliente_id]) : { rows: [] };
  const { rows: lead } = await sql.query('SELECT * FROM tk_leads WHERE ticket_id = $1', [id]);
  const { rows: pv } = await sql.query('SELECT * FROM tk_postventa WHERE ticket_id = $1', [id]);
  const { rows: ev } = await sql.query('SELECT id, tipo, autor_nombre, contenido, estado_anterior, estado_nuevo, creado_en FROM tk_eventos WHERE ticket_id = $1 ORDER BY creado_en, id', [id]);
  const { rows: otros } = base.cliente_id
    ? await sql.query('SELECT id, numero, tipo, estado, asunto, creado_en FROM tickets WHERE cliente_id = $1 AND id <> $2 ORDER BY creado_en DESC LIMIT 15', [base.cliente_id, id])
    : { rows: [] };
  const { rows: adj } = await sql.query('SELECT id, evento_id, nombre, mime, bytes, autor_nombre, creado_en FROM tk_adjuntos WHERE ticket_id = $1 ORDER BY creado_en', [id]);
  // Desde cuándo está el ticket en su estado actual (la "espera" de Zoho) y quiénes interactuaron.
  const ultimoCambio = [...ev].reverse().find((e) => e.tipo === 'cambio_estado');
  const enEstadoDesde = ultimoCambio ? ultimoCambio.creado_en : base.creado_en;
  const primerContacto = ev.find((e) => e.tipo === 'contacto_cliente');
  const personasMap = new Map();
  for (const e of ev) { if (e.autor_nombre) personasMap.set(e.autor_nombre, (personasMap.get(e.autor_nombre) || 0) + 1); }
  const personas = [...personasMap].map(([nombre, acciones]) => ({ nombre, acciones })).sort((a, b) => b.acciones - a.acciones);
  return { ...base, descripcion: tk[0]?.descripcion || null, zoho_ticket_id: tk[0]?.zoho_ticket_id || null, cliente: cli[0] || null, lead: lead[0] || null, postventa: pv[0] || null,
    eventos: ev, otrosTickets: otros, adjuntos: adj, en_estado_desde: enEstadoDesde, primer_contacto_en: primerContacto ? primerContacto.creado_en : null, personas };
}

export async function listarAgentes(sql) {
  const { rows } = await sql.query(`SELECT id, COALESCE(NULLIF(nombre, ''), email) AS nombre FROM usuarios WHERE activo = true ORDER BY COALESCE(NULLIF(nombre, ''), email)`);
  return rows;
}

export function configuracionPublica() {
  return { tipos: TIPOS.map((t) => ({ clave: t, etiqueta: TIPO_ETIQUETA[t] })), estados: ESTADOS, prioridades: PRIORIDADES, origenes: ORIGENES.map((o) => ({ clave: o, etiqueta: ORIGEN_ETIQUETA[o] })),
    motivosPostventa: MOTIVOS_POSTVENTA, tiposProducto: TIPOS_PRODUCTO, canalesContacto: CANALES_CONTACTO, horasSinMovimiento: HORAS_SIN_MOVIMIENTO };
}

// ---------------- Manejador del recurso `tickets` (sesión) ----------------
// GET ?id=N -> detalle; GET -> bandeja con filtros (tipo, estado, agente, origen, desde, hasta, q).
// POST { accion: crear | estado | asignar | comentario | prioridad | detalle | contacto, id, ... }.
export async function manejarTickets(req, res, sesion, getSql) {
  try {
    const sql = await getSql();
    await asegurarTablasTickets(sql);
    const autor = { id: sesion.uid ? Number(sesion.uid) : null, nombre: sesion.nombre || sesion.email };

    if (req.method === 'GET') {
      if (req.query.adjunto !== undefined) {
        const a = Number.isInteger(Number(req.query.adjunto)) ? await leerAdjunto(sql, Number(req.query.adjunto)) : null;
        if (!a) return res.status(404).json({ error: 'Adjunto no encontrado' });
        const inline = esMimeInline(a.mime);
        res.setHeader('Content-Type', inline ? a.mime : 'application/octet-stream');
        res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.status(200).send(a.contenido);
      }
      if (req.query.id !== undefined) {
        const id = Number(req.query.id);
        if (!Number.isInteger(id)) return res.status(400).json({ error: 'Ticket no válido' });
        const t = await leerTicket(sql, id);
        return t ? res.status(200).json({ ticket: t }) : res.status(404).json({ error: 'Ticket no encontrado' });
      }
      const [lista, agentes] = await Promise.all([listarTickets(sql, req.query, sesion), listarAgentes(sql)]);
      return res.status(200).json({ ...lista, agentes, config: configuracionPublica(), yo: autor.id });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const accion = String(b.accion || 'crear');
      const id = Number(b.id);
      let r;
      if (accion === 'crear') r = await crearTicket(sql, { ...b, origen: b.origen || 'manual' }, autor);
      else if (!Number.isInteger(id)) return res.status(400).json({ error: 'Falta el ticket' });
      else if (accion === 'estado') r = await cambiarEstado(sql, id, String(b.estado || ''), autor, { canal: b.canal, nota: b.nota });
      else if (accion === 'asignar') r = await asignarAgente(sql, id, b.agente_id == null || b.agente_id === '' ? null : Number(b.agente_id), autor);
      else if (accion === 'comentario') r = await agregarComentario(sql, id, b.contenido, autor, 'comentario_interno');
      else if (accion === 'contacto') r = await agregarComentario(sql, id, b.contenido, autor, 'contacto_cliente');
      else if (accion === 'prioridad') r = await cambiarPrioridad(sql, id, b.prioridad, autor);
      else if (accion === 'detalle') r = await actualizarDetalle(sql, id, b, autor);
      else if (accion === 'adjunto') r = await agregarAdjunto(sql, id, b, autor);
      else return res.status(400).json({ error: 'Acción no válida' });
      if (r.error) return res.status(r.status || 400).json({ error: r.error });
      const ticketId = accion === 'crear' ? r.ticket.id : id;
      return res.status(200).json({ ok: true, ticket: await leerTicket(sql, ticketId) });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(200).json({ error: 'Error en Tickets', detail: String(err.message || err).slice(0, 300) });
  }
}

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
  // Migración desde Zoho Desk (ver lib/tickets-zoho.js): N° y departamento de origen y cuándo se copió por última vez.
  await sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_numero INTEGER;`;
  await sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_dept_id TEXT;`;
  await sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_sync_en TIMESTAMPTZ;`;
  await sql`CREATE INDEX IF NOT EXISTS tickets_zoho_dept_idx ON tickets (zoho_dept_id);`;
  // Respaldo de las conversaciones de Zoho: cuántos hilos y comentarios tenía el ticket, cuándo se copiaron, y la referencia de cada mensaje (para no duplicarlo al repetir).
  await sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_hilos_n INTEGER;`;
  await sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS zoho_hilos_en TIMESTAMPTZ;`;
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
  await sql`ALTER TABLE tk_eventos ADD COLUMN IF NOT EXISTS zoho_ref TEXT;`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS tk_eventos_zoho_ref_idx ON tk_eventos (ticket_id, zoho_ref) WHERE zoho_ref IS NOT NULL;`;
  // Adjuntos guardados en la propia base (bytea): sin servicio de archivos aparte. Tope por archivo: ver MAX_ADJUNTO_BYTES.
  await sql`CREATE TABLE IF NOT EXISTS tk_adjuntos (
    id SERIAL PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE, evento_id INTEGER REFERENCES tk_eventos(id) ON DELETE SET NULL,
    nombre TEXT NOT NULL, mime TEXT, bytes INTEGER NOT NULL, contenido BYTEA NOT NULL, autor_nombre TEXT, creado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  await sql`CREATE INDEX IF NOT EXISTS tk_adjuntos_ticket_idx ON tk_adjuntos (ticket_id);`;
  await sql`CREATE TABLE IF NOT EXISTS tk_config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL, actualizado_por TEXT, actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  await sql`CREATE INDEX IF NOT EXISTS tk_os_numero_idx ON tk_ordenes_servicio (numero_os);`;
  // Catálogo inicial con los códigos SER más usados en Zoho (nombre según el análisis del historial; sin precio: se completa en "Catálogo de servicios").
  const { rows: hay } = await sql`SELECT 1 FROM tk_servicios LIMIT 1;`;
  if (!hay.length) {
    for (const [codigo, nombre] of [['SER003', 'Formateo'], ['SER009', 'Limpieza'], ['SER013', 'Cambio de pantalla'], ['SER020', 'Limpieza'], ['SER038', 'Reparación de bisagra']]) {
      await sql.query('INSERT INTO tk_servicios (codigo, nombre) VALUES ($1, $2) ON CONFLICT DO NOTHING', [codigo, nombre]);
    }
  }
}

// ---------------- Listas editables y plantillas de WhatsApp ----------------
// Los motivos de postventa y los tipos de producto son listas cerradas, pero el equipo las puede ajustar (Configuración). Nunca se borra un ítem (los tickets
// antiguos lo siguen usando): se desactiva. `LISTAS` se refresca desde la base como máximo una vez por minuto en cada instancia.
export let LISTAS = { motivos: MOTIVOS_POSTVENTA.map((m) => ({ ...m, activo: true })), tipos: TIPOS_PRODUCTO.map((m) => ({ ...m, activo: true })) };
let _listasHasta = 0;
function slug(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); }
export async function cargarListas(sql, forzar = false) {
  if (!forzar && Date.now() < _listasHasta) return LISTAS;
  const { rows } = await sql.query(`SELECT valor FROM tk_config WHERE clave = 'listas'`);
  if (rows[0]) { try { const v = JSON.parse(rows[0].valor); if (Array.isArray(v.motivos) && Array.isArray(v.tipos)) LISTAS = v; } catch { /* se queda con las de fábrica */ } }
  _listasHasta = Date.now() + 60000;
  return LISTAS;
}
// Une lo que llega de la pantalla con lo guardado: se conservan las claves existentes, los ítems nuevos reciben una clave a partir de su nombre.
function fusionarLista(actual, nueva) {
  const out = []; const usadas = new Set();
  for (const x of Array.isArray(nueva) ? nueva : []) {
    const etiqueta = texto(x.etiqueta, 80); if (!etiqueta) continue;
    let clave = actual.some((a) => a.clave === x.clave) && !usadas.has(x.clave) ? x.clave : null;
    if (!clave) {
      const base = slug(etiqueta) || 'otro';
      clave = base;
      for (let i = 2; usadas.has(clave) || actual.some((a) => a.clave === clave); i++) clave = `${base}_${i}`;
    }
    usadas.add(clave); out.push({ clave, etiqueta, activo: x.activo !== false });
  }
  // lo que existía y no vino se conserva desactivado (los tickets viejos lo usan)
  for (const a of actual) if (!usadas.has(a.clave)) out.push({ ...a, activo: false });
  return out;
}
export async function guardarListas(sql, b, autor) {
  await cargarListas(sql, true);
  const motivos = fusionarLista(LISTAS.motivos, b.motivos), tipos = fusionarLista(LISTAS.tipos, b.tipos);
  if (!motivos.some((x) => x.activo) || !tipos.some((x) => x.activo)) return { error: 'Cada lista necesita al menos una opción activa', status: 400 };
  await sql.query(`INSERT INTO tk_config (clave, valor, actualizado_por) VALUES ('listas', $1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
    [JSON.stringify({ motivos, tipos }), autor?.nombre ?? null]);
  LISTAS = { motivos, tipos }; _listasHasta = Date.now() + 60000;
  return { ok: true };
}
export const PLANTILLAS_WA_DEFECTO = {
  lead: 'Hola {nombre}, te escribimos de IndexStore por tu consulta{producto}. ¿En qué podemos ayudarte?',
  postventa: 'Hola {nombre}, te escribimos de IndexStore por tu solicitud de postventa{pedido}.',
  servicio_tecnico: 'Hola {nombre}, te escribimos de IndexStore por tu equipo{orden} en servicio técnico.',
  por_retirar: 'Hola {nombre}, tu equipo{orden} está listo para retirar en IndexStore. Te esperamos con tu orden de servicio y tu documento de identidad.',
};
export async function leerPlantillasWa(sql) {
  const { rows } = await sql.query(`SELECT valor FROM tk_config WHERE clave = 'plantillas_wa'`);
  let g = {}; try { g = rows[0] ? JSON.parse(rows[0].valor) : {}; } catch { g = {}; }
  const out = {}; for (const k of Object.keys(PLANTILLAS_WA_DEFECTO)) out[k] = typeof g[k] === 'string' && g[k].trim() ? g[k] : PLANTILLAS_WA_DEFECTO[k];
  return out;
}
export async function guardarPlantillasWa(sql, b, autor) {
  const out = {};
  for (const k of Object.keys(PLANTILLAS_WA_DEFECTO)) { const v = textoLargo(b[k], 600); out[k] = v || PLANTILLAS_WA_DEFECTO[k]; }
  await sql.query(`INSERT INTO tk_config (clave, valor, actualizado_por) VALUES ('plantillas_wa', $1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`, [JSON.stringify(out), autor?.nombre ?? null]);
  return { ok: true, plantillas: out };
}

// ---------------- Servicios, condiciones y búsqueda de clientes ----------------
// Términos y condiciones que IndexStore ya envía en sus órdenes de servicio de Zoho Desk (copiados de una orden real, ago-2026). Se pueden editar en Configuración.
export const CONDICIONES_OS_DEFECTO = [
  'TÉRMINOS Y CONDICIONES (INDEXSTORE)',
  'INVENTARIO ADJUNTO: El cliente valida este inventario; no se aceptan reclamos por faltantes o daños físicos tras el retiro.',
  'RESPALDO Y PRIVACIDAD: Es responsabilidad exclusiva del cliente respaldar sus datos. IndexStore NO manipula ni accede a la información del usuario, salvo consentimiento previo y explícito para fines de recuperación o respaldo solicitado. No nos responsabilizamos por pérdida de información bajo ninguna circunstancia.',
  'INTERVENCIONES PREVIAS: El cliente tiene la obligación de declarar si el computador ha sido intervenido, reparado o manipulado previamente por terceros o por el mismo usuario. En caso de omitir esta información y detectarse rastros de intervenciones anteriores (ej: limpiezas con químicos inadecuados, soldaduras, piezas adaptadas), IndexStore declina toda responsabilidad por fallas derivadas o colaterales que surjan durante o después del servicio.',
  'RIESGOS: Se aceptan riesgos inherentes en reparaciones de microelectrónica o manipulación de piezas fatigadas.',
  'GARANTÍA: 6 meses solo sobre la reparación específica. Sellos rotos anulan garantía.',
  'ABANDONO: Equipos no retirados en 15 días desde el aviso de término generarán un cobro por acopio de $1.000 diarios. Transcurridos 365 días, se considerarán legalmente abandonados (Art. 42 Ley 19.496).',
].join('\n\n');
export async function listarServicios(sql, { soloActivos = true } = {}) {
  const { rows } = await sql.query(`SELECT codigo, nombre, precio_clp, tiempo_estimado_h, activo FROM tk_servicios ${soloActivos ? 'WHERE activo = true' : ''} ORDER BY codigo`);
  return rows;
}
export async function guardarServicio(sql, b) {
  const codigo = String(b.codigo || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
  const nombre = texto(b.nombre, 120);
  if (!codigo || !nombre) return { error: 'Falta el código o el nombre del servicio', status: 400 };
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v));
  await sql.query(
    `INSERT INTO tk_servicios (codigo, nombre, precio_clp, tiempo_estimado_h, activo) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, precio_clp = EXCLUDED.precio_clp, tiempo_estimado_h = EXCLUDED.tiempo_estimado_h, activo = EXCLUDED.activo`,
    [codigo, nombre, num(b.precio_clp) == null ? null : Math.round(num(b.precio_clp)), num(b.tiempo_estimado_h), b.activo !== false]);
  return { ok: true };
}
export async function leerCondicionesOS(sql) {
  const { rows } = await sql.query(`SELECT valor FROM tk_config WHERE clave = 'condiciones_os'`);
  return rows[0]?.valor || CONDICIONES_OS_DEFECTO;
}
export async function guardarCondicionesOS(sql, valor, autor) {
  const v = textoLargo(valor, 3000);
  if (!v) return { error: 'Las condiciones no pueden quedar vacías', status: 400 };
  await sql.query(`INSERT INTO tk_config (clave, valor, actualizado_por) VALUES ('condiciones_os', $1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`, [v, autor?.nombre ?? null]);
  return { ok: true };
}
// RUT sin puntos ni espacios, con guion y K en mayúscula: 12.345.678-k -> 12345678-K.
export function normalizarRut(valor) {
  const t = String(valor ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
  return t.length >= 2 ? t.slice(0, -1) + '-' + t.slice(-1) : (t || null);
}
// Búsqueda del mesón: por RUT, teléfono, correo o nombre.
export async function buscarClientes(sql, q) {
  const busca = String(q || '').trim().slice(0, 80);
  if (busca.length < 3) return [];
  const rut = normalizarRut(busca); const dig = busca.replace(/\D/g, '');
  const { rows } = await sql.query(
    `SELECT id, rut, nombre, email, telefono FROM tk_clientes
     WHERE ($1::text IS NOT NULL AND length($1) >= 4 AND rut = $1) OR ($2::text <> '' AND length($2) >= 6 AND telefono9 LIKE $3) OR email ILIKE $4 OR nombre ILIKE $4
     ORDER BY id DESC LIMIT 8`,
    [rut, dig, '%' + dig.slice(-9) + '%', '%' + busca.replace(/[%_\\]/g, (m) => '\\' + m) + '%']);
  return rows;
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
  const rut = normalizarRut(texto(d.rut, 20));
  if (!email && !tel9 && !nombre && !rut) return null;
  let fila = null;
  if (email || tel9 || (rut && rut.length >= 5)) {
    const { rows } = await sql.query(
      'SELECT * FROM tk_clientes WHERE ($1::text IS NOT NULL AND email = $1) OR ($2::text <> \'\' AND telefono9 = $2) OR ($3::text IS NOT NULL AND rut = $3) ORDER BY id LIMIT 1',
      [email, tel9, rut && rut.length >= 5 ? rut : null]);
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
  await cargarListas(sql);
  const origen = entre(datos.origen, ORIGENES, 'manual');
  const c = datos.cliente || {};
  const cliente = await buscarOCrearCliente(sql, c);
  const asunto = texto(datos.asunto, 200) || (tipo === 'lead' ? `Consulta de ${cliente?.nombre || 'cliente'}` : tipo === 'servicio_tecnico' ? 'Orden de servicio' : null);
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
      [t.id, claveDe(LISTAS.motivos, p.motivo), claveDe(LISTAS.tipos, p.tipo_producto) || claveDe(LISTAS.tipos, normalizarTipoProducto(p.tipo_producto)), texto(p.shopify_order_id, 40), texto(p.numero_pedido, 40), texto(p.numero_documento, 40)]);
  }
  let numeroOs = null;
  if (tipo === 'servicio_tecnico') {
    const o = datos.orden || {};
    let servicio = texto(o.servicio_codigo, 20);
    if (servicio) { const { rows: s } = await sql.query('SELECT codigo FROM tk_servicios WHERE codigo = $1', [servicio]); servicio = s[0]?.codigo || null; }
    const entero = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.round(Number(v)));
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(o.fecha_entrega_estimada || '') ? o.fecha_entrega_estimada : null;
    const { rows: os } = await sql.query(
      `INSERT INTO tk_ordenes_servicio (ticket_id, numero_os, servicio_codigo, equipo_tipo, marca, modelo, numero_serie, accesorios_recibidos, motivo_ingreso, diagnostico,
         retiro_inmediato, presupuesto_clp, fecha_entrega_estimada)
       VALUES ($1, nextval('tk_os_numero_seq'), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING numero_os`,
      [t.id, servicio, texto(o.equipo_tipo, 40), texto(o.marca, 60), texto(o.modelo, 100), texto(o.numero_serie, 80), textoLargo(o.accesorios_recibidos, 500), textoLargo(o.motivo_ingreso, 2000),
        textoLargo(o.diagnostico, 2000), o.retiro_inmediato === true || o.retiro_inmediato === 'true', entero(o.presupuesto_clp), fecha]);
    numeroOs = os[0].numero_os;
    // Si no vino un asunto, se arma con el número de orden y el equipo.
    if (!datos.asunto) await sql.query('UPDATE tickets SET asunto = $2 WHERE id = $1', [t.id, `OS N° ${numeroOs} — ${[o.marca, o.modelo].map((x) => texto(x, 60)).filter(Boolean).join(' ') || 'equipo'}`]);
    t.numero_os = numeroOs;
  }
  await registrarEvento(sql, t.id, { tipo: 'cambio_estado', autor, contenido: numeroOs ? `Orden de servicio N° ${numeroOs} creada` : 'Ticket creado', estadoNuevo: 'abierto' });
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
  // Orden de servicio: la fecha de entrega queda al marcarla "Entregado" y se borra si se reabre.
  if (t.tipo === 'servicio_tecnico') {
    await sql.query(`UPDATE tk_ordenes_servicio SET fecha_entrega = CASE WHEN $2 THEN (now() AT TIME ZONE 'America/Santiago')::date ELSE NULL END WHERE ticket_id = $1`, [id, nuevo === 'entregado']);
  }
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
  await cargarListas(sql);
  const c = cambios || {};
  if (t.tipo === 'lead') {
    await sql.query(
      `UPDATE tk_leads SET producto_interes = COALESCE($2, producto_interes), canal_contacto = COALESCE($3, canal_contacto) WHERE ticket_id = $1`,
      [id, 'producto_interes' in c ? texto(c.producto_interes, 200) : null, entre(c.canal_contacto, CANALES_CONTACTO)]);
  } else if (t.tipo === 'postventa') {
    await sql.query(
      `UPDATE tk_postventa SET motivo = COALESCE($2, motivo), tipo_producto = COALESCE($3, tipo_producto), numero_pedido = COALESCE($4, numero_pedido),
              numero_documento = COALESCE($5, numero_documento), resumen_resolucion = COALESCE($6, resumen_resolucion) WHERE ticket_id = $1`,
      [id, claveDe(LISTAS.motivos, c.motivo), claveDe(LISTAS.tipos, c.tipo_producto), 'numero_pedido' in c ? texto(c.numero_pedido, 40) : null,
        'numero_documento' in c ? texto(c.numero_documento, 40) : null, 'resumen_resolucion' in c ? textoLargo(c.resumen_resolucion, 2000) : null]);
  } else if (t.tipo === 'servicio_tecnico') {
    const tiene = (k) => k in c;
    const entero = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.round(Number(v)));
    let servicio = null;
    if (tiene('servicio_codigo') && c.servicio_codigo) { const { rows: s } = await sql.query('SELECT codigo FROM tk_servicios WHERE codigo = $1', [String(c.servicio_codigo)]); servicio = s[0]?.codigo || null; }
    // Cada campo se actualiza solo si vino en la petición (también para vaciarlo); "aprobado_cliente": 'si' | 'no' | '' (pendiente).
    const sets = []; const vals = [id];
    const poner = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (tiene('servicio_codigo')) poner('servicio_codigo', servicio);
    for (const [k, max] of [['equipo_tipo', 40], ['marca', 60], ['modelo', 100], ['numero_serie', 80]]) if (tiene(k)) poner(k, texto(c[k], max));
    for (const [k, max] of [['accesorios_recibidos', 500], ['motivo_ingreso', 2000], ['diagnostico', 2000]]) if (tiene(k)) poner(k, textoLargo(c[k], max));
    if (tiene('presupuesto_clp')) poner('presupuesto_clp', entero(c.presupuesto_clp));
    if (tiene('aprobado_cliente')) poner('aprobado_cliente', c.aprobado_cliente === 'si' ? true : c.aprobado_cliente === 'no' ? false : null);
    if (tiene('retiro_inmediato')) poner('retiro_inmediato', c.retiro_inmediato === true || c.retiro_inmediato === 'true');
    if (tiene('fecha_entrega_estimada')) poner('fecha_entrega_estimada', /^\d{4}-\d{2}-\d{2}$/.test(c.fecha_entrega_estimada || '') ? c.fecha_entrega_estimada : null);
    if (sets.length) await sql.query(`UPDATE tk_ordenes_servicio SET ${sets.join(', ')} WHERE ticket_id = $1`, vals);
  }
  await sql.query('UPDATE tickets SET actualizado_en = now() WHERE id = $1', [id]);
  await registrarEvento(sql, id, { tipo: 'actualizacion', autor, contenido: 'Datos del ticket actualizados' });
  return { ok: true };
}

// ---------------- Consultas ----------------
const SELECT_LISTA = `
  SELECT t.id, t.numero, t.zoho_numero, t.zoho_ticket_id, t.tipo, t.estado, t.prioridad, t.origen, t.asunto, t.creado_en, t.actualizado_en, t.ultimo_movimiento_en, t.cerrado_en,
         t.agente_id, COALESCE(NULLIF(u.nombre, ''), u.email) AS agente_nombre,
         c.id AS cliente_id, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.email AS cliente_email,
         l.producto_interes, p.tipo_producto, p.numero_pedido, p.motivo, os.numero_os, os.retiro_inmediato
  FROM tickets t
  LEFT JOIN usuarios u ON u.id = t.agente_id
  LEFT JOIN tk_clientes c ON c.id = t.cliente_id
  LEFT JOIN tk_leads l ON l.ticket_id = t.id
  LEFT JOIN tk_postventa p ON p.ticket_id = t.id
  LEFT JOIN tk_ordenes_servicio os ON os.ticket_id = t.id`;

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
      const condNum = /^\d{3,}$/.test(busca) ? ` OR t.numero::text = ${p(busca)} OR os.numero_os::text = ${p(busca)} OR t.zoho_numero::text = ${p(busca)}` : '';
      const condTel = dig.length >= 6 ? ` OR c.telefono9 LIKE ${p('%' + dig.slice(-9) + '%')}` : '';
      where.push(`(t.asunto ILIKE ${like} OR c.nombre ILIKE ${like} OR c.email ILIKE ${like} OR p.numero_pedido ILIKE ${like}${condNum}${condTel})`);
    }
  };
  aplicarComunes();
  const baseWhere = where.slice(); const baseParams = params.slice();
  // Los contadores por estado se calculan con todos los filtros MENOS el de estado.
  const { rows: cuentas } = await sql.query(
    `SELECT t.tipo, t.estado, count(*)::int AS n FROM tickets t LEFT JOIN tk_clientes c ON c.id = t.cliente_id LEFT JOIN tk_postventa p ON p.ticket_id = t.id
     LEFT JOIN tk_ordenes_servicio os ON os.ticket_id = t.id
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
  const { rows: ord } = await sql.query(
    `SELECT o.*, s.nombre AS servicio_nombre, s.precio_clp AS servicio_precio_clp FROM tk_ordenes_servicio o LEFT JOIN tk_servicios s ON s.codigo = o.servicio_codigo WHERE o.ticket_id = $1`, [id]);
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
  return { ...base, descripcion: tk[0]?.descripcion || null, zoho_ticket_id: tk[0]?.zoho_ticket_id || null, cliente: cli[0] || null, lead: lead[0] || null, postventa: pv[0] || null, orden: ord[0] || null,
    eventos: ev, otrosTickets: otros, adjuntos: adj, en_estado_desde: enEstadoDesde, primer_contacto_en: primerContacto ? primerContacto.creado_en : null, personas };
}

export async function listarAgentes(sql) {
  const { rows } = await sql.query(`SELECT id, COALESCE(NULLIF(nombre, ''), email) AS nombre FROM usuarios WHERE activo = true ORDER BY COALESCE(NULLIF(nombre, ''), email)`);
  return rows;
}

export function configuracionPublica() {
  return { tipos: TIPOS.map((t) => ({ clave: t, etiqueta: TIPO_ETIQUETA[t] })), estados: ESTADOS, prioridades: PRIORIDADES, origenes: ORIGENES.map((o) => ({ clave: o, etiqueta: ORIGEN_ETIQUETA[o] })),
    motivosPostventa: LISTAS.motivos, tiposProducto: LISTAS.tipos, canalesContacto: CANALES_CONTACTO, horasSinMovimiento: HORAS_SIN_MOVIMIENTO };
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
      if (req.query.clientes !== undefined) return res.status(200).json({ clientes: await buscarClientes(sql, req.query.clientes) });
      const [lista, agentes, servicios, condiciones, plantillas] = await Promise.all([listarTickets(sql, req.query, sesion), listarAgentes(sql), listarServicios(sql, { soloActivos: false }), leerCondicionesOS(sql), leerPlantillasWa(sql), cargarListas(sql)]);
      return res.status(200).json({ ...lista, agentes, config: { ...configuracionPublica(), servicios, condicionesOs: condiciones, plantillasWa: plantillas }, yo: autor.id });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const accion = String(b.accion || 'crear');
      const id = Number(b.id);
      let r;
      if (accion === 'listas_guardar' || accion === 'plantillas_guardar') {
        if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede editar la configuración' });
        const rr = accion === 'listas_guardar' ? await guardarListas(sql, b, autor) : await guardarPlantillasWa(sql, b, autor);
        if (rr.error) return res.status(rr.status || 400).json({ error: rr.error });
        return res.status(200).json({ ok: true, motivosPostventa: LISTAS.motivos, tiposProducto: LISTAS.tipos, plantillasWa: await leerPlantillasWa(sql) });
      }
      if (accion === 'servicio_guardar' || accion === 'condiciones_guardar') {
        // El catálogo y las condiciones impresas en la orden las edita solo un administrador.
        if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede editar el catálogo' });
        const rr = accion === 'servicio_guardar' ? await guardarServicio(sql, b) : await guardarCondicionesOS(sql, b.condiciones, autor);
        if (rr.error) return res.status(rr.status || 400).json({ error: rr.error });
        return res.status(200).json({ ok: true, servicios: await listarServicios(sql, { soloActivos: false }), condicionesOs: await leerCondicionesOS(sql) });
      }
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

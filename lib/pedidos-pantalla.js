// /lib/pedidos-pantalla.js
// ═════════════════════════════════════════════════════════════════
// Pantallas de notebook a pedido: modelos que no se tienen en stock pero se pueden importar (15 a 25 días).
// Los pedidos se anotan a mano (cliente, producto, abono, tiempo de espera que se le dijo al cliente, datos de facturación) y se les sigue la pista
// desde "pendiente de compra" hasta "entregado". Este archivo tiene las reglas (campos, validaciones, estados) y las funciones de base de datos.
// La búsqueda de productos con foto (catálogo de la tienda) está en lib/pedidos-pantalla-catalogo.js.
// ═════════════════════════════════════════════════════════════════
import { unaVez } from './una-vez.js';
import { rutValido, rutConGuion } from './bsale-emision.js';

export const DIAS_ESTIMADOS_DEFECTO = 20; // la mayoría de los pedidos tarda entre 15 y 25 días

// pendiente_compra: anotado, falta comprarlo al proveedor.  comprado: ya se compró.  en_transito: viene en camino.  recibido: llegó, falta entregarlo.
export const ESTADOS = ['pendiente_compra', 'comprado', 'en_transito', 'recibido', 'entregado', 'cancelado'];
export const ETIQUETA_ESTADO = {
  pendiente_compra: 'Pendiente de compra', comprado: 'Comprado', en_transito: 'En tránsito', recibido: 'Recibido, por entregar', entregado: 'Entregado', cancelado: 'Cancelado',
};
export const ESTADOS_ACTIVOS = ['pendiente_compra', 'comprado', 'en_transito', 'recibido'];
// Cambios de estado permitidos (desde -> hasta). Se puede saltar pasos (ej. de pendiente directo a en tránsito) y volver atrás si hubo un error.
export const TRANSICIONES = {
  pendiente_compra: ['comprado', 'en_transito', 'cancelado'],
  comprado: ['en_transito', 'recibido', 'pendiente_compra', 'cancelado'],
  en_transito: ['recibido', 'comprado', 'pendiente_compra', 'cancelado'],
  recibido: ['entregado', 'en_transito'],
  entregado: ['recibido'],
  cancelado: ['pendiente_compra'],
};
export const MEDIOS_ABONO = { link_pago: 'Link de pago', transferencia: 'Transferencia', shopify: 'Shopify' };

const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const sumarDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const texto = (v, max = 300) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
// Las fotos y enlaces del producto vienen del catálogo de la tienda: solo se aceptan https de la tienda (o de su CDN) para que nadie cuele otra dirección.
function urlSegura(v, hosts) {
  const s = texto(v, 600);
  if (!s) return null;
  try { const u = new URL(s); return u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h)) ? u.toString() : null; } catch { return null; }
}
const HOSTS_IMAGEN = ['cdn.shopify.com', 'indexstore.cl'];
const HOSTS_PRODUCTO = ['indexstore.cl'];

// ---------------------------------------------------------------- base de datos
export async function asegurarTablaPedidosPantalla(sql) { return unaVez('asegurarTablaPedidosPantalla', () => _asegurarTablaPedidosPantalla(sql)); }
async function _asegurarTablaPedidosPantalla(sql) {
  await sql`CREATE TABLE IF NOT EXISTS pedidos_pantalla (
    id SERIAL PRIMARY KEY,
    shopify_order_id TEXT, linea_id TEXT, orden_nombre TEXT, creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    cliente_nombre TEXT, cliente_email TEXT, cliente_telefono TEXT,
    modelo TEXT, numero_parte TEXT, nota_cliente TEXT, sku_abono TEXT, cantidad INTEGER NOT NULL DEFAULT 1, abono NUMERIC,
    pago TEXT, estado TEXT NOT NULL DEFAULT 'pendiente_compra',
    proveedor TEXT, costo_compra NUMERIC, referencia_compra TEXT, dias_estimados INTEGER, fecha_compra DATE, fecha_eta DATE, fecha_recibido DATE, fecha_entrega DATE,
    nota_interna TEXT, cancelada_en_shopify BOOLEAN NOT NULL DEFAULT false, aviso_enviado_en TIMESTAMPTZ,
    origen TEXT NOT NULL DEFAULT 'manual', actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(), actualizado_por TEXT);`;
  // Campos del formulario (la primera versión también recibía los pedidos de Shopify; esas columnas quedan sin uso).
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS producto_sku TEXT;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS producto_imagen TEXT;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS producto_url TEXT;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS abono_realizado BOOLEAN;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS abono_medio TEXT;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS cliente_comuna TEXT;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS requiere_factura BOOLEAN NOT NULL DEFAULT false;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS fact_rut TEXT;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS fact_razon_social TEXT;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS fact_giro TEXT;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS fact_direccion TEXT;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS fact_comuna TEXT;`;
  // Desde cuándo está el pedido en su estado actual y cuándo se mandó el último recordatorio (aviso si pasan 3 días sin cambio de estado).
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS estado_desde TIMESTAMPTZ;`;
  await sql`ALTER TABLE pedidos_pantalla ADD COLUMN IF NOT EXISTS recordatorio_en TIMESTAMPTZ;`;
  await sql`UPDATE pedidos_pantalla SET estado_desde = COALESCE(actualizado_en, creado_en) WHERE estado_desde IS NULL;`;
  await sql`ALTER TABLE pedidos_pantalla ALTER COLUMN estado_desde SET DEFAULT now();`;
  // Estados de la primera versión -> los nuevos; y "abono realizado" para las filas que ya existían.
  await sql`UPDATE pedidos_pantalla SET estado = 'pendiente_compra' WHERE estado IN ('por_comprar', 'pendiente_pago');`;
  await sql`UPDATE pedidos_pantalla SET abono_realizado = (abono IS NOT NULL AND pago = 'paid') WHERE abono_realizado IS NULL;`;
  await sql`ALTER TABLE pedidos_pantalla ALTER COLUMN estado SET DEFAULT 'pendiente_compra';`;
  await sql`ALTER TABLE pedidos_pantalla ALTER COLUMN abono_realizado SET DEFAULT false;`;
  await sql`ALTER TABLE pedidos_pantalla ALTER COLUMN abono_realizado SET NOT NULL;`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_pantalla_linea ON pedidos_pantalla (shopify_order_id, linea_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pedidos_pantalla_estado ON pedidos_pantalla (estado, creado_en);`;
  await sql`CREATE TABLE IF NOT EXISTS pedidos_pantalla_historial (
    id SERIAL PRIMARY KEY, pedido_id INTEGER NOT NULL REFERENCES pedidos_pantalla(id) ON DELETE CASCADE, usuario TEXT, accion TEXT NOT NULL, creado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pedidos_pantalla_hist ON pedidos_pantalla_historial (pedido_id, creado_en);`;
}

async function anotar(sql, pedidoId, usuario, accion) {
  await sql.query('INSERT INTO pedidos_pantalla_historial (pedido_id, usuario, accion) VALUES ($1, $2, $3)', [pedidoId, usuario || 'Sistema', String(accion).slice(0, 500)]);
}

const SELECT_PEDIDO = `SELECT p.*, p.fecha_compra::text AS fecha_compra, p.fecha_eta::text AS fecha_eta, p.fecha_recibido::text AS fecha_recibido, p.fecha_entrega::text AS fecha_entrega,
       (p.creado_en AT TIME ZONE 'America/Santiago')::date::text AS fecha_pedido,
       ((now() AT TIME ZONE 'America/Santiago')::date - (COALESCE(p.estado_desde, p.creado_en) AT TIME ZONE 'America/Santiago')::date) AS dias_sin_cambio,
       CASE WHEN p.dias_estimados IS NULL THEN NULL ELSE ((p.creado_en AT TIME ZONE 'America/Santiago')::date + p.dias_estimados)::text END AS fecha_prometida,
       COALESCE((SELECT json_agg(json_build_object('usuario', h.usuario, 'accion', h.accion, 'en', h.creado_en) ORDER BY h.creado_en DESC, h.id DESC) FROM pedidos_pantalla_historial h WHERE h.pedido_id = p.id), '[]'::json) AS historial
  FROM pedidos_pantalla p`;

export async function listarPedidos(sql) {
  await asegurarTablaPedidosPantalla(sql);
  const { rows } = await sql.query(
    `${SELECT_PEDIDO}
      ORDER BY (p.estado = ANY($1::text[])) DESC, CASE p.estado WHEN 'pendiente_compra' THEN 0 WHEN 'comprado' THEN 1 WHEN 'en_transito' THEN 2 WHEN 'recibido' THEN 3 ELSE 4 END, p.creado_en DESC
      LIMIT 500`, [ESTADOS_ACTIVOS]);
  return rows;
}
export async function leerPedido(sql, id) {
  await asegurarTablaPedidosPantalla(sql);
  const { rows } = await sql.query(`${SELECT_PEDIDO} WHERE p.id = $1`, [id]);
  return rows[0] || null;
}

// Cantidades por estado, el pedido pendiente más antiguo, las compras con la llegada atrasada y los pedidos activos que ya pasaron la fecha prometida al cliente.
export function resumirPedidos(filas, hoy = hoyChile()) {
  const por = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
  for (const f of filas) por[f.estado] = (por[f.estado] || 0) + 1;
  const dia = (v) => String(v instanceof Date ? v.toISOString() : v).slice(0, 10);
  const dias = (desde) => Math.max(0, Math.round((Date.parse(hoy + 'T12:00:00Z') - Date.parse(dia(desde) + 'T12:00:00Z')) / 86400000));
  const pendientes = filas.filter((f) => f.estado === 'pendiente_compra');
  return {
    porEstado: por,
    pendienteMasAntiguoDias: pendientes.length ? Math.max(...pendientes.map((f) => dias(f.creado_en))) : null,
    atrasados: filas.filter((f) => ['comprado', 'en_transito'].includes(f.estado) && f.fecha_eta && dia(f.fecha_eta) < hoy).length,
    vencidos: filas.filter((f) => ['pendiente_compra', 'comprado', 'en_transito'].includes(f.estado) && f.fecha_prometida && dia(f.fecha_prometida) < hoy).length,
  };
}

// ---------------------------------------------------------------- validación
const CAMPOS_TEXTO = { cliente_nombre: 120, cliente_telefono: 40, cliente_email: 160, cliente_comuna: 80, modelo: 200, producto_sku: 80, numero_parte: 120, proveedor: 120, referencia_compra: 120, nota_interna: 1000, fact_razon_social: 160, fact_giro: 160, fact_direccion: 200, fact_comuna: 80 };
const ETIQUETA_CAMPO = {
  cliente_nombre: 'nombre', cliente_telefono: 'WhatsApp', cliente_email: 'correo', cliente_comuna: 'comuna', modelo: 'modelo', producto_sku: 'SKU', producto_imagen: 'foto', producto_url: 'enlace', numero_parte: 'número de parte',
  abono_realizado: 'abono', abono: 'monto del abono', abono_medio: 'medio del abono', dias_estimados: 'días de espera', requiere_factura: 'factura', fact_rut: 'RUT', fact_razon_social: 'razón social', fact_giro: 'giro',
  fact_direccion: 'dirección', fact_comuna: 'comuna de facturación', proveedor: 'proveedor', referencia_compra: 'referencia', costo_compra: 'costo', fecha_eta: 'llegada estimada', nota_interna: 'nota interna',
};

// Toma lo que vino en el cuerpo y deja solo los campos permitidos, ya limpios: { columna: valor } con las columnas que vinieron. Devuelve { campos } o { error }.
function normalizarCampos(b, { esAdmin }) {
  const c = {};
  for (const [k, max] of Object.entries(CAMPOS_TEXTO)) if (b[k] !== undefined) c[k] = texto(b[k], max);
  if (b.producto_imagen !== undefined) c.producto_imagen = urlSegura(b.producto_imagen, HOSTS_IMAGEN);
  if (b.producto_url !== undefined) c.producto_url = urlSegura(b.producto_url, HOSTS_PRODUCTO);
  if (b.requiere_factura !== undefined) c.requiere_factura = bool(b.requiere_factura);
  if (b.abono_realizado !== undefined) c.abono_realizado = bool(b.abono_realizado);
  if (b.fact_rut !== undefined) { const r = texto(b.fact_rut, 20); c.fact_rut = r ? (rutValido(r) ? rutConGuion(r) : '__invalido__') : null; }
  if (b.abono !== undefined) {
    const n = b.abono === null || b.abono === '' ? null : Number(b.abono);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100000000)) return { error: 'El monto del abono no es válido' };
    c.abono = n === null ? null : Math.round(n);
  }
  if (b.abono_medio !== undefined) {
    const m = texto(b.abono_medio, 30);
    if (m && !MEDIOS_ABONO[m]) return { error: 'El medio del abono debe ser link de pago, transferencia o Shopify' };
    c.abono_medio = m;
  }
  if (b.dias_estimados !== undefined) {
    const n = b.dias_estimados === null || b.dias_estimados === '' ? null : Math.round(Number(b.dias_estimados));
    if (n !== null && !(n >= 1 && n <= 120)) return { error: 'Los días de espera deben estar entre 1 y 120' };
    c.dias_estimados = n;
  }
  if (b.fecha_eta !== undefined) {
    if (b.fecha_eta !== null && b.fecha_eta !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha_eta))) return { error: 'La fecha de llegada no es válida' };
    c.fecha_eta = b.fecha_eta || null;
  }
  if (b.costo_compra !== undefined) {
    if (!esAdmin) return { error: 'El costo de compra solo lo puede cambiar un administrador', status: 403 };
    const n = b.costo_compra === null || b.costo_compra === '' ? null : Number(b.costo_compra);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return { error: 'El costo de compra no es válido' };
    c.costo_compra = n;
  }
  return { campos: c };
}

// Reglas del pedido sobre los valores ya combinados (lo que había + lo que cambia). `tocados` = claves que vinieron: al editar solo se revisa lo que se tocó,
// así un pedido antiguo incompleto se puede seguir moviendo de estado. Devuelve un mensaje de error o null.
function validarPedido(m, tocados, { crear }) {
  const toca = (...ks) => crear || ks.some((k) => tocados.has(k));
  if (toca('cliente_nombre') && !m.cliente_nombre) return 'Falta el nombre del cliente';
  if (toca('cliente_telefono', 'cliente_email')) {
    if (!m.cliente_telefono && !m.cliente_email) return 'Falta un medio de contacto: WhatsApp o correo';
    if (m.cliente_telefono && String(m.cliente_telefono).replace(/\D/g, '').length < 8) return 'El WhatsApp no parece un número válido';
    if (m.cliente_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.cliente_email)) return 'El correo no es válido';
  }
  if (toca('modelo') && !m.modelo) return 'Falta el modelo de la pantalla (puedes buscarlo en el catálogo o escribirlo)';
  if (toca('abono_realizado', 'abono', 'abono_medio') && m.abono_realizado) {
    if (!(Number(m.abono) > 0)) return 'Indica de cuánto fue el abono';
    if (!m.abono_medio) return 'Indica cómo se pagó el abono: link de pago, transferencia o Shopify';
  }
  if (toca('dias_estimados') && !m.dias_estimados) return 'Indica los días de espera que se le dijeron al cliente';
  if (toca('requiere_factura', 'fact_rut', 'fact_razon_social') && m.requiere_factura) {
    if (!m.fact_rut) return 'Para factura falta el RUT de la empresa';
    if (m.fact_rut === '__invalido__') return 'El RUT de la empresa no es válido (revisa el dígito verificador)';
    if (!m.fact_razon_social) return 'Para factura falta la razón social';
  }
  return null;
}

// ---------------------------------------------------------------- crear y editar
const COLUMNAS_PEDIDO = ['cliente_nombre', 'cliente_telefono', 'cliente_email', 'cliente_comuna', 'modelo', 'producto_sku', 'producto_imagen', 'producto_url', 'numero_parte', 'abono_realizado', 'abono', 'abono_medio', 'dias_estimados',
  'requiere_factura', 'fact_rut', 'fact_razon_social', 'fact_giro', 'fact_direccion', 'fact_comuna', 'nota_interna'];

export async function crearPedido(sql, body, { usuario } = {}) {
  await asegurarTablaPedidosPantalla(sql);
  const n = normalizarCampos(body || {}, { esAdmin: false });
  if (n.error) return { error: n.error, status: n.status || 400 };
  const m = { cliente_nombre: null, cliente_telefono: null, cliente_email: null, cliente_comuna: null, modelo: null, producto_sku: null, producto_imagen: null, producto_url: null, numero_parte: null, abono_realizado: false, abono: null, abono_medio: null,
    dias_estimados: DIAS_ESTIMADOS_DEFECTO, requiere_factura: false, fact_rut: null, fact_razon_social: null, fact_giro: null, fact_direccion: null, fact_comuna: null, nota_interna: null, ...n.campos };
  if (!m.abono_realizado) { m.abono = null; m.abono_medio = null; }
  if (!m.requiere_factura) { m.fact_rut = null; m.fact_razon_social = null; m.fact_giro = null; m.fact_direccion = null; m.fact_comuna = null; }
  const error = validarPedido(m, new Set(), { crear: true });
  if (error) return { error, status: 400 };
  const { rows: [fila] } = await sql.query(
    `INSERT INTO pedidos_pantalla (${COLUMNAS_PEDIDO.join(', ')}, estado, origen, actualizado_por) VALUES (${COLUMNAS_PEDIDO.map((_, i) => '$' + (i + 1)).join(', ')}, 'pendiente_compra', 'manual', $${COLUMNAS_PEDIDO.length + 1}) RETURNING *`,
    [...COLUMNAS_PEDIDO.map((c) => m[c]), usuario || null]);
  await anotar(sql, fila.id, usuario, 'Pedido anotado' + (m.abono_realizado ? ` con abono (${MEDIOS_ABONO[m.abono_medio].toLowerCase()})` : ' sin abono'));
  return { fila };
}

// Cambios que hace una persona desde la página. Valida los estados y completa fechas. Devuelve { fila } o { error, status }.
export async function aplicarCambios(sql, id, body, { usuario, esAdmin = false, hoy = hoyChile() } = {}) {
  await asegurarTablaPedidosPantalla(sql);
  const { rows: [ex] } = await sql.query('SELECT *, fecha_eta::text AS fecha_eta_t FROM pedidos_pantalla WHERE id = $1', [id]);
  if (!ex) return { error: 'No existe ese pedido', status: 404 };
  const b = body || {};
  const n = normalizarCampos(b, { esAdmin });
  if (n.error) return { error: n.error, status: n.status || 400 };
  const campos = n.campos;
  if (campos.abono_realizado === false) { campos.abono = null; campos.abono_medio = null; }
  if (campos.requiere_factura === false) Object.assign(campos, { fact_rut: null, fact_razon_social: null, fact_giro: null, fact_direccion: null, fact_comuna: null });
  const combinado = { ...ex, ...campos };
  const error = validarPedido(combinado, new Set(Object.keys(campos)), { crear: false });
  if (error) return { error, status: 400 };
  if (campos.fact_rut === '__invalido__') campos.fact_rut = null; // un RUT mal escrito en un pedido sin factura no se guarda

  // Cambio de estado: se valida antes de armar la actualización.
  let estadoNuevo = ex.estado;
  if (b.estado !== undefined && b.estado !== ex.estado) {
    if (!ESTADOS.includes(b.estado)) return { error: 'Estado no válido', status: 400 };
    if (!(TRANSICIONES[ex.estado] || []).includes(b.estado)) return { error: `No se puede pasar de "${ETIQUETA_ESTADO[ex.estado]}" a "${ETIQUETA_ESTADO[b.estado]}"`, status: 400 };
    estadoNuevo = b.estado;
    // La llegada estimada se calcula sola (hoy + los días dichos al cliente) cuando no se escribió una fecha; la ventana de edición manda el campo vacío.
    const dias = campos.dias_estimados ?? ex.dias_estimados;
    if (['comprado', 'en_transito'].includes(estadoNuevo) && !ex.fecha_compra && !campos.fecha_eta && !ex.fecha_eta_t && dias) campos.fecha_eta = sumarDias(hoy, dias);
  }

  const sets = [], vals = [id]; const editados = [];
  const poner = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  for (const [col, v] of Object.entries(campos)) {
    const antes = ex[col];
    const igual = (antes ?? null) === (v ?? null) || (col === 'abono' && antes != null && v != null && Number(antes) === Number(v));
    if (igual) continue;
    poner(col, v); editados.push(ETIQUETA_CAMPO[col] || col);
  }
  if (estadoNuevo !== ex.estado) {
    poner('estado', estadoNuevo);
    sets.push('estado_desde = now()', 'recordatorio_en = NULL'); // el reloj de los 3 días vuelve a empezar con cada cambio de estado
    if (['comprado', 'en_transito'].includes(estadoNuevo) && !ex.fecha_compra) poner('fecha_compra', hoy);
    if (estadoNuevo === 'recibido') poner('fecha_recibido', hoy);
    if (estadoNuevo === 'entregado') poner('fecha_entrega', hoy);
  }
  if (!sets.length) return { fila: ex, sinCambios: true };
  poner('actualizado_por', usuario || null); sets.push('actualizado_en = now()');
  const { rows: [fila] } = await sql.query(`UPDATE pedidos_pantalla SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
  if (estadoNuevo !== ex.estado) await anotar(sql, id, usuario, `Estado: ${ETIQUETA_ESTADO[ex.estado]} → ${ETIQUETA_ESTADO[estadoNuevo]}`);
  if (editados.length) await anotar(sql, id, usuario, 'Editó: ' + editados.join(', '));
  return { fila };
}

// ---------------------------------------------------------------- recordatorio por falta de cambio de estado
export const DIAS_RECORDATORIO = 3; // si un pedido activo pasa 3 días sin cambiar de estado se manda un recordatorio, y se repite cada 3 días mientras siga igual
const CONDICION_RECORDATORIO = `p.estado = ANY($1::text[])
  AND ((COALESCE(p.estado_desde, p.creado_en) AT TIME ZONE 'America/Santiago')::date) <= ($2::date - $3::int)
  AND (p.recordatorio_en IS NULL OR ((p.recordatorio_en AT TIME ZONE 'America/Santiago')::date) <= ($2::date - $3::int))`;

// Pedidos activos que llevan {dias} o más sin cambiar de estado y a los que no se les avisó en los últimos {dias} días. Los más urgentes primero.
export async function pedidosParaRecordar(sql, { hoy = hoyChile(), dias = DIAS_RECORDATORIO } = {}) {
  await asegurarTablaPedidosPantalla(sql);
  const { rows } = await sql.query(`${SELECT_PEDIDO} WHERE ${CONDICION_RECORDATORIO}
    ORDER BY CASE p.estado WHEN 'pendiente_compra' THEN 0 WHEN 'comprado' THEN 1 WHEN 'en_transito' THEN 2 ELSE 3 END, COALESCE(p.estado_desde, p.creado_en)`, [ESTADOS_ACTIVOS, hoy, dias]);
  return rows;
}
// "Reclama" los recordatorios antes de enviar: devuelve los ids que logró marcar (si dos ejecuciones coinciden, solo una envía cada pedido).
export async function reclamarRecordatorios(sql, ids, { hoy = hoyChile(), dias = DIAS_RECORDATORIO } = {}) {
  if (!ids.length) return [];
  const { rows } = await sql.query(`UPDATE pedidos_pantalla p SET recordatorio_en = now() WHERE p.id = ANY($4::int[]) AND ${CONDICION_RECORDATORIO} RETURNING p.id`, [ESTADOS_ACTIVOS, hoy, dias, ids]);
  return rows.map((r) => r.id);
}
// Si el envío falló, se devuelve la marca para que el cron lo reintente en la próxima ejecución.
export async function soltarRecordatorios(sql, ids) {
  if (ids.length) await sql.query('UPDATE pedidos_pantalla SET recordatorio_en = NULL WHERE id = ANY($1::int[])', [ids]);
}

// Antes de mandar el correo se "reclama" el aviso: solo quien logra marcarlo lo envía (nunca salen dos correos por el mismo pedido).
export async function reclamarAviso(sql, id) {
  const { rows } = await sql.query('UPDATE pedidos_pantalla SET aviso_enviado_en = now() WHERE id = $1 AND aviso_enviado_en IS NULL RETURNING id', [id]);
  return rows.length > 0;
}

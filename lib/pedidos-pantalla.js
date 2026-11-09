// /lib/pedidos-pantalla.js
// ═════════════════════════════════════════════════════════════════
// Pantallas de notebook a pedido: modelos que no se tienen en stock pero se pueden importar (10-20 días).
// El cliente paga en la tienda (Shopify) un producto de "abono" (monto fijo) y el ERP convierte ese pedido en una solicitud de compra:
// aparece en la página "Pantallas a pedido" (Compras) y avisa por correo para que se genere la compra al proveedor internacional.
//
// Este archivo tiene la lógica pura (leer una orden de Shopify, validar cambios) y las funciones de base de datos.
// La parte de Shopify (crear el producto, avisos de pedidos) está en lib/pedidos-pantalla-shopify.js.
// ═════════════════════════════════════════════════════════════════
import { createHmac, timingSafeEqual } from 'node:crypto';
import { unaVez } from './una-vez.js';

export const PREFIJO_SKU_DEFECTO = 'ABONO-PANTALLA';
export const DIAS_ESTIMADOS_DEFECTO = 15;

// pendiente_pago: el cliente hizo el pedido pero el abono aún no está pagado (ej. transferencia).  por_comprar: abono pagado, falta comprar al proveedor.
// comprado: ya se compró al proveedor y viene en camino.  recibido: llegó a Chile/tienda, falta entregarlo.  entregado / cancelado: cerrados.
export const ESTADOS = ['pendiente_pago', 'por_comprar', 'comprado', 'recibido', 'entregado', 'cancelado'];
export const ETIQUETA_ESTADO = {
  pendiente_pago: 'Pago pendiente', por_comprar: 'Por comprar', comprado: 'Comprado, en camino', recibido: 'Recibido, por entregar', entregado: 'Entregado', cancelado: 'Cancelado',
};
export const ESTADOS_ACTIVOS = ['pendiente_pago', 'por_comprar', 'comprado', 'recibido'];
// Cambios de estado que se pueden hacer a mano (desde -> hasta). Los automáticos (pago confirmado, orden cancelada) los hace el aviso de Shopify.
export const TRANSICIONES = {
  pendiente_pago: ['por_comprar', 'cancelado'],
  por_comprar: ['comprado', 'cancelado'],
  comprado: ['recibido', 'por_comprar', 'cancelado'],
  recibido: ['entregado', 'comprado'],
  entregado: ['recibido'],
  cancelado: ['por_comprar'],
};

const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const sumarDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const texto = (v, max = 300) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };

// ---------------------------------------------------------------- configuración
export function normalizarConfig(c) {
  const x = c && typeof c === 'object' ? c : {};
  const prefijo = String(x.prefijo_sku || PREFIJO_SKU_DEFECTO).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '') || PREFIJO_SKU_DEFECTO;
  const dias = Math.round(Number(x.dias_estimados));
  return { prefijo_sku: prefijo, dias_estimados: dias >= 1 && dias <= 90 ? dias : DIAS_ESTIMADOS_DEFECTO };
}

// ---------------------------------------------------------------- seguridad del aviso de Shopify
// Shopify firma cada aviso con el secreto de la app (HMAC-SHA256 del cuerpo, en base64, cabecera X-Shopify-Hmac-Sha256).
export function verificarHmac(cuerpoCrudo, firmaBase64, secreto) {
  if (!secreto || !firmaBase64 || cuerpoCrudo == null) return false;
  const esperado = createHmac('sha256', String(secreto)).update(String(cuerpoCrudo), 'utf8').digest();
  let recibido;
  try { recibido = Buffer.from(String(firmaBase64), 'base64'); } catch { return false; }
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}
// Clave que va en la URL del aviso (se deriva de un secreto que ya existe, igual que el aviso de stock de Descuentos web).
export function claveAviso(secreto) {
  if (!secreto) return '';
  return createHmac('sha256', String(secreto)).update('pedidos-pantalla-aviso').digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------- leer una orden de Shopify
const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function estaPagado(pago) { return ['paid', 'partially_refunded'].includes(String(pago || '').toLowerCase()); }

// Propiedades del producto de abono que llena el cliente ("Modelo del notebook", "Número de parte"...): { nombre: valor }.
export function datosDePropiedades(propiedades) {
  const lista = Object.entries(propiedades || {}).map(([k, v]) => [sinTildes(k), texto(v, 200)]).filter(([, v]) => v);
  let modelo = null, numeroParte = null;
  for (const [k, v] of lista) {
    if (!numeroParte && /\bpart|p\/n|\bpn\b|codigo|\bnumero\b/.test(k)) numeroParte = v;
    else if (!modelo && /modelo|notebook|laptop|portatil|equipo|computador|marca/.test(k)) modelo = v;
  }
  if (!modelo && !numeroParte && lista.length === 1) modelo = lista[0][1];
  return { modelo, numeroParte };
}

// Orden en el formato de los avisos (webhooks) de Shopify, que usan el formato REST (snake_case).
export function normalizarOrdenRest(o) {
  if (!o || o.id == null) return null;
  const cli = o.customer || {}, envio = o.shipping_address || {}, fact = o.billing_address || {};
  const nombre = [cli.first_name, cli.last_name].filter(Boolean).join(' ').trim() || envio.name || fact.name || '';
  return {
    orderId: String(o.id), nombre: o.name || null, creada: o.created_at || null, pago: String(o.financial_status || '').toLowerCase(),
    cancelada: Boolean(o.cancelled_at), nota: texto(o.note, 500),
    cliente: { nombre: texto(nombre, 120), email: texto(cli.email || o.email, 160), telefono: texto(cli.phone || envio.phone || fact.phone || o.phone, 40) },
    lineas: (o.line_items || []).map((l) => ({
      id: String(l.id), sku: String(l.sku || '').trim(), titulo: texto(l.title, 200), cantidad: Number(l.quantity) || 1, precio: Number(l.price) || 0,
      propiedades: Object.fromEntries((l.properties || []).filter((p) => p && p.name && !String(p.name).startsWith('_')).map((p) => [p.name, p.value])),
    })),
  };
}
// Orden de la Admin API GraphQL (para la revisión manual de pedidos).
export function normalizarOrdenGraphql(n) {
  if (!n || !n.id) return null;
  const cli = n.customer || {}, envio = n.shippingAddress || {};
  const nombre = [cli.firstName, cli.lastName].filter(Boolean).join(' ').trim() || envio.name || '';
  return {
    orderId: String(n.id).split('/').pop(), nombre: n.name || null, creada: n.createdAt || null, pago: String(n.displayFinancialStatus || '').toLowerCase(),
    cancelada: Boolean(n.cancelledAt), nota: texto(n.note, 500),
    cliente: { nombre: texto(nombre, 120), email: texto(cli.email || n.email, 160), telefono: texto(cli.phone || envio.phone || n.phone, 40) },
    lineas: ((n.lineItems && n.lineItems.nodes) || []).map((l) => ({
      id: String(l.id).split('/').pop(), sku: String(l.sku || '').trim(), titulo: texto(l.title, 200), cantidad: Number(l.quantity) || 1,
      precio: Number(l.originalUnitPriceSet && l.originalUnitPriceSet.shopMoney && l.originalUnitPriceSet.shopMoney.amount) || 0,
      propiedades: Object.fromEntries((l.customAttributes || []).filter((p) => p && p.key && !String(p.key).startsWith('_')).map((p) => [p.key, p.value])),
    })),
  };
}

// Las líneas de la orden que son el producto de abono (el SKU empieza con el prefijo), con el modelo que indicó el cliente.
export function extraerSolicitudes(orden, config) {
  const prefijo = normalizarConfig(config).prefijo_sku;
  return (orden.lineas || []).filter((l) => l.sku && l.sku.toUpperCase().startsWith(prefijo)).map((l) => {
    const { modelo, numeroParte } = datosDePropiedades(l.propiedades);
    return {
      lineaId: l.id, sku: l.sku, abono: Math.round(l.precio * l.cantidad), cantidad: l.cantidad,
      modelo: modelo || (orden.nota ? texto(orden.nota, 200) : null), numeroParte,
    };
  });
}

// ---------------------------------------------------------------- base de datos
export async function asegurarTablaPedidosPantalla(sql) { return unaVez('asegurarTablaPedidosPantalla', () => _asegurarTablaPedidosPantalla(sql)); }
async function _asegurarTablaPedidosPantalla(sql) {
  await sql`CREATE TABLE IF NOT EXISTS pedidos_pantalla (
    id SERIAL PRIMARY KEY,
    shopify_order_id TEXT, linea_id TEXT, orden_nombre TEXT, creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    cliente_nombre TEXT, cliente_email TEXT, cliente_telefono TEXT,
    modelo TEXT, numero_parte TEXT, nota_cliente TEXT, sku_abono TEXT, cantidad INTEGER NOT NULL DEFAULT 1, abono NUMERIC,
    pago TEXT, estado TEXT NOT NULL DEFAULT 'por_comprar',
    proveedor TEXT, costo_compra NUMERIC, referencia_compra TEXT, dias_estimados INTEGER, fecha_compra DATE, fecha_eta DATE, fecha_recibido DATE, fecha_entrega DATE,
    nota_interna TEXT, cancelada_en_shopify BOOLEAN NOT NULL DEFAULT false, aviso_enviado_en TIMESTAMPTZ,
    origen TEXT NOT NULL DEFAULT 'shopify', actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(), actualizado_por TEXT);`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_pantalla_linea ON pedidos_pantalla (shopify_order_id, linea_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pedidos_pantalla_estado ON pedidos_pantalla (estado, creado_en);`;
  await sql`CREATE TABLE IF NOT EXISTS pedidos_pantalla_historial (
    id SERIAL PRIMARY KEY, pedido_id INTEGER NOT NULL REFERENCES pedidos_pantalla(id) ON DELETE CASCADE, usuario TEXT, accion TEXT NOT NULL, creado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pedidos_pantalla_hist ON pedidos_pantalla_historial (pedido_id, creado_en);`;
  await sql`CREATE TABLE IF NOT EXISTS pedidos_pantalla_config (id INTEGER PRIMARY KEY CHECK (id = 1), config JSONB NOT NULL DEFAULT '{}'::jsonb, actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
}

export async function leerConfig(sql) {
  await asegurarTablaPedidosPantalla(sql);
  const { rows } = await sql.query('SELECT config FROM pedidos_pantalla_config WHERE id = 1');
  return normalizarConfig(rows[0] && rows[0].config);
}
export async function guardarConfig(sql, cambios) {
  const nueva = normalizarConfig({ ...(await leerConfig(sql)), ...cambios });
  await sql.query(`INSERT INTO pedidos_pantalla_config (id, config) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, actualizado_en = now()`, [JSON.stringify(nueva)]);
  return nueva;
}

async function anotar(sql, pedidoId, usuario, accion) {
  await sql.query('INSERT INTO pedidos_pantalla_historial (pedido_id, usuario, accion) VALUES ($1, $2, $3)', [pedidoId, usuario || 'Shopify', String(accion).slice(0, 500)]);
}

// Guarda lo que trae una orden de Shopify (ya normalizada). Idempotente: el mismo aviso o la misma revisión no duplica nada, y lo que la persona
// editó a mano (modelo, número de parte, estado) no se pisa. Devuelve { nuevos, actualizados, paraAvisar }: paraAvisar = solicitudes que pasaron a
// "por comprar" y que hay que avisar por correo (cada una se avisa una sola vez, ver reclamarAviso).
export async function guardarOrden(sql, orden, config) {
  await asegurarTablaPedidosPantalla(sql);
  const salida = { nuevos: 0, actualizados: 0, paraAvisar: [] };
  const pagado = estaPagado(orden.pago);
  const cliente = orden.cliente || {};
  for (const s of extraerSolicitudes(orden, config)) {
    const estadoInicial = orden.cancelada ? 'cancelado' : pagado ? 'por_comprar' : 'pendiente_pago';
    const { rows: ins } = await sql.query(
      `INSERT INTO pedidos_pantalla (shopify_order_id, linea_id, orden_nombre, creado_en, cliente_nombre, cliente_email, cliente_telefono, modelo, numero_parte, nota_cliente, sku_abono, cantidad, abono, pago, estado, cancelada_en_shopify, origen, actualizado_por)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'shopify', 'Shopify')
       ON CONFLICT (shopify_order_id, linea_id) DO NOTHING RETURNING *`,
      [orden.orderId, s.lineaId, orden.nombre, orden.creada, cliente.nombre || null, cliente.email || null, cliente.telefono || null, s.modelo, s.numeroParte, orden.nota, s.sku, s.cantidad, s.abono, orden.pago || null, estadoInicial, orden.cancelada]);
    if (ins[0]) {
      salida.nuevos++;
      await anotar(sql, ins[0].id, 'Shopify', `Pedido recibido de la tienda (orden ${orden.nombre || orden.orderId}, ${ETIQUETA_ESTADO[estadoInicial].toLowerCase()})`);
      if (estadoInicial === 'por_comprar') salida.paraAvisar.push(ins[0]);
      continue;
    }
    const { rows: [ex] } = await sql.query('SELECT * FROM pedidos_pantalla WHERE shopify_order_id = $1 AND linea_id = $2', [orden.orderId, s.lineaId]);
    if (!ex) continue;
    let estado = ex.estado;
    if (orden.cancelada && ['pendiente_pago', 'por_comprar'].includes(ex.estado)) { estado = 'cancelado'; await anotar(sql, ex.id, 'Shopify', 'La orden fue cancelada en la tienda'); }
    else if (orden.cancelada && ['comprado', 'recibido'].includes(ex.estado) && !ex.cancelada_en_shopify) await anotar(sql, ex.id, 'Shopify', 'La orden fue cancelada en la tienda, pero la pantalla ya estaba comprada: revisar qué hacer');
    else if (!orden.cancelada && pagado && ex.estado === 'pendiente_pago') { estado = 'por_comprar'; await anotar(sql, ex.id, 'Shopify', 'Abono pagado: pasa a por comprar'); }
    const { rows: [up] } = await sql.query(
      `UPDATE pedidos_pantalla SET pago = $2, estado = $3, cancelada_en_shopify = $4,
         cliente_nombre = COALESCE(cliente_nombre, $5), cliente_email = COALESCE(cliente_email, $6), cliente_telefono = COALESCE(cliente_telefono, $7),
         modelo = COALESCE(modelo, $8), numero_parte = COALESCE(numero_parte, $9), nota_cliente = COALESCE(nota_cliente, $10), actualizado_en = now()
       WHERE id = $1 RETURNING *`,
      [ex.id, orden.pago || ex.pago, estado, orden.cancelada || ex.cancelada_en_shopify, cliente.nombre || null, cliente.email || null, cliente.telefono || null, s.modelo, s.numeroParte, orden.nota]);
    salida.actualizados++;
    if (up.estado === 'por_comprar' && !up.aviso_enviado_en) salida.paraAvisar.push(up);
  }
  return salida;
}

// Antes de mandar el correo se "reclama" el aviso: solo quien logra marcarlo lo envía (dos avisos de Shopify a la vez no mandan dos correos).
export async function reclamarAviso(sql, id) {
  const { rows } = await sql.query('UPDATE pedidos_pantalla SET aviso_enviado_en = now() WHERE id = $1 AND aviso_enviado_en IS NULL RETURNING id', [id]);
  return rows.length > 0;
}

export async function listarPedidos(sql) {
  await asegurarTablaPedidosPantalla(sql);
  const { rows } = await sql.query(
    `SELECT p.*, p.fecha_compra::text AS fecha_compra, p.fecha_eta::text AS fecha_eta, p.fecha_recibido::text AS fecha_recibido, p.fecha_entrega::text AS fecha_entrega,
            COALESCE((SELECT json_agg(json_build_object('usuario', h.usuario, 'accion', h.accion, 'en', h.creado_en) ORDER BY h.creado_en DESC, h.id DESC) FROM pedidos_pantalla_historial h WHERE h.pedido_id = p.id), '[]'::json) AS historial
       FROM pedidos_pantalla p
      ORDER BY (p.estado = ANY($1::text[])) DESC, CASE p.estado WHEN 'por_comprar' THEN 0 WHEN 'pendiente_pago' THEN 1 WHEN 'comprado' THEN 2 WHEN 'recibido' THEN 3 ELSE 4 END, p.creado_en DESC
      LIMIT 500`, [ESTADOS_ACTIVOS]);
  return rows;
}

export async function leerPedido(sql, id) {
  await asegurarTablaPedidosPantalla(sql);
  const { rows } = await sql.query(
    `SELECT p.*, p.fecha_compra::text AS fecha_compra, p.fecha_eta::text AS fecha_eta, p.fecha_recibido::text AS fecha_recibido, p.fecha_entrega::text AS fecha_entrega,
            COALESCE((SELECT json_agg(json_build_object('usuario', h.usuario, 'accion', h.accion, 'en', h.creado_en) ORDER BY h.creado_en DESC, h.id DESC) FROM pedidos_pantalla_historial h WHERE h.pedido_id = p.id), '[]'::json) AS historial
       FROM pedidos_pantalla p WHERE p.id = $1`, [id]);
  return rows[0] || null;
}

export function resumirPedidos(filas, hoy = hoyChile()) {
  const por = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
  for (const f of filas) por[f.estado] = (por[f.estado] || 0) + 1;
  const porComprar = filas.filter((f) => f.estado === 'por_comprar');
  const masAntiguo = porComprar.length ? Math.max(...porComprar.map((f) => Math.max(0, Math.round((Date.parse(hoy + 'T12:00:00Z') - Date.parse(String(new Date(f.creado_en).toISOString()).slice(0, 10) + 'T12:00:00Z')) / 86400000)))) : null;
  const atrasados = filas.filter((f) => f.estado === 'comprado' && f.fecha_eta && String(f.fecha_eta).slice(0, 10) < hoy).length;
  return { porEstado: por, porComprarMasAntiguoDias: masAntiguo, atrasados };
}

// Cambios que hace una persona desde la página. Valida los estados y completa fechas. Devuelve { fila } o { error }.
export async function aplicarCambios(sql, id, body, { usuario, esAdmin = false, hoy = hoyChile() } = {}) {
  await asegurarTablaPedidosPantalla(sql);
  const { rows: [ex] } = await sql.query('SELECT *, fecha_eta::text AS fecha_eta_t FROM pedidos_pantalla WHERE id = $1', [id]);
  if (!ex) return { error: 'No existe ese pedido', status: 404 };
  const b = body || {};
  const sets = [], vals = [id]; const editados = [];
  const poner = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  const campoTexto = (clave, col, max) => { if (b[clave] !== undefined) { poner(col, texto(b[clave], max)); editados.push(clave); } };
  campoTexto('modelo', 'modelo', 200); campoTexto('numero_parte', 'numero_parte', 120); campoTexto('proveedor', 'proveedor', 120); campoTexto('referencia_compra', 'referencia_compra', 120);
  campoTexto('nota_interna', 'nota_interna', 1000); campoTexto('cliente_nombre', 'cliente_nombre', 120); campoTexto('cliente_telefono', 'cliente_telefono', 40); campoTexto('cliente_email', 'cliente_email', 160);
  if (b.costo_compra !== undefined) {
    if (!esAdmin) return { error: 'El costo de compra solo lo puede cambiar un administrador', status: 403 };
    const n = b.costo_compra === null || b.costo_compra === '' ? null : Number(b.costo_compra);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return { error: 'El costo de compra no es válido', status: 400 };
    poner('costo_compra', n); editados.push('costo');
  }
  if (b.dias_estimados !== undefined) {
    const n = b.dias_estimados === null || b.dias_estimados === '' ? null : Math.round(Number(b.dias_estimados));
    if (n !== null && !(n >= 1 && n <= 120)) return { error: 'Los días estimados deben estar entre 1 y 120', status: 400 };
    poner('dias_estimados', n); editados.push('días estimados');
  }
  if (b.fecha_eta !== undefined) {
    if (b.fecha_eta !== null && b.fecha_eta !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha_eta))) return { error: 'La fecha de llegada no es válida', status: 400 };
    poner('fecha_eta', b.fecha_eta || null); editados.push('fecha de llegada');
  }
  let estadoNuevo = ex.estado;
  if (b.estado !== undefined && b.estado !== ex.estado) {
    if (!ESTADOS.includes(b.estado)) return { error: 'Estado no válido', status: 400 };
    if (!(TRANSICIONES[ex.estado] || []).includes(b.estado)) return { error: `No se puede pasar de "${ETIQUETA_ESTADO[ex.estado]}" a "${ETIQUETA_ESTADO[b.estado]}"`, status: 400 };
    const modeloFinal = b.modelo !== undefined ? texto(b.modelo, 200) : ex.modelo;
    if (b.estado === 'comprado' && !modeloFinal) return { error: 'Antes de marcar la compra hay que indicar el modelo de la pantalla', status: 400 };
    estadoNuevo = b.estado; poner('estado', estadoNuevo);
    if (estadoNuevo === 'comprado') {
      poner('fecha_compra', hoy);
      const diasFinal = b.dias_estimados !== undefined ? (b.dias_estimados === '' ? null : Math.round(Number(b.dias_estimados))) : ex.dias_estimados;
      if (b.fecha_eta === undefined && !ex.fecha_eta_t && diasFinal) poner('fecha_eta', sumarDias(hoy, diasFinal));
    }
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

// Pedido tomado fuera de la tienda (WhatsApp, local): se anota a mano. pagado=true -> por comprar; si no, queda pendiente de pago.
export async function crearManual(sql, body, { usuario, config } = {}) {
  await asegurarTablaPedidosPantalla(sql);
  const b = body || {};
  const nombre = texto(b.cliente_nombre, 120), modelo = texto(b.modelo, 200);
  if (!nombre) return { error: 'Falta el nombre del cliente', status: 400 };
  if (!modelo) return { error: 'Falta el modelo de la pantalla', status: 400 };
  const abono = b.abono === undefined || b.abono === '' || b.abono === null ? null : Number(b.abono);
  if (abono !== null && (!Number.isFinite(abono) || abono < 0)) return { error: 'El abono no es válido', status: 400 };
  const dias = normalizarConfig(config).dias_estimados;
  const estado = b.pagado ? 'por_comprar' : 'pendiente_pago';
  const { rows: [fila] } = await sql.query(
    `INSERT INTO pedidos_pantalla (cliente_nombre, cliente_email, cliente_telefono, modelo, numero_parte, abono, pago, estado, dias_estimados, origen, orden_nombre, actualizado_por, aviso_enviado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', 'Manual', $10, now()) RETURNING *`,
    [nombre, texto(b.cliente_email, 160), texto(b.cliente_telefono, 40), modelo, texto(b.numero_parte, 120), abono, b.pagado ? 'paid' : 'pending', estado, dias, usuario || null]);
  await anotar(sql, fila.id, usuario, `Pedido anotado a mano (${ETIQUETA_ESTADO[estado].toLowerCase()})`);
  return { fila };
}

export function urlAdminOrden(dominio, orderId) {
  const tienda = String(dominio || '').replace(/^https?:\/\//i, '').replace(/\.myshopify\.com.*$/i, '');
  return tienda && orderId ? `https://admin.shopify.com/store/${tienda}/orders/${orderId}` : null;
}

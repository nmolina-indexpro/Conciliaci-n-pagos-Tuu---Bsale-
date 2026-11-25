// /lib/pedidos-pantalla-foto.js
// Foto de referencia que sube el vendedor en Productos a pedido (por ejemplo, para ver la estructura de la pantalla, el conector o cualquier detalle).
// El navegador la reduce y la manda como data URL; aquí se valida (solo JPG, PNG o WebP de verdad, con tope de tamaño) y se guarda en su propia tabla para que
// la lista de pedidos no cargue imágenes. Se entrega por ?recurso=pedidos-pantalla&foto=ID, que exige sesión como todo el ERP.

export const MAX_BYTES_FOTO = 1_500_000; // lo que pesa la imagen ya reducida (el navegador la deja en ~100-300 KB)
const MAX_LARGO_DATAURL = 2_100_000; // 1,5 MB en base64 + el encabezado
const RE_DATAURL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

// Comprueba que los primeros bytes sean de verdad los de la imagen que dice ser (no se confía en el tipo declarado).
function tipoReal(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// data URL -> { tipo, buffer } o { error }
export function leerFotoDataUrl(dataUrl) {
  const s = String(dataUrl || '');
  if (s.length > MAX_LARGO_DATAURL) return { error: 'La foto es demasiado grande (máximo 1,5 MB). Prueba con otra o con menos resolución.' };
  const m = RE_DATAURL.exec(s);
  if (!m) return { error: 'La foto debe ser una imagen JPG, PNG o WebP' };
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES_FOTO) return { error: 'La foto es demasiado grande (máximo 1,5 MB). Prueba con otra o con menos resolución.' };
  const tipo = tipoReal(buffer);
  if (!tipo) return { error: 'La foto no es una imagen válida (JPG, PNG o WebP)' };
  return { tipo, buffer };
}

export async function asegurarTablaFotoPedido(sql) {
  await sql`CREATE TABLE IF NOT EXISTS pedidos_pantalla_foto (
    pedido_id INTEGER PRIMARY KEY REFERENCES pedidos_pantalla(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL, datos BYTEA NOT NULL, actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
}
export async function guardarFotoPedido(sql, pedidoId, foto) {
  await sql.query(
    `INSERT INTO pedidos_pantalla_foto (pedido_id, tipo, datos, actualizado_en) VALUES ($1, $2, $3, now())
     ON CONFLICT (pedido_id) DO UPDATE SET tipo = EXCLUDED.tipo, datos = EXCLUDED.datos, actualizado_en = now()`,
    [pedidoId, foto.tipo, foto.buffer]);
}
export async function borrarFotoPedido(sql, pedidoId) {
  await sql.query('DELETE FROM pedidos_pantalla_foto WHERE pedido_id = $1', [pedidoId]);
}
export async function leerFotoPedido(sql, pedidoId) {
  const { rows } = await sql.query('SELECT tipo, datos FROM pedidos_pantalla_foto WHERE pedido_id = $1', [pedidoId]);
  if (!rows[0]) return null;
  const datos = rows[0].datos;
  return { tipo: rows[0].tipo, buffer: Buffer.isBuffer(datos) ? datos : Buffer.from(datos) };
}

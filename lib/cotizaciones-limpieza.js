// /lib/cotizaciones-limpieza.js
// ══════════════════════════════════════════════════════════════════════
// Limpieza de cotizaciones (módulo Cotizaciones, tabla bsale_cotizaciones).
// ══════════════════════════════════════════════════════════════════════
// Dos reglas pedidas por el usuario:
//   1) Cuando un mismo cliente tiene 2 o más cotizaciones que no están asociadas a una venta, las más antiguas se anulan:
//      queda solo la más reciente (ej. cotización 9746 reemplazada por una posterior).
//   2) Las cotizaciones anuladas se eliminan del ERP (ej. la 9737, anulada en Bsale).
// "Eliminar" = sacarla de bsale_cotizaciones. Para que la sincronización no la vuelva a traer desde Bsale (la cotización sigue vigente allá),
// se deja una copia en bsale_cotizaciones_eliminadas (con el motivo): la sincronización no vuelve a insertar ningún id que esté ahí, y sirve
// de registro por si hubo un error. Al borrar una cotización se borran también sus registros de contacto (ON DELETE CASCADE).
//
// Qué cuenta como duplicada: mismo cliente_id, sin documento_asociado_id (no vinculada a una boleta/factura), no facturada, y en un estado
// "abierto" (sin_contactar ... contactado_segunda_vez). Las perdidas y las de Mercado Público se conservan: son historial, no seguimiento.
// La que se conserva es la más reciente (por fecha de emisión y, a igualdad, la de número de documento mayor).
export const ESTADOS_COTIZACION_ABIERTOS = ['sin_contactar', 'cotizacion_enviada', 'cliente_respondio', 'contactado', 'contactado_no_responde', 'contactado_segunda_vez'];
export const MOTIVO_DUPLICADA = 'duplicada';
export const MOTIVO_ANULADA_BSALE = 'anulada_en_bsale';

export async function asegurarTablaCotizacionesEliminadas(sql) {
  await sql`CREATE TABLE IF NOT EXISTS bsale_cotizaciones_eliminadas (
    id INTEGER PRIMARY KEY, numero TEXT, cliente_id INTEGER, cliente_nombre TEXT, monto NUMERIC, fecha DATE, estado_previo TEXT,
    motivo TEXT NOT NULL, detalle TEXT, eliminada_en TIMESTAMPTZ NOT NULL DEFAULT now(), eliminada_por TEXT);`;
}

// filas = [{ id, detalle }]. Devuelve cuántas se eliminaron de verdad (las que ya no estaban se ignoran).
export async function eliminarCotizaciones(sql, filas, motivo, por) {
  let n = 0;
  for (const f of filas) {
    await sql`
      INSERT INTO bsale_cotizaciones_eliminadas (id, numero, cliente_id, cliente_nombre, monto, fecha, estado_previo, motivo, detalle, eliminada_por)
      SELECT id, numero, cliente_id, cliente_nombre, monto, fecha, estado, ${motivo}, ${f.detalle || null}, ${por || null}
      FROM bsale_cotizaciones WHERE id = ${f.id}
      ON CONFLICT (id) DO NOTHING;`;
    const { rows: borradas } = await sql`DELETE FROM bsale_cotizaciones WHERE id = ${f.id} RETURNING id;`;
    if (borradas.length) n += 1;
  }
  return n;
}

// Cotizaciones que sobran: todas las abiertas, sin venta asociada, que no son la más reciente de su cliente.
export async function buscarDuplicadas(sql) {
  const { rows } = await sql`
    SELECT id, numero, cliente_id, cliente_nombre, monto::float AS monto, fecha::text AS fecha, estado, reemplazada_por FROM (
      SELECT id, numero, cliente_id, cliente_nombre, monto, fecha, estado,
        row_number() OVER (PARTITION BY cliente_id ORDER BY fecha DESC NULLS LAST, id DESC) AS rn,
        first_value(numero) OVER (PARTITION BY cliente_id ORDER BY fecha DESC NULLS LAST, id DESC) AS reemplazada_por
      FROM bsale_cotizaciones
      WHERE cliente_id IS NOT NULL AND documento_asociado_id IS NULL AND estado <> 'facturada'
    ) t
    WHERE rn > 1 AND estado = ANY(${ESTADOS_COTIZACION_ABIERTOS}::text[])
    ORDER BY cliente_nombre, fecha DESC, id DESC;`;
  return rows;
}

// simular = true: solo dice cuáles se anularían, sin tocar nada.
export async function anularCotizacionesDuplicadas(sql, { simular = false, por = null } = {}) {
  await asegurarTablaCotizacionesEliminadas(sql);
  const candidatas = await buscarDuplicadas(sql);
  if (simular || !candidatas.length) return { simulacion: simular, cantidad: candidatas.length, eliminadas: 0, filas: candidatas.slice(0, 200) };
  const eliminadas = await eliminarCotizaciones(sql, candidatas.map(c => ({ id: c.id, detalle: `Reemplazada por la cotización N° ${c.reemplazada_por}` })), MOTIVO_DUPLICADA, por);
  return { simulacion: false, cantidad: candidatas.length, eliminadas, filas: candidatas.slice(0, 200) };
}

export async function listarEliminadas(sql, limite = 200) {
  await asegurarTablaCotizacionesEliminadas(sql);
  const { rows } = await sql`
    SELECT id, numero, cliente_nombre, monto::float AS monto, fecha::text AS fecha, estado_previo, motivo, detalle, eliminada_en, eliminada_por
    FROM bsale_cotizaciones_eliminadas ORDER BY eliminada_en DESC, id DESC LIMIT ${limite};`;
  return rows;
}

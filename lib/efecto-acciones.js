// /lib/efecto-acciones.js
// ═════════════════════════════════════════════════════════════════
// "¿Funcionó?" de Productos estancados: para cada SKU con una acción marcada (🚚 Envío gratis, 💲 Variación de precio, 🛒 Mercado Libre)
// mide qué pasó con sus ventas desde el día en que se marcó (ventas_sku_flags_historial guarda cuándo).
//   - Envío gratis y Variación de precio: unidades y ventas (documentos) del SKU desde ese día, comparadas con el mismo número de días
//     anteriores. No se puede aislar la venta "con envío gratis" de las demás: es lo que vendió el SKU en total.
//   - Mercado Libre: solo cuentan las ventas de Bsale hechas por el usuario "Venta web" con medio de pago "Abono Mercado Libre".
//     Ese dato (vendedor y medios de pago) se guarda al sincronizar con Bsale; los documentos ya sincronizados lo traen recién en la
//     siguiente pasada completa.
// Solo cantidades de unidades y de ventas, sin montos.
// ═════════════════════════════════════════════════════════════════

export const CAMPOS_EFECTO = ['envio_gratis', 'variacion_precio', 'mercado_libre'];
export const DIAS_MINIMOS_PARA_CONCLUIR = 7;
const RE_MERCADO_LIBRE = 'mercado[[:space:]]*libre';
const RE_VENTA_WEB = 'venta[[:space:]]*web';

// ¿Qué se puede decir con estos números? funciono = hubo ventas; sin_ventas = ya pasó tiempo y no hubo; pronto = muy poco tiempo para concluir;
// sin_fecha = se marcó antes de que existiera el historial; sin_datos_pago = (solo Mercado Libre) todavía no se leyó el medio de pago.
export function veredicto(campo, r) {
  if (!r || !r.desde) return 'sin_fecha';
  if (r.unidades > 0) return 'funciono';
  if (campo === 'mercado_libre' && r.total_documentos > 0 && r.con_pago === 0) return 'sin_datos_pago';
  return r.dias < DIAS_MINIMOS_PARA_CONCLUIR ? 'pronto' : 'sin_ventas';
}

// hoy: día de Chile (AAAA-MM-DD). Devuelve { [sku]: { envio_gratis?, variacion_precio?, mercado_libre? } }, solo para lo que está marcado.
export async function efectoAcciones(sql, hoy) {
  const marcados = await sql.query(
    `SELECT c.sku,
            c.mercado_libre, c.envio_gratis, c.variacion_precio,
            (SELECT (max(h.cambiado_en) AT TIME ZONE 'America/Santiago')::date FROM ventas_sku_flags_historial h WHERE h.sku = c.sku AND h.campo = 'mercado_libre' AND h.valor_nuevo) AS mercado_libre_desde,
            (SELECT (max(h.cambiado_en) AT TIME ZONE 'America/Santiago')::date FROM ventas_sku_flags_historial h WHERE h.sku = c.sku AND h.campo = 'envio_gratis' AND h.valor_nuevo) AS envio_gratis_desde,
            (SELECT (max(h.cambiado_en) AT TIME ZONE 'America/Santiago')::date FROM ventas_sku_flags_historial h WHERE h.sku = c.sku AND h.campo = 'variacion_precio' AND h.valor_nuevo) AS variacion_precio_desde
       FROM ventas_sku_comentarios c
      WHERE c.mercado_libre OR c.envio_gratis OR c.variacion_precio`,
  );
  const pares = []; // [sku, campo, desde|null]
  for (const m of marcados.rows) {
    for (const campo of CAMPOS_EFECTO) if (m[campo]) pares.push([m.sku, campo, m[campo + '_desde'] ? new Date(m[campo + '_desde']).toISOString().slice(0, 10) : null]);
  }
  const salida = {};
  if (!pares.length) return salida;

  const conFecha = pares.filter((p) => p[2]);
  const medidas = new Map();
  if (conFecha.length) {
    const r = await sql.query(
      `WITH p AS (SELECT * FROM unnest($1::text[], $2::text[], $3::date[]) AS t(sku, campo, desde)),
            j AS (
              SELECT p.sku, p.campo, p.desde, ($4::date - p.desde + 1) AS dias, v.documento_id, v.cantidad, v.fecha,
                     (v.medios_pago ~* '${RE_MERCADO_LIBRE}' AND v.vendedor ~* '${RE_VENTA_WEB}') AS es_ml,
                     (v.medios_pago IS NOT NULL) AS con_pago
                FROM p LEFT JOIN bsale_ventas_sku v
                  ON v.sku = p.sku AND v.fecha >= p.desde - ($4::date - p.desde + 1)::int AND v.fecha <= $4::date
            )
       SELECT sku, campo, desde::text AS desde, max(dias)::int AS dias,
              COALESCE(sum(cantidad) FILTER (WHERE fecha >= desde AND (campo <> 'mercado_libre' OR es_ml)), 0)::float AS unidades,
              count(DISTINCT documento_id) FILTER (WHERE fecha >= desde AND (campo <> 'mercado_libre' OR es_ml))::int AS documentos,
              COALESCE(sum(cantidad) FILTER (WHERE fecha < desde), 0)::float AS antes_unidades,
              count(DISTINCT documento_id) FILTER (WHERE fecha < desde)::int AS antes_documentos,
              COALESCE(sum(cantidad) FILTER (WHERE fecha >= desde), 0)::float AS total_unidades,
              count(DISTINCT documento_id) FILTER (WHERE fecha >= desde)::int AS total_documentos,
              count(*) FILTER (WHERE fecha >= desde AND con_pago)::int AS con_pago
         FROM j GROUP BY sku, campo, desde`,
      [conFecha.map((p) => p[0]), conFecha.map((p) => p[1]), conFecha.map((p) => p[2]), hoy],
    );
    for (const x of r.rows) medidas.set(x.sku + '|' + x.campo, x);
  }

  for (const [sku, campo, desde] of pares) {
    const x = medidas.get(sku + '|' + campo);
    const base = x
      ? { desde: x.desde, dias: x.dias, unidades: x.unidades, documentos: x.documentos, antes_unidades: x.antes_unidades, antes_documentos: x.antes_documentos, total_unidades: x.total_unidades, total_documentos: x.total_documentos, con_pago: x.con_pago }
      : { desde: null };
    (salida[sku] = salida[sku] || {})[campo] = { ...base, estado: veredicto(campo, base) };
  }
  return salida;
}

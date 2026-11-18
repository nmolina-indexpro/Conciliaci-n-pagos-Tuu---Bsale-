// /lib/compras-daxis.js
// Compras > Importación Daxis:
//  - Productos DESCONTINUADOS: se marcan en la tabla y no se vuelven a mostrar (se pueden reactivar). Tabla compras_daxis_descontinuados.
//  - Lo que viene EN CAMINO de cada SKU, leído de Productos en tránsito (envíos que aún no se marcan como entregados). El cruce es el mismo del simulador de
//    precio (reposicionDeSku, lib/frecuencia-precio.js): el SKU de Bsale puede estar en el SKU del envío o en su nombre.
import { unaVez } from './una-vez.js';
import { asegurarTablaProductosTransito } from './db.js';
import { reposicionDeSku } from './frecuencia-precio.js';

export async function asegurarTablaComprasDaxis(sql) { return unaVez('asegurarTablaComprasDaxis', () => _asegurarTablaComprasDaxis(sql)); }
async function _asegurarTablaComprasDaxis(sql) {
  await sql`CREATE TABLE IF NOT EXISTS compras_daxis_descontinuados (sku TEXT PRIMARY KEY, marcado_por TEXT, marcado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
}

export async function listarDescontinuados(sql) {
  await asegurarTablaComprasDaxis(sql);
  const { rows } = await sql`SELECT sku, marcado_por AS por, marcado_en AS en FROM compras_daxis_descontinuados ORDER BY marcado_en DESC;`;
  return rows;
}

// Marca (descontinuado = true) o reactiva un SKU. Es reversible, por eso lo puede hacer cualquiera con acceso a Compras.
export async function marcarDescontinuado(sql, sku, descontinuado, usuario) {
  await asegurarTablaComprasDaxis(sql);
  if (descontinuado) {
    await sql`INSERT INTO compras_daxis_descontinuados (sku, marcado_por) VALUES (${sku}, ${usuario || null}) ON CONFLICT (sku) DO NOTHING;`;
  } else {
    await sql`DELETE FROM compras_daxis_descontinuados WHERE sku = ${sku};`;
  }
}

// { SKU: [{ referencia, estado, tipoTransporte, fechaEta, cantidad }] } solo para los SKU que tienen algo en camino (envíos no entregados).
export async function enCaminoPorSku(sql, skus) {
  const salida = {};
  if (!skus || !skus.length) return salida;
  await asegurarTablaProductosTransito(sql);
  const { rows: envios } = await sql`SELECT referencia, estado, tipo_transporte, fecha_eta::text AS fecha_eta, productos FROM productos_transito_envios WHERE estado <> 'entregado';`;
  for (const sku of skus) {
    const lineas = reposicionDeSku(envios, sku);
    if (lineas.length) salida[sku] = lineas;
  }
  return salida;
}

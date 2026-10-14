// /lib/bsale-sync.js
// ══════════════════════════════════════════════════════════════════════
// Sincronización Bsale -> Shopify (stock y precios) -- reemplazo de la app "Bsale (Chile)" de Lobo Creaciones.
// Esta primera versión NO escribe en Shopify: recibe los avisos (webhooks) de Bsale, los guarda y calcula, por SKU, qué cambiaría
// (modo sombra). Las funciones de cálculo son puras para poder probarlas sin red.
// ══════════════════════════════════════════════════════════════════════

export async function asegurarTablasBsaleSync(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS bsale_sync_eventos (
      id SERIAL PRIMARY KEY,
      recibido_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      topic TEXT,
      accion TEXT,
      recurso TEXT,
      recurso_id TEXT,
      cpn_id TEXT,
      resultado JSONB
    );
  `;
}

// Solo se aceptan recursos de la propia API de Bsale (nunca una dirección cualquiera que venga en el aviso).
export function recursoBsaleSeguro(recurso) {
  let r = String(recurso || '').trim();
  // Bsale puede mandar la dirección completa (https://api.bsale.io/v1/...) o solo la ruta (/v1/... o /stocks/...): se deja siempre como /v1/...
  const completa = r.match(/^https:\/\/api\.bsale\.io(\/.*)$/i);
  if (completa) r = completa[1];
  else if (/^https?:\/\//i.test(r)) return null; // otra dirección: nunca
  if (r.startsWith('/') && !/^\/v[12]\//.test(r)) r = '/v1' + r;
  if (!/^\/v[12]\/[a-zA-Z0-9_\/\.\-]+(\?[a-zA-Z0-9_=&%,.\-\[\]]*)?$/.test(r) || r.includes('..')) return null;
  return r;
}

// Qué haría falta en Shopify para un SKU, dado lo que dice Bsale ahora. "variantes" = todas las publicaciones de ese SKU en Shopify
// ({ id, producto, estado, stock, precio }). Valores de Bsale opcionales: si no vienen, ese aspecto no se evalúa.
export function planDeSku({ sku, disponibleBsale, precioBrutoBsale, variantes }) {
  const cambios = [];
  const stockBsale = disponibleBsale == null ? null : Math.max(0, Math.floor(Number(disponibleBsale) || 0));
  const precioBsale = precioBrutoBsale == null ? null : Math.round(Number(precioBrutoBsale) || 0);
  for (const v of variantes || []) {
    if (stockBsale !== null && (v.stock ?? 0) !== stockBsale) cambios.push({ tipo: 'stock', sku, variante: v.id, producto: v.producto, estado: v.estado, de: v.stock ?? 0, a: stockBsale });
    if (precioBsale !== null && precioBsale > 0 && Math.abs((v.precio ?? 0) - precioBsale) > 1) cambios.push({ tipo: 'precio', sku, variante: v.id, producto: v.producto, estado: v.estado, de: v.precio ?? 0, a: precioBsale });
  }
  return { sku, publicaciones: (variantes || []).length, cambios, igual: cambios.length === 0 };
}

// Del aviso de Bsale y del recurso ya leído de la API saca lo necesario para planificar. Devuelve null si no es algo de stock/precio.
// stock:  { variant:{code}, quantity, quantityAvailable, office:{id|href} }
// precio: { variant:{code}, variantValue, variantValueWithTaxes }
export function datosDeAviso(topic, recurso, officeIdEsperado) {
  const t = String(topic || '').toLowerCase();
  const sku = recurso && recurso.variant && recurso.variant.code;
  if (!sku) return null;
  if (t === 'stock') {
    const oficina = recurso.office && (recurso.office.id ?? String(recurso.office.href || '').match(/(\d+)\.json/)?.[1]);
    if (officeIdEsperado && oficina != null && Number(oficina) !== Number(officeIdEsperado)) return { sku, ignorado: 'otra bodega' };
    return { sku, disponibleBsale: recurso.quantityAvailable ?? recurso.quantity ?? 0 };
  }
  if (t === 'price' || t === 'precio') {
    const bruto = recurso.variantValueWithTaxes != null ? Number(recurso.variantValueWithTaxes) : (recurso.variantValue != null ? Math.round(Number(recurso.variantValue) * 1.19) : null);
    return bruto == null ? null : { sku, precioBrutoBsale: bruto };
  }
  return null;
}

// Emisión de documentos desde el ERP: un interruptor por tipo (todos nacen apagados) y el registro de lo emitido.
export async function asegurarTablasEmisionBsale(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS bsale_emision_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      nota_venta BOOLEAN NOT NULL DEFAULT false,
      boleta BOOLEAN NOT NULL DEFAULT false,
      factura BOOLEAN NOT NULL DEFAULT false,
      actualizado_por TEXT,
      actualizado_en TIMESTAMPTZ
    );
  `;
  await sql`INSERT INTO bsale_emision_config (id) VALUES (1) ON CONFLICT DO NOTHING;`;
  await sql`
    CREATE TABLE IF NOT EXISTS bsale_emisiones (
      id SERIAL PRIMARY KEY,
      shopify_order_id TEXT NOT NULL,
      pedido TEXT,
      tipo TEXT NOT NULL,
      estado TEXT NOT NULL,
      bsale_id BIGINT,
      numero BIGINT,
      url TEXT,
      total INTEGER,
      error TEXT,
      payload JSONB,
      creado_por TEXT,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  // un solo registro vigente (procesando o emitido) por pedido y tipo: es lo que impide emitir dos veces
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS bsale_emisiones_vigente ON bsale_emisiones (shopify_order_id, tipo) WHERE estado IN ('procesando', 'emitido');`;
}

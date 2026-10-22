// /lib/comparativo-ventas.js
// Comparativo de ventas entre dos meses (ej. octubre 2025 vs octubre 2026) por monto, unidades, categoría y marca.
// Parte pura (sin red ni BD) para poder probarla: períodos, detección de marca y armado del comparativo.

// Marcas que se reconocen en el nombre del producto. Bsale no tiene un campo "marca": se detecta por el nombre. Lo que no calce queda en
// "Sin marca identificada" y la pantalla muestra cuánto pesa, para ir completando esta lista.
export const MARCAS_PRODUCTO = [
  'HP', 'Lenovo', 'Dell', 'Asus', 'Acer', 'Apple', 'Samsung', 'Toshiba', 'MSI', 'Huawei', 'Xiaomi', 'LG', 'Gigabyte', 'Razer', 'Microsoft',
  'Compaq', 'Sony', 'Positivo', 'Gateway', 'Packard Bell', 'Fujitsu', 'Medion', 'Honor', 'Chuwi', 'Alienware',
  'Logitech', 'Kingston', 'Crucial', 'Western Digital', 'WD', 'Seagate', 'SanDisk', 'Adata', 'Patriot', 'Lexar', 'Verbatim', 'Corsair', 'HyperX',
  'Redragon', 'Genius', 'Havit', 'Anker', 'Baseus', 'JBL', 'Sennheiser', 'Intel', 'AMD', 'Nvidia', 'Targus', 'Philips', 'Hikvision', 'Dahua', 'Ezviz',
  'TP-Link', 'Mercusys', 'Tenda', 'D-Link', 'Netgear', 'Cisco', 'Mikrotik', 'Ubiquiti', 'APC', 'Forza', 'Epson', 'Canon', 'Brother', 'Xerox',
  'Ugreen', 'Hisense', 'AOC', 'BenQ', 'ViewSonic', 'Teros', 'Maxell', 'Kodak', 'Belkin', 'Verbatim', 'Trust', 'Elgato', 'Garmin', 'Realme', 'Motorola',
];

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => ` ${sinTildes(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;
const MARCAS_NORM = [...new Set(MARCAS_PRODUCTO)].map((m) => ({ marca: m, buscar: norm(m) }));

export const SIN_MARCA = 'Sin marca identificada';
export const SIN_CATEGORIA = 'Sin categoría';

// Primera marca que aparece en el nombre (con límites de palabra: "HP" no calza dentro de "CHP12").
export function detectarMarca(nombre) {
  const t = norm(nombre);
  let mejor = null;
  for (const m of MARCAS_NORM) {
    const i = t.indexOf(m.buscar);
    if (i >= 0 && (mejor === null || i < mejor.i)) mejor = { i, marca: m.marca };
  }
  return mejor ? mejor.marca : SIN_MARCA;
}

// "2026-10" -> { anio, mes } ; null si no es válido.
export function parsearMes(texto) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(texto || ''));
  return m ? { anio: Number(m[1]), mes: Number(m[2]) } : null;
}
export const mesAnterior12 = (texto) => { const p = parsearMes(texto); return p ? `${p.anio - 1}-${String(p.mes).padStart(2, '0')}` : null; };
export const diasDelMes = (texto) => { const p = parsearMes(texto); return p ? new Date(Date.UTC(p.anio, p.mes, 0)).getUTCDate() : null; };
// Bsale guarda la fecha de emisión como medianoche UTC del día real: el rango del mes en epoch es exacto.
export function rangoEpochMes(texto) {
  const p = parsearMes(texto);
  if (!p) return null;
  return { desde: Math.floor(Date.UTC(p.anio, p.mes - 1, 1) / 1000), hasta: Math.floor(Date.UTC(p.anio, p.mes, 1) / 1000) - 1 };
}

const pct = (nuevo, viejo) => (viejo > 0 ? Math.round(((nuevo - viejo) / viejo) * 1000) / 10 : null);
const redondear = (n) => Math.round(Number(n) || 0);

function filaComparada(clave, a, b, totA, totB) {
  const montoA = a.monto, montoB = b.monto, uniA = a.unidades, uniB = b.unidades;
  return {
    clave,
    montoActual: redondear(montoA), montoBase: redondear(montoB), varMonto: redondear(montoA - montoB), varMontoPct: pct(montoA, montoB),
    unidadesActual: redondear(uniA), unidadesBase: redondear(uniB), varUnidades: redondear(uniA - uniB), varUnidadesPct: pct(uniA, uniB),
    precioActual: uniA > 0 ? redondear(montoA / uniA) : null, precioBase: uniB > 0 ? redondear(montoB / uniB) : null,
    partActual: totA > 0 ? Math.round((montoA / totA) * 1000) / 10 : 0, partBase: totB > 0 ? Math.round((montoB / totB) * 1000) / 10 : 0,
    skusActual: a.skus.size, skusBase: b.skus.size,
  };
}

// filas: [{ periodo, sku, nombre, categoria, unidades, monto }] ya agrupadas por (periodo, sku) y SIN servicios.
// Devuelve totales, categorías, marcas y productos comparados. Las tablas de categoría y marca ordenadas por monto del período actual.
export function armarComparativo(filas, { actual, base }) {
  const vacio = () => ({ monto: 0, unidades: 0, skus: new Set() });
  const totales = { actual: vacio(), base: vacio() };
  const cats = new Map(), marcas = new Map(), prods = new Map();
  const tomar = (mapa, clave) => { if (!mapa.has(clave)) mapa.set(clave, { actual: vacio(), base: vacio() }); return mapa.get(clave); };
  for (const f of filas || []) {
    const lado = f.periodo === actual ? 'actual' : f.periodo === base ? 'base' : null;
    if (!lado) continue;
    const monto = Number(f.monto) || 0, unidades = Number(f.unidades) || 0;
    const categoria = f.categoria || SIN_CATEGORIA, marca = detectarMarca(f.nombre);
    for (const [mapa, clave] of [[cats, categoria], [marcas, marca], [prods, f.sku]]) {
      const x = tomar(mapa, clave)[lado]; x.monto += monto; x.unidades += unidades; x.skus.add(f.sku);
    }
    totales[lado].monto += monto; totales[lado].unidades += unidades; totales[lado].skus.add(f.sku);
    const p = prods.get(f.sku); p.nombre = p.nombre || f.nombre; p.categoria = p.categoria || categoria; p.marca = marca;
  }
  const lista = (mapa) => [...mapa.entries()]
    .map(([k, v]) => filaComparada(k, v.actual, v.base, totales.actual.monto, totales.base.monto))
    .sort((x, y) => y.montoActual - x.montoActual || y.montoBase - x.montoBase);
  const productos = [...prods.entries()].map(([sku, v]) => {
    const f = filaComparada(sku, v.actual, v.base, totales.actual.monto, totales.base.monto);
    f.sku = sku; f.nombre = v.nombre || sku; f.categoria = v.categoria; f.marca = v.marca;
    f.estado = v.base.monto <= 0 && v.actual.monto > 0 ? 'nuevo' : v.actual.monto <= 0 && v.base.monto > 0 ? 'sin_ventas' : f.varMonto >= 0 ? 'crece' : 'cae';
    return f;
  });
  const fin = (t) => ({ monto: redondear(t.monto), unidades: redondear(t.unidades), skus: t.skus.size });
  const marcaSin = marcas.get(SIN_MARCA);
  return {
    totales: { actual: fin(totales.actual), base: fin(totales.base), varMonto: redondear(totales.actual.monto - totales.base.monto), varMontoPct: pct(totales.actual.monto, totales.base.monto), varUnidades: redondear(totales.actual.unidades - totales.base.unidades), varUnidadesPct: pct(totales.actual.unidades, totales.base.unidades) },
    categorias: lista(cats), marcas: lista(marcas), productos,
    // cuánto del monto quedó sin marca reconocida (para saber qué tan confiable es la tabla de marcas)
    sinMarca: { actualPct: totales.actual.monto > 0 && marcaSin ? Math.round((marcaSin.actual.monto / totales.actual.monto) * 1000) / 10 : 0, basePct: totales.base.monto > 0 && marcaSin ? Math.round((marcaSin.base.monto / totales.base.monto) * 1000) / 10 : 0 },
  };
}

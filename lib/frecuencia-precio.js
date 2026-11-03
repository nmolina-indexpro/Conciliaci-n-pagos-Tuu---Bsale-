// /lib/frecuencia-precio.js
// ═════════════════════════════════════════════════════════════════
// Frecuencia de venta de un SKU y evidencia de qué pasó con las ventas cuando bajó el precio ("Productos estancados" > Simular precio).
// Funciones puras: reciben las filas de bsale_ventas_sku (una por documento y SKU, monto NETO) y devuelven números listos para mostrar.
//   - analizarFrecuencia: cada cuántos días vende, unidades por mes, tendencia, precio vigente y la serie mensual (unidades, ventas, precio).
//   - evidenciaBajasPrecio: con TODOS los SKU, compara las unidades del mes siguiente a una baja de precio (>= 5 %) contra lo que le pasó ese mismo
//     mes a los SKU que no cambiaron de precio (temporada, días hábiles) -> cuánto subió de más y la elasticidad implícita.
// Es una observación del historial, no un experimento: no aísla stock, promociones ni la competencia. La página lo dice así.
// ═════════════════════════════════════════════════════════════════

const DIA_MS = 86400000;
export const DIAS_POR_MES = 30.4;
export const UMBRAL_BAJA_PRECIO = 0.05;   // una baja de precio es un cambio de al menos 5 % entre meses con ventas
export const UMBRAL_PRECIO_ESTABLE = 0.02; // "sin cambio de precio" = variación menor a 2 %
export const MIN_EVENTOS_CONFIABLE = 8;

const aMs = f => Date.parse(String(f).slice(0, 10) + 'T00:00:00Z');
const aFecha = ms => new Date(ms).toISOString().slice(0, 10);
const redondear = (n, d = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

export function mediana(arr) {
  const v = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// 'YYYY-MM' de una fecha, y el mes siguiente / n meses atrás
const mesDe = f => String(f).slice(0, 7);
function sumarMeses(mes, n) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
const indiceMes = mes => { const [y, m] = mes.split('-').map(Number); return y * 12 + (m - 1); };

// filas: [{ fecha:'AAAA-MM-DD', cantidad, monto }] de UN SKU (monto neto). hoy: 'AAAA-MM-DD' (día de Chile).
export function analizarFrecuencia(filas, hoy) {
  const hoyMs = aMs(hoy);
  const docs = (filas || [])
    .map(f => ({ ms: aMs(f.fecha), fecha: String(f.fecha).slice(0, 10), cantidad: Number(f.cantidad) || 0, monto: Number(f.monto) || 0 }))
    .filter(f => f.cantidad > 0 && f.ms <= hoyMs && hoyMs - f.ms < 365 * DIA_MS)
    .sort((a, b) => a.ms - b.ms);

  const salida = { hoy, ventas: docs.length, unidades: 0, primeraVenta: null, ultimaVenta: null, diasSinVenta: null, ventanaDias: null, pocaHistoria: false,
    ventasPorMes: 0, unidadesPorMes: 0, diasEntreVentas: null, diasEntreVentasMediana: null,
    ult90: { ventas: 0, unidades: 0 }, prev90: { ventas: 0, unidades: 0 }, tendenciaPct: null, precioVigenteNeto: null, meses: [], cambiosPrecio: [] };

  // Serie mensual de los últimos 12 meses (incluye el mes en curso, marcado como parcial)
  const mesActual = mesDe(hoy);
  for (let i = 11; i >= 0; i--) salida.meses.push({ mes: sumarMeses(mesActual, -i), unidades: 0, ventas: 0, montoNeto: 0, precioNeto: null, parcial: i === 0 });
  const porMes = new Map(salida.meses.map(m => [m.mes, m]));
  for (const d of docs) {
    const m = porMes.get(mesDe(d.fecha));
    if (m) { m.unidades += d.cantidad; m.ventas += 1; m.montoNeto += d.monto; }
  }
  for (const m of salida.meses) m.precioNeto = m.unidades > 0 ? redondear(m.montoNeto / m.unidades, 0) : null;

  // Bajas / subidas de precio entre meses consecutivos con ventas (se ignora el mes en curso: está incompleto)
  const activos = salida.meses.filter(m => m.unidades > 0 && !m.parcial);
  for (let i = 1; i < activos.length; i++) {
    const a = activos[i - 1], b = activos[i];
    if (indiceMes(b.mes) - indiceMes(a.mes) !== 1) continue;
    const pct = b.precioNeto / a.precioNeto - 1;
    if (Math.abs(pct) >= UMBRAL_BAJA_PRECIO) salida.cambiosPrecio.push({ desde: a.mes, hasta: b.mes, pct: redondear(pct * 100, 1), unidadesAntes: a.unidades, unidadesDespues: b.unidades });
  }

  if (!docs.length) return salida;
  salida.unidades = docs.reduce((s, d) => s + d.cantidad, 0);
  salida.primeraVenta = docs[0].fecha;
  salida.ultimaVenta = docs[docs.length - 1].fecha;
  salida.diasSinVenta = Math.floor((hoyMs - docs[docs.length - 1].ms) / DIA_MS);

  // Ventana de observación: 12 meses, pero si la primera venta es más reciente, desde ahí (mínimo 90 días para no inflar la tasa).
  const desdePrimera = Math.floor((hoyMs - docs[0].ms) / DIA_MS) + 1;
  salida.ventanaDias = Math.min(365, Math.max(90, desdePrimera));
  salida.pocaHistoria = desdePrimera < 90;
  salida.ventasPorMes = redondear(salida.ventas / salida.ventanaDias * DIAS_POR_MES, 2);
  salida.unidadesPorMes = redondear(salida.unidades / salida.ventanaDias * DIAS_POR_MES, 2);
  salida.diasEntreVentas = redondear(salida.ventanaDias / salida.ventas, 0);
  const fechas = [...new Set(docs.map(d => d.ms))];
  const gaps = fechas.slice(1).map((ms, i) => (ms - fechas[i]) / DIA_MS);
  salida.diasEntreVentasMediana = gaps.length ? redondear(mediana(gaps), 0) : null;

  const en = (desde, hasta) => docs.filter(d => hoyMs - d.ms >= desde * DIA_MS && hoyMs - d.ms < hasta * DIA_MS);
  const suma = ds => ({ ventas: ds.length, unidades: ds.reduce((s, d) => s + d.cantidad, 0) });
  const u90 = en(0, 90), p90 = en(90, 180);
  salida.ult90 = suma(u90); salida.prev90 = suma(p90);
  salida.tendenciaPct = salida.prev90.unidades > 0 ? redondear((salida.ult90.unidades / salida.prev90.unidades - 1) * 100, 0) : null;

  // Precio vigente = lo que se cobra HOY: mediana del precio unitario de las 3 ventas más recientes (la mediana descarta un descuento puntual).
  // No se promedian los últimos meses: si el precio cambió hace poco, el promedio mezcla el precio viejo y no coincide con el de la tienda.
  const recientes = docs.slice(-3).map(d => d.monto / d.cantidad);
  salida.precioVigenteNeto = recientes.length ? redondear(mediana(recientes), 0) : null;
  return salida;
}

// filasMes: [{ sku, mes:'AAAA-MM', unidades, monto }] con TODOS los SKU (monto neto, solo meses con ventas). mesActual: 'AAAA-MM' (no se usa: incompleto).
export function evidenciaBajasPrecio(filasMes, mesActual) {
  const porSku = new Map();
  for (const f of filasMes || []) {
    if (f.mes >= mesActual || !(Number(f.unidades) > 0)) continue;
    if (!porSku.has(f.sku)) porSku.set(f.sku, []);
    porSku.get(f.sku).push({ mes: f.mes, u: Number(f.unidades), p: Number(f.monto) / Number(f.unidades) });
  }
  const bajas = []; let estables = [];
  for (const [sku, meses] of porSku) {
    meses.sort((a, b) => (a.mes < b.mes ? -1 : 1));
    for (let i = 1; i < meses.length; i++) {
      const a = meses[i - 1], b = meses[i];
      if (indiceMes(b.mes) - indiceMes(a.mes) !== 1 || !(a.p > 0)) continue;
      const pct = b.p / a.p - 1;
      const ev = { sku, mes: b.mes, pct, u0: a.u, u1: b.u };
      if (pct <= -UMBRAL_BAJA_PRECIO && pct >= -0.7) bajas.push(ev);
      else if (Math.abs(pct) < UMBRAL_PRECIO_ESTABLE) estables.push(ev);
    }
  }
  // Control: solo los SKU sin cambio de precio EN LOS MISMOS MESES donde hubo bajas (así la temporada y los días hábiles afectan a ambos grupos igual)
  const mesesConBajas = new Set(bajas.map(e => e.mes));
  estables = estables.filter(e => mesesConBajas.has(e.mes));
  const razon = evs => { const s0 = evs.reduce((s, e) => s + e.u0, 0); return s0 > 0 ? evs.reduce((s, e) => s + e.u1, 0) / s0 : null; };
  const rBaja = razon(bajas), rEstable = razon(estables);
  const pctMediana = mediana(bajas.map(e => e.pct));
  let elasticidad = null;
  if (rBaja > 0 && rEstable > 0 && pctMediana < 0) {
    const e = -(Math.log(rBaja) - Math.log(rEstable)) / Math.log(1 + pctMediana);
    // Negativa o absurda: no sirve como referencia (las bajas suelen hacerse justo cuando el producto se enfría)
    if (Number.isFinite(e) && e > 0 && e < 8) elasticidad = redondear(e, 2);
  }
  return {
    bajas: {
      eventos: bajas.length, skus: new Set(bajas.map(e => e.sku)).size,
      pctSubieron: bajas.length ? redondear(bajas.filter(e => e.u1 > e.u0).length / bajas.length * 100, 0) : null,
      bajaMedianaPct: pctMediana == null ? null : redondear(pctMediana * 100, 1),
      cambioUnidadesPct: rBaja == null ? null : redondear((rBaja - 1) * 100, 0),
    },
    estables: { eventos: estables.length, cambioUnidadesPct: rEstable == null ? null : redondear((rEstable - 1) * 100, 0) },
    elasticidad,
    confiable: bajas.length >= MIN_EVENTOS_CONFIABLE && elasticidad != null,
  };
}

// ── Reposición en camino (Compras > Productos en tránsito) ─────────────────────────────────────────────────────────────────────────────────────────────
// El SKU que se anota en un envío no siempre es idéntico al de Bsale (ej. "MTJZH3165-PTBEZEL10" por "PTBEZEL10"): coincide si el código de Bsale es
// igual al texto completo o a uno de sus pedazos separados por espacio, guion, barra o similares (también se mira el nombre). Códigos de menos de 4
// caracteres solo coinciden de forma exacta, para no cruzar productos por casualidad.
const SEPARADORES_SKU = /[\s\-_/|,;:()]+/;
export function coincideSkuTransito(textoEnvio, skuBsale) {
  const a = String(textoEnvio || '').trim().toUpperCase(), b = String(skuBsale || '').trim().toUpperCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length < 4) return false;
  return a.split(SEPARADORES_SKU).includes(b);
}

// envios: filas de productos_transito_envios (sin los entregados). Devuelve una línea por envío que trae el SKU.
export function reposicionDeSku(envios, skuBsale) {
  const salida = [];
  for (const e of envios || []) {
    const productos = Array.isArray(e.productos) ? e.productos : [];
    const cantidad = productos
      .filter(p => coincideSkuTransito(p.sku, skuBsale) || coincideSkuTransito(p.nombre, skuBsale))
      .reduce((s, p) => s + (Number(p.cantidad) || 0), 0);
    if (cantidad > 0) salida.push({ referencia: e.referencia, estado: e.estado, tipoTransporte: e.tipo_transporte || null, fechaEta: e.fecha_eta ? String(e.fecha_eta).slice(0, 10) : null, cantidad });
  }
  return salida.sort((x, y) => String(x.fechaEta || '9999').localeCompare(String(y.fechaEta || '9999')));
}

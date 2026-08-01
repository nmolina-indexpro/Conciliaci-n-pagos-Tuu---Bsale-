// /api/bsale-sku-report.js
// Analiza, por SKU (variante), las ventas y recepciones de stock de los
// últimos N días en Bsale, más el stock actual — para apoyar decisiones de
// compra a proveedores (qué reponer y qué NO comprar todavía).
//
// Fuentes usadas:
//  - GET /v1/documents.json?expand=details  -> ventas por variante (unidades)
//  - GET /v1/stocks.json                    -> stock actual por variante
//  - GET /v1/stocks/receptions.json         -> recepciones de mercadería
//    (se usa como proxy de "compras a proveedores": no encontré en la doc
//    pública un endpoint separado de "documentos de compra", así que si tu
//    cuenta lo registra distinto, este número puede no calzar — avisar y
//    ajustamos igual que hicimos con TUU/Bsale al principio).
//
// El access_token vive SOLO en el servidor (variable de entorno BSALE_ACCESS_TOKEN),
// la misma que ya usan bsale-report.js.

const BSALE_BASE = 'https://api.bsale.io/v1';
const TIMEOUT_MS = 25000;

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout de ${timeoutMs}ms consultando Bsale`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function bsaleGet(path, token) {
  const r = await fetchWithTimeout(`${BSALE_BASE}${path}`, { headers: { access_token: token } });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Bsale HTTP ${r.status} en ${path}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

// Trae todas las páginas de un recurso, la primera para saber el total
// ("count") y el resto EN PARALELO (mismo patrón que usamos en bsale-report.js
// para no exceder el timeout de la función con rangos largos).
async function fetchAllPages(pathBuilder, token, limit, topeMaximoPaginas) {
  const first = await bsaleGet(pathBuilder(0, limit), token);
  let items = [...(first.items || [])];
  const total = typeof first.count === 'number' ? first.count : items.length;
  const totalPages = Math.min(Math.ceil(total / limit), topeMaximoPaginas);

  if (totalPages > 1) {
    const promesas = [];
    for (let p = 1; p < totalPages; p++) promesas.push(bsaleGet(pathBuilder(p * limit, limit), token));
    const resto = await Promise.all(promesas);
    for (const r of resto) items.push(...(r.items || []));
  }
  return { items, totalDisponible: total, truncado: totalPages < Math.ceil(total / limit) };
}

function toUtcDateStr(unixSeconds) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const { days, startDate: qStart, endDate: qEnd } = req.query;
  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) {
    return res.status(200).json({ error: 'BSALE_ACCESS_TOKEN no configurada en el servidor', skus: [] });
  }

  // Por defecto, últimos 120 días hasta hoy
  const hoy = new Date();
  const endDate = qEnd || hoy.toISOString().slice(0, 10);
  const numDias = parseInt(days || '120', 10);
  const startDateCalc = qStart || (() => {
    const d = new Date(hoy);
    d.setUTCDate(d.getUTCDate() - numDias);
    return d.toISOString().slice(0, 10);
  })();
  const startDate = qStart || startDateCalc;

  try {
    const rangeStart = Math.floor(new Date(`${startDate}T00:00:00-04:00`).getTime() / 1000) - 6 * 3600;
    const rangeEnd = Math.floor(new Date(`${endDate}T23:59:59-04:00`).getTime() / 1000) + 6 * 3600;

    // ---- 1) Ventas por variante ----
    // Tope de 60 páginas x 50 = 3000 documentos. Si tu volumen es mayor,
    // acorta el rango de días o avisa para subir el tope.
    const ventasPage = (offset, limit) =>
      `/documents.json?emissiondaterange=[${rangeStart},${rangeEnd}]&expand=details&limit=${limit}&offset=${offset}`;
    const { items: docsVenta, truncado: ventasTruncadas } = await fetchAllPages(ventasPage, token, 50, 60);

    const ventasPorSku = {}; // { [code]: { unidades, montoNeto, nombre, numDocs } }
    for (const doc of docsVenta) {
      if (doc.state !== 0) continue; // solo documentos activos (no anulados)
      const fecha = toUtcDateStr(doc.emissionDate);
      if (!fecha || fecha < startDate || fecha > endDate) continue;
      const detalles = doc.details?.items || (Array.isArray(doc.details) ? doc.details : []);
      for (const det of detalles) {
        const variant = det.variant || {};
        const code = variant.code || `sin-sku-${variant.id || 'desconocido'}`;
        const nombre = variant.description || det.comment || code;
        ventasPorSku[code] = ventasPorSku[code] || { code, nombre, unidades: 0, montoNeto: 0, numDocs: 0 };
        ventasPorSku[code].unidades += det.quantity || 0;
        ventasPorSku[code].montoNeto += (det.quantity || 0) * (det.netUnitValue || 0);
        ventasPorSku[code].numDocs += 1;
      }
    }

    // ---- 2) Stock actual por variante ----
    const stockPage = (offset, limit) => `/stocks.json?expand=variant&limit=${limit}&offset=${offset}`;
    const { items: stockItems } = await fetchAllPages(stockPage, token, 50, 60);
    const stockPorSku = {}; // { [code]: cantidadDisponible }
    for (const s of stockItems) {
      const code = s.variant?.code;
      if (!code) continue;
      stockPorSku[code] = (stockPorSku[code] || 0) + (s.quantityAvailable ?? s.quantity ?? 0);
    }

    // ---- 3) Recepciones (compras a proveedores) por variante ----
    let comprasPorSku = {};
    let recepcionesDisponibles = true;
    try {
      const recepcionesPage = (offset, limit) =>
        `/stocks/receptions.json?expand=details&limit=${limit}&offset=${offset}`;
      const { items: recepciones } = await fetchAllPages(recepcionesPage, token, 50, 40);
      for (const rec of recepciones) {
        const fecha = toUtcDateStr(rec.admissionDate || rec.generationDate || rec.receptionDate);
        if (fecha && (fecha < startDate || fecha > endDate)) continue;
        const detalles = rec.details?.items || (Array.isArray(rec.details) ? rec.details : []);
        for (const det of detalles) {
          const code = det.variant?.code;
          if (!code) continue;
          comprasPorSku[code] = (comprasPorSku[code] || 0) + (det.quantity || 0);
        }
      }
    } catch (err) {
      recepcionesDisponibles = false; // el endpoint puede no estar disponible según el plan/permisos de la cuenta
    }

    // ---- 4) Combinar todo por SKU ----
    const todosLosCodigos = new Set([
      ...Object.keys(ventasPorSku),
      ...Object.keys(stockPorSku),
      ...Object.keys(comprasPorSku)
    ]);

    const skus = [...todosLosCodigos].map(code => {
      const venta = ventasPorSku[code] || { nombre: code, unidades: 0, montoNeto: 0, numDocs: 0 };
      const stockActual = stockPorSku[code] || 0;
      const compradas = comprasPorSku[code] || 0;
      const ventaDiaria = venta.unidades / numDias;
      const diasCobertura = ventaDiaria > 0 ? Math.round(stockActual / ventaDiaria) : (stockActual > 0 ? null : 0);

      // Sugerencia simple: cubrir 30 días de venta futura, descontando lo que ya hay en stock.
      const objetivoDias = 30;
      const sugerenciaCompra = ventaDiaria > 0 ? Math.max(0, Math.ceil(ventaDiaria * objetivoDias - stockActual)) : 0;

      return {
        code,
        nombre: venta.nombre || code,
        unidadesVendidas: venta.unidades,
        montoVentas: Math.round(venta.montoNeto),
        ventaDiariaPromedio: Math.round(ventaDiaria * 100) / 100,
        stockActual,
        diasCobertura,
        unidadesCompradas: compradas,
        sugerenciaCompra
      };
    });

    // Orden por defecto: lo más vendido primero
    skus.sort((a, b) => b.unidadesVendidas - a.unidadesVendidas);

    return res.status(200).json({
      startDate, endDate, dias: numDias,
      docsRevisados: docsVenta.length,
      ventasTruncadas,
      recepcionesDisponibles,
      skus
    });
  } catch (err) {
    return res.status(200).json({ error: 'Error consultando Bsale', detail: String(err), skus: [] });
  }
}

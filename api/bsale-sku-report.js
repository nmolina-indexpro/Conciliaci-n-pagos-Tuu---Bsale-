// /api/bsale-sku-report.js
// Analiza, por SKU (variante), las ventas y recepciones de stock de los
// últimos N días en Bsale, más el stock actual y la categoría de producto —
// para apoyar decisiones de compra a proveedores (qué reponer y qué NO
// comprar todavía).
//
// Fuentes usadas:
//  - GET /v1/documents.json?expand=details          -> ventas por variante
//  - GET /v1/stocks.json                             -> stock actual
//  - GET /v1/stocks/receptions.json                  -> recepciones (proxy de "compras")
//  - GET /v1/products.json                           -> classification (0=producto,1=servicio,3=pack) y categoría
//  - GET /v1/product_types.json                      -> nombre de cada categoría
//  - GET /v1/variants.json                           -> mapeo SKU -> producto
//
// El access_token vive SOLO en el servidor (variable de entorno BSALE_ACCESS_TOKEN).

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
  const { days, startDate: qStart, endDate: qEnd, debug } = req.query;
  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) {
    return res.status(200).json({ error: 'BSALE_ACCESS_TOKEN no configurada en el servidor', skus: [] });
  }

  const hoy = new Date();
  const endDate = qEnd || hoy.toISOString().slice(0, 10);
  const numDias = parseInt(days || '120', 10);
  const startDate = qStart || (() => {
    const d = new Date(hoy);
    d.setUTCDate(d.getUTCDate() - numDias);
    return d.toISOString().slice(0, 10);
  })();

  // Modo debug: solo trae recepciones crudas, sin procesar nada, para poder
  // ver los nombres reales de los campos (fecha, costo, detalle) y ajustar la
  // lógica de "Compradas" y "Último costo" con datos reales en vez de adivinar.
  if (debug === 'recepciones') {
    try {
      const primera = await bsaleGet('/stocks/receptions.json?limit=5&offset=0', token);
      const total = primera.count || 0;
      const ultimoOffset = Math.max(0, total - 5);
      const r = await bsaleGet(`/stocks/receptions.json?expand=details&limit=5&offset=${ultimoOffset}`, token);
      return res.status(200).json({
        count: total,
        ultimasRecepciones: r.items || []
      });
    } catch (err) {
      return res.status(200).json({ error: 'Error consultando recepciones', detail: String(err) });
    }
  }

  try {
    const rangeStart = Math.floor(new Date(`${startDate}T00:00:00-04:00`).getTime() / 1000) - 6 * 3600;
    const rangeEnd = Math.floor(new Date(`${endDate}T23:59:59-04:00`).getTime() / 1000) + 6 * 3600;

    // ---- 1) Ventas por variante ----
    const ventasPage = (offset, limit) =>
      `/documents.json?emissiondaterange=[${rangeStart},${rangeEnd}]&expand=details&limit=${limit}&offset=${offset}`;
    const { items: docsVenta, truncado: ventasTruncadas } = await fetchAllPages(ventasPage, token, 50, 60);

    const ventasPorSku = {};
    for (const doc of docsVenta) {
      if (doc.state !== 0) continue;
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
    const stockPorSku = {};
    for (const s of stockItems) {
      const code = s.variant?.code;
      if (!code) continue;
      stockPorSku[code] = (stockPorSku[code] || 0) + (s.quantityAvailable ?? s.quantity ?? 0);
    }

    // ---- 3) Catálogo: clasificación (producto/servicio), categoría, y el
    // mapa id de variante -> SKU (las recepciones solo traen el id interno de
    // la variante, no el código, así que este mapa hay que tenerlo ANTES de
    // procesar recepciones). ----
    let catalogoDisponible = true;
    const categoriaPorCode = {};
    const esServicioPorCode = {};
    const codePorVariantId = {};
    try {
      const [tiposRes, productsRes, variantsRes] = await Promise.all([
        bsaleGet('/product_types.json?limit=50', token),
        fetchAllPages((offset, limit) => `/products.json?limit=${limit}&offset=${offset}`, token, 50, 60),
        fetchAllPages((offset, limit) => `/variants.json?limit=${limit}&offset=${offset}`, token, 50, 60)
      ]);

      const nombrePorTipoId = {};
      for (const t of (tiposRes.items || [])) nombrePorTipoId[t.id] = t.name;

      const infoPorProductoId = {};
      for (const p of productsRes.items) {
        const tipoId = p.product_type?.id ?? p.productTypeId ?? null;
        infoPorProductoId[p.id] = {
          esServicio: p.classification === 1,
          categoria: tipoId != null ? (nombrePorTipoId[tipoId] || 'Sin categoría') : 'Sin categoría'
        };
      }

      for (const v of variantsRes.items) {
        if (!v.code) continue;
        codePorVariantId[String(v.id)] = v.code;
        const productoId = v.product?.id;
        const info = productoId != null ? infoPorProductoId[productoId] : null;
        categoriaPorCode[v.code] = info?.categoria || 'Sin categoría';
        esServicioPorCode[v.code] = info?.esServicio || false;
      }
    } catch (err) {
      catalogoDisponible = false; // seguimos sin categorías/filtro de servicio si esto falla
    }

    // ---- 4) Recepciones (compras a proveedores) por variante ----
    // OJO: para "unidadesCompradas" sí filtramos por el período elegido, pero
    // para "último costo comprado" buscamos la recepción más reciente de
    // verdad, aunque haya sido antes del período.
    //
    // Esta cuenta tiene miles de recepciones acumuladas desde 2019, y la API
    // las devuelve de más antigua a más nueva -> hay que paginar DESDE EL
    // FINAL (las más recientes) en vez de desde el principio, o nunca se
    // llega a las fechas actuales dentro de un tope razonable de páginas.
    let comprasPorSku = {};
    let ultimoCostoPorSku = {}; // { [code]: { costo, fecha } }
    let recepcionesDisponibles = true;
    try {
      const primera = await bsaleGet('/stocks/receptions.json?limit=50&offset=0', token);
      const totalRecepciones = primera.count || 0;
      const limit = 50;
      const totalPaginas = Math.ceil(totalRecepciones / limit);
      const topePaginas = 40; // ~2.000 recepciones más recientes
      const paginasARevisar = Math.min(totalPaginas, topePaginas);
      const offsetInicio = Math.max(0, (totalPaginas - paginasARevisar) * limit);

      const promesas = [];
      for (let off = offsetInicio; off < totalPaginas * limit; off += limit) {
        promesas.push(bsaleGet(`/stocks/receptions.json?expand=details&limit=${limit}&offset=${off}`, token));
      }
      const paginas = await Promise.all(promesas);
      let recepciones = paginas.flatMap(p => p.items || []);

      // Si una recepción individual tiene más de 25 líneas de detalle (el
      // límite por defecto de esa sub-colección), traemos el resto aparte.
      const pendientesDetalle = recepciones.filter(r => r.details?.next);
      if (pendientesDetalle.length > 0) {
        const extra = await Promise.all(pendientesDetalle.slice(0, 20).map(async r => {
          try {
            const resto = await bsaleGet(`/stocks/receptions/${r.id}/details.json?limit=50&offset=25`, token);
            return { id: r.id, items: resto.items || [] };
          } catch { return { id: r.id, items: [] }; }
        }));
        const extraPorId = Object.fromEntries(extra.map(e => [e.id, e.items]));
        recepciones = recepciones.map(r => {
          if (extraPorId[r.id]) {
            return { ...r, details: { ...r.details, items: [...(r.details.items || []), ...extraPorId[r.id]] } };
          }
          return r;
        });
      }

      for (const rec of recepciones) {
        // Las notas de crédito generan una "recepción" de reverso de stock,
        // no son compras nuevas a proveedores -> no cuentan.
        if (/nota de cr[eé]dito/i.test(rec.document || '')) continue;

        const fecha = rec.rawAdmissionDate || toUtcDateStr(rec.admissionDate);
        const detalles = rec.details?.items || [];
        for (const det of detalles) {
          const variantId = det.variant?.id;
          const code = variantId != null ? codePorVariantId[String(variantId)] : null;
          if (!code) continue;

          if (fecha && fecha >= startDate && fecha <= endDate) {
            comprasPorSku[code] = (comprasPorSku[code] || 0) + (det.quantity || 0);
          }

          if (det.cost != null && det.cost > 0 && fecha) {
            const actual = ultimoCostoPorSku[code];
            if (!actual || fecha > actual.fecha) {
              ultimoCostoPorSku[code] = { costo: det.cost, fecha };
            }
          }
        }
      }
    } catch (err) {
      recepcionesDisponibles = false;
    }

    // ---- 5) Combinar todo por SKU ----
    const todosLosCodigos = new Set([
      ...Object.keys(ventasPorSku),
      ...Object.keys(stockPorSku),
      ...Object.keys(comprasPorSku)
    ]);

    // Heurística de respaldo por si el catálogo no cargó: excluir por nombre
    const pareceServicioPorNombre = nombre => /servicio|instalaci[oó]n|garant[ií]a|mano de obra/i.test(nombre || '');

    let skus = [...todosLosCodigos]
      .filter(code => {
        if (catalogoDisponible && esServicioPorCode[code] !== undefined) return !esServicioPorCode[code];
        const nombre = (ventasPorSku[code] || {}).nombre || code;
        return !pareceServicioPorNombre(nombre);
      })
      .map(code => {
        const venta = ventasPorSku[code] || { nombre: code, unidades: 0, montoNeto: 0, numDocs: 0 };
        const stockActual = stockPorSku[code] || 0;
        const compradas = comprasPorSku[code] || 0;
        const ventaDiaria = venta.unidades / numDias;

        const diasCobertura = ventaDiaria > 0 ? Math.round(stockActual / ventaDiaria) : (stockActual > 0 ? null : 0);

        // Sugerencia de compra a distintos horizontes: cubrir X días de venta
        // futura, descontando lo que ya hay en stock.
        const sugerirPara = dias => ventaDiaria > 0 ? Math.max(0, Math.ceil(ventaDiaria * dias - stockActual)) : 0;

        return {
          code,
          nombre: venta.nombre || code,
          categoria: categoriaPorCode[code] || 'Sin categoría',
          unidadesVendidas: venta.unidades,
          montoVentas: Math.round(venta.montoNeto),
          ventaDiariaPromedio: Math.round(ventaDiaria * 100) / 100,
          stockActual,
          diasCobertura,
          unidadesCompradas: compradas,
          ultimoCosto: ultimoCostoPorSku[code]?.costo ?? null,
          fechaUltimaCompra: ultimoCostoPorSku[code]?.fecha ?? null,
          sugerencia5: sugerirPara(5),
          sugerencia7: sugerirPara(7),
          sugerencia14: sugerirPara(14),
          sugerencia30: sugerirPara(30)
        };
      });

    skus.sort((a, b) => b.unidadesVendidas - a.unidadesVendidas);

    const categorias = [...new Set(skus.map(s => s.categoria))].sort();

    return res.status(200).json({
      startDate, endDate, dias: numDias,
      docsRevisados: docsVenta.length,
      ventasTruncadas,
      recepcionesDisponibles,
      catalogoDisponible,
      categorias,
      skus
    });
  } catch (err) {
    return res.status(200).json({ error: 'Error consultando Bsale', detail: String(err), skus: [] });
  }
}

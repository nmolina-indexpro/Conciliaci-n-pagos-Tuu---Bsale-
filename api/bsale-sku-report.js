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

function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Reconstruye el stock al final de cada día del período, partiendo del stock
// ACTUAL (hoy) y yendo hacia atrás: stock_fin(día-1) = stock_fin(día) +
// ventas(día) - compras(día). Devuelve las fechas en que el stock reconstruido
// quedó en 0 o menos (quiebre). Es una ESTIMACIÓN: asume que el stock actual
// es exacto y que no hubo ajustes/mermas manuales fuera de ventas y compras
// -> si hay diferencias de inventario no registradas como venta o compra,
// esto puede desviarse un poco de la realidad.
function reconstruirDiasQuiebre(stockActualHoy, ventasPorDia, comprasPorDia, consumosPorDia, startDate, endDate) {
  const dias = [];
  for (let d = startDate; d <= endDate; d = addDaysStr(d, 1)) dias.push(d);

  let stockFinDia = stockActualHoy;
  const diasQuiebre = [];
  for (let i = dias.length - 1; i >= 0; i--) {
    const d = dias[i];
    if (stockFinDia <= 0) diasQuiebre.push(d);
    const ventasDia = (ventasPorDia || {})[d] || 0;
    const comprasDia = (comprasPorDia || {})[d] || 0;
    const consumosDia = (consumosPorDia || {})[d] || 0;
    stockFinDia = stockFinDia + ventasDia + consumosDia - comprasDia; // stock al final del día anterior
  }
  return diasQuiebre;
}

// Si un vencimiento cae sábado o domingo, se paga el lunes siguiente (no hay
// proceso bancario en fin de semana).
function ajustarASiguienteDiaHabil(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo, 6=sábado
  if (dow === 6) return addDaysStr(dateStr, 2);
  if (dow === 0) return addDaysStr(dateStr, 1);
  return dateStr;
}

export default async function handler(req, res) {
  const { days, startDate: qStart, endDate: qEnd, debug } = req.query;
  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) {
    return res.status(200).json({ error: 'BSALE_ACCESS_TOKEN no configurada en el servidor', skus: [] });
  }

  const hoy = new Date();
  const endDate = qEnd || hoy.toISOString().slice(0, 10);
  const diasSolicitados = parseInt(days || '120', 10);
  const startDate = qStart || (() => {
    const d = new Date(hoy);
    d.setUTCDate(d.getUTCDate() - diasSolicitados);
    return d.toISOString().slice(0, 10);
  })();
  // OJO: numDias se recalcula del RANGO REAL (startDate a endDate), no del
  // parámetro "days" -> cuando se piden fechas explícitas (como al traer el
  // "período anterior" para comparar), "days" no llega y el período puede
  // tener un largo distinto a 120 días por defecto. Si se usara el valor
  // equivocado acá, la venta diaria promedio (y todo lo que depende de ella:
  // sugerencias, margen perdido por quiebre, etc.) queda mal calculada.
  const [ay, am, ad] = startDate.split('-').map(Number);
  const [by, bm, bd] = endDate.split('-').map(Number);
  const numDias = Math.max(1, Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000) + 1);

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

  // Modo debug para ver documentos de venta crudos -> necesito confirmar el
  // campo real que distingue una Nota de Crédito de una Boleta/Factura antes
  // de excluirlas del cálculo de ventas (hoy se están sumando como venta).
  if (debug === 'ventas') {
    try {
      const r = await bsaleGet('/documents.json?expand=[document_type,details]&limit=15&offset=0', token);
      return res.status(200).json({ count: r.count, documentos: r.items || [] });
    } catch (err) {
      return res.status(200).json({ error: 'Error consultando documentos', detail: String(err) });
    }
  }

  try {
    const rangeStart = Math.floor(new Date(`${startDate}T00:00:00-04:00`).getTime() / 1000) - 6 * 3600;
    const rangeEnd = Math.floor(new Date(`${endDate}T23:59:59-04:00`).getTime() / 1000) + 6 * 3600;

    // ---- 1) Ventas por variante ----
    const ventasPage = (offset, limit) =>
      `/documents.json?emissiondaterange=[${rangeStart},${rangeEnd}]&expand=[details,document_type]&limit=${limit}&offset=${offset}`;
    const { items: docsVenta, truncado: ventasTruncadas } = await fetchAllPages(ventasPage, token, 50, 60);

    const ventasPorSku = {};
    const ventasPorDiaSku = {}; // { [code]: { [fecha]: unidades } } -> para reconstruir stock histórico
    // Últimas 4 semanas (7 días cada una) contadas hacia atrás desde endDate,
    // para poder ver de un vistazo si una semana puntual tuvo un pico raro
    // (ej. una venta grande a una empresa) en vez de un promedio que lo
    // esconde.
    const semana1Ini = addDaysStr(endDate, -6),  semana1Fin = endDate;
    const semana2Ini = addDaysStr(endDate, -13), semana2Fin = addDaysStr(endDate, -7);
    const semana3Ini = addDaysStr(endDate, -20), semana3Fin = addDaysStr(endDate, -14);
    const semana4Ini = addDaysStr(endDate, -27), semana4Fin = addDaysStr(endDate, -21);

    for (const doc of docsVenta) {
      if (doc.state !== 0) continue;
      // Una Nota de Crédito es una devolución/anulación, no una venta nueva
      // -> no debe sumar al conteo de unidades vendidas (antes se estaba
      // sumando igual que cualquier otro documento, inflando el número).
      const nombreTipoDoc = doc.document_type?.name || '';
      if (/nota de cr[eé]dito/i.test(nombreTipoDoc)) continue;
      const fecha = toUtcDateStr(doc.emissionDate);
      if (!fecha || fecha < startDate || fecha > endDate) continue;
      const detalles = doc.details?.items || (Array.isArray(doc.details) ? doc.details : []);
      for (const det of detalles) {
        const variant = det.variant || {};
        const code = variant.code || `sin-sku-${variant.id || 'desconocido'}`;
        const nombre = variant.description || det.comment || code;
        ventasPorSku[code] = ventasPorSku[code] || { code, nombre, unidades: 0, montoNeto: 0, numDocs: 0, semana1: 0, semana2: 0, semana3: 0, semana4: 0 };
        const cant = det.quantity || 0;
        ventasPorSku[code].unidades += cant;
        ventasPorSku[code].montoNeto += cant * (det.netUnitValue || 0);
        ventasPorSku[code].numDocs += 1;
        ventasPorDiaSku[code] = ventasPorDiaSku[code] || {};
        ventasPorDiaSku[code][fecha] = (ventasPorDiaSku[code][fecha] || 0) + cant;
        if (fecha >= semana1Ini && fecha <= semana1Fin) ventasPorSku[code].semana1 += cant;
        else if (fecha >= semana2Ini && fecha <= semana2Fin) ventasPorSku[code].semana2 += cant;
        else if (fecha >= semana3Ini && fecha <= semana3Fin) ventasPorSku[code].semana3 += cant;
        else if (fecha >= semana4Ini && fecha <= semana4Fin) ventasPorSku[code].semana4 += cant;
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
    const comprasPorDiaSku = {}; // { [code]: { [fecha]: unidades } } -> para reconstruir stock histórico
    let ultimoCostoPorSku = {}; // { [code]: { costo, fecha } }
    let recepcionesDisponibles = true;
    // Filtramos por FECHA DE RECEPCIÓN de los últimos 14 días (no por fecha
    // de vencimiento) — como el vencimiento de cada una ya se calcula como
    // "fecha de recepción + plazo de SU proveedor" (30 días Coimco/Intcomex,
    // 45 días LaptopCenter), filtrando por recepción reciente el vencimiento
    // cae automáticamente en la ventana correcta para cada proveedor, sin
    // tener que fijar una ventana distinta para cada plazo.
    const hoyStr = endDate; // usamos endDate como "hoy" para que sea consistente si se pide un rango con fecha fin distinta a hoy
    const ventanaRecepcionInicio = addDaysStr(hoyStr, -14);
    const ventanaRecepcionFin = hoyStr;
    let proximosPagos = [];
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

      // Identificamos el proveedor a partir del campo "note" de la recepción
      // (ahí es donde vimos, en un caso real, el texto "intcomex"). No hay un
      // campo dedicado de "proveedor" en este endpoint -> normalizamos los
      // nombres conocidos y dejamos el texto tal cual para el resto, en vez
      // de inventar una categoría. Cada uno con su plazo de pago real.
      const proveedoresConocidos = [
        { patron: /coimco/i, nombre: 'COIMCO', plazoDias: 30 },
        { patron: /laptop\s*center/i, nombre: 'LaptopCenter', plazoDias: 45 },
        { patron: /intcomex/i, nombre: 'Intcomex', plazoDias: 30 },
        { patron: /daxis/i, nombre: 'Daxis', plazoDias: 30 },
        { patron: /synnex/i, nombre: 'Synnex', plazoDias: 30 },
        { patron: /ingram/i, nombre: 'Ingram Micro', plazoDias: 30 }
      ];
      const PLAZO_POR_DEFECTO = 30; // para proveedores no identificados
      function identificarProveedor(rec) {
        const texto = `${rec.note || ''} ${rec.document || ''}`;
        for (const p of proveedoresConocidos) if (p.patron.test(texto)) return p;
        const nombre = (rec.note || '').trim() || 'Sin identificar';
        return { nombre, plazoDias: PLAZO_POR_DEFECTO };
      }

      for (const rec of recepciones) {
        // Las notas de crédito generan una "recepción" de reverso de stock,
        // no son compras nuevas a proveedores -> no cuentan.
        if (/nota de cr[eé]dito/i.test(rec.document || '')) continue;

        const fecha = rec.rawAdmissionDate || toUtcDateStr(rec.admissionDate);
        const detalles = rec.details?.items || [];

        // Total de la recepción completa (todas sus líneas), para el panel
        // de próximos pagos, agrupado por proveedor identificado. Cada
        // proveedor vence a SU plazo (Coimco/Intcomex/Daxis = 30 días,
        // LaptopCenter = 45 días).
        if (fecha && fecha >= ventanaRecepcionInicio && fecha <= ventanaRecepcionFin) {
          const proveedorInfo = identificarProveedor(rec);
          const fechaEstimadaPago = ajustarASiguienteDiaHabil(addDaysStr(fecha, proveedorInfo.plazoDias));
          const totalRecepcion = detalles.reduce((a, d) => a + ((d.cost || 0) * (d.quantity || 0)), 0);
          if (totalRecepcion > 0) {
            proximosPagos.push({
              fecha,
              proveedor: proveedorInfo.nombre,
              plazoDias: proveedorInfo.plazoDias,
              documento: rec.document || 'Sin Documento',
              numeroDocumento: rec.documentNumber || '',
              monto: Math.round(totalRecepcion),
              fechaEstimadaPago
            });
          }
        }

        for (const det of detalles) {
          const variantId = det.variant?.id;
          const code = variantId != null ? codePorVariantId[String(variantId)] : null;
          if (!code) continue;

          if (fecha && fecha >= startDate && fecha <= endDate) {
            comprasPorSku[code] = (comprasPorSku[code] || 0) + (det.quantity || 0);
            comprasPorDiaSku[code] = comprasPorDiaSku[code] || {};
            comprasPorDiaSku[code][fecha] = (comprasPorDiaSku[code][fecha] || 0) + (det.quantity || 0);
          }

          if (det.cost != null && det.cost > 0 && fecha) {
            const actual = ultimoCostoPorSku[code];
            if (!actual || fecha > actual.fecha) {
              ultimoCostoPorSku[code] = { costo: det.cost, fecha };
            }
          }
        }
      }
      proximosPagos.sort((a, b) => a.fechaEstimadaPago.localeCompare(b.fechaEstimadaPago));
    } catch (err) {
      recepcionesDisponibles = false;
    }

    // ---- Consumos de stock (mermas, uso interno, etc.) ----
    // Estos también sacan stock pero NO son ni una venta (documents.json) ni
    // una compra (receptions.json) -> si no los consideramos, la
    // reconstrucción de "días en quiebre" queda con el stock histórico
    // inflado y nunca llega a 0 aunque en la realidad sí haya pasado.
    const consumosPorDiaSku = {}; // { [code]: { [fecha]: unidades } }
    try {
      const primeraConsumo = await bsaleGet('/stocks/consumptions.json?limit=50&offset=0', token);
      const totalConsumos = primeraConsumo.count || 0;
      const limitC = 50;
      const totalPaginasC = Math.ceil(totalConsumos / limitC);
      const topeC = 40; // ~2.000 consumos más recientes
      const paginasC = Math.min(totalPaginasC, topeC);
      const offsetInicioC = Math.max(0, (totalPaginasC - paginasC) * limitC);

      const promesasC = [];
      for (let off = offsetInicioC; off < totalPaginasC * limitC; off += limitC) {
        promesasC.push(bsaleGet(`/stocks/consumptions.json?expand=details&limit=${limitC}&offset=${off}`, token));
      }
      const paginasConsumos = await Promise.all(promesasC);
      const consumos = paginasConsumos.flatMap(p => p.items || []);

      for (const cons of consumos) {
        const fecha = cons.rawConsumptionDate || toUtcDateStr(cons.consumptionDate);
        if (!fecha) continue;
        const detalles = cons.details?.items || [];
        for (const det of detalles) {
          const variantId = det.variant?.id;
          const code = variantId != null ? codePorVariantId[String(variantId)] : null;
          if (!code) continue;
          consumosPorDiaSku[code] = consumosPorDiaSku[code] || {};
          consumosPorDiaSku[code][fecha] = (consumosPorDiaSku[code][fecha] || 0) + (det.quantity || 0);
        }
      }
    } catch (err) {
      // Si esto falla, seguimos igual -> la reconstrucción de quiebres queda
      // sin consumos (puede subestimar días en quiebre), pero no rompe el resto.
    }

    // Agrupamos por proveedor identificado, con su subtotal — esto es lo que
    // se muestra en el panel (no la lista documento por documento).
    const porProveedor = {};
    for (const p of proximosPagos) {
      porProveedor[p.proveedor] = porProveedor[p.proveedor] || { proveedor: p.proveedor, monto: 0, cantidadDocumentos: 0, documentos: [] };
      porProveedor[p.proveedor].monto += p.monto;
      porProveedor[p.proveedor].cantidadDocumentos += 1;
      porProveedor[p.proveedor].documentos.push(p);
    }
    const pagosPorProveedor = Object.values(porProveedor).sort((a, b) => b.monto - a.monto);

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
      // "Sin categoría" en esta cuenta corresponde a ítems de despacho/flete
      // (Bluexpress, Starken, "Costo de envío", etc.), no a productos físicos
      // reales -> no tiene sentido reponerlos, se excluyen del análisis.
      .filter(code => (categoriaPorCode[code] || 'Sin categoría') !== 'Sin categoría')
      .map(code => {
        const venta = ventasPorSku[code] || { nombre: code, unidades: 0, montoNeto: 0, numDocs: 0, semana1: 0, semana2: 0, semana3: 0, semana4: 0 };
        const stockActual = stockPorSku[code] || 0;
        const compradas = comprasPorSku[code] || 0;
        const ventaDiaria = venta.unidades / numDias;

        const diasCobertura = ventaDiaria > 0 ? Math.round(stockActual / ventaDiaria) : (stockActual > 0 ? null : 0);

        // Sugerencia de compra a distintos horizontes: cubrir X días de venta
        // futura, descontando lo que ya hay en stock.
        const sugerirPara = dias => ventaDiaria > 0 ? Math.max(0, Math.ceil(ventaDiaria * dias - stockActual)) : 0;

        // Margen: precio de venta promedio del período menos el último costo
        // comprado. Si no tenemos costo o no hubo ventas, queda en null (no
        // asumimos un margen sin datos reales).
        const precioVentaPromedio = venta.unidades > 0 ? venta.montoNeto / venta.unidades : null;
        const costoRef = ultimoCostoPorSku[code]?.costo ?? null;
        const margenUnitario = (precioVentaPromedio != null && costoRef != null) ? Math.round(precioVentaPromedio - costoRef) : null;
        const margenPorcentaje = (margenUnitario != null && precioVentaPromedio > 0) ? Math.round((margenUnitario / precioVentaPromedio) * 1000) / 10 : null;

        // Reconstrucción de stock histórico: días en que el SKU estuvo en
        // quiebre dentro del período, y el margen que probablemente se dejó
        // de ganar esos días (venta diaria promedio de los días CON stock,
        // multiplicada por el margen unitario). Es una estimación, no un
        // registro real de ventas perdidas.
        const diasQuiebreHist = reconstruirDiasQuiebre(stockActual, ventasPorDiaSku[code], comprasPorDiaSku[code], consumosPorDiaSku[code], startDate, endDate);
        const diasConStock = Math.max(1, numDias - diasQuiebreHist.length);
        const ventaDiariaConStock = venta.unidades / diasConStock;
        const margenPerdidoPorQuiebre = margenUnitario != null
          ? Math.round(diasQuiebreHist.length * ventaDiariaConStock * margenUnitario)
          : null;

        return {
          code,
          nombre: venta.nombre || code,
          categoria: categoriaPorCode[code] || 'Sin categoría',
          unidadesVendidas: venta.unidades,
          montoVentas: Math.round(venta.montoNeto),
          ventaDiariaPromedio: Math.round(ventaDiaria * 100) / 100,
          // Venta semana a semana (semana1 = últimos 7 días, semana4 = hace
          // 22-28 días) — para detectar a simple vista si el promedio general
          // está inflado por una venta grande y puntual en una sola semana.
          semana1: venta.semana1 || 0,
          semana2: venta.semana2 || 0,
          semana3: venta.semana3 || 0,
          semana4: venta.semana4 || 0,
          stockActual,
          diasCobertura,
          unidadesCompradas: compradas,
          ultimoCosto: ultimoCostoPorSku[code]?.costo ?? null,
          fechaUltimaCompra: ultimoCostoPorSku[code]?.fecha ?? null,
          margenUnitario,
          margenPorcentaje,
          diasQuiebreHistorico: diasQuiebreHist.length,
          margenPerdidoPorQuiebre,
          sugerencia5: sugerirPara(5),
          sugerencia7: sugerirPara(7),
          sugerencia14: sugerirPara(14),
          sugerencia30: sugerirPara(30),
          costoSugerencia5: ultimoCostoPorSku[code]?.costo != null ? Math.round(sugerirPara(5) * ultimoCostoPorSku[code].costo) : null
        };
      });

    // "Producto estrella": el 20% más vendido del catálogo (con venta > 0) —
    // son los que menos te puedes dar el lujo de dejar sin stock.
    const conVenta = skus.filter(s => s.unidadesVendidas > 0).sort((a,b)=>b.unidadesVendidas-a.unidadesVendidas);
    const topCantidad = Math.max(1, Math.ceil(conVenta.length * 0.2));
    const codigosEstrella = new Set(conVenta.slice(0, topCantidad).map(s=>s.code));
    for (const s of skus) s.esEstrella = codigosEstrella.has(s.code);

    skus.sort((a, b) => b.unidadesVendidas - a.unidadesVendidas);

    const categorias = [...new Set(skus.map(s => s.categoria))].sort();

    return res.status(200).json({
      startDate, endDate, dias: numDias,
      docsRevisados: docsVenta.length,
      ventasTruncadas,
      recepcionesDisponibles,
      catalogoDisponible,
      categorias,
      proximosPagos,
      pagosPorProveedor,
      ventanaPago: { desde: ventanaRecepcionInicio, hasta: ventanaRecepcionFin },
      skus
    });
  } catch (err) {
    return res.status(200).json({ error: 'Error consultando Bsale', detail: String(err), skus: [] });
  }
}

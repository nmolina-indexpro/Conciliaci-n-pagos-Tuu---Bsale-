// /api/tuu-report.js
// Consulta la API de Reportes de Sucursal de TUU (Haulmer) para un día específico.
// El API Key vive SOLO en el servidor (variable de entorno TUU_API_KEY), nunca en el navegador.
// Doc: https://developers.tuu.cl/docs/generación-de-reporte-sucursal

const TIMEOUT_MS = 25000;

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout de ${timeoutMs}ms consultando TUU`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  const { date, startDate: qStart, endDate: qEnd, debug } = req.query;
  const startDate = qStart || date;
  const endDate = qEnd || date;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Falta parámetro date, o startDate y endDate (YYYY-MM-DD)' });
  }

  const apiKey = process.env.TUU_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'TUU_API_KEY no está configurada en el servidor' });
  }

  try {
    // TUU no acepta rangos de más de ~30 días (documentado como 30, aunque la
    // intro dice 60) -> troceamos en bloques de 30 días para cubrir meses de 31.
    function addDays(dateStr, days) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + days);
      return dt.toISOString().slice(0, 10);
    }
    const chunks = [];
    let chunkStart = startDate;
    while (chunkStart <= endDate) {
      let chunkEnd = addDays(chunkStart, 29);
      if (chunkEnd > endDate) chunkEnd = endDate;
      chunks.push([chunkStart, chunkEnd]);
      chunkStart = addDays(chunkEnd, 1);
    }

    const rawTransactions = [];

    async function fetchPage(cStart, cEnd, page) {
      const r = await fetchWithTimeout('https://integrations.payment.haulmer.com/BranchReport/branch-report', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: cStart, endDate: cEnd, page, pageSize: 20 })
      });
      return r.json();
    }

    for (const [cStart, cEnd] of chunks) {
      const first = await fetchPage(cStart, cEnd, 1);

      if (first?.metadata?.code === 'BR-27') continue; // sin datos en este bloque, no es error

      if (first?.metadata?.code && first.metadata.code !== 'BR-00') {
        return res.status(502).json({
          error: 'TUU respondió con error',
          detail: first?.metadata?.message || 'error desconocido'
        });
      }

      rawTransactions.push(...(first?.data?.transactions || []));
      const totalPages = first?.pagination?.totalPages || 1;

      if (totalPages > 1) {
        const pagePromises = [];
        for (let p = 2; p <= totalPages; p++) pagePromises.push(fetchPage(cStart, cEnd, p));
        const rest = await Promise.all(pagePromises);
        for (const body of rest) rawTransactions.push(...(body?.data?.transactions || []));
      }
    }

    // Regla de clasificación (confirmada contra el dashboard real de TUU):
    // - transactionType "debit"/"credit" (sin distinguir mayúsculas) -> tal cual
    // - "PREPAID" -> TUU las trata como venta débito
    // - sin transactionType pero con más de 1 cuota -> son ventas a crédito
    //   (la API de TUU a veces no llena el tipo en ventas con cuotas)
    // Lo que queda fuera de estas reglas (sin tipo, sin cuotas) se deja aparte,
    // en "otras", para no adivinar.
    function inferirTipo(t) {
      const tipoRaw = (t.transactionType || '').toLowerCase();
      if (tipoRaw === 'debit') return 'debito';
      if (tipoRaw === 'credit') return 'credito';
      if (tipoRaw === 'prepaid') return 'debito';
      // Sin transactionType: SOLO clasificamos cuando hay más de 1 cuota (eso
      // sí está confirmado: nunca vimos débito con cuotas). "1 cuota" NO se
      // puede asumir como débito -> se comprobó un caso real de crédito pagado
      // en 1 sola cuota que quedó mal clasificado con esa regla. Esos casos
      // quedan en "otras" para revisión manual en vez de adivinar.
      if (!tipoRaw && (t.installmentCount || 0) > 1) return 'credito';
      return null; // tipo desconocido / sin señal suficiente para clasificar
    }

    if (debug) {
      const porStatus = {};
      const porTipo = {};
      let sumaConFiltroActual = 0;
      let sumaTotalSinFiltro = 0;

      for (const t of rawTransactions) {
        const status = t.status || '(sin status)';
        const tipo = t.transactionType || '(sin tipo)';
        porStatus[status] = porStatus[status] || { cantidad: 0, monto: 0 };
        porStatus[status].cantidad += 1;
        porStatus[status].monto += t.totalAmount || 0;

        porTipo[tipo] = porTipo[tipo] || { cantidad: 0, monto: 0 };
        porTipo[tipo].cantidad += 1;
        porTipo[tipo].monto += t.totalAmount || 0;

        sumaTotalSinFiltro += t.totalAmount || 0;
        if ((t.status || '').toLowerCase() === 'completed') sumaConFiltroActual += t.totalAmount || 0;
      }

      // Detalle de las transacciones que siguen sin poder clasificarse (ni con
      // las reglas de débito/crédito/prepago/cuotas), para seguir cruzándolas
      // manualmente contra el listado de TUU si hace falta.
      const noClasificadas = rawTransactions
        .filter(t => (t.status || '').toLowerCase() === 'completed')
        .filter(t => inferirTipo(t) === null)
        .map(t => ({
          fecha: (t.transactionDateTime || '').slice(0, 10),
          hora: (t.transactionDateTime || '').slice(11, 16),
          tipo: t.transactionType || '(sin tipo)',
          monto: t.totalAmount,
          saleId: t.saleId || '',
          cardBrand: t.cardBrand || '',
          cardOrigin: t.cardOrigin || '',
          cuotas: t.installmentCount ?? null
        }));

      return res.status(200).json({
        startDate, endDate,
        totalTransaccionesCrudas: rawTransactions.length,
        porStatus, porTipo, noClasificadas,
        sumaConFiltroActual,      // lo que hoy usa la app (solo status "completed")
        sumaTotalSinFiltro,       // si no filtráramos por status
        ejemploTransaccion: rawTransactions[0] || null
      });
    }

    // Normalizamos al formato que usa el reconciliador. Incluimos "date" (día
    // calendario de la transacción) para poder agrupar por día en consolidados
    // semanales/mensuales.
    const completadas = rawTransactions.filter(t => (t.status || '').toLowerCase() === 'completed');

    const transacciones = completadas
      .map(t => ({ t, tipo: inferirTipo(t) }))
      .filter(({ tipo }) => tipo !== null)
      .map(({ t, tipo }) => ({
        type: tipo,
        amount: t.totalAmount,
        date: (t.transactionDateTime || '').slice(0, 10),
        time: (t.transactionDateTime || '').slice(11, 16),
        cardBrand: t.cardBrand || '',
        saleId: t.saleId || ''
      }));

    // Transacciones completadas que NO calzan con ninguna regla anterior
    // (sin tipo y sin cuotas) -> se muestran aparte, no se asume a cuál
    // categoría pertenecen para no inflar un número con un supuesto.
    const otras = completadas
      .filter(t => inferirTipo(t) === null)
      .map(t => ({
        tipo: t.transactionType || 'Sin especificar',
        amount: t.totalAmount,
        date: (t.transactionDateTime || '').slice(0, 10),
        time: (t.transactionDateTime || '').slice(11, 16),
        cardBrand: t.cardBrand || ''
      }));

    return res.status(200).json({ startDate, endDate, transacciones, otras });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando TUU', detail: String(err) });
  }
}

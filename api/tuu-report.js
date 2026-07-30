// /api/tuu-report.js
// Consulta la API de Reportes de Sucursal de TUU (Haulmer) para un día específico.
// El API Key vive SOLO en el servidor (variable de entorno TUU_API_KEY), nunca en el navegador.
// Doc: https://developers.tuu.cl/docs/generación-de-reporte-sucursal

const TIMEOUT_MS = 8000;

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
  const { date, startDate: qStart, endDate: qEnd } = req.query;
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

    // Normalizamos al formato que usa el reconciliador. Incluimos "date" (día
    // calendario de la transacción) para poder agrupar por día en consolidados
    // semanales/mensuales.
    const transacciones = rawTransactions
      .filter(t => (t.status || '').toLowerCase() === 'completed')
      .map(t => ({
        type: t.transactionType === 'DEBIT' ? 'debito'
            : t.transactionType === 'CREDIT' ? 'credito'
            : 'otro',
        amount: t.totalAmount,
        date: (t.transactionDateTime || '').slice(0, 10),
        time: (t.transactionDateTime || '').slice(11, 16),
        cardBrand: t.cardBrand || '',
        saleId: t.saleId || ''
      }));

    return res.status(200).json({ startDate, endDate, transacciones });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando TUU', detail: String(err) });
  }
}

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
  const { date } = req.query; // formato YYYY-MM-DD

  if (!date) {
    return res.status(400).json({ error: 'Falta parámetro date (YYYY-MM-DD)' });
  }

  const apiKey = process.env.TUU_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'TUU_API_KEY no está configurada en el servidor' });
  }

  try {
    let page = 1;
    let totalPages = 1;
    const rawTransactions = [];

    do {
      const r = await fetchWithTimeout('https://integrations.payment.haulmer.com/BranchReport/branch-report', {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          startDate: date,
          endDate: date,
          page,
          pageSize: 20
        })
      });

      const body = await r.json();

      // BR-27 = "No data found for the selected filters" -> no es un error, solo no hubo ventas
      if (body?.metadata?.code === 'BR-27') break;

      if (!r.ok || (body?.metadata?.code && body.metadata.code !== 'BR-00')) {
        return res.status(502).json({
          error: 'TUU respondió con error',
          detail: body?.metadata?.message || `HTTP ${r.status}`
        });
      }

      const txs = body?.data?.transactions || [];
      rawTransactions.push(...txs);

      totalPages = body?.pagination?.totalPages || 1;
      page += 1;
    } while (page <= totalPages);

    // Normalizamos al formato que usa el reconciliador
    const transacciones = rawTransactions
      .filter(t => (t.status || '').toLowerCase() === 'completed')
      .map(t => ({
        type: t.transactionType === 'DEBIT' ? 'debito'
            : t.transactionType === 'CREDIT' ? 'credito'
            : 'otro',
        amount: t.totalAmount,
        time: (t.transactionDateTime || '').slice(11, 16),
        cardBrand: t.cardBrand || '',
        saleId: t.saleId || ''
      }));

    return res.status(200).json({ date, transacciones });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando TUU', detail: String(err) });
  }
}

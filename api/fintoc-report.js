// /api/fintoc-report.js
// Consulta la API de Fintoc (producto Payments — pagos por transferencia
// cobrados en el checkout de Shopify) para un rango de fechas. A diferencia
// del webhook nativo de Bci, esta es una consulta directa (mismo patrón que
// TUU/Bsale/Shopify), sin necesidad de base de datos.
//
// Requiere la variable de entorno FINTOC_SECRET_KEY (empieza con sk_live_ o
// sk_test_). La autenticación va directo en el header Authorization, sin
// prefijo "Bearer".
//
// OJO: el esquema completo de cada payment_intent no quedó 100% confirmado
// en la documentación pública (era un widget interactivo) -> extraemos
// campos de forma defensiva con varios nombres candidatos, a ajustar cuando
// se vea la respuesta real.

const TIMEOUT_MS = 20000;
const API_BASE = 'https://api.fintoc.com/v1';

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout de ${timeoutMs}ms consultando Fintoc`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

function nombrePagador(pi) {
  return pi.customer_name || pi.payer?.name || pi.sender_account?.holder_name || pi.customer_email || 'Cliente';
}

function referenciaPedido(pi) {
  // Candidatos típicos para la referencia que Shopify le pasa a Fintoc al crear el pago
  return pi.reference_id || pi.metadata?.order_id || pi.metadata?.reference || pi.description || null;
}

export default async function handler(req, res) {
  const { date, startDate: qStart, endDate: qEnd } = req.query;
  const startDate = qStart || date;
  const endDate = qEnd || date;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Falta parámetro date, o startDate y endDate (YYYY-MM-DD)' });
  }

  const secretKey = (process.env.FINTOC_SECRET_KEY || '').trim();
  if (!secretKey) {
    return res.status(200).json({
      startDate, endDate, transferencias: [],
      error: 'FINTOC_SECRET_KEY no configurada',
      detail: 'Falta agregar la variable de entorno en Vercel'
    });
  }

  try {
    const since = `${startDate}T00:00:00.000Z`;
    const until = `${endDate}T23:59:59.000Z`;

    let page = 1;
    const perPage = 100;
    const all = [];

    while (true) {
      const url = `${API_BASE}/payment_intents?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&status=succeeded&per_page=${perPage}&page=${page}`;
      const r = await fetchWithTimeout(url, { headers: { Authorization: secretKey, Accept: 'application/json' } });

      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return res.status(200).json({ startDate, endDate, transferencias: [], error: `Fintoc HTTP ${r.status}`, detail: text.slice(0, 300) });
      }

      const body = await r.json();
      const items = Array.isArray(body) ? body : (body.data || body.items || []);
      all.push(...items);

      if (items.length < perPage) break;
      page++;
      if (page > 20) break; // tope de seguridad: 2000 pagos
    }

    const transferencias = all.map(pi => ({
      monto: pi.amount ?? pi.final_amount ?? null,
      fecha: (pi.created_at || pi.final_status_time || '').slice(0, 10),
      cliente: nombrePagador(pi),
      referencia: referenciaPedido(pi),
      id: pi.id || null
    })).filter(t => t.monto !== null);

    return res.status(200).json({ startDate, endDate, transferencias, totalRegistros: transferencias.length });
  } catch (err) {
    return res.status(200).json({ startDate, endDate, transferencias: [], error: 'Error consultando Fintoc', detail: String(err) });
  }
}

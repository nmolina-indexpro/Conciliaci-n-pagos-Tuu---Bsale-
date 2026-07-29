// /api/bsale-report.js
// Consulta la API oficial de Bsale (api.bsale.io) y devuelve los documentos pagados
// con Tarjeta Crédito y Tarjeta Débito para un día específico.
//
// IMPORTANTE: /v1/payments.json no tiene un filtro de fecha soportado, así que
// en vez de eso filtramos /v1/documents.json por emissiondaterange (que sí existe)
// y expandimos payments + client en la misma llamada. Esto trae solo los documentos
// del día, no el historial completo de pagos de la cuenta.
//
// El access_token vive SOLO en el servidor (variable de entorno BSALE_ACCESS_TOKEN).
// Doc: https://docs.bsale.dev/

const BSALE_BASE = 'https://api.bsale.io/v1';
const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout de ${timeoutMs}ms consultando ${url}`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function bsaleGet(path, token) {
  const r = await fetchWithTimeout(`${BSALE_BASE}${path}`, {
    headers: { access_token: token }
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Bsale HTTP ${r.status} en ${path}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

// Encuentra los IDs de los tipos de pago cuyo nombre matchea "Tarjeta Crédito" / "Tarjeta Débito"
async function getCardPaymentTypeIds(token) {
  const data = await bsaleGet('/payment_types.json?limit=50', token);
  const items = data.items || [];
  const credito = items.find(p => /tarjeta.*cr[eé]dito/i.test(p.name));
  const debito = items.find(p => /tarjeta.*d[eé]bito/i.test(p.name));
  return { creditoId: credito?.id, debitoId: debito?.id, allTypes: items.map(i => ({ id: i.id, name: i.name })) };
}

function clientName(client) {
  if (!client) return '';
  const full = `${client.firstName || ''} ${client.lastName || ''}`.trim();
  return full || client.company || '';
}

function extractPaymentsArray(doc) {
  const p = doc.payments;
  if (!p) return [];
  if (Array.isArray(p)) return p;
  if (Array.isArray(p.items)) return p.items;
  return [];
}

export default async function handler(req, res) {
  const { date, debug } = req.query; // YYYY-MM-DD

  if (!date) return res.status(400).json({ error: 'Falta parámetro date (YYYY-MM-DD)' });

  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'BSALE_ACCESS_TOKEN no está configurada en el servidor' });

  try {
    const dayStart = Math.floor(new Date(`${date}T00:00:00-04:00`).getTime() / 1000);
    const dayEnd = Math.floor(new Date(`${date}T23:59:59-04:00`).getTime() / 1000);

    const { creditoId, debitoId, allTypes } = await getCardPaymentTypeIds(token);

    if (!creditoId && !debitoId) {
      return res.status(502).json({
        error: 'No se encontraron medios de pago "Tarjeta Crédito" / "Tarjeta Débito" en tu cuenta Bsale.',
        mediosDisponibles: allTypes,
        hint: 'Ajusta el regex en getCardPaymentTypeIds() con el nombre exacto que ves en mediosDisponibles.'
      });
    }

    // Traemos los documentos del día, con sus pagos y cliente expandidos en la misma llamada
    let offset = 0;
    const limit = 50;
    const allDocs = [];
    while (true) {
      const data = await bsaleGet(
        `/documents.json?emissiondaterange=[${dayStart},${dayEnd}]&expand=payments,client&limit=${limit}&offset=${offset}`,
        token
      );
      const items = data.items || [];
      allDocs.push(...items);
      if (items.length < limit) break;
      offset += limit;
    }

    if (debug) {
      const sampleWithPayments = allDocs.find(d => {
        const arr = extractPaymentsArray(d);
        return arr.length > 0;
      });
      return res.status(200).json({
        date,
        docsRevisados: allDocs.length,
        creditoId,
        debitoId,
        allTypes,
        primerDocumentoConPagos: sampleWithPayments || null,
        primerDocumentoCrudo: allDocs[0] || null
      });
    }

    const credito = [];
    const debito = [];

    for (const doc of allDocs) {
      const payments = extractPaymentsArray(doc);
      const numero = doc.number ? String(doc.number) : '';
      const cliente = clientName(doc.client);

      for (const p of payments) {
        const ptId = p.payment_type?.id ?? p.paymentTypeId;
        if (ptId == null) continue;
        if (String(ptId) === String(creditoId)) {
          credito.push({ numero, cliente, monto: p.amount });
        } else if (String(ptId) === String(debitoId)) {
          debito.push({ numero, cliente, monto: p.amount });
        }
      }
    }

    return res.status(200).json({ date, credito, debito, docsRevisados: allDocs.length });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando Bsale', detail: String(err) });
  }
}

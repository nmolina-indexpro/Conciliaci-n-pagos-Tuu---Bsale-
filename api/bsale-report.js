// /api/bsale-report.js
// Consulta la API oficial de Bsale (api.bsale.io) y devuelve los documentos pagados
// con Tarjeta Crédito y Tarjeta Débito para un día específico.
// El access_token vive SOLO en el servidor (variable de entorno BSALE_ACCESS_TOKEN).
// Doc: https://docs.bsale.dev/

const BSALE_BASE = 'https://api.bsale.io/v1';

async function bsaleGet(path, token) {
  const r = await fetch(`${BSALE_BASE}${path}`, {
    headers: { access_token: token }
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Bsale HTTP ${r.status} en ${path}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

// Encuentra los IDs de los tipos de pago cuyo nombre matchea "Tarjeta Crédito" / "Tarjeta Débito"
// (en tu cuenta aparecen literalmente como TARJETA CREDITO / TARJETA DEBITO)
async function getCardPaymentTypeIds(token) {
  const data = await bsaleGet('/payment_types.json?limit=50', token);
  const items = data.items || [];
  const credito = items.find(p => /tarjeta.*cr[eé]dito/i.test(p.name));
  const debito = items.find(p => /tarjeta.*d[eé]bito/i.test(p.name));
  return { creditoId: credito?.id, debitoId: debito?.id };
}

async function fetchPaymentsForType(token, paymentTypeId, dayStart, dayEnd) {
  if (!paymentTypeId) return [];
  let offset = 0;
  const limit = 50;
  const all = [];
  while (true) {
    const data = await bsaleGet(
      `/payments.json?recorddaterange=[${dayStart},${dayEnd}]&paymenttypeid=${paymentTypeId}&limit=${limit}&offset=${offset}`,
      token
    );
    const items = data.items || [];
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all;
}

// Para cada pago, va a buscar el documento asociado (número + cliente)
async function enrichWithDocument(token, payments) {
  const out = [];
  for (const p of payments) {
    let numero = '';
    let cliente = '';
    try {
      const docHref = p.document?.href;
      if (docHref) {
        const r = await fetch(`${docHref}?expand=client`, { headers: { access_token: token } });
        if (r.ok) {
          const doc = await r.json();
          numero = doc.number ? String(doc.number) : '';
          const c = doc.client;
          if (c) cliente = `${c.firstName || ''} ${c.lastName || ''}`.trim();
        }
      }
    } catch (e) {
      // si falla el detalle del documento, igual dejamos el pago con el monto
    }
    out.push({ numero, cliente, monto: p.amount });
  }
  return out;
}

export default async function handler(req, res) {
  const { date } = req.query; // YYYY-MM-DD

  if (!date) {
    return res.status(400).json({ error: 'Falta parámetro date (YYYY-MM-DD)' });
  }

  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'BSALE_ACCESS_TOKEN no está configurada en el servidor' });
  }

  try {
    // Chile continental = UTC-4 (aprox, ignora horario de verano por simplicidad)
    const dayStart = Math.floor(new Date(`${date}T00:00:00-04:00`).getTime() / 1000);
    const dayEnd = Math.floor(new Date(`${date}T23:59:59-04:00`).getTime() / 1000);

    const { creditoId, debitoId } = await getCardPaymentTypeIds(token);

    if (!creditoId && !debitoId) {
      return res.status(502).json({
        error: 'No se encontraron tipos de pago "Tarjeta Crédito" / "Tarjeta Débito" en tu cuenta Bsale.',
        hint: 'Revisa el nombre exacto en Bsale > Configuración > Medios de pago y ajusta el regex en getCardPaymentTypeIds.'
      });
    }

    const [creditoPagos, debitoPagos] = await Promise.all([
      fetchPaymentsForType(token, creditoId, dayStart, dayEnd),
      fetchPaymentsForType(token, debitoId, dayStart, dayEnd)
    ]);

    const [credito, debito] = await Promise.all([
      enrichWithDocument(token, creditoPagos),
      enrichWithDocument(token, debitoPagos)
    ]);

    return res.status(200).json({ date, credito, debito });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando Bsale', detail: String(err) });
  }
}

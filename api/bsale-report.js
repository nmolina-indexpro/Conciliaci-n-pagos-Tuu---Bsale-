// /api/bsale-report.js
// Consulta la API oficial de Bsale (api.bsale.io) y devuelve los documentos pagados
// con Tarjeta Crédito y Tarjeta Débito para un día específico.
//
// Notas de la API real (confirmado con datos de producción):
// - /v1/payments.json NO tiene filtro de fecha soportado -> filtramos documentos
//   por emissiondaterange (que sí existe) con expand=payments,client.
// - Al expandir "payments" dentro de documents.json, cada item NO trae un
//   payment_type anidado: viene aplanado como { href, id, name, amount },
//   donde id/name son directamente los del medio de pago (no del pago en sí).
//
// El access_token vive SOLO en el servidor (variable de entorno BSALE_ACCESS_TOKEN).

const BSALE_BASE = 'https://api.bsale.io/v1';
const TIMEOUT_MS = 15000;

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
  const r = await fetchWithTimeout(`${BSALE_BASE}${path}`, { headers: { access_token: token } });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Bsale HTTP ${r.status} en ${path}: ${text.slice(0, 300)}`);
  }
  return r.json();
}

function normalize(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // saca tildes
    .toUpperCase().trim();
}

// Comparación EXACTA (no "incluye"), para no confundir "TARJETA CREDITO" con
// medios de pago parecidos como "Paga con tarjetas de débito o crédito".
function classifyPayment(name) {
  const n = normalize(name);
  if (n === 'TARJETA CREDITO') return 'credito';
  if (n === 'TARJETA DEBITO') return 'debito';
  if (n === 'TRANSFERENCIA BANCARIA') return 'transferencia';
  if (n === 'EFECTIVO') return 'efectivo';
  if (n === 'SHOPIFY') return 'shopify';
  return null;
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

function toUtcDateStr(unixSeconds) {
  if (!unixSeconds) return null;
  // Bsale guarda emissionDate como medianoche UTC del día calendario (sin
  // considerar que Chile está en UTC-4/UTC-3), así que comparamos en UTC puro,
  // no convirtiendo a huso horario de Chile.
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function officeInfo(doc) {
  const o = doc.office;
  if (!o) return { id: null };
  return { id: o.id || (o.href ? o.href.split('/').pop().replace('.json', '') : null) };
}

export default async function handler(req, res) {
  const { date, debug, officeId, startDate: qStart, endDate: qEnd } = req.query;
  const startDate = qStart || date;
  const endDate = qEnd || date;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Falta parámetro date, o startDate y endDate (YYYY-MM-DD)' });
  }

  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'BSALE_ACCESS_TOKEN no está configurada en el servidor' });

  const effectiveOfficeId = officeId || process.env.BSALE_OFFICE_ID || null;

  try {
    const rangeStart = Math.floor(new Date(`${startDate}T00:00:00-04:00`).getTime() / 1000) - 6 * 3600;
    const rangeEnd = Math.floor(new Date(`${endDate}T23:59:59-04:00`).getTime() / 1000) + 6 * 3600;
    const limit = 50;
    const docsUrl = offset =>
      `/documents.json?emissiondaterange=[${rangeStart},${rangeEnd}]&expand=payments,client,document_type&limit=${limit}&offset=${offset}`;

    // Primera página: nos dice cuántas hay en total (campo "count") para poder
    // pedir el resto EN PARALELO en vez de una por una. Con rangos de varios
    // días esto puede ser bastante más rápido y evita el timeout de la función.
    const first = await bsaleGet(docsUrl(0), token);
    let allDocs = [...(first.items || [])];
    const total = typeof first.count === 'number' ? first.count : allDocs.length;
    const totalPages = Math.min(Math.ceil(total / limit), 40); // tope de seguridad: 2000 documentos

    if (totalPages > 1) {
      const pagePromises = [];
      for (let p = 1; p < totalPages; p++) pagePromises.push(bsaleGet(docsUrl(p * limit), token));
      const rest = await Promise.all(pagePromises);
      for (const r of rest) allDocs.push(...(r.items || []));
    }

    // Excluimos documentos anulados/inactivos, deduplicamos por id, y filtramos
    // por fecha exacta en UTC puro (que es como Bsale realmente guarda
    // emissionDate) para descartar documentos de días vecinos que se cuelan por
    // el rango ampliado. Para rangos multi-día, exigimos que la fecha caiga
    // dentro de [startDate, endDate] (comparación de string ISO funciona bien).
    const seenIds = new Set();
    allDocs = allDocs.filter(d => {
      const fecha = toUtcDateStr(d.emissionDate);
      if (!fecha || fecha < startDate || fecha > endDate) return false;
      if (d.state !== 0) return false; // 0 = activo, 1 = inactivo/anulado
      if (d.cancellationStatus) return false;
      if (seenIds.has(d.id)) return false;
      seenIds.add(d.id);
      return true;
    });

    if (debug) {
      const cardDocs = allDocs
        .flatMap(d => extractPaymentsArray(d).map(p => ({ p, d })))
        .filter(({ p }) => classifyPayment(p.name) !== null)
        .map(({ p, d }) => ({
          numero: d.number,
          cliente: clientName(d.client),
          tipo: classifyPayment(p.name),
          monto: p.amount,
          fecha: toUtcDateStr(d.emissionDate),
          officeId: officeInfo(d).id,
          documentTypeId: d.document_type?.id ?? null,
          salesId: d.salesId ?? null
        }));

      const porDocumentType = {};
      for (const c of cardDocs) {
        const key = String(c.documentTypeId) + (c.salesId ? '_conSalesId' : '_sinSalesId');
        porDocumentType[key] = porDocumentType[key] || { cantidad: 0, total: 0, ejemplos: [] };
        porDocumentType[key].cantidad += 1;
        porDocumentType[key].total += c.monto;
        if (porDocumentType[key].ejemplos.length < 4) {
          porDocumentType[key].ejemplos.push(`#${c.numero} ${c.cliente} $${c.monto} salesId=${c.salesId}`);
        }
      }

      // Volcado crudo de las Notas de Crédito del período -> para encontrar el
      // nombre real del campo con el monto total del documento (no todas traen
      // "payments", así que no basta con mirar los pagos para descontarlas).
      const notasCredito = allDocs
        .filter(d => /nota de cr[eé]dito/i.test(d.document_type?.name || ''))
        .map(d => ({ numero: d.number, cliente: clientName(d.client), documentTypeName: d.document_type?.name, raw: d }));

      return res.status(200).json({
        startDate, endDate,
        docsRevisados: allDocs.length,
        totalConTarjeta: cardDocs.length,
        porDocumentType,
        notasCredito
      });
    }

    const credito = [];
    const debito = [];
    const transferencia = [];
    const efectivo = [];
    const shopify = [];
    const otros = [];

    for (const doc of allDocs) {
      if (effectiveOfficeId && String(officeInfo(doc).id) !== String(effectiveOfficeId)) continue;
      const payments = extractPaymentsArray(doc);
      const numero = doc.number ? String(doc.number) : '';
      const cliente = clientName(doc.client);
      const fecha = toUtcDateStr(doc.emissionDate);
      const url = doc.urlPublicView || doc.urlPublicViewOriginal || '';

      for (const p of payments) {
        const kind = classifyPayment(p.name);
        const row = { numero, cliente, monto: p.amount, fecha, url, medioPago: p.name || '' };
        if (kind === 'credito') credito.push(row);
        else if (kind === 'debito') debito.push(row);
        else if (kind === 'transferencia') transferencia.push(row);
        else if (kind === 'efectivo') efectivo.push(row);
        else if (kind === 'shopify') shopify.push(row);
        else otros.push({ ...row, tipo: p.name || 'Sin especificar' }); // cualquier medio de pago que no reconocemos todavía (crédito 30 días, abono de cliente, etc.)
      }
    }

    return res.status(200).json({ startDate, endDate, credito, debito, transferencia, efectivo, shopify, otros, docsRevisados: allDocs.length });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando Bsale', detail: String(err) });
  }
}

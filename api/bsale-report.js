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
  const { date, debug, officeId } = req.query; // YYYY-MM-DD, officeId opcional para filtrar sucursal

  if (!date) return res.status(400).json({ error: 'Falta parámetro date (YYYY-MM-DD)' });

  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'BSALE_ACCESS_TOKEN no está configurada en el servidor' });

  const effectiveOfficeId = officeId || process.env.BSALE_OFFICE_ID || null;

  try {
    const dayStart = Math.floor(new Date(`${date}T00:00:00-04:00`).getTime() / 1000) - 6 * 3600;
    const dayEnd = Math.floor(new Date(`${date}T23:59:59-04:00`).getTime() / 1000) + 6 * 3600;

    // Traemos los documentos del rango (algo más ancho de lo necesario a propósito),
    // con sus pagos y cliente expandidos en la misma llamada
    let offset = 0;
    const limit = 50;
    let allDocs = [];
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

    // Excluimos documentos anulados/inactivos, deduplicamos por id, y ahora sí
    // filtramos por fecha exacta en UTC puro (que es como Bsale realmente guarda
    // emissionDate) para descartar documentos de días vecinos que se cuelan por
    // el rango ampliado.
    const seenIds = new Set();
    allDocs = allDocs.filter(d => {
      if (toUtcDateStr(d.emissionDate) !== date) return false;
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

      return res.status(200).json({
        date,
        docsRevisados: allDocs.length,
        totalConTarjeta: cardDocs.length,
        porDocumentType
      });
    }

    const credito = [];
    const debito = [];

    for (const doc of allDocs) {
      if (effectiveOfficeId && String(officeInfo(doc).id) !== String(effectiveOfficeId)) continue;
      const payments = extractPaymentsArray(doc);
      const numero = doc.number ? String(doc.number) : '';
      const cliente = clientName(doc.client);

      for (const p of payments) {
        const kind = classifyPayment(p.name);
        if (kind === 'credito') credito.push({ numero, cliente, monto: p.amount });
        else if (kind === 'debito') debito.push({ numero, cliente, monto: p.amount });
      }
    }

    return res.status(200).json({ date, credito, debito, docsRevisados: allDocs.length });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando Bsale', detail: String(err) });
  }
}

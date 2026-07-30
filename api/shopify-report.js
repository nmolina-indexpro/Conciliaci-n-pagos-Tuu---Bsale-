// /api/shopify-report.js
// Consulta la Admin API de Shopify y devuelve las órdenes pagadas de un rango de
// fechas, para cruzarlas contra los documentos "SHOPIFY" de Bsale.
//
// Requiere dos variables de entorno:
//   SHOPIFY_STORE_DOMAIN  -> ej. "indexstore.myshopify.com" (el dominio *.myshopify.com,
//                            no el dominio público como www.indexstore.cl)
//   SHOPIFY_ACCESS_TOKEN  -> Admin API access token (empieza con shpat_), generado
//                            desde una app personalizada (Configuración > Apps y
//                            canales de venta > Desarrollar apps). NO es el
//                            "ID de cliente"/"Secreto" de OAuth.
//
// El token vive SOLO en el servidor, nunca en el navegador.

const TIMEOUT_MS = 12000;
const API_VERSION = '2024-10';

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout de ${timeoutMs}ms consultando Shopify`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.split(',').find(p => p.includes('rel="next"'));
  if (!match) return null;
  const urlMatch = match.match(/<([^>]+)>/);
  return urlMatch ? urlMatch[1] : null;
}

function customerName(order) {
  const c = order.customer;
  if (c) {
    const full = `${c.first_name || ''} ${c.last_name || ''}`.trim();
    if (full) return full;
  }
  return (order.email || '').split('@')[0] || 'Cliente Shopify';
}

export default async function handler(req, res) {
  const { date, startDate: qStart, endDate: qEnd } = req.query;
  const startDate = qStart || date;
  const endDate = qEnd || date;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Falta parámetro date, o startDate y endDate (YYYY-MM-DD)' });
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) {
    return res.status(500).json({
      error: 'Faltan variables de entorno SHOPIFY_STORE_DOMAIN y/o SHOPIFY_ACCESS_TOKEN en el servidor'
    });
  }

  try {
    const createdMin = `${startDate}T00:00:00-04:00`;
    const createdMax = `${endDate}T23:59:59-04:00`;

    let url =
      `https://${domain}/admin/api/${API_VERSION}/orders.json` +
      `?status=any&created_at_min=${encodeURIComponent(createdMin)}` +
      `&created_at_max=${encodeURIComponent(createdMax)}` +
      `&limit=250&fields=id,name,created_at,total_price,financial_status,customer,email,cancelled_at`;

    const allOrders = [];
    let guard = 0;

    while (url && guard < 20) { // tope de seguridad: 20 páginas (5000 órdenes)
      const r = await fetchWithTimeout(url, {
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return res.status(502).json({ error: `Shopify HTTP ${r.status}`, detail: text.slice(0, 300) });
      }
      const body = await r.json();
      allOrders.push(...(body.orders || []));
      url = parseNextLink(r.headers.get('link'));
      guard++;
    }

    // Solo órdenes pagadas y no canceladas cuentan como venta real esperando
    // acreditación / reconciliación contable.
    const ventas = allOrders
      .filter(o => !o.cancelled_at)
      .filter(o => ['paid', 'partially_refunded'].includes(o.financial_status))
      .map(o => ({
        numero: o.name,
        cliente: customerName(o),
        monto: Math.round(parseFloat(o.total_price)),
        fecha: (o.created_at || '').slice(0, 10)
      }));

    return res.status(200).json({ startDate, endDate, ventas, ordenesRevisadas: allOrders.length });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando Shopify', detail: String(err) });
  }
}

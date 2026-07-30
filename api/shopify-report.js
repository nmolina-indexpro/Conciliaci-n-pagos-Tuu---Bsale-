// /api/shopify-report.js
// Consulta la Admin API de Shopify y devuelve las órdenes pagadas de un rango de
// fechas, para cruzarlas contra los documentos "SHOPIFY" de Bsale.
//
// Desde 2026 Shopify ya no entrega un "Admin API access token" fijo para copiar
// una sola vez: las apps creadas en el Dev Dashboard usan Client Credentials
// Grant, un intercambio OAuth donde el servidor pide un token nuevo (válido
// 24h) usando el Client ID + Client Secret de la app. Por eso esta función pide
// un token fresco en cada consulta en vez de leer uno guardado.
//
// Requiere tres variables de entorno:
//   SHOPIFY_STORE_DOMAIN    -> ej. "indexstore-cl.myshopify.com"
//   SHOPIFY_CLIENT_ID       -> "ID de cliente" de la app (Dev Dashboard > tu app > Configuración)
//   SHOPIFY_CLIENT_SECRET   -> "Secreto" de la app (empieza con shpss_)
//
// Client Credentials Grant solo funciona para apps de tu propia organización
// instaladas en tiendas que tú mismo posees — que es justo nuestro caso.
//
// Las credenciales viven SOLO en el servidor, nunca en el navegador.

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

// Intercambia client_id + client_secret por un access_token válido ~24h
async function obtenerAccessToken(dominioLimpio, clientId, clientSecret) {
  const r = await fetchWithTimeout(`https://${dominioLimpio}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials'
    })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) {
    throw new Error(
      `No se pudo obtener token de Shopify (HTTP ${r.status}): ${body.error_description || body.error || JSON.stringify(body).slice(0, 200)}`
    );
  }
  return body.access_token;
}

export default async function handler(req, res) {
  const { date, startDate: qStart, endDate: qEnd } = req.query;
  const startDate = qStart || date;
  const endDate = qEnd || date;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Falta parámetro date, o startDate y endDate (YYYY-MM-DD)' });
  }

  // trim() por si quedó un espacio o salto de línea invisible al copiar/pegar
  const domain = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
  const clientId = (process.env.SHOPIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();

  if (!domain || !clientId || !clientSecret) {
    return res.status(500).json({
      error: 'Faltan variables de entorno SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID y/o SHOPIFY_CLIENT_SECRET en el servidor'
    });
  }

  const dominioLimpio = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!/^[a-z0-9-]+\.myshopify\.com$/i.test(dominioLimpio)) {
    return res.status(500).json({
      error: `SHOPIFY_STORE_DOMAIN no tiene el formato esperado: "${domain}" (largo: ${domain.length} caracteres)`,
      hint: 'Debe verse exactamente así: indexstore-cl.myshopify.com — sin https://, sin barra al final, sin espacios.'
    });
  }

  try {
    const token = await obtenerAccessToken(dominioLimpio, clientId, clientSecret);

    const createdMin = `${startDate}T00:00:00-04:00`;
    const createdMax = `${endDate}T23:59:59-04:00`;

    let url =
      `https://${dominioLimpio}/admin/api/${API_VERSION}/orders.json` +
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

// /api/shopify-images-report.js
// Recorre el catálogo de productos de Shopify y arma un mapa SKU -> URL de
// miniatura, para mostrar la imagen del producto junto a cada fila en la
// página de Compras. Usa las mismas credenciales (Client Credentials Grant)
// que ya usa shopify-report.js.

const TIMEOUT_MS = 20000;
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

async function obtenerAccessToken(dominioLimpio, clientId, clientSecret) {
  const r = await fetchWithTimeout(`https://${dominioLimpio}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) {
    throw new Error(`No se pudo obtener token de Shopify (HTTP ${r.status}): ${body.error_description || body.error || JSON.stringify(body).slice(0, 200)}`);
  }
  return body.access_token;
}

export default async function handler(req, res) {
  const domain = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
  const clientId = (process.env.SHOPIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();

  if (!domain || !clientId || !clientSecret) {
    return res.status(200).json({
      error: 'Faltan variables de entorno de Shopify (SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET)',
      imagenes: {}
    });
  }

  const dominioLimpio = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

  try {
    const token = await obtenerAccessToken(dominioLimpio, clientId, clientSecret);

    let url =
      `https://${dominioLimpio}/admin/api/${API_VERSION}/products.json` +
      `?status=active&limit=250&fields=id,title,image,images,variants`;

    const imagenes = {}; // sku -> url
    let guard = 0;

    while (url && guard < 30) { // tope de seguridad: 30 páginas (~7500 productos)
      const r = await fetchWithTimeout(url, {
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return res.status(200).json({ error: `Shopify HTTP ${r.status}`, detail: text.slice(0, 300), imagenes });
      }
      const body = await r.json();
      for (const p of (body.products || [])) {
        const imgUrl = p.image?.src || (p.images && p.images[0]?.src) || null;
        if (!imgUrl) continue;
        for (const v of (p.variants || [])) {
          if (v.sku) imagenes[v.sku] = imgUrl;
        }
      }
      url = parseNextLink(r.headers.get('link'));
      guard++;
    }

    return res.status(200).json({ imagenes, totalSkusConImagen: Object.keys(imagenes).length });
  } catch (err) {
    return res.status(200).json({ error: 'Error consultando Shopify', detail: String(err), imagenes: {} });
  }
}

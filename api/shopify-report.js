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

import { getSql, asegurarTablaShopifyAgotados } from '../lib/db.js';

const TIMEOUT_MS = 12000;
const API_VERSION = '2024-10';

// Colecciones de Shopify que agrupan cargadores/pantallas/baterías (IDs
// numéricos, sacados de las colecciones reales de indexstore.cl — no existe
// un "product_type" limpio para esto, así que se identifica por colección).
const COLECCIONES_ALERTA = [
  { id: '285430808755', categoria: 'Cargadores' }, // Cargadores para Notebook
  { id: '285473538227', categoria: 'Cargadores' }, // Cargadores de Macbook
  { id: '283436548275', categoria: 'Pantallas' },  // Pantallas para Notebook
  { id: '285483040947', categoria: 'Pantallas' },  // Pantallas para Macbook
  { id: '285306421427', categoria: 'Baterías' },   // Baterías para Notebook
  { id: '285310714035', categoria: 'Baterías' },   // Baterías Macbook
];

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

// Traduce los códigos internos que devuelve Shopify a algo legible para la persona
const NOMBRES_PASARELA = {
  shopify_payments: 'Shopify Payments',
  manual: 'Manual / Transferencia',
  bogus: 'Prueba',
  cash: 'Efectivo (POS)',
  'mercado pago': 'Mercado Pago',
  webpay: 'Webpay (Transbank)',
  paypal: 'PayPal'
};
// Busca en las etiquetas del pedido una referencia directa al documento Bsale
// (formato visto en producción: "NV-2496" para Nota de Venta, "FA-20195"
// para Factura). Devuelve solo el número, sin el prefijo.
function extraerDocBsale(tags) {
  if (!tags) return null;
  const lista = Array.isArray(tags) ? tags : String(tags).split(',').map(t => t.trim());
  for (const tag of lista) {
    const m = /^(?:NV|FA|BE)-(\d+)$/i.exec(tag.trim());
    if (m) return m[1];
  }
  return null;
}

function nombrePasarela(gatewayNames) {
  if (!Array.isArray(gatewayNames) || gatewayNames.length === 0) return 'No especificada';
  return gatewayNames
    .map(g => NOMBRES_PASARELA[(g || '').toLowerCase().trim()] || g)
    .join(' + ');
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

function credencialesShopify() {
  // trim() por si quedó un espacio o salto de línea invisible al copiar/pegar
  const domain = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
  const clientId = (process.env.SHOPIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();

  if (!domain || !clientId || !clientSecret) {
    throw new Error('Faltan variables de entorno SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID y/o SHOPIFY_CLIENT_SECRET en el servidor');
  }
  const dominioLimpio = domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!/^[a-z0-9-]+\.myshopify\.com$/i.test(dominioLimpio)) {
    throw new Error(`SHOPIFY_STORE_DOMAIN no tiene el formato esperado: "${domain}" — debe verse exactamente así: indexstore-cl.myshopify.com`);
  }
  return { dominioLimpio, clientId, clientSecret };
}

export default async function handler(req, res) {
  if (req.query.recurso === 'agotados') return manejarAgotados(req, res);
  return manejarOrdenes(req, res);
}

async function manejarOrdenes(req, res) {
  const { date, startDate: qStart, endDate: qEnd } = req.query;
  const startDate = qStart || date;
  const endDate = qEnd || date;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Falta parámetro date, o startDate y endDate (YYYY-MM-DD)' });
  }

  let dominioLimpio, clientId, clientSecret;
  try {
    ({ dominioLimpio, clientId, clientSecret } = credencialesShopify());
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }

  try {
    const token = await obtenerAccessToken(dominioLimpio, clientId, clientSecret);

    const createdMin = `${startDate}T00:00:00-04:00`;
    const createdMax = `${endDate}T23:59:59-04:00`;

    let url =
      `https://${dominioLimpio}/admin/api/${API_VERSION}/orders.json` +
      `?status=any&created_at_min=${encodeURIComponent(createdMin)}` +
      `&created_at_max=${encodeURIComponent(createdMax)}` +
      `&limit=250&fields=id,name,created_at,total_price,financial_status,customer,email,cancelled_at,payment_gateway_names,tags`;

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
        fecha: (o.created_at || '').slice(0, 10),
        pasarela: nombrePasarela(o.payment_gateway_names),
        // Cuando el pedido se paga por transferencia y Bsale genera la factura
        // después, Shopify guarda el número de documento como etiqueta
        // ("NV-2496", "FA-20195") -> con eso vinculamos directo, sin adivinar
        // por monto.
        docBsaleVinculado: extraerDocBsale(o.tags)
      }));

    return res.status(200).json({ startDate, endDate, ventas, ordenesRevisadas: allOrders.length });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando Shopify', detail: String(err) });
  }
}

function fechaStr(v) {
  if (!v) return null;
  return typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

// ---- Estado de las variantes en Bsale, indexado por SKU ----
// Para saber si un producto agotado que sigue publicado en Shopify tiene
// todavía un equivalente vigente en Bsale, o si ya se descontinuó (SKU
// eliminado o inhabilitado) -- mismo criterio "state === 0 significa
// vigente" que ya usa este proyecto para documentos de Bsale (ver
// bsale-sku-report.js, doc.state !== 0).
const BSALE_BASE = 'https://api.bsale.io/v1';
async function bsaleGet(path, token) {
  const r = await fetchWithTimeout(`${BSALE_BASE}${path}`, { headers: { access_token: token } }, 20000);
  if (!r.ok) throw new Error(`Bsale HTTP ${r.status} en ${path}`);
  return r.json();
}
async function obtenerEstadoVariantesBsale(token) {
  const estadoPorCode = new Map();
  const limit = 50;
  const primera = await bsaleGet(`/variants.json?limit=${limit}&offset=0`, token);
  const registrar = items => { for (const v of items) if (v.code) estadoPorCode.set(v.code, v.state); };
  registrar(primera.items || []);
  const total = primera.count || 0;
  const topePaginas = 80; // ~4.000 variantes
  const totalPaginas = Math.min(Math.ceil(total / limit), topePaginas);
  if (totalPaginas > 1) {
    const promesas = [];
    for (let p = 1; p < totalPaginas; p++) promesas.push(bsaleGet(`/variants.json?limit=${limit}&offset=${p * limit}`, token));
    const resto = await Promise.all(promesas);
    for (const r of resto) registrar(r.items || []);
  }
  return estadoPorCode;
}

// ---------------- Alertas Sitio web: productos agotados ----------------
// Cargadores/pantallas/baterías sin stock, identificados por colección (no
// hay un product_type limpio para esto en el catálogo real). La fecha en
// que "quedó sin stock" se reconstruye guardando la primera vez que este
// endpoint detecta cada producto en 0 (ver asegurarTablaShopifyAgotados).
async function manejarAgotados(req, res) {
  let dominioLimpio, clientId, clientSecret;
  try {
    ({ dominioLimpio, clientId, clientSecret } = credencialesShopify());
  } catch (err) {
    return res.status(200).json({ error: String(err.message || err), agotados: [] });
  }

  try {
    const token = await obtenerAccessToken(dominioLimpio, clientId, clientSecret);

    // GraphQL en vez de REST: el filtro "collection_id" de /products.json
    // (REST) devuelve 403 con este token -> necesita el scope
    // read_product_listings (de "canales de venta"), que la app no tiene.
    // La consulta de productos de una colección vía GraphQL solo pide
    // read_products, que sí está concedido (ya lo usan los otros reportes
    // de Shopify). De paso, totalInventory ya viene sumado por Shopify.
    const productosPorId = new Map(); // id -> { nombre, categoria, stock, sku }
    const query = `
      query($id: ID!, $cursor: String) {
        collection(id: $id) {
          products(first: 100, after: $cursor) {
            edges { node { id title totalInventory variants(first: 1) { edges { node { sku } } } } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `;
    for (const { id: collectionId, categoria } of COLECCIONES_ALERTA) {
      const gid = `gid://shopify/Collection/${collectionId}`;
      let cursor = null;
      let guard = 0;
      while (guard < 10) { // tope de seguridad: 10 páginas (1000 productos) por colección
        const r = await fetchWithTimeout(`https://${dominioLimpio}/admin/api/${API_VERSION}/graphql.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { id: gid, cursor } })
        });
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          return res.status(502).json({ error: `Shopify HTTP ${r.status} (colección ${collectionId})`, detail: text.slice(0, 300), agotados: [] });
        }
        const body = await r.json();
        if (body.errors) {
          return res.status(502).json({ error: `Shopify GraphQL error (colección ${collectionId})`, detail: JSON.stringify(body.errors).slice(0, 300), agotados: [] });
        }
        const conexion = body.data?.collection?.products;
        if (!conexion) break;
        for (const { node: p } of conexion.edges) {
          const idNumerico = p.id.split('/').pop();
          // Un producto puede vivir en más de una colección de alerta (ej.
          // ambas de cargadores) -> se queda con la primera categoría vista.
          if (!productosPorId.has(idNumerico)) {
            const sku = p.variants?.edges?.[0]?.node?.sku || null;
            productosPorId.set(idNumerico, { nombre: p.title, categoria, stock: p.totalInventory, sku });
          }
        }
        if (!conexion.pageInfo.hasNextPage) break;
        cursor = conexion.pageInfo.endCursor;
        guard++;
      }
    }

    const agotadosAhora = [...productosPorId.entries()]
      .filter(([, p]) => p.stock <= 0)
      .map(([id, p]) => ({ id, nombre: p.nombre, categoria: p.categoria, sku: p.sku }));

    // ---- Fecha en que se detectó cada uno sin stock (persistida) ----
    let resultado = agotadosAhora.map(p => ({ ...p, fechaDetectado: null }));
    try {
      const sql = await getSql();
      await asegurarTablaShopifyAgotados(sql);

      const idsAgotadosAhora = new Set(agotadosAhora.map(p => p.id));
      const { rows: activosPrevios } = await sql`SELECT producto_id FROM shopify_agotados WHERE activo = true;`;

      // Los que ya no están agotados se marcan resueltos -> si vuelven a
      // quedar en 0 más adelante, la próxima detección cuenta como una
      // fecha nueva (no se arrastra la anterior).
      for (const row of activosPrevios) {
        if (!idsAgotadosAhora.has(row.producto_id)) {
          await sql`UPDATE shopify_agotados SET activo = false WHERE producto_id = ${row.producto_id};`;
        }
      }

      // Si ya estaba activo, conserva fecha_detectado original; si es
      // nuevo (o había vuelto a tener stock), queda con la fecha de hoy.
      for (const p of agotadosAhora) {
        await sql`
          INSERT INTO shopify_agotados (producto_id, nombre, categoria, sku, fecha_detectado, activo)
          VALUES (${p.id}, ${p.nombre}, ${p.categoria}, ${p.sku}, CURRENT_DATE, true)
          ON CONFLICT (producto_id) DO UPDATE SET
            nombre = EXCLUDED.nombre,
            categoria = EXCLUDED.categoria,
            sku = EXCLUDED.sku,
            fecha_detectado = CASE WHEN shopify_agotados.activo THEN shopify_agotados.fecha_detectado ELSE CURRENT_DATE END,
            activo = true;
        `;
      }

      const { rows } = await sql`SELECT producto_id, nombre, categoria, sku, fecha_detectado FROM shopify_agotados WHERE activo = true ORDER BY fecha_detectado ASC;`;
      resultado = rows.map(r => ({ id: r.producto_id, nombre: r.nombre, categoria: r.categoria, sku: r.sku, fechaDetectado: fechaStr(r.fecha_detectado) }));
    } catch (dbErr) {
      // Sin base de datos disponible, igual se muestra la lista actual (sin fecha).
    }

    // ---- Cruce con Bsale: ¿el SKU sigue vigente allá? ----
    // Si no hay BSALE_ACCESS_TOKEN configurado, o la consulta falla, se
    // sigue mostrando la lista igual, solo sin este dato extra (mismo
    // criterio de degradación que el resto del proyecto).
    const bsaleToken = (process.env.BSALE_ACCESS_TOKEN || '').trim();
    let estadoBsalePorCode = null;
    if (bsaleToken) {
      try { estadoBsalePorCode = await obtenerEstadoVariantesBsale(bsaleToken); }
      catch (err) { /* sigue sin el cruce de Bsale */ }
    }

    resultado = resultado.map(p => {
      let estadoBsale = null;
      if (estadoBsalePorCode) {
        if (!p.sku) estadoBsale = null; // sin SKU legible en Shopify, no se puede cruzar
        else if (!estadoBsalePorCode.has(p.sku)) estadoBsale = 'no_existe';
        else if (estadoBsalePorCode.get(p.sku) !== 0) estadoBsale = 'archivado';
      }
      return { ...p, estadoBsale, adminUrl: `https://${dominioLimpio}/admin/products/${p.id}` };
    });

    return res.status(200).json({ agotados: resultado });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando Shopify', detail: String(err), agotados: [] });
  }
}

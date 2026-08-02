// /api/bsale-facturas-por-pagar.js
// Versión liviana (sin el análisis de SKU/stock) que solo calcula facturas de
// proveedores próximas a vencer, para usar en el Flujo de Caja. Reutiliza la
// misma lógica de identificación de proveedor y plazo que bsale-sku-report.js.

const BSALE_BASE = 'https://api.bsale.io/v1';
const TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout de ${timeoutMs}ms consultando Bsale`);
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

function toUtcDateStr(unixSeconds) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Si un vencimiento cae sábado o domingo, se paga el lunes siguiente (no hay
// proceso bancario en fin de semana).
function ajustarASiguienteDiaHabil(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo, 6=sábado
  if (dow === 6) return addDaysStr(dateStr, 2);
  if (dow === 0) return addDaysStr(dateStr, 1);
  return dateStr;
}

const proveedoresConocidos = [
  { patron: /coimco/i, nombre: 'COIMCO', plazoDias: 30 },
  { patron: /laptop\s*center/i, nombre: 'LaptopCenter', plazoDias: 45 },
  { patron: /intcomex/i, nombre: 'Intcomex', plazoDias: 30 },
  { patron: /daxis/i, nombre: 'Daxis', plazoDias: 30 },
  { patron: /synnex/i, nombre: 'Synnex', plazoDias: 30 },
  { patron: /ingram/i, nombre: 'Ingram Micro', plazoDias: 30 }
];
const PLAZO_POR_DEFECTO = 30;
function identificarProveedor(rec) {
  const texto = `${rec.note || ''} ${rec.document || ''}`;
  for (const p of proveedoresConocidos) if (p.patron.test(texto)) return p;
  const nombre = (rec.note || '').trim() || 'Sin identificar';
  return { nombre, plazoDias: PLAZO_POR_DEFECTO };
}

export default async function handler(req, res) {
  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) {
    return res.status(200).json({ error: 'BSALE_ACCESS_TOKEN no configurada', facturas: [] });
  }

  const hoyStr = new Date().toISOString().slice(0, 10);
  // Recepciones de los últimos 60 días alcanzan para cubrir vencimientos de
  // hasta 45 días (LaptopCenter) más margen.
  const ventanaRecepcionInicio = addDaysStr(hoyStr, -60);

  try {
    const primera = await bsaleGet('/stocks/receptions.json?limit=50&offset=0', token);
    const totalRecepciones = primera.count || 0;
    const limit = 50;
    const totalPaginas = Math.ceil(totalRecepciones / limit);
    const topePaginas = 40; // ~2.000 recepciones más recientes
    const paginasARevisar = Math.min(totalPaginas, topePaginas);
    const offsetInicio = Math.max(0, (totalPaginas - paginasARevisar) * limit);

    const promesas = [];
    for (let off = offsetInicio; off < totalPaginas * limit; off += limit) {
      promesas.push(bsaleGet(`/stocks/receptions.json?expand=details&limit=${limit}&offset=${off}`, token));
    }
    const paginas = await Promise.all(promesas);
    const recepciones = paginas.flatMap(p => p.items || []);

    const facturas = [];
    for (const rec of recepciones) {
      if (/nota de cr[eé]dito/i.test(rec.document || '')) continue;
      const fecha = rec.rawAdmissionDate || toUtcDateStr(rec.admissionDate);
      if (!fecha || fecha < ventanaRecepcionInicio) continue;

      const detalles = rec.details?.items || [];
      const totalRecepcion = detalles.reduce((a, d) => a + ((d.cost || 0) * (d.quantity || 0)), 0);
      if (totalRecepcion <= 0) continue;

      const proveedorInfo = identificarProveedor(rec);
      const fechaEstimadaPago = ajustarASiguienteDiaHabil(addDaysStr(fecha, proveedorInfo.plazoDias));

      facturas.push({
        fecha,
        proveedor: proveedorInfo.nombre,
        documento: rec.document || 'Sin Documento',
        numeroDocumento: rec.documentNumber || '',
        monto: Math.round(totalRecepcion),
        fechaEstimadaPago
      });
    }
    facturas.sort((a, b) => a.fechaEstimadaPago.localeCompare(b.fechaEstimadaPago));

    return res.status(200).json({ hoy: hoyStr, facturas });
  } catch (err) {
    return res.status(200).json({ error: 'Error consultando Bsale', detail: String(err), facturas: [] });
  }
}

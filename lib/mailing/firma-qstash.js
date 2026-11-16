// /lib/mailing/firma-qstash.js
// Verificación de la firma de Upstash QStash (encabezado Upstash-Signature, JWT HS256) y publicación de lotes en la cola.
// Referencia: https://upstash.com/docs/qstash/howto/signature

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const igual = (a, b) => {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Devuelve true si el JWT está firmado con alguna de las claves, no venció, es para ESTA url y corresponde a ESTE cuerpo.
export function verificarFirmaQstash({ firma, cuerpo, url, claves = [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY], ahora = Date.now() }) {
  try {
    const llaves = (claves || []).filter(Boolean);
    if (!firma || !llaves.length) return false;
    const partes = String(firma).split('.');
    if (partes.length !== 3) return false;
    const [cab, carga, sig] = partes;
    const header = JSON.parse(Buffer.from(cab, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256') return false;
    const firmaOk = llaves.some(k => igual(createHmac('sha256', k).update(`${cab}.${carga}`).digest('base64url'), sig.replace(/=+$/, '')));
    if (!firmaOk) return false;
    const c = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
    const seg = Math.floor(ahora / 1000);
    if (c.iss !== 'Upstash') return false;
    if (typeof c.exp !== 'number' || seg > c.exp) return false;
    if (typeof c.nbf === 'number' && seg < c.nbf - 5) return false;
    if (!url || c.sub !== url) return false;
    const hashCuerpo = createHash('sha256').update(cuerpo ?? '').digest('base64url');
    return igual(hashCuerpo, String(c.body || '').replace(/=+$/, ''));
  } catch {
    return false;
  }
}

// Publica varios mensajes en un solo viaje (POST /v2/batch). Cada mensaje: { destino, cuerpo (objeto), retrasoSeg, idDedup }.
// `idDedup` evita que un reintento del lanzamiento encole dos veces el mismo lote.
export async function encolarLotes(mensajes, { token = process.env.QSTASH_TOKEN, base = process.env.QSTASH_URL || 'https://qstash.upstash.io', fetchFn = fetch } = {}) {
  if (!token) throw new Error('QSTASH_TOKEN no está configurada');
  if (!mensajes.length) return { encolados: 0 };
  let encolados = 0;
  for (let i = 0; i < mensajes.length; i += 100) { // el batch de QStash admite hasta 100 por llamada
    const trozo = mensajes.slice(i, i + 100).map(m => ({
      destination: m.destino,
      body: JSON.stringify(m.cuerpo),
      headers: {
        'Content-Type': 'application/json',
        ...(m.retrasoSeg ? { 'Upstash-Delay': `${Math.max(0, Math.round(m.retrasoSeg))}s` } : {}),
        ...(m.idDedup ? { 'Upstash-Deduplication-Id': m.idDedup } : {}),
        'Upstash-Retries': '3',
      },
    }));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetchFn(`${base}/v2/batch`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(trozo), signal: ctrl.signal });
      if (!r.ok) throw new Error(`QStash respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
      encolados += trozo.length;
    } finally { clearTimeout(t); }
  }
  return { encolados };
}

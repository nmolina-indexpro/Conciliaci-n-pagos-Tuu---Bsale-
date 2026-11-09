import { unaVez } from './una-vez.js';
// Páginas 404 de Search Console: lista importada desde el informe "Páginas > No se ha encontrado (404)", comprobación en vivo, clasificación
// (reglas + IA) y redirecciones sugeridas. Las funciones de armado son puras y exportadas; las de base de datos reciben `sql` y las que hablan
// con Shopify o la IA reciben `gql` / `pedirIA` (se inyectan desde api/negocio.js).
//
// La API de Search Console NO entrega la lista de páginas 404 (ni ninguna del informe "Páginas"), por eso se importa desde el botón "Exportar" del informe.

export const HOSTS_SITIO = ['indexstore.cl', 'www.indexstore.cl'];
export const BASE_VERIFICACION = 'https://www.indexstore.cl';
export const MAX_URLS_IMPORTACION = 5000;
export const ACCIONES = ['redirigir', 'dejar', 'ignorar', 'resuelta', 'revisar', 'ia_pendiente'];
export const ESTADOS = ['pendiente', 'aprobada', 'descartada', 'aplicada'];
export const COLECCIONES_NO_DESTINO = ['all', 'cloud-search-all-products', 'globofilter-best-selling-products-index', 'vendors', 'types'];

// ── Lectura de la lista ─────────────────────────────────────────────
// Ruta + parámetros de una URL del sitio, sin barra final ("https://www.indexstore.cl/collections/x/?a=1" -> "/collections/x?a=1"). null si no es del sitio.
export function normalizarRuta(url) {
  try {
    const u = new URL(String(url).trim());
    if (!HOSTS_SITIO.includes(u.hostname.toLowerCase())) return null;
    const ruta = (u.pathname.replace(/\/+$/, '') || '/') + u.search;
    return ruta.length > 600 ? null : ruta;
  } catch { return null; }
}

function fechaDeTexto(t) {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const lat = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t);
  if (lat) return `${lat[3]}-${lat[2].padStart(2, '0')}-${lat[1].padStart(2, '0')}`;
  return null;
}

// CSV exportado de Search Console (columnas "URL" y "Último rastreo"), o una URL por línea. Devuelve { filas: [{ ruta, ultimo_rastreo }], ajenas, repetidas }.
export function parsearUrls404(texto) {
  const filas = []; const vistas = new Set(); let ajenas = 0; let repetidas = 0;
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const m = /https?:\/\/[^\s,;"'\t]+/i.exec(linea);
    if (!m) continue;
    const ruta = normalizarRuta(m[0]);
    if (!ruta) { ajenas++; continue; }
    if (vistas.has(ruta)) { repetidas++; continue; }
    vistas.add(ruta);
    filas.push({ ruta, ultimo_rastreo: fechaDeTexto(linea.slice(m.index + m[0].length)) });
    if (filas.length >= MAX_URLS_IMPORTACION) break;
  }
  return { filas, ajenas, repetidas };
}

// ── Qué es cada URL ─────────────────────────────────────────────────
const EXTENSION_ARCHIVO = /\.(jpe?g|png|webp|gif|svg|ico|pdf|js|css|map|xml|txt|json|woff2?|mp4)$/i;
const RUTAS_TECNICAS = /^\/(apple-touch-icon|\.well-known|wp-|cdn-cgi|cart|checkout|account|search|apps|services|a\/|tools|admin|favicon|robots)/i;
function decodificar(s) { try { return decodeURIComponent(s); } catch { return s; } }

// { tipo, handle, coleccion } — tipos: archivo, tecnica, producto, coleccion, coleccion_filtro, pagina, articulo, otro
export function analizarRuta(ruta) {
  const [camino] = String(ruta || '').split('?');
  const partes = camino.split('/').filter(Boolean).map(decodificar);
  if (!partes.length) return { tipo: 'otro' };
  if (partes[0] === 'cdn' || partes[0] === 'files' || EXTENSION_ARCHIVO.test(camino)) return { tipo: 'archivo' };
  if (RUTAS_TECNICAS.test(camino)) return { tipo: 'tecnica' };
  if (partes[0] === 'products' && partes[1]) return { tipo: 'producto', handle: partes[1].toLowerCase(), coleccion: null };
  if (partes[0] === 'collections' && partes[1]) {
    const col = partes[1].toLowerCase();
    if (COLECCIONES_NO_DESTINO.includes(col) && col !== 'all') return { tipo: 'tecnica' };
    if (partes[2] === 'products' && partes[3]) return { tipo: 'producto', handle: partes[3].toLowerCase(), coleccion: col };
    if (partes[2]) return { tipo: 'coleccion_filtro', handle: col, filtro: partes[2] };
    return { tipo: 'coleccion', handle: col };
  }
  if (partes[0] === 'pages' && partes[1]) return { tipo: 'pagina', handle: partes[1].toLowerCase() };
  if (partes[0] === 'blogs') return { tipo: 'articulo', handle: partes[partes.length - 1].toLowerCase() };
  return { tipo: 'otro' };
}

// ── Parecido entre una URL perdida y el catálogo ────────────────────
const PALABRAS_VACIAS = new Set(['para', 'de', 'del', 'la', 'el', 'los', 'las', 'con', 'y', 'e', 'en', 'a', 'un', 'una', 'por', 'al', 'modelo']);
export function tokensDe(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((t) => t && !PALABRAS_VACIAS.has(t));
}
const esModelo = (t) => /\d/.test(t) && t.length >= 2;
const peso = (t) => (esModelo(t) ? 3 : 1);

// Índice de búsqueda: [{ url, handle, titulo, tipo, stock, tokens:Set, modelos:string[] }]
export function indexar(items, tipo, prefijo) {
  return items.map((x) => {
    const tokens = new Set([...tokensDe(x.handle), ...tokensDe(x.titulo)]);
    return { url: `${prefijo}${x.handle}`, handle: x.handle, titulo: x.titulo || x.handle, tipo, stock: x.stock ?? null, tokens, modelos: [...tokens].filter(esModelo) };
  });
}

// Los candidatos más parecidos a una lista de palabras. score 0..1 (cobertura de las palabras buscadas, con más peso en números de modelo, y precisión).
// mismo_modelo: todos los códigos de modelo de la búsqueda (a1398, g8, 250…) aparecen en el candidato.
export function buscarCandidatos(textoBuscado, indice, { max = 5, minimo = 0.3 } = {}) {
  const buscados = new Set(tokensDe(textoBuscado));
  if (!buscados.size) return [];
  const modelosBuscados = [...buscados].filter(esModelo);
  const pesoBuscado = [...buscados].reduce((s, t) => s + peso(t), 0);
  const res = [];
  for (const it of indice) {
    let comun = 0;
    for (const t of buscados) if (it.tokens.has(t)) comun += peso(t);
    if (!comun) continue;
    let pesoItem = 0;
    for (const t of it.tokens) pesoItem += peso(t);
    const score = 0.65 * (comun / pesoBuscado) + 0.35 * (comun / (pesoItem || 1));
    if (score < minimo) continue;
    res.push({ url: it.url, titulo: it.titulo, tipo: it.tipo, stock: it.stock, score: Math.round(score * 100) / 100, mismo_modelo: modelosBuscados.length > 0 && modelosBuscados.every((m) => it.tokens.has(m)) });
  }
  res.sort((a, b) => b.score - a.score || (b.stock || 0) - (a.stock || 0));
  return res.slice(0, max);
}

// ── Decisión por reglas ─────────────────────────────────────────────
// fila: { ruta, vivo_estado, vivo_destino, clics }. ctx: { productos: Map handle->{titulo,stock}, colecciones: Map, paginas: Map, indiceProductos, indiceColecciones, indicePaginas }.
// Devuelve { tipo, accion, destino, motivo, confianza, origen, candidatos }; accion 'ia_pendiente' = hay que preguntarle a la IA entre los candidatos.
export function decidirPorReglas(fila, ctx) {
  const info = analizarRuta(fila.ruta);
  const r = (accion, motivo, extra = {}) => ({ tipo: info.tipo, accion, destino: null, motivo, confianza: extra.confianza || 'alta', origen: 'regla', candidatos: [], ...extra });
  if (fila.vivo_estado === 'ok') return r('resuelta', 'Hoy la página responde bien: la lista de Google está desactualizada. Basta pedir "Validar arreglo" en Search Console.');
  if (fila.vivo_estado === 'redirige') return r('resuelta', `Ya redirige${fila.vivo_destino ? ' a ' + fila.vivo_destino : ''}: Google lo verá en el próximo rastreo.`, { destino: fila.vivo_destino || null });
  if (info.tipo === 'archivo') return r('ignorar', 'Es un archivo o un enlace roto de imagen/recurso, no una página. No necesita redirección.');
  if (info.tipo === 'tecnica') return r('ignorar', 'Es una ruta técnica o automática de Shopify, no una página del catálogo. No necesita redirección.');

  const colPath = info.tipo === 'producto' ? info.coleccion : info.handle;
  const colVigente = colPath && ctx.colecciones.has(colPath) && !COLECCIONES_NO_DESTINO.includes(colPath) ? colPath : null;
  const candColeccionPath = colVigente ? [{ url: `/collections/${colVigente}`, titulo: ctx.colecciones.get(colVigente).titulo, tipo: 'coleccion', stock: null, score: 1, mismo_modelo: false }] : [];

  if (info.tipo === 'producto') {
    if (ctx.productos.has(info.handle)) {
      if (info.coleccion) return r('redirigir', 'El producto sigue activo; solo falló el enlace que pasa por una colección. Se envía a la ficha directa.', { destino: `/products/${info.handle}` });
      return r('revisar', 'El producto figura activo pero la tienda no lo muestra. Revisa que esté publicado en el canal "Tienda online".');
    }
    const prod = buscarCandidatos(info.handle, ctx.indiceProductos, { max: 5 });
    const mejor = prod[0];
    if (mejor && mejor.score >= 0.88 && mejor.mismo_modelo && !(prod[1] && prod[1].score >= mejor.score - 0.04)) {
      return r('redirigir', `El producto original ya no está publicado; "${mejor.titulo}" coincide en nombre y modelo.`, { destino: mejor.url, confianza: 'media', candidatos: prod });
    }
    const cols = buscarCandidatos(info.handle, ctx.indiceColecciones, { max: 3, minimo: 0.2 });
    const cand = [...prod, ...candColeccionPath, ...cols.filter((c) => !candColeccionPath.some((x) => x.url === c.url))].slice(0, 8);
    if (cand.length) return r('ia_pendiente', 'Pendiente de revisar con IA.', { candidatos: cand, confianza: 'baja' });
    return r('dejar', 'No hay en la tienda una página equivalente. Lo correcto es dejar el 404: Google lo retirará solo.', { confianza: 'media' });
  }

  if (info.tipo === 'coleccion' || info.tipo === 'coleccion_filtro') {
    if (colVigente && info.tipo === 'coleccion_filtro') return r('redirigir', `La etiqueta o filtro "${info.filtro}" ya no existe; se envía a la colección principal.`, { destino: `/collections/${colVigente}`, confianza: 'media' });
    if (colVigente) return r('revisar', 'La colección existe pero la tienda no la muestra. Revisa que esté publicada en el canal "Tienda online".');
    const cols = buscarCandidatos(info.handle, ctx.indiceColecciones, { max: 5 });
    const mejor = cols[0];
    if (mejor && mejor.score >= 0.85 && mejor.mismo_modelo !== false && !(cols[1] && cols[1].score >= mejor.score - 0.04)) {
      return r('redirigir', `La colección original ya no existe; "${mejor.titulo}" coincide en nombre.`, { destino: mejor.url, confianza: 'media', candidatos: cols });
    }
    if (cols.length) return r('ia_pendiente', 'Pendiente de revisar con IA.', { candidatos: cols, confianza: 'baja' });
    return r('dejar', 'No hay una colección equivalente. Lo correcto es dejar el 404: Google lo retirará solo.', { confianza: 'media' });
  }

  if (info.tipo === 'pagina') {
    if (ctx.paginas.has(info.handle)) return r('revisar', 'La página existe pero la tienda no la muestra. Revisa que esté visible.');
    const pags = buscarCandidatos(info.handle, ctx.indicePaginas, { max: 4 });
    if (pags.length) return r('ia_pendiente', 'Pendiente de revisar con IA.', { candidatos: pags, confianza: 'baja' });
    return r('dejar', 'No hay una página equivalente. Lo correcto es dejar el 404.', { confianza: 'media' });
  }
  return r('revisar', 'Tipo de URL que no se clasifica solo (artículo del blog u otra). Revísala a mano.', { confianza: 'baja' });
}

// ── IA ──────────────────────────────────────────────────────────────
export const SISTEMA_IA_404 = `Eres analista SEO de IndexStore.cl, tienda chilena de repuestos y accesorios para notebooks (pantallas, baterías, cargadores, teclados) y tecnología.
Te paso URLs del sitio que hoy dan error 404 y, para cada una, páginas candidatas del catálogo vigente. Decide por cada URL:
- "redirigir": solo si una candidata es el mismo producto o un reemplazo directo y útil para quien buscaba esa URL (mismo modelo o compatibilidad exacta y mismo tipo de repuesto). Para una ficha discontinuada, también vale la colección de su misma categoría y marca/línea si existe y no es genérica.
- "dejar": si ninguna candidata sirve de verdad. Redirigir a algo que no tiene que ver (otro modelo, otra categoría, la portada) lo trata Google como error 404 blando y perjudica; en ese caso lo correcto es dejar el 404.
Reglas: "destino" debe ser EXACTAMENTE la url de una de las candidatas de esa URL (no inventes). Un producto de otro modelo NO es reemplazo. Con igualdad de ajuste prefiere el que tiene stock. Escribe "motivo" en español simple, una frase, sin jerga técnica, diciendo por qué (por ejemplo: "mismo modelo HP 250 G8, ficha vigente"). "confianza": alta solo si es el mismo producto o el mismo modelo exacto; media si es colección de la misma categoría; baja si dudas.`;

export const HERRAMIENTA_IA_404 = {
  name: 'decidir_urls_404',
  description: 'Decisión para cada URL 404: redirigir a una candidata o dejar el 404.',
  input_schema: {
    type: 'object',
    properties: {
      decisiones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            n: { type: 'integer', description: 'Número de la URL tal como viene en la lista' },
            accion: { type: 'string', enum: ['redirigir', 'dejar'] },
            destino: { type: 'string', description: 'url exacta de una candidata; vacío si accion es dejar' },
            motivo: { type: 'string' },
            confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
          },
          required: ['n', 'accion', 'motivo', 'confianza'],
        },
      },
    },
    required: ['decisiones'],
  },
};

export function textoParaIA(filas) {
  return 'URLs con 404:\n' + JSON.stringify(filas.map((f, i) => ({
    n: i + 1, url: f.ruta, clics_12_meses: f.clics || 0,
    candidatas: (f.candidatos || []).map((c) => ({ url: c.url, titulo: c.titulo, tipo: c.tipo, stock: c.stock, parecido: c.score })),
  })));
}

// Une la respuesta de la IA con las filas enviadas. Un destino que no esté entre los candidatos se rechaza (queda para revisión manual).
export function aplicarRespuestaIA(filas, respuesta) {
  const por = new Map((respuesta?.decisiones || []).map((d) => [Number(d.n), d]));
  return filas.map((f, i) => {
    const d = por.get(i + 1);
    if (!d) return { ruta: f.ruta, accion: 'revisar', destino: null, motivo: 'La IA no devolvió una decisión para esta URL.', confianza: 'baja', origen: 'ia' };
    const motivo = String(d.motivo || '').slice(0, 400) || 'Sin motivo.';
    const confianza = ['alta', 'media', 'baja'].includes(d.confianza) ? d.confianza : 'baja';
    if (d.accion === 'redirigir') {
      const destino = String(d.destino || '').trim();
      if (!(f.candidatos || []).some((c) => c.url === destino)) return { ruta: f.ruta, accion: 'revisar', destino: null, motivo: 'La IA propuso un destino que no estaba entre los candidatos: revísala a mano. ' + motivo, confianza: 'baja', origen: 'ia' };
      return { ruta: f.ruta, accion: 'redirigir', destino, motivo, confianza, origen: 'ia' };
    }
    return { ruta: f.ruta, accion: 'dejar', destino: null, motivo, confianza, origen: 'ia' };
  });
}

// ── Comprobación en vivo ────────────────────────────────────────────
export function resultadoVivo(codigo, ubicacion) {
  if (codigo >= 200 && codigo < 300) return { estado: 'ok', codigo };
  if (codigo >= 300 && codigo < 400) return { estado: 'redirige', codigo, destino: String(ubicacion || '').replace(/^https?:\/\/(www\.)?indexstore\.cl/i, '') || null };
  if (codigo === 404 || codigo === 410) return { estado: '404', codigo };
  return { estado: 'error', codigo };
}
export async function comprobarRuta(ruta, fetchFn = fetch, base = BASE_VERIFICACION, ms = 9000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetchFn(base + ruta, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; verificacion-404-erp-indexstore)' } });
    try { await r.arrayBuffer(); } catch { /* el cuerpo no importa */ }
    return resultadoVivo(r.status, r.headers.get('location'));
  } catch { return { estado: 'error', codigo: null }; } finally { clearTimeout(t); }
}
export async function enLotes(items, concurrencia, fn) {
  const salida = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, async () => {
    while (i < items.length) { const k = i++; salida[k] = await fn(items[k], k); }
  }));
  return salida;
}

// ── Catálogo de Shopify ─────────────────────────────────────────────
// Productos activos (con stock), colecciones con productos y páginas. Devuelve { productos: Map, colecciones: Map, paginas: Map }.
export async function cargarCatalogo(gql, { presupuestoMs = 40000 } = {}) {
  const inicio = Date.now();
  const productos = new Map(); const colecciones = new Map(); const paginas = new Map();
  let after = null;
  do {
    const d = await gql(`query($after:String){ products(first:250, after:$after, query:"status:active"){ pageInfo{hasNextPage endCursor} nodes{ handle title totalInventory } } }`, { after });
    const c = d.data?.products;
    for (const p of c?.nodes || []) productos.set(String(p.handle).toLowerCase(), { handle: p.handle, titulo: p.title, stock: p.totalInventory ?? 0 });
    after = c?.pageInfo?.hasNextPage ? c.pageInfo.endCursor : null;
    if (after && Date.now() - inicio > presupuestoMs) throw new Error('El catálogo de Shopify tardó demasiado en leerse; vuelve a intentar.');
  } while (after);
  after = null;
  do {
    const d = await gql(`query($after:String){ collections(first:250, after:$after){ pageInfo{hasNextPage endCursor} nodes{ handle title productsCount{count} } } }`, { after });
    const c = d.data?.collections;
    for (const x of c?.nodes || []) if ((x.productsCount?.count ?? 0) > 0 && !COLECCIONES_NO_DESTINO.includes(x.handle)) colecciones.set(String(x.handle).toLowerCase(), { handle: x.handle, titulo: x.title });
    after = c?.pageInfo?.hasNextPage ? c.pageInfo.endCursor : null;
  } while (after);
  try {
    const d = await gql(`{ pages(first:250){ nodes{ handle title } } }`, {});
    for (const x of d.data?.pages?.nodes || []) paginas.set(String(x.handle).toLowerCase(), { handle: x.handle, titulo: x.title });
  } catch { /* sin permiso de páginas: se sigue sin ellas */ }
  return { productos, colecciones, paginas };
}

export function contextoDeCatalogo(cat) {
  return {
    productos: cat.productos, colecciones: cat.colecciones, paginas: cat.paginas,
    indiceProductos: indexar([...cat.productos.values()], 'producto', '/products/'),
    indiceColecciones: indexar([...cat.colecciones.values()], 'coleccion', '/collections/'),
    indicePaginas: indexar([...cat.paginas.values()], 'pagina', '/pages/'),
  };
}

// ── Salida ──────────────────────────────────────────────────────────
const celdaCsv = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// Formato de importación de Shopify (Tienda online > Navegación > Redireccionamientos de URL > Importar).
export function csvRedirecciones(filas) {
  return 'Redirect from,Redirect to\n' + filas.filter((f) => f.destino).map((f) => `${celdaCsv(f.ruta)},${celdaCsv(f.destino)}`).join('\n') + '\n';
}

export function resumirFilas(filas) {
  const r = { total: filas.length, sin_comprobar: 0, por_accion: {}, por_estado: {}, por_confianza: {}, clics: 0, con_trafico: 0 };
  for (const f of filas) {
    if (!f.vivo_estado) r.sin_comprobar++;
    r.por_accion[f.accion || 'sin_analizar'] = (r.por_accion[f.accion || 'sin_analizar'] || 0) + 1;
    r.por_estado[f.estado] = (r.por_estado[f.estado] || 0) + 1;
    if (f.accion === 'redirigir') r.por_confianza[f.confianza] = (r.por_confianza[f.confianza] || 0) + 1;
    r.clics += f.clics || 0; if ((f.clics || 0) > 0 || (f.impresiones || 0) > 0) r.con_trafico++;
  }
  return r;
}

// ── Base de datos ───────────────────────────────────────────────────
export async function asegurarTablaSc404(sql) { return unaVez('asegurarTablaSc404', () => _asegurarTablaSc404(sql)); }
async function _asegurarTablaSc404(sql) {
  await sql.query(`CREATE TABLE IF NOT EXISTS sc_404 (
    ruta TEXT PRIMARY KEY, ultimo_rastreo DATE, importada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    vivo_estado TEXT, vivo_codigo INTEGER, vivo_destino TEXT, verificada_en TIMESTAMPTZ,
    tipo TEXT, accion TEXT, destino TEXT, motivo TEXT, confianza TEXT, origen TEXT, candidatos JSONB, analizada_en TIMESTAMPTZ,
    clics INTEGER NOT NULL DEFAULT 0, impresiones INTEGER NOT NULL DEFAULT 0,
    estado TEXT NOT NULL DEFAULT 'pendiente', decidida_por TEXT, decidida_en TIMESTAMPTZ, aplicada_en TIMESTAMPTZ, error TEXT)`);
}

// `reemplazar`: la lista importada es la completa de hoy, así que se quitan las URLs que ya no están (salvo las que ya tienen redirección aplicada).
export async function importarFilas(sql, filas, { reemplazar = false } = {}) {
  let nuevas = 0; let quitadas = 0;
  if (reemplazar && filas.length) {
    const { rowCount } = await sql.query(`DELETE FROM sc_404 WHERE ruta <> ALL($1::text[]) AND estado <> 'aplicada'`, [filas.map((f) => f.ruta)]);
    quitadas = rowCount || 0;
  }
  for (let i = 0; i < filas.length; i += 200) {
    const lote = filas.slice(i, i + 200);
    const { rows } = await sql.query(
      `INSERT INTO sc_404 (ruta, ultimo_rastreo) SELECT * FROM unnest($1::text[], $2::date[]) ON CONFLICT (ruta) DO UPDATE SET ultimo_rastreo = COALESCE(EXCLUDED.ultimo_rastreo, sc_404.ultimo_rastreo) RETURNING (xmax = 0) AS nueva`,
      [lote.map((f) => f.ruta), lote.map((f) => f.ultimo_rastreo)]);
    nuevas += rows.filter((r) => r.nueva).length;
  }
  return { nuevas, existentes: filas.length - nuevas, quitadas };
}

export async function listarFilas(sql) {
  const { rows } = await sql.query(
    `SELECT ruta, ultimo_rastreo::text AS ultimo_rastreo, vivo_estado, vivo_codigo, vivo_destino, verificada_en, tipo, accion, destino, motivo, confianza, origen, candidatos, clics, impresiones, estado, decidida_por, aplicada_en, error
       FROM sc_404 ORDER BY COALESCE(accion = 'redirigir', false) DESC, clics DESC, impresiones DESC, ruta`);
  return rows;
}

// Comprueba en vivo hasta `limite` URLs aún no comprobadas (o todas con `todas`). Devuelve cuántas quedan.
export async function verificarLote(sql, { limite = 120, todas = false, reintentar = false, fetchFn = fetch } = {}) {
  if (reintentar) await sql.query(`UPDATE sc_404 SET verificada_en = NULL WHERE vivo_estado = 'error'`);
  const { rows } = await sql.query(`SELECT ruta FROM sc_404 WHERE ${todas ? 'TRUE' : 'verificada_en IS NULL'} ORDER BY verificada_en NULLS FIRST, ruta LIMIT $1`, [limite]);
  const res = await enLotes(rows, 10, (f) => comprobarRuta(f.ruta, fetchFn));
  for (let i = 0; i < rows.length; i++) {
    const v = res[i];
    await sql.query(`UPDATE sc_404 SET vivo_estado = $2, vivo_codigo = $3, vivo_destino = $4, verificada_en = now() WHERE ruta = $1`, [rows[i].ruta, v.estado, v.codigo, v.destino || null]);
  }
  const { rows: q } = await sql.query(`SELECT count(*)::int AS n FROM sc_404 WHERE verificada_en IS NULL`);
  return { verificadas: rows.length, quedan: q[0].n };
}

// Aplica las reglas a las URLs sin analizar (o a todas con `reanalizar`, salvo las ya aprobadas/aplicadas). `trafico`: Map ruta -> { clics, impresiones }.
export async function analizarFilas(sql, ctx, { trafico = new Map(), reanalizar = false } = {}) {
  const { rows } = await sql.query(`SELECT ruta, vivo_estado, vivo_destino FROM sc_404 WHERE estado IN ('pendiente','descartada') ${reanalizar ? '' : 'AND analizada_en IS NULL'} AND vivo_estado IS NOT NULL AND vivo_estado <> 'error'`);
  const cuenta = {};
  for (const f of rows) {
    const t = trafico.get(String(f.ruta).split('?')[0]) || { clics: 0, impresiones: 0 };
    const d = decidirPorReglas({ ...f, clics: t.clics }, ctx);
    cuenta[d.accion] = (cuenta[d.accion] || 0) + 1;
    await sql.query(
      `UPDATE sc_404 SET tipo = $2, accion = $3, destino = $4, motivo = $5, confianza = $6, origen = $7, candidatos = $8::jsonb, clics = $9, impresiones = $10, analizada_en = now(), estado = 'pendiente', error = NULL WHERE ruta = $1`,
      [f.ruta, d.tipo, d.accion, d.destino, d.motivo, d.confianza, d.origen, JSON.stringify(d.candidatos || []), t.clics, t.impresiones]);
  }
  return { analizadas: rows.length, por_accion: cuenta };
}

// Pasa a la IA hasta `limite` URLs con accion 'ia_pendiente' (las de más tráfico primero). pedirIA(sistema, texto, herramienta) -> args.
export async function iaLote(sql, pedirIA, { limite = 15 } = {}) {
  const { rows } = await sql.query(`SELECT ruta, candidatos, clics FROM sc_404 WHERE accion = 'ia_pendiente' ORDER BY clics DESC, impresiones DESC, ruta LIMIT $1`, [limite]);
  if (!rows.length) return { procesadas: 0, quedan: 0 };
  const respuesta = await pedirIA(SISTEMA_IA_404, textoParaIA(rows), HERRAMIENTA_IA_404);
  const decisiones = aplicarRespuestaIA(rows, respuesta);
  for (const d of decisiones) {
    await sql.query(`UPDATE sc_404 SET accion = $2, destino = $3, motivo = $4, confianza = $5, origen = 'ia', analizada_en = now() WHERE ruta = $1`, [d.ruta, d.accion, d.destino, d.motivo, d.confianza]);
  }
  const { rows: q } = await sql.query(`SELECT count(*)::int AS n FROM sc_404 WHERE accion = 'ia_pendiente'`);
  return { procesadas: rows.length, quedan: q[0].n };
}

// Los destinos propuestos deben responder 200 hoy; si no, la fila pasa a revisión (no se redirige a una página que tampoco abre).
export async function validarDestinos(sql, { fetchFn = fetch } = {}) {
  const { rows } = await sql.query(`SELECT DISTINCT destino FROM sc_404 WHERE accion = 'redirigir' AND destino IS NOT NULL AND estado IN ('pendiente','aprobada') AND destino !~ '^https?:'`);
  const res = await enLotes(rows, 10, (f) => comprobarRuta(f.destino, fetchFn));
  const malos = rows.filter((_, i) => res[i].estado !== 'ok').map((f) => f.destino);
  if (malos.length) await sql.query(`UPDATE sc_404 SET accion = 'revisar', motivo = 'El destino propuesto no abre hoy (' || destino || '). ' || COALESCE(motivo, ''), confianza = 'baja', estado = 'pendiente' WHERE accion = 'redirigir' AND destino = ANY($1::text[]) AND estado IN ('pendiente','aprobada')`, [malos]);
  return { revisados: rows.length, descartados: malos.length };
}

// Aprobar / descartar / volver a pendiente. `rutas` explícitas; `destino` opcional (cambio manual, solo con una ruta).
export async function decidirFilas(sql, { rutas, estado, destino, usuario }) {
  if (!['pendiente', 'aprobada', 'descartada'].includes(estado)) throw new Error('Estado no válido');
  if (!Array.isArray(rutas) || !rutas.length) throw new Error('No se indicó ninguna URL');
  if (destino !== undefined && destino !== null && destino !== '') {
    if (rutas.length !== 1) throw new Error('El destino manual aplica a una sola URL');
    if (!/^\/[^\s]*$/.test(destino)) throw new Error('El destino debe ser una ruta del sitio que empiece con /');
    await sql.query(`UPDATE sc_404 SET destino = $2, accion = 'redirigir', origen = 'manual', confianza = 'alta', motivo = 'Destino elegido a mano.' WHERE ruta = $1 AND estado <> 'aplicada'`, [rutas[0], destino]);
  }
  const extra = estado === 'aprobada' ? `AND accion = 'redirigir' AND destino IS NOT NULL` : '';
  const { rowCount } = await sql.query(`UPDATE sc_404 SET estado = $2, decidida_por = $3, decidida_en = now() WHERE ruta = ANY($1::text[]) AND estado <> 'aplicada' ${extra}`, [rutas.slice(0, 2000), estado, usuario || null]);
  return { actualizadas: rowCount };
}

// Crea en Shopify las redirecciones aprobadas (requiere el permiso write_online_store_navigation de la app). Un camino ya redirigido cuenta como aplicado.
export async function aplicarRedirecciones(sql, gql, { usuario, limite = 60 } = {}) {
  const { rows } = await sql.query(`SELECT ruta, destino FROM sc_404 WHERE estado = 'aprobada' AND accion = 'redirigir' AND destino IS NOT NULL ORDER BY clics DESC LIMIT $1`, [limite]);
  let hechas = 0; const errores = [];
  for (const f of rows) {
    try {
      if (f.ruta.includes('?')) throw new Error('Shopify no permite crear redirecciones desde rutas con parámetros (?): quítala de la lista o descártala.');
      const d = await gql(`mutation($r:UrlRedirectInput!){ urlRedirectCreate(urlRedirect:$r){ urlRedirect{ id } userErrors{ field message } } }`, { r: { path: f.ruta, target: f.destino } });
      const ue = d.data?.urlRedirectCreate?.userErrors || [];
      const yaExiste = ue.some((e) => /already|taken|ya existe|en uso/i.test(e.message || ''));
      if (ue.length && !yaExiste) throw new Error(ue.map((e) => e.message).join('; '));
      await sql.query(`UPDATE sc_404 SET estado = 'aplicada', aplicada_en = now(), error = NULL, decidida_por = COALESCE($2, decidida_por) WHERE ruta = $1`, [f.ruta, usuario || null]);
      hechas++;
    } catch (e) {
      const msg = String(e.message || e).slice(0, 300);
      errores.push({ ruta: f.ruta, error: msg });
      await sql.query(`UPDATE sc_404 SET error = $2 WHERE ruta = $1`, [f.ruta, msg]);
      if (/access denied|scope|permission|not approved|ACCESS_DENIED/i.test(msg)) { errores.push({ ruta: '(general)', error: 'La app de Shopify no tiene el permiso write_online_store_navigation. Actívalo en el Dev Dashboard (Versión > Alcances) e instala la nueva versión, o importa el CSV en Shopify.' }); break; }
    }
  }
  const { rows: q } = await sql.query(`SELECT count(*)::int AS n FROM sc_404 WHERE estado = 'aprobada' AND accion = 'redirigir'`);
  return { aplicadas: hechas, errores, quedan: q[0].n };
}

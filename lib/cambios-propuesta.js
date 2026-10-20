// /lib/cambios-propuesta.js
// ══════════════════════════════════════════════════════════════════════
// Propuesta diaria de cambios relevantes (Actualizaciones ERP > "Propuesta del día").
// ══════════════════════════════════════════════════════════════════════
// Cada noche el sistema lee los commits del día (el repositorio es público), y una IA (Gemini) agrupa y redacta hasta 10 cambios relevantes para el
// equipo, sin jerga técnica ni datos financieros. Quedan guardados POR FECHA en cambios_registro como "propuesto". El administrador los revisa,
// edita y aprueba; los aprobados se envían en el correo diario de cambios del día siguiente (ver enviarResumenCambios en lib/resumen-cambios.js).
// Funciones puras (sin red ni base de datos) para poder probarlas, salvo leerCommitsDelDia que recibe el fetch.

export const MAX_PROPUESTAS = 10;
export const REPO_POR_DEFECTO = 'nmolina-indexpro/Conciliaci-n-pagos-Tuu---Bsale-';
export const MAX_DESCRIPCION = 300;

export const PROMPT_PROPUESTA = `Eres el editor del resumen diario de cambios de IndexStore (tienda chilena de repuestos y servicio técnico de notebooks) y de su sistema interno, el ERP. Recibes la lista numerada de los commits del día (mensajes en español) y, aparte, los cambios que ya estaban registrados ese día.
Elige y redacta HASTA ${MAX_PROPUESTAS} cambios RELEVANTES para el equipo no técnico (ventas, atención al cliente, bodega, administración): lo que cambia lo que ven o hacen en la tienda o en el ERP. Agrupa los commits que son partes de un mismo cambio. Descarta lo puramente técnico (pruebas, diagnósticos, ajustes internos, correcciones menores de errores) salvo que cambie algo visible. No repitas lo que ya estaba registrado.
Para cada cambio entrega: "area" (2 a 4 palabras, por ejemplo "Cotizaciones web" o "ERP · Notificaciones"), "sitio" ("web" si es la tienda indexstore.cl, "erp" si es el sistema interno), "descripcion" (1 o 2 frases en español simple: qué cambió y para qué sirve; máximo ${MAX_DESCRIPCION} caracteres; SIN jerga técnica y SIN montos, ventas, costos ni ningún dato financiero), "relevancia" (número de 1 a 10) y "commits" (los números de la lista que componen el cambio).
Ordena de mayor a menor relevancia. Si nada es relevante, responde []. Responde SOLO un arreglo JSON, sin texto antes ni después.`;

// Quita montos en pesos de una descripción (regla: nada financiero en estas notificaciones) y recorta.
export function limpiarDescripcion(texto) {
  let t = String(texto || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/\$\s?\d[\d.,]*/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  if (t.length > MAX_DESCRIPCION) t = t.slice(0, MAX_DESCRIPCION - 1).replace(/\s+\S*$/, '') + '…';
  return t;
}

// commits de la API de GitHub -> [{ sha, corto, asunto, fecha, url }] (se ignoran los merges y los commits vacíos)
export function normalizarCommits(crudos, repo = REPO_POR_DEFECTO) {
  return (crudos || [])
    .map(c => {
      const asunto = String((c.commit && c.commit.message) || '').split('\n')[0].trim();
      return { sha: c.sha, corto: String(c.sha || '').slice(0, 7), asunto: asunto.slice(0, 600), fecha: c.commit && c.commit.author && c.commit.author.date, url: `https://github.com/${repo}/commit/${c.sha}` };
    })
    .filter(c => c.sha && c.asunto && !/^merge\b/i.test(c.asunto));
}

// Lee los commits entre dos instantes (ISO). Si hay GITHUB_TOKEN se usa; el repositorio es público, así que también funciona sin él.
export async function leerCommitsDelDia({ desdeIso, hastaIso, repo = REPO_POR_DEFECTO, token = null, fetchFn = fetch }) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'erp-indexstore' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const todos = [];
  for (let pagina = 1; pagina <= 3; pagina++) {
    const r = await fetchFn(`https://api.github.com/repos/${repo}/commits?since=${encodeURIComponent(desdeIso)}&until=${encodeURIComponent(hastaIso)}&per_page=100&page=${pagina}`, { headers });
    if (!r.ok) throw new Error(`GitHub respondió HTTP ${r.status} al leer los commits`);
    const lote = await r.json();
    todos.push(...lote);
    if (lote.length < 100) break;
  }
  return normalizarCommits(todos, repo);
}

// Texto que se le entrega a la IA
export function armarEntradaIA(commits, yaRegistrados = []) {
  const lista = commits.map((c, i) => `${i + 1}. ${c.asunto}`).join('\n');
  const ya = yaRegistrados.length ? `\n\nYa registrados ese día (no los repitas):\n${yaRegistrados.map(r => `- [${r.area}] ${String(r.descripcion || '').slice(0, 200)}`).join('\n')}` : '';
  return `Commits del día:\n${lista}${ya}`;
}

// Respuesta de la IA -> filas listas para guardar. Valida, limpia, ordena y corta a MAX_PROPUESTAS.
export function normalizarPropuestas(arr, commits) {
  if (!Array.isArray(arr)) return [];
  const filas = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const descripcion = limpiarDescripcion(x.descripcion);
    const area = String(x.area || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!descripcion || !area) continue;
    const sitio = x.sitio === 'web' ? 'web' : 'erp';
    const rel = Math.max(1, Math.min(10, Math.round(Number(x.relevancia) || 5)));
    const idx = (Array.isArray(x.commits) ? x.commits : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= commits.length);
    filas.push({ area, sitio, descripcion, relevancia: rel, commits: [...new Set(idx.map(n => commits[n - 1].corto))] });
  }
  filas.sort((a, b) => b.relevancia - a.relevancia);
  return filas.slice(0, MAX_PROPUESTAS);
}

// Respaldo sin IA: un cambio por prefijo ("Cotizaciones web: ...") con el commit más reciente de cada grupo, los más movidos primero.
export function propuestasSinIA(commits) {
  const grupos = new Map();
  for (const c of commits) {
    const m = c.asunto.match(/^([^:]{3,60}):\s*(.+)$/);
    const area = m ? m[1].trim() : 'Cambios generales';
    const texto = m ? m[2] : c.asunto;
    if (!grupos.has(area)) grupos.set(area, []);
    grupos.get(area).push({ texto, corto: c.corto });
  }
  const filas = [...grupos.entries()].map(([area, lista]) => ({
    area, sitio: /^(web|tienda|home|colecciones?|pantallas|cargadores|chat|cotizador)/i.test(area) && !/erp/i.test(area) ? 'web' : 'erp',
    descripcion: limpiarDescripcion(lista[0].texto), relevancia: Math.min(10, 3 + lista.length), commits: lista.map(x => x.corto),
  })).filter(f => f.descripcion);
  filas.sort((a, b) => b.relevancia - a.relevancia);
  return filas.slice(0, MAX_PROPUESTAS);
}

// Extrae el arreglo JSON de la respuesta de la IA (tolera texto alrededor o bloque ```json)
export function extraerJson(texto) {
  const m = String(texto || '').match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

// Estado de entrega de un cambio propuesto/aprobado, para mostrarlo: dia = día (YYYY-MM-DD) en que ocurrió el cambio.
export function diaDeEnvio(fecha) {
  const d = new Date(String(fecha).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

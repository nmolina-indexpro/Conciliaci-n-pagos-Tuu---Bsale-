// /lib/modelos-metacampo.js
// Metacampo de Shopify "Descripción - modelos_compatibles": cada producto (batería, pantalla, cargador) lista los modelos de notebook a los que sirve.
// El motor de búsqueda del sitio lo lee; el ERP ("Buscar en Shopify" de Compatibilidad y el análisis de WhatsApp) solo miraba el título. Aquí está la parte
// pura (sin red) para poder probarla: normalizar el texto, reconocer el metacampo, decidir si un modelo está en la lista y elegir el mejor producto.

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mayúsculas, sin tildes y con todo lo que no sea letra o número convertido en espacio: "E1-422-5433" -> "E1 422 5433".
export const normalizarTokens = (s) => sinTildes(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// El valor del metacampo puede ser texto, HTML o texto enriquecido (JSON con { type: 'root', children: [...] }, o una lista JSON de textos).
export function textoPlanoMetacampo(valor) {
  const v = String(valor ?? '').trim();
  if (!v) return '';
  if (v[0] === '{' || v[0] === '[') {
    try {
      const partes = [];
      const recorrer = (n) => {
        if (n == null) return;
        if (typeof n === 'string') { partes.push(n); return; }
        if (Array.isArray(n)) { n.forEach(recorrer); return; }
        if (typeof n === 'object') { if (typeof n.value === 'string') partes.push(n.value); if (n.children) recorrer(n.children); }
      };
      recorrer(JSON.parse(v));
      return partes.join('\n');
    } catch { /* no era JSON: se trata como texto */ }
  }
  return v.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
}

// ¿Cuál de las definiciones de metacampos de producto es "modelos compatibles"? Se busca por la clave o por el nombre, sin importar tildes ni guiones.
export function encontrarDefinicion(definiciones) {
  const re = /MODELOS ?COMPATIBLES|COMPATIBLES MODELOS/;
  const lista = (definiciones || []).filter((d) => d && d.namespace && d.key);
  const hallada = lista.find((d) => re.test(normalizarTokens(d.key))) || lista.find((d) => re.test(normalizarTokens(d.name)));
  return hallada ? { namespace: hallada.namespace, key: hallada.key, nombre: hallada.name || null } : null;
}

const PALABRA_TIPO = { bateria: /\bBATERIAS?\b/, pantalla: /\bPANTALLAS?\b|\bDISPLAY\b/, cargador: /\bCARGADORES?\b|\bCARGADOR\b/ };
export function tipoDeProducto(titulo) {
  const t = normalizarTokens(titulo);
  return ['bateria', 'pantalla', 'cargador'].find((k) => PALABRA_TIPO[k].test(t)) || null;
}

// ¿El texto del metacampo menciona ese modelo? texto = textoPlanoMetacampo(...). Devuelve null, { nivel: 'exacto', confianza: 95 } o { nivel: 'familia', confianza: 70, omitido }.
//  exacto: la secuencia de palabras del modelo (sin la marca) aparece completa y con límites de palabra ("E1-422-5433" no se confunde con "XE1-422-54331").
//  familia: aparece el modelo sin sus últimas partes ("E1-422" cuando se buscó "E1-422-5433"); es un producto parecido, no una coincidencia.
export function coincidirModelo(texto, marca, modelo) {
  const base = ` ${normalizarTokens(texto)} `;
  const brand = normalizarTokens(marca);
  let toks = normalizarTokens(modelo).split(' ').filter(Boolean);
  if (brand) toks = toks.filter((t, i) => !(i === 0 && t === brand));
  if (!toks.length || !toks.some((x) => /\d/.test(x))) return null; // sin ningún número no es un modelo ("Aspire" aparecería en toda la lista)
  const aparece = (seq) => seq.length > 0 && base.includes(` ${seq.join(' ')} `);
  if (aparece(toks)) return { nivel: 'exacto', confianza: 95 };
  // solo el código (sin palabras como "Aspire"): "ASPIRE E1 422 5433" -> "E1 422 5433"
  const conNumeros = toks.filter((t) => /\d/.test(t));
  if (conNumeros.length && conNumeros.length < toks.length && aparece(conNumeros)) return { nivel: 'exacto', confianza: 90 };
  for (let n = toks.length - 1; n >= 1; n--) {
    const parcial = toks.slice(0, n);
    if (!parcial.some((t) => /\d/.test(t)) || parcial.join('').length < 4) break;
    if (aparece(parcial)) return { nivel: 'familia', confianza: 70, omitido: toks.slice(n).join(' ') };
  }
  const codigoParcial = conNumeros.slice(0, -1);
  if (codigoParcial.length && codigoParcial.join('').length >= 4 && aparece(codigoParcial)) return { nivel: 'familia', confianza: 70, omitido: conNumeros.slice(-1).join(' ') };
  return null;
}

// items: [{ titulo, url, sku, tipo, texto }]. Mejor producto del tipo pedido cuyo metacampo menciona el modelo; a igual confianza, el de lista más corta (más específico).
export function mejorProductoPorMetacampo(items, tipo, marca, modelo) {
  let mejor = null;
  for (const it of items || []) {
    if (!it || !it.texto || (tipo && it.tipo && it.tipo !== tipo)) continue;
    const c = coincidirModelo(it.texto, marca, modelo);
    if (!c) continue;
    if (!mejor || c.confianza > mejor.c.confianza || (c.confianza === mejor.c.confianza && String(it.texto).length < String(mejor.it.texto).length)) mejor = { it, c };
  }
  if (!mejor) return null;
  const { it, c } = mejor;
  return {
    titulo: it.titulo, url: it.url || null, sku: it.sku || null, confianza: c.confianza, origen: 'metacampo',
    ...(c.nivel === 'familia' ? { aviso: `El metacampo de modelos compatibles lista el modelo sin "${c.omitido}" (buscaste "${modelo}"): confirma que sirve para ese modelo exacto antes de aprobarlo.` } : {}),
  };
}

// ---- Búsqueda libre del Buscador con IA (Worker) sobre el mismo índice ----
// Palabras que describen el repuesto o la intención, no el modelo del notebook.
const PALABRAS_DE_CONSULTA = new Set(['CARGADOR', 'CARGADORES', 'BATERIA', 'BATERIAS', 'PANTALLA', 'PANTALLAS', 'NOTEBOOK', 'NOTEBOOKS', 'LAPTOP', 'PARA', 'DE', 'DEL', 'MI', 'EL', 'LA', 'UN', 'UNA', 'QUE', 'CON', 'Y', 'ORIGINAL', 'ALTERNATIVO', 'ALTERNATIVA', 'BUSCO', 'NECESITO', 'QUIERO', 'SIRVE', 'MODELO', 'COMPATIBLE', 'COMPATIBLES']);
export function tokensDeConsultaModelo(consulta) {
  return normalizarTokens(consulta).split(' ').filter((t) => t && !PALABRAS_DE_CONSULTA.has(t));
}
// Una palabra con números ("E1", "422", "3431") debe aparecer entera; una palabra solo de letras de 4 o más puede ser el comienzo ("ASPIR" -> "ASPIRE").
function palabraEnLinea(base, tok) {
  if (/\d/.test(tok) || tok.length < 4) return base.includes(` ${tok} `);
  return base.includes(` ${tok}`);
}
// items: [{ titulo, url, sku, tipo, texto }] (texto = un modelo por línea). Devuelve los productos cuya lista tiene UNA LÍNEA con todas las palabras de la consulta
// (nivel 'exacto'); si ninguno la tiene y la lista no trae la marca, se prueba solo con las palabras con números (nivel 'sin_marca', hay que confirmar).
// Sin ningún número en la consulta no se busca (una marca o una serie sola aparecería en toda la lista).
export function buscarModelosEnItems(items, consulta, { max = 10 } = {}) {
  const tokens = tokensDeConsultaModelo(consulta);
  const conNumeros = tokens.filter((t) => /\d/.test(t));
  if (!conNumeros.length) return [];
  if (tokens.length < 2 && !(/[A-Z]/.test(tokens[0] || '') && tokens[0].length >= 4)) return [];
  const pasada = (toks, nivel) => {
    const out = [];
    for (const it of items || []) {
      if (!it || (!it.texto && !it.desc)) continue;
      const partir = (t) => String(t || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const delMeta = partir(it.texto), deDesc = partir(it.desc);
      const calza = (l) => { const base = ` ${normalizarTokens(l)} `; return toks.every((t) => palabraEnLinea(base, t)); };
      const hitsMeta = delMeta.filter(calza), hitsDesc = deDesc.filter(calza);
      if (!hitsMeta.length && !hitsDesc.length) continue;
      const hits = hitsMeta.length ? hitsMeta : hitsDesc; // si está en el metacampo, ese es el dato; la descripción solo si no hay otro
      out.push({ titulo: it.titulo, url: it.url || null, sku: it.sku || null, tipo: it.tipo || null, nivel, fuente: hitsMeta.length ? 'metacampo' : 'descripcion', fragmentos: hits.slice(0, 3).map((h) => h.slice(0, 120)), lineas: delMeta.length + deDesc.length });
    }
    return out;
  };
  let res = pasada(tokens, 'exacto');
  if (!res.length && conNumeros.length < tokens.length && (conNumeros.length >= 2 || conNumeros.join('').length >= 4)) res = pasada(conNumeros, 'sin_marca');
  // Lista más corta = producto más específico.
  res.sort((a, b) => a.lineas - b.lineas);
  return res.slice(0, max);
}

// ---- Modelos listados en la DESCRIPCIÓN del producto (no en el metacampo) ----
// Solo unas pocas fichas (sobre todo los cargadores "madre") enumeran modelos en su descripción. Para no cargar la descripción completa de 5.500 productos al índice,
// se guardan SOLO las líneas que parecen un modelo de notebook (marca o serie + código con números), y solo si hay al menos dos.
const MARCA_O_SERIE = /\b(acer|asus|hp|lenovo|dell|samsung|toshiba|sony|msi|apple|huawei|gigabyte|compaq|lg|xiaomi|macbook|thinkpad|ideapad|aspire|pavilion|inspiron|latitude|vivobook|zenbook|probook|elitebook|satellite|yoga|legion|nitro|predator|travelmate|swift|spin)\b/i;
const CODIGO_MODELO = /\b[A-Za-z]{1,4}\d{1,4}[A-Za-z0-9-]*\b/;
const LINEA_DE_FICHA_TECNICA = /garant|resoluci|conector|tama[ñn]o|fabric|soporte|formato|condici|superficie|pines|calidad|cert|voltaje|amperaje|potencia|plug|punta|entrada|salida/i;
export function lineasModelosDescripcion(html) {
  const plano = String(html ?? '')
    .replace(/<li[^>]*>/gi, '\n').replace(/<\/(p|div|h\d|tr|ul|ol|td)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/[ \t]+/g, ' ');
  const lineas = plano.split('\n').map((l) => l.trim()).filter((l) => l.length >= 6 && l.length <= 120 && MARCA_O_SERIE.test(l) && CODIGO_MODELO.test(l) && !LINEA_DE_FICHA_TECNICA.test(l));
  return lineas.length >= 2 ? [...new Set(lineas)] : [];
}

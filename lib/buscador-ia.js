// /lib/buscador-ia.js
// Lógica pura (sin base de datos ni red) del registro de búsquedas del
// Buscador con IA del home de indexstore.cl. El Worker de Cloudflare manda
// cada búsqueda a ?recurso=buscador-ia-registrar y acá se valida, se tachan
// datos personales y se deja lista la fila. Aislado en su propio archivo para
// poder probarlo con node sin POSTGRES_URL.

import { createHash, timingSafeEqual } from 'node:crypto';

export const MAX_CONSULTA = 200;
const MAX_RESPUESTA = 400;
const MAX_ERROR = 300;
const MAX_PRODUCTOS = 4;

// Los clientes a veces escriben su nombre, teléfono o correo en la caja.
// No se guarda nada de eso: se tacha ANTES de persistir (el Worker ya lo hace
// también; acá se repite por si el Worker cambia o alguien llama el
// endpoint directo).
export function tacharDatosPersonales(texto) {
  return String(texto ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]')
    .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[rut]')
    .replace(/(\+?\d[\d\s().-]{6,}\d)/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[teléfono]' : m))
    .replace(/\s+/g, ' ')
    .trim();
}

// Clave para agrupar "Cargador Acer" con "cargador  acer " o "Cargador ÁCER".
export function normalizarConsulta(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Compara en tiempo constante (hash de ambos lados para igualar el largo).
export function claveValida(recibida, esperada) {
  if (!esperada || typeof recibida !== 'string' || !recibida) return false;
  const a = createHash('sha256').update(recibida).digest();
  const b = createHash('sha256').update(esperada).digest();
  return timingSafeEqual(a, b);
}

function entero(v, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null;
}

// Devuelve { ok: true, fila } o { ok: false, error }.
export function validarRegistro(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo inválido' };

  const consulta = tacharDatosPersonales(body.consulta).slice(0, MAX_CONSULTA);
  if (consulta.length < 3) return { ok: false, error: 'Consulta muy corta' };

  const productos = (Array.isArray(body.productos) ? body.productos : [])
    .slice(0, MAX_PRODUCTOS)
    .map((p) => ({
      handle: String(p?.handle ?? '').slice(0, 200),
      title: String(p?.title ?? '').slice(0, 200),
      price: entero(p?.price, 100000000),
    }))
    .filter((p) => p.handle);

  const error = body.error ? String(body.error).slice(0, MAX_ERROR) : null;

  return {
    ok: true,
    fila: {
      consulta,
      consulta_norm: normalizarConsulta(consulta),
      respuesta: body.respuesta ? tacharDatosPersonales(body.respuesta).slice(0, MAX_RESPUESTA) : null,
      productos,
      n_productos: productos.length,
      sin_resultado: productos.length === 0 && !error,
      error,
      ms: entero(body.ms, 600000),
      desde_cache: body.desde_cache === true,
      sid: idBusqueda(body.sid),
      tipo: body.tipo === 'foto' ? 'foto' : 'texto',
      ...datosVisitante(body.visitante),
    },
  };
}

// ---------------------------------------------------------------------------
// ¿Persona o bot? El Worker manda una huella del visitante (hash irreversible que
// cambia cada día; la IP NUNCA llega ni se guarda), el país, el proveedor de
// internet (ASN) y el User-Agent. El User-Agent se usa para clasificar y se
// descarta: solo queda su tipo y un resumen corto ("Chrome · Windows").
// ---------------------------------------------------------------------------
export const UMBRAL_RAFAGA = 8; // búsquedas de un mismo visitante en 5 minutos que ya no parecen de una persona

// Proveedores de hosting/nube: una búsqueda que sale de ahí casi nunca es un cliente en su casa o su celular.
const CENTRO_DATOS = /\b(amazon|aws|google (llc|cloud)|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|vultr|oracle|contabo|choopa|leaseweb|m247|datacamp|scaleway|alibaba|tencent|cloudflare|ionos|hostinger|godaddy|rackspace|packet|quadranet|colocrossing|psychz|zenlayer|ucloud|huawei cloud|stackpath|fastly|hosting|datacenter|data center|server|cloud)\b/i;
export function esCentroDeDatos(asnOrg) {
  return CENTRO_DATOS.test(String(asnOrg ?? ''));
}

// tipo: 'navegador' (navegador de verdad), 'bot' (se declara bot/rastreador), 'herramienta' (curl, scripts, librerías HTTP,
// navegadores sin pantalla), 'vacio' (sin User-Agent) u 'otro'.
export function clasificarUserAgent(ua) {
  const t = String(ua ?? '').trim();
  if (!t) return { tipo: 'vacio', resumen: 'sin navegador' };
  if (/headless|phantomjs|selenium|puppeteer|playwright|webdriver/i.test(t)) return { tipo: 'herramienta', resumen: 'navegador automatizado' };
  if (/\b(curl|wget|python-requests|python-urllib|httpx|aiohttp|node-fetch|undici|axios|got|postman|insomnia|go-http-client|java\/|libwww|okhttp\/[\d.]+$|powershell|scrapy|httpclient|apache-http)/i.test(t)) {
    return { tipo: 'herramienta', resumen: (t.match(/^[A-Za-z][\w.-]*/) || ['herramienta'])[0].slice(0, 30) };
  }
  if (/bot|crawler|spider|slurp|facebookexternalhit|preview|monitor|uptime|lighthouse|pingdom|gtmetrix/i.test(t)) return { tipo: 'bot', resumen: 'bot o rastreador' };
  const navegador = /edg\//i.test(t) ? 'Edge' : /opr\/|opera/i.test(t) ? 'Opera' : /firefox\//i.test(t) ? 'Firefox' : /chrome\/|crios\//i.test(t) ? 'Chrome' : /safari\//i.test(t) ? 'Safari' : null;
  if (navegador && /^mozilla\//i.test(t)) {
    const so = /android/i.test(t) ? 'Android' : /iphone|ipad|ios/i.test(t) ? 'iOS' : /windows/i.test(t) ? 'Windows' : /mac os|macintosh/i.test(t) ? 'Mac' : /linux|x11|cros/i.test(t) ? 'Linux' : null;
    return { tipo: 'navegador', resumen: so ? `${navegador} · ${so}` : navegador };
  }
  return { tipo: 'otro', resumen: t.slice(0, 30) };
}

// Datos del visitante listos para guardar (todos opcionales: las filas antiguas no los tienen).
export function datosVisitante(v) {
  const vacio = { vid: null, pais: null, asn: null, asn_org: null, ua_tipo: null, ua_resumen: null, centro_datos: null };
  if (!v || typeof v !== 'object') return vacio;
  const ua = clasificarUserAgent(v.ua);
  const asnOrg = v.asn_org ? String(v.asn_org).replace(/\s+/g, ' ').trim().slice(0, 100) : null;
  const asn = Number.isInteger(Number(v.asn)) && Number(v.asn) > 0 && Number(v.asn) < 4294967296 ? Number(v.asn) : null;
  return {
    vid: /^[0-9a-f]{16}$/i.test(String(v.vid ?? '')) ? String(v.vid).toLowerCase() : null,
    pais: /^[A-Za-z]{2}$/.test(String(v.pais ?? '')) ? String(v.pais).toUpperCase() : null,
    asn, asn_org: asnOrg,
    ua_tipo: ua.tipo, ua_resumen: ua.resumen,
    centro_datos: asnOrg ? esCentroDeDatos(asnOrg) : null,
  };
}

// Veredicto por visitante. Orden: bot declarado > automatizado (hosting o ráfaga) > persona probable.
// "sin_datos" = búsquedas anteriores a que se guardara el origen. Nunca es una certeza: es lo más probable.
export const ORIGEN_ETIQUETA = { persona: 'Persona probable', bot: 'Bot', automatizado: 'Automatizado', sin_datos: 'Sin datos' };
export function clasificarVisitante({ vid, ua_tipo, centro_datos, rafaga_max }) {
  if (!vid) return { origen: 'sin_datos', motivos: ['Búsqueda anterior al registro del origen'] };
  const motivos = [];
  if (['bot', 'herramienta', 'vacio'].includes(ua_tipo)) {
    motivos.push(ua_tipo === 'vacio' ? 'No envía navegador' : ua_tipo === 'herramienta' ? 'Usa una herramienta o script, no un navegador' : 'Se declara bot o rastreador');
    return { origen: 'bot', motivos };
  }
  if (centro_datos === true) motivos.push('Sale de un centro de datos (hosting o nube)');
  if (Number(rafaga_max) >= UMBRAL_RAFAGA) motivos.push(`${rafaga_max} búsquedas en 5 minutos`);
  if (motivos.length) return { origen: 'automatizado', motivos };
  return { origen: 'persona', motivos: ['Navegador real, red residencial o móvil y ritmo normal'] };
}

// Identificador de una búsqueda (lo genera el Worker): une la búsqueda con los
// clics que el cliente hace después. Solo se aceptan UUID.
export function idBusqueda(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? '')) ? String(v).toLowerCase() : null;
}

export const TIPOS_EVENTO = ['tarjeta', 'whatsapp', 'ejemplo', 'pregunta'];

// Un clic del cliente sobre el resultado de una búsqueda: tocó una tarjeta de
// producto, el botón de WhatsApp, un ejemplo o una pregunta guiada.
// Devuelve { ok: true, fila } o { ok: false, error }.
export function validarEvento(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo inválido' };
  const sid = idBusqueda(body.sid);
  if (!sid) return { ok: false, error: 'Identificador de búsqueda inválido' };
  if (!TIPOS_EVENTO.includes(body.tipo)) return { ok: false, error: 'Tipo de evento inválido' };
  const handle = body.handle ? String(body.handle).slice(0, 200) : null;
  return { ok: true, fila: { sid, tipo: body.tipo, handle } };
}

// /lib/indexscale-sitio.js
// Revisión automática del sitio web de un cliente para IndexScale: ¿existe, carga, tiene algo, es básico, ya vende online?
// El objetivo comercial es llegar PRIMERO a quienes no tienen un sitio utilizable (sin dominio, dominio que no existe o no carga, dominio sin página,
// sitio muy básico) y dejar para el final a quienes ya tienen un sitio con contenido o una tienda.
// Sin navegador: se lee el HTML que devuelve el servidor. Un sitio armado 100% con JavaScript puede verse "vacío" aquí; por eso el vendedor
// siempre ve el link para abrir el sitio y puede marcar "Ya tiene página optimizada".

export const ESTADOS_SITIO = ['sin_dominio', 'no_carga', 'estacionado', 'basico', 'con_sitio', 'tienda'];

const quitarTildes = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const SENALES_ESTACIONADO = [
  'domain is for sale', 'dominio en venta', 'this domain', 'este dominio', 'buy this domain', 'parked', 'hugedomains', 'godaddy',
  'welcome to nginx', 'apache2 ubuntu default', 'apache2 debian default', 'it works', 'index of /', 'default web site page', 'test page for',
  'en construccion', 'under construction', 'coming soon', 'proximamente', 'cpanel', 'plesk', 'default parallels', 'account suspended', 'cuenta suspendida',
  'site not found', 'sitio no encontrado', 'domain registered', 'dominio registrado', 'future home of', 'sitio en desarrollo',
];
const SENALES_TIENDA = [
  'cdn.shopify.com', 'myshopify.com', 'woocommerce', 'wc-add-to-cart', 'add_to_cart', 'add-to-cart', 'agregar al carrito', 'anadir al carrito',
  'carrito de compras', 'prestashop', 'magento', 'vtex', 'jumpseller', 'tiendanube', 'nuvemshop', 'webpay', 'transbank', 'mercadopago',
];
const CONSTRUCTORES_GRATIS = ['wixsite.com', 'wix.com', 'weebly.com', 'jimdo', 'blogspot.', 'wordpress.com', 'godaddysites.com', 'sites.google.com', 'webnode', 'strikingly'];

export function textoVisible(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// html (string) -> { estado, senales }  (solo cuando el sitio respondió con una página)
export function analizarHtmlSitio(html, { url = '' } = {}) {
  const crudo = String(html || '');
  const bajo = quitarTildes(crudo);
  const texto = textoVisible(crudo);
  const textoBajo = quitarTildes(texto);
  const len = texto.length;
  const imgs = (bajo.match(/<img[\s>]/g) || []).length;
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(crudo);
  const tituloOk = /<title[^>]*>[^<]{3,}<\/title>/i.test(crudo);
  const https = /^https:/i.test(url) || url === '';
  const constructor = CONSTRUCTORES_GRATIS.some((c) => bajo.includes(c)) || CONSTRUCTORES_GRATIS.some((c) => String(url).toLowerCase().includes(c));
  const esAppJs = /id=["'](root|app|__next)["']|__next_data__|ng-version|data-reactroot|nuxt/i.test(crudo);
  const senales = { texto: len, imgs, viewport, tituloOk, https, constructor, appJs: esAppJs };

  // Una tienda online no se confunde con un sitio básico aunque tenga poco texto.
  if (SENALES_TIENDA.some((s) => bajo.includes(s))) return { estado: 'tienda', senales };
  // Dominio sin página real: página por defecto del hosting, "en construcción", dominio en venta, o casi sin texto.
  if (len < 1500 && SENALES_ESTACIONADO.some((s) => textoBajo.includes(s) || (s.includes('/') && bajo.includes(s)))) return { estado: 'estacionado', senales };
  if (len < 120 && !esAppJs) return { estado: 'estacionado', senales };
  if (esAppJs && len < 300) return { estado: 'con_sitio', senales: { ...senales, nota: 'sitio armado con JavaScript: no se puede evaluar sin navegador' } };
  const debiles = (viewport ? 0 : 1) + (imgs < 3 ? 1 : 0) + (len < 900 ? 1 : 0) + (constructor ? 1 : 0) + (https ? 0 : 1) + (tituloOk ? 0 : 1);
  if (len < 600 || debiles >= 3) return { estado: 'basico', senales: { ...senales, debiles } };
  return { estado: 'con_sitio', senales: { ...senales, debiles } };
}

// obtener(url) -> { ok, status, text, url } o lanza un error (con cause.code / code: ENOTFOUND, ECONNREFUSED, timeout...).
export async function revisarSitio(dominio, obtener) {
  const errores = [];
  let respuestaHttp = null; // última respuesta con status no exitoso
  for (const esquema of ['https://', 'http://']) {
    try {
      const r = await obtener(esquema + dominio);
      if (r.ok) return analizarHtmlSitio(r.text, { url: r.url || esquema + dominio });
      respuestaHttp = r;
      errores.push('http_' + r.status);
    } catch (err) {
      const codigo = (err && ((err.cause && err.cause.code) || err.code)) || (err && err.name) || 'error';
      errores.push(String(codigo));
    }
  }
  // 401/403/429: el servidor existe pero no deja leer el sitio a un programa (protección anti-bots): se asume que hay sitio.
  if (respuestaHttp && [401, 403, 429].includes(respuestaHttp.status)) return { estado: 'con_sitio', senales: { bloqueado: true, errores } };
  const dns = (c) => /ENOTFOUND|EAI_AGAIN|ENODATA|NXDOMAIN/i.test(c);
  if (errores.length && errores.every(dns)) return { estado: 'sin_dominio', senales: { errores } };
  return { estado: 'no_carga', senales: { errores } };
}

export const TEXTO_ESTADO_SITIO = {
  sin_dominio: 'el dominio de su correo no existe',
  no_carga: 'su sitio no carga',
  estacionado: 'su dominio no tiene página (estacionado o en construcción)',
  basico: 'su sitio es muy básico',
  con_sitio: 'ya tiene un sitio con contenido',
  tienda: 'ya vende online',
};

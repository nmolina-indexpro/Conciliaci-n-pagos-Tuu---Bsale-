// /lib/whatsapp-desperdicio-ads.js
// ═════════════════════════════════════════════════════════════════════
// "Clics que cuestan": cruza TODAS las conversaciones de WhatsApp (y lo que la IA concluyó de cada una) con su origen para ver cuánta atención se pierde
// en gente que no es un comprador de lo que vendemos, y qué palabras la traen. Alimenta el bloque 6 de la página Análisis > Google Ads.
// Funciones puras (sin base de datos): reciben conversaciones y mensajes ya leídos.
//
// Clases (excluyentes, en este orden de prioridad):
//   ganada          venta o cotización: gente que sí compra lo que vendemos
//   no_trabajamos   pide un producto o marca que no vendemos                    ┐
//   incompatible    pedía algo que no calzaba con lo que tenemos               ├ "desperdicio": tiempo del equipo sin posibilidad de venta
//   otro_servicio   no era una compra nueva (servicio técnico, garantía, postventa, estado de pedido) ┘
//   comercial       se perdió por algo comercial (precio, stock, competencia, respuesta lenta, sin seguimiento): se arregla operando, no con Google
//   sin_respuesta   el cliente dejó de responder o no estaba interesado
//   en_curso        seguimiento o consulta resuelta
//   sin_analizar    la IA todavía no la clasificó
// Todo es heurístico y se rotula así: la IA clasifica la conversación; aquí solo se cuenta.
// ═════════════════════════════════════════════════════════════════════
import { tokenizar, esTokenUtil, esPalabraPropia, topCombinaciones } from './whatsapp-motivos.js';

export const CLASES = {
  ganada: 'Venta o cotización',
  no_trabajamos: 'Pide algo que no vendemos',
  incompatible: 'Producto incompatible',
  otro_servicio: 'No era una compra (servicio técnico, garantía, postventa, pedido)',
  comercial: 'Pérdida comercial (precio, stock, competencia, respuesta)',
  sin_respuesta: 'Dejó de responder / no interesado',
  en_curso: 'En seguimiento o consulta resuelta',
  sin_analizar: 'Sin analizar por la IA',
};
export const CLASES_DESPERDICIO = ['no_trabajamos', 'incompatible', 'otro_servicio'];
export const ORIGENES = { google_ads: 'Google Ads (clic vinculado)', google_utm: 'Link de Google con UTM', boton_sitio: 'Botón de WhatsApp del sitio (sin campaña)', meta: 'Meta (anuncio o publicación)', directo: 'Directo o sin origen' };
export const MINUTOS_POR_DEFECTO = 3; // lo que cuesta atender una consulta que no va a ninguna parte (dato del usuario: "2-3 minutos")
export const MIN_CONV_NEGATIVA = 2;   // una palabra se sugiere como negativa desde la segunda conversación de desperdicio
export const MAX_MENSAJES_CLIENTE = 3; // se lee el comienzo de la conversación: ahí está lo que el cliente buscaba

const pct = (n, t) => (t > 0 ? Math.round((n / t) * 1000) / 10 : 0);
const mediana = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function clasificarConversacion(c) {
  if (c.venta_detectada || c.bsale_doc || c.resultado === 'venta' || c.resultado === 'cotizacion') return 'ganada';
  const motivo = c.motivo_perdida || null, res = c.resultado || null;
  if (!res && !motivo) return 'sin_analizar';
  if (motivo === 'producto_no_disponible') return 'no_trabajamos';
  if (motivo === 'producto_incompatible') return 'incompatible';
  if (['servicio_tecnico', 'garantia', 'postventa'].includes(c.intencion) || ['servicio_tecnico', 'garantia', 'estado_pedido', 'postventa'].includes(c.categoria)) return 'otro_servicio';
  if (['precio', 'sin_stock', 'compro_en_otro_lugar', 'respuesta_lenta', 'sin_seguimiento'].includes(motivo) || res === 'sin_stock') return 'comercial';
  if (motivo === 'cliente_no_responde' || res === 'cliente_no_responde' || res === 'no_interesado') return 'sin_respuesta';
  return 'en_curso';
}

// ads_origen: { campana, tipo, grupo, palabra, red } del toque vinculado (ver sqlOrigenGoogleAds) o null.
export function origenDe(c) {
  if (c.ads_origen) return { origen: 'google_ads', campana: c.ads_origen.campana || '(sin campaña)', palabra: c.ads_origen.palabra || '', grupo: c.ads_origen.grupo || '', red: c.ads_origen.red || '' };
  if (c.fuente_tipo === 'utm') return { origen: /google/i.test(c.fuente_utm_source || '') ? 'google_utm' : 'directo', campana: c.fuente_utm_campaign || '', palabra: '', grupo: '', red: '' };
  if (c.fuente_tipo === 'boton_sitio') return { origen: 'boton_sitio', campana: '', palabra: '', grupo: '', red: '' };
  if (c.fuente_tipo === 'ad' || c.fuente_tipo === 'post') return { origen: 'meta', campana: c.fuente_titulo || '', palabra: '', grupo: '', red: '' };
  return { origen: 'directo', campana: '', palabra: '', grupo: '', red: '' };
}

const vacio = () => ({ n: 0, ganada: 0, no_trabajamos: 0, incompatible: 0, otro_servicio: 0, comercial: 0, sin_respuesta: 0, en_curso: 0, sin_analizar: 0 });
function sumar(e, clase) { e.n++; e[clase]++; }
function cerrar(e, minutos) {
  const desperdicio = CLASES_DESPERDICIO.reduce((s, k) => s + e[k], 0);
  return { ...e, desperdicio, pct_desperdicio: pct(desperdicio, e.n), pct_ganada: pct(e.ganada, e.n), minutos_perdidos: desperdicio * minutos };
}

// conversaciones: filas de whatsapp_conversaciones (+ ads_origen, bsale_doc, duracion_seg). mensajesPorConv: Map(id -> [{ dir, texto }]).
export function armarAnalisis({ conversaciones, mensajesPorConv, minutosPorConversacion = MINUTOS_POR_DEFECTO, tope = { campanas: 30, palabras: 40, candidatas: 60 } }) {
  const total = vacio();
  const porOrigen = new Map(), porCampana = new Map(), porPalabra = new Map();
  const duracionesDesperdicio = [];
  const clasePorConv = new Map();
  for (const c of conversaciones) {
    const clase = clasificarConversacion(c);
    clasePorConv.set(c.id, clase);
    sumar(total, clase);
    const o = origenDe(c);
    if (!porOrigen.has(o.origen)) porOrigen.set(o.origen, vacio());
    sumar(porOrigen.get(o.origen), clase);
    if (o.origen === 'google_ads') {
      if (!porCampana.has(o.campana)) porCampana.set(o.campana, vacio());
      sumar(porCampana.get(o.campana), clase);
      const kp = o.campana + '||' + (o.palabra || '(sin palabra clave)');
      if (!porPalabra.has(kp)) porPalabra.set(kp, { ...vacio(), campana: o.campana, palabra: o.palabra || '(sin palabra clave)', grupo: o.grupo });
      sumar(porPalabra.get(kp), clase);
    }
    if (CLASES_DESPERDICIO.includes(clase) && c.duracion_seg != null && c.duracion_seg > 0) duracionesDesperdicio.push(c.duracion_seg / 60);
  }
  const cT = cerrar(total, minutosPorConversacion);
  const analizadas = total.n - total.sin_analizar;

  const origenes = [...porOrigen.entries()].map(([k, e]) => ({ origen: k, nombre: ORIGENES[k], ...cerrar(e, minutosPorConversacion) })).sort((a, b) => b.n - a.n);
  const campanas = [...porCampana.entries()].map(([k, e]) => ({ campana: k, ...cerrar(e, minutosPorConversacion) })).sort((a, b) => b.desperdicio - a.desperdicio || b.n - a.n).slice(0, tope.campanas);
  const palabras = [...porPalabra.values()].map((e) => {
    const x = cerrar(e, minutosPorConversacion);
    return { ...x, revisar: x.n >= 3 && x.ganada === 0 && x.pct_desperdicio >= 50 };
  }).sort((a, b) => Number(b.revisar) - Number(a.revisar) || b.desperdicio - a.desperdicio || b.n - a.n).slice(0, tope.palabras);

  // ---- Palabras candidatas a negativas: lo que pedían quienes no iban a comprar, que nunca aparece en quienes sí compraron o se perdieron por algo comercial
  const MARCAS_PEDIDAS = new Set();
  for (const c of conversaciones) if (clasePorConv.get(c.id) === 'no_trabajamos' && c.marca) tokenizar(c.marca).filter(esTokenUtil).forEach((t) => MARCAS_PEDIDAS.add(t));
  const terminos = new Map(); // término -> { malas:Set, buenas:Set, ejemplo, origenes:Map, campanas:Map }
  const registrar = (conv, clase, texto) => {
    const tokens = tokenizar(texto).map((t) => (esTokenUtil(t) ? t : null));
    const vistos = new Set();
    const anotar = (termino) => {
      if (vistos.has(termino)) return; vistos.add(termino);
      let e = terminos.get(termino);
      if (!e) { e = { termino, malas: new Set(), buenas: new Set(), ejemplo: String(texto).slice(0, 140), origenes: new Map(), campanas: new Map() }; terminos.set(termino, e); }
      if (CLASES_DESPERDICIO.includes(clase)) {
        if (!e.malas.has(conv.id)) {
          e.malas.add(conv.id);
          const o = origenDe(conv);
          e.origenes.set(o.origen, (e.origenes.get(o.origen) || 0) + 1);
          if (o.origen === 'google_ads' && o.campana) e.campanas.set(o.campana, (e.campanas.get(o.campana) || 0) + 1);
        }
      } else if (clase === 'ganada' || clase === 'comercial') e.buenas.add(conv.id);
    };
    tokens.forEach((t, i) => { if (t) { anotar(t); if (tokens[i + 1]) anotar(t + ' ' + tokens[i + 1]); } });
  };
  for (const c of conversaciones) {
    const clase = clasePorConv.get(c.id);
    if (clase === 'sin_analizar') continue;
    const msgs = (mensajesPorConv.get(c.id) || []).filter((m) => m.dir === 'in' && m.texto).slice(0, MAX_MENSAJES_CLIENTE);
    for (const m of msgs) registrar(c, clase, m.texto);
  }
  const candidatas = [...terminos.values()]
    .filter((e) => e.malas.size >= MIN_CONV_NEGATIVA && e.buenas.size === 0 && !e.termino.split(' ').some((w) => esPalabraPropia(w)))
    .map((e) => {
      const frase = e.termino.includes(' ');
      return {
        termino: e.termino, tipo: frase ? 'frase' : (MARCAS_PEDIDAS.has(e.termino) ? 'marca' : 'palabra'),
        conversaciones: e.malas.size, ejemplo: e.ejemplo,
        google_ads: e.origenes.get('google_ads') || 0, boton_sitio: e.origenes.get('boton_sitio') || 0,
        campanas: [...e.campanas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nombre, n]) => ({ nombre, n })),
        // formato para pegar en Google Ads: frase entre comillas, el resto como negativa amplia
        formato_google: frase ? `"${e.termino}"` : e.termino,
        concordancia: frase ? 'frase' : 'amplia',
      };
    })
    .sort((a, b) => b.conversaciones - a.conversaciones || (a.tipo === 'frase' ? 1 : 0) - (b.tipo === 'frase' ? 1 : 0) || a.termino.localeCompare(b.termino));
  // una frase que ya contiene una palabra candidata con el mismo conteo no aporta: se deja la palabra
  const palabrasCand = new Map(candidatas.filter((c) => c.tipo !== 'frase').map((c) => [c.termino, c.conversaciones]));
  const filtradas = candidatas.filter((c) => c.tipo !== 'frase' || !c.termino.split(' ').some((w) => palabrasCand.get(w) === c.conversaciones)).slice(0, tope.candidatas);

  const desperdicioConvs = conversaciones.filter((c) => CLASES_DESPERDICIO.includes(clasePorConv.get(c.id)));
  const pedidos = topCombinaciones(desperdicioConvs.filter((c) => clasePorConv.get(c.id) === 'no_trabajamos').map((c) => ({ marca: c.marca, producto: c.producto, modelo: c.modelo, iniciada_en: c.iniciada_en })), 12);

  return {
    minutos_por_conversacion: minutosPorConversacion,
    resumen: {
      ...cT, analizadas, pct_analizadas: pct(analizadas, total.n),
      mediana_minutos_reales: duracionesDesperdicio.length ? Math.round(mediana(duracionesDesperdicio) * 10) / 10 : null,
      google_vinculadas: porOrigen.get('google_ads') ? porOrigen.get('google_ads').n : 0,
    },
    clases: Object.entries(CLASES).map(([k, nombre]) => ({ clase: k, nombre, n: total[k], pct: pct(total[k], total.n), desperdicio: CLASES_DESPERDICIO.includes(k) })),
    origenes, campanas, palabras, candidatas: filtradas, pedidos,
  };
}

// /lib/whatsapp-motivos.js
// Análisis detallado de UN motivo de pérdida de WhatsApp (panel lateral de "Motivos de pérdida"). Funciones puras: reciben
// las conversaciones perdidas por ese motivo y sus mensajes, y devuelven estadísticas y recomendaciones listas para dibujar.
//
// Qué mide:
//   - Común a todos: qué se repite (producto, marca, modelo, categoría, problema del cliente), palabras y frases más
//     usadas por los clientes, cuándo dejó de responder el cliente (día, hora, tras qué mensaje nuestro) y de dónde venían.
//   - Específico por motivo: producto/marca que no vendemos -> palabras negativas para Google Ads; compró en la competencia
//     -> dominios y competidores mencionados; respuesta lenta -> indicadores de tiempo de respuesta; precio -> señales de
//     precio y clientes para recontactar con cupón.
//
// Todo es heurístico y se rotula como tal: la IA clasifica el motivo, estas reglas solo cuentan lo que dicen los mensajes.

import { mejorNivelOferta, esConversion, esOfertaCompleta } from './whatsapp-oferta.js';

export const MOTIVOS_ANALIZABLES = ['producto_no_disponible', 'compro_en_otro_lugar', 'respuesta_lenta', 'precio', 'sin_stock', 'cliente_no_responde', 'sin_seguimiento', 'producto_incompatible'];

const ZONA = 'America/Santiago';
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
// Horario de atención asumido para "fuera de horario" (se muestra en pantalla como supuesto, no como dato).
export const HORARIO_ASUMIDO = { semana: [9, 19], sabado: [10, 14] };

const sinTildes = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizar = t => sinTildes(t).toLowerCase();
const fechaDe = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d : null; };
const redondear = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (n, total) => (total > 0 ? redondear((n / total) * 100) : 0);
function mediana(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentil(a, p) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// Día de la semana (0 = lunes) y hora en Chile.
const formateadorChile = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, weekday: 'short', hour: '2-digit', hour12: false });
const MAPA_DIA = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
export function diaYHoraChile(d) {
  const partes = Object.fromEntries(formateadorChile.formatToParts(d).map(p => [p.type, p.value]));
  return { dia: MAPA_DIA[partes.weekday], hora: Number(partes.hour) % 24 };
}
export function dentroDeHorario(d) {
  const { dia, hora } = diaYHoraChile(d);
  if (dia <= 4) return hora >= HORARIO_ASUMIDO.semana[0] && hora < HORARIO_ASUMIDO.semana[1];
  if (dia === 5) return hora >= HORARIO_ASUMIDO.sabado[0] && hora < HORARIO_ASUMIDO.sabado[1];
  return false;
}

// ---------------- Texto: palabras y frases ----------------
const STOPWORDS = new Set(`a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bien buen buena buenas bueno buenos cada casi como con contra cual cuales cuando cuanto de del desde donde dos el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estaba estan estar estas este esto estos esta estoy fue fueron gracias ha hace hacen hasta hay hola igual la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque pues que quien quienes se sea segun ser si sin sobre solo son soy su sus tal tambien tan tanto te tengo tiene tienen todo todos tu tus un una unas uno unos usted ustedes va van ver vez voy ya yo
buenos dias tardes noches saludos favor porfavor disculpa disculpe quisiera quiero necesito necesitaba buscaba busco consulta consultar cotizar cotizacion cotiza informacion info ayuda hacer tener tienes tienen disponible disponibles stock venta ventas valor precio precios cuanto cuesta sale saber puedo pueden podria podrian podrias favor amigo amiga estimado estimados vendedor atencion hora horas dia dias semana mensaje whatsapp wsp wasap xq pq q k d x
ok vale listo dale perfecto claro entonces ahora hoy ayer manana despues luego aca alla esta ahi tal vez`.split(/\s+/).filter(Boolean));
// Lo que IndexStore SÍ vende: nunca se sugiere como palabra negativa (dejaría fuera búsquedas buenas).
const PALABRAS_PROPIAS = new Set(`cargador cargadores bateria baterias pantalla pantallas notebook notebooks laptop laptops portatil computador computadora pc repuesto repuestos original originales compatible compatibles tecnico servicio reparacion cambio instalacion teclado ventilador disco ssd ram memoria bisagra bisagras carcasa tapa flex cable`.split(/\s+/).filter(Boolean));

export function tokenizar(texto) {
  const limpio = normalizar(texto).replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9ñ\s.\-_/]/g, ' ');
  return limpio.split(/\s+/).map(t => t.replace(/^[.\-_/]+|[.\-_/]+$/g, '')).filter(Boolean);
}
function esTokenUtil(t) {
  if (STOPWORDS.has(t)) return false;
  if (/^\d+$/.test(t)) return false;           // números sueltos (cantidades, precios)
  if (t.length < 3) return false;
  if (/^\d/.test(t) && !/[a-z]/.test(t)) return false;
  return true;
}
// Palabras (1) y frases de 2 palabras por conversación, contadas UNA vez por conversación (no por mensaje).
export function extraerTerminos(mensajesPorConv, { minConversaciones = 2, tope = 30 } = {}) {
  const uni = new Map(), bi = new Map();
  const sumar = (mapa, clave, conv, ejemplo) => {
    let e = mapa.get(clave); if (!e) { e = { termino: clave, convs: new Set(), ejemplo }; mapa.set(clave, e); }
    e.convs.add(conv);
  };
  for (const [convId, msgs] of mensajesPorConv) {
    for (const m of msgs) {
      if (m.dir !== 'in' || !m.texto) continue;
      const tokens = tokenizar(m.texto);
      const utiles = tokens.map(t => (esTokenUtil(t) ? t : null));
      utiles.forEach(t => { if (t) sumar(uni, t, convId, m.texto); });
      for (let i = 0; i < utiles.length - 1; i++) if (utiles[i] && utiles[i + 1]) sumar(bi, `${utiles[i]} ${utiles[i + 1]}`, convId, m.texto);
    }
  }
  const total = mensajesPorConv.size || 1;
  const armar = mapa => [...mapa.values()]
    .map(e => ({ termino: e.termino, conversaciones: e.convs.size, pct: pct(e.convs.size, total), propia: e.termino.split(' ').some(w => PALABRAS_PROPIAS.has(w)), ejemplo: String(e.ejemplo).slice(0, 140) }))
    .filter(e => e.conversaciones >= minConversaciones)
    .sort((a, b) => b.conversaciones - a.conversaciones || a.termino.localeCompare(b.termino))
    .slice(0, tope);
  return { palabras: armar(uni), frases: armar(bi) };
}

// ---------------- Agrupar campos libres (producto / marca / modelo) ----------------
export function topPorCampo(filas, campo, tope = 10) {
  const mapa = new Map();
  for (const f of filas) {
    const v = String(f[campo] || '').trim();
    if (!v) continue;
    const k = normalizar(v).replace(/\s+/g, ' ');
    const e = mapa.get(k) || { nombre: v, n: 0, variantes: new Map() };
    e.n++; e.variantes.set(v, (e.variantes.get(v) || 0) + 1);
    mapa.set(k, e);
  }
  const total = filas.length;
  return [...mapa.values()].map(e => ({ nombre: [...e.variantes.entries()].sort((a, b) => b[1] - a[1])[0][0], n: e.n, pct: pct(e.n, total) }))
    .sort((a, b) => b.n - a.n).slice(0, tope);
}
// Combinaciones marca + producto (p. ej. "Toshiba · batería"): lo más específico para decidir catálogo o negativas.
export function topCombinaciones(filas, tope = 12) {
  const mapa = new Map();
  for (const f of filas) {
    const marca = String(f.marca || '').trim(), producto = String(f.producto || '').trim(), modelo = String(f.modelo || '').trim();
    if (!marca && !producto && !modelo) continue;
    const etiqueta = [marca, producto, modelo].filter(Boolean).join(' · ');
    const k = normalizar(etiqueta);
    const e = mapa.get(k) || { etiqueta, n: 0, ultima: null };
    e.n++;
    const t = fechaDe(f.ultimo_cliente_en) || fechaDe(f.iniciada_en);
    if (t && (!e.ultima || t > e.ultima)) e.ultima = t;
    mapa.set(k, e);
  }
  return [...mapa.values()].sort((a, b) => b.n - a.n).slice(0, tope).map(e => ({ etiqueta: e.etiqueta, n: e.n, pct: pct(e.n, filas.length), ultima: e.ultima ? e.ultima.toISOString() : null }));
}

// ---------------- Cuándo dejó de responder el cliente ----------------
function clasificarUltimoMensajeNuestro(texto) {
  const t = normalizar(texto);
  if (/\$\s?\d|\d{1,3}(\.\d{3})+|\bprecio|\bvalor|\bcuesta|\bsale\b/.test(t)) return 'Tras informar un precio o valor';
  if (/\bstock|no tenemos|agotad|sin existencia|no hay\b|disponib/.test(t)) return 'Tras informar disponibilidad / stock';
  if (/cotiz/.test(t)) return 'Tras enviar una cotización';
  if (/retiro|despacho|envio|direccion|sucursal|providencia|horario/.test(t)) return 'Tras informar retiro, despacho o dirección';
  if (/\?/.test(texto || '')) return 'Tras hacerle una pregunta';
  return 'Tras otro mensaje nuestro';
}
export function analizarSilencio(conversaciones, mensajesPorConv, ahora) {
  const porDia = Array(7).fill(0), porHora = Array(24).fill(0);
  const tras = new Map();
  const antiguedad = { 'Hoy o ayer': 0, '2 a 3 días': 0, '4 a 7 días': 0, '8 a 14 días': 0, 'Más de 14 días': 0 };
  let ultimoNuestro = 0, ultimoCliente = 0, sinRespuestaNuestra = 0;
  const duraciones = [];
  for (const c of conversaciones) {
    const msgs = mensajesPorConv.get(c.id) || [];
    const tCliente = fechaDe(c.ultimo_cliente_en), tNegocio = fechaDe(c.ultimo_negocio_en);
    if (!tNegocio) sinRespuestaNuestra++;
    // quién habló último: si fue el negocio, el cliente "dejó de responder"; si fue el cliente, nadie le contestó
    if (tNegocio && (!tCliente || tNegocio >= tCliente)) {
      ultimoNuestro++;
      const ultimoOut = [...msgs].reverse().find(m => m.dir === 'out' && m.texto);
      const clave = ultimoOut ? clasificarUltimoMensajeNuestro(ultimoOut.texto) : 'Tras otro mensaje nuestro';
      tras.set(clave, (tras.get(clave) || 0) + 1);
    } else if (tCliente) ultimoCliente++;
    if (tCliente) {
      const { dia, hora } = diaYHoraChile(tCliente);
      porDia[dia]++; porHora[hora]++;
      const dias = (ahora - tCliente) / 86400000;
      antiguedad[dias < 2 ? 'Hoy o ayer' : dias < 4 ? '2 a 3 días' : dias < 8 ? '4 a 7 días' : dias < 15 ? '8 a 14 días' : 'Más de 14 días']++;
    }
    const t0 = msgs.length ? fechaDe(msgs[0].t) : null, t1 = msgs.length ? fechaDe(msgs[msgs.length - 1].t) : null;
    if (t0 && t1) duraciones.push((t1 - t0) / 60000);
  }
  const total = conversaciones.length;
  return {
    ultimoMensajeDe: { negocio: ultimoNuestro, cliente: ultimoCliente, pctNegocio: pct(ultimoNuestro, total), pctCliente: pct(ultimoCliente, total) },
    sinRespuestaNuestra,
    tras: [...tras.entries()].map(([etiqueta, n]) => ({ etiqueta, n, pct: pct(n, ultimoNuestro) })).sort((a, b) => b.n - a.n),
    porDiaSemana: porDia.map((n, i) => ({ dia: DIAS_SEMANA[i], n })),
    porHora: porHora.map((n, h) => ({ hora: h, n })),
    antiguedad: Object.entries(antiguedad).map(([rango, n]) => ({ rango, n })),
    duracionMedianaMin: duraciones.length ? redondear(mediana(duraciones)) : null,
  };
}

// ---------------- Competencia: dominios y nombres ----------------
const COMPETIDORES = [
  ['Mercado Libre', /mercado\s*libre|mercadolibre|\bmeli\b|\bml\b/], ['AliExpress', /ali\s*express|aliexpress/], ['Amazon', /amazon/],
  ['Falabella', /falabella/], ['Paris', /\bparis\b/], ['Ripley', /ripley/], ['PC Factory', /pc\s*factory|pcfactory/], ['SP Digital', /sp\s*digital|spdigital/],
  ['Solotodo', /solotodo/], ['Linio', /linio/], ['Lider / Walmart', /\blider\b|walmart/], ['Wei', /\bwei\b/], ['Tienda de la competencia (genérico)', /otra tienda|otro lado|otro lugar|la competencia/],
];
const RE_URL = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:cl|com|net|co|org|io|shop|store))(?:\/[^\s]*)?/gi;
export function extraerDominiosYCompetidores(mensajesPorConv) {
  const dominios = new Map(), competidores = new Map();
  for (const [convId, msgs] of mensajesPorConv) {
    const dominiosConv = new Set(), compConv = new Set();
    for (const m of msgs) {
      if (m.dir !== 'in' || !m.texto) continue;
      RE_URL.lastIndex = 0;
      let r;
      while ((r = RE_URL.exec(m.texto)) !== null) {
        const d = r[1].toLowerCase();
        if (/indexstore\.cl$|wa\.me$|whatsapp\.com$/.test(d)) continue; // nuestro sitio o el propio WhatsApp
        dominiosConv.add(d);
        if (!dominios.has(d)) dominios.set(d, { dominio: d, convs: new Set(), ejemplo: (m.texto.match(/\S*[a-z0-9-]+\.(?:cl|com|net|co)\S*/i) || [d])[0].slice(0, 160) });
        dominios.get(d).convs.add(convId);
      }
      const t = normalizar(m.texto);
      for (const [nombre, re] of COMPETIDORES) if (re.test(t)) compConv.add(nombre);
    }
    compConv.forEach(n => competidores.set(n, (competidores.get(n) || new Set()).add(convId)));
  }
  const total = mensajesPorConv.size || 1;
  return {
    dominios: [...dominios.values()].map(e => ({ dominio: e.dominio, conversaciones: e.convs.size, ejemplo: e.ejemplo })).sort((a, b) => b.conversaciones - a.conversaciones).slice(0, 15),
    competidores: [...competidores.entries()].map(([nombre, s]) => ({ nombre, conversaciones: s.size, pct: pct(s.size, total) })).sort((a, b) => b.conversaciones - a.conversaciones),
  };
}

// ---------------- Respuesta lenta ----------------
const BUCKETS_RESPUESTA = [['Menos de 5 min', 0, 300], ['5 a 15 min', 300, 900], ['15 a 60 min', 900, 3600], ['1 a 4 horas', 3600, 14400], ['Más de 4 horas', 14400, Infinity]];
export function analizarRespuestaLenta(conversaciones, referenciaVentas = []) {
  const tiempos = conversaciones.map(c => c.primera_respuesta_segundos).filter(v => v != null && v >= 0);
  const sinRespuesta = conversaciones.filter(c => c.primera_respuesta_segundos == null).length;
  const distribucion = BUCKETS_RESPUESTA.map(([rango, a, b]) => ({ rango, n: tiempos.filter(t => t >= a && t < b).length }));
  distribucion.push({ rango: 'Sin respuesta registrada', n: sinRespuesta });
  const porHora = Array(24).fill(0), porDia = Array(7).fill(0);
  let fuera = 0, conFecha = 0;
  const porResp = new Map();
  for (const c of conversaciones) {
    const t = fechaDe(c.primer_cliente_en) || fechaDe(c.iniciada_en);
    if (t) { const { dia, hora } = diaYHoraChile(t); porHora[hora]++; porDia[dia]++; conFecha++; if (!dentroDeHorario(t)) fuera++; }
    const nombre = c.responsable || c.vendedor || 'Sin responsable';
    const e = porResp.get(nombre) || { nombre, n: 0, tiempos: [] };
    e.n++; if (c.primera_respuesta_segundos != null) e.tiempos.push(c.primera_respuesta_segundos);
    porResp.set(nombre, e);
  }
  const refTiempos = referenciaVentas.filter(v => v != null && v >= 0);
  return {
    medianaSeg: mediana(tiempos), p90Seg: percentil(tiempos, 90), nuncaRespondidas: sinRespuesta, distribucion,
    porHora: porHora.map((n, h) => ({ hora: h, n })), porDiaSemana: porDia.map((n, i) => ({ dia: DIAS_SEMANA[i], n })),
    fueraDeHorario: { n: fuera, pct: pct(fuera, conFecha), horario: HORARIO_ASUMIDO },
    porResponsable: [...porResp.values()].map(e => ({ nombre: e.nombre, n: e.n, medianaSeg: mediana(e.tiempos) })).sort((a, b) => b.n - a.n),
    referenciaVentas: { n: refTiempos.length, medianaSeg: mediana(refTiempos) },
  };
}

// ---------------- Precio ----------------
const SENALES_PRECIO = [
  ['Dijo que está caro', /\bcaro\b|\bcarisim|muy caro|elevado|costoso|salado|\bpasado\b/],
  ['Pidió descuento o mejor precio', /descuento|rebaja|\boferta\b|promo|cupon|mejor precio|ultimo precio|precio final|me lo deja|me lo dejas|alguna rebaja|\bdscto/],
  ['Dijo que lo vio más barato en otro lado', /mas barato|mas economico|\bbarato\b|menos en|en otro lado|en otra tienda|mercado\s*libre|mercadolibre|aliexpress/],
  ['Preguntó por cuotas o formas de pago', /cuotas|sin interes|transferencia|tarjeta|credito|debito|formas? de pago/],
];
export function analizarPrecio(conversaciones, mensajesPorConv, ahora) {
  const contadores = SENALES_PRECIO.map(([senal, re]) => ({ senal, re, convs: new Set() }));
  for (const [convId, msgs] of mensajesPorConv) for (const m of msgs) {
    if (m.dir !== 'in' || !m.texto) continue;
    const t = normalizar(m.texto);
    contadores.forEach(c => { if (c.re.test(t)) c.convs.add(convId); });
  }
  const total = conversaciones.length;
  const recuperadas = conversaciones.filter(c => c.bsale_doc);
  const recontactables = conversaciones
    .filter(c => !c.bsale_doc && c.telefono)
    .map(c => ({ id: c.id, cliente: c.contacto_nombre || '', telefono: c.telefono, producto: [c.marca, c.producto, c.modelo].filter(Boolean).join(' ') || '', diasSinResponder: fechaDe(c.ultimo_cliente_en) ? Math.max(0, Math.floor((ahora - fechaDe(c.ultimo_cliente_en)) / 86400000)) : null }))
    .sort((a, b) => (a.diasSinResponder ?? 999) - (b.diasSinResponder ?? 999));
  return {
    senales: contadores.map(c => ({ senal: c.senal, conversaciones: c.convs.size, pct: pct(c.convs.size, total) })),
    recuperadas: { n: recuperadas.length, pct: pct(recuperadas.length, total) },
    recontactables: recontactables.slice(0, 60), totalRecontactables: recontactables.length,
  };
}

// ---------------- Orquestador ----------------
function fuentesDe(conversaciones) {
  const mapa = new Map();
  for (const c of conversaciones) {
    const base = c.fuente_tipo === 'utm' ? (c.utm_source ? `UTM ${c.utm_source}` : 'UTM') : c.fuente_tipo === 'boton_sitio' ? 'Botón del sitio' : c.fuente_tipo ? 'Anuncio' : 'Directo / desconocido';
    const detalle = c.utm_campana || c.fuente_titulo || '';
    const k = `${base}|${detalle}`;
    const e = mapa.get(k) || { fuente: base, detalle, n: 0 };
    e.n++; mapa.set(k, e);
  }
  return [...mapa.values()].sort((a, b) => b.n - a.n).slice(0, 12).map(e => ({ ...e, pct: pct(e.n, conversaciones.length) }));
}

// Calidad del dato "respuestas del negocio": el ERP solo registra lo que el negocio escribe desde el propio ERP / la API de
// WhatsApp. Lo que se responde desde la app del celular solo llega si está activa la coexistencia (eco de mensajes); si no,
// la conversación parece "sin respuesta nuestra" aunque se haya contestado. Con menos de UMBRAL_COBERTURA_RESPUESTAS de
// conversaciones con alguna respuesta registrada, las cifras que dependen de nuestras respuestas NO son confiables.
export const UMBRAL_COBERTURA_RESPUESTAS = 70;
export function evaluarCalidadRespuestas(cobertura) {
  if (!cobertura || !cobertura.total) return { confiable: null, total: 0, conRespuesta: 0, pct: null, conApp: 0 };
  const pctCob = pct(cobertura.conRespuesta, cobertura.total);
  return { confiable: cobertura.total < 10 ? null : pctCob >= UMBRAL_COBERTURA_RESPUESTAS, total: cobertura.total, conRespuesta: cobertura.conRespuesta, pct: pctCob, conApp: cobertura.conApp || 0, umbral: UMBRAL_COBERTURA_RESPUESTAS };
}

export function analizarMotivo({ motivo, conversaciones, mensajes, ahora = new Date(), referenciaVentas = [], cobertura = null }) {
  const total = conversaciones.length;
  const mensajesPorConv = new Map();
  for (const c of conversaciones) mensajesPorConv.set(c.id, []);
  for (const m of mensajes || []) if (mensajesPorConv.has(m.conversacion_id)) mensajesPorConv.get(m.conversacion_id).push({ t: m.marca_tiempo, dir: m.direccion, texto: m.contenido_texto });
  const terminos = extraerTerminos(mensajesPorConv, { minConversaciones: total >= 12 ? 2 : 1, tope: 30 });
  const silencio = analizarSilencio(conversaciones, mensajesPorConv, ahora);
  const comun = {
    productos: topPorCampo(conversaciones, 'producto'), marcas: topPorCampo(conversaciones, 'marca'), modelos: topPorCampo(conversaciones, 'modelo'),
    categorias: topPorCampo(conversaciones, 'categoria'), problemas: topPorCampo(conversaciones, 'problema'), especificaciones: topPorCampo(conversaciones, 'especificaciones', 8),
    combinaciones: topCombinaciones(conversaciones),
  };
  const resultado = {
    motivo, total,
    resumen: {
      total, recuperadas: conversaciones.filter(c => c.bsale_doc).length,
      sinRespuestaNuestra: silencio.sinRespuestaNuestra,
      medianaMensajes: conversaciones.length ? mediana(conversaciones.map(c => c.cantidad_mensajes || 0)) : null,
    },
    comun, silencio, terminos, fuentes: fuentesDe(conversaciones),
    conversaciones: conversaciones.slice(0, 80).map(c => ({
      id: c.id, cliente: c.contacto_nombre || '', telefono: c.telefono || '', producto: [c.marca, c.producto, c.modelo].filter(Boolean).join(' '),
      ultimoCliente: c.ultimo_cliente_en || null, primerMensaje: (mensajesPorConv.get(c.id).find(m => m.dir === 'in' && m.texto) || {}).texto?.slice(0, 160) || '',
    })),
  };
  if (motivo === 'producto_no_disponible') {
    const marcas = new Set(comun.marcas.map(m => normalizar(m.nombre)));
    resultado.especifico = {
      tipo: 'negativas',
      // Candidatas a palabra negativa: términos que se repiten, que no son lo que vendemos y que no son relleno
      candidatas: [...terminos.palabras, ...terminos.frases]
        .filter(t => !t.propia && t.conversaciones >= (total >= 12 ? 2 : 1))
        .sort((x, y) => y.conversaciones - x.conversaciones || (x.termino.includes(' ') ? 1 : 0) - (y.termino.includes(' ') ? 1 : 0) || x.termino.localeCompare(y.termino))
        .slice(0, 40)
        .map(t => ({ ...t, esMarca: marcas.has(t.termino) })),
      marcasPedidas: comun.marcas,
    };
  } else if (motivo === 'compro_en_otro_lugar') {
    const r = analizarRespuestaLenta(conversaciones, referenciaVentas);
    resultado.especifico = { tipo: 'competencia', ...extraerDominiosYCompetidores(mensajesPorConv), respuesta: { medianaSeg: r.medianaSeg, referenciaVentas: r.referenciaVentas, nuncaRespondidas: r.nuncaRespondidas } };
  } else if (motivo === 'respuesta_lenta') {
    resultado.especifico = { tipo: 'respuesta', ...analizarRespuestaLenta(conversaciones, referenciaVentas) };
  } else if (motivo === 'precio') {
    resultado.especifico = { tipo: 'precio', ...analizarPrecio(conversaciones, mensajesPorConv, ahora) };
  }
  resultado.calidad = evaluarCalidadRespuestas(cobertura);
  resultado.recomendaciones = recomendaciones(resultado);
  return resultado;
}

// Recomendaciones derivadas de las cifras (no texto fijo): cada una cita el dato que la sustenta.
export function recomendaciones(r) {
  const out = [];
  const e = r.especifico;
  const sil = r.silencio;
  // Si casi no hay respuestas nuestras registradas, nada de lo que dependa de ellas es una conclusión válida
  const sinDatoRespuestas = r.calidad && r.calidad.confiable === false;
  if (sinDatoRespuestas) out.push({ titulo: 'Antes de sacar conclusiones: faltan las respuestas del negocio', texto: `Solo el ${r.calidad.pct}% de las conversaciones del período tiene alguna respuesta nuestra registrada en el ERP. Las que se contestan desde el celular no llegan al ERP si la coexistencia de WhatsApp no está activa, así que "sin respuesta", "quién habló último", "tras qué mensaje se cortó" y los tiempos de respuesta no reflejan la realidad. Lo que sí es confiable: qué piden los clientes, sus palabras y de dónde vienen.` });
  if (e?.tipo === 'negativas') {
    const marcas = e.candidatas.filter(c => c.esMarca).slice(0, 6).map(c => c.termino);
    const frases = e.candidatas.filter(c => c.termino.includes(' ')).slice(0, 5).map(c => c.termino);
    if (marcas.length) out.push({ titulo: 'Palabras negativas por marca', texto: `Marcas que piden y no vendemos: ${marcas.join(', ')}. Agrégalas como negativas en las campañas de Google Ads (o conviértelas en oportunidad de catálogo si se repiten mucho).` });
    if (frases.length) out.push({ titulo: 'Frases negativas', texto: `Frases que se repiten: ${frases.map(f => `"${f}"`).join(', ')}. Úsalas como negativa de frase.` });
    if (r.comun.combinaciones[0]) out.push({ titulo: 'Qué piden más', texto: `Lo más pedido sin vender es "${r.comun.combinaciones[0].etiqueta}" (${r.comun.combinaciones[0].n} conversaciones, ${r.comun.combinaciones[0].pct}%). Si pasa de ~5 al mes, evalúa sumarlo al catálogo.` });
  }
  if (e?.tipo === 'competencia') {
    if (e.competidores[0]) out.push({ titulo: 'Competencia mencionada', texto: `La más nombrada es ${e.competidores[0].nombre} (${e.competidores[0].conversaciones} conversaciones). Revisa su precio en los productos que más se repiten acá.` });
    if (e.dominios[0]) out.push({ titulo: 'Sitios compartidos por clientes', texto: `Los clientes compartieron ${e.dominios.length} sitio(s), por ejemplo ${e.dominios[0].dominio}. Es la fuente más directa de precios de la competencia.` });
    const ref = e.respuesta.referenciaVentas;
    if (!sinDatoRespuestas && e.respuesta.medianaSeg != null && ref.medianaSeg != null && e.respuesta.medianaSeg > ref.medianaSeg * 1.5) out.push({ titulo: 'Velocidad frente a las ventas', texto: `Estas conversaciones tardaron ${Math.round(e.respuesta.medianaSeg / 60)} min en la primera respuesta contra ${Math.round(ref.medianaSeg / 60)} min en las que terminaron en venta: la velocidad pudo decidir.` });
  }
  if (e?.tipo === 'respuesta' && !sinDatoRespuestas) {
    if (e.medianaSeg != null) out.push({ titulo: 'Tiempo de primera respuesta', texto: `Mediana de ${Math.round(e.medianaSeg / 60)} min (el 10% más lento supera ${Math.round((e.p90Seg || 0) / 60)} min). Meta sugerida: bajo 5 min en horario de atención.` });
    if (e.fueraDeHorario.pct >= 25) out.push({ titulo: 'Mensajes fuera de horario', texto: `El ${e.fueraDeHorario.pct}% de estas conversaciones empezó fuera del horario asumido (${e.fueraDeHorario.horario.semana[0]}–${e.fueraDeHorario.horario.semana[1]} h). Un mensaje automático de ausencia con horario y promesa de respuesta puede retener a esos clientes.` });
    if (e.nuncaRespondidas > 0) out.push({ titulo: 'Sin ninguna respuesta', texto: `${e.nuncaRespondidas} conversaciones nunca recibieron respuesta. Revisa la bandeja de "Pendientes" diaria.` });
  }
  if (e?.tipo === 'precio') {
    const dscto = e.senales.find(s => s.senal.startsWith('Pidió descuento'));
    if (dscto && dscto.pct >= 20) out.push({ titulo: 'Cupón de recontacto', texto: `El ${dscto.pct}% pidió descuento o mejor precio de forma explícita: un cupón puntual (con vigencia corta) a quienes no compraron puede recuperarlos. Hay ${e.totalRecontactables} clientes con teléfono para recontactar abajo.` });
    const caro = e.senales.find(s => s.senal.startsWith('Dijo que está caro'));
    if (caro && caro.conversaciones > 0) out.push({ titulo: 'Objeción de precio directa', texto: `${caro.conversaciones} clientes dijeron que está caro: refuerza garantía y diferencia (original vs. alternativo) antes de bajar el precio.` });
    if (e.recuperadas.n > 0) out.push({ titulo: 'Ya compraron después', texto: `${e.recuperadas.n} de estas conversaciones (${e.recuperadas.pct}%) tienen una venta posterior en Bsale: el precio no siempre es definitivo.` });
  }
  if (!sinDatoRespuestas && sil.ultimoMensajeDe.pctNegocio >= 60 && sil.tras[0]) out.push({ titulo: 'Dónde se corta la conversación', texto: `En el ${sil.ultimoMensajeDe.pctNegocio}% habló último el negocio y el cliente no volvió; lo más común es "${sil.tras[0].etiqueta.toLowerCase()}" (${sil.tras[0].pct}%). Programa un reenganche a las 24–48 h en ese punto.` });
  if (!sinDatoRespuestas && sil.ultimoMensajeDe.pctCliente >= 40) out.push({ titulo: 'Clientes que quedaron esperando', texto: `En el ${sil.ultimoMensajeDe.pctCliente}% el último mensaje fue del cliente y nadie le respondió.` });
  if (!out.length) out.push({ titulo: 'Sin recomendaciones automáticas', texto: 'Hay pocas conversaciones o el patrón no es lo bastante claro. Revisa el listado de conversaciones de abajo.' });
  return out;
}

// ---------------- Cierre cordial ("ok", "gracias") ----------------
// Cuando el último mensaje del cliente es un agradecimiento o una confirmación corta ("Oka.. gracias", "ok", "perfecto",
// "👍"), la conversación terminó bien: la respuesta llegó y la duda quedó aclarada. No es un cliente que "dejó de responder".
// Solo cuenta si el mensaje es SOLO eso: "ok gracias, lo voy a pensar" o "gracias, pero es muy caro" siguen siendo otra cosa.
const PALABRAS_CIERRE = new Set(`ok oka okey okei oki okk okis vale listo perfecto perfecta genial excelente buenisimo buenisima bacan super sipo si sip entendido entendi claro dale dalee bien muy buena bueno gracias grasias grax gracia graciass muchas mil muchisimas muchisimo agradezco agradecido agradecida saludos abrazo abrazos igualmente buen buenas dia dias tarde tardes noche noches hasta luego chao chau adios nos vemos fino cachai`.split(/\s+/).filter(Boolean));
const PALABRAS_ACUSE = new Set(['ok', 'oka', 'okey', 'okei', 'oki', 'okk', 'okis', 'gracias', 'grasias', 'grax', 'gracia', 'graciass', 'agradezco', 'listo', 'perfecto', 'perfecta', 'genial', 'excelente', 'buenisimo', 'buenisima', 'bacan', 'entendido', 'entendi', 'dale', 'dalee', 'vale', 'super']);
export function esCierreCordial(texto) {
  const crudo = String(texto || '').trim();
  if (!crudo || crudo.length > 60) return false;
  const emojis = (crudo.match(/\p{Extended_Pictographic}/gu) || []);
  const soloEmojisAmables = emojis.length > 0 && emojis.every(e => ['👍', '🙏', '👌', '🙌', '😊', '😀', '🤝', '✅', '❤', '❤️', '💪', '😉', '👏'].includes(e));
  const limpio = normalizar(crudo.replace(/\p{Extended_Pictographic}/gu, ' ')).replace(/[^a-zñ\s]/g, ' ');
  const tokens = limpio.split(/\s+/).filter(Boolean);
  if (!tokens.length) return soloEmojisAmables;           // solo 👍 / 🙏
  if (!tokens.every(t => PALABRAS_CIERRE.has(t))) return false;
  // al menos un acuse real (ok, gracias...), y no solo "buenas tardes"
  return tokens.some(t => PALABRAS_ACUSE.has(t)) || soloEmojisAmables;
}
// Conversaciones perdidas por una causa "débil" (la IA no tenía una razón concreta) y que en realidad terminaron con un cierre cordial.
export const RESULTADOS_DEBILES_CIERRE = ['cliente_no_responde', 'otro'];
export const MOTIVOS_DEBILES_CIERRE = ['cliente_no_responde', 'sin_seguimiento', 'respuesta_lenta', 'otro'];
export function debeReclasificarPorCierre({ resultado, motivo_perdida, ultimoTextoCliente, mensajesCliente }) {
  if (!RESULTADOS_DEBILES_CIERRE.includes(resultado)) return false;
  if (motivo_perdida && !MOTIVOS_DEBILES_CIERRE.includes(motivo_perdida)) return false; // una razón concreta (precio, sin stock...) se respeta
  if ((mensajesCliente || 0) < 2) return false;                                         // un "ok" suelto como primer mensaje no cierra nada
  return esCierreCordial(ultimoTextoCliente);
}

// ---------------- Análisis de una CATEGORÍA consultada ----------------
// Misma idea que analizarMotivo, pero sobre TODAS las conversaciones de una categoría (pantallas, cargadores, baterías...), no
// solo las perdidas: cuánto se consulta, cuánto se vende, por qué se pierde, qué piden, desde dónde llegan y en qué horarios.
export const CATEGORIAS_ANALIZABLES = ['pantalla', 'cargador', 'bateria', 'servicio_tecnico', 'repuestos', 'cotizacion', 'compatibilidad', 'garantia', 'estado_pedido', 'postventa', 'otra', 'sin_categoria'];
const RESULTADOS_NO_PERDIDA = ['cotizacion', 'seguimiento', 'consulta_resuelta'];
const esVendida = c => !!c.vendida;
const MOTIVOS_DEBILES_PERDIDA = ['cliente_no_responde', 'sin_seguimiento', 'otro'];
// Pérdida: no vendida, con resultado de pérdida, y que NO sea una conversión (enlace u oferta enviada) con una causa débil: si le enviamos
// el enlace/oferta y no volvió, es una intención de venta pendiente. Una razón concreta (precio, competencia, sin stock...) sigue siendo pérdida.
const esPerdidaBase = c => !esVendida(c) && !!c.resultado && !RESULTADOS_NO_PERDIDA.includes(c.resultado) && c.resultado !== 'venta';

function fuentesConConversion(conversaciones, nivelOferta) {
  const mapa = new Map();
  for (const c of conversaciones) {
    const base = c.fuente_tipo === 'utm' ? (c.utm_source ? `UTM ${c.utm_source}` : 'UTM') : c.fuente_tipo === 'boton_sitio' ? 'Botón del sitio' : c.fuente_tipo ? 'Anuncio' : 'Directo / desconocido';
    const detalle = c.utm_campana || c.fuente_titulo || '';
    const k = `${base}|${detalle}`;
    const e = mapa.get(k) || { fuente: base, detalle, n: 0, ventas: 0, conversiones: 0 };
    e.n++; if (esVendida(c)) e.ventas++; if (esConversion(nivelOferta.get(c.id))) e.conversiones++;
    mapa.set(k, e);
  }
  return [...mapa.values()].sort((a, b) => b.n - a.n).slice(0, 15).map(e => ({ ...e, pct: pct(e.n, conversaciones.length), conversion: pct(e.conversiones, e.n) }));
}

export function analizarCategoria({ categoria, conversaciones, mensajes, ahora = new Date(), cobertura = null, etiquetasMotivo = {} }) {
  const total = conversaciones.length;
  const mensajesPorConv = new Map();
  for (const c of conversaciones) mensajesPorConv.set(c.id, []);
  for (const m of mensajes || []) if (mensajesPorConv.has(m.conversacion_id)) mensajesPorConv.get(m.conversacion_id).push({ t: m.marca_tiempo, dir: m.direccion, texto: m.contenido_texto });
  const ventas = conversaciones.filter(esVendida).length;
  // CONVERSIÓN = intención de venta: se le envió el enlace del producto o una oferta (precio + dónde verla, condiciones, dirección).
  const nivelOferta = new Map(conversaciones.map(c => [c.id, mejorNivelOferta((mensajesPorConv.get(c.id) || []).filter(m => m.dir === 'out').map(m => m.texto))]));
  const esConv = c => esConversion(nivelOferta.get(c.id));
  const perdidas = conversaciones.filter(c => esPerdidaBase(c) && !(esConv(c) && MOTIVOS_DEBILES_PERDIDA.includes(c.motivo || c.resultado)));
  const cotizaciones = conversaciones.filter(c => !esVendida(c) && (c.resultado === 'cotizacion' || c.resultado === 'seguimiento')).length;
  const resueltas = conversaciones.filter(c => !esVendida(c) && c.resultado === 'consulta_resuelta').length;
  const conIntencionCompra = conversaciones.filter(c => c.intencion === 'compra').length;
  const conversiones = conversaciones.filter(esConv).length;
  const ofertasCompletas = conversaciones.filter(c => esOfertaCompleta(nivelOferta.get(c.id))).length;
  const soloEnlace = conversaciones.filter(c => nivelOferta.get(c.id) === 'enlace').length;
  const intencionSinConversion = conversaciones.filter(c => c.intencion === 'compra' && !esVendida(c) && !esConv(c)).length;
  const motivos = new Map();
  for (const c of perdidas) { const m = c.motivo || c.resultado || 'otro'; motivos.set(m, (motivos.get(m) || 0) + 1); }
  const motivosPerdida = [...motivos.entries()].map(([motivo, n]) => ({ motivo, etiqueta: etiquetasMotivo[motivo] || motivo, n, pct: pct(n, perdidas.length) })).sort((a, b) => b.n - a.n);

  // Demanda: cuándo escriben los clientes de esta categoría (hora de Chile)
  const porDia = Array(7).fill(0), porHora = Array(24).fill(0);
  for (const c of conversaciones) { const t = fechaDe(c.primer_cliente_en) || fechaDe(c.iniciada_en); if (t) { const { dia, hora } = diaYHoraChile(t); porDia[dia]++; porHora[hora]++; } }
  const respuesta = analizarRespuestaLenta(conversaciones, []);
  // Sin ningún mensaje saliente registrado: puede ser que no se respondió o que se respondió desde el celular (el ERP no lo ve). Si el
  // cliente cerró con un "ok/gracias" después de varios mensajes, hay un indicio claro de que sí lo atendieron.
  let sinSalida = 0, conIndicios = 0;
  for (const c of conversaciones) {
    const msgs = mensajesPorConv.get(c.id) || [];
    if (msgs.some(m => m.dir === 'out')) continue;
    sinSalida++;
    const entrantes = msgs.filter(m => m.dir === 'in');
    if (entrantes.length >= 2 && esCierreCordial(entrantes[entrantes.length - 1].texto)) conIndicios++;
  }
  const terminos = extraerTerminos(mensajesPorConv, { minConversaciones: total >= 12 ? 2 : 1, tope: 30 });
  const comun = {
    productos: topPorCampo(conversaciones, 'producto'), marcas: topPorCampo(conversaciones, 'marca'), modelos: topPorCampo(conversaciones, 'modelo'),
    problemas: topPorCampo(conversaciones, 'problema'), especificaciones: topPorCampo(conversaciones, 'especificaciones', 8), combinaciones: topCombinaciones(conversaciones),
  };
  // Qué se consulta mucho y no se vende: combinaciones con varias consultas y cero ventas
  const sinVenta = new Map();
  for (const c of conversaciones) {
    const etiqueta = [c.marca, c.producto, c.modelo].filter(Boolean).join(' · ');
    if (!etiqueta) continue;
    const k = normalizar(etiqueta); const e = sinVenta.get(k) || { etiqueta, n: 0, ventas: 0, conversiones: 0 };
    e.n++; if (esVendida(c)) e.ventas++; if (esConv(c)) e.conversiones++; sinVenta.set(k, e);
  }
  const demandaSinVenta = [...sinVenta.values()].filter(e => e.n >= 3 && e.conversiones === 0).sort((a, b) => b.n - a.n).slice(0, 8);
  const fuentes = fuentesConConversion(conversaciones, nivelOferta);
  const calidad = evaluarCalidadRespuestas(cobertura);

  const r = {
    categoria, total,
    resumen: {
      total, conversiones, ofertas: conversiones, ofertasCompletas, soloEnlace,
      pctConversion: pct(conversiones, total),
      intencionSinConversion, intencionSinOferta: intencionSinConversion,
      ventas, conversion: pct(ventas, total), perdidas: perdidas.length, pctPerdidas: pct(perdidas.length, total), cotizaciones, resueltas, conIntencionCompra,
      medianaRespuestaSeg: respuesta.medianaSeg,
    },
    // La intención de venta ES la cotización enviada: no se compara contra la "intención de compra" que clasifica la IA.
    embudo: [{ etapa: 'Conversaciones', n: total }, { etapa: 'Intención de venta: cotización enviada (enlace u oferta)', n: conversiones }, { etapa: 'Venta registrada', n: ventas }],
    motivosPerdida, comun, terminos, fuentes, demandaSinVenta,
    demanda: { porDiaSemana: porDia.map((n, i) => ({ dia: DIAS_SEMANA[i], n })), porHora: porHora.map((n, h) => ({ hora: h, n })) },
    respuesta: { medianaSeg: respuesta.medianaSeg, p90Seg: respuesta.p90Seg, distribucion: respuesta.distribucion, sinRespuestaRegistrada: respuesta.nuncaRespondidas, sinSalida, conIndicios, total },
    calidad,
    conversaciones: conversaciones.slice(0, 80).map(c => ({
      id: c.id, cliente: c.contacto_nombre || '', telefono: c.telefono || '', producto: [c.marca, c.producto, c.modelo].filter(Boolean).join(' '),
      resultado: esVendida(c) ? 'venta' : (c.resultado || ''), primerMensaje: ((mensajesPorConv.get(c.id).find(m => m.dir === 'in' && m.texto) || {}).texto || '').slice(0, 160),
      fecha: c.iniciada_en || null,
    })),
  };
  r.recomendaciones = recomendacionesCategoria(r);
  return r;
}

export function recomendacionesCategoria(r) {
  const out = [];
  const s = r.resumen;
  // Conversión = intención de venta (se le envió el enlace u oferta). La venta confirmada se registra poco y NO se usa para juzgar.
  // La intención de venta es la cotización enviada, así que no se mide "sobre la intención de compra" de la IA (daba 0% con 1 conversión).
  // Si el ERP no ve lo que se contesta desde el celular, un porcentaje bajo de cotizaciones no es confiable: lo avisa la recomendación de calidad.
  const datosConfiables = !(r.calidad && r.calidad.confiable === false);
  if (s.total >= 10 && datosConfiables) {
    if (s.pctConversion < 30) out.push({ titulo: 'Pocas cotizaciones enviadas', texto: `Solo a ${s.conversiones} de las ${s.total} conversaciones (${s.pctConversion}%) se les envió el enlace del producto o una oferta.` });
    else if (s.pctConversion >= 60) out.push({ titulo: 'Se está cotizando bien', texto: `A ${s.conversiones} de las ${s.total} conversaciones (${s.pctConversion}%) se les envió el enlace del producto o una oferta: es una buena categoría para reforzar con campañas.` });
  }
  if (s.conIntencionCompra >= 10 && s.intencionSinConversion / s.conIntencionCompra >= 0.3) out.push({ titulo: 'Pidieron comprar y no recibieron cotización', texto: `${s.intencionSinConversion} de las ${s.conIntencionCompra} conversaciones en que el cliente pidió comprar o cotizar todavía no recibieron el enlace del producto ni una oferta${datosConfiables ? '' : ' (puede incluir cotizaciones enviadas desde el celular, que el ERP no ve)'}. Es la oportunidad más directa de esta categoría.` });
  if (s.conversiones >= 10 && s.ofertasCompletas / s.conversiones < 0.4) out.push({ titulo: 'Conversiones con información incompleta', texto: `Solo ${s.ofertasCompletas} de las ${s.conversiones} conversiones incluyeron la ficha completa (precio, garantía, instalación, dirección y horarios)${s.soloEnlace ? `; en ${s.soloEnlace} solo se envió el enlace` : ''}. Enviar siempre la ficha completa deja al cliente con todo para decidir.` });
  if (r.motivosPerdida[0] && r.motivosPerdida[0].pct >= 25) out.push({ titulo: `Principal motivo de pérdida: ${r.motivosPerdida[0].etiqueta}`, texto: `Explica el ${r.motivosPerdida[0].pct}% de las ${s.perdidas} conversaciones perdidas de esta categoría. Para el detalle usa "📊 Analizar" en la tabla de Motivos de pérdida.` });
  if (r.demandaSinVenta[0]) out.push({ titulo: 'Se consulta y no se convierte', texto: `"${r.demandaSinVenta[0].etiqueta}" tuvo ${r.demandaSinVenta[0].n} consultas y a ninguna se le envió enlace u oferta. Revisa stock, precio y publicación de ese producto.` });
  const fuenteMala = r.fuentes.find(f => f.n >= 8 && f.conversiones === 0 && f.fuente !== 'Directo / desconocido');
  if (fuenteMala) out.push({ titulo: 'Fuente que trae consultas pero ninguna conversión', texto: `${fuenteMala.fuente}${fuenteMala.detalle ? ' · ' + fuenteMala.detalle : ''}: ${fuenteMala.n} conversaciones y a ninguna se le envió enlace u oferta. Revisa si son consultas que no podemos atender o si faltó responderlas; también la segmentación y las palabras negativas de esa campaña.` });
  const hora = [...r.demanda.porHora].sort((a, b) => b.n - a.n)[0];
  if (hora && hora.n >= 5 && s.total >= 20) out.push({ titulo: 'Hora de mayor demanda', texto: `La mayor cantidad de clientes escribe a las ${hora.hora}:00 h (${pct(hora.n, s.total)}% de las conversaciones). Ahí conviene tener cobertura.` });
  if (r.calidad && r.calidad.confiable === false) out.push({ titulo: 'Cuidado con los tiempos de respuesta', texto: `Solo el ${r.calidad.pct}% de las conversaciones tiene alguna respuesta nuestra registrada en el ERP (lo que se contesta desde el celular no llega), así que los tiempos de respuesta de abajo no son confiables.` });
  if (!out.length) out.push({ titulo: 'Sin recomendaciones automáticas', texto: 'Hay pocas conversaciones o el patrón no es lo bastante claro en este período.' });
  return out;
}

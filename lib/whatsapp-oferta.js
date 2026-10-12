// /lib/whatsapp-oferta.js
// COTIZACIÓN = intención de venta en IndexStore. Una conversación cuenta como cotización (conversión) cuando ocurre alguna de estas cosas:
//   1. el negocio le envió al cliente el ENLACE del producto y/o una oferta con precio, disponibilidad, condiciones (garantía, instalación,
//      medios de pago) y dónde y cuándo atendemos;
//   2. el negocio le envió una COTIZACIÓN formal ("le envío la cotización adjunta", "Cotización N° 9820", un PDF de cotización);
//   3. el CLIENTE la pidió por escrito ("necesito una cotización", "quiero cotizar", "me envía un presupuesto"). Se cuenta aunque no se vea
//      la respuesta: lo que se contesta desde el celular no llega al ERP (ver coexistencia de WhatsApp), así que el pedido del cliente es
//      la señal más confiable de que hubo una cotización en curso.
// La venta de productos técnicos es conversacional y de confianza: el cliente puede decidir después o comparar con otro proveedor, pero la
// oportunidad quedó planteada. La venta confirmada es solo la etapa final (y se registra poco), así que NO se usa como medida de conversión.
//
// Los patrones son cadenas simples que sirven igual en JavaScript (RegExp, flag "i") y en PostgreSQL (operador ~*), para que la
// detección en el análisis y en las consultas SQL sea la misma.
export const PATRONES_OFERTA = {
  precio: '\\$\\s?[0-9]{1,3}([.,][0-9]{3})+|\\$\\s?[0-9]{4,}|precio[^0-9]{0,14}[0-9]',
  enlace: 'indexstore\\.cl/(products|collections|pages)|https?://',
  disponible: 'disponible|en stock|tenemos (el|la|los|las|stock)|hay stock|stock disponible',
  condiciones: 'garant|instalaci|despacho|retiro|medios de pago|env[ií]o',
  ubicacion: 'concepci[oó]n|providencia|ubicad|horario|metro pedro|lun a|lunes a',
  enlaceProducto: 'indexstore\\.cl/(products|collections)',
  // El negocio ENVÍA una cotización (no basta con nombrarla: "¿necesita una cotización?" o "para cotizar necesito el modelo" no cuentan).
  cotizacion: 'cotizaci[oó]n[^.?!]{0,40}(adjunt|enviad|lista|a continuaci)|(adjunt|env[ií]o|enviamos|mando|paso|dejo|prepar[eé]|hice|adjuntamos)[^.?!]{0,40}(cotizaci|presupuesto|proforma)|cotizaci[oó]n( n[°ºo]\\.?)? ?[0-9]{3,}|cotiz[^ ]{0,30}\\.pdf',
};
// El CLIENTE pide una cotización por escrito (mensajes entrantes).
export const PATRON_SOLICITUD_COTIZACION = 'cotiz|presupuesto|proforma';

const RE = Object.fromEntries(Object.entries(PATRONES_OFERTA).map(([k, v]) => [k, new RegExp(v, 'i')]));
const RE_SOLICITUD = new RegExp(PATRON_SOLICITUD_COTIZACION, 'i');

// ¿El cliente pidió una cotización en este texto? (mensaje entrante)
export const esSolicitudCotizacion = texto => RE_SOLICITUD.test(String(texto || ''));
export const hayCotizacionSolicitada = textosEntrantes => (textosEntrantes || []).some(t => esSolicitudCotizacion(typeof t === 'string' ? t : t && t.texto != null ? t.texto : t && t.contenido_texto));

// Nivel de un mensaje del negocio (de más a menos completo):
//   'completa'  : precio + (enlace o disponibilidad) + (condiciones o ubicación)  -> la ficha de oferta típica
//   'cotizada'  : precio + (enlace o disponibilidad)                              -> le dimos el precio y por dónde verlo
//   'enlace'    : el enlace de un producto o categoría de la tienda, sin precio    -> le mandamos el link para que lo vea
//   'cotizacion': le enviamos una cotización formal (adjunta, con número o PDF), sin precio en el texto
//   'precio'    : solo un precio (todavía no es una conversión)
export function nivelOfertaMensaje(texto) {
  const t = String(texto || '');
  if (!t) return null;
  const precio = RE.precio.test(t);
  if (!precio) return RE.enlaceProducto.test(t) ? 'enlace' : (RE.cotizacion.test(t) ? 'cotizacion' : null);
  const respaldo = RE.enlace.test(t) || RE.disponible.test(t);
  if (!respaldo) return RE.cotizacion.test(t) ? 'cotizacion' : 'precio';
  return (RE.condiciones.test(t) || RE.ubicacion.test(t)) ? 'completa' : 'cotizada';
}
const ORDEN = { precio: 1, enlace: 2, cotizacion: 3, cotizada: 3, completa: 4 };
export function mejorNivelOferta(mensajesSalientes) {
  let mejor = null;
  for (const m of mensajesSalientes || []) {
    const n = nivelOfertaMensaje(typeof m === 'string' ? m : m && m.texto != null ? m.texto : m && m.contenido_texto);
    if (n && (!mejor || ORDEN[n] > ORDEN[mejor])) mejor = n;
  }
  return mejor;
}
// Es una COTIZACIÓN (conversión): el negocio envió el enlace, una oferta o una cotización, o el cliente la pidió. Un precio suelto no alcanza.
export const esConversion = nivel => nivel === 'completa' || nivel === 'cotizada' || nivel === 'enlace' || nivel === 'cotizacion' || nivel === 'solicitada';
export const esOfertaEntregada = esConversion; // nombre anterior, mismo significado
export const esOfertaCompleta = nivel => nivel === 'completa';
// Cotización que el negocio SÍ envió (se ve en el ERP), distinta de la que solo pidió el cliente.
export const esCotizacionEnviada = nivel => esConversion(nivel) && nivel !== 'solicitada';

// Nivel de una conversación: lo mejor que el negocio le envió; si no hay conversión de ese lado pero el cliente pidió una cotización, 'solicitada'.
export function nivelConversacion(mensajesSalientes, mensajesEntrantes) {
  const n = mejorNivelOferta(mensajesSalientes);
  if (esConversion(n)) return n;
  return hayCotizacionSolicitada(mensajesEntrantes) ? 'solicitada' : n;
}

// Fragmento SQL: por conversación (alias "c"), el mejor nivel de oferta que el negocio le envió y cuándo. Requiere 7 parámetros
// consecutivos a partir de `desdeParam` con los patrones (ver PARAMS_OFERTA): precio, enlace, disponible, condiciones, ubicación, enlaceProducto, cotizacion.
export function sqlOfertaLateral(desdeParam) {
  const p = k => `$${desdeParam + k}`;
  const completa = `(m.contenido_texto ~* ${p(0)} AND (m.contenido_texto ~* ${p(1)} OR m.contenido_texto ~* ${p(2)}) AND (m.contenido_texto ~* ${p(3)} OR m.contenido_texto ~* ${p(4)}))`;
  const cotizada = `(m.contenido_texto ~* ${p(0)} AND (m.contenido_texto ~* ${p(1)} OR m.contenido_texto ~* ${p(2)}))`;
  const enlace = `(m.contenido_texto !~* ${p(0)} AND m.contenido_texto ~* ${p(5)})`;
  const cotizacion = `(m.contenido_texto ~* ${p(6)})`;
  return `LEFT JOIN LATERAL (
    SELECT bool_or(${completa}) AS oferta_completa, bool_or(${cotizada}) AS oferta_cotizada, bool_or(${enlace}) AS oferta_enlace, bool_or(${cotizacion}) AS oferta_cotizacion,
           MIN(m.marca_tiempo) FILTER (WHERE ${cotizada} OR ${enlace} OR ${cotizacion}) AS oferta_en
    FROM whatsapp_mensajes m WHERE m.conversacion_id = c.id AND m.direccion = 'out' AND m.contenido_texto IS NOT NULL
  ) ofe ON true`;
}
export const PARAMS_OFERTA = () => [PATRONES_OFERTA.precio, PATRONES_OFERTA.enlace, PATRONES_OFERTA.disponible, PATRONES_OFERTA.condiciones, PATRONES_OFERTA.ubicacion, PATRONES_OFERTA.enlaceProducto, PATRONES_OFERTA.cotizacion];

// Fragmento SQL: por conversación (alias "c"), si el CLIENTE pidió una cotización y cuándo. Un solo parámetro: PATRON_SOLICITUD_COTIZACION.
export function sqlSolicitudLateral(param) {
  return `LEFT JOIN LATERAL (
    SELECT bool_or(m.contenido_texto ~* $${param}) AS solicito, MIN(m.marca_tiempo) FILTER (WHERE m.contenido_texto ~* $${param}) AS solicito_en
    FROM whatsapp_mensajes m WHERE m.conversacion_id = c.id AND m.direccion = 'in' AND m.contenido_texto IS NOT NULL
  ) sol ON true`;
}
export const PARAM_SOLICITUD = () => PATRON_SOLICITUD_COTIZACION;

// Nivel de la fila devuelta por sqlOfertaLateral (y, si se unió, sqlSolicitudLateral: columna "solicito")
export const nivelDesdeFilaSql = r => (r.oferta_completa ? 'completa' : r.oferta_cotizada ? 'cotizada' : r.oferta_enlace ? 'enlace' : r.oferta_cotizacion ? 'cotizacion' : r.solicito ? 'solicitada' : null);

// Estadística de conversión a partir de filas { intencion, categoria, vendida, oferta: nivel|null, minutosAOferta }
export function resumirConversionComercial(filas) {
  const pct = (n, t) => (t > 0 ? Math.round((n / t) * 1000) / 10 : 0);
  const total = filas.length;
  const conIntencion = filas.filter(f => f.intencion === 'compra');
  const conversiones = filas.filter(f => esConversion(f.oferta));
  const enviadas = filas.filter(f => esCotizacionEnviada(f.oferta));
  const soloSolicitadas = filas.filter(f => f.oferta === 'solicitada');
  const completas = filas.filter(f => esOfertaCompleta(f.oferta));
  const conEnlace = filas.filter(f => f.oferta === 'enlace');
  const ventas = filas.filter(f => f.vendida);
  const ventasConConversion = ventas.filter(f => esConversion(f.oferta));
  const intencionSinConversion = conIntencion.filter(f => !esConversion(f.oferta) && !f.vendida);
  const minutos = enviadas.map(f => f.minutosAOferta).filter(v => v != null && v >= 0).sort((a, b) => a - b);
  const mediana = minutos.length ? (minutos.length % 2 ? minutos[(minutos.length - 1) / 2] : (minutos[minutos.length / 2 - 1] + minutos[minutos.length / 2]) / 2) : null;
  const porCategoria = new Map();
  for (const f of filas) {
    const k = f.categoria || 'sin_categoria';
    const e = porCategoria.get(k) || { categoria: k, conversaciones: 0, conversiones: 0, enviadas: 0, soloSolicitadas: 0, completas: 0, ventas: 0 };
    e.conversaciones++; if (esConversion(f.oferta)) e.conversiones++; if (esCotizacionEnviada(f.oferta)) e.enviadas++; if (f.oferta === 'solicitada') e.soloSolicitadas++;
    if (esOfertaCompleta(f.oferta)) e.completas++; if (f.vendida) e.ventas++;
    porCategoria.set(k, e);
  }
  return {
    conversaciones: total, conIntencionCompra: conIntencion.length,
    // "conversiones" = cotizaciones: enviadas por el negocio + las que solo pidió el cliente
    conversiones: conversiones.length, ofertas: conversiones.length, // "ofertas" = nombre anterior
    cotizacionesEnviadas: enviadas.length, soloSolicitadas: soloSolicitadas.length,
    ofertasCompletas: completas.length, soloEnlace: conEnlace.length,
    pctConversionSobreConversaciones: pct(conversiones.length, total),
    ventas: ventas.length, ventasConConversion: ventasConConversion.length, ventasConOferta: ventasConConversion.length,
    pctVentaSobreConversion: pct(conversiones.filter(f => f.vendida).length, conversiones.length), conversionDeOfertas: pct(conversiones.filter(f => f.vendida).length, conversiones.length),
    intencionSinConversion: intencionSinConversion.length, intencionSinOferta: intencionSinConversion.length,
    medianaMinutosAOferta: mediana,
    porCategoria: [...porCategoria.values()].map(e => ({ ...e, ofertas: e.conversiones, pctConversion: pct(e.conversiones, e.conversaciones), pctOferta: pct(e.conversiones, e.conversaciones), conversion: pct(e.conversiones, e.conversaciones), pctVenta: pct(e.ventas, e.conversaciones) })).sort((a, b) => b.conversaciones - a.conversaciones),
  };
}

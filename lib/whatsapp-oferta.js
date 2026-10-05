// /lib/whatsapp-oferta.js
// "Oferta entregada": el negocio le respondió al cliente con lo que necesita para decidir -- que el producto está disponible,
// el precio, un enlace al producto, las condiciones (garantía, instalación, medios de pago) y dónde y cuándo atendemos.
// Para IndexStore eso ES una conversión comercial: la venta de productos técnicos es conversacional y el cliente puede
// decidir después o comparar con otro proveedor, pero la oportunidad quedó planteada con toda la información.
//
// Los patrones son cadenas simples que sirven igual en JavaScript (RegExp, flag "i") y en PostgreSQL (operador ~*), para que la
// detección en el análisis y en las consultas SQL sea la misma.
export const PATRONES_OFERTA = {
  precio: '\\$\\s?[0-9]{1,3}([.,][0-9]{3})+|\\$\\s?[0-9]{4,}|precio[^0-9]{0,14}[0-9]',
  enlace: 'indexstore\\.cl/(products|collections|pages)|https?://',
  disponible: 'disponible|en stock|tenemos (el|la|los|las|stock)|hay stock|stock disponible',
  condiciones: 'garant|instalaci|despacho|retiro|medios de pago|env[ií]o',
  ubicacion: 'concepci[oó]n|providencia|ubicad|horario|metro pedro|lun a|lunes a',
};
const RE = Object.fromEntries(Object.entries(PATRONES_OFERTA).map(([k, v]) => [k, new RegExp(v, 'i')]));

// Nivel de un mensaje del negocio:
//   'completa': precio + (enlace o disponibilidad) + (condiciones o ubicación)  -> la ficha de oferta típica
//   'cotizada': precio + (enlace o disponibilidad)                              -> le dimos el precio y por dónde verlo
//   'precio'  : solo un precio
export function nivelOfertaMensaje(texto) {
  const t = String(texto || '');
  if (!t) return null;
  const precio = RE.precio.test(t);
  if (!precio) return null;
  const respaldo = RE.enlace.test(t) || RE.disponible.test(t);
  if (!respaldo) return 'precio';
  return (RE.condiciones.test(t) || RE.ubicacion.test(t)) ? 'completa' : 'cotizada';
}
const ORDEN = { precio: 1, cotizada: 2, completa: 3 };
export function mejorNivelOferta(mensajesSalientes) {
  let mejor = null;
  for (const m of mensajesSalientes || []) {
    const n = nivelOfertaMensaje(typeof m === 'string' ? m : m && m.texto != null ? m.texto : m && m.contenido_texto);
    if (n && (!mejor || ORDEN[n] > ORDEN[mejor])) mejor = n;
  }
  return mejor;
}
export const esOfertaEntregada = nivel => nivel === 'completa' || nivel === 'cotizada'; // "oferta" para el embudo: precio + dónde verlo
export const esOfertaCompleta = nivel => nivel === 'completa';

// Fragmento SQL: por conversación (alias "c"), el mejor nivel de oferta que el negocio le envió y cuándo. Requiere 5 parámetros
// consecutivos a partir de `desdeParam` con los patrones: precio, enlace, disponible, condiciones, ubicación.
export function sqlOfertaLateral(desdeParam) {
  const p = k => `$${desdeParam + k}`;
  const completa = `(m.contenido_texto ~* ${p(0)} AND (m.contenido_texto ~* ${p(1)} OR m.contenido_texto ~* ${p(2)}) AND (m.contenido_texto ~* ${p(3)} OR m.contenido_texto ~* ${p(4)}))`;
  const cotizada = `(m.contenido_texto ~* ${p(0)} AND (m.contenido_texto ~* ${p(1)} OR m.contenido_texto ~* ${p(2)}))`;
  return `LEFT JOIN LATERAL (
    SELECT bool_or(${completa}) AS oferta_completa, bool_or(${cotizada}) AS oferta_cotizada,
           MIN(m.marca_tiempo) FILTER (WHERE ${cotizada}) AS oferta_en
    FROM whatsapp_mensajes m WHERE m.conversacion_id = c.id AND m.direccion = 'out' AND m.contenido_texto IS NOT NULL
  ) ofe ON true`;
}
export const PARAMS_OFERTA = () => [PATRONES_OFERTA.precio, PATRONES_OFERTA.enlace, PATRONES_OFERTA.disponible, PATRONES_OFERTA.condiciones, PATRONES_OFERTA.ubicacion];

// Estadística de conversión comercial a partir de filas { intencion, categoria, vendida, oferta: 'completa'|'cotizada'|null, minutosAOferta }
export function resumirConversionComercial(filas) {
  const pct = (n, t) => (t > 0 ? Math.round((n / t) * 1000) / 10 : 0);
  const total = filas.length;
  const conIntencion = filas.filter(f => f.intencion === 'compra');
  const conOferta = filas.filter(f => esOfertaEntregada(f.oferta));
  const completas = filas.filter(f => esOfertaCompleta(f.oferta));
  const ventas = filas.filter(f => f.vendida);
  const ventasConOferta = ventas.filter(f => esOfertaEntregada(f.oferta));
  const intencionSinOferta = conIntencion.filter(f => !esOfertaEntregada(f.oferta) && !f.vendida);
  const minutos = conOferta.map(f => f.minutosAOferta).filter(v => v != null && v >= 0).sort((a, b) => a - b);
  const mediana = minutos.length ? (minutos.length % 2 ? minutos[(minutos.length - 1) / 2] : (minutos[minutos.length / 2 - 1] + minutos[minutos.length / 2]) / 2) : null;
  const porCategoria = new Map();
  for (const f of filas) {
    const k = f.categoria || 'sin_categoria';
    const e = porCategoria.get(k) || { categoria: k, conversaciones: 0, ofertas: 0, completas: 0, ventas: 0 };
    e.conversaciones++; if (esOfertaEntregada(f.oferta)) e.ofertas++; if (esOfertaCompleta(f.oferta)) e.completas++; if (f.vendida) e.ventas++;
    porCategoria.set(k, e);
  }
  return {
    conversaciones: total, conIntencionCompra: conIntencion.length,
    ofertas: conOferta.length, ofertasCompletas: completas.length,
    pctOfertaSobreIntencion: pct(conIntencion.filter(f => esOfertaEntregada(f.oferta)).length, conIntencion.length),
    ventas: ventas.length, ventasConOferta: ventasConOferta.length,
    conversionDeOfertas: pct(conOferta.filter(f => f.vendida).length, conOferta.length),
    intencionSinOferta: intencionSinOferta.length,
    medianaMinutosAOferta: mediana,
    porCategoria: [...porCategoria.values()].map(e => ({ ...e, pctOferta: pct(e.ofertas, e.conversaciones), conversion: pct(e.ventas, e.conversaciones) })).sort((a, b) => b.conversaciones - a.conversaciones),
  };
}

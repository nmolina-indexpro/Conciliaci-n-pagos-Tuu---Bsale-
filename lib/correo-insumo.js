// /lib/correo-insumo.js
// Aviso por correo de un insumo de Servicio Técnico en STOCK CRÍTICO: el técnico lo marca y sugiere cuántas unidades comprar.
// Incluye el link de compra. Función pura (sin red ni base de datos), con el diseño estándar de lib/correo-base.js. Sin montos ni costos.
import { esc, num, plural, tarjetas, avisos, seccion, datos, armarCorreo, tabla, chip, enlace, masEnElErp } from './correo-base.js';

export const RELEVANCIA_TEXTO = { diario: 'Uso diario', ocasional: 'Uso ocasional', no_se_utiliza: 'No se utiliza' };
const esLinkValido = (l) => /^https?:\/\//i.test(String(l || '').trim());
const fechaCorta = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// insumo: { sku, nombre, stock, ultimaFecha, proveedor, relevancia, comentario }; sugerencia: unidades a comprar; link: link de compra guardado (o null);
// por: quién lo marcó; actualizacion: true si es un cambio de la sugerencia de un insumo que ya estaba crítico.
export function armarCorreoInsumoCritico({ insumo, sugerencia, link, por, actualizacion = false, urlBase = 'https://erp.indexstore.cl', ejemplo = false }) {
  const stock = Number(insumo.stock) || 0;
  const conLink = esLinkValido(link);
  const kpis = tarjetas([
    { etiqueta: '📉 Stock actual', cifra: num(stock), sub: stock <= 0 ? 'sin stock' : plural(stock, 'unidad', 'unidades'), tono: stock <= 0 ? 'rojo' : 'naranja' },
    { etiqueta: '🛒 Comprar', cifra: num(sugerencia), sub: `${plural(sugerencia, 'unidad sugerida', 'unidades sugeridas')} por quien lo usa`, tono: 'azul' },
    { etiqueta: '🔧 Uso', cifra: esc(RELEVANCIA_TEXTO[insumo.relevancia] || 'Sin definir'), sub: 'qué tan seguido se necesita', tono: insumo.relevancia === 'diario' ? 'rojo' : 'gris' },
  ]);
  const alertas = [{ tono: 'rojo', texto: `<b>${actualizacion ? 'Se actualizó la sugerencia de compra' : 'Hay que comprar este insumo'}:</b> ${esc(por || 'el técnico')} lo marcó como stock crítico y sugiere comprar <b>${num(sugerencia)} ${plural(sugerencia, 'unidad', 'unidades')}</b>.` }];
  if (!conLink) alertas.push({ tono: 'amarillo', texto: 'Este insumo <b>no tiene un link de compra guardado</b>. Agrégalo en el ERP (Insumos de Servicio Técnico, botón ✏️ de la columna "Link de compra") para comprar más rápido la próxima vez.' });
  const detalle = seccion('El insumo', '', datos([
    ['Insumo', `<b>${esc(insumo.nombre || insumo.sku)}</b>`], ['SKU', esc(insumo.sku)],
    ['Último ingreso', fechaCorta(insumo.ultimaFecha) ? esc(fechaCorta(insumo.ultimaFecha)) : ''],
    ['Proveedor habitual', esc(insumo.proveedor)],
    ['Comentario del técnico', esc(insumo.comentario)],
  ]));
  const html = armarCorreo({
    etiqueta: 'IndexStore · Compras', titulo: 'Insumo en stock crítico', subtitulo: `${esc(insumo.nombre || insumo.sku)}${ejemplo ? ' · EJEMPLO' : ''}`,
    cuerpo: kpis + avisos(alertas) + detalle,
    boton: conLink ? { url: String(link).trim(), texto: '🛒 Comprar este insumo' } : { url: `${urlBase}/insumos-servicio-tecnico.html`, texto: 'Abrir Insumos de Servicio Técnico' },
    botones: conLink ? [{ url: `${urlBase}/insumos-servicio-tecnico.html`, texto: 'Ver en el ERP' }] : [],
    leyenda: 'este aviso sale al instante cuando alguien de Servicio Técnico marca un insumo como stock crítico en el ERP, con las unidades que recomienda comprar. Si cambia la sugerencia mientras sigue crítico, llega un aviso nuevo.',
  });
  const asunto = `${actualizacion ? 'Actualización: ' : 'Comprar: '}${insumo.nombre || insumo.sku} — stock crítico, sugiere ${num(sugerencia)} ${plural(sugerencia, 'unidad', 'unidades')}${ejemplo ? ' [EJEMPLO]' : ''}`;
  return { asunto, html };
}

const MAX_FILAS_AGRUPADO = 40;

// Correo agrupado: varios insumos marcados en stock crítico en una misma tanda (Servicio Técnico va marcando uno tras otro y compras recibe UN solo aviso).
// items: [{ sku, nombre, stock, sugerencia, relevancia, comentario, link, por, actualizacion, proveedor, ultimaFecha }]. Con un solo insumo usa el correo individual.
export function armarCorreoInsumosCriticos({ items, urlBase = 'https://erp.indexstore.cl', ejemplo = false }) {
  const lista = Array.isArray(items) ? items : [];
  if (lista.length === 1) {
    const i = lista[0];
    return armarCorreoInsumoCritico({ insumo: i, sugerencia: i.sugerencia, link: i.link, por: i.por, actualizacion: !!i.actualizacion, urlBase, ejemplo });
  }
  const sinLink = lista.filter((i) => !esLinkValido(i.link));
  const sinStock = lista.filter((i) => !(Number(i.stock) > 0));
  const nuevos = lista.filter((i) => !i.actualizacion).length;
  const quienes = [...new Set(lista.map((i) => i.por).filter(Boolean))];
  const kpis = tarjetas([
    { etiqueta: '📉 Insumos en stock crítico', cifra: num(lista.length), sub: `${num(nuevos)} ${plural(nuevos, 'nuevo', 'nuevos')}${lista.length - nuevos ? ` · ${num(lista.length - nuevos)} con cambio de cantidad` : ''}`, tono: 'rojo' },
    { etiqueta: '🚫 Sin stock', cifra: num(sinStock.length), sub: sinStock.length ? 'quedaron en cero' : 'todos con algo de stock', tono: sinStock.length ? 'naranja' : 'gris' },
    { etiqueta: '🔗 Sin link de compra', cifra: num(sinLink.length), sub: sinLink.length ? 'hay que buscar dónde comprarlos' : 'todos con link', tono: sinLink.length ? 'amarillo' : 'gris' },
  ]);
  const alertas = [{ tono: 'rojo', texto: `<b>Hay que comprar ${num(lista.length)} ${plural(lista.length, 'insumo', 'insumos')}:</b> ${esc(quienes.join(', ') || 'Servicio Técnico')} ${quienes.length > 1 ? 'los marcaron' : 'los marcó'} como stock crítico y sugiere las cantidades de la tabla.` }];
  if (sinLink.length) alertas.push({ tono: 'amarillo', texto: `<b>${num(sinLink.length)} ${plural(sinLink.length, 'insumo no tiene', 'insumos no tienen')} link de compra guardado.</b> Agrégalo en el ERP (Insumos de Servicio Técnico, columna "Link de compra") para comprar más rápido la próxima vez.` });
  const filas = lista.slice(0, MAX_FILAS_AGRUPADO).map((i) => [
    `<b>${esc(i.nombre || i.sku)}</b><br><span style="color:#64748b;font-size:11.5px;">SKU ${esc(i.sku)}${i.comentario ? ` · ${esc(i.comentario)}` : ''}</span>`,
    esc(num(Number(i.stock) || 0)),
    `<b>${esc(num(i.sugerencia))}</b>`,
    esc(RELEVANCIA_TEXTO[i.relevancia] || '—'),
    i.actualizacion ? chip('Cambió la cantidad', 'amarillo') : chip('Nuevo', 'rojo'),
    esConLink(i) ? enlace(String(i.link).trim(), '🛒 Comprar') : '<span style="color:#94a3b8;">sin link</span>',
  ]);
  const detalle = seccion('Qué hay que comprar', 'Cantidad sugerida por quien usa cada insumo, con el link para comprarlo.',
    tabla([{ titulo: 'Insumo' }, { titulo: 'Stock', alinear: 'right', ancho: 50 }, { titulo: 'Comprar', alinear: 'right', ancho: 60 }, { titulo: 'Uso' }, { titulo: 'Estado' }, { titulo: 'Link' }], filas,
      { pie: lista.length > MAX_FILAS_AGRUPADO ? masEnElErp(lista.length - MAX_FILAS_AGRUPADO, 'Insumos de Servicio Técnico') : null }));
  const html = armarCorreo({
    etiqueta: 'IndexStore · Compras', titulo: 'Insumos en stock crítico', subtitulo: `${num(lista.length)} ${plural(lista.length, 'insumo por comprar', 'insumos por comprar')}${ejemplo ? ' · EJEMPLO' : ''}`,
    cuerpo: kpis + avisos(alertas) + detalle,
    boton: { url: `${urlBase}/insumos-servicio-tecnico.html`, texto: 'Abrir Insumos de Servicio Técnico' },
    leyenda: 'este aviso junta todo lo que Servicio Técnico marcó como stock crítico: se envía UN solo correo cuando pasan unos minutos sin cambios nuevos (no uno por insumo). Cuando compres, registra "Comprado" y la fecha de llegada en el ERP para que el técnico sepa que viene en camino.',
  });
  const asunto = `Comprar: ${num(lista.length)} insumos en stock crítico${ejemplo ? ' [EJEMPLO]' : ''}`;
  return { asunto, html };
}
function esConLink(i) { return esLinkValido(i && i.link); }

// /lib/correo-insumo.js
// Aviso por correo de un insumo de Servicio Técnico en STOCK CRÍTICO: el técnico lo marca y sugiere cuántas unidades comprar.
// Incluye el link de compra. Función pura (sin red ni base de datos), con el diseño estándar de lib/correo-base.js. Sin montos ni costos.
import { esc, num, plural, tarjetas, avisos, seccion, datos, armarCorreo } from './correo-base.js';

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

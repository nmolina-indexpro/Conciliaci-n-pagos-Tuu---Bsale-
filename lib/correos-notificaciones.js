// /lib/correos-notificaciones.js
// ══════════════════════════════════════════════════════════════════════
// Correos de notificación con el diseño estándar del ERP (ver lib/correo-base.js): alertas de Sitio web, cambios en Productos estancados y lead nuevo de
// indexscale.cl. Funciones puras (sin red ni base de datos). Sin montos de la empresa: solo cantidades; los precios que aparecen en las alertas del sitio
// son precios de lista de producto (Bsale vs. Shopify), no ventas ni costos.
// ══════════════════════════════════════════════════════════════════════
import { esc, num, plural, chip, enlace, tarjetas, avisos, vacio, seccion, tabla, datos, masEnElErp, armarCorreo, fechaLarga, hoyChile } from './correo-base.js';

const MAX_FILAS = 15;
const pesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL'); // precio de lista de un producto

// ── Alertas de Sitio web (precio / stock) ──────────────────────────────────────────────────────────────
export function armarCorreoAlertasSitioWeb({ stockNoVisible = [], preciosDistintos = [], preciosDesincronizados = [], skusIncorrectosReferencia = [], listaPrecioBsaleNombre = '', urlBase, ahora = new Date() }) {
  const nStock = stockNoVisible.length, nPrecio = preciosDistintos.length, nDesinc = preciosDesincronizados.length, nSku = skusIncorrectosReferencia.length;
  const nPrecios = nPrecio + nDesinc;
  const lista = listaPrecioBsaleNombre || '—';

  const cuerpoTabla = (cols, filas, total) => tabla(cols, filas.slice(0, MAX_FILAS), { pie: total > MAX_FILAS ? masEnElErp(total - MAX_FILAS, 'la página Sitio Web del ERP') : null });
  const bloques = [];
  if (nPrecio) bloques.push(seccion(`💲 Precio distinto entre Bsale y Shopify`, `${num(nPrecio)} ${plural(nPrecio, 'producto', 'productos')}. Precio de Bsale (con IVA) según la lista "${esc(lista)}".`,
    cuerpoTabla([{ titulo: 'SKU' }, { titulo: 'Producto' }, { titulo: 'Bsale', alinear: 'right' }, { titulo: 'Shopify', alinear: 'right' }, { titulo: '', alinear: 'right' }],
      preciosDistintos.map(p => [`<b>${esc(p.sku)}</b>`, esc(p.nombre || ''), pesos(p.precioBsale), `<b style="color:#B91C1C;">${pesos(p.precioShopify)}</b>`, enlace(p.adminUrl, 'Shopify')]), nPrecio)));
  if (nDesinc) bloques.push(seccion(`💲 Productos "de referencia" con precio distinto al de Bsale`, `${num(nDesinc)} ${plural(nDesinc, 'listado', 'listados')} de pantalla, batería o cargador por modelo. Precio de Bsale (con IVA) según la lista "${esc(lista)}".`,
    cuerpoTabla([{ titulo: 'Listado' }, { titulo: 'SKU que representa' }, { titulo: 'Este listado', alinear: 'right' }, { titulo: 'Bsale', alinear: 'right' }, { titulo: '', alinear: 'right' }],
      preciosDesincronizados.map(p => [esc(p.titulo || ''), `<b>${esc(p.skuBase)}</b>`, `<b style="color:#B91C1C;">${pesos(p.precioPropio)}</b>`, pesos(p.precioCanonico), enlace(p.adminUrl, 'Shopify')]), nDesinc)));
  if (nSku) bloques.push(seccion(`⚠️ SKU base mal cargado`, `${num(nSku)} ${plural(nSku, 'producto', 'productos')} "de referencia". El metacampo (probablemente copiado de otra plantilla) apunta a un producto distinto al real: hay que corregir el metacampo en Shopify, no el precio.`,
    cuerpoTabla([{ titulo: 'Listado' }, { titulo: 'El metacampo dice' }, { titulo: 'Producto real' }, { titulo: '', alinear: 'right' }],
      skusIncorrectosReferencia.map(p => [esc(p.titulo || ''), `<b>${esc(p.skuBase)}</b>`, `<b>${esc(p.skuProductoReal)}</b>`, enlace(p.adminUrl, 'Shopify')]), nSku)));
  if (nStock) bloques.push(seccion(`📦 Con stock pero no visibles en la tienda`, `${num(nStock)} ${plural(nStock, 'producto', 'productos')} con stock disponible en borrador o archivados.`,
    cuerpoTabla([{ titulo: 'SKU' }, { titulo: 'Producto' }, { titulo: 'Stock', alinear: 'right' }, { titulo: 'Estado' }, { titulo: '', alinear: 'right' }],
      stockNoVisible.map(p => [`<b>${esc(p.sku)}</b>`, esc(p.nombre || ''), num(p.stock), chip(p.estado === 'draft' ? 'Borrador' : 'Archivado', 'amarillo'), enlace(p.adminUrl, 'Shopify')]), nStock)));

  const kpis = tarjetas([
    { etiqueta: '💲 Precio distinto', cifra: num(nPrecio), sub: 'Bsale vs. Shopify', tono: nPrecio ? 'rojo' : 'verde' },
    { etiqueta: '🔁 Referencias', cifra: num(nDesinc), sub: 'con precio distinto al de Bsale', tono: nDesinc ? 'rojo' : 'verde' },
    { etiqueta: '⚠️ SKU mal cargado', cifra: num(nSku), sub: 'metacampo apunta a otro producto', tono: nSku ? 'naranja' : 'verde' },
    { etiqueta: '📦 Stock oculto', cifra: num(nStock), sub: 'con stock, no visible', tono: nStock ? 'amarillo' : 'verde' },
  ]);
  const aviso = avisos([
    nPrecios ? { tono: 'rojo', texto: `<b>${num(nPrecios)}</b> ${plural(nPrecios, 'precio no coincide', 'precios no coinciden')} con la lista de Bsale: el cliente ve un precio distinto del que se cobra. Corrígelos en Shopify.` } : null,
    nSku ? { tono: 'naranja', texto: `<b>${num(nSku)}</b> ${plural(nSku, 'listado apunta', 'listados apuntan')} a un SKU equivocado: corrige el metacampo antes de tocar el precio.` } : null,
  ], '🚨 Requiere atención');

  const html = armarCorreo({
    etiqueta: 'IndexStore · Sitio web', titulo: 'Alertas de precio y stock', subtitulo: `${fechaLarga(hoyChile(ahora))} · ${num(nPrecios)} ${plural(nPrecios, 'diferencia de precio', 'diferencias de precio')}`,
    cuerpo: kpis + aviso + (bloques.join('') || vacio('✅ <b>Sin alertas hoy.</b>', 'verde')),
    boton: { url: `${urlBase}/sitio-web.html`, texto: 'Revisar en el ERP · Sitio Web' },
    leyenda: `el correo sale cuando hay diferencias de <b>precio</b>; el stock oculto y el SKU mal cargado se incluyen como contexto. Los precios son de lista de producto (con IVA), según la lista de Bsale "${esc(lista)}". Se muestran hasta ${MAX_FILAS} filas por tabla; el resto está en la página Sitio Web.`,
  });
  const asunto = `⚠ Alertas Sitio Web IndexStore -- ${nStock} sin stock visible, ${nPrecios} con precio distinto${nSku ? `, ${nSku} SKU mal vinculado` : ''}`;
  return { asunto, html };
}

// ── Cambios en Productos estancados ───────────────────────────────────────────────────────────────────
// filas: { sku, campo, valor_nuevo, cambiado_por, cambiado_en }; nombrePorSku: { sku: nombre }; camposInfo: { campo: { titulo, activado, desactivado } }
export function armarCorreoProductosEstancados({ filas = [], nombrePorSku = {}, camposInfo = {}, urlBase, ahora = new Date() }) {
  const total = filas.length;
  const porCampo = new Map();
  for (const f of filas) { if (!porCampo.has(f.campo)) porCampo.set(f.campo, []); porCampo.get(f.campo).push(f); }
  const info = campo => camposInfo[campo] || { titulo: campo, activado: 'Se activó.', desactivado: 'Se desactivó.' };
  const hora = v => new Date(v).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const kpis = tarjetas([...porCampo.entries()].slice(0, 4).map(([campo, lista]) => {
    const act = lista.filter(f => f.valor_nuevo).length;
    return { etiqueta: esc(info(campo).titulo), cifra: num(lista.length), sub: `${num(act)} ${plural(act, 'activado', 'activados')} · ${num(lista.length - act)} ${plural(lista.length - act, 'desactivado', 'desactivados')}`, tono: 'azul' };
  }));
  const bloques = [...porCampo.entries()].map(([campo, lista]) => seccion(esc(info(campo).titulo), `${num(lista.length)} ${plural(lista.length, 'cambio', 'cambios')} en las últimas 24 horas.`,
    tabla([{ titulo: 'SKU' }, { titulo: 'Producto' }, { titulo: 'Cambio' }, { titulo: 'Quién y cuándo' }],
      lista.slice(0, 25).map(f => [`<b>${esc(f.sku)}</b>`, esc(nombrePorSku[f.sku] || f.sku), chip(f.valor_nuevo ? 'Activado' : 'Desactivado', f.valor_nuevo ? 'verde' : 'gris'), `<span style="font-size:12px;color:#475569;">${esc(f.cambiado_por || 'Desconocido')}<br>${hora(f.cambiado_en)}</span>`]),
      { pie: lista.length > 25 ? masEnElErp(lista.length - 25, 'la página Productos estancados') : null }))).join('');

  const html = armarCorreo({
    etiqueta: 'IndexStore · Análisis', titulo: 'Cambios en productos estancados', subtitulo: `${fechaLarga(hoyChile(ahora))} · ${num(total)} ${plural(total, 'cambio', 'cambios')} en las últimas 24 horas`,
    cuerpo: kpis + bloques, boton: { url: `${urlBase}/productos-estancados.html`, texto: 'Abrir Productos estancados en el ERP' },
    leyenda: 'cada tabla agrupa los cambios de una marca de la página Productos estancados (Mercado Libre, envío gratis, variación de precio); se ve quién la cambió y cuándo (hora de Chile).',
  });
  const asunto = `📋 Productos estancados -- ${total} ${plural(total, 'cambio', 'cambios')} en las últimas 24h`;
  return { asunto, html };
}

// ── Lead nuevo en indexscale.cl (aviso al instante) ───────────────────────────────────────────────────
export function armarCorreoLeadWeb(l, { urlBase = 'https://erp.indexstore.cl' } = {}) {
  const tipo = (l.mensaje || '').includes('[Formulario rápido]') ? 'Contacto rápido'
    : ({ demo: 'Demo gratis', express: 'Diagnóstico Express', general: 'Diagnóstico / contacto' }[l.tipo] || 'Formulario');
  const ads = !!(l.gclid || (l.utm_source === 'google' && l.utm_medium === 'cpc'));
  const tel = String(l.telefono || '').replace(/\D/g, '');
  const waNum = tel ? (tel.startsWith('56') ? tel : '56' + tel) : '';
  const d = l.datos || {};
  const detalle = [d.tipo_sitio && 'Tipo de sitio: ' + d.tipo_sitio, d.rubro && 'Rubro: ' + d.rubro, d.dominio_deseado && 'Dominio: ' + d.dominio_deseado, d.sitio && 'Sitio: ' + d.sitio].filter(Boolean).map(esc).join('<br>');
  const kpis = tarjetas([
    { etiqueta: '📝 Formulario', cifra: esc(tipo), sub: 'cómo escribió', tono: 'azul' },
    { etiqueta: '🎯 Origen', cifra: ads ? 'Google Ads' : 'Sitio', sub: ads ? 'vino de un anuncio' : 'visita directa u orgánica', tono: ads ? 'verde' : 'gris' },
    { etiqueta: '💬 Contacto', cifra: esc(l.preferencia_contacto || '—'), sub: 'prefiere ser contactado por', tono: 'gris' },
  ]);
  const html = armarCorreo({
    etiqueta: 'IndexStore · IndexScale', titulo: 'Lead nuevo en indexscale.cl', subtitulo: `${esc(l.nombre || 'Sin nombre')} · ${esc(tipo)}${ads ? ' · Google Ads' : ''}`,
    cuerpo: kpis + avisos([{ tono: 'naranja', texto: '<b>Responde pronto:</b> se prometió contestar en pocas horas.' }])
      + seccion('Datos del lead', '', datos([
        ['Nombre', esc(l.nombre)],
        ['WhatsApp', waNum ? `<a href="https://wa.me/${waNum}" style="color:#0b57d0;text-decoration:none;font-weight:600;">${esc(l.telefono)} ↗</a>` : ''],
        ['Correo', l.email ? `<a href="mailto:${esc(l.email)}" style="color:#0b57d0;text-decoration:none;font-weight:600;">${esc(l.email)}</a>` : ''],
        ['Prefiere ser contactado por', esc(l.preferencia_contacto)],
        ['Página', esc(l.pagina_origen)], ['Campaña', esc(l.utm_campaign)], ['Palabra clave', esc(l.utm_term)], ['Detalle', detalle],
      ])),
    boton: { url: `${urlBase}/indexscale.html`, texto: 'Abrir en el ERP · IndexScale' },
    botones: waNum ? [{ url: `https://wa.me/${waNum}`, texto: 'Escribirle por WhatsApp' }] : [],
    leyenda: 'este aviso sale al instante, cada vez que alguien completa un formulario de indexscale.cl; el lead también queda guardado en el ERP.',
  });
  const asunto = `Lead nuevo en indexscale.cl: ${l.nombre || 'sin nombre'} — ${tipo}${ads ? ' (Google Ads)' : ''}`;
  return { asunto, html };
}

// /lib/home-indicadores.js
// Los 12 indicadores del Home. Sin nada financiero (ni ventas en $, ni márgenes, ni costos, ni pagos) y sin nada de compras (ni stock, ni quiebres, ni coberturas, ni
// pedidos a proveedores, ni envíos en tránsito): solo atención al cliente, actividad comercial, marketing, sitio web y soporte, en cantidades, tiempos y porcentajes.
// Función pura (sin red ni base de datos): api/negocio.js (manejarHomeIndicadores) lee los datos y aquí se arman las tarjetas, para poder probarla.
//
// Cada indicador: { id, area, icono, titulo, valor, sub, enlace, tono: 'ok'|'warn'|'alert'|null, variacion: { pct, tendencia: 'bueno'|'malo'|'neutro' } | null, sinDatos? }

const n = v => Number(v) || 0;
const num = v => Math.round(n(v)).toLocaleString('es-CL');
const plural = (c, uno, varios) => (Number(c) === 1 ? uno : varios);
const pct1 = v => (Math.round(n(v) * 10) / 10).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + '%';

// Variación respecto del período anterior. Si antes era 0 y ahora hay, no se inventa un porcentaje: queda null (la tarjeta dice "nuevo").
export function variacion(actual, anterior, subeEsBueno = true) {
  actual = n(actual); anterior = n(anterior);
  if (anterior === 0) return actual === 0 ? null : { pct: null, nuevo: true, tendencia: 'neutro' };
  const pct = Math.round(((actual - anterior) / anterior) * 1000) / 10;
  if (pct === 0) return { pct: 0, tendencia: 'neutro' };
  return { pct, tendencia: (pct > 0) === subeEsBueno ? 'bueno' : 'malo' };
}

export function duracion(seg) {
  if (seg == null) return '—';
  const s = Math.round(Number(seg));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 && m < 10 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? `${h} h ${rm} min` : `${h} h`;
}

const ENLACES = {
  whatsapp: 'clientes-whatsapp.html', ejecutivos: 'ejecutivos-whatsapp.html', cotizaciones: 'cotizaciones-clientes.html', indexscale: 'indexscale.html',
  ads: 'google-ads.html', web: 'sitio-web.html', buscador: 'buscador-ia.html', compat: 'modelos-compatibles.html', soporte: 'reportar-error.html',
};

// d: datos ya leídos (cada bloque puede venir null si no se pudo leer: ese indicador se muestra "sin datos" en vez de tumbar el resto).
//   d.dias, d.wa, d.seguimientos, d.cotizaciones, d.leads, d.ads, d.buscador, d.alertasWeb, d.compat, d.soporte, d.esAdmin
export function armarIndicadores(d) {
  const periodo = d.dias === 1 ? 'hoy' : `últimos ${d.dias} días`;
  const sinDatos = (id, area, icono, titulo, enlace) => ({ id, area, icono, titulo, valor: '—', sub: 'No se pudo leer este dato', enlace, tono: null, variacion: null, sinDatos: true });
  const lista = [];
  const wa = d.wa;

  // ── WhatsApp: atención ──────────────────────────────────────────────────────────────────────────────────────
  lista.push(!wa ? sinDatos('wa-nuevas', 'WhatsApp', '💬', 'Conversaciones nuevas', ENLACES.whatsapp) : {
    id: 'wa-nuevas', area: 'WhatsApp', icono: '💬', titulo: 'Conversaciones nuevas', valor: num(wa.nuevas), enlace: ENLACES.whatsapp, tono: null,
    sub: `${periodo}${d.dias > 1 ? ` · ${(n(wa.nuevas) / d.dias).toLocaleString('es-CL', { maximumFractionDigits: 1 })} por día` : ''}`,
    variacion: d.dias >= 1 ? variacion(wa.nuevas, wa.nuevas_prev, true) : null,
  });
  lista.push(!wa ? sinDatos('wa-respuesta', 'WhatsApp', '⏱️', 'Primera respuesta (mediana)', ENLACES.ejecutivos) : {
    id: 'wa-respuesta', area: 'WhatsApp', icono: '⏱️', titulo: 'Primera respuesta (mediana)', enlace: ENLACES.ejecutivos,
    valor: wa.mediana_seg != null ? duracion(wa.mediana_seg) : '—',
    sub: n(wa.con_resp) ? `${pct1((n(wa.bajo_5) / n(wa.con_resp)) * 100)} se respondió en menos de 5 min · ${periodo}` : `sin respuestas medidas ${periodo}`,
    tono: wa.mediana_seg == null ? null : wa.mediana_seg > 600 ? 'alert' : wa.mediana_seg > 300 ? 'warn' : 'ok',
    variacion: wa.mediana_seg != null && wa.mediana_prev_seg != null ? variacion(wa.mediana_seg, wa.mediana_prev_seg, false) : null,
  });
  lista.push(!wa ? sinDatos('wa-sin-respuesta', 'WhatsApp', '🔕', 'Sin responder', ENLACES.whatsapp) : {
    id: 'wa-sin-respuesta', area: 'WhatsApp', icono: '🔕', titulo: 'Sin responder', valor: num(wa.sin_resp), enlace: ENLACES.whatsapp,
    sub: `${plural(wa.sin_resp, 'conversación', 'conversaciones')} donde el cliente escribió y no hubo respuesta · ${periodo}`,
    tono: n(wa.sin_resp) > 0 ? 'alert' : 'ok', variacion: variacion(wa.sin_resp, wa.sin_resp_prev, false),
  });
  lista.push(!d.seguimientos ? sinDatos('wa-seguimientos', 'WhatsApp', '📌', 'Seguimientos pendientes', ENLACES.whatsapp) : {
    id: 'wa-seguimientos', area: 'WhatsApp', icono: '📌', titulo: 'Seguimientos pendientes', valor: num(d.seguimientos.n), enlace: ENLACES.whatsapp,
    sub: `conversaciones que quedaron por retomar · últimos 30 días`, tono: n(d.seguimientos.n) > 0 ? 'warn' : 'ok', variacion: null,
  });
  lista.push(!wa ? sinDatos('wa-conversion', 'WhatsApp', '🤝', 'Conversaciones con venta', ENLACES.whatsapp) : {
    id: 'wa-conversion', area: 'WhatsApp', icono: '🤝', titulo: 'Conversaciones con venta',
    valor: n(wa.nuevas) ? pct1((n(wa.ventas) / n(wa.nuevas)) * 100) : '—', enlace: ENLACES.whatsapp, tono: null,
    sub: `${num(wa.ventas)} ${plural(wa.ventas, 'venta detectada', 'ventas detectadas')} de ${num(wa.nuevas)} conversaciones · ${periodo}`,
    variacion: n(wa.nuevas) && n(wa.nuevas_prev) ? variacion((n(wa.ventas) / n(wa.nuevas)) * 100, (n(wa.ventas_prev) / n(wa.nuevas_prev)) * 100, true) : null,
  });

  // ── Comercial ───────────────────────────────────────────────────────────────────────────────────────────────
  const c = d.cotizaciones;
  lista.push(!c ? sinDatos('cot-sin-contactar', 'Comercial', '🧾', 'Cotizaciones sin contactar', ENLACES.cotizaciones) : {
    id: 'cot-sin-contactar', area: 'Comercial', icono: '🧾', titulo: 'Cotizaciones sin contactar', valor: num(c.sin_contactar), enlace: ENLACES.cotizaciones,
    sub: n(c.mas_3_dias) ? `${num(c.mas_3_dias)} con más de 3 días esperando · últimos 30 días` : `ninguna lleva más de 3 días · últimos 30 días`,
    tono: n(c.mas_3_dias) > 0 ? 'alert' : n(c.sin_contactar) > 0 ? 'warn' : 'ok', variacion: null,
  });
  const l = d.leads;
  lista.push(!l ? sinDatos('leads-indexscale', 'Comercial', '🎯', 'Leads IndexScale sin atender', ENLACES.indexscale) : {
    id: 'leads-indexscale', area: 'Comercial', icono: '🎯', titulo: 'Leads IndexScale sin atender', valor: num(l.sin_atender), enlace: ENLACES.indexscale,
    sub: `${num(l.nuevos_periodo)} ${plural(l.nuevos_periodo, 'lead nuevo', 'leads nuevos')} del formulario · ${periodo}`,
    tono: n(l.sin_atender) > 0 ? 'alert' : 'ok', variacion: variacion(l.nuevos_periodo, l.nuevos_prev, true),
  });

  // ── Marketing ───────────────────────────────────────────────────────────────────────────────────────────────
  const a = d.ads;
  lista.push(!a ? sinDatos('ads-conversaciones', 'Marketing', '📣', 'Mensajes desde Google Ads', ENLACES.ads) : {
    id: 'ads-conversaciones', area: 'Marketing', icono: '📣', titulo: 'Mensajes desde Google Ads', valor: num(a.con_mensaje), enlace: ENLACES.ads, tono: null,
    sub: `${num(a.toques)} ${plural(a.toques, 'toque', 'toques')} al botón de WhatsApp, ${n(a.toques) ? pct1((n(a.con_mensaje) / n(a.toques)) * 100) : '0%'} llegó a escribir · ${periodo}`,
    variacion: variacion(a.con_mensaje, a.con_mensaje_prev, true),
  });

  // ── Sitio web ───────────────────────────────────────────────────────────────────────────────────────────────
  const b = d.buscador;
  lista.push(!b ? sinDatos('buscador-sin-resultado', 'Sitio web', '🔎', 'Búsquedas sin resultado', ENLACES.buscador) : {
    id: 'buscador-sin-resultado', area: 'Sitio web', icono: '🔎', titulo: 'Búsquedas sin resultado',
    valor: n(b.total) ? pct1((n(b.sin_resultado) / n(b.total)) * 100) : '—', enlace: ENLACES.buscador,
    sub: `${num(b.sin_resultado)} de ${num(b.total)} ${plural(b.total, 'búsqueda', 'búsquedas')} en el buscador con IA · ${periodo}`,
    tono: n(b.total) && n(b.sin_resultado) / n(b.total) > 0.25 ? 'warn' : null,
    variacion: n(b.total) && n(b.total_prev) ? variacion((n(b.sin_resultado) / n(b.total)) * 100, (n(b.sin_resultado_prev) / n(b.total_prev)) * 100, false) : null,
  });
  const w = d.alertasWeb;
  const totalWeb = w ? n(w.stockNoVisible) + n(w.preciosDistintos) + n(w.preciosDesincronizados) + n(w.skusIncorrectos) : 0;
  lista.push(!w ? { ...sinDatos('web-alertas', 'Sitio web', '🌐', 'Alertas del sitio web', ENLACES.web), sub: 'Aún no hay una revisión guardada del sitio' } : {
    id: 'web-alertas', area: 'Sitio web', icono: '🌐', titulo: 'Alertas del sitio web', valor: num(totalWeb), enlace: ENLACES.web, variacion: null,
    sub: totalWeb ? [n(w.stockNoVisible) && `${num(w.stockNoVisible)} con stock que no se ve en la web`, n(w.preciosDistintos) && `${num(w.preciosDistintos)} ${plural(w.preciosDistintos, 'precio distinto', 'precios distintos')} a Bsale`,
      n(w.preciosDesincronizados) && `${num(w.preciosDesincronizados)} ${plural(w.preciosDesincronizados, 'precio desincronizado', 'precios desincronizados')}`, n(w.skusIncorrectos) && `${num(w.skusIncorrectos)} ${plural(w.skusIncorrectos, 'SKU de referencia incorrecto', 'SKU de referencia incorrectos')}`].filter(Boolean).join(' · ') : 'Todo en orden entre la web y Bsale',
    tono: totalWeb > 0 ? 'warn' : 'ok',
  });
  const m = d.compat;
  lista.push(!m ? sinDatos('compat-pendientes', 'Sitio web', '🔧', 'Modelos compatibles por aprobar', ENLACES.compat) : {
    id: 'compat-pendientes', area: 'Sitio web', icono: '🔧', titulo: 'Modelos compatibles por aprobar', valor: num(m.n), enlace: ENLACES.compat, variacion: null,
    sub: n(m.n) ? `la más antigua lleva ${num(m.dias_mas_antigua)} ${plural(m.dias_mas_antigua, 'día', 'días')} esperando` : 'no hay propuestas pendientes',
    tono: n(m.dias_mas_antigua) > 7 ? 'alert' : n(m.n) > 0 ? 'warn' : 'ok',
  });

  // ── Soporte ─────────────────────────────────────────────────────────────────────────────────────────────────
  const s = d.soporte;
  lista.push(!s ? sinDatos('soporte', 'Soporte', '🐞', 'Tickets de soporte sin resolver', ENLACES.soporte) : {
    id: 'soporte', area: 'Soporte', icono: '🐞', titulo: 'Tickets de soporte sin resolver', valor: num(s.pendientes), enlace: ENLACES.soporte, variacion: null,
    sub: d.esAdmin ? `reportes de error y objeciones del equipo · ${num(s.total)} en total` : 'los tuyos, entre errores y objeciones',
    tono: n(s.pendientes) > 0 ? 'warn' : 'ok',
  });
  return lista;
}

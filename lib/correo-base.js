// /lib/correo-base.js
// ══════════════════════════════════════════════════════════════════════
// DISEÑO ESTÁNDAR DE LAS NOTIFICACIONES POR CORREO DEL ERP
// ══════════════════════════════════════════════════════════════════════
// Todo correo del ERP (los de Usuarios > Notificaciones, hoy y los que se creen más adelante) se arma con estas piezas para que se vean igual:
//   · encabezado azul marino: "IndexStore · Área", título, subtítulo con la fecha o el período;
//   · tarjetas con las cifras clave (con color según gravedad: rojo, naranja, amarillo, verde, azul, gris);
//   · "Lo que destaca" / "Requiere atención": avisos cortos con lo que hay que hacer, en orden de gravedad;
//   · detalle en tablas cortas (con "… y N más en el ERP" si es largo), nunca listas largas de texto;
//   · botón azul que abre la página del ERP;
//   · leyenda "Cómo leerlo" y pie "Notificación del sistema ERP · IndexStore".
// Reglas: sin montos, ventas ni costos de la empresa (solo cantidades, plazos y porcentajes); estilos en línea (los correos no leen hojas de estilo);
// ancho máximo 680 px; funciones puras (sin red ni base de datos) para poder probarlas.
//
// Uso típico:
//   const cuerpo = tarjetas([{ etiqueta: 'Pendientes', cifra: 12, sub: '3 con más de 7 días', tono: 'naranja' }])
//     + avisos([{ tono: 'naranja', texto: '<b>3</b> llevan más de una semana.' }])
//     + seccion('Detalle', 'Los más antiguos primero.', tabla([{ titulo: 'SKU' }, { titulo: 'Días', alinear: 'right' }], [['ABC', '9']]));
//   const html = armarCorreo({ etiqueta: 'IndexStore · Compras', titulo: 'Lo que hay que revisar', subtitulo: '22 de octubre de 2026', cuerpo, boton: { url, texto: 'Abrir en el ERP' } });

export const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const num = n => Number(n || 0).toLocaleString('es-CL');
export const dec = (n, d = 1) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: d }));
export const plural = (n, uno, varios) => (Number(n) === 1 ? uno : varios);
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const hoyChile = (ahora = new Date()) => new Date(ahora).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
// 'AAAA-MM-DD' -> '22 de octubre de 2026'
export const fechaLarga = iso => { const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`; };
// 'AAAA-MM-DD' o instante -> '22 oct' (día de Chile)
export const fechaCorta = v => {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : hoyChile(new Date(v));
  const [, m, d] = iso.split('-'); return `${Number(d)} ${MESES_CORTOS[Number(m) - 1]}`;
};

export const TONOS = {
  rojo: { fondo: '#FDE2E2', texto: '#B91C1C' },
  naranja: { fondo: '#FFEDD5', texto: '#C2410C' },
  amarillo: { fondo: '#FEF3C7', texto: '#92400E' },
  verde: { fondo: '#E3F6EA', texto: '#12713A' },
  azul: { fondo: '#E8F0FE', texto: '#0B57D0' },
  gris: { fondo: '#EEF2F9', texto: '#475569' },
};
const tono = t => TONOS[t] || TONOS.gris;

export const ESTILO = {
  th: 'padding:7px 9px;text-align:left;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:#ffffff;background:#0b2a5b;',
  td: 'padding:8px 9px;border-bottom:1px solid #e3ebf8;vertical-align:middle;font-size:13px;line-height:1.35;color:#1b2a41;',
  h3: 'margin:28px 0 4px;padding:0 0 6px;font-size:16px;color:#0b2a5b;border-bottom:2px solid #dbe7fb;',
  sub: 'margin:0 0 8px;font-size:12px;color:#64748b;',
};

// Etiqueta de color (chip)
export const chip = (texto, t = 'gris') => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap;background:${tono(t).fondo};color:${tono(t).texto};">${texto}</span>`;

// Enlace "ver ↗"
export const enlace = (url, texto = 'Ver') => (url ? `<a href="${esc(url)}" style="color:#0b57d0;text-decoration:none;font-weight:600;">${texto} ↗</a>` : '');

// Una tarjeta de indicador: etiqueta pequeña, cifra grande y subtítulo (acepta HTML en sub)
export function tarjeta({ etiqueta, cifra, sub = '', tono: t = 'azul' }, ancho = 25) {
  return `<td width="${ancho}%" style="padding:4px;vertical-align:top;"><div style="background:${tono(t).fondo};border-radius:12px;padding:11px 12px;">
      <div style="font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${tono(t).texto};">${etiqueta}</div>
      <div style="font-size:26px;font-weight:800;line-height:1.1;color:#1b2a41;margin-top:2px;">${cifra}</div>
      ${sub ? `<div style="font-size:12px;color:#475569;margin-top:2px;line-height:1.35;">${sub}</div>` : ''}</div></td>`;
}
// Fila de tarjetas (hasta 4 por fila; si hay más, se reparten en varias filas)
export function tarjetas(lista) {
  const items = (lista || []).filter(Boolean);
  if (!items.length) return '';
  const filas = [];
  for (let i = 0; i < items.length; i += 4) filas.push(items.slice(i, i + 4));
  return filas.map(f => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 -4px;"><tr>${f.map(x => tarjeta(x, Math.floor(100 / Math.max(f.length, items.length >= 4 ? 4 : f.length)))).join('')}</tr></table>`).join('');
}

// Avisos cortos con borde de color ("Lo que destaca", "Requiere atención")
export function avisos(lista, titulo = null) {
  const items = (lista || []).filter(Boolean);
  if (!items.length) return '';
  return (titulo ? `<h3 style="margin:22px 0 8px;padding:0 0 6px;font-size:16px;color:#0b2a5b;border-bottom:2px solid #dbe7fb;">${titulo}</h3>` : '')
    + items.map(x => `<div style="background:${tono(x.tono).fondo};color:#1b2a41;border-left:4px solid ${tono(x.tono).texto};border-radius:8px;padding:9px 12px;margin:6px 0;font-size:13.5px;line-height:1.45;">${x.texto}</div>`).join('');
}
// Recuadro de "todo bien" o de nota
export const vacio = (texto, t = 'gris') => `<div style="margin-top:16px;background:${tono(t).fondo};border-radius:12px;padding:14px 18px;font-size:13.5px;line-height:1.5;color:${t === 'gris' ? '#475569' : tono(t).texto};">${texto}</div>`;

// Sección con título, descripción corta y cuerpo
export const seccion = (titulo, descripcion, cuerpo) => `<h3 style="${ESTILO.h3}">${titulo}</h3>${descripcion ? `<p style="${ESTILO.sub}">${descripcion}</p>` : ''}${cuerpo}`;

// Tabla: columnas [{ titulo, alinear?: 'left'|'right'|'center', ancho?: px }], filas: arreglo de arreglos de HTML (ya escapado). pie = texto bajo la tabla ("… y N más").
export function tabla(columnas, filas, { pie = null } = {}) {
  const th = columnas.map(c => `<th style="${ESTILO.th}${c.alinear ? `text-align:${c.alinear};` : ''}${c.ancho ? `width:${c.ancho}px;` : ''}">${c.titulo}</th>`).join('');
  const trs = filas.map((f, k) => `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};">${f.map((celda, i) => `<td style="${ESTILO.td}${columnas[i] && columnas[i].alinear ? `text-align:${columnas[i].alinear};` : ''}">${celda}</td>`).join('')}</tr>`).join('');
  const piePie = pie ? `<tr><td colspan="${columnas.length}" style="${ESTILO.td}color:#64748b;font-size:12px;">${pie}</td></tr>` : '';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;"><tr>${th}</tr>${trs}${piePie}</table>`;
}
// Texto estándar de "…y N más" cuando se recorta una lista
export const masEnElErp = (n, donde = 'el ERP') => `… y ${num(n)} más en ${donde}.`;

// Datos clave-valor (para un caso puntual, por ejemplo un lead): pares [etiqueta, html]; se omiten los vacíos
export function datos(pares) {
  const filas = (pares || []).filter(p => p && p[1]);
  if (!filas.length) return '';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;">${filas.map(([k, v], i) =>
    `<tr style="background:${i % 2 ? '#f5f8fe' : '#ffffff'};"><td style="${ESTILO.td}width:34%;color:#5b6b86;font-size:12px;vertical-align:top;">${k}</td><td style="${ESTILO.td}vertical-align:top;">${v}</td></tr>`).join('')}</table>`;
}

// Barra horizontal dentro de una celda: valor respecto de un máximo
export function barra(valor, maximo, color = '#0b57d0') {
  const ancho = Math.max(valor ? 2 : 0, Math.round((valor / Math.max(1, maximo)) * 100));
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="background:${color};height:10px;line-height:10px;font-size:1px;border-radius:0 5px 5px 0;width:${ancho}%;">&nbsp;</td><td></td></tr></table>`;
}

export const boton = (url, texto) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 0;"><tr><td style="background:#0b57d0;border-radius:10px;">
        <a href="${esc(url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">${texto}</a>
      </td></tr></table>`;

// Estructura completa del correo. cuerpo = HTML armado con las piezas de arriba; leyenda = "Cómo leerlo" (HTML); botones = [{ url, texto }] (el primero es el principal).
// pie = HTML propio para el pie (por ejemplo, en correos que van a clientes y no al equipo interno); por omisión, el pie estándar del ERP.
export function armarCorreo({ etiqueta, titulo, subtitulo = '', cuerpo = '', botones = [], boton: unBoton = null, leyenda = '', pie = null }) {
  const lista = unBoton ? [unBoton, ...botones] : botones;
  return `
<div style="margin:0;padding:24px 12px;background:#eef2f9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;border-collapse:separate;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td style="background:#0b2a5b;border-radius:14px 14px 0 0;padding:24px 26px 20px;">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9db8ea;font-weight:700;">${etiqueta}</div>
      <div style="margin-top:6px;font-size:25px;line-height:1.25;color:#ffffff;font-weight:800;">${titulo}</div>
      ${subtitulo ? `<div style="margin-top:4px;font-size:14px;color:#c9d9f7;">${subtitulo}</div>` : ''}
    </td></tr>
    <tr><td style="background:#ffffff;padding:20px 22px 24px;color:#1b2a41;font-size:14px;line-height:1.55;">
      ${cuerpo}
      ${lista.map(b => boton(b.url, b.texto)).join('')}
      ${leyenda ? `<div style="margin-top:18px;font-size:11.5px;line-height:1.5;color:#64748b;"><b>Cómo leerlo:</b> ${leyenda}</div>` : ''}
    </td></tr>
    <tr><td style="background:#f5f8fe;border-top:1px solid #dbe7fb;border-radius:0 0 14px 14px;padding:14px 26px;font-size:12px;line-height:1.5;color:#5b6b86;">
      ${pie || `<b style="color:#0b2a5b;">Notificación del sistema ERP · IndexStore</b><br>
      Mensaje automático: no respondas a este correo. Puedes cambiar quién lo recibe en el ERP, en Usuarios &gt; Notificaciones.`}
    </td></tr>
  </table>
</div>`;
}

// /lib/resumen-cambios.js
// ══════════════════════════════════════════════════════════════════════
// Resumen diario de cambios (tienda, ERP, buscador IA) -- notificación
// 'resumen-cambios-diario' de la página Usuarios > Notificaciones.
// ══════════════════════════════════════════════════════════════════════
// Pedido del usuario: un breve resumen de los cambios que se hicieron cada
// día, para que el equipo (Lesly, Nathalia) sepa qué cambió. El TEXTO lo
// escribe/pega un admin en la propia página Usuarios (tabla resumen_cambios,
// una fila por día): el sistema no puede deducir solo qué se cambió, así que
// no inventa nada -- si ese día no hay texto guardado, no manda correo.
// Vive en lib/ porque lo usan dos funciones: api/negocio.js (cron diario) y
// api/usuarios.js (guardar el texto y "Enviar ahora").
import { enviarCorreo } from './mailer.js';
import { obtenerSuscriptoresEmail, notificacionDebeEnviarse, marcarNotificacionEnviada } from './notificaciones.js';
import { asegurarCambiosRegistro } from './cambios-registro.js';

export const TIPO_RESUMEN_CAMBIOS = 'resumen-cambios-diario';

export function fechaHoyChile() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// El resumen puede venir con formato (pegado desde el chat o armado con la barra del editor): se guarda como HTML LIMPIO.
// Solo se dejan etiquetas de texto, listas y tablas, sin atributos (salvo href http/https en enlaces) ni scripts ni estilos pegados.
export const URL_IMAGEN_CAMBIO = 'https://erp.indexstore.cl/api/negocio?recurso=cambio-imagen';
const MAX_VISTAS_PREVIAS = 4;
const ETIQUETAS_OK = new Set(['img', 'p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'hr']);
export function sanitizarHtmlResumen(html) {
  let s = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|svg|head|title)[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, cierra, nombre, attrs) => {
    let t = nombre.toLowerCase();
    if (t === 'img') {
      // solo se aceptan las imágenes de vista previa del propio ERP (nada de imágenes externas)
      if (cierra) return '';
      const mi = attrs.match(/src\s*=\s*("([^"]*)"|'([^']*)')/i);
      const src = mi ? (mi[2] ?? mi[3]) : '';
      return (src.startsWith(URL_IMAGEN_CAMBIO + '&amp;t=') || src.startsWith(URL_IMAGEN_CAMBIO + '&t=')) ? '<img src="' + src + '">' : '';
    }
    if (t === 'span' || t === 'font' || t === 'section' || t === 'article') return '';
    if (!ETIQUETAS_OK.has(t)) return '';
    if (cierra) return t === 'br' || t === 'hr' ? '' : '</' + t + '>';
    if (t === 'a') {
      const h = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)')/i);
      const url = h ? (h[2] ?? h[3]) : '';
      return /^https?:\/\//i.test(url) ? '<a href="' + url.replace(/"/g, '&quot;') + '">' : '<a>';
    }
    return '<' + t + '>';
  });
  return s.replace(/<(div|p)>\s*<\/\1>/g, '').trim();
}

// Estilos en línea (los correos no leen hojas de estilo) sobre el HTML ya limpio.
const H3 = 'margin:26px 0 10px;padding:0 0 6px;font-size:17px;line-height:1.3;color:#0b2a5b;border-bottom:2px solid #dbe7fb;';
const INSIGNIA = {
  publicado: 'background:#e3f6ea;color:#12713a;',
  pendiente: 'background:#fff1d6;color:#8a5a00;',
};
const ANCHO_COLUMNA = { fecha: 70, sitio: 48, 'área': 100, 'vista previa': 124, estado: 74, ver: 40 };
function estilarHtmlResumen(html) {
  const celda = 'padding:7px 9px;border-bottom:1px solid #e3ebf8;vertical-align:top;text-align:left;font-size:13px;line-height:1.35;';
  let fila = 0;
  return html
    .replace(/<table>/g, '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:10px 0 4px;border:1px solid #d3dff3;border-radius:8px;">')
    // filas de datos con fondo alternado; la de encabezado (th) va oscura
    .replace(/<tr>([\s\S]*?)<\/tr>/g, (m, dentro) => {
      if (/<th>/.test(dentro)) return '<tr style="background:#0b2a5b;">' + dentro + '</tr>';
      fila += 1;
      return '<tr style="background:' + (fila % 2 ? '#ffffff' : '#f5f8fe') + ';">' + dentro + '</tr>';
    })
    // anchos fijos para las columnas cortas: "Qué cambió" se lleva todo el espacio sobrante y así las filas quedan bajas
    .replace(/<th>([^<]*)<\/th>/g, (m, t) => {
      const ancho = ANCHO_COLUMNA[t.trim().toLowerCase()];
      return '<th style="padding:8px 9px;text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#ffffff;' + (ancho ? 'width:' + ancho + 'px;' : '') + '">' + t + '</th>';
    })
    // estado como etiqueta de color; fecha en una sola línea y en gris
    .replace(/<td>\s*(Publicado|Pendiente(?: de publicar)?)\s*<\/td>/gi, (m, e) =>
      '<td style="' + celda + 'white-space:nowrap;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;' +
      (/^publicado/i.test(e) ? INSIGNIA.publicado : INSIGNIA.pendiente) + '">' + (/^publicado/i.test(e) ? 'Publicado' : 'Pendiente') + '</span></td>')
    .replace(/<td>\s*(Web indexstore\.cl|Web|ERP)\s*<\/td>/gi, (m, t) =>
      '<td style="' + celda + 'white-space:nowrap;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;' +
      (/^erp/i.test(t) ? 'background:#ece8fb;color:#4a2fb0;' : 'background:#e1effe;color:#0b57d0;') + '">' + (/^erp/i.test(t) ? 'ERP' : 'Web') + '</span></td>')
    .replace(/<td>\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*<\/td>/g, '<td style="' + celda + 'white-space:nowrap;color:#5b6b86;font-size:12px;">$1</td>')
    .replace(/<td>/g, '<td style="' + celda + 'color:#1b2a41;">')
    .replace(/<h[1-4]>/g, '<h3 style="' + H3 + '">')
    .replace(/<\/h[1-4]>/g, '</h3>')
    .replace(/<ul>/g, '<ul style="margin:6px 0 12px 20px;padding:0;">')
    .replace(/<ol>/g, '<ol style="margin:6px 0 12px 22px;padding:0;">')
    .replace(/<li>/g, '<li style="margin:6px 0;font-size:15px;line-height:1.55;color:#1b2a41;">')
    .replace(/<p>/g, '<p style="margin:8px 0;font-size:15px;line-height:1.6;color:#1b2a41;">')
    .replace(/<b>|<strong>/g, '<strong style="color:#0b2a5b;">')
    .replace(/<\/b>/g, '</strong>')
    .replace(/<img src=/g, '<img width="110" style="display:block;width:110px;height:auto;border:1px solid #d3dff3;border-radius:6px;" src=')
    .replace(/<a href=/g, '<a style="color:#0b57d0;font-weight:700;" href=');
}

const PARECE_HTML = /<\/?(p|div|ul|ol|li|h[1-4]|table|tr|td|th|b|strong|br|i|em|u|a)\b/i;
export function contenidoResumenAHtml(contenido) {
  const c = String(contenido || '');
  return PARECE_HTML.test(c) ? estilarHtmlResumen(sanitizarHtmlResumen(c)) : textoResumenAHtml(c);
}

// Texto simple -> HTML: "## Título" o "**Título**" en una línea = encabezado; "- algo" / "• algo" = viñeta; el resto, párrafo.
export function textoResumenAHtml(texto) {
  const lineas = String(texto || '').replace(/\r/g, '').split('\n');
  const html = [];
  let enLista = false;
  const cerrarLista = () => { if (enLista) { html.push('</ul>'); enLista = false; } };
  for (const cruda of lineas) {
    const l = cruda.trim();
    if (!l) { cerrarLista(); continue; }
    let m;
    if ((m = l.match(/^#{1,4}\s+(.*)$/)) || (m = l.match(/^\*\*(.+?)\*\*:?$/))) {
      cerrarLista();
      html.push(`<h3 style="${H3}">${esc(m[1])}</h3>`);
    } else if ((m = l.match(/^[-•*]\s+(.*)$/))) {
      if (!enLista) { html.push('<ul style="margin:6px 0 12px 20px;padding:0;">'); enLista = true; }
      html.push(`<li style="margin:6px 0;font-size:15px;line-height:1.55;color:#1b2a41;">${esc(m[1]).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0b2a5b;">$1</strong>')}</li>`);
    } else {
      cerrarLista();
      html.push(`<p style="margin:8px 0;font-size:15px;line-height:1.6;color:#1b2a41;">${esc(l).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0b2a5b;">$1</strong>')}</p>`);
    }
  }
  cerrarLista();
  return html.join('\n');
}

// Arma el correo completo (asunto + HTML con el diseño de la notificación) para el resumen de "dia" (AAAA-MM-DD).
export function armarCorreoResumen(dia, contenido) {
  const [a, m, d] = dia.split('-');
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const fechaLarga = Number(d) + ' de ' + MESES[Number(m) - 1] + ' de ' + a;
  const asunto = `Resumen de cambios IndexStore · ${d}-${m}-${a}`;
  const urlHistorial = 'https://erp.indexstore.cl/actualizaciones-erp.html#cambios';
  const html = `
<div style="margin:0;padding:24px 12px;background:#eef2f9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:780px;margin:0 auto;border-collapse:separate;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td style="background:#0b2a5b;border-radius:14px 14px 0 0;padding:26px 28px 22px;">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9db8ea;font-weight:700;">IndexStore · Resumen de cambios</div>
      <div style="margin-top:6px;font-size:26px;line-height:1.25;color:#ffffff;font-weight:800;">Qué cambió hoy</div>
      <div style="margin-top:4px;font-size:15px;color:#c9d9f7;">${fechaLarga}</div>
    </td></tr>
    <tr><td style="background:#ffffff;padding:8px 22px 26px;color:#1b2a41;font-size:15px;line-height:1.6;">
      ${contenidoResumenAHtml(contenido)}
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 0;"><tr><td style="background:#0b57d0;border-radius:10px;">
        <a href="${urlHistorial}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">Ver el historial de cambios en el ERP</a>
      </td></tr></table>
    </td></tr>
    <tr><td style="background:#f5f8fe;border-top:1px solid #dbe7fb;border-radius:0 0 14px 14px;padding:16px 28px;font-size:12.5px;line-height:1.5;color:#5b6b86;">
      <b style="color:#0b2a5b;">Notificación del sistema ERP · IndexStore</b><br>
      Mensaje automático: no respondas a este correo. Puedes cambiar quién lo recibe en el ERP, en Usuarios &gt; Notificaciones.
    </td></tr>
  </table>
</div>`;
  return { asunto, html };
}

// Contenido del resumen a partir del historial de cambios: los de las últimas 24 horas (fecha de ayer y de hoy), en tabla.
// "filas" = filas de cambios_registro (fecha 'AAAA-MM-DD', area, descripcion, estado, sitio, url).
// Para el correo: solo la primera frase (máx. ~130 caracteres) para que cada fila sea baja; el detalle completo queda en el ERP.
function descripcionCorta(t) {
  const texto = String(t || '').replace(/\s+/g, ' ').trim();
  const frase = (texto.match(/^.*?[.!?](?=\s|$)/) || [texto])[0];
  if (frase.length <= 130) return frase;
  // si la frase es larga, se corta en la última coma (queda completa); si no hay coma, en la última palabra con "…"
  const coma = frase.lastIndexOf(',', 130);
  if (coma > 60) return frase.slice(0, coma);
  const corte = frase.slice(0, 130), ult = corte.lastIndexOf(' ');
  return corte.slice(0, ult > 60 ? ult : 130).replace(/[\s,;:(]+$/, '') + '…';
}
export function armarContenidoCambios(filas) {
  const f = iso => { const [a, m, d] = String(iso).slice(0, 10).split('-'); return d + '/' + m + '/' + a; };
  const pub = filas.filter(c => c.estado === 'publicado').length, pen = filas.length - pub;
  const resumen = filas.length + (filas.length === 1 ? ' cambio' : ' cambios') + ': ' + pub + (pub === 1 ? ' publicado' : ' publicados') + ' y ' + pen + (pen === 1 ? ' pendiente de publicar' : ' pendientes de publicar') + '.';
  // Orden: primero los cambios de la web (indexstore.cl) y después los del ERP; dentro de cada grupo, lo más reciente arriba.
  const ordenadas = [...filas].sort((a, b) => (a.sitio === 'erp' ? 1 : 0) - (b.sitio === 'erp' ? 1 : 0) || String(b.fecha).localeCompare(String(a.fecha)));
  // Vista previa: solo los cambios marcados como relevantes que tengan imagen, máximo 4. Si ninguno la tiene, no se muestra la columna.
  const conImagen = new Set(ordenadas.filter(c => c.destacado && c.imagen_token).slice(0, MAX_VISTAS_PREVIAS));
  const columnaVista = conImagen.size > 0;
  const celdaVista = c => {
    if (!columnaVista) return '';
    if (!conImagen.has(c)) return '<td></td>';
    const img = '<img src="' + URL_IMAGEN_CAMBIO + '&amp;t=' + esc(c.imagen_token) + '" alt="Vista previa: ' + esc(c.area) + '">';
    return '<td>' + (c.url ? '<a href="' + esc(c.url) + '">' + img + '</a>' : img) + '</td>';
  };
  const tabla = ordenadas.map(c => '<tr><td>' + f(c.fecha) + '</td><td>' + (c.sitio === 'erp' ? 'ERP' : 'Web') + '</td><td><b>' + esc(c.area) + '</b></td><td>' + esc(descripcionCorta(c.descripcion)) + '</td>' + celdaVista(c) + '<td>' +
    (c.estado === 'publicado' ? 'Publicado' : 'Pendiente de publicar') + '</td><td>' + (c.url ? '<a href="' + esc(c.url) + '">Ver ↗</a>' : '') + '</td></tr>').join('');
  return '<h3>Cambios de las últimas 24 horas</h3><p>' + resumen + '</p>' +
    '<table><thead><tr><th>Fecha</th><th>Sitio</th><th>Área</th><th>Qué cambió</th>' + (columnaVista ? '<th>Vista previa</th>' : '') + '<th>Estado</th><th>Ver</th></tr></thead><tbody>' + tabla + '</tbody></table>' +
    '<p><i>Web = indexstore.cl · ERP = sistema interno. Primero van los cambios de la web y luego los del ERP. El detalle completo de cada cambio está en el ERP (Actualizaciones ERP &gt; Cambios).</i></p>';
}

// ── Recordatorio para generar y mandar el resumen a mano ──────────────────────────────────────────────
// Aviso interno (sin datos financieros) a quien arma el resumen: solo sale si en las últimas 24 horas (fecha de ayer y de hoy,
// igual que "Generar resumen de hoy") hubo cambios tanto en el sitio web como en el ERP, y si el resumen de hoy todavía no se envió.
// No arma ni manda el resumen: eso se hace a mano en Actualizaciones ERP.
export const TIPO_RECORDATORIO_RESUMEN = 'resumen-cambios-recordatorio';

// Resumen breve (máx. 5 palabras) de cada cambio: la IA lo redacta y, si no está disponible, sale del comienzo de la descripción.
const PALABRAS_SUELTAS = new Set(['y', 'e', 'o', 'u', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'en', 'con', 'para', 'por', 'a', 'al', 'que', 'se']);
export function limitarPalabras(texto, max = 5) {
  const p = String(texto || '').replace(/["`*“”«»]/g, '').replace(/\s+/g, ' ').replace(/^[\s'\-–—•]+|[\s.']+$/g, '').split(' ').filter(Boolean).slice(0, max);
  // si el corte deja una palabra de enlace al final ("filtros de pulgadas y"), se quita
  while (p.length > 1 && PALABRAS_SUELTAS.has(p[p.length - 1].toLowerCase().replace(/[,;:]$/, ''))) p.pop();
  return p.join(' ').replace(/[\s,;:(\-–—]+$/, '');
}
export function resumenCortoLocal(descripcion) {
  const base = String(descripcion || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return limitarPalabras((base.match(/^[^.:;!?]+/) || [base])[0], 5);
}
export function armarCorreoRecordatorio({ web, erp }) {
  // "Área: resumen breve", sin repetir el mismo par
  const nombres = lista => [...new Set(lista.map(c => {
    const area = String(c.area || '').trim(), corto = String(c.corto || '').trim();
    return area && corto ? area + ': ' + corto : (area || corto);
  }).filter(Boolean))].join('; ');
  const url = 'https://erp.indexstore.cl/actualizaciones-erp.html';
  const asunto = 'Recordatorio: genera y envía el resumen de cambios de hoy';
  const cantidad = n => n + (n === 1 ? ' cambio' : ' cambios');
  const html = `
<div style="margin:0;padding:24px 12px;background:#eef2f9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;border-collapse:separate;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td style="background:#0b2a5b;border-radius:14px 14px 0 0;padding:24px 28px 20px;">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9db8ea;font-weight:700;">IndexStore · Recordatorio</div>
      <div style="margin-top:6px;font-size:24px;line-height:1.25;color:#ffffff;font-weight:800;">Hay un resumen de cambios por enviar</div>
    </td></tr>
    <tr><td style="background:#ffffff;padding:20px 28px 26px;color:#1b2a41;font-size:15px;line-height:1.6;">
      <p style="margin:0 0 12px;">En las últimas 24 horas hubo cambios en el <strong style="color:#0b2a5b;">sitio web</strong> y en el <strong style="color:#0b2a5b;">ERP</strong>:</p>
      <ul style="margin:6px 0 14px 20px;padding:0;">
        <li style="margin:6px 0;"><strong style="color:#0b57d0;">Web:</strong> ${cantidad(web.length)} (${esc(nombres(web))})</li>
        <li style="margin:6px 0;"><strong style="color:#4a2fb0;">ERP:</strong> ${cantidad(erp.length)} (${esc(nombres(erp))})</li>
      </ul>
      <p style="margin:0 0 6px;"><strong style="color:#0b2a5b;">Qué hacer:</strong></p>
      <ol style="margin:6px 0 14px 22px;padding:0;">
        <li style="margin:6px 0;">Entra a <b>Actualizaciones ERP</b>.</li>
        <li style="margin:6px 0;">Presiona <b>Generar resumen de hoy</b> y revisa la vista previa.</li>
        <li style="margin:6px 0;">Presiona <b>Enviar por correo ahora</b> para mandarlo al equipo.</li>
      </ol>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0 0;"><tr><td style="background:#0b57d0;border-radius:10px;">
        <a href="${url}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">Ir a Actualizaciones ERP</a>
      </td></tr></table>
    </td></tr>
    <tr><td style="background:#f5f8fe;border-top:1px solid #dbe7fb;border-radius:0 0 14px 14px;padding:16px 28px;font-size:12.5px;line-height:1.5;color:#5b6b86;">
      <b style="color:#0b2a5b;">Notificación del sistema ERP · IndexStore</b><br>
      Mensaje automático: no respondas a este correo. Puedes cambiar quién lo recibe en el ERP, en Usuarios &gt; Notificaciones.
    </td></tr>
  </table>
</div>`;
  return { asunto, html };
}

// sql = cliente de la base; enviar = función de envío (inyectable para pruebas).
// resumir = async (cambios) => arreglo de textos breves (uno por cambio, mismo orden) o null; opcional (la IA vive en api/negocio.js).
// para = correo de prueba: manda solo a esa persona, con [PRUEBA] en el asunto, sin marcar nada como enviado (botón de prueba de Usuarios > Notificaciones).
export async function enviarRecordatorioResumen(sql, { forzar = false, enviar = enviarCorreo, resumir = null, para: paraPrueba = null } = {}) {
  if (!forzar && !paraPrueba && !(await notificacionDebeEnviarse(sql, TIPO_RECORDATORIO_RESUMEN))) {
    return { enviado: false, motivo: 'notificación inactiva o no corresponde hoy según su frecuencia' };
  }
  await asegurarCambiosRegistro(sql);
  const hoy = fechaHoyChile();
  const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const { rows: cambios } = await sql`SELECT area, sitio, descripcion FROM cambios_registro WHERE fecha >= ${ayer}::date ORDER BY fecha DESC, id DESC;`;
  const web = cambios.filter(c => c.sitio !== 'erp');
  const erp = cambios.filter(c => c.sitio === 'erp');
  if (web.length === 0 || erp.length === 0) {
    return { enviado: false, motivo: `sin cambios en ambos sitios (web: ${web.length}, ERP: ${erp.length})`, web: web.length, erp: erp.length };
  }
  const { rows } = await sql`SELECT enviado_en FROM resumen_cambios WHERE fecha = ${hoy}::date;`;
  if (rows[0] && rows[0].enviado_en && !forzar && !paraPrueba) return { enviado: false, motivo: 'el resumen de hoy ya se envió', web: web.length, erp: erp.length };

  const destinatarios = paraPrueba ? [paraPrueba] : await obtenerSuscriptoresEmail(sql, TIPO_RECORDATORIO_RESUMEN);
  if (destinatarios.length === 0) return { enviado: false, motivo: 'sin destinatarios suscritos', web: web.length, erp: erp.length };

  let cortos = null;
  if (resumir) { try { cortos = await resumir(cambios); } catch (e) { cortos = null; } }
  cambios.forEach((c, i) => { c.corto = limitarPalabras(Array.isArray(cortos) ? cortos[i] : '', 5) || resumenCortoLocal(c.descripcion); });
  const { asunto, html } = armarCorreoRecordatorio({ web, erp });
  const envios = [];
  for (const para of destinatarios) envios.push({ para, ...(await enviar({ para, asunto: paraPrueba ? `[PRUEBA] ${asunto}` : asunto, html })) });
  if (!paraPrueba && envios.some(e => e.enviado !== false)) await marcarNotificacionEnviada(sql, TIPO_RECORDATORIO_RESUMEN, { asunto, html });
  return { enviado: envios.some(e => e.enviado !== false), envios, web: web.length, erp: erp.length };
}

// Manda el resumen guardado para "fecha" (por defecto hoy en Chile) a los suscriptores.
// forzar = true (botón "Enviar ahora"): ignora frecuencia/activa y que ya se haya mandado.
// para = correo de prueba: manda el resumen guardado de hoy (o el último que haya) solo a esa persona, con [PRUEBA] en el asunto, sin marcar nada como enviado.
export async function enviarResumenCambios(sql, { fecha, forzar = false, para: paraPrueba = null } = {}) {
  const dia = fecha || fechaHoyChile();
  if (!forzar && !paraPrueba && !(await notificacionDebeEnviarse(sql, TIPO_RESUMEN_CAMBIOS))) {
    return { enviado: false, motivo: 'notificación inactiva o no corresponde hoy según su frecuencia' };
  }
  const { rows } = paraPrueba
    ? await sql`SELECT fecha::text AS fecha, contenido, enviado_en FROM resumen_cambios WHERE COALESCE(contenido, '') <> '' ORDER BY (fecha = ${dia}::date) DESC, fecha DESC LIMIT 1;`
    : await sql`SELECT fecha::text AS fecha, contenido, enviado_en FROM resumen_cambios WHERE fecha = ${dia}::date;`;
  const fila = rows[0];
  if (!fila || !String(fila.contenido || '').trim()) return { enviado: false, motivo: `no hay resumen guardado para ${dia}` };
  if (fila.enviado_en && !forzar && !paraPrueba) return { enviado: false, motivo: `el resumen de ${dia} ya se envió` };

  if (paraPrueba) {
    const { asunto, html } = armarCorreoResumen(fila.fecha, fila.contenido);
    const r = await enviarCorreo({ para: paraPrueba, asunto: `[PRUEBA] ${asunto}`, html });
    return { enviado: r.enviado !== false, envios: [{ para: paraPrueba, ...r }] };
  }
  const destinatarios = await obtenerSuscriptoresEmail(sql, TIPO_RESUMEN_CAMBIOS);
  if (destinatarios.length === 0) return { enviado: false, motivo: 'sin destinatarios suscritos' };

  const { asunto, html } = armarCorreoResumen(dia, fila.contenido);
  const envios = [];
  for (const para of destinatarios) envios.push({ para, ...(await enviarCorreo({ para, asunto, html })) });
  if (envios.some(e => e.enviado !== false)) {
    await sql`UPDATE resumen_cambios SET enviado_en = now() WHERE fecha = ${dia}::date;`;
    await marcarNotificacionEnviada(sql, TIPO_RESUMEN_CAMBIOS, { asunto, html });
  }
  return { enviado: envios.length > 0, envios };
}

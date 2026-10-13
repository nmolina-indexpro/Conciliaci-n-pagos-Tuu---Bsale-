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

export const TIPO_RESUMEN_CAMBIOS = 'resumen-cambios-diario';

export function fechaHoyChile() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// El resumen puede venir con formato (pegado desde el chat o armado con la barra del editor): se guarda como HTML LIMPIO.
// Solo se dejan etiquetas de texto, listas y tablas, sin atributos (salvo href http/https en enlaces) ni scripts ni estilos pegados.
const ETIQUETAS_OK = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'hr']);
export function sanitizarHtmlResumen(html) {
  let s = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|svg|head|title)[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, cierra, nombre, attrs) => {
    let t = nombre.toLowerCase();
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
const ANCHO_COLUMNA = { fecha: 70, sitio: 48, 'área': 100, estado: 74, ver: 40 };
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
  const urlHistorial = 'https://erp.indexstore.cl/usuarios.html#cambios';
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
  const tabla = filas.map(c => '<tr><td>' + f(c.fecha) + '</td><td>' + (c.sitio === 'erp' ? 'ERP' : 'Web') + '</td><td><b>' + esc(c.area) + '</b></td><td>' + esc(descripcionCorta(c.descripcion)) + '</td><td>' +
    (c.estado === 'publicado' ? 'Publicado' : 'Pendiente de publicar') + '</td><td>' + (c.url ? '<a href="' + esc(c.url) + '">Ver ↗</a>' : '') + '</td></tr>').join('');
  return '<h3>Cambios de las últimas 24 horas</h3><p>' + resumen + '</p>' +
    '<table><thead><tr><th>Fecha</th><th>Sitio</th><th>Área</th><th>Qué cambió</th><th>Estado</th><th>Ver</th></tr></thead><tbody>' + tabla + '</tbody></table>' +
    '<p><i>Web = indexstore.cl · ERP = sistema interno. El detalle completo de cada cambio está en el ERP (Usuarios &gt; Cambios).</i></p>';
}

// Manda el resumen guardado para "fecha" (por defecto hoy en Chile) a los suscriptores.
// forzar = true (botón "Enviar ahora"): ignora frecuencia/activa y que ya se haya mandado.
export async function enviarResumenCambios(sql, { fecha, forzar = false } = {}) {
  const dia = fecha || fechaHoyChile();
  if (!forzar && !(await notificacionDebeEnviarse(sql, TIPO_RESUMEN_CAMBIOS))) {
    return { enviado: false, motivo: 'notificación inactiva o no corresponde hoy según su frecuencia' };
  }
  const { rows } = await sql`SELECT fecha::text AS fecha, contenido, enviado_en FROM resumen_cambios WHERE fecha = ${dia}::date;`;
  const fila = rows[0];
  if (!fila || !String(fila.contenido || '').trim()) return { enviado: false, motivo: `no hay resumen guardado para ${dia}` };
  if (fila.enviado_en && !forzar) return { enviado: false, motivo: `el resumen de ${dia} ya se envió` };

  const destinatarios = await obtenerSuscriptoresEmail(sql, TIPO_RESUMEN_CAMBIOS);
  if (destinatarios.length === 0) return { enviado: false, motivo: 'sin destinatarios suscritos' };

  const { asunto, html } = armarCorreoResumen(dia, fila.contenido);
  const envios = [];
  for (const para of destinatarios) envios.push({ para, ...(await enviarCorreo({ para, asunto, html })) });
  if (envios.some(e => e.enviado !== false)) {
    await sql`UPDATE resumen_cambios SET enviado_en = now() WHERE fecha = ${dia}::date;`;
    await marcarNotificacionEnviada(sql, TIPO_RESUMEN_CAMBIOS);
  }
  return { enviado: envios.length > 0, envios };
}

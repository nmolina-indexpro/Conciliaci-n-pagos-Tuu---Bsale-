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
function estilarHtmlResumen(html) {
  const celda = 'padding:7px 10px;border:1px solid #d3dff3;vertical-align:top;text-align:left;';
  return html
    .replace(/<table>/g, '<table style="border-collapse:collapse;margin:8px 0;width:100%;font-size:13px;">')
    .replace(/<th>/g, '<th style="' + celda + 'background:#eef4ff;color:#0b2a5b;">')
    .replace(/<td>/g, '<td style="' + celda + '">')
    .replace(/<h[1-4]>/g, '<h3 style="margin:16px 0 6px;font-size:15px;color:#0b2a5b;">')
    .replace(/<\/h[1-4]>/g, '</h3>')
    .replace(/<ul>/g, '<ul style="margin:4px 0 8px 18px;padding:0;">')
    .replace(/<ol>/g, '<ol style="margin:4px 0 8px 20px;padding:0;">')
    .replace(/<li>/g, '<li style="margin:3px 0;">')
    .replace(/<p>/g, '<p style="margin:6px 0;">')
    .replace(/<a href=/g, '<a style="color:#0b57d0;" href=');
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
      html.push(`<h3 style="margin:16px 0 6px;font-size:15px;color:#0b2a5b;">${esc(m[1])}</h3>`);
    } else if ((m = l.match(/^[-•*]\s+(.*)$/))) {
      if (!enLista) { html.push('<ul style="margin:4px 0 8px 18px;padding:0;">'); enLista = true; }
      html.push(`<li style="margin:3px 0;">${esc(m[1]).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</li>`);
    } else {
      cerrarLista();
      html.push(`<p style="margin:6px 0;">${esc(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`);
    }
  }
  cerrarLista();
  return html.join('\n');
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

  const [a, m, d] = dia.split('-');
  const asunto = `Resumen de cambios IndexStore -- ${d}-${m}-${a}`;
  const html = `
    <div style="font-family:sans-serif;font-size:14px;color:#1b2a41;max-width:640px;">
      <h2 style="margin:0 0 4px;color:#0b2a5b;">Resumen de cambios -- ${d}-${m}-${a}</h2>
      ${contenidoResumenAHtml(fila.contenido)}
    </div>`;
  const envios = [];
  for (const para of destinatarios) envios.push({ para, ...(await enviarCorreo({ para, asunto, html })) });
  if (envios.some(e => e.enviado !== false)) {
    await sql`UPDATE resumen_cambios SET enviado_en = now() WHERE fecha = ${dia}::date;`;
    await marcarNotificacionEnviada(sql, TIPO_RESUMEN_CAMBIOS);
  }
  return { enviado: envios.length > 0, envios };
}

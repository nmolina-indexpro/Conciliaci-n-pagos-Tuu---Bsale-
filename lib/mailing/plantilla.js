// /lib/mailing/plantilla.js
// Congelado y personalización del HTML de una campaña.
//  - Variables {{first_name}}, {{last_name}}, {{company_name}}, {{email}}, {{unsubscribe_url}}; con valor por defecto: {{first_name|cliente}}.
//  - Los valores se escapan para HTML (salvo las URL), y una variable desconocida o vacía queda en blanco (nunca se filtra "{{...}}" al cliente).
//  - Ley 19.496: todo correo lleva identificación del remitente, aviso de publicidad y enlace de baja. Si la plantilla no trae {{unsubscribe_url}}, se agrega un pie.

const URL_VARS = new Set(['unsubscribe_url']);

export const escaparHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function personalizar(texto, vars, { html = true } = {}) {
  return String(texto ?? '').replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_, nombre, porDefecto) => {
    const clave = nombre.toLowerCase();
    let v = vars[clave];
    if (v === undefined || v === null || String(v).trim() === '') v = porDefecto !== undefined ? porDefecto.trim() : '';
    if (URL_VARS.has(clave) || !html) return String(v);
    return escaparHtml(v);
  });
}

export function pieDeBaja({ fromName, fromEmail }) {
  return `<div style="margin:24px auto 0;max-width:600px;padding:16px;font:12px/1.5 Arial,Helvetica,sans-serif;color:#6b7280;text-align:center;border-top:1px solid #e5e7eb">` +
    `Este es un correo publicitario enviado por ${escaparHtml(fromName)} (${escaparHtml(fromEmail)}). ` +
    `Si no deseas recibir más correos, <a href="{{unsubscribe_url}}" style="color:#6b7280">date de baja aquí</a>.</div>`;
}

// HTML final que se guarda en mk_campaigns.html_snapshot al lanzar (después de esto editar la plantilla no cambia la campaña).
export function congelarHtml({ html, preheader, fromName, fromEmail }) {
  let h = String(html ?? '');
  if (preheader && String(preheader).trim()) {
    const oculto = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escaparHtml(preheader)}</div>`;
    h = /<body[^>]*>/i.test(h) ? h.replace(/<body[^>]*>/i, m => m + oculto) : oculto + h;
  }
  if (!/\{\{\s*unsubscribe_url\s*(?:\|[^}]*)?\}\}/i.test(h)) {
    const pie = pieDeBaja({ fromName, fromEmail });
    h = /<\/body>/i.test(h) ? h.replace(/<\/body>/i, pie + '</body>') : h + pie;
  }
  return h;
}

export function htmlATexto(html) {
  return String(html ?? '')
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => `${t.replace(/<[^>]+>/g, '').trim()} (${href})`)
    .replace(/<(br|\/p|\/div|\/tr|\/h[1-6]|\/li)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

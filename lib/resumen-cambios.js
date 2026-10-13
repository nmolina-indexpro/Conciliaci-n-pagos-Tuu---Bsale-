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
      ${textoResumenAHtml(fila.contenido)}
    </div>`;
  const envios = [];
  for (const para of destinatarios) envios.push({ para, ...(await enviarCorreo({ para, asunto, html })) });
  if (envios.some(e => e.enviado !== false)) {
    await sql`UPDATE resumen_cambios SET enviado_en = now() WHERE fecha = ${dia}::date;`;
    await marcarNotificacionEnviada(sql, TIPO_RESUMEN_CAMBIOS);
  }
  return { enviado: envios.length > 0, envios };
}

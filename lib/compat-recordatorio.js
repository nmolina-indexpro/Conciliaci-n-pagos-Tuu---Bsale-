// /lib/compat-recordatorio.js
// ══════════════════════════════════════════════════════════════════════
// Recordatorio semanal (lunes) de las propuestas de "Modelos compatibles" que ya se crearon y siguen sin aprobar ni rechazar. Función pura:
// recibe las filas pendientes de compat_propuestas y arma el correo (asunto + html). Sin montos ni datos de clientes.
// ══════════════════════════════════════════════════════════════════════
export const URL_MODELOS_COMPATIBLES = 'https://erp.indexstore.cl/modelos-compatibles.html';
export const MAX_FILAS_CORREO = 40;
const NOMBRES_TIPO = { pantalla: 'Pantalla', bateria: 'Batería', cargador: 'Cargador' };
const ORDEN_TIPO = ['pantalla', 'bateria', 'cargador'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DIA = 86400000;
export const diasEspera = (creadoEn, ahora = new Date()) => Math.max(0, Math.floor((new Date(ahora) - new Date(creadoEn)) / DIA));
const textoDias = d => d === 0 ? 'hoy' : d === 1 ? '1 día' : `${d} días`;
const fechaCorta = d => new Date(d).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit' });

// pendientes: filas de compat_propuestas con estado 'pendiente' (creado_en, tipo, marca, modelo, sku, titulo, creado_por, veces)
export function armarCorreoModelosPendientes(pendientes, { ahora = new Date() } = {}) {
  const filas = [...(pendientes || [])].sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en)); // las que llevan más tiempo esperando, primero
  const total = filas.length;
  const nuevas = filas.filter(f => diasEspera(f.creado_en, ahora) < 7).length;
  const antiguas = total - nuevas;
  const mostradas = filas.slice(0, MAX_FILAS_CORREO);
  const porTipo = ORDEN_TIPO.map(t => [t, filas.filter(f => f.tipo === t).length]).filter(([, n]) => n > 0);

  const asunto = `Modelos compatibles por revisar: ${total} ${total === 1 ? 'propuesta pendiente' : 'propuestas pendientes'}`;
  const celda = 'padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px';
  const filasHtml = mostradas.map(f => {
    const d = diasEspera(f.creado_en, ahora);
    const marca = d >= 7 ? '<span style="background:#fde8e6;color:#b42318;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:bold">esperando</span>' : '<span style="background:#e7f6ec;color:#15803d;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:bold">nueva</span>';
    return `<tr><td style="${celda}">${esc(fechaCorta(f.creado_en))}<br>${marca}<br><span style="color:#6b7280;font-size:11px">${textoDias(d)}</span></td>` +
      `<td style="${celda}"><b>${esc(NOMBRES_TIPO[f.tipo] || f.tipo)}</b><br>${esc(f.marca)} ${esc(f.modelo)}</td>` +
      `<td style="${celda}">${esc(f.sku)}${f.titulo ? `<br><span style="color:#6b7280;font-size:12px">${esc(String(f.titulo).slice(0, 90))}</span>` : ''}</td>` +
      `<td style="${celda}">${esc(f.creado_por || '—')}${Number(f.veces) > 1 ? `<br><span style="color:#6b7280;font-size:11px">propuesto ${f.veces} veces</span>` : ''}</td></tr>`;
  }).join('');
  const resto = total > mostradas.length ? `<p style="color:#6b7280;font-size:13px;margin:8px 0 0">…y ${total - mostradas.length} más. Están todas en la página.</p>` : '';

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#111827">
<h2 style="margin:0 0 4px">Modelos compatibles por revisar</h2>
<p style="margin:0 0 14px;color:#4b5563">Hay <b>${total}</b> ${total === 1 ? 'modelo propuesto' : 'modelos propuestos'} que todavía no ${total === 1 ? 'está aprobado ni rechazado' : 'están aprobados ni rechazados'}${total ? `: ${nuevas} ${nuevas === 1 ? 'nuevo' : 'nuevos'} de esta semana y ${antiguas} que ${antiguas === 1 ? 'lleva' : 'llevan'} una semana o más esperando` : ''}. Hasta que un administrador los apruebe, no entran a la base de compatibilidad del sitio (la que usan el buscador y la categorización).</p>
${porTipo.length ? `<p style="margin:0 0 12px;font-size:13px;color:#374151">${porTipo.map(([t, n]) => `${esc(NOMBRES_TIPO[t])}: <b>${n}</b>`).join(' · ')}</p>` : ''}
<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f3f4f6;text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280"><th style="padding:8px 10px">Creada</th><th style="padding:8px 10px">Modelo</th><th style="padding:8px 10px">Producto que sirve</th><th style="padding:8px 10px">Propuso</th></tr></thead><tbody>${filasHtml}</tbody></table>
${resto}
<p style="text-align:center;margin:22px 0"><a href="${URL_MODELOS_COMPATIBLES}" style="background:#0F766E;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:bold;display:inline-block">Revisar propuestas</a></p>
<p style="font-size:12px;color:#6b7280">Aprobar una propuesta agrega el producto a la base de compatibilidad del sitio; rechazarla la descarta. Este recordatorio llega los lunes y solo cuando hay propuestas pendientes. Se administra en Usuarios &gt; Notificaciones.</p>
</div>`;
  const texto = `Modelos compatibles por revisar: ${total} pendientes (${nuevas} nuevas, ${antiguas} con una semana o más).\n` + mostradas.map(f => `- ${NOMBRES_TIPO[f.tipo] || f.tipo} ${f.marca} ${f.modelo} · ${f.sku} · propuso ${f.creado_por || '—'} · ${textoDias(diasEspera(f.creado_en, ahora))}`).join('\n') + `\nRevisar: ${URL_MODELOS_COMPATIBLES}`;
  return { asunto, html, texto, total, nuevas, antiguas };
}

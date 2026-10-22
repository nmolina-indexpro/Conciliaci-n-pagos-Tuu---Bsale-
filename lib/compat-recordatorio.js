// /lib/compat-recordatorio.js
// ══════════════════════════════════════════════════════════════════════
// Recordatorio semanal (lunes) de las propuestas de "Modelos compatibles" que ya se crearon y siguen sin aprobar ni rechazar. Función pura:
// recibe las filas pendientes de compat_propuestas y arma el correo (asunto + html). Sin montos ni datos de clientes.
// ══════════════════════════════════════════════════════════════════════
import { esc, num, chip, tarjetas, avisos, seccion, tabla, armarCorreo } from './correo-base.js';
export const URL_MODELOS_COMPATIBLES = 'https://erp.indexstore.cl/modelos-compatibles.html';
export const MAX_FILAS_CORREO = 40;
const NOMBRES_TIPO = { pantalla: 'Pantalla', bateria: 'Batería', cargador: 'Cargador' };
const ORDEN_TIPO = ['pantalla', 'bateria', 'cargador'];

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
  const cuerpo = tarjetas([
    { etiqueta: '🧩 Pendientes', cifra: num(total), sub: 'sin aprobar ni rechazar', tono: total ? 'naranja' : 'verde' },
    { etiqueta: '🆕 Nuevas', cifra: num(nuevas), sub: 'de esta semana', tono: 'verde' },
    { etiqueta: '⏳ Esperando', cifra: num(antiguas), sub: 'una semana o más', tono: antiguas ? 'rojo' : 'verde' },
    { etiqueta: '🗂️ Por tipo', cifra: porTipo.length ? porTipo.map(([, n]) => n).join(' · ') : '0', sub: porTipo.map(([t, n]) => `${NOMBRES_TIPO[t]} ${n}`).join(' · ') || 'ninguna', tono: 'gris' },
  ]) + avisos([
    antiguas ? { tono: 'rojo', texto: `<b>${antiguas}</b> ${antiguas === 1 ? 'propuesta lleva' : 'propuestas llevan'} una semana o más esperando. Hasta que un administrador las apruebe, no entran a la base de compatibilidad del sitio (la que usan el buscador y la categorización).` }
      : { tono: 'amarillo', texto: `Hay <b>${total}</b> ${total === 1 ? 'propuesta nueva' : 'propuestas nuevas'} por revisar: hasta que un administrador las apruebe, no entran a la base de compatibilidad del sitio.` },
  ], '🚨 Requiere atención') + seccion('Propuestas por revisar', 'Las que llevan más tiempo esperando, primero.', tabla(
    [{ titulo: 'Creada' }, { titulo: 'Modelo' }, { titulo: 'Producto que sirve' }, { titulo: 'Propuso' }],
    mostradas.map(f => {
      const d = diasEspera(f.creado_en, ahora);
      return [
        `${esc(fechaCorta(f.creado_en))}<br>${chip(d >= 7 ? 'esperando' : 'nueva', d >= 7 ? 'rojo' : 'verde')}<br><span style="color:#64748b;font-size:11px">${textoDias(d)}</span>`,
        `<b>${esc(NOMBRES_TIPO[f.tipo] || f.tipo)}</b><br>${esc(f.marca)} ${esc(f.modelo)}`,
        `${esc(f.sku)}${f.titulo ? `<br><span style="color:#64748b;font-size:12px">${esc(String(f.titulo).slice(0, 90))}</span>` : ''}`,
        `${esc(f.creado_por || '—')}${Number(f.veces) > 1 ? `<br><span style="color:#64748b;font-size:11px">propuesto ${f.veces} veces</span>` : ''}`,
      ];
    }),
    { pie: total > mostradas.length ? `…y ${total - mostradas.length} más. Están todas en la página.` : null }));
  const html = armarCorreo({
    etiqueta: 'IndexStore · Modelos compatibles', titulo: 'Propuestas por revisar', subtitulo: `${total} ${total === 1 ? 'modelo propuesto sin aprobar' : 'modelos propuestos sin aprobar'}`,
    cuerpo, boton: { url: URL_MODELOS_COMPATIBLES, texto: 'Revisar propuestas en el ERP' },
    leyenda: 'aprobar una propuesta agrega el producto a la base de compatibilidad del sitio; rechazarla la descarta. Este recordatorio llega los lunes y solo cuando hay propuestas pendientes. "Esperando" = una semana o más sin revisar.',
  });
  const texto = `Modelos compatibles por revisar: ${total} pendientes (${nuevas} nuevas, ${antiguas} con una semana o más).\n` + mostradas.map(f => `- ${NOMBRES_TIPO[f.tipo] || f.tipo} ${f.marca} ${f.modelo} · ${f.sku} · propuso ${f.creado_por || '—'} · ${textoDias(diasEspera(f.creado_en, ahora))}`).join('\n') + `\nRevisar: ${URL_MODELOS_COMPATIBLES}`;
  return { asunto, html, texto, total, nuevas, antiguas };
}

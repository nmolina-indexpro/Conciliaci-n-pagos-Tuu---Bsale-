// /lib/ventas-efectivo.js
// ══════════════════════════════════════════════════════════════════════
// Notificación 'ventas-efectivo-diario': ventas pagadas (en todo o en parte) en EFECTIVO
// ══════════════════════════════════════════════════════════════════════
// Cada mañana revisa los documentos de venta de ayer y de anteayer en Bsale y avisa de los que tienen un pago con el medio "EFECTIVO". Solo manda si hay
// ventas en efectivo que todavía no se avisaron (tabla ventas_efectivo_avisadas): ninguna se repite y una venta con fecha atrasada tampoco se pierde.
// EXCEPCIÓN a la regla de "sin montos" de las notificaciones del ERP, pedida por el usuario para ESTE aviso (va solo a nmolina y polivares): muestra el monto
// cobrado en efectivo de cada documento y el total recolectado.
//
// Criterio de "venta en efectivo": el mismo de Conciliación (api/bsale-report.js): documento vigente (state 0, sin anulación), pago cuyo nombre
// normalizado es EXACTAMENTE "EFECTIVO". Las notas de crédito (devoluciones) y las cotizaciones no cuentan. Las funciones de armado son puras.

import { esc, num, plural, fechaLarga, fechaCorta, tarjetas, avisos, seccion, tabla, masEnElErp, chip, enlace, armarCorreo, hoyChile } from './correo-base.js';
import { sumarDias } from './recepciones-stock.js';

export const BASE_BSALE = 'https://api.bsale.io/v1';
export const VENTANA_DIAS = 1; // además de "ayer": también anteayer
export const MAX_VENTAS_EN_CORREO = 40;
const clp = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
export const esMedioEfectivo = (nombre) => normalizar(nombre) === 'EFECTIVO';

export const ayerChile = (ahora = new Date()) => sumarDias(hoyChile(ahora), -1);

function pagosDe(doc) {
  const p = doc && doc.payments;
  if (Array.isArray(p)) return p;
  return p && Array.isArray(p.items) ? p.items : [];
}
// Bsale guarda emissionDate como medianoche UTC del día calendario (ver api/bsale-report.js): se compara en UTC puro.
const fechaDeDocumento = (doc) => (doc && doc.emissionDate ? new Date(Number(doc.emissionDate) * 1000).toISOString().slice(0, 10) : null);

function nombreCliente(c) {
  if (!c) return '';
  const completo = `${c.firstName || ''} ${c.lastName || ''}`.trim();
  return completo || c.company || '';
}
function oficinaDe(doc) {
  const o = doc && doc.office;
  if (!o) return null;
  return String(o.id || (o.href ? String(o.href).split('/').pop().replace('.json', '') : '') || '') || null;
}
function horaChile(unix) {
  if (!unix) return '';
  return new Date(Number(unix) * 1000).toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
}

// docs: documentos de Bsale con payments, client y document_type expandidos. Devuelve las ventas con efectivo, la más reciente primero.
export function extraerVentasEfectivo(docs, { desde, hasta, officeId = null, avisadas = new Set(), ignorarAvisadas = false }) {
  const vistos = new Set();
  const ventas = [];
  for (const d of docs || []) {
    if (vistos.has(d.id)) continue;
    vistos.add(d.id);
    const fecha = fechaDeDocumento(d);
    if (!fecha || fecha < desde || fecha > hasta) continue;
    if (d.state !== 0 || d.cancellationStatus) continue;
    const tipoDoc = d.document_type || {};
    if (tipoDoc.isCreditNote === 1 || /nota de cr[eé]dito|cotizaci[oó]n/i.test(tipoDoc.name || '')) continue;
    if (officeId && oficinaDe(d) !== String(officeId)) continue;
    if (!ignorarAvisadas && avisadas.has(Number(d.id))) continue;
    const pagos = pagosDe(d);
    const efectivo = pagos.filter((p) => esMedioEfectivo(p.name));
    if (!efectivo.length) continue;
    const montoEfectivo = efectivo.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const otros = [...new Set(pagos.filter((p) => !esMedioEfectivo(p.name)).map((p) => String(p.name || '').trim()).filter(Boolean))];
    ventas.push({
      id: Number(d.id), numero: d.number ? String(d.number) : '', tipo: String(tipoDoc.name || 'Documento').trim(), fecha,
      hora: horaChile(d.generationDate), cliente: nombreCliente(d.client), url: d.urlPublicView || d.urlPublicViewOriginal || '',
      mixto: otros.length > 0, otrosMedios: otros, montoEfectivo, totalDocumento: Number(d.totalAmount) || null,
    });
  }
  return ventas.sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.hora || '').localeCompare(a.hora || '') || b.id - a.id);
}

export function armarCorreoVentasEfectivo({ ventas, desde, hasta, urlBase }) {
  const mixtas = ventas.filter((v) => v.mixto).length;
  const totalEfectivo = ventas.reduce((s, v) => s + v.montoEfectivo, 0);
  const dias = new Set(ventas.map((v) => v.fecha)).size;
  const periodo = desde === hasta ? fechaLarga(hasta) : `${fechaLarga(desde)} al ${fechaLarga(hasta)}`;
  const visibles = ventas.slice(0, MAX_VENTAS_EN_CORREO);
  const filas = visibles.map((v) => [
    `${esc(fechaCorta(v.fecha))}${v.hora ? `<br><span style="color:#64748b;font-size:12px;">${esc(v.hora)}</span>` : ''}`,
    `<b>${esc(v.tipo)}</b>${v.numero ? ` N° ${esc(v.numero)}` : ''}${v.url ? `<br>${enlace(v.url, 'Ver documento')}` : ''}`,
    esc(v.cliente) || '<span style="color:#94a3b8;">Sin cliente</span>',
    `<b>${clp(v.montoEfectivo)}</b>${v.mixto && v.totalDocumento ? `<br><span style="color:#64748b;font-size:12px;">de ${clp(v.totalDocumento)}</span>` : ''}`,
    v.mixto ? `${chip('Pago mixto', 'amarillo')}<br><span style="color:#64748b;font-size:12px;">y ${esc(v.otrosMedios.join(', '))}</span>` : chip('Solo efectivo', 'naranja'),
  ]);
  const pie = ventas.length > visibles.length ? masEnElErp(ventas.length - visibles.length, 'Bsale') : null;
  const cuerpo = tarjetas([
    { etiqueta: 'Recolectado en efectivo', cifra: clp(totalEfectivo), sub: `en ${num(ventas.length)} ${plural(ventas.length, 'documento', 'documentos')}`, tono: 'naranja' },
    { etiqueta: 'Pago mixto', cifra: num(mixtas), sub: mixtas ? 'efectivo más otro medio' : 'ninguna', tono: mixtas ? 'amarillo' : 'gris' },
    { etiqueta: 'Días', cifra: num(dias), sub: desde === hasta ? fechaCorta(hasta) : `${fechaCorta(desde)} al ${fechaCorta(hasta)}`, tono: 'gris' },
  ])
    + avisos([{ tono: 'naranja', texto: `Hubo <b>${num(ventas.length)}</b> ${plural(ventas.length, 'venta pagada', 'ventas pagadas')} en efectivo por un total de <b>${clp(totalEfectivo)}</b>. Revisa que el efectivo esté en caja y que cada documento esté bien emitido.` }], 'Requiere atención')
    + seccion('Detalle', 'Las más recientes primero.', tabla(
      [{ titulo: 'Fecha', ancho: 70 }, { titulo: 'Documento' }, { titulo: 'Cliente' }, { titulo: 'Efectivo', alinear: 'right', ancho: 90 }, { titulo: 'Pago', ancho: 120 }],
      filas, { pie },
    ));
  const asunto = `Venta en efectivo: ${clp(totalEfectivo)} en ${num(ventas.length)} ${plural(ventas.length, 'documento', 'documentos')} ${desde === hasta ? 'del ' + fechaLarga(hasta) : 'del ' + fechaCorta(desde) + ' al ' + fechaCorta(hasta)}`;
  const html = armarCorreo({
    etiqueta: 'IndexStore · Ventas',
    titulo: 'Ventas pagadas en efectivo',
    subtitulo: periodo,
    cuerpo,
    boton: { url: `${urlBase}/conciliacion.html`, texto: 'Abrir Conciliación en el ERP' },
    leyenda: 'son los documentos de venta de Bsale vigentes con un pago cuyo medio es «Efectivo». El monto es lo cobrado en efectivo en ese documento; en un «Pago mixto» se muestra además el total del documento. Las notas de crédito y las cotizaciones no cuentan, y las devoluciones en efectivo no se descuentan del total recolectado.',
  });
  return { asunto, html, ventas: ventas.length, mixtas, totalEfectivo };
}

// ── Lectura de Bsale ─────────────────────────────────────────────────
async function bsaleGet(path, token, intentos = 3) {
  for (let i = 0; i < intentos; i++) {
    const r = await fetch(`${BASE_BSALE}${path}`, { headers: { access_token: token, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (r.status === 429 && i < intentos - 1) { await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); continue; }
    if (!r.ok) throw new Error(`Bsale HTTP ${r.status} en ${path.split('?')[0]}`);
    return r.json();
  }
}

// Documentos entre dos fechas de Chile (ambas incluidas). Las páginas se piden de a pocas a la vez para no gatillar el límite de Bsale.
export async function leerDocumentos(token, desde, hasta, { leer = bsaleGet } = {}) {
  const ini = Math.floor(new Date(`${desde}T00:00:00-04:00`).getTime() / 1000) - 6 * 3600;
  const fin = Math.floor(new Date(`${hasta}T23:59:59-04:00`).getTime() / 1000) + 6 * 3600;
  const limit = 50;
  const ruta = (offset) => `/documents.json?emissiondaterange=[${ini},${fin}]&expand=payments,client,document_type,office&limit=${limit}&offset=${offset}`;
  const primera = await leer(ruta(0), token);
  const docs = [...((primera && primera.items) || [])];
  const total = typeof (primera && primera.count) === 'number' ? primera.count : docs.length;
  const paginas = Math.min(Math.ceil(total / limit), 40);
  const resultados = new Array(Math.max(0, paginas - 1));
  let siguiente = 1;
  const trabajador = async () => {
    while (siguiente < paginas) { const p = siguiente++; resultados[p - 1] = await leer(ruta(p * limit), token); }
  };
  await Promise.all(Array.from({ length: Math.min(4, Math.max(0, paginas - 1)) }, trabajador));
  for (const r of resultados) docs.push(...((r && r.items) || []));
  return docs;
}

// ── Base de datos: qué ventas ya se avisaron ─────────────────────────
let tablaLista = false;
export async function asegurarTablaVentasEfectivoAvisadas(sql) {
  if (tablaLista) return;
  await sql`CREATE TABLE IF NOT EXISTS ventas_efectivo_avisadas (documento_id INTEGER PRIMARY KEY, avisada_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  tablaLista = true;
}
export async function ventasEfectivoYaAvisadas(sql) {
  await asegurarTablaVentasEfectivoAvisadas(sql);
  const { rows } = await sql`SELECT documento_id FROM ventas_efectivo_avisadas WHERE avisada_en > now() - interval '30 days';`;
  return new Set(rows.map((r) => Number(r.documento_id)));
}
export async function marcarVentasEfectivoAvisadas(sql, ids) {
  if (!ids.length) return;
  await asegurarTablaVentasEfectivoAvisadas(sql);
  await sql`INSERT INTO ventas_efectivo_avisadas (documento_id) SELECT unnest(${ids}::int[]) ON CONFLICT (documento_id) DO NOTHING;`;
  await sql`DELETE FROM ventas_efectivo_avisadas WHERE avisada_en < now() - interval '90 days';`;
}

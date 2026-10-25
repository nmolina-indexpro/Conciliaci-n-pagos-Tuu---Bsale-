// /lib/traspaso-stock.js
// ══════════════════════════════════════════════════════════════════════
// Traspaso de stock entre modelos de pantalla (notificación 'traspaso-stock-modelos').
// ══════════════════════════════════════════════════════════════════════
// Las pantallas de un mismo tamaño y resolución se agrupan: un modelo PRINCIPAL concentra el stock y los demás modelos del grupo se reponen traspasando desde él.
// Cuando un modelo que NO es el principal se agota, hay que traspasarle stock desde el principal (lo hace Nathalia o Nicolás en Bsale).
// Funciones puras (sin red ni base de datos): reciben el stock por SKU y arman la evaluación y el correo con el diseño estándar (lib/correo-base.js).
import { esc, num, plural, chip, tarjetas, avisos, vacio, seccion, tabla, armarCorreo, fechaLarga, hoyChile } from './correo-base.js';

// Grupos de traspaso: el primer modelo de cada lista es el principal. Para agregar o cambiar un grupo, se edita esta lista.
export const GRUPOS_TRASPASO = [
  { id: '14-hd', nombre: '14.0 HD', modelos: [
    { sku: 'PTBEZEL02', nombre: 'Pantalla Notebook Thin Bezel 14.0 HD 30 Pines S/B', principal: true },
    { sku: 'PTBEZEL01', nombre: 'Pantalla Notebook Thin Bezel 14.0 HD 30 Pines Brackets U/D' },
    { sku: 'PSLIM08', nombre: 'Pantalla Notebook Slim 14.0 HD 30 Pines Brackets U/D' }] },
  { id: '14-fhd', nombre: '14.0 FullHD', modelos: [
    { sku: 'PTBEZEL05', nombre: 'Pantalla Notebook Thin Bezel 14.0 FHD 30 Pines S/B', principal: true },
    { sku: 'PTBEZEL04', nombre: 'Pantalla Notebook Thin Bezel 14.0 FHD 30 Pines Brackets U/D' },
    { sku: 'PSLIM07', nombre: 'Pantalla Notebook Slim 14.0 FHD 30 Pines Brackets U/D' }] },
  { id: '156-hd', nombre: '15.6 HD', modelos: [
    { sku: 'PTBEZEL07', nombre: 'Pantalla Notebook Thin Bezel 15.6 HD 30 Pines Brackets U/D', principal: true },
    { sku: 'PTBEZEL08', nombre: 'Pantalla Notebook Thin Bezel 15.6 HD 30 Pines S/B' },
    { sku: 'PSLIM13', nombre: 'Pantalla Notebook Slim 15.6 HD 30 Pines Brackets U/D' }] },
  { id: '156-fhd', nombre: '15.6 FullHD', modelos: [
    { sku: 'PTBEZEL12', nombre: 'Pantalla Notebook Thin Bezel 15.6 FHD 30 Pines S/B', principal: true },
    { sku: 'PTBEZEL11', nombre: 'Pantalla Notebook Thin Bezel 15.6 FHD 30 Pines Brackets U/D' },
    { sku: 'PSLIM11', nombre: 'Pantalla Notebook Slim 15.6 FHD 30 Pines Brackets U/D' }] },
];

export const todosLosSkus = (grupos = GRUPOS_TRASPASO) => grupos.flatMap(g => g.modelos.map(m => m.sku));

// stock: objeto/Map { sku: número | null (sin dato) }. Un modelo se considera agotado con 0 o menos unidades.
const leer = (stock, sku) => { const v = stock instanceof Map ? stock.get(sku) : stock[sku]; return v == null || Number.isNaN(Number(v)) ? null : Number(v); };

// Evalúa un grupo. estado de cada modelo: 'ok' | 'agotado' | 'sin_dato'. accion (solo modelos no principales agotados):
//   'traspasar' -> el principal alcanza: puede darle 1 unidad a cada modelo agotado y quedarse con al menos 1;
//   'quiebre'   -> el principal no alcanza (tiene menos unidades que las necesarias, o está agotado): el grupo está en quiebre de stock y se debe COMPRAR;
//   'revisar'   -> no se pudo leer el stock del principal.
// Ejemplo: principal con 1, otro modelo con 1 y el tercero agotado -> hay solo 2 unidades en el grupo y no se alcanza a traspasar: quiebre, comprar.
export function evaluarGrupo(grupo, stock) {
  const principal = grupo.modelos.find(m => m.principal) || grupo.modelos[0];
  const stockPrincipal = leer(stock, principal.sku);
  const agotadosNoPrincipales = grupo.modelos.filter(m => m !== principal && (() => { const s = leer(stock, m.sku); return s != null && s <= 0; })()).length;
  // Para traspasar a todos los agotados, el principal necesita 1 unidad por cada uno y quedarse con al menos 1.
  const alcanza = stockPrincipal != null && stockPrincipal - agotadosNoPrincipales >= 1;
  const filas = grupo.modelos.map(m => {
    const s = leer(stock, m.sku);
    const estado = s == null ? 'sin_dato' : s <= 0 ? 'agotado' : 'ok';
    let accion = null;
    if (!m.principal && m !== principal && estado === 'agotado') accion = stockPrincipal == null ? 'revisar' : alcanza ? 'traspasar' : 'quiebre';
    return { ...m, principal: m === principal, stock: s, estado, accion };
  });
  return {
    id: grupo.id, nombre: grupo.nombre, principal: { sku: principal.sku, nombre: principal.nombre, stock: stockPrincipal }, filas,
    pendientes: filas.filter(f => f.accion), principalAgotado: stockPrincipal != null && stockPrincipal <= 0,
  };
}
export const evaluarTodos = (stock, grupos = GRUPOS_TRASPASO) => grupos.map(g => evaluarGrupo(g, stock));

// Resumen de lo que hay que hacer (todos los grupos)
export function resumirPendientes(evaluados) {
  const pend = evaluados.flatMap(g => g.pendientes.map(p => ({ ...p, grupo: g.nombre, grupoId: g.id, principalSku: g.principal.sku, principalStock: g.principal.stock })));
  return {
    pendientes: pend,
    traspasar: pend.filter(p => p.accion === 'traspasar'),
    quiebre: pend.filter(p => p.accion === 'quiebre'),
    revisar: pend.filter(p => p.accion === 'revisar'),
    principalesAgotados: evaluados.filter(g => g.principalAgotado).length,
    sinDato: evaluados.reduce((s, g) => s + g.filas.filter(f => f.estado === 'sin_dato').length, 0),
  };
}

// Decide a qué SKU avisar: estado = Map sku -> { notificadoEn: Date|null } de lo ya avisado y todavía agotado. Avisa lo nuevo y, pasado el plazo de recordatorio, lo que sigue sin resolverse.
// Devuelve { avisar: [{ sku, tipo: 'nuevo'|'recordatorio' }], resueltos: [sku] } (resueltos = estaban avisados y ya no están pendientes).
export function decidirAvisos(pendientes, estado, { ahora = new Date(), horasRecordatorio = 24 } = {}) {
  const avisar = [];
  const actuales = new Set(pendientes.map(p => p.sku));
  for (const p of pendientes) {
    const previo = estado instanceof Map ? estado.get(p.sku) : estado[p.sku];
    if (!previo || !previo.notificadoEn) avisar.push({ sku: p.sku, tipo: 'nuevo' });
    else if ((ahora - new Date(previo.notificadoEn)) / 3600000 >= horasRecordatorio) avisar.push({ sku: p.sku, tipo: 'recordatorio' });
  }
  const conocidos = estado instanceof Map ? [...estado.keys()] : Object.keys(estado || {});
  return { avisar, resueltos: conocidos.filter(s => !actuales.has(s)) };
}

// Correo. tipos: Map sku -> 'nuevo' | 'recordatorio' (para etiquetar); prueba = true muestra el estado actual aunque no haya nada que hacer.
export function armarCorreoTraspasoStock({ evaluados, tipos = new Map(), urlBase, ahora = new Date() }) {
  const r = resumirPendientes(evaluados);
  const nSec = evaluados.reduce((s, g) => s + g.filas.filter(f => !f.principal).length, 0);
  const total = r.pendientes.length;
  const nombresAsunto = r.pendientes.slice(0, 3).map(p => p.sku).join(', ') + (total > 3 ? ` y ${total - 3} más` : '');
  const soloQuiebre = total > 0 && r.traspasar.length === 0 && r.revisar.length === 0;
  const asunto = !total ? '📦 Traspaso de stock entre modelos: todo en orden'
    : soloQuiebre ? `📦 Quiebre de stock: ${nombresAsunto} ${plural(total, 'agotado', 'agotados')}, hay que comprar`
    : r.quiebre.length ? `📦 Stock de pantallas: ${nombresAsunto} ${plural(total, 'agotado', 'agotados')} (traspasar o comprar)`
    : `📦 Traspasar stock: ${nombresAsunto} ${plural(total, 'agotado', 'agotados')}`;

  const kpis = tarjetas([
    { etiqueta: '🔁 Por traspasar', cifra: num(r.traspasar.length), sub: 'agotados, con stock en el principal', tono: r.traspasar.length ? 'rojo' : 'verde' },
    { etiqueta: '🛒 Quiebre de stock', cifra: num(r.quiebre.length), sub: 'no alcanza para traspasar: comprar', tono: r.quiebre.length ? 'naranja' : 'verde' },
    { etiqueta: '⭐ Principales agotados', cifra: num(r.principalesAgotados), sub: `de ${evaluados.length} grupos`, tono: r.principalesAgotados ? 'amarillo' : 'verde' },
    { etiqueta: '🧾 Modelos revisados', cifra: num(evaluados.reduce((s, g) => s + g.filas.length, 0)), sub: `${num(nSec)} no principales`, tono: 'gris' },
  ]);

  const recordar = sku => (tipos.get(sku) === 'recordatorio' ? '<b>Recordatorio:</b> ' : '');
  const lineasAviso = [
    ...r.traspasar.map(p => ({ tono: 'rojo', texto: `${recordar(p.sku)}<b>${esc(p.sku)}</b> (${esc(p.grupo)}) está agotado: traspasa stock desde <b>${esc(p.principalSku)}</b>, que tiene <b>${num(p.principalStock)}</b> ${plural(p.principalStock, 'unidad', 'unidades')}.` })),
    ...r.quiebre.map(p => ({ tono: 'naranja', texto: `${recordar(p.sku)}<b>${esc(p.sku)}</b> (${esc(p.grupo)}): <b>quiebre de stock, se debe comprar.</b> ${p.principalStock <= 0 ? `El principal <b>${esc(p.principalSku)}</b> también está agotado.` : `El principal <b>${esc(p.principalSku)}</b> tiene solo <b>${num(p.principalStock)}</b> ${plural(p.principalStock, 'unidad', 'unidades')} y no alcanza para traspasar.`}` })),
    ...r.revisar.map(p => ({ tono: 'amarillo', texto: `${recordar(p.sku)}<b>${esc(p.sku)}</b> (${esc(p.grupo)}) está agotado, pero no se pudo leer el stock del principal <b>${esc(p.principalSku)}</b>: revísalo en Bsale.` })),
  ];
  const bloqueAvisos = lineasAviso.length ? avisos(lineasAviso, '🚨 Qué hacer') : vacio('✅ <b>Todo en orden:</b> ningún modelo no principal está agotado.', 'verde');

  const estadoChip = f => f.estado === 'sin_dato' ? chip('sin dato', 'gris') : f.estado === 'agotado' ? chip('Agotado', 'rojo') : chip('Con stock', 'verde');
  const queHacer = f => f.accion === 'traspasar' ? `<b style="color:#B91C1C;">Traspasar desde el principal</b>` : f.accion === 'quiebre' ? `<b style="color:#C2410C;">Quiebre de stock: comprar</b>`
    : f.accion === 'revisar' ? 'Revisar en Bsale' : f.principal && f.estado === 'agotado' ? '<span style="color:#92400E;">Principal agotado: comprar</span>' : '<span style="color:#94a3b8;">—</span>';
  const bloques = evaluados.map(g => seccion(`${g.pendientes.length ? '🔴' : g.principalAgotado ? '🟡' : '🟢'} ${esc(g.nombre)}`, `Principal: <b>${esc(g.principal.sku)}</b>.`,
    tabla([{ titulo: 'Modelo' }, { titulo: 'Stock', alinear: 'right', ancho: 60 }, { titulo: 'Estado' }, { titulo: 'Qué hacer' }],
      g.filas.map(f => [
        `<b>${esc(f.sku)}</b> ${f.principal ? chip('Principal', 'azul') : ''}<br><span style="font-size:11.5px;color:#64748b;">${esc(f.nombre)}</span>${tipos.get(f.sku) ? ` ${chip(tipos.get(f.sku) === 'nuevo' ? 'nuevo' : 'recordatorio', tipos.get(f.sku) === 'nuevo' ? 'rojo' : 'amarillo')}` : ''}`,
        f.stock == null ? '—' : `<b>${num(f.stock)}</b>`, estadoChip(f), queHacer(f)])))).join('');

  const html = armarCorreo({
    etiqueta: 'IndexStore · Inventario', titulo: total ? 'Traspasos de stock por hacer' : 'Traspaso de stock entre modelos', subtitulo: `${fechaLarga(hoyChile(ahora))} · ${total} ${plural(total, 'modelo por atender', 'modelos por atender')}`,
    cuerpo: kpis + bloqueAvisos + bloques, botones: [{ url: 'https://app.bsale.cl', texto: 'Abrir Bsale' }],
    leyenda: 'cada grupo reúne las pantallas del mismo tamaño y resolución; el modelo <b>Principal</b> concentra el stock. Cuando un modelo que no es el principal llega a 0, se traspasa stock desde el principal, siempre que este pueda dar 1 unidad a cada modelo agotado y quedarse con al menos 1; si no alcanza (por ejemplo, solo hay 2 unidades en todo el grupo), es quiebre de stock y se debe comprar. El stock es el disponible en Bsale. Se avisa apenas se agota y se recuerda cada 24 horas mientras siga sin resolverse.',
  });
  return { asunto, html, resumen: r };
}

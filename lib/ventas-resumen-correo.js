// /lib/ventas-resumen-correo.js
// ═════════════════════════════════════════════════════════════════
// Resumen semanal de ventas por correo (lunes y viernes), con el pronóstico del mes. Notificaciones 'ventas-resumen-lunes' y 'ventas-resumen-viernes'
// (ver lib/notificaciones.js). EXCEPCIÓN pedida a la regla de "sin montos": este correo SÍ lleva ventas y margen y va solo a administradores (correosFijos).
//
//  · Lunes: la semana anterior completa (lunes a domingo), día por día.
//  · Viernes: la semana en curso hasta ayer (lunes a jueves), día por día.
//  · Ambos: productos y servicios más vendidos, comparativo de venta (semana anterior y hace 52 semanas, mismos días de la semana), cómo va el mes,
//    la proyección de la venta y del margen a fin de mes y cuánto falta vender para llegar a ella. SIN vendedores ni sucursales.
//  · El margen NO se muestra en el resumen diario ni en los productos: solo en el pronóstico del mes y en "cómo vamos".
//
// Funciones puras (sin red ni base de datos): reciben las líneas ya preparadas (DV.prepararLineas) y el estado de lectura de los meses.
// El cálculo es el mismo de la página Comercial > Detalle de ventas (public/detalle-ventas-calculo.js), así las cifras calzan con la pantalla.
// ═════════════════════════════════════════════════════════════════
import DV from '../public/detalle-ventas-calculo.js';
import { esc, num, dec, MESES, armarCorreo, tarjetas, avisos, seccion, tabla, vacio, chip, barra } from './correo-base.js';

export const TIPOS_RESUMEN = { lunes: 'ventas-resumen-lunes', viernes: 'ventas-resumen-viernes' };
const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const DIA_SEMANA = (iso) => (new Date(Date.parse(iso + 'T00:00:00Z')).getUTCDay() + 6) % 7; // lunes = 0

const peso = (n) => (n == null || !Number.isFinite(n) ? '—' : (n < 0 ? '-' : '') + '$' + num(Math.round(Math.abs(n))));
const diaMes = (iso) => `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]}`;
const rangoTexto = (d, h) => (d === h ? `${diaMes(d)} de ${d.slice(0, 4)}` : d.slice(0, 7) === h.slice(0, 7) ? `${Number(d.slice(8, 10))} al ${diaMes(h)} de ${h.slice(0, 4)}` : `${diaMes(d)} al ${diaMes(h)} de ${h.slice(0, 4)}`);
const recortar = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// Variación como etiqueta de color: sube = verde, baja = rojo (null = sin base de comparación)
function varChip(pct) {
  if (pct == null || !Number.isFinite(pct)) return '<span style="color:#64748b;">—</span>';
  if (Math.abs(pct) < 0.05) return chip('= 0%', 'gris');
  return chip(`${pct > 0 ? '▲ +' : '▼ -'}${dec(Math.abs(pct), 1)}%`, pct > 0 ? 'verde' : 'rojo');
}
const puntos = (a, b) => (a == null || b == null ? '' : Math.abs(a - b) < 0.05 ? 'igual' : `${a - b > 0 ? '▲' : '▼'} ${dec(Math.abs(a - b), 1)} pts`);
// Para el servidor: las líneas que entrega leerDetalle (arreglos cortos) pasan a objetos con el sku, el tipo y el costo ya resueltos
export const prepararLineasResumen = (datos) => DV.prepararLineas(datos);

// La semana que cubre cada correo. Lunes: la semana anterior completa. Viernes: lunes de esta semana hasta ayer (si no hay días todavía, la semana anterior completa).
export function ventanaSemana(tipo, hoy) {
  const lun = DV.lunesDe(hoy);
  let desde = lun, hasta = DV.sumarDias(hoy, -1);
  if (tipo !== 'viernes' || hasta < desde) { desde = DV.sumarDias(lun, -7); hasta = DV.sumarDias(desde, 6); }
  return { desde, hasta, completa: hasta === DV.sumarDias(desde, 6) };
}
const mesesDe = (r) => [...new Set([r.desde.slice(0, 7), r.hasta.slice(0, 7)])];
const rangoPrev = (r) => ({ desde: DV.sumarDias(r.desde, -7), hasta: DV.sumarDias(r.hasta, -7) });
const rangoAnio = (r) => ({ desde: DV.sumarDias(r.desde, -364), hasta: DV.sumarDias(r.hasta, -364) }); // 52 semanas: cae en el mismo día de la semana

// Qué meses hay que tener leídos de Bsale al día antes de armar el correo: el mes en curso y los meses que toca la semana.
export function mesesParaActualizar(tipo, hoy) {
  return [...new Set([...mesesDe(ventanaSemana(tipo, hoy)), hoy.slice(0, 7)])].sort();
}
// Desde qué día hay que cargar líneas: 13 meses para el pronóstico y la semana del año pasado.
export function rangoNecesario(tipo, hoy) {
  const v = ventanaSemana(tipo, hoy);
  const a = DV.primeroDelMes(rangoAnio(v).desde), b = DV.sumarMeses(DV.primeroDelMes(hoy), -12);
  return { desde: a < b ? a : b, hasta: hoy };
}

// entrada: { tipo: 'lunes'|'viernes', hoy: 'AAAA-MM-DD', lineas: líneas preparadas (con costo), estado: { 'AAAA-MM': { completo, actualizadoEn } }, urlBase }
export function armarResumenSemanal({ tipo, hoy, lineas, estado, urlBase, diaChile }) {
  const V = ventanaSemana(tipo, hoy), P = rangoPrev(V), Y = rangoAnio(V);
  const est = estado || {};
  const leido = (r) => mesesDe(r).every((m) => est[m] && est[m].completo);
  const enR = (r) => lineas.filter((l) => DV.enRango(l, r));
  const porDia = new Map();
  for (const l of lineas) { if (!porDia.has(l.f)) porDia.set(l.f, []); porDia.get(l.f).push(l); }
  const delDia = (d) => porDia.get(d) || [];

  // ---- venta de la semana y comparativos (con IVA, notas de crédito descontadas; SIN margen)
  const lSem = enR(V), tSem = DV.totales(lSem);
  const tPrev = leido(P) ? DV.totales(enR(P)) : null, tAnio = leido(Y) ? DV.totales(enR(Y)) : null;
  const vPrev = tPrev ? DV.variacion(tSem.venta, tPrev.venta) : null, vAnio = tAnio ? DV.variacion(tSem.venta, tAnio.venta) : null;

  // ---- día por día
  const dias = [];
  for (let d = V.desde; d <= V.hasta; d = DV.sumarDias(d, 1)) {
    const t = DV.totales(delDia(d)), dp = DV.sumarDias(d, -7), tp = leido(rangoPrev({ desde: d, hasta: d })) ? DV.totales(delDia(dp)) : null;
    dias.push({ fecha: d, etiqueta: `${DIAS[DIA_SEMANA(d)]} ${Number(d.slice(8, 10))}/${d.slice(5, 7)}`, venta: t.venta, ventas: t.ventas, prev: tp ? tp.venta : null, varPct: tp ? DV.variacion(t.venta, tp.venta) : null });
  }
  const maxDia = Math.max(1, ...dias.map((x) => x.venta));
  const mejor = dias.reduce((m, x) => (x.venta > (m ? m.venta : -1) ? x : m), null);

  // ---- productos y servicios (todo lo que se vendió, servicios incluidos) y tipos de producto; comparados con la semana anterior
  const gProd = DV.agrupar(lSem, 'producto').filter((g) => g.venta > 0), gTipo = DV.agrupar(lSem, 'tipo').filter((g) => g.venta > 0);
  const base = (dim) => (leido(P) ? DV.agrupar(enR(P), dim) : null);
  const bProd = base('producto'), bTipo = base('tipo');
  const conComp = (filas, b) => (b ? DV.conComparacion(filas, b) : filas.map((f) => ({ ...f, base: null, varPct: null, difVenta: null })));
  const prod = conComp(gProd, bProd), tipos = conComp(gTipo, bTipo);
  const totalVenta = Math.max(1, tSem.venta);

  // ---- el mes: cómo vamos y pronóstico (corte = último día con datos completos: ayer, sin pasar de lo que alcanzó la última lectura de Bsale)
  const mes = hoy.slice(0, 7), eMes = est[mes] || null;
  let corte = DV.sumarDias(hoy, -1);
  const lectura = eMes && eMes.actualizadoEn && diaChile ? diaChile(eMes.actualizadoEn) : null;
  if (lectura && DV.sumarDias(lectura, -1) < corte) corte = DV.sumarDias(lectura, -1);
  const mesLeido = !!(eMes && eMes.completo);
  // con menos de 3 días completos no hay base para proyectar el mes (un solo día, que puede ser domingo, no dice nada)
  const mesEmpieza = Number(corte.slice(8, 10)) < 3 || corte < DV.primeroDelMes(hoy);
  const completos = Object.keys(est).filter((m) => m < mes && est[m].completo);
  let pron = null, rMes = null, tMes = null, tMesPrev = null, tMesAnio = null;
  if (mesLeido && !mesEmpieza) {
    rMes = { desde: DV.primeroDelMes(hoy), hasta: corte };
    tMes = DV.totales(enR(rMes));
    const rp = DV.rangoComparacion(rMes, 'anterior'), ra = DV.rangoComparacion(rMes, 'anio');
    tMesPrev = leido(rp) ? DV.totales(enR(rp)) : null; tMesAnio = leido(ra) ? DV.totales(enR(ra)) : null;
    pron = DV.pronostico({ lineas, hoy, corte, mesesCompletos: completos, conMargen: true });
  }
  const A = pron && pron.actual, M = pron && pron.margen;

  // ---- avisos
  const av = [];
  if (!mesLeido) av.push({ tono: 'amarillo', texto: `La lectura de <b>${MESES[Number(mes.slice(5)) - 1]}</b> desde Bsale no se alcanzó a completar: el pronóstico y las cifras del mes no se muestran. Puedes actualizarlas en Comercial &gt; Detalle de ventas.` });
  else if (corte < DV.sumarDias(hoy, -1)) av.push({ tono: 'amarillo', texto: `Los datos de Bsale de este mes llegan hasta el <b>${diaMes(corte)}</b>: faltan los días siguientes, así que las cifras del mes pueden quedar cortas.` });
  if (!leido(V)) av.push({ tono: 'amarillo', texto: 'Los datos de la semana no están completos en el ERP: las cifras pueden quedar cortas.' });
  if (!tPrev) av.push({ tono: 'gris', texto: 'No hay datos leídos de la semana anterior: este correo va sin esa comparación.' });
  const lo = [];
  if (tSem.venta > 0 && mejor && mejor.venta > 0) lo.push({ tono: 'azul', texto: `El mejor día fue el <b>${mejor.etiqueta}</b> con <b>${peso(mejor.venta)}</b> (${dec((mejor.venta / totalVenta) * 100, 0)}% de la semana).` });
  if (vPrev != null) lo.push({ tono: vPrev >= 0 ? 'verde' : 'rojo', texto: `La venta ${V.completa ? 'de la semana' : 'de lo que va de la semana'} ${Math.abs(vPrev) < 0.05 ? 'quedó igual' : vPrev >= 0 ? 'subió <b>' + dec(vPrev, 1) + '%</b>' : 'bajó <b>' + dec(Math.abs(vPrev), 1) + '%</b>'} contra los mismos días de la semana anterior (${peso(tPrev.venta)}).` });
  const conBase = prod.filter((x) => x.difVenta != null);
  const sube = [...conBase].sort((a, b) => b.difVenta - a.difVenta)[0], baja = [...conBase].sort((a, b) => a.difVenta - b.difVenta)[0];
  if (sube && sube.difVenta > 0) lo.push({ tono: 'verde', texto: `Lo que más creció: <b>${esc(recortar(sube.nombre, 60))}</b> (+${peso(sube.difVenta)} contra la semana anterior).` });
  if (baja && baja.difVenta < 0) lo.push({ tono: 'naranja', texto: `Lo que más cayó entre lo más vendido: <b>${esc(recortar(baja.nombre, 60))}</b> (${peso(baja.difVenta)}).` });
  if (A && pron.totalMesAnterior != null) {
    const dif = A.combinada - pron.totalMesAnterior;
    lo.push({ tono: dif >= 0 ? 'verde' : 'naranja', texto: `Al ritmo actual el mes cerraría en <b>${peso(A.combinada)}</b>, ${dif >= 0 ? 'por encima' : 'por debajo'} del mes anterior por ${peso(Math.abs(dif))}.` });
  }

  // ---- cuerpo
  let cuerpo = tarjetas([
    { etiqueta: V.completa ? 'Venta de la semana' : 'Venta de la semana (hasta ayer)', cifra: peso(tSem.venta), sub: `${num(tSem.ventas)} ${tSem.ventas === 1 ? 'venta' : 'ventas'} · ${num(tSem.cant)} unidades${tSem.ncDocs ? ` · notas de crédito ${peso(tSem.ncVenta)}` : ''}`, tono: 'azul' },
    { etiqueta: 'Contra la semana anterior', cifra: vPrev == null ? '—' : `${Math.abs(vPrev) < 0.05 ? '' : vPrev > 0 ? '+' : '-'}${dec(Math.abs(vPrev), 1)}%`, sub: tPrev ? `Antes: ${peso(tPrev.venta)}` : 'Sin datos leídos', tono: vPrev == null ? 'gris' : vPrev >= 0 ? 'verde' : 'rojo' },
    { etiqueta: 'Contra hace 52 semanas', cifra: vAnio == null ? '—' : `${Math.abs(vAnio) < 0.05 ? '' : vAnio > 0 ? '+' : '-'}${dec(Math.abs(vAnio), 1)}%`, sub: tAnio ? `Entonces: ${peso(tAnio.venta)}` : 'Sin datos leídos', tono: vAnio == null ? 'gris' : vAnio >= 0 ? 'verde' : 'rojo' },
    { etiqueta: 'Ticket promedio', cifra: peso(tSem.ticket), sub: tPrev && tPrev.ticket != null ? `Semana anterior: ${peso(tPrev.ticket)}` : '', tono: 'gris' },
  ]);
  cuerpo += avisos(av) + avisos(lo, 'Lo que destaca');

  cuerpo += seccion('Venta día por día', `${rangoTexto(V.desde, V.hasta)}. Venta real con IVA, con las notas de crédito descontadas. La variación compara con el mismo día de la semana anterior.`,
    tabla([{ titulo: 'Día' }, { titulo: 'Venta', alinear: 'right' }, { titulo: '', ancho: 120 }, { titulo: 'Ventas', alinear: 'right' }, { titulo: 'vs sem. anterior', alinear: 'right' }],
      dias.map((x) => [`<b>${x.etiqueta}</b>`, peso(x.venta), barra(Math.max(0, x.venta), maxDia), num(x.ventas), varChip(x.varPct)]),
      { pie: `<b>Total:</b> ${peso(tSem.venta)}${tPrev ? ` · semana anterior (mismos días): ${peso(tPrev.venta)}` : ''}` }));

  const filasProd = prod.slice(0, 10);
  cuerpo += seccion('Productos y servicios más vendidos', 'Lo más vendido de la semana (servicios incluidos) y cómo varió contra la semana anterior.',
    filasProd.length ? tabla([{ titulo: 'Producto o servicio' }, { titulo: 'Unid.', alinear: 'right' }, { titulo: 'Venta', alinear: 'right' }, { titulo: '%', alinear: 'right' }, { titulo: 'vs sem. ant.', alinear: 'right' }],
      filasProd.map((x) => [esc(recortar(x.nombre, 58)), num(x.cant), peso(x.venta), `${dec((x.venta / totalVenta) * 100, 1)}%`, varChip(x.varPct)]),
      { pie: prod.length > 10 ? `… y ${num(prod.length - 10)} más en Comercial &gt; Detalle de ventas.` : null }) : vacio('No hubo ventas en este período.'));

  const filasTipo = tipos.slice(0, 6);
  if (filasTipo.length) cuerpo += seccion('Por tipo de producto', 'Cómo se reparte la venta de la semana.',
    tabla([{ titulo: 'Tipo' }, { titulo: 'Venta', alinear: 'right' }, { titulo: '%', alinear: 'right' }, { titulo: 'vs sem. ant.', alinear: 'right' }],
      filasTipo.map((x) => [esc(recortar(x.nombre, 40)), peso(x.venta), `${dec((x.venta / totalVenta) * 100, 1)}%`, varChip(x.base ? x.varPct : null)])));

  // ---- cómo vamos en el mes + pronóstico
  const nombreMes = `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;
  if (mesEmpieza) cuerpo += seccion(`Cómo va ${nombreMes}`, '', vacio('El mes recién comienza: todavía no hay suficientes días completos para proyectar la venta y el margen. El pronóstico aparece desde el tercer día.'));
  else if (!mesLeido) cuerpo += seccion(`Cómo va ${nombreMes}`, '', vacio('No se pudo completar la lectura del mes desde Bsale, así que hoy no hay pronóstico.', 'amarillo'));
  else {
    const fila = (nombre, t, vp) => [nombre, peso(t ? t.venta : null), vp == null ? '<span style="color:#64748b;">—</span>' : varChip(vp), t && t.margen != null ? peso(t.margen) : '—', t && t.margenPct != null ? `${dec(t.margenPct, 1)}%` : '—'];
    cuerpo += seccion(`Cómo va ${nombreMes}`, `Del ${Number(rMes.desde.slice(8))} al ${diaMes(rMes.hasta)}, contra el mismo tramo de otros períodos. El margen es neto menos costo, solo de lo que tiene costo conocido.`,
      tabla([{ titulo: 'Período' }, { titulo: 'Venta', alinear: 'right' }, { titulo: 'Variación', alinear: 'right' }, { titulo: 'Margen', alinear: 'right' }, { titulo: 'Margen %', alinear: 'right' }],
        [fila(`<b>${nombreMes}</b>`, tMes, null),
          fila(`${MESES[Number(DV.sumarMeses(rMes.desde, -1).slice(5, 7)) - 1]} (mismo tramo)`, tMesPrev, tMesPrev ? DV.variacion(tMes.venta, tMesPrev.venta) : null),
          fila(`${MESES[Number(mes.slice(5)) - 1]} ${Number(mes.slice(0, 4)) - 1} (mismo tramo)`, tMesAnio, tMesAnio ? DV.variacion(tMes.venta, tMesAnio.venta) : null)]));

    if (!A) cuerpo += vacio('Con los datos disponibles todavía no hay base para proyectar el mes (hace falta al menos un día con ventas y meses anteriores leídos).');
    else {
      const pr = pron.prueba, conf = pr && pr.filas.length >= 3 ? (pr.errorMedioPct <= 8 ? ['alta', 'verde'] : pr.errorMedioPct <= 15 ? ['media', 'amarillo'] : ['baja', 'rojo']) : null;
      const faltaIgualar = pron.totalMesAnterior != null ? pron.totalMesAnterior - A.acumulado : null;
      cuerpo += seccion('Pronóstico de venta de fin de mes', `Llevamos ${A.c} de ${A.dias} días. Mezcla el ritmo de los meses anteriores con el promedio de cada día de la semana.`,
        tarjetas([
          { etiqueta: 'Venta proyectada', cifra: peso(A.combinada), sub: `Rango probable: ${peso(A.rango.desde)} a ${peso(A.rango.hasta)}`, tono: 'azul' },
          { etiqueta: 'Llevamos', cifra: peso(A.acumulado), sub: `${dec((A.acumulado / A.combinada) * 100, 0)}% de lo proyectado`, tono: 'gris' },
          { etiqueta: 'Falta por vender', cifra: peso(A.restante), sub: `≈ ${peso(A.promedioDiarioFalta)} por día los ${A.diasFaltan} días que quedan (llevamos ${peso(A.promedioDiarioActual)} por día)`, tono: 'naranja' },
          { etiqueta: 'Mes anterior', cifra: peso(pron.totalMesAnterior), sub: faltaIgualar == null ? 'Sin datos leídos' : faltaIgualar <= 0 ? `Ya lo superamos por ${peso(-faltaIgualar)}` : `Para igualarlo faltan ${peso(faltaIgualar)} (≈ ${peso(faltaIgualar / A.diasFaltan)} por día)`, tono: faltaIgualar != null && faltaIgualar <= 0 ? 'verde' : 'gris' },
        ])
        + `<p style="margin:8px 0 0;font-size:12.5px;color:#475569;">${pron.totalMesAnterior != null ? `La proyección es ${varChip(DV.variacion(A.combinada, pron.totalMesAnterior))} contra ${MESES[Number(pron.mesAnterior.slice(5)) - 1]}` : ''}${pron.totalMismoMesAnio != null ? ` y ${varChip(DV.variacion(A.combinada, pron.totalMismoMesAnio))} contra ${MESES[Number(pron.mesAnio.slice(5)) - 1]} ${pron.mesAnio.slice(0, 4)} (${peso(pron.totalMismoMesAnio)})` : ''}.${conf ? ` Confianza ${chip(conf[0], conf[1])} (en ${pr.filas.length} meses anteriores el error medio de este método fue de ${dec(pr.errorMedioPct, 1)}%).` : ' Estimación gruesa: hay pocos meses leídos para medir su acierto.'}</p>`);

      if (!M) cuerpo += seccion('Pronóstico de margen de fin de mes', '', vacio('Este mes todavía no tiene ventas con costo conocido: no se puede proyectar el margen.'));
      else {
        const Mm = M.actual;
        cuerpo += seccion('Pronóstico de margen de fin de mes', 'Mismo método aplicado al margen de cada día (neto menos costo, solo de lo que tiene costo conocido).',
          tarjetas([
            { etiqueta: 'Margen proyectado', cifra: peso(Mm.combinada), sub: `Rango probable: ${peso(Mm.rango.desde)} a ${peso(Mm.rango.hasta)}`, tono: 'azul' },
            { etiqueta: 'Llevamos', cifra: peso(Mm.acumulado), sub: `${M.pctActual != null ? dec(M.pctActual, 1) + '% de margen hasta hoy' : ''}`, tono: 'gris' },
            { etiqueta: 'Falta por ganar', cifra: peso(Mm.restante), sub: `≈ ${peso(Mm.promedioDiarioFalta)} de margen por día`, tono: 'naranja' },
            { etiqueta: 'Margen esperado', cifra: M.pctProyectado != null ? `${dec(M.pctProyectado, 1)}%` : '—', sub: M.pctMesAnterior != null && M.pctProyectado != null ? `${puntos(M.pctProyectado, M.pctMesAnterior)} contra ${dec(M.pctMesAnterior, 1)}% del mes anterior` : 'Sin mes anterior para comparar', tono: M.pctMesAnterior != null && M.pctProyectado != null ? (M.pctProyectado >= M.pctMesAnterior ? 'verde' : 'naranja') : 'gris' },
          ])
          + `<p style="margin:8px 0 0;font-size:12.5px;color:#475569;">${M.totalMesAnterior != null ? `Margen del mes anterior: <b>${peso(M.totalMesAnterior)}</b> (la proyección es ${varChip(DV.variacion(Mm.combinada, M.totalMesAnterior))}). ` : ''}${M.cobertura != null ? `El costo se conoce en <b>${dec(M.cobertura, 0)}%</b> de la venta del mes${M.cobertura < 80 ? ': el margen real puede ser distinto del proyectado' : ''}.` : ''}</p>`);
      }
    }
  }

  const titulo = tipo === 'viernes' && !V.completa ? 'Cómo va la semana y el mes' : 'Resumen de ventas de la semana';
  const html = armarCorreo({
    etiqueta: 'IndexStore · Comercial', titulo, subtitulo: `${V.completa ? 'Semana del ' : 'Del '}${rangoTexto(V.desde, V.hasta)}${V.completa ? '' : ' (lunes a ayer)'}`,
    cuerpo, boton: { url: `${urlBase || ''}/detalle-ventas.html`, texto: 'Abrir Detalle de ventas en el ERP' },
    leyenda: 'la venta es la real de Bsale (con IVA, boletas y facturas menos notas de crédito). Las variaciones comparan los mismos días de la semana: la semana anterior y la de hace 52 semanas. '
      + 'El pronóstico no considera feriados ni eventos como Black Friday o Navidad: mira el rango. Este correo trae cifras financieras de la empresa: no lo reenvíes.',
  });
  const asunto = tipo === 'viernes' && !V.completa ? `Ventas: cómo va la semana y el mes (hasta el ${diaMes(V.hasta)})` : `Ventas: resumen de la semana del ${rangoTexto(V.desde, V.hasta)}`;
  return {
    asunto, html,
    resumen: { desde: V.desde, hasta: V.hasta, venta: tSem.venta, ventaPrev: tPrev ? tPrev.venta : null, ventaAnio: tAnio ? tAnio.venta : null, dias, productos: prod.length, corte, proyeccion: A ? A.combinada : null, margenProyectado: M ? M.actual.combinada : null },
  };
}

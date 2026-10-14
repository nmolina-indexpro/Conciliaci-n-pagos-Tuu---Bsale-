// /lib/servicio-tecnico-correo.js
// ══════════════════════════════════════════════════════════════════════
// Correo semanal de Servicio Técnico (lunes) con el mismo estilo del correo diario de cotizaciones ("Qué hacer hoy"):
// lo urgente arriba, tarjetas con cifras, detalle corto y un botón al ERP.
// ══════════════════════════════════════════════════════════════════════
// Funciones puras (sin red ni base de datos) para poder probarlas.
//
// Fuentes:
//   · Bsale (tabla bsale_servicios_ventas): servicios vendidos en la semana recién terminada y su comparación con la anterior.
//   · Zoho Desk (las mismas métricas del dashboard de la página Servicio Técnico, ver lib/zoho-metricas.js): órdenes abiertas y
//     vencidas, equipos por retirar (cobro de acopio), clientes esperando respuesta, ingresos vs. cierres, tiempo de resolución
//     y carga por técnico. Si Zoho no responde, el correo sale igual solo con la parte de Bsale y lo avisa.
//
// Sin montos en pesos: las notificaciones al equipo no llevan datos financieros (solo cantidades y plazos).

export const UMBRAL_ESPERA_DIAS = 2; // un cliente que espera 2+ días sin respuesta ya cuenta como atrasado
export const UMBRAL_RESOLUCION_BUENA = 70; // % de órdenes cerradas en 3 días o menos para pintar en verde
export const UMBRAL_RESOLUCION_REGULAR = 40;
const FILAS_LISTA = 5;
const FILAS_SERVICIOS = 8;

export const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = n => Number(n || 0).toLocaleString('es-CL');
const dec = n => (n == null ? '—' : String(n).replace('.', ','));
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// 'YYYY-MM-DD' -> '21 sep'
const diaCorto = s => { const [, m, d] = String(s).split('-'); return `${Number(d)} ${MESES_CORTOS[Number(m) - 1]}`; };
const plural = (n, uno, varios) => (Number(n) === 1 ? uno : varios);

// Variación porcentual; null = "nuevo" (no había base de comparación)
export function variacionPct(actual, anterior) {
  if (!anterior) return actual > 0 ? null : 0;
  return Math.round(((actual - anterior) / anterior) * 100);
}
// subeEsBueno: en servicios vendidos subir es bueno (verde); en lo que se acumula (abiertas) sería al revés.
function textoVariacion(pct, referencia, subeEsBueno = true) {
  if (pct === null) return `<span style="color:#15803D;font-weight:700;">▲ nuevo</span> <span style="color:#64748b;">(sin datos ${referencia})</span>`;
  if (pct === 0) return `<span style="color:#64748b;">＝ igual que ${referencia}</span>`;
  const bueno = (pct > 0) === subeEsBueno;
  return `<span style="color:${bueno ? '#15803D' : '#B91C1C'};font-weight:700;">${pct > 0 ? '▲ +' : '▼ '}${pct}%</span> <span style="color:#64748b;">vs. ${referencia}</span>`;
}

const TONOS = {
  rojo: { fondo: '#FDE2E2', texto: '#B91C1C' },
  naranja: { fondo: '#FFEDD5', texto: '#C2410C' },
  amarillo: { fondo: '#FEF3C7', texto: '#92400E' },
  verde: { fondo: '#E3F6EA', texto: '#12713A' },
  azul: { fondo: '#E8F0FE', texto: '#0B57D0' },
  gris: { fondo: '#EEF2F9', texto: '#475569' },
};

// Calcula el tono y el texto de cada indicador de Zoho a partir de las métricas del dashboard. Se separa del HTML para probarlo.
export function evaluarIndicadoresZoho(z) {
  if (!z) return null;
  const b = z.backlog || {}, pr = (b.porRetirar || {}), e = z.esperandoRespuesta || {}, f = z.flujo || {}, r = z.resolucion || {};
  const balance = (f.cerrados4 || 0) - (f.ingresados4 || 0);
  const abiertas = { total: b.total || 0, vencidas: b.vencidos || 0, tono: (b.vencidos || 0) > 0 ? 'rojo' : 'verde' };
  const porRetirar = {
    total: pr.total || 0, conAcopio: pr.conAcopio || 0, diasAcopio: pr.diasAcopio || 15, masAntiguos: pr.masAntiguos || [],
    tono: (pr.conAcopio || 0) > 0 ? 'rojo' : (pr.total || 0) > 0 ? 'amarillo' : 'verde',
  };
  const esperando = { total: e.total || 0, atrasados: e.masDeDosDias || 0, lista: e.lista || [], tono: (e.masDeDosDias || 0) > 0 ? 'naranja' : (e.total || 0) > 0 ? 'amarillo' : 'verde' };
  const flujo = {
    ingresados4: f.ingresados4 || 0, cerrados4: f.cerrados4 || 0, ingresadosPrev4: f.ingresadosPrev4 || 0, cerradosPrev4: f.cerradosPrev4 || 0, balance, semanas: f.semanas || [],
    tono: balance >= 0 ? 'verde' : 'naranja',
  };
  const pct = r.pctEn3Dias;
  const resolucion = {
    cerrados: r.cerrados || 0, promedio: r.promedio, mediana: r.mediana, pctEn3Dias: pct,
    tono: pct == null ? 'gris' : pct >= UMBRAL_RESOLUCION_BUENA ? 'verde' : pct >= UMBRAL_RESOLUCION_REGULAR ? 'amarillo' : 'rojo',
  };
  // Lo que requiere acción esta semana, en orden de gravedad
  const alertas = [];
  if (porRetirar.conAcopio) alertas.push({ tono: 'rojo', texto: `<b>${porRetirar.conAcopio}</b> ${plural(porRetirar.conAcopio, 'equipo lleva', 'equipos llevan')} ${porRetirar.diasAcopio}+ días listo${plural(porRetirar.conAcopio, '', 's')} por retirar: ya corre el cobro de acopio. Avisa al cliente.` });
  if (abiertas.vencidas) alertas.push({ tono: 'rojo', texto: `<b>${abiertas.vencidas}</b> ${plural(abiertas.vencidas, 'orden vencida', 'órdenes vencidas')} (pasaron su fecha de compromiso).` });
  if (esperando.atrasados) alertas.push({ tono: 'naranja', texto: `<b>${esperando.atrasados}</b> ${plural(esperando.atrasados, 'cliente espera', 'clientes esperan')} respuesta hace ${UMBRAL_ESPERA_DIAS}+ días.` });
  if (flujo.balance < 0) alertas.push({ tono: 'amarillo', texto: `En las últimas 4 semanas ingresaron <b>${flujo.ingresados4}</b> órdenes y se cerraron <b>${flujo.cerrados4}</b>: la cola crece en ${-flujo.balance}.` });
  return { abiertas, porRetirar, esperando, flujo, resolucion, alertas, porAgente: z.porAgente || [] };
}

// semana / semanaPrevia: { filas: [{ sku, nombre, cantidad }], cantidadTotal }
// zoho: resultado de calcularMetricasTickets o null; zohoError: texto si no se pudo leer Zoho.
export function armarCorreoServicioTecnico({ semana, semanaPrevia, inicio, fin, zoho = null, zohoError = null, ultimaSincronizacion = null, urlBase, ahora = new Date() }) {
  const ind = evaluarIndicadoresZoho(zoho);
  const urlPagina = `${urlBase}/servicio-tecnico.html`;
  const [a, m, d] = fin.split('-');
  const rango = `${diaCorto(inicio)} al ${diaCorto(fin)} de ${a}`;
  const fechaLarga = `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`;

  const partes = [`${semana.cantidadTotal} ${plural(semana.cantidadTotal, 'servicio vendido', 'servicios vendidos')}`];
  if (ind) {
    if (ind.porRetirar.conAcopio) partes.push(`${ind.porRetirar.conAcopio} con acopio`);
    if (ind.abiertas.vencidas) partes.push(`${ind.abiertas.vencidas} ${plural(ind.abiertas.vencidas, 'vencida', 'vencidas')}`);
    if (ind.esperando.atrasados) partes.push(`${ind.esperando.atrasados} ${plural(ind.esperando.atrasados, 'cliente esperando', 'clientes esperando')}`);
  }
  const asunto = `🔧 Servicio Técnico, semana del ${diaCorto(inicio)} al ${diaCorto(fin)}: ${partes.join(' · ')}`;

  const th = 'padding:7px 9px;text-align:left;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:#ffffff;background:#0b2a5b;';
  const td = 'padding:8px 9px;border-bottom:1px solid #e3ebf8;vertical-align:top;font-size:13px;line-height:1.35;color:#1b2a41;';
  const h3 = 'margin:26px 0 8px;padding:0 0 6px;font-size:16px;color:#0b2a5b;border-bottom:2px solid #dbe7fb;';
  const chip = (texto, tono) => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap;background:${TONOS[tono].fondo};color:${TONOS[tono].texto};">${texto}</span>`;
  const tonoDias = dias => (dias >= 7 ? 'rojo' : dias >= 3 ? 'naranja' : 'amarillo');
  const enlace = (t, texto) => (t.url ? `<a href="${esc(t.url)}" style="color:#0b57d0;text-decoration:none;font-weight:600;">${texto} ↗</a>` : `<span style="color:#5b6b86;">${texto}</span>`);

  // Tarjeta de indicador: etiqueta, cifra grande, subtítulo
  const tarjeta = (etiqueta, cifra, sub, tono) => `<td width="33%" style="padding:5px;vertical-align:top;"><div style="background:${TONOS[tono].fondo};border-radius:12px;padding:12px 14px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${TONOS[tono].texto};">${etiqueta}</div>
      <div style="font-size:28px;font-weight:800;line-height:1.1;color:#1b2a41;margin-top:2px;">${cifra}</div>
      <div style="font-size:12.5px;color:#475569;margin-top:2px;line-height:1.35;">${sub}</div></div></td>`;

  const pctServ = variacionPct(semana.cantidadTotal, semanaPrevia.cantidadTotal);
  const tarjetaVentas = tarjeta('🔧 Servicios vendidos', num(semana.cantidadTotal), textoVariacion(pctServ, 'semana anterior'), semana.cantidadTotal ? 'azul' : 'gris');

  let kpis;
  if (ind) {
    const { abiertas, porRetirar, esperando, flujo, resolucion } = ind;
    const subFlujo = `${flujo.cerrados4} cerradas · ${flujo.ingresados4} ingresadas<br><span style="color:#64748b;">últimas 4 semanas (antes: ${flujo.cerradosPrev4} y ${flujo.ingresadosPrev4})</span>`;
    const cifraFlujo = `${flujo.balance > 0 ? '+' : ''}${flujo.balance}`;
    const subRes = resolucion.cerrados
      ? `${resolucion.pctEn3Dias}% se cierra en 3 días o menos<br><span style="color:#64748b;">mediana ${dec(resolucion.mediana)} d · ${resolucion.cerrados} cerradas en 90 días</span>`
      : 'Sin órdenes cerradas en el período';
    kpis = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 -5px;">
      <tr>${tarjetaVentas}
        ${tarjeta('📂 Órdenes abiertas', num(abiertas.total), abiertas.vencidas ? `<b style="color:#B91C1C;">${abiertas.vencidas} ${plural(abiertas.vencidas, 'vencida', 'vencidas')}</b>` : 'ninguna vencida', abiertas.tono)}
        ${tarjeta('📦 Por retirar', num(porRetirar.total), porRetirar.conAcopio ? `<b style="color:#B91C1C;">${porRetirar.conAcopio} con ${porRetirar.diasAcopio}+ días</b> (acopio)` : porRetirar.total ? `ninguno con ${porRetirar.diasAcopio}+ días` : 'ninguno esperando', porRetirar.tono)}</tr>
      <tr>${tarjeta('💬 Esperan respuesta', num(esperando.total), esperando.atrasados ? `<b style="color:#C2410C;">${esperando.atrasados} hace ${UMBRAL_ESPERA_DIAS}+ días</b>` : esperando.total ? `ninguno hace ${UMBRAL_ESPERA_DIAS}+ días` : 'al día', esperando.tono)}
        ${tarjeta('⚖️ Cierres − ingresos', cifraFlujo, subFlujo, flujo.tono)}
        ${tarjeta('⏱️ Resolución', resolucion.promedio == null ? '—' : `${dec(resolucion.promedio)} d`, subRes, resolucion.tono)}</tr>
    </table>`;
  } else {
    kpis = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 -5px;"><tr>${tarjetaVentas}<td width="67%"></td></tr></table>`;
  }

  // ---- requiere atención
  let bloqueAtencion = '';
  if (ind) {
    bloqueAtencion = ind.alertas.length
      ? `<h3 style="margin:22px 0 8px;padding:0 0 6px;font-size:16px;color:#0b2a5b;border-bottom:2px solid #dbe7fb;">🚨 Requiere atención</h3>${ind.alertas.map(x => `<div style="background:${TONOS[x.tono].fondo};color:#1b2a41;border-left:4px solid ${TONOS[x.tono].texto};border-radius:8px;padding:9px 12px;margin:6px 0;font-size:13.5px;line-height:1.45;">${x.texto}</div>`).join('')}`
      : `<div style="margin-top:18px;background:#e3f6ea;border-radius:12px;padding:14px 18px;font-size:14px;color:#12713a;">✅ <b>Todo al día en Zoho Desk:</b> sin órdenes vencidas, sin equipos con acopio y sin clientes esperando respuesta hace más de ${UMBRAL_ESPERA_DIAS} días.</div>`;
  } else {
    bloqueAtencion = `<div style="margin-top:18px;background:#FEF3C7;border-radius:12px;padding:12px 16px;font-size:13px;line-height:1.5;color:#92400E;">⚠️ No se pudo leer Zoho Desk esta vez${zohoError ? ` (${esc(zohoError)})` : ''}, así que faltan las órdenes abiertas, los equipos por retirar y los tiempos de resolución. Revísalos directo en el ERP.</div>`;
  }

  // ---- clientes esperando respuesta y equipos por retirar
  let bloqueListas = '';
  if (ind) {
    const esp = ind.esperando.lista.slice(0, FILAS_LISTA);
    const ret = ind.porRetirar.masAntiguos.slice(0, FILAS_LISTA);
    if (esp.length) {
      bloqueListas += `<h3 style="${h3}">💬 Clientes esperando respuesta</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;">
        <tr><th style="${th}">Cliente</th><th style="${th}">Técnico</th><th style="${th}text-align:right;">Esperando</th></tr>
        ${esp.map((t, k) => `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};">
          <td style="${td}"><b>${esc(t.cliente)}</b><br><span style="font-size:11.5px;">${enlace(t, `#${esc(t.numero)}`)} · ${esc(t.asunto).slice(0, 70)}</span></td>
          <td style="${td}white-space:nowrap;">${esc(t.agente)}</td>
          <td style="${td}text-align:right;">${t.dias == null ? '' : chip(t.dias < 1 ? 'hoy' : `${Math.floor(t.dias)} ${Math.floor(t.dias) === 1 ? 'día' : 'días'}`, t.dias >= 4 ? 'rojo' : t.dias >= UMBRAL_ESPERA_DIAS ? 'naranja' : 'amarillo')}</td></tr>`).join('')}
        ${ind.esperando.total > esp.length ? `<tr><td colspan="3" style="${td}color:#64748b;font-size:12px;">… y ${ind.esperando.total - esp.length} más en el ERP.</td></tr>` : ''}
      </table>`;
    }
    if (ret.length) {
      bloqueListas += `<h3 style="${h3}">📦 Equipos listos por retirar (los más antiguos)</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;">
        <tr><th style="${th}">Cliente</th><th style="${th}text-align:right;">Esperando retiro</th></tr>
        ${ret.map((t, k) => `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};">
          <td style="${td}"><b>${esc(t.cliente)}</b><br><span style="font-size:11.5px;">${enlace(t, `#${esc(t.numero)}`)} · ${esc(t.asunto).slice(0, 70)}</span></td>
          <td style="${td}text-align:right;">${t.dias == null ? '' : chip(`${t.dias} ${t.dias === 1 ? 'día' : 'días'}${t.dias >= ind.porRetirar.diasAcopio ? ' · acopio' : ''}`, t.dias >= ind.porRetirar.diasAcopio ? 'rojo' : tonoDias(t.dias))}</td></tr>`).join('')}
        ${ind.porRetirar.total > ret.length ? `<tr><td colspan="2" style="${td}color:#64748b;font-size:12px;">… y ${ind.porRetirar.total - ret.length} más en el ERP.</td></tr>` : ''}
      </table>`;
    }
  }

  // ---- ingresos vs cierres por semana (barras simples hechas con tablas, que sí se ven en todos los clientes de correo)
  let bloqueFlujo = '';
  if (ind && ind.flujo.semanas.length) {
    const semanas = ind.flujo.semanas;
    const maximo = Math.max(1, ...semanas.map(s => Math.max(s.ingresados, s.cerrados)));
    const barra = (valor, color) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:1px 0;"><tr>
      <td style="background:${color};height:9px;line-height:9px;font-size:1px;width:${Math.max(valor ? 3 : 0, Math.round((valor / maximo) * 190))}px;border-radius:0 4px 4px 0;">&nbsp;</td>
      <td style="padding-left:6px;font-size:11.5px;color:#334155;">${valor}</td></tr></table>`;
    bloqueFlujo = `<h3 style="${h3}">⚖️ Ingresos vs. cierres por semana</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;">
        ${semanas.map((s, k) => `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};">
          <td style="${td}width:96px;white-space:nowrap;font-size:12px;">Sem. ${diaCorto(s.semana)}${k === semanas.length - 1 ? '<br><span style="color:#64748b;font-size:11px;">en curso</span>' : ''}</td>
          <td style="${td}">${barra(s.ingresados, '#0b57d0')}${barra(s.cerrados, '#16a34a')}</td></tr>`).join('')}
        <tr><td colspan="2" style="${td}font-size:11.5px;color:#475569;"><span style="color:#0b57d0;font-weight:700;">■</span> Ingresadas &nbsp; <span style="color:#16a34a;font-weight:700;">■</span> Cerradas</td></tr>
      </table>`;
  }

  // ---- carga por técnico
  let bloqueTecnicos = '';
  if (ind && ind.porAgente.length) {
    const filas = ind.porAgente.filter(x => x.abiertos || x.cerradosPeriodo).slice(0, 8);
    if (filas.length) {
      bloqueTecnicos = `<h3 style="${h3}">🧑‍🔧 Carga por técnico</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;">
        <tr><th style="${th}">Técnico</th><th style="${th}text-align:right;">Abiertas</th><th style="${th}text-align:right;">Cerradas (30 d)</th><th style="${th}text-align:right;">Días prom.</th></tr>
        ${filas.map((x, k) => `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};">
          <td style="${td}"><b>${esc(x.agente)}</b></td>
          <td style="${td}text-align:right;font-weight:700;">${x.abiertos}</td>
          <td style="${td}text-align:right;">${x.cerradosPeriodo}</td>
          <td style="${td}text-align:right;">${dec(x.diasPromedio)}</td></tr>`).join('')}
      </table>`;
    }
  }

  // ---- servicios más vendidos de la semana
  const previos = new Map((semanaPrevia.filas || []).map(f => [f.sku, Number(f.cantidad)]));
  const top = (semana.filas || []).slice(0, FILAS_SERVICIOS);
  const bloqueServicios = top.length
    ? `<h3 style="${h3}">🛠️ Servicios más vendidos</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;">
        <tr><th style="${th}">Servicio</th><th style="${th}text-align:right;">Unidades</th><th style="${th}text-align:right;">Semana anterior</th></tr>
        ${top.map((f, k) => {
          const cant = Number(f.cantidad), ant = previos.get(f.sku) || 0;
          const tono = cant > ant ? 'verde' : cant < ant ? 'rojo' : 'gris';
          return `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};">
          <td style="${td}"><b>${esc(f.nombre || f.sku)}</b></td>
          <td style="${td}text-align:right;font-weight:800;">${num(cant)}</td>
          <td style="${td}text-align:right;">${chip(`${cant > ant ? '▲' : cant < ant ? '▼' : '＝'} ${num(ant)}`, tono)}</td></tr>`;
        }).join('')}
        ${semana.filas.length > top.length ? `<tr><td colspan="3" style="${td}color:#64748b;font-size:12px;">… y ${semana.filas.length - top.length} servicios más en el ERP.</td></tr>` : ''}
      </table>`
    : `<div style="margin-top:20px;background:#f5f8fe;border:1px solid #dbe7fb;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155;">No se registraron servicios vendidos en Bsale esta semana.</div>`;

  const sinc = ultimaSincronizacion
    ? `Ventas de servicios sincronizadas desde Bsale hasta el ${new Date(ultimaSincronizacion).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}.`
    : 'Las ventas de servicios no se han sincronizado desde Bsale: hazlo en la página Servicio Técnico.';

  const html = `
<div style="margin:0;padding:24px 12px;background:#eef2f9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;border-collapse:separate;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td style="background:#0b2a5b;border-radius:14px 14px 0 0;padding:24px 26px 20px;">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9db8ea;font-weight:700;">IndexStore · Servicio Técnico</div>
      <div style="margin-top:6px;font-size:25px;line-height:1.25;color:#ffffff;font-weight:800;">Resumen de la semana</div>
      <div style="margin-top:4px;font-size:14px;color:#c9d9f7;">${rango} · enviado el ${fechaLarga}</div>
    </td></tr>
    <tr><td style="background:#ffffff;padding:20px 22px 24px;color:#1b2a41;font-size:14px;line-height:1.55;">
      ${kpis}
      ${bloqueAtencion}
      ${bloqueListas}
      ${bloqueFlujo}
      ${bloqueTecnicos}
      ${bloqueServicios}
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 0;"><tr><td style="background:#0b57d0;border-radius:10px;">
        <a href="${urlPagina}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">Abrir Servicio Técnico en el ERP</a>
      </td></tr></table>
      <div style="margin-top:18px;font-size:11.5px;line-height:1.5;color:#64748b;">
        <b>Cómo leerlo:</b> 🔴 rojo = hay que actuar ya (órdenes vencidas o equipos con ${ind ? ind.porRetirar.diasAcopio : 15}+ días por retirar, cuando parte el cobro de acopio) · 🟠 naranja = atrasado (cliente esperando ${UMBRAL_ESPERA_DIAS}+ días, o entran más órdenes de las que se cierran) · 🟢 verde = al día.
        La resolución va en verde si el ${UMBRAL_RESOLUCION_BUENA}% o más de las órdenes se cierra en 3 días o menos. Las órdenes, retiros, esperas y técnicos vienen de Zoho Desk (departamentos de Servicio Técnico, igual que el dashboard de la página); los servicios vendidos, de Bsale.
        ${esc(sinc)}
      </div>
    </td></tr>
    <tr><td style="background:#f5f8fe;border-top:1px solid #dbe7fb;border-radius:0 0 14px 14px;padding:14px 26px;font-size:12px;line-height:1.5;color:#5b6b86;">
      <b style="color:#0b2a5b;">Notificación del sistema ERP · IndexStore</b><br>
      Mensaje automático: no respondas a este correo. Puedes cambiar quién lo recibe en el ERP, en Usuarios &gt; Notificaciones.
    </td></tr>
  </table>
</div>`;
  return { asunto, html, indicadores: ind };
}

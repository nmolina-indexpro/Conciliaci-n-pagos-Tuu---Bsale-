// /lib/whatsapp-resumen-correo.js
// ══════════════════════════════════════════════════════════════════════
// Correo diario de WhatsApp: ejecutivos de ayer + 10 análisis de los últimos 7 días (los mismos de la pestaña Analítica de Clientes WhatsApp),
// con el diseño de los otros correos del ERP (encabezado azul, tarjetas, "lo que destaca", detalle corto, botón al ERP, leyenda y pie).
// ══════════════════════════════════════════════════════════════════════
// Funciones puras (sin red ni base de datos) para poder probarlas. Sin montos en pesos: solo cantidades y porcentajes.
//
// Entradas:
//   ejecutivos / sinAsignar : calcularWhatsappAnaliticaEjecutivos(ayer)
//   semana                  : respuesta de manejarWhatsappAnalitica para los últimos 7 días (hasta ayer)
//   serie14                 : serie diaria de los últimos 14 días (la de manejarWhatsappAnalitica con 14 días): [{ fecha, conversaciones, clientesUnicos, ventas }]
//
// Los 10 análisis: 1 evolución temporal · 2 horarios de los mensajes · 3 categorías consultadas · 4 embudo de conversión ·
// 5 propuestas: cotizaciones y links enviados (intención de venta) · 6 motivos de pérdida · 7 ranking de productos · 8 marcas y modelos · 9 fuente de ingreso · 10 ventas vinculadas a Bsale.

export const HORA_NOCHE_DESDE = 22; // mensajes entre las 22:00 y las 07:59 cuentan como "de noche" (cuando atiende el bot nocturno)
export const HORA_NOCHE_HASTA = 7;
const TOP = 5;

export const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = n => Number(n || 0).toLocaleString('es-CL');
const dec = n => (n == null ? '—' : String(Math.round(n * 10) / 10).replace('.', ','));
const pct = (n, t) => (t > 0 ? Math.round((n / t) * 1000) / 10 : 0);
const plural = (n, uno, varios) => (Number(n) === 1 ? uno : varios);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const diaChile = v => new Date(v).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const CATEGORIA = {
  pantalla: 'Pantallas notebook', cargador: 'Cargadores', bateria: 'Baterías', servicio_tecnico: 'Servicio técnico', repuestos: 'Repuestos',
  cotizacion: 'Cotización', compatibilidad: 'Compatibilidad', garantia: 'Garantía', estado_pedido: 'Estado de pedido', postventa: 'Postventa',
  otra: 'Otra', sin_categoria: 'Sin categorizar',
};
const FUENTE = {
  anuncio: '📢 Anuncios de Meta', boton_sitio: '📎 Botón de WhatsApp del sitio', google_ads: '🔍 Google Ads', utm: '🔗 Link con UTM (otro)',
  desconocido: '❓ Origen desconocido', shopify_journey: '🛍️ Origen real de la venta (Shopify)',
};
const TONOS = {
  rojo: { fondo: '#FDE2E2', texto: '#B91C1C' }, naranja: { fondo: '#FFEDD5', texto: '#C2410C' }, amarillo: { fondo: '#FEF3C7', texto: '#92400E' },
  verde: { fondo: '#E3F6EA', texto: '#12713A' }, azul: { fondo: '#E8F0FE', texto: '#0B57D0' }, gris: { fondo: '#EEF2F9', texto: '#475569' },
};

export function variacionPct(actual, anterior) {
  if (!anterior) return actual > 0 ? null : 0;
  return Math.round(((actual - anterior) / anterior) * 100);
}

// Cálculos de los 10 análisis a partir de las respuestas de la analítica. Se separan del HTML para probarlos.
export function calcularResumenWhatsapp({ ejecutivos = [], sinAsignar = null, semana = {}, serie14 = [], dia }) {
  const serie = [...serie14].map(s => ({ dia: diaChile(s.fecha), conversaciones: s.conversaciones || 0, clientesUnicos: s.clientesUnicos || 0, ventas: s.ventas || 0 })).sort((a, b) => (a.dia < b.dia ? -1 : 1));
  const ultimos = serie.slice(-7), previos = serie.slice(-14, -7);
  const suma = (a, k) => a.reduce((s, x) => s + x[k], 0);
  const ayer = serie.find(s => s.dia === dia) || { dia, conversaciones: 0 };
  const anteriores6 = serie.filter(s => s.dia < dia).slice(-6);
  const promedio6 = anteriores6.length ? suma(anteriores6, 'conversaciones') / anteriores6.length : null;
  const evolucion = {
    dias: serie.slice(-14), semana: suma(ultimos, 'conversaciones'), semanaPrevia: suma(previos, 'conversaciones'),
    ventasSemana: suma(ultimos, 'ventas'), ayer: ayer.conversaciones, promedio6,
  };
  evolucion.variacionSemana = variacionPct(evolucion.semana, evolucion.semanaPrevia);
  evolucion.variacionAyer = promedio6 ? Math.round(((ayer.conversaciones - promedio6) / promedio6) * 100) : null;

  // 2) Horarios
  const horas = (semana.horarios && semana.horarios.general) || Array(24).fill(0);
  const totalHoras = horas.reduce((s, x) => s + x, 0);
  const horaPunta = totalHoras ? horas.indexOf(Math.max(...horas)) : null;
  let mejorFranja = null;
  for (let h = 0; h < 22 && totalHoras; h++) { const s = horas[h] + horas[h + 1] + horas[h + 2]; if (!mejorFranja || s > mejorFranja.n) mejorFranja = { desde: h, hasta: h + 3, n: s }; }
  const nocturnos = horas.reduce((s, x, h) => s + ((h >= HORA_NOCHE_DESDE || h <= HORA_NOCHE_HASTA) ? x : 0), 0);
  const horarios = { horas, total: totalHoras, horaPunta, mejorFranja, pctNoche: pct(nocturnos, totalHoras) };

  // 3) Categorías
  const totalCat = (semana.distribucionCategoria || []).reduce((s, x) => s + x.cantidad, 0);
  const categorias = (semana.distribucionCategoria || []).slice(0, 6).map(c => ({ nombre: CATEGORIA[c.categoria] || c.categoria, cantidad: c.cantidad, pct: pct(c.cantidad, totalCat) }));

  // 4) Embudo
  const e = semana.embudo || { conversaciones: 0, intencion_compra: 0, cotizacion: 0, venta: 0 };
  const cc = semana.conversionComercial || {};
  // Tercer paso = propuesta entregada: cotización (emitida o pedida por el cliente) o link de compra enviado.
  const propuestas = cc.propuestas != null ? cc.propuestas : (cc.conversiones != null ? cc.conversiones : e.cotizacion);
  const embudo = {
    pasos: [
      { nombre: 'Conversaciones', n: e.conversaciones },
      { nombre: 'Con intención de compra', n: e.intencion_compra },
      { nombre: 'Cotización o link enviado', n: propuestas },
      { nombre: 'Venta', n: e.venta },
    ].map((p, i, a) => ({ ...p, pctTotal: pct(p.n, a[0].n), pctPaso: i ? Math.min(100, pct(p.n, a[i - 1].n)) : 100 })),
  };

  // 5) Propuestas: cotización (emitida en el sistema o pedida por el cliente) y link enviado (tenemos el producto y le mandamos el enlace u oferta
  // para que compre en la tienda). Una conversación puede tener las dos; "propuestas" cuenta cada conversación una sola vez.
  const cotizaciones = {
    propuestas, cotizaciones: cc.cotizacionesEmitidas || 0, links: cc.linkEnviado || 0, ambas: cc.linkYCotizacion || 0,
    pctPropuestas: pct(propuestas, e.conversaciones), medianaMin: cc.medianaMinutosAOferta ?? null,
    sinPropuesta: cc.pendientesSinPropuesta != null ? cc.pendientesSinPropuesta : (cc.intencionSinConversion || 0), conIntencion: cc.conIntencionCompra || 0,
    pctVentaTrasCotizacion: cc.pctVentaTrasCotizacion || 0, pctVentaTrasLink: cc.pctVentaTrasLink || 0, pctVentaTrasPropuesta: cc.pctVentaSobreConversion || 0,
  };

  // 6) Motivos de pérdida
  const motivos = (semana.motivosPerdida || []).slice(0, TOP).map(m => ({ nombre: m.etiqueta || m.motivo, cantidad: m.cantidad, pct: m.porcentaje }));
  const totalPerdidas = (semana.motivosPerdida || []).reduce((s, m) => s + m.cantidad, 0);

  // 7) Productos, 8) marcas y modelos
  const productos = (semana.rankingProductos || []).slice(0, TOP);
  const marcas = (semana.rankingMarcas || []).slice(0, TOP);
  const modelos = (semana.rankingModelos || []).slice(0, TOP);

  // 9) Fuentes
  const fuentes = (semana.fuentes || []).filter(f => f.tipo !== 'shopify_journey').map(f => ({ nombre: FUENTE[f.tipo] || f.tipo, cantidad: f.cantidad, ventas: f.ventas, pctVenta: pct(f.ventas, f.cantidad) }));
  const totalFuentes = fuentes.reduce((s, f) => s + f.cantidad, 0);
  fuentes.forEach(f => { f.pct = pct(f.cantidad, totalFuentes); });

  // 10) Ventas vinculadas a Bsale
  const b = semana.embudoBsale || { conversaciones: 0, vinculadas: 0, ventaEnPeriodo: 0 };
  const bsale = { conversaciones: b.conversaciones, vinculadas: b.vinculadas, ventaEnPeriodo: b.ventaEnPeriodo, pctVinculadas: pct(b.vinculadas, b.conversaciones), pctVenta: pct(b.ventaEnPeriodo, b.conversaciones) };

  // Lo que destaca
  const destaca = [];
  if (sinAsignar && sinAsignar.total) destaca.push({ tono: 'naranja', texto: `<b>${num(sinAsignar.total)}</b> ${plural(sinAsignar.total, 'conversación sigue', 'conversaciones siguen')} sin ejecutivo asignado.` });
  if (cotizaciones.sinPropuesta) destaca.push({ tono: 'naranja', texto: `<b>${num(cotizaciones.sinPropuesta)}</b> ${plural(cotizaciones.sinPropuesta, 'conversación con intención de compra sigue', 'conversaciones con intención de compra siguen')} sin cotización ni link, con actividad en los últimos 3 días.` });
  if (motivos[0]) destaca.push({ tono: 'amarillo', texto: `Principal motivo de pérdida: <b>${esc(motivos[0].nombre)}</b> (${dec(motivos[0].pct)}% de las perdidas).` });
  if (horarios.horaPunta != null) destaca.push({ tono: 'azul', texto: `Hora punta: <b>${String(horarios.horaPunta).padStart(2, '0')}:00</b>. ${dec(horarios.pctNoche)}% de los mensajes llega de noche (${HORA_NOCHE_DESDE}:00 a ${String(HORA_NOCHE_HASTA + 1).padStart(2, '0')}:00).` });
  if (evolucion.variacionSemana !== null && Math.abs(evolucion.variacionSemana) >= 15) destaca.push({ tono: evolucion.variacionSemana > 0 ? 'verde' : 'rojo', texto: `Las conversaciones ${evolucion.variacionSemana > 0 ? 'subieron' : 'bajaron'} <b>${Math.abs(evolucion.variacionSemana)}%</b> frente a la semana anterior.` });

  const totalEjecutivos = ejecutivos.reduce((s, x) => s + x.total, 0) + (sinAsignar ? sinAsignar.total : 0);
  return { evolucion, horarios, categorias, embudo, cotizaciones, motivos, totalPerdidas, productos, marcas, modelos, fuentes, bsale, destaca, totalEjecutivos, clientesSemana: (semana.clientes || []).length };
}

function textoVariacion(pctV, referencia) {
  if (pctV === null) return `<span style="color:#15803D;font-weight:700;">▲ nuevo</span> <span style="color:#64748b;">(sin datos ${referencia})</span>`;
  if (pctV === 0) return `<span style="color:#64748b;">＝ igual que ${referencia}</span>`;
  return `<span style="color:${pctV > 0 ? '#15803D' : '#B91C1C'};font-weight:700;">${pctV > 0 ? '▲ +' : '▼ '}${pctV}%</span> <span style="color:#64748b;">vs. ${referencia}</span>`;
}

export function armarCorreoWhatsapp({ dia, ejecutivos = [], sinAsignar = null, semana = {}, serie14 = [], seguimientos = null, avisoAnalitica = null, urlBase, rangoSemana = null }) {
  const r = calcularResumenWhatsapp({ ejecutivos, sinAsignar, semana, serie14, dia });
  const [a, m, d] = dia.split('-');
  const fechaLarga = `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`;
  const asunto = `📈 WhatsApp ${dia}: ${num(r.evolucion.ayer)} ${plural(r.evolucion.ayer, 'conversación', 'conversaciones')} ayer · ${num(r.evolucion.semana)} en 7 días`;
  const diaCortoStr = s => { const [, mm, dd] = s.split('-'); return `${Number(dd)} ${MESES_CORTOS[Number(mm) - 1]}`; };

  const th = 'padding:7px 9px;text-align:left;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:#ffffff;background:#0b2a5b;';
  const td = 'padding:8px 9px;border-bottom:1px solid #e3ebf8;vertical-align:middle;font-size:13px;line-height:1.35;color:#1b2a41;';
  const h3 = 'margin:28px 0 4px;padding:0 0 6px;font-size:16px;color:#0b2a5b;border-bottom:2px solid #dbe7fb;';
  const sub = 'margin:0 0 8px;font-size:12px;color:#64748b;';
  const chip = (texto, tono) => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap;background:${TONOS[tono].fondo};color:${TONOS[tono].texto};">${texto}</span>`;
  const tarjeta = (etiqueta, cifra, subtitulo, tono) => `<td width="25%" style="padding:4px;vertical-align:top;"><div style="background:${TONOS[tono].fondo};border-radius:12px;padding:11px 12px;">
      <div style="font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${TONOS[tono].texto};">${etiqueta}</div>
      <div style="font-size:26px;font-weight:800;line-height:1.1;color:#1b2a41;margin-top:2px;">${cifra}</div>
      <div style="font-size:12px;color:#475569;margin-top:2px;line-height:1.35;">${subtitulo}</div></div></td>`;
  // Barra horizontal: etiqueta | barra | cifra
  const filaBarra = (etiqueta, valor, maximo, color, cifra, k) => `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};">
      <td style="${td}width:34%;">${etiqueta}</td>
      <td style="${td}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="background:${color};height:10px;line-height:10px;font-size:1px;border-radius:0 5px 5px 0;width:${Math.max(valor ? 2 : 0, Math.round((valor / Math.max(1, maximo)) * 100))}%;">&nbsp;</td><td></td></tr></table></td>
      <td style="${td}width:84px;text-align:right;white-space:nowrap;font-weight:700;">${cifra}</td></tr>`;
  const tablaBarras = filas => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;">${filas}</table>`;
  const vacio = t => `<div style="background:#f5f8fe;border:1px solid #dbe7fb;border-radius:10px;padding:11px 14px;font-size:12.5px;color:#64748b;">${t}</div>`;
  const seccion = (n, titulo, descripcion, cuerpo) => `<h3 style="${h3}">${n}. ${titulo}</h3><p style="${sub}">${descripcion}</p>${cuerpo}`;

  // ---- KPIs
  const { evolucion, cotizaciones, bsale, embudo } = r;
  const kpis = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 -4px;"><tr>
    ${tarjeta('💬 Ayer', num(evolucion.ayer), evolucion.variacionAyer == null ? 'conversaciones' : textoVariacion(evolucion.variacionAyer, 'promedio de los 6 días anteriores'), 'azul')}
    ${tarjeta('📅 Últimos 7 días', num(evolucion.semana), textoVariacion(evolucion.variacionSemana, 'semana anterior'), 'azul')}
    ${tarjeta('📝 Cotización o link', num(cotizaciones.propuestas), `${num(cotizaciones.cotizaciones)} cotizaciones · ${num(cotizaciones.links)} links<br><span style="color:#64748b;">${dec(cotizaciones.pctPropuestas)}% de las conversaciones · 7 días</span>`, cotizaciones.sinPropuesta ? 'naranja' : 'verde')}
    ${tarjeta('🛒 Ventas', num(embudo.pasos[3].n), `${dec(embudo.pasos[3].pctTotal)}% de las conversaciones<br><span style="color:#64748b;">7 días</span>`, 'verde')}
  </tr></table>`;

  // ---- lo que destaca
  const bloqueDestaca = r.destaca.length
    ? `<h3 style="margin:22px 0 8px;padding:0 0 6px;font-size:16px;color:#0b2a5b;border-bottom:2px solid #dbe7fb;">⭐ Lo que destaca</h3>${r.destaca.map(x => `<div style="background:${TONOS[x.tono].fondo};color:#1b2a41;border-left:4px solid ${TONOS[x.tono].texto};border-radius:8px;padding:9px 12px;margin:6px 0;font-size:13.5px;line-height:1.45;">${x.texto}</div>`).join('')}`
    : '';

  // ---- ejecutivos de ayer
  const maxTotal = Math.max(1, ...ejecutivos.map(e => e.total), sinAsignar ? sinAsignar.total : 0);
  const celdaNum = (v, negrita) => `<td style="${td}text-align:center;${negrita ? 'font-weight:800;' : ''}${v ? '' : 'color:#94a3b8;'}">${v}</td>`;
  const bloqueEjecutivos = `<h3 style="margin:26px 0 4px;padding:0 0 6px;font-size:16px;color:#0b2a5b;border-bottom:2px solid #dbe7fb;">👥 Ejecutivos · ayer (${diaCortoStr(dia)})</h3>
    <p style="${sub}">Cómo quedaron repartidas las ${num(r.totalEjecutivos)} conversaciones del día.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;">
      <tr><th style="${th}">Ejecutivo</th><th style="${th}text-align:center;">Inicia</th><th style="${th}text-align:center;">Nuevas</th><th style="${th}text-align:center;">Vuelve a hablar</th><th style="${th}text-align:center;">Recontacta</th><th style="${th}text-align:center;">Total</th></tr>
      ${ejecutivos.map((e, k) => `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};">
        <td style="${td}"><b>${esc(e.nombre)}</b>${e.total ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:4px;"><tr><td style="background:#0b57d0;height:5px;line-height:5px;font-size:1px;border-radius:3px;width:${Math.round((e.total / maxTotal) * 100)}%;">&nbsp;</td><td></td></tr></table>` : ''}</td>
        ${celdaNum(e.inicia)}${celdaNum(e.nuevas)}${celdaNum(e.clienteVuelveAHablar)}${e.seguimientos == null ? `<td style="${td}text-align:center;color:#94a3b8;">—</td>` : celdaNum(e.seguimientos)}${celdaNum(e.total, true)}</tr>`).join('')}
      ${sinAsignar && sinAsignar.total ? `<tr style="background:#FFF7ED;"><td style="${td}"><b style="color:#C2410C;">Sin ejecutivo asignado</b></td><td colspan="4" style="${td}color:#C2410C;font-size:12px;">todavía nadie las tomó</td><td style="${td}text-align:center;font-weight:800;color:#C2410C;">${num(sinAsignar.total)}</td></tr>` : ''}
    </table>
    <div style="margin-top:6px;font-size:11.5px;line-height:1.45;color:#64748b;"><b>Recontacta</b> = seguimientos sin respuesta: mensajes que el ejecutivo mandó cuando el cliente no había escrito desde nuestro mensaje anterior (con 2 horas o más de pausa), según quién los firmó o los envió.${seguimientos && seguimientos.noIdentificados ? ` <b>${num(seguimientos.noIdentificados)}</b> ${plural(seguimientos.noIdentificados, 'seguimiento', 'seguimientos')} no ${plural(seguimientos.noIdentificados, 'se pudo', 'se pudieron')} atribuir a nadie (sin firma ni usuario) y no ${plural(seguimientos.noIdentificados, 'está sumado', 'están sumados')} arriba.` : ''}${seguimientos == null ? ' <b>No se pudieron calcular hoy.</b>' : ''}</div>`;

  // ---- 1 evolución
  const maxDia = Math.max(1, ...evolucion.dias.map(x => x.conversaciones));
  const bloque1 = seccion(1, 'Evolución de las conversaciones', `Conversaciones por día, últimos 14 días. Últimos 7: <b>${num(evolucion.semana)}</b> · 7 anteriores: <b>${num(evolucion.semanaPrevia)}</b>.`,
    evolucion.dias.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #d3dff3;border-radius:8px;"><tr>${evolucion.dias.map((x, i) => {
      const alto = Math.max(x.conversaciones ? 3 : 1, Math.round((x.conversaciones / maxDia) * 80));
      const esAyer = x.dia === dia, nueva = i >= evolucion.dias.length - 7;
      const dow = DIAS_CORTOS[new Date(x.dia + 'T12:00:00Z').getUTCDay()];
      return `<td valign="bottom" align="center" style="padding:8px 1px 6px;font-size:10px;color:#475569;"><div style="font-size:10.5px;font-weight:700;color:#1b2a41;margin-bottom:2px;">${x.conversaciones}</div><div style="width:70%;max-width:26px;margin:0 auto;height:${alto}px;background:${esAyer ? '#0b2a5b' : nueva ? '#0b57d0' : '#b8cdf0'};border-radius:3px 3px 0 0;font-size:1px;line-height:1px;">&nbsp;</div><div style="margin-top:3px;">${dow}<br>${Number(x.dia.slice(8))}</div></td>`;
    }).join('')}</tr></table>` : vacio('Sin datos de los últimos 14 días.'));

  // ---- 2 horarios
  const hr = r.horarios, maxHora = Math.max(1, ...hr.horas);
  const bloque2 = seccion(2, 'Horarios de los mensajes', hr.horaPunta == null ? 'Hora en que escribe el cliente por primera vez (hora de Chile).' : `Hora del primer mensaje del cliente (hora de Chile). Hora punta <b>${String(hr.horaPunta).padStart(2, '0')}:00</b>; mejor franja <b>${String(hr.mejorFranja.desde).padStart(2, '0')}:00 a ${String(hr.mejorFranja.hasta).padStart(2, '0')}:00</b> (${dec(pct(hr.mejorFranja.n, hr.total))}% de los mensajes).`,
    hr.total ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #d3dff3;border-radius:8px;"><tr>${hr.horas.map((n, h) => {
      const alto = Math.max(n ? 3 : 1, Math.round((n / maxHora) * 56));
      const noche = h >= HORA_NOCHE_DESDE || h <= HORA_NOCHE_HASTA;
      return `<td valign="bottom" align="center" style="padding:8px 0 5px;font-size:9px;color:#64748b;"><div style="width:70%;max-width:18px;margin:0 auto;height:${alto}px;background:${h === hr.horaPunta ? '#C2410C' : noche ? '#8aa0c8' : '#0b57d0'};border-radius:2px 2px 0 0;font-size:1px;line-height:1px;">&nbsp;</div><div style="margin-top:3px;">${h}</div></td>`;
    }).join('')}</tr></table><div style="margin-top:6px;font-size:11.5px;color:#64748b;"><span style="color:#0b57d0;font-weight:700;">■</span> de día &nbsp; <span style="color:#8aa0c8;font-weight:700;">■</span> de noche (${HORA_NOCHE_DESDE}:00 a ${String(HORA_NOCHE_HASTA + 1).padStart(2, '0')}:00, ${dec(hr.pctNoche)}%) &nbsp; <span style="color:#C2410C;font-weight:700;">■</span> hora punta</div>` : vacio('Sin mensajes en el período.'));

  // ---- 3 categorías
  const maxCat = Math.max(1, ...r.categorias.map(c => c.cantidad));
  const bloque3 = seccion(3, 'Categorías más consultadas', 'De qué hablan los clientes (clasificación de la IA).',
    r.categorias.length ? tablaBarras(r.categorias.map((c, k) => filaBarra(esc(c.nombre), c.cantidad, maxCat, '#0b57d0', `${num(c.cantidad)} · ${dec(c.pct)}%`, k)).join('')) : vacio('Sin conversaciones categorizadas.'));

  // ---- 4 embudo
  const bloque4 = seccion(4, 'Embudo de conversión', 'Cuántas conversaciones avanzan de una etapa a la siguiente.',
    embudo.pasos[0].n ? tablaBarras(embudo.pasos.map((p, k) => filaBarra(`<b>${p.nombre}</b>`, p.n, embudo.pasos[0].n, ['#0b57d0', '#3b82f6', '#16a34a', '#12713a'][k], `${num(p.n)}${k ? ` <span style="color:#64748b;font-weight:500;">· ${dec(p.pctPaso)}% del paso anterior</span>` : ''}`, k)).join('')) : vacio('Sin conversaciones en el período.'));

  // ---- 5 propuestas: cotizaciones y links enviados
  const bloque5 = seccion(5, 'Cotizaciones y links enviados', 'Hay dos formas de conversión: una <b>cotización</b> (la emitimos en el sistema o el cliente la pidió) y un <b>link enviado</b> (tenemos el producto y le mandamos el enlace para que compre directo en la tienda). Ambas significan que entregamos la propuesta; falta que el cliente decida.',
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      ${tarjeta('📝 Cotizaciones', num(cotizaciones.cotizaciones), `emitidas o pedidas<br><span style="color:#64748b;">${dec(cotizaciones.pctVentaTrasCotizacion)}% terminó en venta</span>`, 'azul')}
      ${tarjeta('🔗 Links enviados', num(cotizaciones.links), `tenemos el producto<br><span style="color:#64748b;">${dec(cotizaciones.pctVentaTrasLink)}% terminó en venta</span>`, 'azul')}
      ${tarjeta('✅ Total propuestas', num(cotizaciones.propuestas), `${dec(cotizaciones.pctPropuestas)}% de las conversaciones<br><span style="color:#64748b;">${num(cotizaciones.ambas)} recibieron ambas</span>`, 'verde')}
      ${tarjeta('⏱️ Respuesta típica', cotizaciones.medianaMin == null ? '—' : `${dec(cotizaciones.medianaMin)} min`, 'mediana hasta la propuesta', cotizaciones.medianaMin != null && cotizaciones.medianaMin > 60 ? 'naranja' : 'verde')}
    </tr></table>
    <div style="margin-top:8px;background:${cotizaciones.sinPropuesta ? '#FFEDD5' : '#E3F6EA'};border-radius:10px;padding:10px 14px;font-size:13px;color:#1b2a41;line-height:1.45;">${cotizaciones.sinPropuesta
      ? `🟠 <b>${num(cotizaciones.sinPropuesta)}</b> de ${num(cotizaciones.conIntencion)} conversaciones con intención de compra siguen sin cotización ni link y tuvieron actividad en los últimos 3 días: son las primeras a retomar.<br><span style="font-size:11.5px;color:#64748b;">Las respuestas que se dan desde el celular pueden no verse en el ERP, así que alguna de estas conversaciones podría estar ya atendida.</span>`
      : `✅ Todas las conversaciones recientes con intención de compra recibieron una cotización o un link.<br><span style="font-size:11.5px;color:#64748b;">Las respuestas que se dan desde el celular pueden no verse en el ERP.</span>`}</div>`);

  // ---- 6 motivos de pérdida
  const maxMot = Math.max(1, ...r.motivos.map(x => x.cantidad));
  const bloque6 = seccion(6, 'Motivos de pérdida', `Por qué no se concretó la venta (${num(r.totalPerdidas)} ${plural(r.totalPerdidas, 'conversación perdida', 'conversaciones perdidas')} en 7 días).`,
    r.motivos.length ? tablaBarras(r.motivos.map((x, k) => filaBarra(esc(x.nombre), x.cantidad, maxMot, '#dc2626', `${num(x.cantidad)} · ${dec(x.pct)}%`, k)).join('')) : vacio('No hay conversaciones perdidas con motivo registrado.'));

  // ---- 7 productos
  const bloque7 = seccion(7, 'Ranking de productos', 'Los más consultados y cuántos terminaron en venta.',
    r.productos.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;">
      <tr><th style="${th}">#</th><th style="${th}">Producto</th><th style="${th}text-align:right;">Consultas</th><th style="${th}text-align:right;">Ventas</th><th style="${th}text-align:right;">Conversión</th></tr>
      ${r.productos.map((p, k) => `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};"><td style="${td}width:26px;color:#64748b;">${k + 1}</td><td style="${td}"><b>${esc(p.producto)}</b></td><td style="${td}text-align:right;font-weight:700;">${num(p.consultas)}</td><td style="${td}text-align:right;">${num(p.ventas)}</td><td style="${td}text-align:right;">${chip(`${dec(p.conversion)}%`, p.conversion >= 10 ? 'verde' : p.conversion > 0 ? 'amarillo' : 'gris')}</td></tr>`).join('')}
    </table>` : vacio('Sin productos identificados en el período.'));

  // ---- 8 marcas y modelos
  const lista = (titulo, items, clave) => {
    const max = Math.max(1, ...items.map(x => x.consultas));
    return `<td width="50%" valign="top" style="padding:0 4px;"><div style="font-size:12px;font-weight:800;color:#0b2a5b;margin-bottom:5px;">${titulo}</div>${items.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;">${items.map((x, k) => `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};"><td style="${td}padding:6px 8px;font-size:12.5px;">${esc(x[clave])}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:3px;"><tr><td style="background:#3b82f6;height:4px;line-height:4px;font-size:1px;border-radius:2px;width:${Math.round((x.consultas / max) * 100)}%;">&nbsp;</td><td></td></tr></table></td><td style="${td}padding:6px 8px;width:30px;text-align:right;font-weight:700;">${num(x.consultas)}</td></tr>`).join('')}</table>` : '<div style="font-size:12px;color:#64748b;">Sin datos.</div>'}</td>`;
  };
  const bloque8 = seccion(8, 'Marcas y modelos más consultados', 'Qué marcas y qué modelos de notebook piden los clientes.',
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 -4px;"><tr>${lista('🏷️ Marcas', r.marcas, 'marca')}${lista('💻 Modelos', r.modelos, 'modelo')}</tr></table>`);

  // ---- 9 fuentes
  const maxFuente = Math.max(1, ...r.fuentes.map(f => f.cantidad));
  const bloque9 = seccion(9, 'Fuente de ingreso', 'De dónde llegan las conversaciones y cuáles terminan en venta.',
    r.fuentes.length ? tablaBarras(r.fuentes.map((f, k) => filaBarra(esc(f.nombre), f.cantidad, maxFuente, '#7c3aed', `${num(f.cantidad)} · ${dec(f.pct)}%${f.ventas ? ` <span style="color:#12713A;">· ${num(f.ventas)} ${plural(f.ventas, 'venta', 'ventas')}</span>` : ''}`, k)).join('')) : vacio('Sin datos de origen en el período.'));

  // ---- 10 Bsale
  const bloque10 = seccion(10, 'Ventas vinculadas a Bsale', 'Conversaciones cuyo cliente (por teléfono) compró en Bsale. Solo cantidades.',
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      ${tarjeta('Conversaciones', num(bsale.conversaciones), 'en los últimos 7 días', 'gris')}
      ${tarjeta('Vinculadas a Bsale', num(bsale.vinculadas), `${dec(bsale.pctVinculadas)}% de las conversaciones`, 'azul')}
      ${tarjeta('Compraron en el período', num(bsale.ventaEnPeriodo), `${dec(bsale.pctVenta)}% de las conversaciones`, 'verde')}
      ${tarjeta('Clientes distintos', num(r.clientesSemana), 'escribieron en 7 días', 'gris')}
    </tr></table>`);

  const html = `
<div style="margin:0;padding:24px 12px;background:#eef2f9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;border-collapse:separate;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td style="background:#0b2a5b;border-radius:14px 14px 0 0;padding:24px 26px 20px;">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9db8ea;font-weight:700;">IndexStore · WhatsApp</div>
      <div style="margin-top:6px;font-size:25px;line-height:1.25;color:#ffffff;font-weight:800;">Resumen diario de WhatsApp</div>
      <div style="margin-top:4px;font-size:14px;color:#c9d9f7;">${fechaLarga} · análisis del ${diaCortoStr(new Date(Date.parse(dia + 'T00:00:00Z') - 6 * 86400000).toISOString().slice(0, 10))} al ${diaCortoStr(dia)}</div>
    </td></tr>
    <tr><td style="background:#ffffff;padding:20px 22px 24px;color:#1b2a41;font-size:14px;line-height:1.55;">
      ${avisoAnalitica ? `<div style="margin:0 0 14px;background:#FEF3C7;border-radius:12px;padding:12px 16px;font-size:13px;line-height:1.5;color:#92400E;">⚠️ No se pudo calcular la analítica de los últimos 7 días esta vez (${esc(avisoAnalitica)}). Más abajo solo aparecen los ejecutivos de ayer.</div>` : ''}
      ${kpis}
      ${bloqueDestaca}
      ${bloqueEjecutivos}
      <div style="margin:30px 0 0;padding:10px 14px;background:#0b2a5b;border-radius:10px;color:#ffffff;font-size:14px;font-weight:800;">📊 Análisis de los últimos 7 días</div>
      ${bloque1}${bloque2}${bloque3}${bloque4}${bloque5}${bloque6}${bloque7}${bloque8}${bloque9}${bloque10}
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 0;"><tr><td style="background:#0b57d0;border-radius:10px;">
        <a href="${urlBase}/clientes-whatsapp.html" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">Abrir Clientes WhatsApp en el ERP</a>
      </td></tr></table>
      <div style="margin-top:18px;font-size:11.5px;line-height:1.5;color:#64748b;">
        <b>Cómo leerlo:</b> lo "pendiente" son conversaciones (no clientes distintos) con intención de compra según la IA, sin cotización ni link, sin venta y con mensajes en los últimos 3 días; lo respondido desde el celular puede no verse. Una <b>propuesta</b> es una cotización (emitida o pedida por el cliente) o un link de compra enviado, y cuenta una sola vez por conversación. La tabla de ejecutivos es de ayer; los 10 análisis son de los últimos 7 días, los mismos de la pestaña Analítica del ERP. "Inicia" depende de a quién quedó asignada cada conversación (WhatsApp no dice quién escribió desde la app), así que es una aproximación; "Recontacta" se atribuye por la firma o el usuario de cada mensaje. Categorías, productos, marcas, modelos y motivos de pérdida los clasifica la IA. No incluye montos en pesos.
      </div>
    </td></tr>
    <tr><td style="background:#f5f8fe;border-top:1px solid #dbe7fb;border-radius:0 0 14px 14px;padding:14px 26px;font-size:12px;line-height:1.5;color:#5b6b86;">
      <b style="color:#0b2a5b;">Notificación del sistema ERP · IndexStore</b><br>
      Mensaje automático: no respondas a este correo. Puedes cambiar quién lo recibe en el ERP, en Usuarios &gt; Notificaciones.
    </td></tr>
  </table>
</div>`;
  return { asunto, html, resumen: r };
}

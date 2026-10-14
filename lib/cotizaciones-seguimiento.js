// /lib/cotizaciones-seguimiento.js
// ══════════════════════════════════════════════════════════════════════
// Correo diario único de cotizaciones: "qué hacer hoy" (reemplaza al "Seguimiento" de 7+ días, a "Cotizaciones en riesgo" y a "Por recontactar").
// ══════════════════════════════════════════════════════════════════════
// Pensado para los vendedores: una sola lista priorizada por MONTO y por DÍAS, sin tener que cruzar tres correos.
// Funciones puras (sin red ni base de datos) para poder probarlas.
//
// Cómo se cuentan los días ("sin contacto"): desde NUESTRO último contacto (correo enviado, contacto registrado o último cambio de estado;
// si nunca se gestionó, desde la fecha de emisión). Si el cliente escribió DESPUÉS de ese contacto, la pelota está de nuestro lado:
// se marca "Cliente respondió" y los días se cuentan desde su mensaje.
//
// Prioridad:
//   🔴 Crítica      monto de $300.000 o más y 3+ días sin contacto (o con el cliente esperando respuesta nuestra)
//   🟠 Alta         $100.000 o más y 7+ días, o 15+ días, o el cliente respondió y está esperando
//   🟡 Seguimiento  7+ días sin contacto
// Dentro de cada nivel: primero el monto mayor y, a igualdad, los más días.
// Más de 35 días sin contacto no se lista cotización por cotización (ya se dan casi por perdidas): se resumen como "por depurar".
// Las de Mercado Público se cuentan aparte: dependen del proceso del comprador, no de un recontacto.

export const UMBRAL_CRITICA_MONTO = 300000;
export const UMBRAL_CRITICA_DIAS = 3;
export const UMBRAL_ALTA_MONTO = 100000;
export const UMBRAL_SEGUIMIENTO_DIAS = 7;
export const UMBRAL_ALTA_DIAS = 15;
export const TOPE_DIAS = 35;
export const ESTADOS_NO_ABIERTOS = ['facturada', 'perdida'];
const FILAS_POR_VENDEDOR = 10;
const FILAS_TOP = 5;

const aFecha = v => (v ? new Date(v) : null);
const diaChile = d => d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const diasEntreDias = (desdeDia, hastaDia) => Math.round((new Date(hastaDia + 'T00:00:00Z') - new Date(desdeDia + 'T00:00:00Z')) / 86400000);
export const esc = t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const clp = n => '$' + Math.round(n || 0).toLocaleString('es-CL');

const NIVELES = {
  critica: { orden: 0, etiqueta: 'Crítica', emoji: '🔴', fondo: '#FDE2E2', texto: '#B91C1C' },
  alta: { orden: 1, etiqueta: 'Alta', emoji: '🟠', fondo: '#FFEDD5', texto: '#C2410C' },
  seguimiento: { orden: 2, etiqueta: 'Seguimiento', emoji: '🟡', fondo: '#FEF3C7', texto: '#92400E' },
};
const ESTADO_ETIQUETA = {
  sin_contactar: 'Sin contactar', cotizacion_enviada: 'Cotización enviada', cliente_respondio: 'Cliente respondió', contactado: 'Contactado',
  contactado_no_responde: 'Sin respuesta', contactado_segunda_vez: '2º contacto', mercado_publico: 'Mercado Público',
};

// filas: { id, numero, url_cotizacion, cliente_nombre, monto, fecha, estado, actualizado_en, ultimo_contacto, ultimo_entrante, responsable, vendedor_nombre }
export function prepararCotizaciones(filas, ahora = new Date()) {
  const items = [];
  const mercadoPublico = { n: 0, monto: 0 };
  const depurar = { n: 0, monto: 0 };
  for (const f of filas || []) {
    if (ESTADOS_NO_ABIERTOS.includes(f.estado)) continue;
    const monto = Number(f.monto) || 0;
    // Último contacto nuestro: el más reciente entre contacto registrado/correo enviado y último cambio de estado (si se gestionó); si no, la emisión.
    // OJO con las zonas horarias: "fecha" es una fecha SIN hora (Bsale/Postgres la entregan como medianoche UTC), así que se toma su día tal cual;
    // los demás son instantes y su día se mira en hora de Chile. Si no, cada cotización quedaría con un día de más.
    const cambioEstado = f.estado !== 'sin_contactar' ? aFecha(f.actualizado_en) : null;
    const instantes = [aFecha(f.ultimo_contacto), cambioEstado].filter(Boolean).sort((a, b) => b - a);
    const emision = aFecha(f.fecha);
    const base = instantes[0] || emision;
    if (!base) continue;
    const baseDia = instantes[0] ? diaChile(instantes[0]) : emision.toISOString().slice(0, 10);
    const entrante = aFecha(f.ultimo_entrante);
    const clienteEspera = Boolean(entrante && entrante > base);
    const dias = diasEntreDias(clienteEspera ? diaChile(entrante) : baseDia, diaChile(ahora));
    if (f.estado === 'mercado_publico') { mercadoPublico.n += 1; mercadoPublico.monto += monto; continue; }
    if (dias > TOPE_DIAS) { depurar.n += 1; depurar.monto += monto; continue; }

    let nivel = null;
    if (monto >= UMBRAL_CRITICA_MONTO && (dias >= UMBRAL_CRITICA_DIAS || (clienteEspera && dias >= 1))) nivel = 'critica';
    else if ((monto >= UMBRAL_ALTA_MONTO && dias >= UMBRAL_SEGUIMIENTO_DIAS) || dias >= UMBRAL_ALTA_DIAS || (clienteEspera && dias >= 1)) nivel = 'alta';
    else if (dias >= UMBRAL_SEGUIMIENTO_DIAS) nivel = 'seguimiento';
    if (!nivel) continue; // todavía en plazo
    items.push({
      id: f.id, numero: f.numero || '', url: f.url_cotizacion || null, cliente: f.cliente_nombre || 'Sin nombre', monto, dias, nivel, clienteEspera,
      estado: f.estado, vendedor: f.responsable || f.vendedor_nombre || 'Sin vendedor asignado',
    });
  }
  const orden = (a, b) => NIVELES[a.nivel].orden - NIVELES[b.nivel].orden || b.monto - a.monto || b.dias - a.dias;
  items.sort(orden);
  return { items, mercadoPublico, depurar };
}

export function resumirPorNivel(items) {
  const r = { critica: { n: 0, monto: 0 }, alta: { n: 0, monto: 0 }, seguimiento: { n: 0, monto: 0 } };
  for (const i of items) { r[i.nivel].n += 1; r[i.nivel].monto += i.monto; }
  return r;
}

// Color del chip de días: más días = más rojo
function chipDias(dias, clienteEspera) {
  const [fondo, texto] = dias >= 15 ? ['#FDE2E2', '#B91C1C'] : dias >= 7 ? ['#FFEDD5', '#C2410C'] : ['#FEF3C7', '#92400E'];
  const rotulo = clienteEspera ? `${dias} ${dias === 1 ? 'día' : 'días'} esperando` : `${dias} días`;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap;background:${fondo};color:${texto};">${rotulo}</span>`;
}
function chipNivel(nivel) {
  const n = NIVELES[nivel];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap;background:${n.fondo};color:${n.texto};">${n.emoji} ${n.etiqueta}</span>`;
}
function enlaceNumero(i) {
  const t = i.numero ? `#${esc(i.numero)}` : 'ver';
  return i.url ? `<a href="${esc(i.url)}" style="color:#0b57d0;text-decoration:none;font-weight:600;">${t} ↗</a>` : `<span style="color:#5b6b86;">${t}</span>`;
}

// Arma el correo. urlBase = https://erp.indexstore.cl
export function armarCorreoSeguimiento(prep, { urlBase, ahora = new Date() } = {}) {
  const { items, mercadoPublico, depurar } = prep;
  const r = resumirPorNivel(items);
  const urlPagina = `${urlBase}/cotizaciones-clientes.html`;
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const [a, m, d] = diaChile(ahora).split('-');
  const fechaLarga = `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`;
  const partes = [];
  if (r.critica.n) partes.push(`${r.critica.n} ${r.critica.n === 1 ? 'crítica' : 'críticas'}`);
  if (r.alta.n) partes.push(`${r.alta.n} ${r.alta.n === 1 ? 'alta' : 'altas'}`);
  if (r.seguimiento.n) partes.push(`${r.seguimiento.n} en seguimiento`);
  const asunto = items.length ? `🔔 Cotizaciones de hoy: ${partes.join(' · ')}` : '🔔 Cotizaciones de hoy: nada urgente';

  const celdaKpi = (nivel, datos) => {
    const n = NIVELES[nivel];
    return `<td width="33%" style="padding:0 5px;vertical-align:top;"><div style="background:${n.fondo};border-radius:12px;padding:12px 14px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${n.texto};">${n.emoji} ${n.etiqueta}</div>
      <div style="font-size:28px;font-weight:800;line-height:1.1;color:#1b2a41;margin-top:2px;">${datos.n}</div>
      <div style="font-size:12.5px;color:#475569;margin-top:2px;">${datos.n ? clp(datos.monto) + ' en juego' : 'ninguna'}</div></div></td>`;
  };
  const kpis = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 -5px 6px;"><tr>${celdaKpi('critica', r.critica)}${celdaKpi('alta', r.alta)}${celdaKpi('seguimiento', r.seguimiento)}</tr></table>`;

  const th = 'padding:7px 9px;text-align:left;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:#ffffff;background:#0b2a5b;';
  const td = 'padding:8px 9px;border-bottom:1px solid #e3ebf8;vertical-align:top;font-size:13px;line-height:1.35;color:#1b2a41;';

  // ---- las 5 de mayor prioridad (de todo el equipo)
  const top = items.slice(0, FILAS_TOP);
  const bloqueTop = top.length ? `
    <h3 style="margin:22px 0 8px;padding:0 0 6px;font-size:16px;color:#0b2a5b;border-bottom:2px solid #dbe7fb;">🔥 Las ${top.length === 1 ? '' : top.length + ' '}de mayor prioridad hoy</h3>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;">
      <tr><th style="${th}">Cliente</th><th style="${th}text-align:right;">Monto</th><th style="${th}">Días</th><th style="${th}">Vendedor</th></tr>
      ${top.map((i, k) => `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};">
        <td style="${td}"><b>${esc(i.cliente)}</b><br><span style="font-size:11.5px;">${enlaceNumero(i)} · ${chipNivel(i.nivel)}${i.clienteEspera ? ' <span style="font-size:11px;font-weight:700;color:#0b57d0;">💬 respondió</span>' : ''}</span></td>
        <td style="${td}text-align:right;white-space:nowrap;font-weight:800;">${clp(i.monto)}</td>
        <td style="${td}">${chipDias(i.dias, i.clienteEspera)}</td>
        <td style="${td}white-space:nowrap;">${esc(i.vendedor)}</td></tr>`).join('')}
    </table>` : '';

  // ---- por vendedor
  const porVend = new Map();
  for (const i of items) { if (!porVend.has(i.vendedor)) porVend.set(i.vendedor, []); porVend.get(i.vendedor).push(i); }
  const vendedores = [...porVend.entries()].map(([nombre, lista]) => ({
    nombre, lista, criticas: lista.filter(x => x.nivel === 'critica').length, total: lista.reduce((s, x) => s + x.monto, 0),
  })).sort((x, y) => y.criticas - x.criticas || y.total - x.total);
  const bloquesVend = vendedores.map(v => {
    const visibles = v.lista.slice(0, FILAS_POR_VENDEDOR);
    const resto = v.lista.length - visibles.length;
    return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0 0;"><tr>
      <td style="font-size:15px;font-weight:800;color:#0b2a5b;">👤 ${esc(v.nombre)}</td>
      <td style="text-align:right;font-size:12.5px;color:#475569;">${v.lista.length} ${v.lista.length === 1 ? 'cotización' : 'cotizaciones'} · ${clp(v.total)}${v.criticas ? ` · <b style="color:#B91C1C;">${v.criticas} ${v.criticas === 1 ? 'crítica' : 'críticas'}</b>` : ''}</td>
    </tr></table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #d3dff3;margin-top:6px;">
      ${visibles.map((i, k) => `<tr style="background:${k % 2 ? '#f5f8fe' : '#ffffff'};">
        <td style="${td}width:92px;">${chipNivel(i.nivel)}</td>
        <td style="${td}"><b>${esc(i.cliente)}</b> <span style="font-size:11.5px;">${enlaceNumero(i)}</span>${i.clienteEspera ? ' <span style="font-size:11px;font-weight:700;color:#0b57d0;">💬 respondió</span>' : ''}<br><span style="font-size:11.5px;color:#64748b;">${esc(ESTADO_ETIQUETA[i.estado] || i.estado)}</span></td>
        <td style="${td}text-align:right;white-space:nowrap;font-weight:700;">${clp(i.monto)}</td>
        <td style="${td}text-align:right;">${chipDias(i.dias, i.clienteEspera)}</td></tr>`).join('')}
      ${resto > 0 ? `<tr><td colspan="4" style="${td}color:#64748b;font-size:12px;">… y ${resto} más de ${esc(v.nombre)} en el ERP.</td></tr>` : ''}
    </table>`;
  }).join('');

  // ---- notas al pie: por depurar y Mercado Público
  const notas = [];
  if (depurar.n) notas.push(`<b>${depurar.n}</b> ${depurar.n === 1 ? 'cotización lleva' : 'cotizaciones llevan'} más de ${TOPE_DIAS} días sin contacto (${clp(depurar.monto)}): ya se dan casi por perdidas. Recontáctalas o márcalas como perdidas en el ERP para no seguir viéndolas.`);
  if (mercadoPublico.n) notas.push(`<b>${mercadoPublico.n}</b> en <b>Mercado Público</b> (${clp(mercadoPublico.monto)}): dependen del proceso del comprador y no se listan aquí.`);
  const bloqueNotas = notas.length ? `<div style="margin-top:20px;background:#f5f8fe;border:1px solid #dbe7fb;border-radius:10px;padding:12px 14px;font-size:12.5px;line-height:1.5;color:#334155;">${notas.map(n => `<div style="margin:4px 0;">• ${n}</div>`).join('')}</div>` : '';

  const vacio = !items.length ? `<div style="margin-top:16px;background:#e3f6ea;border-radius:12px;padding:16px 18px;font-size:14px;color:#12713a;">✅ <b>Nada urgente hoy:</b> ninguna cotización abierta lleva el tiempo suficiente sin contacto como para que haya que actuar.</div>` : '';

  const html = `
<div style="margin:0;padding:24px 12px;background:#eef2f9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;border-collapse:separate;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td style="background:#0b2a5b;border-radius:14px 14px 0 0;padding:24px 26px 20px;">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#9db8ea;font-weight:700;">IndexStore · Cotizaciones</div>
      <div style="margin-top:6px;font-size:25px;line-height:1.25;color:#ffffff;font-weight:800;">Qué hacer hoy</div>
      <div style="margin-top:4px;font-size:14px;color:#c9d9f7;">${fechaLarga} · ${items.length} ${items.length === 1 ? 'cotización por atender' : 'cotizaciones por atender'}</div>
    </td></tr>
    <tr><td style="background:#ffffff;padding:20px 22px 24px;color:#1b2a41;font-size:14px;line-height:1.55;">
      ${items.length ? kpis : ''}
      ${vacio}
      ${bloqueTop}
      ${items.length ? `<h3 style="margin:26px 0 0;padding:0 0 6px;font-size:16px;color:#0b2a5b;border-bottom:2px solid #dbe7fb;">📋 Detalle por vendedor</h3>${bloquesVend}` : ''}
      ${bloqueNotas}
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 0;"><tr><td style="background:#0b57d0;border-radius:10px;">
        <a href="${urlPagina}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">Abrir Cotizaciones en el ERP</a>
      </td></tr></table>
      <div style="margin-top:18px;font-size:11.5px;line-height:1.5;color:#64748b;">
        <b>Cómo se prioriza:</b> 🔴 Crítica = $300.000 o más y 3+ días sin contacto · 🟠 Alta = $100.000 o más y 7+ días, o 15+ días, o el cliente respondió y espera · 🟡 Seguimiento = 7+ días sin contacto.
        Dentro de cada nivel van primero las de mayor monto. Los días se cuentan desde el último contacto registrado (o desde la emisión si nunca se gestionó).
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

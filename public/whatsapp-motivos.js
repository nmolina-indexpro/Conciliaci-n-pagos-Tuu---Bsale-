// public/whatsapp-motivos.js
// Panel lateral "Análisis del motivo de pérdida" de Clientes WhatsApp (pestaña Analítica). Se abre desde el botón
// "📊 Analizar" de cada fila de la tabla "Motivos de pérdida". Los números los calcula el servidor
// (lib/whatsapp-motivos.js, recurso whatsapp-motivo-detalle); acá solo se dibujan.
const MOTIVOS_ANALIZABLES_UI = ['producto_no_disponible', 'compro_en_otro_lugar', 'respuesta_lenta', 'precio', 'sin_stock', 'cliente_no_responde', 'sin_seguimiento', 'producto_incompatible'];
let motivoPanel = null;      // { motivo, base, datos }
let cargandoPanelMotivo = 0; // para ignorar respuestas viejas si el usuario cambia rápido

// Teléfono como enlace al chat de WhatsApp, en otra pestaña (Chile: 9 dígitos se completan con el 56)
function enlaceTelefonoPm(telefono){
  const texto = String(telefono || '').trim();
  if(!texto) return '';
  let dig = texto.replace(/\D/g, '');
  if(dig.length < 8) return escapeHtml(texto);
  if(dig.length === 9) dig = '56' + dig;
  return `<a href="https://wa.me/${dig}" target="_blank" rel="noopener noreferrer" title="Abrir el chat en WhatsApp">${escapeHtml(texto)} ↗</a>`;
}
function fmtMin(seg){
  if(seg == null) return '—';
  if(seg < 90) return `${Math.round(seg)} s`;
  const min = seg / 60;
  if(min < 90) return `${Math.round(min)} min`;
  const h = min / 60;
  return h < 48 ? `${(Math.round(h * 10) / 10).toLocaleString('es-CL')} h` : `${Math.round(h / 24)} días`;
}
function barrasHtml(filas, { vacio = 'Sin datos', color = 'var(--primary)' } = {}){
  if(!filas.length) return `<p class="empty-note">${vacio}</p>`;
  const max = Math.max(1, ...filas.map(f => f.n));
  return `<div class="pm-barras">${filas.map(f => `
    <div class="pm-barra" title="${escapeHtml(f.etiqueta)}: ${f.n}${f.pct != null ? ' (' + f.pct + '%)' : ''}">
      <span class="pm-nom">${escapeHtml(f.etiqueta)}</span>
      <span class="pm-pista"><span style="width:${Math.max(3, Math.round(f.n / max * 100))}%;background:${f.color || color};"></span></span>
      <span class="pm-val">${f.n}${f.pct != null ? ` <small>${f.pct}%</small>` : ''}</span>
    </div>`).join('')}</div>`;
}
function histogramaHtml(valores, etiquetaDe){
  const max = Math.max(1, ...valores.map(v => v.n));
  return `<div class="pm-histo">${valores.map(v => `
    <div class="pm-col" title="${escapeHtml(etiquetaDe(v))}: ${v.n}"><span class="pm-col-barra" style="height:${Math.round(v.n / max * 100)}%;"></span><span class="pm-col-eti">${escapeHtml(String(v.eti))}</span></div>`).join('')}</div>`;
}
function tarjetaPm(titulo, valor, nota){
  return `<div class="pm-kpi"><div class="pm-kpi-lbl">${escapeHtml(titulo)}</div><div class="pm-kpi-val">${valor}</div>${nota ? `<div class="pm-kpi-nota">${nota}</div>` : ''}</div>`;
}
function seccionPm(titulo, cuerpo, sub){
  return `<section class="pm-sec"><h3>${titulo}</h3>${sub ? `<div class="pm-sub">${sub}</div>` : ''}${cuerpo}</section>`;
}

function asegurarEstilosPanelMotivo(){
  if(document.getElementById('estilosPanelMotivo')) return;
  const st = document.createElement('style');
  st.id = 'estilosPanelMotivo';
  st.textContent = `
    #fondoPanelMotivo{position:fixed;inset:0;background:rgba(20,28,24,.45);z-index:70;display:none;}
    #panelMotivo{position:fixed;top:0;right:0;bottom:0;width:min(1040px,96vw);background:var(--bg);z-index:71;box-shadow:-12px 0 40px rgba(0,0,0,.22);display:none;flex-direction:column;}
    #panelMotivo.abierto,#fondoPanelMotivo.abierto{display:flex;}
    .pm-head{padding:14px 20px;background:var(--surface);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
    .pm-head h2{font-family:'Space Grotesk',sans-serif;font-size:17px;margin:0;}
    .pm-head .pm-esp{flex:1;}
    .pm-cuerpo{overflow:auto;padding:16px 20px 40px;flex:1;}
    .pm-nota{background:var(--amber-dim,#FDF0DC);color:var(--amber,#B45309);border-radius:9px;padding:8px 12px;font-size:12px;margin-bottom:12px;}
    .pm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px;}
    .pm-kpi{background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:10px 13px;}
    .pm-kpi-lbl{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-weight:600;}
    .pm-kpi-val{font-family:'IBM Plex Mono',monospace;font-size:22px;font-weight:600;margin-top:2px;}
    .pm-kpi-nota{font-size:11px;color:var(--muted);margin-top:2px;}
    .pm-sec{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px;}
    .pm-sec h3{font-family:'Space Grotesk',sans-serif;font-size:14px;margin:0 0 4px;}
    .pm-sub{font-size:11.5px;color:var(--muted);margin-bottom:10px;}
    .pm-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;}
    .pm-grid2 h4{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:6px 0;}
    .pm-barras{display:flex;flex-direction:column;gap:5px;}
    .pm-barra{display:grid;grid-template-columns:minmax(90px,42%) 1fr 64px;gap:8px;align-items:center;font-size:12px;}
    .pm-nom{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .pm-pista{background:var(--line);border-radius:4px;height:9px;overflow:hidden;display:block;}
    .pm-pista span{display:block;height:100%;border-radius:4px;}
    .pm-val{font-family:'IBM Plex Mono',monospace;text-align:right;font-weight:600;}
    .pm-val small{color:var(--muted);font-weight:500;}
    .pm-histo{display:flex;align-items:flex-end;gap:2px;height:110px;padding-top:6px;}
    .pm-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0;}
    .pm-col-barra{width:100%;background:var(--primary);border-radius:3px 3px 0 0;min-height:1px;display:block;}
    .pm-col-eti{font-size:9.5px;color:var(--muted);margin-top:3px;}
    .pm-reco{display:flex;flex-direction:column;gap:8px;}
    .pm-reco div{background:var(--primary-dim);border-radius:9px;padding:9px 12px;font-size:12.5px;}
    .pm-reco b{display:block;margin-bottom:2px;font-size:12px;color:var(--primary-dark);}
    .pm-tabla{width:100%;border-collapse:collapse;font-size:12px;}
    .pm-tabla th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);padding:6px 8px;border-bottom:2px solid var(--line);background:var(--surface-2);}
    .pm-tabla td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top;}
    .pm-tabla td.num{text-align:right;font-family:'IBM Plex Mono',monospace;}
    .pm-scroll{max-height:320px;overflow:auto;}
    .pm-acciones{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px;}
    .pm-badge{font-size:10px;font-weight:700;border-radius:999px;padding:1px 8px;background:var(--surface-2);color:var(--muted);}
    .pm-badge.ok{background:var(--primary-dim);color:var(--primary);}
    .pm-badge.no{background:var(--red-bg,#FCE8E8);color:var(--red,#DC2626);}
    .pm-ej{color:var(--muted);font-size:11px;max-width:300px;}
    .pm-cargando{padding:40px;text-align:center;color:var(--muted);}
  `;
  document.head.appendChild(st);
  const fondo = document.createElement('div'); fondo.id = 'fondoPanelMotivo'; fondo.onclick = cerrarPanelMotivo;
  const panel = document.createElement('aside'); panel.id = 'panelMotivo'; panel.setAttribute('aria-label', 'Análisis del motivo de pérdida');
  document.body.appendChild(fondo); document.body.appendChild(panel);
  document.addEventListener('keydown', e => { if(e.key === 'Escape') cerrarPanelMotivo(); });
}

function abrirPanelMotivo(motivo){
  asegurarEstilosPanelMotivo();
  motivoPanel = { tipo: 'motivo', motivo, categoria: null, base: 'ultimo_cliente', datos: null };
  $('fondoPanelMotivo').classList.add('abierto'); $('panelMotivo').classList.add('abierto');
  cargarPanelMotivo();
}
function cerrarPanelMotivo(){
  const f = document.getElementById('fondoPanelMotivo'), p = document.getElementById('panelMotivo');
  if(f) f.classList.remove('abierto'); if(p) p.classList.remove('abierto');
}
function cambiarBasePanelMotivo(base){ motivoPanel.base = base; cargarPanelMotivo(); }
async function cargarPanelMotivo(){
  const { motivo, base } = motivoPanel;
  const desde = $('analiticaDesde').value, hasta = $('analiticaHasta').value;
  const etiqueta = MOTIVO_PERDIDA_LABEL[motivo] || motivo;
  const yo = ++cargandoPanelMotivo;
  $('panelMotivo').innerHTML = `<div class="pm-head"><h2>📊 ${escapeHtml(etiqueta)}</h2><span class="pm-esp"></span><button class="btn-ghost btn-compact" onclick="cerrarPanelMotivo()">✕ Cerrar</button></div><div class="pm-cuerpo"><div class="pm-cargando">Analizando conversaciones y mensajes…</div></div>`;
  try{
    const res = await fetch(`/api/negocio?recurso=whatsapp-motivo-detalle&motivo=${encodeURIComponent(motivo)}&desde=${desde}&hasta=${hasta}&base=${base}`);
    const d = await res.json();
    if(yo !== cargandoPanelMotivo) return;
    if(!res.ok || d.error){ $('panelMotivo').querySelector('.pm-cuerpo').innerHTML = `<p class="empty-note">${escapeHtml(d.error || 'No se pudo analizar este motivo.')}${d.detail ? ' (' + escapeHtml(d.detail) + ')' : ''}</p>`; return; }
    motivoPanel.datos = d;
    renderPanelMotivo(d);
  }catch(err){
    if(yo === cargandoPanelMotivo) $('panelMotivo').querySelector('.pm-cuerpo').innerHTML = `<p class="empty-note">Error: ${escapeHtml(err.message)}</p>`;
  }
}

function renderPanelMotivo(d){
  const s = d.silencio, c = d.comun, e = d.especifico;
  const cabecera = `
    <div class="pm-head">
      <h2>📊 ${escapeHtml(d.etiqueta)}</h2>
      <span class="empty-note">${escapeHtml(d.desde)} al ${escapeHtml(d.hasta)}</span>
      <span class="pm-esp"></span>
      <select id="pmBase" onchange="cambiarBasePanelMotivo(this.value)" title="Con qué fecha se ubica cada conversación dentro del período">
        <option value="ultimo_cliente" ${d.base === 'ultimo_cliente' ? 'selected' : ''}>Período: cuando el cliente dejó de responder</option>
        <option value="inicio" ${d.base === 'inicio' ? 'selected' : ''}>Período: inicio de la conversación (como la tabla)</option>
      </select>
      <button class="btn-ghost btn-compact" onclick="cerrarPanelMotivo(); irAConversacionesConMotivo('${escapeHtml(d.motivo)}')">👁️ Ver conversaciones</button>
      <button class="btn-ghost btn-compact" onclick="cerrarPanelMotivo()">✕ Cerrar</button>
    </div>`;
  if(d.total === 0){
    $('panelMotivo').innerHTML = cabecera + `<div class="pm-cuerpo"><p class="empty-note">No hay conversaciones perdidas por este motivo en el período elegido${d.base === 'ultimo_cliente' && d.totalSegunInicio ? ` (según el inicio de la conversación hay ${d.totalSegunInicio}: cambia la base arriba)` : ''}.</p></div>`;
    return;
  }
  const notas = [];
  const q = d.calidad || {};
  const sinDato = q.confiable === false;
  if(sinDato) notas.push(`<b>⚠ Cuidado con las cifras que dependen de nuestras respuestas.</b> Solo el <b>${q.pct}%</b> de las ${fmtNum(q.total)} conversaciones del período tiene alguna respuesta del negocio registrada en el ERP${q.conApp ? ` (${fmtNum(q.conApp)} desde la app del celular)` : ''}. Lo que se contesta desde el celular no llega al ERP si la <i>coexistencia</i> de WhatsApp no está activa, así que "sin respuesta", "quién habló último", "tras qué mensaje se cortó" y los tiempos de respuesta pueden mostrar problemas que no existen. Es confiable lo que piden los clientes, sus palabras y de dónde vienen.`);
  if(d.base === 'ultimo_cliente' && d.totalSegunInicio !== d.total) notas.push(`La tabla de motivos cuenta <b>${d.totalSegunInicio}</b> porque ubica cada conversación por su fecha de inicio; acá hay <b>${d.total}</b> porque se ubican por la fecha en que el cliente dejó de responder.`);
  if(d.excluidasPorCierre) notas.push(`Se dejaron fuera <b>${fmtNum(d.excluidasPorCierre)}</b> conversaciones cuyo último mensaje del cliente fue un cierre cordial ("ok", "gracias"): se consideran <b>resueltas</b>, no pérdidas. Si la tabla de motivos todavía las cuenta, usa "✅ Reclasificar cierres" para actualizarla.`);
  if(d.truncado) notas.push('Hay más conversaciones que el máximo analizado; se muestran las más recientes.');
  const kpis = `<div class="pm-kpis">
    ${tarjetaPm('Conversaciones perdidas', fmtNum(d.total), `por "${escapeHtml(d.etiqueta)}"`)}
    ${tarjetaPm('Compraron después', fmtNum(d.resumen.recuperadas), 'con venta en Bsale (por teléfono)')}
    ${sinDato
      ? tarjetaPm('Sin respuesta registrada en el ERP', fmtNum(d.resumen.sinRespuestaNuestra), 'no significa que no se respondió: ver aviso')
      : tarjetaPm('Sin ninguna respuesta nuestra', fmtNum(d.resumen.sinRespuestaNuestra), 'el negocio nunca escribió')}
    ${sinDato
      ? tarjetaPm('Respuestas registradas', (q.pct != null ? q.pct : 0) + '%', `de las ${fmtNum(q.total)} conversaciones del período`)
      : tarjetaPm('Habló último el negocio', s.ultimoMensajeDe.pctNegocio + '%', 'el cliente dejó de responder')}
    ${tarjetaPm('Mensajes por conversación', d.resumen.medianaMensajes != null ? String(d.resumen.medianaMensajes) : '—', 'mediana')}
  </div>`;
  const reco = seccionPm('💡 Qué hacer', `<div class="pm-reco">${d.recomendaciones.map(r => `<div><b>${escapeHtml(r.titulo)}</b>${escapeHtml(r.texto)}</div>`).join('')}</div>`, 'Calculado con las cifras de este panel; sirven de punto de partida, no son una orden.');

  const repite = seccionPm('🔁 Qué se repite', `
    <div class="pm-grid2">
      <div><h4>Producto · marca · modelo</h4>${barrasHtml(c.combinaciones.map(x => ({ etiqueta: x.etiqueta, n: x.n, pct: x.pct })), { vacio: 'La IA no detectó producto o marca en estas conversaciones.' })}</div>
      <div><h4>Marcas</h4>${barrasHtml(c.marcas.map(x => ({ etiqueta: x.nombre, n: x.n, pct: x.pct })))}<h4>Modelos</h4>${barrasHtml(c.modelos.map(x => ({ etiqueta: x.nombre, n: x.n, pct: x.pct })))}</div>
      <div><h4>Productos</h4>${barrasHtml(c.productos.map(x => ({ etiqueta: x.nombre, n: x.n, pct: x.pct })))}<h4>Categorías</h4>${barrasHtml(c.categorias.map(x => ({ etiqueta: x.nombre, n: x.n, pct: x.pct })))}</div>
      <div><h4>Por qué, según el análisis de la conversación</h4>${barrasHtml(c.problemas.map(x => ({ etiqueta: x.nombre, n: x.n, pct: x.pct })), { vacio: 'Sin un "problema del cliente" registrado.' })}</div>
    </div>`, 'Salen de los campos que completa la IA al analizar cada conversación.');

  const espec = renderEspecificoPm(d);
  const cuando = seccionPm('⏱️ Cuándo dejó de responder el cliente', `
    <div class="pm-grid2">
      <div><h4>Quién habló último ${sinDato ? '<span class="pm-badge no">dato incompleto</span>' : ''}</h4>${barrasHtml([{ etiqueta: 'El negocio (el cliente dejó de responder)', n: s.ultimoMensajeDe.negocio, pct: s.ultimoMensajeDe.pctNegocio }, { etiqueta: sinDato ? 'El cliente (sin respuesta registrada)' : 'El cliente (nadie le contestó)', n: s.ultimoMensajeDe.cliente, pct: s.ultimoMensajeDe.pctCliente, color: 'var(--red,#DC2626)' }])}
        <h4>Tras qué mensaje nuestro se cortó</h4>${barrasHtml(s.tras.map(t => ({ etiqueta: t.etiqueta, n: t.n, pct: t.pct })), { vacio: 'No hay conversaciones en las que haya hablado último el negocio.' })}</div>
      <div><h4>Hace cuánto fue el último mensaje del cliente</h4>${barrasHtml(s.antiguedad.map(a => ({ etiqueta: a.rango, n: a.n })))}
        <div class="pm-sub" style="margin-top:8px;">Duración típica de la conversación: <b>${s.duracionMedianaMin != null ? (s.duracionMedianaMin < 90 ? Math.round(s.duracionMedianaMin) + ' min' : Math.round(s.duracionMedianaMin / 60) + ' h') : '—'}</b> (primer a último mensaje).</div></div>
      <div><h4>Día de la semana</h4>${histogramaHtml(s.porDiaSemana.map(x => ({ eti: x.dia, n: x.n })), v => v.eti)}</div>
      <div><h4>Hora del día (Chile)</h4>${histogramaHtml(s.porHora.map(x => ({ eti: x.hora % 3 === 0 ? x.hora : '', n: x.n, h: x.hora })), v => (v.h != null ? v.h + ' h' : ''))}</div>
    </div>`, 'Día y hora del último mensaje del cliente, en hora de Chile.');

  const terminos = seccionPm('🔤 Palabras y frases más repetidas por los clientes', `
    <div class="pm-grid2">
      <div><h4>Palabras</h4>${tablaTerminosPm(d.terminos.palabras)}</div>
      <div><h4>Frases de dos palabras</h4>${tablaTerminosPm(d.terminos.frases)}</div>
    </div>`, 'Se cuenta una vez por conversación (no por mensaje). Se ignoran saludos y palabras de relleno. "Nuestro catálogo" marca lo que sí vendemos: no conviene usarlo como palabra negativa.');
  const fuentes = seccionPm('🧭 De dónde venían estas conversaciones', `<table class="pm-tabla"><thead><tr><th>Fuente</th><th>Campaña / anuncio / página</th><th>Conv.</th><th>%</th></tr></thead><tbody>
    ${d.fuentes.map(f => `<tr><td>${escapeHtml(f.fuente)}</td><td>${escapeHtml(f.detalle || '—')}</td><td class="num">${f.n}</td><td class="num">${f.pct}%</td></tr>`).join('')}</tbody></table>`,
    d.motivo === 'producto_no_disponible' ? 'Si una campaña de Google Ads concentra estas conversaciones, ahí van primero las palabras negativas.' : '');
  const lista = seccionPm('💬 Conversaciones', `<div class="pm-scroll"><table class="pm-tabla"><thead><tr><th>Cliente</th><th>Producto</th><th>Primer mensaje</th><th>Último mensaje del cliente</th></tr></thead><tbody>
    ${d.conversaciones.map(x => `<tr><td>${escapeHtml(x.cliente || '—')}<div class="pm-ej">${enlaceTelefonoPm(x.telefono)}</div></td><td>${escapeHtml(x.producto || '—')}</td><td class="pm-ej">${escapeHtml(x.primerMensaje)}</td><td>${x.ultimoCliente ? escapeHtml(new Date(x.ultimoCliente).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : '—'}</td></tr>`).join('')}</tbody></table></div>`,
    `Las ${Math.min(80, d.total)} más recientes. Para abrir una conversación usa "Ver conversaciones".`);

  $('panelMotivo').innerHTML = cabecera + `<div class="pm-cuerpo">${notas.map(n => `<div class="pm-nota">${n}</div>`).join('')}${kpis}${reco}${espec}${repite}${cuando}${terminos}${fuentes}${lista}</div>`;
}

function tablaTerminosPm(lista){
  if(!lista.length) return '<p class="empty-note">Sin términos repetidos en al menos 2 conversaciones.</p>';
  return `<div class="pm-scroll"><table class="pm-tabla"><thead><tr><th>Término</th><th>Conv.</th><th>%</th></tr></thead><tbody>${lista.map(t => `
    <tr title="${escapeHtml(t.ejemplo)}"><td>${escapeHtml(t.termino)} ${t.propia ? '<span class="pm-badge ok">nuestro catálogo</span>' : ''}</td><td class="num">${t.conversaciones}</td><td class="num">${t.pct}%</td></tr>`).join('')}</tbody></table></div>`;
}

function renderEspecificoPm(d){
  const e = d.especifico;
  const sinDato = (d.calidad || {}).confiable === false; // faltan las respuestas del negocio en el ERP
  if(!e) return '';
  if(e.tipo === 'negativas'){
    const filas = e.candidatas.map(c => `<tr><td>${escapeHtml(c.termino)} ${c.esMarca ? '<span class="pm-badge no">marca que no vendemos</span>' : ''}</td><td class="num">${c.conversaciones}</td><td class="num">${c.pct}%</td><td class="pm-ej">${escapeHtml(c.ejemplo)}</td></tr>`).join('');
    return seccionPm('🚫 Palabras clave negativas para Google Ads', `
      <div class="pm-acciones">
        <button class="btn-primary btn-compact" onclick="copiarNegativasPm('amplia')">📋 Copiar (amplia)</button>
        <button class="btn-ghost btn-compact" onclick="copiarNegativasPm('frase')">📋 Copiar ("frase")</button>
        <button class="btn-ghost btn-compact" onclick="copiarNegativasPm('exacta')">📋 Copiar ([exacta])</button>
        <button class="btn-ghost btn-compact" onclick="descargarNegativasPm()">⬇ Descargar CSV</button>
      </div>
      ${e.candidatas.length ? `<div class="pm-scroll"><table class="pm-tabla"><thead><tr><th>Candidata a negativa</th><th>Conv.</th><th>%</th><th>Ejemplo de mensaje</th></tr></thead><tbody>${filas}</tbody></table></div>` : '<p class="empty-note">Todavía no hay términos que se repitan lo suficiente. Con más conversaciones aparecerán.</p>'}`,
      'Términos repetidos en los mensajes de los clientes que no son parte de lo que vendemos. Revísalos antes de cargarlos: una palabra negativa puede dejar fuera búsquedas buenas.');
  }
  if(e.tipo === 'competencia'){
    const r = e.respuesta;
    return seccionPm('🏪 Competencia', `
      <div class="pm-grid2">
        <div><h4>Sitios que compartió el cliente</h4>${e.dominios.length ? `<table class="pm-tabla"><thead><tr><th>Dominio</th><th>Conv.</th><th>Ejemplo</th></tr></thead><tbody>${e.dominios.map(x => `<tr><td>${escapeHtml(x.dominio)}</td><td class="num">${x.conversaciones}</td><td class="pm-ej">${escapeHtml(x.ejemplo)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty-note">Ningún cliente compartió un enlace en estas conversaciones.</p>'}</div>
        <div><h4>Competidores nombrados</h4>${barrasHtml(e.competidores.map(x => ({ etiqueta: x.nombre, n: x.conversaciones, pct: x.pct })), { vacio: 'No se nombró a ninguna tienda conocida.' })}
          <h4>¿Fue la velocidad? ${sinDato ? '<span class="pm-badge no">dato incompleto</span>' : ''}</h4><div class="pm-sub">Primera respuesta en estas conversaciones: <b>${fmtMin(r.medianaSeg)}</b> · en las que terminaron en venta: <b>${fmtMin(r.referenciaVentas.medianaSeg)}</b>${r.nuncaRespondidas ? ` · ${r.nuncaRespondidas} sin respuesta` : ''}.</div></div>
      </div>`, 'Se buscan enlaces y nombres de tiendas en lo que escribió el cliente.');
  }
  if(e.tipo === 'respuesta'){
    const ref = e.referenciaVentas;
    return seccionPm('🐢 Indicadores de respuesta', `
      <div class="pm-kpis">
        ${tarjetaPm('Mediana primera respuesta', fmtMin(e.medianaSeg), ref.medianaSeg != null ? `en las ventas: ${fmtMin(ref.medianaSeg)}` : '')}
        ${tarjetaPm('El 10% más lento', fmtMin(e.p90Seg), 'p90')}
        ${tarjetaPm(sinDato ? 'Sin respuesta registrada' : 'Nunca se respondió', fmtNum(e.nuncaRespondidas), sinDato ? 'puede haberse respondido desde el celular' : '')}
        ${tarjetaPm('Empezaron fuera de horario', e.fueraDeHorario.pct + '%', `supuesto: lun–vie ${e.fueraDeHorario.horario.semana[0]}–${e.fueraDeHorario.horario.semana[1]} h, sáb ${e.fueraDeHorario.horario.sabado[0]}–${e.fueraDeHorario.horario.sabado[1]} h`)}
      </div>
      <div class="pm-grid2">
        <div><h4>Cuánto tardó la primera respuesta</h4>${barrasHtml(e.distribucion.map(x => ({ etiqueta: x.rango, n: x.n })))}</div>
        <div><h4>Hora en que escribió el cliente (Chile)</h4>${histogramaHtml(e.porHora.map(x => ({ eti: x.hora % 3 === 0 ? x.hora : '', n: x.n, h: x.hora })), v => (v.h != null ? v.h + ' h' : ''))}
          <h4>Día de la semana</h4>${histogramaHtml(e.porDiaSemana.map(x => ({ eti: x.dia, n: x.n })), v => v.eti)}</div>
        <div><h4>Por responsable</h4><table class="pm-tabla"><thead><tr><th>Responsable</th><th>Conv.</th><th>Mediana</th></tr></thead><tbody>${e.porResponsable.map(x => `<tr><td>${escapeHtml(x.nombre)}</td><td class="num">${x.n}</td><td class="num">${fmtMin(x.medianaSeg)}</td></tr>`).join('')}</tbody></table></div>
      </div>`, 'El horario de atención es un supuesto para medir "fuera de horario"; ajústalo con el equipo si es otro.');
  }
  if(e.tipo === 'precio'){
    const filas = e.recontactables.map(x => `<tr><td>${escapeHtml(x.cliente || '—')}</td><td>${enlaceTelefonoPm(x.telefono)}</td><td>${escapeHtml(x.producto || '—')}</td><td class="num">${x.diasSinResponder != null ? x.diasSinResponder + ' d' : '—'}</td></tr>`).join('');
    return seccionPm('💲 Precio: qué dicen los clientes', `
      <div class="pm-grid2">
        <div><h4>Señales en los mensajes</h4>${barrasHtml(e.senales.map(x => ({ etiqueta: x.senal, n: x.conversaciones, pct: x.pct })))}
          <div class="pm-sub" style="margin-top:8px;">Compraron igual después: <b>${e.recuperadas.n}</b> (${e.recuperadas.pct}%).</div></div>
        <div><h4>Clientes para recontactar con un cupón (${e.totalRecontactables})</h4>
          <div class="pm-acciones"><button class="btn-ghost btn-compact" onclick="descargarRecontactoPm()">⬇ Descargar lista (CSV)</button></div>
          <div class="pm-scroll"><table class="pm-tabla"><thead><tr><th>Cliente</th><th>Teléfono</th><th>Producto</th><th>Sin responder</th></tr></thead><tbody>${filas}</tbody></table></div></div>
      </div>`, 'Son las conversaciones perdidas por precio que no tienen una venta posterior en Bsale y tienen teléfono.');
  }
  return '';
}

// ---- Copiar / descargar ----
function textoNegativasPm(tipo){
  const e = motivoPanel && motivoPanel.datos && motivoPanel.datos.especifico;
  if(!e || !e.candidatas) return '';
  return e.candidatas.map(c => tipo === 'frase' ? `"${c.termino}"` : tipo === 'exacta' ? `[${c.termino}]` : c.termino).join('\n');
}
async function copiarNegativasPm(tipo){
  const texto = textoNegativasPm(tipo);
  if(!texto){ alert('No hay candidatas para copiar.'); return; }
  try{ await navigator.clipboard.writeText(texto); mostrarAvisoPm(`Copiadas ${texto.split('\n').length} palabras (${tipo}).`); }
  catch(err){ prompt('Copia estas palabras (Ctrl+C):', texto.replace(/\n/g, ', ')); }
}
function mostrarAvisoPm(msg){
  let t = document.getElementById('avisoPm');
  if(!t){ t = document.createElement('div'); t.id = 'avisoPm'; t.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#1F2A24;color:#fff;padding:9px 16px;border-radius:9px;font-size:12.5px;z-index:120;'; document.body.appendChild(t); }
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, 2400);
}
function csvPm(filas, nombre){
  const csv = filas.map(f => f.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = nombre; a.click(); URL.revokeObjectURL(a.href);
}
function descargarNegativasPm(){
  const d = motivoPanel && motivoPanel.datos; if(!d || !d.especifico || !d.especifico.candidatas) return;
  csvPm([['Palabra clave', 'Conversaciones', '% de conversaciones', 'Es marca', 'Ejemplo'], ...d.especifico.candidatas.map(c => [c.termino, c.conversaciones, c.pct, c.esMarca ? 'Sí' : '', c.ejemplo])], `negativas-${d.motivo}-${d.desde}_${d.hasta}.csv`);
}
function descargarRecontactoPm(){
  const d = motivoPanel && motivoPanel.datos; if(!d || !d.especifico || !d.especifico.recontactables) return;
  csvPm([['Cliente', 'Teléfono', 'Producto', 'Días sin responder'], ...d.especifico.recontactables.map(x => [x.cliente, x.telefono, x.producto, x.diasSinResponder ?? ''])], `recontacto-precio-${d.desde}_${d.hasta}.csv`);
}

// ---- Reclasificar cierres cordiales ("ok", "gracias") como consulta resuelta ----
async function reclasificarCierres(){
  const btn = document.getElementById('btnReclasificarCierres');
  if(btn) btn.disabled = true;
  try{
    const vista = await fetch('/api/negocio?recurso=whatsapp-reclasificar-cierres').then(r => r.json());
    if(vista.error){ alert(vista.error + (vista.detail ? ' (' + vista.detail + ')' : '')); return; }
    if(!vista.candidatas){ alert('No hay conversaciones para reclasificar: revisé ' + fmtNum(vista.revisadas) + ' y ninguna terminó con un cierre cordial.'); return; }
    const ejemplos = vista.ejemplos.slice(0, 8).map(e => '• #' + e.id + ' ' + (e.cliente || 'Sin nombre') + ': "' + e.ultimoMensaje + '"').join('\n');
    if(!confirm('Encontré ' + fmtNum(vista.candidatas) + ' conversaciones que quedaron como "Cliente dejó de responder" (u "Otro") pero cuyo último mensaje del cliente fue un cierre cordial. Pasarían a "Consulta resuelta" y dejarían de contar como pérdida.\n\nEjemplos:\n' + ejemplos + '\n\n¿Aplicar el cambio?')) return;
    const r = await fetch('/api/negocio?recurso=whatsapp-reclasificar-cierres', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aplicar: true }) }).then(x => x.json());
    if(r.error){ alert(r.error); return; }
    alert('Listo: ' + fmtNum(r.actualizadas) + ' conversaciones pasaron a "Consulta resuelta".');
    if(typeof cargarAnalitica === 'function' && document.getElementById('analiticaDesde')) cargarAnalitica();
  }catch(err){ alert('Error: ' + err.message); }
  finally{ if(btn) btn.disabled = false; }
}

// ================= Análisis de una CATEGORÍA consultada (mismo panel lateral) =================
// Se abre desde el botón "📊 Analizar" de cada fila de "Categorías consultadas". Comparte el panel de los motivos de pérdida.
function abrirPanelCategoria(categoria){
  asegurarEstilosPanelMotivo();
  motivoPanel = { tipo: 'categoria', categoria, base: null, motivo: null, datos: null };
  $('fondoPanelMotivo').classList.add('abierto'); $('panelMotivo').classList.add('abierto');
  cargarPanelCategoria();
}
async function cargarPanelCategoria(){
  const { categoria } = motivoPanel;
  const desde = $('analiticaDesde').value, hasta = $('analiticaHasta').value;
  const etiqueta = CATEGORIA_LABEL[categoria] || categoria;
  const yo = ++cargandoPanelMotivo;
  $('panelMotivo').innerHTML = `<div class="pm-head"><h2>📊 ${escapeHtml(etiqueta)}</h2><span class="pm-esp"></span><button class="btn-ghost btn-compact" onclick="cerrarPanelMotivo()">✕ Cerrar</button></div><div class="pm-cuerpo"><div class="pm-cargando">Analizando las conversaciones de esta categoría…</div></div>`;
  try{
    const res = await fetch(`/api/negocio?recurso=whatsapp-categoria-detalle&categoria=${encodeURIComponent(categoria)}&desde=${desde}&hasta=${hasta}`);
    const d = await res.json();
    if(yo !== cargandoPanelMotivo) return;
    if(!res.ok || d.error){ $('panelMotivo').querySelector('.pm-cuerpo').innerHTML = `<p class="empty-note">${escapeHtml(d.error || 'No se pudo analizar esta categoría.')}${d.detail ? ' (' + escapeHtml(d.detail) + ')' : ''}</p>`; return; }
    motivoPanel.datos = d;
    renderPanelCategoria(d);
  }catch(err){
    if(yo === cargandoPanelMotivo) $('panelMotivo').querySelector('.pm-cuerpo').innerHTML = `<p class="empty-note">Error: ${escapeHtml(err.message)}</p>`;
  }
}
function badgeResultadoPm(r){
  if(r === 'venta') return '<span class="pm-badge ok">venta</span>';
  if(r === 'consulta_resuelta') return '<span class="pm-badge ok">resuelta</span>';
  if(r === 'cotizacion' || r === 'seguimiento') return '<span class="pm-badge">en curso</span>';
  return r ? '<span class="pm-badge no">perdida</span>' : '';
}
function renderPanelCategoria(d){
  const etiqueta = CATEGORIA_LABEL[d.categoria] || d.categoria;
  const s = d.resumen, c = d.comun, q = d.calidad || {};
  const cabecera = `<div class="pm-head"><h2>📊 ${escapeHtml(etiqueta)}</h2><span class="empty-note">${escapeHtml(d.desde)} al ${escapeHtml(d.hasta)}</span><span class="pm-esp"></span><button class="btn-ghost btn-compact" onclick="cerrarPanelMotivo()">✕ Cerrar</button></div>`;
  if(d.total === 0){ $('panelMotivo').innerHTML = cabecera + '<div class="pm-cuerpo"><p class="empty-note">No hay conversaciones de esta categoría en el período elegido.</p></div>'; return; }
  const notas = [];
  if(q.confiable === false) notas.push(`<b>⚠ Los tiempos de respuesta no son confiables.</b> Solo el <b>${q.pct}%</b> de las ${fmtNum(q.total)} conversaciones del período tiene alguna respuesta del negocio registrada en el ERP (lo que se contesta desde el celular no llega si la coexistencia de WhatsApp no está activa). Es confiable lo que piden los clientes, de dónde vienen y cuánto se vende.`);
  if(d.truncado) notas.push('Hay más conversaciones que el máximo analizado; se muestran las más recientes.');
  const kpis = `<div class="pm-kpis">
    ${tarjetaPm('Conversaciones', fmtNum(s.total), `${fmtNum(s.conIntencionCompra)} con intención de compra`)}
    ${tarjetaPm('Ventas', fmtNum(s.ventas), `${s.conversion}% de conversión`)}
    ${tarjetaPm('Perdidas', fmtNum(s.perdidas), `${s.pctPerdidas}% de las conversaciones`)}
    ${tarjetaPm('Cotización en curso', fmtNum(s.cotizaciones), 'todavía abiertas')}
    ${tarjetaPm('Consultas resueltas', fmtNum(s.resueltas), 'terminaron con "ok / gracias"')}
  </div>`;
  const reco = seccionPm('💡 Qué hacer', `<div class="pm-reco">${d.recomendaciones.map(r => `<div><b>${escapeHtml(r.titulo)}</b>${escapeHtml(r.texto)}</div>`).join('')}</div>`, 'Calculado con las cifras de este panel; sirven de punto de partida, no son una orden.');
  const embudo = seccionPm('🔻 Embudo de esta categoría', barrasHtml(d.embudo.map((e, i) => ({ etiqueta: e.etapa, n: e.n, pct: i > 0 ? pctPm(e.n, d.embudo[0].n) : null }))));
  const motivos = seccionPm('🚫 Por qué se pierden', d.motivosPerdida.length ? `<table class="pm-tabla"><thead><tr><th>Motivo</th><th>Conv.</th><th>%</th><th></th></tr></thead><tbody>${d.motivosPerdida.map(m => `<tr><td>${escapeHtml(m.etiqueta)}</td><td class="num">${m.n}</td><td class="num">${m.pct}%</td><td>${MOTIVOS_ANALIZABLES_UI.includes(m.motivo) ? `<button class="btn-ghost btn-compact" onclick="abrirPanelMotivo('${escapeHtml(m.motivo)}')">📊 Analizar este motivo</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="empty-note">No hay conversaciones perdidas en esta categoría.</p>',
    'El análisis de cada motivo abre el detalle general (todas las categorías) del período.');
  const repite = seccionPm('🔁 Qué se consulta', `
    <div class="pm-grid2">
      <div><h4>Producto · marca · modelo</h4>${barrasHtml(c.combinaciones.map(x => ({ etiqueta: x.etiqueta, n: x.n, pct: x.pct })), { vacio: 'La IA no detectó producto o marca.' })}</div>
      <div><h4>Marcas</h4>${barrasHtml(c.marcas.map(x => ({ etiqueta: x.nombre, n: x.n, pct: x.pct })))}<h4>Modelos</h4>${barrasHtml(c.modelos.map(x => ({ etiqueta: x.nombre, n: x.n, pct: x.pct })))}</div>
      <div><h4>Productos</h4>${barrasHtml(c.productos.map(x => ({ etiqueta: x.nombre, n: x.n, pct: x.pct })))}<h4>Especificaciones</h4>${barrasHtml(c.especificaciones.map(x => ({ etiqueta: x.nombre, n: x.n, pct: x.pct })), { vacio: 'Sin especificaciones registradas.' })}</div>
      <div><h4>Necesidad del cliente</h4>${barrasHtml(c.problemas.map(x => ({ etiqueta: x.nombre, n: x.n, pct: x.pct })), { vacio: 'Sin un "problema del cliente" registrado.' })}</div>
    </div>`, 'Salen de los campos que completa la IA al analizar cada conversación.');
  const sinVenta = d.demandaSinVenta.length ? seccionPm('🧲 Se consulta y no se vende', `<table class="pm-tabla"><thead><tr><th>Producto · marca · modelo</th><th>Consultas</th><th>Ventas</th></tr></thead><tbody>${d.demandaSinVenta.map(x => `<tr><td>${escapeHtml(x.etiqueta)}</td><td class="num">${x.n}</td><td class="num">${x.ventas}</td></tr>`).join('')}</tbody></table>`, 'Combinaciones con 3 o más consultas y ninguna venta en el período: revisa stock, precio y publicación.') : '';
  const demanda = seccionPm('🕒 Cuándo escriben los clientes', `<div class="pm-grid2"><div><h4>Día de la semana</h4>${histogramaHtml(d.demanda.porDiaSemana.map(x => ({ eti: x.dia, n: x.n })), v => v.eti)}</div><div><h4>Hora del día (Chile)</h4>${histogramaHtml(d.demanda.porHora.map(x => ({ eti: x.hora % 3 === 0 ? x.hora : '', n: x.n, h: x.hora })), v => (v.h != null ? v.h + ' h' : ''))}</div></div>`, 'Hora del primer mensaje del cliente.');
  const fuentes = seccionPm('🧭 De dónde vienen y cuánto convierten', `<table class="pm-tabla"><thead><tr><th>Fuente</th><th>Campaña / anuncio / página</th><th>Conv.</th><th>%</th><th>Ventas</th><th>Conversión</th></tr></thead><tbody>${d.fuentes.map(f => `<tr><td>${escapeHtml(f.fuente)}</td><td>${escapeHtml(f.detalle || '—')}</td><td class="num">${f.n}</td><td class="num">${f.pct}%</td><td class="num">${f.ventas}</td><td class="num">${f.conversion}%</td></tr>`).join('')}</tbody></table>`);
  const terminos = seccionPm('🔤 Palabras y frases más repetidas por los clientes', `<div class="pm-grid2"><div><h4>Palabras</h4>${tablaTerminosPm(d.terminos.palabras)}</div><div><h4>Frases de dos palabras</h4>${tablaTerminosPm(d.terminos.frases)}</div></div>`, 'Se cuenta una vez por conversación. Útil para ideas de palabras clave y de palabras negativas en Google Ads.');
  const respuesta = seccionPm('⏱️ Primera respuesta', `<div class="pm-grid2"><div>${barrasHtml(d.respuesta.distribucion.map(x => ({ etiqueta: x.rango, n: x.n })))}</div><div><div class="pm-sub">Mediana: <b>${fmtMin(d.respuesta.medianaSeg)}</b> · el 10% más lento: <b>${fmtMin(d.respuesta.p90Seg)}</b> · sin respuesta registrada: <b>${fmtNum(d.respuesta.sinRespuestaRegistrada)}</b>${q.confiable === false ? ' <span class="pm-badge no">dato incompleto</span>' : ''}</div></div></div>`);
  const lista = seccionPm('💬 Conversaciones', `<div class="pm-scroll"><table class="pm-tabla"><thead><tr><th>Cliente</th><th>Producto</th><th>Primer mensaje</th><th>Resultado</th></tr></thead><tbody>
    ${d.conversaciones.map(x => `<tr><td>${escapeHtml(x.cliente || '—')}<div class="pm-ej">${enlaceTelefonoPm(x.telefono)}</div></td><td>${escapeHtml(x.producto || '—')}</td><td class="pm-ej">${escapeHtml(x.primerMensaje)}</td><td>${badgeResultadoPm(x.resultado)}</td></tr>`).join('')}</tbody></table></div>`, `Las ${Math.min(80, d.total)} más recientes.`);
  $('panelMotivo').innerHTML = cabecera + `<div class="pm-cuerpo">${notas.map(n => `<div class="pm-nota">${n}</div>`).join('')}${kpis}${reco}${embudo}${motivos}${repite}${sinVenta}${demanda}${fuentes}${terminos}${respuesta}${lista}</div>`;
}
function pctPm(n, total){ return total > 0 ? Math.round(n / total * 1000) / 10 : 0; }

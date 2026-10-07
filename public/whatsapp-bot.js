// Panel "🤖 Bot nocturno" (fase 1: modo sombra). Reutiliza el panel lateral y los estilos pm-* de whatsapp-motivos.js.
// El bot redacta borradores con precio, stock y enlace reales; NADA se envía solo: el ejecutivo los revisa en Conversaciones.

const BOT_DIAS_ORDEN = [1, 2, 3, 4, 5, 6, 0];
const BOT_DIA_CORTO = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' };
const BOT_DIA_LARGO = { 0: 'domingo', 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado' };
let botPanel = { cfg: null, resumen: null, horario: [], ejecutando: false };

function abrirPanelBot(){
  asegurarEstilosPanelMotivo();
  $('fondoPanelMotivo').classList.add('abierto'); $('panelMotivo').classList.add('abierto');
  cargarPanelBot();
}
function cabeceraPanelBot(extra){
  return `<div class="pm-head"><h2>🤖 Bot nocturno</h2>${extra || ''}<span class="pm-esp"></span><button class="btn-ghost btn-compact" onclick="cerrarPanelMotivo()">✕ Cerrar</button></div>`;
}
async function cargarPanelBot(){
  $('panelMotivo').innerHTML = cabeceraPanelBot() + '<div class="pm-cuerpo"><div class="pm-cargando">Cargando el bot…</div></div>';
  try{
    const [rc, rr] = await Promise.all([fetch('/api/negocio?recurso=whatsapp-bot-config'), fetch('/api/negocio?recurso=whatsapp-bot-resumen&dias=30')]);
    const [c, r] = await Promise.all([rc.json(), rr.json()]);
    if(!rc.ok || c.error) throw new Error(c.error || 'No se pudo leer la configuración.');
    botPanel.cfg = c; botPanel.resumen = (rr.ok && !r.error) ? r : null;
    botPanel.horario = JSON.parse(JSON.stringify(c.horario));
    renderPanelBot();
  }catch(err){
    $('panelMotivo').innerHTML = cabeceraPanelBot() + `<div class="pm-cuerpo"><p class="empty-note">Error: ${escapeHtml(err.message)}</p></div>`;
  }
}
// Los tramos idénticos de distintos días (martes a viernes 08:30 → 19:35) se muestran juntos.
function lineasHuecosBot(huecos){
  const grupos = new Map(), lineas = [];
  for(const h of huecos){
    if(h.desdeDia === h.hastaDia){ const k = `${h.desde}|${h.hasta}`; if(!grupos.has(k)) grupos.set(k, { h, dias: [] }); grupos.get(k).dias.push(BOT_DIA_LARGO[h.desdeDia]); }
    else lineas.push(`${BOT_DIA_LARGO[h.desdeDia]} ${h.desde} → ${BOT_DIA_LARGO[h.hastaDia]} ${h.hasta} (${String(h.horas).replace('.', ',')} h)`);
  }
  for(const g of grupos.values()){
    const d = g.dias.length > 1 ? g.dias.slice(0, -1).join(', ') + ' y ' + g.dias[g.dias.length - 1] : g.dias[0];
    lineas.unshift(`${d} ${g.h.desde} → ${g.h.hasta} (${String(g.h.horas).replace('.', ',')} h)`);
  }
  return lineas;
}
function renderPanelBot(){
  const c = botPanel.cfg, r = botPanel.resumen, admin = c.esAdmin;
  const dis = admin ? '' : 'disabled';
  const modoBadge = c.modo === 'apagado' ? '<span class="pm-badge no">apagado</span>' : '<span class="pm-badge ok">modo sombra</span>';
  const avisos = [];
  if(!c.apiKeyConfigurada) avisos.push('<b>Falta la GEMINI_API_KEY</b> en el servidor: sin ella el bot no puede redactar.');
  if(!admin) avisos.push('Solo un administrador puede cambiar la configuración. Tú puedes preparar respuestas y ver el rendimiento.');
  const nota = avisos.length ? `<div class="pm-nota">${avisos.join('<br>')}</div>` : '';
  const kpis = r ? `<div class="pm-kpis">
      ${tarjetaPm('Ahora', c.ahoraAtiendeBot ? 'Bot' : 'Equipo', c.ahoraAtiendeBot ? 'dentro del horario del bot' : 'fuera del horario del bot')}
      ${tarjetaPm('Por preparar', fmtNum(r.porPreparar), 'mensajes del bot sin respuesta (24 h)')}
      ${tarjetaPm('Borradores', fmtNum(r.total), `últimos ${r.dias} días · ${fmtNum(r.escalados)} piden ejecutivo`)}
      ${tarjetaPm('Se usan tal cual', r.pctUsadosTalCual == null ? '—' : r.pctUsadosTalCual + '%', `de ${fmtNum(r.decididos)} decididos`)}
      ${tarjetaPm('Se editan', r.pctUsadosEditados == null ? '—' : r.pctUsadosEditados + '%', 'enviados con cambios')}
      ${tarjetaPm('Se descartan', r.pctDescartados == null ? '—' : r.pctDescartados + '%', 'no sirvieron')}
      ${tarjetaPm('Confianza alta', fmtNum(r.alta), `${fmtNum(r.media)} media · ${fmtNum(r.baja)} baja`)}
      ${tarjetaPm('Tokens por borrador', fmtNum(r.tokens_entrada_prom + r.tokens_salida_prom), `${fmtNum(r.tokens_entrada_prom)} entrada · ${fmtNum(r.tokens_salida_prom)} salida · ${escapeHtml(c.modelo)}`)}
    </div>` : '';
  const lote = seccionPm('🌙 Preparar las respuestas de la noche', `
      <div class="pm-acciones">
        <button class="btn-primary" id="btnLoteBot" onclick="prepararLoteBot()" ${c.modo === 'apagado' || !c.apiKeyConfigurada ? 'disabled' : ''}>▶ Preparar ${r ? fmtNum(r.porPreparar) : ''} conversaciones</button>
        <span class="empty-note" id="progresoLoteBot"></span>
      </div>
      <div id="barraLoteBot" style="display:none;height:9px;background:var(--line);border-radius:5px;overflow:hidden;margin-bottom:6px;"><div id="rellenoLoteBot" style="height:100%;width:0;background:var(--primary);transition:width .3s;"></div></div>
      <div id="detalleLoteBot" class="empty-note"></div>`,
    'Redacta un borrador para cada conversación cuyo último mensaje llegó dentro del horario del bot y sigue sin respuesta. Cada borrador aparece en la conversación (tarjeta 🤖) para que lo revises; no se envía nada.');
  const huecos = c.huecos.length ? `<div class="pm-nota" style="background:var(--surface-2);color:var(--text);">Tramos en que el bot <b>no</b> atiende (hay equipo, o nadie):<br>${lineasHuecosBot(c.huecos).map(t => '• ' + escapeHtml(t)).join('<br>')}</div>` : '';
  const horario = seccionPm('🕒 Modo y horario', `
      <div class="pm-acciones" style="align-items:center;">
        <label for="botModo" style="font-size:12px;font-weight:600;">Modo</label>
        <select id="botModo" ${dis}><option value="sombra" ${c.modo === 'sombra' ? 'selected' : ''}>Sombra: redacta, tú revisas y envías</option><option value="apagado" ${c.modo === 'apagado' ? 'selected' : ''}>Apagado</option></select>
        ${modoBadge}
      </div>
      <div id="botHorario"></div>
      ${admin ? '<div class="pm-acciones"><button class="btn-ghost btn-compact" onclick="botAgregarVentana()">➕ Agregar ventana</button></div>' : ''}
      ${huecos}`,
    'Cada ventana vale para los días marcados. Si "hasta" es menor que "desde", la ventana sigue después de la medianoche (lun–vie 19:35 → 08:30 cubre también la madrugada del día siguiente). Hora de Chile.');
  const conocimiento = seccionPm('📚 Qué puede afirmar el bot', `
      <textarea id="botConocimiento" rows="10" style="width:100%;font-family:inherit;font-size:12.5px;padding:10px;border:1.5px solid var(--line);border-radius:9px;" ${dis}>${escapeHtml(c.conocimiento)}</textarea>
      ${admin ? `<div class="pm-acciones"><button class="btn-ghost btn-compact" onclick="botRestaurarConocimiento()">↺ Restaurar el texto inicial</button></div>` : ''}`,
    `Direcciones, garantías, instalación, envíos, medios de pago, etc. <b>Lo que no esté escrito acá, el bot no lo afirma</b>: avisa que lo confirma un ejecutivo. Precio, stock y enlace los toma siempre del catálogo (Shopify) y de Bsale, nunca de este texto. ${c.conocimientoPersonalizado ? 'Última edición: ' + escapeHtml(c.actualizadoPor || '—') + '.' : 'Este es el texto inicial: revísalo y complétalo.'}`);
  const guardar = admin ? `<div class="pm-acciones"><button class="btn-primary" id="btnGuardarBot" onclick="guardarConfigBot()">💾 Guardar configuración</button><span class="empty-note" id="msgGuardarBot"></span></div>` : '';
  const reglas = seccionPm('🛡️ Reglas de seguridad', `<ul style="margin:0;padding-left:18px;font-size:12.5px;line-height:1.6;">
      <li>Precio, stock y enlace salen solo del catálogo. Si el borrador trae un precio o enlace que no vino de ahí, <b>se marca y pide ejecutivo</b>.</li>
      <li>No promete descuentos, reservas, plazos ni costos de envío, ni compatibilidad si el producto no nombra el modelo exacto.</li>
      <li>Reclamos, garantías en curso, servicio técnico, facturas, empresas, imágenes o audios: <b>escala a un ejecutivo</b>.</li>
      <li>Se presenta como asistente virtual de IndexStore en su primer mensaje.</li>
      <li>Fase 1: <b>nunca envía solo</b>. Se mide cuántos borradores salen tal cual, editados o descartados antes de pensar en el envío automático.</li></ul>`);
  $('panelMotivo').innerHTML = cabeceraPanelBot(modoBadge) + `<div class="pm-cuerpo">${nota}${kpis}${lote}${horario}${conocimiento}${guardar}${reglas}</div>`;
  renderHorarioBot();
}
function renderHorarioBot(){
  const admin = botPanel.cfg.esAdmin, dis = admin ? '' : 'disabled';
  $('botHorario').innerHTML = botPanel.horario.map((v, i) => `
    <div class="pm-acciones" style="align-items:center;border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin:6px 0;">
      ${BOT_DIAS_ORDEN.map(d => `<label style="font-size:12px;display:flex;align-items:center;gap:3px;"><input type="checkbox" ${v.dias.includes(d) ? 'checked' : ''} ${dis} onchange="botToggleDia(${i}, ${d})">${BOT_DIA_CORTO[d]}</label>`).join('')}
      <span style="flex:1"></span>
      <label style="font-size:12px;">desde <input type="time" value="${escapeHtml(v.desde)}" ${dis} onchange="botCambiarHora(${i}, 'desde', this.value)"></label>
      <label style="font-size:12px;">hasta <input type="time" value="${escapeHtml(v.hasta)}" ${dis} onchange="botCambiarHora(${i}, 'hasta', this.value)"></label>
      ${admin && botPanel.horario.length > 1 ? `<button class="btn-ghost btn-compact" title="Quitar ventana" onclick="botQuitarVentana(${i})">🗑</button>` : ''}
    </div>`).join('');
}
function botToggleDia(i, d){
  const v = botPanel.horario[i];
  v.dias = v.dias.includes(d) ? v.dias.filter(x => x !== d) : [...v.dias, d].sort();
}
function botCambiarHora(i, campo, valor){ botPanel.horario[i][campo] = valor; }
function botQuitarVentana(i){ botPanel.horario.splice(i, 1); renderHorarioBot(); }
function botAgregarVentana(){ botPanel.horario.push({ dias: [1, 2, 3, 4, 5], desde: '20:00', hasta: '08:00' }); renderHorarioBot(); }
function botRestaurarConocimiento(){
  if(!confirm('¿Reemplazar el texto por el inicial? Se pierden los cambios que no hayas guardado.')) return;
  $('botConocimiento').value = botPanel.cfg.conocimientoDefecto;
}
async function guardarConfigBot(){
  const btn = $('btnGuardarBot'), msg = $('msgGuardarBot');
  btn.disabled = true; msg.textContent = 'Guardando…';
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-bot-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo: $('botModo').value, horario: botPanel.horario, conocimiento: $('botConocimiento').value }),
    });
    const d = await res.json();
    if(!res.ok || d.error){ msg.textContent = d.error || 'No se pudo guardar.'; btn.disabled = false; return; }
    await cargarPanelBot();
    const m2 = $('msgGuardarBot'); if(m2) m2.textContent = '✓ Guardado';
  }catch(err){ msg.textContent = 'Error: ' + err.message; btn.disabled = false; }
}
// Tandas resumibles con progreso en % (cada llamada procesa los que alcance en ~30 s).
async function prepararLoteBot(){
  if(botPanel.ejecutando) return;
  botPanel.ejecutando = true;
  const btn = $('btnLoteBot'), prog = $('progresoLoteBot'), barra = $('barraLoteBot'), relleno = $('rellenoLoteBot'), det = $('detalleLoteBot');
  btn.disabled = true; barra.style.display = 'block'; det.textContent = '';
  const omitir = []; let total = null, hechas = 0; const errores = [];
  try{
    for(let vuelta = 0; vuelta < 60; vuelta++){
      const res = await fetch('/api/negocio?recurso=whatsapp-bot-lote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ omitir }) });
      const d = await res.json();
      if(!res.ok || d.error){ det.textContent = d.error || 'No se pudo preparar el lote.'; break; }
      if(total === null) total = d.totalAntes;
      hechas += d.procesadas.length;
      for(const e of d.errores){ omitir.push(e.id); errores.push(e); }
      const pct = total ? Math.min(100, Math.round(((hechas + errores.length) / total) * 100)) : 100;
      relleno.style.width = pct + '%';
      prog.textContent = total ? `${pct}% — ${fmtNum(hechas + errores.length)} de ${fmtNum(total)} conversaciones revisadas` : 'No hay conversaciones por preparar.';
      if(d.pendientes === 0 || (d.procesadas.length === 0 && d.errores.length === 0)) break;
    }
    const motivos = [...new Set(errores.map(e => e.error))].slice(0, 3);
    if(hechas === 0 && errores.length) det.innerHTML = `<b style="color:var(--red);">No se preparó ninguno.</b> ${escapeHtml(motivos.join(' · '))}`;
    else det.innerHTML = `Listo: <b>${fmtNum(hechas)}</b> borradores preparados${errores.length ? `; <b>${errores.length}</b> con error (${escapeHtml(motivos.join(' · '))})` : ''}. Ábrelos en Conversaciones.`;
  }catch(err){ det.textContent = 'Error: ' + err.message; }
  finally{
    botPanel.ejecutando = false;
    const b2 = $('btnLoteBot'); if(b2) b2.disabled = false;
  }
}

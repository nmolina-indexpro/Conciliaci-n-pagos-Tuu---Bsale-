// public/clientes-whatsapp.js
// Módulo "Clientes WhatsApp" — CRM de conversaciones. Ver api/negocio.js
// (recurso whatsapp-*) para los endpoints y lib/db.js (asegurarTablaWhatsapp)
// para el esquema. Sin framework, igual que el resto del panel.

let rolActual = null;
let usuariosActivos = []; // [{id,nombre}] para el selector de Responsable

const ESTADO_LABEL = {
  nueva: 'Nueva', abierta: 'Abierta', esperando_cliente: 'Esperando cliente',
  seguimiento: 'Seguimiento', cerrada: 'Cerrada', sin_respuesta: 'Sin respuesta',
};
const ESTADO_BADGE = {
  nueva: 'b-azul', abierta: 'b-verde', esperando_cliente: 'b-ambar',
  seguimiento: 'b-morado', cerrada: 'b-gris', sin_respuesta: 'b-rojo',
};
const RESULTADO_LABEL = {
  venta: 'Venta', cotizacion: 'Cotización', seguimiento: 'Seguimiento', sin_stock: 'Sin stock',
  cliente_no_responde: 'Cliente dejó de responder', no_interesado: 'No interesado', otro: 'Otro',
};
const INTENCION_LABEL = {
  compra: 'Compra', consulta: 'Consulta', postventa: 'Postventa',
  servicio_tecnico: 'Servicio técnico', garantia: 'Garantía', seguimiento: 'Seguimiento',
};
const CATEGORIA_LABEL = {
  pantalla: 'Pantallas notebook', cargador: 'Cargadores', bateria: 'Baterías',
  servicio_tecnico: 'Servicio técnico', repuestos: 'Repuestos', cotizacion: 'Cotización',
  compatibilidad: 'Compatibilidad', garantia: 'Garantía', estado_pedido: 'Estado de pedido',
  postventa: 'Postventa', otra: 'Otra',
};
const MOTIVO_PERDIDA_LABEL = {
  cliente_no_responde: 'Cliente dejó de responder', sin_stock: 'Sin stock', precio: 'Precio',
  respuesta_lenta: 'Respuesta demasiado lenta', producto_incompatible: 'Producto incompatible',
  sin_seguimiento: 'No se realizó seguimiento', otro: 'Otro',
};
const SEGUIMIENTO_ESTADO_LABEL = { pendiente: 'Pendiente', contactado: 'Contactado', venta: 'Venta', cerrado: 'Cerrado', no_interesado: 'No interesado' };
const SEGUIMIENTO_ESTADO_BADGE = { pendiente: 'b-ambar', contactado: 'b-azul', venta: 'b-verde', cerrado: 'b-gris', no_interesado: 'b-rojo' };

function $(id){ return document.getElementById(id); }
function escapeHtml(s){
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtNum(n){ return new Intl.NumberFormat('es-CL').format(n || 0); }
function fmtMoneda(n){ return '$' + new Intl.NumberFormat('es-CL').format(Math.round(n || 0)); }
function fmtFecha(iso){
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtFechaHora(iso){
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}
function fmtHora(iso){
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}
// Punto 20: formatos amigables (43 segundos, 2m 14s, 7m 32s, 1h 14m)
function fmtDuracion(seg){
  if (seg === null || seg === undefined) return null;
  seg = Number(seg);
  if (seg < 60) return `${seg} segundos`;
  if (seg < 3600) {
    const m = Math.floor(seg / 60), s = seg % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
// Responsable real (usuario del ERP) si ya está asignado; si no, muestra
// el vendedor que la IA detectó firmando el mensaje (todavía sin cuenta
// creada) como pista visual mientras tanto.
function responsableCellHtml(c){
  if (c.responsableNombre) return escapeHtml(c.responsableNombre);
  if (c.vendedorDetectado) return `<span class="sub">${escapeHtml(c.vendedorDetectado)} <span title="Detectado por IA, todavía sin cuenta de usuario">🤖</span></span>`;
  return 'Sin asignar';
}
// "Pantalla HP 250 G8": categoría/producto detectado + marca + modelo, en
// vez de mostrar solo la marca+modelo (sin contexto de qué se pedía).
function productoDisplayHtml(c){
  const partes = [c.producto || (c.categoria ? CATEGORIA_LABEL[c.categoria] : null), c.marca, c.modelo].filter(Boolean);
  return partes.length ? escapeHtml(partes.join(' ')) : '—';
}
function shopifyCellHtml(c){
  if (!c.shopifyProductoUrl) return '—';
  return `<a href="${escapeHtml(c.shopifyProductoUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" title="${escapeHtml(c.shopifyProductoTitulo || '')}" class="btn-ghost btn-compact" style="text-decoration:none;">🛒 Ver</a>`;
}
function debounce(fn, ms){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---- Semáforo comercial (punto 14): color + texto, nunca solo color ----
function semaforoHtml(prob){
  if (prob === null || prob === undefined) return '<span class="semaforo b-gris" style="background:var(--surface-2);color:var(--muted);">— Sin dato</span>';
  prob = Number(prob);
  if (prob >= 76) return `<span class="semaforo alta">🟢 Alta (${prob}%)</span>`;
  if (prob >= 51) return `<span class="semaforo media">🟡 Media (${prob}%)</span>`;
  if (prob >= 26) return `<span class="semaforo baja">🟠 Baja (${prob}%)</span>`;
  return `<span class="semaforo muybaja">🔴 Muy baja (${prob}%)</span>`;
}

function badgeEstado(estado){
  return `<span class="badge ${ESTADO_BADGE[estado] || 'b-gris'}">${ESTADO_LABEL[estado] || estado || '—'}</span>`;
}
function badgeResultado(resultado){
  if (!resultado) return '<span class="badge b-gris">—</span>';
  const clase = resultado === 'venta' ? 'b-verde' : (resultado === 'cotizacion' || resultado === 'seguimiento') ? 'b-azul' : 'b-rojo';
  return `<span class="badge ${clase}">${RESULTADO_LABEL[resultado] || resultado}</span>`;
}
// Alertas visuales (punto 27)
function alertasConversacion(c){
  const chips = [];
  if (c.primeraRespuestaSegundos === null && c.cantidadMensajes > 0 && c.estado !== 'cerrada') {
    chips.push('<span class="alerta-chip critica">⛔ Sin respuesta</span>');
  } else if (c.primeraRespuestaSegundos !== null) {
    if (c.primeraRespuestaSegundos > 600) chips.push('<span class="alerta-chip critica">🔴 Atención crítica</span>');
    else if (c.primeraRespuestaSegundos > 300) chips.push('<span class="alerta-chip demorada">🟠 Atención demorada</span>');
  }
  if (c.intencion === 'compra' && !c.venta && (c.primeraRespuestaSegundos === null || c.probabilidadCompra >= 51)) {
    chips.push('<span class="alerta-chip oportunidad">💡 Oportunidad comercial</span>');
  }
  if (c.requiereSeguimiento) chips.push('<span class="alerta-chip seguimiento">📌 Seguimiento pendiente</span>');
  return chips.join('');
}

// ================= Sesión / navegación entre pestañas =================
async function cargarSesionUsuario(){
  try{
    const res = await fetch('/api/auth-session');
    if(!res.ok) return;
    const u = await res.json();
    rolActual = u.rol;
    $('userBox').innerHTML = `<span>Hola, <b>${escapeHtml(u.nombre || u.email)}</b></span><a href="reportar-error.html" class="btn-logout">🐞 Reportar error</a><button class="btn-logout" onclick="cerrarSesion()">Cerrar sesión</button>`;
    if (typeof aplicarRestriccionesUsuario === 'function') aplicarRestriccionesUsuario(u.rol);
    if (typeof aplicarRestriccionPaginas === 'function') aplicarRestriccionPaginas(u.paginas);
    if(u.rol === 'admin'){
      const nav = $('navUsuarios');
      if (nav) nav.style.display = '';
      $('accionesDemo').style.display = '';
    }
    cargarUsuariosActivos();
    cambiarVistaModulo('dashboard');
  }catch(err){ /* silencioso */ }
}
async function cerrarSesion(){
  await fetch('/api/auth-session', { method: 'DELETE' });
  location.href = '/login.html';
}
async function cargarUsuariosActivos(){
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-usuarios');
    const data = await res.json();
    if (res.ok) usuariosActivos = data.usuarios || [];
  }catch(err){ /* silencioso */ }
}
function opcionesResponsable(seleccionadoId, incluirTodos){
  let out = incluirTodos ? '<option value="">Todos</option><option value="sin_asignar">Sin asignar</option>' : '<option value="">Sin asignar</option>';
  for (const u of usuariosActivos) {
    out += `<option value="${u.id}" ${Number(seleccionadoId) === u.id ? 'selected' : ''}>${escapeHtml(u.nombre)}</option>`;
  }
  return out;
}

const vistasCargadas = new Set();
function cambiarVistaModulo(vista){
  document.querySelectorAll('.tab-modulo').forEach(b => b.classList.toggle('activo', b.dataset.vista === vista));
  document.querySelectorAll('.vista-modulo').forEach(v => v.classList.remove('activa'));
  const nombreVista = 'vista' + vista.charAt(0).toUpperCase() + vista.slice(1);
  $(nombreVista).classList.add('activa');
  if (!vistasCargadas.has(vista)) {
    vistasCargadas.add(vista);
    if (vista === 'dashboard') initDashboard();
    if (vista === 'conversaciones') initConversaciones();
    if (vista === 'seguimientos') initSeguimientos();
    if (vista === 'clientes') initClientes();
    if (vista === 'analitica') initAnalitica();
  }
}

// ================= DASHBOARD =================
function initDashboard(){
  $('vistaDashboard').innerHTML = `
    <div class="seccion">
      <div class="seccion-head"><div><h2>Resumen general</h2><div class="sub">Comparado con el período anterior donde aplica.</div></div></div>
      <div id="kpisConversaciones" class="grid" style="margin-bottom:18px;"></div>
      <div id="kpisAtencion" class="grid" style="margin-bottom:18px;"></div>
      <div id="kpisComercial" class="grid"></div>
    </div>
  `;
  cargarDashboard();
}
function cmpHtml(pct){
  if (pct === null || pct === undefined) return '';
  if (pct === Infinity) return `<div class="cmp up">▲ nuevo</div>`;
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const flecha = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  return `<div class="cmp ${cls}">${flecha} ${pct > 0 ? '+' : ''}${pct}% vs. período anterior</div>`;
}
async function cargarDashboard(){
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-dashboard');
    const data = await res.json();
    if (!res.ok || data.error) { $('kpisConversaciones').innerHTML = `<p class="empty-note">${data.error || 'No se pudo cargar el dashboard.'}</p>`; return; }
    const c = data.conversaciones, a = data.atencion, com = data.comercial;

    $('kpisConversaciones').innerHTML = `
      <div class="card"><div class="lbl">Conversaciones hoy</div><div class="big">${fmtNum(c.hoy)}</div></div>
      <div class="card"><div class="lbl">Últimos 7 días</div><div class="big">${fmtNum(c.ult7dias)}</div>${cmpHtml(c.ult7diasVariacion)}</div>
      <div class="card"><div class="lbl">Este mes</div><div class="big">${fmtNum(c.mes)}</div>${cmpHtml(c.mesVariacion)}</div>
      <div class="card"><div class="lbl">Clientes únicos (mes)</div><div class="big">${fmtNum(c.clientesUnicosMes)}</div>${cmpHtml(c.clientesUnicosMesVariacion)}</div>
    `;
    $('kpisAtencion').innerHTML = `
      <div class="card"><div class="lbl">Tiempo prom. 1ª respuesta</div><div class="big">${a.promedioSegundos != null ? fmtDuracion(a.promedioSegundos) : '—'}</div></div>
      <div class="card"><div class="lbl">Mediana 1ª respuesta</div><div class="big">${a.medianaSegundos != null ? fmtDuracion(a.medianaSegundos) : '—'}</div></div>
      <div class="card"><div class="lbl">Respondidas &lt;5min / 5-10min / &gt;10min</div><div class="big" style="font-size:16px;">${a.pctBajo5min}% / ${a.pctEntre5y10min}% / ${a.pctSobre10min}%</div></div>
      <div class="card ${a.sinRespuesta > 0 ? 'destacada' : ''}"><div class="lbl">Sin respuesta</div><div class="big">${fmtNum(a.sinRespuesta)}</div></div>
    `;
    $('kpisComercial').innerHTML = `
      <div class="card"><div class="lbl">Con intención de compra</div><div class="big">${fmtNum(com.conIntencionCompra)}</div></div>
      <div class="card"><div class="lbl">Cotizaciones detectadas</div><div class="big">${fmtNum(com.cotizaciones)}</div></div>
      <div class="card destacada"><div class="lbl">Ventas detectadas</div><div class="big">${fmtNum(com.ventas)}</div><div class="cmp flat">${fmtMoneda(com.montoTotalVentas)}</div></div>
      <div class="card"><div class="lbl">Conversión WhatsApp → Venta</div><div class="big">${com.conversionVenta}%</div></div>
      <div class="card"><div class="lbl">Requieren seguimiento</div><div class="big">${fmtNum(com.requierenSeguimiento)}</div></div>
    `;
  }catch(err){
    $('kpisConversaciones').innerHTML = `<p class="empty-note">Error: ${escapeHtml(err.message)}</p>`;
  }
}

// ================= CONVERSACIONES =================
let convState = { page: 1, pageSize: 25, q: '', filtros: {}, orden: 'fecha_desc', total: 0, totalPaginas: 1 };

function initConversaciones(){
  $('vistaConversaciones').innerHTML = `
    <div class="seccion">
      <div class="seccion-head">
        <div><h2>Conversaciones</h2><div class="sub">Todas las conversaciones de WhatsApp, con filtros y búsqueda global.</div></div>
        <button class="btn-ghost btn-compact" id="btnToggleFiltrosConv" onclick="toggleFiltrosConv()">🔎 Filtros</button>
      </div>
      <div class="buscador-wrap" style="margin-bottom:12px;">
        <span class="icono-buscar">🔍</span>
        <input type="text" id="buscadorConv" placeholder="Buscar por nombre, teléfono, texto, marca, modelo, pedido o ID de conversación...">
      </div>
      <div class="filtros-panel" id="panelFiltrosConv" style="display:none;">
        <div class="campo"><label>Fecha desde</label><input type="date" id="fDesde"></div>
        <div class="campo"><label>Fecha hasta</label><input type="date" id="fHasta"></div>
        <div class="campo"><label>Estado</label><select id="fEstado"><option value="">Todos</option>${WHATSAPP_ESTADOS_OPT()}</select></div>
        <div class="campo"><label>Resultado</label><select id="fResultado"><option value="">Todos</option>${WHATSAPP_RESULTADOS_OPT()}</select></div>
        <div class="campo"><label>Intención</label><select id="fIntencion"><option value="">Todas</option>${WHATSAPP_INTENCIONES_OPT()}</select></div>
        <div class="campo"><label>Producto</label><select id="fProducto"><option value="">Todos</option>${WHATSAPP_CATEGORIAS_OPT()}</select></div>
        <div class="campo"><label>1ª respuesta</label><select id="fRespuesta">
          <option value="">Todas</option>
          <option value="menos1">&lt; 1 min</option><option value="menos5">&lt; 5 min</option>
          <option value="5a10">5-10 min</option><option value="10a30">10-30 min</option>
          <option value="mas30">&gt; 30 min</option><option value="sin_respuesta">Sin respuesta</option>
        </select></div>
        <div class="campo"><label>Prob. de compra</label><select id="fProbabilidad">
          <option value="">Todas</option>
          <option value="0a25">0-25%</option><option value="26a50">26-50%</option>
          <option value="51a75">51-75%</option><option value="76a100">76-100%</option>
        </select></div>
        <div class="campo"><label>Venta</label><select id="fVenta"><option value="">Todas</option><option value="con_venta">Con venta</option><option value="sin_venta">Sin venta</option></select></div>
        <div class="campo"><label>Seguimiento</label><select id="fSeguimiento"><option value="">Todas</option><option value="requiere">Requiere</option><option value="no_requiere">No requiere</option></select></div>
        <div class="campo"><label>Responsable</label><select id="fResponsable">${opcionesResponsable(null, true)}</select></div>
        <div style="display:flex;gap:8px;">
          <button class="btn-primary btn-compact" onclick="aplicarFiltrosConv()">Aplicar</button>
          <button class="btn-ghost btn-compact" onclick="limpiarFiltrosConv()">Limpiar</button>
        </div>
      </div>
      <div class="tabla-wrap">
        <table>
          <thead><tr>
            <th class="ordenable" onclick="ordenarConv('fecha')">Fecha</th>
            <th>Cliente</th><th>Teléfono</th><th>Estado</th><th>Último mensaje</th>
            <th>Intención</th><th>Producto</th><th>Shopify</th>
            <th class="ordenable" onclick="ordenarConv('respuesta')">1ª respuesta</th>
            <th>Prob. compra</th><th>Resultado</th>
            <th class="amount">Venta</th><th>Responsable</th><th>Alertas</th>
          </tr></thead>
          <tbody id="tablaConv"><tr><td colspan="14" class="empty-note">Cargando…</td></tr></tbody>
        </table>
      </div>
      <div id="paginacionConv" style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12.5px;color:var(--muted);"></div>
    </div>
  `;
  $('buscadorConv').addEventListener('input', debounce(() => { convState.q = $('buscadorConv').value.trim(); convState.page = 1; cargarConversaciones(); }, 350));
  cargarConversaciones();
}
function WHATSAPP_ESTADOS_OPT(){ return WHATSAPP_ESTADOS.map(e => `<option value="${e}">${ESTADO_LABEL[e]}</option>`).join(''); }
function WHATSAPP_RESULTADOS_OPT(){ return WHATSAPP_RESULTADOS.map(r => `<option value="${r}">${RESULTADO_LABEL[r]}</option>`).join(''); }
function WHATSAPP_INTENCIONES_OPT(){ return WHATSAPP_INTENCIONES.map(i => `<option value="${i}">${INTENCION_LABEL[i]}</option>`).join(''); }
function WHATSAPP_CATEGORIAS_OPT(){ return WHATSAPP_CATEGORIAS.map(c => `<option value="${c}">${CATEGORIA_LABEL[c]}</option>`).join(''); }

const WHATSAPP_ESTADOS = ['nueva', 'abierta', 'esperando_cliente', 'seguimiento', 'cerrada', 'sin_respuesta'];
const WHATSAPP_RESULTADOS = ['venta', 'cotizacion', 'seguimiento', 'sin_stock', 'cliente_no_responde', 'no_interesado', 'otro'];
const WHATSAPP_INTENCIONES = ['compra', 'consulta', 'postventa', 'servicio_tecnico', 'garantia', 'seguimiento'];
const WHATSAPP_CATEGORIAS = ['pantalla', 'cargador', 'bateria', 'servicio_tecnico', 'repuestos', 'cotizacion', 'compatibilidad', 'garantia', 'estado_pedido', 'postventa', 'otra'];

function toggleFiltrosConv(){
  const panel = $('panelFiltrosConv');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
}
function aplicarFiltrosConv(){
  convState.filtros = {
    desde: $('fDesde').value || undefined, hasta: $('fHasta').value || undefined,
    estado: $('fEstado').value || undefined, resultado: $('fResultado').value || undefined,
    intencion: $('fIntencion').value || undefined, producto: $('fProducto').value || undefined,
    respuesta: $('fRespuesta').value || undefined, probabilidad: $('fProbabilidad').value || undefined,
    venta: $('fVenta').value || undefined, seguimiento: $('fSeguimiento').value || undefined,
    responsableId: $('fResponsable').value || undefined,
  };
  convState.page = 1;
  cargarConversaciones();
}
function limpiarFiltrosConv(){
  ['fDesde','fHasta','fEstado','fResultado','fIntencion','fProducto','fRespuesta','fProbabilidad','fVenta','fSeguimiento','fResponsable'].forEach(id => $(id).value = '');
  convState.filtros = {};
  convState.page = 1;
  cargarConversaciones();
}
function ordenarConv(campo){
  convState.orden = convState.orden === campo + '_desc' ? campo + '_asc' : campo + '_desc';
  renderTablaConv(convState.ultimaData || []);
}
async function cargarConversaciones(){
  const params = new URLSearchParams({ page: convState.page, pageSize: convState.pageSize, q: convState.q });
  for (const [k, v] of Object.entries(convState.filtros)) if (v) params.set(k, v);
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-conversaciones&' + params.toString());
    const data = await res.json();
    if (!res.ok || data.error) { $('tablaConv').innerHTML = `<tr><td colspan="14" class="empty-note">${data.error || 'Error al cargar.'}</td></tr>`; return; }
    convState.total = data.total; convState.totalPaginas = data.totalPaginas; convState.ultimaData = data.conversaciones;
    renderTablaConv(data.conversaciones);
    renderPaginacionConv();
  }catch(err){
    $('tablaConv').innerHTML = `<tr><td colspan="14" class="empty-note">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}
function renderTablaConv(lista){
  if (!lista.length) { $('tablaConv').innerHTML = '<tr><td colspan="14" class="empty-note">No hay conversaciones que calcen con los filtros.</td></tr>'; return; }
  let ordenada = [...lista];
  if (convState.orden === 'fecha_asc') ordenada.sort((a,b) => new Date(a.fecha) - new Date(b.fecha));
  else if (convState.orden === 'fecha_desc') ordenada.sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
  else if (convState.orden === 'respuesta_asc') ordenada.sort((a,b) => (a.primeraRespuestaSegundos ?? Infinity) - (b.primeraRespuestaSegundos ?? Infinity));
  else if (convState.orden === 'respuesta_desc') ordenada.sort((a,b) => (b.primeraRespuestaSegundos ?? -1) - (a.primeraRespuestaSegundos ?? -1));

  $('tablaConv').innerHTML = ordenada.map(c => `
    <tr class="fila-clic" onclick="abrirConversacion(${c.id})">
      <td>${fmtFechaHora(c.fecha)}</td>
      <td>${escapeHtml(c.clienteNombre || 'Sin nombre')}</td>
      <td>${escapeHtml(c.clienteTelefono || '—')}</td>
      <td>${badgeEstado(c.estado)}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.ultimoMensaje || '—')}</td>
      <td>${c.intencion ? (INTENCION_LABEL[c.intencion] || c.intencion) : '—'}</td>
      <td>${productoDisplayHtml(c)}</td>
      <td>${shopifyCellHtml(c)}</td>
      <td>${c.primeraRespuestaSegundos != null ? fmtDuracion(c.primeraRespuestaSegundos) : (c.cantidadMensajes > 0 ? '<span class="badge b-rojo">Sin respuesta</span>' : '—')}</td>
      <td>${semaforoHtml(c.probabilidadCompra)}</td>
      <td>${badgeResultado(c.resultado)}</td>
      <td class="amount">${c.venta ? fmtMoneda(c.montoVenta) : '—'}</td>
      <td>${responsableCellHtml(c)}</td>
      <td>${alertasConversacion(c)}</td>
    </tr>
  `).join('');
}
function renderPaginacionConv(){
  $('paginacionConv').innerHTML = `
    <span>${fmtNum(convState.total)} conversación(es) — página ${convState.page} de ${convState.totalPaginas}</span>
    <span>
      <button class="btn-ghost btn-compact" ${convState.page <= 1 ? 'disabled' : ''} onclick="irPaginaConv(${convState.page - 1})">← Anterior</button>
      <button class="btn-ghost btn-compact" ${convState.page >= convState.totalPaginas ? 'disabled' : ''} onclick="irPaginaConv(${convState.page + 1})">Siguiente →</button>
    </span>
  `;
}
function irPaginaConv(p){ convState.page = p; cargarConversaciones(); }

// ---- Detalle de conversación (modal, punto 11/12/13) ----
async function abrirConversacion(id){
  $('modalConvTitulo').textContent = 'Conversación #' + id;
  $('modalConvBody').innerHTML = '<p class="empty-note">Cargando…</p>';
  $('modalConversacion').classList.add('abierto');
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-conversacion-detalle&id=' + id);
    const data = await res.json();
    if (!res.ok || data.error) { $('modalConvBody').innerHTML = `<p class="empty-note">${data.error || 'No se pudo cargar.'}</p>`; return; }
    renderDetalleConversacion(data);
  }catch(err){
    $('modalConvBody').innerHTML = `<p class="empty-note">Error: ${escapeHtml(err.message)}</p>`;
  }
}
function cerrarModalConversacion(){ $('modalConversacion').classList.remove('abierto'); }

function burbujaMensaje(m){
  const clase = m.direccion === 'in' ? 'in' : 'out';
  let contenido;
  if (m.tipo === 'texto') {
    contenido = escapeHtml(m.texto || '');
  } else if (m.tipo === 'imagen' && m.mediaUrl) {
    const src = '/api/negocio?recurso=whatsapp-media&ref=' + encodeURIComponent(m.mediaUrl);
    contenido = `<img src="${src}" loading="lazy" alt="Imagen" style="max-width:220px;max-height:220px;border-radius:8px;display:block;object-fit:cover;" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tipo-media',textContent:'📎 [imagen no disponible]'}))">`;
  } else {
    contenido = `<span class="tipo-media">📎 [${m.tipo}]${m.texto ? ' — ' + escapeHtml(m.texto) : ''}</span>`;
  }
  return `<div class="burbuja ${clase}">${contenido}<span class="hora">${fmtHora(m.marcaTiempo)}${m.estado ? ' · ' + escapeHtml(m.estado) : ''}</span></div>`;
}

function bsaleMatchHtml(clienteBsale){
  if (!clienteBsale) return '<div class="ficha-fila"><span>Cliente Bsale</span><b class="sub">No identificado</b></div>';
  return `<div class="ficha-fila"><span>Cliente Bsale</span><b><span class="badge b-verde">✓ ${escapeHtml(clienteBsale.nombre)}</span>${clienteBsale.rut ? ' <span class="sub">' + escapeHtml(clienteBsale.rut) + '</span>' : ''}</b></div>`;
}

function renderDetalleConversacion(data){
  const c = data.conversacion, ct = data.contacto, ai = data.analisisIa;
  $('modalConvTitulo').innerHTML = `Conversación con ${escapeHtml(ct?.nombre || 'Sin nombre')} <span class="badge b-gris">#${c.id}</span>`;

  const hilo = data.mensajes.length
    ? data.mensajes.map(burbujaMensaje).join('')
    : '<p class="empty-note">Sin mensajes registrados.</p>';

  const etiquetasHtml = (data.etiquetas || []).map(e => `<span class="etiqueta-chip">${escapeHtml(e)}</span>`).join('') || '<span class="sub">Sin etiquetas</span>';

  const botonAnalizar = `<button class="btn-ghost btn-compact" id="btnAnalizarIA" onclick="analizarConversacionIA(${c.id})">${ai ? '🔄 Volver a analizar' : '🤖 Analizar con IA'}</button>`;
  const analisisHtml = ai ? `
    <div class="ficha-grupo">
      <h3 style="display:flex;justify-content:space-between;align-items:center;">🤖 Análisis IA ${botonAnalizar}</h3>
      <div class="ficha-fila"><span>Resumen</span><b style="text-align:left;max-width:220px;">${escapeHtml(ai.resumen || '—')}</b></div>
      <div class="ficha-fila"><span>Categoría</span><b>${CATEGORIA_LABEL[ai.categoria] || ai.categoria || '—'}</b></div>
      <div class="ficha-fila"><span>Problema del cliente</span><b style="text-align:left;max-width:220px;">${escapeHtml(ai.problemaCliente || '—')}</b></div>
      ${ai.especificaciones ? `<div class="ficha-fila"><span>Especificaciones</span><b style="text-align:left;max-width:220px;">${escapeHtml(ai.especificaciones)}</b></div>` : ''}
      <div class="ficha-fila"><span>Sentimiento</span><b>${escapeHtml(ai.sentimiento || '—')}</b></div>
      <div class="ficha-fila"><span>Calidad de atención</span><b>${ai.calidadAtencionScore != null ? ai.calidadAtencionScore + '/100' : '—'}</b></div>
      <div class="ficha-fila"><span>¿IA sugiere seguimiento?</span><b>${ai.requiereSeguimiento ? 'Sí' : 'No'}</b></div>
      <div class="ficha-fila"><span>Observaciones IA</span><b style="text-align:left;max-width:220px;">${escapeHtml(ai.observaciones || '—')}</b></div>
    </div>
  ` : `<div class="ficha-grupo"><h3 style="display:flex;justify-content:space-between;align-items:center;">🤖 Análisis IA ${botonAnalizar}</h3><p class="sub">Sin análisis todavía.</p></div>`;

  const ventaHtml = c.venta
    ? `<div class="ficha-fila"><span>Venta</span><b>${fmtMoneda(c.montoVenta)}${c.pedidoAsociado ? ' — Pedido ' + escapeHtml(c.pedidoAsociado) : ''}</b></div>`
    : `<div class="ficha-fila"><span>Venta</span><b><button class="btn-ghost btn-compact" onclick="abrirAsociarVenta(${c.id})">Asociar venta</button></b></div>`;

  $('modalConvBody').innerHTML = `
    <div class="detalle-conv">
      <div class="panel-hilo">${hilo}</div>
      <div class="panel-ficha">
        <div class="ficha-grupo">
          <h3>👤 Cliente</h3>
          <div class="ficha-fila"><span>Nombre</span><b>${escapeHtml(ct?.nombre || 'Sin nombre')}</b></div>
          <div class="ficha-fila"><span>Teléfono</span><b>${escapeHtml(ct?.telefono || '—')}</b></div>
          <div class="ficha-fila"><span>Primera conversación</span><b>${fmtFecha(ct?.primeraConversacionEn)}</b></div>
          <div class="ficha-fila"><span>Última conversación</span><b>${fmtFecha(ct?.ultimaConversacionEn)}</b></div>
          <div class="ficha-fila"><span>Total conversaciones</span><b>${fmtNum(ct?.totalConversaciones)}</b></div>
          ${bsaleMatchHtml(data.clienteBsale)}
        </div>
        <div class="ficha-grupo">
          <h3>💬 Conversación actual</h3>
          <div class="ficha-fila"><span>Fecha inicio</span><b>${fmtFechaHora(c.fecha)}</b></div>
          <div class="ficha-fila"><span>Cantidad de mensajes</span><b>${fmtNum(c.cantidadMensajes)}</b></div>
          <div class="ficha-fila"><span>1ª respuesta</span><b>${c.primeraRespuestaSegundos != null ? fmtDuracion(c.primeraRespuestaSegundos) : 'Sin respuesta'}</b></div>
          <div class="ficha-fila"><span>Estado</span><b><select id="editEstado" onchange="guardarCampoConv(${c.id}, 'estado', this.value)">${WHATSAPP_ESTADOS.map(e => `<option value="${e}" ${e===c.estado?'selected':''}>${ESTADO_LABEL[e]}</option>`).join('')}</select></b></div>
          <div class="ficha-fila"><span>Responsable</span><b><select id="editResponsable" onchange="guardarCampoConv(${c.id}, 'responsableId', this.value)">${opcionesResponsable(c.responsableId, false)}</select></b></div>
          ${c.vendedorDetectado ? `<div class="ficha-fila"><span>Vendedor detectado (IA)</span><b>${escapeHtml(c.vendedorDetectado)}${!c.responsableId ? ' <span class="sub">(sin cuenta todavía)</span>' : ''}</b></div>` : ''}
        </div>
        <div class="ficha-grupo">
          <h3>📈 Comercial</h3>
          <div class="ficha-fila"><span>Intención</span><b>${c.intencion ? (INTENCION_LABEL[c.intencion]||c.intencion) : '—'}</b></div>
          <div class="ficha-fila"><span>Producto / marca / modelo</span><b>${productoDisplayHtml(c)}</b></div>
          ${c.shopifyProductoUrl ? `<div class="ficha-fila"><span>Shopify</span><b>${shopifyCellHtml(c)}</b></div>` : ''}
          <div class="ficha-fila"><span>Probabilidad de compra</span><b>${semaforoHtml(c.probabilidadCompra)}</b></div>
          <div class="ficha-fila"><span>Resultado</span><b><select id="editResultado" onchange="guardarCampoConv(${c.id}, 'resultado', this.value)"><option value="">—</option>${WHATSAPP_RESULTADOS.map(r => `<option value="${r}" ${r===c.resultado?'selected':''}>${RESULTADO_LABEL[r]}</option>`).join('')}</select></b></div>
          ${c.motivoPerdida ? `<div class="ficha-fila"><span>Motivo de pérdida</span><b>${MOTIVO_PERDIDA_LABEL[c.motivoPerdida] || escapeHtml(c.motivoPerdida)}</b></div>` : ''}
          ${ventaHtml}
        </div>
        <div class="ficha-grupo">
          <h3>📌 Seguimiento</h3>
          <div class="ficha-fila"><span>Requiere seguimiento</span><b>${c.requiereSeguimiento ? 'Sí' : 'No'}</b></div>
        </div>
        ${analisisHtml}
        <div class="ficha-grupo">
          <h3>🏷️ Etiquetas</h3>
          <div>${etiquetasHtml}</div>
        </div>
        ${data.auditoria && data.auditoria.length ? `
        <div class="ficha-grupo">
          <h3>🕓 Auditoría</h3>
          ${data.auditoria.slice(0,8).map(a => `<div class="ficha-fila"><span>${fmtFechaHora(a.fecha)}</span><b style="text-align:left;max-width:220px;">${escapeHtml(a.detalle)}</b></div>`).join('')}
        </div>` : ''}
      </div>
    </div>
  `;
}
async function guardarCampoConv(id, campo, valor){
  try{
    const body = { id };
    body[campo] = valor;
    const res = await fetch('/api/negocio?recurso=whatsapp-conversaciones', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || 'No se pudo guardar el cambio.'); return; }
    cargarConversaciones();
  }catch(err){ alert('Error: ' + err.message); }
}
function abrirAsociarVenta(conversacionId){
  const monto = prompt('Monto de la venta (CLP):');
  if (!monto || isNaN(Number(monto))) return;
  const pedido = prompt('Número de pedido asociado (opcional):') || null;
  (async () => {
    try{
      const res = await fetch('/api/negocio?recurso=whatsapp-venta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversacionId, monto: Number(monto), pedidoExterno: pedido }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { alert(data.error || 'No se pudo asociar la venta.'); return; }
      abrirConversacion(conversacionId);
      cargarConversaciones();
    }catch(err){ alert('Error: ' + err.message); }
  })();
}

async function analizarConversacionIA(conversacionId){
  const btn = $('btnAnalizarIA');
  if (btn){ btn.disabled = true; btn.textContent = 'Analizando…'; }
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-analizar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversacionId }),
    });
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || 'No se pudo analizar la conversación.'); if (btn){ btn.disabled = false; btn.textContent = '🤖 Analizar con IA'; } return; }
    abrirConversacion(conversacionId);
    cargarConversaciones();
  }catch(err){
    alert('Error: ' + err.message);
    if (btn){ btn.disabled = false; btn.textContent = '🤖 Analizar con IA'; }
  }
}

// ================= SEGUIMIENTOS =================
function initSeguimientos(){
  $('vistaSeguimientos').innerHTML = `
    <div class="seccion">
      <div class="seccion-head">
        <div><h2>Seguimientos</h2><div class="sub">Conversaciones marcadas como "requiere seguimiento".</div></div>
        <select id="fSeguimientoEstado" onchange="cargarSeguimientos()" style="width:180px;">
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option><option value="contactado">Contactado</option>
          <option value="venta">Venta</option><option value="cerrado">Cerrado</option><option value="no_interesado">No interesado</option>
        </select>
      </div>
      <div class="tabla-wrap">
        <table>
          <thead><tr>
            <th>Cliente</th><th>Teléfono</th><th>Producto</th><th>Última conversación</th>
            <th>Motivo</th><th>Prob. compra</th><th>Fecha sugerida</th><th>Responsable</th><th>Estado</th>
          </tr></thead>
          <tbody id="tablaSeguimientos"><tr><td colspan="9" class="empty-note">Cargando…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;
  cargarSeguimientos();
}
async function cargarSeguimientos(){
  const estado = $('fSeguimientoEstado').value;
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-seguimientos' + (estado ? '&estado=' + estado : ''));
    const data = await res.json();
    if (!res.ok || data.error) { $('tablaSeguimientos').innerHTML = `<tr><td colspan="9" class="empty-note">${data.error || 'Error al cargar.'}</td></tr>`; return; }
    if (!data.seguimientos.length) { $('tablaSeguimientos').innerHTML = '<tr><td colspan="9" class="empty-note">No hay seguimientos pendientes.</td></tr>'; return; }
    $('tablaSeguimientos').innerHTML = data.seguimientos.map(s => `
      <tr class="fila-clic" onclick="abrirConversacion(${s.id})">
        <td>${escapeHtml(s.clienteNombre || 'Sin nombre')}</td>
        <td>${escapeHtml(s.clienteTelefono || '—')}</td>
        <td>${escapeHtml(s.marca ? s.marca + (s.modelo ? ' ' + s.modelo : '') : (s.producto ? CATEGORIA_LABEL[s.producto]||s.producto : '—'))}</td>
        <td>${fmtFechaHora(s.fecha)}</td>
        <td>${s.motivoPerdida ? (MOTIVO_PERDIDA_LABEL[s.motivoPerdida]||s.motivoPerdida) : (s.resultado ? RESULTADO_LABEL[s.resultado]||s.resultado : '—')}</td>
        <td>${semaforoHtml(s.probabilidadCompra)}</td>
        <td>${s.seguimientoEn ? fmtFecha(s.seguimientoEn) : '—'}</td>
        <td>${responsableCellHtml(s)}</td>
        <td><span class="badge ${SEGUIMIENTO_ESTADO_BADGE[s.seguimientoEstado] || 'b-gris'}">${SEGUIMIENTO_ESTADO_LABEL[s.seguimientoEstado] || s.seguimientoEstado}</span></td>
      </tr>
    `).join('');
  }catch(err){
    $('tablaSeguimientos').innerHTML = `<tr><td colspan="9" class="empty-note">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ================= CLIENTES =================
let clientesState = { page: 1, pageSize: 25, q: '' };
function initClientes(){
  $('vistaClientes').innerHTML = `
    <div class="seccion">
      <div class="seccion-head"><div><h2>Clientes</h2><div class="sub">Clientes únicos que han escrito por WhatsApp (no conversaciones individuales).</div></div></div>
      <div class="buscador-wrap" style="margin-bottom:12px;"><span class="icono-buscar">🔍</span><input type="text" id="buscadorClientes" placeholder="Buscar por nombre o teléfono..."></div>
      <div class="tabla-wrap">
        <table>
          <thead><tr>
            <th>Cliente</th><th>Teléfono</th><th>1ª conversación</th><th>Última conversación</th>
            <th>Nº conversaciones</th><th>Productos consultados</th><th>Nº ventas</th>
            <th class="amount">Total comprado</th><th>Última intención</th><th>Estado</th>
          </tr></thead>
          <tbody id="tablaClientes"><tr><td colspan="10" class="empty-note">Cargando…</td></tr></tbody>
        </table>
      </div>
      <div id="paginacionClientes" style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12.5px;color:var(--muted);"></div>
    </div>
  `;
  $('buscadorClientes').addEventListener('input', debounce(() => { clientesState.q = $('buscadorClientes').value.trim(); clientesState.page = 1; cargarClientes(); }, 350));
  cargarClientes();
}
async function cargarClientes(){
  const params = new URLSearchParams({ page: clientesState.page, pageSize: clientesState.pageSize, q: clientesState.q });
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-clientes&' + params.toString());
    const data = await res.json();
    if (!res.ok || data.error) { $('tablaClientes').innerHTML = `<tr><td colspan="10" class="empty-note">${data.error || 'Error al cargar.'}</td></tr>`; return; }
    if (!data.clientes.length) { $('tablaClientes').innerHTML = '<tr><td colspan="10" class="empty-note">No hay clientes que calcen con la búsqueda.</td></tr>'; return; }
    $('tablaClientes').innerHTML = data.clientes.map(c => `
      <tr class="fila-clic" onclick="abrirCliente(${c.id})">
        <td>${escapeHtml(c.nombre || 'Sin nombre')}${c.bsaleClienteId ? ' <span class="badge b-verde" title="Cliente Bsale: ' + escapeHtml(c.bsaleClienteNombre) + '">✓ Bsale</span>' : ''}</td>
        <td>${escapeHtml(c.telefono || '—')}</td>
        <td>${fmtFecha(c.primeraConversacion)}</td>
        <td>${fmtFecha(c.ultimaConversacion)}</td>
        <td>${fmtNum(c.numConversaciones)}${c.numConversaciones > 2 ? ' <span class="badge b-azul">Recurrente</span>' : ''}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml((c.productosConsultados||[]).map(p => CATEGORIA_LABEL[p]||p).join(', ') || '—')}</td>
        <td>${fmtNum(c.numVentas)}${c.numVentas > 1 ? ' <span class="badge b-verde">Recompra</span>' : ''}</td>
        <td class="amount">${fmtMoneda(c.totalComprado)}</td>
        <td>${c.ultimaIntencion ? (INTENCION_LABEL[c.ultimaIntencion]||c.ultimaIntencion) : '—'}</td>
        <td>${badgeEstado(c.estado)}</td>
      </tr>
    `).join('');
    $('paginacionClientes').innerHTML = `
      <span>${fmtNum(data.total)} cliente(s) — página ${data.page} de ${data.totalPaginas}</span>
      <span>
        <button class="btn-ghost btn-compact" ${data.page <= 1 ? 'disabled' : ''} onclick="irPaginaClientes(${data.page - 1})">← Anterior</button>
        <button class="btn-ghost btn-compact" ${data.page >= data.totalPaginas ? 'disabled' : ''} onclick="irPaginaClientes(${data.page + 1})">Siguiente →</button>
      </span>
    `;
  }catch(err){
    $('tablaClientes').innerHTML = `<tr><td colspan="10" class="empty-note">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}
function irPaginaClientes(p){ clientesState.page = p; cargarClientes(); }

async function abrirCliente(id){
  $('modalClienteTitulo').textContent = 'Cliente';
  $('modalClienteBody').innerHTML = '<p class="empty-note">Cargando…</p>';
  $('modalCliente').classList.add('abierto');
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-cliente-detalle&id=' + id);
    const data = await res.json();
    if (!res.ok || data.error) { $('modalClienteBody').innerHTML = `<p class="empty-note">${data.error || 'No se pudo cargar.'}</p>`; return; }
    const cl = data.cliente;
    $('modalClienteTitulo').textContent = cl.nombre || 'Sin nombre';
    $('modalClienteBody').innerHTML = `
      <div class="ficha-grupo">
        <div class="ficha-fila"><span>Teléfono</span><b>${escapeHtml(cl.telefono || '—')}</b></div>
        <div class="ficha-fila"><span>Primera conversación</span><b>${fmtFecha(cl.primeraConversacion)}</b></div>
        <div class="ficha-fila"><span>Última conversación</span><b>${fmtFecha(cl.ultimaConversacion)}</b></div>
        <div class="ficha-fila"><span>Total conversaciones</span><b>${fmtNum(cl.totalConversaciones)}</b></div>
        ${bsaleMatchHtml(data.clienteBsale)}
      </div>
      <h3 style="font-family:'Space Grotesk',sans-serif;font-size:12px;text-transform:uppercase;color:var(--muted);margin:16px 0 8px;">Historial de conversaciones</h3>
      <div class="tabla-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Estado</th><th>Producto</th><th>Resultado</th><th class="amount">Venta</th></tr></thead>
          <tbody>
            ${data.conversaciones.map(c => `
              <tr class="fila-clic" onclick="cerrarModalCliente(); abrirConversacion(${c.id});">
                <td>${fmtFechaHora(c.fecha)}</td><td>${badgeEstado(c.estado)}</td>
                <td>${productoDisplayHtml(c)}</td>
                <td>${badgeResultado(c.resultado)}</td><td class="amount">${c.venta ? fmtMoneda(c.montoVenta) : '—'}</td>
              </tr>
            `).join('') || '<tr><td colspan="5" class="empty-note">Sin conversaciones.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }catch(err){
    $('modalClienteBody').innerHTML = `<p class="empty-note">Error: ${escapeHtml(err.message)}</p>`;
  }
}
function cerrarModalCliente(){ $('modalCliente').classList.remove('abierto'); }

// ================= ANALÍTICA =================
function initAnalitica(){
  $('vistaAnalitica').innerHTML = `
    <div class="seccion">
      <div class="seccion-head">
        <div><h2>Evolución temporal</h2><div class="sub">Conversaciones, clientes únicos y ventas.</div></div>
        <div style="display:flex;gap:6px;">
          <button class="btn-ghost btn-compact activo" data-rango="7d" onclick="cambiarRangoAnalitica('7d')">7 días</button>
          <button class="btn-ghost btn-compact" data-rango="30d" onclick="cambiarRangoAnalitica('30d')">30 días</button>
          <button class="btn-ghost btn-compact" data-rango="90d" onclick="cambiarRangoAnalitica('90d')">90 días</button>
          <button class="btn-ghost btn-compact" data-rango="anio" onclick="cambiarRangoAnalitica('anio')">Año</button>
        </div>
      </div>
      <div id="chartSerie"></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;">
      <div class="seccion">
        <h2>Categorías consultadas</h2>
        <div id="chartCategorias" style="margin-top:12px;"></div>
      </div>
      <div class="seccion">
        <h2>Embudo de conversión</h2>
        <div id="chartEmbudo" style="margin-top:12px;"></div>
      </div>
    </div>
    <div class="seccion">
      <h2>Motivos de pérdida</h2>
      <div class="sub" style="margin-bottom:10px;">Haz clic en un motivo para ver esas conversaciones.</div>
      <div class="tabla-wrap"><table>
        <thead><tr><th>Motivo</th><th>Cantidad</th><th>%</th></tr></thead>
        <tbody id="tablaMotivos"></tbody>
      </table></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;">
      <div class="seccion"><h2>Ranking de productos</h2><div class="tabla-wrap"><table>
        <thead><tr><th>Producto</th><th>Consultas</th><th>Ventas</th><th>Conv.</th></tr></thead>
        <tbody id="tablaProductos"></tbody>
      </table></div></div>
      <div class="seccion"><h2>Marcas más consultadas</h2><div id="rankMarcas"></div></div>
      <div class="seccion"><h2>Modelos más consultados</h2><div id="rankModelos"></div></div>
    </div>
    <div class="seccion">
      <h2>Resultados de conversaciones</h2>
      <div id="chartResultados" style="margin-top:12px;"></div>
    </div>
  `;
  cargarAnalitica('30d');
}
function cambiarRangoAnalitica(rango){
  document.querySelectorAll('[data-rango]').forEach(b => b.classList.toggle('activo', b.dataset.rango === rango));
  cargarAnalitica(rango);
}
async function cargarAnalitica(rango){
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-analitica&rango=' + rango);
    const data = await res.json();
    if (!res.ok || data.error) { $('chartSerie').innerHTML = `<p class="empty-note">${data.error || 'Error al cargar.'}</p>`; return; }
    renderChartSerie(data.serie, data.agrupacion);
    renderChartCategorias(data.distribucionCategoria);
    renderChartEmbudo(data.embudo);
    renderTablaMotivos(data.motivosPerdida);
    renderTablaProductos(data.rankingProductos);
    renderRanking('rankMarcas', data.rankingMarcas, 'marca');
    renderRanking('rankModelos', data.rankingModelos, 'modelo');
    renderChartResultados(data.resultados);
  }catch(err){
    $('chartSerie').innerHTML = `<p class="empty-note">Error: ${escapeHtml(err.message)}</p>`;
  }
}
function labelBucket(fecha, agrupacion){
  const d = new Date(fecha);
  if (agrupacion === 'day') return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
  if (agrupacion === 'week') return 'sem. ' + d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
  return d.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' });
}
function renderChartSerie(serie, agrupacion){
  if (!serie.length) { $('chartSerie').innerHTML = '<p class="empty-note">Sin datos en este período.</p>'; return; }
  const max = Math.max(1, ...serie.map(s => s.conversaciones));
  $('chartSerie').innerHTML = `
    <div class="barra-chart">
      ${serie.map(s => `
        <div class="col" title="${s.conversaciones} conversaciones, ${s.clientesUnicos} clientes, ${s.ventas} ventas">
          <div style="font-size:9px;color:var(--muted);">${s.conversaciones}</div>
          <div class="bar" style="height:${Math.max(2, (s.conversaciones/max)*90)}px;"></div>
          <div class="lbl-x">${labelBucket(s.fecha, agrupacion)}</div>
        </div>
      `).join('')}
    </div>
    <div class="sub" style="margin-top:8px;">Total: ${fmtNum(serie.reduce((a,s)=>a+s.conversaciones,0))} conversaciones · ${fmtNum(serie.reduce((a,s)=>a+s.ventas,0))} ventas</div>
  `;
}
function renderChartCategorias(dist){
  if (!dist.length) { $('chartCategorias').innerHTML = '<p class="empty-note">Sin datos.</p>'; return; }
  const max = Math.max(1, ...dist.map(d => d.cantidad));
  $('chartCategorias').innerHTML = dist.map(d => `
    <div class="barra-horizontal">
      <div class="nombre">${CATEGORIA_LABEL[d.categoria] || d.categoria}</div>
      <div class="pista"><div class="relleno" style="width:${(d.cantidad/max)*100}%;"></div></div>
      <div class="valor">${fmtNum(d.cantidad)}</div>
    </div>
  `).join('');
}
function renderChartEmbudo(e){
  const pasos = [
    { l: 'Conversaciones', v: e.conversaciones },
    { l: 'Intención de compra', v: e.intencion_compra },
    { l: 'Cotización', v: e.cotizacion },
    { l: 'Venta', v: e.venta },
  ];
  $('chartEmbudo').innerHTML = `<div class="embudo">${pasos.map((p,i) => `
    <div class="paso"><span>${p.l}</span><b>${fmtNum(p.v)}</b></div>
    ${i < pasos.length - 1 ? `<div class="flecha">↓ ${pasos[i].v > 0 ? Math.round((pasos[i+1].v/pasos[i].v)*100) : 0}%</div>` : ''}
  `).join('')}</div>`;
}
function renderTablaMotivos(motivos){
  if (!motivos.length) { $('tablaMotivos').innerHTML = '<tr><td colspan="3" class="empty-note">Sin conversaciones perdidas en este período.</td></tr>'; return; }
  $('tablaMotivos').innerHTML = motivos.map(m => `
    <tr class="fila-clic" onclick="irAConversacionesConMotivo('${escapeHtml(m.motivo)}')">
      <td>${escapeHtml(m.etiqueta)}</td><td>${fmtNum(m.cantidad)}</td><td>${m.porcentaje}%</td>
    </tr>
  `).join('');
}
function irAConversacionesConMotivo(motivo){
  cambiarVistaModulo('conversaciones');
  if (!vistasCargadas.has('conversaciones')) return;
  $('panelFiltrosConv').style.display = 'flex';
  $('buscadorConv').value = '';
  convState.q = ''; convState.page = 1;
  cargarConversaciones();
}
function renderTablaProductos(prods){
  if (!prods.length) { $('tablaProductos').innerHTML = '<tr><td colspan="4" class="empty-note">Sin datos.</td></tr>'; return; }
  $('tablaProductos').innerHTML = prods.map(p => `
    <tr><td>${escapeHtml(p.producto)}</td><td>${fmtNum(p.consultas)}</td><td>${fmtNum(p.ventas)}</td><td>${p.conversion}%</td></tr>
  `).join('');
}
function renderRanking(elId, lista, campo){
  if (!lista.length) { $(elId).innerHTML = '<p class="empty-note">Sin datos.</p>'; return; }
  const max = Math.max(1, ...lista.map(l => l.consultas));
  $(elId).innerHTML = lista.map(l => `
    <div class="barra-horizontal">
      <div class="nombre">${escapeHtml(l[campo] || '—')}</div>
      <div class="pista"><div class="relleno" style="width:${(l.consultas/max)*100}%;"></div></div>
      <div class="valor">${fmtNum(l.consultas)}</div>
    </div>
  `).join('');
}
function renderChartResultados(resultados){
  if (!resultados.length) { $('chartResultados').innerHTML = '<p class="empty-note">Sin datos.</p>'; return; }
  const max = Math.max(1, ...resultados.map(r => r.cantidad));
  $('chartResultados').innerHTML = resultados.map(r => `
    <div class="barra-horizontal">
      <div class="nombre">${RESULTADO_LABEL[r.resultado] || r.resultado}</div>
      <div class="pista"><div class="relleno" style="width:${(r.cantidad/max)*100}%;"></div></div>
      <div class="valor">${fmtNum(r.cantidad)}</div>
    </div>
  `).join('');
}

// ================= Análisis IA en lote (admin) =================
// El disparo automático (webhook) solo corre para mensajes NUEVOS -- las
// conversaciones que ya existían antes de activarlo se quedan sin
// analizar para siempre a menos que se corra esto una vez.
async function analizarPendientesIA(){
  if (!confirm('¿Analizar con IA todas las conversaciones que todavía no tienen análisis? Puede tardar varios minutos si hay muchas, y cada conversación tiene un costo pequeño en la API de Claude.')) return;
  const btn = $('btnAnalizarPendientes');
  btn.disabled = true;
  let totalAnalizadas = 0, totalErrores = 0;
  try{
    let completo = false;
    while (!completo) {
      btn.textContent = totalAnalizadas > 0 ? `🤖 Analizando… (${totalAnalizadas} listas)` : '🤖 Analizando…';
      const res = await fetch('/api/negocio?recurso=whatsapp-analizar-pendientes', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) { alert(data.error || 'No se pudo analizar las conversaciones pendientes.'); break; }
      totalAnalizadas += data.analizadas; totalErrores += data.errores;
      completo = data.completo;
      if (data.analizadas === 0 && !completo) break; // nada avanzó, evita loop infinito
    }
    alert(`Análisis en lote terminado: ${totalAnalizadas} conversaciones analizadas${totalErrores ? `, ${totalErrores} con error` : ''}.`);
    vistasCargadas.clear();
    const vistaActiva = document.querySelector('.tab-modulo.activo').dataset.vista;
    cambiarVistaModulo(vistaActiva);
  }catch(err){ alert('Error: ' + err.message); }
  finally{ btn.disabled = false; btn.textContent = '🤖 Analizar pendientes'; }
}

// ================= Datos demo (admin, punto 37) =================
async function generarDatosDemo(){
  if (!confirm('¿Generar datos demo (contactos, conversaciones y mensajes de prueba)? Podrás borrarlos después con un solo clic.')) return;
  $('btnDemoSeed').disabled = true;
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-demo-seed', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || 'No se pudo generar los datos demo.'); return; }
    alert(`Datos demo generados: ${data.contactos} clientes, ${data.conversaciones} conversaciones, ${data.mensajes} mensajes.`);
    vistasCargadas.clear();
    const vistaActiva = document.querySelector('.tab-modulo.activo').dataset.vista;
    cambiarVistaModulo(vistaActiva);
  }catch(err){ alert('Error: ' + err.message); }
  finally{ $('btnDemoSeed').disabled = false; }
}
async function borrarDatosDemo(){
  if (!confirm('¿Borrar todos los datos demo de WhatsApp? Esta acción no se puede deshacer (los datos reales que hayan llegado por el webhook no se ven afectados).')) return;
  $('btnDemoClear').disabled = true;
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-demo-clear', { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || 'No se pudo borrar los datos demo.'); return; }
    alert('Datos demo borrados.');
    vistasCargadas.clear();
    const vistaActiva = document.querySelector('.tab-modulo.activo').dataset.vista;
    cambiarVistaModulo(vistaActiva);
  }catch(err){ alert('Error: ' + err.message); }
  finally{ $('btnDemoClear').disabled = false; }
}

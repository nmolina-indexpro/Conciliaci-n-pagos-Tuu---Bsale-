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
  cliente_no_responde: 'Cliente dejó de responder', no_interesado: 'No interesado', consulta_resuelta: 'Consulta resuelta', otro: 'Otro',
};
const INTENCION_LABEL = {
  compra: 'Compra', consulta: 'Consulta', postventa: 'Postventa',
  servicio_tecnico: 'Servicio técnico', garantia: 'Garantía', seguimiento: 'Seguimiento',
};
const CATEGORIA_LABEL = {
  pantalla: 'Pantallas notebook', cargador: 'Cargadores', bateria: 'Baterías',
  servicio_tecnico: 'Servicio técnico', repuestos: 'Repuestos', cotizacion: 'Cotización',
  compatibilidad: 'Compatibilidad', garantia: 'Garantía', estado_pedido: 'Estado de pedido',
  postventa: 'Postventa', otra: 'Otra (la IA no la clasificó)', sin_categoria: 'Sin categorizar (sin análisis IA)',
};
const MOTIVO_PERDIDA_LABEL = {
  cliente_no_responde: 'Cliente dejó de responder', sin_stock: 'Sin stock', precio: 'Precio',
  respuesta_lenta: 'Respuesta demasiado lenta', producto_incompatible: 'Producto incompatible',
  producto_no_disponible: 'Producto/marca que no vendemos',
  sin_seguimiento: 'No se realizó seguimiento', compro_en_otro_lugar: 'Compró en la competencia', otro: 'Otro',
};
// Recomendación fija por motivo (pedido del usuario) -- pensada para el
// negocio real de IndexStore (venta de repuestos/accesorios de notebook por
// WhatsApp). "venta" y "no_interesado" no son motivos reales de
// motivo_perdida -- son valores de "resultado" que se cuelan en esta tabla
// porque el query los usa como comodín cuando falta el motivo específico
// (ver conversación con el usuario sobre el bug de manejarWhatsappAnalitica);
// quedan con su propia recomendación mientras no se corrija ese filtro.
const MOTIVO_PERDIDA_RECOMENDACION = {
  cliente_no_responde: 'Enviar un mensaje de reenganche a las 24-48h (pregunta simple o una oferta puntual) en vez de dejar la conversación morir sola.',
  sin_stock: 'Cruzar estos SKU con Alertas de Stock para priorizar reposición si son de alta demanda, y ofrecer una alternativa compatible en el momento en vez de solo decir "no hay".',
  precio: 'Revisar si hay margen para un descuento puntual en los productos que más se repiten acá, o reforzar el argumento de valor (garantía, original vs. alternativo) frente a la competencia.',
  respuesta_lenta: 'Revisar carga de vendedores en los horarios con más consultas y reforzar dotación ahí -- ver "Tiempo prom. 1ª respuesta" del dashboard para confirmar si coincide con un horario puntual.',
  producto_incompatible: 'Reforzar el uso de "Modelos de Notebook" (compatibilidad) ANTES de cotizar, para no ofrecer un repuesto que no calza con el equipo del cliente.',
  producto_no_disponible: 'Revisar estas conversaciones para detectar marcas/productos que piden seguido y hoy no se venden, y evaluar si conviene sumarlos al catálogo -- mientras tanto, seguir derivando a Aliexpress/Mercado Libre para no dejar al cliente sin alternativa.',
  sin_seguimiento: 'Activar un recordatorio automático para cotizaciones sin respuesta después de X días, y asignar responsable explícito a cada conversación para que no quede sin dueño.',
  compro_en_otro_lugar: 'Revisar precio y tiempo de respuesta de estas conversaciones puntuales para identificar si fue velocidad o precio lo que decidió la venta de la competencia.',
  otro: 'Es la categoría más grande -- vale la pena revisar estas conversaciones a mano, probablemente esconden un motivo recurrente que todavía no está en la lista.',
  venta: 'No es una pérdida real: la IA detectó que terminó en venta pero nadie la confirmó con el botón "Asociar venta". Revisar y asociarlas para que no sigan contando como pérdida.',
  no_interesado: 'Falta completar el motivo específico de pérdida en estas conversaciones (quedó solo el resultado general) -- revisar y clasificar a mano.',
};
const SEGUIMIENTO_ESTADO_LABEL = { pendiente: 'Pendiente', contactado: 'Contactado', venta: 'Venta', cerrado: 'Cerrado', no_interesado: 'No interesado' };
const SEGUIMIENTO_ESTADO_BADGE = { pendiente: 'b-ambar', contactado: 'b-azul', venta: 'b-verde', cerrado: 'b-gris', no_interesado: 'b-rojo' };

// ================= Rediseño bandeja: estado de atención / resultado =================
// Pedido del usuario: separar "estado de atención" (4 valores: Pendiente,
// En atención, Esperando al cliente, Resuelta) de "resultado comercial" (5
// valores) -- calculados a partir de DATOS REALES (último mensaje,
// primera_respuesta_segundos) en vez de depender del enum "estado" de
// whatsapp_conversaciones, que tiene 6 valores históricos ('seguimiento' y
// 'sin_respuesta' se solapan en significado con lo de acá) y puede quedar
// desactualizado si nadie lo toca a mano. No se migra ni se reescribe ese
// enum (dato histórico intacto) -- esto es solo una capa de
// visualización que nunca vuelve a escribir 'seguimiento'/'sin_respuesta'
// como estado nuevo (ver WHATSAPP_ESTADOS_ATENCION_EDITABLES más abajo).
const INTENCIONES_NO_COMERCIALES = ['postventa', 'servicio_tecnico', 'garantia'];
function esConversacionComercial(c){
  if (c.intencion) return !INTENCIONES_NO_COMERCIALES.includes(c.intencion);
  return true; // todavía sin intención detectada -- se trata como comercial hasta saber más
}
// Solo estos 4 valores se pueden ELEGIR desde la bandeja nueva (el select
// de "Estado" sigue aceptando los 6 de siempre por compatibilidad con
// datos viejos, pero un cambio manual desde acá nunca vuelve a escribir
// 'seguimiento' ni 'sin_respuesta' -- esos quedan como quedaron, sin
// reclasificar nada existente).
const WHATSAPP_ESTADOS_ATENCION_EDITABLES = ['nueva', 'abierta', 'esperando_cliente', 'cerrada'];
function estadoAtencionInfo(c){
  if (c.estado === 'cerrada') return { clave: 'resuelta', label: 'Resuelta', badge: 'b-gris' };
  if (!c.cantidadMensajes) return { clave: 'pendiente', label: 'Pendiente', badge: 'b-ambar' };
  if (c.primeraRespuestaSegundos == null) {
    // Nunca se respondió -- "Pendiente" (accionable) solo mientras siga
    // abierta la ventana de 24h de WhatsApp (mismo corte que
    // condicionPendienteSQL en el backend, para que el badge de cada fila
    // coincida con los contadores de arriba). Pasado eso, ya no se puede
    // responder con texto libre -- queda "Vencida", no desaparece ni se
    // cuenta como tarea del día.
    const dentroDeVentana = c.ultimoMensajeEn && (Date.now() - new Date(c.ultimoMensajeEn).getTime()) < 24 * 3600000;
    return dentroDeVentana
      ? { clave: 'pendiente', label: 'Pendiente', badge: 'b-ambar' }
      : { clave: 'vencida', label: 'Vencida sin responder', badge: 'b-rojo' };
  }
  if (c.ultimoMensajeDireccion === 'out') return { clave: 'esperando_cliente', label: 'Esperando al cliente', badge: 'b-azul' };
  return { clave: 'en_atencion', label: 'En atención', badge: 'b-verde' };
}
// "Venta" de resultado solo cuenta como confirmada si hay una venta
// REALMENTE asociada (c.venta, botón "Confirmar/Asociar venta") -- si la
// IA clasificó resultado='venta' pero nadie la confirmó todavía, se
// muestra como "En seguimiento" (pendiente de confirmar), nunca como
// "Venta confirmada" ni como "Venta perdida".
function resultadoComercialInfo(c){
  if (!esConversacionComercial(c)) return { clave: 'no_aplica', label: 'No aplica', badge: 'b-gris' };
  if (c.venta) return { clave: 'venta_confirmada', label: 'Venta confirmada', badge: 'b-verde' };
  if (!c.resultado) return { clave: 'sin_definir', label: 'Sin definir', badge: 'b-gris' };
  if (c.resultado === 'cotizacion' || c.resultado === 'seguimiento') return { clave: 'en_seguimiento', label: 'En seguimiento', badge: 'b-azul' };
  if (c.resultado === 'venta') return { clave: 'en_seguimiento', label: 'Venta sin confirmar', badge: 'b-azul' };
  return { clave: 'venta_perdida', label: 'Venta perdida', badge: 'b-rojo' };
}
// Probabilidad: "No aplica" en postventa/servicio técnico/garantía (no
// "0%"), "Por confirmar" si es comercial pero la IA nunca la calculó
// (nunca un porcentaje inventado), y siempre marcada como estimación de
// IA -- no existe en este sistema una probabilidad "confirmada" a mano.
function probabilidadDisplayHtml(c){
  if (!esConversacionComercial(c)) return '<span class="badge b-gris">No aplica</span>';
  if (c.probabilidadCompra == null) return '<span class="badge b-gris">Por confirmar</span>';
  return semaforoHtml(c.probabilidadCompra) + ' <span class="sub" style="font-size:10px;">estimación IA</span>';
}
// Origen de un campo "de trabajo" (intención/producto/marca/modelo/
// resultado/motivo de pérdida): si una persona ya lo editó a mano queda en
// campos_editados_manualmente (ver api/negocio.js) y la IA nunca lo vuelve
// a tocar -- si no, sigue siendo una sugerencia de IA sin validar.
function origenCampoLabel(c, campoSnake){
  return (c.camposEditadosManualmente || []).includes(campoSnake) ? '👤 agente' : '✨ IA · sin validar';
}
function fmtMinutos(min){
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
// Alerta principal de una conversación (una sola, la más relevante) -- a
// partir de datos reales (último mensaje real, fecha de seguimiento), no
// de un enum que pueda quedar desactualizado. Nunca marca "pendiente de
// respuesta del agente" una conversación donde el último mensaje es
// nuestro (esperando al cliente) -- justo la regla que pidió el usuario.
function alertaPrincipalInfo(c){
  const info = estadoAtencionInfo(c);
  if (info.clave === 'vencida') {
    const horas = c.ultimoMensajeEn ? Math.round((Date.now() - new Date(c.ultimoMensajeEn).getTime()) / 3600000) : null;
    return { texto: `Sin responder hace ${horas != null ? horas + 'h' : 'más de 24h'} — ventana de WhatsApp cerrada`, clase: 'critica', icono: '⚠️' };
  }
  if (info.clave === 'pendiente' && c.cantidadMensajes > 0) {
    const minutos = c.ultimoMensajeEn ? Math.round((Date.now() - new Date(c.ultimoMensajeEn).getTime()) / 60000) : null;
    return { texto: `Pendiente de primera respuesta${minutos != null ? ' · ' + fmtMinutos(Math.max(0,minutos)) : ''}`, clase: 'critica', icono: '⛔' };
  }
  if (info.clave === 'en_atencion') {
    const minutos = c.ultimoMensajeEn ? Math.round((Date.now() - new Date(c.ultimoMensajeEn).getTime()) / 60000) : null;
    if (minutos != null && minutos > 30) return { texto: `Esperando respuesta hace ${fmtMinutos(minutos)}`, clase: 'demorada', icono: '🟠' };
  }
  if (c.requiereSeguimiento && c.seguimientoEn) {
    const hoyStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    const segStr = String(c.seguimientoEn).slice(0, 10);
    if (segStr <= hoyStr) return { texto: `Seguimiento ${segStr === hoyStr ? 'para hoy' : 'vencido'}`, clase: 'seguimiento', icono: '📌' };
  }
  if (!c.responsableId && !c.vendedorDetectado) return { texto: 'Sin asignar', clase: 'seguimiento', icono: '👤' };
  return null;
}
function alertaPrincipalHtml(c){
  const a = alertaPrincipalInfo(c);
  return a ? `<span class="alerta-chip ${a.clase}">${a.icono} ${escapeHtml(a.texto)}</span>` : '<span class="sub">—</span>';
}

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
  // La confianza es una heurística (qué tan específica fue la búsqueda
  // que encontró el producto), no una probabilidad real -- se muestra
  // igual para que quien lo use sepa cuándo conviene confirmar a mano.
  const conf = c.shopifyProductoConfianza;
  const etiquetaConf = conf == null ? '' : conf >= 85 ? ' (alta confianza)' : conf >= 65 ? ` (${conf}% aprox.)` : ` (${conf}% — revisar)`;
  const tooltip = `${c.shopifyProductoTitulo || ''}${conf != null ? ` — confianza aprox. ${conf}%` : ''}`;
  return `<a href="${escapeHtml(c.shopifyProductoUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" title="${escapeHtml(tooltip)}" class="btn-ghost btn-compact" style="text-decoration:none;white-space:nowrap;">🛒 Ver${escapeHtml(etiquetaConf)}</a>`;
}
// Venta confirmada a mano (prioridad) o, si no hay, sugerencia detectada
// automáticamente por teléfono contra Bsale (ver buscarVentaBsalePorTelefono)
// -- se distingue con "🧾 sugerido" para que quede claro que no es una
// confirmación humana, solo una pista para revisar.
function ventaCellHtml(c){
  if (c.venta) return fmtMoneda(c.montoVenta);
  if (c.bsaleDocumentoNumero) {
    const tooltip = `Detectado automáticamente por teléfono — ${c.bsaleDocumentoTipo || 'documento'} ${c.bsaleDocumentoNumero}${c.bsaleDocumentoFecha ? ', ' + fmtFecha(c.bsaleDocumentoFecha) : ''}. No es una confirmación manual.`;
    const contenido = `🧾 ${fmtMoneda(c.bsaleDocumentoMonto)} <span class="sub">(sugerido)</span>`;
    return c.bsaleDocumentoUrl
      ? `<a href="${escapeHtml(c.bsaleDocumentoUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation();" title="${escapeHtml(tooltip)}" style="text-decoration:none;color:inherit;">${contenido}</a>`
      : `<span title="${escapeHtml(tooltip)}">${contenido}</span>`;
  }
  return '—';
}
function debounce(fn, ms){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
// Origen de la conversación: anuncio pagado de Meta (referral) o un link
// con UTM que el cliente pegó en el chat (ver extraerUtmDeTexto) -- dos
// fuentes distintas, mismo juego de campos (fuenteTipo/Titulo/Url/Id).
function fuenteInfo(c){
  if (!c.fuenteTipo) return { icono: '❓', texto: 'Origen desconocido', esSub: true };
  if (c.fuenteTipo === 'boton_sitio') return { icono: '📎', texto: `Botón WhatsApp del sitio (sin campaña)${c.fuenteTitulo ? ' — ' + c.fuenteTitulo : ''}`, esSub: false };
  if (c.fuenteTipo === 'utm') {
    const esGoogle = (c.fuenteUtmSource || '').toLowerCase().includes('google');
    return { icono: esGoogle ? '🔍' : '🔗', texto: `${esGoogle ? 'Google Ads' : 'Link con UTM'}${c.fuenteTitulo ? ' — ' + c.fuenteTitulo : ''}`, esSub: false };
  }
  return { icono: '📢', texto: `Anuncio${c.fuenteTitulo ? ' — ' + c.fuenteTitulo : ''}`, esSub: false };
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
  const clase = (resultado === 'venta' || resultado === 'consulta_resuelta') ? 'b-verde' : (resultado === 'cotizacion' || resultado === 'seguimiento') ? 'b-azul' : 'b-rojo';
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
    $('userBox').innerHTML = `<span>Hola, <b>${escapeHtml(u.nombre || u.email)}</b></span>`;
    if (typeof aplicarRestriccionesUsuario === 'function') aplicarRestriccionesUsuario(u.rol);
    if (typeof aplicarRestriccionPaginas === 'function') aplicarRestriccionPaginas(u.paginas);
    if(u.rol === 'admin'){
      const nav = $('navUsuarios');
      if (nav) nav.style.display = '';
      $('accionesDemo').style.display = '';
    }
    cargarUsuariosActivos();
    // Vínculo real desde Cotizaciones y ventas (coincidencia de teléfono) --
    // ?abrirConversacion=123 abre directo la bandeja en esa conversación en
    // vez del Dashboard por defecto.
    const idDesdeUrl = new URLSearchParams(location.search).get('abrirConversacion');
    if (idDesdeUrl) {
      cambiarVistaModulo('conversaciones');
      seleccionarConversacionBandeja(Number(idDesdeUrl));
    } else {
      cambiarVistaModulo('conversaciones'); // la página abre en la bandeja de conversaciones
    }
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

// Teléfono como enlace al chat de WhatsApp (se abre en otra pestaña). Chile: un número de 9 dígitos se completa con el 56.
function enlaceWhatsappTelefono(telefono){
  const texto = String(telefono || '').trim();
  if(!texto) return '—';
  let d = texto.replace(/\D/g, '');
  if(d.length < 8) return escapeHtml(texto);
  if(d.length === 9) d = '56' + d;
  return `<a href="https://wa.me/${d}" target="_blank" rel="noopener noreferrer" title="Abrir el chat en WhatsApp" onclick="event.stopPropagation()">${escapeHtml(texto)} ↗</a>`;
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
    if (vista === 'clientes') initClientes();
    if (vista === 'analitica') initAnalitica();
  }
}

// ================= DASHBOARD =================
// Fechas del dashboard en hora de Chile (el servidor corta los días igual).
function hoyChileDash(){ return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); }
function addDiasDash(dateStr, dias){
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}
function fmtNum1(n){ return Number(n || 0).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function initDashboard(){
  $('vistaDashboard').innerHTML = `
    <div class="seccion">
      <div class="seccion-head"><div><h2>Resumen general</h2><div class="sub" id="dashSubtitulo">Comparado con el período anterior de igual duración.</div></div></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;" class="dash-filtros">
        <div class="date-field"><label for="dashDesde">Desde</label><input type="date" id="dashDesde" onchange="dashCambioManual()"></div>
        <div class="date-field"><label for="dashHasta">Hasta</label><input type="date" id="dashHasta" onchange="dashCambioManual()"></div>
        <button class="btn-ghost btn-compact" data-dash-rango="hoy" onclick="setRangoRapidoDash('hoy')">Hoy</button>
        <button class="btn-ghost btn-compact" data-dash-rango="semana" onclick="setRangoRapidoDash('semana')">Semana</button>
        <button class="btn-ghost btn-compact" data-dash-rango="mes" onclick="setRangoRapidoDash('mes')">Mes actual</button>
        <button class="btn-ghost btn-compact" data-dash-rango="mes_anterior" onclick="setRangoRapidoDash('mes_anterior')">Mes anterior</button>
        <button class="btn-ghost btn-compact" data-dash-rango="limpiar" onclick="setRangoRapidoDash('limpiar')">✕ Limpiar</button>
      </div>
      <div class="sub" id="dashAviso" style="margin-bottom:14px;"></div>
      <div id="kpisConversaciones" class="grid" style="margin-bottom:18px;"></div>
      <div id="kpisAtencion" class="grid" style="margin-bottom:18px;"></div>
      <div id="kpisComercial" class="grid"></div>
    </div>
  `;
  setRangoRapidoDash('mes'); // arranca en el mes actual, como Cotizaciones
}
function setRangoRapidoDash(tipo){
  const hoy = hoyChileDash();
  const [y, m] = hoy.split('-').map(Number);
  const primeroMes = `${y}-${String(m).padStart(2, '0')}-01`;
  let desde = '', hasta = '';
  if (tipo === 'hoy') { desde = hoy; hasta = hoy; }
  else if (tipo === 'semana') { desde = addDiasDash(hoy, -6); hasta = hoy; }
  else if (tipo === 'mes') { desde = primeroMes; hasta = hoy; }
  else if (tipo === 'mes_anterior') { hasta = addDiasDash(primeroMes, -1); desde = hasta.slice(0, 8) + '01'; }
  // 'limpiar' deja ambos vacíos = todo el historial
  $('dashDesde').value = desde; $('dashHasta').value = hasta;
  document.querySelectorAll('[data-dash-rango]').forEach(b => b.classList.toggle('activo', b.dataset.dashRango === tipo));
  cargarDashboard();
}
function dashCambioManual(){
  document.querySelectorAll('[data-dash-rango]').forEach(b => b.classList.remove('activo'));
  const d = $('dashDesde').value, h = $('dashHasta').value;
  if (d && h && d > h) { $('dashAviso').textContent = '"Desde" no puede ser posterior a "Hasta".'; return; }
  cargarDashboard();
}
function cmpHtml(pct){
  if (pct === null || pct === undefined) return '';
  if (pct === Infinity) return `<div class="cmp up">▲ nuevo</div>`;
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const flecha = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
  return `<div class="cmp ${cls}">${flecha} ${pct > 0 ? '+' : ''}${pct}% vs. período anterior</div>`;
}
let dashPeticion = 0; // descarta respuestas viejas si el usuario cambia el rango rápido
async function cargarDashboard(){
  const desde = $('dashDesde')?.value || '', hasta = $('dashHasta')?.value || '';
  if ((desde && hasta && desde > hasta) || (!desde) !== (!hasta)) {
    // rango a medias: se espera a que estén las dos fechas (o ninguna)
    if (!desde !== !hasta) { $('dashAviso').textContent = 'Elige las dos fechas (Desde y Hasta) o usa "Limpiar" para ver todo el historial.'; }
    return;
  }
  const mia = ++dashPeticion;
  $('dashAviso').textContent = 'Cargando...';
  try{
    const qs = desde && hasta ? `&desde=${desde}&hasta=${hasta}` : '';
    const res = await fetch('/api/negocio?recurso=whatsapp-dashboard' + qs);
    const data = await res.json();
    if (mia !== dashPeticion) return;
    if (!res.ok || data.error) { $('dashAviso').textContent = ''; $('kpisConversaciones').innerHTML = `<p class="empty-note">${data.error || 'No se pudo cargar el dashboard.'}</p>`; return; }
    const c = data.conversaciones, a = data.atencion, com = data.comercial;
    const r = data.rango;
    $('dashAviso').textContent = r
      ? `Mostrando conversaciones iniciadas del ${r.desde} al ${r.hasta} (${r.dias} día${r.dias === 1 ? '' : 's'}); la variación compara con ${r.dias === 1 ? 'el día anterior' : `los ${r.dias} días anteriores`}.`
      : 'Mostrando todo el historial (sin comparación con un período anterior).';
    $('dashSubtitulo').textContent = r ? 'Comparado con el período anterior de igual duración.' : 'Sin rango de fechas: se muestra todo el historial.';

    $('kpisConversaciones').innerHTML = `
      <div class="card"><div class="lbl">Conversaciones hoy</div><div class="big">${fmtNum(c.hoy)}</div></div>
      <div class="card"><div class="lbl">Conversaciones del período</div><div class="big">${fmtNum(c.periodo)}</div>${cmpHtml(c.periodoVariacion)}</div>
      <div class="card"><div class="lbl">Clientes únicos del período</div><div class="big">${fmtNum(c.clientesUnicos)}</div>${cmpHtml(c.clientesUnicosVariacion)}</div>
      <div class="card"><div class="lbl">Promedio por día</div><div class="big">${c.promedioDiario != null ? fmtNum1(c.promedioDiario) : '—'}</div></div>
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
// Rediseño: bandeja de 3 paneles (lista / chat / ficha) como vista
// principal de atención, con un selector "Bandeja / Tabla" para seguir
// teniendo la tabla de supervisión de siempre (ver renderTablaConv más
// abajo, ahora con columnas por defecto reducidas). Ambas vistas comparten
// el mismo estado de filtros/búsqueda/orden y el mismo fetch
// (cargarConversaciones) -- cambiar de vista nunca vuelve a pedir datos al
// servidor, solo re-renderiza lo ya cargado (convState.ultimaData).
let convState = {
  page: 1, pageSize: 200, q: '', filtros: {}, orden: 'fecha_desc', total: 0, totalPaginas: 1,
  vista: 'todas', // pestaña de la bandeja (arranca en Todas): pendientes | mias | todas
  vistaUI: 'bandeja', // bandeja | tabla
  columnasExtendidas: false,
  contadores: {},
};
let conversacionSeleccionadaId = null;
let detalleBandejaActual = null;
let composerModoActual = {}; // {[conversacionId]: 'responder'|'nota'}
const borradoresComposer = {}; // {[conversacionId+':'+modo]: texto} -- sobrevive a cambios de vista/ficha mientras la pestaña siga abierta
let sugerenciaIaActual = null; // {conversacionId, texto} -- se descarta al cambiar de conversación
let botModo = null; // modo del bot nocturno ('sombra' | 'apagado' | null si no se pudo leer)
let botBorradorActual = null; // borrador pendiente del bot para la conversación abierta
const botInsertado = {}; // {[conversacionId]: {id}} -- borrador del bot insertado en el compositor, para registrar cómo salió

function initConversaciones(){
  $('vistaConversaciones').innerHTML = `
    <div class="bandeja-toolbar">
      <div class="view-toggle">
        <button id="btnVistaBandeja" class="activo" onclick="cambiarVistaConv('bandeja')">📥 Bandeja</button>
        <button id="btnVistaTabla" onclick="cambiarVistaConv('tabla')">📋 Tabla</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <select id="selVistaTablaRapida" style="display:none;font-size:12px;" onchange="cambiarTabBandeja(this.value)"></select>
        <button class="btn-ghost btn-compact" id="btnBotNocturno" onclick="abrirPanelBot()" title="Bot que redacta respuestas fuera del horario de atención (modo sombra: tú revisas y envías)">🤖 Bot nocturno</button>
        <button class="btn-ghost btn-compact" id="btnToggleFiltrosConv" onclick="toggleFiltrosConv()">🔎 Filtros</button>
      </div>
    </div>
    <div id="chipFiltroMotivo"></div>
    <div class="filtros-panel" id="panelFiltrosConv" style="display:none;">
      <div class="campo"><label>Fecha desde</label><input type="date" id="fDesde"></div>
      <div class="campo"><label>Fecha hasta</label><input type="date" id="fHasta"></div>
      <div class="campo"><label>Estado</label><select id="fEstado"><option value="">Todos</option>${WHATSAPP_ESTADOS_OPT()}</select></div>
      <div class="campo"><label>Resultado</label><select id="fResultado"><option value="">Todos</option>${WHATSAPP_RESULTADOS_OPT()}</select></div>
      <div class="campo"><label>Intención</label><select id="fIntencion"><option value="">Todas</option>${WHATSAPP_INTENCIONES_OPT()}</select></div>
      <div class="campo"><label>Categoría</label><select id="fProducto"><option value="">Todas</option>${WHATSAPP_CATEGORIAS_OPT()}</select></div>
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
      <div class="campo"><label title="Todavía no es un campo propio del sistema -- no existe una columna de prioridad en los datos de WhatsApp, así que no se puede filtrar por algo que no se guarda. Queda documentado como limitación pendiente.">Prioridad (pendiente)</label><select disabled><option>No disponible todavía</option></select></div>
      <div style="display:flex;gap:8px;">
        <button class="btn-primary btn-compact" onclick="aplicarFiltrosConv()">Aplicar</button>
        <button class="btn-ghost btn-compact" onclick="limpiarFiltrosConv()">Limpiar</button>
      </div>
    </div>

    <div id="vistaBandejaConv" class="bandeja-layout">
      <div class="panel-lista activa" id="panelLista">
        <div class="lista-head">
          <div class="lista-indicadores" id="listaIndicadores"></div>
          <div class="lista-buscador">
            <span class="icono-buscar">🔍</span>
            <input type="text" id="buscadorBandeja" placeholder="Buscar por nombre, teléfono, mensaje, producto, modelo o ID...">
          </div>
          <div class="lista-tabs" id="listaTabs"></div>
        </div>
        <div class="lista-items" id="listaItemsBandeja"><p class="empty-note" style="padding:16px;">Cargando…</p></div>
        <div class="lista-paginacion" id="listaPaginacionBandeja"></div>
      </div>
      <div class="panel-chat" id="panelChat"><div class="sin-seleccion">Selecciona una conversación de la lista para verla acá.</div></div>
      <div class="panel-ficha-bandeja" id="panelFichaBandeja"></div>
    </div>
    <div class="overlay-ficha-movil" id="overlayFichaMovil" onclick="cerrarFichaMovil()"></div>

    <div id="vistaTablaConv" style="display:none;">
      <div class="seccion">
        <div class="seccion-head">
          <div><h2>Tabla de conversaciones</h2><div class="sub">Vista de supervisión. Columnas reducidas por defecto -- usa "Más columnas" o abre la conversación para ver todo el detalle.</div></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <div class="buscador-wrap" style="min-width:260px;">
              <span class="icono-buscar">🔍</span>
              <input type="text" id="buscadorConv" placeholder="Buscar por nombre, teléfono, texto, marca, modelo, pedido o ID...">
            </div>
            <button class="btn-ghost btn-compact" id="btnColumnasExtendidas" onclick="toggleColumnasExtendidas()">➕ Más columnas</button>
          </div>
        </div>
        <div class="tabla-wrap">
          <table>
            <thead><tr id="theadConv"></tr></thead>
            <tbody id="tablaConv"><tr><td colspan="6" class="empty-note">Cargando…</td></tr></tbody>
          </table>
        </div>
        <div id="paginacionConv" style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12.5px;color:var(--muted);"></div>
      </div>
    </div>
  `;
  renderTheadConv();
  $('buscadorBandeja').addEventListener('input', debounce(() => { convState.q = $('buscadorBandeja').value.trim(); convState.page = 1; cargarConversaciones(); }, 350));
  $('buscadorConv').addEventListener('input', debounce(() => { convState.q = $('buscadorConv').value.trim(); convState.page = 1; cargarConversaciones(); }, 350));
  cargarConversaciones();
}

function cambiarVistaConv(vistaUI){
  convState.vistaUI = vistaUI;
  $('btnVistaBandeja').classList.toggle('activo', vistaUI === 'bandeja');
  $('btnVistaTabla').classList.toggle('activo', vistaUI === 'tabla');
  $('vistaBandejaConv').style.display = vistaUI === 'bandeja' ? '' : 'none';
  $('vistaTablaConv').style.display = vistaUI === 'tabla' ? '' : 'none';
  // Mismo texto de búsqueda en ambos inputs al cambiar de vista -- el
  // usuario no pierde lo que ya había escrito (punto "conserva la
  // selección al cambiar de vista").
  if (vistaUI === 'tabla') {
    $('buscadorConv').value = convState.q;
    renderTablaConv(convState.ultimaDataOrdenada || convState.ultimaData || []);
    renderPaginacionConv();
  } else {
    $('buscadorBandeja').value = convState.q;
    actualizarListaBandeja({ conversaciones: convState.ultimaData || [], contadores: convState.contadores });
  }
}

function WHATSAPP_ESTADOS_OPT(){ return WHATSAPP_ESTADOS.map(e => `<option value="${e}">${ESTADO_LABEL[e]}</option>`).join(''); }
function WHATSAPP_RESULTADOS_OPT(){ return WHATSAPP_RESULTADOS.map(r => `<option value="${r}">${RESULTADO_LABEL[r]}</option>`).join(''); }
function WHATSAPP_INTENCIONES_OPT(){ return WHATSAPP_INTENCIONES.map(i => `<option value="${i}">${INTENCION_LABEL[i]}</option>`).join(''); }
function WHATSAPP_CATEGORIAS_OPT(){ return WHATSAPP_CATEGORIAS.map(c => `<option value="${c}">${CATEGORIA_LABEL[c]}</option>`).join(''); }

const WHATSAPP_ESTADOS = ['nueva', 'abierta', 'esperando_cliente', 'seguimiento', 'cerrada', 'sin_respuesta'];
const WHATSAPP_RESULTADOS = ['venta', 'cotizacion', 'seguimiento', 'sin_stock', 'cliente_no_responde', 'no_interesado', 'consulta_resuelta', 'otro'];
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
  convState.filtroMotivoLabel = null;
  convState.page = 1;
  cargarConversaciones();
}
function filtrarSinAsignar(){
  convState.filtros.responsableId = 'sin_asignar';
  const sel = $('fResponsable'); if (sel) sel.value = 'sin_asignar';
  convState.page = 1;
  cargarConversaciones();
}
// El indicador de seguimientos (hoy/vencidos) manda directo a la pestaña
// "Seguimientos" de este mismo módulo -- ya existe esa vista dedicada, no
// hace falta duplicar su lógica acá.

// Chip visible arriba cuando se llega filtrado por un motivo de pérdida
// (ver irAConversacionesConMotivo, en Analítica) -- sin esto el filtro
// queda invisible, no se entiende por qué aparecen menos conversaciones.
function renderChipFiltroMotivo(){
  const el = $('chipFiltroMotivo');
  if (!el) return;
  if (!convState.filtros.motivoPerdida) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div style="display:inline-flex;align-items:center;gap:8px;background:var(--surface-2);border:1px solid var(--line);border-radius:20px;padding:4px 6px 4px 12px;margin-bottom:12px;font-size:12.5px;">
      Motivo de pérdida: <b>${escapeHtml(convState.filtroMotivoLabel || convState.filtros.motivoPerdida)}</b>
      <button class="btn-icono" title="Quitar filtro" onclick="limpiarFiltrosConv()">✕</button>
    </div>`;
}

async function cargarConversaciones(){
  const params = new URLSearchParams({ page: convState.page, pageSize: convState.pageSize, q: convState.q });
  if (convState.vista) params.set('vista', convState.vista);
  for (const [k, v] of Object.entries(convState.filtros)) if (v) params.set(k, v);
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-conversaciones&' + params.toString());
    const data = await res.json();
    if (!res.ok || data.error) {
      const msg = escapeHtml(data.error || 'Error al cargar.');
      $('tablaConv').innerHTML = `<tr><td colspan="17" class="empty-note">${msg}</td></tr>`;
      $('listaItemsBandeja').innerHTML = `<p class="empty-note" style="padding:16px;">${msg}</p>`;
      return;
    }
    convState.total = data.total; convState.totalPaginas = data.totalPaginas;
    convState.ultimaData = data.conversaciones; convState.contadores = data.contadores || {};
    if (convState.vistaUI === 'tabla') { renderTablaConv(data.conversaciones); renderPaginacionConv(); }
    else { actualizarListaBandeja(data); }
    renderChipFiltroMotivo();
  }catch(err){
    const msg = 'Error: ' + escapeHtml(err.message);
    $('tablaConv').innerHTML = `<tr><td colspan="17" class="empty-note">${msg}</td></tr>`;
    $('listaItemsBandeja').innerHTML = `<p class="empty-note" style="padding:16px;">${msg}</p>`;
  }
}
function irPaginaConv(p){ convState.page = p; cargarConversaciones(); }

// ---------------- Bandeja: lista (izquierda) ----------------
function renderListaIndicadores(contadores){
  const c = contadores || {};
  $('listaIndicadores').innerHTML = `
    <div class="indicador-chip rojo" onclick="cambiarTabBandeja('pendientes')" title="Conversaciones sin ninguna respuesta todavía"><span class="num">${fmtNum(c.pendientes)}</span><span class="lbl-ind">Sin responder</span></div>
    <div class="indicador-chip gris" onclick="filtrarSinAsignar()" title="Conversaciones sin responsable asignado"><span class="num">${fmtNum(c.sinAsignar)}</span><span class="lbl-ind">Sin asignar</span></div>
  `;
}
function renderListaTabs(contadores){
  const c = contadores || {};
  const tabs = [['pendientes', 'Pendientes', c.pendientes], ['mias', 'Mías', c.mias], ['todas', 'Todas', c.todas]];
  $('listaTabs').innerHTML = tabs.map(([clave, label, n]) => `
    <button class="${convState.vista === clave ? 'activo' : ''}" onclick="cambiarTabBandeja('${clave}')">${label} <span class="num-tab">${fmtNum(n)}</span></button>
  `).join('');
  const sel = $('selVistaTablaRapida');
  if (sel) {
    sel.style.display = '';
    sel.innerHTML = tabs.map(([clave, label, n]) => `<option value="${clave}" ${convState.vista === clave ? 'selected' : ''}>${label} (${fmtNum(n)})</option>`).join('');
  }
}
function cambiarTabBandeja(vista){
  convState.vista = vista;
  convState.page = 1;
  cargarConversaciones();
}
function iniciales(nombre){
  if (!nombre) return '?';
  const partes = String(nombre).trim().split(/\s+/);
  return ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase() || '?';
}
// Tiempo relativo compacto para la fila de la lista (igual criterio visual
// que cualquier bandeja de mensajería) -- fmtFecha/fmtFechaHora (arriba)
// siguen existiendo para fechas completas en la ficha y la tabla.
function tiempoRelativo(iso){
  if (!iso) return '';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `${diffMin} min`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d`;
  return fmtFecha(iso);
}
// Teléfono legible para la lista: el número viene como wa_id (solo dígitos,
// con código de país). Móviles chilenos: +56 9 1234 5678; el resto: +dígitos.
function fmtTelefonoLista(tel){
  const d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  const m = /^56(9)(\d{4})(\d{4})$/.exec(d);
  return m ? `+56 ${m[1]} ${m[2]} ${m[3]}` : '+' + d;
}
function itemConvHtml(c){
  const info = estadoAtencionInfo(c);
  const alerta = alertaPrincipalInfo(c);
  const seleccionado = conversacionSeleccionadaId === c.id;
  return `
    <div class="item-conv ${seleccionado ? 'seleccionado' : ''}" onclick="seleccionarConversacionBandeja(${c.id})">
      <div class="avatar-chip">${iniciales(c.clienteNombre)}</div>
      <div class="item-cuerpo">
        <div class="item-top-row">
          <span class="item-nombre">${escapeHtml(c.clienteNombre || 'Sin nombre')}</span>
          <span class="item-tiempo">${tiempoRelativo(c.ultimoMensajeEn || c.fecha)}</span>
        </div>
        <div class="item-mensaje">${escapeHtml(c.ultimoMensaje || 'Sin mensajes')}</div>
        <div class="item-meta-row">
          <span class="item-estado-punto ${info.clave}" title="${info.label}"></span>
          ${c.categoria ? `<span class="badge-mini b-gris">${escapeHtml(CATEGORIA_LABEL[c.categoria] || c.categoria)}</span>` : ''}
          <span class="sub" style="font-size:10.5px;">${escapeHtml(c.responsableNombre || (c.vendedorDetectado ? c.vendedorDetectado + ' 🤖' : 'Sin asignar'))}</span>
          ${c.clienteTelefono ? `<span class="sub item-telefono" style="font-size:10.5px;">· 📞 ${escapeHtml(fmtTelefonoLista(c.clienteTelefono))}</span>` : ''}
        </div>
        ${alerta ? `<div style="margin-top:4px;"><span class="alerta-chip ${alerta.clase}" style="font-size:10px;padding:2px 7px;">${alerta.icono} ${escapeHtml(alerta.texto)}</span></div>` : ''}
      </div>
    </div>
  `;
}
function actualizarListaBandeja(data){
  renderListaIndicadores(data.contadores);
  renderListaTabs(data.contadores);
  const lista = data.conversaciones || [];
  $('listaItemsBandeja').innerHTML = lista.length
    ? lista.map(itemConvHtml).join('')
    : '<p class="empty-note" style="padding:16px;">No hay conversaciones que calcen con los filtros.</p>';
  $('listaPaginacionBandeja').innerHTML = `
    <span>${fmtNum(convState.total)} conversación(es)${convState.totalPaginas > 1 ? ` · pág. ${convState.page}/${convState.totalPaginas}` : ''}</span>
    <span>
      <button class="btn-ghost btn-compact" style="padding:4px 9px;" ${convState.page <= 1 ? 'disabled' : ''} onclick="irPaginaConv(${convState.page - 1})">←</button>
      <button class="btn-ghost btn-compact" style="padding:4px 9px;" ${convState.page >= convState.totalPaginas ? 'disabled' : ''} onclick="irPaginaConv(${convState.page + 1})">→</button>
    </span>
  `;
}

// ---------------- Bandeja: selección + chat (centro) ----------------
async function seleccionarConversacionBandeja(id){
  conversacionSeleccionadaId = id;
  sugerenciaIaActual = null;
  document.querySelectorAll('#listaItemsBandeja .item-conv').forEach(el => el.classList.remove('seleccionado'));
  $('panelChat').innerHTML = '<div class="sin-seleccion">Cargando conversación…</div>';
  await cargarDetalleBandeja(id, { forzarScroll: true });
  if (window.matchMedia('(max-width:860px)').matches) mostrarPanelMovil('chat');
}
async function cargarDetalleBandeja(id, opts){
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-conversacion-detalle&id=' + id);
    const data = await res.json();
    if (!res.ok || data.error) { $('panelChat').innerHTML = `<div class="sin-seleccion">${escapeHtml(data.error || 'No se pudo cargar.')}</div>`; return; }
    detalleBandejaActual = data;
    await cargarBorradorBot(id);
    renderChatBandeja(data, opts || {});
    renderFichaBandeja(data);
    const idx = (convState.ultimaData || []).findIndex(c => c.id === id);
    const items = document.querySelectorAll('#listaItemsBandeja .item-conv');
    items.forEach(el => el.classList.remove('seleccionado'));
    if (idx >= 0 && items[idx]) items[idx].classList.add('seleccionado');
  }catch(err){
    $('panelChat').innerHTML = `<div class="sin-seleccion">Error: ${escapeHtml(err.message)}</div>`;
  }
}
// Mezcla mensajes reales + notas internas en un solo hilo cronológico --
// las notas se distinguen visualmente (fondo ámbar punteado) y nunca se
// mandan por WhatsApp (ver whatsapp_notas_internas en lib/db.js).
function hiloCombinadoHtml(mensajes, notas){
  const items = [
    ...(mensajes || []).map(m => ({ t: new Date(m.marcaTiempo).getTime(), html: burbujaMensaje(m) })),
    ...(notas || []).map(n => ({ t: new Date(n.fecha).getTime(), html: notaInternaHtml(n) })),
  ].sort((a, b) => a.t - b.t);
  if (!items.length) return '<p class="empty-note">Sin mensajes registrados.</p>';
  return items.map(it => it.html).join('');
}
function notaInternaHtml(n){
  return `<div class="nota-interna-burbuja"><span class="nota-autor">📝 Nota interna — ${escapeHtml(n.autor)}</span>${escapeHtml(n.texto)}<span class="hora" style="display:block;text-align:right;margin-top:3px;">${fmtHora(n.fecha)}</span></div>`;
}
function renderChatBandeja(data, opts){
  opts = opts || {};
  const c = data.conversacion, ct = data.contacto;
  const info = estadoAtencionInfo(c);
  const alerta = alertaPrincipalInfo(c);
  const modo = composerModoActual[c.id] || 'responder';

  // Conserva la posición de lectura: si el usuario estaba leyendo mensajes
  // antiguos (no al fondo), el re-render no lo manda al final -- solo se
  // fuerza el scroll al fondo al abrir la conversación o justo después de
  // mandar algo (opts.forzarScroll), o si ya estaba al fondo de todas
  // formas (igual que cualquier chat).
  const hiloViejo = $('chatHiloWrap');
  const scrollViejo = hiloViejo ? hiloViejo.scrollTop : null;
  const alFondoAntes = hiloViejo ? (hiloViejo.scrollTop + hiloViejo.clientHeight >= hiloViejo.scrollHeight - 60) : true;

  const hilo = hiloCombinadoHtml(data.mensajes, data.notasInternas);

  const sugerenciaHtml = (sugerenciaIaActual && sugerenciaIaActual.conversacionId === c.id) ? `
    <div class="chat-ia-sugerencia">
      <div class="txt"><b>✨ Sugerencia IA — revisa antes de enviar</b>${escapeHtml(sugerenciaIaActual.texto)}</div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn-primary btn-compact" onclick="insertarSugerenciaIA(${c.id})">Insertar</button>
        <button class="btn-ghost btn-compact" onclick="descartarSugerenciaIA()">Descartar</button>
      </div>
    </div>` : '';

  const areaComposerHtml = modo === 'nota'
    ? `<div class="composer-area">
         <textarea id="composerBandeja${c.id}" rows="1" placeholder="Nota interna -- no se envía al cliente…" oninput="guardarBorradorComposer(${c.id})" onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); accionComposerBandeja(${c.id});}">${escapeHtml(borradoresComposer[c.id + ':nota'] || '')}</textarea>
         <button class="btn-primary btn-compact" id="btnComposerBandeja${c.id}" onclick="accionComposerBandeja(${c.id})">Guardar nota</button>
       </div>`
    : (data.ventanaAbierta
        ? `<div class="composer-area">
             <textarea id="composerBandeja${c.id}" rows="1" placeholder="Escribe una respuesta…" oninput="guardarBorradorComposer(${c.id})" onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); accionComposerBandeja(${c.id});}">${escapeHtml(borradoresComposer[c.id + ':responder'] || '')}</textarea>
             <button class="btn-primary btn-compact" id="btnComposerBandeja${c.id}" onclick="accionComposerBandeja(${c.id})">Enviar</button>
           </div>
           <div class="composer-extra">
             <button class="btn-ghost btn-compact" disabled title="Los adjuntos de salida todavía no están disponibles en este sistema -- solo se reciben, no se envían">📎 Adjuntar</button>
             <button class="btn-ghost btn-compact" disabled title="Las respuestas rápidas todavía no están disponibles en este sistema">💬 Respuestas rápidas</button>
             <button class="btn-ghost btn-compact" onclick="pedirSugerenciaIA(${c.id})" id="btnSugerirIA${c.id}">✨ Sugerir respuesta</button>
             ${botModo && botModo !== 'apagado' ? `<button class="btn-ghost btn-compact" onclick="prepararRespuestaBot(${c.id}, false)" id="btnBot${c.id}" title="El bot busca el producto en el catálogo (precio, stock, enlace) y redacta la respuesta">🤖 Preparar con bot</button>` : ''}
           </div>`
        : `<div class="composer-cerrado">🔒 Pasaron más de 24h desde el último mensaje del cliente — WhatsApp ya no permite texto libre acá (se necesita una plantilla pre-aprobada, no disponible todavía). La nota interna sigue disponible en la otra pestaña.</div>`);

  $('panelChat').innerHTML = `
    <div class="chat-head">
      <div class="chat-head-id">
        <button class="btn-ghost btn-compact btn-volver-lista" onclick="mostrarPanelMovil('lista')" title="Volver a la lista">←</button>
        <div class="avatar-chip">${iniciales(ct?.nombre)}</div>
        <div>
          <h2>${escapeHtml(ct?.nombre || 'Sin nombre')}</h2>
          <div class="sub" style="font-size:11px;">WhatsApp · #${c.id}${c.categoria ? ' · ' + escapeHtml(CATEGORIA_LABEL[c.categoria] || c.categoria) : ''}</div>
        </div>
      </div>
      <div class="chat-head-acciones">
        ${info.clave !== 'resuelta'
          ? `<button class="btn-primary btn-compact" onclick="guardarCampoConvBandeja(${c.id}, 'estado', 'cerrada')">✓ Resolver</button>`
          : `<span class="badge b-gris">Resuelta</span>`}
        <button class="btn-ghost btn-compact btn-cerrar-panel-movil" onclick="mostrarPanelMovil('ficha')" title="Ver ficha del cliente">👤 Ficha</button>
      </div>
    </div>
    ${alerta ? `<div class="chat-alerta-pendiente">${alerta.icono} ${escapeHtml(alerta.texto)}</div>` : ''}
    <div class="chat-hilo-wrap" id="chatHiloWrap">${hilo}</div>
    ${botBorradorHtml(c.id)}
    ${sugerenciaHtml}
    <div class="chat-composer-wrap">
      <div class="composer-tabs">
        <button class="${modo === 'responder' ? 'activo' : ''}" onclick="cambiarComposerModo(${c.id}, 'responder')">💬 Responder</button>
        <button class="nota ${modo === 'nota' ? 'activo' : ''}" onclick="cambiarComposerModo(${c.id}, 'nota')">📝 Nota interna</button>
      </div>
      ${areaComposerHtml}
    </div>
  `;

  const hiloNuevo = $('chatHiloWrap');
  if (hiloNuevo) {
    if (opts.forzarScroll || alFondoAntes) hiloNuevo.scrollTop = hiloNuevo.scrollHeight;
    else if (scrollViejo != null) hiloNuevo.scrollTop = scrollViejo;
  }
}
function cambiarComposerModo(id, modo){
  composerModoActual[id] = modo;
  if (detalleBandejaActual && detalleBandejaActual.conversacion.id === id) renderChatBandeja(detalleBandejaActual, {});
}
function guardarBorradorComposer(id){
  const modo = composerModoActual[id] || 'responder';
  const el = $('composerBandeja' + id);
  if (el) borradoresComposer[id + ':' + modo] = el.value;
}
// Responder y Nota interna comparten el mismo botón de acción (cambia de
// texto/endpoint según la pestaña activa) para no duplicar el composer --
// nunca se confunden entre sí porque solo uno de los dos está visible a la
// vez y usan endpoints distintos (whatsapp-enviar-mensaje vs.
// whatsapp-nota-interna, ver api/negocio.js).
async function accionComposerBandeja(id){
  const modo = composerModoActual[id] || 'responder';
  const el = $('composerBandeja' + id);
  const btn = $('btnComposerBandeja' + id);
  const texto = (el?.value || '').trim();
  if (!texto || !el) return;
  el.disabled = true; if (btn) btn.disabled = true;
  try{
    const recurso = modo === 'nota' ? 'whatsapp-nota-interna' : 'whatsapp-enviar-mensaje';
    const res = await fetch('/api/negocio?recurso=' + recurso, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversacionId: id, texto }),
    });
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || 'No se pudo completar la acción.'); return; }
    borradoresComposer[id + ':' + modo] = '';
    if(modo !== 'nota' && botInsertado[id]){ registrarEnvioBot(id, texto); }
    await cargarDetalleBandeja(id, { forzarScroll: true });
    cargarConversaciones();
  }catch(err){ alert('Error: ' + err.message); }
  finally{
    const el2 = $('composerBandeja' + id); if (el2) el2.disabled = false;
    const btn2 = $('btnComposerBandeja' + id); if (btn2) btn2.disabled = false;
  }
}
async function guardarCampoConvBandeja(id, campo, valor){
  try{
    const body = { id }; body[campo] = valor;
    const res = await fetch('/api/negocio?recurso=whatsapp-conversaciones', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || 'No se pudo guardar el cambio.'); return; }
    await cargarDetalleBandeja(id, {});
    cargarConversaciones();
  }catch(err){ alert('Error: ' + err.message); }
}
function programarSeguimientoBandeja(id){
  const fecha = prompt('Fecha del seguimiento (AAAA-MM-DD):', new Date().toISOString().slice(0, 10));
  if (!fecha) return;
  (async () => {
    try{
      const res = await fetch('/api/negocio?recurso=whatsapp-conversaciones', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, requiereSeguimiento: true, seguimientoEn: fecha + 'T12:00:00', seguimientoEstado: 'pendiente' }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { alert(data.error || 'No se pudo programar el seguimiento.'); return; }
      await cargarDetalleBandeja(id, {});
      cargarConversaciones();
    }catch(err){ alert('Error: ' + err.message); }
  })();
}
// Sugerencia de respuesta de IA (botón manual, no automático -- ver
// manejarWhatsappSugerirRespuesta): SIEMPRE requiere clic explícito de
// "Insertar" para llegar al composer, y clic en "Enviar" para salir de
// verdad -- nunca se manda sola.
async function pedirSugerenciaIA(id){
  const btn = $('btnSugerirIA' + id);
  if (btn) { btn.disabled = true; btn.textContent = '✨ Pensando…'; }
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-sugerir-respuesta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversacionId: id }),
    });
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || 'No se pudo generar una sugerencia.'); return; }
    sugerenciaIaActual = { conversacionId: id, texto: data.borrador };
    if (detalleBandejaActual && detalleBandejaActual.conversacion.id === id) renderChatBandeja(detalleBandejaActual, {});
  }catch(err){ alert('Error: ' + err.message); }
  finally{ const b = $('btnSugerirIA' + id); if (b) { b.disabled = false; b.textContent = '✨ Sugerir respuesta'; } }
}
function insertarSugerenciaIA(id){
  if (!sugerenciaIaActual || sugerenciaIaActual.conversacionId !== id) return;
  composerModoActual[id] = 'responder';
  borradoresComposer[id + ':responder'] = sugerenciaIaActual.texto;
  sugerenciaIaActual = null;
  if (detalleBandejaActual) renderChatBandeja(detalleBandejaActual, {});
  const el = $('composerBandeja' + id); if (el) el.focus();
}
// ---- Bot nocturno (modo sombra): el borrador queda guardado, el ejecutivo lo inserta, lo edita y lo envía como cualquier respuesta ----
async function cargarBorradorBot(id){
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-bot-borrador&conversacionId=' + id);
    const d = await res.json();
    if(res.ok && !d.error){ botModo = d.modo; botBorradorActual = d.borrador || null; return; }
  }catch(err){ /* sin bot: la bandeja funciona igual */ }
  botModo = null; botBorradorActual = null;
}
function botBorradorHtml(convId){
  const b = botBorradorActual;
  if(!b || b.conversacionId !== convId) return '';
  const conf = { alta: ['b-verde', 'Confianza alta'], media: ['b-ambar', 'Confianza media'], baja: ['b-rojo', 'Confianza baja'] }[b.confianza] || ['b-gris', b.confianza || ''];
  const productos = (b.productos || []).slice(0, 5).map(p => `<li>${escapeHtml(p.titulo)} — ${p.precio != null ? '$' + fmtNum(p.precio) : 'sin precio'} · stock: ${escapeHtml(String(p.stock))}${p.publicado ? '' : ' · <b>no publicado</b>'}</li>`).join('');
  return `
    <div class="chat-ia-sugerencia chat-bot-borrador ${b.escalar ? 'escala' : ''}">
      <div class="txt">
        <b>🤖 Bot nocturno — borrador, revisa antes de enviar</b>
        <div style="margin:4px 0 6px;display:flex;gap:6px;flex-wrap:wrap;"><span class="badge ${conf[0]}">${conf[1]}</span>${b.escalar ? '<span class="badge b-rojo">👤 Requiere ejecutivo</span>' : ''}</div>
        <div style="white-space:pre-wrap;">${escapeHtml(b.texto)}</div>
        ${b.resumen ? `<div class="sub" style="margin-top:6px;font-size:11.5px;">📝 ${escapeHtml(b.resumen)}</div>` : ''}
        ${b.motivo ? `<div class="sub" style="margin-top:4px;font-size:11.5px;color:var(--red);">⚠ ${escapeHtml(b.motivo)}</div>` : ''}
        ${productos ? `<details style="margin-top:6px;font-size:11.5px;"><summary>Productos que consultó en el catálogo</summary><ul style="margin:4px 0 0 16px;padding:0;">${productos}</ul></details>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
        <button class="btn-primary btn-compact" onclick="insertarBorradorBot(${convId})">Insertar</button>
        <button class="btn-ghost btn-compact" onclick="prepararRespuestaBot(${convId}, true)" title="Pedirle al bot una nueva versión">↻ Regenerar</button>
        <button class="btn-ghost btn-compact" onclick="descartarBorradorBot(${convId})">Descartar</button>
      </div>
    </div>`;
}
function actualizarEstadoBot(id, accion, textoFinal){
  fetch('/api/negocio?recurso=whatsapp-bot-estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, accion, textoFinal }) }).catch(() => {});
}
async function prepararRespuestaBot(convId, forzar){
  const btn = $('btnBot' + convId);
  if(btn){ btn.disabled = true; btn.textContent = '🤖 Pensando…'; }
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-bot-generar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversacionId: convId, forzar: !!forzar }) });
    const d = await res.json();
    if(!res.ok || d.error){ alert(d.error || 'No se pudo preparar la respuesta.'); return; }
    botBorradorActual = d.borrador;
    if(detalleBandejaActual && detalleBandejaActual.conversacion.id === convId) renderChatBandeja(detalleBandejaActual, {});
  }catch(err){ alert('Error: ' + err.message); }
  finally{ const b = $('btnBot' + convId); if(b){ b.disabled = false; b.textContent = '🤖 Preparar con bot'; } }
}
function insertarBorradorBot(convId){
  const b = botBorradorActual;
  if(!b || b.conversacionId !== convId) return;
  composerModoActual[convId] = 'responder';
  borradoresComposer[convId + ':responder'] = b.texto;
  botInsertado[convId] = { id: b.id };
  actualizarEstadoBot(b.id, 'insertado');
  botBorradorActual = null;
  if(detalleBandejaActual) renderChatBandeja(detalleBandejaActual, {});
  const el = $('composerBandeja' + convId); if(el) el.focus();
}
function descartarBorradorBot(convId){
  const b = botBorradorActual;
  if(!b || b.conversacionId !== convId) return;
  actualizarEstadoBot(b.id, 'descartado');
  botBorradorActual = null;
  if(detalleBandejaActual) renderChatBandeja(detalleBandejaActual, {});
}
// Al enviar lo que salió del bot, se guarda el texto final: sirve para medir cuántos borradores salen tal cual y cuántos editados.
function registrarEnvioBot(convId, textoFinal){
  const reg = botInsertado[convId];
  if(!reg) return;
  actualizarEstadoBot(reg.id, 'enviado', textoFinal);
  delete botInsertado[convId];
}
function descartarSugerenciaIA(){
  sugerenciaIaActual = null;
  if (detalleBandejaActual) renderChatBandeja(detalleBandejaActual, {});
}

// ---------------- Bandeja: ficha contextual (derecha) ----------------
// Coincidencia con Bsale: SIEMPRE heurística por teléfono, nunca verificada
// a mano (ver buscarClienteBsalePorTelefono en api/negocio.js) -- se marca
// explícitamente "por confirmar", nunca como identidad confirmada.
function fichaBsaleHtml(clienteBsale){
  if (!clienteBsale) return '<div class="ficha-fila"><span>Bsale</span><b class="sub">Sin coincidencia</b></div>';
  return `<div class="ficha-fila"><span>Bsale</span><b><span class="badge b-ambar" title="Coincidencia automática por teléfono -- todavía sin confirmar a mano">🔍 ${escapeHtml(clienteBsale.nombre)} (por confirmar)</span></b></div>`;
}
function renderFichaBandeja(data){
  const c = data.conversacion, ct = data.contacto, ai = data.analisisIa;
  const resInfo = resultadoComercialInfo(c);

  let proximaAccionHtml;
  if (c.requiereSeguimiento) {
    proximaAccionHtml = `
      <div class="ficha-fila"><span>Acción pendiente</span><b style="text-align:left;max-width:200px;">${escapeHtml(c.seguimientoObservaciones || 'Hacer seguimiento')}</b></div>
      <div class="ficha-fila"><span>Fecha</span><b>${c.seguimientoEn ? fmtFecha(c.seguimientoEn) : '—'}</b></div>
      <div class="ficha-fila"><span>Estado</span><b><span class="badge ${SEGUIMIENTO_ESTADO_BADGE[c.seguimientoEstado] || 'b-gris'}">${SEGUIMIENTO_ESTADO_LABEL[c.seguimientoEstado] || c.seguimientoEstado || 'Pendiente'}</span></b></div>`;
  } else if (resInfo.clave === 'en_seguimiento' && c.bsaleDocumentoNumero && !c.venta) {
    proximaAccionHtml = `<div class="ficha-fila"><span>Acción pendiente</span><b style="text-align:left;">Confirmar venta sugerida (Bsale)</b></div>`;
  } else {
    proximaAccionHtml = `<div class="ficha-fila"><span>Acción pendiente</span><b class="sub">Ninguna registrada</b></div>`;
  }

  $('panelFichaBandeja').innerHTML = `
    <div class="ficha-bandeja-head">
      <h2 style="font-size:13.5px;margin:0;">Ficha del cliente</h2>
      <button class="btn-ghost btn-compact btn-cerrar-panel-movil" onclick="cerrarFichaMovil()">✕</button>
    </div>
    <div class="ficha-bandeja-body">
      <div class="ficha-grupo">
        <h3>👤 Cliente</h3>
        <div class="ficha-fila"><span>Nombre</span><b>${escapeHtml(ct?.nombre || 'Sin nombre')}</b></div>
        <div class="ficha-fila"><span>Teléfono</span><b>${enlaceWhatsappTelefono(ct?.telefono)}</b></div>
        <div class="ficha-fila"><span>1ª conversación</span><b>${fmtFecha(ct?.primeraConversacionEn)}</b></div>
        <div class="ficha-fila"><span>Última conversación</span><b>${fmtFecha(ct?.ultimaConversacionEn)}</b></div>
        ${fichaBsaleHtml(data.clienteBsale)}
      </div>
      <div class="ficha-grupo">
        <h3>⚙️ Gestión</h3>
        <div class="ficha-fila"><span>Estado</span><b><select onchange="guardarCampoConvBandeja(${c.id}, 'estado', this.value)" style="font-size:12px;">${WHATSAPP_ESTADOS_ATENCION_EDITABLES.map(e => `<option value="${e}" ${e === c.estado ? 'selected' : ''}>${ESTADO_LABEL[e]}</option>`).join('')}</select></b></div>
        <div class="ficha-fila"><span>Responsable</span><b><select onchange="guardarCampoConvBandeja(${c.id}, 'responsableId', this.value)" style="font-size:12px;">${opcionesResponsable(c.responsableId, false)}</select></b></div>
        <div class="ficha-fila"><span>Prioridad</span><b><select disabled style="font-size:12px;" title="Todavía no es un campo propio del sistema -- no se guarda ninguna prioridad hoy, así que no se puede editar algo que no existe."><option>Normal</option></select></b></div>
      </div>
      <div class="ficha-grupo">
        <h3>✨ Resumen IA</h3>
        ${ai ? `
          <div class="ficha-fila"><span>Resumen</span><b style="text-align:left;max-width:200px;">${escapeHtml(ai.resumen || 'Por confirmar')}</b></div>
          <div class="ficha-fila"><span>Intención</span><b>${ai.intencion ? (INTENCION_LABEL[ai.intencion] || ai.intencion) : 'Por confirmar'} <span class="sub" style="font-size:9.5px;">(${origenCampoLabel(c, 'intencion')})</span></b></div>
          <div class="ficha-fila"><span>Categoría</span><b>${ai.categoria ? (CATEGORIA_LABEL[ai.categoria] || ai.categoria) : 'Por confirmar'}</b></div>
          <div class="ficha-fila"><span>Producto/modelo</span><b>${productoDisplayHtml(c)} <span class="sub" style="font-size:9.5px;">(${origenCampoLabel(c, 'modelo')})</span></b></div>
          <div class="ficha-fila"><span>Prob. de compra</span><b>${probabilidadDisplayHtml(c)}</b></div>
        ` : `<p class="sub">Sin análisis todavía. <button class="btn-ghost btn-compact" onclick="analizarConversacionIA(${c.id})">🤖 Analizar con IA</button></p>`}
      </div>
      <div class="ficha-grupo">
        <h3>📅 Próxima acción</h3>
        ${proximaAccionHtml}
        <button class="btn-ghost btn-compact" style="margin-top:8px;" onclick="programarSeguimientoBandeja(${c.id})">📅 Programar seguimiento</button>
      </div>
      <details class="ficha-colapsable">
        <summary>🛒 Compras y pedidos</summary>
        <div class="ficha-fila"><span>Resultado comercial</span><b><span class="badge ${resInfo.badge}">${resInfo.label}</span></b></div>
        ${c.shopifyProductoUrl ? `<div class="ficha-fila"><span>Shopify</span><b>${shopifyCellHtml(c)}</b></div>` : ''}
        <div class="ficha-fila"><span>Venta</span><b>${ventaCellHtml(c)}</b></div>
        ${!c.venta ? `<div class="ficha-fila"><span></span><b><button class="btn-ghost btn-compact" onclick="abrirAsociarVenta(${c.id}, ${c.bsaleDocumentoMonto || 0}, '${escapeHtml(c.bsaleDocumentoNumero || '')}')">${c.bsaleDocumentoNumero ? 'Confirmar esta venta' : 'Asociar venta'}</button></b></div>` : ''}
        ${c.motivoPerdida ? `<div class="ficha-fila"><span>Motivo de pérdida</span><b>${MOTIVO_PERDIDA_LABEL[c.motivoPerdida] || escapeHtml(c.motivoPerdida)} <span class="sub" style="font-size:9.5px;">(${origenCampoLabel(c, 'motivo_perdida')})</span></b></div>` : ''}
      </details>
      <details class="ficha-colapsable">
        <summary>🏷️ Etiquetas</summary>
        <div style="padding:6px 0;">${(data.etiquetas || []).map(e => `<span class="etiqueta-chip">${escapeHtml(e)}</span>`).join('') || '<span class="sub">Sin etiquetas.</span>'}</div>
      </details>
      <details class="ficha-colapsable">
        <summary>🕓 Historial y auditoría</summary>
        <div style="padding:6px 0;">
          ${(data.auditoria || []).slice(0, 8).map(a => `<div class="ficha-fila"><span>${fmtFechaHora(a.fecha)}</span><b style="text-align:left;max-width:200px;">${escapeHtml(a.detalle)}</b></div>`).join('') || '<span class="sub">Sin registros.</span>'}
        </div>
      </details>
    </div>
  `;
}

// ---------------- Responsive: navegación lista/chat/ficha en pantallas chicas ----------------
function mostrarPanelMovil(cual){
  if (cual === 'ficha') {
    $('panelFichaBandeja').classList.add('abierta-movil');
    const o = $('overlayFichaMovil'); if (o) o.classList.add('abierto');
    return;
  }
  cerrarFichaMovil();
  const lista = $('panelLista'), chat = $('panelChat');
  if (lista) lista.classList.toggle('activa', cual === 'lista');
  if (chat) chat.classList.toggle('activa', cual === 'chat');
}
function cerrarFichaMovil(){
  const f = $('panelFichaBandeja'); if (f) f.classList.remove('abierta-movil');
  const o = $('overlayFichaMovil'); if (o) o.classList.remove('abierto');
}

// ---------------- Tabla de supervisión (columnas reducidas por defecto) ----------------
// Ordena solo las filas de la página actual (esta tabla pagina server-side
// y ordenar el dataset completo implicaría un cambio de API más grande) --
// mismo criterio de siempre, extendido a las columnas nuevas.
function flechaConv(campo){
  if (convState.orden === campo + '_asc') return ' ▲';
  if (convState.orden === campo + '_desc') return ' ▼';
  return '';
}
function ordenarConv(campo){
  convState.orden = convState.orden === campo + '_desc' ? campo + '_asc' : campo + '_desc';
  renderTheadConv();
  renderTablaConv(convState.ultimaData || []);
}
function toggleColumnasExtendidas(){
  convState.columnasExtendidas = !convState.columnasExtendidas;
  $('btnColumnasExtendidas').textContent = convState.columnasExtendidas ? '➖ Menos columnas' : '➕ Más columnas';
  renderTheadConv();
  renderTablaConv(convState.ultimaDataOrdenada || convState.ultimaData || []);
}
function renderTheadConv(){
  const ext = convState.columnasExtendidas;
  $('theadConv').innerHTML = `
    <th>Cliente</th>
    <th class="ordenable" onclick="ordenarConv('fecha')">Última interacción${flechaConv('fecha')}</th>
    <th class="ordenable" onclick="ordenarConv('estado')">Estado de atención${flechaConv('estado')}</th>
    <th class="ordenable" onclick="ordenarConv('responsable')">Responsable${flechaConv('responsable')}</th>
    <th>Próxima acción</th>
    <th>Alerta principal</th>
    ${ext ? `
      <th>Teléfono</th>
      <th>Último mensaje</th>
      <th class="ordenable" onclick="ordenarConv('intencion')">Intención${flechaConv('intencion')}</th>
      <th>Producto</th><th>Shopify</th>
      <th class="ordenable" onclick="ordenarConv('respuesta')">1ª respuesta${flechaConv('respuesta')}</th>
      <th class="ordenable" onclick="ordenarConv('probabilidad')">Prob. compra${flechaConv('probabilidad')}</th>
      <th class="ordenable" onclick="ordenarConv('resultado')">Resultado comercial${flechaConv('resultado')}</th>
      <th class="amount ordenable" onclick="ordenarConv('venta')">Venta${flechaConv('venta')}</th>
      <th>IA</th>
    ` : ''}
  `;
}
function renderTablaConv(lista){
  const colspan = convState.columnasExtendidas ? 17 : 6;
  if (!lista.length) { $('tablaConv').innerHTML = `<tr><td colspan="${colspan}" class="empty-note">No hay conversaciones que calcen con los filtros.</td></tr>`; return; }
  let ordenada = [...lista];
  const VALOR_ORDEN_CONV = {
    fecha: c => new Date(c.ultimoMensajeEn || c.fecha).getTime(),
    respuesta: c => c.primeraRespuestaSegundos ?? Infinity,
    estado: c => estadoAtencionInfo(c).label,
    intencion: c => (c.intencion ? (INTENCION_LABEL[c.intencion] || c.intencion) : ''),
    probabilidad: c => c.probabilidadCompra ?? -1,
    resultado: c => resultadoComercialInfo(c).label,
    venta: c => c.montoVenta || c.bsaleDocumentoMonto || 0,
    responsable: c => c.responsableNombre || c.vendedorDetectado || '',
  };
  const [, campo, dir] = convState.orden.match(/^(.+)_(asc|desc)$/) || [];
  if (campo && VALOR_ORDEN_CONV[campo]) {
    const valor = VALOR_ORDEN_CONV[campo];
    ordenada.sort((a, b) => {
      const av = valor(a), bv = valor(b);
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return dir === 'asc' ? cmp : -cmp;
    });
  }
  convState.ultimaDataOrdenada = ordenada; // orden realmente mostrado -- lo usa la navegación "Anterior/Siguiente" del modal de detalle

  $('tablaConv').innerHTML = ordenada.map(c => {
    const info = estadoAtencionInfo(c);
    const proxima = c.requiereSeguimiento ? `📅 ${c.seguimientoEn ? fmtFecha(c.seguimientoEn) : 'Seguimiento'}` : '<span class="sub">—</span>';
    return `
    <tr class="fila-clic" onclick="abrirConversacion(${c.id}, 'conversaciones')">
      <td>${escapeHtml(c.clienteNombre || 'Sin nombre')}${c.cantidadImagenes > 0 ? ' 📷' : ''}</td>
      <td>${fmtFechaHora(c.ultimoMensajeEn || c.fecha)}</td>
      <td><span class="badge ${info.badge}">${info.label}</span></td>
      <td>${responsableCellHtml(c)}</td>
      <td>${proxima}</td>
      <td>${alertaPrincipalHtml(c)}</td>
      ${convState.columnasExtendidas ? `
        <td>${escapeHtml(c.clienteTelefono || '—')}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.ultimoMensaje || '—')}</td>
        <td>${c.intencion ? (INTENCION_LABEL[c.intencion] || c.intencion) : '—'}</td>
        <td>${productoDisplayHtml(c)}</td>
        <td>${shopifyCellHtml(c)}</td>
        <td>${c.primeraRespuestaSegundos != null ? fmtDuracion(c.primeraRespuestaSegundos) : (c.cantidadMensajes > 0 ? '<span class="badge b-rojo">Sin respuesta</span>' : '—')}</td>
        <td>${probabilidadDisplayHtml(c)}</td>
        <td>${(() => { const r = resultadoComercialInfo(c); return `<span class="badge ${r.badge}">${r.label}</span>`; })()}</td>
        <td class="amount">${ventaCellHtml(c)}</td>
        <td>${c.analisisDesactualizado ? `<button class="btn-ghost btn-compact" title="Nunca analizada, o llegaron mensajes nuevos después del último análisis" onclick="event.stopPropagation(); analizarDesdeListado(${c.id}, this)">🤖 Analizar</button>` : ''}</td>
      ` : ''}
    </tr>
  `;}).join('');
}
// Analizar con IA una conversación directo desde el listado (sin tener que
// abrirla) -- botón solo visible si analisisDesactualizado (ver
// mapearConversacionWhatsapp). event.stopPropagation() en el onclick evita
// que dispare también el click de la fila (que abre el detalle).
async function analizarDesdeListado(conversacionId, btn){
  btn.disabled = true; btn.textContent = 'Analizando…';
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-analizar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversacionId }),
    });
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || 'No se pudo analizar la conversación.'); btn.disabled = false; btn.textContent = '🤖 Analizar'; return; }
    cargarConversaciones();
  }catch(err){
    alert('Error: ' + err.message);
    btn.disabled = false; btn.textContent = '🤖 Analizar';
  }
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

// ---- Detalle de conversación (modal, punto 11/12/13) ----
let conversacionAbiertaId = null;
// Lista para los botones "← Anterior"/"Siguiente →" del modal -- solo
// tiene sentido cuando se abre desde la tabla de Conversaciones (mismo
// orden que se ve ahí, filtros y ordenamiento incluidos); si se abre
// desde Seguimientos o el historial de un Cliente, queda null y los
// botones se ocultan (no hay una "lista" clara de la cual sea obvio
// cuál es la anterior/siguiente en esos contextos).
let listaNavegacionConv = null;

async function abrirConversacion(id, origenLista){
  conversacionAbiertaId = id;
  listaNavegacionConv = origenLista === 'conversaciones' ? (convState.ultimaDataOrdenada || null) : null;
  $('modalConvTitulo').textContent = 'Conversación #' + id;
  $('modalConvBody').innerHTML = '<p class="empty-note">Cargando…</p>';
  $('modalConversacion').classList.add('abierto');
  actualizarBotonesNavegacionConv();
  await refrescarConversacionAbierta(id);
}
function actualizarBotonesNavegacionConv(){
  const btnAnt = $('btnConvAnterior'), btnSig = $('btnConvSiguiente');
  if (!listaNavegacionConv || !listaNavegacionConv.length) {
    btnAnt.style.display = 'none'; btnSig.style.display = 'none';
    return;
  }
  btnAnt.style.display = ''; btnSig.style.display = '';
  const idx = listaNavegacionConv.findIndex(c => c.id === conversacionAbiertaId);
  btnAnt.disabled = idx <= 0;
  btnSig.disabled = idx === -1 || idx >= listaNavegacionConv.length - 1;
}
function irConversacionAdyacente(delta){
  if (!listaNavegacionConv) return;
  const idx = listaNavegacionConv.findIndex(c => c.id === conversacionAbiertaId);
  const nuevoIdx = idx + delta;
  if (idx === -1 || nuevoIdx < 0 || nuevoIdx >= listaNavegacionConv.length) return;
  abrirConversacion(listaNavegacionConv[nuevoIdx].id, 'conversaciones');
}
// Vuelve a pedir el detalle y repinta el contenido, SIN pasar por el
// estado de "Cargando…" ni tocar la clase "abierto" -- eso es lo que
// causaba el parpadeo/minimizado al enviar un mensaje: abrirConversacion
// reseteaba el modal entero aunque ya estuviera abierto y mostrando algo.
async function refrescarConversacionAbierta(id){
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

function abrirImagenAmpliada(src){
  $('lightboxImagenImg').src = src;
  $('lightboxImagen').classList.add('abierto');
}
function cerrarImagenAmpliada(){
  $('lightboxImagen').classList.remove('abierto');
  $('lightboxImagenImg').src = '';
}
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrarImagenAmpliada(); });

function burbujaMensaje(m){
  const clase = m.direccion === 'in' ? 'in' : 'out';
  let contenido;
  if (m.tipo === 'texto') {
    contenido = escapeHtml(m.texto || '');
  } else if (m.tipo === 'imagen' && m.mediaUrl) {
    const src = '/api/negocio?recurso=whatsapp-media&ref=' + encodeURIComponent(m.mediaUrl);
    contenido = `<img src="${src}" loading="lazy" alt="Imagen" style="max-width:220px;max-height:220px;border-radius:8px;display:block;object-fit:cover;cursor:zoom-in;" onclick="event.stopPropagation(); abrirImagenAmpliada('${src.replace(/'/g, "\\'")}')" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'tipo-media',textContent:'📎 [imagen no disponible]'}))">`;
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

  // Origen REAL según Shopify (customerJourneySummary del pedido) -- cómo
  // llegó el cliente al sitio ANTES de comprar (Google Ads, orgánico,
  // directo, etc.), distinto de "Fuente de ingreso" (que es sobre el clic
  // en WhatsApp). Solo existe cuando la venta se vinculó a un pedido de
  // Shopify con tracking disponible.
  const origenRealHtml = (c.shopifyJourneyFuente || c.shopifyJourneyMedio || c.shopifyJourneyCampana)
    ? `<div class="ficha-fila"><span>Origen real (Shopify)</span><b>${[c.shopifyJourneyFuente, c.shopifyJourneyMedio, c.shopifyJourneyCampana].filter(Boolean).map(escapeHtml).join(' / ')}</b></div>`
    : '';

  let ventaHtml;
  if (c.venta) {
    ventaHtml = `<div class="ficha-fila"><span>Venta</span><b>${fmtMoneda(c.montoVenta)}${c.pedidoAsociado ? ' — Pedido ' + escapeHtml(c.pedidoAsociado) : ''}</b></div>${origenRealHtml}`;
  } else if (c.bsaleDocumentoNumero) {
    // Sugerencia automática (por teléfono, ver buscarVentaBsalePorTelefono)
    // -- todavía no es una venta confirmada, solo una pista para revisar.
    ventaHtml = `
      <div class="ficha-fila"><span>Venta</span><b>
        <span class="sub">🧾 Sugerido: ${fmtMoneda(c.bsaleDocumentoMonto)} — ${escapeHtml(c.bsaleDocumentoTipo || 'Documento')} ${escapeHtml(c.bsaleDocumentoNumero)}${c.bsaleDocumentoUrl ? ` <a href="${escapeHtml(c.bsaleDocumentoUrl)}" target="_blank" rel="noopener">(ver)</a>` : ''}</span>
      </b></div>
      <div class="ficha-fila"><span></span><b>
        <button class="btn-ghost btn-compact" onclick="abrirAsociarVenta(${c.id}, ${c.bsaleDocumentoMonto || 0}, '${escapeHtml(c.bsaleDocumentoNumero)}')">Confirmar esta venta</button>
      </b></div>${origenRealHtml}`;
  } else {
    ventaHtml = `<div class="ficha-fila"><span>Venta</span><b><button class="btn-ghost btn-compact" onclick="abrirAsociarVenta(${c.id})">Asociar venta</button></b></div>`;
  }

  // Responder desde el ERP: solo texto libre, y solo dentro de la ventana
  // de 24h desde el último mensaje del cliente (WhatsApp exige plantillas
  // pre-aprobadas fuera de eso, no implementado todavía). ventanaAbierta
  // la calcula el servidor (fuente de verdad real), no este JS.
  const composerHtml = data.ventanaAbierta
    ? `<div class="composer-hilo">
         <textarea id="composerTexto${c.id}" rows="1" placeholder="Escribe una respuesta…" onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); enviarMensajeWhatsapp(${c.id});}"></textarea>
         <button class="btn-primary btn-compact btn-enviar" id="btnEnviarMensaje" onclick="enviarMensajeWhatsapp(${c.id})">Enviar</button>
       </div>`
    : `<div class="composer-cerrado">🔒 Pasaron más de 24h desde el último mensaje del cliente — WhatsApp ya no permite texto libre acá (se necesita una plantilla pre-aprobada, no disponible todavía).</div>`;

  $('modalConvBody').innerHTML = `
    <div class="detalle-conv">
      <div class="columna-hilo">
        <div class="panel-hilo" id="panelHilo">${hilo}</div>
        ${composerHtml}
      </div>
      <div class="panel-ficha">
        <div class="ficha-grupo">
          <h3>👤 Cliente</h3>
          <div class="ficha-fila"><span>Nombre</span><b>${escapeHtml(ct?.nombre || 'Sin nombre')}</b></div>
          <div class="ficha-fila"><span>Teléfono</span><b>${enlaceWhatsappTelefono(ct?.telefono)}</b></div>
          <div class="ficha-fila"><span>Primera conversación</span><b>${fmtFecha(ct?.primeraConversacionEn)}</b></div>
          <div class="ficha-fila"><span>Última conversación</span><b>${fmtFecha(ct?.ultimaConversacionEn)}</b></div>
          <div class="ficha-fila"><span>Total conversaciones</span><b>${fmtNum(ct?.totalConversaciones)}</b></div>
          ${bsaleMatchHtml(data.clienteBsale)}
        </div>
        <div class="ficha-grupo">
          <h3>💬 Conversación actual</h3>
          <div class="ficha-fila"><span>Fecha inicio</span><b>${fmtFechaHora(c.fecha)}</b></div>
          <div class="ficha-fila"><span>Origen</span><b>${(() => { const f = fuenteInfo(c); const contenido = `${f.icono} ${escapeHtml(f.texto)}${c.fuenteUrl ? ` <a href="${escapeHtml(c.fuenteUrl)}" target="_blank" rel="noopener">(ver)</a>` : ''}`; return f.esSub ? `<span class="sub">${contenido}</span>` : contenido; })()}</b></div>
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
  const panelHilo = $('panelHilo');
  if (panelHilo) panelHilo.scrollTop = panelHilo.scrollHeight;
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
async function enviarMensajeWhatsapp(conversacionId){
  const textarea = $('composerTexto' + conversacionId);
  const btn = $('btnEnviarMensaje');
  const texto = textarea.value.trim();
  if (!texto) return;
  textarea.disabled = true;
  if (btn) btn.disabled = true;
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-enviar-mensaje', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversacionId, texto }),
    });
    const data = await res.json();
    if (!res.ok || data.error) { alert(data.error || 'No se pudo enviar el mensaje.'); return; }
    await refrescarConversacionAbierta(conversacionId); // recarga el hilo con el mensaje ya enviado, sin parpadeo
    cargarConversaciones();
  }catch(err){ alert('Error: ' + err.message); }
  finally{
    // El textarea puede ya no existir si abrirConversacion recargó el modal.
    const t = $('composerTexto' + conversacionId);
    if (t) t.disabled = false;
    const b = $('btnEnviarMensaje');
    if (b) b.disabled = false;
  }
}
function abrirAsociarVenta(conversacionId, montoSugerido, pedidoSugerido){
  const monto = prompt('Monto de la venta (CLP):', montoSugerido != null ? String(montoSugerido) : '');
  if (!monto || isNaN(Number(monto))) return;
  const pedido = prompt('Número de pedido asociado (opcional):', pedidoSugerido || '') || null;
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

// ================= CLIENTES =================
// orden/ordenAsc viajan al backend (la tabla pagina server-side, así que
// no alcanza con reordenar solo las filas ya traídas) -- ver
// ORDEN_CLIENTES_WHATSAPP en negocio.js para la whitelist de columnas.
let clientesState = { page: 1, pageSize: 500, q: '', orden: 'ultimaConversacion', ordenAsc: false, recurrencia: '', ventas: '' };
function flechaClientes(col){ return clientesState.orden === col ? (clientesState.ordenAsc ? ' ▲' : ' ▼') : ''; }
function cambiarOrdenClientes(col){
  if(clientesState.orden === col) clientesState.ordenAsc = !clientesState.ordenAsc;
  else { clientesState.orden = col; clientesState.ordenAsc = false; }
  clientesState.page = 1;
  renderTheadClientes(); // solo las flechas -- cargarClientes() no toca el thead, para no perder el foco del buscador
  cargarClientes();
}
function renderTheadClientes(){
  $('theadClientes').innerHTML = `
    <th>Cliente</th><th>Teléfono</th><th>Correo</th><th>Atendido por</th>
    <th class="ordenable" onclick="cambiarOrdenClientes('primeraConversacion')">1ª conversación${flechaClientes('primeraConversacion')}</th>
    <th class="ordenable" onclick="cambiarOrdenClientes('ultimaConversacion')">Última conversación${flechaClientes('ultimaConversacion')}</th>
    <th class="ordenable" onclick="cambiarOrdenClientes('numConversaciones')">Nº conversaciones${flechaClientes('numConversaciones')}</th>
    <th>Productos consultados</th>
    <th class="ordenable" onclick="cambiarOrdenClientes('numVentas')">Nº ventas${flechaClientes('numVentas')}</th>
    <th class="amount ordenable" onclick="cambiarOrdenClientes('totalComprado')">Total comprado${flechaClientes('totalComprado')}</th>
    <th>Última intención</th>
    <th class="ordenable" onclick="cambiarOrdenClientes('estado')">Estado${flechaClientes('estado')}</th>
  `;
}
function initClientes(){
  $('vistaClientes').innerHTML = `
    <div class="seccion">
      <div class="seccion-head"><div><h2>Clientes</h2><div class="sub">Clientes únicos que han escrito por WhatsApp (no conversaciones individuales).</div></div></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
        <div class="buscador-wrap" style="margin:0;flex:1 1 280px;max-width:420px;"><span class="icono-buscar">🔍</span><input type="text" id="buscadorClientes" placeholder="Buscar por nombre, teléfono o correo..."></div>
        <select id="filtroRecurrenciaClientes" onchange="cambiarFiltroClientes()" title="Recurrentes: clientes con 2 o más conversaciones">
          <option value="">Conversaciones: todos</option><option value="recurrentes">Recurrentes (2 o más)</option><option value="nuevos">Nuevos (1 conversación)</option>
        </select>
        <select id="filtroVentasClientes" onchange="cambiarFiltroClientes()" title="Ventas confirmadas o vinculadas a un documento de Bsale/Shopify">
          <option value="">Ventas: todos</option><option value="con">Con ventas</option><option value="sin">Sin ventas</option>
        </select>
        <button class="btn-ghost btn-compact" onclick="limpiarFiltrosClientes()">✕ Limpiar</button>
      </div>
      <div class="tabla-wrap">
        <table>
          <thead><tr id="theadClientes"></tr></thead>
          <tbody id="tablaClientes"><tr><td colspan="12" class="empty-note">Cargando…</td></tr></tbody>
        </table>
      </div>
      <div id="paginacionClientes" style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12.5px;color:var(--muted);"></div>
    </div>
  `;
  renderTheadClientes();
  $('buscadorClientes').addEventListener('input', debounce(() => { clientesState.q = $('buscadorClientes').value.trim(); clientesState.page = 1; cargarClientes(); }, 350));
  cargarClientes();
}
function cambiarFiltroClientes(){
  clientesState.recurrencia = $('filtroRecurrenciaClientes').value;
  clientesState.ventas = $('filtroVentasClientes').value;
  clientesState.page = 1;
  cargarClientes();
}
function limpiarFiltrosClientes(){
  $('filtroRecurrenciaClientes').value = ''; $('filtroVentasClientes').value = ''; $('buscadorClientes').value = '';
  clientesState.recurrencia = ''; clientesState.ventas = ''; clientesState.q = ''; clientesState.page = 1;
  cargarClientes();
}
function atendidoPorHtml(lista){
  const nombres = lista || [];
  if(!nombres.length) return '<span class="empty-note">—</span>';
  const resto = nombres.length > 2 ? ` <span class="badge b-gris" title="${escapeHtml(nombres.join(', '))}">+${nombres.length - 2}</span>` : '';
  return escapeHtml(nombres.slice(0, 2).join(', ')) + resto;
}
async function cargarClientes(){
  const params = new URLSearchParams({ page: clientesState.page, pageSize: clientesState.pageSize, q: clientesState.q, orden: clientesState.orden, ordenAsc: clientesState.ordenAsc ? '1' : '0', recurrencia: clientesState.recurrencia, ventas: clientesState.ventas });
  try{
    const res = await fetch('/api/negocio?recurso=whatsapp-clientes&' + params.toString());
    const data = await res.json();
    if (!res.ok || data.error) { $('tablaClientes').innerHTML = `<tr><td colspan="12" class="empty-note">${data.error || 'Error al cargar.'}</td></tr>`; return; }
    if (!data.clientes.length) { $('tablaClientes').innerHTML = '<tr><td colspan="12" class="empty-note">No hay clientes que calcen con la búsqueda y los filtros.</td></tr>'; $('paginacionClientes').innerHTML = ''; return; }
    $('tablaClientes').innerHTML = data.clientes.map(c => `
      <tr class="fila-clic" onclick="abrirCliente(${c.id})">
        <td>${escapeHtml(c.nombre || 'Sin nombre')}${c.bsaleClienteId ? ' <span class="badge b-verde" title="Cliente Bsale: ' + escapeHtml(c.bsaleClienteNombre) + '">✓ Bsale</span>' : ''}</td>
        <td>${enlaceWhatsappTelefono(c.telefono)}</td>
        <td>${c.correo ? `<a href="mailto:${escapeHtml(c.correo)}" onclick="event.stopPropagation()">${escapeHtml(c.correo)}</a>` : '<span class="empty-note">—</span>'}</td>
        <td>${atendidoPorHtml(c.atendidoPor)}</td>
        <td>${fmtFecha(c.primeraConversacion)}</td>
        <td>${fmtFecha(c.ultimaConversacion)}</td>
        <td>${fmtNum(c.numConversaciones)}${c.numConversaciones >= 2 ? ' <span class="badge b-azul">Recurrente</span>' : ''}</td>
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
    $('tablaClientes').innerHTML = `<tr><td colspan="12" class="empty-note">Error: ${escapeHtml(err.message)}</td></tr>`;
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
        <div class="ficha-fila"><span>Teléfono</span><b>${enlaceWhatsappTelefono(cl.telefono)}</b></div>
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
                <td>${badgeResultado(c.resultado)}</td><td class="amount">${ventaCellHtml(c)}</td>
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
function hoyStrAnalitica(){ return new Date().toLocaleDateString('en-CA'); } // en-CA = YYYY-MM-DD
function addDiasAnalitica(dateStr, dias){
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0,10);
}
function primerDiaMesAnalitica(dateStr){
  const [y,m] = dateStr.split('-').map(Number);
  return `${y}-${String(m).padStart(2,'0')}-01`;
}

function initAnalitica(){
  $('vistaAnalitica').innerHTML = `
    <div class="seccion">
      <div class="seccion-head">
        <div><h2>Período</h2><div class="sub">Elige el rango de fechas para toda la analítica.</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div class="date-field"><label for="analiticaDesde">Desde</label><input type="date" id="analiticaDesde"></div>
        <div class="date-field"><label for="analiticaHasta">Hasta</label><input type="date" id="analiticaHasta"></div>
        <button class="btn-primary btn-compact" title="Buscar este rango" onclick="buscarRangoAnalitica()">🔍</button>
        <button class="btn-ghost btn-compact" data-rango-rapido="dia" onclick="setRangoRapidoAnalitica('dia')">Día (Hoy)</button>
        <button class="btn-ghost btn-compact" data-rango-rapido="ayer" onclick="setRangoRapidoAnalitica('ayer')">Ayer</button>
        <button class="btn-ghost btn-compact" data-rango-rapido="semana" onclick="setRangoRapidoAnalitica('semana')">Última semana</button>
        <button class="btn-ghost btn-compact" data-rango-rapido="mes" onclick="setRangoRapidoAnalitica('mes')">Este mes</button>
        <button class="btn-ghost btn-compact activo" data-rango-rapido="30d" onclick="setRangoRapidoAnalitica('30d')">30 días</button>
        <button class="btn-primary btn-compact" onclick="buscarRangoAnalitica()">Actualizar</button>
      </div>
    </div>
    <div class="seccion">
      <h2>Evolución temporal</h2>
      <div class="sub">Conversaciones, clientes únicos y ventas.</div>
      <div id="chartSerie"></div>
    </div>
    <div class="seccion">
      <h2>Horarios de los mensajes</h2>
      <div class="sub">Hora de Chile en que el cliente escribió por primera vez, una vez por conversación. Primero el general del período; abajo puedes ver el horario de cada categoría principal.</div>
      <div id="chartHorarios" style="margin-top:12px;"></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;">
      <div class="seccion">
        <h2>Categorías consultadas</h2>
        <div id="chartCategorias" style="margin-top:12px;"></div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-ghost btn-compact" onclick="verListadoOtra()">📋 Ver listado de "Otra" / sin categorizar</button>
          ${rolActual === 'admin' ? '<button class="btn-ghost btn-compact" id="btnReanalizarOtra" onclick="reanalizarOtra()">🔎 Reanalizar "Otra"</button><button class="btn-ghost btn-compact" id="btnReanalizarSinModelo" onclick="reanalizarOtra(\'sin_modelo\')" title="Reanaliza las conversaciones sin modelo de equipo detectado, para rescatar modelos que el análisis anterior no leyó">🔎 Reanalizar sin modelo</button>' : ''}
        </div>
        <div id="listadoOtra" style="margin-top:14px;"></div>
      </div>
      <div class="seccion">
        <h2>Embudo de conversión</h2>
        <div id="chartEmbudo" style="margin-top:12px;"></div>
      </div>
    </div>
    <div class="seccion">
      <h2>Embudo de ventas vinculadas a Bsale</h2>
      <div class="sub">A diferencia del embudo de arriba (que también cuenta ventas confirmadas a mano), este solo cuenta conversaciones con un documento real de Bsale encontrado por teléfono (no Shopify) cuya fecha de emisión cae dentro del período elegido -- el correo no sirve para este cruce porque WhatsApp no lo entrega, ver "Clientes de este período" más abajo.</div>
      <div id="chartEmbudoBsale" style="margin-top:12px;"></div>
    </div>
    <div class="seccion">
      <h2>Conversiones: intención de venta</h2>
      <div class="sub">En IndexStore una <b>conversión es una intención de venta</b>: le enviamos al cliente el <b>enlace del producto</b> y/o una oferta (precio, disponibilidad, condiciones, dónde atendemos). La venta es conversacional y de confianza: el cliente puede decidir después o comparar con otro proveedor, pero la oportunidad quedó planteada. La venta confirmada es solo la etapa final y se registra poco. Se detecta en lo que escribe el negocio, no depende de la IA.</div>
      <div id="chartConversionComercial" style="margin-top:12px;"></div>
    </div>
    <div class="seccion">
      <h2>Motivos de pérdida</h2>
      <div class="sub" style="margin-bottom:10px;">Haz clic en un motivo para ver esas conversaciones, o en "📊 Analizar" para el detalle: qué se repite, palabras clave, cuándo dejó de responder el cliente y qué hacer.</div>
      <div class="tabla-wrap"><table>
        <thead><tr id="theadMotivos"></tr></thead>
        <tbody id="tablaMotivos"></tbody>
      </table></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;">
      <div class="seccion"><h2>Ranking de productos</h2><div class="tabla-wrap"><table>
        <thead><tr id="theadProductos"></tr></thead>
        <tbody id="tablaProductos"></tbody>
      </table></div></div>
      <div class="seccion"><h2>Marcas más consultadas</h2><div id="rankMarcas"></div></div>
      <div class="seccion"><h2>Modelos más consultados</h2><div id="rankModelos"></div></div>
    </div>
    <div class="seccion">
      <div class="seccion-head">
        <div><h2>Clientes de este período</h2><div class="sub">Clientes con al menos una conversación en el rango de fechas elegido arriba. El correo no es un dato de WhatsApp -- sale del cliente vinculado en Bsale por teléfono, así que no todos van a tener uno.</div></div>
        <button class="btn-ghost btn-compact btn-exportar" onclick="descargarClientesAnalitica()">⬇ Descargar CSV (nombre, teléfono, correo)</button>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr;">
        <div>
          <h3 style="margin:0 0 8px;font-size:13px;">👤 Nombres (<span id="totalClientesAnalitica">0</span>)</h3>
          <div id="listaClientesAnalitica" class="lista-clientes-analitica"></div>
        </div>
        <div>
          <h3 style="margin:0 0 8px;font-size:13px;">📧 Con correo (<span id="totalClientesCorreoAnalitica">0</span>)</h3>
          <div id="listaClientesCorreoAnalitica" class="lista-clientes-analitica"></div>
        </div>
      </div>
    </div>
    <div class="seccion">
      <h2>Resultados de conversaciones</h2>
      <div id="chartResultados" style="margin-top:12px;"></div>
    </div>
    <div class="seccion">
      <div class="seccion-head">
        <div><h2>Fuente de ingreso</h2><div class="sub">De dónde vienen las conversaciones: anuncios de Meta, un UTM real (Google Ads si utm_source=google, u otra plataforma), el botón de WhatsApp del sitio sin dato de campaña, origen desconocido, o el origen REAL de la venta según el tracking propio de Shopify (cómo llegó al sitio antes de comprar -- solo para ventas vinculadas a un pedido de Shopify con tracking disponible). Solo cuenta conversaciones con al menos un mensaje real.</div></div>
      </div>
      <div id="chartFuentes" style="margin-bottom:14px;"></div>
      <div class="tabla-wrap"><table>
        <thead><tr id="theadFuentesDetalle"></tr></thead>
        <tbody id="tablaFuentesDetalle"></tbody>
      </table></div>
    </div>
  `;
  const hoy = hoyStrAnalitica();
  $('analiticaDesde').value = addDiasAnalitica(hoy, -29);
  $('analiticaHasta').value = hoy;
  cargarAnalitica();
}
function setRangoRapidoAnalitica(tipo){
  const hoy = hoyStrAnalitica();
  let desde, hasta = hoy;
  if(tipo === 'dia'){ desde = hoy; }
  else if(tipo === 'ayer'){ desde = addDiasAnalitica(hoy, -1); hasta = desde; }
  else if(tipo === 'semana'){ desde = addDiasAnalitica(hoy, -6); }
  else if(tipo === 'mes'){ desde = primerDiaMesAnalitica(hoy); }
  else { desde = addDiasAnalitica(hoy, -29); } // '30d'
  $('analiticaDesde').value = desde;
  $('analiticaHasta').value = hasta;
  document.querySelectorAll('[data-rango-rapido]').forEach(b => b.classList.toggle('activo', b.dataset.rangoRapido === tipo));
  cargarAnalitica();
}
function buscarRangoAnalitica(){
  document.querySelectorAll('[data-rango-rapido]').forEach(b => b.classList.remove('activo'));
  cargarAnalitica();
}
async function cargarAnalitica(){
  const desde = $('analiticaDesde').value;
  const hasta = $('analiticaHasta').value;
  if(!desde || !hasta) return;
  if(desde > hasta){ $('chartSerie').innerHTML = '<p class="empty-note">"Desde" no puede ser posterior a "Hasta".</p>'; return; }
  try{
    const res = await fetch(`/api/negocio?recurso=whatsapp-analitica&desde=${desde}&hasta=${hasta}`);
    const data = await res.json();
    if (!res.ok || data.error) { $('chartSerie').innerHTML = `<p class="empty-note">${data.error || 'Error al cargar.'}</p>`; return; }
    renderChartSerie(data.serie, data.agrupacion);
    renderChartCategorias(data.distribucionCategoria);
    renderChartEmbudo(data.embudo);
    renderChartEmbudoBsale(data.embudoBsale);
    renderConversionComercial(data.conversionComercial);
    renderHorarios(data.horarios);
    renderFuentes(data.fuentes, data.fuentesDetalle);
    renderTablaMotivos(data.motivosPerdida);
    renderTablaProductos(data.rankingProductos);
    renderRanking('rankMarcas', data.rankingMarcas, 'marca');
    renderRanking('rankModelos', data.rankingModelos, 'modelo');
    renderChartResultados(data.resultados);
    renderClientesAnalitica(data.clientes);
  }catch(err){
    $('chartSerie').innerHTML = `<p class="empty-note">Error: ${escapeHtml(err.message)}</p>`;
  }
}
const FUENTE_TIPO_LABEL_ANALITICA = {
  google_ads: '🔍 Google Ads',
  utm: '🔗 Link con UTM (otro)',
  boton_sitio: '📎 Botón WhatsApp del sitio (sin campaña)',
  anuncio: '📢 Anuncio (Meta Ads)',
  desconocido: '❓ Origen desconocido',
  shopify_journey: '🛍️ Origen real de venta (Shopify)',
};
let fuentesDetalleActual = [];
let sortColFuentesDetalle = 'cantidad';
let sortAscFuentesDetalle = false;
function flechaFuentesDetalle(col){ return sortColFuentesDetalle === col ? (sortAscFuentesDetalle ? ' ▲' : ' ▼') : ''; }
function cambiarOrdenFuentesDetalle(col){
  if(sortColFuentesDetalle === col) sortAscFuentesDetalle = !sortAscFuentesDetalle;
  else { sortColFuentesDetalle = col; sortAscFuentesDetalle = false; }
  renderTablaFuentesDetalle();
}
function renderTablaFuentesDetalle(){
  $('theadFuentesDetalle').innerHTML = `
    <th>Fuente</th><th>Detalle</th>
    <th class="ordenable" onclick="cambiarOrdenFuentesDetalle('cantidad')">Conversaciones${flechaFuentesDetalle('cantidad')}</th>
  `;
  if (!fuentesDetalleActual.length) {
    $('tablaFuentesDetalle').innerHTML = '<tr><td colspan="3" class="empty-note">Sin detalle todavía (nadie llegó por un link con UTM o un anuncio identificado con nombre en este período).</td></tr>';
    return;
  }
  const lista = [...fuentesDetalleActual].sort((a, b) => sortAscFuentesDetalle ? a.cantidad - b.cantidad : b.cantidad - a.cantidad);
  $('tablaFuentesDetalle').innerHTML = lista.map(d => `
    <tr><td>${FUENTE_TIPO_LABEL_ANALITICA[d.tipo] || d.tipo}</td><td>${escapeHtml(d.titulo || '—')}</td><td>${fmtNum(d.cantidad)}</td></tr>
  `).join('');
}
function renderFuentes(fuentes, detalle){
  if (!fuentes || !fuentes.length) { $('chartFuentes').innerHTML = '<p class="empty-note">Sin datos.</p>'; $('tablaFuentesDetalle').innerHTML = ''; return; }
  const max = Math.max(1, ...fuentes.map(f => f.cantidad));
  $('chartFuentes').innerHTML = fuentes.map(f => `
    <div class="barra-horizontal">
      <div class="nombre">${FUENTE_TIPO_LABEL_ANALITICA[f.tipo] || f.tipo}</div>
      <div class="pista"><div class="relleno" style="width:${(f.cantidad/max)*100}%;"></div></div>
      <div class="valor">${fmtNum(f.cantidad)} · ${fmtNum(f.ventas)} venta(s)</div>
    </div>
  `).join('');
  fuentesDetalleActual = detalle || [];
  renderTablaFuentesDetalle();
}
function labelBucket(fecha, agrupacion){
  const d = new Date(fecha);
  if (agrupacion === 'day') {
    const diaSemana = d.toLocaleDateString('es-CL', { weekday: 'short', timeZone: 'America/Santiago' }).replace('.', '');
    const fechaCorta = d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', timeZone: 'America/Santiago' });
    return `${diaSemana}<br>${fechaCorta}`;
  }
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
      <button class="btn-ghost btn-compact" style="flex-shrink:0;" title="Embudo, por qué se pierde, qué se consulta, fuentes, palabras y horarios de esta categoría" onclick="abrirPanelCategoria('${escapeHtml(d.categoria)}')">📊 Analizar</button>
    </div>
  `).join('');
}
// Compartido por los dos embudos (conversión general y ventas vinculadas a
// Bsale) -- misma mecánica de "↓X%" paso a paso y "% del total" acumulado,
// solo cambian las etapas.
function renderEmbudoGenerico(elId, pasos){
  const total = pasos[0].v; // primera etapa -- base contra la que se mide el % de cada una
  $(elId).innerHTML = `<div class="embudo">${pasos.map((p,i) => {
    // % del total: qué fracción de la primera etapa llegó a esta (distinto
    // del "↓X%" de abajo, que es el paso a paso entre dos etapas
    // consecutivas) -- pedido del usuario para saber, por ejemplo, qué
    // porcentaje de las conversaciones terminó en venta.
    const pctTotal = i > 0 && total > 0 ? `<span class="pct-total">(${(p.v/total*100).toFixed(1)}% del total)</span>` : '';
    return `
    <div class="paso"><span>${p.l}</span><span class="paso-valor"><b>${fmtNum(p.v)}</b>${pctTotal}</span></div>
    ${i < pasos.length - 1 ? `<div class="flecha">↓ ${pasos[i].v > 0 ? Math.round((pasos[i+1].v/pasos[i].v)*100) : 0}%</div>` : ''}
  `;
  }).join('')}</div>`;
}
function renderChartEmbudo(e){
  renderEmbudoGenerico('chartEmbudo', [
    { l: 'Conversaciones', v: e.conversaciones },
    { l: 'Intención de compra', v: e.intencion_compra },
    { l: 'Cotización', v: e.cotizacion },
    { l: 'Venta', v: e.venta },
  ]);
}
// Segundo embudo: solo ventas con un documento real de Bsale encontrado por
// teléfono (no Shopify, no confirmadas a mano) cuya fecha de emisión cae
// dentro del período -- ver comentario en manejarWhatsappAnalitica.
function renderChartEmbudoBsale(eb){
  renderEmbudoGenerico('chartEmbudoBsale', [
    { l: 'Conversaciones', v: eb.conversaciones },
    { l: 'Vinculadas a Bsale', v: eb.vinculadas },
    { l: 'Venta en el período', v: eb.ventaEnPeriodo },
  ]);
}
let motivosActuales = [];
let sortColMotivos = 'cantidad';
let sortAscMotivos = false;
function flechaMotivos(col){ return sortColMotivos === col ? (sortAscMotivos ? ' ▲' : ' ▼') : ''; }
function cambiarOrdenMotivos(col){
  if(sortColMotivos === col) sortAscMotivos = !sortAscMotivos;
  else { sortColMotivos = col; sortAscMotivos = false; }
  renderTbodyMotivos();
}
function renderTbodyMotivos(){
  $('theadMotivos').innerHTML = `
    <th>Motivo</th>
    <th class="ordenable" onclick="cambiarOrdenMotivos('cantidad')">Cantidad${flechaMotivos('cantidad')}</th>
    <th class="ordenable" onclick="cambiarOrdenMotivos('porcentaje')">%${flechaMotivos('porcentaje')}</th>
    <th>Recomendación</th><th></th>
  `;
  if (!motivosActuales.length) { $('tablaMotivos').innerHTML = '<tr><td colspan="5" class="empty-note">Sin conversaciones perdidas en este período.</td></tr>'; return; }
  const lista = [...motivosActuales].sort((a, b) => sortAscMotivos ? a[sortColMotivos] - b[sortColMotivos] : b[sortColMotivos] - a[sortColMotivos]);
  $('tablaMotivos').innerHTML = lista.map(m => `
    <tr class="fila-clic" onclick="irAConversacionesConMotivo('${escapeHtml(m.motivo)}')">
      <td>${escapeHtml(m.etiqueta)}</td><td>${fmtNum(m.cantidad)}</td><td>${m.porcentaje}%</td>
      <td style="max-width:340px;font-size:12px;color:var(--muted);">${escapeHtml(MOTIVO_PERDIDA_RECOMENDACION[m.motivo] || 'Sin recomendación definida para este motivo.')}</td>
      <td style="white-space:nowrap;">${MOTIVOS_ANALIZABLES_UI.includes(m.motivo) ? `<button class="btn-primary btn-compact" title="Qué se repite, palabras clave, cuándo dejó de responder el cliente y qué hacer" onclick="event.stopPropagation(); abrirPanelMotivo('${escapeHtml(m.motivo)}')">📊 Analizar</button> ` : ''}<button class="btn-ghost btn-compact" onclick="event.stopPropagation(); irAConversacionesConMotivo('${escapeHtml(m.motivo)}')">👁️ Ver conversaciones</button></td>
    </tr>
  `).join('');
}
function renderTablaMotivos(motivos){
  motivosActuales = motivos || [];
  renderTbodyMotivos();
}
// Antes solo cambiaba de pestaña sin aplicar ningún filtro (bug real,
// detectado al probar el clic de la tabla de Motivos de pérdida) -- el
// filtro se deja seteado ANTES de cambiarVistaModulo('conversaciones'),
// porque si esa pestaña nunca se había abierto, initConversaciones() llama
// a cargarConversaciones() de inmediato y necesita encontrar convState.filtros
// ya listo. Si la pestaña ya estaba cargada, cambiarVistaModulo no hace
// nada más -> hay que recargar a mano.
function irAConversacionesConMotivo(motivo){
  const yaEstabaCargada = vistasCargadas.has('conversaciones');
  convState.filtros = { motivoPerdida: motivo };
  convState.filtroMotivoLabel = MOTIVO_PERDIDA_LABEL[motivo] || motivo;
  convState.q = ''; convState.page = 1;
  cambiarVistaModulo('conversaciones');
  if (yaEstabaCargada) {
    $('panelFiltrosConv').style.display = 'none';
    $('buscadorConv').value = '';
    cargarConversaciones();
  }
}
let productosActuales = [];
let sortColProductos = 'consultas';
let sortAscProductos = false;
function flechaProductos(col){ return sortColProductos === col ? (sortAscProductos ? ' ▲' : ' ▼') : ''; }
function cambiarOrdenProductos(col){
  if(sortColProductos === col) sortAscProductos = !sortAscProductos;
  else { sortColProductos = col; sortAscProductos = false; }
  renderTbodyProductos();
}
function renderTbodyProductos(){
  $('theadProductos').innerHTML = `
    <th>Producto</th>
    <th class="ordenable" onclick="cambiarOrdenProductos('consultas')">Consultas${flechaProductos('consultas')}</th>
    <th class="ordenable" onclick="cambiarOrdenProductos('ventas')">Ventas${flechaProductos('ventas')}</th>
    <th class="ordenable" onclick="cambiarOrdenProductos('conversion')">Conv.${flechaProductos('conversion')}</th>
  `;
  if (!productosActuales.length) { $('tablaProductos').innerHTML = '<tr><td colspan="4" class="empty-note">Sin datos.</td></tr>'; return; }
  const lista = [...productosActuales].sort((a, b) => sortAscProductos ? a[sortColProductos] - b[sortColProductos] : b[sortColProductos] - a[sortColProductos]);
  $('tablaProductos').innerHTML = lista.map(p => `
    <tr><td>${escapeHtml(p.producto)}</td><td>${fmtNum(p.consultas)}</td><td>${fmtNum(p.ventas)}</td><td>${p.conversion}%</td></tr>
  `).join('');
}
function renderTablaProductos(prods){
  productosActuales = prods || [];
  renderTbodyProductos();
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

// Clientes con al menos una conversación en el rango de Analítica --
// pedido del usuario: dos "ventanas" (nombres / con correo) + poder
// descargar la lista completa. Se guarda en una variable de módulo para
// que descargarClientesAnalitica() no tenga que volver a pedirle nada al
// servidor -- ya llegó todo junto con el resto de la analítica.
let clientesAnaliticaActuales = [];
function renderClientesAnalitica(clientes){
  clientesAnaliticaActuales = clientes || [];
  $('totalClientesAnalitica').textContent = fmtNum(clientesAnaliticaActuales.length);
  $('listaClientesAnalitica').innerHTML = clientesAnaliticaActuales.length
    ? clientesAnaliticaActuales.map(c => `
        <div class="fila-cliente-analitica">
          <span class="nombre-cliente-analitica">${escapeHtml(c.nombre || '(sin nombre)')}</span>
          <span class="dato-cliente-analitica">${escapeHtml(c.telefono || '—')}</span>
        </div>`).join('')
    : '<p class="empty-note" style="padding:12px;">Sin clientes en este período.</p>';

  const conCorreo = clientesAnaliticaActuales.filter(c => c.correo);
  $('totalClientesCorreoAnalitica').textContent = fmtNum(conCorreo.length);
  $('listaClientesCorreoAnalitica').innerHTML = conCorreo.length
    ? conCorreo.map(c => `
        <div class="fila-cliente-analitica">
          <span class="nombre-cliente-analitica">${escapeHtml(c.nombre || '(sin nombre)')}</span>
          <span class="dato-cliente-analitica">${escapeHtml(c.correo)}</span>
        </div>`).join('')
    : '<p class="empty-note" style="padding:12px;">Ningún cliente de este período tiene correo vinculado en Bsale.</p>';
}
// Mismo patrón de exportarCsv() en alertas-stock.html (BOM + comillas
// escapadas + descarga vía blob) -- lista COMPLETA del período filtrado
// (no solo lo que se ve en las dos ventanas), pedido explícito del usuario.
function descargarClientesAnalitica(){
  if(!clientesAnaliticaActuales.length){ alert('No hay clientes en este período para descargar.'); return; }
  const filas = [['Nombre','Teléfono','Correo']];
  for(const c of clientesAnaliticaActuales) filas.push([c.nombre || '', c.telefono || '', c.correo || '']);
  const csv = filas.map(f => f.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿'+csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `clientes-whatsapp-${$('analiticaDesde').value}-a-${$('analiticaHasta').value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ================= Análisis IA en lote (admin) =================
// El disparo automático (webhook) solo corre para mensajes NUEVOS -- las
// conversaciones que ya existían antes de activarlo se quedan sin
// analizar para siempre a menos que se corra esto una vez.
// Versión rápida y acotada de "Analizar pendientes": solo conversaciones
// iniciadas en las últimas 12 horas y sin análisis todavía -- pensado para
// ponerse al día con lo de hoy sin disparar una corrida sobre todo el
// backlog histórico (eso lo sigue haciendo "Analizar pendientes").
async function analizarRecientesIA(){
  const btn = $('btnAnalizarRecientes');
  btn.disabled = true;
  let totalAnalizadas = 0, totalErrores = 0, ultimoRestantesRecientes = 0;
  try{
    let completo = false;
    while (!completo) {
      const totalAprox = totalAnalizadas + (ultimoRestantesRecientes || 0);
      const pct = totalAprox ? Math.round(totalAnalizadas / totalAprox * 100) : 0;
      btn.textContent = totalAnalizadas > 0 ? `🤖 Analizando… ${pct}% (${totalAnalizadas} listas)` : '🤖 Analizando…';
      const res = await fetch('/api/negocio?recurso=whatsapp-analizar-pendientes&horas=12', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) { alert(data.error || 'No se pudo analizar las conversaciones recientes.'); break; }
      totalAnalizadas += data.analizadas; totalErrores += data.errores;
      ultimoRestantesRecientes = data.restantes || 0;
      completo = data.completo;
      if (data.analizadas === 0 && !completo) break; // nada avanzó, evita loop infinito
    }
    if (totalAnalizadas === 0 && totalErrores === 0) {
      // Silencioso a propósito (sin confirm/alert): pensado para poder
      // darle clic seguido sin fricción -- si no había nada pendiente,
      // no hace falta interrumpir con un aviso.
    } else {
      alert(`Análisis de recientes terminado: ${totalAnalizadas} conversaciones analizadas${totalErrores ? `, ${totalErrores} con error` : ''}.`);
    }
    vistasCargadas.clear();
    const vistaActiva = document.querySelector('.tab-modulo.activo').dataset.vista;
    cambiarVistaModulo(vistaActiva);
  }catch(err){ alert('Error: ' + err.message); }
  finally{ btn.disabled = false; btn.textContent = '🤖 Analizar recientes (12h)'; }
}
async function analizarPendientesIA(){
  if (!confirm('¿Analizar con IA todas las conversaciones que todavía no tienen análisis? Puede tardar varios minutos si hay muchas, y cada conversación tiene un costo pequeño en la API de Claude.')) return;
  const btn = $('btnAnalizarPendientes');
  btn.disabled = true;
  let totalAnalizadas = 0, totalErrores = 0, ultimoRestantesPendientes = 0;
  try{
    let completo = false;
    while (!completo) {
      const totalAprox = totalAnalizadas + (ultimoRestantesPendientes || 0);
      const pct = totalAprox ? Math.round(totalAnalizadas / totalAprox * 100) : 0;
      btn.textContent = totalAnalizadas > 0 ? `🤖 Analizando… ${pct}% (${totalAnalizadas} listas)` : '🤖 Analizando…';
      const res = await fetch('/api/negocio?recurso=whatsapp-analizar-pendientes', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) { alert(data.error || 'No se pudo analizar las conversaciones pendientes.'); break; }
      totalAnalizadas += data.analizadas; totalErrores += data.errores;
      ultimoRestantesPendientes = data.restantes || 0;
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

// El disparo automático a veces analiza con muy poca información todavía
// (ej. solo el saludo, antes de que el cliente diga qué producto quiere)
// y ese resultado queda pegado -- esto reanaliza las conversaciones donde
// llegaron mensajes nuevos después del último análisis, para ponerse al
// día en lote. Ver el comentario junto a DEBOUNCE_ANALISIS_IA_MS.
async function reanalizarDesactualizadas(){
  if (!confirm('¿Reanalizar conversaciones donde llegaron mensajes nuevos después del último análisis con IA? Puede tardar varios minutos, y cada reanálisis tiene un costo pequeño en la API de Claude.')) return;
  const btn = $('btnReanalizarDesactualizadas');
  btn.disabled = true;
  let totalReanalizadas = 0, totalErrores = 0, ultimoRestantesReanalisis = 0;
  try{
    let completo = false;
    while (!completo) {
      const totalAprox = totalReanalizadas + (ultimoRestantesReanalisis || 0);
      const pct = totalAprox ? Math.round(totalReanalizadas / totalAprox * 100) : 0;
      btn.textContent = totalReanalizadas > 0 ? `🔄 Reanalizando… ${pct}% (${totalReanalizadas} listas)` : '🔄 Reanalizando…';
      const res = await fetch('/api/negocio?recurso=whatsapp-reanalizar-desactualizadas', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) { alert(data.error || 'No se pudo reanalizar las conversaciones desactualizadas.'); break; }
      totalReanalizadas += data.reanalizadas; totalErrores += data.errores;
      ultimoRestantesReanalisis = data.restantes || 0;
      completo = data.completo;
      if (data.reanalizadas === 0 && !completo) break; // nada avanzó, evita loop infinito
    }
    alert(`Reanálisis terminado: ${totalReanalizadas} conversaciones actualizadas${totalErrores ? `, ${totalErrores} con error` : ''}.`);
    vistasCargadas.clear();
    const vistaActiva = document.querySelector('.tab-modulo.activo').dataset.vista;
    cambiarVistaModulo(vistaActiva);
  }catch(err){ alert('Error: ' + err.message); }
  finally{ btn.disabled = false; btn.textContent = '🔄 Reanalizar desactualizadas'; }
}

// Migración puntual: reanaliza SOLO las conversaciones que ya quedaron
// clasificadas como "Otro" o "Producto incompatible" -- las dos categorías
// donde antes caía un "no trabajamos esa marca/producto", antes de que
// existiera el motivo "Producto/marca que no vendemos" (ver
// WHATSAPP_MOTIVOS_PERDIDA_LABEL en api/negocio.js). Se pagina por id
// (desdeId), no por offset, porque el conjunto se va achicando a medida
// que reclasifica conversaciones -- ver el comentario en el backend.
async function reanalizarProductoNoDisponible(){
  if (!confirm('¿Reanalizar las conversaciones marcadas como "Otro" o "Producto incompatible", por si ahora corresponden al nuevo motivo "Producto/marca que no vendemos"? Puede tardar varios minutos, y cada reanálisis tiene un costo pequeño en la API de Claude.')) return;
  const btn = $('btnReanalizarProductoNoDisponible');
  btn.disabled = true;
  let totalReanalizadas = 0, totalErrores = 0, totalCambiadas = 0, ultimoRestantes = 0, desdeId = 0;
  try{
    let completo = false;
    while (!completo) {
      const totalAprox = totalReanalizadas + (ultimoRestantes || 0);
      const pct = totalAprox ? Math.round(totalReanalizadas / totalAprox * 100) : 0;
      btn.textContent = totalReanalizadas > 0 ? `🔎 Reanalizando… ${pct}% (${totalReanalizadas} revisadas)` : '🔎 Reanalizando…';
      const res = await fetch('/api/negocio?recurso=whatsapp-reanalizar-producto-no-disponible', {
        method: 'POST', headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ desdeId })
      });
      const data = await res.json();
      if (!res.ok || data.error) { alert(data.error || 'No se pudo reanalizar las conversaciones.'); break; }
      totalReanalizadas += data.reanalizadas; totalErrores += data.errores; totalCambiadas += data.cambiadas || 0;
      ultimoRestantes = data.restantes || 0;
      desdeId = data.ultimoId || desdeId;
      completo = data.completo;
      if (data.reanalizadas === 0 && !completo) break; // nada avanzó, evita loop infinito
    }
    alert(`Reanálisis terminado: ${totalReanalizadas} conversaciones revisadas, ${totalCambiadas} reclasificadas${totalErrores ? `, ${totalErrores} con error` : ''}.`);
    vistasCargadas.clear();
    const vistaActiva = document.querySelector('.tab-modulo.activo').dataset.vista;
    cambiarVistaModulo(vistaActiva);
  }catch(err){ alert('Error: ' + err.message); }
  finally{ btn.disabled = false; btn.textContent = '🔎 Reanalizar "no disponible"'; }
}

// Listado de lo que hoy cuenta como "Otra" en el gráfico de categorías, del
// mismo período que está elegido arriba en la Analítica.
async function verListadoOtra(){
  const cont = $('listadoOtra');
  cont.innerHTML = '<p class="empty-note">Cargando…</p>';
  try{
    const desde = $('analiticaDesde').value, hasta = $('analiticaHasta').value;
    const res = await fetch(`/api/negocio?recurso=whatsapp-categoria-otra&desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`);
    const data = await res.json();
    if (!res.ok || data.error) { cont.innerHTML = `<p class="empty-note">${escapeHtml(data.error || 'No se pudo cargar el listado.')}</p>`; return; }
    if (!data.total) { cont.innerHTML = '<p class="empty-note">No hay conversaciones "Otra" en este período.</p>'; return; }
    const grupoLabel = { otra: 'Otra (IA)', sin_categoria: 'Sin categorizar' };
    cont.innerHTML = `
      <div class="sub" style="margin-bottom:8px;">${fmtNum(data.total)} conversaciones: ${fmtNum(data.otra)} que la IA analizó y dejó como "Otra", ${fmtNum(data.sinCategoria)} sin categorizar${data.sinMensajes ? ` (${fmtNum(data.sinMensajes)} sin ningún mensaje, no se pueden analizar)` : ''}.${data.total >= 2000 ? ' Se muestran las 2.000 más recientes.' : ''}</div>
      <div class="tabla-wrap" style="max-height:480px;overflow:auto;"><table>
        <thead><tr><th>Fecha</th><th>Grupo</th><th>Cliente</th><th>Msgs</th><th>Producto detectado</th><th>Resumen IA / primer mensaje</th></tr></thead>
        <tbody>${data.filas.map(f => `
          <tr>
            <td>${escapeHtml(fmtFechaHora(f.iniciadaEn))}</td>
            <td>${grupoLabel[f.grupo]}</td>
            <td>${escapeHtml(f.cliente || f.telefono || '')}</td>
            <td>${f.mensajes}</td>
            <td>${escapeHtml(f.producto || '—')}</td>
            <td>${escapeHtml(f.resumen || f.primerMensaje || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  }catch(err){ cont.innerHTML = `<p class="empty-note">Error: ${escapeHtml(err.message)}</p>`; }
}

// Reanálisis IA (con costo de API) de las conversaciones "Otra" / sin
// categorizar del período elegido en la Analítica, por si alguna calza en
// una categoría concreta. Cursor por id, igual que
// reanalizarProductoNoDisponible.
async function reanalizarOtra(modo = 'otra'){
  const desde = $('analiticaDesde').value, hasta = $('analiticaHasta').value;
  const sinModelo = modo === 'sin_modelo';
  const textoBtn = sinModelo ? '🔎 Reanalizar sin modelo' : '🔎 Reanalizar "Otra"';
  const detalle = sinModelo
    ? 'las conversaciones a las que todavía no se les detectó un modelo de equipo'
    : 'las conversaciones "Otra" o sin categorizar';
  if (!confirm(`¿Reanalizar con IA ${detalle} entre ${desde} y ${hasta}? Puede tardar varios minutos (son muchas) y cada reanálisis tiene un costo pequeño en la API de IA. Las conversaciones donde el cliente nunca menciona el modelo quedarán igual.`)) return;
  const btn = $(sinModelo ? 'btnReanalizarSinModelo' : 'btnReanalizarOtra');
  btn.disabled = true;
  let totalReanalizadas = 0, totalErrores = 0, totalCambiadas = 0, ultimoRestantes = 0, desdeId = 0;
  let primerError = null, detenidoPorFallo = false;
  try{
    let completo = false;
    while (!completo) {
      const totalAprox = totalReanalizadas + totalErrores + (ultimoRestantes || 0);
      const pct = totalAprox ? Math.round((totalReanalizadas + totalErrores) / totalAprox * 100) : 0;
      btn.textContent = totalReanalizadas + totalErrores > 0 ? `🔎 Reanalizando… ${pct}% (${totalReanalizadas + totalErrores} revisadas)` : '🔎 Reanalizando…';
      const res = await fetch('/api/negocio?recurso=whatsapp-reanalizar-otra', {
        method: 'POST', headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ desdeId, desde, hasta, modo })
      });
      const data = await res.json();
      if (!res.ok || data.error) { alert(data.error || 'No se pudo reanalizar las conversaciones.'); break; }
      totalReanalizadas += data.reanalizadas; totalErrores += data.errores; totalCambiadas += data.cambiadas || 0;
      ultimoRestantes = data.restantes || 0;
      desdeId = data.ultimoId || desdeId;
      completo = data.completo;
      if (data.errores > 0 && data.primerError && !primerError) primerError = data.primerError;
      // Si nada ha funcionado ni una vez, la causa es sistémica (API key,
      // cuota, saldo) -- seguir con las demás conversaciones solo repite el
      // mismo error cientos de veces.
      if (totalReanalizadas === 0 && totalErrores >= 5) { detenidoPorFallo = true; break; }
      if (data.reanalizadas + data.errores === 0 && !completo) break; // nada avanzó, evita loop infinito
    }
    if (detenidoPorFallo) {
      alert(`Se detuvo: las primeras ${totalErrores} conversaciones fallaron todas, así que no tiene sentido seguir. Motivo del primer error:\n\n${primerError || '(sin detalle)'}`);
    } else {
      alert(`Reanálisis terminado: ${totalReanalizadas} conversaciones reanalizadas, ${totalCambiadas} ${sinModelo ? 'ahora tienen un modelo detectado' : 'pasaron a una categoría concreta'}${totalErrores ? `, ${totalErrores} no se pudieron analizar${primerError ? ` (primer error: ${primerError})` : ''}` : ''}.`);
    }
    vistasCargadas.clear();
    const vistaActiva = document.querySelector('.tab-modulo.activo').dataset.vista;
    cambiarVistaModulo(vistaActiva);
  }catch(err){ alert('Error: ' + err.message); }
  finally{ btn.disabled = false; btn.textContent = textoBtn; }
}

// Solo actualiza el link de Shopify de conversaciones que YA tienen
// Análisis IA (sin volver a llamar a la IA, mucho más barato) -- sirve
// para corregir en lote matches viejos guardados con una versión anterior
// de la búsqueda, o para conversaciones que se analizaron antes de tener
// Shopify configurado.
async function actualizarShopifyEnLote(){
  if (!confirm('¿Actualizar el link de Shopify de todas las conversaciones ya analizadas? No vuelve a usar la IA, solo consulta Shopify.')) return;
  const btn = $('btnActualizarShopify');
  btn.disabled = true;
  let offset = 0, totalActualizadas = 0, total = 0;
  try{
    let completo = false;
    while (!completo) {
      const pctShopify = total ? Math.round(offset / total * 100) : 0;
      btn.textContent = totalActualizadas > 0 ? `🛒 Actualizando… ${pctShopify}% (${totalActualizadas}/${total || '?'})` : '🛒 Actualizando…';
      const res = await fetch('/api/negocio?recurso=whatsapp-actualizar-shopify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offset }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { alert(data.error || 'No se pudo actualizar los links de Shopify.'); break; }
      totalActualizadas += data.actualizadas; offset = data.offset; total = data.total;
      completo = data.completo;
      if (data.actualizadas === 0 && !completo) break; // nada avanzó, evita loop infinito
    }
    alert(`Links de Shopify actualizados: ${totalActualizadas} de ${total}.`);
    vistasCargadas.clear();
    const vistaActiva = document.querySelector('.tab-modulo.activo').dataset.vista;
    cambiarVistaModulo(vistaActiva);
  }catch(err){ alert('Error: ' + err.message); }
  finally{ btn.disabled = false; btn.textContent = '🛒 Actualizar Shopify'; }
}

// Busca en Bsale (por teléfono) ventas que podrían corresponder a
// conversaciones sin venta confirmada todavía -- puramente sugerido, ver
// buscarVentaBsalePorTelefono. Golpea la API real de Bsale (más lenta que
// Shopify), así que puede tardar bastante más con muchas conversaciones.
async function buscarVentasBsaleEnLote(){
  if (!confirm('¿Buscar en Bsale y Shopify (por teléfono) ventas que podrían corresponder a conversaciones sin venta confirmada? Es solo una sugerencia para revisar, no confirma nada automáticamente. Puede tardar varios minutos.')) return;
  const btn = $('btnBuscarVentasBsale');
  btn.disabled = true;
  let totalRevisadas = 0, totalEncontradas = 0, ultimoRestantesVentas = 0;
  try{
    let completo = false;
    while (!completo) {
      const totalAprox = totalRevisadas + (ultimoRestantesVentas || 0);
      const pct = totalAprox ? Math.round(totalRevisadas / totalAprox * 100) : 0;
      btn.textContent = totalRevisadas > 0 ? `🧾 Buscando… ${pct}% (${totalEncontradas} encontradas)` : '🧾 Buscando…';
      const res = await fetch('/api/negocio?recurso=whatsapp-actualizar-ventas-bsale', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) { alert(data.error || 'No se pudo buscar ventas en Bsale.'); break; }
      totalRevisadas += data.revisadas; totalEncontradas += data.encontradas;
      ultimoRestantesVentas = data.restantes || 0;
      completo = data.completo;
      if (data.revisadas === 0 && !completo) break; // nada avanzó, evita loop infinito
    }
    alert(`Búsqueda terminada: ${totalRevisadas} conversaciones revisadas, ${totalEncontradas} con una venta sugerida en Bsale.`);
    vistasCargadas.clear();
    const vistaActiva = document.querySelector('.tab-modulo.activo').dataset.vista;
    cambiarVistaModulo(vistaActiva);
  }catch(err){ alert('Error: ' + err.message); }
  finally{ btn.disabled = false; btn.textContent = '🧾 Buscar ventas (Bsale/Shopify)'; }
}


// ================= Conversión comercial: ofertas entregadas =================
// Horarios en que escriben los clientes: primero el general; después, por categoría principal (chips).
const HORARIO_CATEGORIAS = ['pantalla', 'cargador', 'bateria', 'servicio_tecnico'];
let horariosActuales = null;
let categoriaHorario = HORARIO_CATEGORIAS[0];
function histogramaHorario(horas){
  const total = horas.reduce((a, n) => a + n, 0);
  if(!total) return '<p class="empty-note">Sin conversaciones en este período.</p>';
  const pico = horas.reduce((mejor, n, h) => (n > horas[mejor] ? h : mejor), 0);
  const franja = (d, h) => horas.slice(d, h).reduce((a, n) => a + n, 0);
  const pctF = n => Math.round(n / total * 1000) / 10;
  const mañana = franja(6, 12), tarde = franja(12, 18), noche = franja(18, 24), madrugada = franja(0, 6);
  const dato = (lbl, n) => `<span style="margin-right:14px;"><b>${lbl}</b> ${fmtNum(n)} <small style="color:var(--muted);">(${pctF(n)}%)</small></span>`;
  return `<div style="font-size:12px;margin-bottom:8px;"><b>${fmtNum(total)}</b> conversaciones · hora de mayor demanda: <b>${pico}:00 h</b> (${pctF(horas[pico])}%)</div>
    ${histogramaHtml(horas.map((n, h) => ({ eti: h % 3 === 0 ? h : '', n, h })), v => `${v.h}:00 h`, true)}
    <div style="font-size:11.5px;margin-top:8px;color:var(--text);">${dato('Madrugada 0–6 h', madrugada)}${dato('Mañana 6–12 h', mañana)}${dato('Tarde 12–18 h', tarde)}${dato('Noche 18–24 h', noche)}</div>`;
}
function renderHorarios(h){
  const el = $('chartHorarios');
  if(!el) return;
  horariosActuales = h || null;
  if(!h){ el.innerHTML = '<p class="empty-note">Sin datos de horarios en este período.</p>'; return; }
  asegurarEstilosPanelMotivo();
  el.innerHTML = `
    <h3 style="margin:0 0 6px;font-size:13px;">🕒 General (todas las categorías)</h3>
    ${histogramaHorario(h.general)}
    <h3 style="margin:18px 0 8px;font-size:13px;">🗂️ Horario por categoría</h3>
    <div id="chipsHorario" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;"></div>
    <div id="chartHorarioCategoria"></div>`;
  renderHorarioCategoria();
}
function elegirCategoriaHorario(cat){ categoriaHorario = cat; renderHorarioCategoria(); }
function renderHorarioCategoria(){
  const porCat = (horariosActuales && horariosActuales.porCategoria) || {};
  $('chipsHorario').innerHTML = HORARIO_CATEGORIAS.map(cat => {
    const n = (porCat[cat] || []).reduce((a, x) => a + x, 0);
    return `<button class="btn-ghost btn-compact ${cat === categoriaHorario ? 'activo' : ''}" onclick="elegirCategoriaHorario('${cat}')">${escapeHtml(CATEGORIA_LABEL[cat] || cat)} <small>(${fmtNum(n)})</small></button>`;
  }).join('');
  $('chartHorarioCategoria').innerHTML = histogramaHorario(porCat[categoriaHorario] || Array(24).fill(0));
}
// Para IndexStore la venta es conversacional: entregarle al cliente una OFERTA (producto disponible + precio + enlace + condiciones
// + dónde atendemos) ya es una conversión. Se detecta en los mensajes del negocio; no depende del análisis de la IA.
function renderConversionComercial(cc){
  const el = $('chartConversionComercial');
  if(!el) return;
  if(!cc || !cc.conversaciones){ el.innerHTML = '<p class="empty-note">Sin conversaciones con mensajes en este período.</p>'; return; }
  const tarjeta = (lbl, big, nota, clase) => `<div class="card ${clase || ''}"><div class="lbl">${lbl}</div><div class="big">${big}</div>${nota ? `<div class="cmp flat">${nota}</div>` : ''}</div>`;
  const aviso = (cc.pctConRespuestaRegistrada != null && cc.pctConRespuestaRegistrada < 70)
    ? `<div class="note-box" style="margin-bottom:12px;background:var(--amber-dim);padding:9px 12px;border-radius:9px;font-size:12px;">⚠ Solo el <b>${cc.pctConRespuestaRegistrada}%</b> de las conversaciones tiene alguna respuesta nuestra registrada en el ERP (lo que se contesta desde el celular no llega si la coexistencia de WhatsApp no está activa). Los enlaces y ofertas enviados desde el celular <b>no se ven aquí</b>: las cifras de conversión son un mínimo.</div>` : '';
  const min = cc.medianaMinutosAOferta;
  const tiempo = min == null ? '—' : (min < 90 ? `${Math.round(min)} min` : (min < 2880 ? `${Math.round(min / 60 * 10) / 10} h` : `${Math.round(min / 1440)} días`));
  const tabla = cc.porCategoria.map(c => `
    <tr><td>${escapeHtml(CATEGORIA_LABEL[c.categoria] || c.categoria)}</td><td class="num">${fmtNum(c.conversaciones)}</td><td class="num">${fmtNum(c.conversiones)}</td><td class="num">${c.pctConversion}%</td><td class="num">${fmtNum(c.completas)}</td><td class="num">${fmtNum(c.ventas)}</td>
    <td><button class="btn-ghost btn-compact" onclick="abrirPanelCategoria('${escapeHtml(c.categoria)}')">📊 Analizar</button></td></tr>`).join('');
  el.innerHTML = `${aviso}
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-bottom:14px;">
      ${tarjeta('Cotizaciones enviadas', fmtNum(cc.conversiones), `${cc.pctConversionSobreConversaciones}% de ${fmtNum(cc.conversaciones)} conversaciones · intención de venta`, 'destacada')}
      ${tarjeta('Con ficha completa', fmtNum(cc.ofertasCompletas), `precio, condiciones y dónde atendemos · ${fmtNum(cc.soloEnlace)} solo con el enlace`)}
      ${tarjeta('Pidieron comprar sin cotización', fmtNum(cc.intencionSinConversion), `de ${fmtNum(cc.conIntencionCompra)} que pidieron comprar o cotizar`)}
      ${tarjeta('Tiempo hasta el enlace u oferta', tiempo, 'mediana desde el primer mensaje')}
      ${tarjeta('Ventas registradas', fmtNum(cc.ventas), `${fmtNum(cc.ventasConConversion)} tuvieron conversión · se registran pocas`)}
    </div>
    <div class="tabla-wrap"><table>
      <thead><tr><th>Categoría</th><th>Conversaciones</th><th>Conversiones</th><th>% convertidas</th><th>Ficha completa</th><th>Ventas registradas</th><th></th></tr></thead>
      <tbody>${tabla}</tbody>
    </table></div>`;
}

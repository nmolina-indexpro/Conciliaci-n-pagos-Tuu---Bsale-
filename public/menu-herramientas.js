// /public/menu-herramientas.js
// Menú desplegable de la tuerca (⚙) en la esquina izquierda del header:
// Usuarios, Ayuda, Guía de uso, Cerrar sesión. Compartido por todas las
// páginas del panel -- "Cerrar sesión" y "Reportar error" (este último
// ahora vive en el desplegable Soporte del nav) se sacaron del header
// derecho para no repetir dos zonas de "acciones de cuenta" distintas.
// También maneja los desplegables agrupados del nav principal (Finanzas,
// Compras, Comercial, Soporte, ver .nav-dropdown-menu en responsive.css) --
// mismo mecanismo (clase "abierto", cierre al clickear afuera o con
// Escape), generalizado por id para no repetir la lógica de apertura/cierre.
function cerrarTodosLosDesplegables(){
  document.querySelectorAll('.menu-herramientas.abierto, .nav-dropdown-menu.abierto').forEach(m => m.classList.remove('abierto'));
}
function toggleMenuHerramientas(ev){
  if(ev) ev.stopPropagation();
  const menu = document.getElementById('menuHerramientas');
  if(!menu) return;
  const yaAbierto = menu.classList.contains('abierto');
  cerrarTodosLosDesplegables();
  if(!yaAbierto) menu.classList.add('abierto');
}
// .page-nav tiene overflow-x:auto (scroll horizontal en mobile) -- por la
// regla de CSS que hace que "overflow-x no-visible + overflow-y visible"
// se recalcule como "auto" en ambos ejes, el desplegable quedaba recortado
// verticalmente y era invisible aunque la clase "abierto" sí se aplicaba
// bien (bug real: el estado cambiaba pero no se veía nada en pantalla).
// Se saca el menú del flujo de .page-nav la primera vez que se abre --
// pasa a colgar directo de <body> como position:fixed, posicionado a mano
// bajo el botón que lo abrió, así ningún overflow de un ancestro lo recorta.
function toggleNavDropdown(ev, id){
  if(ev) ev.stopPropagation();
  const menu = document.getElementById(id);
  if(!menu) return;
  const yaAbierto = menu.classList.contains('abierto');
  cerrarTodosLosDesplegables();
  if(yaAbierto) return;

  const boton = ev ? ev.currentTarget : menu.previousElementSibling;
  if(menu.parentElement !== document.body) document.body.appendChild(menu);
  const rect = (boton || menu).getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${rect.left}px`;
  menu.classList.add('abierto');
  // En pantallas angostas el menú no debe salirse por la derecha.
  const maxLeft = window.innerWidth - menu.offsetWidth - 8;
  menu.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`;
}
document.addEventListener('click', (e) => {
  if(e.target.closest('#menuHerramientas') || e.target.closest('.btn-settings') || e.target.closest('.nav-dropdown') || e.target.closest('.nav-dropdown-menu')) return;
  cerrarTodosLosDesplegables();
});
document.addEventListener('keydown', (e) => {
  if(e.key !== 'Escape') return;
  cerrarTodosLosDesplegables();
});
// Un desplegable position:fixed no sigue al botón si la página se
// scrollea -- se cierra en vez de quedar flotando desconectado.
window.addEventListener('scroll', () => cerrarTodosLosDesplegables(), true);

// En celular el nav se desliza horizontalmente: deja a la vista la sección activa.
document.addEventListener('DOMContentLoaded', () => {
  const activo = document.querySelector('.page-nav .active');
  if(activo && activo.scrollIntoView) activo.scrollIntoView({ block:'nearest', inline:'center' });
});

// Enlace "Bot WhatsApp" (entrenamiento y pruebas) en el desplegable Comercial, junto a WhatsApp. Se agrega acá, una sola vez, y no en el nav de
// cada página. Corre antes de que la página aplique los permisos del perfil (aplicarRestriccionPaginas), que lo oculta a quien no tenga la página.
function agregarEnlaceBotWhatsapp(){
  const comercial = document.getElementById('navComercial');
  if(!comercial || comercial.querySelector('a[href="bot-whatsapp.html"]')) return;
  const wa = comercial.querySelector('a[href="clientes-whatsapp.html"]');
  if(!wa) return;
  const a = document.createElement('a');
  a.href = 'bot-whatsapp.html';
  a.textContent = 'Bot WhatsApp';
  if(/bot-whatsapp\.html$/.test(location.pathname)){ a.classList.add('active'); wa.classList.remove('active'); }
  wa.insertAdjacentElement('afterend', a);
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', agregarEnlaceBotWhatsapp); else agregarEnlaceBotWhatsapp();

// Enlace "Configuración WhatsApp" (dashboard, clientes, analítica, respuestas rápidas, etiquetas) en el desplegable Comercial, junto a Bot WhatsApp.
// El chat (WhatsApp) ahora es una pantalla completa sin menú: todo lo demás del módulo vive en esta página. Mismo criterio que arriba: se agrega acá una sola
// vez y la página aplica los permisos del perfil (aplicarRestriccionPaginas) para ocultarlo a quien no tenga la página.
function agregarEnlaceConfiguracionWhatsapp(){
  const comercial = document.getElementById('navComercial');
  if(!comercial || comercial.querySelector('a[href="configuracion-whatsapp.html"]')) return;
  const chat = comercial.querySelector('a[href="clientes-whatsapp.html"]');
  if(chat && chat.textContent.trim() === 'WhatsApp') chat.textContent = 'Chat WhatsApp'; // junto a "Bot WhatsApp" y "Configuración WhatsApp"
  const ancla = comercial.querySelector('a[href="bot-whatsapp.html"]') || chat;
  if(!ancla) return;
  const a = document.createElement('a');
  a.href = 'configuracion-whatsapp.html';
  a.textContent = 'Configuración WhatsApp';
  if(/configuracion-whatsapp\.html$/.test(location.pathname)){
    comercial.querySelectorAll('a.active').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
  }
  ancla.insertAdjacentElement('afterend', a);
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', agregarEnlaceConfiguracionWhatsapp); else agregarEnlaceConfiguracionWhatsapp();

// "Actualizaciones ERP" (resumen de hoy y cambios) es solo para administradores,
// igual que el acceso a Usuarios: cada página muestra #navUsuarios cuando la
// sesión es admin, y este enlace lo acompaña sin tocar el código de cada página.
document.addEventListener('DOMContentLoaded', () => {
  const usuarios = document.getElementById('navUsuarios');
  const actualizaciones = document.getElementById('navActualizaciones');
  const mercadolibre = document.getElementById('navMercadoLibre');
  const mailing = document.getElementById('navMailing');
  if(!usuarios || !actualizaciones || !window.MutationObserver) return;
  new MutationObserver(() => {
    if(usuarios.style.display !== 'none'){
      actualizaciones.style.display = '';
      if(mercadolibre) mercadolibre.style.display = '';
      if(mailing) mailing.style.display = '';
    }
  }).observe(usuarios, { attributes: true, attributeFilter: ['style'] });
});

// ---------- Barra superior azul oscura (estilo Zoho Desk) ----------
// Se activa sola en toda página que tenga el menú principal (<header> con .page-nav): agrega la clase "zd" al <body> (los estilos están en
// responsive.css), mide el relleno de la página para que la barra llegue de borde a borde y suma los accesos rápidos de arriba:
// Nuevo ticket, Nueva orden de servicio (abren el formulario en Tickets) y WhatsApp (el chat de conversaciones, en otra pestaña).
(function(){
  function medir(){
    const cs = getComputedStyle(document.body);
    document.body.style.setProperty('--zd-pt', cs.paddingTop);
    document.body.style.setProperty('--zd-px', cs.paddingLeft);
  }
  function iniciar(){
    const nav = document.querySelector('header .page-nav');
    if(!nav) return;
    const header = nav.closest('header');
    document.body.classList.add('zd');
    let acc = header.querySelector('.acciones-top');
    if(!acc){
      acc = document.createElement('div');
      acc.className = 'acciones-top';
      acc.innerHTML =
        '<a class="btn-orden" href="tickets.html#nueva-os" title="Nueva orden de servicio">🔧 <span class="l">Nueva orden de servicio</span><span class="c">Orden</span></a>' +
        '<a class="btn-nuevo" href="tickets.html#nuevo" title="Nuevo ticket">+ <span class="l">Nuevo ticket</span><span class="c">Ticket</span></a>';
      const ub = header.querySelector('.user-box');
      if(ub) header.insertBefore(acc, ub); else header.appendChild(acc);
    }
    if(!acc.querySelector('.btn-wa-top')){
      const wa = document.createElement('a');
      wa.className = 'btn-wa-top'; wa.href = 'clientes-whatsapp.html'; wa.target = '_blank'; wa.rel = 'noopener';
      wa.title = 'Abrir el chat de conversaciones de WhatsApp (en una pestaña nueva)'; wa.textContent = '💬 WhatsApp';
      acc.insertBefore(wa, acc.firstChild);
    }
    medir();
    window.addEventListener('resize', medir);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();

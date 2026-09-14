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

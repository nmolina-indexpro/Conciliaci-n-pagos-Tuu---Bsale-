// /public/menu-herramientas.js
// Menú desplegable de la tuerca (⚙) en la esquina izquierda del header:
// Usuarios, Ayuda, Guía de uso. Compartido por todas las páginas del panel.
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
function toggleNavDropdown(ev, id){
  if(ev) ev.stopPropagation();
  const menu = document.getElementById(id);
  if(!menu) return;
  const yaAbierto = menu.classList.contains('abierto');
  cerrarTodosLosDesplegables();
  if(!yaAbierto) menu.classList.add('abierto');
}
document.addEventListener('click', (e) => {
  if(e.target.closest('#menuHerramientas') || e.target.closest('.btn-settings') || e.target.closest('.nav-dropdown')) return;
  cerrarTodosLosDesplegables();
});
document.addEventListener('keydown', (e) => {
  if(e.key !== 'Escape') return;
  cerrarTodosLosDesplegables();
});

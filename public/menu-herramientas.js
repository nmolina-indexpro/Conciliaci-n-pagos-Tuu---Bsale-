// /public/menu-herramientas.js
// Menú desplegable de la tuerca (⚙) en la esquina izquierda del header:
// Usuarios, Ayuda, Guía de uso. Compartido por todas las páginas del panel.
function toggleMenuHerramientas(ev){
  if(ev) ev.stopPropagation();
  const menu = document.getElementById('menuHerramientas');
  if(!menu) return;
  menu.classList.toggle('abierto');
}
document.addEventListener('click', (e) => {
  const menu = document.getElementById('menuHerramientas');
  if(!menu || !menu.classList.contains('abierto')) return;
  if(e.target.closest('#menuHerramientas') || e.target.closest('.btn-settings')) return;
  menu.classList.remove('abierto');
});
document.addEventListener('keydown', (e) => {
  if(e.key !== 'Escape') return;
  const menu = document.getElementById('menuHerramientas');
  if(menu) menu.classList.remove('abierto');
});

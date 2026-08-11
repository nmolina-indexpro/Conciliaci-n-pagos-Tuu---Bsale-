// /public/restriccion-usuario.js
// Restricciones para el rol "usuario": no puede descargar/exportar
// información ni copiar texto o datos de las tablas. Tampoco puede ver
// márgenes ni la marca de "producto estrella" (solo admin ve esos datos).
//
// Uso: después de obtener la sesión (fetch a /api/auth-session), llamar
// aplicarRestriccionesUsuario(u.rol) y aplicarRestriccionMargenes(u.rol).
// Los botones de descarga/exportación de cada página deben tener la clase
// "btn-exportar" para que esto los desactive automáticamente. Cualquier
// card/columna/badge de margen o "estrella" debe tener la clase
// "solo-admin" (y la página debe definir en su CSS
// `body.sin-margenes .solo-admin{display:none !important;}`).
function aplicarRestriccionesUsuario(rol) {
  if (rol !== 'usuario') return; // admin: sin restricciones

  // 1) Deshabilitar cualquier botón de descarga/exportación.
  document.querySelectorAll('.btn-exportar').forEach(btn => {
    btn.disabled = true;
    btn.title = 'Tu perfil no tiene permiso para descargar información.';
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  });

  // 2) Bloquear copiar/cortar/menú contextual y desactivar selección de
  //    texto en toda la página (donde vive la información de negocio).
  const estilo = document.createElement('style');
  estilo.textContent = `body.restringido-copia{-webkit-user-select:none;user-select:none;}`;
  document.head.appendChild(estilo);
  document.body.classList.add('restringido-copia');

  const bloquear = e => e.preventDefault();
  document.addEventListener('copy', bloquear);
  document.addEventListener('cut', bloquear);
  document.addEventListener('contextmenu', bloquear);
}

// Márgenes y "producto estrella": solo el rol "admin" puede verlos. Oculta
// (vía CSS, clase "solo-admin") cualquier card, columna o badge que
// muestre esa información en la página.
function aplicarRestriccionMargenes(rol) {
  if (rol === 'admin') return; // admin: ve todo
  document.body.classList.add('sin-margenes');
}

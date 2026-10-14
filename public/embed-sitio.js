// /public/embed-sitio.js
// Permite mostrar una página del ERP DENTRO de otra (módulos "Buscador IA" y "Descuentos web" dentro de Sitio Web). Se incluye en la página
// incrustada; solo actúa cuando se abre con ?embed=1 (la página normal queda igual):
//   - oculta el encabezado y el menú (los pone la página que la contiene) y quita el relleno de la página;
//   - le avisa a la página contenedora cuánto mide su contenido, para que el marco se ajuste y no haya dos barras de desplazamiento.
(function () {
  if (!/[?&]embed=1(&|$)/.test(location.search)) return;
  document.documentElement.classList.add('embebido');
  var css = document.createElement('style');
  css.textContent =
    'html.embebido body{padding:0 !important;background:transparent !important;}' +
    'html.embebido header,html.embebido .page-nav,html.embebido .btn-settings,html.embebido .menu-herramientas{display:none !important;}' +
    'html.embebido .wrap{margin:0 !important;max-width:none !important;}';
  document.head.appendChild(css);

  var ultima = 0;
  function enviar() {
    var alto = Math.ceil(Math.max(document.body.scrollHeight, document.body.offsetHeight));
    if (!alto || Math.abs(alto - ultima) < 2) return;
    ultima = alto;
    try { parent.postMessage({ tipo: 'sw-altura', altura: alto, pagina: location.pathname }, location.origin); } catch (e) { /* sin contenedor */ }
  }
  window.addEventListener('load', enviar);
  document.addEventListener('DOMContentLoaded', function () {
    enviar();
    if (window.ResizeObserver) new ResizeObserver(enviar).observe(document.body);
    else setInterval(enviar, 1000);
  });
})();

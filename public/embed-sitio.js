// /public/embed-sitio.js
// Permite mostrar una página del ERP DENTRO de otra (módulos "Buscador IA" y "Descuentos web" dentro de Sitio Web). Se incluye en la página
// incrustada; solo actúa cuando se abre con ?embed=1 (la página normal queda igual):
//   - oculta el encabezado y el menú (los pone la página que la contiene) y quita el relleno de la página;
//   - recibe el período del filtro de fechas de Sitio Web (?desde=&hasta= al abrir; mensaje 'sw-fechas' al cambiarlo): lo deja en window.FECHAS_SITIO y llama a
//     window.aplicarFechasSitio({desde, hasta}) si la página la define; los controles de fecha propios (clase .filtro-fechas-propio) se ocultan;
//   - le avisa a la página contenedora cuánto mide su contenido, para que el marco se ajuste y no haya dos barras de desplazamiento.
(function () {
  if (!/[?&]embed=1(&|$)/.test(location.search)) return;
  document.documentElement.classList.add('embebido');
  var css = document.createElement('style');
  css.textContent =
    'html.embebido body{padding:0 !important;background:transparent !important;}' +
    'html.embebido header,html.embebido .page-nav,html.embebido .btn-settings,html.embebido .menu-herramientas{display:none !important;}' +
    'html.embebido .wrap{margin:0 !important;max-width:none !important;}' +
    'html.embebido .filtro-fechas-propio{display:none !important;}';
  document.head.appendChild(css);

  var esFecha = function (v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); };
  var q = new URLSearchParams(location.search);
  if (esFecha(q.get('desde')) && esFecha(q.get('hasta'))) window.FECHAS_SITIO = { desde: q.get('desde'), hasta: q.get('hasta') };
  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (ev.origin !== location.origin || !m || m.tipo !== 'sw-fechas' || !esFecha(m.desde) || !esFecha(m.hasta)) return;
    window.FECHAS_SITIO = { desde: m.desde, hasta: m.hasta };
    if (typeof window.aplicarFechasSitio === 'function') window.aplicarFechasSitio(window.FECHAS_SITIO);
  });

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

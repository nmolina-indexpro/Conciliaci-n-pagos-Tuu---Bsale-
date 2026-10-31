// /public/sondeo-activo.js
// Consulta periódica que cuida la base de datos (Neon cobra horas de cómputo mientras esté despierta): corre fn cada `ms` SOLO si la pestaña
// está a la vista y la persona hizo algo (mouse, teclado, toque, scroll) en los últimos `inactividadMin` minutos. Una pestaña olvidada abierta
// ya no mantiene la base encendida toda la noche. Al volver a la pestaña o a usarla tras una pausa, refresca de inmediato si pasó el intervalo.
//   const detener = sondeoActivo(miFuncion, { ms: 180000, inactividadMin: 15 });   // devuelve una función para cancelar
(function () {
  window.sondeoActivo = function (fn, opciones) {
    var ms = (opciones && opciones.ms) || 120000;
    var maxInactivoMs = ((opciones && opciones.inactividadMin) || 15) * 60000;
    var ultimaActividad = Date.now();
    var ultimaCorrida = Date.now();

    function inactivo() { return Date.now() - ultimaActividad >= maxInactivoMs; }
    function correr() {
      ultimaCorrida = Date.now();
      try { fn(); } catch (e) { /* una falla de la consulta no debe cortar el sondeo */ }
    }
    var timer = setInterval(function () {
      if (!document.hidden && !inactivo()) correr();
    }, ms);

    function actividad() {
      var estabaInactivo = inactivo();
      ultimaActividad = Date.now();
      if (estabaInactivo && !document.hidden && Date.now() - ultimaCorrida >= ms) correr();
    }
    function visibilidad() {
      if (!document.hidden && !inactivo() && Date.now() - ultimaCorrida >= ms) correr();
    }
    var eventos = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    eventos.forEach(function (e) { window.addEventListener(e, actividad, { passive: true, capture: true }); });
    document.addEventListener('visibilitychange', visibilidad);

    return function detener() {
      clearInterval(timer);
      eventos.forEach(function (e) { window.removeEventListener(e, actividad, { capture: true }); });
      document.removeEventListener('visibilitychange', visibilidad);
    };
  };
})();

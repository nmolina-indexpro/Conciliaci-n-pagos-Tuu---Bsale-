// public/navegacion-historial.js
// "Migas de pan" dentro de una página: cada cambio de pestaña, panel o ficha queda anotado en el historial del navegador,
// así que el botón Atrás vuelve a lo que se estaba viendo ANTES dentro de la misma página (la pestaña anterior, la ficha
// cerrada...) y solo después a la página anterior. Adelante funciona igual.
//
// Cómo se usa (una vez por página, al final):
//   Nav.iniciar({
//     dimensiones: {
//       tab: { actual: () => 'usuarios', aplicar: v => cambiarTab(v) },          // lo que cambia: lectura y restauración
//       ficha: { actual: () => idAbierto, aplicar: v => ..., reemplazar: true },   // reemplazar: pasar de una ficha a otra no suma entradas
//     },
//     envolver: ['cambiarTab', 'abrirFicha', 'cerrarFicha'],                       // funciones globales tras las que se anota el cambio
//   });
// - actual() devuelve el valor de esa dimensión AHORA (null/'' = "cerrado" o sin selección).
// - aplicar(valor) lleva la pantalla a ese valor SIN anotar nada (Nav sabe que está restaurando).
// - Si el nuevo estado es el anterior del historial (por ejemplo, cerrar una ficha recién abierta) se usa history.back() en vez
//   de sumar otra entrada: así Atrás y la X de cerrar se comportan igual.
(function(){
  const Nav = { dims: {}, listo: false, restaurando: false };
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const instantanea = () => { const s = {}; for(const k of Object.keys(Nav.dims)) s[k] = Nav.dims[k].actual(); return s; };
  const estadoNav = () => (history.state && history.state._nav) || null;
  const vacio = v => v === null || v === undefined || v === '';

  Nav.aplicar = function(snap){
    Nav.restaurando = true;
    try{
      for(const k of Object.keys(Nav.dims)){
        if(!(k in snap)) continue;
        if(!igual(Nav.dims[k].actual(), snap[k])){
          try{ Nav.dims[k].aplicar(snap[k]); }catch(err){ console.warn('[Nav] no se pudo restaurar', k, err); }
        }
      }
    } finally {
      Nav.restaurando = false;
    }
  };

  Nav.cambio = function(){
    if(!Nav.listo || Nav.restaurando) return;
    const nuevo = instantanea();
    const est = estadoNav();
    if(!est){ history.replaceState({ _nav: { snap: nuevo, prev: null } }, ''); return; }
    if(igual(est.snap, nuevo)) return;
    // Volver al estado de la entrada anterior (p. ej. cerrar lo que se abrió): es lo mismo que Atrás.
    if(est.prev && igual(est.prev, nuevo)){ history.back(); return; }
    // Pasar de un valor abierto a otro de la misma dimensión (p. ej. siguiente ficha): se reemplaza la entrada actual.
    const distintas = Object.keys(nuevo).filter(k => !igual(est.snap[k], nuevo[k]));
    if(distintas.length === 1){
      const d = Nav.dims[distintas[0]];
      if(d.reemplazar && !vacio(est.snap[distintas[0]]) && !vacio(nuevo[distintas[0]])){
        history.replaceState({ _nav: { snap: nuevo, prev: est.prev } }, '');
        return;
      }
    }
    history.pushState({ _nav: { snap: nuevo, prev: est.snap } }, '');
  };

  // Envuelve funciones globales: después de ejecutarlas se anota el cambio. Sirve para onclick="" y para llamadas internas.
  Nav.envolver = function(nombres){
    for(const nombre of nombres){
      const original = window[nombre];
      if(typeof original !== 'function' || original.__navEnvuelta) continue;
      const envuelta = function(){
        const r = original.apply(this, arguments);
        Nav.cambio();
        return r;
      };
      envuelta.__navEnvuelta = true;
      window[nombre] = envuelta;
    }
  };

  Nav.iniciar = function(opciones){
    Nav.dims = opciones.dimensiones || {};
    if(Nav.dims && opciones.envolver) Nav.envolver(opciones.envolver);
    // Siempre se parte limpio: la primera entrada de la página es "estado inicial".
    history.replaceState({ _nav: { snap: instantanea(), prev: null } }, '');
    Nav.listo = true;
  };

  window.addEventListener('popstate', e => {
    const n = e.state && e.state._nav;
    if(!n || !Nav.listo) return;
    Nav.aplicar(n.snap);
  });

  window.Nav = Nav;
})();

// preferencias-vista.js
// Helper genérico para que cualquier página guarde/restaure preferencias de
// vista por usuario (filtros por defecto, columnas visibles, búsquedas
// guardadas, etc.) contra /api/negocio?recurso=preferencias.
//
// Uso típico en una página:
//   await cargarPreferencias('compras');                 // una vez, al iniciar
//   const pref = obtenerPreferencia('compras', 'catalogo-completo', {});
//   guardarPreferencia('compras', 'catalogo-completo', { categoria: '...' });
//
// obtenerPreferencia() lee de una caché en memoria (sin red) que
// cargarPreferencias() llena -- por eso siempre hay que esperar
// cargarPreferencias() antes de leer. guardarPreferencia() actualiza esa
// misma caché al toque (optimista) y manda el PUT al backend con debounce,
// para no pegarle a la base de datos en cada tecla de un buscador con
// oninput.

let _preferenciasCache = {};
let _preferenciasPaginaCargada = null;

async function cargarPreferencias(pagina) {
  try {
    const res = await fetch(`/api/negocio?recurso=preferencias&pagina=${encodeURIComponent(pagina)}`);
    const data = await res.json();
    _preferenciasCache = (res.ok && data.preferencias) ? data.preferencias : {};
  } catch (err) {
    _preferenciasCache = {};
  }
  _preferenciasPaginaCargada = pagina;
  return _preferenciasCache;
}

// Devuelve porDefecto si todavía no se cargaron preferencias para esa
// página (cargarPreferencias no se llamó o falló) o si esa clave puntual
// nunca se guardó -- así una página nueva funciona igual sin tener que
// chequear nada especial.
function obtenerPreferencia(pagina, clave, porDefecto) {
  if (pagina !== _preferenciasPaginaCargada) return porDefecto;
  const valor = _preferenciasCache[clave];
  return valor === undefined || valor === null ? porDefecto : valor;
}

const _timersGuardarPreferencia = {};
function guardarPreferencia(pagina, clave, valor, debounceMs = 600) {
  _preferenciasCache[clave] = valor;
  const key = pagina + '::' + clave;
  clearTimeout(_timersGuardarPreferencia[key]);
  _timersGuardarPreferencia[key] = setTimeout(async () => {
    try {
      await fetch('/api/negocio?recurso=preferencias', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pagina, clave, valor }),
      });
    } catch (err) {
      // Silencioso: perder un guardado de preferencia no debe interrumpir
      // al usuario -- en el peor caso, la próxima vez no encuentra el
      // filtro guardado.
    }
  }, debounceMs);
}

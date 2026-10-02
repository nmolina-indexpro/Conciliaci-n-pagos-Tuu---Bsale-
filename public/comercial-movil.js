// /public/comercial-movil.js
// Apoyo de la vista móvil de las páginas de Comercial (ver comercial-movil.css).
// Las tablas se renderizan por JS en cada página, así que acá se les pone a
// cada <td> su encabezado como data-label; en pantallas angostas el CSS usa
// ese atributo para mostrar cada fila como una tarjeta "etiqueta: valor" en
// vez de obligar a deslizar la tabla de lado. En escritorio no cambia nada.
(function(){
  const MIN_COLUMNAS = 4;               // tablas más chicas se leen bien igual
  const EXCLUIR = '.tabla-cot-compacta, .ficha-lateral-cot table, .no-tarjetas';

  function anotarTabla(t){
    if(t.matches(EXCLUIR) || t.closest('.ficha-lateral-cot')) return;
    const ths = [...t.querySelectorAll('thead th')];
    if(ths.length < MIN_COLUMNAS) return;
    const etiquetas = ths.map(th => th.textContent.replace(/[▲▼↑↓]/g, '').trim());
    let anotada = false;
    t.querySelectorAll('tbody tr').forEach(tr => {
      const tds = [...tr.children].filter(c => c.tagName === 'TD');
      if(tds.length !== etiquetas.length) return;   // filas con colspan (totales, avisos): quedan como están
      tds.forEach((td, i) => {
        if(etiquetas[i]) td.setAttribute('data-label', etiquetas[i]);
        // Celdas sin dato ("—") no aportan en la tarjeta: se ocultan para acortarla.
        const vacia = /^[—–-]?$/.test(td.textContent.trim()) && !td.querySelector('input,select,button,a,img');
        if(vacia) td.setAttribute('data-vacio', '1'); else td.removeAttribute('data-vacio');
      });
      anotada = true;
    });
    if(anotada) t.classList.add('tabla-tarjetas');
  }

  let pendiente = false;
  function anotarTodas(){
    pendiente = false;
    document.querySelectorAll('table').forEach(anotarTabla);
  }
  function programar(){
    if(pendiente) return;
    pendiente = true;
    requestAnimationFrame(anotarTodas);
  }

  function iniciar(){
    anotarTodas();
    // Los observers solo miran altas/bajas de nodos; poner atributos no los dispara de nuevo.
    new MutationObserver(programar).observe(document.body, { childList: true, subtree: true });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

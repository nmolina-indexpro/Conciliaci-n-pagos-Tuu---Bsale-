// Ordenar tablas haciendo clic en el encabezado de cada columna (de mayor a menor la primera vez en números y fechas,
// de A a Z en textos; un segundo clic invierte). Sirve para CUALQUIER tabla de una página: basta con incluir
//   <script src="tablas-ordenables.js"></script>
// Funciona también con tablas que la página vuelve a dibujar (se vuelve a activar solo).
// Las tablas cuyos encabezados ya traen onclick (orden propio de la página) se dejan tal cual.
// Las filas de total (clase *total* o primera celda "Total") y las de celda combinada no se mueven.
// Para excluir una tabla: <table data-sin-orden>. Para excluir una columna: <th data-sin-orden>.
// Si la página oculta filas (por ejemplo "Ver todos"), escucha el evento "tabla-ordenada" para volver a aplicarlo.
(function () {
  if (window.__tablasOrdenables) return;
  window.__tablasOrdenables = true;

  var css = document.createElement('style');
  css.textContent =
    'th.ord-th{cursor:pointer;user-select:none;}' +
    'th.ord-th:hover{color:var(--primary,#0F766E);}' +
    'th.ord-th::after{content:" \\2195";opacity:.35;font-size:.9em;}' +
    'th.ord-th[aria-sort="descending"]::after{content:" \\25BC";opacity:1;color:var(--primary,#0F766E);}' +
    'th.ord-th[aria-sort="ascending"]::after{content:" \\25B2";opacity:1;color:var(--primary,#0F766E);}';
  document.head.appendChild(css);

  function texto(td) {
    var inp = td.querySelector('input, select');
    var t = inp ? (inp.tagName === 'SELECT' ? (inp.options[inp.selectedIndex] || {}).text : inp.value) : td.textContent;
    return String(t == null ? '' : t).replace(/ /g, ' ').replace(/−/g, '-').trim();
  }

  // Devuelve { tipo: 'num'|'fecha'|'txt'|'vacio', v }
  function valor(td) {
    var t = texto(td);
    if (t === '' || /^[-—–]+$/.test(t)) return { tipo: 'vacio', v: null };
    var f = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:,?\s*(\d{1,2}):(\d{2}))?$/);
    if (f) {
      var y = f[3] ? Number(f[3]) : new Date().getFullYear();
      if (y < 100) y += 2000;
      return { tipo: 'fecha', v: Date.UTC(y, Number(f[2]) - 1, Number(f[1]), Number(f[4] || 0), Number(f[5] || 0)) };
    }
    var iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (iso) return { tipo: 'fecha', v: Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] || 0), Number(iso[5] || 0)) };
    var n = t.replace(/[\s$%]/g, '');
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(n) || /^-?\d+(,\d+)?$/.test(n) || /^-?\d+\.\d{1,2}$/.test(n)) {
      return { tipo: 'num', v: parseFloat(/,/.test(n) || /\.\d{3}/.test(n) ? n.replace(/\./g, '').replace(',', '.') : n) };
    }
    return { tipo: 'txt', v: t.toLowerCase() };
  }

  function esFilaFija(r) {
    if (r.cells[0] && r.cells[0].colSpan > 1) return true;
    if (/(^|[\s-])total([\s-]|$)/i.test(r.className)) return true;
    return /^total/i.test((r.cells[0] ? r.cells[0].textContent : '').trim());
  }

  function ordenar(tabla, idx, th) {
    var cuerpo = tabla.tBodies[0];
    if (!cuerpo) return;
    // las filas de total, de aviso (celda combinada) o sin esa columna no se mueven: quedan al final
    var filas = Array.prototype.slice.call(cuerpo.rows).filter(function (r) { return r.cells.length > idx && !esFilaFija(r); });
    var sueltas = Array.prototype.slice.call(cuerpo.rows).filter(function (r) { return filas.indexOf(r) < 0; });
    if (filas.length < 2) return;
    var datos = filas.map(function (r, i) { return { r: r, i: i, x: valor(r.cells[idx]) }; });
    var con = datos.filter(function (d) { return d.x.tipo !== 'vacio'; });
    var numericas = con.length > 0 && con.filter(function (d) { return d.x.tipo === 'num' || d.x.tipo === 'fecha'; }).length / con.length >= 0.6;
    var actual = th.getAttribute('aria-sort');
    // primera vez: mayor a menor en números y fechas; A a Z en textos
    var desc = actual ? actual === 'ascending' : numericas;
    datos.sort(function (a, b) {
      var av = a.x.tipo === 'vacio', bv = b.x.tipo === 'vacio';
      if (av || bv) return av === bv ? a.i - b.i : (av ? 1 : -1); // los vacíos siempre al final
      var c;
      if (numericas) c = (a.x.tipo === 'txt' || b.x.tipo === 'txt') ? (a.x.tipo === b.x.tipo ? 0 : (a.x.tipo === 'txt' ? 1 : -1)) : a.x.v - b.x.v;
      else c = String(a.x.v).localeCompare(String(b.x.v), 'es', { numeric: true });
      return c === 0 ? a.i - b.i : (desc ? -c : c);
    });
    datos.forEach(function (d) { cuerpo.appendChild(d.r); });
    sueltas.forEach(function (r) { cuerpo.appendChild(r); });
    Array.prototype.forEach.call(tabla.tHead.rows[0].cells, function (c) { c.removeAttribute('aria-sort'); });
    th.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
    tabla.dispatchEvent(new CustomEvent('tabla-ordenada', { bubbles: true }));
  }

  function activar(tabla) {
    if (tabla.hasAttribute('data-sin-orden') || !tabla.tHead || !tabla.tHead.rows.length) return;
    // si la página ya ordena esa tabla a su manera (encabezados con onclick), se respeta y no se toca
    if (tabla.tHead.querySelector('th[onclick]')) return;
    var ths = tabla.tHead.rows[0].cells;
    Array.prototype.forEach.call(ths, function (th) {
      if (th.classList.contains('ord-th') || th.hasAttribute('data-sin-orden') || !th.textContent.trim()) return;
      th.classList.add('ord-th');
      th.setAttribute('tabindex', '0');
      th.setAttribute('title', 'Ordenar por esta columna');
    });
    if (tabla.__ordenable) return;
    tabla.__ordenable = true;
    var hacer = function (e) {
      var th = e.target.closest ? e.target.closest('th.ord-th') : null;
      if (!th || !tabla.contains(th)) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      ordenar(tabla, th.cellIndex, th);
    };
    tabla.addEventListener('click', hacer);
    tabla.addEventListener('keydown', hacer);
  }

  function revisar() { Array.prototype.forEach.call(document.querySelectorAll('table'), activar); }

  var pendiente = null;
  new MutationObserver(function () {
    if (pendiente) return;
    pendiente = setTimeout(function () { pendiente = null; revisar(); }, 60);
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', revisar); else revisar();
})();

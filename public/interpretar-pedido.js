// /public/interpretar-pedido.js
// Productos Nuevos: convierte lo que escribe el vendedor tal como se lo dijo el cliente ("batería asus B31N1911", "pantalla lenovo ideapad 3 15IIL05")
// en tipo + marca + modelo, para que registrar un pedido sea escribir una línea y apretar Enter, sin llenar un formulario.
// Funciona en el navegador (window.interpretarPedido) y en Node (para probarlo). Sin dependencias.
(function (root) {
  var TIPOS = [
    { tipo: 'bateria', re: /^(bater[ií]as?|battery|batteries)$/i },
    { tipo: 'cargador', re: /^(cargador(es)?|charger|chargers|adaptador(es)?)$/i },
    { tipo: 'pantalla', re: /^(pantallas?|display|displays|screen|screens|lcd|led)$/i },
  ];
  var MARCAS = ['HP', 'Lenovo', 'Dell', 'Asus', 'Acer', 'Apple', 'Samsung', 'Toshiba', 'MSI', 'Huawei', 'Xiaomi', 'LG', 'Gigabyte', 'Razer', 'Microsoft', 'Compaq', 'Sony', 'Positivo', 'Gateway', 'Packard Bell', 'Fujitsu', 'Medion', 'Honor', 'Chuwi', 'Alienware'];
  // líneas de producto que delatan la marca cuando el cliente no la dijo (la palabra se queda en el modelo)
  var LINEAS = {
    Lenovo: ['ideapad', 'thinkpad', 'yoga', 'legion', 'thinkbook', 'flex'],
    HP: ['pavilion', 'probook', 'elitebook', 'envy', 'omen', 'victus', 'zbook', 'spectre', 'stream', 'compaq'],
    Dell: ['inspiron', 'latitude', 'vostro', 'xps', 'precision', 'alienware', 'g15'],
    Acer: ['aspire', 'nitro', 'swift', 'predator', 'travelmate', 'spin'],
    Asus: ['vivobook', 'zenbook', 'tuf', 'rog', 'expertbook', 'x541', 'x556'],
    Apple: ['macbook'],
  };
  var RELLENO = /^(de|del|para|el|la|los|las|un|una|notebook|notebooks|laptop|laptops|netbook|equipo|original|alternativo|alternativa|compatible|modelo|marca|necesito|busco|quiere|pidio|pidió|cliente)$/i;

  function normalizar(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  // opciones.marcasExtra: marcas ya registradas en la base (para reconocer las que no están en la lista fija)
  function interpretarPedido(texto, opciones) {
    var extra = (opciones && opciones.marcasExtra) || [];
    var palabras = String(texto || '').replace(/[,;]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    var tipo = null, marca = null;
    var resto = [];
    palabras.forEach(function (p) {
      if (!tipo) { var t = TIPOS.filter(function (x) { return x.re.test(p); })[0]; if (t) { tipo = t.tipo; return; } }
      resto.push(p);
    });
    // marca dicha explícitamente (se saca de las palabras)
    var todas = MARCAS.concat(extra.filter(function (m) { return m && MARCAS.map(normalizar).indexOf(normalizar(m)) < 0; }));
    var idxMarca = -1;
    for (var i = 0; i < resto.length && idxMarca < 0; i++) {
      var n = normalizar(resto[i]);
      for (var j = 0; j < todas.length; j++) {
        if (normalizar(todas[j]) === n) { marca = todas[j]; idxMarca = i; break; }
      }
    }
    if (idxMarca >= 0) resto.splice(idxMarca, 1);
    // marca deducida por la línea de producto (la palabra queda en el modelo)
    if (!marca) {
      for (var m in LINEAS) {
        if (resto.some(function (p) { return LINEAS[m].indexOf(normalizar(p)) >= 0; })) { marca = m; break; }
      }
    }
    var modelo = resto.filter(function (p) { return !RELLENO.test(p); }).join(' ').trim();
    return { tipo: tipo, marca: marca, modelo: modelo, marcaDeducida: !!marca && idxMarca < 0, completo: !!(marca && modelo) };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { interpretarPedido: interpretarPedido };
  else root.interpretarPedido = interpretarPedido;
})(typeof window !== 'undefined' ? window : globalThis);

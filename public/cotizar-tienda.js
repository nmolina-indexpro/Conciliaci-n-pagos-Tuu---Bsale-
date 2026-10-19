// Generado por indexstore-buscador-ia/cotizaciones/construir-tienda.cjs desde pagina-cotizar.html. No editar a mano.
(function(){var s=document.createElement('style');s.textContent="\r\n  .ctz { --az: #004fc7; --az-osc: #003a96; --borde: #d6dbe4; --suave: #f3f6fb; --txt-suave: #5b6577; --ok: #15803d; --mal: #b42318; --aviso: #8a5a00; max-width: 1240px; width: 100%; margin: 0 auto; padding: 8px 16px 40px; color: inherit; font-size: 15px; line-height: 1.45; }\r\n  .ctz * { box-sizing: border-box; }\r\n  .ctz h1 { font-size: 26px; margin: 8px 0 4px; }\r\n  .ctz h2 { font-size: 17px; margin: 0 0 12px; }\r\n  .ctz .ctz-sub { color: var(--txt-suave); margin: 0 0 18px; }\r\n  .ctz-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 24px; align-items: start; }\r\n  @media (max-width: 860px) { .ctz-grid { grid-template-columns: minmax(0, 1fr); } }\r\n  .ctz-card { border: 1px solid var(--borde); border-radius: 12px; padding: 16px; margin-bottom: 16px; background: #fff; color: #1b2230; }\r\n  .ctz-card.resumen { position: sticky; top: 12px; }\r\n  .ctz-campos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }\r\n  .ctz-campos .ancho { grid-column: 1 / -1; }\r\n  @media (max-width: 520px) { .ctz-campos { grid-template-columns: minmax(0, 1fr); } }\r\n  .ctz label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; }\r\n  .ctz input[type=text], .ctz input[type=email], .ctz input[type=tel], .ctz input[type=search], .ctz select { width: 100%; min-height: 44px; padding: 9px 11px; border: 1px solid var(--borde); border-radius: 8px; font: inherit; background: #fff; color: #1b2230; }\r\n  .ctz input:focus, .ctz select:focus, .ctz button:focus-visible, .ctz a:focus-visible { outline: 2px solid var(--az); outline-offset: 1px; }\r\n  .ctz input.mal, .ctz select.mal { border-color: var(--mal); }\r\n  .ctz .ctz-error { color: var(--mal); font-size: 13px; margin-top: 4px; }\r\n  .ctz-item { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--borde); }\r\n  .ctz-item:last-child { border-bottom: 0; }\r\n  .ctz-item img { width: 64px; height: 64px; object-fit: contain; border-radius: 8px; background: var(--suave); }\r\n  .ctz-item .t { font-weight: 600; font-size: 14px; }\r\n  .ctz-item .p { color: var(--txt-suave); font-size: 13px; }\r\n  .ctz-item .acc { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }\r\n  .ctz-item .sub { font-weight: 700; white-space: nowrap; text-align: right; }\r\n  .ctz-cant { display: inline-flex; border: 1px solid var(--borde); border-radius: 8px; overflow: hidden; }\r\n  .ctz-cant button { width: 36px; min-height: 36px; border: 0; background: var(--suave); font-size: 18px; cursor: pointer; color: #1b2230; }\r\n  .ctz-cant span { min-width: 38px; text-align: center; align-self: center; font-weight: 600; }\r\n  .ctz-link { background: none; border: 0; color: var(--az); cursor: pointer; padding: 6px 4px; font: inherit; text-decoration: underline; }\r\n  .ctz-btn { display: inline-block; width: 100%; min-height: 48px; padding: 12px 18px; border: 0; border-radius: 10px; background: var(--az); color: #fff; font: inherit; font-weight: 700; cursor: pointer; text-align: center; text-decoration: none; }\r\n  .ctz-btn:hover { background: var(--az-osc); }\r\n  .ctz-btn[disabled] { opacity: .55; cursor: not-allowed; }\r\n  .ctz-btn.sec { background: #fff; color: var(--az); border: 1.5px solid var(--az); }\r\n  .ctz-opcion { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--borde); border-radius: 10px; margin-bottom: 8px; cursor: pointer; }\r\n  .ctz-opcion.sel { border-color: var(--az); background: #eef4ff; }\r\n  .ctz-opcion input { margin-top: 3px; }\r\n  .ctz-opcion .n { font-weight: 600; }\r\n  .ctz-opcion .l { font-size: 13px; color: var(--txt-suave); }\r\n  .ctz-opcion .pr { margin-left: auto; font-weight: 700; white-space: nowrap; }\r\n  .ctz-fila { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; }\r\n  .ctz-fila.total { border-top: 1px solid var(--borde); margin-top: 8px; padding-top: 10px; font-size: 18px; font-weight: 800; }\r\n  .ctz-aviso { background: #fff8e6; border: 1px solid #f0d58a; color: var(--aviso); border-radius: 8px; padding: 9px 11px; font-size: 13px; margin: 12px 0; }\r\n  .ctz-ok { background: #effaf3; border: 1px solid #bfe5cc; color: #14532d; border-radius: 8px; padding: 9px 11px; margin: 12px 0; }\r\n  .ctz-mal { background: #fff1f0; border: 1px solid #f3b8b3; color: var(--mal); border-radius: 8px; padding: 9px 11px; margin: 12px 0; }\r\n  .ctz-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }\r\n  .ctz-pill.vigente { background: #e7f6ec; color: var(--ok); } .ctz-pill.vencida, .ctz-pill.anulada { background: #fde8e6; color: var(--mal); } .ctz-pill.comprada { background: #e6eefc; color: var(--az); }\r\n  .ctz-sug { border: 1px solid var(--borde); border-radius: 10px; margin-top: 6px; max-height: 300px; overflow: auto; }\r\n  .ctz-sug button { display: flex; gap: 10px; align-items: center; width: 100%; padding: 8px 10px; border: 0; border-bottom: 1px solid var(--borde); background: #fff; cursor: pointer; text-align: left; font: inherit; color: #1b2230; }\r\n  .ctz-sug button:hover { background: var(--suave); }\r\n  .ctz-sug img { width: 40px; height: 40px; object-fit: contain; }\r\n  .ctz-mis { list-style: none; margin: 0; padding: 0; }\r\n  .ctz-mis li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--borde); }\r\n  .ctz dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; font-size: 14px; }\r\n  .ctz dt { color: var(--txt-suave); } .ctz dd { margin: 0; }\r\n  .ctz-tabla { overflow-x: auto; }\r\n  .ctz-tabla table { width: 100%; border-collapse: collapse; font-size: 14px; }\r\n  .ctz-tabla th, .ctz-tabla td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--borde); }\r\n  .ctz-tabla td.num, .ctz-tabla th.num { text-align: right; white-space: nowrap; }\r\n  @media (prefers-reduced-motion: reduce) { .ctz * { transition: none !important; } }\r\n";document.head.appendChild(s);})();

(function () {
  var WORKER = 'https://indexstore-buscador-ia.nmolina.workers.dev';
  var raiz = document.getElementById('ctz');
  // El tema envuelve las páginas en contenedores angostos: se les quita el tope de ancho para que el formulario use el espacio de la pantalla.
  (function () { var n = raiz.parentElement, i = 0; while (n && n !== document.body && i++ < 8) { if (n.tagName !== 'MAIN' || true) { n.style.maxWidth = 'none'; n.style.width = '100%'; } n = n.parentElement; } })();
  var LS = 'ctz_mis_cotizaciones';
  var estado = { items: [], comunas: null, f: { metodo: 'transferencia' }, envio: { opciones: [], sel: null, cargando: false, error: '' }, errores: {}, enviando: false, error: '', sug: [], vista: null, confirmar: null, comprando: false, perfil: { fase: '', msg: '', error: '' }, autocompletado: null, revisado: false };
  var temporizador = null, tEnvio = null;

  function clp(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fecha(d) { try { return new Date(d).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return ''; } }
  function rutLimpio(r) { return String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); }
  function rutValido(r) {
    var s = rutLimpio(r); if (s.length < 8 || s.length > 9) return false;
    var cuerpo = s.slice(0, -1), dv = s.slice(-1), suma = 0, mul = 2;
    for (var i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo.charAt(i)) * mul; mul = mul === 7 ? 2 : mul + 1; }
    var res = 11 - (suma % 11);
    return dv === (res === 11 ? '0' : res === 10 ? 'K' : String(res));
  }
  function leerLS() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } }
  function guardarLS(c) {
    try { var l = leerLS().filter(function (x) { return x.token !== c.token; }); l.unshift({ token: c.token, numero: c.numero, total: c.total, vence: c.vence }); localStorage.setItem(LS, JSON.stringify(l.slice(0, 10))); } catch (e) {}
  }
  function api(ruta, cuerpo) {
    return fetch(WORKER + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.json().catch(function () { return { error: 'Respuesta no válida' }; }).then(function (j) { j._status = r.status; return j; }); })
      .catch(function () { return { error: 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.' }; });
  }

  // ───── Productos ─────
  function agregarProducto(handle, varianteId, cantidad) {
    return fetch('/products/' + encodeURIComponent(handle) + '.js').then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
      if (!p) return;
      var v = null;
      for (var i = 0; i < p.variants.length; i++) if (String(p.variants[i].id) === String(varianteId)) v = p.variants[i];
      if (!v) v = p.variants.filter(function (x) { return x.available; })[0] || p.variants[0];
      var ya = estado.items.filter(function (x) { return x.variante === v.id; })[0];
      if (ya) { ya.cantidad = Math.min(50, ya.cantidad + (cantidad || 1)); return; }
      estado.items.push({ handle: p.handle, variante: v.id, titulo: p.title, variantes: p.variants.map(function (x) { return { id: x.id, titulo: x.title, precio: x.price / 100, disponible: x.available }; }),
        vtitulo: v.title === 'Default Title' ? '' : v.title, precio: v.price / 100, imagen: (v.featured_image && v.featured_image.src) || p.featured_image || '', cantidad: Math.max(1, Math.min(50, cantidad || 1)), disponible: v.available, sku: v.sku || '' });
    });
  }
  function cargarDesdeUrl(param) {
    var tareas = String(param || '').split(',').slice(0, 15).map(function (par) {
      var d = par.split(':'); if (!d[0]) return Promise.resolve();
      return agregarProducto(d[0], d[1], Number(d[2]) || 1);
    });
    return tareas.reduce(function (p, t) { return p.then(function () { return t; }); }, Promise.resolve());
  }
  function subtotal() { return estado.items.reduce(function (s, i) { return s + i.precio * i.cantidad; }, 0); }
  function totalFinal() { return subtotal() + (estado.envio.sel ? estado.envio.sel.precio : 0); }

  // ───── Envío ─────
  function pedirEnvio() {
    clearTimeout(tEnvio);
    var f = estado.f;
    if (!estado.items.length || !f.region || !f.comuna) { estado.envio = { opciones: [], sel: null, cargando: false, error: '' }; return pintarEnvio(); }
    estado.envio.cargando = true; estado.envio.error = ''; pintarEnvio();
    tEnvio = setTimeout(function () {
      var peticion = JSON.stringify([estado.items.map(function (i) { return i.variante + 'x' + i.cantidad; }), f.region, f.comuna]);
      api('/cotizacion-envio', { items: estado.items.map(function (i) { return { variante: i.variante, cantidad: i.cantidad }; }), region: f.region, comuna: f.comuna }).then(function (r) {
        if (peticion !== JSON.stringify([estado.items.map(function (i) { return i.variante + 'x' + i.cantidad; }), estado.f.region, estado.f.comuna])) return; // cambió mientras tanto
        var previo = estado.envio.sel && estado.envio.sel.nombre;
        if (r.error || !r.opciones) { estado.envio = { opciones: [], sel: null, cargando: false, error: r._status === 429 ? 'Muchas consultas seguidas; espera un minuto.' : 'No pudimos calcular el envío para esa comuna. Escríbenos por WhatsApp.' }; return pintarEnvio(); }
        var sel = r.opciones.filter(function (o) { return o.nombre === previo; })[0] || null;
        estado.envio = { opciones: r.opciones, sel: sel, cargando: false, error: r.opciones.length ? '' : 'No hay envíos disponibles para esa comuna. Escríbenos por WhatsApp.', region: r.region };
        pintarEnvio(); pintarResumen();
      });
    }, 450);
  }
  function pintarEnvio() {
    var el = document.getElementById('ctz-envio'); if (!el) return;
    var e = estado.envio, h = '';
    if (!estado.f.comuna) h = '<p class="ctz-sub">Elige región y comuna para ver las opciones de envío.</p>';
    else if (e.cargando) h = '<p class="ctz-sub">Calculando envío a ' + esc(estado.f.comuna) + '…</p>';
    else if (e.error) h = '<div class="ctz-mal">' + esc(e.error) + '</div>';
    else h = e.opciones.map(function (o, i) {
      var sel = e.sel && e.sel.nombre === o.nombre;
      return '<label class="ctz-opcion' + (sel ? ' sel' : '') + '"><input type="radio" name="ctz-envio" data-envio="' + i + '"' + (sel ? ' checked' : '') + '><span><span class="n">' + esc(o.nombre) + '</span>' + (o.llega ? '<br><span class="l">' + esc(o.llega) + '</span>' : '') + '</span><span class="pr">' + (o.precio ? clp(o.precio) : 'Gratis') + '</span></label>';
    }).join('');
    if (estado.errores.envio) h += '<div class="ctz-error">' + esc(estado.errores.envio) + '</div>';
    el.innerHTML = h;
  }

  // ───── Pintado ─────
  function pintarItems() {
    var el = document.getElementById('ctz-items'); if (!el) return;
    if (!estado.items.length) { el.innerHTML = '<p class="ctz-sub">Aún no hay productos. Búscalos arriba para agregarlos.</p>'; return; }
    el.innerHTML = estado.items.map(function (it, i) {
      var opts = it.variantes.length > 1 ? '<select data-variante="' + i + '" aria-label="Opción">' + it.variantes.map(function (v) { return '<option value="' + v.id + '"' + (v.id === it.variante ? ' selected' : '') + '>' + esc(v.titulo) + (v.disponible ? '' : ' (sin stock)') + '</option>'; }).join('') + '</select>' : '';
      return '<div class="ctz-item"><img src="' + esc(it.imagen) + '" alt="" loading="lazy"><div><div class="t">' + esc(it.titulo) + '</div><div class="p">' + (it.sku ? esc(it.sku) + ' · ' : '') + clp(it.precio) + ' c/u (IVA incl.)' + (it.disponible ? '' : ' · <b style="color:var(--mal)">sin stock</b>') + '</div>' +
        '<div class="acc">' + opts + '<span class="ctz-cant"><button type="button" data-menos="' + i + '" aria-label="Menos">−</button><span>' + it.cantidad + '</span><button type="button" data-mas="' + i + '" aria-label="Más">+</button></span><button type="button" class="ctz-link" data-quitar="' + i + '">Quitar</button></div></div><div class="sub">' + clp(it.precio * it.cantidad) + '</div></div>';
    }).join('');
  }
  function pintarResumen() {
    var el = document.getElementById('ctz-resumen'); if (!el) return;
    var e = estado.envio.sel;
    el.innerHTML = '<h2>Resumen</h2><div class="ctz-fila"><span>Productos (' + estado.items.reduce(function (s, i) { return s + i.cantidad; }, 0) + ')</span><span>' + clp(subtotal()) + '</span></div>' +
      '<div class="ctz-fila"><span>Envío' + (e ? ' · ' + esc(e.nombre) : '') + '</span><span>' + (e ? (e.precio ? clp(e.precio) : 'Gratis') : 'Por elegir') + '</span></div>' +
      '<div class="ctz-fila total"><span>Total</span><span>' + clp(totalFinal()) + '</span></div><p class="ctz-sub" style="font-size:12px;margin:2px 0 0">Precios con IVA incluido.</p>' +
      '<div class="ctz-aviso">Esta cotización no garantiza disponibilidad de stock. Es válida por 3 días y el stock y los precios se confirman al pagar.</div>' +
      (estado.error ? '<div class="ctz-mal">' + esc(estado.error) + '</div>' : '') +
      '<button type="button" class="ctz-btn" id="ctz-enviar"' + (estado.enviando ? ' disabled' : '') + '>' + (estado.enviando ? 'Generando cotización…' : 'Generar cotización') + '</button>';
  }
  function campo(id, etiqueta, tipo, extra) {
    var err = estado.errores[id];
    return '<div class="' + ((extra && extra.ancho) ? 'ancho' : '') + '"><label for="ctz-' + id + '">' + etiqueta + '</label><input id="ctz-' + id + '" type="' + (tipo || 'text') + '" data-campo="' + id + '" value="' + esc(estado.f[id] || '') + '"' + (err ? ' class="mal"' : '') + ((extra && extra.ph) ? ' placeholder="' + esc(extra.ph) + '"' : '') + ((extra && extra.auto) ? ' autocomplete="' + extra.auto + '"' : '') + '>' + (err ? '<div class="ctz-error">' + esc(err) + '</div>' : '') + '</div>';
  }
  function selectRegion() {
    var rs = (estado.comunas || []);
    return '<div><label for="ctz-region">Región</label><select id="ctz-region" data-campo="region"' + (estado.errores.region ? ' class="mal"' : '') + '><option value="">Elige región</option>' + rs.map(function (r) { return '<option value="' + r.codigo + '"' + (estado.f.region === r.codigo ? ' selected' : '') + '>' + esc(r.nombre) + '</option>'; }).join('') + '</select>' + (estado.errores.region ? '<div class="ctz-error">' + estado.errores.region + '</div>' : '') + '</div>';
  }
  function selectComuna() {
    var r = (estado.comunas || []).filter(function (x) { return x.codigo === estado.f.region; })[0];
    return '<div><label for="ctz-comuna">Comuna</label><select id="ctz-comuna" data-campo="comuna"' + (estado.errores.comuna ? ' class="mal"' : '') + (r ? '' : ' disabled') + '><option value="">Elige comuna</option>' + (r ? r.comunas.map(function (c) { return '<option' + (estado.f.comuna === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') : '') + '</select>' + (estado.errores.comuna ? '<div class="ctz-error">' + estado.errores.comuna + '</div>' : '') + '</div>';
  }

  function pintarCrear() {
    var mis = leerLS();
    raiz.innerHTML = '<h1>Cotización express</h1><p class="ctz-sub">Arma tu cotización, la generamos en nuestro sistema y la recibes por correo. Tienes 3 días para pagarla desde el enlace.</p>' +
      '<div class="ctz-grid"><div>' +
      '<section class="ctz-card"><h2>Productos</h2><label for="ctz-buscar">Agregar producto</label><input id="ctz-buscar" type="search" placeholder="Busca por nombre, marca o modelo" autocomplete="off"><div id="ctz-sug"></div><div id="ctz-items" style="margin-top:10px"></div></section>' +
      '<section class="ctz-card"><h2>Tus datos</h2><div class="ctz-campos">' + campo('nombre', 'Nombre de contacto', 'text', { auto: 'name' }) + campo('email', 'Correo', 'email', { auto: 'email' }) + campo('telefono', 'Teléfono', 'tel', { auto: 'tel', ph: '+56 9 ...' }) + '</div><div id="ctz-perfil"></div></section>' +
      '<section class="ctz-card"><h2>Datos de facturación</h2><div class="ctz-campos">' + campo('rut', 'RUT empresa', 'text', { ph: '76.123.456-7' }) + campo('razon', 'Razón social', 'text') + campo('giro', 'Giro', 'text', { ancho: true }) + '</div></section>' +
      '<section class="ctz-card"><h2>Dirección de despacho</h2><div class="ctz-campos">' + selectRegion() + selectComuna() + campo('calle', 'Calle y número', 'text', { ancho: true, auto: 'address-line1' }) + '</div></section>' +
      '<section class="ctz-card"><h2>Método de envío</h2><div id="ctz-envio"></div></section>' +
      '<section class="ctz-card"><h2>Método de pago preferido</h2>' +
      ['transferencia', 'tarjeta'].map(function (m) { return '<label class="ctz-opcion' + (estado.f.metodo === m ? ' sel' : '') + '"><input type="radio" name="ctz-metodo" data-metodo="' + m + '"' + (estado.f.metodo === m ? ' checked' : '') + '><span class="n">' + (m === 'transferencia' ? 'Transferencia bancaria' : 'Tarjeta de crédito o débito') + '</span></label>'; }).join('') +
      '<p class="ctz-sub" style="font-size:12px;margin:6px 0 0">El medio de pago definitivo se elige al pagar.</p></section>' +
      (mis.length ? '<section class="ctz-card"><h2>Mis cotizaciones en este navegador</h2><ul class="ctz-mis">' + mis.map(function (m) { return '<li><a href="?t=' + encodeURIComponent(m.token) + '">N° ' + esc(m.numero) + '</a><span>' + clp(m.total) + ' · vence ' + esc(fecha(m.vence)) + '</span></li>'; }).join('') + '</ul></section>' : '') +
      '</div><aside><div class="ctz-card resumen" id="ctz-resumen"></div></aside></div>';
    pintarItems(); pintarEnvio(); pintarResumen(); pintarPerfil();
  }

  function pintarVista() {
    var c = estado.vista, vigente = c.estado === 'vigente';
    var filas = (c.items || []).map(function (l) { return '<tr><td>' + esc(l.titulo) + (l.sku ? '<br><small>' + esc(l.sku) + '</small>' : '') + '</td><td class="num">' + l.cantidad + '</td><td class="num">' + clp(l.precio) + '</td><td class="num">' + clp(l.subtotal) + '</td></tr>'; }).join('');
    var conf = '';
    if (estado.confirmar) conf = '<div class="ctz-aviso"><b>Algunos precios cambiaron desde tu cotización:</b><ul style="margin:6px 0 8px 18px">' + estado.confirmar.cambios.map(function (x) { return '<li>' + esc(x.titulo) + ': antes ' + clp(x.antes) + ', ahora ' + clp(x.ahora) + '</li>'; }).join('') + '</ul>Nuevo total: <b>' + clp(estado.confirmar.total_nuevo) + '</b>.<button type="button" class="ctz-btn" id="ctz-aceptar" style="margin-top:10px">Aceptar y continuar al pago</button></div>';
    var rehacer = (c.items || []).map(function (l) { return encodeURIComponent(l.handle) + ':' + l.variante + ':' + l.cantidad; }).join(',');
    raiz.innerHTML = '<h1>Cotización N° ' + esc(c.numero || '') + ' <span class="ctz-pill ' + esc(c.estado) + '">' + ({ vigente: 'Vigente', vencida: 'Vencida', comprada: 'Pagada', anulada: 'Anulada' }[c.estado] || esc(c.estado)) + '</span></h1>' +
      '<p class="ctz-sub">' + (vigente ? 'Válida hasta el ' + esc(fecha(c.vence)) + '. Pide el producto antes de que venza para mantener esta cotización.' : 'Venció el ' + esc(fecha(c.vence)) + '.') + '</p>' +
      (estado.avisoCreada ? '<div class="ctz-ok">¡Listo! Creamos tu cotización y te enviamos el detalle a <b>' + esc(c.cliente.email) + '</b>' + (estado.correoFallo ? ' (no pudimos enviar el correo, guarda este enlace)' : '') + '.</div>' : '') +
      '<div class="ctz-grid"><div><section class="ctz-card"><h2>Productos</h2><div class="ctz-tabla"><table><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Subtotal</th></tr></thead><tbody>' + filas + '</tbody></table></div></section>' +
      '<section class="ctz-card"><h2>Datos</h2><dl><dt>Cliente</dt><dd>' + esc(c.cliente.razon_social) + ' (' + esc(c.cliente.rut) + ')</dd><dt>Giro</dt><dd>' + esc(c.cliente.giro) + '</dd><dt>Contacto</dt><dd>' + esc(c.cliente.nombre) + ' · ' + esc(c.cliente.telefono) + '</dd><dt>Despacho</dt><dd>' + esc(c.direccion.calle) + ', ' + esc(c.direccion.comuna) + '</dd><dt>Envío</dt><dd>' + esc(c.envio.nombre) + '</dd></dl></section></div>' +
      '<aside><div class="ctz-card resumen"><h2>Resumen</h2><div class="ctz-fila"><span>Productos</span><span>' + clp(c.total_productos) + '</span></div><div class="ctz-fila"><span>Envío</span><span>' + (c.envio.precio ? clp(c.envio.precio) : 'Gratis') + '</span></div><div class="ctz-fila total"><span>Total</span><span>' + clp(c.total) + '</span></div>' +
      '<div class="ctz-aviso">Esta cotización no garantiza disponibilidad de stock; se confirma al pagar.</div>' + conf +
      (estado.error ? '<div class="ctz-mal">' + esc(estado.error) + '</div>' : '') +
      (vigente && !estado.confirmar ? '<button type="button" class="ctz-btn" id="ctz-comprar"' + (estado.comprando ? ' disabled' : '') + '>' + (estado.comprando ? 'Revisando stock…' : 'Generar compra') + '</button>' : '') +
      (!vigente ? '<a class="ctz-btn" href="/pages/cotizar?p=' + rehacer + '">Armar una cotización nueva con estos productos</a>' : '') +
      (c.pdf ? '<p style="text-align:center;margin:10px 0 0"><a href="' + esc(c.pdf) + '" target="_blank" rel="noopener">Descargar PDF</a></p>' : '') +
      '<p style="text-align:center;margin:6px 0 0"><a href="/pages/cotizar">Hacer otra cotización</a></p></div></aside></div>';
  }

  // ───── Autocompletar con código al correo ─────
  function sinTildes(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
  function formatoRut(r) { var s = rutLimpio(r); return s.length < 2 ? String(r || '') : s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + s.slice(-1); }
  function pintarPerfil() {
    var el = document.getElementById('ctz-perfil'); if (!el) return;
    var p = estado.perfil, h = '';
    if (estado.autocompletado) {
      h = '<div class="ctz-aviso"><b>Completamos tus datos con tu ' + esc(estado.autocompletado) + '.</b> Revísalos con calma antes de generar la cotización: si algo cambió, corrígelo.' +
        '<label style="display:flex;gap:8px;align-items:center;margin:10px 0 0;font-weight:600"><input type="checkbox" id="ctz-revisado" data-revisado' + (estado.revisado ? ' checked' : '') + '> Revisé que mis datos están correctos</label>' +
        (estado.errores.revisado ? '<div class="ctz-error">' + esc(estado.errores.revisado) + '</div>' : '') + '</div>';
    } else if (p.fase === 'codigo') {
      h = '<div class="ctz-aviso">' + esc(p.msg) + '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center"><input id="ctz-codigo" type="text" inputmode="numeric" maxlength="6" placeholder="Código de 6 dígitos" style="max-width:200px" autocomplete="one-time-code"><button type="button" class="ctz-btn" id="ctz-perfil-verificar" style="width:auto">Verificar</button></div>' +
        (p.error ? '<div class="ctz-error">' + esc(p.error) + '</div>' : '') + '</div>';
    } else {
      h = '<p style="margin:12px 0 0;font-size:13px">¿Ya compraste o cotizaste antes? <button type="button" class="ctz-link" id="ctz-perfil-pedir">Autocompleta mis datos con un código a mi correo</button></p>' + (p.error ? '<div class="ctz-error">' + esc(p.error) + '</div>' : '');
    }
    el.innerHTML = h;
  }
  function pedirPerfil() {
    var email = String(estado.f.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { estado.perfil = { fase: '', msg: '', error: 'Escribe primero tu correo arriba.' }; return pintarPerfil(); }
    api('/cotizacion', { accion: 'perfil_solicitar', email: email }).then(function (r) {
      estado.perfil = r.error ? { fase: '', msg: '', error: r.error } : { fase: 'codigo', msg: r.mensaje, error: '' };
      pintarPerfil();
    });
  }
  function verificarPerfil() {
    var cod = (document.getElementById('ctz-codigo') || {}).value || '';
    api('/cotizacion', { accion: 'perfil_verificar', email: String(estado.f.email || '').trim(), codigo: cod }).then(function (r) {
      if (!r.perfil) { estado.perfil.error = r.error || 'No pudimos verificar el código.'; return pintarPerfil(); }
      aplicarPerfil(r.perfil);
    });
  }
  function aplicarPerfil(p) {
    var f = estado.f;
    if (p.nombre) f.nombre = p.nombre; if (p.telefono) f.telefono = p.telefono; if (p.rut) f.rut = formatoRut(p.rut);
    if (p.razon_social) f.razon = p.razon_social; if (p.giro) f.giro = p.giro; if (p.calle) f.calle = p.calle;
    var rn = sinTildes(p.region);
    var reg = (estado.comunas || []).filter(function (r) { var n = sinTildes(r.nombre); return rn && (n === rn || n.indexOf(rn) >= 0 || rn.indexOf(n) >= 0); })[0];
    if (reg) { f.region = reg.codigo; var cn = sinTildes(p.comuna); f.comuna = reg.comunas.filter(function (c) { return sinTildes(c) === cn; })[0] || ''; }
    estado.autocompletado = p.origen || 'historial'; estado.revisado = false; estado.errores = {}; estado.error = '';
    estado.envio = { opciones: [], sel: null, cargando: false, error: '' }; estado.perfil = { fase: '', msg: '', error: '' };
    pintarCrear();
    if (f.region && f.comuna) pedirEnvio();
  }

  // ───── Acciones ─────
  function validar() {
    var f = estado.f, e = {};
    if (!estado.items.length) e.items = 'Agrega al menos un producto.';
    if (String(f.nombre || '').trim().length < 3) e.nombre = 'Indica tu nombre.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(f.email || '').trim())) e.email = 'Correo no válido.';
    if (String(f.telefono || '').replace(/\D/g, '').length < 8) e.telefono = 'Indica un teléfono.';
    if (!rutValido(f.rut)) e.rut = 'RUT no válido (revisa el dígito verificador).';
    if (String(f.razon || '').trim().length < 3) e.razon = 'Indica la razón social.';
    if (String(f.giro || '').trim().length < 3) e.giro = 'Indica el giro.';
    if (!f.region) e.region = 'Elige la región.';
    if (!f.comuna) e.comuna = 'Elige la comuna.';
    if (String(f.calle || '').trim().length < 4) e.calle = 'Indica calle y número.';
    if (!estado.envio.sel) e.envio = 'Elige un método de envío.';
    if (estado.autocompletado && !estado.revisado) e.revisado = 'Confirma que revisaste tus datos antes de continuar.';
    estado.errores = e;
    return !Object.keys(e).length;
  }
  function enviar() {
    estado.error = '';
    if (!validar()) { pintarCrear(); estado.error = estado.errores.items || 'Revisa los campos marcados.'; pintarResumen(); var m = raiz.querySelector('.mal, .ctz-error'); if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    estado.enviando = true; pintarResumen();
    var f = estado.f, s = estado.envio.sel;
    api('/cotizacion', { accion: 'crear', metodo_pago: f.metodo,
      items: estado.items.map(function (i) { return { variante: i.variante, cantidad: i.cantidad }; }),
      cliente: { nombre: f.nombre, email: f.email, telefono: f.telefono, rut: f.rut, razon_social: f.razon, giro: f.giro },
      direccion: { region: estado.envio.region, comuna: f.comuna, calle: f.calle },
      envio: { nombre: s.nombre, precio: s.precio, region: estado.envio.region, comuna: f.comuna, exp: s.exp, firma: s.firma } }).then(function (r) {
      estado.enviando = false;
      if (r.error || !r.cotizacion) { estado.error = r.error || 'No pudimos generar la cotización.'; if (r._status === 400 && /envío/i.test(estado.error)) pedirEnvio(); return pintarResumen(); }
      guardarLS(r.cotizacion); estado.vista = r.cotizacion; estado.avisoCreada = true; estado.correoFallo = !r.correo_enviado; estado.error = '';
      try { history.replaceState(null, '', '?t=' + encodeURIComponent(r.cotizacion.token)); } catch (e) {}
      pintarVista(); window.scrollTo(0, 0);
    });
  }
  function comprar(acepta) {
    estado.error = ''; estado.comprando = true; pintarVista();
    api('/cotizacion', { accion: 'comprar', token: estado.vista.token, acepta: !!acepta }).then(function (r) {
      estado.comprando = false;
      if (r.requiere_confirmar) { estado.confirmar = r; return pintarVista(); }
      if (r.enlace) { location.href = r.enlace; return; }
      estado.error = r.error || 'No pudimos continuar al pago.'; pintarVista();
    });
  }
  function buscarSug(q) {
    clearTimeout(temporizador);
    if (q.length < 3) { estado.sug = []; return pintarSug(); }
    temporizador = setTimeout(function () {
      fetch('/search/suggest.json?q=' + encodeURIComponent(q) + '&resources[type]=product&resources[limit]=6').then(function (r) { return r.json(); }).then(function (j) {
        estado.sug = ((j.resources && j.resources.results && j.resources.results.products) || []).slice(0, 6); pintarSug();
      }).catch(function () {});
    }, 300);
  }
  function pintarSug() {
    var el = document.getElementById('ctz-sug'); if (!el) return;
    el.innerHTML = estado.sug.length ? '<div class="ctz-sug">' + estado.sug.map(function (p, i) { return '<button type="button" data-sug="' + i + '"><img src="' + esc((p.image || '').replace(/^\/\//, 'https://')) + '" alt=""><span>' + esc(p.title) + '<br><small>' + clp(Number(String(p.price).replace(/[^0-9.]/g, '')) ) + '</small></span></button>'; }).join('') + '</div>' : '';
  }

  // ───── Eventos (delegación) ─────
  raiz.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'ctz-buscar') return buscarSug(t.value.trim());
    if (t.dataset && t.dataset.campo && t.tagName === 'INPUT') { var k = t.dataset.campo; estado.f[k] = t.value; if (estado.errores[k]) { delete estado.errores[k]; t.classList.remove('mal'); } }
  });
  raiz.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.dataset.campo === 'region') { estado.f.region = t.value; estado.f.comuna = ''; delete estado.errores.region; estado.envio = { opciones: [], sel: null, cargando: false, error: '' }; var rr = document.getElementById('ctz-comuna'); if (rr) { var r = estado.comunas.filter(function (x) { return x.codigo === t.value; })[0]; rr.innerHTML = '<option value="">Elige comuna</option>' + (r ? r.comunas.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') : ''); rr.disabled = !r; } pintarEnvio(); }
    else if (t.dataset.campo === 'comuna') { estado.f.comuna = t.value; delete estado.errores.comuna; pedirEnvio(); }
    else if (t.dataset.envio !== undefined) { estado.envio.sel = estado.envio.opciones[Number(t.dataset.envio)]; delete estado.errores.envio; pintarEnvio(); pintarResumen(); }
    else if (t.dataset.revisado !== undefined) { estado.revisado = t.checked; if (t.checked) delete estado.errores.revisado; pintarPerfil(); }
    else if (t.dataset.metodo) { estado.f.metodo = t.dataset.metodo; Array.prototype.forEach.call(raiz.querySelectorAll('input[name=ctz-metodo]'), function (x) { x.closest('.ctz-opcion').classList.toggle('sel', x.checked); }); }
    else if (t.dataset.variante !== undefined) {
      var it = estado.items[Number(t.dataset.variante)], v = it.variantes.filter(function (x) { return String(x.id) === t.value; })[0];
      if (v) { it.variante = v.id; it.precio = v.precio; it.disponible = v.disponible; it.vtitulo = v.titulo; pintarItems(); pintarResumen(); pedirEnvio(); }
    }
    if (t.dataset.campo === 'rut') { var s = rutLimpio(t.value); if (s.length > 1) { var cuerpo = s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); estado.f.rut = cuerpo + '-' + s.slice(-1); t.value = estado.f.rut; } }
  });
  raiz.addEventListener('click', function (ev) {
    var t = ev.target.closest('button, a'); if (!t) return;
    if (t.id === 'ctz-enviar') return enviar();
    if (t.id === 'ctz-perfil-pedir') return pedirPerfil();
    if (t.id === 'ctz-perfil-verificar') return verificarPerfil();
    if (t.id === 'ctz-comprar') return comprar(false);
    if (t.id === 'ctz-aceptar') return comprar(true);
    var d = t.dataset || {};
    if (d.mas !== undefined) { var a = estado.items[Number(d.mas)]; a.cantidad = Math.min(50, a.cantidad + 1); pintarItems(); pintarResumen(); pedirEnvio(); }
    else if (d.menos !== undefined) { var b = estado.items[Number(d.menos)]; b.cantidad = Math.max(1, b.cantidad - 1); pintarItems(); pintarResumen(); pedirEnvio(); }
    else if (d.quitar !== undefined) { estado.items.splice(Number(d.quitar), 1); pintarItems(); pintarResumen(); pedirEnvio(); }
    else if (d.sug !== undefined) {
      var p = estado.sug[Number(d.sug)]; estado.sug = []; pintarSug(); var inp = document.getElementById('ctz-buscar'); if (inp) inp.value = '';
      agregarProducto(p.handle, null, 1).then(function () { pintarItems(); pintarResumen(); pedirEnvio(); });
    }
  });

  // ───── Inicio ─────
  var q = new URLSearchParams(location.search);
  if (q.get('t')) {
    api('/cotizacion', { accion: 'ver', token: q.get('t') }).then(function (r) {
      if (!r.cotizacion) { raiz.innerHTML = '<h1>Cotización</h1><div class="ctz-mal">' + esc(r.error || 'No pudimos abrir la cotización.') + '</div><p><a href="/pages/cotizar">Hacer una cotización nueva</a></p>'; return; }
      estado.vista = r.cotizacion; pintarVista();
    });
  } else {
    fetch(WORKER + '/comunas').then(function (r) { return r.json(); }).catch(function () { return { regiones: [] }; }).then(function (j) {
      estado.comunas = j.regiones || [];
      return cargarDesdeUrl(q.get('p'));
    }).then(function () { pintarCrear(); });
  }
})();

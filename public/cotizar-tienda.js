// Generado por indexstore-buscador-ia/cotizaciones/construir-tienda.cjs desde pagina-cotizar.html. No editar a mano.
(function(){var s=document.createElement('style');s.textContent="\r\n  .ctz { --az: #004fc7; --az-osc: #003a96; --borde: #d6dbe4; --suave: #f3f6fb; --txt-suave: #5b6577; --ok: #15803d; --mal: #b42318; --aviso: #8a5a00; max-width: 1240px; width: 100%; margin: 0 auto; padding: 8px 16px 40px; color: inherit; font-size: 15px; line-height: 1.45; }\r\n  .ctz * { box-sizing: border-box; }\r\n  .ctz h1 { font-size: 26px; margin: 8px 0 4px; }\r\n  .ctz h2 { font-size: 17px; margin: 0 0 12px; }\r\n  .ctz .ctz-sub { color: var(--txt-suave); margin: 0 0 18px; }\r\n  .ctz-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 24px; align-items: start; }\r\n  @media (max-width: 860px) { .ctz-grid { grid-template-columns: minmax(0, 1fr); } }\r\n  .ctz-card { border: 1px solid var(--borde); border-radius: 12px; padding: 16px; margin-bottom: 16px; background: #fff; color: #1b2230; }\r\n  .ctz-card.resumen { position: sticky; top: 12px; }\r\n  .ctz-campos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }\r\n  .ctz-campos .ancho { grid-column: 1 / -1; }\r\n  @media (max-width: 520px) { .ctz-campos { grid-template-columns: minmax(0, 1fr); } }\r\n  .ctz label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; }\r\n  .ctz input[type=text], .ctz input[type=email], .ctz input[type=tel], .ctz input[type=search], .ctz select { width: 100%; min-height: 44px; padding: 9px 11px; border: 1px solid var(--borde); border-radius: 8px; font: inherit; background: #fff; color: #1b2230; }\r\n  .ctz input:focus, .ctz select:focus, .ctz button:focus-visible, .ctz a:focus-visible { outline: 2px solid var(--az); outline-offset: 1px; }\r\n  .ctz input.mal, .ctz select.mal { border-color: var(--mal); }\r\n  .ctz .ctz-error { color: var(--mal); font-size: 13px; margin-top: 4px; }\r\n  .ctz-item { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--borde); }\r\n  .ctz-item:last-child { border-bottom: 0; }\r\n  .ctz-item img { width: 64px; height: 64px; object-fit: contain; border-radius: 8px; background: var(--suave); }\r\n  .ctz-item .t { font-weight: 600; font-size: 14px; }\r\n  .ctz-item .p { color: var(--txt-suave); font-size: 13px; }\r\n  .ctz-item .acc { display: flex; align-items: center; gap: 6px; margin-top: 6px; flex-wrap: wrap; }\r\n  .ctz-item .sub { font-weight: 700; white-space: nowrap; text-align: right; }\r\n  .ctz-cant { display: inline-flex; border: 1px solid var(--borde); border-radius: 8px; overflow: hidden; }\r\n  .ctz-cant button { width: 36px; min-height: 36px; border: 0; background: var(--suave); font-size: 18px; cursor: pointer; color: #1b2230; }\r\n  .ctz-cant span { min-width: 38px; text-align: center; align-self: center; font-weight: 600; }\r\n  .ctz-link { background: none; border: 0; color: var(--az); cursor: pointer; padding: 6px 4px; font: inherit; text-decoration: underline; }\r\n  .ctz-btn { display: inline-block; width: 100%; min-height: 48px; padding: 12px 18px; border: 0; border-radius: 10px; background: var(--az); color: #fff; font: inherit; font-weight: 700; cursor: pointer; text-align: center; text-decoration: none; }\r\n  .ctz-btn:hover { background: var(--az-osc); }\r\n  .ctz-btn[disabled] { opacity: .55; cursor: not-allowed; }\r\n  .ctz-btn.sec { background: #fff; color: var(--az); border: 1.5px solid var(--az); }\r\n  .ctz-opcion { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--borde); border-radius: 10px; margin-bottom: 8px; cursor: pointer; }\r\n  .ctz-opcion.sel { border-color: var(--az); background: #eef4ff; }\r\n  .ctz-opcion input { margin-top: 3px; }\r\n  .ctz-opcion .n { font-weight: 600; }\r\n  .ctz-opcion .l { font-size: 13px; color: var(--txt-suave); }\r\n  .ctz-opcion .pr { margin-left: auto; font-weight: 700; white-space: nowrap; }\r\n  .ctz-fila { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; }\r\n  .ctz-fila.total { border-top: 1px solid var(--borde); margin-top: 8px; padding-top: 10px; font-size: 18px; font-weight: 800; }\r\n  .ctz-aviso { background: #fff8e6; border: 1px solid #f0d58a; color: var(--aviso); border-radius: 8px; padding: 9px 11px; font-size: 13px; margin: 12px 0; }\r\n  .ctz-ok { background: #effaf3; border: 1px solid #bfe5cc; color: #14532d; border-radius: 8px; padding: 9px 11px; margin: 12px 0; }\r\n  .ctz-mal { background: #fff1f0; border: 1px solid #f3b8b3; color: var(--mal); border-radius: 8px; padding: 9px 11px; margin: 12px 0; }\r\n  .ctz-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }\r\n  .ctz-pill.vigente { background: #e7f6ec; color: var(--ok); } .ctz-pill.vencida, .ctz-pill.anulada { background: #fde8e6; color: var(--mal); } .ctz-pill.comprada { background: #e6eefc; color: var(--az); }\r\n  .ctz-sug { border: 1px solid var(--borde); border-radius: 10px; margin-top: 6px; max-height: 300px; overflow: auto; }\r\n  .ctz-sug button { display: flex; gap: 10px; align-items: center; width: 100%; padding: 8px 10px; border: 0; border-bottom: 1px solid var(--borde); background: #fff; cursor: pointer; text-align: left; font: inherit; color: #1b2230; }\r\n  .ctz-sug button:hover { background: var(--suave); }\r\n  .ctz-sug img { width: 40px; height: 40px; object-fit: contain; }\r\n  .ctz-acceso { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }\r\n  @media (max-width: 520px) { .ctz-acceso { grid-template-columns: minmax(0, 1fr); } }\r\n  .ctz-opc { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: left; padding: 14px; border: 1.5px solid var(--borde); border-radius: 12px; background: #fff; color: #1b2230; font: inherit; cursor: pointer; min-height: 44px; }\r\n  .ctz-opc:hover { border-color: var(--az); background: #eef4ff; }\r\n  .ctz-opc b { font-size: 15px; } .ctz-opc span { font-size: 13px; color: var(--txt-suave); }\r\n  .ctz-mis { list-style: none; margin: 0; padding: 0; }\r\n  .ctz-mis li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--borde); }\r\n  .ctz dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; font-size: 14px; }\r\n  .ctz dt { color: var(--txt-suave); } .ctz dd { margin: 0; }\r\n  .ctz-tabla { overflow-x: auto; }\r\n  .ctz-tabla table { width: 100%; border-collapse: collapse; font-size: 14px; }\r\n  .ctz-tabla th, .ctz-tabla td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--borde); }\r\n  .ctz-tabla td.num, .ctz-tabla th.num { text-align: right; white-space: nowrap; }\r\n  .ctz-btn + .ctz-btn { margin-top: 10px; }\r\n  .ctz-pago { white-space: pre-line; background: var(--suave); border: 1px solid var(--borde); border-radius: 10px; padding: 12px 14px; font-size: 14px; line-height: 1.55; margin: 8px 0 12px; }\r\n  .ctz-pill.revision { background: #fff4d6; color: #7a5200; } .ctz-pill.pagada { background: #e7f6ec; color: var(--ok); }\r\n  .ctz-subir { border: 1.5px dashed var(--az); border-radius: 12px; padding: 14px; background: #f5f9ff; margin-top: 10px; }\r\n  .ctz-subir input[type=file] { width: 100%; font: inherit; margin: 8px 0; }\r\n  @media (prefers-reduced-motion: reduce) { .ctz * { transition: none !important; } }\r\n";document.head.appendChild(s);})();

(function () {
  var WORKER = 'https://indexstore-buscador-ia.nmolina.workers.dev';
  var raiz = document.getElementById('ctz');
  // El tema envuelve las páginas en contenedores angostos: se les quita el tope de ancho para que el formulario use el espacio de la pantalla.
  (function () { var n = raiz.parentElement, i = 0; while (n && n !== document.body && i++ < 8) { if (n.tagName !== 'MAIN' || true) { n.style.maxWidth = 'none'; n.style.width = '100%'; } n = n.parentElement; } })();
  var LS = 'ctz_mis_cotizaciones';
  var estado = { items: [], comunas: null, f: { metodo: 'transferencia' }, envio: { opciones: [], sel: null, cargando: false, error: '' }, errores: {}, enviando: false, error: '', sug: [], vista: null, confirmar: null, comprando: false, metodoCompra: 'carro', subiendo: false, errorSubida: '', modo: null, autocompletado: null, revisado: false, retiro: false, hist: { fase: '', msg: '', error: '' } };
  var temporizador = null, tEnvio = null;
  // Retiro en la tienda de Providencia (datos de la ubicación en Shopify). Es gratis y no necesita tarifa.
  var RETIRO = { nombre: 'Retiro en tienda', precio: 0, retiro: true, detalle: 'La Concepción 81, of. 1904, piso 19, Providencia (cerca del metro Pedro de Valdivia). Listo en 1 hora. Lun a Jue 9:30 a 18:30 · Vie 9:30 a 17:30 · Sáb 10:00 a 14:00.' };
  function envioElegido() { return estado.retiro ? RETIRO : estado.envio.sel; }

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

  // ───── Avisos de uso para las estadísticas del ERP (Sitio Web > Cotizaciones web) ─────
  // Solo cuentan que algo pasó (qué acción, desde qué producto); no llevan datos personales. unaVez = una vez por tipo y por visita.
  var avisados = {};
  function avisar(tipo, valor, producto, unaVez) {
    try {
      var clave = tipo + ':' + (valor || ''); if (unaVez && avisados[clave]) return; avisados[clave] = 1;
      var cuerpo = JSON.stringify({ tipo: tipo, valor: valor || null, producto: producto || null, dispositivo: window.matchMedia && matchMedia('(max-width: 768px)').matches ? 'movil' : 'escritorio' });
      if (navigator.sendBeacon) navigator.sendBeacon(WORKER + '/cotizacion-evento', new Blob([cuerpo], { type: 'text/plain;charset=UTF-8' }));
      else fetch(WORKER + '/cotizacion-evento', { method: 'POST', body: cuerpo, keepalive: true }).catch(function () {});
    } catch (e) {}
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
  function totalFinal() { var e = envioElegido(); return subtotal() + (e ? e.precio : 0); }

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
    h += '<label class="ctz-opcion' + (estado.retiro ? ' sel' : '') + '"><input type="radio" name="ctz-envio" data-envio="retiro"' + (estado.retiro ? ' checked' : '') + '><span><span class="n">' + esc(RETIRO.nombre) + '</span><br><span class="l">' + esc(RETIRO.detalle) + '</span></span><span class="pr">Gratis</span></label>';
    if (!estado.f.comuna) h += '<p class="ctz-sub">Elige región y comuna para ver también las opciones de despacho a domicilio.</p>';
    else if (e.cargando) h += '<p class="ctz-sub">Calculando envío a ' + esc(estado.f.comuna) + '…</p>';
    else if (e.error) h += '<div class="ctz-mal">' + esc(e.error) + '</div>';
    else h += e.opciones.map(function (o, i) {
      var sel = !estado.retiro && e.sel && e.sel.nombre === o.nombre;
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
    var e = envioElegido();
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
      '<div class="ctz-grid"><div><div id="ctz-acceso"></div>' +
      '<section class="ctz-card"><h2>Productos</h2><label for="ctz-buscar">Agregar producto</label><input id="ctz-buscar" type="search" placeholder="Busca por nombre, marca o modelo" autocomplete="off"><div id="ctz-sug"></div><div id="ctz-items" style="margin-top:10px"></div></section>' +
      '<section class="ctz-card"><h2>Tus datos</h2><div class="ctz-campos">' + campo('nombre', 'Nombre de contacto', 'text', { auto: 'name' }) + campo('email', 'Correo', 'email', { auto: 'email' }) + campo('telefono', 'Teléfono', 'tel', { auto: 'tel', ph: '+56 9 ...' }) + '</div><div id="ctz-perfil"></div></section>' +
      '<section class="ctz-card"><h2>Datos de facturación</h2><div class="ctz-campos">' + campo('rut', 'RUT empresa', 'text', { ph: '76.123.456-7' }) + campo('razon', 'Razón social', 'text') + campo('giro', 'Giro', 'text', { ancho: true }) + '</div></section>' +
      '<section class="ctz-card"><h2>Dirección de despacho y facturación</h2><p class="ctz-sub" style="font-size:13px;margin:-6px 0 12px">Si retiras en tienda, es la dirección de facturación de tu empresa.</p><div class="ctz-campos">' + selectRegion() + selectComuna() + campo('calle', 'Calle y número', 'text', { ancho: true, auto: 'address-line1' }) + '</div></section>' +
      '<section class="ctz-card"><h2>Método de envío</h2><div id="ctz-envio"></div></section>' +
      '<section class="ctz-card"><h2>Método de pago preferido</h2>' +
      ['transferencia', 'tarjeta'].map(function (m) { return '<label class="ctz-opcion' + (estado.f.metodo === m ? ' sel' : '') + '"><input type="radio" name="ctz-metodo" data-metodo="' + m + '"' + (estado.f.metodo === m ? ' checked' : '') + '><span class="n">' + (m === 'transferencia' ? 'Transferencia bancaria' : 'Tarjeta de crédito o débito') + '</span></label>'; }).join('') +
      '<p class="ctz-sub" style="font-size:12px;margin:6px 0 0">El medio de pago definitivo se elige al pagar.</p></section>' +
      (mis.length ? '<section class="ctz-card"><h2>Mis cotizaciones en este navegador</h2><ul class="ctz-mis">' + mis.map(function (m) { return '<li><a href="?t=' + encodeURIComponent(m.token) + '">N° ' + esc(m.numero) + '</a><span>' + clp(m.total) + ' · vence ' + esc(fecha(m.vence)) + '</span></li>'; }).join('') + '</ul></section>' : '') +
      '</div><aside><div class="ctz-card resumen" id="ctz-resumen"></div></aside></div>';
    pintarItems(); pintarEnvio(); pintarResumen(); pintarPerfil(); pintarAcceso();
  }

  function pintarVista() {
    var c = estado.vista, vigente = c.estado === 'vigente', pago = c.pago || '', enPago = pago === 'transferencia' || pago === 'comprobante' || pago === 'rechazado';
    var filas = (c.items || []).map(function (l) { return '<tr><td>' + esc(l.titulo) + (l.sku ? '<br><small>' + esc(l.sku) + '</small>' : '') + '</td><td class="num">' + l.cantidad + '</td><td class="num">' + clp(l.precio) + '</td><td class="num">' + clp(l.subtotal) + '</td></tr>'; }).join('');
    var conf = '';
    if (estado.confirmar) conf = '<div class="ctz-aviso"><b>Algunos precios cambiaron desde tu cotización:</b><ul style="margin:6px 0 8px 18px">' + estado.confirmar.cambios.map(function (x) { return '<li>' + esc(x.titulo) + ': antes ' + clp(x.antes) + ', ahora ' + clp(x.ahora) + '</li>'; }).join('') + '</ul>Nuevo total: <b>' + clp(estado.confirmar.total_nuevo) + '</b>.<button type="button" class="ctz-btn" id="ctz-aceptar" style="margin-top:10px">' + (estado.metodoCompra === 'transferencia' ? 'Aceptar y continuar con la transferencia' : 'Aceptar y continuar al pago') + '</button></div>';
    var rehacer = (c.items || []).map(function (l) { return encodeURIComponent(l.handle) + ':' + l.variante + ':' + l.cantidad; }).join(',');
    raiz.innerHTML = '<h1>Cotización N° ' + esc(c.numero || '') + ' <span class="ctz-pill ' + esc(c.estado) + '">' + ({ vigente: 'Vigente', vencida: 'Vencida', comprada: 'Pagada', anulada: 'Anulada' }[c.estado] || esc(c.estado)) + '</span>' + (pago === 'comprobante' ? ' <span class="ctz-pill revision">Comprobante en revisión</span>' : '') + '</h1>' +
      '<p class="ctz-sub">' + (vigente ? 'Válida hasta el ' + esc(fecha(c.vence)) + '. Pide el producto antes de que venza para mantener esta cotización.' : 'Venció el ' + esc(fecha(c.vence)) + '.') + '</p>' +
      (estado.avisoCreada ? '<div class="ctz-ok">¡Listo! Creamos tu cotización y te enviamos el detalle a <b>' + esc(c.cliente.email) + '</b>' + (estado.correoFallo ? ' (no pudimos enviar el correo, guarda este enlace)' : '') + '.</div>' : '') +
      '<div class="ctz-grid"><div><section class="ctz-card"><h2>Productos</h2><div class="ctz-tabla"><table><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Subtotal</th></tr></thead><tbody>' + filas + '</tbody></table></div></section>' +
      '<section class="ctz-card"><h2>Datos</h2><dl><dt>Cliente</dt><dd>' + esc(c.cliente.razon_social) + ' (' + esc(c.cliente.rut) + ')</dd><dt>Giro</dt><dd>' + esc(c.cliente.giro) + '</dd><dt>Contacto</dt><dd>' + esc(c.cliente.nombre) + ' · ' + esc(c.cliente.telefono) + '</dd>' + (c.envio.nombre === RETIRO.nombre ? '<dt>Entrega</dt><dd>' + esc(RETIRO.nombre) + ' · ' + esc(RETIRO.detalle) + '</dd><dt>Facturación</dt><dd>' + esc(c.direccion.calle) + ', ' + esc(c.direccion.comuna) + '</dd>' : '<dt>Despacho</dt><dd>' + esc(c.direccion.calle) + ', ' + esc(c.direccion.comuna) + '</dd><dt>Envío</dt><dd>' + esc(c.envio.nombre) + '</dd>') + '</dl></section>' +
      panelTransferencia(c, pago) +
      '</div>' +
      '<aside><div class="ctz-card resumen"><h2>Resumen</h2><div class="ctz-fila"><span>Productos</span><span>' + clp(c.total_productos) + '</span></div><div class="ctz-fila"><span>Envío</span><span>' + (c.envio.precio ? clp(c.envio.precio) : 'Gratis') + '</span></div><div class="ctz-fila total"><span>Total</span><span>' + clp(c.total) + '</span></div>' +
      '<div class="ctz-aviso">Esta cotización no garantiza disponibilidad de stock; se confirma al pagar.</div>' + conf +
      (estado.error ? '<div class="ctz-mal">' + esc(estado.error) + '</div>' : '') +
      (vigente && !enPago && !estado.confirmar ? '<button type="button" class="ctz-btn" id="ctz-comprar"' + (estado.comprando ? ' disabled' : '') + '>' + (estado.comprando && estado.metodoCompra === 'carro' ? 'Revisando stock…' : 'Generar compra con carrito de compra') + '</button>' +
        (c.transferencia_disponible ? '<button type="button" class="ctz-btn sec" id="ctz-transferencia"' + (estado.comprando ? ' disabled' : '') + '>' + (estado.comprando && estado.metodoCompra === 'transferencia' ? 'Revisando stock…' : 'Generar compra por transferencia') + '</button>' : '') : '') +
      (enPago ? '<p class="ctz-sub" style="margin:10px 0 0">Pagas por transferencia: sigue los pasos de abajo.</p>' : '') +
      (!vigente ? '<a class="ctz-btn" href="/pages/cotizar?p=' + rehacer + '">Armar una cotización nueva con estos productos</a>' : '') +
      (c.pdf ? '<p style="text-align:center;margin:10px 0 0"><a href="' + esc(c.pdf) + '" target="_blank" rel="noopener">Descargar PDF</a></p>' : '') +
      '<p style="text-align:center;margin:6px 0 0"><a href="/pages/cotizar">Hacer otra cotización</a></p></div></aside></div>';
  }

  // ───── Pago por transferencia ─────
  function panelTransferencia(c, pago) {
    if (c.estado === 'comprada' || pago === 'aprobado') return '<section class="ctz-card"><h2>Pago recibido</h2><div class="ctz-ok" style="margin:0">Confirmamos tu transferencia. Preparamos tu pedido y te enviaremos la factura al correo.</div></section>';
    if (pago !== 'transferencia' && pago !== 'rechazado' && pago !== 'comprobante') return '';
    var datos = '<h2>Paga por transferencia</h2><p class="ctz-sub" style="margin:0">Transfiere <b>' + clp(c.total) + '</b> a esta cuenta e indica el N° de cotización <b>' + esc(c.numero || '') + '</b> como referencia:</p><div class="ctz-pago">' + esc(c.datos_transferencia) + '</div>';
    if (pago === 'comprobante') return '<section class="ctz-card">' + datos + '<div class="ctz-ok" style="margin:0">Recibimos tu comprobante' + (c.comprobante_nombre ? ' (' + esc(c.comprobante_nombre) + ')' : '') + '. Lo estamos revisando; apenas lo confirmemos te avisamos por correo y emitimos la factura.</div>' + zonaSubida(c, 'Cambiar comprobante') + '</section>';
    return '<section class="ctz-card">' + datos + (pago === 'rechazado' ? '<div class="ctz-mal">No pudimos validar tu comprobante.' + (c.pago_motivo ? ' <b>Motivo:</b> ' + esc(c.pago_motivo) : '') + ' Sube uno nuevo.</div>' : '') + '<h2 style="margin-top:14px">Cuando transfieras, sube tu comprobante</h2>' + zonaSubida(c, 'Enviar comprobante') + '</section>';
  }
  function zonaSubida(c, boton) {
    return '<div class="ctz-subir"><label for="ctz-archivo">Comprobante (foto o PDF, hasta 2,5 MB)</label><input type="file" id="ctz-archivo" accept="image/jpeg,image/png,image/webp,application/pdf">' +
      (estado.errorSubida ? '<div class="ctz-mal" style="margin:6px 0">' + esc(estado.errorSubida) + '</div>' : '') +
      '<button type="button" class="ctz-btn" id="ctz-subir"' + (estado.subiendo ? ' disabled' : '') + '>' + (estado.subiendo ? 'Enviando…' : boton) + '</button></div>';
  }
  function leerArchivo(archivo) { // fotos: se reducen a 1600 px (JPG) para que pesen poco; PDF: tal cual
    return new Promise(function (ok, mal) {
      var lector = new FileReader();
      lector.onerror = function () { mal(new Error('No pudimos leer el archivo.')); };
      lector.onload = function () {
        var url = String(lector.result);
        if (archivo.type === 'application/pdf') return ok({ tipo: 'application/pdf', datos: url.split(',')[1] });
        var img = new Image();
        img.onerror = function () { mal(new Error('No pudimos abrir la imagen.')); };
        img.onload = function () {
          var k = Math.min(1, 1600 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
          cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
          ok({ tipo: 'image/jpeg', datos: cv.toDataURL('image/jpeg', 0.82).split(',')[1] });
        };
        img.src = url;
      };
      lector.readAsDataURL(archivo);
    });
  }
  function subirComprobante() {
    var inp = document.getElementById('ctz-archivo'), archivo = inp && inp.files && inp.files[0];
    estado.errorSubida = '';
    if (!archivo) { estado.errorSubida = 'Elige primero el archivo de tu comprobante.'; return pintarVista(); }
    if (['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].indexOf(archivo.type) < 0) { estado.errorSubida = 'Sube una foto (JPG, PNG, WEBP) o un PDF.'; return pintarVista(); }
    if (archivo.type === 'application/pdf' && archivo.size > 2.5 * 1024 * 1024) { estado.errorSubida = 'El PDF pesa más de 2,5 MB.'; return pintarVista(); }
    estado.subiendo = true; pintarVista();
    leerArchivo(archivo).then(function (a) {
      return api('/cotizacion', { accion: 'comprobante', token: estado.vista.token, tipo: a.tipo, nombre: archivo.name, datos: a.datos });
    }).then(function (r) {
      estado.subiendo = false;
      if (r.cotizacion) { estado.vista = r.cotizacion; estado.errorSubida = ''; } else estado.errorSubida = r.error || 'No pudimos enviar el comprobante. Intenta de nuevo.';
      pintarVista();
    }).catch(function (e) { estado.subiendo = false; estado.errorSubida = e.message || 'No pudimos enviar el comprobante.'; pintarVista(); });
  }

  // ───── Acceso: invitado o con la cuenta de IndexStore ─────
  // window.CTZ_SESION lo deja el bloque Liquid del tema (cotizar-sesion.liquid): sabe si hay un cliente con sesión y sus datos guardados.
  // Los datos solo sirven para rellenar el formulario; lo que se cotiza siempre se valida en el servidor.
  var BORRADOR = 'ctz_borrador';
  function sinTildes(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
  function formatoRut(r) { var s = rutLimpio(r); return s.length < 2 ? String(r || '') : s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + s.slice(-1); }
  function perfilDeSesion(s) {
    var c = s.cliente || {}, d = c.direccion || {}, pe = c.pedido || {}, a = pe.atributos || {}, e = pe.envio || {};
    function primero() { for (var i = 0; i < arguments.length; i++) if (arguments[i]) return arguments[i]; return ''; }
    // Mucha gente escribe el RUT en el campo "Empresa" de la dirección: si lo es, va como RUT y no como razón social.
    var empresaEsRut = d.empresa && rutValido(d.empresa);
    return { origen: 'cuenta de IndexStore', email: c.email, nombre: primero(c.nombre, e.nombre), telefono: primero(a.telefono, c.telefono, e.telefono),
      rut: primero(a.rut, empresaEsRut ? d.empresa : ''), razon_social: primero(a.razon_social, empresaEsRut ? '' : d.empresa), giro: a.giro,
      region: primero(a.region, e.region, d.region), comuna: primero(a.comuna, e.comuna, d.comuna), calle: primero(a.direccion_tributaria, e.calle, d.calle) };
  }
  function pintarAcceso() {
    var el = document.getElementById('ctz-acceso'); if (!el) return;
    var s = window.CTZ_SESION, h = '';
    if (s && s.conectado) {
      h = '<div class="ctz-ok" style="margin-top:0">Sesión iniciada como <b>' + esc((s.cliente || {}).email || '') + '</b>. ' + (estado.autocompletado ? 'Completamos tus datos con lo que tienes guardado en tu cuenta.' : 'Tu cuenta no trae todos los datos de facturación: completa el formulario o búscalos en tus compras anteriores.') + '</div>' + (estado.autocompletado ? '' : htmlHistorial());
    } else if (s && estado.modo === 'invitado') {
      h = '<p class="ctz-sub" style="margin:0 0 12px">Cotizando como invitado. <button type="button" class="ctz-link" data-acceso="sesion">Mejor iniciar sesión</button></p>';
    } else if (s) {
      h = '<section class="ctz-card"><h2>¿Cómo quieres cotizar?</h2><div class="ctz-acceso">' +
        '<button type="button" class="ctz-opc" data-acceso="invitado"><b>Cotizar como invitado</b><span>Solo escribes los datos de esta cotización.</span></button>' +
        '<button type="button" class="ctz-opc" data-acceso="sesion"><b>Iniciar sesión</b><span>Usa tu cuenta de IndexStore y completamos tus datos por ti. Tus productos se mantienen.</span></button></div></section>';
    }
    if (/[?&]ctz_debug=1/.test(location.search)) h += '<pre style="font-size:11px;white-space:pre-wrap;background:#f3f6fb;padding:8px;border-radius:8px">' + esc(JSON.stringify(window.CTZ_SESION === undefined ? 'sin bloque del tema (CTZ_SESION no existe)' : window.CTZ_SESION, null, 1)) + '</pre>';
    el.innerHTML = h;
  }
  function htmlHistorial() {
    var p = estado.hist;
    if (p.fase === 'codigo') {
      return '<div class="ctz-aviso" style="margin-top:0">' + esc(p.msg) + '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center"><input id="ctz-codigo" type="text" inputmode="numeric" maxlength="6" placeholder="Código de 6 dígitos" style="max-width:200px" autocomplete="one-time-code"><button type="button" class="ctz-btn" id="ctz-hist-verificar" style="width:auto">Verificar</button></div>' + (p.error ? '<div class="ctz-error">' + esc(p.error) + '</div>' : '') + '</div>';
    }
    return '<p style="margin:0 0 12px;font-size:13px">¿Ya compraste o cotizaste antes? <button type="button" class="ctz-link" id="ctz-hist-pedir">Completar con mis compras anteriores (te enviamos un código a tu correo)</button></p>' + (p.error ? '<div class="ctz-error" style="margin:-6px 0 12px">' + esc(p.error) + '</div>' : '');
  }
  function pedirHistorial() {
    var email = String(((window.CTZ_SESION || {}).cliente || {}).email || estado.f.email || '').trim();
    api('/cotizacion', { accion: 'perfil_solicitar', email: email }).then(function (r) {
      estado.hist = r.error ? { fase: '', msg: '', error: r.error } : { fase: 'codigo', msg: r.mensaje, error: '' };
      pintarAcceso();
    });
  }
  function verificarHistorial() {
    var email = String(((window.CTZ_SESION || {}).cliente || {}).email || estado.f.email || '').trim();
    api('/cotizacion', { accion: 'perfil_verificar', email: email, codigo: (document.getElementById('ctz-codigo') || {}).value || '' }).then(function (r) {
      if (!r.perfil) { estado.hist.error = r.error || 'No pudimos verificar el código.'; return pintarAcceso(); }
      estado.hist = { fase: '', msg: '', error: '' };
      aplicarPerfil(r.perfil);
    });
  }
  function irALogin() {
    try { localStorage.setItem(BORRADOR, JSON.stringify({ t: Date.now(), p: estado.items.map(function (i) { return encodeURIComponent(i.handle) + ':' + i.variante + ':' + i.cantidad; }).join(',') })); } catch (e) {}
    var s = window.CTZ_SESION || {};
    var base = s.login || '/account/login';
    location.href = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'return_to=' + encodeURIComponent('/pages/cotizar' + (location.search || ''));
  }
  function borradorGuardado() {
    try { var b = JSON.parse(localStorage.getItem(BORRADOR) || 'null'); localStorage.removeItem(BORRADOR); return b && Date.now() - b.t < 3 * 3600000 ? b.p : ''; } catch (e) { return ''; }
  }
  function pintarPerfil() {
    var el = document.getElementById('ctz-perfil'); if (!el) return;
    el.innerHTML = estado.autocompletado ?
      '<div class="ctz-aviso"><b>Completamos tus datos con tu ' + esc(estado.autocompletado) + '.</b> Revísalos con calma antes de generar la cotización: si algo cambió, corrígelo.' +
      '<label style="display:flex;gap:8px;align-items:center;margin:10px 0 0;font-weight:600"><input type="checkbox" id="ctz-revisado" data-revisado' + (estado.revisado ? ' checked' : '') + '> Revisé que mis datos están correctos</label>' +
      (estado.errores.revisado ? '<div class="ctz-error">' + esc(estado.errores.revisado) + '</div>' : '') + '</div>' : '';
  }
  function aplicarPerfil(p) {
    var f = estado.f;
    if (p.email) f.email = p.email; if (p.nombre) f.nombre = p.nombre; if (p.telefono) f.telefono = p.telefono; if (p.rut) f.rut = formatoRut(p.rut);
    if (p.razon_social) f.razon = p.razon_social; if (p.giro) f.giro = p.giro; if (p.calle) f.calle = p.calle;
    var rn = sinTildes(p.region);
    var reg = (estado.comunas || []).filter(function (r) { var n = sinTildes(r.nombre); return rn && (n === rn || n.indexOf(rn) >= 0 || rn.indexOf(n) >= 0); })[0];
    if (reg) { f.region = reg.codigo; var cn = sinTildes(p.comuna); f.comuna = reg.comunas.filter(function (c) { return sinTildes(c) === cn; })[0] || ''; }
    estado.autocompletado = (p.rut || p.calle || p.razon_social) ? (p.origen || 'cuenta') : null; estado.revisado = false;
    estado.errores = {}; estado.error = '';
    estado.envio = { opciones: [], sel: null, cargando: false, error: '' };
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
    if (!envioElegido()) e.envio = 'Elige un método de envío o el retiro en tienda.';
    if (estado.autocompletado && !estado.revisado) e.revisado = 'Confirma que revisaste tus datos antes de continuar.';
    estado.errores = e;
    return !Object.keys(e).length;
  }
  function enviar() {
    estado.error = '';
    if (!validar()) { avisar('form_enviar', 'con_errores'); pintarCrear(); estado.error = estado.errores.items || 'Revisa los campos marcados.'; pintarResumen(); var m = raiz.querySelector('.mal, .ctz-error'); if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    avisar('form_enviar', 'enviado');
    estado.enviando = true; pintarResumen();
    var f = estado.f, s = envioElegido();
    var regionNombre = ((estado.comunas || []).filter(function (r) { return r.codigo === f.region; })[0] || {}).nombre || estado.envio.region;
    api('/cotizacion', { accion: 'crear', metodo_pago: f.metodo,
      items: estado.items.map(function (i) { return { variante: i.variante, cantidad: i.cantidad }; }),
      cliente: { nombre: f.nombre, email: f.email, telefono: f.telefono, rut: f.rut, razon_social: f.razon, giro: f.giro },
      direccion: { region: regionNombre, comuna: f.comuna, calle: f.calle },
      envio: s.retiro ? { tipo: 'retiro' } : { nombre: s.nombre, precio: s.precio, region: regionNombre, comuna: f.comuna, exp: s.exp, firma: s.firma } }).then(function (r) {
      estado.enviando = false;
      if (r.error || !r.cotizacion) { estado.error = r.error || 'No pudimos generar la cotización.'; if (r._status === 400 && /envío/i.test(estado.error)) pedirEnvio(); return pintarResumen(); }
      guardarLS(r.cotizacion); estado.vista = r.cotizacion; estado.avisoCreada = true; estado.correoFallo = !r.correo_enviado; estado.error = '';
      try { history.replaceState(null, '', '?t=' + encodeURIComponent(r.cotizacion.token)); } catch (e) {}
      pintarVista(); window.scrollTo(0, 0);
    });
  }
  function transferir(acepta) {
    estado.error = ''; estado.metodoCompra = 'transferencia'; estado.comprando = true; pintarVista();
    api('/cotizacion', { accion: 'transferencia', token: estado.vista.token, acepta: !!acepta }).then(function (r) {
      estado.comprando = false;
      if (r.requiere_confirmar) { estado.confirmar = r; return pintarVista(); }
      if (r.cotizacion) { estado.vista = r.cotizacion; estado.confirmar = null; pintarVista(); return window.scrollTo(0, 0); }
      estado.error = r.error || 'No pudimos continuar con la transferencia.'; pintarVista();
    });
  }
  function comprar(acepta) {
    estado.error = ''; estado.metodoCompra = 'carro'; estado.comprando = true; pintarVista();
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
    if (t.dataset && t.dataset.campo && t.tagName === 'INPUT') { var k = t.dataset.campo; avisar('form_accion', 'datos', null, true); estado.f[k] = t.value; if (estado.errores[k]) { delete estado.errores[k]; t.classList.remove('mal'); } }
  });
  raiz.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.dataset.campo === 'region') { avisar('form_accion', 'direccion', null, true); estado.f.region = t.value; estado.f.comuna = ''; delete estado.errores.region; estado.envio = { opciones: [], sel: null, cargando: false, error: '' }; var rr = document.getElementById('ctz-comuna'); if (rr) { var r = estado.comunas.filter(function (x) { return x.codigo === t.value; })[0]; rr.innerHTML = '<option value="">Elige comuna</option>' + (r ? r.comunas.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') : ''); rr.disabled = !r; } pintarEnvio(); }
    else if (t.dataset.campo === 'comuna') { avisar('form_accion', 'direccion', null, true); estado.f.comuna = t.value; delete estado.errores.comuna; pedirEnvio(); }
    else if (t.dataset.envio !== undefined) {
      avisar('form_accion', t.dataset.envio === 'retiro' ? 'retiro' : 'envio', null, true);
      if (t.dataset.envio === 'retiro') { estado.retiro = true; estado.envio.sel = null; } else { estado.retiro = false; estado.envio.sel = estado.envio.opciones[Number(t.dataset.envio)]; }
      delete estado.errores.envio; pintarEnvio(); pintarResumen();
    }
    else if (t.dataset.revisado !== undefined) { estado.revisado = t.checked; if (t.checked) delete estado.errores.revisado; pintarPerfil(); }
    else if (t.dataset.metodo) { avisar('form_accion', 'pago', null, true); estado.f.metodo = t.dataset.metodo; Array.prototype.forEach.call(raiz.querySelectorAll('input[name=ctz-metodo]'), function (x) { x.closest('.ctz-opcion').classList.toggle('sel', x.checked); }); }
    else if (t.dataset.variante !== undefined) {
      var it = estado.items[Number(t.dataset.variante)], v = it.variantes.filter(function (x) { return String(x.id) === t.value; })[0];
      avisar('form_accion', 'producto', null, true);
      if (v) { it.variante = v.id; it.precio = v.precio; it.disponible = v.disponible; it.vtitulo = v.titulo; pintarItems(); pintarResumen(); pedirEnvio(); }
    }
    if (t.dataset.campo === 'rut') { var s = rutLimpio(t.value); if (s.length > 1) { var cuerpo = s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); estado.f.rut = cuerpo + '-' + s.slice(-1); t.value = estado.f.rut; } }
  });
  raiz.addEventListener('click', function (ev) {
    var t = ev.target.closest('button, a'); if (!t) return;
    if (t.id === 'ctz-enviar') return enviar();
    if (t.id === 'ctz-comprar') return comprar(false);
    if (t.id === 'ctz-aceptar') return estado.metodoCompra === 'transferencia' ? transferir(true) : comprar(true);
    if (t.id === 'ctz-transferencia') return transferir(false);
    if (t.id === 'ctz-subir') return subirComprobante();
    var d = t.dataset || {};
    if (t.id === 'ctz-hist-pedir') { avisar('form_accion', 'autocompletar', null, true); return pedirHistorial(); }
    if (t.id === 'ctz-hist-verificar') return verificarHistorial();
    if (d.acceso === 'invitado') { avisar('form_accion', 'invitado', null, true); estado.modo = 'invitado'; return pintarAcceso(); }
    if (d.acceso === 'sesion') { avisar('form_accion', 'login', null, true); return irALogin(); }
    if (d.mas !== undefined) { avisar('form_accion', 'cantidad', null, true); var a = estado.items[Number(d.mas)]; a.cantidad = Math.min(50, a.cantidad + 1); pintarItems(); pintarResumen(); pedirEnvio(); }
    else if (d.menos !== undefined) { avisar('form_accion', 'cantidad', null, true); var b = estado.items[Number(d.menos)]; b.cantidad = Math.max(1, b.cantidad - 1); pintarItems(); pintarResumen(); pedirEnvio(); }
    else if (d.quitar !== undefined) { avisar('form_accion', 'producto', null, true); estado.items.splice(Number(d.quitar), 1); pintarItems(); pintarResumen(); pedirEnvio(); }
    else if (d.sug !== undefined) {
      avisar('form_accion', 'producto', null, true);
      var p = estado.sug[Number(d.sug)]; estado.sug = []; pintarSug(); var inp = document.getElementById('ctz-buscar'); if (inp) inp.value = '';
      agregarProducto(p.handle, null, 1).then(function () { pintarItems(); pintarResumen(); pedirEnvio(); });
    }
  });

  // ───── Inicio ─────
  var q = new URLSearchParams(location.search), origenForm = 'directo';
  if (q.get('t')) {
    api('/cotizacion', { accion: 'ver', token: q.get('t') }).then(function (r) {
      if (!r.cotizacion) { raiz.innerHTML = '<h1>Cotización</h1><div class="ctz-mal">' + esc(r.error || 'No pudimos abrir la cotización.') + '</div><p><a href="/pages/cotizar">Hacer una cotización nueva</a></p>'; return; }
      estado.vista = r.cotizacion; pintarVista();
    });
  } else {
    fetch(WORKER + '/comunas').then(function (r) { return r.json(); }).catch(function () { return { regiones: [] }; }).then(function (j) {
      estado.comunas = j.regiones || [];
      var pp = q.get('p'), bor = pp ? '' : borradorGuardado();
      origenForm = pp ? 'ficha' : (bor ? 'login' : 'directo');
      return cargarDesdeUrl(pp || bor);
    }).then(function () {
      var ses = window.CTZ_SESION;
      if (ses && ses.conectado) aplicarPerfil(perfilDeSesion(ses)); else pintarCrear();
      avisar('form_abierto', origenForm, estado.items[0] && estado.items[0].handle, true);
    });
  }
})();

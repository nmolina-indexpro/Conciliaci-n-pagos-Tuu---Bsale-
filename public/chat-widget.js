/* Chat en vivo de IndexStore (reemplazo de Zoho SalesIQ). Un solo archivo, sin dependencias, dentro de Shadow DOM:
 * el CSS del tema de Shopify no lo afecta ni él afecta al tema.
 *
 * Instalación (una sola línea, antes de </body> en theme.liquid; nunca pegar documentos HTML completos en páginas o bloques):
 *   <script src="https://URL-DEL-ERP/chat-widget.js" defer></script>
 *
 * Quién lo ve (atributo data-modo; por defecto "piloto"):
 *   - piloto (por defecto): solo quien entre una vez con ?chat=erp en la dirección (queda recordado en ese navegador). ?chat=off lo apaga.
 *   - data-porcentaje="10": además, el 10% de los visitantes (fijo por navegador).
 *   - data-modo="todos": todos los visitantes.
 *
 * Atributos opcionales: data-color (#0F766E), data-lado (derecha | izquierda), data-offset-x / data-offset-y (px desde el borde, 20 por defecto; sirven
 * para esquivar el botón de WhatsApp), data-titulo (IndexStore), data-globo (texto del globo; se muestra una sola vez por visitante),
 * data-whatsapp (número sin +, para el enlace de respaldo si el chat falla), data-politica (enlace a la política de privacidad),
 * data-ocultar-salesiq="si" (oculta el botón de SalesIQ mientras este chat esté activo en ese navegador).
 * Cualquier elemento con el atributo data-erp-chat abre el chat al hacer clic.
 * Eventos para GTM / Google Ads (dataLayer): erp_chat_iniciado y erp_chat_mensaje (la persona escribió de verdad).
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) { var ss = document.querySelectorAll('script[src*="chat-widget"]'); script = ss[ss.length - 1]; }
  if (!script || window.__erpChatCargado) return;
  var base = ''; try { base = new URL(script.src).origin; } catch (e) { return; }
  window.__erpChatCargado = true;
  var API = base + '/api/negocio?recurso=chat-publico';
  var D = script.dataset || {};
  function num(v, d) { var n = Number(v); return isFinite(n) && v !== undefined && v !== '' ? n : d; }
  var CFG = {
    modo: D.modo || 'piloto', porcentaje: num(D.porcentaje, 0), color: /^#[0-9a-f]{3,8}$/i.test(D.color || '') ? D.color : '#0F766E',
    lado: D.lado === 'izquierda' ? 'izq' : 'der', offX: num(D.offsetX, 20), offY: num(D.offsetY, 20), titulo: D.titulo || 'IndexStore',
    globo: D.globo || '¿Necesitas ayuda? Escríbenos 👋', whatsapp: String(D.whatsapp || '').replace(/\D/g, ''), politica: /^https?:\/\//.test(D.politica || '') ? D.politica : '',
    ocultarSalesiq: D.ocultarSalesiq === 'si',
  };

  // ---------- Almacenamiento (si el navegador lo bloquea, funciona en memoria) ----------
  var mem = {};
  var LS = {
    get: function (k) { try { var v = window.localStorage.getItem(k); return v === null ? (mem[k] === undefined ? null : mem[k]) : v; } catch (e) { return mem[k] === undefined ? null : mem[k]; } },
    set: function (k, v) { mem[k] = String(v); try { window.localStorage.setItem(k, String(v)); } catch (e) { /* sin almacenamiento */ } },
    del: function (k) { delete mem[k]; try { window.localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } },
  };
  var SS = {
    get: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
  };

  // ---------- ¿Le toca a este visitante? ----------
  var qs = new URLSearchParams(location.search);
  if (qs.get('chat') === 'erp') LS.set('erp_chat_piloto', '1');
  if (qs.get('chat') === 'off') { LS.del('erp_chat_piloto'); LS.del('erp_chat_token'); }
  function activo() {
    if (LS.get('erp_chat_piloto') === '1' || CFG.modo === 'todos') return true;
    if (CFG.porcentaje > 0) {
      var g = LS.get('erp_chat_grupo');
      if (g === null) { g = String(Math.floor(Math.random() * 100)); LS.set('erp_chat_grupo', g); }
      return Number(g) < CFG.porcentaje;
    }
    return false;
  }
  if (!activo()) return;

  // ---------- Datos de la visita ----------
  function atribucion() {
    var o = {}, claves = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'gclid'], guardado = {};
    try { guardado = JSON.parse(SS.get('erp_chat_utm') || '{}') || {}; } catch (e) { guardado = {}; }
    var hay = false;
    claves.forEach(function (k) { var v = qs.get(k); if (v) { guardado[k] = v.slice(0, 300); hay = true; } });
    if (hay) SS.set('erp_chat_utm', JSON.stringify(guardado));
    claves.forEach(function (k) { if (guardado[k]) o[k] = guardado[k]; });
    return o;
  }
  function metaContenido(sel) { var el = document.querySelector(sel); return el ? (el.getAttribute('content') || el.getAttribute('href') || '') : ''; }
  function datosPagina() {
    var d = { pagina: location.href.slice(0, 500) };
    if (/\/products\//.test(location.pathname)) {
      d.producto_titulo = (metaContenido('meta[property="og:title"]') || document.title || '').slice(0, 200);
      d.producto_url = (metaContenido('link[rel="canonical"]') || location.origin + location.pathname).slice(0, 500);
    }
    return d;
  }
  function dispositivo() { return window.innerWidth < 750 ? 'movil' : 'escritorio'; }
  function dl(evento) { try { window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: evento }); } catch (e) { /* sin GTM */ } }

  // ---------- Estado ----------
  var S = { token: LS.get('erp_chat_token'), ultimoId: 0, estado: null, paso: null, agente: null, cerrado: false, abierto: false, noLeidos: 0, ultimaActividad: Date.now(),
            cola: [], animando: false, pend: [], enviando: false, mensajeDicho: false, ultimoAutor: null, t0: 0 };
  var timer = null, rafScroll = 0;

  // ---------- DOM (Shadow DOM) ----------
  var host = document.createElement('div');
  host.id = 'erp-chat-raiz';
  var sh = host.attachShadow({ mode: 'open' });
  var ICONO = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';
  sh.innerHTML = '<style>' + [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    '.raiz{position:fixed;bottom:' + CFG.offY + 'px;' + (CFG.lado === 'izq' ? 'left' : 'right') + ':' + CFG.offX + 'px;z-index:2147483000;font-size:14px;line-height:1.4;color:#1f2937;letter-spacing:normal;word-spacing:normal;text-transform:none;text-indent:0;text-align:left;font-style:normal;font-weight:400}', // lo heredable se fija aquí: así el tema del sitio no se filtra por la herencia del elemento anfitrión
    '[hidden]{display:none!important}',
    'button{font:inherit;cursor:pointer}',
    '.burbuja{position:relative;width:58px;height:58px;border-radius:50%;border:none;background:' + CFG.color + ';color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;padding:0;transition:transform .15s}',
    '.burbuja:hover{transform:scale(1.06)}',
    '.burbuja:focus-visible,.min:focus-visible,.fin:focus-visible,.env:focus-visible,.foto:focus-visible,.chip:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}',
    '.badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#dc2626;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px}',
    '.globo{position:absolute;bottom:68px;' + (CFG.lado === 'izq' ? 'left' : 'right') + ':0;width:max-content;max-width:240px;background:#fff;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.2);padding:12px 30px 12px 14px;cursor:pointer;animation:sube .3s ease-out}',
    '.globo .x{position:absolute;top:4px;right:6px;border:none;background:none;font-size:18px;color:#6b7280;padding:2px 6px;line-height:1}',
    '.panel{position:absolute;bottom:70px;' + (CFG.lado === 'izq' ? 'left' : 'right') + ':0;width:361px;height:min(440px,calc(100vh - ' + (CFG.offY + 90) + 'px));background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;animation:sube .2s ease-out}',
    '.cab{background:' + CFG.color + ';color:#fff;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.cab .t{font-weight:700;font-size:15px}.cab .s{font-size:12px;opacity:.9}',
    '.cab .acc{display:flex;gap:2px}',
    '.min,.fin{background:none;border:none;color:#fff;width:32px;height:32px;border-radius:8px;font-size:18px;line-height:1;padding:0}',
    '.min:hover,.fin:hover{background:rgba(255,255,255,.18)}',
    '.cuerpo{flex:1;min-height:0;display:flex;flex-direction:column;background:#f6f7f9}',
    '.msgs{flex:1;min-height:0;overflow-y:auto;padding:12px 12px 4px;display:flex;flex-direction:column;gap:6px;overscroll-behavior:contain}',
    '.m{max-width:84%;padding:8px 12px;border-radius:14px;word-break:break-word;white-space:pre-wrap;animation:sube .18s ease-out}',
    '.m a{color:inherit;text-decoration:underline}',
    '.m img{display:block;max-width:100%;max-height:200px;border-radius:8px;margin-top:4px;background:#fff}',
    '.m.v{align-self:flex-end;background:' + CFG.color + ';color:#fff;border-bottom-right-radius:4px}',
    '.m.a,.m.b{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px}',
    '.m .q{font-size:11px;font-weight:700;color:#6b7280;margin-bottom:2px}',
    '.m.s{align-self:center;background:none;color:#6b7280;font-size:12px;text-align:center;padding:2px 0;max-width:95%}',
    '.m.pend{opacity:.6}',
    '.escribe{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-radius:14px;border-bottom-left-radius:4px;padding:10px 14px;display:flex;gap:4px}',
    '.escribe i{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:pulso 1s infinite}.escribe i:nth-child(2){animation-delay:.15s}.escribe i:nth-child(3){animation-delay:.3s}',
    '.chips{padding:6px 12px 10px;display:flex;flex-wrap:wrap;gap:6px}',
    '.chip{border:1.5px solid ' + CFG.color + ';background:#fff;color:' + CFG.color + ';border-radius:999px;padding:6px 12px;font-size:13px;font-weight:600}',
    '.chip:hover{background:' + CFG.color + ';color:#fff}',
    '.chip.sec{border-color:#d1d5db;color:#4b5563;font-weight:500}',
    '.chip.sec:hover{background:#4b5563;color:#fff;border-color:#4b5563}',
    '.comp{border-top:1px solid #e5e7eb;background:#fff;padding:8px;display:flex;gap:6px;align-items:flex-end}',
    '.comp textarea{flex:1;resize:none;border:1.5px solid #d1d5db;border-radius:12px;padding:9px 11px;font-size:14px;max-height:96px;min-height:40px;outline:none;color:#111827;background:#fff}',
    '.comp textarea:focus{border-color:' + CFG.color + '}',
    '.env,.foto{border:none;border-radius:12px;height:40px;min-width:40px;display:flex;align-items:center;justify-content:center;padding:0 12px;font-weight:700}',
    '.env{background:' + CFG.color + ';color:#fff}.env:disabled{opacity:.5;cursor:default}',
    '.foto{background:#eef0f3;color:#374151;font-size:18px}',
    '.pre{padding:16px;display:flex;flex-direction:column;gap:10px;overflow-y:auto}',
    '.pre h3{margin:0;font-size:16px;color:#111827}.pre p{margin:0;color:#4b5563;font-size:13px}',
    '.pre label{font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:3px}',
    '.pre input[type=text]{width:100%;border:1.5px solid #d1d5db;border-radius:10px;padding:9px 11px;font-size:14px;outline:none;color:#111827;background:#fff}',
    '.pre input[type=text]:focus{border-color:' + CFG.color + '}',
    '.pre .trampa{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}',
    '.pre .ok{border:none;background:' + CFG.color + ';color:#fff;border-radius:10px;padding:11px;font-weight:700;font-size:14px}',
    '.pre .ok:disabled{opacity:.6}',
    '.pre .legal{font-size:11px;color:#6b7280}.pre .legal a{color:#6b7280}',
    '.err{color:#b91c1c;font-size:13px}',
    '.fin-chat{padding:12px;text-align:center;background:#fff;border-top:1px solid #e5e7eb}',
    '.fin-chat button{border:none;background:' + CFG.color + ';color:#fff;border-radius:10px;padding:10px 16px;font-weight:700}',
    '@keyframes sube{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '@keyframes pulso{0%,60%,100%{opacity:.3}30%{opacity:1}}',
    '@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}',
    // En celular se respetan los márgenes configurados (sirven para esquivar el botón de WhatsApp); el panel es una tarjeta que no tapa toda la pantalla.
    '@media (max-width:600px){.raiz{bottom:' + CFG.offY + 'px;' + (CFG.lado === 'izq' ? 'left' : 'right') + ':' + Math.min(CFG.offX, 24) + 'px}',
    '.panel{position:fixed;left:12px;right:12px;bottom:' + (CFG.offY + 66) + 'px;width:auto;height:min(62vh,470px);height:min(62dvh,470px)}',
    '.burbuja{width:52px;height:52px}.comp textarea{font-size:16px}.pre input[type=text]{font-size:16px}}',
  ].join('\n') + '</style>' +
  '<div class="raiz">' +
    '<div class="globo" hidden><button class="x" aria-label="Cerrar aviso">×</button><span class="gt"></span></div>' +
    '<section class="panel" role="dialog" aria-label="Chat con ' + CFG.titulo + '" hidden>' +
      '<div class="cab"><div><div class="t"></div><div class="s" aria-live="polite"></div></div>' +
        '<div class="acc"><button class="fin" type="button" title="Terminar el chat" aria-label="Terminar el chat" hidden>⏻</button><button class="min" type="button" title="Minimizar" aria-label="Minimizar el chat">–</button></div></div>' +
      '<div class="cuerpo">' +
        '<form class="pre" novalidate hidden>' +
          '<h3>¡Hola! 👋</h3><p>Cuéntanos tu nombre y te ayudamos con lo que necesites.</p>' +
          '<div><label for="pn">Tu nombre</label><input id="pn" type="text" maxlength="80" autocomplete="given-name" placeholder="Ej: María"></div>' +
          '<div><label for="pc">WhatsApp o correo (opcional)</label><input id="pc" type="text" maxlength="120" autocomplete="off" placeholder="+56 9 1234 5678 o nombre@correo.cl"></div>' +
          '<input class="trampa" type="text" name="web" tabindex="-1" autocomplete="off" aria-hidden="true">' +
          '<div class="err" role="alert"></div>' +
          '<button class="ok" type="submit">Comenzar chat</button>' +
          '<div class="legal">Usaremos tus datos solo para atenderte.<span class="pol"></span></div>' +
        '</form>' +
        '<div class="msgs" aria-live="polite" hidden></div>' +
        '<div class="chips" hidden></div>' +
      '</div>' +
      '<div class="comp" hidden><input class="archivo" type="file" accept="image/*" hidden><button class="foto" type="button" title="Enviar una foto" aria-label="Enviar una foto">📷</button>' +
        '<textarea rows="1" maxlength="1000" placeholder="Escribe tu mensaje…" aria-label="Mensaje"></textarea><button class="env" type="button" aria-label="Enviar">Enviar</button></div>' +
      '<div class="fin-chat" hidden><div style="margin-bottom:8px;color:#4b5563">Este chat terminó.</div><button type="button" class="nuevo">Iniciar un nuevo chat</button></div>' +
    '</section>' +
    '<button class="burbuja" type="button" aria-label="Abrir el chat">' + ICONO + '<span class="badge" hidden></span></button>' +
  '</div>';
  var q = function (s) { return sh.querySelector(s); };
  var el = { globo: q('.globo'), gt: q('.gt'), panel: q('.panel'), t: q('.cab .t'), s: q('.cab .s'), fin: q('.fin'), min: q('.min'), pre: q('.pre'), msgs: q('.msgs'), chips: q('.chips'),
             comp: q('.comp'), txt: q('.comp textarea'), env: q('.env'), foto: q('.foto'), archivo: q('.archivo'), finChat: q('.fin-chat'), nuevo: q('.nuevo'), burbuja: q('.burbuja'), badge: q('.badge'),
             pn: q('#pn'), pc: q('#pc'), err: q('.pre .err'), ok: q('.pre .ok'), trampa: q('.pre .trampa'), pol: q('.pol') };
  el.t.textContent = CFG.titulo; el.gt.textContent = CFG.globo;
  if (CFG.politica) { var a = document.createElement('a'); a.href = CFG.politica; a.target = '_blank'; a.rel = 'noopener'; a.textContent = ' Ver política de privacidad.'; el.pol.appendChild(a); }
  if (CFG.ocultarSalesiq) {
    var st = document.createElement('style'); st.setAttribute('data-erp-chat', '');
    st.textContent = '#zsiq_float,.zsiq_floatmain,#zsiq_chat_wrap,.zsiq-newfloat{display:none!important}';
    (document.head || document.documentElement).appendChild(st);
  }

  // ---------- Utilidades de pantalla ----------
  function formato(texto) { // texto plano -> nodos (enlaces y *negrita*), sin innerHTML
    var f = document.createDocumentFragment();
    String(texto || '').split(/(https?:\/\/[^\s<]+)/g).forEach(function (parte, i) {
      if (i % 2 === 1) { var a = document.createElement('a'); a.href = parte; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = parte; f.appendChild(a); return; }
      parte.split(/(\*[^*\n]+\*)/g).forEach(function (p) {
        if (/^\*[^*\n]+\*$/.test(p)) { var b = document.createElement('b'); b.textContent = p.slice(1, -1); f.appendChild(b); } else if (p) f.appendChild(document.createTextNode(p));
      });
    });
    return f;
  }
  function bajar(forzar) {
    cancelAnimationFrame(rafScroll);
    rafScroll = requestAnimationFrame(function () {
      var m = el.msgs; if (forzar || m.scrollHeight - m.scrollTop - m.clientHeight < 140) m.scrollTop = m.scrollHeight;
    });
  }
  function nodoMensaje(m, pendiente) {
    var d = document.createElement('div');
    var clase = m.autor === 'visitante' ? 'v' : m.autor === 'agente' ? 'a' : m.autor === 'bot' ? 'b' : 's';
    d.className = 'm ' + clase + (pendiente ? ' pend' : '');
    if (clase === 'a' || clase === 'b') { var q1 = document.createElement('div'); q1.className = 'q'; q1.textContent = m.nombre || (clase === 'b' ? 'Asistente' : 'Ejecutivo'); d.appendChild(q1); }
    if (m.tipo === 'imagen' && m.adjunto && S.token) {
      var im = document.createElement('img'); im.alt = 'Foto enviada'; im.loading = 'lazy';
      im.src = API + '&adjunto=' + encodeURIComponent(m.adjunto) + '&token=' + encodeURIComponent(S.token); im.addEventListener('load', function () { bajar(false); }); d.appendChild(im);
    } else d.appendChild(formato(m.texto));
    if (m.imagen_url && /^https:\/\//.test(m.imagen_url)) { var ib = document.createElement('img'); ib.alt = ''; ib.src = m.imagen_url; ib.addEventListener('load', function () { bajar(false); }); d.appendChild(ib); }
    return d;
  }

  // ---------- Vistas ----------
  function vista() { // qué parte del panel se ve según el estado
    var enChat = !!S.token && !S.cerrado;      // conversación en curso
    var sinSesion = !S.token && !S.cerrado;    // todavía no empieza: se ve el formulario con el nombre
    el.pre.hidden = !sinSesion; el.msgs.hidden = sinSesion;
    el.comp.hidden = !enChat; el.finChat.hidden = !S.cerrado; el.fin.hidden = !enChat;
    pintarEstado(); pintarChips();
  }
  function pintarEstado() {
    var t = 'Respondemos en minutos';
    if (S.cerrado) t = 'Chat finalizado';
    else if (S.estado === 'activo') t = S.agente && S.agente.nombre ? 'Te atiende ' + S.agente.nombre : 'Te atiende un ejecutivo';
    else if (S.estado === 'cola') t = 'Conectándote con un ejecutivo…';
    else if (S.estado === 'bot') t = 'Asistente de ' + CFG.titulo;
    el.s.textContent = t;
  }
  function pintarChips() {
    el.chips.textContent = '';
    var ultimo = S.ultimoMsg; var hay = false;
    if (!S.token || S.cerrado || S.animando || S.cola.length) { el.chips.hidden = true; return; }
    if (ultimo && ultimo.autor === 'bot' && ultimo.opciones && ultimo.opciones.length) {
      ultimo.opciones.forEach(function (o) { var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = o.etiqueta; b.addEventListener('click', function () { enviar({ opcion: o.id, texto: o.etiqueta }); }); el.chips.appendChild(b); hay = true; });
    }
    if (S.estado === 'bot' && ['tipo', 'modelo', 'pedido', 'detalle'].indexOf(S.paso) >= 0) {
      var e = document.createElement('button'); e.type = 'button'; e.className = 'chip sec'; e.textContent = 'Hablar con un ejecutivo';
      e.addEventListener('click', function () { enviar({ opcion: 'ejecutivo', texto: 'Quiero hablar con un ejecutivo' }); }); el.chips.appendChild(e); hay = true;
    }
    el.chips.hidden = !hay;
  }

  // ---------- Recepción de mensajes ----------
  // Los del asistente se muestran con un "escribiendo…" breve, uno tras otro, para que la conversación se sienta natural.
  function recibir(msgs, sinAnimar) {
    (msgs || []).forEach(function (m) {
      if (m.id <= S.ultimoId) return;
      S.ultimoId = m.id;
      if (m.autor === 'visitante') quitarPendiente(m);
      S.cola.push({ m: m, animar: !sinAnimar && m.autor === 'bot' });
    });
    S.ultimaActividad = Date.now();
    procesarCola();
  }
  function quitarPendiente(m) { var i = S.pend.findIndex(function (p) { return p.texto === m.texto; }); if (i >= 0) { var p = S.pend.splice(i, 1)[0]; if (p.nodo.parentNode) p.nodo.parentNode.removeChild(p.nodo); } }
  function procesarCola() {
    if (S.animando) return;
    var it = S.cola.shift();
    if (!it) { pintarChips(); return; }
    var mostrar = function () {
      S.animando = false;
      var n = nodoMensaje(it.m, false);
      // pendientes del visitante quedan siempre al final
      var ref = S.pend.length ? S.pend[0].nodo : null; el.msgs.insertBefore(n, ref); bajar(true);
      S.ultimoMsg = it.m; S.ultimoAutor = it.m.autor;
      if (!S.abierto && it.m.autor !== 'visitante' && it.m.autor !== 'sistema') { S.noLeidos++; pintarBadge(); }
      procesarCola();
    };
    if (it.animar && S.abierto) {
      S.animando = true; pintarChips();
      var tip = document.createElement('div'); tip.className = 'escribe'; tip.innerHTML = '<i></i><i></i><i></i>'; el.msgs.appendChild(tip); bajar(true);
      var ms = Math.min(1400, 450 + String(it.m.texto || '').length * 9);
      setTimeout(function () { if (tip.parentNode) tip.parentNode.removeChild(tip); mostrar(); }, ms);
    } else mostrar();
  }
  function pintarBadge() { el.badge.hidden = S.noLeidos <= 0; el.badge.textContent = S.noLeidos > 9 ? '9+' : String(S.noLeidos); }
  function aplicarRespuesta(j, sinAnimar) {
    if (!j) return;
    if (j.estado) { S.estado = j.estado; S.paso = j.paso || S.paso; }
    S.agente = j.agente || S.agente; if (S.estado !== 'activo') S.agente = null;
    recibir(j.mensajes, sinAnimar);
    if (j.cerrado) cerrarSesionLocal();
    pintarEstado();
  }
  function cerrarSesionLocal() { // la conversación terminó: se conserva el token en memoria solo para seguir viendo las fotos
    S.cerrado = true; LS.del('erp_chat_token'); detener();
    vista();
  }
  function olvidarSesion() { // el servidor ya no la conoce: se vuelve al formulario
    detener(); LS.del('erp_chat_token'); S.token = null; S.cerrado = false; S.estado = null; S.paso = null; S.ultimoMsg = null; S.cola = []; S.pend = []; el.msgs.textContent = ''; S.t0 = Date.now(); vista();
  }

  // ---------- Red ----------
  function llamar(accion, cuerpo) {
    var c = cuerpo || {}; c.accion = accion;
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); });
  }
  function errorRed(msg) {
    var d = document.createElement('div'); d.className = 'm s';
    d.textContent = msg || 'No pudimos conectar el chat.';
    if (CFG.whatsapp) { d.appendChild(document.createTextNode(' Escríbenos por ')); var a = document.createElement('a'); a.href = 'https://wa.me/' + CFG.whatsapp; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'WhatsApp'; d.appendChild(a); d.appendChild(document.createTextNode('.')); }
    el.msgs.appendChild(d); bajar(true);
  }

  // ---------- Sondeo (sin websockets: consulta cada pocos segundos, más lento cuando no hay nada en juego) ----------
  function intervalo() {
    var ociosa = Date.now() - S.ultimaActividad;
    if (document.hidden) return 20000;
    if (!S.abierto) return 15000;
    if (S.estado === 'cola') return 3000; // el sondeo del visitante también hace de reloj de la cola
    return ociosa > 300000 ? 20000 : ociosa > 60000 ? 8000 : 3000;
  }
  function programar() { clearTimeout(timer); if (!S.token || S.cerrado) return; timer = setTimeout(sondear, intervalo()); }
  function detener() { clearTimeout(timer); timer = null; }
  function sondear() {
    if (!S.token || S.cerrado) return;
    var cuerpo = { token: S.token, desde: S.ultimoId }; var p = datosPagina(); for (var k in p) cuerpo[k] = p[k];
    llamar('leer', cuerpo).then(function (r) {
      if (r.status === 404) { olvidarSesion(); return; }
      if (r.ok) aplicarRespuesta(r.j, false);
    }).catch(function () { /* se reintenta en el siguiente ciclo */ }).then(programar);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.token && !S.cerrado) { clearTimeout(timer); sondear(); } });

  // ---------- Acciones ----------
  function iniciar(ev) {
    ev.preventDefault();
    var nombre = el.pn.value.trim(); el.err.textContent = '';
    if (nombre.length < 2) { el.err.textContent = 'Cuéntanos tu nombre para empezar'; el.pn.focus(); return; }
    var c = el.pc.value.trim(), cuerpo = { nombre: nombre, t: Date.now() - S.t0, web: el.trampa.value, dispositivo: dispositivo(), referrer: (document.referrer || '').slice(0, 300) };
    if (c) { if (c.indexOf('@') >= 0) cuerpo.email = c; else cuerpo.telefono = c; }
    var p = datosPagina(); for (var k in p) cuerpo[k] = p[k]; var at = atribucion(); for (var k2 in at) cuerpo[k2] = at[k2];
    el.ok.disabled = true; el.ok.textContent = 'Conectando…';
    llamar('iniciar', cuerpo).then(function (r) {
      el.ok.disabled = false; el.ok.textContent = 'Comenzar chat';
      if (!r.ok || r.j.error) { el.err.textContent = (r.j && r.j.error) || 'No pudimos conectar el chat. Intenta de nuevo.'; return; }
      if (!r.j.token) { el.err.textContent = 'No pudimos conectar el chat. Intenta de nuevo.'; return; }
      LS.set('erp_chat_nombre', nombre); LS.set('erp_chat_token', r.j.token);
      S.token = r.j.token; S.cerrado = false; S.ultimoId = 0; S.cola = []; S.pend = []; S.mensajeDicho = false; S.ultimoMsg = null; el.msgs.textContent = '';
      dl('erp_chat_iniciado');
      vista(); aplicarRespuesta(r.j, false); programar(); setTimeout(function () { el.txt.focus(); }, 60);
    }).catch(function () { el.ok.disabled = false; el.ok.textContent = 'Comenzar chat'; el.err.textContent = 'No pudimos conectar el chat. Revisa tu conexión e intenta de nuevo.'; });
  }
  function enviar(o) {
    if (!S.token || S.cerrado || S.enviando) return;
    var texto = (o && o.texto !== undefined ? o.texto : el.txt.value).trim();
    if (!texto) return;
    S.enviando = true;
    var cuerpo = { token: S.token, desde: S.ultimoId }; var p = datosPagina(); for (var k in p) cuerpo[k] = p[k];
    if (o && o.opcion) cuerpo.opcion = o.opcion; else cuerpo.texto = texto;
    var nodo = nodoMensaje({ autor: 'visitante', texto: texto }, true); el.msgs.appendChild(nodo); bajar(true);
    S.pend.push({ texto: texto, nodo: nodo });
    if (!o) { el.txt.value = ''; ajustar(); }
    el.chips.hidden = true; S.ultimaActividad = Date.now(); S.ultimoMsg = null;
    if (!S.mensajeDicho && !(o && o.opcion)) { S.mensajeDicho = true; dl('erp_chat_mensaje'); }
    llamar('enviar', cuerpo).then(function (r) {
      S.enviando = false;
      if (r.status === 404) { olvidarSesion(); return; }
      if (!r.ok || r.j.error) { if (nodo.parentNode) nodo.parentNode.removeChild(nodo); S.pend = S.pend.filter(function (x) { return x.nodo !== nodo; }); errorRed(r.j && r.j.error); pintarChips(); return; }
      aplicarRespuesta(r.j, false); clearTimeout(timer); programar();
    }).catch(function () { S.enviando = false; if (nodo.parentNode) nodo.parentNode.removeChild(nodo); S.pend = S.pend.filter(function (x) { return x.nodo !== nodo; }); errorRed('No pudimos enviar tu mensaje. Revisa tu conexión.'); });
  }
  function reducirImagen(file) { // la foto se reduce antes de subirla (el servidor acepta hasta 3 MB)
    return new Promise(function (ok, mal) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85));
      };
      im.onerror = function () { URL.revokeObjectURL(url); mal(new Error('No pudimos leer esa imagen')); };
      im.src = url;
    });
  }
  function subirFoto() {
    var f = el.archivo.files && el.archivo.files[0]; el.archivo.value = ''; if (!f || !S.token || S.cerrado) return;
    el.foto.disabled = true;
    reducirImagen(f).then(function (datos) { return llamar('adjunto', { token: S.token, desde: S.ultimoId, nombre: f.name.replace(/\.[^.]+$/, '') + '.jpg', datos: datos }); })
      .then(function (r) { if (!r.ok || r.j.error) { errorRed(r.j && r.j.error); return; } aplicarRespuesta(r.j, false); clearTimeout(timer); programar(); })
      .catch(function (e) { errorRed(e && e.message); }).then(function () { el.foto.disabled = false; });
  }
  function terminar() {
    if (!S.token || S.cerrado) return;
    if (!window.confirm('¿Terminar esta conversación?')) return;
    var t = S.token;
    llamar('cerrar', { token: t }).catch(function () {}).then(function () { cerrarSesionLocal(); });
  }
  function ajustar() { el.txt.style.height = 'auto'; el.txt.style.height = Math.min(el.txt.scrollHeight, 96) + 'px'; }

  // ---------- Abrir / cerrar ----------
  function abrir() {
    S.abierto = true; el.panel.hidden = false; el.globo.hidden = true; LS.set('erp_chat_globo', '1'); LS.set('erp_chat_abierto', '1');
    S.noLeidos = 0; pintarBadge(); el.burbuja.setAttribute('aria-label', 'Minimizar el chat');
    if (!S.token) { S.cerrado = false; S.t0 = Date.now(); var n = LS.get('erp_chat_nombre'); if (n && !el.pn.value) el.pn.value = n; }
    vista(); if (S.token && !S.cerrado) { bajar(true); setTimeout(function () { el.txt.focus(); }, 60); clearTimeout(timer); sondear(); } else if (!S.token) setTimeout(function () { el.pn.focus(); }, 60);
  }
  function minimizar() { S.abierto = false; el.panel.hidden = true; LS.set('erp_chat_abierto', '0'); el.burbuja.setAttribute('aria-label', 'Abrir el chat'); programar(); }
  el.burbuja.addEventListener('click', function () { S.abierto ? minimizar() : abrir(); });
  el.min.addEventListener('click', minimizar);
  el.fin.addEventListener('click', terminar);
  el.pre.addEventListener('submit', iniciar);
  el.env.addEventListener('click', function () { enviar(); });
  el.txt.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
  el.txt.addEventListener('input', ajustar);
  el.foto.addEventListener('click', function () { el.archivo.click(); });
  el.archivo.addEventListener('change', subirFoto);
  el.nuevo.addEventListener('click', function () { S.token = null; S.cerrado = false; S.estado = null; S.paso = null; S.ultimoMsg = null; el.msgs.textContent = ''; S.t0 = Date.now(); vista(); setTimeout(function () { el.pn.focus(); }, 60); });
  q('.globo .x').addEventListener('click', function (e) { e.stopPropagation(); el.globo.hidden = true; LS.set('erp_chat_globo', '1'); });
  el.globo.addEventListener('click', abrir);
  sh.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.abierto) { minimizar(); el.burbuja.focus(); } });
  document.addEventListener('click', function (e) { var t = e.target && e.target.closest ? e.target.closest('[data-erp-chat]') : null; if (t) { e.preventDefault(); abrir(); } });
  window.ERPChat = { abrir: abrir, cerrar: minimizar };

  // ---------- Arranque ----------
  function arrancar() {
    document.body.appendChild(host);
    pintarEstado();
    if (S.token) { // conversación en curso: se recupera y, si ya terminó, se descarta
      var cuerpo = { token: S.token, desde: 0 }; var p = datosPagina(); for (var k in p) cuerpo[k] = p[k];
      llamar('leer', cuerpo).then(function (r) {
        if (r.status === 404 || !r.ok) { S.token = null; LS.del('erp_chat_token'); vista(); return; }
        if (r.j.cerrado) { S.token = null; LS.del('erp_chat_token'); vista(); return; }
        vista(); aplicarRespuesta(r.j, true); programar();
        if (LS.get('erp_chat_abierto') === '1' && window.innerWidth > 600) abrir();
      }).catch(function () { vista(); });
    } else {
      vista();
      if (!LS.get('erp_chat_globo')) setTimeout(function () { if (!S.abierto && !S.token) el.globo.hidden = false; }, 4000);
    }
  }
  if (document.body) arrancar(); else document.addEventListener('DOMContentLoaded', arrancar);
})();

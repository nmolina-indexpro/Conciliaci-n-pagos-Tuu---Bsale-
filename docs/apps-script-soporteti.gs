/**
 * Envía al ERP de IndexStore los correos que llegan a soporteti@indexpro.cl, para que se conviertan en tickets de la tiquetera "Soporte TI".
 * Se instala UNA vez en la cuenta de Google que recibe ese correo (ver docs/tickets-correo-soporte-ti.md).
 *
 * Propiedades del script (Configuración del proyecto > Propiedades del script):
 *   ERP_URL   = https://DOMINIO-DEL-ERP/api/negocio?recurso=tickets-correo
 *   ERP_KEY   = la misma clave que TICKETS_CORREO_KEY en Vercel
 *   ULTIMO    = (opcional) fecha en milisegundos desde la que revisar la primera vez; si no existe, se toman las últimas 24 horas
 */
var DIRECCION = 'soporteti@indexpro.cl';
var MAX_ADJUNTO_BYTES = 2 * 1024 * 1024;       // un adjunto más grande no se envía (queda anotado su nombre en el ticket)
var MAX_TOTAL_ADJUNTOS_BYTES = 2.8 * 1024 * 1024; // el ERP recibe como máximo ~4,5 MB por envío
var SOLAPE_MS = 10 * 60 * 1000;                // se revisa 10 minutos hacia atrás por seguridad; el ERP ignora lo que ya recibió

function procesarSoporteTI() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('ERP_URL');
  var clave = props.getProperty('ERP_KEY');
  if (!url || !clave) throw new Error('Faltan ERP_URL y ERP_KEY en las propiedades del script');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // ya hay una pasada en curso
  try {
    var desde = Number(props.getProperty('ULTIMO')) || (Date.now() - 24 * 3600 * 1000);
    var inicioSeg = Math.floor((desde - SOLAPE_MS) / 1000);
    var hilos = GmailApp.search('(to:' + DIRECCION + ' OR cc:' + DIRECCION + ' OR deliveredto:' + DIRECCION + ') after:' + inicioSeg, 0, 50);

    var pendientes = [];
    hilos.forEach(function (hilo) {
      hilo.getMessages().forEach(function (m) {
        if (m.getDate().getTime() > desde - SOLAPE_MS) pendientes.push({ m: m, hilo: hilo });
      });
    });
    pendientes.sort(function (a, b) { return a.m.getDate().getTime() - b.m.getDate().getTime(); });

    var ultimo = desde;
    for (var i = 0; i < pendientes.length; i++) {
      var r = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', headers: { 'x-api-key': clave }, muteHttpExceptions: true,
        payload: JSON.stringify({ mensajes: [armarMensaje(pendientes[i].m, pendientes[i].hilo)] })
      });
      if (r.getResponseCode() !== 200) { Logger.log('El ERP respondió ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200)); break; }
      var res = JSON.parse(r.getContentText()).resultados[0];
      if (res.accion === 'error') { Logger.log('El ERP no pudo procesar ' + res.id + ': ' + res.error); break; } // se reintenta en la próxima pasada
      ultimo = Math.max(ultimo, pendientes[i].m.getDate().getTime());
    }
    props.setProperty('ULTIMO', String(ultimo));
  } finally {
    lock.releaseLock();
  }
}

function armarMensaje(m, hilo) {
  var autoSubmitted = String(m.getHeader('Auto-Submitted') || '').toLowerCase();
  var precedence = String(m.getHeader('Precedence') || '').toLowerCase();
  var auto = (autoSubmitted !== '' && autoSubmitted !== 'no') || /bulk|junk|auto_reply/.test(precedence);

  var adjuntos = [], omitidos = [], total = 0;
  m.getAttachments({ includeInlineImages: false, includeAttachments: true }).forEach(function (a) {
    var peso = a.getSize();
    if (peso <= MAX_ADJUNTO_BYTES && total + peso <= MAX_TOTAL_ADJUNTOS_BYTES) {
      adjuntos.push({ nombre: a.getName(), tipo: a.getContentType(), base64: Utilities.base64Encode(a.getBytes()) });
      total += peso;
    } else {
      omitidos.push(a.getName());
    }
  });

  return {
    id: m.getId(), hilo: hilo.getId(), de: parsearRemitente(m.getFrom()), para: m.getTo(), asunto: m.getSubject(),
    fecha: m.getDate().toISOString(), texto: String(m.getPlainBody() || '').slice(0, 30000), auto: auto,
    adjuntos: adjuntos, adjuntosOmitidos: omitidos
  };
}

function parsearRemitente(s) {
  var m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(String(s || ''));
  return m ? { nombre: m[1].trim(), email: m[2].trim() } : { nombre: '', email: String(s || '').trim() };
}

/** Ejecutar UNA vez: crea el disparador que corre procesarSoporteTI cada minuto. */
function instalarDisparador() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'procesarSoporteTI') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('procesarSoporteTI').timeBased().everyMinutes(1).create();
}

// /lib/whatsapp-ejecutivos.js
// Cálculo del "control operativo + efectividad del seguimiento" por ejecutivo
// de WhatsApp. Función pura, sin imports (se prueba aislada y la usa
// api/negocio.js).
//
// ── Modelo ────────────────────────────────────────────────────────────────
// Todo se calcula sobre la LÍNEA DE TIEMPO DE MENSAJES de cada contacto
// (no sobre whatsapp_conversaciones.responsable_id, que es una asignación
// actual y no demuestra quién escribió un mensaje histórico).
//
// Episodio: serie de mensajes de un contacto en la que ningún hueco supera
//   12 h (más de 12 h exactas abre un episodio nuevo). Ajuste respecto de la
//   "conversación" del sistema (se corta a las 24 h, configurable, medido
//   contra updated_at): aquí se necesita el corte exacto de 12 h para
//   clasificar recontactos, así que los episodios se recalculan desde los
//   mensajes; la conversación sigue siendo el contenedor que se abre en el
//   detalle.
// Entrante: episodio que parte con un mensaje del cliente. "Atendido" si
//   recibe una respuesta humana antes del corte; si no, "sin respuesta".
//   Un saliente que llega mientras hay un entrante sin atender es la
//   respuesta (aunque pasen más de 12 h: es una atención tardía, no un
//   recontacto) y atiende todos los entrantes abiertos de ese contacto.
// Nuevo proactivo: primer saliente humano a un contacto sin ningún mensaje
//   anterior.
// Recontacto (intento): primer saliente humano de un episodio nuevo, con
//   historial previo y más de 12 h desde el último mensaje enviado o
//   recibido, cuando NO hay un entrante pendiente de respuesta. Los mensajes
//   salientes consecutivos (sin pausa >12 h) son un solo intento.
//   Si el cliente retoma primero, es un entrante, no un recontacto.
// Respuesta a un recontacto: mensaje entrante posterior a un intento, hasta
//   48 h después del PRIMER intento de ese ejecutivo a ese cliente en el
//   período (los intentos extra no reinician la ventana). Si hay varios
//   ejecutivos, la respuesta se vincula al último intento humano anterior a
//   ella cuya ventana siga vigente: una respuesta nunca se atribuye a dos.
// Unidad: (ejecutivo, cliente) en la tabla; (cliente) deduplicado en los
//   totales y tarjetas sin filtro de ejecutivo.
// Autor: solo el usuario autenticado que envió desde el ERP (columna o
//   auditoría). Si no hay registro => "no verificado" (clave 'nv'), nunca se
//   reasigna al responsable de la conversación ni a firmas detectadas por IA.

export const PAUSA_RECONTACTO_MS = 12 * 3600 * 1000;
export const VENTANA_RESPUESTA_MS = 48 * 3600 * 1000;

export const MOTIVOS_SEGUIMIENTO = [
  { clave: 'cotizacion_pendiente', label: 'Cotización pendiente' },
  { clave: 'validar_compatibilidad', label: 'Validar compatibilidad' },
  { clave: 'disponibilidad_stock', label: 'Disponibilidad de stock' },
  { clave: 'otro', label: 'Otro motivo' },
];
export const MOTIVO_SIN_CLASIFICAR = { clave: 'sin_clasificar', label: 'Sin clasificar' };

export const CLAVE_NO_VERIFICADO = 'nv';
export const CLAVE_SIN_ASIGNAR = 'sa';
export const claveUsuario = id => 'u' + id;
const claveAutor = autorId => (autorId ? claveUsuario(autorId) : CLAVE_NO_VERIFICADO);

function mediana(valores) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

// Recorre la línea de tiempo de UN contacto y devuelve sus episodios entrantes,
// sus intentos (proactivos y recontactos) y todos sus mensajes entrantes.
// msgs: [{id, t, dir:'in'|'out', autorId, origenAutor, conversacionId, responsableId}] ordenados por t.
// previo: {ultimaT, abiertaSinResponder} del historial anterior al período (o null).
function recorrerContacto(msgs, previo, p) {
  const { desdeMs, hastaMs, pausaMs } = p;
  const episodios = [];
  const intentos = [];
  const entradas = [];
  let lastT = previo?.ultimaT ?? null;
  let abiertoPrevio = !!previo?.abiertaSinResponder;
  let abiertos = [];
  for (const m of msgs) {
    const enPeriodo = m.t >= desdeMs && m.t < hastaMs;
    const pausa = lastT == null ? null : m.t - lastT;
    if (m.dir === 'in') {
      entradas.push(m);
      const nuevo = lastT == null || pausa > pausaMs;
      if (nuevo && enPeriodo) {
        const ep = { inicio: m, pausaPrevia: pausa, tieneHistorial: lastT != null, respuesta: null };
        episodios.push(ep);
        abiertos.push(ep);
      }
    } else {
      if (abiertos.length > 0 || abiertoPrevio) {
        // Respuesta (posiblemente tardía) a entrantes sin atender. Después del corte no cuenta.
        if (m.t < hastaMs) {
          for (const ep of abiertos) ep.respuesta = m;
          abiertos = [];
          abiertoPrevio = false;
        }
      } else if (lastT == null || pausa > pausaMs) {
        if (enPeriodo) {
          intentos.push({
            tipo: lastT == null ? 'proactivo' : 'recontacto',
            msg: m, pausaPrevia: pausa, tieneHistorial: lastT != null,
          });
        }
      }
      // Dentro del mismo episodio (hueco <= 12 h) un saliente extra es parte del bloque/conversación en curso.
    }
    lastT = m.t;
  }
  return { episodios, intentos, entradas };
}

// Vincula respuestas a intentos de recontacto de UN contacto y arma sus unidades.
function analizarRecontactosContacto(intentos, entradas, p) {
  const rec = intentos.filter(a => a.tipo === 'recontacto').sort((a, b) => a.msg.t - b.msg.t || a.msg.id - b.msg.id);
  if (!rec.length) return null;
  const { ventanaMs, ahoraMs } = p;
  for (const a of rec) a.clave = claveAutor(a.msg.autorId);

  const t1PorClave = new Map();
  for (const a of rec) if (!t1PorClave.has(a.clave)) t1PorClave.set(a.clave, a.msg.t);
  const finVentana = a => t1PorClave.get(a.clave) + ventanaMs;

  // Cada entrante se vincula al ÚLTIMO intento previo con ventana vigente (nunca a dos).
  const vinculos = [];
  for (const r of entradas) {
    let elegido = null;
    for (const a of rec) {
      if (a.msg.t < r.t && r.t <= finVentana(a)) elegido = a;
    }
    if (elegido) vinculos.push({ r, intento: elegido });
  }

  const construirUnidad = (clave) => {
    const intentosU = clave == null ? rec : rec.filter(a => a.clave === clave);
    const vincU = clave == null ? vinculos : vinculos.filter(v => v.intento.clave === clave);
    vincU.sort((a, b) => a.r.t - b.r.t);
    const primera = vincU[0] || null;
    const respondio = !!primera;
    const abierta = !respondio && intentosU.some(a => ahoraMs < finVentana(a));
    const contados = intentosU.filter(a => a.msg.t <= finVentana(a) && (!primera || a.msg.t < primera.r.t));
    return {
      clave, intentos: intentosU, primerIntento: intentosU[0], respondio, abierta,
      respuesta: primera ? primera.r : null,
      intentosContados: contados.length,
    };
  };

  const claves = [...new Set(rec.map(a => a.clave))];
  return {
    intentos: rec,
    porClave: new Map(claves.map(c => [c, construirUnidad(c)])),
    global: construirUnidad(null),
  };
}

// API principal. Devuelve todo lo necesario para tabla, tarjetas y detalle, de modo
// que los tres salgan del MISMO cálculo.
//   mensajes: [{id, contactoId, conversacionId, responsableId, t, dir, autorId, origenAutor}]
//   previos:  Map contactoId -> {ultimaT, abiertaSinResponder}
//   motivos:  Map mensajeId -> clave de motivo
//   elegibles: Set de contactoId con una oportunidad de seguimiento identificable (o null si no hay datos)
export function calcularControlEjecutivos({ mensajes, previos, motivos, elegibles, desdeMs, hastaMs, ahoraMs, ejecutivoClave }) {
  const p = { desdeMs, hastaMs, ahoraMs, pausaMs: PAUSA_RECONTACTO_MS, ventanaMs: VENTANA_RESPUESTA_MS };
  const porContacto = new Map();
  for (const m of mensajes) {
    if (!porContacto.has(m.contactoId)) porContacto.set(m.contactoId, []);
    porContacto.get(m.contactoId).push(m);
  }

  const todosEpisodios = [];
  const todosIntentos = [];
  const unidades = []; // por contacto: {contactoId, porClave, global}
  for (const [contactoId, msgs] of porContacto) {
    msgs.sort((a, b) => a.t - b.t || a.id - b.id);
    const { episodios, intentos, entradas } = recorrerContacto(msgs, previos?.get(contactoId) || null, p);
    for (const ep of episodios) { ep.contactoId = contactoId; todosEpisodios.push(ep); }
    for (const a of intentos) { a.contactoId = contactoId; todosIntentos.push(a); }
    const an = analizarRecontactosContacto(intentos, entradas, p);
    if (an) unidades.push({ contactoId, ...an });
  }

  // ---------- Eventos (la fuente única) ----------
  const eventos = [];
  for (const ep of todosEpisodios) {
    const atendido = !!ep.respuesta;
    const clave = atendido ? claveAutor(ep.respuesta.autorId) : (ep.inicio.responsableId ? claveUsuario(ep.inicio.responsableId) : CLAVE_SIN_ASIGNAR);
    eventos.push({
      tipo: atendido ? 'entrante_atendido' : 'entrante_sin_respuesta',
      contactoId: ep.contactoId, conversacionId: ep.inicio.conversacionId, t: ep.inicio.t,
      clave,
      autorOrigen: atendido ? (ep.respuesta.origenAutor || 'sin_registro') : null,
      pausaPrevia: ep.pausaPrevia,
      respuestaT: atendido ? ep.respuesta.t : null,
      respuestaSeg: atendido ? Math.max(0, Math.round((ep.respuesta.t - ep.inicio.t) / 1000)) : null,
    });
  }
  for (const a of todosIntentos) {
    const clave = claveAutor(a.msg.autorId);
    const ev = {
      tipo: a.tipo === 'proactivo' ? 'nuevo_proactivo' : 'recontacto',
      contactoId: a.contactoId, conversacionId: a.msg.conversacionId, t: a.msg.t,
      clave, autorOrigen: a.msg.origenAutor || 'sin_registro', pausaPrevia: a.pausaPrevia,
      mensajeId: a.msg.id,
      elegible: !!elegibles && elegibles.has(a.contactoId),
    };
    a.evento = ev;
    eventos.push(ev);
  }
  // Marcas por unidad en los intentos de recontacto.
  for (const u of unidades) {
    for (const [clave, un] of u.porClave) {
      const ev = un.primerIntento.evento;
      ev.primeroEjecutivo = true;
      ev.respondioEjecutivo = un.respondio;
      ev.abiertaEjecutivo = un.abierta;
      ev.respuestaT = un.respuesta ? un.respuesta.t : null;
      ev.motivo = motivos?.get(un.primerIntento.msg.id) || null;
      ev.intentosContados = un.intentosContados;
    }
    const g = u.global;
    const evG = g.primerIntento.evento;
    evG.primeroGlobal = true;
    evG.respondioGlobal = g.respondio;
    evG.abiertaGlobal = g.abierta;
    evG.respuestaGlobalT = g.respuesta ? g.respuesta.t : null;
    evG.intentosContadosGlobal = g.intentosContados;
    evG.motivoGlobal = motivos?.get(g.primerIntento.msg.id) || null;
  }
  for (const ev of eventos) if (ev.tipo === 'recontacto' && ev.motivo === undefined) ev.motivo = motivos?.get(ev.mensajeId) || null;

  // ---------- Filas por ejecutivo ----------
  const filas = new Map();
  const fila = clave => {
    if (!filas.has(clave)) filas.set(clave, { clave, recibidas: 0, atendidas: 0, sinRespuesta: 0, nuevosProactivos: 0, intentos: 0, clientes: 0, respondieron: 0, ventanasAbiertas: 0, tiemposSeg: [] });
    return filas.get(clave);
  };
  for (const ev of eventos) {
    const f = fila(ev.clave);
    if (ev.tipo === 'entrante_atendido') { f.recibidas++; f.atendidas++; f.tiemposSeg.push(ev.respuestaSeg); }
    else if (ev.tipo === 'entrante_sin_respuesta') { f.recibidas++; f.sinRespuesta++; }
    else if (ev.tipo === 'nuevo_proactivo') f.nuevosProactivos++;
    else if (ev.tipo === 'recontacto') {
      f.intentos++;
      if (ev.primeroEjecutivo) { f.clientes++; if (ev.respondioEjecutivo) f.respondieron++; if (ev.abiertaEjecutivo) f.ventanasAbiertas++; }
    }
  }

  const resumenFila = f => ({
    clave: f.clave, recibidas: f.recibidas, atendidas: f.atendidas, sinRespuesta: f.sinRespuesta,
    nuevosProactivos: f.nuevosProactivos, intentos: f.intentos, clientes: f.clientes,
    respondieron: f.respondieron, ventanasAbiertas: f.ventanasAbiertas,
    pctRespondieron: f.clientes ? Math.round(f.respondieron / f.clientes * 100) : null,
    primeraRespuestaMedianaSeg: mediana(f.tiemposSeg),
  });

  // ---------- Totales (deduplicados) y vista filtrada ----------
  const filtra = !!ejecutivoClave;
  const evVista = filtra ? eventos.filter(e => e.clave === ejecutivoClave) : eventos;
  const unidadesVista = filtra
    ? unidades.filter(u => u.porClave.has(ejecutivoClave)).map(u => ({ contactoId: u.contactoId, un: u.porClave.get(ejecutivoClave) }))
    : unidades.map(u => ({ contactoId: u.contactoId, un: u.global }));

  const totalTiempos = evVista.filter(e => e.tipo === 'entrante_atendido').map(e => e.respuestaSeg);
  const recibidas = evVista.filter(e => e.tipo === 'entrante_atendido' || e.tipo === 'entrante_sin_respuesta').length;
  const atendidas = evVista.filter(e => e.tipo === 'entrante_atendido').length;
  const clientesRecontactados = unidadesVista.length;
  const respondieron = unidadesVista.filter(x => x.un.respondio).length;
  const total = {
    recibidas, atendidas, sinRespuesta: recibidas - atendidas,
    nuevosProactivos: evVista.filter(e => e.tipo === 'nuevo_proactivo').length,
    intentos: evVista.filter(e => e.tipo === 'recontacto').length,
    clientes: clientesRecontactados, respondieron,
    ventanasAbiertas: unidadesVista.filter(x => x.un.abierta).length,
    pctRespondieron: clientesRecontactados ? Math.round(respondieron / clientesRecontactados * 100) : null,
    primeraRespuestaMedianaSeg: mediana(totalTiempos),
  };

  // Motivos: cada cliente (unidad) cae en UN solo motivo, el de su primer intento.
  const gruposMotivo = new Map([...MOTIVOS_SEGUIMIENTO, MOTIVO_SIN_CLASIFICAR].map(m => [m.clave, { clave: m.clave, label: m.label, clientes: 0, respondieron: 0 }]));
  for (const { un } of unidadesVista) {
    const clave = motivos?.get(un.primerIntento.msg.id);
    const g = gruposMotivo.get(gruposMotivo.has(clave) ? clave : MOTIVO_SIN_CLASIFICAR.clave);
    g.clientes++;
    if (un.respondio) g.respondieron++;
  }
  const motivosOut = [...gruposMotivo.values()].map(g => ({ ...g, pct: g.clientes ? Math.round(g.respondieron / g.clientes * 100) : null }));

  // Intentos por cliente: dos grupos excluyentes (1 intento / 2 o más) hasta la primera respuesta o el cierre de la ventana.
  const grupo = { uno: { clientes: 0, respondieron: 0 }, dosOMas: { clientes: 0, respondieron: 0 } };
  for (const { un } of unidadesVista) {
    const g = un.intentosContados >= 2 ? grupo.dosOMas : grupo.uno;
    g.clientes++;
    if (un.respondio) g.respondieron++;
  }
  for (const g of Object.values(grupo)) g.pct = g.clientes ? Math.round(g.respondieron / g.clientes * 100) : null;

  // Cobertura: clientes elegibles recontactados / clientes elegibles.
  let cobertura = null;
  if (elegibles) {
    const recontactadosElegibles = new Set();
    for (const ev of evVista) if (ev.tipo === 'recontacto' && elegibles.has(ev.contactoId)) recontactadosElegibles.add(ev.contactoId);
    cobertura = {
      elegibles: elegibles.size, recontactados: recontactadosElegibles.size,
      pct: elegibles.size ? Math.round(recontactadosElegibles.size / elegibles.size * 100) : null,
    };
  }

  return {
    filas: [...filas.values()].map(resumenFila),
    total, motivos: motivosOut, intentosPorCliente: grupo, cobertura,
    ventanasAbiertasClientes: total.ventanasAbiertas,
    eventos, // el detalle recibe todos los eventos; cada indicador filtra los suyos (mismos datos que tabla y tarjetas)
  };
}

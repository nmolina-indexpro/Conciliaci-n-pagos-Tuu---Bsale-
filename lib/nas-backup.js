// /lib/nas-backup.js
// Soporte > IndexPro: backups de los NAS QNAP de los clientes de IndexPro.
// Funciones puras (sin BD ni red) para poder probarlas con datos de ejemplo.
//
// FASE 1 (hoy): los eventos vienen de los correos que el propio NAS manda con
// Notification Center (Hybrid Backup Sync). OJO: un correo ausente NO prueba
// que el job no corrió -- solo que el NAS no avisó. Por eso el estado se llama
// "sin avisos" y no "no corrió".
// FASE 2: un agente en el NAS empujará el estado real (fuente = 'agente') a la
// misma tabla nas_backup_eventos, y este resumen seguirá funcionando igual.

// Clientes y los jobs de HBS 3 que se esperan de cada uno. "toleranciaDias" es
// cuántos días puede pasar sin un backup exitoso antes de marcarlo "sin avisos".
export const CLIENTES = {
  magua: {
    id: 'magua',
    nombre: 'Inmobiliaria Magua',
    detalle: 'NAS-PATAGUA (también aparece como "Patagua" en los correos del NAS)',
    nas: 'NAS-PATAGUA',
    equipo: 'QNAP TS-451+',
    // A quién se le envía el informe semanal (lib/nas-backup-correo.js), previa aprobación en Soporte > IndexPro.
    destinatariosInforme: ['gfresno@inmobiliariamagua.cl'],
    // Reciben el mismo informe en copia oculta cuando se aprueba y envía (el cliente no los ve).
    copiaInforme: ['nmolina@indexpro.cl', 'lhernandez@indexstore.cl'],
    jobs: [
      { nombre: 'Backup-Diario-Disco-Externo', etiqueta: 'Backup diario', destino: 'Disco externo USB (incremental)', cadencia: 'Diaria', horario: 'todos los días 01:30', toleranciaDias: 2 },
      { nombre: 'RAIZ PATAGUA A DRIVE Q3Z1ON', etiqueta: 'Backup semanal', destino: 'Google Drive (vinculado en QTS)', cadencia: 'Semanal', horario: 'viernes 01:00', toleranciaDias: 9 },
    ],
  },
  mvs: {
    id: 'mvs',
    nombre: 'MvS Group',
    detalle: 'Aún sin NAS conectado al panel',
    nas: null,
    equipo: null,
    destinatariosInforme: [],
    copiaInforme: [],
    jobs: [],
  },
};

const MS_DIA = 86400000;
const FMT_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });

// 'YYYY-MM-DD' en hora de Chile (los backups corren de madrugada: ver la fecha en UTC los movería de día).
export function diaChile(fecha) {
  return FMT_DIA.format(fecha instanceof Date ? fecha : new Date(fecha));
}
export function diasEntre(desdeDia, hastaDia) {
  return Math.round((Date.parse(hastaDia + 'T00:00:00Z') - Date.parse(desdeDia + 'T00:00:00Z')) / MS_DIA);
}
function sumarDias(dia, n) {
  return new Date(Date.parse(dia + 'T00:00:00Z') + n * MS_DIA).toISOString().slice(0, 10);
}

export const esExito = e => e.tipo === 'finished' && e.severidad !== 'Error';
export const esFalla = e => e.tipo === 'failed' || e.severidad === 'Error';
export const esAviso = e => e.tipo === 'warning' || e.severidad === 'Warning';

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

// Normaliza una fila de la BD (o del historial) a lo que consume la página.
export function normalizarEvento(r) {
  const fecha = r.fecha instanceof Date ? r.fecha.toISOString() : new Date(r.fecha).toISOString();
  return {
    id: r.evento_id ?? r.id ?? null,
    fecha,
    dia: diaChile(fecha),
    job: r.job || null,
    tipo: r.tipo,
    severidad: r.severidad || null,
    categoria: r.categoria || null,
    mensaje: r.mensaje || '',
    carpetas: num(r.carpetas),
    archivosTotal: num(r.archivos_total),
    sinCambios: num(r.sin_cambios),
    omitidos: num(r.omitidos),
    respaldados: num(r.respaldados),
    tamanoGb: num(r.tamano_gb),
    transferidoGb: num(r.transferido_gb),
    ejecucion: num(r.ejecucion),
    velocidad: r.velocidad || null,
    fuente: r.fuente || 'gmail',
  };
}

// HBS 3 manda DOS correos por cada término (o falla) de un job, con 1-2 segundos de diferencia: uno "Job Status" sin cifras y otro
// "Custom Job Event" con archivos / GB. Se fusionan en un solo evento (queda el que trae cifras) para no contar doble.
const VENTANA_DUPLICADO_MS = 180000;
export function consolidarEventos(eventos) {
  const ordenados = [...eventos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const resultado = [];
  const ultimoPorClave = new Map();
  for (const e of ordenados) {
    const clave = `${e.job}|${e.tipo}`;
    const idx = ultimoPorClave.get(clave);
    if (idx !== undefined && Date.parse(e.fecha) - Date.parse(resultado[idx].fecha) <= VENTANA_DUPLICADO_MS) {
      if (e.tamanoGb !== null && resultado[idx].tamanoGb === null) resultado[idx] = e;
      continue;
    }
    ultimoPorClave.set(clave, resultado.length);
    resultado.push(e);
  }
  // El historial de trabajos de HBS 3 (fuente 'hbs-panel') y el correo de término describen la MISMA corrida (el panel trae la hora de inicio y
  // el correo la de término, con minutos de diferencia): se dejan como un solo evento por job y día, con las cifras de ambos.
  const final = [];
  const finalPorDia = new Map();
  for (const e of resultado) {
    if (e.tipo === 'finished' && e.job) {
      const clave = `${e.job}|${e.dia}`;
      const idx = finalPorDia.get(clave);
      if (idx !== undefined && final[idx].fuente !== e.fuente && (final[idx].fuente === 'hbs-panel' || e.fuente === 'hbs-panel')) {
        const base = final[idx].fuente === 'hbs-panel' ? final[idx] : e;
        const otro = base === e ? final[idx] : e;
        final[idx] = { ...base, tamanoGb: otro.tamanoGb ?? base.tamanoGb, archivosTotal: otro.archivosTotal ?? base.archivosTotal, sinCambios: otro.sinCambios ?? base.sinCambios, omitidos: otro.omitidos ?? base.omitidos, carpetas: otro.carpetas ?? base.carpetas, velocidad: otro.velocidad ?? base.velocidad };
        continue;
      }
      if (idx === undefined) finalPorDia.set(clave, final.length);
    }
    final.push(e);
  }
  return final;
}

// Calendario de los últimos N días de un job: por día, éxitos / fallas.
function calendario(eventosJob, hoy, dias) {
  const porDia = new Map();
  for (const e of eventosJob) {
    const d = porDia.get(e.dia) || { exitos: 0, fallas: 0, avisos: 0 };
    if (esExito(e)) d.exitos++;
    else if (esFalla(e)) d.fallas++;
    else if (esAviso(e)) d.avisos++;
    porDia.set(e.dia, d);
  }
  const lista = [];
  for (let i = dias - 1; i >= 0; i--) {
    const dia = sumarDias(hoy, -i);
    const d = porDia.get(dia) || { exitos: 0, fallas: 0, avisos: 0 };
    const estado = d.fallas ? 'falla' : (d.exitos ? (d.avisos ? 'aviso' : 'ok') : (d.avisos ? 'aviso' : 'vacio'));
    lista.push({ dia, estado, ...d });
  }
  return lista;
}

// Resumen de UN job: estado, último éxito/falla, conteos, calendario y serie de tamaño.
export function resumirJob(def, eventos, ahora = new Date()) {
  const hoy = diaChile(ahora);
  const propios = eventos.filter(e => e.job === def.nombre).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const exitos = propios.filter(esExito);
  const fallas = propios.filter(esFalla);
  const ultimoEvento = propios[propios.length - 1] || null;
  const ultimoExito = exitos[exitos.length - 1] || null;
  const ultimaFalla = fallas[fallas.length - 1] || null;
  const contar = (lista, dias) => lista.filter(e => diasEntre(e.dia, hoy) < dias).length;

  const diasDesdeAviso = ultimoEvento ? diasEntre(ultimoEvento.dia, hoy) : null;
  const diasDesdeExito = ultimoExito ? diasEntre(ultimoExito.dia, hoy) : null;
  const tolerancia = def.toleranciaDias ?? 2;

  let estado;
  if (!ultimoEvento) estado = 'sin_datos';
  else if (ultimaFalla && (!ultimoExito || ultimaFalla.fecha > ultimoExito.fecha)) estado = 'falla';
  else if (diasDesdeExito === null || diasDesdeExito > tolerancia) estado = 'sin_avisos';
  else estado = 'ok';

  return {
    ...def,
    estado,
    ultimoEvento, ultimoExito, ultimaFalla,
    diasDesdeAviso, diasDesdeExito,
    exitos30: contar(exitos, 30), fallas30: contar(fallas, 30),
    exitos90: contar(exitos, 90), fallas90: contar(fallas, 90),
    totalEventos: propios.length,
    calendario: calendario(propios, hoy, 60),
    // Evolución de lo respaldado (solo los eventos "finished" que traen cifras).
    serieTamano: exitos.filter(e => e.tamanoGb !== null).slice(-60).map(e => ({
      fecha: e.fecha, dia: e.dia, tamanoGb: e.tamanoGb, archivosTotal: e.archivosTotal, respaldados: e.respaldados,
    })),
  };
}

const PRIORIDAD_ESTADO = { falla: 3, sin_avisos: 2, sin_datos: 1, ok: 0 };

// Resumen del cliente completo. `eventos` ya normalizados (normalizarEvento).
export function resumirCliente(clienteId, eventos, ahora = new Date()) {
  const cliente = CLIENTES[clienteId];
  if (!cliente) return null;
  const jobs = cliente.jobs.map(def => resumirJob(def, eventos, ahora));
  // Jobs que aparecen en los eventos pero no están configurados (por si agregan uno nuevo en el NAS).
  const conocidos = new Set(cliente.jobs.map(j => j.nombre));
  const otrosNombres = [...new Set(eventos.filter(e => e.job && !conocidos.has(e.job)).map(e => e.job))];
  const otrosTodos = otrosNombres.map(nombre => resumirJob({ nombre, etiqueta: 'Otro job', destino: 'Sin clasificar', cadencia: '—', toleranciaDias: 9999 }, eventos, ahora));
  // Un job desconocido sin actividad en los últimos 90 días (ej. pruebas de 2022-2023) no es parte del estado actual: va aparte, como "antiguo".
  const hoyDia = diaChile(ahora);
  const esReciente = j => j.ultimoEvento && diasEntre(j.ultimoEvento.dia, hoyDia) <= 90;
  const otros = otrosTodos.filter(esReciente);
  const antiguos = otrosTodos.filter(j => !esReciente(j)).map(j => ({ nombre: j.nombre, ultimoEvento: j.ultimoEvento ? j.ultimoEvento.dia : null, fallas: j.fallas90, totalEventos: j.totalEventos }));
  let estadoGeneral = 'sin_datos';
  const todos = [...jobs, ...otros];
  if (todos.length && eventos.length) {
    estadoGeneral = todos.reduce((peor, j) => (PRIORIDAD_ESTADO[j.estado] > PRIORIDAD_ESTADO[peor] ? j.estado : peor), 'ok');
  }
  return {
    cliente: { id: cliente.id, nombre: cliente.nombre, detalle: cliente.detalle, nas: cliente.nas, equipo: cliente.equipo, destinatariosInforme: cliente.destinatariosInforme },
    estadoGeneral,
    jobs, otros, antiguos,
    totalEventos: eventos.length,
    ultimoAviso: eventos.length ? eventos.reduce((m, e) => (e.fecha > m ? e.fecha : m), eventos[0].fecha) : null,
  };
}

// Convierte el JSON del historial inicial (lib/nas-backup-historial.js) en filas para insertar.
export function filasDesdeHistorial(historial) {
  return (historial.eventos || []).filter(e => e && e.id && e.fecha && e.tipo).map(e => ({
    id: String(e.id),
    fecha: String(e.fecha).replace(' ', 'T'), // 'YYYY-MM-DD HH:MM:SS' hora local de Chile
    job: e.job || null,
    tipo: e.tipo,
    severidad: e.severidad || null,
    categoria: e.categoria || null,
    mensaje: e.mensaje || '',
    carpetas: e.stats?.carpetas ?? null,
    archivosTotal: e.stats?.archivos_total ?? null,
    sinCambios: e.stats?.sin_cambios ?? null,
    omitidos: e.stats?.omitidos ?? null,
    respaldados: e.stats?.respaldados ?? null,
    tamanoGb: e.stats?.tamano_gb ?? null,
    transferidoGb: e.stats?.transferido_gb ?? null,
    ejecucion: e.ejecucion ?? null,
    velocidad: e.stats?.velocidad ?? null,
    fuente: e.fuente || 'gmail',
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Lectura automática del buzón (Fase 1b): interpreta los correos de Notification Center del NAS (Hybrid Backup Sync).
// Un correo trae: NAS Name, Severity, Date/Time (hora local del NAS), App Name, Category y Message. Ejemplo del Message:
//   [Hybrid Backup Sync] Finished Backup job: "X". Folder Pairs: 27, Total Files: 403295, Unchanged Files: 396946, Skipped Files: 0,
//   Backed-up Files: 1771, Total File Size: 514.29 GB, Average Transmission Speed: 742.88 KB.
// ---------------------------------------------------------------------------------------------------------------------

function decodificarQuotedPrintable(s) {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Recorre un correo crudo (MIME) y devuelve sus partes de texto ya decodificadas (text/plain y text/html).
function partesTextoMime(raw, profundidad = 0) {
  const corte = raw.search(/\r?\n\r?\n/);
  const cabeceras = (corte >= 0 ? raw.slice(0, corte) : raw).replace(/\r?\n[ \t]+/g, ' ');
  const cuerpo = corte >= 0 ? raw.slice(corte).replace(/^\r?\n\r?\n/, '') : '';
  const ct = (cabeceras.match(/^content-type:\s*([^\r\n]*)/im) || [])[1] || 'text/plain';
  const cte = ((cabeceras.match(/^content-transfer-encoding:\s*([^\r\n;]*)/im) || [])[1] || '7bit').trim().toLowerCase();
  const tipo = ct.split(';')[0].trim().toLowerCase();
  if (tipo.startsWith('multipart/')) {
    const b = ct.match(/boundary="?([^";\r\n]+)"?/i);
    if (!b || profundidad >= 6) return [];
    return cuerpo.split('--' + b[1]).slice(1).filter(p => !p.startsWith('--')).flatMap(p => partesTextoMime(p.replace(/^\r?\n/, ''), profundidad + 1));
  }
  if (tipo !== 'text/plain' && tipo !== 'text/html') return [];
  let buf;
  if (cte === 'base64') buf = Buffer.from(cuerpo.replace(/\s+/g, ''), 'base64');
  else if (cte === 'quoted-printable') buf = Buffer.from(decodificarQuotedPrintable(cuerpo), 'latin1');
  else buf = Buffer.from(cuerpo, 'utf8');
  return [{ tipo, texto: buf.toString('utf8') }];
}

const ENTIDADES = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#39;': "'", '&nbsp;': ' ' };
function htmlATexto(html) {
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&(quot|amp|lt|gt|nbsp|#39);/g, m => ENTIDADES[m]);
}

// Texto plano de un correo crudo (prefiere text/plain; si solo hay HTML, lo convierte).
export function textoDesdeCorreoCrudo(raw) {
  const partes = partesTextoMime(String(raw));
  const plano = partes.filter(p => p.tipo === 'text/plain').map(p => p.texto).join(' ');
  const html = partes.filter(p => p.tipo === 'text/html').map(p => htmlATexto(p.texto)).join(' ');
  return (/Severity:|Gravedad:/.test(plano) ? plano : (html || plano)).replace(/\s+/g, ' ').trim();
}

const A_GB = { KB: 1 / 1024 / 1024, MB: 1 / 1024, GB: 1, TB: 1024 };

// El NAS manda los correos en el idioma de QTS (inglés en los antiguos, español desde oct-2026): se aceptan ambos.
const quitarTildes = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function numeroNas(txt, entero) {
  let s = String(txt).trim();
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /^\d{1,3}(,\d{3})+$/.test(s) && entero ? s.replace(/,/g, '') : s.replace(',', '.');
  else if (entero && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return Number(s);
}

// Cifras del término de un job: "...". Etiqueta: valor, Etiqueta: valor. (las etiquetas se reconocen por palabra clave, en inglés o español)
function cifrasDelMensaje(mensaje) {
  const resto = mensaje.replace(/^[^"]*"[^"]*"\.?\s*/, '');
  const stats = {};
  for (const seg of resto.split(/,\s+(?=[^,:]+:)/)) {
    const i = seg.indexOf(':');
    if (i < 0) continue;
    const et = quitarTildes(seg.slice(0, i));
    const val = seg.slice(i + 1).trim().replace(/\.$/, '');
    const num = (val.match(/^[\d.,]+/) || [])[0];
    if (/tamano|size/.test(et)) {
      const u = (val.match(/(KB|MB|GB|TB)/i) || [])[1];
      if (num && u) stats.tamano_gb = Math.round(numeroNas(num, false) * A_GB[u.toUpperCase()] * 100) / 100;
    } else if (/velocidad|speed/.test(et)) stats.velocidad = val;
    else if (!num) continue;
    else if (/carpeta|folder/.test(et)) stats.carpetas = numeroNas(num, true);
    else if (/sin cambio|no modific|unchanged/.test(et)) stats.sin_cambios = numeroNas(num, true);
    else if (/omit|skipped/.test(et)) stats.omitidos = numeroNas(num, true);
    else if (/respald|copia|backed/.test(et)) stats.respaldados = numeroNas(num, true);
    else if (/total/.test(et)) stats.archivos_total = numeroNas(num, true);
  }
  return stats.archivos_total != null || stats.tamano_gb != null ? stats : null;
}

// Interpreta el texto de UN correo del NAS. Devuelve null si no es un aviso de Hybrid Backup Sync.
// Campos comunes de cualquier correo de Notification Center (cualquier aplicación del NAS). Devuelve null si no tiene el formato.
function camposCorreoNas(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const campo = re => (t.match(re) || [])[1] || null;
  const fecha = campo(/(?:Date\/Time|Fecha\/Hora):\s*(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/);
  const mensaje = campo(/(?:Message|Mensaje):\s*(.+?)(?:\s+To configure notification rules|$)/);
  if (!fecha || !mensaje) return null;
  const sevCruda = campo(/(?:Severity|Gravedad):\s*(\S+)/) || '';
  return {
    nas: campo(/(?:NAS Name|Nombre del NAS):\s*(.+?)\s+(?:Severity|Gravedad):/),
    fecha: fecha.replace(/\//g, '-'),
    app: campo(/(?:App Name|Nombre de la aplicaci[oó]n):\s*(.+?)\s+(?:Category|Categor[ií]a):/),
    categoria: campo(/(?:Category|Categor[ií]a):\s*(.+?)\s+(?:Message|Mensaje):/),
    severidad: /^(warning|advertencia)/i.test(sevCruda) ? 'Warning' : /^(error|cr[ií]tic)/i.test(sevCruda) ? 'Error' : (sevCruda || null),
    mensaje: mensaje.replace(/^\[[^\]]+\]\s*/, '').trim(),
  };
}

// Alerta de salud o seguridad del NAS (hardware, discos, firmware, firewall...): cualquier aviso que no sea de un job de backup.
export function parsearAlertaNas(texto) {
  const c = camposCorreoNas(texto);
  return c ? { nas: c.nas, fecha: c.fecha, app: c.app, categoria: c.categoria, severidad: c.severidad, mensaje: c.mensaje } : null;
}

export function parsearCorreoHbs(texto) {
  const c = camposCorreoNas(texto);
  if (!c || !/Hybrid Backup Sync/i.test((c.app || '') + c.mensaje)) return null;
  const { mensaje, severidad } = c;
  const job = (mensaje.match(/job:\s*"([^"]+)"/i) || mensaje.match(/"([^"]+)"/) || [])[1] || null;

  let tipo = 'otro';
  if (/^Started\b|\bse ha iniciado\b|\biniciado\b/i.test(mensaje)) tipo = 'started';
  else if (/^Finished\b.*\bwith (warnings?|errors?)\b/i.test(mensaje) || /(finaliz|complet|termin).*\bcon (advertencias?|errores|error)\b/i.test(mensaje)) tipo = 'warning';
  else if (/^Failed\b|failed to complete|\bno se pudo\b|\bha fallado\b|\bfall[oó]\b/i.test(mensaje)) tipo = 'failed';
  else if (/^Finished\b|\b(finaliz|complet|termin)/i.test(mensaje)) tipo = 'finished';
  else if (severidad === 'Error') tipo = 'failed';
  else if (/storage|almacenamiento/i.test(mensaje)) tipo = 'storage';

  return {
    nas: c.nas, fecha: c.fecha, job, tipo, severidad, categoria: c.categoria, mensaje, stats: cifrasDelMensaje(mensaje),
  };
}

export function clientePorNas(nas) {
  return Object.values(CLIENTES).find(c => c.nas && nas && c.nas.toLowerCase() === String(nas).toLowerCase()) || null;
}

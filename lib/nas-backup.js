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
    jobs: [
      { nombre: 'Backup-Diario-Disco-Externo', etiqueta: 'Backup diario', destino: 'Disco externo USB (incremental)', cadencia: 'Diaria', toleranciaDias: 2 },
      { nombre: 'RAIZ PATAGUA A DRIVE Q3Z1ON', etiqueta: 'Backup semanal', destino: 'Google Drive (vinculado en QTS)', cadencia: 'Semanal', toleranciaDias: 9 },
    ],
  },
  mvs: {
    id: 'mvs',
    nombre: 'MvS Group',
    detalle: 'Aún sin NAS conectado al panel',
    nas: null,
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
  return resultado;
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
    cliente: { id: cliente.id, nombre: cliente.nombre, detalle: cliente.detalle, nas: cliente.nas },
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
    velocidad: e.stats?.velocidad ?? null,
  }));
}

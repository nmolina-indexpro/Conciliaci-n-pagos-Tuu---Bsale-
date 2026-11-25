// /lib/reclutamiento.js
// Reclutamiento (ERP > Servicio Técnico > Electrónica > Postulantes): lista de postulantes (Indeed) y agenda de entrevistas por videollamada.
// Funciones puras (sin red ni base de datos): fechas en hora de Chile, generación de espacios disponibles, validaciones y textos.
// La base de datos y los endpoints están en lib/db.js (asegurarTablaReclutamiento) y api/negocio.js (?recurso=reclutamiento y ?recurso=agenda-publica).
import { randomBytes } from 'node:crypto';

export const ZONA = 'America/Santiago';
export const ESTADOS_POSTULANTE = ['nuevo', 'invitado', 'agendado', 'entrevistado', 'descartado', 'contratado'];
export const CARGO_POR_DEFECTO = 'Técnico/a Electrónico/a en reparación de placas madre de notebooks';

// ---------------------------------------------------------------- fechas en hora de Chile
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const pad = n => String(n).padStart(2, '0');
function partesChile(ms) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute };
}
// 'AAAA-MM-DD' + 'HH:MM' en hora de Chile -> instante (Date). Considera el horario de verano.
export function chileAUtc(fechaISO, hhmm) {
  const [y, m, d] = fechaISO.split('-').map(Number), [hh, mm] = hhmm.split(':').map(Number);
  const objetivo = Date.UTC(y, m - 1, d, hh, mm);
  let t = objetivo + 3 * 3600000; // primer intento: UTC-3
  for (let i = 0; i < 3; i++) {
    const p = partesChile(t);
    const dif = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - objetivo;
    if (dif === 0) break;
    t -= dif;
  }
  return new Date(t);
}
export const fechaChile = d => { const p = partesChile(new Date(d).getTime()); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
export const horaChile = d => { const p = partesChile(new Date(d).getTime()); return `${pad(p.h)}:${pad(p.mi)}`; };
export const diaSemana = fechaISO => { const [y, m, d] = fechaISO.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const nombreDia = n => DIAS[n];
const sumarDias = (fechaISO, n) => { const [y, m, d] = fechaISO.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const aMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const deMin = n => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
const esFecha = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const esHora = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s));
// 'miércoles 25 de noviembre, 10:30' (hora de Chile)
export function textoFechaHora(inicio) {
  const d = new Date(inicio);
  const f = new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  return `${f}, ${horaChile(d)}`;
}

// ---------------------------------------------------------------- configuración
// Primera vez (nadie la ha guardado): martes a viernes de 10:30 a 15:30, entrevistas de 60 min, con 24 horas de anticipación, desde hoy hasta fin del mes en curso.
export function configInicial(hoy) {
  const [y, m] = hoy.split('-').map(Number), ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { activa: true, dias: [2, 3, 4, 5], desde: '10:30', hasta: '15:30', duracion_min: 60, descanso_min: 0, anticipacion_horas: 24, fecha_desde: hoy, fecha_hasta: `${y}-${pad(m)}-${pad(ultimo)}`, enlace_video: '', aviso: '' };
}
export function normalizarConfig(c) {
  const b = c || {};
  const dias = Array.isArray(b.dias) ? [...new Set(b.dias.map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 6).sort() : [];
  if (!dias.length) return { ok: false, error: 'Elige al menos un día de la semana' };
  if (!esHora(b.desde) || !esHora(b.hasta) || aMin(b.desde) >= aMin(b.hasta)) return { ok: false, error: 'El horario es inválido (la hora de término debe ser posterior a la de inicio)' };
  const dur = Number(b.duracion_min), des = Number(b.descanso_min ?? 0), ant = Number(b.anticipacion_horas ?? 24);
  if (!Number.isInteger(dur) || dur < 10 || dur > 240) return { ok: false, error: 'La duración debe estar entre 10 y 240 minutos' };
  if (!Number.isInteger(des) || des < 0 || des > 120) return { ok: false, error: 'El descanso debe estar entre 0 y 120 minutos' };
  if (!Number.isInteger(ant) || ant < 0 || ant > 720) return { ok: false, error: 'La anticipación debe estar entre 0 y 720 horas' };
  if (!esFecha(b.fecha_desde) || !esFecha(b.fecha_hasta) || b.fecha_hasta < b.fecha_desde) return { ok: false, error: 'Las fechas son inválidas (la última debe ser igual o posterior a la primera)' };
  if (Date.parse(b.fecha_hasta + 'T00:00:00Z') - Date.parse(b.fecha_desde + 'T00:00:00Z') > 62 * 86400000) return { ok: false, error: 'El período no puede superar 62 días' };
  const enlace = String(b.enlace_video || '').trim();
  if (enlace && !/^https?:\/\/\S{4,290}$/i.test(enlace)) return { ok: false, error: 'El enlace de la videollamada debe empezar con http:// o https://' };
  const aviso = String(b.aviso || '').trim();
  if (aviso.length > 500) return { ok: false, error: 'El mensaje para el postulante es demasiado largo (máximo 500 caracteres)' };
  return { ok: true, config: { activa: b.activa !== false, dias, desde: b.desde, hasta: b.hasta, duracion_min: dur, descanso_min: des, anticipacion_horas: ant, fecha_desde: b.fecha_desde, fecha_hasta: b.fecha_hasta, enlace_video: enlace, aviso } };
}

// ---------------------------------------------------------------- espacios
// Devuelve los espacios del período configurado, desde hoy, con su estado: 'libre' | 'ocupado' | 'bloqueado' | 'pronto' (dentro del plazo de anticipación y no habilitado).
// ocupados / bloqueados / habilitados: Set de instantes ISO (toISOString) de inicio. Para el postulante se usan solo los 'libre'.
export function generarEspacios(config, ahora, { ocupados = new Set(), bloqueados = new Set(), habilitados = new Set() } = {}) {
  const c = config, hoy = fechaChile(ahora), out = [];
  const limite = ahora.getTime() + c.anticipacion_horas * 3600000;
  const ini = aMin(c.desde), fin = aMin(c.hasta);
  for (let f = c.fecha_desde > hoy ? c.fecha_desde : hoy; f <= c.fecha_hasta; f = sumarDias(f, 1)) {
    const dow = diaSemana(f);
    if (!c.dias.includes(dow)) continue;
    for (let t = ini; t + c.duracion_min <= fin; t += c.duracion_min + c.descanso_min) {
      const inicio = chileAUtc(f, deMin(t)), key = inicio.toISOString();
      // habilitado = el administrador lo ofrece aunque esté dentro del plazo de anticipación
      const forzado = habilitados.has(key) && inicio.getTime() < limite;
      const estado = ocupados.has(key) ? 'ocupado' : bloqueados.has(key) ? 'bloqueado' : (inicio.getTime() < limite && !forzado) ? 'pronto' : 'libre';
      out.push({ inicio: key, fin: new Date(inicio.getTime() + c.duracion_min * 60000).toISOString(), fecha: f, hora: deMin(t), dia: dow, estado, forzado: estado === 'libre' && forzado });
    }
  }
  return out;
}

// ---------------------------------------------------------------- postulantes
// Entrevista propuesta de un postulante (guion de 15 a 20 minutos). null = quitarla. Devuelve { ok, entrevista } o { ok:false, error }.
export function normalizarEntrevista(e) {
  if (e === null) return { ok: true, entrevista: null };
  if (!e || typeof e !== 'object' || Array.isArray(e)) return { ok: false, error: 'La entrevista debe ser un objeto' };
  const lista = (v, max, largo) => (Array.isArray(v) ? v : []).slice(0, max).map(x => limpiar(x, largo)).filter(Boolean);
  const perfil = (Array.isArray(e.perfil) ? e.perfil : []).slice(0, 10).map(f => (Array.isArray(f) ? [limpiar(f[0], 40), limpiar(f[1], 700)] : null)).filter(f => f && f[0] && f[1]);
  const preguntas = (Array.isArray(e.preguntas) ? e.preguntas : []).slice(0, 12)
    .map(q => (q && typeof q === 'object' ? { cod: limpiar(q.cod, 6), texto: limpiar(q.texto, 500), espera: limpiar(q.espera, 900), alerta: limpiar(q.alerta, 500), ref: limpiar(q.ref, 60) } : null)).filter(q => q && q.cod && q.texto);
  if (!preguntas.length) return { ok: false, error: 'La entrevista necesita al menos una pregunta' };
  return { ok: true, entrevista: { encaje: limpiar(e.encaje, 40), perfil, fortalezas: lista(e.fortalezas, 10, 400), dudas: lista(e.dudas, 10, 400), antes: lista(e.antes, 10, 400), preguntas, cierre: lista(e.cierre, 10, 400) } };
}
export const nuevoToken = () => randomBytes(18).toString('base64url');
export const primerNombre = n => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : ''; };
const limpiar = (t, max) => { const s = String(t ?? '').trim().replace(/\s+/g, ' '); return s.slice(0, max); };
const emailValido = e => /^[^@\s]{1,80}@[^@\s]{1,100}\.[^@\s]{2,}$/.test(String(e || ''));
export function normalizarTelefono(t) {
  const d = String(t || '').replace(/[^\d+]/g, '');
  const sin = d.replace(/^\+?56/, '').replace(/^\+/, '');
  if (/^9\d{8}$/.test(sin)) return `+56 9 ${sin.slice(1, 5)} ${sin.slice(5)}`;
  return limpiar(t, 30);
}
// Valida un postulante (importación o alta). Devuelve { ok, postulante } o { ok:false, error }.
export function normalizarPostulante(p) {
  const b = p || {};
  const nombre = limpiar(b.nombre, 120);
  if (nombre.length < 2) return { ok: false, error: 'Falta el nombre' };
  const email = limpiar(b.email, 160).toLowerCase();
  if (email && !emailValido(email)) return { ok: false, error: `El correo de ${nombre} no es válido` };
  const fecha = String(b.fecha_postulacion || '').slice(0, 10);
  const resp = b.respuestas && typeof b.respuestas === 'object' ? Object.fromEntries(Object.entries(b.respuestas).slice(0, 10).map(([k, v]) => [limpiar(k, 40), limpiar(v, 600)])) : {};
  const urlPerfil = b.indeed_id ? `https://employers.indeed.com/candidates/view?id=${encodeURIComponent(limpiar(b.indeed_id, 40))}` : limpiar(b.url_perfil, 300);
  return { ok: true, postulante: {
    nombre, email: email || null, telefono: b.telefono ? normalizarTelefono(b.telefono) : null, ubicacion: limpiar(b.ubicacion, 120) || null, cargo: limpiar(b.cargo, 160) || CARGO_POR_DEFECTO,
    origen: limpiar(b.origen, 40) || 'Indeed', indeed_id: limpiar(b.indeed_id, 40) || null, url_perfil: urlPerfil || null, fecha_postulacion: esFecha(fecha) ? fecha : null,
    estado_indeed: limpiar(b.estado_indeed, 40) || null, respuestas: resp, resumen: limpiar(b.resumen, 1200) || null, notas: limpiar([b.nota_datos, b.notas, b.url_linkedin ? 'LinkedIn: ' + b.url_linkedin : '', b.url_github ? 'GitHub: ' + b.url_github : ''].filter(Boolean).join(' · '), 1000) || null,
  } };
}

export const urlAgenda = (urlBase, token) => `${urlBase}/agendar.html?t=${encodeURIComponent(token)}`;
// Mensaje para enviar al postulante (por Indeed o por correo) con su enlace personal de agenda.
export function mensajeInvitacion(nombre, url, cargo = CARGO_POR_DEFECTO) {
  return `Hola, ${primerNombre(nombre)}: gracias por postularte al cargo de ${cargo}. Para avanzar, agenda tu entrevista por videollamada eligiendo el horario que más te acomode en este enlace: ${url}\n\nLos horarios disponibles son de martes a viernes. Si no te acomoda ninguno o tienes alguna duda, responde este mensaje.`;
}

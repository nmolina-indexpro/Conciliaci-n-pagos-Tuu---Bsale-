// /lib/llamadas-fonoip.js
// Parser del registro de llamadas exportado desde el panel de Fono IP.
// Sin imports a propósito (función pura, se prueba aislada).
//
// Formato visto: columnas Fecha, Origen, Destino, Duración, Dirección,
// Grabación, separadas por tabulador (también se aceptan ; y ,). Fecha en
// hora de Chile "dd/mm/aaaa hh:mm:ss". En una llamada saliente Origen es el
// anexo del vendedor y Destino el teléfono del cliente; en una entrante se
// asume lo contrario (Origen = quien llama, Destino = anexo/línea) -- supuesto
// pendiente de confirmar con un registro real de entrantes.

const SINONIMOS = {
  fecha: ['fecha', 'fecha y hora', 'date', 'inicio'],
  origen: ['origen', 'anexo', 'linea', 'src', 'desde'],
  destino: ['destino', 'numero', 'dst', 'hacia'],
  duracion: ['duracion', 'duration', 'billsec'],
  direccion: ['direccion', 'tipo', 'sentido'],
  grabacion: ['grabacion', 'recording'],
};
const ORDEN_POR_DEFECTO = ['fecha', 'origen', 'destino', 'duracion', 'direccion', 'grabacion'];

function sinTildes(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function detectarSeparador(linea) {
  if (linea.includes('\t')) return '\t';
  const puntoComa = (linea.match(/;/g) || []).length;
  const coma = (linea.match(/,/g) || []).length;
  if (puntoComa === 0 && coma === 0) return '\t';
  return puntoComa >= coma ? ';' : ',';
}

// "dd/mm/aaaa hh:mm[:ss]" o "aaaa-mm-dd hh:mm[:ss]" -> "aaaa-mm-dd hh:mm:ss" (hora local, sin zona).
export function normalizarFechaLlamada(texto) {
  const t = String(texto || '').trim();
  let a, mes, d, h, mi, se;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) {
    d = +m[1]; mes = +m[2]; a = +m[3]; h = +m[4]; mi = +m[5]; se = +(m[6] || 0);
  } else {
    m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t);
    if (!m) return null;
    a = +m[1]; mes = +m[2]; d = +m[3]; h = +m[4]; mi = +m[5]; se = +(m[6] || 0);
  }
  if (mes < 1 || mes > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const p = n => String(n).padStart(2, '0');
  return `${a}-${p(mes)}-${p(d)} ${p(h)}:${p(mi)}:${p(se)}`;
}

// "mm:ss" o "hh:mm:ss" (o segundos a secas) -> segundos; null si no se entiende.
export function duracionASegundos(texto) {
  const t = String(texto || '').trim();
  if (!t) return 0;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

function soloDigitos(t) { return String(t || '').replace(/\D/g, ''); }

// Devuelve { filas: [{fecha, anexo, numero, duracionSeg, direccion, grabacion}], invalidas: [{linea, motivo}] }
export function parsearRegistroFonoip(texto) {
  const lineas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  const resultado = { filas: [], invalidas: [] };
  if (lineas.length === 0) return resultado;

  const sep = detectarSeparador(lineas[0]);
  const celdas = l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));

  // ¿La primera línea es encabezado? (no empieza con una fecha)
  let mapa = {};
  ORDEN_POR_DEFECTO.forEach((campo, i) => { mapa[campo] = i; });
  let inicio = 0;
  const primera = celdas(lineas[0]);
  if (!normalizarFechaLlamada(primera[0])) {
    inicio = 1;
    mapa = {};
    primera.forEach((nombre, i) => {
      const n = sinTildes(nombre);
      for (const [campo, sins] of Object.entries(SINONIMOS)) {
        if (mapa[campo] === undefined && sins.includes(n)) mapa[campo] = i;
      }
    });
    if (mapa.fecha === undefined || mapa.destino === undefined) {
      resultado.invalidas.push({ linea: 1, motivo: 'No reconozco los encabezados (se esperan Fecha, Origen, Destino, Duración, Dirección)' });
      return resultado;
    }
  }
  const valor = (c, campo) => (mapa[campo] === undefined ? '' : (c[mapa[campo]] || ''));

  for (let i = inicio; i < lineas.length; i++) {
    const c = celdas(lineas[i]);
    const fecha = normalizarFechaLlamada(valor(c, 'fecha'));
    if (!fecha) { resultado.invalidas.push({ linea: i + 1, motivo: 'Fecha no válida' }); continue; }
    const duracionSeg = duracionASegundos(valor(c, 'duracion'));
    if (duracionSeg === null) { resultado.invalidas.push({ linea: i + 1, motivo: 'Duración no válida' }); continue; }
    const dirTxt = sinTildes(valor(c, 'direccion'));
    const direccion = dirTxt.startsWith('entr') ? 'entrante' : 'saliente';
    const origen = soloDigitos(valor(c, 'origen'));
    const destino = soloDigitos(valor(c, 'destino'));
    // El "numero" siempre es el de la otra persona; el "anexo", el interno.
    const anexo = direccion === 'saliente' ? origen : destino;
    const numero = direccion === 'saliente' ? destino : origen;
    if (!numero || !anexo) { resultado.invalidas.push({ linea: i + 1, motivo: 'Falta origen o destino' }); continue; }
    resultado.filas.push({ fecha, anexo, numero, duracionSeg, direccion, grabacion: valor(c, 'grabacion') || null });
  }
  return resultado;
}

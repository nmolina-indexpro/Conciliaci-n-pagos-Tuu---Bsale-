// /lib/rango-fechas.js
// Fechas por día calendario de Chile (huso America/Santiago, que cambia entre -03 y -04 según la época del año).
// Lo usan los módulos de la página Sitio Web que se filtran por período (descuentos web, uso de filtros por marca).
const TZ = 'America/Santiago';

export const diaChile = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
export const sumarDias = (fecha, n) => { const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const esFechaDia = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

// Instante UTC en que empieza `fecha` (AAAA-MM-DD) en Chile.
export function inicioDiaChile(fecha) {
  for (const off of ['-03:00', '-04:00']) {
    const d = new Date(`${fecha}T00:00:00${off}`);
    const hora = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    if (hora === '00:00' && diaChile(d.getTime()) === fecha) return d;
  }
  return new Date(`${fecha}T00:00:00-04:00`);
}

// Rango entre dos días inclusivos: { desde, hasta, desdeISO, hastaISO (exclusivo) }. Si faltan o vienen al revés, se corrigen:
// por defecto el mes actual hasta hoy.
export function rangoDesdeHasta(desde, hasta, ahora = Date.now()) {
  const hoy = diaChile(ahora);
  let h = esFechaDia(hasta) ? hasta : hoy;
  if (h > hoy) h = hoy;
  let d = esFechaDia(desde) ? desde : `${h.slice(0, 7)}-01`;
  if (d > h) d = h;
  return { desde: d, hasta: h, desdeISO: inicioDiaChile(d).toISOString(), hastaISO: inicioDiaChile(sumarDias(h, 1)).toISOString() };
}

// /lib/zoho-metricas.js
// Métricas del departamento de Servicio Técnico en Zoho Desk (página Servicio Técnico). Funciones puras: reciben la
// lista de tickets tal como la entrega Zoho (GET /tickets) y devuelven números ya listos para dibujar.
//
// Qué mide cada una (todas salen solo de la lista de tickets, sin pedir los mensajes uno por uno):
//   1) Backlog: tickets abiertos ahora, por estado, con los vencidos y los equipos "Por Retirar" (el cobro de acopio
//      parte a los 15 días).
//   2) Clientes esperando respuesta: abiertos cuyo último mensaje fue del cliente (lastThread.direction = 'in').
//   3) Ingresos vs. cierres por semana: tickets creados y cerrados en cada una de las últimas 8 semanas.
//   4) Tiempo de resolución: de la creación al cierre, en días, de lo cerrado en los últimos 90 días.
//   5) Carga por técnico: abiertos y cerrados (30 días) por agente asignado, con su tiempo medio de resolución.

export const DIAS_ACOPIO = 15;
export const SEMANAS_GRAFICO = 8;
export const DIAS_VENTANA_RESOLUCION = 90;
const MS_DIA = 86400000;

const fecha = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d : null; };
const diaChile = d => d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // YYYY-MM-DD
const diasEntre = (desde, hasta) => (hasta - desde) / MS_DIA;
const redondear = (n, dec = 1) => Math.round(n * 10 ** dec) / 10 ** dec;
const promedio = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const mediana = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const estaAbierto = t => t && t.statusType !== 'Closed';

// Lunes de la semana (hora de Chile) de una fecha, como YYYY-MM-DD.
export function lunesDeSemana(d) {
  const [a, m, dia] = diaChile(d).split('-').map(Number);
  const base = new Date(Date.UTC(a, m - 1, dia));
  const dow = base.getUTCDay(); // 0 domingo
  base.setUTCDate(base.getUTCDate() - ((dow + 6) % 7));
  return base.toISOString().slice(0, 10);
}

function nombreCliente(t) {
  const c = t.contact || {};
  const n = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return n || t.email || 'Sin nombre';
}
function nombreAgente(t) {
  const a = t.assignee;
  const n = a ? [a.firstName, a.lastName].filter(Boolean).join(' ').trim() : '';
  return n || 'Sin asignar';
}

export function calcularMetricasTickets(tickets, ahora = new Date()) {
  const lista = (tickets || []).filter(t => t && !t.isSpam);
  const abiertos = lista.filter(estaAbierto);

  // 1) Backlog
  const porEstadoMap = new Map();
  for (const t of abiertos) porEstadoMap.set(t.status || 'Sin estado', (porEstadoMap.get(t.status || 'Sin estado') || 0) + 1);
  const porEstado = [...porEstadoMap.entries()].map(([estado, cantidad]) => ({ estado, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
  const vencidos = abiertos.filter(t => { const d = fecha(t.dueDate); return d && d < ahora; });
  const porRetirar = abiertos
    .filter(t => /retirar/i.test(t.status || ''))
    .map(t => {
      const desde = fecha(t.onholdTime) || fecha(t.modifiedTime) || fecha(t.createdTime);
      return { id: t.id, numero: t.ticketNumber, asunto: t.subject || '', cliente: nombreCliente(t), url: t.webUrl || null, dias: desde ? Math.floor(diasEntre(desde, ahora)) : null };
    })
    .sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
  const backlog = {
    total: abiertos.length,
    vencidos: vencidos.length,
    porEstado,
    porRetirar: { total: porRetirar.length, conAcopio: porRetirar.filter(x => x.dias != null && x.dias >= DIAS_ACOPIO).length, diasAcopio: DIAS_ACOPIO, masAntiguos: porRetirar.slice(0, 5) },
  };

  // 2) Clientes esperando respuesta (último mensaje fue del cliente). Los "Por Retirar" quedan fuera: ahí el último
  // mensaje del cliente suele ser "paso a retirar", no una consulta pendiente.
  const esperando = abiertos
    .filter(t => t.lastThread && t.lastThread.direction === 'in' && !/retirar/i.test(t.status || ''))
    .map(t => {
      const desde = fecha(t.customerResponseTime) || fecha(t.modifiedTime);
      return { id: t.id, numero: t.ticketNumber, asunto: t.subject || '', cliente: nombreCliente(t), agente: nombreAgente(t), estado: t.status || '', url: t.webUrl || null, dias: desde ? redondear(diasEntre(desde, ahora)) : null };
    })
    .sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
  const esperandoResp = { total: esperando.length, masDeDosDias: esperando.filter(x => x.dias != null && x.dias >= 2).length, lista: esperando.slice(0, 10) };

  // 3) Ingresos vs. cierres, por semana (las últimas SEMANAS_GRAFICO, la actual incluida)
  const lunesActual = lunesDeSemana(ahora);
  const semanas = [];
  for (let i = SEMANAS_GRAFICO - 1; i >= 0; i--) {
    const d = new Date(lunesActual + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7 * i);
    semanas.push({ semana: d.toISOString().slice(0, 10), ingresados: 0, cerrados: 0 });
  }
  const idxSemana = new Map(semanas.map((s, i) => [s.semana, i]));
  for (const t of lista) {
    const c = fecha(t.createdTime); if (c) { const i = idxSemana.get(lunesDeSemana(c)); if (i !== undefined) semanas[i].ingresados++; }
    const k = fecha(t.closedTime); if (k) { const i = idxSemana.get(lunesDeSemana(k)); if (i !== undefined) semanas[i].cerrados++; }
  }
  const ult = semanas.slice(-4), prev = semanas.slice(0, 4);
  const suma = (a, k) => a.reduce((s, x) => s + x[k], 0);
  const flujo = { semanas, ingresados4: suma(ult, 'ingresados'), cerrados4: suma(ult, 'cerrados'), ingresadosPrev4: suma(prev, 'ingresados'), cerradosPrev4: suma(prev, 'cerrados') };

  // 4) Tiempo de resolución (cerrados en la ventana)
  const desdeVentana = new Date(ahora.getTime() - DIAS_VENTANA_RESOLUCION * MS_DIA);
  const resueltos = lista
    .map(t => ({ t, c: fecha(t.createdTime), k: fecha(t.closedTime) }))
    .filter(x => x.c && x.k && x.k >= desdeVentana && x.k >= x.c);
  const dias = resueltos.map(x => diasEntre(x.c, x.k));
  const cubo = (a, b) => dias.filter(d => d >= a && d < b).length;
  const resolucion = {
    cerrados: dias.length, ventanaDias: DIAS_VENTANA_RESOLUCION,
    promedio: dias.length ? redondear(promedio(dias)) : null,
    mediana: dias.length ? redondear(mediana(dias)) : null,
    pctEn3Dias: dias.length ? Math.round((dias.filter(d => d <= 3).length / dias.length) * 100) : null,
    distribucion: [
      { rango: 'Hasta 1 día', cantidad: cubo(0, 1.0000001) },
      { rango: '2 a 3 días', cantidad: cubo(1.0000001, 3.0000001) },
      { rango: '4 a 7 días', cantidad: cubo(3.0000001, 7.0000001) },
      { rango: 'Más de 7 días', cantidad: cubo(7.0000001, Infinity) },
    ],
  };

  // 5) Carga por técnico
  const hace30 = new Date(ahora.getTime() - 30 * MS_DIA);
  const agentes = new Map();
  const ag = n => { if (!agentes.has(n)) agentes.set(n, { agente: n, abiertos: 0, cerrados30: 0, dias: [] }); return agentes.get(n); };
  for (const t of abiertos) ag(nombreAgente(t)).abiertos++;
  for (const x of resueltos) {
    if (x.k >= hace30) { const a = ag(nombreAgente(x.t)); a.cerrados30++; a.dias.push(diasEntre(x.c, x.k)); }
  }
  const porAgente = [...agentes.values()]
    .map(a => ({ agente: a.agente, abiertos: a.abiertos, cerrados30: a.cerrados30, diasPromedio: a.dias.length ? redondear(promedio(a.dias)) : null }))
    .sort((a, b) => b.abiertos - a.abiertos || b.cerrados30 - a.cerrados30);

  return { generadoEn: ahora.toISOString(), totalTicketsLeidos: lista.length, backlog, esperandoRespuesta: esperandoResp, flujo, resolucion, porAgente };
}

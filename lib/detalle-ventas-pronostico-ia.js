// /lib/detalle-ventas-pronostico-ia.js
// Análisis con IA (Gemini) del pronóstico de venta del mes (Detalle de ventas > Pronóstico).
// El pronóstico NUMÉRICO se calcula en la página (public/detalle-ventas-calculo.js) con estadística simple y se puede auditar con la prueba de meses anteriores;
// la IA no recalcula ni cambia esa cifra: solo la interpreta (qué la puede desviar y qué conviene hacer). Funciones puras: se prueban sin red.

const recortar = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
// un valor ausente es null (no 0: "no hay dato" no es "vendió cero")
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

export const SISTEMA_PRONOSTICO_IA = `Eres analista comercial de IndexStore, una tienda chilena de repuestos y accesorios para notebooks (pantallas, baterías, cargadores) y servicio técnico. Recibes el pronóstico de venta del mes en curso, ya calculado con estadística simple a partir de las ventas reales de Bsale (venta real con IVA, descontadas las notas de crédito): lo vendido hasta la fecha de corte, la proyección a fin de mes por dos métodos (ritmo de los meses anteriores y promedio por día de la semana), el rango probable, los meses anteriores y qué tan acertado habría sido el método en meses pasados.
Tu trabajo es INTERPRETAR esa proyección para el dueño del negocio, no recalcularla. Reglas:
- Usa solo los números recibidos; no inventes cifras, fechas ni hechos de la empresa. No cambies la proyección: puedes decir si parece prudente, alta o baja respecto de los meses anteriores.
- La confianza depende del error histórico (error_medio_pct) y de cuántos meses hay de base: alta si el error medio es menor a 8% y hay 6 o más meses; baja si es mayor a 15% o hay menos de 4 meses; media en lo demás.
- Los riesgos son motivos concretos por los que la venta real podría quedar sobre o bajo la proyección (por ejemplo, que el mes tenga un día de venta muy alto que distorsiona el promedio, que el resto del mes tenga más o menos fines de semana, o la diferencia entre los dos métodos). Puedes mencionar eventos de calendario del comercio (Black Friday, Cyber, Navidad, fin de año) solo como posibilidad si el mes corresponde, nunca como un hecho.
- Las acciones deben ser concretas y posibles de hacer esta semana (por ejemplo, cuánto hay que vender por día para llegar al mes anterior).
- Español de Chile, sin jerga. Resumen: máximo 3 frases. Máximo 4 riesgos y 3 acciones, cada uno de máximo 25 palabras.`;

export const HERRAMIENTA_PRONOSTICO_IA = {
  name: 'analisis_pronostico',
  description: 'Interpretación del pronóstico de venta del mes: resumen, nivel de confianza, riesgos y acciones.',
  input_schema: {
    type: 'object',
    properties: {
      resumen: { type: 'string', description: 'Qué dice el pronóstico y si parece prudente, en máximo 3 frases.' },
      confianza: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Según el error histórico del método y los meses de base.' },
      riesgos: { type: 'array', items: { type: 'string' }, description: 'Hasta 4 motivos por los que la venta real podría quedar sobre o bajo la proyección.' },
      acciones: { type: 'array', items: { type: 'string' }, description: 'Hasta 3 acciones concretas para esta semana.' },
    },
    required: ['resumen', 'confianza', 'riesgos', 'acciones'],
  },
};

// primero se descartan los vacíos y después se corta al máximo (así un vacío no le quita el lugar a uno válido)
const lista = (a, max, f) => (Array.isArray(a) ? a.slice(0, max * 5).map(f).filter(Boolean).slice(0, max) : []);

// Deja solo lo válido de lo que manda la página (nada de texto libre largo ni campos desconocidos). Devuelve null si falta lo esencial.
export function armarEntradaPronostico(b) {
  if (!b || typeof b !== 'object') return null;
  if (!MES.test(String(b.mes || '')) || !DIA.test(String(b.corte || ''))) return null;
  const proyeccion = num(b.proyeccion && b.proyeccion.combinada);
  const acumulado = num(b.acumulado);
  if (proyeccion == null || acumulado == null || !(Number(b.dias_mes) >= 28 && Number(b.dias_mes) <= 31)) return null;
  const rango = b.proyeccion.rango || {};
  return {
    mes: b.mes, corte: b.corte, dias_mes: Number(b.dias_mes), dias_transcurridos: Math.round(Number(b.dias_transcurridos) || 0),
    acumulado_hasta_el_corte: acumulado,
    proyeccion: {
      combinada: proyeccion, rango_probable: { desde: num(rango.desde), hasta: num(rango.hasta) },
      por_ritmo_de_meses_anteriores: num(b.proyeccion.ritmo), por_dia_de_la_semana: num(b.proyeccion.diaSemana),
      porcentaje_tipico_del_mes_al_corte: num(b.proyeccion.porcentajeTipico),
    },
    mes_anterior_total: num(b.mes_anterior), mismo_mes_anio_anterior_total: num(b.mismo_mes_anio_anterior),
    totales_meses_anteriores: lista(b.meses_anteriores, 14, (m) => (m && MES.test(String(m.mes || '')) && num(m.total) != null ? { mes: m.mes, total: num(m.total) } : null)),
    promedio_por_dia_de_semana: lista(b.promedio_dia_semana, 7, (x) => (x && num(x.promedio) != null ? { dia: recortar(x.dia, 12), promedio: num(x.promedio) } : null)),
    prueba_meses_anteriores: {
      error_medio_pct: num(b.prueba && b.prueba.errorMedioPct), sesgo_pct: num(b.prueba && b.prueba.sesgoPct),
      meses: lista(b.prueba && b.prueba.filas, 8, (f) => (f && MES.test(String(f.mes || '')) ? { mes: f.mes, proyectado: num(f.proyectado), real: num(f.real), error_pct: num(f.errorPct) } : null)),
    },
    filtros_activos: recortar(b.filtros, 200) || 'ninguno (venta de toda la empresa)',
  };
}

export function textoParaIA(entrada) {
  return 'Pronóstico de venta del mes (montos en pesos chilenos, venta real con IVA):\n' + JSON.stringify(entrada, null, 1);
}

// Normaliza la respuesta de Gemini: textos acotados y confianza válida.
export function normalizarAnalisisPronostico(bruto) {
  const conf = String(bruto && bruto.confianza || '').toLowerCase();
  return {
    resumen: recortar(bruto && bruto.resumen, 700),
    confianza: ['alta', 'media', 'baja'].includes(conf) ? conf : 'media',
    riesgos: lista(bruto && bruto.riesgos, 4, (x) => recortar(x, 260) || null),
    acciones: lista(bruto && bruto.acciones, 3, (x) => recortar(x, 260) || null),
  };
}

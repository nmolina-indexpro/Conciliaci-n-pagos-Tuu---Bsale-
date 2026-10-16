// /lib/filtros-uso-ia.js
// Análisis con IA (Gemini) de los filtros por marca: qué hacer con cada valor (marca, serie, medida...) para que más personas los usen.
// Aquí solo se arma lo que se le pasa a la IA y se valida lo que devuelve; la llamada a Gemini la hace api/negocio.js.
// La IA solo ve conteos de personas por valor (nada de montos ni datos personales) y no puede inventar valores: lo que devuelve y no existe se descarta.

export const ACCIONES_FILTRO_IA = ['destacar', 'mantener', 'reordenar', 'revisar', 'quitar'];
export const MAX_VALORES_POR_TIPO = 12;
export const MIN_PERSONAS_CONCLUIR = 5; // con menos personas en el origen no se concluye nada firme

// Entrada compacta para la IA a partir de resumenFiltrosUso: por origen, sus cifras y los valores más usados de cada tipo.
export function armarEntradaFiltrosIA(resumen) {
  const origenes = [];
  for (const o of resumen.origenes || []) {
    const valores = [];
    for (const [tipo, filas] of Object.entries(o.valores || {})) {
      if (tipo === 'vista') continue;
      for (const f of filas.slice(0, MAX_VALORES_POR_TIPO)) valores.push({ tipo, nombre_tipo: (resumen.nombresTipo || {})[tipo] || tipo, valor: f.valor, personas: f.personas, veces: f.veces });
    }
    if (!o.vistas && !o.usaron && !o.lateral && !valores.length) continue;
    origenes.push({
      origen: o.origen, nombre: o.nombre, vieron: o.vistas, usaron_botones: o.usaron, usaron_filtro_lateral: o.lateral,
      dispositivos: (o.dispositivos || []).filter(d => d.dispositivo !== 'sin dato').map(d => ({ dispositivo: d.dispositivo === 'movil' ? 'celular' : 'escritorio', vieron: d.vistas, usaron: d.usaron })),
      valores,
    });
  }
  return { periodo: resumen.rango ? `${resumen.rango.desde} al ${resumen.rango.hasta}` : `últimos ${resumen.dias} días`, origenes };
}

export const SISTEMA_FILTROS_IA = `Eres analista de conversión de una tienda chilena de repuestos para notebooks (cargadores, baterías y pantallas). Recibes el uso de los botones de filtro de la tienda: por página (origen) cuántas personas la vieron, cuántas usaron los botones nuevos (marca, serie, pulgadas, resolución, watt, voltaje, punta) y cuántas el filtro lateral de siempre, más cuántas personas eligieron cada valor. El buscador del home ("Encuentra tu repuesto") tiene botones de pestaña, "Ver productos" y WhatsApp.
Tu trabajo: decir qué hacer con CADA valor listado para optimizar los filtros, con una de estas acciones:
- destacar: se usa mucho; ponerlo primero o más visible.
- mantener: funciona bien como está.
- reordenar: se usa menos de lo que merece por su posición o formato (ej.: valores muy parecidos que conviene agrupar, o ubicar antes).
- revisar: dato raro o poco claro (ej.: se pulsa mucho pero casi nadie sigue, nombre ambiguo, valor mal escrito).
- quitar: casi nadie lo usa y solo ensucia el filtro.
Reglas: basa todo en los números recibidos; no inventes cifras ni valores; si una página tiene menos de ${MIN_PERSONAS_CONCLUIR} personas, di que hay pocos datos y no recomiendes quitar nada. Cada motivo: máximo 14 palabras, concreto, en español de Chile, sin jerga. El resumen: máximo 3 frases. Las prioridades: máximo 4 acciones, ordenadas por impacto, cada una concreta. Devuelve un item en "valores" por cada valor recibido, repitiendo exactamente origen, tipo y valor.`;

export const HERRAMIENTA_FILTROS_IA = {
  name: 'analisis_filtros',
  description: 'Resultado del análisis de los filtros por marca: resumen, prioridades y una recomendación por cada valor.',
  input_schema: {
    type: 'object',
    properties: {
      resumen: { type: 'string', description: 'Qué está pasando con los filtros, en máximo 3 frases.' },
      prioridades: { type: 'array', items: { type: 'string' }, description: 'Hasta 4 acciones concretas, de mayor a menor impacto.' },
      valores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            origen: { type: 'string' }, tipo: { type: 'string' }, valor: { type: 'string' },
            accion: { type: 'string', enum: ACCIONES_FILTRO_IA },
            motivo: { type: 'string', description: 'Máximo 14 palabras.' },
          },
          required: ['origen', 'tipo', 'valor', 'accion', 'motivo'],
        },
      },
    },
    required: ['resumen', 'prioridades', 'valores'],
  },
};

const recortar = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Deja solo lo válido: acciones conocidas, valores que existen en la entrada (sin repetir) y textos acotados.
export function normalizarAnalisisFiltros(bruto, entrada) {
  const existentes = new Set();
  for (const o of entrada.origenes) for (const v of o.valores) existentes.add(`${o.origen}|${v.tipo}|${v.valor}`);
  const vistos = new Set(), valores = [];
  for (const x of Array.isArray(bruto?.valores) ? bruto.valores : []) {
    const clave = `${x?.origen}|${x?.tipo}|${x?.valor}`;
    if (!existentes.has(clave) || vistos.has(clave)) continue;
    vistos.add(clave);
    valores.push({ origen: x.origen, tipo: x.tipo, valor: x.valor, accion: ACCIONES_FILTRO_IA.includes(x.accion) ? x.accion : 'revisar', motivo: recortar(x.motivo, 140) });
  }
  return {
    resumen: recortar(bruto?.resumen, 600),
    prioridades: (Array.isArray(bruto?.prioridades) ? bruto.prioridades : []).map(p => recortar(p, 220)).filter(Boolean).slice(0, 4),
    valores,
    sin_analizar: existentes.size - valores.length,
  };
}

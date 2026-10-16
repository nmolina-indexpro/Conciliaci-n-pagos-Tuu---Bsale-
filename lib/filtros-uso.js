// /lib/filtros-uso.js
// ══════════════════════════════════════════════════════════════════════
// Uso de los filtros por marca de la tienda (colecciones de cargadores, baterías y pantallas, y el buscador "Encuentra tu repuesto" del
// home). Los bloques del tema avisan cada vez que alguien usa un filtro (ficha -> Worker -> ERP, con la huella anónima diaria del
// visitante; la IP nunca llega aquí). Esta librería valida el aviso, guarda la tabla y arma el análisis de la página Sitio Web.
// ══════════════════════════════════════════════════════════════════════
import { datosVisitante } from './buscador-ia.js';

export const ORIGENES_FILTRO = ['cargadores', 'cargadores-modelos', 'baterias', 'baterias-modelos', 'pantallas', 'home'];
export const NOMBRES_ORIGEN = { cargadores: 'Cargadores', 'cargadores-modelos': 'Cargadores por modelo de equipo', baterias: 'Baterías', 'baterias-modelos': 'Baterías por modelo de equipo', pantallas: 'Pantallas por modelo de equipo', home: 'Home: Encuentra tu repuesto' };
// vista = entró a la página (o vio el buscador del home); marca/todas = botón de marca; serie, pulgadas, resolucion, watt, voltaje, punta =
// botones nuevos; lateral = filtro lateral de siempre (para comparar); tipo = pestaña del home; buscar/whatsapp = botones del buscador del home.
export const TIPOS_FILTRO = ['vista', 'marca', 'todas', 'serie', 'pulgadas', 'resolucion', 'watt', 'voltaje', 'punta', 'lateral', 'tipo', 'buscar', 'whatsapp', 'limpiar'];
export const NOMBRES_TIPO = { vista: 'Vistas', marca: 'Marca', todas: 'Todas (quitar marca)', serie: 'Serie', pulgadas: 'Pulgadas', resolucion: 'Resolución', watt: 'Watt', voltaje: 'Voltaje y amperaje', punta: 'Punta', lateral: 'Filtro lateral', tipo: 'Tipo de repuesto', buscar: 'Botón "Ver productos"', whatsapp: 'WhatsApp "No encuentro mi modelo"', limpiar: 'Borrar selección' };

export function limpiarValor(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[^\p{L}\p{N} .,_\-\/"'+()·|:x]/gu, '').trim();
  return s || null;
}

export function validarFiltroEvento(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo inválido' };
  if (!ORIGENES_FILTRO.includes(body.origen)) return { ok: false, error: 'Origen inválido' };
  if (!TIPOS_FILTRO.includes(body.tipo)) return { ok: false, error: 'Tipo inválido' };
  const v = datosVisitante(body.visitante);
  if (!v.vid) return { ok: false, error: 'Sin huella del visitante' };
  return {
    ok: true,
    fila: { origen: body.origen, tipo: body.tipo, valor: body.tipo === 'vista' ? null : limpiarValor(body.valor), dispositivo: ['movil', 'escritorio'].includes(body.dispositivo) ? body.dispositivo : null, ...v },
  };
}

export async function asegurarTablaFiltrosUso(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS filtros_uso_eventos (
      id SERIAL PRIMARY KEY,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      origen TEXT NOT NULL,
      tipo TEXT NOT NULL,
      valor TEXT,
      dispositivo TEXT,
      vid TEXT,
      pais TEXT,
      ua_tipo TEXT,
      centro_datos BOOLEAN
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS filtros_uso_eventos_creado ON filtros_uso_eventos (creado_en);`;
}

// Análisis por origen: cuántas personas vieron la página, cuántas usaron algún filtro por marca (y cuántas el filtro lateral de siempre),
// qué usaron (marcas, series, medidas...) y cómo se reparte entre celular y escritorio. Solo personas probables; los bots van aparte.
// "Personas" = huellas diarias distintas (la misma persona en dos días cuenta dos veces).
// rango = número de días hacia atrás (como antes) o { desde, hasta, desdeISO, hastaISO } con un período elegido (hastaISO exclusivo).
export async function resumenFiltrosUso(sql, rango) {
  await asegurarTablaFiltrosUso(sql);
  const porFechas = rango && typeof rango === 'object';
  const params = porFechas ? [rango.desdeISO, rango.hastaISO] : [rango];
  const dias = porFechas ? null : rango;
  const base = `WITH ev AS (
      SELECT origen, tipo, valor, dispositivo, vid, (ua_tipo = 'navegador' AND COALESCE(centro_datos, false) = false) AS persona
      FROM filtros_uso_eventos WHERE ${porFechas ? 'creado_en >= $1::timestamptz AND creado_en < $2::timestamptz' : 'creado_en >= now() - make_interval(days => $1)'})`;
  const [porOrigen, valores, porDisp, bots, primero] = await Promise.all([
    sql.query(`${base} SELECT origen,
        count(DISTINCT vid) FILTER (WHERE tipo = 'vista')::int AS vistas,
        count(DISTINCT vid) FILTER (WHERE tipo NOT IN ('vista', 'lateral'))::int AS usaron,
        count(DISTINCT vid) FILTER (WHERE tipo = 'lateral')::int AS lateral,
        count(*) FILTER (WHERE tipo NOT IN ('vista', 'lateral'))::int AS acciones
      FROM ev WHERE persona GROUP BY 1`, params),
    sql.query(`${base} SELECT origen, tipo, valor, count(*)::int AS veces, count(DISTINCT vid)::int AS personas
      FROM ev WHERE persona AND tipo <> 'vista' GROUP BY 1, 2, 3 ORDER BY personas DESC, veces DESC`, params),
    sql.query(`${base} SELECT origen, COALESCE(dispositivo, 'sin dato') AS dispositivo,
        count(DISTINCT vid) FILTER (WHERE tipo = 'vista')::int AS vistas,
        count(DISTINCT vid) FILTER (WHERE tipo NOT IN ('vista', 'lateral'))::int AS usaron
      FROM ev WHERE persona GROUP BY 1, 2`, params),
    sql.query(`${base} SELECT count(*)::int AS eventos FROM ev WHERE NOT persona`, params),
    sql.query(`SELECT min(creado_en) AS desde FROM filtros_uso_eventos`),
  ]);
  const origenes = ORIGENES_FILTRO.map(origen => {
    const r = porOrigen.rows.find(x => x.origen === origen) || { vistas: 0, usaron: 0, lateral: 0, acciones: 0 };
    const val = {};
    for (const x of valores.rows.filter(v => v.origen === origen)) (val[x.tipo] = val[x.tipo] || []).push({ valor: x.valor || '—', veces: x.veces, personas: x.personas });
    return {
      origen, nombre: NOMBRES_ORIGEN[origen], vistas: r.vistas, usaron: r.usaron, lateral: r.lateral, acciones: r.acciones,
      dispositivos: porDisp.rows.filter(d => d.origen === origen).map(d => ({ dispositivo: d.dispositivo, vistas: d.vistas, usaron: d.usaron })),
      valores: val,
    };
  });
  return { dias, rango: porFechas ? { desde: rango.desde, hasta: rango.hasta } : null, origenes, bots: bots.rows[0]?.eventos || 0, desde: primero.rows[0]?.desde || null, nombresTipo: NOMBRES_TIPO };
}

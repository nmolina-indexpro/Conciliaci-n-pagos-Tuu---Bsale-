// /lib/cotizacion-web-uso.js
// ══════════════════════════════════════════════════════════════════════
// Uso de las cotizaciones web: cuánta gente ve el enlace "Cotización express" de la ficha, cuánta lo toca, cuánta abre el formulario, hace algo
// en él, intenta generar la cotización, y cuántas cotizaciones se crearon y llegaron al pago. Los avisos salen de la ficha y de la página
// /pages/cotizar, pasan por el Worker (con la huella anónima diaria del visitante; la IP nunca llega aquí) y se guardan aquí.
// "Personas" = huellas diarias distintas de navegadores reales (los bots y los centros de datos se cuentan aparte).
// ══════════════════════════════════════════════════════════════════════
import { datosVisitante } from './buscador-ia.js';

export const TIPOS_EVENTO_COTIZACION = ['ficha_vista', 'ficha_clic', 'form_abierto', 'form_accion', 'form_enviar'];
export const NOMBRES_EVENTO = {
  ficha_vista: 'Vieron el enlace en la ficha', ficha_clic: 'Tocaron el enlace', form_abierto: 'Abrieron el formulario',
  form_accion: 'Hicieron algo en el formulario', form_enviar: 'Pulsaron «Generar cotización»',
};
// form_abierto: de dónde llegaron. form_accion: qué hicieron primero (una vez por tipo y por visita).
export const ORIGENES_FORM = ['ficha', 'directo', 'correo', 'login'];
export const ACCIONES_FORM = ['producto', 'cantidad', 'datos', 'direccion', 'envio', 'retiro', 'pago', 'invitado', 'login', 'autocompletar'];
export const NOMBRES_ACCION = {
  producto: 'Agregó o quitó un producto', cantidad: 'Cambió una cantidad', datos: 'Escribió sus datos o los de facturación', direccion: 'Eligió región o comuna',
  envio: 'Eligió un envío a domicilio', retiro: 'Eligió retiro en tienda', pago: 'Eligió el pago preferido', invitado: 'Eligió cotizar como invitado',
  login: 'Fue a iniciar sesión', autocompletar: 'Pidió completar con compras anteriores',
};

const limpiar = (v, max = 80) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max).replace(/[^\p{L}\p{N} .,_\-\/+()·:]/gu, '').trim();
  return s || null;
};

export function validarEventoCotizacion(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo inválido' };
  if (!TIPOS_EVENTO_COTIZACION.includes(body.tipo)) return { ok: false, error: 'Tipo inválido' };
  const v = datosVisitante(body.visitante);
  if (!v.vid) return { ok: false, error: 'Sin huella del visitante' };
  let valor = limpiar(body.valor, 30);
  if (body.tipo === 'form_abierto' && !ORIGENES_FORM.includes(valor)) valor = 'directo';
  if (body.tipo === 'form_accion' && !ACCIONES_FORM.includes(valor)) return { ok: false, error: 'Acción inválida' };
  if (!['form_abierto', 'form_accion', 'form_enviar'].includes(body.tipo)) valor = null;
  if (body.tipo === 'form_enviar' && !['con_errores', 'enviado'].includes(valor)) valor = 'enviado';
  return {
    ok: true,
    fila: { tipo: body.tipo, valor, producto: limpiar(body.producto, 120), dispositivo: ['movil', 'escritorio'].includes(body.dispositivo) ? body.dispositivo : null, ...v },
  };
}

export async function asegurarTablaEventosCotizacion(sql) {
  await sql.query(`CREATE TABLE IF NOT EXISTS cotizaciones_web_eventos (
    id SERIAL PRIMARY KEY, creado_en TIMESTAMPTZ NOT NULL DEFAULT now(), tipo TEXT NOT NULL, valor TEXT, producto TEXT, dispositivo TEXT,
    vid TEXT, pais TEXT, ua_tipo TEXT, centro_datos BOOLEAN)`);
  await sql.query('CREATE INDEX IF NOT EXISTS cotizaciones_web_eventos_creado ON cotizaciones_web_eventos (creado_en)');
}

export async function registrarEventoCotizacion(sql, body) {
  const v = validarEventoCotizacion(body);
  if (!v.ok) return { status: 400, error: v.error };
  const f = v.fila;
  await asegurarTablaEventosCotizacion(sql);
  await sql.query('INSERT INTO cotizaciones_web_eventos (tipo, valor, producto, dispositivo, vid, pais, ua_tipo, centro_datos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [f.tipo, f.valor, f.producto, f.dispositivo, f.vid, f.pais, f.ua_tipo, f.centro_datos]);
  if (Math.random() < 0.02) await sql.query(`DELETE FROM cotizaciones_web_eventos WHERE creado_en < now() - interval '180 days'`);
  return { status: 200, ok: true };
}

// rango: { desdeISO, hastaISO } (hasta exclusivo)
export async function resumenUsoCotizacion(sql, { desdeISO, hastaISO }) {
  await asegurarTablaEventosCotizacion(sql);
  const persona = `ua_tipo = 'navegador' AND coalesce(centro_datos, false) = false`;
  const base = `FROM cotizaciones_web_eventos WHERE creado_en >= $1 AND creado_en < $2`;
  const p = [desdeISO, hastaISO];
  const q = async (texto) => (await sql.query(texto, p)).rows;

  const porTipoValor = await q(`SELECT tipo, valor, count(*)::int AS veces, count(DISTINCT vid)::int AS personas ${base} AND ${persona} GROUP BY tipo, valor`);
  const porTipo = await q(`SELECT tipo, count(*)::int AS veces, count(DISTINCT vid)::int AS personas ${base} AND ${persona} GROUP BY tipo`);
  const productos = await q(`SELECT producto, tipo, count(DISTINCT vid)::int AS personas ${base} AND ${persona} AND producto IS NOT NULL AND tipo IN ('ficha_vista','ficha_clic') GROUP BY producto, tipo`);
  const dispositivos = await q(`SELECT tipo, coalesce(dispositivo, 'sin dato') AS dispositivo, count(DISTINCT vid)::int AS personas ${base} AND ${persona} AND tipo IN ('ficha_vista','ficha_clic','form_abierto') GROUP BY tipo, dispositivo`);
  const bots = (await q(`SELECT count(*)::int AS n ${base} AND NOT (${persona})`))[0].n;
  const cot = (await q(`SELECT count(*)::int AS creadas, count(*) FILTER (WHERE pago_iniciado_en IS NOT NULL)::int AS con_pago FROM cotizaciones_web WHERE creado_en >= $1 AND creado_en < $2`))[0];

  const t = Object.fromEntries(porTipo.map(r => [r.tipo, r]));
  const get = tipo => ({ personas: (t[tipo] || {}).personas || 0, veces: (t[tipo] || {}).veces || 0 });
  const desdeFicha = porTipoValor.find(r => r.tipo === 'form_abierto' && r.valor === 'ficha');
  const embudo = [
    { clave: 'ficha_vista', nombre: NOMBRES_EVENTO.ficha_vista, ...get('ficha_vista') },
    { clave: 'ficha_clic', nombre: NOMBRES_EVENTO.ficha_clic, ...get('ficha_clic') },
    { clave: 'form_abierto', nombre: NOMBRES_EVENTO.form_abierto, ...get('form_abierto'), desde_ficha: desdeFicha ? desdeFicha.personas : 0 },
    { clave: 'form_accion', nombre: NOMBRES_EVENTO.form_accion, ...get('form_accion') },
    { clave: 'form_enviar', nombre: NOMBRES_EVENTO.form_enviar, ...get('form_enviar') },
    { clave: 'creadas', nombre: 'Cotizaciones creadas', personas: cot.creadas, veces: cot.creadas },
    { clave: 'con_pago', nombre: 'Iniciaron el pago', personas: cot.con_pago, veces: cot.con_pago },
  ];
  const acciones = porTipoValor.filter(r => r.tipo === 'form_accion').map(r => ({ valor: r.valor, nombre: NOMBRES_ACCION[r.valor] || r.valor, personas: r.personas, veces: r.veces })).sort((a, b) => b.personas - a.personas);
  const origenes = porTipoValor.filter(r => r.tipo === 'form_abierto').map(r => ({ valor: r.valor, personas: r.personas })).sort((a, b) => b.personas - a.personas);
  const intentos = porTipoValor.filter(r => r.tipo === 'form_enviar').map(r => ({ valor: r.valor, personas: r.personas, veces: r.veces }));
  const prods = {};
  for (const r of productos) { (prods[r.producto] ||= { producto: r.producto, vistas: 0, clics: 0 })[r.tipo === 'ficha_vista' ? 'vistas' : 'clics'] = r.personas; }
  return {
    embudo, acciones, origenes, intentos, bots,
    productos: Object.values(prods).sort((a, b) => b.clics - a.clics || b.vistas - a.vistas).slice(0, 15),
    dispositivos: dispositivos.map(r => ({ tipo: r.tipo, dispositivo: r.dispositivo, personas: r.personas })),
  };
}

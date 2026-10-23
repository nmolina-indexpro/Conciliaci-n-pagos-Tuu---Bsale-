// /lib/correo-transito.js
// Aviso por correo de un envío nuevo en Productos en tránsito: una carga que ya viene en camino o que está siendo preparada.
// Se manda una sola vez por envío, cuando queda con sus productos cargados. Función pura (sin red ni base de datos) con el diseño estándar
// de lib/correo-base.js. Sin montos, ventas ni costos: solo productos, cantidades, ruta y fechas.
import { esc, num, plural, tarjetas, avisos, seccion, tabla, masEnElErp, armarCorreo, MESES_CORTOS } from './correo-base.js';

const MAX_FILAS = 25;
export const TIPO_TRANSPORTE = { maritimo: { texto: 'Marítimo', icono: '🚢' }, aereo: { texto: 'Aéreo', icono: '✈️' } };

// fecha (Date de la base, ISO o 'AAAA-MM-DD') -> 'AAAA-MM-DD'
const dia = v => (!v ? null : v instanceof Date ? (Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)) : String(v).slice(0, 10));
const fechaCorta = iso => { const [a, m, d] = iso.split('-'); return `${Number(d)} ${MESES_CORTOS[Number(m) - 1]} ${a}`; };
const diasEntre = (desde, hasta) => Math.round((Date.parse(hasta + 'T00:00:00Z') - Date.parse(desde + 'T00:00:00Z')) / 86400000);

// ¿La carga ya salió? Con fecha de salida de hoy o anterior: va en camino; si no tiene fecha de salida o es futura: se está preparando.
export function faseDelEnvio(envio, hoy) {
  const salida = dia(envio.fecha_salida);
  return salida && salida <= hoy ? 'en_camino' : 'en_preparacion';
}

// ¿Corresponde avisar? Solo envíos activos (no los que ya llegaron o se entregaron) y con al menos un producto cargado.
export function debeAvisarseEnvio(envio) {
  const productos = Array.isArray(envio && envio.productos) ? envio.productos.filter(p => p && p.nombre && String(p.nombre).trim()) : [];
  return !!envio && (envio.estado || 'en_transito') === 'en_transito' && productos.length > 0;
}

// envio: fila de productos_transito_envios (productos ya como arreglo). hoy: 'AAAA-MM-DD' (día de Chile).
export function armarCorreoEnvioTransito(envio, { urlBase = 'https://erp.indexstore.cl', hoy, ejemplo = false } = {}) {
  const fase = faseDelEnvio(envio, hoy);
  const enCamino = fase === 'en_camino';
  const productos = (envio.productos || []).filter(p => p && p.nombre && String(p.nombre).trim());
  const unidades = productos.reduce((t, p) => t + (Number(p.cantidad) || 0), 0);
  const transporte = TIPO_TRANSPORTE[envio.tipo_transporte] || null;
  const eta = dia(envio.fecha_eta), salida = dia(envio.fecha_salida);
  const diasParaEta = eta ? diasEntre(hoy, eta) : null;
  const ruta = [envio.puerto_origen, envio.puerto_destino].filter(Boolean).map(esc).join(' → ');

  const kpis = tarjetas([
    { etiqueta: transporte ? `${transporte.icono} Transporte` : '📦 Transporte', cifra: transporte ? transporte.texto : '—', sub: ruta || 'sin ruta indicada', tono: 'azul' },
    { etiqueta: '📅 Llegada estimada', cifra: eta ? fechaCorta(eta).replace(/ \d{4}$/, '') : '—',
      sub: eta ? (diasParaEta > 0 ? `en ${num(diasParaEta)} ${plural(diasParaEta, 'día', 'días')}` : diasParaEta === 0 ? 'es hoy' : `hace ${num(-diasParaEta)} ${plural(-diasParaEta, 'día', 'días')}`) : 'aún sin ETA', tono: eta && diasParaEta <= 7 ? 'verde' : 'gris' },
    { etiqueta: '🧾 Productos', cifra: num(productos.length), sub: `${num(unidades)} ${plural(unidades, 'unidad', 'unidades')} en total`, tono: 'azul' },
    { etiqueta: '📦 Bultos', cifra: envio.total_bultos != null ? num(envio.total_bultos) : '—', sub: envio.peso_kg ? `${num(envio.peso_kg)} kg` : 'peso sin informar', tono: 'gris' },
  ]);

  const nota = [];
  nota.push(enCamino
    ? { tono: 'azul', texto: `<b>La carga ya salió${salida ? ` el ${fechaCorta(salida)}` : ''} y viene en camino.</b>` }
    : { tono: 'amarillo', texto: `<b>La carga se está preparando:</b> todavía no sale${salida ? ` (salida programada: ${fechaCorta(salida)})` : ' y aún no tiene fecha de salida'}.` });
  if (!eta) nota.push({ tono: 'amarillo', texto: 'Todavía no tiene fecha de llegada (ETA): se irá completando en el ERP.' });
  else if (diasParaEta < 0) nota.push({ tono: 'naranja', texto: 'La fecha de llegada estimada ya pasó: conviene revisar el estado de la carga.' });

  const filas = productos.slice(0, MAX_FILAS).map(p => [esc(p.sku || '—'), esc(p.nombre), esc(num(p.cantidad || 0))]);
  const detalle = seccion('Qué viene en esta carga', 'Los productos y cantidades registrados en el ERP.',
    tabla([{ titulo: 'SKU' }, { titulo: 'Producto' }, { titulo: 'Cant.', alinear: 'right', ancho: 60 }], filas, { pie: productos.length > MAX_FILAS ? masEnElErp(productos.length - MAX_FILAS) : null }));

  const nombre = esc(envio.referencia || 'Sin referencia');
  const html = armarCorreo({
    etiqueta: 'IndexStore · Compras',
    titulo: enCamino ? 'Una carga viene en camino' : 'Una carga está siendo preparada',
    subtitulo: `${nombre}${ejemplo ? ' · EJEMPLO' : ''}`,
    cuerpo: kpis + avisos(nota) + detalle,
    boton: { url: `${urlBase}/productos-en-transito.html`, texto: 'Ver el envío en el ERP' },
    leyenda: 'este aviso sale una sola vez, cuando un envío nuevo queda registrado con sus productos. El seguimiento posterior (fechas, eventos) se ve en Productos en tránsito.',
  });
  const asunto = `${enCamino ? 'Carga en camino' : 'Carga en preparación'}: ${envio.referencia || 'envío nuevo'}${eta ? ` · llega ~${fechaCorta(eta).replace(/ \d{4}$/, '')}` : ''}${ejemplo ? ' [EJEMPLO]' : ''}`;
  return { asunto, html };
}

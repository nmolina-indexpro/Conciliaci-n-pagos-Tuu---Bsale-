// /lib/electronica-correo.js
// Correo de la Academia de Electrónica (Servicio Técnico > Electrónica; Usuarios > Notificaciones, tipo 'electronica-leccion').
// Lunes y miércoles: lección. Viernes: resumen semanal. Qué toca cada día sale de la grilla (lib/electronica-datos.js) y el texto,
// de lib/electronica-lecciones.js. Funciones puras (sin red ni base de datos), con las piezas de lib/correo-base.js.
// Gmail y otros clientes no muestran SVG: el diagrama ilustrativo se ve en la página del ERP, y el correo lo avisa.
import { esc, fechaLarga, armarCorreo, avisos, seccion, hoyChile } from './correo-base.js';
import { ELECTRONICA } from './electronica-datos.js';
import { LECCIONES } from './electronica-lecciones.js';
import { componentesDeEnvio } from './electronica-componentes.js';

export { hoyChile };

// Texto plano con **negrita** -> HTML seguro
const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const P = 'margin:8px 0;font-size:14px;line-height:1.6;color:#1b2a41;';

function cuerpoBloque(b) {
  if (b.li) return `<ul style="margin:8px 0;padding-left:20px;font-size:14px;line-height:1.6;color:#1b2a41;">${b.li.map(x => `<li style="margin:4px 0;">${md(x)}</li>`).join('')}</ul>`;
  return (b.p || []).map(x => `<p style="${P}">${md(x)}</p>`).join('');
}

// Envío del programa que corresponde a una fecha 'AAAA-MM-DD' (o null si ese día no hay envío).
export const envioDeFecha = fecha => ELECTRONICA.envios.find(e => e.fecha === fecha) || null;
// Primer envío con contenido redactado desde 'fecha' en adelante (para la prueba); si ya pasaron todos, el último redactado.
export function envioParaPrueba(fecha) {
  const conContenido = ELECTRONICA.envios.filter(e => LECCIONES[e.n]);
  return conContenido.find(e => e.fecha >= fecha) || conContenido[conContenido.length - 1] || null;
}
export const hayLeccion = n => !!LECCIONES[n];


// «Conoce el componente»: la foto real (con su autor y licencia) va justo bajo la introducción; para qué sirve y fallas más comunes, al final de la lección.
function htmlFoto(c, urlBase) {
  const f = c.foto;
  if (!f) return '';
  return `<div style="margin:10px 0 6px;"><img src="${esc(urlBase)}/img-electronica/${esc(f.archivo)}" alt="${esc(c.nombre)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border-radius:10px;border:1px solid #dbe7fb;">
      <div style="font-size:11px;line-height:1.45;color:#64748b;margin-top:4px;">Foto: ${esc(f.descripcion)}. Autor: ${esc(f.autor)} · <a href="${esc(f.pagina_url)}" style="color:#64748b;">Wikimedia Commons</a> · <a href="${esc(f.licencia_url || f.pagina_url)}" style="color:#64748b;">${esc(f.licencia)}</a></div></div>`;
}
function htmlTextoComponente(c) {
  const lista = xs => `<ul style="margin:6px 0 10px;padding-left:20px;font-size:14px;line-height:1.55;color:#1b2a41;">${xs.map(x => `<li style="margin:3px 0;">${esc(x)}</li>`).join('')}</ul>`;
  return `<p style="margin:8px 0 0;font-size:13px;font-weight:700;color:#0b2a5b;">Para qué sirve</p>${lista(c.funciones)}`
    + `<p style="margin:8px 0 0;font-size:13px;font-weight:700;color:#0b2a5b;">${c.tipo === 'instrumento' ? 'Errores y problemas frecuentes' : 'Fallas más comunes en un notebook'}</p>${lista(c.fallas)}`;
}

export function armarCorreoElectronica({ envio, urlBase }) {
  const l = LECCIONES[envio.n];
  if (!l) return null;
  const esResumen = envio.tipo === 'Resumen semanal';
  let cuerpo = '';
  const comps = componentesDeEnvio(envio.n);
  l.bloques.forEach((b, i) => {
    cuerpo += seccion(esc(b.t), '', cuerpoBloque(b));
    if (i === 0) for (const c of comps) if (c.foto) cuerpo += seccion(esc('Conoce: ' + c.nombre), '', htmlFoto(c, urlBase));
  });
  for (const c of comps) cuerpo += seccion(esc(c.nombre + (c.tipo === 'instrumento' ? ': para qué sirve y errores frecuentes' : ': para qué sirve y fallas comunes')), '', htmlTextoComponente(c));
  if (l.svg) cuerpo += `<p style="margin:14px 0 0;font-size:12.5px;color:#64748b;">🖼 El diagrama ilustrativo de esta lección está en el ERP (botón de abajo).</p>`;
  const preguntas = l.preguntas || [];
  cuerpo += seccion(esc(esResumen ? 'Preguntas de autoevaluación' : 'Pregunta de aprendizaje'), 'Piensa tu respuesta antes de bajar: las respuestas están al final.',
    `<ol style="margin:8px 0;padding-left:20px;font-size:14px;line-height:1.6;color:#1b2a41;">${preguntas.map(x => `<li style="margin:6px 0;">${md(String(x.q).replace(/^\d\)\s*/, ''))}</li>`).join('')}</ol>`);
  cuerpo += seccion(esc(esResumen ? (envio.n === 36 ? 'Próxima etapa' : 'Adelanto de la próxima semana') : 'Recuerda'), '', `<p style="${P}">${md(l.resumen)}</p>`);
  if (l.seguridad) cuerpo += avisos([{ tono: 'amarillo', texto: `<b>Seguridad:</b> ${esc(l.seguridad)}` }], null);
  cuerpo += seccion(esc('Respuestas'), 'Solo después de pensarlas.',
    `<ol style="margin:8px 0;padding-left:20px;font-size:14px;line-height:1.6;color:#1b2a41;">${preguntas.map(x => `<li style="margin:6px 0;">${md(x.a)}</li>`).join('')}</ol>`);
  const html = armarCorreo({
    etiqueta: 'IndexStore · Electrónica',
    titulo: esc(l.titulo),
    subtitulo: esc(`${fechaLarga(envio.fecha)} · Semana ${envio.semana} de 12 · lectura de ${l.lectura || envio.minutos} min`),
    cuerpo,
    boton: { url: `${urlBase}/electronica.html`, texto: 'Ver el programa en el ERP' },
    leyenda: 'Programa de 12 semanas de electrónica de notebooks: lecciones los lunes y miércoles, resumen los viernes. Es material de estudio general: lo que depende del fabricante, la plataforma o el modelo se indica en cada lección, y no reemplaza el esquemático del equipo. Las prácticas de riesgo se hacen con supervisión.',
  });
  const asunto = `Electrónica de Notebooks — ${l.titulo}`;
  return { asunto, html };
}

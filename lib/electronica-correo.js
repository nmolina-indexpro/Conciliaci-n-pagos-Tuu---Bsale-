// /lib/electronica-correo.js
// Correo de la Academia de Electrónica (Servicio Técnico > Electrónica; Usuarios > Notificaciones, tipo 'electronica-leccion').
// Lunes y miércoles: lección. Viernes: resumen semanal. Qué toca cada día sale de la grilla (lib/electronica-datos.js) y el texto,
// de lib/electronica-lecciones.js. Funciones puras (sin red ni base de datos), con las piezas de lib/correo-base.js.
// Gmail y otros clientes no muestran SVG: el diagrama ilustrativo se ve en la página del ERP, y el correo lo avisa.
import { esc, fechaLarga, armarCorreo, avisos, seccion, hoyChile } from './correo-base.js';
import { ELECTRONICA } from './electronica-datos.js';
import { LECCIONES } from './electronica-lecciones.js';

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

export function armarCorreoElectronica({ envio, urlBase }) {
  const l = LECCIONES[envio.n];
  if (!l) return null;
  const esResumen = envio.tipo === 'Resumen semanal';
  let cuerpo = '';
  for (const b of l.bloques) cuerpo += seccion(esc(b.t), '', cuerpoBloque(b));
  if (l.svg) cuerpo += `<p style="margin:14px 0 0;font-size:12.5px;color:#64748b;">🖼 El diagrama ilustrativo de esta lección está en el ERP (botón de abajo).</p>`;
  const preguntas = l.preguntas || [];
  cuerpo += seccion(esc(esResumen ? 'Preguntas de autoevaluación' : 'Pregunta de aprendizaje'), 'Piensa tu respuesta antes de bajar: las respuestas están al final.',
    `<ol style="margin:8px 0;padding-left:20px;font-size:14px;line-height:1.6;color:#1b2a41;">${preguntas.map(x => `<li style="margin:6px 0;">${md(String(x.q).replace(/^\d\)\s*/, ''))}</li>`).join('')}</ol>`);
  cuerpo += seccion(esc(esResumen ? 'Adelanto de la próxima semana' : 'Recuerda'), '', `<p style="${P}">${md(l.resumen)}</p>`);
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

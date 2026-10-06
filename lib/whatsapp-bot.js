// Bot de WhatsApp fuera del horario de atención (fase 1: MODO SOMBRA -- redacta borradores, nunca envía solo).
// Todo lo puro (horarios, instrucciones, validación de la propuesta) vive acá para poder probarlo sin base de datos ni APIs.

export const MODOS_BOT = ['apagado', 'sombra'];

// Ventanas en que atiende el bot. dias: 0=domingo ... 6=sábado. Si "hasta" <= "desde" la ventana cruza la medianoche y sigue
// el día siguiente (lun–vie 19:35 → 08:30 cubre también la madrugada de sábado, pero NO la del lunes ni la del domingo).
export const HORARIO_BOT_DEFECTO = [
  { dias: [1, 2, 3, 4, 5], desde: '19:35', hasta: '08:30' },
  { dias: [6], desde: '15:00', hasta: '23:30' },
  { dias: [0], desde: '09:00', hasta: '15:30' },
];

export const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIA_CORTO = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formateador = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const formateadorFecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });

export function partesChile(fecha) {
  const p = Object.fromEntries(formateador.formatToParts(fecha).map(x => [x.type, x.value]));
  return { dia: DIA_CORTO[p.weekday], minutos: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const aMinutos = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const aHHMM = min => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Devuelve el horario normalizado o lanza Error con un mensaje claro (para mostrarlo en la pantalla de configuración).
export function validarHorario(h) {
  if (!Array.isArray(h) || h.length === 0) throw new Error('El horario necesita al menos una ventana.');
  return h.map((v, i) => {
    const dias = Array.isArray(v?.dias) ? [...new Set(v.dias.map(Number))] : [];
    if (!dias.length || dias.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error(`Ventana ${i + 1}: elige al menos un día válido.`);
    const ok = x => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || ''));
    if (!ok(v.desde) || !ok(v.hasta)) throw new Error(`Ventana ${i + 1}: las horas deben ir como HH:MM (por ejemplo 19:35).`);
    if (v.desde === v.hasta) throw new Error(`Ventana ${i + 1}: "desde" y "hasta" no pueden ser iguales.`);
    return { dias: dias.sort(), desde: v.desde, hasta: v.hasta };
  });
}

export function dentroDeHorarioBot(fecha, horario = HORARIO_BOT_DEFECTO) {
  const { dia, minutos } = partesChile(fecha);
  for (const v of horario) {
    const d0 = aMinutos(v.desde), d1 = aMinutos(v.hasta);
    for (const d of v.dias) {
      if (d0 < d1) { if (dia === d && minutos >= d0 && minutos < d1) return true; }
      else if ((dia === d && minutos >= d0) || (dia === (d + 1) % 7 && minutos < d1)) return true;
    }
  }
  return false;
}

// Cuándo termina la ventana en la que está el bot (= cuándo vuelve el equipo). null si ahora no hay bot.
export function finVentanaActual(fecha, horario = HORARIO_BOT_DEFECTO) {
  if (!dentroDeHorarioBot(fecha, horario)) return null;
  for (let i = 1; i <= 36 * 12; i++) {
    const t = new Date(fecha.getTime() + i * 5 * 60000);
    if (!dentroDeHorarioBot(t, horario)) {
      const { dia, minutos } = partesChile(t);
      const hoy = formateadorFecha.format(fecha), fin = formateadorFecha.format(t);
      const manana = formateadorFecha.format(new Date(fecha.getTime() + 24 * 3600000));
      return { hora: aHHMM(minutos), dia: fin === hoy ? 'hoy' : fin === manana ? 'mañana' : `el ${NOMBRES_DIA[dia]}` };
    }
  }
  return null;
}

// Tramos de la semana en que NO atiende el bot (para avisar de huecos al configurar). Resolución de 5 minutos, tramos de 1 h o más.
export function huecosDelHorario(horario = HORARIO_BOT_DEFECTO) {
  const huecos = [];
  const base = Date.UTC(2026, 0, 4, 3, 0, 0); // domingo 04-ene-2026, 00:00 en Chile (UTC-3 en verano)
  const semana = 7 * 24 * 12;
  let inicio = null, iInicio = 0;
  // Se recorren dos semanas para no partir en dos un hueco que cruza del sábado al domingo; se informan los que parten en la primera.
  for (let i = 0; i <= 2 * semana; i++) {
    const t = new Date(base + i * 5 * 60000);
    const dentro = i < 2 * semana ? dentroDeHorarioBot(t, horario) : true;
    if (!dentro && inicio === null) { inicio = t; iInicio = i; }
    if (dentro && inicio !== null) {
      const a = partesChile(inicio), b = partesChile(t);
      if (iInicio > 0 && iInicio < semana && (t - inicio) / 60000 >= 60) huecos.push({ desdeDia: a.dia, desde: aHHMM(a.minutos), hastaDia: b.dia, hasta: aHHMM(b.minutos), horas: Math.round((t - inicio) / 360000) / 10 });
      inicio = null;
    }
  }
  return huecos;
}

// Datos fijos del negocio que el bot puede afirmar. SOLO lo que figura acá (más precio, link y stock que trae el catálogo).
// Se edita desde la pantalla del bot; lo que no está escrito, el bot no lo afirma: avisa que lo confirma un ejecutivo.
export const CONOCIMIENTO_DEFECTO = `Tienda: IndexStore (indexstore.cl). Repuestos y accesorios para notebooks (pantallas, baterías, cargadores, etc.) y servicio técnico.
Dirección: La Concepción 81, Of. 1904, Piso 19, Providencia (Metro Pedro de Valdivia).
Medios de pago: se aceptan todos los medios de pago.
Garantía: los productos tienen garantía por fallas de fábrica. Pantallas: 2 años. Para otros productos no indiques el plazo exacto: di que el ejecutivo lo confirma.
Instalación gratis en tienda: pantallas (20 a 25 minutos si el equipo está completo). Para otros productos no prometas instalación gratis: di que el ejecutivo lo confirma.
Envío express dentro de Santiago: sí hay. No indiques costo ni plazo exacto (no están definidos acá): di que el ejecutivo los confirma.
Con cada compra se suman puntos para ahorrar en la próxima visita.`;

export const REGLAS_NO_PROMETER = `NUNCA prometas ni afirmes: descuentos o cupones, reservar o apartar un producto, plazos exactos de entrega o retiro, costos de envío, garantías o instalaciones que no estén en la BASE DE CONOCIMIENTO, ni que un producto es compatible con un equipo si el título del producto no nombra ese modelo exacto.`;

export function construirSystemBot({ conocimiento, ahora = new Date(), horario = HORARIO_BOT_DEFECTO, primeraRespuestaBot = true, ejemplos = [] }) {
  const fin = finVentanaActual(ahora, horario);
  const { dia, minutos } = partesChile(ahora);
  const cuandoVuelve = fin ? `El equipo de ejecutivos vuelve ${fin.dia} a las ${fin.hora}.` : 'El equipo de ejecutivos responderá a la brevedad.';
  return `Eres el asistente virtual de IndexStore (tienda chilena de repuestos para notebooks y servicio técnico) y atiendes por WhatsApp FUERA del horario de atención. Escribes un BORRADOR de respuesta que un ejecutivo revisa; igual debe quedar listo para enviarse.

AHORA: ${NOMBRES_DIA[dia]} ${aHHMM(minutos)} (hora de Chile). ${cuandoVuelve}

QUÉ PUEDES AFIRMAR (y nada más):
1) La BASE DE CONOCIMIENTO de abajo.
2) Lo que devuelva la herramienta buscar_productos (título, precio, stock y enlace). Para precio, stock y enlace SIEMPRE consulta la herramienta; nunca los escribas de memoria. Si el stock es 0 o el producto no está publicado, no lo ofrezcas como disponible. Si el stock sale "sin dato", di que el ejecutivo confirma la disponibilidad.
3) Lo que dijo el cliente en la conversación.

${REGLAS_NO_PROMETER}

CUÁNDO ESCALAR (escalar=true, y el texto es un mensaje breve y amable de espera): reclamos, devoluciones, garantías ya en curso, servicio técnico o diagnósticos, facturas o pagos, ventas a empresas, clientes molestos, productos que no encuentres, equipos o modelos poco claros, y cualquier cosa que no esté en tu base. Si el cliente mandó imagen, audio o documento (no los ves), pídele que lo escriba o escala.

CÓMO RESPONDER:
- Si te falta el modelo exacto del equipo (la etiqueta bajo el notebook o el código del modelo), pídelo antes de ofrecer un producto.
- Cuando haya un producto disponible, entrega la ficha: nombre, precio, enlace, y las condiciones que correspondan de la base (garantía, instalación, dirección). Sé breve.
- Tono cercano y profesional de Chile, tuteo, mensajes cortos (máximo unos 900 caracteres), sin markdown salvo *negrita* de WhatsApp, emojis con moderación.
- ${primeraRespuestaBot ? 'Es tu primer mensaje en esta conversación: saluda y di que eres el asistente virtual de IndexStore.' : 'Ya hubo mensajes del asistente antes: sigue la conversación sin volver a presentarte.'}
- Si prometes que un ejecutivo continúa, menciona cuándo vuelve el equipo solo si lo sabes (arriba).

Termina SIEMPRE llamando a la herramienta proponer_respuesta. confianza: "alta" solo si todo lo que afirmas está respaldado por la base o por la herramienta; "media" si dependes de que el cliente confirme algo; "baja" si dudas.

BASE DE CONOCIMIENTO:
${conocimiento}${ejemplos.length ? `\n\nEJEMPLOS REALES de cómo responde el equipo (imita el estilo y el orden de la ficha, NO copies sus precios ni enlaces):\n${ejemplos.map((e, i) => `--- Ejemplo ${i + 1} ---\n${e}`).join('\n')}` : ''}`;
}

export const HERRAMIENTAS_BOT = [
  {
    name: 'buscar_productos',
    description: 'Busca en el catálogo de IndexStore (Shopify) por texto. Devuelve hasta 5 productos con título, precio en CLP, stock (si se conoce) y enlace. Úsala para cualquier precio, stock o enlace. Ejemplo de consulta: "pantalla hp 250 g7", "batería asus x541", "cargador lenovo 65w".',
    input_schema: { type: 'object', properties: { consulta: { type: 'string', description: 'Tipo de producto + marca + modelo (o potencia en cargadores).' } }, required: ['consulta'] },
  },
  {
    name: 'proponer_respuesta',
    description: 'Entrega el borrador final para el ejecutivo. Se llama una sola vez, al terminar.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Mensaje de WhatsApp listo para enviar al cliente.' },
        confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
        escalar: { type: 'boolean', description: 'true si un humano debe atender esta conversación.' },
        motivo_escalamiento: { type: 'string', description: 'Por qué se escala (vacío si no).' },
        resumen_para_ejecutivo: { type: 'string', description: 'Una o dos líneas: qué pide el cliente y qué falta resolver.' },
      },
      required: ['texto', 'confianza', 'escalar'],
    },
  },
];

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const soloDigitos = s => String(s || '').replace(/\D/g, '');

// Revisión determinista de la propuesta (no depende de que la IA "se porte bien"): todo precio y todo enlace que aparezca en el
// texto debe venir del catálogo consultado o de la base de conocimiento. Si no, se marca y se fuerza a escalar.
export function revisarPropuesta({ texto, productos = [], conocimiento = '' }) {
  const problemas = [];
  const preciosPermitidos = new Set();
  for (const p of productos) if (p.precio != null) preciosPermitidos.add(soloDigitos(Math.round(Number(p.precio))));
  for (const m of String(conocimiento).matchAll(/\$\s?[\d.]+/g)) preciosPermitidos.add(soloDigitos(m[0]));
  for (const m of String(texto).matchAll(/\$\s?(\d[\d.]*)/g)) {
    const n = soloDigitos(m[1]);
    if (n && !preciosPermitidos.has(n)) problemas.push(`Precio no verificado: $${m[1]}`);
  }
  const urlsPermitidas = new Set(productos.map(p => (p.url || '').split('?')[0].replace(/\/+$/, '')).filter(Boolean));
  for (const m of String(conocimiento).matchAll(/https?:\/\/[^\s)]+/g)) urlsPermitidas.add(m[0].split('?')[0].replace(/\/+$/, ''));
  for (const m of String(texto).matchAll(/https?:\/\/[^\s)]+/g)) {
    const u = m[0].replace(/[.,;!?]+$/, '').split('?')[0].replace(/\/+$/, '');
    if (!urlsPermitidas.has(u)) problemas.push(`Enlace no verificado: ${u}`);
  }
  const t = norm(texto);
  if (/\b(descuento|cupon|rebaja|oferta especial)\b/.test(t)) problemas.push('Menciona descuento o cupón');
  if (/\b(te lo reservo|te la reservo|lo dejo reservado|la dejo reservada|apartad[oa]|reservad[oa])\b/.test(t)) problemas.push('Promete reservar el producto');
  return problemas;
}

// Normaliza lo que devuelve la IA y aplica la revisión: ante cualquier problema, escala y baja la confianza.
export function normalizarPropuesta(input, { productos = [], conocimiento = '' } = {}) {
  const texto = String(input?.texto || '').trim().slice(0, 1500);
  let confianza = ['alta', 'media', 'baja'].includes(input?.confianza) ? input.confianza : 'baja';
  let escalar = input?.escalar === true;
  let motivo = String(input?.motivo_escalamiento || '').trim().slice(0, 400);
  const alertas = texto ? revisarPropuesta({ texto, productos, conocimiento }) : ['La IA no escribió ningún texto'];
  if (alertas.length) {
    escalar = true; confianza = 'baja';
    motivo = [motivo, `Revisión automática: ${alertas.join('; ')}`].filter(Boolean).join(' · ').slice(0, 600);
  }
  return { texto, confianza, escalar, motivo, resumen: String(input?.resumen_para_ejecutivo || '').trim().slice(0, 400), alertas };
}

// ¿El texto enviado es el mismo borrador (ignorando espacios, mayúsculas y tildes)?
export const mismoTexto = (a, b) => norm(a).replace(/\s+/g, ' ').trim() === norm(b).replace(/\s+/g, ' ').trim();

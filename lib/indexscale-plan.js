// /lib/indexscale-plan.js
// Lista de contacto guiada de IndexScale para el vendedor: de miles de clientes Bsale elige 10-15 por día.
// Este archivo es lógica pura (sin base de datos ni red): filtro de Santiago / Región Metropolitana, puntaje previo,
// teléfono para WhatsApp, y validación de lo que devuelve Gemini. La consulta y la IA viven en api/negocio.js.

export const RESULTADOS_PLAN = ['pendiente', 'interesado', 'reunion', 'volver_a_llamar', 'sin_respuesta', 'no_interesa', 'dato_incorrecto'];

// Estado de la oportunidad (indexscale_oportunidades.estado) que corresponde a cada resultado; null = no cambia.
export const ESTADO_POR_RESULTADO = { interesado: 'contactado', reunion: 'contactado', no_interesa: 'perdido' };

export const OFERTAS_PLAN = ['crear_tienda', 'optimizar_tienda', 'diagnostico_gratis'];

// Las 52 comunas de la Región Metropolitana. "San Pedro" se deja fuera a propósito: existe también en otras regiones y es demasiado ambiguo.
const COMUNAS_RM = [
  'Santiago', 'Cerrillos', 'Cerro Navia', 'Conchalí', 'El Bosque', 'Estación Central', 'Huechuraba', 'Independencia', 'La Cisterna', 'La Florida',
  'La Granja', 'La Pintana', 'La Reina', 'Las Condes', 'Lo Barnechea', 'Lo Espejo', 'Lo Prado', 'Macul', 'Maipú', 'Ñuñoa', 'Pedro Aguirre Cerda',
  'Peñalolén', 'Providencia', 'Pudahuel', 'Quilicura', 'Quinta Normal', 'Recoleta', 'Renca', 'San Joaquín', 'San Miguel', 'San Ramón', 'Vitacura',
  'Puente Alto', 'Pirque', 'San José de Maipo', 'Colina', 'Lampa', 'Tiltil', 'San Bernardo', 'Buin', 'Calera de Tango', 'Paine', 'Melipilla',
  'Alhué', 'Curacaví', 'María Pinto', 'San Pedro', 'Talagante', 'El Monte', 'Isla de Maipo', 'Padre Hurtado', 'Peñaflor',
];

export function normalizarTexto(t) {
  return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const COMUNAS_NORM = COMUNAS_RM.filter((c) => c !== 'San Pedro').map((c) => ({ nombre: c, norm: normalizarTexto(c) }))
  // las más largas primero: "San José de Maipo" antes que "Maipú" no se pisan, pero "La Reina" / "Reina" sí podrían
  .sort((a, b) => b.norm.length - a.norm.length);
// Cómo escriben los clientes la ciudad en Bsale cuando no ponen la comuna exacta.
const SINONIMOS = [
  { re: /(^| )(region )?metropolitana( |$)/, nombre: 'Región Metropolitana' },
  { re: /(^| )(gran )?(santiago|stgo|scl)( |$)/, nombre: 'Santiago' },
  { re: /(^| )rm( |$)/, nombre: 'Región Metropolitana' },
  { re: /(^| )til til( |$)/, nombre: 'Tiltil' },
  { re: /(^| )pac( |$)/, nombre: 'Pedro Aguirre Cerda' },
  { re: /(^| )est(acion)? central( |$)/, nombre: 'Estación Central' },
];

// ¿La ciudad/comuna escrita en Bsale es de Santiago o de la Región Metropolitana? -> { ok, comuna } (comuna = lo que se reconoció)
export function esRegionMetropolitana(ciudad) {
  const n = normalizarTexto(ciudad);
  if (!n) return { ok: false, motivo: 'sin_comuna' };
  for (const c of COMUNAS_NORM) {
    if ((' ' + n + ' ').includes(' ' + c.norm + ' ')) return { ok: true, comuna: c.nombre };
  }
  for (const s of SINONIMOS) if (s.re.test(n)) return { ok: true, comuna: s.nombre };
  return { ok: false, motivo: 'fuera_rm' };
}

// Teléfono chileno -> { mostrar, wa } (wa = dígitos con 56 si es celular; los fijos no tienen WhatsApp).
export function telefonoChileno(telefono) {
  let d = String(telefono || '').replace(/\D+/g, '');
  if (!d) return { mostrar: '', wa: null };
  if (d.startsWith('56') && d.length >= 11) d = d.slice(2);
  d = d.replace(/^0+/, '');
  if (d.length === 9 && d.startsWith('9')) return { mostrar: '+56 9 ' + d.slice(1, 5) + ' ' + d.slice(5), wa: '56' + d, tel: '+56' + d };
  if (d.length === 8 && /^[5-9]/.test(d)) return { mostrar: '+56 9 ' + d.slice(0, 4) + ' ' + d.slice(4), wa: '569' + d, tel: '+569' + d }; // celular sin el 9 inicial
  if (d.length === 9) return { mostrar: '+56 ' + d.slice(0, 1) + ' ' + d.slice(1, 5) + ' ' + d.slice(5), wa: null, tel: '+56' + d };
  if (d.length >= 7) return { mostrar: String(telefono).trim(), wa: null, tel: d };
  return { mostrar: String(telefono).trim(), wa: null, tel: null };
}

// Primer nombre para el saludo ("Juan Pérez" -> "Juan"); si parece una razón social o está vacío -> ''.
export function primerNombre(nombre) {
  const t = String(nombre || '').trim();
  if (!t || /\b(spa|ltda|limitada|s\.?a\.?|eirl|e\.?i\.?r\.?l|comercial|servicios|inversiones|sociedad|empresa|importadora|distribuidora|constructora)\b/i.test(t)) return '';
  const p = t.split(/\s+/)[0].replace(/[^\p{L}'-]/gu, '');
  if (p.length < 2) return '';
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

// ---- Puntaje previo (decide qué ~40 clientes ve la IA; la IA elige y redacta los 10-15 finales) ----
// c: { segmento, email, telefono, puntos, compras12m, comprasTotal, diasUltimaCompra, montoServicios12m, montoOtros12m, montoTotal12m,
//      seguimientoVencido, intentosSinRespuesta }
export function puntuarCandidato(c) {
  let p = 0; const razones = [];
  const compras = Number(c.compras12m) || 0;
  const total = Number(c.comprasTotal) || 0;
  const dias = c.diasUltimaCompra == null ? null : Number(c.diasUltimaCompra);
  if (compras >= 6) { p += 24; razones.push('compra seguido (' + compras + ' compras en 12 meses)'); }
  else if (compras >= 3) { p += 18; razones.push(compras + ' compras en los últimos 12 meses'); }
  else if (compras >= 1) { p += 10; razones.push(compras + (compras === 1 ? ' compra' : ' compras') + ' en los últimos 12 meses'); }
  else if (total > 0) { p += 3; razones.push('compró antes, no en el último año'); }
  if (dias != null) {
    if (dias <= 45) { p += 14; razones.push('compró hace poco'); }
    else if (dias <= 120) { p += 9; }
    else if (dias <= 365) { p += 4; }
  }
  const monto = Number(c.montoTotal12m) || 0;
  if (monto >= 3000000) p += 16; else if (monto >= 1000000) p += 12; else if (monto >= 300000) p += 7; else if (monto > 0) p += 3;
  if (c.segmento === 'potenciar') { p += 12; razones.push('tiene correo con dominio propio (probable sitio web que mejorar)'); }
  else { p += 8; razones.push('usa correo personal (probablemente sin sitio propio)'); }
  const tel = telefonoChileno(c.telefono);
  if (tel.wa) { p += 10; razones.push('tiene celular (WhatsApp)'); }
  else if (tel.tel) { p += 4; }
  else { p -= 6; }
  if (!String(c.email || '').includes('@')) p -= 4;
  if ((Number(c.puntos) || 0) > 0) p += 3;
  if (c.seguimientoVencido) { p += 30; razones.push('seguimiento vencido: quedó de volver a llamarlo'); }
  p -= Math.min(12, 4 * (Number(c.intentosSinRespuesta) || 0));
  return { puntaje: Math.max(0, Math.min(100, Math.round(p))), razones };
}

// ---- Gemini ----
export const SISTEMA_PLAN_IA = `Eres el asistente comercial de IndexStore (Santiago, Chile). IndexStore vende repuestos y da servicio técnico para notebooks, y su otra empresa, IndexScale (indexscale.cl), diseña tiendas online y optimiza e-commerce para pymes.
Tu trabajo: de una lista de clientes de IndexStore (empresas que ya nos compran), elegir a quiénes un vendedor debería contactar HOY para ofrecerles IndexScale, y dejarle todo listo para que hable con ellos sin pensar.
Reglas:
- Usa SOLO los datos entregados de cada cliente. No inventes giro, rubro, tamaño, productos ni nada que no esté en los datos.
- Elige exactamente la cantidad pedida. Prioriza: seguimientos vencidos, clientes que compran seguido o compraron hace poco, con celular, con correo de dominio propio (mejorar su sitio) o con correo personal (crear su tienda). Varía el tipo de cliente; no pongas 12 iguales.
- "oferta": crear_tienda (correo personal: probablemente no tiene sitio), optimizar_tienda (correo con dominio propio: probablemente ya tiene sitio) o diagnostico_gratis (si no tienes certeza).
- "motivo": 1 frase corta y concreta de por qué este cliente ahora (por ejemplo "Compra todos los meses y usa correo de Gmail: no debería tener tienda propia"). Máximo 140 caracteres.
- "mensaje_whatsapp": primer mensaje breve (máximo 380 caracteres), cercano, chileno neutro, sin tecnicismos, sin precios ni montos, sin presionar. Parte saludando con {nombre}, se presenta como {vendedor} de IndexStore, menciona que ya le han comprado a IndexStore, y propone un diagnóstico gratuito de su presencia online como siguiente paso. Termina con una pregunta fácil de responder. Usa literalmente los textos {nombre} y {vendedor}; se reemplazan después.
- "apertura_llamada": 2 frases para decir por teléfono al inicio.
- "preguntas": 3 preguntas para descubrir si necesita una tienda o mejorar la que tiene (cómo vende hoy, si tiene sitio, qué le cuesta más). Cortas.
- "objeciones": 2 objeciones probables con una respuesta breve y honesta cada una (por ejemplo "no tengo tiempo", "ya tengo una página", "es caro" -> el diagnóstico es gratis y sin compromiso).
- Nunca menciones montos de dinero que haya gastado el cliente. No prometas resultados ni plazos que no estén en los datos.
- "prioridad": alta, media o baja.
Responde llamando a la herramienta.`;

export const HERRAMIENTA_PLAN_IA = {
  name: 'lista_de_contacto',
  description: 'Lista ordenada de clientes a contactar hoy, con la guía de conversación para el vendedor.',
  input_schema: {
    type: 'object',
    properties: {
      seleccion: {
        type: 'array',
        description: 'Los clientes elegidos, del más al menos prometedor.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'El id del cliente tal como viene en los datos.' },
            prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
            oferta: { type: 'string', enum: OFERTAS_PLAN },
            motivo: { type: 'string' },
            mensaje_whatsapp: { type: 'string' },
            apertura_llamada: { type: 'string' },
            preguntas: { type: 'array', items: { type: 'string' } },
            objeciones: { type: 'array', items: { type: 'object', properties: { objecion: { type: 'string' }, respuesta: { type: 'string' } }, required: ['objecion', 'respuesta'] } },
          },
          required: ['id', 'prioridad', 'oferta', 'motivo', 'mensaje_whatsapp', 'apertura_llamada', 'preguntas', 'objeciones'],
        },
      },
      resumen: { type: 'string', description: 'Una frase para el vendedor sobre cómo enfrentar la lista de hoy.' },
    },
    required: ['seleccion'],
  },
};

const recortar = (t, n) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);

// Guía de respaldo cuando la IA no responde: el vendedor igual recibe su lista con textos útiles.
export function guiaRespaldo(c) {
  const oferta = c.segmento === 'potenciar' ? 'optimizar_tienda' : 'crear_tienda';
  const mensaje = oferta === 'optimizar_tienda'
    ? 'Hola {nombre}, soy {vendedor} de IndexStore. Como ya nos has comprado, quería contarte que también ayudamos a pymes a vender más con su sitio web (IndexScale). ¿Te puedo hacer un diagnóstico gratuito de tu página y mostrarte qué mejorar?'
    : 'Hola {nombre}, soy {vendedor} de IndexStore. Como ya nos has comprado, quería contarte que también armamos tiendas online para pymes (IndexScale). ¿Te interesaría un diagnóstico gratuito para ver si te conviene vender por internet?';
  return {
    prioridad: c.puntaje >= 60 ? 'alta' : c.puntaje >= 40 ? 'media' : 'baja',
    oferta,
    motivo: recortar(c.razones && c.razones.length ? c.razones.slice(0, 2).join('; ') : 'Cliente de IndexStore en la Región Metropolitana', 140),
    mensaje_whatsapp: mensaje,
    apertura_llamada: 'Hola, ¿hablo con ' + '{nombre}' + '? Soy {vendedor} de IndexStore, donde nos ha comprado. Le llamo porque también ayudamos a pymes con su sitio web y tienda online, ¿tiene un minuto?',
    preguntas: ['¿Hoy vende por internet o solo en forma presencial / por WhatsApp?', '¿Tiene sitio web o tienda online? ¿Cómo le está funcionando?', '¿Qué es lo que más le cuesta hoy para conseguir clientes?'],
    objeciones: [
      { objecion: 'Ya tengo página', respuesta: 'Perfecto, justamente el diagnóstico es gratuito y revisa la que tiene: le muestro qué se puede mejorar sin compromiso.' },
      { objecion: 'No tengo tiempo', respuesta: 'Lo entiendo, por eso le propongo algo corto: le envío por escrito el diagnóstico y lo ve cuando pueda.' },
    ],
  };
}

// Lo que devolvió Gemini -> lista limpia y segura. Descarta ids que no estaban entre los candidatos, repetidos, y completa lo que falte con el respaldo.
export function validarSeleccionIA(bruto, candidatos, cantidad) {
  const porId = new Map(candidatos.map((c) => [c.id, c]));
  const usados = new Set();
  const salida = [];
  const lista = bruto && Array.isArray(bruto.seleccion) ? bruto.seleccion : [];
  for (const s of lista) {
    const id = Number(s && s.id);
    const c = porId.get(id);
    if (!c || usados.has(id)) continue;
    usados.add(id);
    const resp = guiaRespaldo(c);
    const preguntas = (Array.isArray(s.preguntas) ? s.preguntas : []).map((x) => recortar(x, 200)).filter(Boolean).slice(0, 4);
    const objeciones = (Array.isArray(s.objeciones) ? s.objeciones : [])
      .map((o) => ({ objecion: recortar(o && o.objecion, 120), respuesta: recortar(o && o.respuesta, 300) })).filter((o) => o.objecion && o.respuesta).slice(0, 3);
    salida.push({
      id, origen: 'ia',
      prioridad: ['alta', 'media', 'baja'].includes(s.prioridad) ? s.prioridad : resp.prioridad,
      oferta: OFERTAS_PLAN.includes(s.oferta) ? s.oferta : resp.oferta,
      motivo: recortar(s.motivo, 160) || resp.motivo,
      mensaje_whatsapp: recortar(s.mensaje_whatsapp, 600) || resp.mensaje_whatsapp,
      apertura_llamada: recortar(s.apertura_llamada, 400) || resp.apertura_llamada,
      preguntas: preguntas.length ? preguntas : resp.preguntas,
      objeciones: objeciones.length ? objeciones : resp.objeciones,
    });
    if (salida.length >= cantidad) break;
  }
  for (const c of candidatos) { // si la IA eligió menos de los pedidos, se completa por puntaje
    if (salida.length >= cantidad) break;
    if (usados.has(c.id)) continue;
    usados.add(c.id);
    salida.push({ id: c.id, origen: 'respaldo', ...guiaRespaldo(c) });
  }
  return salida;
}

// Reemplaza {nombre} (y deja {vendedor} para quien lo envía). Sin nombre -> "Hola" sin coma colgando.
export function personalizarTexto(texto, nombre) {
  const n = String(nombre || '').trim();
  let t = String(texto || '');
  t = n ? t.replace(/\{nombre\}/g, n) : t.replace(/\s*\{nombre\}\s*/g, ' ').replace(/Hola\s*,/g, 'Hola,').replace(/\s{2,}/g, ' ').replace(/¿hablo con\s*\?/gi, '¿hablo con la persona encargada?');
  return t.trim();
}

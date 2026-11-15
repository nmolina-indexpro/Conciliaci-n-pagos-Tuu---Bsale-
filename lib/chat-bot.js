// /lib/chat-bot.js
// Asistente guiado del chat en vivo (sin IA): es SIEMPRE el primero que responde. Averigua qué necesita el cliente (tipo de producto, modelo, pedido),
// y luego lo deriva a un ejecutivo si hay alguien en línea, o deja el lead en Tickets si no.
// Funciones puras (sin base ni red): reciben el estado de la sesión y lo que escribió el visitante, y devuelven qué decir y qué hacer.
// Los textos y las opciones son PROVISORIOS hasta contrastarlos con el flujo real de Zobot en Zoho SalesIQ.
// Fase 2: Gemini podrá entender texto libre en el paso "modelo"; el resto del flujo seguirá siendo determinista.

import { normalizarEmail, normalizarTelefono } from './tickets.js';

export const NOMBRE_ASISTENTE = 'Asistente IndexStore';

// Imagen que explica dónde está el modelo del equipo (la de Zobot es una foto de etiquetas). Se configura con CHAT_IMAGEN_MODELO (URL pública).
export function imagenModelo() { return process.env.CHAT_IMAGEN_MODELO || null; }

export const TIPOS = [
  { id: 'pantalla', etiqueta: 'Pantalla' },
  { id: 'bateria', etiqueta: 'Batería' },
  { id: 'cargador', etiqueta: 'Cargador' },
  { id: 'otro_repuesto', etiqueta: 'Otro repuesto' },
  { id: 'servicio_tecnico', etiqueta: 'Servicio técnico' },
  { id: 'postventa', etiqueta: 'Mi pedido (postventa)' },
  { id: 'otra', etiqueta: 'Otra consulta' },
];
const PIDEN_MODELO = ['pantalla', 'bateria', 'cargador', 'otro_repuesto'];
export function etiquetaTipo(id) { return (TIPOS.find((t) => t.id === id) || {}).etiqueta || null; }

export function primerNombre(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

function sinTildes(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// "necesito una pantalla para mi hp" -> 'pantalla'. null si no se reconoce.
export function tipoDesdeTexto(texto) {
  const t = sinTildes(texto);
  if (!t) return null;
  if (/pedido|compre|compra |despacho|seguimiento|boleta|factura|garantia/.test(t)) return 'postventa';
  if (/pantalla|display|\blcd\b|\bled\b|screen/.test(t)) return 'pantalla';
  if (/bateri/.test(t)) return 'bateria';
  if (/cargador|charger|adaptador|fuente de poder/.test(t)) return 'cargador';
  if (/reparar|reparacion|arreglo|arreglar|servicio tecnico|no enciende|no prende/.test(t)) return 'servicio_tecnico';
  if (/teclado|disco|ssd|ram|memoria|bisagra|carcasa|ventilador|cooler/.test(t)) return 'otro_repuesto';
  return null;
}

// "quiero hablar con un ejecutivo" / "una persona" (solo mensajes cortos, para no confundir una descripción larga).
export function pideEjecutivo(texto) {
  const t = sinTildes(texto).trim();
  return t.length > 0 && t.length <= 60 && /\b(ejecutiv[oa]s?|humano|persona|asesor[a]?|vendedor[a]?|agente|alguien|operador[a]?)\b/.test(t);
}

// Saca un correo o un teléfono de lo que escribió la persona.
export function extraerContacto(texto) {
  const t = String(texto || '');
  const mail = t.match(/[^\s@,;:<>()]+@[^\s@,;:<>()]+\.[^\s@,;:<>()]+/);
  const email = mail ? normalizarEmail(mail[0]) : null;
  const sinMail = mail ? t.replace(mail[0], ' ') : t;
  const tel = sinMail.match(/(\+?\d[\d\s().-]{6,17}\d)/);
  const dig = tel ? tel[1].replace(/\D/g, '') : '';
  const telefono = dig.length >= 8 && dig.length <= 12 ? normalizarTelefono(dig) : null;
  return { email, telefono };
}

export function mensajeInicial(nombre) {
  const n = primerNombre(nombre);
  return { texto: `¡Hola${n ? ' ' + n : ''}! 👋 Soy el asistente de IndexStore. ¿En qué te puedo ayudar hoy?`, opciones: TIPOS.map((t) => ({ id: t.id, etiqueta: t.etiqueta })) };
}

function textoCierre(ses, contacto) {
  const n = primerNombre(ses.nombre);
  const email = contacto?.email || ses.email;
  const tel = contacto?.telefono || ses.telefono;
  const via = email && tel ? `correo o WhatsApp ${tel}` : email ? `correo ${email}` : `WhatsApp ${tel}`;
  return `Perfecto${n ? ' ' + n : ''}, te enviaremos una respuesta a tu ${via} cuando volvamos a estar en línea. ¡Gracias por escribirnos!`;
}

function derivar(ses, datos, { hayEjecutivos }, contacto = null) {
  const n = primerNombre(ses.nombre);
  if (hayEjecutivos) {
    return { mensajes: [{ texto: `Gracias${n ? ', ' + n : ''}. Te conecto con un ejecutivo para que te ayude con esto. Un momento… 🙌` }], paso: 'cola', datos, accion: 'derivar' };
  }
  if (contacto?.email || contacto?.telefono || ses.email || ses.telefono) {
    return { mensajes: [{ texto: textoCierre(ses, contacto) }], paso: 'fin', datos, accion: 'crear_lead_y_cerrar', contacto };
  }
  return { mensajes: [{ texto: 'Por ahora no tenemos ejecutivos en línea. Déjame tu WhatsApp o tu correo y te respondemos apenas volvamos 🙂' }], paso: 'contacto', datos: { ...datos, intentos_contacto: 0 }, accion: null };
}

// Un paso del flujo. ses: { paso, datos, nombre, email, telefono }; entrada: { texto, opcion, imagen }; ctx: { hayEjecutivos }.
// Devuelve { mensajes: [{texto, opciones?, imagen_url?}], paso, datos, accion: null | 'derivar' | 'crear_lead_y_cerrar' | 'cerrar_sin_lead', contacto? }.
export function siguientePaso(ses, entrada = {}, ctx = {}) {
  const datos = { ...(ses.datos || {}) };
  const texto = String(entrada.texto || '').trim();
  const paso = ses.paso || 'tipo';
  const nada = { mensajes: [], paso, datos, accion: null };

  if (paso === 'cola' || paso === 'fin') return nada;

  if (paso !== 'contacto' && (entrada.opcion === 'ejecutivo' || (!entrada.opcion && pideEjecutivo(texto)))) {
    datos.pidio_ejecutivo = true;
    return derivar(ses, datos, ctx);
  }

  if (paso === 'tipo') {
    const opcion = TIPOS.some((t) => t.id === entrada.opcion) ? entrada.opcion : null;
    const tipo = opcion || tipoDesdeTexto(texto);
    if (!tipo) {
      if (texto) { datos.tipo = 'otra'; datos.detalle = texto.slice(0, 600); return derivar(ses, datos, ctx); }
      return { mensajes: [{ texto: 'Elige una de estas opciones para ayudarte más rápido 👇', opciones: TIPOS.map((t) => ({ id: t.id, etiqueta: t.etiqueta })) }], paso, datos, accion: null };
    }
    datos.tipo = tipo;
    if (!opcion && texto && /\d/.test(texto) && PIDEN_MODELO.includes(tipo)) { datos.modelo = texto.slice(0, 150); return derivar(ses, datos, ctx); } // "pantalla hp 250 g10": ya dijo el modelo
    if (PIDEN_MODELO.includes(tipo)) {
      return { mensajes: [{ texto: 'Perfecto. Necesito el *modelo completo* de tu equipo (por ejemplo "HP 250 G10"). Si no lo sabes, está en la etiqueta de la parte trasera del equipo (donde dice "model"), o puedes enviarme una foto 📷', imagen_url: imagenModelo() }], paso: 'modelo', datos, accion: null };
    }
    if (tipo === 'postventa') return { mensajes: [{ texto: 'Claro. ¿Cuál es el número de tu pedido? (Lo encuentras en el correo de confirmación, por ejemplo #12345)' }], paso: 'pedido', datos, accion: null };
    if (tipo === 'servicio_tecnico') return { mensajes: [{ texto: 'Cuéntame qué equipo es (marca y modelo) y qué le está pasando.' }], paso: 'detalle', datos, accion: null };
    return { mensajes: [{ texto: 'Cuéntame brevemente qué necesitas y lo reviso.' }], paso: 'detalle', datos, accion: null };
  }

  if (paso === 'modelo') {
    if (texto) { datos.modelo = texto.slice(0, 150); if (entrada.imagen) datos.foto = true; return derivar(ses, datos, ctx); }
    if (entrada.imagen) { datos.foto = true; const r = derivar(ses, datos, ctx); r.mensajes.unshift({ texto: 'Gracias por la foto, un ejecutivo la va a revisar.' }); return r; }
    return nada;
  }

  if (paso === 'pedido') {
    const num = texto.match(/\d{3,}/);
    if (num) { datos.pedido = num[0]; return { mensajes: [{ texto: 'Gracias. ¿Qué pasó con tu pedido?' }], paso: 'detalle', datos, accion: null }; }
    datos.intentos_pedido = (datos.intentos_pedido || 0) + 1;
    if (!texto && entrada.imagen) { datos.foto = true; return derivar(ses, datos, ctx); }
    if (datos.intentos_pedido >= 2) { datos.detalle = texto.slice(0, 600); return derivar(ses, datos, ctx); }
    return { mensajes: [{ texto: 'No logré leer el número. Escríbelo solo con dígitos, por favor (por ejemplo 12345).' }], paso, datos, accion: null };
  }

  if (paso === 'detalle') {
    if (texto) { datos.detalle = [datos.detalle, texto].filter(Boolean).join(' · ').slice(0, 800); return derivar(ses, datos, ctx); }
    if (entrada.imagen) { datos.foto = true; return derivar(ses, datos, ctx); }
    return nada;
  }

  if (paso === 'contacto') {
    const c = extraerContacto(texto);
    if (c.email || c.telefono) {
      return { mensajes: [{ texto: textoCierre(ses, c) }], paso: 'fin', datos, accion: 'crear_lead_y_cerrar', contacto: c };
    }
    datos.intentos_contacto = (datos.intentos_contacto || 0) + 1;
    if (datos.intentos_contacto >= 2) {
      return { mensajes: [{ texto: 'No te preocupes. Cuando quieras puedes escribirnos por WhatsApp o abrir el chat de nuevo. ¡Gracias!' }], paso: 'fin', datos, accion: 'cerrar_sin_lead' };
    }
    return { mensajes: [{ texto: 'No logré leer ese dato. ¿Me dejas tu WhatsApp (por ejemplo +56 9 1234 5678) o tu correo?' }], paso, datos, accion: null };
  }

  return nada;
}

// Cuando nadie tomó el chat a tiempo: pide el contacto o, si ya lo tiene, cierra dejando el lead.
export function sinAtender(ses) {
  const datos = { ...(ses.datos || {}), desde_cola: true };
  if (ses.email || ses.telefono) {
    return { mensajes: [{ texto: `Parece que todos nuestros ejecutivos están ocupados en este momento. ${textoCierre(ses)}` }], paso: 'fin', datos, accion: 'crear_lead_y_cerrar', contacto: null };
  }
  return { mensajes: [{ texto: 'Parece que todos nuestros ejecutivos están ocupados en este momento. Déjame tu WhatsApp o tu correo y te respondemos a la brevedad 🙂' }], paso: 'contacto', datos: { ...datos, intentos_contacto: 0 }, accion: null };
}

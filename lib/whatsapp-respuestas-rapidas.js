// /lib/whatsapp-respuestas-rapidas.js
// Respuestas rápidas de WhatsApp (como en WhatsApp Business): el ejecutivo escribe "/" en la conversación, elige una y el texto se inserta para revisarlo y enviarlo.
// Se administran desde Clientes WhatsApp > Configuración. Las cuatro iniciales se siembran una sola vez, cuando se crea la tabla.

import { unaVez } from './una-vez.js';

export const RESPUESTAS_INICIALES = [
  {
    atajo: 'RecontactarPantalla',
    texto: `Hola, soy Nicolás del equipo de Indexstore.cl finalmente pudo realizar la compra de la pantalla? 💻 ¿aún necesita instalación?
quedamos atentos por cualquier duda.`,
  },
  {
    atajo: 'PantallaDISPONIBLE',
    texto: `¡Tenemos la pantalla disponible! 💻

💰 Precio: $
✅ Instalación GRATIS en nuestra tienda
⏱️ Tiempo de instalación: 20 a 25 minutos (con el equipo completo)
🛡️ 2 años de garantía por fallas de fábrica
💳 Aceptamos todos los medios de pago

🔗 Ver producto:

📍 Estamos en: La Concepción 81, oficina 1904, piso 19, Providencia. A pasos del Metro Pedro de Valdivia.

🕒 Horarios de atención:
• Lun y Mar: 9:30 a 18:30
• Mié y Jue: 9:30 a 19:30
• Vie: 9:30 a 17:30
• Sáb: 10:00 a 14:00

🛠️ Servicio técnico no atiende de 13:00 a 14:00 hrs por colación (lunes a viernes).

📍 Ubicación y opiniones de nuestros clientes:
https://g.page/INDEXSTORE?share

*¿Requieres Instalación o Envío de la Pantalla?*`,
  },
  {
    atajo: 'losiento',
    texto: 'Lo siento pero no estamos trabajando con ese modelo en específico. por lo general recomendamos encontrarlo en Aliexpress o Mercadolibre.',
  },
  {
    atajo: 'bisagras',
    texto: `Hola,  tenemos disponible el servicio de reparación de bisagras, por $55.000
https://www.indexstore.cl/products/reparacion-de-bisagras

*Sujeto a evaluación del daño existente en la carcasa*
*¿En qué consiste?*
Lo primero es evaluar el daño de la carcasa, para confirmar si es posible reparar las bisagras o si es necesario cambian la carcasa completa del equipo. Para que podamos ver el estado real en el que está, sugerimos que traigas tu equipo a nuestra tienda.

*¿Cuánto se demora?*
Tiempo estimado de trabajo: De 24 a 72 HRS hábiles

¡LA MEJOR GARANTÍA DEL MERCADO! Somos los únicos que entregamos 12 meses de garantía en este servicio.

⭐ Más de 1.100 reseñas reales en Google
*Estamos ubicados en:*

📍 La Concepción 81, Of. 1904, Piso 19 - Providencia, 🚇 Metro Pedro de Valdivia

🕒 Lun y Mar: 9:30 a 18:30 hrs *🕒Mié y Jue: 9:30 a 20:00 hrs* 🕒 Vie: 9:30 a 17:30 hrs 🕒 Sáb: 10:00 a 14:00 hrs

📍 Ubicación y opiniones de clientes:
https://g.page/INDEXSTORE?share`,
  },
];

export const ATAJO_MAX = 40;
export const TEXTO_MAX = 4000; // WhatsApp admite hasta 4096 caracteres por mensaje

// Atajo sin "/" ni espacios, solo letras, números, guion y guion bajo (así se puede escribir seguido, como "/bisagras").
export function normalizarAtajo(valor) {
  return String(valor ?? '').trim().replace(/^\/+/, '').replace(/\s+/g, '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, ATAJO_MAX);
}

// Devuelve { atajo, texto } limpio o lanza Error con un mensaje listo para mostrar.
export function validarRespuesta(entrada) {
  const atajo = normalizarAtajo(entrada?.atajo);
  const texto = String(entrada?.texto ?? '').replace(/\r\n/g, '\n').trim();
  if (!atajo) throw new Error('El atajo es obligatorio (por ejemplo: bisagras).');
  if (!texto) throw new Error('El texto de la respuesta es obligatorio.');
  if (texto.length > TEXTO_MAX) throw new Error(`El texto es demasiado largo (${texto.length} de ${TEXTO_MAX} caracteres).`);
  return { atajo, texto };
}

export function asegurarTablaRespuestasRapidas(sql) {
  return unaVez('asegurarTablaRespuestasRapidas', () => _asegurar(sql));
}
async function _asegurar(sql) {
  // La siembra solo corre cuando la tabla todavía no existía: si después se borran respuestas, no reaparecen solas.
  const { rows } = await sql`SELECT to_regclass('public.whatsapp_respuestas_rapidas') AS t;`;
  const existia = !!rows[0]?.t;
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_respuestas_rapidas (
      id SERIAL PRIMARY KEY,
      atajo TEXT NOT NULL,
      texto TEXT NOT NULL,
      creado_por TEXT,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado_por TEXT,
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_respuestas_rapidas_atajo ON whatsapp_respuestas_rapidas (lower(atajo));`;
  if (!existia) {
    for (const r of RESPUESTAS_INICIALES) {
      await sql`INSERT INTO whatsapp_respuestas_rapidas (atajo, texto, creado_por) VALUES (${r.atajo}, ${r.texto}, 'Sistema') ON CONFLICT DO NOTHING;`;
    }
  }
}

const aFila = r => ({ id: r.id, atajo: r.atajo, texto: r.texto, actualizadoPor: r.actualizado_por || r.creado_por || null, actualizadoEn: r.actualizado_en });

export async function listarRespuestas(sql) {
  const { rows } = await sql`SELECT id, atajo, texto, creado_por, actualizado_por, actualizado_en FROM whatsapp_respuestas_rapidas ORDER BY lower(atajo) ASC;`;
  return rows.map(aFila);
}

const esDuplicado = err => String(err?.code || '') === '23505' || /duplicate key|unique/i.test(String(err?.message || err));

// Cada función devuelve { ok:true, respuesta } o { ok:false, estado, error } para que el handler solo traduzca a HTTP.
export async function crearRespuesta(sql, entrada, usuario) {
  let v; try { v = validarRespuesta(entrada); } catch (e) { return { ok: false, estado: 400, error: e.message }; }
  try {
    const { rows } = await sql`INSERT INTO whatsapp_respuestas_rapidas (atajo, texto, creado_por, actualizado_por) VALUES (${v.atajo}, ${v.texto}, ${usuario || null}, ${usuario || null}) RETURNING id, atajo, texto, creado_por, actualizado_por, actualizado_en;`;
    return { ok: true, respuesta: aFila(rows[0]) };
  } catch (err) {
    if (esDuplicado(err)) return { ok: false, estado: 409, error: `Ya existe una respuesta con el atajo /${v.atajo}.` };
    throw err;
  }
}

export async function actualizarRespuesta(sql, id, entrada, usuario) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, estado: 400, error: 'Falta el id de la respuesta.' };
  let v; try { v = validarRespuesta(entrada); } catch (e) { return { ok: false, estado: 400, error: e.message }; }
  try {
    const { rows } = await sql`UPDATE whatsapp_respuestas_rapidas SET atajo = ${v.atajo}, texto = ${v.texto}, actualizado_por = ${usuario || null}, actualizado_en = now() WHERE id = ${n} RETURNING id, atajo, texto, creado_por, actualizado_por, actualizado_en;`;
    if (!rows.length) return { ok: false, estado: 404, error: 'La respuesta ya no existe.' };
    return { ok: true, respuesta: aFila(rows[0]) };
  } catch (err) {
    if (esDuplicado(err)) return { ok: false, estado: 409, error: `Ya existe otra respuesta con el atajo /${v.atajo}.` };
    throw err;
  }
}

export async function eliminarRespuesta(sql, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, estado: 400, error: 'Falta el id de la respuesta.' };
  const { rows } = await sql`DELETE FROM whatsapp_respuestas_rapidas WHERE id = ${n} RETURNING id;`;
  if (!rows.length) return { ok: false, estado: 404, error: 'La respuesta ya no existe.' };
  return { ok: true };
}

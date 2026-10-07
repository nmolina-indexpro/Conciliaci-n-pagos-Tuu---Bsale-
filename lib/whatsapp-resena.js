// Reseña de Google = VENTA CONCRETA.
// Cuando el cliente confirma que ya fue a la tienda o ya instaló el producto ("sí, fui el viernes", "ya fuimos"), el negocio le manda
// un mensaje para que califique la atención, con un enlace de Google Review ("Nos alegra saber que completaste tu compra en nuestra
// tienda… https://g.page/IndexStore/review"). Ese mensaje solo se envía cuando la compra ya se concretó, así que si aparece en una
// conversación, la conversación terminó en venta, aunque el análisis la haya dejado como "otro" o "cliente dejó de responder".
//
// Un solo patrón para JavaScript y PostgreSQL (operador ~*): enlace de reseña de Google (g.page/.../review o writereview) o la frase
// de la plantilla ("completaste tu compra"). Solo se mira lo que escribe el negocio (mensajes salientes).
export const PATRON_RESENA = 'g\\.page/[a-z0-9_/-]*review|writereview|completaste tu compra';

const RE_RESENA = new RegExp(PATRON_RESENA, 'i');

export const esMensajeResena = (texto) => RE_RESENA.test(String(texto ?? ''));

// textos = contenido de los mensajes salientes de UNA conversación.
export const hayResena = (textos) => (textos || []).some(esMensajeResena);

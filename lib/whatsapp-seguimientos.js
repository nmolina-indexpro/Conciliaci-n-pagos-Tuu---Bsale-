// /lib/whatsapp-seguimientos.js
// ══════════════════════════════════════════════════════════════════════
// "Recontacta" del correo diario de WhatsApp: seguimientos sin respuesta enviados por cada ejecutivo.
// ══════════════════════════════════════════════════════════════════════
// Regla (acordada con el usuario): cuenta un SEGUIMIENTO cuando David, Stephanie o Nathalia mandan un mensaje saliente y
//   1. el mensaje anterior de ese contacto (en cualquier conversación) también fue nuestro: el cliente no ha escrito desde entonces, y
//   2. pasaron al menos 2 horas desde ese mensaje anterior (así los mensajes seguidos de una misma respuesta no cuentan).
// Se atribuye a quien lo envió: usuario verificado del ERP o, si no hay, la firma del texto ("Soy Stephanie de Indexstore.cl"; ver aplicarFirmas en
// lib/whatsapp-ejecutivos.js). Si no se puede saber quién fue, no se le suma a nadie y se cuenta aparte como "no identificado".
// Función pura (sin red ni base de datos) para poder probarla; la consulta vive en api/negocio.js (calcularSeguimientosWhatsapp).

export const PAUSA_SEGUIMIENTO_MS = 2 * 3600 * 1000;

// c: { t (ms), prevDir ('in'|'out'|null), prevT (ms|null) }
export function esSeguimiento(c, pausaMs = PAUSA_SEGUIMIENTO_MS) {
  return Boolean(c && c.prevDir === 'out' && c.prevT != null && c.t - c.prevT >= pausaMs);
}

// candidatos: [{ id, t, prevDir, prevT }] mensajes salientes del período; claves: Map(id -> clave del autor | null);
// permitidas: Map(clave -> nombre corto) de los ejecutivos que se cuentan. Devuelve cuántos seguimientos hizo cada uno y cuántos no se pudieron atribuir.
export function contarSeguimientos(candidatos, claves, permitidas, pausaMs = PAUSA_SEGUIMIENTO_MS) {
  const porEjecutivo = {};
  for (const nombre of permitidas.values()) porEjecutivo[nombre] = 0;
  let noIdentificados = 0, otros = 0, total = 0;
  for (const c of candidatos) {
    if (!esSeguimiento(c, pausaMs)) continue;
    total++;
    const clave = claves.get(c.id) || null;
    if (!clave || clave === 'nv') noIdentificados++;
    else if (permitidas.has(clave)) porEjecutivo[permitidas.get(clave)]++;
    else otros++; // de alguien que no se cuenta (por ejemplo Fernando u otro usuario del ERP)
  }
  return { porEjecutivo, noIdentificados, otros, total };
}

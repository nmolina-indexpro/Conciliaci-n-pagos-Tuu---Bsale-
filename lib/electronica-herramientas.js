// /lib/electronica-herramientas.js
// Checklist de herramientas del técnico electrónico (ERP > Servicio Técnico > Electrónica > pestaña «Herramientas»).
// El catálogo (qué herramientas, prioridad, enlaces) está en lib/electronica-herramientas-datos.js (generado desde el Excel de compras);
// el avance (estado, precio, nota) se guarda en la tabla electronica_herramientas. Funciones puras, sin red ni base de datos.
import { HERRAMIENTAS } from './electronica-herramientas-datos.js';

export { HERRAMIENTAS };
// por cotizar -> cotizando -> comprada; «ya la tiene» = ya estaba en el taller.
export const ESTADOS_HERRAMIENTA = ['pendiente', 'cotizando', 'comprada', 'la_tiene'];

// Valida y fusiona un cambio sobre una herramienta. body = { n, estado?, precio_clp?, nota? }; existente = fila de la base (o null).
// El precio solo lo registra un administrador (es información de costos). Devuelve { ok:true, n, valores } o { ok:false, status, error }.
export function validarCambioHerramienta(body, existente, esAdmin) {
  const b = body || {};
  const n = Number(b.n);
  const h = Number.isInteger(n) ? HERRAMIENTAS.find(x => x.n === n) : null;
  if (!h) return { ok: false, status: 400, error: 'Herramienta desconocida' };
  const valores = existente
    ? { estado: existente.estado, precio_clp: existente.precio_clp == null ? null : Number(existente.precio_clp), nota: existente.nota ?? null }
    : { estado: h.inicial, precio_clp: null, nota: null };
  if ('estado' in b) {
    if (!ESTADOS_HERRAMIENTA.includes(b.estado)) return { ok: false, status: 400, error: 'Estado inválido' };
    valores.estado = b.estado;
  }
  if ('precio_clp' in b) {
    if (!esAdmin) return { ok: false, status: 403, error: 'Solo un administrador puede registrar precios' };
    if (b.precio_clp === null || b.precio_clp === '') valores.precio_clp = null;
    else {
      const p = Number(b.precio_clp);
      if (!Number.isFinite(p) || p < 0 || p > 1e9) return { ok: false, status: 400, error: 'Precio inválido' };
      valores.precio_clp = Math.round(p);
    }
  }
  if ('nota' in b) {
    const t = String(b.nota ?? '').trim();
    if (t.length > 500) return { ok: false, status: 400, error: 'La nota es demasiado larga (máximo 500 caracteres)' };
    valores.nota = t || null;
  }
  return { ok: true, n, valores };
}

// Catálogo + estado guardado -> lo que ve la página. filas = filas de la tabla; el estado inicial sale del Excel si todavía no hay fila.
export function armarHerramientas(filas) {
  const porN = new Map((filas || []).map(f => [Number(f.n), f]));
  return HERRAMIENTAS.map(h => {
    const f = porN.get(h.n);
    return { ...h, estado: f ? f.estado : h.inicial, precio_clp: f && f.precio_clp != null ? Number(f.precio_clp) : null, nota_equipo: f ? f.nota : null,
      actualizado_por: f ? f.actualizado_por : null, actualizado_en: f && f.actualizado_en ? new Date(f.actualizado_en).toISOString() : null };
  });
}

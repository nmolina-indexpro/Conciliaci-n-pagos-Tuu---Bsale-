// /lib/buscador-ia.js
// Lógica pura (sin base de datos ni red) del registro de búsquedas del
// Buscador con IA del home de indexstore.cl. El Worker de Cloudflare manda
// cada búsqueda a ?recurso=buscador-ia-registrar y acá se valida, se tachan
// datos personales y se deja lista la fila. Aislado en su propio archivo para
// poder probarlo con node sin POSTGRES_URL.

import { createHash, timingSafeEqual } from 'node:crypto';

export const MAX_CONSULTA = 200;
const MAX_RESPUESTA = 400;
const MAX_ERROR = 300;
const MAX_PRODUCTOS = 4;

// Los clientes a veces escriben su nombre, teléfono o correo en la caja.
// No se guarda nada de eso: se tacha ANTES de persistir (el Worker ya lo hace
// también; acá se repite por si el Worker cambia o alguien llama el
// endpoint directo).
export function tacharDatosPersonales(texto) {
  return String(texto ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]')
    .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g, '[rut]')
    .replace(/(\+?\d[\d\s().-]{6,}\d)/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[teléfono]' : m))
    .replace(/\s+/g, ' ')
    .trim();
}

// Clave para agrupar "Cargador Acer" con "cargador  acer " o "Cargador ÁCER".
export function normalizarConsulta(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Compara en tiempo constante (hash de ambos lados para igualar el largo).
export function claveValida(recibida, esperada) {
  if (!esperada || typeof recibida !== 'string' || !recibida) return false;
  const a = createHash('sha256').update(recibida).digest();
  const b = createHash('sha256').update(esperada).digest();
  return timingSafeEqual(a, b);
}

function entero(v, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : null;
}

// Devuelve { ok: true, fila } o { ok: false, error }.
export function validarRegistro(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Cuerpo inválido' };

  const consulta = tacharDatosPersonales(body.consulta).slice(0, MAX_CONSULTA);
  if (consulta.length < 3) return { ok: false, error: 'Consulta muy corta' };

  const productos = (Array.isArray(body.productos) ? body.productos : [])
    .slice(0, MAX_PRODUCTOS)
    .map((p) => ({
      handle: String(p?.handle ?? '').slice(0, 200),
      title: String(p?.title ?? '').slice(0, 200),
      price: entero(p?.price, 100000000),
    }))
    .filter((p) => p.handle);

  const error = body.error ? String(body.error).slice(0, MAX_ERROR) : null;

  return {
    ok: true,
    fila: {
      consulta,
      consulta_norm: normalizarConsulta(consulta),
      respuesta: body.respuesta ? tacharDatosPersonales(body.respuesta).slice(0, MAX_RESPUESTA) : null,
      productos,
      n_productos: productos.length,
      sin_resultado: productos.length === 0 && !error,
      error,
      ms: entero(body.ms, 600000),
      desde_cache: body.desde_cache === true,
    },
  };
}

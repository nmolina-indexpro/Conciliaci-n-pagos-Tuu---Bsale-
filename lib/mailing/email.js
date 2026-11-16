// /lib/mailing/email.js
// Normalización y validación de correos del módulo de Mailing. Sin dependencias.

const PATRON_CORREO = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Minúsculas, sin espacios ni comillas/<> de copiar-pegar ("Juan <juan@x.cl>" -> "juan@x.cl"). Devuelve '' si no hay nada usable.
export function normalizarEmail(valor) {
  let s = String(valor ?? '').trim();
  const entreAngulos = s.match(/<([^<>]+)>/);
  if (entreAngulos) s = entreAngulos[1];
  s = s.replace(/^[\s"'<]+|[\s"'>;,]+$/g, '').toLowerCase();
  return s;
}

export function emailValido(valor) {
  const s = normalizarEmail(valor);
  if (!s || s.length > 254) return false;
  const [local] = s.split('@');
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  return PATRON_CORREO.test(s);
}

// Quita de una lista de destinatarios los que están en el conjunto de suprimidos (Set de correos ya normalizados).
export function excluirSuprimidos(destinatarios, suprimidos) {
  const set = suprimidos instanceof Set ? suprimidos : new Set([...(suprimidos || [])].map(normalizarEmail));
  const enviables = [];
  const excluidos = [];
  for (const d of destinatarios) (set.has(normalizarEmail(d.email)) ? excluidos : enviables).push(d);
  return { enviables, excluidos };
}

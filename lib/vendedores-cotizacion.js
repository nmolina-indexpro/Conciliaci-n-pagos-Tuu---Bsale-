// /lib/vendedores-cotizacion.js
// Empareja al vendedor de Bsale (quien emitió la cotización) con un usuario activo del ERP,
// para dejarlo como responsable de la gestión. Funciones puras, sin imports.
//
// Orden de prioridad (el primero que dé UN solo candidato gana; si hay más de uno, no se asigna):
//   1) correo exacto,
//   2) nombre completo igual (sin tildes, mayúsculas ni espacios de más),
//   3) mismo apellido (último token) y primer nombre igual o casi igual (una letra de diferencia:
//      "Luiggi"/"Luigi", "Stephanie"/"Stefanie").

export function normalizarNombrePersona(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Aproximación fonética para nombres: ph->f, th->t, letras repetidas se juntan (Stephanie~Stefanie, Luiggi~Luigi).
function fonetico(t) {
  return t.replace(/ph/g, 'f').replace(/th/g, 't').replace(/(.)\1+/g, '$1');
}

function distanciaEdicion(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const m = a.length, n = b.length;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let anterior = prev[0]; prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? anterior : 1 + Math.min(anterior, prev[j], prev[j - 1]);
      anterior = temp;
    }
  }
  return prev[n];
}

// vendedor: { email, nombre }. usuarios: [{ id, nombre, email }] (activos). Devuelve el id o null.
export function emparejarVendedorConUsuario(vendedor, usuarios) {
  const email = String(vendedor?.email || '').trim().toLowerCase();
  if (email) {
    const porEmail = usuarios.filter(u => String(u.email || '').trim().toLowerCase() === email);
    if (porEmail.length === 1) return porEmail[0].id;
    if (porEmail.length > 1) return null;
  }
  const nombre = normalizarNombrePersona(vendedor?.nombre);
  if (!nombre) return null;
  const iguales = usuarios.filter(u => normalizarNombrePersona(u.nombre) === nombre);
  if (iguales.length === 1) return iguales[0].id;
  if (iguales.length > 1) return null;
  const tv = nombre.split(' ');
  if (tv.length < 2) return null; // un solo nombre es demasiado ambiguo para el cruce difuso
  const apellidoV = tv[tv.length - 1], primerV = tv[0];
  const difusos = usuarios.filter(u => {
    const tu = normalizarNombrePersona(u.nombre).split(' ');
    if (tu.length < 2) return false;
    return tu[tu.length - 1] === apellidoV && distanciaEdicion(fonetico(tu[0]), fonetico(primerV)) <= 1;
  });
  return difusos.length === 1 ? difusos[0].id : null;
}

// vendedores: [{ id, nombre, email }] de Bsale. Devuelve Map vendedorId -> usuarioId (solo los que se pudieron emparejar).
export function asignacionesPorVendedor(vendedores, usuarios) {
  const mapa = new Map();
  for (const v of vendedores) {
    const uid = emparejarVendedorConUsuario(v, usuarios);
    if (uid != null) mapa.set(v.id, uid);
  }
  return mapa;
}

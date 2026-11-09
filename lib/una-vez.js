// /lib/una-vez.js
// Las migraciones (CREATE TABLE / ALTER TABLE ... IF NOT EXISTS y siembras de datos) de las funciones asegurar* y migrar* corrían en CADA petición:
// varios viajes a la base y un bloqueo corto de la tabla por cada ALTER, además de cómputo de Neon. Ahora corren una sola vez por instancia de la función.
// Varias llamadas a la vez comparten la misma ejecución; si falla, no se recuerda y la próxima petición lo reintenta.

const hechas = new Map();

export function unaVez(clave, fn) {
  let p = hechas.get(clave);
  if (!p) {
    p = Promise.resolve().then(fn);
    hechas.set(clave, p);
    p.catch(() => { if (hechas.get(clave) === p) hechas.delete(clave); });
  }
  return p;
}

// Solo para pruebas: olvida lo ya hecho, como una instancia nueva (por ejemplo, tras un despliegue).
export function reiniciarUnaVez() { hechas.clear(); }

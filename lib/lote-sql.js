// /lib/lote-sql.js
// Guarda varias filas con UNA consulta (UNNEST) en vez de una consulta por fila (el patrón "N+1"): cada consulta es un viaje a la base y consume cómputo de Neon.
// Mismo estilo que la sincronización de ventas por SKU (bsale_ventas_sku) y el registro de precios.

const TANDA = 1000;

// INSERT ... ON CONFLICT DO UPDATE de muchas filas a la vez.
//   columnas: [['nombre', 'tipo_pg'], ...]   filas: arreglos con los valores en ese orden
//   conflicto: columnas de la clave única   ahora: columnas que se fijan en now() al insertar y al actualizar (ej. 'visto_en')
//   noActualizar: columnas que no se tocan si la fila ya existe   soloInsertar: true = ON CONFLICT DO NOTHING
// Si en el lote una clave se repite, queda la última fila (igual que al guardarlas una por una); Postgres no admite repetidas en un mismo INSERT.
export async function upsertLote(sql, tabla, columnas, filas, { conflicto, ahora = [], noActualizar = [], soloInsertar = false } = {}) {
  if (!filas.length) return 0;
  const nombres = columnas.map(c => c[0]);
  const idx = conflicto.map(k => nombres.indexOf(k));
  if (idx.some(i => i < 0)) throw new Error('upsertLote: la clave no está en las columnas de ' + tabla);
  const unicas = new Map();
  for (const f of filas) unicas.set(idx.map(i => String(f[i])).join('\u0001'), f);
  const lista = [...unicas.values()];
  const actualizables = nombres.filter(n => !conflicto.includes(n) && !noActualizar.includes(n));
  const sets = [...actualizables.map(n => `${n} = EXCLUDED.${n}`), ...ahora.map(n => `${n} = now()`)];
  const accion = soloInsertar || !sets.length ? 'DO NOTHING' : 'DO UPDATE SET ' + sets.join(', ');
  const todas = [...nombres, ...ahora];
  let total = 0;
  for (let i = 0; i < lista.length; i += TANDA) {
    const lote = lista.slice(i, i + TANDA);
    const params = columnas.map((_, j) => lote.map(f => (f[j] === undefined ? null : f[j])));
    await sql.query(
      `INSERT INTO ${tabla} (${todas.join(', ')})
       SELECT ${[...nombres.map(n => 'u.' + n), ...ahora.map(() => 'now()')].join(', ')} FROM UNNEST(${columnas.map((c, j) => `$${j + 1}::${c[1]}[]`).join(', ')}) AS u(${nombres.join(', ')})
       ON CONFLICT (${conflicto.join(', ')}) ${accion}`,
      params,
    );
    total += lote.length;
  }
  return total;
}

// UPDATE de muchas filas a la vez: tabla.columnaClave = valor de la clave, y se asignan las columnas indicadas.
//   clave: ['sku', 'text']   columnas: [['precio_lista', 'numeric'], ...]   filas: [clave, valor1, valor2...]
// Si la clave se repite en el lote queda la última.
//   ahora: columnas que se fijan en now()   fijas: asignaciones constantes en SQL (texto del código, nunca datos), ej. "error = NULL"
export async function actualizarLote(sql, tabla, clave, columnas, filas, { ahora = [], fijas = [] } = {}) {
  if (!filas.length) return 0;
  const unicas = new Map();
  for (const f of filas) unicas.set(String(f[0]), f);
  const lista = [...unicas.values()];
  const nombres = [clave[0], ...columnas.map(c => c[0])];
  const tipos = [clave[1], ...columnas.map(c => c[1])];
  let total = 0;
  for (let i = 0; i < lista.length; i += TANDA) {
    const lote = lista.slice(i, i + TANDA);
    const params = nombres.map((_, j) => lote.map(f => (f[j] === undefined ? null : f[j])));
    await sql.query(
      `UPDATE ${tabla} AS t SET ${[...columnas.map(c => `${c[0]} = u.${c[0]}`), ...ahora.map(n => `${n} = now()`), ...fijas].join(', ')}
         FROM UNNEST(${tipos.map((tp, j) => `$${j + 1}::${tp}[]`).join(', ')}) AS u(${nombres.join(', ')})
        WHERE t.${clave[0]} = u.${clave[0]}`,
      params,
    );
    total += lote.length;
  }
  return total;
}

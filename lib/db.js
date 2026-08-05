// /lib/db.js
// Import dinámico de @vercel/postgres (evita que la función se caiga con un
// error crudo si POSTGRES_URL todavía no está configurada — mismo patrón que
// ya usamos para BCI).

export async function getSql() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL no está configurada en el servidor (falta conectar la base de datos en Vercel)');
  }
  const { sql } = await import('@vercel/postgres');
  return sql;
}

export async function asegurarTablaUsuarios(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nombre TEXT,
      rol TEXT NOT NULL DEFAULT 'usuario',
      activo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
}

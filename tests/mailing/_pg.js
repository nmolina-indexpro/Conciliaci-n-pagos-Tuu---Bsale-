// Base de pruebas: Postgres real en memoria (PGlite, WASM) con la interfaz que usa el ERP (`sql` con plantillas + sql.query).
// Así se ejecutan de verdad la migración mk_* y las consultas del módulo, no un simulacro.

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { asegurarTablasMailing } from '../../lib/db.js';
import { reiniciarUnaVez } from '../../lib/una-vez.js';

export async function crearBase() {
  const db = new PGlite({ extensions: { citext } });
  await db.waitReady;
  const salida = r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  const sql = async (strings, ...valores) => {
    const texto = strings.reduce((acc, s, i) => acc + s + (i < valores.length ? `$${i + 1}` : ''), '');
    return salida(await db.query(texto, valores));
  };
  sql.query = async (texto, params = []) => salida(await db.query(texto, params));
  reiniciarUnaVez();
  await asegurarTablasMailing(sql);
  return { db, sql, cerrar: () => db.close() };
}

export const uuid = () => crypto.randomUUID();

export async function crearContacto(sql, email, { estado = 'subscribed', nombre = null } = {}) {
  const { rows: [c] } = await sql`INSERT INTO mk_contacts (email, first_name, status) VALUES (${email}, ${nombre}, ${estado}) RETURNING id`;
  return c.id;
}

export async function crearLista(sql, nombre, contactIds) {
  const { rows: [l] } = await sql`INSERT INTO mk_lists (name) VALUES (${nombre}) RETURNING id`;
  for (const id of contactIds) await sql`INSERT INTO mk_list_members (list_id, contact_id) VALUES (${l.id}, ${id})`;
  return l.id;
}

export async function crearCampana(sql, { listas, excluidas = [], html = '<html><body><p>Hola {{first_name|cliente}}</p></body></html>', rate = 1000 }) {
  const { rows: [t] } = await sql`INSERT INTO mk_templates (name, subject, html) VALUES ('t', 'Oferta para {{first_name|ti}}', ${html}) RETURNING id`;
  const { rows: [c] } = await sql`
    INSERT INTO mk_campaigns (name, template_id, subject, from_name, from_email, audience, rate_per_sec)
    VALUES ('c', ${t.id}, 'Oferta para {{first_name|ti}}', 'IndexStore', 'ofertas@news.indexstore.cl', ${JSON.stringify({ lists: listas, exclude_lists: excluidas })}::jsonb, ${rate}) RETURNING id`;
  return c.id;
}

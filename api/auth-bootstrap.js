// /api/auth-bootstrap.js
// Crea el PRIMER usuario administrador. Por seguridad, solo funciona si la
// tabla de usuarios está vacía — una vez que exista al menos un usuario,
// este endpoint se autobloquea y hay que crear cuentas nuevas desde el
// mantenedor de usuarios (ya logueado como admin).

import { getSql, asegurarTablaUsuarios } from '../lib/db.js';
import { hashPassword, firmarSesion, cookieSesion } from '../lib/auth-node.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, nombre } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Falta email o contraseña' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  try {
    const sql = await getSql();
    await asegurarTablaUsuarios(sql);

    const { rows: existentes } = await sql`SELECT COUNT(*)::int AS total FROM usuarios;`;
    if (existentes[0].total > 0) {
      return res.status(403).json({ error: 'Ya existe al menos un usuario — crea cuentas nuevas desde el mantenedor de usuarios, ya logueado.' });
    }

    const passwordHash = hashPassword(password);
    const { rows } = await sql`
      INSERT INTO usuarios (email, password_hash, nombre, rol, activo)
      VALUES (${email.toLowerCase().trim()}, ${passwordHash}, ${nombre || email}, 'admin', true)
      RETURNING id, email, nombre, rol;
    `;
    const usuario = rows[0];

    const token = firmarSesion({ uid: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol });
    res.setHeader('Set-Cookie', cookieSesion(token));
    return res.status(200).json({ ok: true, nombre: usuario.nombre, rol: usuario.rol });
  } catch (err) {
    return res.status(500).json({ error: 'Error creando el primer usuario', detail: String(err) });
  }
}

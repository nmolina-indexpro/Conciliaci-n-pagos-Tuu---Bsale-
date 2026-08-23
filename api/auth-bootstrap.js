// /api/auth-bootstrap.js
// Crea el PRIMER usuario administrador. Por seguridad, solo funciona si la
// tabla de usuarios está vacía, O si el único usuario que existe es
// justamente el mismo email que se está intentando crear (esto permite
// "recuperarse a sí mismo" si el primer intento quedó con datos corruptos,
// sin necesitar acceso de escritura directo a la base de datos). Una vez que
// exista más de un usuario, o un usuario con OTRO email, este endpoint se
// autobloquea del todo — hay que crear cuentas nuevas desde el mantenedor,
// ya logueado como admin.

import { getSql, asegurarTablaUsuarios, asegurarTablaPerfiles } from '../lib/db.js';
import { hashPassword, firmarSesion, cookieSesion } from '../lib/auth-node.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, nombre } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Falta email o contraseña' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  const emailNormalizado = email.toLowerCase().trim();

  try {
    const sql = await getSql();
    await asegurarTablaPerfiles(sql);
    await asegurarTablaUsuarios(sql);

    const { rows: existentes } = await sql`SELECT id, email FROM usuarios;`;
    const esRecuperacionValida = existentes.length === 1 && existentes[0].email === emailNormalizado;

    if (existentes.length > 0 && !esRecuperacionValida) {
      return res.status(403).json({ error: 'Ya existe al menos un usuario distinto — crea cuentas nuevas desde el mantenedor de usuarios, ya logueado.' });
    }

    const passwordHash = hashPassword(password);
    const { rows } = await sql`
      INSERT INTO usuarios (email, password_hash, nombre, rol, activo)
      VALUES (${emailNormalizado}, ${passwordHash}, ${nombre || email}, 'admin', true)
      ON CONFLICT (email) DO UPDATE SET password_hash = ${passwordHash}, nombre = ${nombre || email}, rol = 'admin', activo = true
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


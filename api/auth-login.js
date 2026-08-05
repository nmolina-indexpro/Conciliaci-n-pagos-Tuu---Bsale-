// /api/auth-login.js
import { getSql, asegurarTablaUsuarios } from '../lib/db.js';
import { verificarPassword, firmarSesion, cookieSesion } from '../lib/auth-node.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Falta email o contraseña' });

  try {
    const sql = await getSql();
    await asegurarTablaUsuarios(sql);

    const { rows } = await sql`SELECT * FROM usuarios WHERE email = ${email.toLowerCase().trim()} LIMIT 1;`;
    const usuario = rows[0];

    if (!usuario || !usuario.activo || !verificarPassword(password, usuario.password_hash)) {
      // Mensaje genérico a propósito: no revelamos si el email existe o no.
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const token = firmarSesion({ uid: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol });
    res.setHeader('Set-Cookie', cookieSesion(token));
    return res.status(200).json({ ok: true, nombre: usuario.nombre, rol: usuario.rol });
  } catch (err) {
    return res.status(500).json({ error: 'Error al iniciar sesión', detail: String(err) });
  }
}

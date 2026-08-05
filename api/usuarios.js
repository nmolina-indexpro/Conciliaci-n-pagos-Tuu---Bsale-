// /api/usuarios.js
// CRUD del mantenedor de usuarios. Solo accesible para usuarios con rol
// 'admin' — cualquier otro caso devuelve 403.

import { getSql, asegurarTablaUsuarios } from '../lib/db.js';
import { hashPassword, usuarioDesdeRequest } from '../lib/auth-node.js';

export default async function handler(req, res) {
  const sesion = usuarioDesdeRequest(req);
  if (!sesion) return res.status(401).json({ error: 'No hay sesión activa' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede gestionar usuarios' });

  try {
    const sql = await getSql();
    await asegurarTablaUsuarios(sql);

    if (req.method === 'GET') {
      const { rows } = await sql`SELECT id, email, nombre, rol, activo, created_at FROM usuarios ORDER BY created_at ASC;`;
      return res.status(200).json({ usuarios: rows });
    }

    if (req.method === 'POST') {
      const { email, password, nombre, rol } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: 'Falta email o contraseña' });
      if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      const rolFinal = rol === 'admin' ? 'admin' : 'usuario';
      const passwordHash = hashPassword(password);
      try {
        const { rows } = await sql`
          INSERT INTO usuarios (email, password_hash, nombre, rol, activo)
          VALUES (${email.toLowerCase().trim()}, ${passwordHash}, ${nombre || email}, ${rolFinal}, true)
          RETURNING id, email, nombre, rol, activo, created_at;
        `;
        return res.status(200).json({ usuario: rows[0] });
      } catch (err) {
        if (String(err).includes('duplicate key')) return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
        throw err;
      }
    }

    if (req.method === 'PUT') {
      const { id, nombre, rol, activo, password } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Falta el id del usuario' });

      // No permitir que un admin se quite a sí mismo el rol de admin ni se
      // desactive a sí mismo -> evita quedar todos bloqueados sin querer.
      if (Number(id) === sesion.uid && (rol === 'usuario' || activo === false)) {
        return res.status(400).json({ error: 'No puedes quitarte tu propio acceso de administrador ni desactivar tu propia cuenta.' });
      }

      if (password) {
        if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        const passwordHash = hashPassword(password);
        await sql`UPDATE usuarios SET nombre = COALESCE(${nombre}, nombre), rol = COALESCE(${rol}, rol), activo = COALESCE(${activo}, activo), password_hash = ${passwordHash} WHERE id = ${id};`;
      } else {
        await sql`UPDATE usuarios SET nombre = COALESCE(${nombre}, nombre), rol = COALESCE(${rol}, rol), activo = COALESCE(${activo}, activo) WHERE id = ${id};`;
      }
      const { rows } = await sql`SELECT id, email, nombre, rol, activo, created_at FROM usuarios WHERE id = ${id};`;
      return res.status(200).json({ usuario: rows[0] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Falta el id del usuario' });
      if (Number(id) === sesion.uid) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });

      const { rows: admins } = await sql`SELECT COUNT(*)::int AS total FROM usuarios WHERE rol = 'admin' AND activo = true;`;
      const { rows: objetivo } = await sql`SELECT rol FROM usuarios WHERE id = ${id};`;
      if (objetivo[0]?.rol === 'admin' && admins[0].total <= 1) {
        return res.status(400).json({ error: 'No puedes eliminar al único administrador que queda.' });
      }

      await sql`DELETE FROM usuarios WHERE id = ${id};`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en el mantenedor de usuarios', detail: String(err) });
  }
}

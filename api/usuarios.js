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
      const { rows } = await sql`SELECT id, email, nombre, rol, activo, expira_en, created_at FROM usuarios ORDER BY created_at ASC;`;
      return res.status(200).json({ usuarios: rows });
    }

    if (req.method === 'POST') {
      const { email, password, nombre, rol, expiraMinutos } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: 'Falta email o contraseña' });
      if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      const rolFinal = rol === 'admin' ? 'admin' : 'usuario';
      const passwordHash = hashPassword(password);
      // Cuenta temporal: si viene expiraMinutos (> 0), la cuenta deja de
      // poder loguearse pasado ese tiempo (ver api/auth-login.js). Sin
      // expiraMinutos, la cuenta es permanente (expira_en = NULL).
      const expiraEn = (typeof expiraMinutos === 'number' && expiraMinutos > 0)
        ? new Date(Date.now() + expiraMinutos * 60 * 1000)
        : null;
      try {
        const { rows } = await sql`
          INSERT INTO usuarios (email, password_hash, nombre, rol, activo, expira_en)
          VALUES (${email.toLowerCase().trim()}, ${passwordHash}, ${nombre || email}, ${rolFinal}, true, ${expiraEn})
          RETURNING id, email, nombre, rol, activo, expira_en, created_at;
        `;
        return res.status(200).json({ usuario: rows[0] });
      } catch (err) {
        if (String(err).includes('duplicate key')) return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
        throw err;
      }
    }

    if (req.method === 'PUT') {
      const { id, nombre, rol, activo, password, expiraMinutos, quitarExpiracion } = req.body || {};
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

      // La expiración se maneja en una consulta aparte porque a veces hay
      // que dejarla explícitamente en NULL (quitar la expiración), y
      // COALESCE no distingue "no me mandaron este campo" de "me mandaron
      // NULL a propósito".
      if (quitarExpiracion) {
        await sql`UPDATE usuarios SET expira_en = NULL WHERE id = ${id};`;
      } else if (typeof expiraMinutos === 'number' && expiraMinutos > 0) {
        const nuevaExpira = new Date(Date.now() + expiraMinutos * 60 * 1000);
        await sql`UPDATE usuarios SET expira_en = ${nuevaExpira} WHERE id = ${id};`;
      }

      const { rows } = await sql`SELECT id, email, nombre, rol, activo, expira_en, created_at FROM usuarios WHERE id = ${id};`;
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

// /api/usuarios.js
// CRUD del mantenedor de usuarios. Solo accesible para usuarios con rol
// 'admin' — cualquier otro caso devuelve 403.

import { getSql, asegurarTablaUsuarios, asegurarTablaPerfiles } from '../lib/db.js';
import { hashPassword, usuarioDesdeRequest } from '../lib/auth-node.js';
import { enviarCorreo } from '../lib/mailer.js';

// Páginas que se pueden marcar en un perfil de acceso (ver
// asegurarTablaPerfiles en lib/db.js). No incluye usuarios.html (ya es
// exclusivo de rol admin, independiente del perfil) ni login.html/
// reportar-error.html (siempre accesibles, ver middleware.ts).
const PAGINAS_DISPONIBLES = [
  'home.html', 'index.html', 'conciliacion.html', 'compras.html',
  'alertas-stock.html', 'oportunidades-comerciales.html', 'sitio-web.html',
  'eficiencia-tickets.html', 'guia-uso.html',
];

export default async function handler(req, res) {
  const sesion = usuarioDesdeRequest(req);
  if (!sesion) return res.status(401).json({ error: 'No hay sesión activa' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede gestionar usuarios' });

  try {
    const sql = await getSql();
    await asegurarTablaPerfiles(sql);
    await asegurarTablaUsuarios(sql);

    if (req.query.recurso === 'perfiles') return manejarPerfiles(req, res, sql);

    if (req.method === 'GET') {
      const { rows } = await sql`
        SELECT u.id, u.email, u.nombre, u.rol, u.activo, u.expira_en, u.expira_minutos, u.ultimo_login, u.created_at,
               u.perfil_id, p.nombre AS perfil_nombre
        FROM usuarios u
        LEFT JOIN perfiles p ON p.id = u.perfil_id
        ORDER BY u.created_at ASC;
      `;
      return res.status(200).json({ usuarios: rows });
    }

    if (req.method === 'POST') {
      const { email, password, nombre, rol, expiraMinutos, perfilId } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: 'Falta email o contraseña' });
      if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      const rolFinal = rol === 'admin' ? 'admin' : 'usuario';
      const passwordHash = hashPassword(password);
      // Cuenta temporal: si viene expiraMinutos (> 0), se guarda como
      // duración PENDIENTE (expira_minutos) — todavía no arranca. El reloj
      // recién empieza a correr con el primer login exitoso (ver
      // api/auth-login.js), que calcula expira_en = ahora + expira_minutos.
      // Sin expiraMinutos, la cuenta es permanente.
      const duracionPendiente = (typeof expiraMinutos === 'number' && expiraMinutos > 0) ? expiraMinutos : null;
      const perfilIdFinal = perfilId ? Number(perfilId) : null;
      let usuarioCreado;
      try {
        const { rows } = await sql`
          INSERT INTO usuarios (email, password_hash, nombre, rol, activo, expira_minutos, perfil_id)
          VALUES (${email.toLowerCase().trim()}, ${passwordHash}, ${nombre || email}, ${rolFinal}, true, ${duracionPendiente}, ${perfilIdFinal})
          RETURNING id, email, nombre, rol, activo, expira_en, expira_minutos, created_at;
        `;
        usuarioCreado = rows[0];
      } catch (err) {
        if (String(err).includes('duplicate key')) return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
        throw err;
      }

      // Correo de bienvenida con los datos de acceso. La contraseña va en
      // texto plano acá porque es la única forma de que la persona la
      // reciba (no se guarda en ningún otro lado además del hash en la
      // base) — si falla el envío, el usuario queda creado igual, solo que
      // hay que avisarle la clave por otro medio.
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const loginUrl = host ? `https://${host}/login.html` : null;
      const notaDuracion = duracionPendiente
        ? `<p>Esta es una cuenta <b>temporal</b>: el acceso dura <b>${duracionPendiente} minutos desde el primer inicio de sesión</b>, no desde este correo.</p>`
        : '';
      const correoResultado = await enviarCorreo({
        para: usuarioCreado.email,
        asunto: 'Tus datos de acceso — Panel IndexStore',
        html: `
          <p>Hola ${usuarioCreado.nombre || ''},</p>
          <p>Se creó una cuenta para ti en el panel interno de IndexStore. Estos son tus datos de acceso:</p>
          <p><b>Usuario:</b> ${usuarioCreado.email}<br><b>Contraseña:</b> ${password}</p>
          ${notaDuracion}
          ${loginUrl ? `<p>Puedes ingresar acá: <a href="${loginUrl}">${loginUrl}</a></p>` : ''}
          <p>Por seguridad, evita compartir esta contraseña con otras personas.</p>
        `,
        texto: `Hola ${usuarioCreado.nombre || ''}, se creó una cuenta para ti en el panel interno de IndexStore.\nUsuario: ${usuarioCreado.email}\nContraseña: ${password}\n${duracionPendiente ? `Cuenta temporal: dura ${duracionPendiente} minutos desde el primer inicio de sesión.\n` : ''}${loginUrl ? `Ingresa acá: ${loginUrl}\n` : ''}`,
      });

      return res.status(200).json({ usuario: usuarioCreado, correo: correoResultado });
    }

    if (req.method === 'PUT') {
      const { id, nombre, rol, activo, password, expiraMinutos, quitarExpiracion, perfilId, quitarPerfil } = req.body || {};
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

      // Igual que con la expiración: aparte porque COALESCE no distingue
      // "no mandaron este campo" de "lo mandaron en NULL a propósito" (acá,
      // quitar el perfil = volver a acceso sin restricción).
      if (quitarPerfil) {
        await sql`UPDATE usuarios SET perfil_id = NULL WHERE id = ${id};`;
      } else if (perfilId) {
        await sql`UPDATE usuarios SET perfil_id = ${Number(perfilId)} WHERE id = ${id};`;
      }

      // La expiración se maneja en consultas aparte porque a veces hay que
      // dejarla explícitamente en NULL, y COALESCE no distingue "no me
      // mandaron este campo" de "me mandaron NULL a propósito".
      if (quitarExpiracion) {
        // Cuenta permanente de nuevo: se borra tanto la fecha activa como
        // cualquier duración pendiente sin activar.
        await sql`UPDATE usuarios SET expira_en = NULL, expira_minutos = NULL WHERE id = ${id};`;
      } else if (typeof expiraMinutos === 'number' && expiraMinutos > 0) {
        // Acción manual del admin: expira AHORA + X minutos, de forma
        // inmediata (no depende de ningún login). Se usa para extender una
        // cuenta ya activa, o para forzar una expiración sin esperar un
        // primer login.
        const nuevaExpira = new Date(Date.now() + expiraMinutos * 60 * 1000);
        await sql`UPDATE usuarios SET expira_en = ${nuevaExpira}, expira_minutos = NULL WHERE id = ${id};`;
      }

      const { rows } = await sql`
        SELECT u.id, u.email, u.nombre, u.rol, u.activo, u.expira_en, u.expira_minutos, u.created_at,
               u.perfil_id, p.nombre AS perfil_nombre
        FROM usuarios u LEFT JOIN perfiles p ON p.id = u.perfil_id
        WHERE u.id = ${id};
      `;
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

// ---------------- Perfiles de acceso (?recurso=perfiles) ----------------
// Ya se validó arriba que sesion.rol === 'admin' antes de llegar acá.
async function manejarPerfiles(req, res, sql) {
  if (req.method === 'GET') {
    const { rows } = await sql`
      SELECT p.id, p.nombre, p.paginas, p.created_at,
             (SELECT COUNT(*)::int FROM usuarios u WHERE u.perfil_id = p.id) AS usuarios_asignados
      FROM perfiles p ORDER BY p.nombre ASC;
    `;
    return res.status(200).json({ perfiles: rows, paginasDisponibles: PAGINAS_DISPONIBLES });
  }

  if (req.method === 'POST') {
    const { nombre, paginas } = req.body || {};
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre del perfil' });
    const paginasValidas = (Array.isArray(paginas) ? paginas : []).filter(p => PAGINAS_DISPONIBLES.includes(p));
    try {
      const { rows } = await sql`
        INSERT INTO perfiles (nombre, paginas) VALUES (${nombre.trim()}, ${JSON.stringify(paginasValidas)})
        RETURNING id, nombre, paginas, created_at;
      `;
      return res.status(200).json({ perfil: rows[0] });
    } catch (err) {
      if (String(err).includes('duplicate key')) return res.status(400).json({ error: 'Ya existe un perfil con ese nombre' });
      throw err;
    }
  }

  if (req.method === 'PUT') {
    const { id, nombre, paginas } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Falta el id del perfil' });
    const paginasValidas = Array.isArray(paginas) ? paginas.filter(p => PAGINAS_DISPONIBLES.includes(p)) : undefined;
    await sql`
      UPDATE perfiles SET
        nombre = COALESCE(${nombre || null}, nombre),
        paginas = COALESCE(${paginasValidas ? JSON.stringify(paginasValidas) : null}, paginas)
      WHERE id = ${id};
    `;
    const { rows } = await sql`SELECT id, nombre, paginas, created_at FROM perfiles WHERE id = ${id};`;
    return res.status(200).json({ perfil: rows[0] });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta el id del perfil' });
    // ON DELETE SET NULL en usuarios.perfil_id -> a quienes tenían este
    // perfil les queda acceso sin restricción, no se quedan sin páginas.
    await sql`DELETE FROM perfiles WHERE id = ${id};`;
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

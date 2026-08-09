// /api/reportes-error.js
// Reportes de error que mandan los usuarios desde public/reportar-error.html.
// Cualquier usuario logueado puede crear uno y ver los suyos; un admin ve y
// gestiona (cambia estado) todos.

import { getSql, asegurarTablaReportesError } from '../lib/db.js';
import { usuarioDesdeRequest } from '../lib/auth-node.js';
import { enviarCorreo } from '../lib/mailer.js';

const CORREO_ALERTA = 'nmolina@indexpro.cl';
const ESTADOS_VALIDOS = ['pendiente', 'en progreso', 'resuelto'];

export default async function handler(req, res) {
  const sesion = usuarioDesdeRequest(req);
  if (!sesion) return res.status(401).json({ error: 'No hay sesión activa' });

  try {
    const sql = await getSql();
    await asegurarTablaReportesError(sql);

    if (req.method === 'GET') {
      const { rows } = sesion.rol === 'admin'
        ? await sql`SELECT * FROM reportes_error ORDER BY created_at DESC;`
        : await sql`SELECT * FROM reportes_error WHERE usuario_email = ${sesion.email} ORDER BY created_at DESC;`;
      return res.status(200).json({ reportes: rows });
    }

    if (req.method === 'POST') {
      const { descripcion, pagina } = req.body || {};
      if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'Describe el error, por favor.' });

      const { rows } = await sql`
        INSERT INTO reportes_error (usuario_email, usuario_nombre, descripcion, pagina)
        VALUES (${sesion.email}, ${sesion.nombre || sesion.email}, ${descripcion.trim()}, ${pagina || null})
        RETURNING *;
      `;
      const reporte = rows[0];

      // Alerta por correo — si falla, el reporte queda igual creado en el
      // sistema (se puede revisar en la lista), solo que no llegó el aviso.
      const correoResultado = await enviarCorreo({
        para: CORREO_ALERTA,
        asunto: `Nuevo reporte de error — ${sesion.nombre || sesion.email}`,
        html: `
          <p>Se reportó un error nuevo en el panel IndexStore.</p>
          <p><b>Usuario:</b> ${sesion.nombre || ''} (${sesion.email})<br>
          <b>Página:</b> ${pagina || 'No especificada'}<br>
          <b>Fecha:</b> ${new Date(reporte.created_at).toLocaleString('es-CL')}</p>
          <p><b>Descripción:</b><br>${(descripcion || '').replace(/\n/g, '<br>')}</p>
        `,
        texto: `Nuevo reporte de error.\nUsuario: ${sesion.nombre || ''} (${sesion.email})\nPágina: ${pagina || 'No especificada'}\nDescripción: ${descripcion}`,
      });

      return res.status(200).json({ reporte, correo: correoResultado });
    }

    if (req.method === 'PUT') {
      if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede cambiar el estado de un reporte' });
      const { id, estado } = req.body || {};
      if (!id || !estado) return res.status(400).json({ error: 'Falta id o estado' });
      if (!ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

      const { rows } = await sql`
        UPDATE reportes_error SET estado = ${estado}, actualizado_en = now()
        WHERE id = ${id}
        RETURNING *;
      `;
      return res.status(200).json({ reporte: rows[0] });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en reportes de error', detail: String(err) });
  }
}

// /api/negocio.js
// Este endpoint reúne DOS recursos que antes eran archivos separados
// (productos-criticos.js y reportes-error.js). Se fusionaron a propósito:
// Vercel (plan Hobby) permite un máximo de 12 funciones serverless por
// deployment, y con ambos archivos separados el proyecto llegó a 13 y el
// build empezó a fallar silenciosamente (los cambios no se veían reflejados
// aunque el commit sí se había subido bien a GitHub).
//
// Se elige el recurso con ?recurso=criticos o ?recurso=reportes.

import { getSql, asegurarTablaProductosCriticos, asegurarTablaReportesError } from '../lib/db.js';
import { usuarioDesdeRequest } from '../lib/auth-node.js';
import { enviarCorreo } from '../lib/mailer.js';

const CORREO_ALERTA = 'nmolina@indexpro.cl';
const ESTADOS_VALIDOS = ['pendiente', 'en progreso', 'resuelto'];

export default async function handler(req, res) {
  const sesion = usuarioDesdeRequest(req);
  if (!sesion) return res.status(401).json({ error: 'No hay sesión activa' });

  const recurso = req.query.recurso;
  if (recurso === 'criticos') return manejarCriticos(req, res, sesion);
  if (recurso === 'reportes') return manejarReportes(req, res, sesion);
  return res.status(400).json({ error: 'Falta ?recurso=criticos o ?recurso=reportes' });
}

// ---------------- Productos críticos (marcados a mano) ----------------
async function manejarCriticos(req, res, sesion) {
  try {
    const sql = await getSql();
    await asegurarTablaProductosCriticos(sql);

    if (req.method === 'GET') {
      const { rows } = await sql`SELECT code, nombre, agregado_por, created_at FROM productos_criticos ORDER BY created_at ASC;`;
      return res.status(200).json({ productos: rows });
    }

    if (req.method === 'POST') {
      const { code, nombre } = req.body || {};
      if (!code) return res.status(400).json({ error: 'Falta el SKU (code)' });
      const codeNorm = code.trim().toUpperCase();
      const { rows } = await sql`
        INSERT INTO productos_criticos (code, nombre, agregado_por)
        VALUES (${codeNorm}, ${nombre || codeNorm}, ${sesion.nombre || sesion.email})
        ON CONFLICT (code) DO UPDATE SET nombre = EXCLUDED.nombre
        RETURNING code, nombre, agregado_por, created_at;
      `;
      return res.status(200).json({ producto: rows[0] });
    }

    if (req.method === 'DELETE') {
      const { code } = req.query;
      if (!code) return res.status(400).json({ error: 'Falta el SKU (code)' });
      await sql`DELETE FROM productos_criticos WHERE code = ${code.trim().toUpperCase()};`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en productos críticos', detail: String(err) });
  }
}

// ---------------- Reportes de error / objeciones ----------------
async function manejarReportes(req, res, sesion) {
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
      const { descripcion, pagina, tipo, skuCode, contexto } = req.body || {};
      if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'Describe el error u objeción, por favor.' });
      const tipoFinal = tipo === 'objecion' ? 'objecion' : 'error';

      const { rows } = await sql`
        INSERT INTO reportes_error (usuario_email, usuario_nombre, descripcion, pagina, tipo, sku_code, contexto)
        VALUES (${sesion.email}, ${sesion.nombre || sesion.email}, ${descripcion.trim()}, ${pagina || null}, ${tipoFinal}, ${skuCode || null}, ${contexto ? JSON.stringify(contexto) : null})
        RETURNING *;
      `;
      const reporte = rows[0];

      const esObjecion = tipoFinal === 'objecion';
      const correoResultado = await enviarCorreo({
        para: CORREO_ALERTA,
        asunto: esObjecion
          ? `Nueva objeción a un resultado — ${sesion.nombre || sesion.email}${skuCode ? ' — SKU ' + skuCode : ''}`
          : `Nuevo reporte de error — ${sesion.nombre || sesion.email}`,
        html: `
          <p>${esObjecion ? 'Se objetó un resultado' : 'Se reportó un error'} en el panel IndexStore.</p>
          <p><b>Usuario:</b> ${sesion.nombre || ''} (${sesion.email})<br>
          <b>Página:</b> ${pagina || 'No especificada'}<br>
          ${skuCode ? `<b>SKU:</b> ${skuCode}<br>` : ''}
          <b>Fecha:</b> ${new Date(reporte.created_at).toLocaleString('es-CL')}</p>
          <p><b>Descripción:</b><br>${(descripcion || '').replace(/\n/g, '<br>')}</p>
          ${contexto ? `<p><b>Datos que estaba viendo:</b><br><code>${JSON.stringify(contexto)}</code></p>` : ''}
        `,
        texto: `${esObjecion ? 'Nueva objeción' : 'Nuevo reporte de error'}.\nUsuario: ${sesion.nombre || ''} (${sesion.email})\nPágina: ${pagina || 'No especificada'}\n${skuCode ? `SKU: ${skuCode}\n` : ''}Descripción: ${descripcion}${contexto ? `\nDatos: ${JSON.stringify(contexto)}` : ''}`,
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

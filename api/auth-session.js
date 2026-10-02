// /api/auth-session.js
// Fusiona lo que antes eran dos funciones separadas (auth-me.js y
// auth-logout.js) en una sola -> Vercel Hobby tiene un tope de 12 funciones
// serverless por deployment, y con todos los endpoints que fuimos armando
// hoy se pasó ese límite.
//
// GET    -> devuelve quién está conectado (antes /api/auth-me)
// DELETE -> cierra la sesión (antes /api/auth-logout)

import { usuarioDesdeRequest, cookieSesion } from '../lib/auth-node.js';
import { getSql } from '../lib/db.js';
import { paginasEfectivas } from '../lib/paginas-perfil.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const sesion = usuarioDesdeRequest(req);
    if (!sesion) return res.status(401).json({ error: 'No hay sesión activa' });

    // Mismo motivo que en middleware.ts: no confiar en la foto de "paginas"
    // guardada en el token al momento del login -- se vuelve a mirar el
    // perfil ACTUAL en la base de datos, para que el menú de navegación
    // (restriccion-usuario.js -> aplicarRestriccionPaginas) oculte/muestre
    // los links que corresponden AHORA, no los de cuando esta persona inició
    // sesión. sesion.paginas queda de respaldo si la consulta falla.
    let paginas = sesion.paginas ?? null;
    if (sesion.rol !== 'admin') {
      try {
        const sql = await getSql();
        const { rows } = await sql`
          SELECT p.paginas FROM usuarios u LEFT JOIN perfiles p ON p.id = u.perfil_id
          WHERE u.id = ${sesion.uid};
        `;
        paginas = rows[0] && Array.isArray(rows[0].paginas) ? rows[0].paginas : null;
      } catch { /* se sigue con lo que trae el token */ }
    }

    return res.status(200).json({ email: sesion.email, nombre: sesion.nombre, rol: sesion.rol, paginas: paginasEfectivas(paginas) });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', cookieSesion(null, true));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

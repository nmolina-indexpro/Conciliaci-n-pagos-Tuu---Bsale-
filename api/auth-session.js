// /api/auth-session.js
// Fusiona lo que antes eran dos funciones separadas (auth-me.js y
// auth-logout.js) en una sola -> Vercel Hobby tiene un tope de 12 funciones
// serverless por deployment, y con todos los endpoints que fuimos armando
// hoy se pasó ese límite.
//
// GET    -> devuelve quién está conectado (antes /api/auth-me)
// DELETE -> cierra la sesión (antes /api/auth-logout)

import { usuarioDesdeRequest, cookieSesion } from '../lib/auth-node.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const sesion = usuarioDesdeRequest(req);
    if (!sesion) return res.status(401).json({ error: 'No hay sesión activa' });
    return res.status(200).json({ email: sesion.email, nombre: sesion.nombre, rol: sesion.rol });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', cookieSesion(null, true));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

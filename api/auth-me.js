// /api/auth-me.js
import { usuarioDesdeRequest } from '../lib/auth-node.js';

export default async function handler(req, res) {
  const sesion = usuarioDesdeRequest(req);
  if (!sesion) return res.status(401).json({ error: 'No hay sesión activa' });
  return res.status(200).json({ email: sesion.email, nombre: sesion.nombre, rol: sesion.rol });
}

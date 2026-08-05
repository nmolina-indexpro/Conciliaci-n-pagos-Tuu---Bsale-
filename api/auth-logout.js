// /api/auth-logout.js
import { cookieSesion } from '../lib/auth-node.js';

export default async function handler(req, res) {
  res.setHeader('Set-Cookie', cookieSesion(null, true));
  return res.status(200).json({ ok: true });
}

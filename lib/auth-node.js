// /lib/auth-node.js
// Funciones de autenticación para usar dentro de las funciones serverless
// (runtime Node.js normal, NO el middleware que corre en Edge — ese tiene su
// propia copia liviana basada en Web Crypto, ver middleware.js).
//
// - Contraseñas: scrypt (nativo de Node, no requiere ninguna librería extra).
// - Sesión: un token firmado con HMAC-SHA256 (JWT "casero", sin dependencias),
//   guardado en una cookie httpOnly. Requiere la variable de entorno
//   AUTH_SECRET (un string largo y random) configurada en Vercel.

import crypto from 'crypto';

const DIAS_SESION = 7;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verificarPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const hashVerif = crypto.scryptSync(password, salt, 64).toString('hex');
  // Comparación en tiempo constante, para no filtrar info por timing.
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashVerif, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function firmarSesion(payload) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET no está configurada en el servidor');
  const cuerpo = { ...payload, exp: Date.now() + DIAS_SESION * 24 * 60 * 60 * 1000 };
  const data = Buffer.from(JSON.stringify(cuerpo)).toString('base64url');
  const firma = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${firma}`;
}

export function verificarSesion(token) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || !token) return null;
  try {
    const [data, firma] = token.split('.');
    if (!data || !firma) return null;
    const esperada = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const a = Buffer.from(firma);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function leerCookieSesion(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('session='));
  return match ? match.slice('session='.length) : null;
}

export function usuarioDesdeRequest(req) {
  const token = leerCookieSesion(req);
  return token ? verificarSesion(token) : null;
}

export function cookieSesion(token, borrar = false) {
  if (borrar) {
    return `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  }
  const maxAge = DIAS_SESION * 24 * 60 * 60;
  return `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

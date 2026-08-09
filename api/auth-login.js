// /api/auth-login.js
import { getSql, asegurarTablaUsuarios } from '../lib/db.js';
import { verificarPassword, firmarSesion, cookieSesion } from '../lib/auth-node.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Falta email o contraseña' });

  try {
    const sql = await getSql();
    await asegurarTablaUsuarios(sql);

    const { rows } = await sql`SELECT * FROM usuarios WHERE email = ${email.toLowerCase().trim()} LIMIT 1;`;
    const usuario = rows[0];

    if (!usuario || !usuario.activo || !verificarPassword(password, usuario.password_hash)) {
      // Mensaje genérico a propósito: no revelamos si el email existe, si
      // está desactivado, o si ya expiró — todo cae en el mismo 401.
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    let expiraEn = usuario.expira_en ? new Date(usuario.expira_en) : null;

    // Primera activación de una cuenta temporal: si tiene expira_minutos
    // pendiente y todavía nunca se activó (expira_en sigue en NULL), el
    // reloj arranca recién ahora, en este primer login exitoso.
    if (!expiraEn && usuario.expira_minutos) {
      expiraEn = new Date(Date.now() + usuario.expira_minutos * 60 * 1000);
      await sql`UPDATE usuarios SET expira_en = ${expiraEn} WHERE id = ${usuario.id};`;
    }

    const yaExpiro = expiraEn && expiraEn.getTime() <= Date.now();
    if (yaExpiro) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    // Registro de último ingreso, se muestra en el mantenedor de usuarios.
    // No bloquea el login si por algún motivo falla.
    try {
      await sql`UPDATE usuarios SET ultimo_login = now() WHERE id = ${usuario.id};`;
    } catch (err) { /* no crítico */ }

    // Si la cuenta tiene expiración, la cookie de sesión hereda ese
    // vencimiento (ver firmarSesion en lib/auth-node.js) en vez de los 7
    // días normales.
    const token = firmarSesion(
      { uid: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol },
      expiraEn ? expiraEn.getTime() : undefined
    );
    res.setHeader('Set-Cookie', cookieSesion(token));
    return res.status(200).json({ ok: true, nombre: usuario.nombre, rol: usuario.rol });
  } catch (err) {
    return res.status(500).json({ error: 'Error al iniciar sesión', detail: String(err) });
  }
}

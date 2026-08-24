// /api/auth-login.js
import { getSql, asegurarTablaUsuarios, asegurarTablaPerfiles, asegurarTablaIntentosLogin } from '../lib/db.js';
import { verificarPassword, firmarSesion, cookieSesion } from '../lib/auth-node.js';

// Protección contra fuerza bruta / credential stuffing: 5 intentos fallidos
// seguidos (dentro de VENTANA_MIN) bloquean ESE email por
// BLOQUEO_MIN — corto y acotado, no permanente (ver comentario en
// asegurarTablaIntentosLogin). Por email, no por IP, porque en Vercel no
// hay una IP de cliente 100% confiable sin config adicional, y lo que
// importa acá es no dejar que alguien pruebe miles de contraseñas contra
// UNA cuenta puntual.
const INTENTOS_MAX = 5;
const VENTANA_MIN = 15;
const BLOQUEO_MIN = 5;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Falta email o contraseña' });
  const emailNorm = email.toLowerCase().trim();

  try {
    const sql = await getSql();
    await asegurarTablaPerfiles(sql);
    await asegurarTablaUsuarios(sql);
    await asegurarTablaIntentosLogin(sql);

    const { rows: intentoRows } = await sql`SELECT * FROM intentos_login WHERE email = ${emailNorm};`;
    const intentoActual = intentoRows[0];
    if (intentoActual?.bloqueado_hasta && new Date(intentoActual.bloqueado_hasta).getTime() > Date.now()) {
      return res.status(429).json({ error: `Demasiados intentos fallidos. Espera unos minutos antes de volver a intentar.` });
    }

    const { rows } = await sql`SELECT * FROM usuarios WHERE email = ${emailNorm} LIMIT 1;`;
    const usuario = rows[0];

    if (!usuario || !usuario.activo || !verificarPassword(password, usuario.password_hash)) {
      // Ventana deslizante: si el último intento fallido fue hace más de
      // VENTANA_MIN, se vuelve a partir de 1 en vez de seguir acumulando
      // intentos viejos que ya no reflejan un ataque en curso.
      const dentroDeVentana = intentoActual?.ultimo_intento &&
        (Date.now() - new Date(intentoActual.ultimo_intento).getTime()) < VENTANA_MIN * 60 * 1000;
      const intentosNuevos = (dentroDeVentana ? (intentoActual.intentos || 0) : 0) + 1;
      const bloqueadoHasta = intentosNuevos >= INTENTOS_MAX ? new Date(Date.now() + BLOQUEO_MIN * 60 * 1000) : null;
      await sql`
        INSERT INTO intentos_login (email, intentos, ultimo_intento, bloqueado_hasta)
        VALUES (${emailNorm}, ${intentosNuevos}, now(), ${bloqueadoHasta})
        ON CONFLICT (email) DO UPDATE SET intentos = EXCLUDED.intentos, ultimo_intento = EXCLUDED.ultimo_intento, bloqueado_hasta = EXCLUDED.bloqueado_hasta;
      `;
      // Mensaje genérico a propósito: no revelamos si el email existe, si
      // está desactivado, o si ya expiró — todo cae en el mismo 401.
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    // Login exitoso -> se limpia cualquier historial de intentos fallidos
    // de este email.
    if (intentoActual) await sql`DELETE FROM intentos_login WHERE email = ${emailNorm};`;

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

    // Perfil de acceso a páginas: se resuelve UNA VEZ acá y se guarda
    // directo en el token de sesión (ver middleware.ts), para que
    // controlar qué páginas puede ver el usuario no requiera consultar la
    // base de datos en cada request de página. Un admin nunca queda
    // restringido por perfil, aunque tenga uno asignado -- necesita poder
    // llegar a cualquier parte del sistema, incluyendo el mantenedor de
    // usuarios para deshacer un error de configuración.
    let paginas = null;
    if (usuario.rol !== 'admin' && usuario.perfil_id) {
      const { rows: perfilRows } = await sql`SELECT paginas FROM perfiles WHERE id = ${usuario.perfil_id};`;
      if (perfilRows[0]) paginas = perfilRows[0].paginas;
    }

    // Si la cuenta tiene expiración, la cookie de sesión hereda ese
    // vencimiento (ver firmarSesion en lib/auth-node.js) en vez de los 7
    // días normales.
    const token = firmarSesion(
      { uid: usuario.id, email: usuario.email, nombre: usuario.nombre, rol: usuario.rol, paginas },
      expiraEn ? expiraEn.getTime() : undefined
    );
    res.setHeader('Set-Cookie', cookieSesion(token));
    // Si el perfil no tiene ni una página permitida (perfil mal armado o
    // vacío), reportar-error.html queda siempre disponible (ver
    // middleware.ts) -> mejor eso que un usuario sin ningún lugar donde
    // caer, o un loop de redirecciones.
    const landing = (Array.isArray(paginas) && paginas.length > 0) ? `/${paginas[0]}` : (paginas ? '/reportar-error.html' : '/index.html');
    return res.status(200).json({ ok: true, nombre: usuario.nombre, rol: usuario.rol, paginas, landing });
  } catch (err) {
    return res.status(500).json({ error: 'Error al iniciar sesión', detail: String(err) });
  }
}

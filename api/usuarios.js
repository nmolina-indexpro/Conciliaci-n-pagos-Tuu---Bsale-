// /api/usuarios.js
// CRUD del mantenedor de usuarios. Solo accesible para usuarios con rol
// 'admin' — cualquier otro caso devuelve 403.

import crypto from 'crypto';
import { getSql, asegurarTablaUsuarios, asegurarTablaPerfiles, asegurarTablaNotificaciones } from '../lib/db.js';
import { hashPassword, usuarioDesdeRequest } from '../lib/auth-node.js';
import { enviarCorreo, consultarEventosBrevo, resumirEntregaBrevo } from '../lib/mailer.js';
import { TIPOS_NOTIFICACION, CATEGORIAS_NOTIFICACION, asegurarConfigYSuscriptoresPorDefecto } from '../lib/notificaciones.js';
import { TIPO_RESUMEN_CAMBIOS, fechaHoyChile, enviarResumenCambios, sanitizarHtmlResumen, armarCorreoResumen, armarContenidoCambios } from '../lib/resumen-cambios.js';
import { asegurarCambiosRegistro, validarCambio } from '../lib/cambios-registro.js';
import { paginasEfectivas, paginasParaGuardar } from '../lib/paginas-perfil.js';

// Páginas que se pueden marcar en un perfil de acceso (ver
// asegurarTablaPerfiles en lib/db.js). No incluye usuarios.html (ya es
// exclusivo de rol admin, independiente del perfil) ni login.html/
// reportar-error.html (siempre accesibles, ver middleware.ts).
const PAGINAS_DISPONIBLES = [
  'home.html', 'index.html', 'conciliacion.html', 'contabilidad.html', 'compras.html',
  'alertas-stock.html', 'productos-en-transito.html', 'oportunidades-comerciales.html', 'cotizaciones-clientes.html', 'compra-agil.html', 'metas-de-venta.html', 'llamadas.html', 'buscador-ia.html', 'descuentos-web.html', 'cotizaciones-web.html', 'sitio-web.html',
  'eficiencia-tickets.html', 'analisis.html', 'servicio-tecnico.html', 'identificacion-modelos.html', 'productos-nuevos.html', 'clientes-whatsapp.html', 'guia-uso.html',
  'indexscale.html', 'productos-estancados.html', 'google-analytics.html', 'ejecutivos-whatsapp.html', 'google-ads.html', 'comparativo-ventas.html', 'insumos-servicio-tecnico.html', 'modelos-compatibles.html',
];
// REGLA: toda página nueva de la app (menos login, recuperar/reset de contraseña, reportar-error, Usuarios, Mercado Libre y Actualizaciones ERP, que son
// solo para administradores o públicas) debe agregarse aquí Y a GRUPOS_PAGINAS en public/usuarios.html; si no, no se le puede dar acceso a otros usuarios.

// Modo diagnóstico puntual (?debugBrevo=email@dominio.cl): consulta
// directo la API de Brevo (con la misma BREVO_API_KEY que ya usa
// enviarCorreo, ver lib/mailer.js) por el historial de eventos de ese
// destinatario -- delivered, bounce, blocked, spam, etc. Existe porque
// "el correo se envió" (enviarCorreo devolvió enviado:true, o sea Brevo
// aceptó el envío de nuestro lado) no es lo mismo que "el correo llegó" --
// esto deja ver el estado real sin depender de poder entrar al panel web
// de Brevo (caso real: no se sabía con qué cuenta se había creado esa
// API key).
async function manejarDebugBrevo(req, res) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'BREVO_API_KEY no está configurada en el servidor' });
  const email = String(req.query.debugBrevo || '').trim();
  if (!email) return res.status(400).json({ error: 'Falta el email a revisar' });
  try {
    const url = `https://api.brevo.com/v3/smtp/statistics/events?email=${encodeURIComponent(email)}&limit=20&offset=0&sort=desc`;
    const r = await fetch(url, { headers: { 'api-key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const body = await r.json().catch(() => ({}));
    return res.status(200).json({ email, urlUsada: url, status: r.status, respuesta: body });
  } catch (err) {
    return res.status(200).json({ error: 'Error consultando la API de Brevo', detail: String(err) });
  }
}

export default async function handler(req, res) {
  const sesion = usuarioDesdeRequest(req);
  if (!sesion) return res.status(401).json({ error: 'No hay sesión activa' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede gestionar usuarios' });

  if (req.method === 'GET' && req.query.debugBrevo) return manejarDebugBrevo(req, res);

  try {
    const sql = await getSql();
    await asegurarTablaPerfiles(sql);
    await asegurarTablaUsuarios(sql);
    await asegurarTablaNotificaciones(sql);

    if (req.query.recurso === 'perfiles') return manejarPerfiles(req, res, sql);
    if (req.query.recurso === 'notificaciones') return manejarNotificaciones(req, res, sql);
    if (req.query.recurso === 'cambios') return manejarCambios(req, res, sql);

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
      const { id, nombre, rol, activo, password, expiraMinutos, quitarExpiracion, perfilId, quitarPerfil, reenviarNotificacion } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Falta el id del usuario' });

      // No permitir que un admin se quite a sí mismo el rol de admin ni se
      // desactive a sí mismo -> evita quedar todos bloqueados sin querer.
      if (Number(id) === sesion.uid && (rol === 'usuario' || activo === false)) {
        return res.status(400).json({ error: 'No puedes quitarte tu propio acceso de administrador ni desactivar tu propia cuenta.' });
      }

      // Reenviar notificación de acceso -- pedido para cuentas que nunca
      // hicieron su primer login (ver "Pendiente: Xh desde 1er login" en
      // la tabla) y quizás perdieron el correo original, o cualquier
      // usuario que necesite recuperar acceso. La contraseña original NO
      // se guarda en ningún lado más que su hash (ver comentario en la
      // creación, abajo), así que no se puede "reenviar la misma" -- se
      // genera una nueva, reemplaza la anterior, y se manda por correo con
      // el mismo formato del correo de bienvenida. Acción aparte, no pasa
      // por el UPDATE genérico de más abajo.
      if (reenviarNotificacion) {
        const { rows: existente } = await sql`SELECT email, nombre, expira_minutos, expira_en FROM usuarios WHERE id = ${id};`;
        if (!existente.length) return res.status(404).json({ error: 'Usuario no encontrado' });
        const usuario = existente[0];
        const nuevaPassword = crypto.randomBytes(9).toString('base64url');
        await sql`UPDATE usuarios SET password_hash = ${hashPassword(nuevaPassword)} WHERE id = ${id};`;

        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const loginUrl = host ? `https://${host}/login.html` : null;
        // Pendiente (expira_minutos con valor, expira_en todavía NULL) =
        // el reloj de la cuenta temporal no ha arrancado -- mismo aviso
        // que en la creación. Si expira_en ya tiene valor, la cuenta ya
        // arrancó su cuenta regresiva -- no repetir el aviso de "el reloj
        // corre desde tu primer login" porque ya corrió.
        const notaDuracion = (usuario.expira_minutos && !usuario.expira_en)
          ? `<p>Esta es una cuenta <b>temporal</b>: el acceso dura <b>${usuario.expira_minutos} minutos desde el primer inicio de sesión</b>, no desde este correo.</p>`
          : '';
        const correoResultado = await enviarCorreo({
          para: usuario.email,
          asunto: 'Tus datos de acceso — Panel IndexStore',
          html: `
            <p>Hola ${usuario.nombre || ''},</p>
            <p>Te reenviamos tus datos de acceso al panel interno de IndexStore (se generó una contraseña nueva; la anterior dejó de funcionar):</p>
            <p><b>Usuario:</b> ${usuario.email}<br><b>Contraseña:</b> ${nuevaPassword}</p>
            ${notaDuracion}
            ${loginUrl ? `<p>Puedes ingresar acá: <a href="${loginUrl}">${loginUrl}</a></p>` : ''}
            <p>Por seguridad, evita compartir esta contraseña con otras personas.</p>
          `,
          texto: `Hola ${usuario.nombre || ''}, te reenviamos tus datos de acceso al panel interno de IndexStore (se generó una contraseña nueva; la anterior dejó de funcionar).\nUsuario: ${usuario.email}\nContraseña: ${nuevaPassword}\n${(usuario.expira_minutos && !usuario.expira_en) ? `Cuenta temporal: dura ${usuario.expira_minutos} minutos desde el primer inicio de sesión.\n` : ''}${loginUrl ? `Ingresa acá: ${loginUrl}\n` : ''}`,
        });
        // nuevaPassword va en la respuesta como respaldo -- si el correo
        // no se pudo mandar, es la única forma de que el admin la tenga
        // para avisarle al usuario por otro medio (mismo criterio que la
        // creación de cuenta).
        // Brevo "aceptó" el correo no significa que llegó: se espera unos 7 segundos (Brevo tarda en registrar los eventos) y se le pregunta a Brevo qué pasó con
        // ESTE envío (entregado, rebotado, bloqueado, diferido...), para que el admin lo vea al tiro y no tenga que
        // adivinar. Mejor esfuerzo: si la consulta falla, igual se responde el envío.
        let entrega = null;
        if (correoResultado.enviado && correoResultado.messageId) {
          try {
            await new Promise(r => setTimeout(r, 7000));
            entrega = resumirEntregaBrevo(await consultarEventosBrevo(usuario.email, correoResultado.messageId));
          } catch (err) { entrega = { estado: 'desconocida', texto: 'No se pudo consultar a Brevo el estado de la entrega (' + String(err.message || err) + ').' }; }
        }
        return res.status(200).json({ ok: true, correo: correoResultado, nuevaPassword, entrega });
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
    return res.status(200).json({ perfiles: rows.map(p => ({ ...p, paginas: paginasEfectivas(p.paginas) })), paginasDisponibles: PAGINAS_DISPONIBLES });
  }

  if (req.method === 'POST') {
    const { nombre, paginas } = req.body || {};
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre del perfil' });
    const paginasValidas = (Array.isArray(paginas) ? paginas : []).filter(p => PAGINAS_DISPONIBLES.includes(p));
    try {
      const { rows } = await sql`
        INSERT INTO perfiles (nombre, paginas) VALUES (${nombre.trim()}, ${JSON.stringify(paginasParaGuardar(paginasValidas))})
        RETURNING id, nombre, paginas, created_at;
      `;
      return res.status(200).json({ perfil: { ...rows[0], paginas: paginasEfectivas(rows[0].paginas) } });
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
        paginas = COALESCE(${paginasValidas ? JSON.stringify(paginasParaGuardar(paginasValidas)) : null}, paginas)
      WHERE id = ${id};
    `;
    const { rows } = await sql`SELECT id, nombre, paginas, created_at FROM perfiles WHERE id = ${id};`;
    return res.status(200).json({ perfil: rows[0] ? { ...rows[0], paginas: paginasEfectivas(rows[0].paginas) } : rows[0] });
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

// ---------------- Historial de cambios (?recurso=cambios) ----------------
// Solo administradores (ya se validó arriba). Ver lib/cambios-registro.js.
async function manejarCambios(req, res, sql) {
  await asegurarCambiosRegistro(sql);
  const quien = usuarioDesdeRequest(req);
  const autor = (quien && (quien.nombre || quien.email)) || 'admin';

  // Guarda (o quita) la imagen de vista previa de un cambio. La imagen sale en el correo desde una dirección pública con un código
  // aleatorio (?recurso=cambio-imagen&t=...), porque el correo no puede cargar imágenes que estén detrás del inicio de sesión.
  async function guardarImagen(id, v) {
    if (v.quitarImagen) {
      await sql`UPDATE cambios_registro SET imagen_b64 = NULL, imagen_tipo = NULL, imagen_token = NULL WHERE id = ${id};`;
    } else if (v.imagen) {
      const token = crypto.randomBytes(16).toString('hex');
      await sql`UPDATE cambios_registro SET imagen_b64 = ${v.imagen.b64}, imagen_tipo = ${v.imagen.tipo}, imagen_token = ${token} WHERE id = ${id};`;
    }
  }

  if (req.method === 'GET') {
    const { rows } = await sql`
      SELECT id, fecha::text AS fecha, area, descripcion, estado, sitio, url, destacado, imagen_token, creado_por, actualizado_en
      FROM cambios_registro WHERE aprobacion = 'aprobado' ORDER BY fecha DESC, id DESC;`;
    return res.status(200).json({ cambios: rows });
  }
  if (req.method === 'POST') {
    const v = validarCambio(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const { rows } = await sql`
      INSERT INTO cambios_registro (fecha, area, descripcion, estado, sitio, url, destacado, creado_por)
      VALUES (${v.fecha}::date, ${v.area}, ${v.descripcion}, ${v.estado}, ${v.sitio}, ${v.url}, ${v.destacado}, ${autor}) RETURNING id;`;
    await guardarImagen(rows[0].id, v);
    return res.status(200).json({ ok: true, id: rows[0].id });
  }
  if (req.method === 'PUT') {
    const id = Number((req.body || {}).id);
    if (!id) return res.status(400).json({ error: 'Falta el id del cambio' });
    const v = validarCambio(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const { rows } = await sql`
      UPDATE cambios_registro SET fecha = ${v.fecha}::date, area = ${v.area}, descripcion = ${v.descripcion}, estado = ${v.estado}, sitio = ${v.sitio}, url = ${v.url}, destacado = ${v.destacado}, actualizado_en = now()
      WHERE id = ${id} RETURNING id;`;
    if (!rows[0]) return res.status(404).json({ error: 'No existe ese cambio' });
    await guardarImagen(id, v);
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ error: 'Falta el id del cambio' });
    await sql`DELETE FROM cambios_registro WHERE id = ${id};`;
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ---------------- Notificaciones por correo (?recurso=notificaciones) ----------------
// Ya se validó arriba que sesion.rol === 'admin' antes de llegar acá. Un
// solo lugar para administrar quién recibe CADA notificación por correo
// del sistema y con qué frecuencia se manda -- ver lib/notificaciones.js
// para el registro de tipos y el porqué "frecuencia" no controla la HORA
// exacta de envío (eso lo sigue fijando vercel.json).
async function manejarNotificaciones(req, res, sql) {
  if (req.method === 'GET') {
    // Se siembra cada tipo antes de listarlo (config por defecto +
    // destinatarios de antes, ver asegurarConfigYSuscriptoresPorDefecto) --
    // así la página siempre muestra algo coherente, incluso para un tipo
    // que nadie ha abierto nunca en esta pantalla.
    for (const tipo of Object.keys(TIPOS_NOTIFICACION)) {
      await asegurarConfigYSuscriptoresPorDefecto(sql, tipo);
    }
    // Vista previa de UN correo (el último que se mandó de esa notificación): asunto y HTML guardados al enviarlo.
    if (req.query.vista) {
      const tipoVista = String(req.query.vista);
      if (!TIPOS_NOTIFICACION[tipoVista]) return res.status(400).json({ error: 'Tipo de notificación inválido' });
      const { rows: vr } = await sql`SELECT ultimo_asunto, ultimo_html, ultimo_envio_en FROM notificaciones_config WHERE tipo = ${tipoVista};`;
      if (!vr[0] || !vr[0].ultimo_html) return res.status(200).json({ tieneVista: false });
      return res.status(200).json({ tieneVista: true, asunto: vr[0].ultimo_asunto || '', html: vr[0].ultimo_html, enviadoEn: vr[0].ultimo_envio_en });
    }
    const { rows: configRows } = await sql`SELECT tipo, frecuencia, dia_semana, activa, ultimo_envio_en, ultimo_asunto, (ultimo_html IS NOT NULL) AS tiene_vista FROM notificaciones_config;`;
    const { rows: suscriptoresRows } = await sql`
      SELECT ns.tipo, u.id, u.nombre, u.email, u.activo
      FROM notificaciones_suscriptores ns JOIN usuarios u ON u.id = ns.usuario_id
      ORDER BY u.nombre ASC;
    `;
    const { rows: usuariosRows } = await sql`SELECT id, nombre, email FROM usuarios WHERE activo = true ORDER BY nombre ASC;`;
    const configPorTipo = Object.fromEntries(configRows.map(c => [c.tipo, c]));
    const tipos = Object.entries(TIPOS_NOTIFICACION).map(([tipo, info]) => {
      const c = configPorTipo[tipo] || {};
      return {
        tipo, nombre: info.nombre, categoria: info.categoria || 'otras',
        activa: c.activa !== false,
        frecuencia: c.frecuencia || 'diaria',
        diaSemana: c.dia_semana ?? null,
        ultimoEnvioEn: c.ultimo_envio_en || null,
        ultimoAsunto: c.ultimo_asunto || null, tieneVista: Boolean(c.tiene_vista),
        suscriptores: suscriptoresRows.filter(s => s.tipo === tipo).map(s => ({ id: s.id, nombre: s.nombre, email: s.email, activo: s.activo })),
      };
    });
    const hoy = fechaHoyChile();
    const { rows: resumenRows } = await sql`SELECT fecha::text AS fecha, contenido, enviado_en, actualizado_por FROM resumen_cambios WHERE fecha = ${hoy}::date;`;
    const resumenHoy = { fecha: hoy, contenido: resumenRows[0]?.contenido || '', enviadoEn: resumenRows[0]?.enviado_en || null, actualizadoPor: resumenRows[0]?.actualizado_por || null };
    return res.status(200).json({ tipos, categorias: CATEGORIAS_NOTIFICACION, usuariosDisponibles: usuariosRows, resumenHoy });
  }

  // Texto del resumen diario de cambios: guardar el de hoy / mandarlo ahora a los suscriptores.
  if (req.method === 'POST' && (req.body || {}).accion) {
    const { accion, contenido } = req.body;
    const hoy = fechaHoyChile();
    if (accion === 'guardar-resumen') {
      const crudo = String(contenido || '').trim();
      if (crudo.length > 200000) return res.status(400).json({ error: 'El resumen es demasiado largo' });
      // Si trae formato (HTML del editor) se guarda limpio; si es texto plano antiguo, se deja tal cual.
      const texto = /<\/?[a-z][^>]*>/i.test(crudo) ? sanitizarHtmlResumen(crudo) : crudo;
      if (!texto.replace(/<[^>]*>/g, '').trim()) return res.status(400).json({ error: 'El resumen no puede estar vacío' });
      if (texto.length > 20000) return res.status(400).json({ error: 'El resumen es demasiado largo (máximo 20.000 caracteres)' });
      await asegurarConfigYSuscriptoresPorDefecto(sql, TIPO_RESUMEN_CAMBIOS);
      const quien = usuarioDesdeRequest(req);
      const autor = (quien && (quien.nombre || quien.email)) || 'admin';
      // Si el texto cambia después de haberse enviado, vuelve a quedar pendiente para el cron de esa tarde.
      await sql`
        INSERT INTO resumen_cambios (fecha, contenido, actualizado_por) VALUES (${hoy}::date, ${texto}, ${autor})
        ON CONFLICT (fecha) DO UPDATE SET contenido = EXCLUDED.contenido, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now(),
          enviado_en = CASE WHEN resumen_cambios.contenido = EXCLUDED.contenido THEN resumen_cambios.enviado_en ELSE NULL END;`;
      return res.status(200).json({ ok: true });
    }
    // Arma el resumen con los cambios NUEVOS (todavía no enviados) de un período -- periodo: 'hoy' | 'ayer' | '24h' (ayer y hoy, por defecto) | 'semana' (últimos 7 días);
    // incluirEnviados = true agrega también los que ya salieron en un resumen. Lo guarda como resumen de hoy y devuelve la vista previa del correo.
    if (accion === 'generar-resumen') {
      await asegurarCambiosRegistro(sql);
      const dia = n => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
      const PERIODOS = {
        hoy: [0, 0, 'Cambios de hoy', 'de hoy'], ayer: [1, 1, 'Cambios de ayer', 'de ayer'],
        '24h': [1, 0, 'Cambios de las últimas 24 horas', 'de las últimas 24 horas'], semana: [6, 0, 'Cambios de los últimos 7 días', 'de los últimos 7 días'],
      };
      const p = PERIODOS[(req.body || {}).periodo] || PERIODOS['24h'];
      const incluirEnviados = (req.body || {}).incluirEnviados === true;
      const { rows: todas } = await sql`
        SELECT id, fecha::text AS fecha, area, descripcion, estado, sitio, url, destacado, imagen_token, enviado_en IS NOT NULL AS enviado
        FROM cambios_registro WHERE aprobacion = 'aprobado' AND fecha >= ${dia(p[0])}::date AND fecha <= ${dia(p[1])}::date ORDER BY fecha DESC, id DESC;`;
      const filas = incluirEnviados ? todas : todas.filter(r => !r.enviado);
      const yaEnviados = todas.length - filas.length;
      if (filas.length === 0) {
        // El resumen solo ve los cambios registrados y aprobados; los hechos en el sistema llegan como propuestas (Propuesta del día), que hay que aprobar.
        const { rows: pend } = await sql`
          SELECT COUNT(*) FILTER (WHERE aprobacion = 'propuesto')::int AS por_revisar, COUNT(DISTINCT fecha)::int AS dias_analizados
          FROM cambios_registro WHERE origen = 'propuesta' AND fecha >= ${dia(p[0])}::date AND fecha <= ${dia(p[1])}::date;`;
        const porRevisar = pend[0] ? pend[0].por_revisar : 0;
        const base = todas.length
          ? `No hay cambios nuevos ${p[3]}: los ${todas.length} que hay ya se enviaron. Marca "Incluir los ya enviados" si quieres verlos igual.`
          : `No hay cambios registrados ${p[3]}.`;
        const pista = porRevisar
          ? ` Hay ${porRevisar} ${porRevisar === 1 ? 'cambio propuesto' : 'cambios propuestos'} sin revisar en "Propuesta del día": apruébalos y vuelve a generar.`
          : ' Los cambios que se hacen en el sistema entran como propuestas: en "Propuesta del día" usa "Proponer los últimos 7 días", apruébalos y vuelve a generar.';
        return res.status(200).json({ ok: false, sugerirPropuesta: true, error: base + pista });
      }
      const texto = sanitizarHtmlResumen(armarContenidoCambios(filas, { titulo: p[2] }));
      const ids = filas.map(r => r.id);
      await asegurarConfigYSuscriptoresPorDefecto(sql, TIPO_RESUMEN_CAMBIOS);
      const quien = usuarioDesdeRequest(req);
      const autor = (quien && (quien.nombre || quien.email)) || 'admin';
      await sql`
        INSERT INTO resumen_cambios (fecha, contenido, actualizado_por, cambios_ids) VALUES (${hoy}::date, ${texto}, ${autor}, ${ids}::int[])
        ON CONFLICT (fecha) DO UPDATE SET contenido = EXCLUDED.contenido, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now(), cambios_ids = EXCLUDED.cambios_ids,
          enviado_en = CASE WHEN resumen_cambios.contenido = EXCLUDED.contenido THEN resumen_cambios.enviado_en ELSE NULL END;`;
      const { asunto, html } = armarCorreoResumen(hoy, texto);
      return res.status(200).json({ ok: true, cantidad: filas.length, yaEnviados, periodo: p[3], contenido: texto, asunto, html });
    }
    if (accion === 'enviar-resumen-ahora') {
      const r = await enviarResumenCambios(sql, { forzar: true });
      return res.status(200).json({ ok: true, ...r });
    }
    return res.status(400).json({ error: 'Acción inválida' });
  }

  if (req.method === 'PUT') {
    const { tipo, activa, frecuencia, diaSemana, agregarUsuarioId, quitarUsuarioId } = req.body || {};
    if (!tipo || !TIPOS_NOTIFICACION[tipo]) return res.status(400).json({ error: 'Tipo de notificación inválido' });
    await asegurarConfigYSuscriptoresPorDefecto(sql, tipo);

    if (typeof activa === 'boolean') {
      await sql`UPDATE notificaciones_config SET activa = ${activa} WHERE tipo = ${tipo};`;
    }
    // dia_semana solo tiene sentido junto con frecuencia "semanal" -- al
    // pasar a "diaria" se limpia (NULL), para que un día viejo no quede
    // dando vueltas confundiendo si más adelante alguien vuelve a "semanal".
    if (frecuencia === 'diaria') {
      await sql`UPDATE notificaciones_config SET frecuencia = 'diaria', dia_semana = NULL WHERE tipo = ${tipo};`;
    } else if (frecuencia === 'semanal') {
      const dia = (typeof diaSemana === 'number' && diaSemana >= 0 && diaSemana <= 6) ? diaSemana : 0;
      await sql`UPDATE notificaciones_config SET frecuencia = 'semanal', dia_semana = ${dia} WHERE tipo = ${tipo};`;
    }

    if (agregarUsuarioId) {
      await sql`INSERT INTO notificaciones_suscriptores (tipo, usuario_id) VALUES (${tipo}, ${Number(agregarUsuarioId)}) ON CONFLICT DO NOTHING;`;
    }
    if (quitarUsuarioId) {
      await sql`DELETE FROM notificaciones_suscriptores WHERE tipo = ${tipo} AND usuario_id = ${Number(quitarUsuarioId)};`;
    }

    const { rows: configRows } = await sql`SELECT tipo, frecuencia, dia_semana, activa, ultimo_envio_en FROM notificaciones_config WHERE tipo = ${tipo};`;
    return res.status(200).json({ ok: true, config: configRows[0] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

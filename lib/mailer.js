// /lib/mailer.js
// Envío de correos vía SMTP (nodemailer) — pensado para una cuenta de Gmail
// con "contraseña de aplicación" (Gmail bloquea el login con la contraseña
// normal de la cuenta si no usas eso).
//
// Variables de entorno requeridas en Vercel (Settings → Environment Variables):
//   SMTP_HOST   ej: smtp.gmail.com
//   SMTP_PORT   ej: 465 (SSL directo) o 587 (STARTTLS)
//   SMTP_USER   la cuenta de Gmail que envía, ej: notificaciones@indexstore.cl
//   SMTP_PASS   la "contraseña de aplicación" de 16 caracteres de esa cuenta
//               (Cuenta de Google → Seguridad → Verificación en 2 pasos →
//               Contraseñas de aplicaciones — requiere 2FA activado)
//   SMTP_FROM   opcional, remitente a mostrar; si no está, se usa SMTP_USER
//
// Si estas variables no están configuradas, enviarCorreo() NO revienta:
// devuelve { enviado:false, motivo:'...' } para que quien la llama pueda
// seguir funcionando igual (ej: crear el usuario aunque el correo de
// bienvenida no se haya podido mandar).

export async function enviarCorreo({ para, asunto, html, texto }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return { enviado: false, motivo: 'SMTP no configurado en el servidor (faltan SMTP_HOST / SMTP_USER / SMTP_PASS en Vercel)' };
  }
  try {
    const nodemailer = await import('nodemailer');
    const puerto = Number(SMTP_PORT) || 465;
    const transporter = nodemailer.default.createTransport({
      host: SMTP_HOST,
      port: puerto,
      secure: puerto !== 587, // 465 = SSL directo; 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: para,
      subject: asunto,
      text: texto || undefined,
      html: html || undefined,
    });
    return { enviado: true };
  } catch (err) {
    return { enviado: false, motivo: String(err) };
  }
}

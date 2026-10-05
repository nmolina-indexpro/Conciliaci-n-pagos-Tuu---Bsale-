// /lib/mailer.js
// Envío de correos. Dos vías posibles:
//
//   1) API HTTP de Brevo (recomendada) — evita SMTP saliente, que en
//      funciones serverless de Vercel suele fallar con ETIMEDOUT (Vercel no
//      soporta bien conexiones SMTP directas; la API HTTP usa HTTPS/443, que
//      sí funciona siempre). Se activa poniendo BREVO_API_KEY.
//        BREVO_API_KEY, SMTP_FROM (remitente a mostrar, ej. soporteapp@indexstore.cl)
//
//   2) SMTP genérico vía nodemailer (fallback, o para Indexpro mientras no
//      se migre) — pensado para Gmail/Google Workspace con "contraseña de
//      aplicación", o cualquier otro proveedor SMTP.
//
// Hay DOS configuraciones independientes, con sus propias variables de
// entorno en Vercel (Settings → Environment Variables):
//
//   General (todo el sistema EXCEPTO Indexpro — reportes de error,
//   objeciones, alertas de conciliación, etc.):
//     BREVO_API_KEY (vía API), o SMTP_HOST/PORT/USER/PASS (vía SMTP)
//     SMTP_FROM (remitente a mostrar, usado por ambas vías)
//
//   Indexpro (solo el correo de presentación comercial NAS/soporte TI,
//   ver api/negocio.js -> manejarIndexproEnviarPresentacion):
//     SMTP_INDEXPRO_HOST, SMTP_INDEXPRO_PORT, SMTP_INDEXPRO_USER,
//     SMTP_INDEXPRO_PASS, SMTP_INDEXPRO_FROM (opcional)
//
// Se separaron a propósito (dos cuentas de remitente distintas: la general
// es de indexstore.cl, la de Indexpro es de indexpro.cl) -> NO reutilizar
// una sola configuración para ambas cosas.
//
// PORT: ej. 465 (SSL directo) o 587 (STARTTLS). USER: la cuenta que envía.
// PASS: la "contraseña de aplicación" de 16 caracteres de esa cuenta
// (Cuenta de Google → Seguridad → Verificación en 2 pasos → Contraseñas de
// aplicaciones — requiere 2FA activado). FROM: opcional, remitente a
// mostrar; si no está, se usa el USER correspondiente.
//
// Si las variables de una configuración no están puestas, esa función NO
// revienta: devuelve { enviado:false, motivo:'...' } para que quien la
// llama pueda seguir funcionando igual (ej: crear el usuario aunque el
// correo de bienvenida no se haya podido mandar).

async function enviarPorBrevoApi({ apiKey, from, para, asunto, html, texto }) {
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: from },
      to: [{ email: para }],
      subject: asunto,
      htmlContent: html || undefined,
      textContent: texto || undefined,
    }),
  });
  if (!resp.ok) {
    const detalle = await resp.text().catch(() => '');
    throw new Error(`Brevo API respondió ${resp.status}: ${detalle}`);
  }
  const cuerpo = await resp.json().catch(() => ({}));
  return { enviado: true, messageId: cuerpo.messageId || null };
}

async function enviarConConfig({ host, port, user, pass, from, faltanMsg }, { para, asunto, html, texto }) {
  if (!host || !user || !pass) {
    return { enviado: false, motivo: faltanMsg };
  }
  try {
    const nodemailer = await import('nodemailer');
    const puerto = Number(port) || 465;
    const transporter = nodemailer.default.createTransport({
      host,
      port: puerto,
      secure: puerto !== 587, // 465 = SSL directo; 587 = STARTTLS
      auth: { user, pass },
    });
    const info = await transporter.sendMail({
      from: from || user,
      to: para,
      subject: asunto,
      text: texto || undefined,
      html: html || undefined,
    });
    // Lo que respondió el servidor SMTP (ej. "250 OK id=..."): permite
    // diagnosticar un correo que se "envió bien" pero nunca llegó -- es la
    // única pista que existe del lado de la app, ya que enviar por SMTP no
    // deja copia en "Enviados" ni avisa de rebotes posteriores.
    return { enviado: true, servidor: { respuesta: info.response, aceptados: info.accepted, rechazados: info.rejected, desde: from || user, messageId: info.messageId } };
  } catch (err) {
    return { enviado: false, motivo: String(err) };
  }
}

export async function enviarCorreo(datos) {
  const { BREVO_API_KEY, SMTP_FROM, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (BREVO_API_KEY) {
    try {
      return await enviarPorBrevoApi({ apiKey: BREVO_API_KEY, from: SMTP_FROM || 'soporteapp@indexstore.cl', ...datos });
    } catch (err) {
      return { enviado: false, motivo: String(err) };
    }
  }
  return enviarConConfig(
    {
      host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS, from: SMTP_FROM,
      faltanMsg: 'Correo no configurado en el servidor (falta BREVO_API_KEY, o SMTP_HOST/SMTP_USER/SMTP_PASS en Vercel)',
    },
    datos
  );
}

// Config aparte para el correo de presentación comercial de Indexpro (NAS /
// soporte TI) -> se manda desde una cuenta de indexpro.cl, no desde la
// cuenta general de indexstore.cl.
export async function enviarCorreoIndexpro(datos) {
  const { SMTP_INDEXPRO_HOST, SMTP_INDEXPRO_PORT, SMTP_INDEXPRO_USER, SMTP_INDEXPRO_PASS, SMTP_INDEXPRO_FROM } = process.env;
  return enviarConConfig(
    {
      host: SMTP_INDEXPRO_HOST, port: SMTP_INDEXPRO_PORT, user: SMTP_INDEXPRO_USER, pass: SMTP_INDEXPRO_PASS, from: SMTP_INDEXPRO_FROM,
      faltanMsg: 'SMTP de Indexpro no configurado en el servidor (faltan SMTP_INDEXPRO_HOST / SMTP_INDEXPRO_USER / SMTP_INDEXPRO_PASS en Vercel)',
    },
    datos
  );
}

// Config aparte para el correo en frío de IndexScale (diseño web /
// optimización de e-commerce) -> se manda desde una cuenta de
// indexscale.cl, no desde la cuenta general ni desde la de Indexpro
// (son 3 marcas/ofertas distintas del mismo grupo, cada una con su propia
// reputación de envío -- mezclarlas arriesga la entregabilidad de todas si
// una recibe muchos rebotes/marcas de spam por ser correo en frío).
export async function enviarCorreoIndexscale(datos) {
  const { SMTP_INDEXSCALE_HOST, SMTP_INDEXSCALE_PORT, SMTP_INDEXSCALE_USER, SMTP_INDEXSCALE_PASS, SMTP_INDEXSCALE_FROM } = process.env;
  return enviarConConfig(
    {
      host: SMTP_INDEXSCALE_HOST, port: SMTP_INDEXSCALE_PORT, user: SMTP_INDEXSCALE_USER, pass: SMTP_INDEXSCALE_PASS, from: SMTP_INDEXSCALE_FROM,
      faltanMsg: 'SMTP de IndexScale no configurado en el servidor (faltan SMTP_INDEXSCALE_HOST / SMTP_INDEXSCALE_USER / SMTP_INDEXSCALE_PASS en Vercel)',
    },
    datos
  );
}

// ---- Diagnóstico de entrega (solo Brevo) ----
// "Brevo aceptó el correo" (enviado:true) no significa que llegó: puede rebotar, quedar bloqueado o diferido
// después. Brevo guarda un historial de eventos por destinatario; esta función lo resume en un estado entendible.
// Eventos de Brevo: requests (aceptado), delivered, opened, clicks, deferred, softBounces, hardBounces, blocked,
// invalid, spam, error, unsubscribed. Se toma el más reciente que importe, por orden de gravedad.
export function resumirEntregaBrevo(eventos) {
  const lista = Array.isArray(eventos) ? eventos : [];
  if (!lista.length) return { estado: 'sin_eventos', texto: 'Brevo todavía no informa nada de este correo (puede tardar unos minutos).' };
  const tiene = nombres => lista.find(e => nombres.includes(e.event));
  const rechazado = tiene(['hardBounces', 'blocked', 'invalid', 'spam', 'error', 'softBounces']);
  const entregado = tiene(['delivered', 'opened', 'clicks']);
  const diferido = tiene(['deferred']);
  if (rechazado && !entregado) {
    const razon = rechazado.reason ? ` Motivo: ${rechazado.reason}` : '';
    return { estado: 'rechazado', evento: rechazado.event, texto: `Brevo lo marcó como "${rechazado.event}", no llegó al buzón.${razon}` };
  }
  if (entregado) return { estado: 'entregado', evento: entregado.event, texto: 'Brevo lo entregó al servidor de correo del destinatario. Si no lo ve, revisa su carpeta de spam o cuarentena.' };
  if (diferido) return { estado: 'diferido', evento: 'deferred', texto: `El servidor del destinatario lo está demorando (diferido).${diferido.reason ? ' Motivo: ' + diferido.reason : ''}` };
  return { estado: 'aceptado', evento: lista[0].event, texto: 'Brevo lo aceptó y lo está procesando; todavía no confirma la entrega.' };
}

// Eventos de un destinatario (y de un envío puntual si se conoce su messageId), del más reciente al más antiguo.
export async function consultarEventosBrevo(email, messageId) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null;
  const params = new URLSearchParams({ email, limit: '10', sort: 'desc' });
  if (messageId) params.set('messageId', messageId);
  const r = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?${params}`, { headers: { 'api-key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Brevo respondió ${r.status}`);
  const body = await r.json().catch(() => ({}));
  return body.events || [];
}

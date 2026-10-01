// /middleware.ts
// Corre en el runtime Edge de Vercel, ANTES de servir cualquier página o
// función — es lo que realmente obliga a iniciar sesión para entrar. Usa
// Web Crypto (no el módulo "crypto" de Node, que no existe en Edge) para
// verificar la firma de la cookie de sesión.
//
// Requiere la misma variable de entorno AUTH_SECRET que usan las funciones
// de /api (lib/auth-node.js) — deben ser el mismo valor en ambos lados para
// que la firma calce.

// Sin "matcher": corre en TODAS las rutas por defecto (comportamiento base
// de Routing Middleware) — las excepciones (login, endpoints públicos) las
// filtra el propio código de abajo, así evitamos depender de la sintaxis
// exacta de un regex en el matcher.

// Rutas que se pueden ver SIN sesión (la propia página de login, y las
// llamadas que la hacen funcionar). Todo lo demás exige sesión válida.
const RUTAS_PUBLICAS = new Set([
  '/login.html',
  '/api/auth-login',
  '/api/auth-bootstrap',
  '/recuperar-password.html',
  '/reset-password.html',
]);

// getSql también sirve en Edge (@vercel/postgres es fetch-based, sin nada
// de Node puro) -- se usa acá abajo para revisar en vivo, en cada
// navegación a una página .html, cuál es el perfil ACTUAL del usuario y
// qué páginas tiene permitidas ESE perfil ahora mismo (ver más abajo por
// qué: la sesión ya no confía en la foto que quedó guardada en el token
// al momento del login).
import { getSql } from './lib/db.js';

// El webhook de WhatsApp lo llama Meta directo, sin la cookie de sesión de
// esta app -> tiene que quedar público. Vive multiplexado dentro de
// /api/negocio (mismo motivo que todo lo demás: tope de 12 funciones
// serverless del plan Hobby de Vercel), así que NO se puede eximir la ruta
// completa (dejaría público todo lo demás que maneja ese archivo) -> se
// distingue por el query param ?recurso=whatsapp-webhook específicamente.
// La seguridad real de este endpoint puntual la hace la verificación de
// firma de Meta (X-Hub-Signature-256) dentro del propio handler, ver
// manejarWhatsappWebhook en api/negocio.js.
function esWebhookWhatsappPublico(pathname, searchParams) {
  return pathname === '/api/negocio' && searchParams.get('recurso') === 'whatsapp-webhook';
}

// El cron diario de alertas de Sitio Web (ver vercel.json y
// manejarAlertasSitioWebNotificar en api/negocio.js) lo dispara Vercel
// Cron, sin la cookie de sesión de esta app -> mismo motivo y mismo
// patrón que el webhook de WhatsApp arriba: se distingue por el query
// param puntual, no se exime la ruta completa. La seguridad real la hace
// el chequeo de CRON_SECRET dentro del propio handler.
function esAlertasSitioWebNotificarPublico(pathname, searchParams) {
  return pathname === '/api/negocio' && searchParams.get('recurso') === 'alertas-sitio-web-notificar';
}

// Cron semanal (lunes) del resumen de Servicio Técnico -- mismo motivo y
// mismo patrón que el de arriba.
function esServicioTecnicoResumenSemanalPublico(pathname, searchParams) {
  return pathname === '/api/negocio' && searchParams.get('recurso') === 'servicio-tecnico-resumen-semanal';
}

// Cron diario (lunes a viernes) de seguimiento de cotizaciones -- mismo
// motivo y mismo patrón que los de arriba.
function esCotizacionesSeguimientoDiarioPublico(pathname, searchParams) {
  return pathname === '/api/negocio' && searchParams.get('recurso') === 'cotizaciones-seguimiento-diario';
}

// Cron diario (todos los días) de cambios en los checkboxes de "Productos
// estancados" -- mismo motivo y mismo patrón que los de arriba.
function esProductosEstancadosFlagsNotificarPublico(pathname, searchParams) {
  return pathname === '/api/negocio' && searchParams.get('recurso') === 'productos-estancados-flags-notificar';
}

// Cron diario (todos los días) de correspondencia de correo con clientes
// de Cotizaciones -- mismo motivo y mismo patrón que los de arriba.
function esCotizacionesCorreosSyncPublico(pathname, searchParams) {
  return pathname === '/api/negocio' && searchParams.get('recurso') === 'cotizaciones-correos-sync';
}

// Cron de respaldo (diario) que analiza con IA las respuestas de clientes
// que nadie abrió a mano -- mismo motivo y mismo patrón que el de arriba.
function esCotizacionesCorreosAnalizarRespuestasPublico(pathname, searchParams) {
  return pathname === '/api/negocio' && searchParams.get('recurso') === 'cotizaciones-correos-analizar-respuestas';
}

// El píxel de seguimiento de apertura de los correos de IndexScale (ver
// manejarIndexscalePixel en api/negocio.js) lo carga el cliente de correo
// del destinatario directo, sin ninguna cookie de sesión -> mismo motivo y
// mismo patrón que los de arriba. La seguridad real la hace el token
// aleatorio por fila (?t=) que se valida dentro del propio handler, no
// algo que dependa de la sesión.
function esIndexscalePixelPublico(pathname, searchParams) {
  return pathname === '/api/negocio' && searchParams.get('recurso') === 'indexscale-pixel';
}

// Recuperación de contraseña (ver recuperar-password.html /
// reset-password.html y manejarAuthRecuperarPassword /
// manejarAuthResetearPassword en api/negocio.js) -- por definición corre
// SIN sesión, ya que quien la usa es justamente alguien que no puede
// entrar. Mismo patrón de "distinguir por ?recurso=" que los de arriba. La
// seguridad real la hace el token aleatorio de un solo uso que llega solo
// al correo registrado, no algo ligado a la cookie de sesión.
function esAuthRecuperarPasswordPublico(pathname, searchParams) {
  return pathname === '/api/negocio' && searchParams.get('recurso') === 'auth-recuperar-password';
}
function esAuthResetearPasswordPublico(pathname, searchParams) {
  return pathname === '/api/negocio' && searchParams.get('recurso') === 'auth-resetear-password';
}

// Páginas que un usuario con un perfil restringido puede ver SIEMPRE, sin
// importar qué páginas le haya marcado el administrador -- reportar-error
// es la vía de ayuda/soporte, no tendría sentido poder bloquearla (y sirve
// de destino de respaldo si un perfil quedara sin ninguna página marcada).
const PAGINAS_SIEMPRE_PERMITIDAS = new Set(['/reportar-error.html']);

function base64UrlABytes(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const base64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const binaria = atob(base64);
  const bytes = new Uint8Array(binaria.length);
  for (let i = 0; i < binaria.length; i++) bytes[i] = binaria.charCodeAt(i);
  return bytes;
}

async function verificarSesionEdge(token, secret) {
  if (!token || !secret) return null;
  try {
    const [data, firma] = token.split('.');
    if (!data || !firma) return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valido = await crypto.subtle.verify('HMAC', key, base64UrlABytes(firma), new TextEncoder().encode(data));
    if (!valido) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlABytes(data)));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export default async function middleware(req) {
  const url = new URL(req.url);
  const { pathname } = url;
  console.log('[middleware] request a', pathname); // visible en Vercel > Logs, para confirmar que esto SI esta corriendo

  if (
    RUTAS_PUBLICAS.has(pathname) ||
    esWebhookWhatsappPublico(pathname, url.searchParams) ||
    esAlertasSitioWebNotificarPublico(pathname, url.searchParams) ||
    esServicioTecnicoResumenSemanalPublico(pathname, url.searchParams) ||
    esCotizacionesSeguimientoDiarioPublico(pathname, url.searchParams) ||
    esProductosEstancadosFlagsNotificarPublico(pathname, url.searchParams) ||
    esCotizacionesCorreosSyncPublico(pathname, url.searchParams) ||
    esCotizacionesCorreosAnalizarRespuestasPublico(pathname, url.searchParams) ||
    esIndexscalePixelPublico(pathname, url.searchParams) ||
    esAuthRecuperarPasswordPublico(pathname, url.searchParams) ||
    esAuthResetearPasswordPublico(pathname, url.searchParams)
  ) return; // deja pasar sin exigir sesión

  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('session='));
  const token = match ? match.slice('session='.length) : null;

  const sesion = await verificarSesionEdge(token, process.env.AUTH_SECRET);

  if (!sesion) {
    // Para llamadas a /api/* devolvemos 401 en vez de redirigir (no tiene
    // sentido "redirigir" un fetch hecho desde JS).
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'No hay sesión activa' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const destino = new URL('/login.html', req.url);
    destino.searchParams.set('next', pathname);
    return Response.redirect(destino, 302);
  }
  // Perfil de acceso a páginas (ver lib/db.js -> asegurarTablaPerfiles).
  // Solo aplica a navegación de páginas .html -- no a assets (css/js/
  // imágenes) ni a /api/*, para no romper que la página cargue sus propios
  // recursos ni llamadas de fondo. Un admin nunca queda restringido por
  // perfil (mismo criterio que api/auth-login.js).
  //
  // IMPORTANTE: acá NO se usa sesion.paginas tal cual viene en el token.
  // Ese valor es solo la foto de qué perfil/páginas tenía el usuario al
  // momento de iniciar sesión -- si un admin después edita ese perfil (o le
  // cambia el perfil asignado al usuario), un usuario que ya estaba logueado
  // seguía viendo las páginas viejas hasta por 7 días, porque nadie volvía a
  // mirar la base de datos (bug real reportado: a una vendedora con perfil
  // "Ventas" le seguía apareciendo Flujo de Caja después de sacárselo del
  // perfil). Por eso acá se vuelve a consultar en vivo cuál es el perfil
  // ACTUAL del usuario y qué páginas tiene permitidas ESE perfil ahora mismo,
  // usando sesion.uid -- sesion.paginas queda solo como respaldo por si la
  // consulta falla (BD caída, etc.), para no dejar a todo el mundo sin poder
  // navegar por un problema de infraestructura puntual.
  if (pathname.endsWith('.html') && sesion.rol !== 'admin' && !PAGINAS_SIEMPRE_PERMITIDAS.has(pathname)) {
    let paginas = sesion.paginas;
    try {
      const sql = await getSql();
      const { rows } = await sql`
        SELECT p.paginas FROM usuarios u LEFT JOIN perfiles p ON p.id = u.perfil_id
        WHERE u.id = ${sesion.uid};
      `;
      paginas = rows[0] && Array.isArray(rows[0].paginas) ? rows[0].paginas : null;
    } catch {
      // Se sigue con lo que trae el token (ver comentario de arriba).
    }
    if (Array.isArray(paginas)) {
      const permitido = paginas.some(p => `/${p}` === pathname);
      if (!permitido) {
        const destino = paginas.length > 0 ? `/${paginas[0]}` : '/reportar-error.html';
        // Si el destino de respaldo también fuera la página actual (no
        // debería pasar, pero por seguridad ante loops) se deja pasar.
        if (destino !== pathname) return Response.redirect(new URL(destino, req.url), 302);
      }
    }
  }

  // Sesión válida -> continúa normalmente (no se devuelve nada).
}

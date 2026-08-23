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
]);

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

  if (RUTAS_PUBLICAS.has(pathname)) return; // deja pasar sin exigir sesión

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
  // Perfil de acceso a páginas (ver lib/db.js -> asegurarTablaPerfiles):
  // sesion.paginas es la lista exacta de páginas .html que puede ver, o
  // null si no tiene restricción (comportamiento de siempre). Solo aplica
  // a navegación de páginas .html -- no a assets (css/js/imágenes) ni a
  // /api/*, para no romper que la página cargue sus propios recursos ni
  // llamadas de fondo.
  if (
    Array.isArray(sesion.paginas) &&
    pathname.endsWith('.html') &&
    !PAGINAS_SIEMPRE_PERMITIDAS.has(pathname)
  ) {
    const permitido = sesion.paginas.some(p => `/${p}` === pathname);
    if (!permitido) {
      const destino = sesion.paginas.length > 0 ? `/${sesion.paginas[0]}` : '/reportar-error.html';
      // Si el destino de respaldo también fuera la página actual (no
      // debería pasar, pero por seguridad ante loops) se deja pasar.
      if (destino !== pathname) return Response.redirect(new URL(destino, req.url), 302);
    }
  }

  // Sesión válida -> continúa normalmente (no se devuelve nada).
}

// /lib/notificaciones.js
// ══════════════════════════════════════════════════════════════════════
// Notificaciones por correo -- suscriptores y frecuencia configurables
// ══════════════════════════════════════════════════════════════════════
// Pedido del usuario: un solo lugar (página Usuarios) para administrar
// quién recibe CADA notificación del sistema, en vez de listas de correos
// fijas en el código como antes (una por cron: alertas de sitio web,
// resumen semanal de Servicio Técnico, seguimiento de cotizaciones,
// cambios en productos estancados -- y la nueva de ejecutivos WhatsApp).
//
// Vive en lib/ (no en api/negocio.js) porque dos funciones serverless
// DISTINTAS lo necesitan: api/negocio.js (los crons que arman y mandan
// cada reporte) y api/usuarios.js (el CRUD que administra config +
// suscriptores desde la página Usuarios) -- importar un archivo de otro
// sería traer todo api/negocio.js (enorme) al bundle de api/usuarios.js
// sin necesidad.
//
// "tipo" es un id de texto fijo en el código (no una tabla aparte en la
// base) -- agregar un tipo de notificación nuevo siempre implica escribir
// el código que arma ese reporte, así que no tiene sentido que alguien
// pueda "crear un tipo" desde la UI sin ese código existiendo. La UI solo
// administra QUIÉN se suscribe a cada tipo YA EXISTENTE y con qué
// frecuencia se manda.
//
// Importante sobre "frecuencia": los crons de Vercel (ver vercel.json)
// siguen disparándose a la hora fija que ya tenían (una vez al día, plan
// Hobby) -- cambiar la frecuencia a "semanal" NO cambia CUÁNDO Vercel llama
// a la función, sino que hace que la función, al correr, revise si HOY le
// toca mandar algo (ver notificacionDebeEnviarseHoy) y si no, no haga nada.
// Lo mismo para "activa" (apagar una notificación sin borrar a sus
// suscriptores). No hay forma de que una página web cambie la hora exacta
// en que Vercel invoca un cron sin desplegar un vercel.json nuevo -- por
// eso NO se ofrece una hora configurable, solo frecuencia/día.
// Categorías para ordenar la lista de Usuarios > Notificaciones (el orden de esta lista es el que se muestra).
export const CATEGORIAS_NOTIFICACION = [
  { id: 'comercial', nombre: 'Comercial', icono: '💼' },
  { id: 'web', nombre: 'Sitio web', icono: '🌐' },
  { id: 'analisis', nombre: 'Análisis', icono: '📊' },
  { id: 'compras', nombre: 'Compras', icono: '📦' },
  { id: 'inventario', nombre: 'Inventario', icono: '📦' },
  { id: 'servicio', nombre: 'Servicio técnico', icono: '🛠️' },
  { id: 'erp', nombre: 'ERP', icono: '⚙️' },
];
// REGLA DE DISEÑO: todo correo de notificación (los de esta lista, hoy y los que se agreguen) se arma con las piezas de lib/correo-base.js
// (encabezado azul, tarjetas de cifras, avisos "Requiere atención", tablas cortas, botón al ERP, leyenda "Cómo leerlo" y pie estándar) y sin montos,
// ventas ni costos de la empresa. Al crear un tipo nuevo: 1) agregarlo aquí con su categoría, 2) armar el correo con correo-base en una función pura
// (ejemplos: lib/correos-notificaciones.js, lib/servicio-tecnico-correo.js), 3) guardar el último correo con marcarNotificacionEnviada(sql, tipo, { asunto, html }).
export const TIPOS_NOTIFICACION = {
  'alertas-sitio-web': { categoria: 'web', nombre: 'Alertas de sitio web (precio/stock)', destinatariosPorDefecto: ['lcelis@indexstore.cl', 'nmolina@indexstore.cl'] },
  'servicio-tecnico-resumen-semanal': { categoria: 'servicio', nombre: 'Resumen semanal de Servicio Técnico', destinatariosPorDefecto: ['nmolina@indexstore.cl', 'nathalia@indexstore.cl'] },
  'cotizaciones-seguimiento-diario': { categoria: 'comercial', nombre: 'Cotizaciones: qué hacer hoy (seguimiento, en riesgo y por recontactar, priorizado por monto y días)', destinatariosPorDefecto: ['nmolina@indexstore.cl'] },
  'productos-estancados-flags': { categoria: 'analisis', nombre: 'Cambios en productos estancados', destinatariosPorDefecto: ['nmolina@indexstore.cl'] },
  'resumen-cambios-diario': { categoria: 'erp', nombre: 'Resumen diario de cambios (tienda, ERP, buscador)', destinatariosPorDefecto: ['nmolina@indexstore.cl'] },
  'resumen-cambios-recordatorio': { categoria: 'erp', nombre: 'Recordatorio: generar y enviar el resumen de cambios (si hubo cambios en la web y en el ERP)', destinatariosPorDefecto: ['nmolina@indexstore.cl'] },
  'whatsapp-ejecutivos-diario': { categoria: 'comercial', nombre: 'Resumen diario de ejecutivos WhatsApp', destinatariosPorDefecto: ['nmolina@indexstore.cl'] },
  'indexscale-lead-web': { categoria: 'comercial', nombre: 'Lead nuevo en el sitio indexscale.cl (formularios de contacto, demo y diagnóstico), al instante', destinatariosPorDefecto: ['nmolina@indexstore.cl', 'lcelis@indexstore.cl', 'nathalia@indexstore.cl'] },
  'modelos-compatibles-pendientes': { categoria: 'comercial', nombre: 'Modelos compatibles: propuestas creadas que siguen sin aprobar (lunes, solo si hay pendientes)', destinatariosPorDefecto: ['lcelis@indexstore.cl', 'nmolina@indexstore.cl', 'nathalia@indexstore.cl'], frecuenciaPorDefecto: { frecuencia: 'semanal', dia_semana: 1 } },
  'transito-envio-nuevo': { categoria: 'compras', nombre: 'Envío nuevo en tránsito: carga en camino o en preparación (al instante, cuando el envío queda con sus productos)', destinatariosPorDefecto: ['nmolina@indexstore.cl'] },
  'traspaso-stock-modelos': { categoria: 'inventario', nombre: 'Traspaso de stock: un modelo de pantalla no principal se agotó (traspasar desde el principal)', destinatariosPorDefecto: ['nathalia@indexstore.cl', 'nmolina@indexstore.cl'] },
  // correosFijos: direcciones que SIEMPRE reciben este aviso (además de quienes se agreguen en el panel); no tienen que ser usuarios del ERP.
  'insumos-stock-critico': { categoria: 'compras', nombre: 'Insumos de Servicio Técnico en stock crítico: UN solo aviso de compra (junta lo que el técnico marca en ~15 min), con el link y las unidades que sugiere', destinatariosPorDefecto: [], correosFijos: ['nmolina@indexpro.cl', 'lhernandez@indexstore.cl'] },
  'google-ads-resumen-semanal': { categoria: 'analisis', nombre: 'Resumen semanal de Google Ads (domingos, últimos 15 y 30 días)', destinatariosPorDefecto: ['nmolina@indexstore.cl'] },
};

// La primera vez que corre un tipo (todavía sin fila de configuración ni
// suscriptores) se siembra con los destinatarios que antes estaban fijos
// en el código -- así este refactor no corta en seco un correo que ya se
// estaba mandando, mientras nadie entra a la página Usuarios a
// configurarlo de verdad. Una vez que alguien agrega o saca a un
// suscriptor (aunque sea el mismo que ya estaba), la siembra no se vuelve
// a aplicar -- ver el chequeo "ya tiene al menos uno" más abajo.
export async function asegurarConfigYSuscriptoresPorDefecto(sql, tipo) {
  const info = TIPOS_NOTIFICACION[tipo];
  if (!info) return;
  await sql`INSERT INTO notificaciones_config (tipo) VALUES (${tipo}) ON CONFLICT (tipo) DO NOTHING;`;
  const { rows: yaTiene } = await sql`SELECT 1 FROM notificaciones_suscriptores WHERE tipo = ${tipo} LIMIT 1;`;
  if (yaTiene.length > 0) return;
  // Frecuencia inicial (solo la primera vez, junto con los destinatarios): para que la lista muestre «Semanal · Lunes» y no «Diaria» en lo que corre una vez por semana.
  if (info.frecuenciaPorDefecto) await sql`UPDATE notificaciones_config SET frecuencia = ${info.frecuenciaPorDefecto.frecuencia}, dia_semana = ${info.frecuenciaPorDefecto.dia_semana} WHERE tipo = ${tipo};`;
  for (const email of info.destinatariosPorDefecto || []) {
    const { rows: usuarioRows } = await sql`SELECT id FROM usuarios WHERE email = ${email};`;
    if (usuarioRows[0]) {
      await sql`INSERT INTO notificaciones_suscriptores (tipo, usuario_id) VALUES (${tipo}, ${usuarioRows[0].id}) ON CONFLICT DO NOTHING;`;
    }
  }
}

export function notificacionDebeEnviarseHoy(config) {
  if (!config || config.activa === false) return false;
  if (config.frecuencia === 'semanal' && config.dia_semana != null) {
    // Día de la semana en Chile, no UTC -- un cron que corre a las 13:00 UTC
    // (10am Chile en horario de verano, 9am en invierno) ya cae del lado
    // correcto del cambio de día en Chile de todas formas, pero se calcula
    // explícito para no depender de esa coincidencia.
    const hoyChile = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
    if (hoyChile.getDay() !== config.dia_semana) return false;
  }
  return true;
}

// Devuelve los correos activos suscritos a "tipo" -- sembrando primero los
// destinatarios de antes si nadie ha configurado nada todavía.
export async function obtenerSuscriptoresEmail(sql, tipo) {
  await asegurarConfigYSuscriptoresPorDefecto(sql, tipo);
  const { rows } = await sql`
    SELECT u.email FROM notificaciones_suscriptores ns
    JOIN usuarios u ON u.id = ns.usuario_id AND u.activo = true
    WHERE ns.tipo = ${tipo};
  `;
  // Más las direcciones fijas del tipo (si las tiene), sin repetir ninguna.
  const info = TIPOS_NOTIFICACION[tipo];
  const vistos = new Set(), todos = [];
  for (const email of [...rows.map(r => r.email), ...((info && info.correosFijos) || [])]) {
    const k = String(email || '').trim().toLowerCase();
    if (k && !vistos.has(k)) { vistos.add(k); todos.push(String(email).trim()); }
  }
  return todos;
}

// true si corresponde mandar HOY según la frecuencia configurada (o true
// por defecto, diaria, si nadie ha tocado la configuración todavía).
export async function notificacionDebeEnviarse(sql, tipo) {
  await asegurarConfigYSuscriptoresPorDefecto(sql, tipo);
  const { rows } = await sql`SELECT frecuencia, dia_semana, activa FROM notificaciones_config WHERE tipo = ${tipo};`;
  return notificacionDebeEnviarseHoy(rows[0]);
}

// contenido = { asunto, html } del correo que se mandó: se guarda como "último correo" para mostrarlo en la página Usuarios > Notificaciones.
const MAX_HTML_GUARDADO = 400000; // tope de seguridad por correo
export async function marcarNotificacionEnviada(sql, tipo, contenido) {
  const asunto = contenido && contenido.asunto ? String(contenido.asunto).slice(0, 300) : null;
  const html = contenido && contenido.html ? String(contenido.html).slice(0, MAX_HTML_GUARDADO) : null;
  await sql`UPDATE notificaciones_config SET ultimo_envio_en = now(),
    ultimo_asunto = COALESCE(${asunto}::text, ultimo_asunto), ultimo_html = COALESCE(${html}::text, ultimo_html) WHERE tipo = ${tipo};`;
}

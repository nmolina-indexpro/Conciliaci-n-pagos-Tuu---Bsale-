// /lib/cambios-registro.js
// ══════════════════════════════════════════════════════════════════════
// Historial de cambios (tienda, ERP, buscador) -- pestaña "Cambios" de la
// página Usuarios. Una fila por cambio, con fecha, área, descripción y
// estado (publicado / pendiente de publicar). De aquí sale también el
// resumen diario (botón "Armar desde los cambios de hoy").
// REGLA del usuario: nunca poner datos financieros (ventas, montos, costos)
// en estas descripciones: solo qué cambió y qué hacer.
// ══════════════════════════════════════════════════════════════════════

export const ESTADOS_CAMBIO = ['publicado', 'pendiente'];
export const SITIOS_CAMBIO = ['web', 'erp'];

// Cambios ya hechos al momento de crear el historial. Campos: fecha, área, descripción, estado, sitio ('web' = indexstore.cl, 'erp'), enlace para ver/probar.
// Se siembran UNA vez (solo si la tabla está vacía);
// después todo se administra desde la página (la fecha y el estado se pueden corregir ahí).
export const CAMBIOS_INICIALES = [
  ['2026-10-12', 'Pantallas', 'Filtros nuevos de Pulgadas (14.0", 15.6", 16.0", 16.1") y de Resolución (HD 1366x768 o FullHD 1920x1080), con la cantidad de productos.', 'publicado', 'web', 'https://www.indexstore.cl/collections/pantalla-notebook-modelos-equipos'],
  ['2026-10-12', 'Cargadores por modelo', 'Fila nueva con Watt, Voltaje y amperaje y Punta. Cada botón abre un panel con las opciones. Voltaje y amperaje es un solo filtro de la tienda: se elige el par (por ejemplo 19.5V | 3.33A).', 'publicado', 'web', 'https://www.indexstore.cl/collections/cargadores-notebook-modelos-equipos'],
  ['2026-10-12', 'Cargadores por modelo', 'Corrección: las puntas mostraban el nombre de la imagen ("files/PUNTAS…jpg"); ahora se ven como "4.5 x 3.0 mm", USB o USB-C.', 'pendiente', 'web', 'https://www.indexstore.cl/collections/cargadores-notebook-modelos-equipos'],
  ['2026-10-12', 'Colecciones', 'Encabezado nuevo en Pantallas, Cargadores y Baterías, con las marcas como botones con logo (HP, Asus, Dell, Lenovo, Acer).', 'publicado', 'web', 'https://www.indexstore.cl/collections/baterias-para-notebook'],
  ['2026-10-12', 'Colecciones', 'Series por marca: al elegir una marca aparecen sus series; las que tienen menos de 10 productos van juntas en "Otros". El filtro lateral también queda agrupado por marca.', 'publicado', 'web', 'https://www.indexstore.cl/collections/cargadores-notebook-modelos-equipos'],
  ['2026-10-12', 'Chat SalesIQ', 'El globo "Estamos en línea" saldrá una sola vez por visitante (por navegador). El botón verde del chat sigue siempre visible.', 'pendiente', 'web', 'https://www.indexstore.cl/'],
  ['2026-10-12', 'Chat SalesIQ', 'La ventana de chat en celular es ahora una tarjeta chica abajo y no ocupa toda la pantalla.', 'publicado', 'web', 'https://www.indexstore.cl/'],
  ['2026-10-12', 'WhatsApp', 'El botón de WhatsApp no se veía en celular: lo tapaba la página del medidor de la punta del cargador. Corregido.', 'publicado', 'web', 'https://www.indexstore.cl/pages/cual-es-la-medida-de-mi-cargador'],
  ['2026-10-12', 'Home', 'Buscador nuevo "Encuentra tu repuesto": tipo, marca y serie (más pulgadas/resolución o watt/voltaje/punta según el tipo). Reemplaza al actual en escritorio y va bajo el deslizador en celular. Incluye el botón "No encuentro mi modelo, vamos a WhatsApp" con mensaje ya escrito.', 'pendiente', 'web', 'https://www.indexstore.cl/'],
  ['2026-10-12', 'Home', 'Se ocultó el extracto de blog del inicio.', 'publicado', 'web', 'https://www.indexstore.cl/'],
  ['2026-10-12', 'Descuentos por cantidad', 'En cargadores: 3 unidades 10% y 5 unidades 15%, contando todos los cargadores del carro juntos y sin combinar con otros descuentos. Se reservan 2 unidades de stock. La ficha muestra un bloque con los tramos.', 'publicado', 'web', 'https://www.indexstore.cl/collections/cargadores-para-notebook'],
  ['2026-10-12', 'ERP · Descuentos web', 'Módulo nuevo para ver y administrar los descuentos por cantidad: aplica las etiquetas, revisa solo cada día y muestra tarjetas de carros y clics. Falta revisar esas tarjetas en unos días.', 'publicado', 'erp', 'https://erp.indexstore.cl/descuentos-web.html'],
  ['2026-10-12', 'Cotizador de envío', 'En la ficha, las opciones salen en este orden: primero la más económica, luego la más rápida y al final el retiro en tienda (gratis). Pendiente de decidir si "Más rápida" debe incluir los puntos de retiro.', 'publicado', 'web', 'https://www.indexstore.cl/collections/cargadores-para-notebook'],
  ['2026-10-08', 'Cotizador de envío', 'Ahora cuenta personas y no clics: cuántos eligieron una comuna a mano, cuántos usan la recordada y cuántos la cambian.', 'publicado', 'web', 'https://www.indexstore.cl/collections/cargadores-para-notebook'],
  ['2026-10-12', 'Cotizador de envío', 'Se mide el embudo carro → pago → compra; las cifras se ven en la página Sitio Web del ERP.', 'publicado', 'erp', 'https://erp.indexstore.cl/sitio-web.html'],
  ['2026-10-12', 'ERP · Notificaciones', 'Notificación nueva "Resumen diario de cambios": se arma en Usuarios > Notificaciones y se envía por correo a las 19:00 a los destinatarios.', 'publicado', 'erp', 'https://erp.indexstore.cl/usuarios.html#notificaciones'],
  ['2026-10-12', 'ERP', 'Todas las tablas nuevas se pueden ordenar haciendo clic en el encabezado de cada columna.', 'publicado', 'erp', 'https://erp.indexstore.cl/descuentos-web.html'],
  ['2026-10-12', 'ERP · Cambios', 'Pestaña nueva "Cambios" en Usuarios: historial de todos los cambios, con fecha, para agregar, editar y eliminar.', 'publicado', 'erp', 'https://erp.indexstore.cl/usuarios.html#cambios'],
];

// [texto anterior, texto nuevo]: el globo de SalesIQ pasó de "una vez cada 12 horas" a "una sola vez por visitante" (14-oct-2026).
const CORRECCIONES_INICIALES = [
  ['El globo "Estamos en línea" saldrá una vez cada 12 horas por visitante. El botón verde del chat sigue siempre visible.', 'El globo "Estamos en línea" saldrá una sola vez por visitante (por navegador). El botón verde del chat sigue siempre visible.'],
];

const RE_FECHA =/^\d{4}-\d{2}-\d{2}$/;

export async function asegurarCambiosRegistro(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS cambios_registro (
      id SERIAL PRIMARY KEY,
      fecha DATE NOT NULL,
      area TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'publicado' CHECK (estado IN ('publicado','pendiente')),
      creado_por TEXT,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS sitio TEXT NOT NULL DEFAULT 'web';`;
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS url TEXT;`;
  // Cambio relevante (sale con vista previa en el correo) e imagen de vista previa (reducida, en base64) con su código público.
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS destacado BOOLEAN NOT NULL DEFAULT false;`;
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS imagen_b64 TEXT;`;
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS imagen_tipo TEXT;`;
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS imagen_token TEXT;`;
  // Propuesta diaria de cambios relevantes (ver lib/cambios-propuesta.js): origen 'manual' (los de siempre) o 'propuesta'; aprobacion 'propuesto' /
  // 'aprobado' / 'descartado' (los de antes quedan 'aprobado'); los aprobados de origen 'propuesta' se envían en el correo del día siguiente (enviado_en).
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'manual';`;
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS aprobacion TEXT NOT NULL DEFAULT 'aprobado';`;
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS relevancia INTEGER;`;
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS commits TEXT;`;
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS aprobado_por TEXT;`;
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS aprobado_en TIMESTAMPTZ;`;
  await sql`ALTER TABLE cambios_registro ADD COLUMN IF NOT EXISTS enviado_en TIMESTAMPTZ;`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cambios_registro_propuesta ON cambios_registro (origen, aprobacion, fecha);`;
  // Un cambio manual cuya fecha cae en un resumen ya enviado (el de ese día o el siguiente) y que ya existía al enviarlo, cuenta como enviado: así "Generar resumen" muestra solo lo nuevo.
  try {
    await sql`
      UPDATE cambios_registro c SET enviado_en = r.enviado_en
      FROM resumen_cambios r
      WHERE c.enviado_en IS NULL AND c.origen <> 'propuesta' AND r.enviado_en IS NOT NULL
        AND c.fecha BETWEEN r.fecha - 1 AND r.fecha AND c.creado_en <= r.enviado_en;`;
  } catch (e) { /* la tabla de resúmenes todavía no existe: no hay nada enviado */ }
  const { rows } = await sql`SELECT 1 FROM cambios_registro LIMIT 1;`;
  if (rows.length === 0) {
    for (const [fecha, area, descripcion, estado, sitio, url] of CAMBIOS_INICIALES) {
      await sql`INSERT INTO cambios_registro (fecha, area, descripcion, estado, sitio, url, creado_por) VALUES (${fecha}::date, ${area}, ${descripcion}, ${estado}, ${sitio}, ${url}, 'inicial');`;
    }
  } else {
    // Historial creado antes de existir "sitio" y "enlace": se completan solo las filas iniciales que aún no los tienen.
    for (const [, , descripcion, , sitio, url] of CAMBIOS_INICIALES) {
      await sql`UPDATE cambios_registro SET sitio = ${sitio}, url = ${url} WHERE creado_por = 'inicial' AND descripcion = ${descripcion} AND url IS NULL;`;
    }
    // Textos de cambios iniciales que cambiaron de criterio después de cargarse (solo si nadie los editó a mano).
    for (const [viejo, nuevo] of CORRECCIONES_INICIALES) {
      await sql`UPDATE cambios_registro SET descripcion = ${nuevo}, actualizado_en = now() WHERE creado_por = 'inicial' AND descripcion = ${viejo};`;
    }
  }
}

// Devuelve { error } si algo no es válido, o los campos ya limpios.
export function validarCambio(body) {
  const fecha = String((body || {}).fecha || '').trim();
  const area = String((body || {}).area || '').trim();
  const descripcion = String((body || {}).descripcion || '').trim();
  const estado = String((body || {}).estado || 'publicado').trim();
  const sitio = String((body || {}).sitio || 'web').trim();
  const url = String((body || {}).url || '').trim();
  const destacado = (body || {}).destacado === true || (body || {}).destacado === 'true';
  const quitarImagen = (body || {}).quitarImagen === true;
  const imagenCruda = String((body || {}).imagen || '');
  let imagen = null;
  if (imagenCruda) {
    const m = imagenCruda.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return { error: 'La imagen no es válida (usa JPG, PNG o WebP)' };
    if (m[2].length > 150000) return { error: 'La imagen es demasiado pesada (máximo unos 110 KB); se reduce sola al subirla' };
    imagen = { tipo: m[1], b64: m[2] };
  }
  if (!RE_FECHA.test(fecha) || Number.isNaN(Date.parse(fecha))) return { error: 'La fecha no es válida' };
  if (!area) return { error: 'Falta el área' };
  if (area.length > 80) return { error: 'El área es demasiado larga (máximo 80 caracteres)' };
  if (!descripcion) return { error: 'Falta la descripción del cambio' };
  if (descripcion.length > 2000) return { error: 'La descripción es demasiado larga (máximo 2.000 caracteres)' };
  if (!ESTADOS_CAMBIO.includes(estado)) return { error: 'Estado inválido' };
  if (!SITIOS_CAMBIO.includes(sitio)) return { error: 'Sitio inválido (web o erp)' };
  if (url && (!/^https?:\/\/\S+$/i.test(url) || url.length > 500)) return { error: 'El enlace debe empezar con http:// o https:// (máximo 500 caracteres)' };
  return { fecha, area, descripcion, estado, sitio, url: url || null, destacado, imagen, quitarImagen };
}

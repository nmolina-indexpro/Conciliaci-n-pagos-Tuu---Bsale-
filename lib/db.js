// /lib/db.js
// Import dinámico de @vercel/postgres (evita que la función se caiga con un
// error crudo si POSTGRES_URL todavía no está configurada — mismo patrón que
// ya usamos para BCI).

export async function getSql() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL no está configurada en el servidor (falta conectar la base de datos en Vercel)');
  }
  const { sql } = await import('@vercel/postgres');
  return sql;
}

// Rate limiting del login (fuerza bruta / credential stuffing) -> se
// necesita una tabla porque las funciones de Vercel son sin estado entre
// invocaciones (nada de contadores en memoria sirve). Bloqueo corto y
// acotado (ver api/auth-login.js) a propósito, no permanente -> un
// bloqueo "para siempre" por intentos fallidos se puede usar como
// denegación de servicio contra la cuenta real de otra persona.
export async function asegurarTablaIntentosLogin(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS intentos_login (
      email TEXT PRIMARY KEY,
      intentos INTEGER NOT NULL DEFAULT 0,
      ultimo_intento TIMESTAMPTZ,
      bloqueado_hasta TIMESTAMPTZ
    );
  `;
}

export async function asegurarTablaUsuarios(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nombre TEXT,
      rol TEXT NOT NULL DEFAULT 'usuario',
      activo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  // Cuentas temporales (ej. un admin de acceso puntual por unas horas).
  // Dos columnas separadas a propósito:
  //   - expira_minutos: la duración pendiente que se definió al crear la
  //     cuenta (ej. 180 = 3 horas), pero que TODAVÍA no empezó a correr.
  //   - expira_en: la fecha límite real. Queda NULL hasta el primer login
  //     exitoso — ahí (api/auth-login.js) se calcula como
  //     now() + expira_minutos y se guarda. A partir de ese momento la
  //     cuenta (y cualquier sesión abierta con ella) deja de funcionar
  //     exactamente en esa fecha, sin depender de que nadie cierre sesión
  //     a mano (ver firmarSesion en lib/auth-node.js).
  await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS expira_en TIMESTAMPTZ;`;
  await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS expira_minutos INTEGER;`;
  // Última vez que este usuario inició sesión con éxito (api/auth-login.js
  // la actualiza en cada login) -> se muestra en el mantenedor de usuarios.
  await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_login TIMESTAMPTZ;`;
  // Perfil de acceso a páginas (ver asegurarTablaPerfiles) -> NULL significa
  // "sin restricción" (comportamiento de siempre, todas las páginas), para
  // no romper cuentas existentes. Se usa ON DELETE SET NULL para que borrar
  // un perfil no borre usuarios, solo les quite la restricción.
  await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil_id INTEGER REFERENCES perfiles(id) ON DELETE SET NULL;`;
}

// Perfiles de acceso: un nombre + la lista de páginas (archivos .html) que
// puede ver un usuario con ese perfil asignado. Se guarda como JSONB (array
// de strings, ej. ["home.html","compras.html"]) en vez de una tabla aparte
// de relación -> son pocas páginas y nunca se consultan por separado, así
// que no vale la pena la complejidad de una tabla intermedia.
//
// Se hace cumplir en dos lugares:
//  - middleware.ts (Edge): bloquea la navegación directa a una página que
//    no esté en la lista del perfil del usuario. Lee la lista desde el
//    propio token de sesión (ver api/auth-login.js), no consulta la base
//    en cada request.
//  - restriccion-usuario.js (cliente): oculta del menú los links a páginas
//    no permitidas, para no mostrar accesos que de todos modos van a
//    rebotar.
//
// OJO: se llama ANTES que asegurarTablaUsuarios en cualquier lugar donde se
// use perfil_id, porque esa columna tiene una FK hacia esta tabla.
export async function asegurarTablaPerfiles(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS perfiles (
      id SERIAL PRIMARY KEY,
      nombre TEXT UNIQUE NOT NULL,
      paginas JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
}

// Reportes de error que mandan los usuarios desde la página
// "Reportar un error". Cada uno tiene un estado editable (por un admin) para
// hacerle seguimiento a si ya se resolvió o no.
export async function asegurarTablaReportesError(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS reportes_error (
      id SERIAL PRIMARY KEY,
      usuario_email TEXT NOT NULL,
      usuario_nombre TEXT,
      descripcion TEXT NOT NULL,
      pagina TEXT,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      created_at TIMESTAMPTZ DEFAULT now(),
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  // 'error' (reporte de falla) o 'objecion' (desacuerdo con un resultado
  // puntual, ej. una sugerencia de compra o un cálculo de quiebre). Cuando
  // es una objeción, sku_code y contexto guardan el producto y los números
  // exactos que se estaban mostrando en ese momento, para poder revisarlo
  // con el mismo dato que vio la persona.
  await sql`ALTER TABLE reportes_error ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'error';`;
  await sql`ALTER TABLE reportes_error ADD COLUMN IF NOT EXISTS sku_code TEXT;`;
  await sql`ALTER TABLE reportes_error ADD COLUMN IF NOT EXISTS contexto JSONB;`;
  // Captura de pantalla opcional adjunta por el usuario, guardada como data
  // URL (ya comprimida/redimensionada en el navegador antes de subirla, ver
  // reportar-error.html) -> se muestra en el modal de detalle y se incrusta
  // en el correo de aviso.
  await sql`ALTER TABLE reportes_error ADD COLUMN IF NOT EXISTS imagen TEXT;`;
}

// Productos marcados a mano como "críticos" (nunca deberían faltar), desde
// la página Alertas de Stock. Esto se combina con la sugerencia automática
// (SKU "Estrella" = top 20% más vendido, que ya calcula bsale-sku-report.js)
// -> un producto puede ser crítico por ser Estrella, por estar marcado a
// mano acá, o ambas cosas.
export async function asegurarTablaProductosCriticos(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS productos_criticos (
      code TEXT PRIMARY KEY,
      nombre TEXT,
      agregado_por TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
}

// Resultado cacheado de "Alertas Sitio web" (stock disponible no visible +
// diferencias de precio Bsale/Shopify) -> ese cálculo escanea el catálogo
// completo de Shopify más stock y precios de Bsale, pesado para recalcular
// en cada carga de la página (ver conversación con el usuario). Se guarda
// una sola fila (mismo patrón que saldo_bci) con el resultado completo en
// JSONB; la página lee esto en vez de recalcular, y el cron diario (ver
// manejarAlertasSitioWebNotificar en api/negocio.js) la mantiene al día
// automáticamente. Un botón "Actualizar ahora" en la página fuerza un
// recálculo puntual cuando hace falta ver el estado real de inmediato.
export async function asegurarTablaAlertasSitioWebCache(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS alertas_sitio_web_cache (
      id INTEGER PRIMARY KEY DEFAULT 1,
      datos JSONB,
      calculado_en TIMESTAMPTZ
    );
  `;
  await sql`INSERT INTO alertas_sitio_web_cache (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`;
}

// Resultado cacheado del escaneo de las 3 colecciones de Shopify usadas
// para "descubrir" modelos de notebook (pantalla/batería/cargador, ver
// COLECCIONES_MODELOS_NOTEBOOK en api/negocio.js) -- paginar ~5.000
// productos entre las 3 colecciones en cada carga de la página era lento.
// Mismo patrón que alertas_sitio_web_cache: una fila con el resultado
// crudo en JSONB: la página agrupa/extrae marca+modelo del lado del
// cliente sobre estos datos ya cacheados (rápido, es solo JS en memoria),
// y el cron diario + el botón "Actualizar ahora" son los que de verdad
// vuelven a golpear Shopify.
export async function asegurarTablaModelosNotebookCache(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS modelos_notebook_cache (
      id INTEGER PRIMARY KEY DEFAULT 1,
      datos JSONB,
      calculado_en TIMESTAMPTZ
    );
  `;
  await sql`INSERT INTO modelos_notebook_cache (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`;
}

// Compatibilidad manual notebook -> repuestos (Sitio Web): por cada
// marca+modelo de notebook, el SKU de la batería/pantalla/cargador que le
// corresponde -- carga a mano por un admin (Bsale/Shopify no tienen esta
// relación modelada en ningún lado), para poder responder rápido "¿esta
// pieza sirve para mi notebook X?" sin adivinar por texto.
export async function asegurarTablaCompatibilidadNotebook(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS notebook_compatibilidad (
      id SERIAL PRIMARY KEY,
      marca TEXT NOT NULL,
      modelo TEXT NOT NULL,
      sku_bateria TEXT,
      sku_pantalla TEXT,
      sku_cargador TEXT,
      actualizado_por TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (marca, modelo)
    );
  `;
}

// Facturas de compra a proveedores, ingresadas a mano desde Flujo de Caja
// -> complementa el "Facturas por pagar" automático (que solo lee
// recepciones de Bsale) con las que se pagan por cheque o transferencia y
// se quieren seguir aparte. Si la forma de pago es "cheque", numero_cheque
// y fecha_cobro_cheque quedan disponibles; si es "transferencia", quedan
// NULL.
export async function asegurarTablaFacturasCompra(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS facturas_compra (
      id SERIAL PRIMARY KEY,
      proveedor TEXT NOT NULL,
      numero_factura TEXT,
      monto NUMERIC NOT NULL,
      fecha_compra DATE NOT NULL,
      fecha_vencimiento DATE,
      forma_pago TEXT NOT NULL DEFAULT 'transferencia',
      numero_cheque TEXT,
      fecha_cobro_cheque DATE,
      agregado_por TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
}

// Clientes de Bsale con puntos del club de fidelización, y el progreso de la
// sincronización que los trae. Bsale limita su API a ~8 solicitudes/segundo
// (ver changelog oficial) y clients.json no tiene filtro por puntos, así que
// con decenas de miles de clientes (ej. 47.295 habilitados) traerlos TODOS
// no cabe en una sola invocación de función (tope de 60s en plan Hobby de
// Vercel) -> se sincroniza en tandas resumibles (ver
// manejarSyncClientesPuntos en api/negocio.js), guardando en Postgres el
// offset donde quedó cada tanda para retomar justo ahí en la siguiente.
export async function asegurarTablaBsalePuntos(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS bsale_clientes_puntos (
      id INTEGER PRIMARY KEY,
      nombre TEXT,
      rut TEXT,
      telefono TEXT,
      empresa TEXT,
      ciudad TEXT,
      puntos INTEGER NOT NULL DEFAULT 0,
      acumula_puntos BOOLEAN NOT NULL DEFAULT false,
      puntos_actualizado DATE,
      sincronizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  // Agregada después de la tabla original -> clientes ya sincronizados
  // quedan con email NULL hasta que corra la sincronización de nuevo.
  await sql`ALTER TABLE bsale_clientes_puntos ADD COLUMN IF NOT EXISTS email TEXT;`;
  // Vinculación automática con Clientes WhatsApp (por teléfono, con sus
  // límites -- ver comentario en api/negocio.js junto a
  // vincularClienteBsalePorTelefono): columna calculada con solo los
  // últimos 9 dígitos del teléfono (el largo de un celular chileno sin
  // código de país), para poder cruzar contra el wa_id de WhatsApp sin
  // depender de que ambos lados usen el mismo formato (+56, espacios,
  // guiones, con o sin código de país). Columna GENERATED -> Postgres la
  // recalcula solo, con índice para que el cruce sea rápido incluso con
  // decenas de miles de clientes.
  await sql`ALTER TABLE bsale_clientes_puntos ADD COLUMN IF NOT EXISTS telefono_normalizado TEXT GENERATED ALWAYS AS (right(regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g'), 9)) STORED;`;
  await sql`CREATE INDEX IF NOT EXISTS idx_bsale_clientes_puntos_telefono_normalizado ON bsale_clientes_puntos (telefono_normalizado) WHERE telefono_normalizado <> '';`;
  await sql`
    CREATE TABLE IF NOT EXISTS bsale_puntos_sync_estado (
      id INTEGER PRIMARY KEY DEFAULT 1,
      offset_actual INTEGER NOT NULL DEFAULT 0,
      total_clientes INTEGER,
      ultima_pasada_completa_en TIMESTAMPTZ,
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`INSERT INTO bsale_puntos_sync_estado (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`;
}

// Cotizaciones de Bsale (documentos tipo "Cotización") por cliente, para
// hacerles seguimiento comercial -> mismo patrón resumible que los puntos
// (ver asegurarTablaBsalePuntos): Fase 1 trae los documentos de cotización
// del período, Fase 2 completa "cliente_ha_comprado" consultando el
// historial de cada cliente (ver manejarSyncCotizaciones en
// api/negocio.js). El campo "estado" es el único que edita una persona
// (no Bsale) -> la sincronización nunca lo pisa.
export async function asegurarTablaCotizaciones(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS bsale_cotizaciones (
      id INTEGER PRIMARY KEY,
      numero TEXT,
      cliente_id INTEGER,
      cliente_nombre TEXT,
      monto NUMERIC NOT NULL DEFAULT 0,
      fecha DATE,
      cliente_ha_comprado BOOLEAN,
      estado TEXT NOT NULL DEFAULT 'sin_contactar',
      actualizado_por TEXT,
      sincronizado_en TIMESTAMPTZ DEFAULT now(),
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  // Agregadas después de la tabla original: link para ver la cotización en
  // Bsale, y el documento (boleta/factura) al que quedó vinculada cuando se
  // factura -> ahí el "estado" pasa a 'facturada' automáticamente (ver
  // Fase 3 de manejarSyncCotizaciones). documento_asociado_id NULL significa
  // "todavía no se ha revisado o no está vinculada", no lo mismo que "false".
  await sql`ALTER TABLE bsale_cotizaciones ADD COLUMN IF NOT EXISTS url_cotizacion TEXT;`;
  await sql`ALTER TABLE bsale_cotizaciones ADD COLUMN IF NOT EXISTS documento_asociado_id INTEGER;`;
  await sql`ALTER TABLE bsale_cotizaciones ADD COLUMN IF NOT EXISTS documento_asociado_tipo TEXT;`;
  await sql`ALTER TABLE bsale_cotizaciones ADD COLUMN IF NOT EXISTS documento_asociado_numero TEXT;`;
  await sql`ALTER TABLE bsale_cotizaciones ADD COLUMN IF NOT EXISTS documento_asociado_url TEXT;`;
  await sql`ALTER TABLE bsale_cotizaciones ADD COLUMN IF NOT EXISTS cliente_telefono TEXT;`;
  // Vendedor (usuario de Bsale) que emitió la cotización -> para el
  // resumen de desempeño por vendedor en la página.
  await sql`ALTER TABLE bsale_cotizaciones ADD COLUMN IF NOT EXISTS vendedor_id INTEGER;`;
  await sql`ALTER TABLE bsale_cotizaciones ADD COLUMN IF NOT EXISTS vendedor_nombre TEXT;`;
  await sql`
    CREATE TABLE IF NOT EXISTS bsale_cotizaciones_sync_estado (
      id INTEGER PRIMARY KEY DEFAULT 1,
      offset_actual INTEGER NOT NULL DEFAULT 0,
      total_documentos INTEGER,
      ultima_pasada_completa_en TIMESTAMPTZ,
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`INSERT INTO bsale_cotizaciones_sync_estado (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`;
}

// Página "Análisis" — clasificación de clientes por N° de compras reales
// (boletas/facturas, sin cotizaciones ni notas de crédito) en los últimos
// 12 meses. Cada fila es UN documento de venta -> se cuenta con
// COUNT(*) GROUP BY cliente_id al leer (ver manejarAnalisisClientes en
// api/negocio.js), no se guarda un contador aparte, para no arrastrar un
// número desincronizado si la sincronización se corta a mitad de camino
// (mismo patrón resumible que bsale_cotizaciones, ver
// manejarSyncAnalisis).
export async function asegurarTablaAnalisis(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS analisis_compras (
      documento_id INTEGER PRIMARY KEY,
      cliente_id INTEGER NOT NULL,
      cliente_nombre TEXT,
      fecha DATE,
      sincronizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  // Monto del documento -> se agregó después de la tabla original, para
  // poder mostrar "monto total comprado" replicando las columnas de
  // Oportunidades Indexpro.
  await sql`ALTER TABLE analisis_compras ADD COLUMN IF NOT EXISTS monto NUMERIC NOT NULL DEFAULT 0;`;
  // Desglose del monto del documento por categoría (una venta puede tener
  // líneas de más de una categoría a la vez, ej. cargador + servicio de
  // instalación) -> ver categoriaLinea() en manejarSyncAnalisis, misma
  // idea que pareceServicioPorNombre en bsale-sku-report.js pero por
  // texto del detalle en vez de por catálogo, para no tener que traer
  // products.json/product_types.json solo para esto.
  await sql`ALTER TABLE analisis_compras ADD COLUMN IF NOT EXISTS monto_servicios NUMERIC NOT NULL DEFAULT 0;`;
  await sql`ALTER TABLE analisis_compras ADD COLUMN IF NOT EXISTS monto_pantallas NUMERIC NOT NULL DEFAULT 0;`;
  await sql`ALTER TABLE analisis_compras ADD COLUMN IF NOT EXISTS monto_cargadores NUMERIC NOT NULL DEFAULT 0;`;
  await sql`ALTER TABLE analisis_compras ADD COLUMN IF NOT EXISTS monto_baterias NUMERIC NOT NULL DEFAULT 0;`;
  await sql`CREATE INDEX IF NOT EXISTS idx_analisis_compras_cliente ON analisis_compras (cliente_id);`;
  await sql`
    CREATE TABLE IF NOT EXISTS analisis_sync_estado (
      id INTEGER PRIMARY KEY DEFAULT 1,
      offset_actual INTEGER NOT NULL DEFAULT 0,
      total_documentos INTEGER,
      ultima_pasada_completa_en TIMESTAMPTZ,
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`INSERT INTO analisis_sync_estado (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`;

  // Seguimiento manual (contactado/fidelizado) por cliente -> igual que
  // "estado" en Indexpro, esto lo edita una persona, la sincronización
  // nunca lo toca.
  await sql`
    CREATE TABLE IF NOT EXISTS analisis_clientes_estado (
      cliente_id INTEGER PRIMARY KEY,
      estado TEXT NOT NULL DEFAULT 'sin_contactar',
      actualizado_por TEXT,
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  // Nota libre por cliente (ícono 💬 de la tabla) -> igual que "estado",
  // la sincronización nunca la toca.
  await sql`ALTER TABLE analisis_clientes_estado ADD COLUMN IF NOT EXISTS comentario TEXT;`;

  // Exclusión permanente (mismo patrón que indexpro_excluidos): un cliente
  // borrado acá NO debe reaparecer en la próxima sincronización. Se filtra
  // por cliente_id (lo normal, vía el botón 🗑️ de la página) o por
  // cliente_nombre (para poder excluir de una vez clientes puntuales que
  // se pidieron sacar del análisis sin conocer su cliente_id de Bsale).
  await sql`
    CREATE TABLE IF NOT EXISTS analisis_excluidos (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER,
      cliente_nombre TEXT,
      excluido_por TEXT,
      excluido_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`
    INSERT INTO analisis_excluidos (cliente_nombre, excluido_por)
    SELECT nombre, 'sistema' FROM UNNEST(ARRAY[
      'Cristian Guerrero', 'Jova Leiva', 'Felipe Negrete', 'Nathalia Tebre Armas', 'Lesly Prueba'
    ]) AS nombre
    WHERE NOT EXISTS (SELECT 1 FROM analisis_excluidos e WHERE e.cliente_nombre = nombre);
  `;
}

// Ventas por SKU y mes de PRODUCTOS reales (excluye servicios, ver
// api/negocio.js SKUS con prefijo "SER") -- para detectar productos con
// ventas a la baja en los últimos 12 meses (página Análisis, sección
// "Productos con ventas a la baja"). Se llena en la MISMA sincronización
// que ya usa "Clientes recurrentes" (manejarSyncAnalisis) -- ya trae
// documents.json con expand=details, así que agregar esto no suma ni un
// solo llamado extra a Bsale. Mismo criterio de idempotencia que
// analisis_compras/bsale_servicios_ventas: una fila por (documento, sku)
// real, no un contador acumulado -> reprocesar el mismo documento en una
// sincronización posterior pisa la fila en vez de sumar de más. El
// desglose por mes se arma al LEER (GROUP BY date_trunc('month', fecha)),
// no al guardar.
export async function asegurarTablaVentasSku(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS bsale_ventas_sku (
      documento_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      nombre TEXT,
      fecha DATE NOT NULL,
      cantidad NUMERIC NOT NULL DEFAULT 0,
      monto NUMERIC NOT NULL DEFAULT 0,
      sincronizado_en TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (documento_id, sku)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_bsale_ventas_sku_fecha ON bsale_ventas_sku (fecha);`;
}

// Estado manual por SKU en "Productos con ventas a la baja" -- igual que
// analisis_excluidos/indexpro_excluidos (exclusión permanente, no
// reaparece aunque siga cayendo) y analisis_clientes_estado (comentario
// libre, no lo toca la sincronización). Dos tablas separadas por el mismo
// motivo que esos ejemplos: son dos cosas distintas (sacar del análisis
// vs. dejar una nota), no dependen una de la otra.
export async function asegurarTablaVentasSkuEstado(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS ventas_sku_excluidos (
      sku TEXT PRIMARY KEY,
      excluido_por TEXT,
      excluido_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ventas_sku_comentarios (
      sku TEXT PRIMARY KEY,
      comentario TEXT,
      actualizado_por TEXT,
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  // Checkboxes de seguimiento manual por SKU (no se detectan solos, los
  // marca una persona): publicado en Mercado Libre, envío gratis activado,
  // variación de precio hecha -- pedido del usuario para dejar registro de
  // qué acción ya se tomó con cada producto estancado.
  await sql`ALTER TABLE ventas_sku_comentarios ADD COLUMN IF NOT EXISTS mercado_libre BOOLEAN DEFAULT false;`;
  await sql`ALTER TABLE ventas_sku_comentarios ADD COLUMN IF NOT EXISTS envio_gratis BOOLEAN DEFAULT false;`;
  await sql`ALTER TABLE ventas_sku_comentarios ADD COLUMN IF NOT EXISTS variacion_precio BOOLEAN DEFAULT false;`;
}

// Página "Servicio Técnico" — servicios de Bsale (SKU que empieza con
// "SER", ver categoriaLinea en api/negocio.js) vendidos, para verlos por
// mes con variación % mes a mes. Igual que analisis_compras: una fila por
// (documento, sku) real, no un contador acumulado -> reprocesar el mismo
// documento en una sincronización posterior sencillamente pisa la misma
// fila (ON CONFLICT DO UPDATE) en vez de sumar de más. El desglose por
// mes se arma al leer (GROUP BY date_trunc('month', fecha)), no al
// guardar -- ver manejarServiciosPorMes en api/negocio.js.
export async function asegurarTablaServiciosMensual(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS bsale_servicios_ventas (
      documento_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      nombre TEXT,
      fecha DATE NOT NULL,
      cantidad NUMERIC NOT NULL DEFAULT 0,
      monto NUMERIC NOT NULL DEFAULT 0,
      sincronizado_en TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (documento_id, sku)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_bsale_servicios_ventas_fecha ON bsale_servicios_ventas (fecha);`;
  await sql`
    CREATE TABLE IF NOT EXISTS bsale_servicios_sync_estado (
      id INTEGER PRIMARY KEY DEFAULT 1,
      offset_actual INTEGER NOT NULL DEFAULT 0,
      total_documentos INTEGER,
      ultima_pasada_completa_en TIMESTAMPTZ,
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`INSERT INTO bsale_servicios_sync_estado (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`;
}

// Calendario de pagos futuros (Flujo de Caja) — reemplaza la planilla
// Google Sheets que llevaban a mano: una fila por movimiento con fecha,
// categoría (mismas que la planilla: Ingreso, Remuneraciones, Impuestos y
// Previred, Proveedores, Cheques y Cargos, Arriendos, Préstamos, Otros
// egresos) y monto. La categoría "Ingreso" se resta al revés (suma) al
// proyectar el saldo BCI.
export async function asegurarTablaCalendarioPagos(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS calendario_pagos (
      id SERIAL PRIMARY KEY,
      fecha DATE NOT NULL,
      categoria TEXT NOT NULL,
      monto NUMERIC NOT NULL,
      nota TEXT,
      agregado_por TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
}

// Saldo BCI ingresado a mano (no hay integración con el banco) -> junto con
// calendario_pagos permite proyectar el saldo hacia adelante, como la fila
// "SALDO ACUMULADO" de la planilla.
export async function asegurarTablaSaldoBci(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS saldo_bci (
      id INTEGER PRIMARY KEY DEFAULT 1,
      saldo NUMERIC NOT NULL DEFAULT 0,
      actualizado_por TEXT,
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`INSERT INTO saldo_bci (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`;
}

// Stock adicional manual por SKU -> se SUMA al stock que reporta Bsale al
// calcular "stock actual" (ver api/bsale-sku-report.js). Para mercadería ya
// recibida que todavía no se ingresó como stock en Bsale (ej. un lote Daxis
// recién llegado), sin tener que esperar a que se registre allá.
export async function asegurarTablaStockExtra(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS stock_extra (
      sku TEXT PRIMARY KEY,
      nombre TEXT,
      cantidad INTEGER NOT NULL DEFAULT 0,
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  // Lote Daxis confirmado el 12/08/2026 -> se siembra una sola vez (ON
  // CONFLICT DO NOTHING) para no pisar ajustes manuales que se hagan después
  // directo en la tabla.
  await sql`
    INSERT INTO stock_extra (sku, nombre, cantidad) VALUES
      ('CARDXAC02', 'CARGADOR NOTEBOOK DAXIS ACER 19V 2.37A 3.0X1.1MM', 10),
      ('CARDXAC01', 'CARGADOR NOTEBOOK DAXIS ACER 19V 2.37A 5.5X1.7MM', 20),
      ('CARDXAC03', 'CARGADOR NOTEBOOK DAXIS ACER 19V 3.42A 3.0X1.1MM', 15),
      ('CARDXAS07', 'CARGADOR NOTEBOOK DAXIS ASUS 19V 3.42A 4.0X1.35MM', 15),
      ('CARDXDE01', 'CARGADOR NOTEBOOK DAXIS DELL 19.5V 2.31A 4.5X3.0MM', 30),
      ('CARDXDE02', 'CARGADOR NOTEBOOK DAXIS DELL 19.5V 3.34A 4.5X3.0MM', 15),
      ('CARDXHP02', 'CARGADOR NOTEBOOK DAXIS HP 19.5V 3.33A 4.5X3.0MM', 30)
    ON CONFLICT (sku) DO NOTHING;
  `;
}

// Oportunidades comerciales "Indexpro" (servicios a empresas: NAS QNAP,
// soporte TI, etc.) que administra Patricio. La lista base son 100
// clientes de IndexStore preseleccionados a mano por rubro (RM) desde el
// historial de ventas en Bsale -> se siembra UNA vez (ON CONFLICT DO
// NOTHING, no pisa el estado ni el progreso de sincronización si ya
// corrió antes) y después se cruza cada RUT contra Bsale para traer
// nombre real, giro, historial de compras y monto -> ver
// manejarSyncIndexpro en api/negocio.js.
const SEED_INDEXPRO_LEADS = [
  ['77898298-6','Arquitectura','ARQUITECTURA Y DISEÑO LIMITADA','Felipe Negrete'],
  ['76624430-0','Arquitectura','Arquitectura H2 Ltda','venta web'],
  ['77742099-2','Arquitectura','ARQUITECTURA FERIALES MOLINA CARLOS SPA','Nathalia Tebre'],
  ['77535213-2','Arquitectura','SEARLE PUGA ARQUITECTOS LIMITADA','Felipe Negrete'],
  ['76809108-0','Arquitectura','MOCARQUER VIDAL ARQUITECTURA Y CONSTRUCCIÓN LIMITADA','Cristian Painevilo'],
  ['76081365-6','Arquitectura','CARVAJAL CASARIEGO RIESCO RIVERA ARQUITECTOS LIMITADA','Felipe Negrete'],
  ['76047332-4','Construcción','DANIEL ORLANDO VALENZUELA VERGARA INGENIERIA Y OBRAS CIVILES E.I.R.L.','Nathalia Tebre'],
  ['77629144-7','Construcción','Inmobiliaria y Constructora Isometrika Ltda','Felipe Negrete'],
  ['96528140-1','Construcción','CONSTRUCTORA LYD S.A.','Felipe Negrete'],
  ['96691680-K','Construcción','EMPRESA CONSTRUCTORA MENA Y OVALLE S.A.','Nathalia Tebre'],
  ['76605784-5','Construcción','M&P SERVICE ASEO INDUSTRIAL Y OBRAS MENORES EN CONSTRUCCION LIMITADA','Cristian Painevilo'],
  ['76117617-K','Construcción','CONSTRUCTORA BEFCO S.A','Nathalia Tebre'],
  ['76880000-6','Construcción','Constructora Terrafirme Ltda','Fernanda Arias'],
  ['99535300-8','Construcción','INGENIERIA Y CONSTRUCCION COLTAUCO SPA','Luiggi hernandez'],
  ['77303370-6','Construcción','INMOBILIARIA Y CONSTRUCTORA LA PATAGUA LIMITADA','Luiggi hernandez'],
  ['81220300-2','Construcción','CONSTRUCTORA FV S.A.','Cristian Painevilo'],
  ['77700409-3','Construcción','PAZ INGENIERIA Y CONSTRUCCION SPA','Felipe Negrete'],
  ['96649660-6','Construcción','CONSTRUCTORA GPR S A','Felipe Negrete'],
  ['76964335-4','Construcción','CONSTRUCCIONES RODRIGO CARREÑO FERNANDEZ E.I.R.L.','Felipe Negrete'],
  ['79657030-K','Construcción','LAMBDA CONSTRUCCIONES COMPANIA LIMITADA','Nathalia Tebre'],
  ['78041757-9','Construcción','CONSTRUCTORA ISLA PICTON SPA','Nathalia Tebre'],
  ['96550520-2','Construcción','INGENIERIA Y CONSTRUCCIONES C Y T S.A.','Nathalia Tebre'],
  ['76458535-6','Construcción','MONTAJE Y CONSTRUCCION SPA','Nathalia Tebre'],
  ['76023415-K','Construcción','INMOBILIARIA Y CONSTRUCTORA LO RECABARREN LIMITADA','Nathalia Tebre'],
  ['76862776-2','Construcción','Constructora Pepbor SPA','Fernanda Arias'],
  ['76839230-7','Construcción','CONSTRUCTORA C Y C SERVICIOS LTDA','Felipe Negrete'],
  ['76463216-8','Construcción','RUBEN ANDRES ORELLANA MORENO LOREMAR CONSTRUCCIONES E.I.R.L.','Stephanie Nuñez'],
  ['76299890-4','Construcción','E. Molina Morel Constructora S.A','venta web'],
  ['77371716-8','Construcción','CONSTRUCTORA TERRACON SPA','venta web'],
  ['76054280-6','Construcción','constructora vesta spa','Felipe Negrete'],
  ['93343000-6','Construcción','CONSTRUCTORA BIO BIO S.A.','Felipe Negrete'],
  ['77736371-9','Construcción','CONSTRUCTORA UBS LIMITADA','Felipe Negrete'],
  ['78440650-4','Construcción','EMPRESA CONSTRUCTORA ALZERRECA Y DIAZ LIMITADA','Felipe Negrete'],
  ['76092272-2','Construcción','Montajes del Pacifico SPA','Nathalia Tebre'],
  ['79822780-7','Construcción','Inmobiliaria y Constructora Hogares S. A.','Nathalia Tebre'],
  ['76730092-1','Construcción','CONSTRUCTORA STP LIMITADA','Felipe Negrete'],
  ['76099915-6','Construcción','Fabricacion Montajes y Servicios D.J.Ltda.','venta web'],
  ['76706251-6','Construcción','SILGA INGENERIA Y CONSTRUCCION SPA','Nathalia Tebre'],
  ['76733328-5','Construcción','DAMIOS CONSTRUCCIONES SPA','Nathalia Tebre'],
  ['76419148-K','Construcción','C & P DISEÑO, INGENIERIA Y CONSTRUCCION LIMITADA','Felipe Negrete'],
  ['77848090-5','Contabilidad / Auditoría','AMR AUDITORES CONSULTORES SPA','Cristian Painevilo'],
  ['79755470-7','Contabilidad / Auditoría','PKF CHILE AUDITORES CONSULTORES LTDA.','Nathalia Tebre'],
  ['77793172-5','Contabilidad / Auditoría','ASESORIAS CONTABLES Y TRIBUTARIAS CODELMA LIMITADA','Luiggi hernandez'],
  ['79793050-4','Contabilidad / Auditoría','AYC CEPEDA PESCE AUDITORES CONSULTORES LIMITADA','Nathalia Tebre'],
  ['78987530-8','Contabilidad / Auditoría','MONTERRIOS AUDITORES CONSULTORES LIMITADA','Nathalia Tebre'],
  ['76412576-2','Contabilidad / Auditoría','CCL AC AUDITORES CONSULTORES LTDA','venta web'],
  ['78122332-8','Contabilidad / Auditoría','TELECONTADOR SPA','NICOLAS MOLINA'],
  ['77554291-8','Contabilidad / Auditoría','Asesorias Contables y Tributarias JOI Ltda','Nathalia Tebre'],
  ['76024344-2','Diseño / Proyectos','URBANO PROYECTOS S.A','venta web'],
  ['76550397-3','Diseño / Proyectos','SERVICIOS DE MONTAJE Y PROYECTOS TERMICOS LIMITADA','Nathalia Tebre'],
  ['76210058-4','Diseño / Proyectos','ASESORIAS Y PROYECTOS EMPIRICA CONSULTORES SPA','Felipe Negrete'],
  ['76548496-0','Diseño / Proyectos','ACE Proyectos Spa','Nathalia Tebre'],
  ['77958270-1','Estudio Jurídico','Ossandon Abogados Ltda','Felipe Negrete'],
  ['76481651-K','Estudio Jurídico','DUARTE ABOGADOS LIMITADA','Fernanda Arias'],
  ['77667017-0','Estudio Jurídico','FONTAINE ABOGADOS LIMITADA','Felipe Negrete'],
  ['77517295-9','Estudio Jurídico','ASESORIAS JURIDICAS DONOSO LIMITADA','Stephanie Nuñez'],
  ['77361930-1','Ingeniería','INGENIERIA GESTION Y SOFTWARE LIMITADA','venta web'],
  ['79882360-4','Ingeniería','INGENIERIA E INFORMATICA ASOCIADA LIMITADA','Nathalia Tebre'],
  ['77748270-K','Ingeniería','Agea consultoria e ingenieria spa','venta web'],
  ['77760300-0','Ingeniería','FIGUEROA Y DIAZ INGENIEROS ASOCIADOS S.A','Stephanie Nuñez'],
  ['76300404-K','Ingeniería','F UNO INGENIERIA Y TELECOMUNICACIONES LTDA','Felipe Negrete'],
  ['77656970-4','Ingeniería','INGENIERIA E INVERSIONES SANTA CAMILA LIMITADA','venta web'],
  ['76248758-6','Ingeniería','BCTEC INGENIERIA Y TECNOLOGIA SPA','Luis Lizana'],
  ['76265366-4','Ingeniería','NUEVAS VIAS, INGENIERIA Y SERVICIOS LIMITADA','Felipe Negrete'],
  ['96885630-8','Ingeniería','MAURICIO HOCHSCHILD INGENIERIA Y SERVICIOS S. A.','Felipe Negrete'],
  ['76289754-7','Ingeniería','Safetk Ingenieria y Servicios Ltda.','venta web'],
  ['76269723-8','Ingeniería','SERVICIOS E INGENIERIA THERMOTECNIA LIMITADA.','Felipe Negrete'],
  ['76343803-1','Ingeniería','I-SEP INGENIEROS SPA','Felipe Negrete'],
  ['78815840-8','Ingeniería','SOCIEDAD DE INGENIERIA Y CERTIFICACION DE CALIDAD S.A','Felipe Negrete'],
  ['76010315-2','Ingeniería','INGENIERIA Y TELECOMUNICACIONES BOXWORK CHILE LIMITADA','Stephanie Nuñez'],
  ['89233400-5','Ingeniería','METACONTROL INGENIEROS S.A.','Nathalia Tebre'],
  ['76231308-1','Ingeniería','INGENIERIA ALTO SUR SPA','Stephanie Nuñez'],
  ['78164780-2','Ingeniería','INGENIERIA Y PROYECTOS MINEROS SPA','Felipe Negrete'],
  ['76139389-8','Ingeniería','Ingenieria EyT Limitada','venta web'],
  ['79971430-2','Ingeniería','INGENIERIA Y MOVIMIENTO DE TIERRAS TRANEX LIMITADA','Felipe Negrete'],
  ['77631790-K','Ingeniería','TELECTRONIC INGENIERIA Y SERVICIOS LIMITADA','Nathalia Tebre'],
  ['76866307-6','Ingeniería','MADASH INGENIERIA Y CONSTRUCCIÓN SPA','Nathalia Tebre'],
  ['76212187-5','Ingeniería','ATES INGENIERIA Y SERVICIOS SPA','Felipe Negrete'],
  ['77799200-7','Ingeniería','TERMOGAS INGENIERIA TERMICA Y GAS LIMITADA','Nathalia Tebre'],
  ['76922409-2','Ingeniería','INGENIERIA TERMICA LAGOS SPA','Stephanie Nuñez'],
  ['78720140-7','Ingeniería','SERVICIO DE INGENIERIA DIGITALIZACION Y PLOTEO LIMITADA','Fernanda Arias'],
  ['79555420-3','Ingeniería','SOCIEDAD DE INGENIERIA Y SERVICIOS HOGG Y SERRANO LTDA.','Nathalia Tebre'],
  ['96915420-K','Ingeniería','pry ingenieria','venta web'],
  ['76355924-6','Ingeniería','MARCELA ESPINOZA INGENIERIA ELECTRICA Y SERVICIOS E.I.R.L','Nathalia Tebre'],
  ['88542600-K','Ingeniería','Bogado Ingenieros Consultores SpA','venta web'],
  ['76306210-4','Ingeniería','MM INGENIERIA LTDA','Nathalia Tebre'],
  ['76266331-7','Ingeniería','JCA INGENIERIA ELECTRICA','Nathalia Tebre'],
  ['77509791-4','Ingeniería','DELPORTE INGENIEROS SPA','Cristian Painevilo'],
  ['76240780-9','Inmobiliaria','INMOBILIARIA MAGUA LIMITADA','NICOLAS MOLINA'],
  ['76294818-4','Inmobiliaria','IBS ADMINITRACION GESTION INMOBILIARIA LTDA','Fernanda Arias'],
  ['78179641-7','Inmobiliaria','INMOBILIARIA E INVERSIONES HERRE TRES SPA','David Torres'],
  ['76175182-4','Inmobiliaria','INMOBILIARIA DON ROMAN LIMITADA','Felipe Negrete'],
  ['76571734-5','Inmobiliaria','ENTIDAD DE GESTION INMOBILIARIA SOCIAL GIRASOL LIMITADA','Cristian Painevilo'],
  ['78499940-8','Inmobiliaria','SOC UROLOGICA INMOBILIARIA E INVERSIONES MANUEL MONTT LIMITADA','Felipe Negrete'],
  ['96599270-7','Inmobiliaria','INMOBILIARIA MACUL S.A.','Nathalia Tebre'],
  ['77880428-K','Inmobiliaria','PB GESTION INMOBILIARIA LIMITADA','Luiggi hernandez'],
  ['96673250-4','Inmobiliaria','PATAGONICA INMOBILIARIA SPA','Felipe Negrete'],
  ['99507600-4','Inmobiliaria','SOC DE INVERSIONES FACTORING E INMOBILIARIA CHANGRILA SOC ANONIMA','Felipe Negrete'],
  ['76543752-0','Inmobiliaria','PMV DIREXXION INMOBILIARIA LIMITADA','Luiggi hernandez'],
  ['77032471-8','Inmobiliaria','MARIA INES MORA MORA, INMOBILIARIA MORITA EIRL','Felipe Negrete'],
];

export async function asegurarTablaIndexpro(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS indexpro_oportunidades (
      id SERIAL PRIMARY KEY,
      rut TEXT UNIQUE NOT NULL,
      empresa_original TEXT,
      rubro_original TEXT,
      vendedor_original TEXT,
      bsale_cliente_id INTEGER,
      cliente_nombre TEXT,
      giro TEXT,
      telefono TEXT,
      email TEXT,
      num_compras INTEGER,
      monto_total NUMERIC,
      ultima_compra DATE,
      activo_12m BOOLEAN,
      estado TEXT NOT NULL DEFAULT 'sin_contactar',
      actualizado_por TEXT,
      sincronizado_en TIMESTAMPTZ,
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  // Agregada después de la tabla original: cuándo se mandó el correo de
  // presentación comercial automático (botón "primer contacto") -> para
  // avisar si ya se envió antes y no duplicar sin querer.
  await sql`ALTER TABLE indexpro_oportunidades ADD COLUMN IF NOT EXISTS presentacion_enviada_en TIMESTAMPTZ;`;
  // RUT que alguien eliminó a mano de la lista (ej. el cliente de Bsale
  // quedó registrado a nombre de una persona, no de la empresa) -> se
  // recuerda para siempre, así la re-siembra de abajo (que corre en CADA
  // request) no lo vuelve a insertar apenas se borra.
  await sql`
    CREATE TABLE IF NOT EXISTS indexpro_excluidos (
      rut TEXT PRIMARY KEY,
      excluido_por TEXT,
      excluido_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql.query(
    `INSERT INTO indexpro_oportunidades (rut, rubro_original, empresa_original, vendedor_original, giro)
     SELECT t.rut, t.rubro, t.empresa, t.vendedor, t.rubro
     FROM UNNEST ($1::text[], $2::text[], $3::text[], $4::text[]) AS t(rut, rubro, empresa, vendedor)
     WHERE t.rut NOT IN (SELECT rut FROM indexpro_excluidos)
     ON CONFLICT (rut) DO NOTHING;`,
    [
      SEED_INDEXPRO_LEADS.map(x => x[0]),
      SEED_INDEXPRO_LEADS.map(x => x[1]),
      SEED_INDEXPRO_LEADS.map(x => x[2]),
      SEED_INDEXPRO_LEADS.map(x => x[3]),
    ]
  );
  // Cliente de prueba para probar el botón de correo de presentación sin
  // mandarle nada a un cliente real. estado='cotizado' lo deja en el grupo
  // de mayor prioridad del orden por defecto (ver oportunidades-
  // comerciales.html) para que aparezca cerca del principio de la lista.
  await sql`
    INSERT INTO indexpro_oportunidades (rut, empresa_original, rubro_original, vendedor_original, giro, cliente_nombre, email, estado)
    SELECT '00000000-0', '🧪 Cliente de prueba', 'Prueba', 'Sistema', 'Prueba', 'Nicolás Molina', 'nmolina@indexpro.cl', 'cotizado'
    WHERE '00000000-0' NOT IN (SELECT rut FROM indexpro_excluidos)
    ON CONFLICT (rut) DO NOTHING;
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS indexpro_sync_estado (
      id INTEGER PRIMARY KEY DEFAULT 1,
      ultima_pasada_completa_en TIMESTAMPTZ,
      actualizado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`INSERT INTO indexpro_sync_estado (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`;
}

// ==================== Clientes WhatsApp ====================
// Módulo de conversaciones de WhatsApp Business / Cloud API. Se crea en
// orden de dependencia (contactos -> conversaciones -> mensajes/análisis/
// ventas/etiquetas/auditoría) porque hay FOREIGN KEY entre ellas.
//
// "conversación" NO es "cada mensaje" -> es una sesión de mensajes de un
// mismo contacto, cortada cuando pasan más de X horas sin actividad (ver
// whatsapp_config.horas_nueva_conversacion, configurable, 24h por
// defecto). Esa lógica de corte vive en manejarWhatsappWebhook
// (api/negocio.js), no acá.
//
// El webhook real de Meta todavía no está conectado (sin credenciales) ->
// mientras tanto, estas tablas se pueblan con datos demo (ver
// manejarWhatsappDemoSeed) para poder construir y probar toda la interfaz.
// Los datos demo se identifican con es_demo=true en whatsapp_contactos,
// para poder borrarlos de un solo golpe sin afectar datos reales que
// lleguen después por el webhook.
export async function asegurarTablaWhatsapp(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_contactos (
      id SERIAL PRIMARY KEY,
      whatsapp_id TEXT UNIQUE NOT NULL,
      telefono TEXT NOT NULL,
      nombre TEXT,
      primera_conversacion_en TIMESTAMPTZ,
      ultima_conversacion_en TIMESTAMPTZ,
      total_conversaciones INTEGER NOT NULL DEFAULT 0,
      es_demo BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_conversaciones (
      id SERIAL PRIMARY KEY,
      contacto_id INTEGER NOT NULL REFERENCES whatsapp_contactos(id) ON DELETE CASCADE,
      iniciada_en TIMESTAMPTZ NOT NULL,
      cerrada_en TIMESTAMPTZ,
      primer_mensaje_cliente_en TIMESTAMPTZ,
      primera_respuesta_empresa_en TIMESTAMPTZ,
      primera_respuesta_segundos INTEGER,
      estado TEXT NOT NULL DEFAULT 'nueva',
      responsable_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      intencion TEXT,
      categoria TEXT,
      producto TEXT,
      marca TEXT,
      modelo TEXT,
      resultado TEXT,
      motivo_perdida TEXT,
      requiere_seguimiento BOOLEAN NOT NULL DEFAULT false,
      seguimiento_en TIMESTAMPTZ,
      seguimiento_estado TEXT,
      seguimiento_observaciones TEXT,
      venta_detectada BOOLEAN NOT NULL DEFAULT false,
      venta_monto NUMERIC,
      pedido_asociado TEXT,
      cantidad_mensajes INTEGER NOT NULL DEFAULT 0,
      ultimo_mensaje_resumen TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_contacto ON whatsapp_conversaciones (contacto_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_iniciada ON whatsapp_conversaciones (iniciada_en);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_estado ON whatsapp_conversaciones (estado);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_conv_seguimiento ON whatsapp_conversaciones (requiere_seguimiento) WHERE requiere_seguimiento = true;`;
  // Nombre del vendedor que el Análisis IA detecta firmando/mencionado en
  // los mensajes salientes (WhatsApp no dice qué persona del equipo
  // respondió desde la app). Se guarda el nombre crudo SIEMPRE que se
  // detecta, independiente de si ya existe una cuenta de usuario con ese
  // nombre -- responsable_id (el campo real, editable a mano) recién se
  // autocompleta cuando el nombre matchea contra un usuario activo, ver
  // manejarWhatsappAnalizar en api/negocio.js.
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS vendedor_detectado TEXT;`;
  // Link al producto de la tienda Shopify que mejor calza con marca+modelo
  // detectados por el Análisis IA (ver manejarWhatsappAnalizar en
  // api/negocio.js) -- búsqueda "mejor esfuerzo", queda cacheado acá para
  // no golpear la API de Shopify en cada carga del listado.
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS shopify_producto_url TEXT;`;
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS shopify_producto_titulo TEXT;`;
  // % de confianza del match (0-100), heurístico según qué tan específica
  // fue la búsqueda que sí encontró resultado -- ver buscarProductoShopify.
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS shopify_producto_confianza INTEGER;`;
  // Documento de venta real en Bsale del cliente vinculado por teléfono
  // (ver buscarClienteBsalePorTelefono) -- puramente informativo/sugerido,
  // detectado automáticamente; no reemplaza el botón manual "Asociar
  // venta" (venta_detectada/venta_monto/pedido_asociado), que sigue
  // siendo la confirmación humana. Ver buscarVentaBsalePorTelefono.
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS bsale_documento_numero TEXT;`;
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS bsale_documento_tipo TEXT;`;
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS bsale_documento_monto NUMERIC;`;
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS bsale_documento_fecha DATE;`;
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS bsale_documento_url TEXT;`;
  // Origen de la conversación (el "UTM" de WhatsApp): cuando alguien
  // escribe desde un anuncio de "Click to WhatsApp" de Meta (Facebook/
  // Instagram), el primer mensaje trae un objeto "referral" con estos
  // datos -- ver manejarWhatsappWebhook. Contactos que escriben directo
  // (buscaron el número, un link wa.me sin anuncio, etc.) no traen nada
  // de esto, lo cual es información también (fuente_tipo queda NULL).
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS fuente_tipo TEXT;`;
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS fuente_titulo TEXT;`;
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS fuente_url TEXT;`;
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS fuente_id TEXT;`;
  // Qué campos "de trabajo" (intencion/categoria/producto/marca/modelo/
  // resultado/motivo_perdida) ha tocado una persona a mano -- sin esto,
  // el Análisis IA no tenía forma de distinguir "nunca se tocó" de "ya se
  // llenó una vez" y usaba COALESCE(campo, nuevo) para todos: eso protegía
  // ediciones manuales, pero también dejaba un valor de la IA mal leído
  // (ej. un modelo mal leído de una etiqueta) pegado para siempre, porque
  // "Volver a analizar" nunca lo encontraba NULL. Con esta lista, la IA
  // puede corregirse a sí misma en cada reanálisis (incluido el
  // automático que corre en cada mensaje nuevo) sin arriesgarse a pisar
  // algo que una persona ya editó. Ver manejarWhatsappConversaciones (PUT)
  // y ejecutarAnalisisIA.
  await sql`ALTER TABLE whatsapp_conversaciones ADD COLUMN IF NOT EXISTS campos_editados_manualmente TEXT[] NOT NULL DEFAULT '{}';`;

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_mensajes (
      id SERIAL PRIMARY KEY,
      conversacion_id INTEGER NOT NULL REFERENCES whatsapp_conversaciones(id) ON DELETE CASCADE,
      whatsapp_message_id TEXT UNIQUE,
      marca_tiempo TIMESTAMPTZ NOT NULL,
      direccion TEXT NOT NULL,
      origen TEXT,
      tipo TEXT NOT NULL DEFAULT 'texto',
      contenido_texto TEXT,
      media_url TEXT,
      estado TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_msg_conversacion ON whatsapp_mensajes (conversacion_id, marca_tiempo);`;

  // 1:1 con la conversación -> lo llena una futura integración de IA
  // (segunda fase, ver conversación con el usuario). Por ahora se puebla
  // con datos demo para poder mostrar la interfaz completa.
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_analisis_ia (
      conversacion_id INTEGER PRIMARY KEY REFERENCES whatsapp_conversaciones(id) ON DELETE CASCADE,
      resumen TEXT,
      intencion TEXT,
      categoria TEXT,
      producto TEXT,
      marca TEXT,
      modelo TEXT,
      problema_cliente TEXT,
      especificaciones TEXT,
      probabilidad_compra INTEGER,
      resultado TEXT,
      motivo_perdida TEXT,
      sentimiento TEXT,
      calidad_atencion_score INTEGER,
      requiere_seguimiento BOOLEAN,
      observaciones TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  // Agregada después de la tabla original -> detalles técnicos sueltos que
  // el cliente menciona (ej. "65W USB-C", "20V 3.25A") y que el modelo del
  // notebook por sí solo no captura, sobre todo para cargadores (un mismo
  // cargador cubre muchos modelos; lo que distingue es conector/potencia,
  // no el modelo). Se usa para afinar la búsqueda en Shopify, ver
  // buscarProductoShopify en api/negocio.js.
  await sql`ALTER TABLE whatsapp_analisis_ia ADD COLUMN IF NOT EXISTS especificaciones TEXT;`;

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_ventas (
      id SERIAL PRIMARY KEY,
      conversacion_id INTEGER NOT NULL REFERENCES whatsapp_conversaciones(id) ON DELETE CASCADE,
      contacto_id INTEGER NOT NULL REFERENCES whatsapp_contactos(id) ON DELETE CASCADE,
      pedido_externo TEXT,
      fecha_venta DATE,
      monto NUMERIC,
      margen NUMERIC,
      creado_por TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_etiquetas (
      id SERIAL PRIMARY KEY,
      nombre TEXT UNIQUE NOT NULL
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_conversacion_etiquetas (
      conversacion_id INTEGER NOT NULL REFERENCES whatsapp_conversaciones(id) ON DELETE CASCADE,
      etiqueta_id INTEGER NOT NULL REFERENCES whatsapp_etiquetas(id) ON DELETE CASCADE,
      PRIMARY KEY (conversacion_id, etiqueta_id)
    );
  `;

  // Auditoría de cambios manuales (responsable, estado, etiquetas, venta,
  // seguimiento) -> ver punto 36 del pedido.
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_auditoria (
      id SERIAL PRIMARY KEY,
      conversacion_id INTEGER REFERENCES whatsapp_conversaciones(id) ON DELETE CASCADE,
      usuario_email TEXT,
      accion TEXT,
      detalle TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_whatsapp_audit_conversacion ON whatsapp_auditoria (conversacion_id);`;

  // Parámetro configurable de "qué es una conversación nueva" (punto 22 del
  // pedido) -> una sola fila, igual que el resto de las tablas *_estado de
  // este proyecto.
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      horas_nueva_conversacion INTEGER NOT NULL DEFAULT 24
    );
  `;
  await sql`INSERT INTO whatsapp_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`;

  // Idempotencia del webhook (punto 20 del pedido): Meta puede reenviar el
  // mismo evento -> se registra cada whatsapp_message_id ya procesado
  // ANTES de intentar insertarlo como mensaje (más simple que depender
  // solo del UNIQUE de whatsapp_mensajes, porque también hay que decidir
  // si abrir/reusar conversación antes de llegar a esa tabla).
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_webhook_eventos_procesados (
      whatsapp_message_id TEXT PRIMARY KEY,
      procesado_en TIMESTAMPTZ DEFAULT now()
    );
  `;
}

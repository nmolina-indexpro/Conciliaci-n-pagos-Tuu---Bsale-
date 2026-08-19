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

// Facturas de compra a proveedores, ingresadas a mano desde Flujo de Caja
// -> complementa el "Facturas por pagar" automático (que solo lee
// recepciones de Bsale) con las que se pagan por cheque o transferencia y
// se quieren seguir aparte. Si la forma de pago es "cheque", numero_cheque
// y fecha_cobro_cheque quedan disponibles; si es "transferencia", quedan
// NULL.
// Productos de Shopify (cargadores/pantallas/baterías) detectados sin stock.
// Shopify no entrega un histórico de "desde cuándo está en 0" -> se
// reconstruye guardando la primera vez que ESTE sistema lo detecta en 0
// (fecha_detectado) y marcándolo activo=false apenas vuelve a tener stock.
// Si ya estaba agotado antes de que existiera esta tabla, la fecha mostrada
// es la del primer chequeo, no la real.
export async function asegurarTablaShopifyAgotados(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS shopify_agotados (
      producto_id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      categoria TEXT NOT NULL,
      fecha_detectado DATE NOT NULL DEFAULT CURRENT_DATE,
      activo BOOLEAN NOT NULL DEFAULT true
    );
  `;
}

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

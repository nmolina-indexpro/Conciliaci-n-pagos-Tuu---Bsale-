// /api/negocio.js
// Este endpoint reúne TRES recursos que en otro proyecto serían archivos
// separados (productos-criticos, reportes-error, zoho-tickets). Se
// fusionaron a propósito: Vercel (plan Hobby) permite un máximo de 12
// funciones serverless por deployment, y separados el proyecto se pasa del
// límite y el build empieza a fallar silenciosamente (los cambios no se ven
// reflejados aunque el commit sí se subió bien a GitHub).
//
// Se elige el recurso con ?recurso=criticos, ?recurso=reportes o
// ?recurso=zoho-tickets.

import { getSql, asegurarTablaProductosCriticos, asegurarTablaReportesError, asegurarTablaFacturasCompra, asegurarTablaBsalePuntos, asegurarTablaCotizaciones } from '../lib/db.js';
import { usuarioDesdeRequest } from '../lib/auth-node.js';
import { enviarCorreo } from '../lib/mailer.js';

const CORREO_ALERTA = 'nmolina@indexpro.cl';
const ESTADOS_VALIDOS = ['pendiente', 'en progreso', 'resuelto'];
const ZOHO_TIMEOUT_MS = 20000;

export default async function handler(req, res) {
  const sesion = usuarioDesdeRequest(req);
  if (!sesion) return res.status(401).json({ error: 'No hay sesión activa' });

  const recurso = req.query.recurso;
  if (recurso === 'criticos') return manejarCriticos(req, res, sesion);
  if (recurso === 'reportes') return manejarReportes(req, res, sesion);
  if (recurso === 'zoho-tickets') return manejarZohoTickets(req, res, sesion);
  if (recurso === 'alerta-conciliacion') return manejarAlertaConciliacion(req, res, sesion);
  if (recurso === 'facturas-compra') return manejarFacturasCompra(req, res, sesion);
  if (recurso === 'clientes-puntos') return manejarClientesPuntos(req, res, sesion);
  if (recurso === 'sync-clientes-puntos') return manejarSyncClientesPuntos(req, res, sesion);
  if (recurso === 'cotizaciones-clientes') return manejarCotizacionesClientes(req, res, sesion);
  if (recurso === 'sync-cotizaciones') return manejarSyncCotizaciones(req, res, sesion);
  if (recurso === 'cotizacion-estado') return manejarCotizacionEstado(req, res, sesion);
  return res.status(400).json({ error: 'Falta ?recurso=criticos, ?recurso=reportes, ?recurso=zoho-tickets, ?recurso=alerta-conciliacion, ?recurso=facturas-compra, ?recurso=clientes-puntos, ?recurso=sync-clientes-puntos, ?recurso=cotizaciones-clientes, ?recurso=sync-cotizaciones o ?recurso=cotizacion-estado' });
}

// ---------------- Facturas de compra (ingresadas a mano) ----------------
async function manejarFacturasCompra(req, res, sesion) {
  try {
    const sql = await getSql();
    await asegurarTablaFacturasCompra(sql);

    if (req.method === 'GET') {
      // Por defecto, el último mes -> se puede pedir un rango explícito con
      // ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (ej. para ver meses anteriores).
      const hoy = new Date().toISOString().slice(0, 10);
      const haceUnMes = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const desde = req.query.desde || haceUnMes;
      const hasta = req.query.hasta || hoy;
      const { rows } = await sql`
        SELECT * FROM facturas_compra
        WHERE fecha_compra >= ${desde} AND fecha_compra <= ${hasta}
        ORDER BY fecha_compra DESC, created_at DESC;
      `;
      return res.status(200).json({ facturas: rows });
    }

    if (req.method === 'POST') {
      const { proveedor, numeroFactura, monto, fechaCompra, fechaVencimiento, formaPago, numeroCheque, fechaCobroCheque } = req.body || {};
      if (!proveedor || !proveedor.trim()) return res.status(400).json({ error: 'Falta el proveedor' });
      if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
      if (!fechaCompra) return res.status(400).json({ error: 'Falta la fecha de compra' });
      const formaPagoFinal = formaPago === 'cheque' ? 'cheque' : 'transferencia';

      const { rows } = await sql`
        INSERT INTO facturas_compra (
          proveedor, numero_factura, monto, fecha_compra, fecha_vencimiento,
          forma_pago, numero_cheque, fecha_cobro_cheque, agregado_por
        )
        VALUES (
          ${proveedor.trim()}, ${numeroFactura || null}, ${monto}, ${fechaCompra}, ${fechaVencimiento || null},
          ${formaPagoFinal},
          ${formaPagoFinal === 'cheque' ? (numeroCheque || null) : null},
          ${formaPagoFinal === 'cheque' ? (fechaCobroCheque || null) : null},
          ${sesion.nombre || sesion.email}
        )
        RETURNING *;
      `;
      return res.status(200).json({ factura: rows[0] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Falta el id' });
      await sql`DELETE FROM facturas_compra WHERE id = ${id};`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en facturas de compra', detail: String(err) });
  }
}

// ---------------- Alerta de conciliación por correo (botón manual) ----------------
// El contenido (asunto/html/texto) lo arma el frontend (conciliacion.html)
// con el descuadre que está viendo en pantalla -> este endpoint solo lo
// reenvía por el mismo SMTP que ya usa "reportes" (lib/mailer.js).
async function manejarAlertaConciliacion(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { asunto, html, texto } = req.body || {};
  if (!asunto || (!html && !texto)) return res.status(400).json({ error: 'Falta asunto y contenido (html o texto)' });

  const correoResultado = await enviarCorreo({ para: CORREO_ALERTA, asunto, html, texto });
  return res.status(200).json({ correo: correoResultado });
}

// ---------------- Productos críticos (marcados a mano) ----------------
async function manejarCriticos(req, res, sesion) {
  try {
    const sql = await getSql();
    await asegurarTablaProductosCriticos(sql);

    if (req.method === 'GET') {
      const { rows } = await sql`SELECT code, nombre, agregado_por, created_at FROM productos_criticos ORDER BY created_at ASC;`;
      return res.status(200).json({ productos: rows });
    }

    if (req.method === 'POST') {
      const { code, nombre } = req.body || {};
      if (!code) return res.status(400).json({ error: 'Falta el SKU (code)' });
      const codeNorm = code.trim().toUpperCase();
      const { rows } = await sql`
        INSERT INTO productos_criticos (code, nombre, agregado_por)
        VALUES (${codeNorm}, ${nombre || codeNorm}, ${sesion.nombre || sesion.email})
        ON CONFLICT (code) DO UPDATE SET nombre = EXCLUDED.nombre
        RETURNING code, nombre, agregado_por, created_at;
      `;
      return res.status(200).json({ producto: rows[0] });
    }

    if (req.method === 'DELETE') {
      const { code } = req.query;
      if (!code) return res.status(400).json({ error: 'Falta el SKU (code)' });
      await sql`DELETE FROM productos_criticos WHERE code = ${code.trim().toUpperCase()};`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en productos críticos', detail: String(err) });
  }
}

// ---------------- Reportes de error / objeciones ----------------
async function manejarReportes(req, res, sesion) {
  try {
    const sql = await getSql();
    await asegurarTablaReportesError(sql);

    if (req.method === 'GET') {
      const { rows } = sesion.rol === 'admin'
        ? await sql`SELECT * FROM reportes_error ORDER BY created_at DESC;`
        : await sql`SELECT * FROM reportes_error WHERE usuario_email = ${sesion.email} ORDER BY created_at DESC;`;
      return res.status(200).json({ reportes: rows });
    }

    if (req.method === 'POST') {
      const { descripcion, pagina, tipo, skuCode, contexto } = req.body || {};
      if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'Describe el error u objeción, por favor.' });
      const tipoFinal = tipo === 'objecion' ? 'objecion' : 'error';

      const { rows } = await sql`
        INSERT INTO reportes_error (usuario_email, usuario_nombre, descripcion, pagina, tipo, sku_code, contexto)
        VALUES (${sesion.email}, ${sesion.nombre || sesion.email}, ${descripcion.trim()}, ${pagina || null}, ${tipoFinal}, ${skuCode || null}, ${contexto ? JSON.stringify(contexto) : null})
        RETURNING *;
      `;
      const reporte = rows[0];

      const esObjecion = tipoFinal === 'objecion';
      const correoResultado = await enviarCorreo({
        para: CORREO_ALERTA,
        asunto: esObjecion
          ? `Nueva objeción a un resultado — ${sesion.nombre || sesion.email}${skuCode ? ' — SKU ' + skuCode : ''}`
          : `Nuevo reporte de error — ${sesion.nombre || sesion.email}`,
        html: `
          <p>${esObjecion ? 'Se objetó un resultado' : 'Se reportó un error'} en el panel IndexStore.</p>
          <p><b>Usuario:</b> ${sesion.nombre || ''} (${sesion.email})<br>
          <b>Página:</b> ${pagina || 'No especificada'}<br>
          ${skuCode ? `<b>SKU:</b> ${skuCode}<br>` : ''}
          <b>Fecha:</b> ${new Date(reporte.created_at).toLocaleString('es-CL')}</p>
          <p><b>Descripción:</b><br>${(descripcion || '').replace(/\n/g, '<br>')}</p>
          ${contexto ? `<p><b>Datos que estaba viendo:</b><br><code>${JSON.stringify(contexto)}</code></p>` : ''}
        `,
        texto: `${esObjecion ? 'Nueva objeción' : 'Nuevo reporte de error'}.\nUsuario: ${sesion.nombre || ''} (${sesion.email})\nPágina: ${pagina || 'No especificada'}\n${skuCode ? `SKU: ${skuCode}\n` : ''}Descripción: ${descripcion}${contexto ? `\nDatos: ${JSON.stringify(contexto)}` : ''}`,
      });

      return res.status(200).json({ reporte, correo: correoResultado });
    }

    if (req.method === 'PUT') {
      if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede cambiar el estado de un reporte' });
      const { id, estado } = req.body || {};
      if (!id || !estado) return res.status(400).json({ error: 'Falta id o estado' });
      if (!ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

      const { rows } = await sql`
        UPDATE reportes_error SET estado = ${estado}, actualizado_en = now()
        WHERE id = ${id}
        RETURNING *;
      `;
      return res.status(200).json({ reporte: rows[0] });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en reportes de error', detail: String(err) });
  }
}

// ---------------- Clientes Bsale con puntos disponibles (club de puntos) ----------------
// GET /v1/clients.json no tiene filtro por puntos, y la cuenta tiene ~47.000
// clientes habilitados para el programa -> traerlos todos de una sola pasada
// no cabe ni en el límite de 60s de una función Vercel (plan Hobby) ni en el
// límite de ~8 solicitudes/segundo que aplica Bsale (ver
// https://docs.bsale.dev/changelog/). Por eso esto se separa en dos partes:
//
//  - manejarClientesPuntos: SOLO lee de Postgres (rápido, sin llamar a
//    Bsale) — lo que muestra la página en cada carga.
//  - manejarSyncClientesPuntos: la trae de a tandas de ~50s desde Bsale
//    (respetando el rate limit) y las va guardando/actualizando en Postgres,
//    retomando en el "offset" donde quedó la tanda anterior. El frontend
//    encadena llamadas a este endpoint hasta que informa completo:true.
const BSALE_BASE = 'https://api.bsale.io/v1';
// Compartidas por manejarSyncClientesPuntos y manejarSyncCotizaciones (misma
// cuenta de Bsale, mismo rate limit de ~8 req/s aplicado en todo /v1/*).
const PUNTOS_SYNC_PRESUPUESTO_MS = 50000; // deja margen bajo el tope de 60s de Vercel Hobby
const PUNTOS_SYNC_INTERVALO_MIN_MS = 150; // ritmo ~6.5 req/s, bajo el límite de Bsale (8 req/s) con margen
const PUNTOS_SYNC_LIMIT = 50; // máximo permitido por página en clients.json / documents.json

function nombreCliente(c) {
  const full = `${c.firstName || ''} ${c.lastName || ''}`.trim();
  return full || c.company || `Cliente #${c.id}`;
}

async function manejarClientesPuntos(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sql = await getSql();
    await asegurarTablaBsalePuntos(sql);

    const { rows } = await sql`
      SELECT id, nombre, rut, telefono, email, empresa, ciudad, puntos, acumula_puntos, puntos_actualizado
      FROM bsale_clientes_puntos WHERE puntos > 0 ORDER BY puntos DESC;
    `;
    const { rows: estadoRows } = await sql`SELECT * FROM bsale_puntos_sync_estado WHERE id = 1;`;
    const estado = estadoRows[0] || {};

    const clientes = rows.map(r => ({
      id: r.id,
      nombre: r.nombre,
      rut: r.rut,
      telefono: r.telefono,
      email: r.email,
      empresa: r.empresa,
      ciudad: r.ciudad,
      puntos: r.puntos,
      acumulaPuntos: r.acumula_puntos,
      puntosActualizado: r.puntos_actualizado,
    }));

    return res.status(200).json({
      clientes,
      totalConPuntos: clientes.length,
      puntosTotalAcumulados: clientes.reduce((a, c) => a + c.puntos, 0),
      sync: {
        offsetActual: estado.offset_actual || 0,
        totalClientes: estado.total_clientes ?? null,
        ultimaPasadaCompletaEn: estado.ultima_pasada_completa_en || null,
        actualizadoEn: estado.actualizado_en || null,
      },
    });
  } catch (err) {
    return res.status(200).json({ error: 'Error leyendo clientes con puntos', detail: String(err), clientes: [] });
  }
}

// Extrae el correo de la respuesta de un cliente individual
// (GET /clients/{id}.json?expand=contacts): el campo "email" del cliente si
// viene con datos, si no el del primer contacto asociado (con expand,
// "contacts" viene con "items" en vez de solo el "href").
function extraerEmailDetalle(data) {
  if (data.email) return data.email;
  const contactos = data.contacts && Array.isArray(data.contacts.items) ? data.contacts.items : [];
  const conCorreo = contactos.find(c => c.email);
  return conCorreo ? conCorreo.email : '';
}

// Solo un admin puede disparar la sincronización (golpea la API de Bsale
// repetidamente y puede tardar varios minutos en tandas encadenadas).
async function manejarSyncClientesPuntos(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede sincronizar clientes con Bsale' });

  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) return res.status(200).json({ error: 'BSALE_ACCESS_TOKEN no está configurada en el servidor' });

  const inicio = Date.now();
  try {
    const sql = await getSql();
    await asegurarTablaBsalePuntos(sql);

    const { rows: estadoRows } = await sql`SELECT * FROM bsale_puntos_sync_estado WHERE id = 1;`;
    const estado = estadoRows[0] || {};
    let offset = estado.offset_actual || 0;
    let total = estado.total_clientes ?? null;
    let procesados = 0;
    let ultimaPeticion = 0;
    const presupuestoRestante = () => PUNTOS_SYNC_PRESUPUESTO_MS - (Date.now() - inicio);
    const esperarRitmo = async () => {
      const espera = PUNTOS_SYNC_INTERVALO_MIN_MS - (Date.now() - ultimaPeticion);
      if (espera > 0) await new Promise(r => setTimeout(r, espera));
      ultimaPeticion = Date.now();
    };

    // ---- Fase 1: listado paginado (trae rut, teléfono, puntos, etc. de TODOS
    // los clientes activos; el correo del listado casi siempre viene vacío en
    // esta cuenta, se completa en la Fase 2). ----
    let pasadaListadoTerminada = total != null && offset >= total;
    while (!pasadaListadoTerminada && presupuestoRestante() > 0) {
      await esperarRitmo();

      const url = `${BSALE_BASE}/clients.json?limit=${PUNTOS_SYNC_LIMIT}&offset=${offset}&state=0`;
      const r = await fetchConTimeout(url, { headers: { access_token: token } }, 15000);
      if (!r.ok) {
        const texto = await r.text().catch(() => '');
        throw new Error(`Bsale HTTP ${r.status} en clients.json: ${texto.slice(0, 300)}`);
      }
      const data = await r.json();
      const items = data.items || [];
      if (typeof data.count === 'number') total = data.count;

      if (items.length > 0) {
        await sql.query(
          `INSERT INTO bsale_clientes_puntos (id, nombre, rut, telefono, email, empresa, ciudad, puntos, acumula_puntos, puntos_actualizado, sincronizado_en)
           SELECT * FROM UNNEST ($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[], $9::bool[], $10::date[], $11::timestamptz[])
           ON CONFLICT (id) DO UPDATE SET
             nombre = EXCLUDED.nombre, rut = EXCLUDED.rut, telefono = EXCLUDED.telefono,
             email = COALESCE(NULLIF(EXCLUDED.email, ''), bsale_clientes_puntos.email), empresa = EXCLUDED.empresa,
             ciudad = EXCLUDED.ciudad, puntos = EXCLUDED.puntos, acumula_puntos = EXCLUDED.acumula_puntos,
             puntos_actualizado = EXCLUDED.puntos_actualizado, sincronizado_en = EXCLUDED.sincronizado_en;`,
          [
            items.map(c => c.id),
            items.map(nombreCliente),
            items.map(c => c.code || ''),
            items.map(c => c.phone || ''),
            items.map(c => c.email || ''),
            items.map(c => c.company || ''),
            items.map(c => c.city || ''),
            items.map(c => Number(c.points) || 0),
            items.map(c => c.accumulatePoints === 1),
            items.map(c => c.pointsUpdated ? new Date(c.pointsUpdated * 1000).toISOString().slice(0, 10) : null),
            items.map(() => new Date().toISOString()),
          ]
        );
      }

      offset += items.length;
      procesados += items.length;
      pasadaListadoTerminada = items.length < PUNTOS_SYNC_LIMIT || (total != null && offset >= total);
      await sql`UPDATE bsale_puntos_sync_estado SET offset_actual = ${offset}, total_clientes = ${total}, actualizado_en = now() WHERE id = 1;`;
    }

    if (!pasadaListadoTerminada) {
      // Se acabó el presupuesto de esta invocación en plena Fase 1 -> el
      // frontend vuelve a llamar y retoma en el mismo offset.
      return res.status(200).json({ completo: false, fase: 'listado', procesadosEnEstaLlamada: procesados, offsetActual: offset, totalClientes: total });
    }

    // ---- Fase 2: completar el correo caso a caso, SOLO para clientes con
    // puntos > 0 (el subconjunto relevante para esta página, no los ~47.000
    // clientes totales) -> ficha individual (GET /clients/{id}.json) en vez
    // del listado, que es donde según lo confirmado el correo sí viene. ----
    const { rows: pendientesCount } = await sql`
      SELECT COUNT(*)::int AS n FROM bsale_clientes_puntos WHERE puntos > 0 AND (email IS NULL OR email = '');
    `;
    const pendientesCorreo = pendientesCount[0]?.n || 0;

    if (pendientesCorreo === 0) {
      await sql`UPDATE bsale_puntos_sync_estado SET offset_actual = 0, ultima_pasada_completa_en = now(), actualizado_en = now() WHERE id = 1;`;
      return res.status(200).json({ completo: true, fase: 'listado', procesadosEnEstaLlamada: procesados, totalClientes: total });
    }

    const { rows: faltanCorreo } = await sql`
      SELECT id FROM bsale_clientes_puntos WHERE puntos > 0 AND (email IS NULL OR email = '') ORDER BY id LIMIT 2000;
    `;
    let correosCompletados = 0;
    for (const { id } of faltanCorreo) {
      if (presupuestoRestante() <= 0) break;
      await esperarRitmo();

      const url = `${BSALE_BASE}/clients/${id}.json?expand=contacts`;
      const r = await fetchConTimeout(url, { headers: { access_token: token } }, 15000);
      if (!r.ok) {
        if (r.status === 404) continue; // cliente eliminado en Bsale desde el listado -> se salta
        const texto = await r.text().catch(() => '');
        throw new Error(`Bsale HTTP ${r.status} en clients/${id}.json: ${texto.slice(0, 300)}`);
      }
      const data = await r.json();
      const email = extraerEmailDetalle(data);
      await sql`UPDATE bsale_clientes_puntos SET email = ${email}, sincronizado_en = now() WHERE id = ${id};`;
      correosCompletados++;
    }

    const quedanPendientes = pendientesCorreo - correosCompletados;
    if (quedanPendientes <= 0) {
      await sql`UPDATE bsale_puntos_sync_estado SET offset_actual = 0, ultima_pasada_completa_en = now(), actualizado_en = now() WHERE id = 1;`;
      return res.status(200).json({ completo: true, fase: 'correos', procesadosEnEstaLlamada: correosCompletados, totalClientes: total });
    }
    return res.status(200).json({ completo: false, fase: 'correos', procesadosEnEstaLlamada: correosCompletados, pendientesCorreo: quedanPendientes, totalClientes: total });
  } catch (err) {
    return res.status(200).json({ error: 'Error sincronizando clientes con Bsale', detail: String(err) });
  }
}

// ---------------- Cotizaciones de clientes (seguimiento comercial) ----------------
// Documentos tipo "Cotización" en Bsale, para hacerles seguimiento: ¿se
// contactó al cliente?, ¿había comprado antes? Mismo patrón resumible que
// los puntos (ver arriba) porque también depende de /v1/documents.json con
// el mismo rate limit de Bsale.
const COTIZACIONES_DIAS_HISTORIAL = 180; // más allá de eso una cotización está prácticamente muerta para seguimiento
// 'facturada' NO la elige una persona -> la pone sola la Fase 3 cuando
// encuentra la boleta/factura vinculada (ver manejarSyncCotizaciones).
const ESTADOS_COTIZACION = ['sin_contactar', 'contactado', 'contactado_no_responde', 'contactado_segunda_vez', 'facturada'];

function nombreClienteDoc(client) {
  if (!client) return '';
  const full = `${client.firstName || ''} ${client.lastName || ''}`.trim();
  return full || client.company || (client.id ? `Cliente #${client.id}` : '');
}
function esCotizacionDoc(tipoDoc) {
  return /cotizaci[oó]n/i.test(tipoDoc?.name || '');
}
// Una venta real: no es cotización (propuesta, no confirmada) ni nota de
// crédito (devolución) -> mismo criterio que ya usa bsale-sku-report.js.
function esVentaReal(tipoDoc) {
  const nombre = tipoDoc?.name || '';
  if (tipoDoc?.isCreditNote === 1) return false;
  if (/nota de cr[eé]dito/i.test(nombre)) return false;
  if (/cotizaci[oó]n/i.test(nombre)) return false;
  return true;
}

async function manejarCotizacionesClientes(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sql = await getSql();
    await asegurarTablaCotizaciones(sql);

    const { rows } = await sql`
      SELECT id, numero, cliente_id, cliente_nombre, cliente_telefono, monto, fecha, cliente_ha_comprado, estado, actualizado_por, actualizado_en,
             url_cotizacion, documento_asociado_id, documento_asociado_tipo, documento_asociado_numero, documento_asociado_url
      FROM bsale_cotizaciones ORDER BY fecha DESC NULLS LAST, id DESC;
    `;
    const { rows: estadoRows } = await sql`SELECT * FROM bsale_cotizaciones_sync_estado WHERE id = 1;`;
    const estado = estadoRows[0] || {};

    const cotizaciones = rows.map(r => ({
      id: r.id,
      numero: r.numero,
      clienteId: r.cliente_id,
      clienteNombre: r.cliente_nombre,
      clienteTelefono: r.cliente_telefono,
      monto: Number(r.monto) || 0,
      // "fecha" es DATE en Postgres -> el driver lo entrega como Date y
      // res.json() lo serializa completo (...T00:00:00.000Z) si no se
      // recorta acá a YYYY-MM-DD.
      fecha: r.fecha ? new Date(r.fecha).toISOString().slice(0, 10) : null,
      clienteHaComprado: r.cliente_ha_comprado,
      estado: r.estado,
      actualizadoPor: r.actualizado_por,
      actualizadoEn: r.actualizado_en,
      urlCotizacion: r.url_cotizacion,
      documentoAsociadoTipo: r.documento_asociado_tipo,
      documentoAsociadoNumero: r.documento_asociado_numero,
      documentoAsociadoUrl: r.documento_asociado_url,
    }));

    return res.status(200).json({
      cotizaciones,
      estadosDisponibles: ESTADOS_COTIZACION,
      sync: {
        offsetActual: estado.offset_actual || 0,
        totalDocumentos: estado.total_documentos ?? null,
        ultimaPasadaCompletaEn: estado.ultima_pasada_completa_en || null,
      },
    });
  } catch (err) {
    return res.status(200).json({ error: 'Error leyendo cotizaciones', detail: String(err), cotizaciones: [] });
  }
}

async function manejarCotizacionEstado(req, res, sesion) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id, estado } = req.body || {};
  if (!id || !estado) return res.status(400).json({ error: 'Falta id o estado' });
  if (!ESTADOS_COTIZACION.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

  try {
    const sql = await getSql();
    await asegurarTablaCotizaciones(sql);
    const { rows } = await sql`
      UPDATE bsale_cotizaciones SET estado = ${estado}, actualizado_por = ${sesion.nombre || sesion.email}, actualizado_en = now()
      WHERE id = ${id} RETURNING id;
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'Cotización no encontrada' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Error actualizando el estado', detail: String(err) });
  }
}

// Busca en document_types.json el id configurado para "Cotización" en esta
// cuenta -> permite filtrar documents.json en el servidor (documenttypeid=)
// en vez de traer TODOS los documentos del período (180 días es demasiado
// para hacerlo sin filtro). Si no lo encuentra, se sigue funcionando con el
// filtro por nombre client-side (más lento, pero no rompe el módulo).
async function obtenerIdTipoCotizacion(token) {
  const r = await fetchConTimeout(`${BSALE_BASE}/document_types.json?limit=50`, { headers: { access_token: token } }, 15000);
  if (!r.ok) return null;
  const data = await r.json();
  const tipo = (data.items || []).find(t => /cotizaci[oó]n/i.test(t.name || ''));
  return tipo ? tipo.id : null;
}

// Solo un admin puede disparar la sincronización (misma razón que la de
// puntos: golpea la API de Bsale repetidamente).
async function manejarSyncCotizaciones(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede sincronizar cotizaciones con Bsale' });

  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) return res.status(200).json({ error: 'BSALE_ACCESS_TOKEN no está configurada en el servidor' });

  const inicio = Date.now();
  try {
    const sql = await getSql();
    await asegurarTablaCotizaciones(sql);

    const { rows: estadoRows } = await sql`SELECT * FROM bsale_cotizaciones_sync_estado WHERE id = 1;`;
    const estado = estadoRows[0] || {};
    let offset = estado.offset_actual || 0;
    let total = estado.total_documentos ?? null;
    let procesados = 0;
    let ultimaPeticion = 0;
    const presupuestoRestante = () => PUNTOS_SYNC_PRESUPUESTO_MS - (Date.now() - inicio);
    const esperarRitmo = async () => {
      const espera = PUNTOS_SYNC_INTERVALO_MIN_MS - (Date.now() - ultimaPeticion);
      if (espera > 0) await new Promise(r => setTimeout(r, espera));
      ultimaPeticion = Date.now();
    };

    // ---- Fase 1: listado paginado de cotizaciones del período ----
    let pasadaListadoTerminada = total != null && offset >= total;
    if (!pasadaListadoTerminada) {
      const tipoCotizacionId = await obtenerIdTipoCotizacion(token);
      const hastaStr = new Date().toISOString().slice(0, 10);
      const desdeStr = new Date(Date.now() - COTIZACIONES_DIAS_HISTORIAL * 86400000).toISOString().slice(0, 10);
      const rangeStart = Math.floor(new Date(`${desdeStr}T00:00:00-04:00`).getTime() / 1000) - 6 * 3600;
      const rangeEnd = Math.floor(new Date(`${hastaStr}T23:59:59-04:00`).getTime() / 1000) + 6 * 3600;

      while (!pasadaListadoTerminada && presupuestoRestante() > 0) {
        await esperarRitmo();

        // Un solo "expand" (Bsale no combina dos parámetros repetidos):
        // sin documenttypeid hay que traer document_type igual para filtrar
        // client-side qué es realmente una cotización.
        const filtroTipo = tipoCotizacionId ? `&documenttypeid=${tipoCotizacionId}` : '';
        const expandParam = tipoCotizacionId ? 'client' : 'client,document_type';
        const url = `${BSALE_BASE}/documents.json?emissiondaterange=[${rangeStart},${rangeEnd}]${filtroTipo}&expand=${expandParam}&limit=${PUNTOS_SYNC_LIMIT}&offset=${offset}`;
        const r = await fetchConTimeout(url, { headers: { access_token: token } }, 15000);
        if (!r.ok) {
          const texto = await r.text().catch(() => '');
          throw new Error(`Bsale HTTP ${r.status} en documents.json: ${texto.slice(0, 300)}`);
        }
        const data = await r.json();
        const items = data.items || [];
        if (typeof data.count === 'number') total = data.count;

        const cotizaciones = items.filter(d =>
          d.state === 0 && !d.cancellationStatus && (tipoCotizacionId ? true : esCotizacionDoc(d.document_type))
        );

        if (cotizaciones.length > 0) {
          await sql.query(
            `INSERT INTO bsale_cotizaciones (id, numero, cliente_id, cliente_nombre, cliente_telefono, monto, fecha, url_cotizacion, sincronizado_en)
             SELECT * FROM UNNEST ($1::int[], $2::text[], $3::int[], $4::text[], $5::text[], $6::numeric[], $7::date[], $8::text[], $9::timestamptz[])
             ON CONFLICT (id) DO UPDATE SET
               numero = EXCLUDED.numero, cliente_id = EXCLUDED.cliente_id, cliente_nombre = EXCLUDED.cliente_nombre,
               cliente_telefono = EXCLUDED.cliente_telefono, monto = EXCLUDED.monto, fecha = EXCLUDED.fecha,
               url_cotizacion = EXCLUDED.url_cotizacion, sincronizado_en = EXCLUDED.sincronizado_en;`,
            [
              cotizaciones.map(d => d.id),
              cotizaciones.map(d => d.number ? String(d.number) : ''),
              cotizaciones.map(d => d.client?.id || null),
              cotizaciones.map(d => nombreClienteDoc(d.client)),
              cotizaciones.map(d => d.client?.phone || ''),
              cotizaciones.map(d => Number(d.totalAmount) || 0),
              cotizaciones.map(d => d.emissionDate ? new Date(d.emissionDate * 1000).toISOString().slice(0, 10) : null),
              cotizaciones.map(d => d.urlPublicView || d.urlPublicViewOriginal || ''),
              cotizaciones.map(() => new Date().toISOString()),
            ]
          );
        }

        offset += items.length;
        procesados += cotizaciones.length;
        pasadaListadoTerminada = items.length < PUNTOS_SYNC_LIMIT || (total != null && offset >= total);
        await sql`UPDATE bsale_cotizaciones_sync_estado SET offset_actual = ${offset}, total_documentos = ${total}, actualizado_en = now() WHERE id = 1;`;
      }
    }

    if (!pasadaListadoTerminada) {
      return res.status(200).json({ completo: false, fase: 'listado', procesadosEnEstaLlamada: procesados, offsetActual: offset, totalDocumentos: total });
    }

    // ---- Fase 2: por cada cliente con cotización pendiente de revisar,
    // UNA sola consulta a su historial completo (sin rango de fecha) sirve
    // para dos cosas:
    //  a) "cliente_ha_comprado": ¿tiene alguna venta real alguna vez?
    //  b) vincular sus cotizaciones sin resolver con una boleta/factura del
    //     mismo cliente, incluso monto y con fecha igual o posterior a la
    //     cotización. NO se usa el mecanismo de "referencia" de Bsale (era
    //     el intento anterior, por referencenumber) porque una cotización
    //     no es un documento tributario electrónico y esa referencia
    //     nunca aparece -> comparar por cliente+monto+fecha es lo que
    //     realmente funciona con los datos que expone la API pública.
    // (a) SÍ bloquea que la sincronización se marque completa (siempre
    // termina, cada cliente queda resuelto true/false). (b) es best-effort:
    // muchas cotizaciones legítimamente nunca se facturan, así que NO
    // bloquea -> las que queden sin resolver se reintentan en la próxima
    // sincronización completa (por si se facturan más tarde).
    const { rows: clientesPendientes } = await sql`
      SELECT DISTINCT cliente_id FROM bsale_cotizaciones
      WHERE cliente_id IS NOT NULL AND (cliente_ha_comprado IS NULL OR documento_asociado_id IS NULL)
      LIMIT 2000;
    `;
    let clientesRevisados = 0;
    let vinculosEncontrados = 0;
    for (const { cliente_id } of clientesPendientes) {
      if (presupuestoRestante() <= 0) break;
      await esperarRitmo();

      const url = `${BSALE_BASE}/documents.json?clientid=${cliente_id}&expand=document_type&limit=50`;
      const r = await fetchConTimeout(url, { headers: { access_token: token } }, 15000);
      if (!r.ok) {
        const texto = await r.text().catch(() => '');
        throw new Error(`Bsale HTTP ${r.status} en documents.json?clientid=${cliente_id}: ${texto.slice(0, 300)}`);
      }
      const data = await r.json();
      const items = data.items || [];
      let ventas = items.filter(d => d.state === 0 && !d.cancellationStatus && esVentaReal(d.document_type));

      await sql`UPDATE bsale_cotizaciones SET cliente_ha_comprado = ${ventas.length > 0} WHERE cliente_id = ${cliente_id} AND cliente_ha_comprado IS NULL;`;

      const { rows: cotizacionesCliente } = await sql`
        SELECT id, monto, fecha FROM bsale_cotizaciones WHERE cliente_id = ${cliente_id} AND documento_asociado_id IS NULL;
      `;
      for (const cot of cotizacionesCliente) {
        const montoCot = Math.round(Number(cot.monto));
        const idx = ventas.findIndex(d => {
          if (Math.round(Number(d.totalAmount) || 0) !== montoCot) return false;
          if (!cot.fecha || !d.emissionDate) return true;
          const fechaDoc = new Date(d.emissionDate * 1000).toISOString().slice(0, 10);
          return fechaDoc >= new Date(cot.fecha).toISOString().slice(0, 10);
        });
        if (idx === -1) continue;
        const candidata = ventas[idx];
        ventas = ventas.filter((_, i) => i !== idx); // no reusar el mismo documento para otra cotización del mismo cliente
        const urlDoc = candidata.urlPublicView || candidata.urlPublicViewOriginal || '';
        await sql`UPDATE bsale_cotizaciones SET
          documento_asociado_id = ${candidata.id}, documento_asociado_tipo = ${candidata.document_type?.name || ''},
          documento_asociado_numero = ${candidata.number ? String(candidata.number) : ''}, documento_asociado_url = ${urlDoc},
          estado = 'facturada', actualizado_en = now() WHERE id = ${cot.id};`;
        vinculosEncontrados++;
      }
      clientesRevisados++;
    }

    const { rows: pendientesRestantes } = await sql`
      SELECT COUNT(DISTINCT cliente_id)::int AS n FROM bsale_cotizaciones WHERE cliente_id IS NOT NULL AND cliente_ha_comprado IS NULL;
    `;
    const quedanPendientes = pendientesRestantes[0]?.n || 0;

    if (quedanPendientes > 0) {
      return res.status(200).json({ completo: false, fase: 'historial', procesadosEnEstaLlamada: clientesRevisados, vinculosEncontrados, pendientesHistorial: quedanPendientes, totalDocumentos: total });
    }

    const { rows: pendientesVinculoRestantes } = await sql`SELECT COUNT(*)::int AS n FROM bsale_cotizaciones WHERE documento_asociado_id IS NULL;`;

    await sql`UPDATE bsale_cotizaciones_sync_estado SET offset_actual = 0, ultima_pasada_completa_en = now(), actualizado_en = now() WHERE id = 1;`;
    return res.status(200).json({
      completo: true, fase: 'historial', procesadosEnEstaLlamada: clientesRevisados, vinculosEncontrados,
      pendientesVinculo: pendientesVinculoRestantes[0]?.n || 0, totalDocumentos: total,
    });
  } catch (err) {
    return res.status(200).json({ error: 'Error sincronizando cotizaciones con Bsale', detail: String(err) });
  }
}

// ---------------- Zoho Desk (eficiencia de tickets) ----------------
// Variables de entorno requeridas en Vercel:
//   ZOHO_DC             dominio del datacenter de tu cuenta: com, eu, in,
//                        com.au, jp o ca (si no está, se asume "com")
//   ZOHO_CLIENT_ID       de un "Self Client" creado en api-console.zoho.com
//   ZOHO_CLIENT_SECRET   idem
//   ZOHO_REFRESH_TOKEN   token de larga duración generado una sola vez a
//                        partir del "grant token" del Self Client
//   ZOHO_ORG_ID          id de la organización en Zoho Desk (requerido en
//                        TODAS las llamadas a la API de Desk)

async function fetchConTimeout(url, options = {}, timeoutMs = ZOHO_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timeout de ${timeoutMs}ms consultando Zoho`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function obtenerAccessTokenZoho() {
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_DC } = process.env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Faltan credenciales de Zoho en el servidor (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN)');
  }
  const dc = ZOHO_DC || 'com';
  const url = `https://accounts.zoho.${dc}/oauth/v2/token?grant_type=refresh_token`
    + `&client_id=${encodeURIComponent(ZOHO_CLIENT_ID)}`
    + `&client_secret=${encodeURIComponent(ZOHO_CLIENT_SECRET)}`
    + `&refresh_token=${encodeURIComponent(ZOHO_REFRESH_TOKEN)}`;
  const r = await fetchConTimeout(url, { method: 'POST' });
  const data = await r.json();
  if (!data.access_token) throw new Error('No se pudo renovar el access_token de Zoho: ' + JSON.stringify(data));
  return data.access_token;
}

async function manejarZohoTickets(req, res, sesion) {
  try {
    const { ZOHO_ORG_ID, ZOHO_DC } = process.env;
    if (!ZOHO_ORG_ID) return res.status(200).json({ error: 'Falta ZOHO_ORG_ID en el servidor', tickets: [] });
    const dc = ZOHO_DC || 'com';

    const dias = Math.max(1, parseInt(req.query.days || '30', 10));
    const hoy = new Date();
    const desde = new Date(hoy.getTime() - dias * 86400000);

    const accessToken = await obtenerAccessTokenZoho();
    const headers = { orgId: ZOHO_ORG_ID, Authorization: `Zoho-oauthtoken ${accessToken}` };

    // Los tickets vienen ordenados del más nuevo al más viejo -> se puede
    // cortar la paginación apenas se cruza la ventana de fechas pedida, sin
    // tener que traer TODO el histórico cada vez.
    const limit = 100;
    const topePaginas = 30; // hasta ~3.000 tickets recientes como resguardo
    let tickets = [];
    for (let pagina = 0; pagina < topePaginas; pagina++) {
      const from = pagina * limit;
      const url = `https://desk.zoho.${dc}/api/v1/tickets?limit=${limit}&from=${from}&sortBy=-createdTime&include=assignee`;
      const r = await fetchConTimeout(url, { headers });
      if (!r.ok) {
        const texto = await r.text().catch(() => '');
        throw new Error(`Zoho Desk respondió HTTP ${r.status}: ${texto.slice(0, 300)}`);
      }
      const data = await r.json();
      const items = data.data || [];
      tickets.push(...items);
      if (items.length < limit) break;
      const ultimaFecha = items[items.length - 1]?.createdTime;
      if (ultimaFecha && new Date(ultimaFecha) < desde) break;
    }

    const dentroDelPeriodo = tickets.filter(t => t.createdTime && new Date(t.createdTime) >= desde);

    const resumen = dentroDelPeriodo.map(t => {
      const creado = t.createdTime ? new Date(t.createdTime) : null;
      const cerrado = t.closedTime ? new Date(t.closedTime) : null;
      return {
        id: t.id,
        numero: t.ticketNumber,
        asunto: t.subject,
        estado: t.status,
        statusType: t.statusType,
        prioridad: t.priority,
        canal: t.channel,
        creado: t.createdTime,
        cerrado: t.closedTime,
        vencido: !!t.isOverDue,
        respuestaVencida: !!t.isResponseOverdue,
        agente: t.assignee ? `${t.assignee.firstName || ''} ${t.assignee.lastName || ''}`.trim() : null,
        horasResolucion: (creado && cerrado) ? Math.round(((cerrado - creado) / 3600000) * 10) / 10 : null,
      };
    });

    return res.status(200).json({
      dias,
      desde: desde.toISOString().slice(0, 10),
      hasta: hoy.toISOString().slice(0, 10),
      totalTickets: resumen.length,
      tickets: resumen,
    });
  } catch (err) {
    return res.status(200).json({ error: 'Error consultando Zoho Desk', detail: String(err), tickets: [] });
  }
}

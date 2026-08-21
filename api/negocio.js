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

import { getSql, asegurarTablaProductosCriticos, asegurarTablaReportesError, asegurarTablaFacturasCompra, asegurarTablaBsalePuntos, asegurarTablaCotizaciones, asegurarTablaCalendarioPagos, asegurarTablaSaldoBci, asegurarTablaIndexpro } from '../lib/db.js';
import { usuarioDesdeRequest } from '../lib/auth-node.js';
import { enviarCorreo, enviarCorreoIndexpro } from '../lib/mailer.js';

const CORREO_ALERTA = 'nmolina@indexpro.cl';
const ESTADOS_VALIDOS = ['pendiente', 'en progreso', 'resuelto'];
const RESPONSABLE_REPORTES = 'Nicolás Molina'; // fijo por ahora, ver reportar-error.html
const URL_REPORTES = 'https://conciliaci-n-pagos-tuu-bsale.vercel.app/reportar-error.html';
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
  if (recurso === 'calendario-pagos') return manejarCalendarioPagos(req, res, sesion);
  if (recurso === 'calendario-pagos-importar') return manejarCalendarioPagosImportar(req, res, sesion);
  if (recurso === 'saldo-bci') return manejarSaldoBci(req, res, sesion);
  if (recurso === 'indexpro-oportunidades') return manejarIndexproOportunidades(req, res, sesion);
  if (recurso === 'sync-indexpro') return manejarSyncIndexpro(req, res, sesion);
  if (recurso === 'indexpro-estado') return manejarIndexproEstado(req, res, sesion);
  if (recurso === 'indexpro-historial') return manejarIndexproHistorial(req, res, sesion);
  if (recurso === 'indexpro-enviar-presentacion') return manejarIndexproEnviarPresentacion(req, res, sesion);
  return res.status(400).json({ error: 'Falta ?recurso=criticos, ?recurso=reportes, ?recurso=zoho-tickets, ?recurso=alerta-conciliacion, ?recurso=facturas-compra, ?recurso=clientes-puntos, ?recurso=sync-clientes-puntos, ?recurso=cotizaciones-clientes, ?recurso=sync-cotizaciones, ?recurso=cotizacion-estado, ?recurso=calendario-pagos, ?recurso=calendario-pagos-importar, ?recurso=saldo-bci, ?recurso=indexpro-oportunidades, ?recurso=sync-indexpro, ?recurso=indexpro-estado, ?recurso=indexpro-historial o ?recurso=indexpro-enviar-presentacion' });
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

// ---------------- Calendario de pagos futuros (Flujo de Caja) ----------------
// Reemplaza la planilla Google Sheets que usaban para ir anotando pagos e
// ingresos futuros por categoría. Mismas categorías que la planilla.
const CATEGORIAS_CALENDARIO_PAGOS = [
  'Ingreso', 'Remuneraciones', 'Intereses Línea de Sobregiro', 'Financiamiento o Crédito',
  'Impuestos y Previred', 'Proveedores', 'Cheques y Cargos', 'Arriendos',
  'Tarjeta Crédito $', 'Tarjeta Crédito USD', 'Retiros', 'Préstamos', 'Otros egresos',
];

async function manejarCalendarioPagos(req, res, sesion) {
  try {
    const sql = await getSql();
    await asegurarTablaCalendarioPagos(sql);

    if (req.method === 'GET') {
      // Por defecto, el mes actual -> el calendario en el frontend pide
      // explícitamente ?desde=&hasta= del mes que esté mostrando.
      const hoy = new Date().toISOString().slice(0, 10);
      const desde = req.query.desde || hoy.slice(0, 8) + '01';
      const hasta = req.query.hasta || hoy;
      const { rows } = await sql`
        SELECT * FROM calendario_pagos
        WHERE fecha >= ${desde} AND fecha <= ${hasta}
        ORDER BY fecha ASC, created_at ASC;
      `;
      const movimientos = rows.map(r => ({
        id: r.id,
        fecha: r.fecha ? new Date(r.fecha).toISOString().slice(0, 10) : null,
        categoria: r.categoria,
        monto: Number(r.monto) || 0,
        nota: r.nota,
        agregadoPor: r.agregado_por,
      }));
      return res.status(200).json({ movimientos, categorias: CATEGORIAS_CALENDARIO_PAGOS });
    }

    if (req.method === 'POST') {
      const { fecha, categoria, monto, nota } = req.body || {};
      if (!fecha) return res.status(400).json({ error: 'Falta la fecha' });
      if (!CATEGORIAS_CALENDARIO_PAGOS.includes(categoria)) return res.status(400).json({ error: 'Categoría inválida' });
      if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

      const { rows } = await sql`
        INSERT INTO calendario_pagos (fecha, categoria, monto, nota, agregado_por)
        VALUES (${fecha}, ${categoria}, ${monto}, ${nota || null}, ${sesion.nombre || sesion.email})
        RETURNING *;
      `;
      return res.status(200).json({ movimiento: rows[0] });
    }

    if (req.method === 'PUT') {
      const { id, fecha, categoria, monto, nota } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Falta el id' });
      if (!CATEGORIAS_CALENDARIO_PAGOS.includes(categoria)) return res.status(400).json({ error: 'Categoría inválida' });
      if (!monto || Number(monto) <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });

      const { rows } = await sql`
        UPDATE calendario_pagos SET fecha = ${fecha}, categoria = ${categoria}, monto = ${monto}, nota = ${nota || null}
        WHERE id = ${id} RETURNING *;
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
      return res.status(200).json({ movimiento: rows[0] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Falta el id' });
      await sql`DELETE FROM calendario_pagos WHERE id = ${id};`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en calendario de pagos', detail: String(err) });
  }
}

// ---------------- Saldo BCI (ingresado a mano) ----------------
async function manejarSaldoBci(req, res, sesion) {
  try {
    const sql = await getSql();
    await asegurarTablaSaldoBci(sql);

    if (req.method === 'GET') {
      const { rows } = await sql`SELECT * FROM saldo_bci WHERE id = 1;`;
      const r = rows[0] || {};
      return res.status(200).json({
        saldo: Number(r.saldo) || 0,
        actualizadoPor: r.actualizado_por || null,
        actualizadoEn: r.actualizado_en || null,
      });
    }

    if (req.method === 'PUT') {
      const { saldo } = req.body || {};
      if (saldo === undefined || saldo === null || isNaN(Number(saldo))) return res.status(400).json({ error: 'Saldo inválido' });
      const { rows } = await sql`
        UPDATE saldo_bci SET saldo = ${saldo}, actualizado_por = ${sesion.nombre || sesion.email}, actualizado_en = now()
        WHERE id = 1 RETURNING *;
      `;
      const r = rows[0];
      return res.status(200).json({ saldo: Number(r.saldo) || 0, actualizadoPor: r.actualizado_por, actualizadoEn: r.actualizado_en });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en saldo BCI', detail: String(err) });
  }
}

// Importación masiva única (migración de la planilla Google Sheets a este
// calendario) -> inserta muchos movimientos de una vez con UNNEST en vez de
// una llamada por fila (que con ~1.300 filas sería demasiado lento/pesado
// desde el navegador). Solo admin: es una operación de una sola vez, no
// pensada para uso repetido.
async function manejarCalendarioPagosImportar(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede importar' });

  const { movimientos, saldoBci } = req.body || {};
  if (!Array.isArray(movimientos) || movimientos.length === 0) return res.status(400).json({ error: 'Falta el arreglo de movimientos' });

  const invalido = movimientos.find(m => !m.fecha || !CATEGORIAS_CALENDARIO_PAGOS.includes(m.categoria) || !(Number(m.monto) > 0));
  if (invalido) return res.status(400).json({ error: 'Movimiento inválido en la importación', detail: JSON.stringify(invalido) });

  try {
    const sql = await getSql();
    await asegurarTablaCalendarioPagos(sql);
    await asegurarTablaSaldoBci(sql);

    const agregadoPor = sesion.nombre || sesion.email;
    // UNNEST en tandas de 500 -> evita mandar un statement gigante de una vez.
    const TAMANO_TANDA = 500;
    let insertados = 0;
    for (let i = 0; i < movimientos.length; i += TAMANO_TANDA) {
      const tanda = movimientos.slice(i, i + TAMANO_TANDA);
      await sql.query(
        `INSERT INTO calendario_pagos (fecha, categoria, monto, agregado_por)
         SELECT * FROM UNNEST ($1::date[], $2::text[], $3::numeric[], $4::text[]);`,
        [
          tanda.map(m => m.fecha),
          tanda.map(m => m.categoria),
          tanda.map(m => Number(m.monto)),
          tanda.map(() => agregadoPor),
        ]
      );
      insertados += tanda.length;
    }

    if (saldoBci && saldoBci.valor !== undefined && saldoBci.valor !== null && !isNaN(Number(saldoBci.valor))) {
      await sql`
        UPDATE saldo_bci SET saldo = ${saldoBci.valor}, actualizado_por = ${agregadoPor + ' (importado de planilla)'}, actualizado_en = now()
        WHERE id = 1;
      `;
    }

    return res.status(200).json({ ok: true, insertados });
  } catch (err) {
    return res.status(500).json({ error: 'Error importando movimientos', detail: String(err) });
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
      if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'Describe el error u observación, por favor.' });
      const tipoFinal = ['objecion', 'observacion'].includes(tipo) ? tipo : 'error';

      const { rows } = await sql`
        INSERT INTO reportes_error (usuario_email, usuario_nombre, descripcion, pagina, tipo, sku_code, contexto)
        VALUES (${sesion.email}, ${sesion.nombre || sesion.email}, ${descripcion.trim()}, ${pagina || null}, ${tipoFinal}, ${skuCode || null}, ${contexto ? JSON.stringify(contexto) : null})
        RETURNING *;
      `;
      const reporte = rows[0];

      const etiquetaTipo = tipoFinal === 'objecion' ? 'Objeción' : (tipoFinal === 'observacion' ? 'Observación' : 'Error');
      const correoResultado = await enviarCorreo({
        para: CORREO_ALERTA,
        asunto: `Nuevo reporte #${reporte.id} (${etiquetaTipo}) — ${sesion.nombre || sesion.email}${skuCode ? ' — SKU ' + skuCode : ''}`,
        html: `
          <p>Se registró un nuevo reporte en el panel IndexStore.</p>
          <p><b>ID:</b> #${reporte.id}<br>
          <b>Tipo:</b> ${etiquetaTipo}<br>
          <b>Responsable:</b> ${RESPONSABLE_REPORTES}<br>
          <b>Usuario:</b> ${sesion.nombre || ''} (${sesion.email})<br>
          <b>Página:</b> ${pagina || 'No especificada'}<br>
          ${skuCode ? `<b>SKU:</b> ${skuCode}<br>` : ''}
          <b>Fecha:</b> ${new Date(reporte.created_at).toLocaleString('es-CL')}</p>
          <p><b>Descripción:</b><br>${(descripcion || '').replace(/\n/g, '<br>')}</p>
          ${contexto ? `<p><b>Datos que estaba viendo:</b><br><code>${JSON.stringify(contexto)}</code></p>` : ''}
          <p><a href="${URL_REPORTES}">Ver en la página de reportes →</a></p>
        `,
        texto: `Nuevo reporte #${reporte.id} (${etiquetaTipo}).\nResponsable: ${RESPONSABLE_REPORTES}\nUsuario: ${sesion.nombre || ''} (${sesion.email})\nPágina: ${pagina || 'No especificada'}\n${skuCode ? `SKU: ${skuCode}\n` : ''}Descripción: ${descripcion}${contexto ? `\nDatos: ${JSON.stringify(contexto)}` : ''}\n\nVer en la página de reportes: ${URL_REPORTES}`,
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

    if (req.method === 'DELETE') {
      if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede eliminar un reporte' });
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Falta id' });
      await sql`DELETE FROM reportes_error WHERE id = ${id};`;
      return res.status(200).json({ ok: true });
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
      // DATE de Postgres -> el driver lo entrega como Date y res.json() lo
      // serializa completo (...T00:00:00.000Z) si no se recorta acá.
      puntosActualizado: r.puntos_actualizado ? new Date(r.puntos_actualizado).toISOString().slice(0, 10) : null,
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
// 'mercado_publico' y 'perdida' se agregaron después de ver la planilla
// real con la que hacen seguimiento (además de "Contactado" y "Venta
// concretada", que es como le llaman ellos a lo que acá es 'facturada').
// 'facturada' NO la elige una persona -> la pone sola la Fase 2 cuando
// encuentra la boleta/factura vinculada (ver manejarSyncCotizaciones).
const ESTADOS_COTIZACION = ['sin_contactar', 'contactado', 'contactado_no_responde', 'contactado_segunda_vez', 'mercado_publico', 'perdida', 'facturada'];

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
             url_cotizacion, documento_asociado_id, documento_asociado_tipo, documento_asociado_numero, documento_asociado_url,
             vendedor_id, vendedor_nombre
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
      vendedorId: r.vendedor_id,
      vendedorNombre: r.vendedor_nombre,
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

// Mapa id -> nombre de los usuarios de Bsale (vendedores). El documento
// trae "user" con solo el id (expand no lo completa con el nombre) -> se
// resuelve una sola vez por sincronización con /v1/users.json. Se pagina
// completo (no basta con "limit=50 y listo": una cuenta puede tener más de
// 50 usuarios entre activos e inactivos, y justo el que falte puede ser el
// vendedor de una cotización -> aparecía como "Usuario #51" en vez del
// nombre real).
async function obtenerMapaVendedores(token) {
  const mapa = new Map();
  const limit = 50;
  let offset = 0;
  let total = null;
  const topeSeguridad = 10; // 500 usuarios como resguardo
  for (let pagina = 0; pagina < topeSeguridad; pagina++) {
    const r = await fetchConTimeout(`${BSALE_BASE}/users.json?limit=${limit}&offset=${offset}`, { headers: { access_token: token } }, 15000);
    if (!r.ok) break;
    const data = await r.json();
    const items = data.items || [];
    if (typeof data.count === 'number') total = data.count;
    for (const u of items) {
      const nombre = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || `Usuario #${u.id}`;
      mapa.set(u.id, nombre);
    }
    offset += items.length;
    if (items.length < limit || (total != null && offset >= total)) break;
  }
  return mapa;
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
      const vendedoresPorId = await obtenerMapaVendedores(token);
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
        const expandParam = tipoCotizacionId ? 'client,user' : 'client,document_type,user';
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
            `INSERT INTO bsale_cotizaciones (id, numero, cliente_id, cliente_nombre, cliente_telefono, monto, fecha, url_cotizacion, vendedor_id, vendedor_nombre, sincronizado_en)
             SELECT * FROM UNNEST ($1::int[], $2::text[], $3::int[], $4::text[], $5::text[], $6::numeric[], $7::date[], $8::text[], $9::int[], $10::text[], $11::timestamptz[])
             ON CONFLICT (id) DO UPDATE SET
               numero = EXCLUDED.numero, cliente_id = EXCLUDED.cliente_id, cliente_nombre = EXCLUDED.cliente_nombre,
               cliente_telefono = EXCLUDED.cliente_telefono, monto = EXCLUDED.monto, fecha = EXCLUDED.fecha,
               url_cotizacion = EXCLUDED.url_cotizacion, vendedor_id = EXCLUDED.vendedor_id,
               vendedor_nombre = EXCLUDED.vendedor_nombre, sincronizado_en = EXCLUDED.sincronizado_en;`,
            [
              cotizaciones.map(d => d.id),
              cotizaciones.map(d => d.number ? String(d.number) : ''),
              cotizaciones.map(d => d.client?.id || null),
              cotizaciones.map(d => nombreClienteDoc(d.client)),
              cotizaciones.map(d => d.client?.phone || ''),
              cotizaciones.map(d => Number(d.totalAmount) || 0),
              cotizaciones.map(d => d.emissionDate ? new Date(d.emissionDate * 1000).toISOString().slice(0, 10) : null),
              cotizaciones.map(d => d.urlPublicView || d.urlPublicViewOriginal || ''),
              cotizaciones.map(d => d.user?.id || null),
              cotizaciones.map(d => vendedoresPorId.get(d.user?.id) || (d.user?.id ? `Usuario #${d.user.id}` : '')),
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
        // Tolerancia de $2: confirmado con un export real de Bsale (60
        // cotizaciones de agosto) que el monto del documento generado
        // puede venir $1 distinto al de la cotización (redondeo), aunque
        // en la enorme mayoría de los casos calza exacto.
        const candidatos = ventas
          .map((d, i) => ({ d, i, diff: Math.abs((Math.round(Number(d.totalAmount) || 0)) - montoCot) }))
          .filter(({ d, diff }) => {
            if (diff > 2) return false;
            if (!cot.fecha || !d.emissionDate) return true;
            const fechaDoc = new Date(d.emissionDate * 1000).toISOString().slice(0, 10);
            return fechaDoc >= new Date(cot.fecha).toISOString().slice(0, 10);
          })
          .sort((a, b) => a.diff - b.diff);
        if (candidatos.length === 0) continue;
        const { d: candidata, i: idx } = candidatos[0];
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

// ---------------- Indexpro: oportunidades de servicios a empresas (NAS, soporte TI) ----------------
// Administra Patricio. Parte de una lista de 100 clientes de IndexStore
// preseleccionados a mano por rubro (ver SEED_INDEXPRO_LEADS en
// lib/db.js, extraída de la selección real ya hecha en
// data/leads_100_nas_qnap_RM.xlsx del proyecto indexpro.cl) -> se cruza
// cada RUT contra Bsale para traer nombre real, giro, historial de
// compras y monto. El score usa el MISMO criterio que ya se usaba en
// ventas/leads-priorizados-nas.xlsx: 55% monto histórico + 25% N° de
// compras + 20% si compró en los últimos 12 meses, todo normalizado 0-1
// contra el resto de la lista -> el cálculo se hace en el frontend
// porque depende del máximo/mínimo del conjunto completo cargado en ese
// momento (igual que la fórmula original de la planilla).
// 'primer_correo' NO la elige una persona -> la pone sola el envío del
// correo de presentación (ver manejarIndexproEnviarPresentacion).
const ESTADOS_INDEXPRO = ['sin_contactar', 'primer_correo', 'contactado', 'cotizado', 'ganado', 'perdido'];

async function manejarIndexproOportunidades(req, res, sesion) {
  if (req.method === 'DELETE') {
    if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede eliminar oportunidades' });
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta el id' });
    try {
      const sql = await getSql();
      await asegurarTablaIndexpro(sql);
      // Se recuerda el RUT en indexpro_excluidos ANTES de borrar -> si no,
      // la re-siembra de la próxima vez que corra asegurarTablaIndexpro
      // (o sea, en el próximo request a esta misma página) lo vuelve a
      // insertar apenas se borra, porque para esa siembra ya no hay
      // conflicto de RUT.
      const { rows } = await sql`SELECT rut FROM indexpro_oportunidades WHERE id = ${id};`;
      if (rows[0]) {
        await sql`INSERT INTO indexpro_excluidos (rut, excluido_por) VALUES (${rows[0].rut}, ${sesion.nombre || sesion.email}) ON CONFLICT (rut) DO NOTHING;`;
      }
      await sql`DELETE FROM indexpro_oportunidades WHERE id = ${id};`;
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Error eliminando la oportunidad', detail: String(err) });
    }
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sql = await getSql();
    await asegurarTablaIndexpro(sql);

    const { rows } = await sql`SELECT * FROM indexpro_oportunidades ORDER BY empresa_original ASC;`;
    const { rows: estadoRows } = await sql`SELECT * FROM indexpro_sync_estado WHERE id = 1;`;
    const estado = estadoRows[0] || {};

    const oportunidades = rows.map(r => ({
      id: r.id,
      rut: r.rut,
      empresaOriginal: r.empresa_original,
      rubroOriginal: r.rubro_original,
      vendedorOriginal: r.vendedor_original,
      encontradoEnBsale: r.bsale_cliente_id != null && r.bsale_cliente_id > 0,
      clienteNombre: r.cliente_nombre || r.empresa_original,
      giro: r.giro || r.rubro_original,
      telefono: r.telefono,
      email: r.email,
      numCompras: r.num_compras,
      montoTotal: r.monto_total != null ? Number(r.monto_total) : null,
      ultimaCompra: r.ultima_compra ? new Date(r.ultima_compra).toISOString().slice(0, 10) : null,
      activo12m: r.activo_12m,
      estado: r.estado,
      actualizadoPor: r.actualizado_por,
      sincronizadoEn: r.sincronizado_en,
      presentacionEnviadaEn: r.presentacion_enviada_en,
    }));

    return res.status(200).json({
      oportunidades,
      estadosDisponibles: ESTADOS_INDEXPRO,
      sync: { ultimaPasadaCompletaEn: estado.ultima_pasada_completa_en || null },
    });
  } catch (err) {
    return res.status(200).json({ error: 'Error leyendo oportunidades Indexpro', detail: String(err), oportunidades: [] });
  }
}

async function manejarIndexproEstado(req, res, sesion) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { id, estado } = req.body || {};
  if (!id || !estado) return res.status(400).json({ error: 'Falta id o estado' });
  if (!ESTADOS_INDEXPRO.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  try {
    const sql = await getSql();
    await asegurarTablaIndexpro(sql);
    const { rows } = await sql`
      UPDATE indexpro_oportunidades SET estado = ${estado}, actualizado_por = ${sesion.nombre || sesion.email}, actualizado_en = now()
      WHERE id = ${id} RETURNING id;
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Error actualizando el estado', detail: String(err) });
  }
}

// "81220300-2" -> "81.220.300-2" (formato chileno estándar, puntos cada 3
// dígitos antes del guion).
function formatearRutConPuntos(rutSinPuntos) {
  const [cuerpo, dv] = rutSinPuntos.split('-');
  if (!dv) return rutSinPuntos;
  return `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
}

async function buscarClientePorRut(token, rut) {
  const r = await fetchConTimeout(`${BSALE_BASE}/clients.json?code=${encodeURIComponent(rut)}&limit=5`, { headers: { access_token: token } }, 15000);
  if (!r.ok) {
    const texto = await r.text().catch(() => '');
    throw new Error(`Bsale HTTP ${r.status} en clients.json?code=${rut}: ${texto.slice(0, 300)}`);
  }
  const data = await r.json();
  const items = data.items || [];
  return items.find(c => c.state === 0) || items[0] || null;
}

// Historial completo de compras reales (boleta/factura, activas) de un
// cliente Bsale, paginado -> usado para calcular N° compras, monto total,
// última compra y si sigue activo.
async function obtenerHistorialCompras(token, clienteId) {
  const limit = 50;
  let offset = 0;
  let total = null;
  let items = [];
  const topePaginas = 6; // 300 documentos como resguardo
  for (let pagina = 0; pagina < topePaginas; pagina++) {
    const r = await fetchConTimeout(`${BSALE_BASE}/documents.json?clientid=${clienteId}&expand=document_type&limit=${limit}&offset=${offset}`, { headers: { access_token: token } }, 15000);
    if (!r.ok) {
      const texto = await r.text().catch(() => '');
      throw new Error(`Bsale HTTP ${r.status} en documents.json?clientid=${clienteId}: ${texto.slice(0, 300)}`);
    }
    const data = await r.json();
    const pageItems = data.items || [];
    if (typeof data.count === 'number') total = data.count;
    items = items.concat(pageItems);
    offset += pageItems.length;
    if (pageItems.length < limit || (total != null && offset >= total)) break;
  }
  return items.filter(d => d.state === 0 && !d.cancellationStatus && esVentaReal(d.document_type));
}

// Solo admin: golpea la API de Bsale repetidamente (RUT por RUT, y después
// historial por cliente). Con solo 100 leads normalmente termina en una
// sola corrida, pero queda resumible por si acaso.
async function manejarSyncIndexpro(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede sincronizar con Bsale' });

  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) return res.status(200).json({ error: 'BSALE_ACCESS_TOKEN no está configurada en el servidor' });

  const inicio = Date.now();
  try {
    const sql = await getSql();
    await asegurarTablaIndexpro(sql);

    let ultimaPeticion = 0;
    const presupuestoRestante = () => PUNTOS_SYNC_PRESUPUESTO_MS - (Date.now() - inicio);
    const esperarRitmo = async () => {
      const espera = PUNTOS_SYNC_INTERVALO_MIN_MS - (Date.now() - ultimaPeticion);
      if (espera > 0) await new Promise(r => setTimeout(r, espera));
      ultimaPeticion = Date.now();
    };

    // ---- Fase 1: buscar cada RUT en Bsale ----
    const { rows: pendientesMatch } = await sql`SELECT id, rut, rubro_original FROM indexpro_oportunidades WHERE bsale_cliente_id IS NULL;`;
    let matcheados = 0;
    for (const fila of pendientesMatch) {
      if (presupuestoRestante() <= 0) {
        return res.status(200).json({ completo: false, fase: 'match', procesadosEnEstaLlamada: matcheados });
      }
      await esperarRitmo();

      // No sabemos con certeza si Bsale guarda el RUT con o sin puntos ->
      // se intenta primero sin puntos y, si no aparece nadie, se reintenta
      // con puntos (formato chileno estándar) antes de darlo por no
      // encontrado.
      const rutLimpio = fila.rut.replace(/\./g, '');
      let candidato = await buscarClientePorRut(token, rutLimpio);
      if (!candidato) {
        await esperarRitmo();
        candidato = await buscarClientePorRut(token, formatearRutConPuntos(rutLimpio));
      }

      if (candidato) {
        await sql`
          UPDATE indexpro_oportunidades SET
            bsale_cliente_id = ${candidato.id}, cliente_nombre = ${nombreCliente(candidato)},
            giro = ${candidato.activity || fila.rubro_original}, telefono = ${candidato.phone || ''},
            email = ${candidato.email || ''}, actualizado_en = now()
          WHERE id = ${fila.id};`;
      } else {
        // -1 = se buscó y no se encontró (distinto de NULL = "todavía no se
        // buscó") -> no lo reintenta en cada sincronización.
        await sql`UPDATE indexpro_oportunidades SET bsale_cliente_id = -1, actualizado_en = now() WHERE id = ${fila.id};`;
      }
      matcheados++;
    }

    // ---- Fase 2: historial de compras de cada cliente ya encontrado ----
    const { rows: pendientesHistorial } = await sql`
      SELECT id, bsale_cliente_id FROM indexpro_oportunidades WHERE bsale_cliente_id > 0 AND sincronizado_en IS NULL;
    `;
    let historiales = 0;
    const haceUnAnio = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    for (const fila of pendientesHistorial) {
      if (presupuestoRestante() <= 0) {
        return res.status(200).json({ completo: false, fase: 'historial', procesadosEnEstaLlamada: historiales, matcheadosEnEstaLlamada: matcheados });
      }
      await esperarRitmo();

      const compras = await obtenerHistorialCompras(token, fila.bsale_cliente_id);
      const numCompras = compras.length;
      const montoTotal = compras.reduce((a, d) => a + (Number(d.totalAmount) || 0), 0);
      const fechas = compras.map(d => d.emissionDate ? new Date(d.emissionDate * 1000).toISOString().slice(0, 10) : null).filter(Boolean);
      const ultimaCompra = fechas.length ? fechas.sort().slice(-1)[0] : null;
      const activo12m = ultimaCompra ? ultimaCompra >= haceUnAnio : false;

      await sql`
        UPDATE indexpro_oportunidades SET
          num_compras = ${numCompras}, monto_total = ${montoTotal}, ultima_compra = ${ultimaCompra},
          activo_12m = ${activo12m}, sincronizado_en = now(), actualizado_en = now()
        WHERE id = ${fila.id};`;
      historiales++;
    }

    await sql`UPDATE indexpro_sync_estado SET ultima_pasada_completa_en = now(), actualizado_en = now() WHERE id = 1;`;
    return res.status(200).json({ completo: true, fase: 'historial', procesadosEnEstaLlamada: historiales, matcheadosEnEstaLlamada: matcheados });
  } catch (err) {
    return res.status(200).json({ error: 'Error sincronizando Indexpro con Bsale', detail: String(err) });
  }
}

// Detalle de documentos (para el ícono $ "ver facturas") de UN cliente
// puntual -> se consulta a Bsale al momento (no queda guardado), porque
// solo hace falta cuando alguien hace clic, no para las 100 filas cada vez.
async function manejarIndexproHistorial(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta el id' });

  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) return res.status(200).json({ error: 'BSALE_ACCESS_TOKEN no está configurada en el servidor' });

  try {
    const sql = await getSql();
    await asegurarTablaIndexpro(sql);
    const { rows } = await sql`SELECT bsale_cliente_id, cliente_nombre FROM indexpro_oportunidades WHERE id = ${id};`;
    const fila = rows[0];
    if (!fila || !(fila.bsale_cliente_id > 0)) return res.status(200).json({ error: 'Este cliente todavía no está vinculado a Bsale', documentos: [] });

    const compras = await obtenerHistorialCompras(token, fila.bsale_cliente_id);
    const documentos = compras
      .map(d => ({
        id: d.id,
        tipo: d.document_type?.name || '',
        numero: d.number ? String(d.number) : '',
        fecha: d.emissionDate ? new Date(d.emissionDate * 1000).toISOString().slice(0, 10) : null,
        monto: Number(d.totalAmount) || 0,
        url: d.urlPublicView || d.urlPublicViewOriginal || '',
      }))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    return res.status(200).json({ clienteNombre: fila.cliente_nombre, documentos });
  } catch (err) {
    return res.status(200).json({ error: 'Error consultando el historial en Bsale', detail: String(err), documentos: [] });
  }
}

// Correo de primer contacto / presentación comercial NAS QNAP. Mismo
// argumento de venta que docs/capacitacion-venta-nas.md del proyecto
// indexpro.cl (gancho del gasto mensual en la nube, complementa Google
// Workspace, control + continuidad, administrado por nosotros). Sin
// precios de kits: esos se dan en la llamada de diagnóstico, no en el
// primer correo (así lo indica la misma guía de ventas), y así este
// texto no se desactualiza si cambian los precios allá.
function construirCorreoPresentacionNas(nombreCliente) {
  const nombre = nombreCliente || 'estimado/a';
  const texto = `Hola ${nombre},

¿Sabes cuánto están pagando hoy en Google Drive o OneDrive al mes por espacio de almacenamiento? Muchas empresas de su rubro se están ahorrando esa mensualidad con un servidor propio (NAS) que se paga una sola vez.

Es una alternativa simple:
- No reemplaza Google Workspace, lo complementa: siguen usando correo y colaboración en Google: el NAS se hace cargo de los archivos pesados.
- Sus archivos quedan en su oficina, accesibles aunque falle internet.
- Nosotros lo administramos — no necesitan contratar a alguien de TI para eso.

Si les hace sentido, la idea no es venderles nada en este correo, sino agendar un diagnóstico gratuito de 15 minutos para ver el volumen real de archivos y qué opción les conviene.

Más detalles acá: https://www.indexpro.cl/tu-nube-privada/

Quedo atento/a — basta con responder este correo.

Equipo IndexPro`;

  const html = texto
    .split('\n\n')
    .map(p => `<p style="margin:0 0 14px;">${p.replace(/\n/g, '<br>').replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`)
    .join('');

  return {
    asunto: '¿Sabes cuánto pagas al mes por almacenamiento en la nube?',
    texto,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1F2A24;">${html}</div>`,
  };
}

async function manejarIndexproEnviarPresentacion(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Falta el id' });

  try {
    const sql = await getSql();
    await asegurarTablaIndexpro(sql);
    const { rows } = await sql`SELECT email, cliente_nombre, empresa_original, estado FROM indexpro_oportunidades WHERE id = ${id};`;
    const fila = rows[0];
    if (!fila) return res.status(404).json({ error: 'No encontrado' });
    if (!fila.email) return res.status(400).json({ error: 'Este cliente no tiene correo registrado' });

    const nombre = fila.cliente_nombre || fila.empresa_original;
    const correo = construirCorreoPresentacionNas(nombre);
    const resultado = await enviarCorreoIndexpro({ para: fila.email, ...correo });
    if (!resultado.enviado) return res.status(200).json({ error: 'No se pudo enviar el correo', detail: resultado.motivo });

    const nuevoEstado = fila.estado === 'sin_contactar' ? 'primer_correo' : fila.estado;
    await sql`
      UPDATE indexpro_oportunidades SET
        presentacion_enviada_en = now(), estado = ${nuevoEstado},
        actualizado_por = ${sesion.nombre || sesion.email}, actualizado_en = now()
      WHERE id = ${id};`;

    return res.status(200).json({ ok: true, estado: nuevoEstado });
  } catch (err) {
    return res.status(500).json({ error: 'Error enviando el correo', detail: String(err) });
  }
}

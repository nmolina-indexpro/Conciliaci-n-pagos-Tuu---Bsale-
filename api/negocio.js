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

import { getSql, asegurarTablaProductosCriticos, asegurarTablaReportesError, asegurarTablaFacturasCompra, asegurarTablaBsalePuntos, asegurarTablaCotizaciones, asegurarTablaCalendarioPagos, asegurarTablaSaldoBci, asegurarTablaIndexpro, asegurarTablaAnalisis, asegurarTablaWhatsapp } from '../lib/db.js';
import { usuarioDesdeRequest } from '../lib/auth-node.js';
import { enviarCorreo, enviarCorreoIndexpro } from '../lib/mailer.js';

const CORREO_ALERTA = 'nmolina@indexpro.cl';
const ESTADOS_VALIDOS = ['pendiente', 'en progreso', 'resuelto'];
const RESPONSABLE_REPORTES = 'Nicolás Molina'; // fijo por ahora, ver reportar-error.html
const URL_REPORTES = 'https://conciliaci-n-pagos-tuu-bsale.vercel.app/reportar-error.html';
const ZOHO_TIMEOUT_MS = 20000;

// Vercel parsea el body a JSON automáticamente por defecto -- pero el
// webhook de WhatsApp necesita los bytes CRUDOS exactos que mandó Meta para
// poder verificar su firma (X-Hub-Signature-256), y un JSON.stringify(req.body)
// re-serializado no calza byte a byte (orden de llaves, espacios). Se apaga
// el parseo automático para todo el archivo y se hace a mano una sola vez
// al principio del handler, guardando el crudo ANTES de parsear -- así el
// resto de los ~30 recursos de este archivo siguen viendo req.body como un
// objeto normal, sin cambiar nada de su código.
export const config = { api: { bodyParser: false } };

function leerCuerpoCrudo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on('data', (chunk) => partes.push(chunk));
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const cuerpoCrudo = await leerCuerpoCrudo(req);
  req.rawBody = cuerpoCrudo;
  try {
    req.body = cuerpoCrudo ? JSON.parse(cuerpoCrudo) : {};
  } catch {
    req.body = {};
  }

  // El webhook de WhatsApp lo llama Meta directo (sin cookie de sesión) ->
  // se resuelve ANTES del chequeo de sesión, y con su propia verificación
  // (firma de Meta, sobre req.rawBody). Ver también middleware.ts
  // (esWebhookWhatsappPublico), que deja pasar ESTA combinación puntual de
  // pathname+recurso sin sesión.
  if (req.query.recurso === 'whatsapp-webhook') return manejarWhatsappWebhook(req, res);

  const sesion = usuarioDesdeRequest(req);
  if (!sesion) return res.status(401).json({ error: 'No hay sesión activa' });

  const recurso = req.query.recurso;
  if (recurso === 'criticos') return manejarCriticos(req, res, sesion);
  if (recurso === 'alertas-stock-shopify') return manejarAlertasStockShopify(req, res, sesion);
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
  if (recurso === 'analisis-clientes') return manejarAnalisisClientes(req, res, sesion);
  if (recurso === 'sync-analisis') return manejarSyncAnalisis(req, res, sesion);
  if (recurso === 'whatsapp-dashboard') return manejarWhatsappDashboard(req, res, sesion);
  if (recurso === 'whatsapp-conversaciones') return manejarWhatsappConversaciones(req, res, sesion);
  if (recurso === 'whatsapp-conversacion-detalle') return manejarWhatsappConversacionDetalle(req, res, sesion);
  if (recurso === 'whatsapp-clientes') return manejarWhatsappClientes(req, res, sesion);
  if (recurso === 'whatsapp-cliente-detalle') return manejarWhatsappClienteDetalle(req, res, sesion);
  if (recurso === 'whatsapp-seguimientos') return manejarWhatsappSeguimientos(req, res, sesion);
  if (recurso === 'whatsapp-etiquetas') return manejarWhatsappEtiquetas(req, res, sesion);
  if (recurso === 'whatsapp-venta') return manejarWhatsappVenta(req, res, sesion);
  if (recurso === 'whatsapp-enviar-mensaje') return manejarWhatsappEnviarMensaje(req, res, sesion);
  if (recurso === 'whatsapp-analizar') return manejarWhatsappAnalizar(req, res, sesion);
  if (recurso === 'whatsapp-analizar-pendientes') return manejarWhatsappAnalizarPendientes(req, res, sesion);
  if (recurso === 'whatsapp-reanalizar-desactualizadas') return manejarWhatsappReanalizarDesactualizadas(req, res, sesion);
  if (recurso === 'whatsapp-actualizar-shopify') return manejarWhatsappActualizarShopify(req, res, sesion);
  if (recurso === 'whatsapp-actualizar-ventas-bsale') return manejarWhatsappActualizarVentasBsale(req, res, sesion);
  if (recurso === 'whatsapp-recategorizar') return manejarWhatsappRecategorizar(req, res, sesion);
  if (recurso === 'whatsapp-analitica') return manejarWhatsappAnalitica(req, res, sesion);
  if (recurso === 'whatsapp-usuarios') return manejarWhatsappUsuarios(req, res, sesion);
  if (recurso === 'whatsapp-debug-categoria') return manejarWhatsappDebugCategoria(req, res, sesion);
  if (recurso === 'whatsapp-media') return manejarWhatsappMedia(req, res, sesion);
  return res.status(400).json({ error: 'Falta un ?recurso= válido (ver api/negocio.js)' });
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
      const { descripcion, pagina, tipo, skuCode, contexto, imagen } = req.body || {};
      if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'Describe el error u observación, por favor.' });
      const tipoFinal = ['objecion', 'observacion'].includes(tipo) ? tipo : 'error';
      // La imagen ya viene comprimida desde el navegador (ver reportar-error.html);
      // igual se pone un tope acá por si acaso, para no reventar la fila/el correo.
      const imagenFinal = (typeof imagen === 'string' && imagen.startsWith('data:image/') && imagen.length < 3_000_000) ? imagen : null;

      const { rows } = await sql`
        INSERT INTO reportes_error (usuario_email, usuario_nombre, descripcion, pagina, tipo, sku_code, contexto, imagen)
        VALUES (${sesion.email}, ${sesion.nombre || sesion.email}, ${descripcion.trim()}, ${pagina || null}, ${tipoFinal}, ${skuCode || null}, ${contexto ? JSON.stringify(contexto) : null}, ${imagenFinal})
        RETURNING *;
      `;
      const reporte = rows[0];

      const etiquetaTipo = tipoFinal === 'objecion' ? 'Objeción' : (tipoFinal === 'observacion' ? 'Observación' : 'Error');
      const correoResultado = await enviarCorreo({
        para: CORREO_ALERTA,
        asunto: `Nuevo ticket #${reporte.id} (${etiquetaTipo}) — ${sesion.nombre || sesion.email}${skuCode ? ' — SKU ' + skuCode : ''}`,
        html: `
          <p>Se registró un nuevo ticket en el panel IndexStore.</p>
          <p><b>ID:</b> #${reporte.id}<br>
          <b>Tipo:</b> ${etiquetaTipo}<br>
          <b>Responsable:</b> ${RESPONSABLE_REPORTES}<br>
          <b>Usuario:</b> ${sesion.nombre || ''} (${sesion.email})<br>
          <b>Página:</b> ${pagina || 'No especificada'}<br>
          ${skuCode ? `<b>SKU:</b> ${skuCode}<br>` : ''}
          <b>Fecha:</b> ${new Date(reporte.created_at).toLocaleString('es-CL')}</p>
          <p><b>Descripción:</b><br>${(descripcion || '').replace(/\n/g, '<br>')}</p>
          ${contexto ? `<p><b>Datos que estaba viendo:</b><br><code>${JSON.stringify(contexto)}</code></p>` : ''}
          ${imagenFinal ? `<p><b>Captura adjunta:</b><br><img src="${imagenFinal}" style="max-width:520px;border:1px solid #ddd;border-radius:8px;"></p>` : ''}
          <p><a href="${URL_REPORTES}">Ver en la página de tickets →</a></p>
        `,
        texto: `Nuevo ticket #${reporte.id} (${etiquetaTipo}).\nResponsable: ${RESPONSABLE_REPORTES}\nUsuario: ${sesion.nombre || ''} (${sesion.email})\nPágina: ${pagina || 'No especificada'}\n${skuCode ? `SKU: ${skuCode}\n` : ''}Descripción: ${descripcion}${contexto ? `\nDatos: ${JSON.stringify(contexto)}` : ''}${imagenFinal ? '\n(Tiene una captura adjunta — verla en la página de tickets)' : ''}\n\nVer en la página de tickets: ${URL_REPORTES}`,
      });

      return res.status(200).json({ reporte, correo: correoResultado });
    }

    if (req.method === 'PUT') {
      if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede cambiar el estado de un ticket' });
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
      if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede eliminar un ticket' });
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Falta id' });
      await sql`DELETE FROM reportes_error WHERE id = ${id};`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en tickets', detail: String(err) });
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
const PUNTOS_SYNC_INTERVALO_MIN_MS = 130; // ritmo ~7.7 req/s, bajo el límite de Bsale (8 req/s) con margen
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

// Clasifica una línea de detalle de venta por texto del producto (nombre
// de la variante) -> mismo espíritu que pareceServicioPorNombre en
// bsale-sku-report.js, pero acá se necesitan las 4 categorías, no solo
// "es servicio o no". Se usa el texto en vez de products.json/
// product_types.json para no sumar una vuelta extra a Bsale (y su rate
// limit) solo por esto -> Análisis ya hace bastantes llamadas trayendo
// documents.json con expand=details de un año completo.
// "variant.description" en Bsale NO es el nombre del producto -> es una
// ficha técnica (ej. "19.5V 2.31A 4.5X3.0MM" para un cargador), confirmado
// con un documento real vía el modo ?debug=1 de manejarSyncAnalisis. Para
// cargadores el código sí trae un prefijo limpio ("CARHP06"), pero para
// pantallas NO existe un prefijo "PAN" (confirmado con ?debug=skus): usan
// códigos como PSLIM/PNORMAL/PTBEZEL/FDP, o directamente el número de
// modelo del panel sin ningún prefijo (ej. "M215HCA-L3B"). La señal que sí
// aparece siempre en esos casos es el patrón de la ficha técnica: tamaño en
// pulgadas + pines + resolución (ej. `21.5" 30P FHD`) -> se detecta por
// regex sobre la descripción.
function categoriaLinea(codigoVariante, nombreLinea) {
  const codigo = (codigoVariante || '').toUpperCase();
  if (/^CAR/.test(codigo)) return 'cargadores';
  if (/^BAT/.test(codigo)) return 'baterias';
  if (/^SER/.test(codigo)) return 'servicios';
  if (/^(PSLIM|PNORMAL|PTBEZEL|FDP)/.test(codigo)) return 'pantallas';
  const n = nombreLinea || '';
  if (/\d+(\.\d+)?["″]\s*\d+p\b/i.test(n)) return 'pantallas'; // ej. 15.6" 30P FHD
  if (/pantalla/i.test(n)) return 'pantallas';
  if (/cargador/i.test(n)) return 'cargadores';
  if (/bater[ií]a/i.test(n)) return 'baterias';
  if (/servicio|instalaci[oó]n|garant[ií]a|mano de obra|diagn[oó]stico|reparaci[oó]n/i.test(n)) return 'servicios';
  return null;
}

// Suma, por categoría, el monto neto de las líneas de un documento de
// venta (una venta puede mezclar categorías, ej. cargador + instalación).
function desglosarCategoriasDocumento(doc) {
  const totales = { servicios: 0, pantallas: 0, cargadores: 0, baterias: 0 };
  const detalles = doc.details?.items || (Array.isArray(doc.details) ? doc.details : []);
  for (const det of detalles) {
    const codigo = det.variant?.code || '';
    const nombre = det.variant?.description || det.comment || det.note || '';
    const cat = categoriaLinea(codigo, nombre);
    if (!cat) continue;
    totales[cat] += (det.quantity || 0) * (det.netUnitValue || 0);
  }
  return totales;
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

// ---------------- Análisis — clientes recurrentes ----------------
// Clasifica clientes por N° de compras REALES (boletas/facturas, sin
// cotizaciones ni notas de crédito, ver esVentaReal) en los últimos 12
// meses:
//   1 compra    -> ocasional
//   2 compras   -> recurrente
//   3+ compras  -> pro
// Mismo patrón resumible de las otras sincronizaciones con Bsale (ver
// manejarSyncCotizaciones más arriba): la Fase 1 (única acá, no hay
// Fase 2) pagina documents.json del período y guarda cada documento;
// como "documento_id" es PRIMARY KEY, reintentar o repetir una página no
// duplica el conteo.
const ANALISIS_DIAS_HISTORIAL = 365;

async function manejarSyncAnalisis(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede sincronizar el análisis de clientes' });

  const token = process.env.BSALE_ACCESS_TOKEN;
  if (!token) return res.status(200).json({ error: 'BSALE_ACCESS_TOKEN no está configurada en el servidor' });

  const inicio = Date.now();
  try {
    const sql = await getSql();
    await asegurarTablaAnalisis(sql);

    const { rows: estadoRows } = await sql`SELECT * FROM analisis_sync_estado WHERE id = 1;`;
    const estado = estadoRows[0] || {};
    let offset = estado.offset_actual || 0;
    let total = estado.total_documentos ?? null;
    let procesados = 0;
    let ultimaPeticion = 0;
    const presupuestoRestante = () => PUNTOS_SYNC_PRESUPUESTO_MS - (Date.now() - inicio);

    const hastaStr = new Date().toISOString().slice(0, 10);
    const desdeStr = new Date(Date.now() - ANALISIS_DIAS_HISTORIAL * 86400000).toISOString().slice(0, 10);
    const rangeStart = Math.floor(new Date(`${desdeStr}T00:00:00-04:00`).getTime() / 1000) - 6 * 3600;
    const rangeEnd = Math.floor(new Date(`${hastaStr}T23:59:59-04:00`).getTime() / 1000) + 6 * 3600;

    // Modo diagnóstico (?recurso=sync-analisis&debug=1): trae UNA página tal
    // cual la devuelve Bsale, sin tocar la base de datos -- para confirmar
    // que "details" realmente viene.
    if (req.query.debug === '1') {
      const urlDebug = `${BSALE_BASE}/documents.json?emissiondaterange=[${rangeStart},${rangeEnd}]&expand=[client,document_type,details]&limit=3&offset=0`;
      const rDebug = await fetchConTimeout(urlDebug, { headers: { access_token: token } }, 15000);
      const dataDebug = await rDebug.json();
      return res.status(200).json({
        debug: true, urlUsada: urlDebug, status: rDebug.status,
        primerDocumentoCompleto: dataDebug.items?.[0] || null,
        tieneDetails: dataDebug.items?.[0]?.details !== undefined,
        formaDeDetails: dataDebug.items?.[0]?.details,
      });
    }

    // Modo diagnóstico (?recurso=sync-analisis&debug=skus): recorre varias
    // páginas y junta los códigos de SKU distintos vistos, separados en
    // "clasificados" (matchearon categoriaLinea) y "sin clasificar" -- para
    // ver de una vez qué prefijo/patrón usan de verdad las pantallas (u
    // otra categoría) en vez de seguir adivinando a ciegas.
    if (req.query.debug === 'skus') {
      const vistos = new Map(); // code -> { descripcion, categoria, veces }
      for (let p = 0; p < 8; p++) {
        const urlP = `${BSALE_BASE}/documents.json?emissiondaterange=[${rangeStart},${rangeEnd}]&expand=[client,document_type,details]&limit=${PUNTOS_SYNC_LIMIT}&offset=${p * PUNTOS_SYNC_LIMIT}`;
        const rP = await fetchConTimeout(urlP, { headers: { access_token: token } }, 15000);
        const dataP = await rP.json();
        const itemsP = dataP.items || [];
        for (const doc of itemsP) {
          const detalles = doc.details?.items || [];
          for (const det of detalles) {
            const codigo = det.variant?.code || '';
            const nombre = det.variant?.description || det.comment || det.note || '';
            const cat = categoriaLinea(codigo, nombre);
            if (!vistos.has(codigo)) vistos.set(codigo, { descripcion: nombre, categoria: cat, veces: 0 });
            vistos.get(codigo).veces++;
          }
        }
        if (itemsP.length < PUNTOS_SYNC_LIMIT) break;
      }
      const todos = [...vistos.entries()].map(([codigo, v]) => ({ codigo, ...v }));
      return res.status(200).json({
        debug: true,
        totalSkusDistintos: todos.length,
        clasificados: todos.filter(s => s.categoria).sort((a, b) => b.veces - a.veces),
        sinClasificar: todos.filter(s => !s.categoria).sort((a, b) => b.veces - a.veces),
      });
    }

    // Con expand=[...,details] cada página pesa bastante más (trae todas
    // las líneas de producto de 50 documentos) -> la pausa mínima entre
    // peticiones deja de ser el cuello de botella real, lo es la latencia
    // de cada respuesta de Bsale. En vez de una petición a la vez, se
    // pide una TANDA en paralelo (Promise.all) -> mismo techo de ~8 req/s
    // de Bsale, pero aprovechado en paralelo en vez de en fila.
    const TANDA_ANALISIS = 6;
    const esperarRitmoTanda = async (tam) => {
      const espera = (tam * PUNTOS_SYNC_INTERVALO_MIN_MS) - (Date.now() - ultimaPeticion);
      if (espera > 0) await new Promise(r => setTimeout(r, espera));
      ultimaPeticion = Date.now();
    };

    let pasadaTerminada = total != null && offset >= total;
    while (!pasadaTerminada && presupuestoRestante() > 0) {
      const offsetsTanda = [];
      for (let i = 0; i < TANDA_ANALISIS; i++) {
        const off = offset + i * PUNTOS_SYNC_LIMIT;
        if (total != null && off >= total) break;
        offsetsTanda.push(off);
      }
      if (offsetsTanda.length === 0) { pasadaTerminada = true; break; }

      await esperarRitmoTanda(offsetsTanda.length);
      // OJO: para combinar "details" (relación a muchos) con otros expands
      // hay que usar la sintaxis de arreglo expand=[a,b,c] -- expand=a,b,c
      // sin corchetes no trae los detalles (visto ya en bsale-sku-report.js,
      // que sí usa expand=[details,document_type] con éxito).
      const respuestas = await Promise.all(offsetsTanda.map(async off => {
        const url = `${BSALE_BASE}/documents.json?emissiondaterange=[${rangeStart},${rangeEnd}]&expand=[client,document_type,details]&limit=${PUNTOS_SYNC_LIMIT}&offset=${off}`;
        const r = await fetchConTimeout(url, { headers: { access_token: token } }, 15000);
        if (!r.ok) {
          const texto = await r.text().catch(() => '');
          throw new Error(`Bsale HTTP ${r.status} en documents.json: ${texto.slice(0, 300)}`);
        }
        return r.json();
      }));

      let items = [];
      let ultimaPaginaIncompleta = false;
      for (const data of respuestas) {
        if (typeof data.count === 'number') total = data.count;
        const its = data.items || [];
        items.push(...its);
        if (its.length < PUNTOS_SYNC_LIMIT) ultimaPaginaIncompleta = true;
      }

      const ventas = items.filter(d => d.state === 0 && !d.cancellationStatus && esVentaReal(d.document_type) && d.client?.id);

      if (ventas.length > 0) {
        const desglosePorDoc = ventas.map(d => desglosarCategoriasDocumento(d));
        await sql.query(
          `INSERT INTO analisis_compras (documento_id, cliente_id, cliente_nombre, fecha, monto, monto_servicios, monto_pantallas, monto_cargadores, monto_baterias, sincronizado_en)
           SELECT * FROM UNNEST ($1::int[], $2::int[], $3::text[], $4::date[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[], $10::timestamptz[])
           ON CONFLICT (documento_id) DO UPDATE SET
             cliente_id = EXCLUDED.cliente_id, cliente_nombre = EXCLUDED.cliente_nombre,
             fecha = EXCLUDED.fecha, monto = EXCLUDED.monto,
             monto_servicios = EXCLUDED.monto_servicios, monto_pantallas = EXCLUDED.monto_pantallas,
             monto_cargadores = EXCLUDED.monto_cargadores, monto_baterias = EXCLUDED.monto_baterias,
             sincronizado_en = EXCLUDED.sincronizado_en;`,
          [
            ventas.map(d => d.id),
            ventas.map(d => d.client.id),
            ventas.map(d => nombreClienteDoc(d.client)),
            ventas.map(d => d.emissionDate ? new Date(d.emissionDate * 1000).toISOString().slice(0, 10) : null),
            ventas.map(d => Number(d.totalAmount) || 0),
            desglosePorDoc.map(d => d.servicios),
            desglosePorDoc.map(d => d.pantallas),
            desglosePorDoc.map(d => d.cargadores),
            desglosePorDoc.map(d => d.baterias),
            ventas.map(() => new Date().toISOString()),
          ]
        );
      }

      offset += offsetsTanda.length * PUNTOS_SYNC_LIMIT;
      procesados += ventas.length;
      pasadaTerminada = ultimaPaginaIncompleta || (total != null && offset >= total);
      await sql`UPDATE analisis_sync_estado SET offset_actual = ${offset}, total_documentos = ${total}, actualizado_en = now() WHERE id = 1;`;
    }

    if (!pasadaTerminada) {
      return res.status(200).json({ completo: false, procesadosEnEstaLlamada: procesados, offsetActual: offset, totalDocumentos: total });
    }

    // Pasada completa: se saca lo que quedó fuera de la ventana de 12
    // meses (compras que "envejecieron" desde la sincronización anterior)
    // y se reinicia el offset para la próxima pasada completa.
    await sql`DELETE FROM analisis_compras WHERE fecha < ${desdeStr};`;
    await sql`UPDATE analisis_sync_estado SET offset_actual = 0, total_documentos = NULL, ultima_pasada_completa_en = now(), actualizado_en = now() WHERE id = 1;`;

    return res.status(200).json({ completo: true, procesadosEnEstaLlamada: procesados });
  } catch (err) {
    return res.status(200).json({ error: 'Error sincronizando el análisis de clientes con Bsale', detail: String(err) });
  }
}

const ESTADOS_ANALISIS = ['sin_contactar', 'contactado', 'fidelizado'];

async function manejarAnalisisClientes(req, res, sesion) {
  if (req.method === 'DELETE') {
    if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede excluir un cliente del análisis' });
    const { clienteId } = req.query;
    if (!clienteId) return res.status(400).json({ error: 'Falta clienteId' });
    try {
      const sql = await getSql();
      await asegurarTablaAnalisis(sql);
      await sql`INSERT INTO analisis_excluidos (cliente_id, excluido_por) VALUES (${clienteId}, ${sesion.nombre || sesion.email});`;
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Error al excluir el cliente', detail: String(err) });
    }
  }

  if (req.method === 'PUT') {
    if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede editar esto' });
    const { clienteId, estado, comentario } = req.body || {};
    if (!clienteId) return res.status(400).json({ error: 'Falta clienteId' });
    if (estado !== undefined && !ESTADOS_ANALISIS.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    if (estado === undefined && comentario === undefined) return res.status(400).json({ error: 'Falta estado o comentario' });
    try {
      const sql = await getSql();
      await asegurarTablaAnalisis(sql);
      // Se asegura la fila primero (con los valores por defecto) y después
      // se actualiza SOLO lo que vino en la petición -> así un cambio de
      // comentario no pisa el estado, y viceversa.
      await sql`INSERT INTO analisis_clientes_estado (cliente_id) VALUES (${clienteId}) ON CONFLICT (cliente_id) DO NOTHING;`;
      if (estado !== undefined) {
        await sql`UPDATE analisis_clientes_estado SET estado = ${estado}, actualizado_por = ${sesion.nombre || sesion.email}, actualizado_en = now() WHERE cliente_id = ${clienteId};`;
      }
      if (comentario !== undefined) {
        await sql`UPDATE analisis_clientes_estado SET comentario = ${comentario || null}, actualizado_por = ${sesion.nombre || sesion.email}, actualizado_en = now() WHERE cliente_id = ${clienteId};`;
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Error al actualizar', detail: String(err) });
    }
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sql = await getSql();
    await asegurarTablaAnalisis(sql);
    await asegurarTablaBsalePuntos(sql);

    // Enriquecido con lo que ya sincronizó Puntos Bsale (RUT, empresa,
    // teléfono, email) -> evita una vuelta nueva a Bsale solo para esto,
    // ese roster ya cubre prácticamente todos los clientes (~47.000,
    // programa de fidelización). "Giro" no se replica: en Indexpro viene
    // de la planilla de 100 leads curados a mano, no existe un equivalente
    // para clientes de retail en general.
    const { rows } = await sql`
      SELECT
        ac.cliente_id, MAX(ac.cliente_nombre) AS cliente_nombre, COUNT(*)::int AS num_compras,
        SUM(ac.monto) AS monto_total, MAX(ac.fecha) AS ultima_compra,
        SUM(ac.monto_servicios) AS monto_servicios, SUM(ac.monto_pantallas) AS monto_pantallas,
        SUM(ac.monto_cargadores) AS monto_cargadores, SUM(ac.monto_baterias) AS monto_baterias,
        MAX(bp.rut) AS rut, MAX(bp.empresa) AS empresa, MAX(bp.telefono) AS telefono, MAX(bp.email) AS email,
        COALESCE(MAX(ace.estado), 'sin_contactar') AS estado, MAX(ace.comentario) AS comentario
      FROM analisis_compras ac
      LEFT JOIN bsale_clientes_puntos bp ON bp.id = ac.cliente_id
      LEFT JOIN analisis_clientes_estado ace ON ace.cliente_id = ac.cliente_id
      WHERE ac.cliente_id NOT IN (SELECT cliente_id FROM analisis_excluidos WHERE cliente_id IS NOT NULL)
        AND ac.cliente_nombre NOT IN (SELECT cliente_nombre FROM analisis_excluidos WHERE cliente_nombre IS NOT NULL)
      GROUP BY ac.cliente_id
      ORDER BY num_compras DESC, cliente_nombre ASC;
    `;
    const { rows: estadoRows } = await sql`SELECT * FROM analisis_sync_estado WHERE id = 1;`;

    const mapear = r => ({
      clienteId: r.cliente_id,
      clienteNombre: r.cliente_nombre,
      empresa: r.empresa || null,
      rut: r.rut || null,
      telefono: r.telefono || null,
      email: r.email || null,
      numCompras: r.num_compras,
      montoTotal: r.monto_total != null ? Number(r.monto_total) : 0,
      montoServicios: r.monto_servicios != null ? Number(r.monto_servicios) : 0,
      montoPantallas: r.monto_pantallas != null ? Number(r.monto_pantallas) : 0,
      montoCargadores: r.monto_cargadores != null ? Number(r.monto_cargadores) : 0,
      montoBaterias: r.monto_baterias != null ? Number(r.monto_baterias) : 0,
      ultimaCompra: r.ultima_compra ? new Date(r.ultima_compra).toISOString().slice(0, 10) : null,
      estado: r.estado,
      comentario: r.comentario || null,
    });

    const totalClientes = rows.length;
    const clientesPro = [], clientesRecurrentes = [], clientesOcasionales = [];
    for (const r of rows) {
      const item = mapear(r);
      if (r.num_compras >= 3) clientesPro.push(item);
      else if (r.num_compras === 2) clientesRecurrentes.push(item);
      else clientesOcasionales.push(item);
    }
    const pct = n => totalClientes > 0 ? Math.round((n / totalClientes) * 1000) / 10 : 0;

    return res.status(200).json({
      totalClientes,
      pro: { cantidad: clientesPro.length, porcentaje: pct(clientesPro.length), clientes: clientesPro },
      recurrentes: { cantidad: clientesRecurrentes.length, porcentaje: pct(clientesRecurrentes.length), clientes: clientesRecurrentes },
      ocasionales: { cantidad: clientesOcasionales.length, porcentaje: pct(clientesOcasionales.length), clientes: clientesOcasionales },
      sync: estadoRows[0] || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al calcular el análisis de clientes', detail: String(err) });
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
    if (err.name === 'AbortError') throw new Error(`Timeout de ${timeoutMs}ms consultando ${url}`);
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

// ==================== Clientes WhatsApp ====================
// Variables de entorno requeridas para conectar de verdad con Meta (hasta
// que existan, el webhook queda "preparado" pero inactivo -- ver Fase 37
// del pedido, se usan datos demo mientras tanto):
//   WHATSAPP_VERIFY_TOKEN   texto que TÚ inventas y pones también en el
//                           panel de Meta al configurar el webhook (paso
//                           de verificación GET).
//   WHATSAPP_APP_SECRET     App Secret de la app de Meta -> firma
//                           X-Hub-Signature-256 de cada POST.
const WHATSAPP_ESTADOS = ['nueva', 'abierta', 'esperando_cliente', 'seguimiento', 'cerrada', 'sin_respuesta'];
const WHATSAPP_RESULTADOS = ['venta', 'cotizacion', 'seguimiento', 'sin_stock', 'cliente_no_responde', 'no_interesado', 'otro'];
const WHATSAPP_SEGUIMIENTO_ESTADOS = ['pendiente', 'contactado', 'venta', 'cerrado', 'no_interesado'];
const WHATSAPP_INTENCIONES = ['compra', 'consulta', 'postventa', 'servicio_tecnico', 'garantia', 'seguimiento'];
const WHATSAPP_MOTIVOS_PERDIDA_LABEL = {
  cliente_no_responde: 'Cliente dejó de responder', sin_stock: 'Sin stock', precio: 'Precio',
  respuesta_lenta: 'Respuesta demasiado lenta', producto_incompatible: 'Producto incompatible',
  sin_seguimiento: 'No se realizó seguimiento', compro_en_otro_lugar: 'Compró en la competencia', otro: 'Otro',
};
const WHATSAPP_CATEGORIAS = ['pantalla', 'cargador', 'bateria', 'servicio_tecnico', 'repuestos', 'cotizacion', 'compatibilidad', 'garantia', 'estado_pedido', 'postventa', 'otra'];

// ---- Webhook (recibe eventos de Meta; ver middleware.ts para el paso público) ----
async function manejarWhatsappWebhook(req, res) {
  if (req.method === 'GET') {
    // Paso de verificación que exige Meta al configurar el webhook: si el
    // verify_token calza, hay que devolver el "challenge" tal cual, texto
    // plano (no JSON).
    const modo = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const tokenEsperado = process.env.WHATSAPP_VERIFY_TOKEN;
    if (modo === 'subscribe' && tokenEsperado && token === tokenEsperado) {
      res.status(200);
      return res.end(String(challenge || ''));
    }
    return res.status(403).json({ error: 'Token de verificación inválido' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verificación de firma de Meta: usa req.rawBody (los bytes EXACTOS que
  // mandó Meta, capturados en handler() antes de parsear JSON) -> ahora sí
  // calza byte a byte y se puede rechazar de verdad, no solo avisar. Si no
  // hay WHATSAPP_APP_SECRET configurado todavía, se deja pasar sin
  // verificar (fase de conexión inicial) pero queda registrado en logs.
  const secreto = process.env.WHATSAPP_APP_SECRET;
  const firma = req.headers['x-hub-signature-256'];
  if (secreto) {
    if (!firma) {
      console.warn('[whatsapp-webhook] rechazado: falta X-Hub-Signature-256');
      return res.status(401).json({ error: 'Falta firma' });
    }
    try {
      const crypto = await import('crypto');
      const esperada = 'sha256=' + crypto.createHmac('sha256', secreto).update(req.rawBody || '').digest('hex');
      const a = Buffer.from(firma);
      const b = Buffer.from(esperada);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.warn('[whatsapp-webhook] rechazado: firma no calzó');
        return res.status(401).json({ error: 'Firma inválida' });
      }
    } catch (err) {
      console.warn('[whatsapp-webhook] error validando firma', err);
      return res.status(401).json({ error: 'Error validando firma' });
    }
  } else {
    console.warn('[whatsapp-webhook] WHATSAPP_APP_SECRET no configurado -- evento aceptado SIN verificar firma');
  }

  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);

    const entradas = req.body?.entry || [];
    let mensajesProcesados = 0;
    const conversacionesTocadas = new Set(); // para el análisis IA automático, ver más abajo
    for (const entrada of entradas) {
      for (const cambio of (entrada.changes || [])) {
        const valor = cambio.value || {};
        const contactosPayload = valor.contacts || [];
        const mensajesPayload = valor.messages || [];
        // Mensajes que el NEGOCIO manda desde la app de WhatsApp Business
        // (coexistencia) -> Meta los manda por un campo de webhook aparte,
        // "message_echoes" (hay que suscribirlo en Meta además de
        // "messages"), porque no pasan por la Cloud API. Sin esto, la
        // conversación en el ERP solo mostraría lo que escribe el cliente,
        // nunca las respuestas reales del negocio.
        const echosPayload = valor.message_echoes || [];
        const estadosPayload = valor.statuses || [];

        for (const m of mensajesPayload) {
          const { rows: yaProcesado } = await sql`SELECT 1 FROM whatsapp_webhook_eventos_procesados WHERE whatsapp_message_id = ${m.id};`;
          if (yaProcesado.length > 0) continue; // idempotencia (Meta puede reenviar el mismo evento)

          const marcaTiempo = new Date(Number(m.timestamp) * 1000);
          const infoContacto = contactosPayload.find(c => c.wa_id === m.from) || {};
          const contacto = await obtenerOCrearContactoWhatsapp(sql, m.from, infoContacto.profile?.name);
          const conversacion = await obtenerOCrearConversacionWhatsapp(sql, contacto, marcaTiempo);
          const { tipo, texto, mediaRef } = extraerContenidoMensajeWhatsapp(m);

          await sql`
            INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, origen, tipo, contenido_texto, media_url)
            VALUES (${conversacion.id}, ${m.id}, ${marcaTiempo.toISOString()}, 'in', 'api', ${tipo}, ${texto}, ${mediaRef})
            ON CONFLICT (whatsapp_message_id) DO NOTHING;
          `;
          await sql`INSERT INTO whatsapp_webhook_eventos_procesados (whatsapp_message_id) VALUES (${m.id}) ON CONFLICT (whatsapp_message_id) DO NOTHING;`;

          if (!conversacion.primer_mensaje_cliente_en) {
            await sql`UPDATE whatsapp_conversaciones SET primer_mensaje_cliente_en = ${marcaTiempo.toISOString()} WHERE id = ${conversacion.id};`;
          }
          // Origen de la conversación (el "UTM" de WhatsApp): cuando el
          // cliente escribe desde un anuncio de "Click to WhatsApp" de
          // Meta, el mensaje trae este objeto -- normalmente solo en el
          // primer mensaje del click, así que se guarda con COALESCE
          // (nunca pisa un origen ya registrado con un mensaje posterior
          // que no lo traiga).
          if (m.referral) {
            await sql`
              UPDATE whatsapp_conversaciones SET
                fuente_tipo = COALESCE(fuente_tipo, ${m.referral.source_type || 'ad'}),
                fuente_titulo = COALESCE(fuente_titulo, ${m.referral.headline || null}),
                fuente_url = COALESCE(fuente_url, ${m.referral.source_url || null}),
                fuente_id = COALESCE(fuente_id, ${m.referral.source_id || m.referral.ctwa_clid || null})
              WHERE id = ${conversacion.id};
            `;
          }
          // Segunda fuente de origen: un link con UTM pegado en el propio
          // texto del mensaje (ver extraerUtmDeTexto) -- el COALESCE hace
          // que si ya había un referral de anuncio pagado, ese quede
          // primero (más autoritativo que un link que el cliente pegó).
          const utm = extraerUtmDeTexto(texto);
          if (utm) {
            await sql`
              UPDATE whatsapp_conversaciones SET
                fuente_tipo = COALESCE(fuente_tipo, 'utm'),
                fuente_titulo = COALESCE(fuente_titulo, ${utm.etiqueta}),
                fuente_url = COALESCE(fuente_url, ${utm.urlLimpia}),
                fuente_id = COALESCE(fuente_id, ${utm.id})
              WHERE id = ${conversacion.id};
            `;
          }
          await sql`
            UPDATE whatsapp_conversaciones
            SET cantidad_mensajes = cantidad_mensajes + 1, ultimo_mensaje_resumen = ${texto ? texto.slice(0, 140) : `[${tipo}]`}, updated_at = now()
            WHERE id = ${conversacion.id};
          `;
          await sql`UPDATE whatsapp_contactos SET ultima_conversacion_en = now(), updated_at = now() WHERE id = ${contacto.id};`;
          mensajesProcesados++;
          conversacionesTocadas.add(conversacion.id);
        }

        for (const m of echosPayload) {
          if (!m.id) continue;
          const { rows: yaProcesado } = await sql`SELECT 1 FROM whatsapp_webhook_eventos_procesados WHERE whatsapp_message_id = ${m.id};`;
          if (yaProcesado.length > 0) continue;

          // En un echo, "to" es el cliente (el negocio es "from") -- al
          // revés que en un mensaje entrante normal.
          const waIdCliente = m.to;
          if (!waIdCliente) continue;
          const marcaTiempo = new Date(Number(m.timestamp) * 1000);
          const contacto = await obtenerOCrearContactoWhatsapp(sql, waIdCliente, null);
          const conversacion = await obtenerOCrearConversacionWhatsapp(sql, contacto, marcaTiempo);
          const { tipo, texto, mediaRef } = extraerContenidoMensajeWhatsapp(m);

          await sql`
            INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, origen, tipo, contenido_texto, media_url)
            VALUES (${conversacion.id}, ${m.id}, ${marcaTiempo.toISOString()}, 'out', 'app', ${tipo}, ${texto}, ${mediaRef})
            ON CONFLICT (whatsapp_message_id) DO NOTHING;
          `;
          await sql`INSERT INTO whatsapp_webhook_eventos_procesados (whatsapp_message_id) VALUES (${m.id}) ON CONFLICT (whatsapp_message_id) DO NOTHING;`;

          // Punto 20 del pedido: tiempo de primera respuesta -- se calcula
          // la primera vez que el negocio contesta después del primer
          // mensaje del cliente en esta conversación.
          if (conversacion.primer_mensaje_cliente_en && !conversacion.primera_respuesta_empresa_en) {
            const segundos = Math.max(0, Math.round((marcaTiempo.getTime() - new Date(conversacion.primer_mensaje_cliente_en).getTime()) / 1000));
            await sql`
              UPDATE whatsapp_conversaciones
              SET primera_respuesta_empresa_en = ${marcaTiempo.toISOString()}, primera_respuesta_segundos = ${segundos},
                  estado = CASE WHEN estado = 'nueva' THEN 'abierta' ELSE estado END
              WHERE id = ${conversacion.id};
            `;
          }
          await sql`
            UPDATE whatsapp_conversaciones
            SET cantidad_mensajes = cantidad_mensajes + 1, ultimo_mensaje_resumen = ${texto ? texto.slice(0, 140) : `[${tipo}]`}, updated_at = now()
            WHERE id = ${conversacion.id};
          `;
          mensajesProcesados++;
          conversacionesTocadas.add(conversacion.id);
        }

        for (const st of estadosPayload) {
          if (st.id) await sql`UPDATE whatsapp_mensajes SET estado = ${st.status} WHERE whatsapp_message_id = ${st.id};`;
        }
      }
    }

    // Análisis IA automático (pedido por el usuario): se dispara para cada
    // conversación que recibió mensajes nuevos en esta llamada.
    //
    // Limitación real, documentada a propósito: esto analiza al toque
    // (sin esperar), no después de que el cliente "termine de escribir"
    // -- Meta no avisa eso, y este entorno serverless no tiene cola/cron
    // frecuente para implementar una espera de verdad (Vercel Hobby limita
    // los cron jobs a una vez al día, insuficiente para esto). Si un
    // cliente manda 3 mensajes seguidos en una ráfaga (ej. "Hola" -> foto
    // -> "tiene stock?"), el primer webhook puede analizar con SOLO el
    // "Hola" ya presente, y sin la ventana bien corta de acá abajo, ese
    // resultado incompleto quedaría "protegido" por horas sin volver a
    // intentarse. Por eso la ventana es corta (no minutos): sirve para no
    // relanzar el análisis en cada mensaje individual de una ráfaga muy
    // pegada (segundos), pero deja que la conversación se vuelva a
    // analizar pronto si sigue llegando algo. Aun así, algo puede quedar
    // desactualizado -- ver el botón admin "Reanalizar desactualizadas"
    // (whatsapp-reanalizar-desactualizadas) para ponerse al día en lote.
    // Nunca debe tumbar la respuesta 200 al webhook (Meta reintenta
    // agresivo si no la recibe) -> aislado en su propio try/catch, mejor
    // esfuerzo, sin bloquear el resto.
    const DEBOUNCE_ANALISIS_IA_MS = 90 * 1000; // 90s (subido de 45s tras revisión de costo de API, ver conversación con el usuario) -- sigue corto a propósito, ver comentario arriba
    // Tope defensivo: Meta casi siempre manda 1 mensaje por llamada de
    // webhook (rara vez toca más de una conversación distinta a la vez),
    // pero si alguna vez llegara un lote grande, esto evita que la función
    // se pase del límite de duración (60s, ver vercel.json) encadenando
    // demasiadas llamadas a Anthropic una tras otra.
    let analisisRestantes = 5;
    for (const conversacionId of conversacionesTocadas) {
      if (analisisRestantes-- <= 0) break;
      try {
        const { rows: previo } = await sql`SELECT updated_at FROM whatsapp_analisis_ia WHERE conversacion_id = ${conversacionId};`;
        const ultimaVez = previo[0]?.updated_at ? new Date(previo[0].updated_at).getTime() : 0;
        if (Date.now() - ultimaVez > DEBOUNCE_ANALISIS_IA_MS) {
          await ejecutarAnalisisIA(sql, conversacionId, 'Sistema (análisis automático)');
        }
      } catch (err) {
        console.error('[whatsapp-webhook] error en análisis IA automático de la conversación', conversacionId, err);
      }
    }

    return res.status(200).json({ ok: true, mensajesProcesados });
  } catch (err) {
    // Meta reintenta agresivamente si no recibe 200 -> se responde 200 aun
    // en error nuestro (para no generar una tormenta de reintentos), el
    // detalle queda en los logs de Vercel para diagnosticar.
    console.error('[whatsapp-webhook] error procesando evento', err);
    return res.status(200).json({ ok: false, error: String(err) });
  }
}

async function obtenerOCrearContactoWhatsapp(sql, waId, nombre) {
  const { rows } = await sql`SELECT * FROM whatsapp_contactos WHERE whatsapp_id = ${waId};`;
  if (rows[0]) {
    if (nombre && !rows[0].nombre) {
      await sql`UPDATE whatsapp_contactos SET nombre = ${nombre}, updated_at = now() WHERE id = ${rows[0].id};`;
      rows[0].nombre = nombre;
    }
    return rows[0];
  }
  const { rows: nuevo } = await sql`
    INSERT INTO whatsapp_contactos (whatsapp_id, telefono, nombre, primera_conversacion_en)
    VALUES (${waId}, ${waId}, ${nombre || null}, now())
    RETURNING *;
  `;
  return nuevo[0];
}

// "conversación" = sesión de mensajes de un mismo contacto, cortada cuando
// pasan más de X horas sin actividad (configurable, ver whatsapp_config;
// punto 22 del pedido) -- NO se asume que cada mensaje es una conversación
// nueva.
async function obtenerOCrearConversacionWhatsapp(sql, contacto, marcaTiempoMensaje) {
  const { rows: configRows } = await sql`SELECT horas_nueva_conversacion FROM whatsapp_config WHERE id = 1;`;
  const horasCorte = configRows[0]?.horas_nueva_conversacion || 24;

  const { rows: abiertas } = await sql`
    SELECT * FROM whatsapp_conversaciones
    WHERE contacto_id = ${contacto.id} AND cerrada_en IS NULL
    ORDER BY iniciada_en DESC LIMIT 1;
  `;
  const ultima = abiertas[0];
  if (ultima) {
    const horasDesdeUltima = (marcaTiempoMensaje.getTime() - new Date(ultima.updated_at).getTime()) / 3600000;
    if (horasDesdeUltima < horasCorte) return ultima;
    await sql`
      UPDATE whatsapp_conversaciones SET cerrada_en = now(),
        estado = CASE WHEN estado IN ('nueva','abierta') THEN 'sin_respuesta' ELSE estado END
      WHERE id = ${ultima.id};
    `;
  }

  const { rows: creada } = await sql`
    INSERT INTO whatsapp_conversaciones (contacto_id, iniciada_en, estado)
    VALUES (${contacto.id}, ${marcaTiempoMensaje.toISOString()}, 'nueva')
    RETURNING *;
  `;
  await sql`UPDATE whatsapp_contactos SET total_conversaciones = total_conversaciones + 1 WHERE id = ${contacto.id};`;
  return creada[0];
}

// Vinculación automática con Bsale por teléfono -- puramente informativa
// (identifica si el contacto de WhatsApp es un cliente ya conocido en
// Bsale). NO reemplaza el botón manual "Asociar venta": esto solo dice
// "este número aparece en Bsale como fulano", no crea ninguna venta.
// Cruza por los últimos 9 dígitos (columna generada telefono_normalizado
// en bsale_clientes_puntos, ver lib/db.js) para tolerar formatos
// distintos (+56, espacios, con o sin código de país). Límites reales: un
// número mal cargado, compartido o reciclado en Bsale puede dar un match
// incorrecto, y no encuentra nada si nunca se corrió la sincronización de
// "Puntos Bsale" (admin, en Oportunidades Comerciales).
async function buscarClienteBsalePorTelefono(sql, telefono) {
  if (!telefono) return null;
  const { rows } = await sql`
    SELECT id, nombre, rut, empresa, puntos FROM bsale_clientes_puntos
    WHERE telefono_normalizado <> '' AND telefono_normalizado = right(regexp_replace(${telefono}, '[^0-9]', '', 'g'), 9)
    LIMIT 1;
  `;
  return rows[0] || null;
}

// Busca si el cliente vinculado por teléfono (ver buscarClienteBsalePorTelefono)
// tiene una compra real en Bsale relacionada con esta conversación --
// puramente informativo/sugerido, para detectar automáticamente ventas
// que nadie asoció a mano todavía (no reemplaza el botón "Asociar
// venta", que sigue siendo la confirmación humana). Se queda solo con
// compras EN O DESPUÉS del inicio de la conversación, dentro de una
// ventana de 30 días: una compra de hace meses no necesariamente tiene
// que ver con esta conversación puntual, mejor no sugerir nada que
// sugerir algo sin relación real. "Mejor esfuerzo": cualquier error acá
// no debe tumbar el análisis IA completo.
async function buscarVentaBsalePorTelefono(sql, telefono, fechaConversacionIso) {
  const token = (process.env.BSALE_ACCESS_TOKEN || '').trim();
  if (!token || !telefono || !fechaConversacionIso) return null;
  try {
    const clienteBsale = await buscarClienteBsalePorTelefono(sql, telefono);
    if (!clienteBsale) return null;

    const compras = await obtenerHistorialCompras(token, clienteBsale.id);
    if (!compras.length) return null;

    const inicioMs = new Date(fechaConversacionIso).getTime();
    const VENTANA_MS = 30 * 86400000; // 30 días
    const candidatas = compras
      .map(d => ({ d, fechaMs: d.emissionDate ? d.emissionDate * 1000 : null }))
      .filter(({ fechaMs }) => fechaMs != null && fechaMs >= inicioMs && fechaMs <= inicioMs + VENTANA_MS)
      .sort((a, b) => a.fechaMs - b.fechaMs); // la más cercana al inicio de la conversación primero

    if (!candidatas.length) {
      console.warn('[buscarVentaBsalePorTelefono] cliente con compras en Bsale pero ninguna dentro de los 30 días siguientes al inicio de la conversación', telefono);
      return null;
    }

    const { d } = candidatas[0];
    return {
      numero: d.number ? String(d.number) : null,
      tipo: d.document_type?.name || null,
      monto: Number(d.totalAmount) || 0,
      fecha: d.emissionDate ? new Date(d.emissionDate * 1000).toISOString().slice(0, 10) : null,
      url: d.urlPublicView || d.urlPublicViewOriginal || null,
    };
  } catch (err) {
    console.warn('[buscarVentaBsalePorTelefono] error inesperado', telefono, err);
    return null; // mejor esfuerzo -- no interrumpe el análisis IA
  }
}

// Igual que buscarVentaBsalePorTelefono, pero contra pedidos de Shopify --
// útil para pedidos de la tienda online que todavía no se sincronizaron
// como documento a Bsale (o nunca se sincronizan, ej. pagos por Webpay
// directo). Busca al cliente por teléfono (comodín sobre los últimos 9
// dígitos, mismo criterio que el resto de los cruces por teléfono de este
// archivo) y sus pedidos pagados de los últimos 5, quedándose con el que
// haya sido creado dentro de los 30 días siguientes al inicio de la
// conversación. "Mejor esfuerzo": cualquier error acá no debe tumbar el
// análisis IA completo.
async function buscarVentaShopifyPorTelefono(telefono, fechaConversacionIso) {
  if (!telefono || !fechaConversacionIso) return null;
  try {
    const acceso = await obtenerAccesoShopify();
    if (!acceso) { console.warn('[buscarVentaShopifyPorTelefono] faltan credenciales de Shopify o no se pudo obtener token'); return null; }
    const { domain, accessToken } = acceso;

    const ultimos9 = telefono.replace(/[^0-9]/g, '').slice(-9);
    if (ultimos9.length < 9) return null;

    const query = `
      query($q: String!) {
        customers(first: 3, query: $q) {
          edges { node {
            orders(first: 5, sortKey: CREATED_AT, reverse: true) {
              edges { node { name createdAt displayFinancialStatus statusPageUrl totalPriceSet { shopMoney { amount } } } }
            }
          } }
        }
      }`;
    const r = await fetchConTimeout(`https://${domain}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { q: `phone:*${ultimos9}*` } }),
    }, 12000);
    if (!r.ok) { console.warn('[buscarVentaShopifyPorTelefono] error HTTP', telefono, r.status); return null; }
    const body = await r.json().catch(() => ({}));
    if (body.errors) { console.warn('[buscarVentaShopifyPorTelefono] GraphQL devolvió errores', telefono, JSON.stringify(body.errors).slice(0, 300)); return null; }

    const pedidos = (body.data?.customers?.edges || []).flatMap(c => (c.node.orders?.edges || []).map(o => o.node));
    if (!pedidos.length) { console.warn('[buscarVentaShopifyPorTelefono] sin cliente o sin pedidos en Shopify', telefono); return null; }

    const inicioMs = new Date(fechaConversacionIso).getTime();
    const VENTANA_MS = 30 * 86400000; // 30 días, mismo criterio que Bsale
    const candidatos = pedidos
      .filter(o => o.displayFinancialStatus === 'PAID' || o.displayFinancialStatus === 'PARTIALLY_REFUNDED')
      .map(o => ({ o, fechaMs: new Date(o.createdAt).getTime() }))
      .filter(({ fechaMs }) => fechaMs >= inicioMs && fechaMs <= inicioMs + VENTANA_MS)
      .sort((a, b) => a.fechaMs - b.fechaMs);

    if (!candidatos.length) {
      console.warn('[buscarVentaShopifyPorTelefono] cliente con pedidos en Shopify pero ninguno pagado dentro de los 30 días siguientes al inicio de la conversación', telefono);
      return null;
    }

    const { o } = candidatos[0];
    return {
      numero: o.name || null,
      tipo: 'Pedido Shopify',
      monto: Number(o.totalPriceSet?.shopMoney?.amount) || 0,
      fecha: o.createdAt ? o.createdAt.slice(0, 10) : null,
      url: o.statusPageUrl || null,
    };
  } catch (err) {
    console.warn('[buscarVentaShopifyPorTelefono] error inesperado', telefono, err);
    return null;
  }
}

// Intenta primero Bsale (suele tener más historial e incluye ventas en
// tienda física) y si no encuentra nada, Shopify (cubre pedidos web que
// todavía no se sincronizaron a Bsale). Devuelve el mismo formato
// {numero, tipo, monto, fecha, url} sea cual sea la fuente -- el campo
// "tipo" indica de dónde salió.
async function buscarVentaPorTelefono(sql, telefono, fechaConversacionIso) {
  const deBsale = await buscarVentaBsalePorTelefono(sql, telefono, fechaConversacionIso);
  if (deBsale) return deBsale;
  return buscarVentaShopifyPorTelefono(telefono, fechaConversacionIso);
}

function extraerContenidoMensajeWhatsapp(m) {
  const mapaTipos = { text: 'texto', image: 'imagen', audio: 'audio', video: 'video', document: 'documento' };
  const tipo = mapaTipos[m.type] || 'texto';
  const texto = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || null;
  // Meta no manda una URL de descarga directa para multimedia, hay que
  // resolver el "media id" con otra llamada a su API -> se guarda el id
  // como referencia por ahora, para resolverlo cuando haya credenciales
  // reales conectadas.
  const mediaId = m[m.type]?.id;
  const mediaRef = mediaId ? `whatsapp-media-id:${mediaId}` : null;
  return { tipo, texto, mediaRef };
}

// Segunda fuente de "de dónde viene el cliente", además del referral de
// anuncios pagados de Meta (ver más arriba): muchos clientes pegan en el
// chat el link de un producto de la tienda (compartido desde la página, o
// por un botón de WhatsApp del sitio) que trae utm_source/utm_medium/
// utm_campaign -- ej. "?utm_source=wsp-DT&utm_medium=wsp-DT&utm_campaign=wsp-DT"
// (un botón de WhatsApp en la ficha del producto). Usa las mismas columnas
// fuente_* que el referral, con tipo='utm' para distinguirlo.
function extraerUtmDeTexto(texto) {
  if (!texto) return null;
  const match = texto.match(/https?:\/\/[^\s]+/);
  if (match) {
    try {
      const url = new URL(match[0]);
      const source = url.searchParams.get('utm_source');
      const medium = url.searchParams.get('utm_medium');
      const campaign = url.searchParams.get('utm_campaign');
      if (source || medium || campaign) {
        return {
          urlLimpia: url.origin + url.pathname, // sin los query params, más legible
          etiqueta: [source, medium, campaign].filter((v, i, arr) => v && arr.indexOf(v) === i).join(' / '),
          id: campaign || medium || source,
        };
      }
    } catch {
      // URL mal formada -- sigue al fallback de abajo en vez de cortar acá
    }
  }

  // Fallback: el botón de WhatsApp de las fichas de producto del sitio a
  // veces manda el mismo mensaje de siempre pero solo con el TÍTULO de la
  // página en vez de un link http real con utm_* (ej. "Url: Cargador para
  // notebook | Original y Alternativo - IndexStore.cl") -- detectado
  // auditando "Origen desconocido" en Analítica: ~1 de cada 4 casos tenía
  // este patrón exacto. Se reconoce por el texto fijo del mensaje ("si
  // busca Cargador... Indícanos el Modelo del equipo"), no por cualquier
  // "Url:" suelto, para no confundir un mensaje real de un cliente que
  // casualmente escriba esa palabra.
  if (/si busca cargador/i.test(texto) && /ind[ií]canos el modelo/i.test(texto)) {
    const m = texto.match(/url:\s*(.+)$/is);
    const titulo = m ? m[1].trim() : null;
    if (titulo) return { urlLimpia: null, etiqueta: titulo, id: titulo };
  }

  return null;
}

// ---- Usuarios activos, para el selector de "Responsable" (punto 21) ----
// api/usuarios.js es admin-only (gestión completa de cuentas) -- acá se
// necesita algo bien distinto: que CUALQUIER usuario logueado pueda ver
// a quién asignarle una conversación, sin exponer email/rol/hash. Se
// mantiene multiplexado en negocio.js (tope de 12 funciones serverless).
async function manejarWhatsappUsuarios(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sql = await getSql();
    const { rows } = await sql`SELECT id, nombre FROM usuarios WHERE activo = true ORDER BY nombre ASC;`;
    return res.status(200).json({ usuarios: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Error al cargar usuarios', detail: String(err) });
  }
}

// Diagnóstico puntual: muestra real de conversaciones donde un campo
// "comodín" (categoria u motivo_perdida) tiene un valor dado (por
// defecto 'otra'/'otro'), con resumen/producto/primer mensaje del
// cliente, para revisar si el enum correspondiente está capturando bien
// la realidad. campo whitelisteado a propósito (nunca interpolar un
// nombre de columna que venga directo de la query string). Uso temporal
// vía navegador ya logueado: /api/negocio?recurso=whatsapp-debug-categoria
async function manejarWhatsappDebugCategoria(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sql = await getSql();
    // Chequeo puntual de zona horaria de la sesión de Postgres -- ver
    // conversación sobre si "hoy"/"este mes" del dashboard usan hora de
    // Chile o UTC (CURRENT_DATE/now() dependen de esto).
    if (req.query.campo === 'zona') {
      const { rows: zonaRows } = await sql.query(
        `SELECT now() AS ahora_utc, CURRENT_DATE AS fecha_actual_sesion, current_setting('TIMEZONE') AS timezone_sesion,
                now() AT TIME ZONE 'America/Santiago' AS ahora_santiago;`
      );
      return res.status(200).json(zonaRows[0]);
    }
    // Muestra de conversaciones con fuente_tipo desconocida (NULL) -- para
    // ver si hay algún patrón real (ej. un mensaje de plantilla repetido,
    // un vendedor que las inició) que permita detectar una fuente
    // específica en vez de dejarlas todas en "Origen desconocido".
    if (req.query.campo === 'fuente_desconocido') {
      const limite = Math.min(parseInt(req.query.limite, 10) || 25, 50);
      const { rows } = await sql.query(
        `SELECT c.id, c.intencion, c.categoria, c.resultado, c.vendedor_detectado, c.responsable_id,
                (SELECT contenido_texto FROM whatsapp_mensajes m
                  WHERE m.conversacion_id = c.id AND m.direccion = 'in'
                  ORDER BY m.marca_tiempo ASC LIMIT 1) AS primer_mensaje_cliente,
                (SELECT contenido_texto FROM whatsapp_mensajes m
                  WHERE m.conversacion_id = c.id AND m.direccion = 'out'
                  ORDER BY m.marca_tiempo ASC LIMIT 1) AS primer_mensaje_negocio,
                (SELECT direccion FROM whatsapp_mensajes m
                  WHERE m.conversacion_id = c.id ORDER BY m.marca_tiempo ASC LIMIT 1) AS quien_partio
         FROM whatsapp_conversaciones c
         WHERE c.fuente_tipo IS NULL
         ORDER BY c.iniciada_en DESC
         LIMIT $1;`,
        [limite]
      );
      return res.status(200).json({ campo: 'fuente_desconocido', total: rows.length, muestras: rows });
    }
    const camposValidos = { categoria: 'c.categoria', motivo_perdida: 'c.motivo_perdida' };
    const campo = camposValidos[req.query.campo] ? req.query.campo : 'categoria';
    const columna = camposValidos[campo];
    const valor = String(req.query.valor || req.query.categoria || (campo === 'motivo_perdida' ? 'otro' : 'otra'));
    const limite = Math.min(parseInt(req.query.limite, 10) || 25, 50);
    const { rows } = await sql.query(
      `SELECT c.id, c.producto, c.marca, c.modelo, c.intencion, c.categoria, c.resultado, c.motivo_perdida,
              a.resumen, a.problema_cliente, a.observaciones,
              (SELECT contenido_texto FROM whatsapp_mensajes m
                WHERE m.conversacion_id = c.id AND m.direccion = 'in' AND m.contenido_texto IS NOT NULL
                ORDER BY m.marca_tiempo ASC LIMIT 1) AS primer_mensaje_cliente
       FROM whatsapp_conversaciones c
       LEFT JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id
       WHERE ${columna} = $1
       ORDER BY c.iniciada_en DESC
       LIMIT $2;`,
      [valor, limite]
    );
    return res.status(200).json({ campo, valor, total: rows.length, muestras: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Error al cargar muestra de diagnóstico', detail: String(err) });
  }
}

// ---- Dashboard (punto 4 del pedido) ----
async function manejarWhatsappDashboard(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);

    // La sesión de Postgres corre en GMT/UTC (confirmado con
    // ?campo=zona del endpoint de diagnóstico), así que CURRENT_DATE y
    // date_trunc('month', now()) sin más marcan el corte de "hoy"/"este
    // mes" a la medianoche UTC -- en Chile (UTC-3/-4 según horario de
    // verano) eso corta el día real 3-4 horas antes de tiempo. "zona"
    // calcula el inicio del día/mes en hora de Chile (convierte a hora
    // local, trunca, y vuelve a convertir a instante UTC real para poder
    // compararlo contra iniciada_en, que es timestamptz). ult7/ult7_anterior
    // no llevan este ajuste porque son una resta de duración fija desde el
    // instante actual, no un corte de día calendario -- no dependen de
    // huso horario.
    const { rows } = await sql`
      WITH zona AS (
        SELECT
          (date_trunc('day', now() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago') AS inicio_hoy,
          (date_trunc('month', now() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago') AS inicio_mes
      )
      SELECT
        COUNT(*) FILTER (WHERE iniciada_en >= zona.inicio_hoy) AS hoy,
        COUNT(*) FILTER (WHERE iniciada_en >= now() - interval '7 days') AS ult7,
        COUNT(*) FILTER (WHERE iniciada_en >= now() - interval '14 days' AND iniciada_en < now() - interval '7 days') AS ult7_anterior,
        COUNT(*) FILTER (WHERE iniciada_en >= zona.inicio_mes) AS mes,
        COUNT(*) FILTER (WHERE iniciada_en >= zona.inicio_mes - interval '1 month' AND iniciada_en < zona.inicio_mes) AS mes_anterior,
        COUNT(DISTINCT contacto_id) FILTER (WHERE iniciada_en >= zona.inicio_mes) AS clientes_unicos_mes,
        COUNT(DISTINCT contacto_id) FILTER (WHERE iniciada_en >= zona.inicio_mes - interval '1 month' AND iniciada_en < zona.inicio_mes) AS clientes_unicos_mes_anterior,
        AVG(primera_respuesta_segundos) FILTER (WHERE primera_respuesta_segundos IS NOT NULL) AS promedio_respuesta_seg,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY primera_respuesta_segundos) FILTER (WHERE primera_respuesta_segundos IS NOT NULL) AS mediana_respuesta_seg,
        COUNT(*) FILTER (WHERE primera_respuesta_segundos IS NOT NULL) AS con_respuesta,
        COUNT(*) FILTER (WHERE primera_respuesta_segundos < 300) AS bajo_5min,
        COUNT(*) FILTER (WHERE primera_respuesta_segundos >= 300 AND primera_respuesta_segundos <= 600) AS entre_5_10min,
        COUNT(*) FILTER (WHERE primera_respuesta_segundos > 600) AS sobre_10min,
        COUNT(*) FILTER (WHERE primera_respuesta_segundos IS NULL AND primer_mensaje_cliente_en IS NOT NULL) AS sin_respuesta,
        COUNT(*) FILTER (WHERE intencion = 'compra') AS con_intencion_compra,
        COUNT(*) FILTER (WHERE resultado = 'cotizacion') AS cotizaciones,
        COUNT(*) FILTER (WHERE venta_detectada = true) AS ventas,
        COALESCE(SUM(venta_monto) FILTER (WHERE venta_detectada = true), 0) AS monto_total_ventas,
        COUNT(*) FILTER (WHERE requiere_seguimiento = true AND (seguimiento_estado IS NULL OR seguimiento_estado = 'pendiente')) AS requieren_seguimiento,
        COUNT(*) AS total_conversaciones
      FROM whatsapp_conversaciones, zona;
    `;
    const r = rows[0] || {};
    const num = v => Number(v) || 0;
    const variacionPct = (actual, anterior) => {
      anterior = num(anterior); actual = num(actual);
      if (anterior === 0) return actual === 0 ? null : Infinity;
      return Math.round(((actual - anterior) / anterior) * 1000) / 10;
    };
    const pct = (parte, total) => total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
    const conRespuesta = num(r.con_respuesta);

    return res.status(200).json({
      conversaciones: {
        hoy: num(r.hoy),
        ult7dias: num(r.ult7), ult7diasVariacion: variacionPct(r.ult7, r.ult7_anterior),
        mes: num(r.mes), mesVariacion: variacionPct(r.mes, r.mes_anterior),
        clientesUnicosMes: num(r.clientes_unicos_mes), clientesUnicosMesVariacion: variacionPct(r.clientes_unicos_mes, r.clientes_unicos_mes_anterior),
      },
      atencion: {
        promedioSegundos: r.promedio_respuesta_seg != null ? Math.round(Number(r.promedio_respuesta_seg)) : null,
        medianaSegundos: r.mediana_respuesta_seg != null ? Math.round(Number(r.mediana_respuesta_seg)) : null,
        pctBajo5min: pct(num(r.bajo_5min), conRespuesta),
        pctEntre5y10min: pct(num(r.entre_5_10min), conRespuesta),
        pctSobre10min: pct(num(r.sobre_10min), conRespuesta),
        sinRespuesta: num(r.sin_respuesta),
      },
      comercial: {
        conIntencionCompra: num(r.con_intencion_compra),
        cotizaciones: num(r.cotizaciones),
        ventas: num(r.ventas),
        montoTotalVentas: num(r.monto_total_ventas),
        conversionVenta: pct(num(r.ventas), num(r.total_conversaciones)),
        requierenSeguimiento: num(r.requieren_seguimiento),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error calculando el dashboard de WhatsApp', detail: String(err) });
  }
}

// Traduce los filtros de ?query a condiciones SQL parametrizadas -> se
// arma a mano (en vez de con el tagged-template `sql`) porque el número de
// condiciones es variable según qué filtros vengan, y el tagged-template
// no se presta bien para eso. Se usa sql.query(texto, params), mismo
// mecanismo parametrizado que ya usa el resto del proyecto para inserts
// masivos -> nunca se concatena el VALOR del usuario directo en el texto.
function armarFiltrosConversacionesWhatsapp(query) {
  const cond = [];
  const params = [];
  const p = (valor) => { params.push(valor); return `$${params.length}`; };

  if (query.desde) cond.push(`c.iniciada_en >= ${p(query.desde + 'T00:00:00')}`);
  if (query.hasta) cond.push(`c.iniciada_en <= ${p(query.hasta + 'T23:59:59')}`);
  if (query.estado) cond.push(`c.estado = ${p(query.estado)}`);
  if (query.resultado) cond.push(`c.resultado = ${p(query.resultado)}`);
  if (query.intencion) cond.push(`c.intencion = ${p(query.intencion)}`);
  // El filtro se llama "Producto" en la UI pero sus opciones son las
  // categorías (WHATSAPP_CATEGORIAS: pantalla/cargador/bateria/...) -> hay
  // que compararlo contra c.categoria, no contra c.producto (que guarda el
  // nombre libre del ítem específico, ej. "Pantalla HP Pavilion").
  if (query.producto) cond.push(`c.categoria = ${p(query.producto)}`);
  if (query.responsableId) cond.push(query.responsableId === 'sin_asignar' ? `c.responsable_id IS NULL` : `c.responsable_id = ${p(Number(query.responsableId))}`);

  if (query.respuesta) {
    const rangos = {
      'menos1': `c.primera_respuesta_segundos < 60`,
      'menos5': `c.primera_respuesta_segundos < 300`,
      '5a10': `c.primera_respuesta_segundos >= 300 AND c.primera_respuesta_segundos <= 600`,
      '10a30': `c.primera_respuesta_segundos > 600 AND c.primera_respuesta_segundos <= 1800`,
      'mas30': `c.primera_respuesta_segundos > 1800`,
      'sin_respuesta': `c.primera_respuesta_segundos IS NULL AND c.primer_mensaje_cliente_en IS NOT NULL`,
    };
    if (rangos[query.respuesta]) cond.push(rangos[query.respuesta]);
  }

  if (query.probabilidad) {
    const rangos = {
      '0a25': `a.probabilidad_compra BETWEEN 0 AND 25`,
      '26a50': `a.probabilidad_compra BETWEEN 26 AND 50`,
      '51a75': `a.probabilidad_compra BETWEEN 51 AND 75`,
      '76a100': `a.probabilidad_compra BETWEEN 76 AND 100`,
    };
    if (rangos[query.probabilidad]) cond.push(rangos[query.probabilidad]);
  }

  if (query.venta === 'con_venta') cond.push(`c.venta_detectada = true`);
  if (query.venta === 'sin_venta') cond.push(`c.venta_detectada = false`);
  if (query.seguimiento === 'requiere') cond.push(`c.requiere_seguimiento = true`);
  if (query.seguimiento === 'no_requiere') cond.push(`c.requiere_seguimiento = false`);

  if (query.q) {
    const qParam = p(`%${query.q}%`);
    const idNum = Number(query.q);
    const condId = Number.isInteger(idNum) ? ` OR c.id = ${p(idNum)}` : '';
    cond.push(`(
      ct.nombre ILIKE ${qParam} OR ct.telefono ILIKE ${qParam} OR c.producto ILIKE ${qParam}
      OR c.marca ILIKE ${qParam} OR c.modelo ILIKE ${qParam} OR c.pedido_asociado ILIKE ${qParam}
      OR EXISTS (SELECT 1 FROM whatsapp_mensajes m WHERE m.conversacion_id = c.id AND m.contenido_texto ILIKE ${qParam})
      ${condId}
    )`);
  }

  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}

// ---- Conversaciones: listado paginado (punto 8/9/10/33) + edición (punto 25/23/24/15) ----
async function manejarWhatsappConversaciones(req, res, sesion) {
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);

    if (req.method === 'GET') {
      const { where, params } = armarFiltrosConversacionesWhatsapp(req.query);
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(200, Math.max(10, parseInt(req.query.pageSize, 10) || 25));
      const offset = (page - 1) * pageSize;

      const sqlBase = `
        FROM whatsapp_conversaciones c
        JOIN whatsapp_contactos ct ON ct.id = c.contacto_id
        LEFT JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id
        LEFT JOIN usuarios u ON u.id = c.responsable_id
        ${where}
      `;
      const { rows: totalRows } = await sql.query(`SELECT COUNT(*)::int AS n ${sqlBase}`, params);
      const total = totalRows[0]?.n || 0;

      const paramsConPaginacion = [...params, pageSize, offset];
      const { rows } = await sql.query(
        `SELECT
           c.id, c.iniciada_en, c.estado, c.intencion, c.categoria, c.producto, c.marca, c.modelo,
           c.primera_respuesta_segundos, c.resultado, c.motivo_perdida, c.venta_detectada, c.venta_monto,
           c.requiere_seguimiento, c.cantidad_mensajes, c.ultimo_mensaje_resumen, c.responsable_id, c.vendedor_detectado,
           c.shopify_producto_url, c.shopify_producto_titulo, c.shopify_producto_confianza,
           c.bsale_documento_numero, c.bsale_documento_tipo, c.bsale_documento_monto, c.bsale_documento_fecha, c.bsale_documento_url,
           c.fuente_tipo, c.fuente_titulo, c.fuente_url, c.fuente_id,
           ct.nombre AS cliente_nombre, ct.telefono AS cliente_telefono,
           a.probabilidad_compra,
           u.nombre AS responsable_nombre,
           (SELECT COUNT(*)::int FROM whatsapp_mensajes m WHERE m.conversacion_id = c.id AND m.tipo = 'imagen') AS cantidad_imagenes,
           -- Para el botón "Analizar con IA" del listado (no solo dentro del
           -- detalle): true si nunca se analizó, o si llegaron mensajes
           -- nuevos después del último análisis (mismo criterio que
           -- manejarWhatsappReanalizarDesactualizadas). Solo aplica a
           -- conversaciones con mensajes de verdad.
           (c.cantidad_mensajes > 0 AND (
             a.conversacion_id IS NULL
             OR EXISTS (SELECT 1 FROM whatsapp_mensajes m WHERE m.conversacion_id = c.id AND m.marca_tiempo > a.updated_at)
           )) AS analisis_desactualizado
         ${sqlBase}
         ORDER BY c.iniciada_en DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        paramsConPaginacion
      );

      return res.status(200).json({
        conversaciones: rows.map(mapearConversacionWhatsapp),
        total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
      });
    }

    if (req.method === 'PUT') {
      if (sesion.rol !== 'admin' && !req.body?.soloResponsablePropio) {
        // Cualquier usuario autenticado puede gestionar sus conversaciones
        // asignadas; queda abierto a que a futuro se agregue un permiso
        // más fino (ver Perfiles de acceso) si hace falta restringir por
        // rol de verdad. Por ahora el control real es: solo se editan
        // conversaciones, no se borra nada, y todo cambio queda en
        // whatsapp_auditoria.
      }
      const { id, estado, responsableId, intencion, producto, marca, modelo, resultado, motivoPerdida,
        requiereSeguimiento, seguimientoEn, seguimientoEstado, seguimientoObservaciones, etiquetas } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Falta id' });
      if (estado && !WHATSAPP_ESTADOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
      if (resultado && !WHATSAPP_RESULTADOS.includes(resultado)) return res.status(400).json({ error: 'Resultado inválido' });
      if (seguimientoEstado && !WHATSAPP_SEGUIMIENTO_ESTADOS.includes(seguimientoEstado)) return res.status(400).json({ error: 'Estado de seguimiento inválido' });

      const { rows: antesRows } = await sql`SELECT * FROM whatsapp_conversaciones WHERE id = ${id};`;
      const antes = antesRows[0];
      if (!antes) return res.status(404).json({ error: 'Conversación no encontrada' });

      // Marca como "editado a mano" cualquiera de estos 6 campos que venga
      // en la solicitud -- así el Análisis IA (ver ejecutarAnalisisIA) sabe
      // que ya no debe tocarlos en reanálisis futuros, automáticos o no.
      const editadosNuevos = new Set(antes.campos_editados_manualmente || []);
      if (intencion !== undefined) editadosNuevos.add('intencion');
      if (producto !== undefined) editadosNuevos.add('producto');
      if (marca !== undefined) editadosNuevos.add('marca');
      if (modelo !== undefined) editadosNuevos.add('modelo');
      if (resultado !== undefined) editadosNuevos.add('resultado');
      if (motivoPerdida !== undefined) editadosNuevos.add('motivo_perdida');

      await sql`
        UPDATE whatsapp_conversaciones SET
          estado = COALESCE(${estado}, estado),
          responsable_id = CASE WHEN ${responsableId !== undefined} THEN ${responsableId || null} ELSE responsable_id END,
          intencion = COALESCE(${intencion}, intencion),
          producto = COALESCE(${producto}, producto),
          marca = COALESCE(${marca}, marca),
          modelo = COALESCE(${modelo}, modelo),
          resultado = COALESCE(${resultado}, resultado),
          motivo_perdida = COALESCE(${motivoPerdida}, motivo_perdida),
          requiere_seguimiento = COALESCE(${requiereSeguimiento}, requiere_seguimiento),
          seguimiento_en = CASE WHEN ${seguimientoEn !== undefined} THEN ${seguimientoEn || null} ELSE seguimiento_en END,
          seguimiento_estado = COALESCE(${seguimientoEstado}, seguimiento_estado),
          seguimiento_observaciones = CASE WHEN ${seguimientoObservaciones !== undefined} THEN ${seguimientoObservaciones || null} ELSE seguimiento_observaciones END,
          campos_editados_manualmente = ${[...editadosNuevos]},
          updated_at = now()
        WHERE id = ${id};
      `;

      // Auditoría (punto 36): un renglón legible por cada cambio relevante.
      const quien = sesion.nombre || sesion.email;
      const cambios = [];
      if (responsableId !== undefined && Number(responsableId || 0) !== Number(antes.responsable_id || 0)) {
        const { rows: nuevoResp } = responsableId ? await sql`SELECT nombre FROM usuarios WHERE id = ${responsableId};` : { rows: [] };
        const { rows: viejoResp } = antes.responsable_id ? await sql`SELECT nombre FROM usuarios WHERE id = ${antes.responsable_id};` : { rows: [] };
        cambios.push(`cambió responsable: ${viejoResp[0]?.nombre || 'Sin asignar'} → ${nuevoResp[0]?.nombre || 'Sin asignar'}`);
      }
      if (estado && estado !== antes.estado) cambios.push(`cambió estado: ${antes.estado} → ${estado}`);
      if (resultado && resultado !== antes.resultado) cambios.push(`cambió resultado: ${antes.resultado || '—'} → ${resultado}`);
      if (seguimientoEstado && seguimientoEstado !== antes.seguimiento_estado) cambios.push(`cambió estado de seguimiento: ${antes.seguimiento_estado || '—'} → ${seguimientoEstado}`);
      for (const detalle of cambios) {
        await sql`INSERT INTO whatsapp_auditoria (conversacion_id, usuario_email, accion, detalle) VALUES (${id}, ${quien}, 'edicion', ${detalle});`;
      }

      // Etiquetas: reemplaza el set completo por el que llegó (más simple
      // que diffear agregar/quitar, y son pocas por conversación).
      if (Array.isArray(etiquetas)) {
        await sql`DELETE FROM whatsapp_conversacion_etiquetas WHERE conversacion_id = ${id};`;
        for (const nombreEtiqueta of etiquetas) {
          const { rows: et } = await sql`INSERT INTO whatsapp_etiquetas (nombre) VALUES (${nombreEtiqueta}) ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id;`;
          await sql`INSERT INTO whatsapp_conversacion_etiquetas (conversacion_id, etiqueta_id) VALUES (${id}, ${et[0].id}) ON CONFLICT DO NOTHING;`;
        }
        await sql`INSERT INTO whatsapp_auditoria (conversacion_id, usuario_email, accion, detalle) VALUES (${id}, ${quien}, 'etiquetas', ${'etiquetas: ' + etiquetas.join(', ')});`;
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en conversaciones de WhatsApp', detail: String(err) });
  }
}

function mapearConversacionWhatsapp(r) {
  return {
    id: r.id,
    fecha: r.iniciada_en ? new Date(r.iniciada_en).toISOString() : null,
    clienteNombre: r.cliente_nombre,
    clienteTelefono: r.cliente_telefono,
    estado: r.estado,
    ultimoMensaje: r.ultimo_mensaje_resumen,
    intencion: r.intencion,
    categoria: r.categoria,
    producto: r.producto,
    marca: r.marca,
    modelo: r.modelo,
    primeraRespuestaSegundos: r.primera_respuesta_segundos,
    probabilidadCompra: r.probabilidad_compra,
    resultado: r.resultado,
    motivoPerdida: r.motivo_perdida,
    venta: r.venta_detectada,
    montoVenta: r.venta_monto != null ? Number(r.venta_monto) : null,
    requiereSeguimiento: r.requiere_seguimiento,
    responsableId: r.responsable_id,
    responsableNombre: r.responsable_nombre,
    vendedorDetectado: r.vendedor_detectado,
    shopifyProductoUrl: r.shopify_producto_url,
    shopifyProductoTitulo: r.shopify_producto_titulo,
    shopifyProductoConfianza: r.shopify_producto_confianza,
    bsaleDocumentoNumero: r.bsale_documento_numero,
    bsaleDocumentoTipo: r.bsale_documento_tipo,
    bsaleDocumentoMonto: r.bsale_documento_monto != null ? Number(r.bsale_documento_monto) : null,
    bsaleDocumentoFecha: r.bsale_documento_fecha,
    bsaleDocumentoUrl: r.bsale_documento_url,
    fuenteTipo: r.fuente_tipo,
    fuenteTitulo: r.fuente_titulo,
    fuenteUrl: r.fuente_url,
    fuenteId: r.fuente_id,
    cantidadMensajes: r.cantidad_mensajes,
    cantidadImagenes: r.cantidad_imagenes || 0,
    analisisDesactualizado: r.analisis_desactualizado === true,
  };
}

// ---- Detalle de una conversación (punto 11/12/13 del pedido) ----
async function manejarWhatsappConversacionDetalle(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta id' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);
    await asegurarTablaBsalePuntos(sql);

    const { rows: convRows } = await sql`
      SELECT c.*, u.nombre AS responsable_nombre
      FROM whatsapp_conversaciones c LEFT JOIN usuarios u ON u.id = c.responsable_id
      WHERE c.id = ${id};
    `;
    const conv = convRows[0];
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    const { rows: contactoRows } = await sql`
      SELECT ct.*, (SELECT COUNT(*)::int FROM whatsapp_conversaciones WHERE contacto_id = ct.id) AS total_conversaciones_real
      FROM whatsapp_contactos ct WHERE ct.id = ${conv.contacto_id};
    `;
    const contacto = contactoRows[0];
    const clienteBsale = await buscarClienteBsalePorTelefono(sql, contacto?.telefono);

    const { rows: mensajes } = await sql`SELECT * FROM whatsapp_mensajes WHERE conversacion_id = ${id} ORDER BY marca_tiempo ASC;`;
    const { rows: analisisRows } = await sql`SELECT * FROM whatsapp_analisis_ia WHERE conversacion_id = ${id};`;
    const { rows: auditoria } = await sql`SELECT * FROM whatsapp_auditoria WHERE conversacion_id = ${id} ORDER BY created_at DESC LIMIT 30;`;
    const { rows: etiquetas } = await sql`
      SELECT e.nombre FROM whatsapp_conversacion_etiquetas ce
      JOIN whatsapp_etiquetas e ON e.id = ce.etiqueta_id
      WHERE ce.conversacion_id = ${id};
    `;
    const { rows: ventaRows } = await sql`SELECT * FROM whatsapp_ventas WHERE conversacion_id = ${id} ORDER BY created_at DESC LIMIT 1;`;

    // Ventana de 24h de WhatsApp: solo se puede mandar texto libre si el
    // cliente escribió dentro de las últimas 24h desde su último mensaje
    // -- pasado eso, la API de Meta rechaza cualquier mensaje que no sea
    // una plantilla pre-aprobada (no implementado todavía). Se calcula acá
    // (no en el frontend) para que sea la misma fuente de verdad que usa
    // manejarWhatsappEnviarMensaje al validar antes de mandar.
    const ultimoInboundEn = [...mensajes].reverse().find(m => m.direccion === 'in')?.marca_tiempo || null;
    const ventanaExpiraEn = ultimoInboundEn ? new Date(new Date(ultimoInboundEn).getTime() + 24 * 3600000).toISOString() : null;
    const ventanaAbierta = ventanaExpiraEn ? new Date(ventanaExpiraEn).getTime() > Date.now() : false;

    return res.status(200).json({
      conversacion: {
        ...mapearConversacionWhatsapp({ ...conv, cliente_nombre: contacto?.nombre, cliente_telefono: contacto?.telefono, probabilidad_compra: analisisRows[0]?.probabilidad_compra }),
        pedidoAsociado: conv.pedido_asociado,
      },
      ventanaAbierta, ventanaExpiraEn,
      contacto: contacto ? {
        id: contacto.id, nombre: contacto.nombre, telefono: contacto.telefono, whatsappId: contacto.whatsapp_id,
        primeraConversacionEn: contacto.primera_conversacion_en, ultimaConversacionEn: contacto.ultima_conversacion_en,
        totalConversaciones: contacto.total_conversaciones_real,
      } : null,
      clienteBsale: clienteBsale ? {
        id: clienteBsale.id, nombre: clienteBsale.nombre, rut: clienteBsale.rut,
        empresa: clienteBsale.empresa, puntos: clienteBsale.puntos,
      } : null,
      mensajes: mensajes.map(m => ({
        id: m.id, marcaTiempo: m.marca_tiempo, direccion: m.direccion, tipo: m.tipo,
        texto: m.contenido_texto, mediaUrl: m.media_url, estado: m.estado,
      })),
      analisisIa: analisisRows[0] ? {
        resumen: analisisRows[0].resumen, intencion: analisisRows[0].intencion, categoria: analisisRows[0].categoria,
        producto: analisisRows[0].producto, marca: analisisRows[0].marca, modelo: analisisRows[0].modelo,
        problemaCliente: analisisRows[0].problema_cliente, especificaciones: analisisRows[0].especificaciones, probabilidadCompra: analisisRows[0].probabilidad_compra,
        resultado: analisisRows[0].resultado, motivoPerdida: analisisRows[0].motivo_perdida,
        sentimiento: analisisRows[0].sentimiento, calidadAtencionScore: analisisRows[0].calidad_atencion_score,
        requiereSeguimiento: analisisRows[0].requiere_seguimiento, observaciones: analisisRows[0].observaciones,
      } : null,
      etiquetas: etiquetas.map(e => e.nombre),
      auditoria: auditoria.map(a => ({ accion: a.accion, detalle: a.detalle, usuario: a.usuario_email, fecha: a.created_at })),
      venta: ventaRows[0] ? {
        pedidoExterno: ventaRows[0].pedido_externo, fecha: ventaRows[0].fecha_venta,
        monto: ventaRows[0].monto != null ? Number(ventaRows[0].monto) : null,
      } : null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al cargar el detalle de la conversación', detail: String(err) });
  }
}

// ---- Clientes (punto 16/17 del pedido: no conversaciones, clientes únicos) ----
async function manejarWhatsappClientes(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);
    await asegurarTablaBsalePuntos(sql);

    const q = (req.query.q || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(req.query.pageSize, 10) || 25));
    const offset = (page - 1) * pageSize;

    const cond = q ? `WHERE ct.nombre ILIKE $1 OR ct.telefono ILIKE $1` : '';
    const params = q ? [`%${q}%`] : [];

    const { rows: totalRows } = await sql.query(`SELECT COUNT(*)::int AS n FROM whatsapp_contactos ct ${cond};`, params);
    const total = totalRows[0]?.n || 0;

    const { rows } = await sql.query(
      `SELECT
         ct.id, ct.nombre, ct.telefono, ct.primera_conversacion_en, ct.ultima_conversacion_en, ct.total_conversaciones,
         (SELECT COUNT(*)::int FROM whatsapp_conversaciones cv WHERE cv.contacto_id = ct.id AND cv.venta_detectada = true) AS num_ventas,
         (SELECT COALESCE(SUM(venta_monto),0) FROM whatsapp_conversaciones cv WHERE cv.contacto_id = ct.id AND cv.venta_detectada = true) AS total_comprado,
         (SELECT array_agg(DISTINCT producto) FROM whatsapp_conversaciones cv WHERE cv.contacto_id = ct.id AND producto IS NOT NULL) AS productos_consultados,
         (SELECT intencion FROM whatsapp_conversaciones cv WHERE cv.contacto_id = ct.id ORDER BY iniciada_en DESC LIMIT 1) AS ultima_intencion,
         (SELECT estado FROM whatsapp_conversaciones cv WHERE cv.contacto_id = ct.id ORDER BY iniciada_en DESC LIMIT 1) AS ultimo_estado,
         bcli.id AS bsale_cliente_id, bcli.nombre AS bsale_cliente_nombre
       FROM whatsapp_contactos ct
       LEFT JOIN LATERAL (
         SELECT bp.id, bp.nombre FROM bsale_clientes_puntos bp
         WHERE bp.telefono_normalizado <> '' AND bp.telefono_normalizado = right(regexp_replace(coalesce(ct.telefono, ''), '[^0-9]', '', 'g'), 9)
         LIMIT 1
       ) bcli ON true
       ${cond}
       ORDER BY ct.ultima_conversacion_en DESC NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2};`,
      [...params, pageSize, offset]
    );

    return res.status(200).json({
      clientes: rows.map(r => ({
        id: r.id, nombre: r.nombre, telefono: r.telefono,
        primeraConversacion: r.primera_conversacion_en, ultimaConversacion: r.ultima_conversacion_en,
        numConversaciones: r.total_conversaciones,
        productosConsultados: r.productos_consultados || [],
        numVentas: r.num_ventas,
        totalComprado: Number(r.total_comprado) || 0,
        ultimaIntencion: r.ultima_intencion,
        estado: r.ultimo_estado,
        bsaleClienteId: r.bsale_cliente_id,
        bsaleClienteNombre: r.bsale_cliente_nombre,
      })),
      total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al cargar clientes de WhatsApp', detail: String(err) });
  }
}

async function manejarWhatsappClienteDetalle(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta id' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);
    await asegurarTablaBsalePuntos(sql);

    const { rows: contactoRows } = await sql`SELECT * FROM whatsapp_contactos WHERE id = ${id};`;
    const contacto = contactoRows[0];
    if (!contacto) return res.status(404).json({ error: 'Cliente no encontrado' });
    const clienteBsale = await buscarClienteBsalePorTelefono(sql, contacto.telefono);

    const { rows: conversaciones } = await sql`
      SELECT c.*, a.probabilidad_compra
      FROM whatsapp_conversaciones c LEFT JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id
      WHERE c.contacto_id = ${id} ORDER BY c.iniciada_en DESC;
    `;

    return res.status(200).json({
      cliente: {
        id: contacto.id, nombre: contacto.nombre, telefono: contacto.telefono, whatsappId: contacto.whatsapp_id,
        primeraConversacion: contacto.primera_conversacion_en, ultimaConversacion: contacto.ultima_conversacion_en,
        totalConversaciones: contacto.total_conversaciones,
      },
      clienteBsale: clienteBsale ? {
        id: clienteBsale.id, nombre: clienteBsale.nombre, rut: clienteBsale.rut,
        empresa: clienteBsale.empresa, puntos: clienteBsale.puntos,
      } : null,
      conversaciones: conversaciones.map(r => mapearConversacionWhatsapp({ ...r, cliente_nombre: contacto.nombre, cliente_telefono: contacto.telefono })),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al cargar el cliente', detail: String(err) });
  }
}

// ---- Seguimientos (punto 15 del pedido) ----
async function manejarWhatsappSeguimientos(req, res, sesion) {
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);

    if (req.method === 'GET') {
      const estadoFiltro = req.query.estado;
      const { rows } = await sql`
        SELECT c.*, ct.nombre AS cliente_nombre, ct.telefono AS cliente_telefono, a.probabilidad_compra, u.nombre AS responsable_nombre
        FROM whatsapp_conversaciones c
        JOIN whatsapp_contactos ct ON ct.id = c.contacto_id
        LEFT JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id
        LEFT JOIN usuarios u ON u.id = c.responsable_id
        WHERE c.requiere_seguimiento = true
        ORDER BY c.seguimiento_en ASC NULLS LAST, c.iniciada_en DESC;
      `;
      const filtradas = estadoFiltro ? rows.filter(r => (r.seguimiento_estado || 'pendiente') === estadoFiltro) : rows;
      return res.status(200).json({
        seguimientos: filtradas.map(r => ({
          ...mapearConversacionWhatsapp(r),
          seguimientoEn: r.seguimiento_en,
          seguimientoEstado: r.seguimiento_estado || 'pendiente',
          seguimientoObservaciones: r.seguimiento_observaciones,
        })),
      });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al cargar seguimientos de WhatsApp', detail: String(err) });
  }
}

// ---- Etiquetas (punto 26) ----
async function manejarWhatsappEtiquetas(req, res, sesion) {
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);
    if (req.method === 'GET') {
      const { rows } = await sql`SELECT nombre FROM whatsapp_etiquetas ORDER BY nombre ASC;`;
      return res.status(200).json({ etiquetas: rows.map(r => r.nombre) });
    }
    if (req.method === 'POST') {
      const { nombre } = req.body || {};
      if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre de la etiqueta' });
      await sql`INSERT INTO whatsapp_etiquetas (nombre) VALUES (${nombre.trim()}) ON CONFLICT (nombre) DO NOTHING;`;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Error en etiquetas de WhatsApp', detail: String(err) });
  }
}

// ---- Asociar venta (punto 24) ----
async function manejarWhatsappVenta(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { conversacionId, pedidoExterno, monto, fecha } = req.body || {};
  if (!conversacionId || !monto) return res.status(400).json({ error: 'Falta conversacionId o monto' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);
    const { rows: convRows } = await sql`SELECT contacto_id FROM whatsapp_conversaciones WHERE id = ${conversacionId};`;
    if (!convRows[0]) return res.status(404).json({ error: 'Conversación no encontrada' });

    await sql`
      INSERT INTO whatsapp_ventas (conversacion_id, contacto_id, pedido_externo, fecha_venta, monto, creado_por)
      VALUES (${conversacionId}, ${convRows[0].contacto_id}, ${pedidoExterno || null}, ${fecha || new Date().toISOString().slice(0,10)}, ${monto}, ${sesion.nombre || sesion.email});
    `;
    await sql`
      UPDATE whatsapp_conversaciones SET venta_detectada = true, venta_monto = ${monto}, pedido_asociado = ${pedidoExterno || null}, resultado = 'venta', updated_at = now()
      WHERE id = ${conversacionId};
    `;
    await sql`INSERT INTO whatsapp_auditoria (conversacion_id, usuario_email, accion, detalle) VALUES (${conversacionId}, ${sesion.nombre || sesion.email}, 'venta_asociada', ${`Venta asociada: $${monto}${pedidoExterno ? ' — Pedido ' + pedidoExterno : ''}`});`;

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Error al asociar la venta', detail: String(err) });
  }
}

// ---- Responder desde el ERP (fase 2 del pedido original) ----
// Solo texto libre, y solo dentro de la ventana de 24h desde el último
// mensaje del cliente -- fuera de esa ventana, WhatsApp exige una
// plantilla pre-aprobada (no implementado todavía; el error de Meta al
// intentarlo queda registrado si igual llega a pasar el chequeo propio).
// Requiere WHATSAPP_ACCESS_TOKEN (Usuario del sistema, permanente) y
// WHATSAPP_PHONE_NUMBER_ID (el de tu número real conectado).
async function manejarWhatsappEnviarMensaje(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { conversacionId, texto } = req.body || {};
  if (!conversacionId || !texto || !String(texto).trim()) return res.status(400).json({ error: 'Falta conversacionId o texto' });

  const accessToken = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!accessToken || !phoneNumberId) return res.status(200).json({ error: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID no están configurados en el servidor' });

  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);

    const { rows: convRows } = await sql`
      SELECT c.id, c.responsable_id, c.primer_mensaje_cliente_en, c.primera_respuesta_empresa_en, c.estado, ct.whatsapp_id
      FROM whatsapp_conversaciones c JOIN whatsapp_contactos ct ON ct.id = c.contacto_id
      WHERE c.id = ${conversacionId};
    `;
    const conv = convRows[0];
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    // Ventana de 24h -- mismo cálculo que manejarWhatsappConversacionDetalle
    // (fuente de verdad server-side, no confía en lo que haya calculado el
    // frontend antes de mostrar el botón).
    const { rows: ultimoInboundRows } = await sql`
      SELECT MAX(marca_tiempo) AS ultimo FROM whatsapp_mensajes WHERE conversacion_id = ${conversacionId} AND direccion = 'in';
    `;
    const ultimoInbound = ultimoInboundRows[0]?.ultimo;
    const ventanaAbierta = ultimoInbound && (new Date(ultimoInbound).getTime() + 24 * 3600000) > Date.now();
    if (!ventanaAbierta) {
      return res.status(400).json({ error: 'Pasaron más de 24h desde el último mensaje del cliente -- WhatsApp ya no permite texto libre en esta conversación, se necesita una plantilla pre-aprobada (no disponible todavía).' });
    }

    const textoLimpio = String(texto).trim().slice(0, 4096);
    const rEnvio = await fetchConTimeout(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: conv.whatsapp_id, type: 'text', text: { body: textoLimpio } }),
    }, 15000);
    const bodyEnvio = await rEnvio.json().catch(() => ({}));
    if (!rEnvio.ok) {
      console.error('[whatsapp-enviar-mensaje] Meta rechazó el envío', conversacionId, rEnvio.status, JSON.stringify(bodyEnvio).slice(0, 500));
      return res.status(502).json({ error: bodyEnvio.error?.message || 'Meta rechazó el envío del mensaje' });
    }

    const whatsappMessageId = bodyEnvio.messages?.[0]?.id || null;
    const ahora = new Date();
    await sql`
      INSERT INTO whatsapp_mensajes (conversacion_id, whatsapp_message_id, marca_tiempo, direccion, origen, tipo, contenido_texto)
      VALUES (${conversacionId}, ${whatsappMessageId}, ${ahora.toISOString()}, 'out', 'api', 'texto', ${textoLimpio})
      ON CONFLICT (whatsapp_message_id) DO NOTHING;
    `;

    // Igual que en message_echoes: si es la primera respuesta del negocio
    // en esta conversación, calcula el tiempo de primera respuesta.
    if (conv.primer_mensaje_cliente_en && !conv.primera_respuesta_empresa_en) {
      const segundos = Math.max(0, Math.round((ahora.getTime() - new Date(conv.primer_mensaje_cliente_en).getTime()) / 1000));
      await sql`
        UPDATE whatsapp_conversaciones SET primera_respuesta_empresa_en = ${ahora.toISOString()}, primera_respuesta_segundos = ${segundos}
        WHERE id = ${conversacionId};
      `;
    }
    // Quien manda el mensaje queda como responsable si todavía no había
    // ninguno asignado -- no pisa una asignación previa.
    await sql`
      UPDATE whatsapp_conversaciones SET
        cantidad_mensajes = cantidad_mensajes + 1,
        ultimo_mensaje_resumen = ${textoLimpio.slice(0, 140)},
        estado = CASE WHEN estado = 'nueva' THEN 'abierta' ELSE estado END,
        responsable_id = COALESCE(responsable_id, ${sesion.uid || null}),
        updated_at = now()
      WHERE id = ${conversacionId};
    `;

    const quien = sesion.nombre || sesion.email;
    await sql`INSERT INTO whatsapp_auditoria (conversacion_id, usuario_email, accion, detalle) VALUES (${conversacionId}, ${quien}, 'mensaje_enviado', ${`Envió: "${textoLimpio.slice(0, 80)}${textoLimpio.length > 80 ? '…' : ''}"`});`;

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Error al enviar el mensaje', detail: String(err) });
  }
}

// ---- Análisis con IA (punto 13 del pedido: la tabla whatsapp_analisis_ia
// quedó preparada para esto -- este es el proceso que la llena) ----
// Usa la API de mensajes de Claude (Anthropic) con "tool use" forzado
// (tool_choice) para obtener JSON estructurado y validado por esquema, en
// vez de pedirle JSON en texto libre y parsearlo a mano -- más confiable.
// Requiere ANTHROPIC_API_KEY; sin ella, error controlado (mismo patrón
// que el resto de integraciones externas de este archivo).
// Palabra clave en español que debería aparecer en el título de Shopify
// para cada categoría -- sirve tanto para armar la búsqueda como para
// verificar después que el resultado sea del tipo correcto (ver abajo).
const WHATSAPP_CATEGORIA_PALABRA_SHOPIFY = {
  pantalla: 'pantalla', cargador: 'cargador', bateria: 'bateria',
  repuestos: 'repuesto', servicio_tecnico: null, cotizacion: null,
  compatibilidad: null, garantia: null, estado_pedido: null, postventa: null, otra: null,
};

// Tipos de equipo que cambian el producto por completo aunque la
// categoría y la marca sean las mismas (ej. "Pantalla HP" de notebook y
// "Pantalla HP All in One" son productos distintos en el catálogo real,
// aunque ambos digan "pantalla" y "HP"). Ver tipoEquipoBuscado en
// buscarProductoShopify. Todo en minúsculas y sin tildes (se compara con
// normalizarTexto).
const WHATSAPP_TIPOS_EQUIPO = ['all in one', 'aio', 'todo en uno', 'macbook', 'imac', 'pc de escritorio', 'desktop'];

// Busca en Shopify el producto que mejor calza con la categoría+marca+modelo
// detectados por el Análisis IA -- mismo mecanismo de autenticación (Client
// Credentials Grant) que api/shopify-report.js, duplicado acá porque cada
// función de /api en este proyecto es standalone (ver CLAUDE.md). Usa
// GraphQL en vez de REST porque el campo onlineStoreUrl viene resuelto
// directo (evita tener que reconstruir la URL a mano combinando dominio +
// handle, que puede no calzar si la tienda usa un dominio propio).
//
// Buscar solo por marca+modelo NO alcanza: un mismo modelo de notebook
// tiene pantalla, batería, cargador y teclado como accesorios distintos
// en el catálogo, todos con "marca + modelo" en el título -> hay que
// incluir la categoría en la búsqueda, y además verificar que el título
// del resultado la mencione de verdad antes de devolverlo con confianza
// (si Shopify igual devuelve el producto equivocado, mejor no mostrar
// ningún link que mostrar uno de la categoría incorrecta).
//
// "Mejor esfuerzo": cualquier error acá no debe tumbar el análisis IA
// completo, se atrapa aparte y sencillamente no queda link.
// Separa un texto en palabras "buscables" (2+ caracteres, sin comas ni
// dos-puntos que puedan romper la sintaxis de búsqueda de Shopify).
function palabrasBuscables(texto) {
  return (texto || '')
    .replace(/[",:]/g, ' ')
    .split(/\s+/)
    .map(p => p.trim())
    .filter(p => p.length >= 2);
}

// Arma una consulta con comodín por palabra ("title:*HP* AND title:*250*
// AND ...") en vez de una frase exacta -- la búsqueda por defecto de
// Shopify exige que el texto calce bastante literal, y en la práctica casi
// nunca calzaba (ver conversación con el usuario: "Pantalla ASUS TUF Dash
// F15 FX517ZC" daba 0 resultados aunque el producto sí existe). Con
// comodines por palabra alcanza con que cada palabra aparezca en algún
// lado del título, sin importar el orden ni el formato exacto.
async function consultarShopify(domain, accessToken, palabras) {
  if (!palabras.length) return [];
  const q = palabras.map(p => `title:*${p}*`).join(' AND ');
  const query = `query($q: String!) { products(first: 8, query: $q) { edges { node { title onlineStoreUrl } } } }`;
  const r = await fetchConTimeout(`https://${domain}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { q } }),
  }, 12000);
  if (!r.ok) { console.warn('[buscarProductoShopify] error HTTP en la búsqueda', q, r.status); return []; }
  const body = await r.json().catch(() => ({}));
  if (body.errors) { console.warn('[buscarProductoShopify] GraphQL devolvió errores', q, JSON.stringify(body.errors).slice(0, 300)); return []; }
  const total = (body.data?.products?.edges || []).length;
  const candidatos = (body.data?.products?.edges || []).filter(e => e.node.onlineStoreUrl);
  if (total > 0 && candidatos.length === 0) console.warn('[buscarProductoShopify] hubo resultados pero ninguno publicado en la tienda online', q, `(${total} total)`);
  return candidatos;
}

// Busca en Shopify el producto que mejor calza con la categoría+marca+modelo
// detectados por el Análisis IA -- mismo mecanismo de autenticación (Client
// Credentials Grant) que api/shopify-report.js, duplicado acá porque cada
// función de /api en este proyecto es standalone (ver CLAUDE.md). Usa
// GraphQL en vez de REST porque el campo onlineStoreUrl viene resuelto
// directo (evita tener que reconstruir la URL a mano combinando dominio +
// handle, que puede no calzar si la tienda usa un dominio propio).
//
// Escalera de intentos, de más específico a más amplio -- si el más
// específico no encuentra nada, se afloja de a poco en vez de rendirse de
// inmediato (la búsqueda de Shopify es sensible al formato exacto). Cada
// intento exitoso queda con un % de confianza heurístico según qué tan
// ceñido fue el criterio que sí encontró algo -- no es una probabilidad
// real, es una señal de "qué tanto se aflojó la búsqueda para encontrarlo".
// En todos los niveles se verifica que el título mencione la categoría
// esperada antes de aceptar el resultado (si ninguno calza, no se
// devuelve nada en vez de mostrar un link de la categoría equivocada).
//
// "Mejor esfuerzo": cualquier error acá no debe tumbar el análisis IA
// completo, se atrapa aparte y sencillamente no queda link.
// Client Credentials Grant de Shopify (mismo mecanismo que api/shopify-report.js,
// factorizado acá porque dentro de ESTE archivo ya se usa en más de un lugar
// -- ver buscarProductoShopify y buscarVentaShopifyPorTelefono).
async function obtenerAccesoShopify() {
  const domain = (process.env.SHOPIFY_STORE_DOMAIN || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const clientId = (process.env.SHOPIFY_CLIENT_ID || '').trim();
  const clientSecret = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();
  if (!domain || !clientId || !clientSecret) return null;

  const rToken = await fetchConTimeout(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  }, 12000);
  const bodyToken = await rToken.json().catch(() => ({}));
  if (!rToken.ok || !bodyToken.access_token) return null;
  return { domain, accessToken: bodyToken.access_token };
}

// Trae el estado (active/draft/archived) de CADA variante del catálogo de
// Shopify, indexado por SKU -- para la alerta de "stock en Bsale pero no
// visible en la tienda" en sitio-web.html (ver conversación con el
// usuario: SKU CARALUSBC01 con stock real pero archivado en Shopify, sin
// que nadie lo notara hasta revisar a mano). A propósito NO se filtra por
// status en la consulta -- acá el punto es encontrar justamente los que NO
// están activos.
//
// GraphQL (no REST) a propósito: el intento original con REST
// /products.json?fields=... devolvió error consultando Shopify en
// producción; manejarAgotados (más abajo en este mismo archivo, función
// hermana en shopify-report.js) ya documenta que el token de esta app NO
// tiene el scope read_product_listings que algunas variantes de la REST
// API de productos piden -- la consulta de productos vía GraphQL (sin
// filtro de colección, a diferencia de manejarAgotados) solo necesita
// read_products, que sí está concedido y es justo lo que ya usa
// buscarProductoShopify más abajo.
async function obtenerEstadoShopifyPorSku() {
  const acceso = await obtenerAccesoShopify();
  if (!acceso) return null;
  const { domain, accessToken } = acceso;

  const estadoPorSku = {};
  const query = `
    query($cursor: String) {
      products(first: 100, after: $cursor) {
        edges { node { id title status variants(first: 100) { edges { node { sku price } } } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  let cursor = null;
  let guard = 0;
  while (guard < 60) { // tope de seguridad: 60 páginas (~6.000 productos)
    const r = await fetchConTimeout(`https://${domain}/admin/api/2024-10/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { cursor } }),
    }, 20000);
    if (!r.ok) throw new Error(`Shopify HTTP ${r.status} listando productos`);
    const body = await r.json();
    if (body.errors) throw new Error(`Shopify GraphQL error: ${JSON.stringify(body.errors).slice(0, 300)}`);
    const conexion = body.data?.products;
    if (!conexion) break;
    for (const { node: p } of conexion.edges) {
      const idNumerico = p.id.split('/').pop();
      for (const { node: v } of (p.variants?.edges || [])) {
        if (!v.sku) continue;
        estadoPorSku[v.sku] = {
          status: (p.status || '').toLowerCase(), productoId: idNumerico, titulo: p.title,
          adminUrl: `https://${domain}/admin/products/${idNumerico}`,
          precio: v.price != null ? Number(v.price) : null,
        };
      }
    }
    if (!conexion.pageInfo.hasNextPage) break;
    cursor = conexion.pageInfo.endCursor;
    guard++;
  }
  return estadoPorSku;
}

// Precio de cada SKU en Bsale, según la lista de precios -- necesario para
// la alerta de "precio distinto entre Bsale y Shopify" (ver conversación
// con el usuario). Bsale no guarda un precio único por variante: vive en
// una "lista de precios" aparte (puede haber varias). Acá se usa la
// marcada como predeterminada si existe, o la primera si no -- ASUNCIÓN
// sin poder verificarla en vivo contra la cuenta real, revisar
// "listaPrecioNombre" en la respuesta para confirmar que es la lista
// correcta (la que de verdad se usa para vender online/en tienda).
async function obtenerPreciosBsalePorSku() {
  const token = (process.env.BSALE_ACCESS_TOKEN || '').trim();
  if (!token) return null;
  const BSALE_BASE = 'https://api.bsale.io/v1';
  const bsaleGet = async (path) => {
    const r = await fetchConTimeout(`${BSALE_BASE}${path}`, { headers: { access_token: token } }, 15000);
    if (!r.ok) throw new Error(`Bsale HTTP ${r.status} en ${path}`);
    return r.json();
  };

  const listas = (await bsaleGet('/price_lists.json?limit=25')).items || [];
  if (!listas.length) return null;
  // "LISTA DE PRECIOS BASE" confirmada por el usuario como la lista real de
  // venta -- se busca por nombre en vez de asumir isDefault (que no tiene
  // por qué coincidir). Si por algún motivo no aparece (renombrada,
  // eliminada), cae a isDefault o a la primera, para no dejar la alerta sin
  // datos -- pero en ese caso el nombre real usado queda igual expuesto en
  // la respuesta (listaNombre) para notar la discrepancia.
  const lista = listas.find(l => (l.name || '').trim().toUpperCase() === 'LISTA DE PRECIOS BASE')
    || listas.find(l => l.isDefault)
    || listas[0];

  const precioPorSku = {};
  const limit = 50;
  let offset = 0, total = Infinity, guard = 0;
  while (offset < total && guard < 80) { // tope de seguridad: 80 páginas (~4.000 variantes)
    const body = await bsaleGet(`/price_lists/${lista.id}/details.json?expand=[variant]&limit=${limit}&offset=${offset}`);
    total = body.count ?? 0;
    for (const item of (body.items || [])) {
      const code = item.variant?.code;
      if (code && item.variantValue != null) precioPorSku[code] = Number(item.variantValue);
    }
    offset += limit;
    guard++;
  }
  return { listaId: lista.id, listaNombre: lista.name, precioPorSku };
}

async function manejarAlertasStockShopify(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const estadoPorSku = await obtenerEstadoShopifyPorSku();
    if (estadoPorSku === null) return res.status(200).json({ error: 'Faltan credenciales de Shopify (SHOPIFY_STORE_DOMAIN/CLIENT_ID/CLIENT_SECRET)', estadoPorSku: {} });

    let preciosBsale = null;
    try { preciosBsale = await obtenerPreciosBsalePorSku(); }
    catch (err) { console.warn('[alertas-stock-shopify] no se pudo traer precios de Bsale', err); }

    return res.status(200).json({
      estadoPorSku, totalSkus: Object.keys(estadoPorSku).length,
      preciosBsalePorSku: preciosBsale?.precioPorSku || {},
      listaPrecioBsaleNombre: preciosBsale?.listaNombre || null,
    });
  } catch (err) {
    return res.status(200).json({ error: 'Error consultando estado de productos en Shopify', detail: String(err), estadoPorSku: {} });
  }
}

async function buscarProductoShopify(producto, categoria, marca, modelo, especificaciones) {
  // Los cargadores no se catalogan por modelo de notebook (un mismo
  // cargador cubre muchos modelos distintos) -- lo que realmente
  // distingue el producto correcto es la potencia/voltaje/conector, que
  // va en "especificaciones" si el cliente lo mencionó.
  const modeloParaBusqueda = categoria === 'cargador' ? null : modelo;
  if (![producto, marca, modeloParaBusqueda, especificaciones].some(Boolean)) {
    console.warn('[buscarProductoShopify] muy pocos datos para buscar', { producto, categoria, marca, modelo, especificaciones });
    return null;
  }

  try {
    const acceso = await obtenerAccesoShopify();
    if (!acceso) { console.warn('[buscarProductoShopify] faltan credenciales de Shopify o no se pudo obtener token'); return null; }
    const { domain, accessToken } = acceso;

    // Palabra que el título debería tener: la de la categoría si se
    // reconoce, si no, el nombre de producto que dio la IA tal cual.
    const palabraEsperada = normalizarTexto(WHATSAPP_CATEGORIA_PALABRA_SHOPIFY[categoria] || producto || '');
    // Tipo de equipo (All in One, Macbook, etc.) -- cambia el producto por
    // completo aunque la categoría y la marca sean las mismas (una
    // "Pantalla HP" de notebook y una "Pantalla HP All in One" son
    // productos distintos en el catálogo). Si se detectó uno, el título
    // tiene que mencionarlo también, no basta con que calce la categoría.
    const tipoEquipoBuscado = WHATSAPP_TIPOS_EQUIPO.find(t => normalizarTexto(especificaciones || '').includes(t) || normalizarTexto(producto || '').includes(t)) || null;
    const conCategoriaCorrecta = (candidatos) => {
      let lista = palabraEsperada ? candidatos.filter(e => normalizarTexto(e.node.title).includes(palabraEsperada)) : candidatos;
      if (tipoEquipoBuscado) lista = lista.filter(e => normalizarTexto(e.node.title).includes(tipoEquipoBuscado));
      return lista[0] || null;
    };

    // De más específico (todo junto) a más amplio (solo marca+modelo, o
    // solo marca). Cada nivel intermedio va soltando el término que
    // menos ayuda a identificar el producto exacto.
    const niveles = [
      { palabras: palabrasBuscables([producto, marca, modeloParaBusqueda, especificaciones].filter(Boolean).join(' ')), confianza: 90 },
      { palabras: palabrasBuscables([producto, marca, modeloParaBusqueda].filter(Boolean).join(' ')), confianza: 75 },
      { palabras: palabrasBuscables([marca, modeloParaBusqueda].filter(Boolean).join(' ')), confianza: 60 },
      { palabras: palabrasBuscables([producto, marca].filter(Boolean).join(' ')), confianza: 40 },
    ];

    const vistos = new Set();
    for (const nivel of niveles) {
      const clave = nivel.palabras.join(' ');
      if (!clave || vistos.has(clave)) continue; // nivel vacío o repetido (ej. sin modelo, dos niveles quedan iguales)
      vistos.add(clave);

      const candidatos = await consultarShopify(domain, accessToken, nivel.palabras);
      if (!candidatos.length) { console.warn('[buscarProductoShopify] sin resultados', clave, `(confianza ${nivel.confianza}%)`); continue; }

      const elegido = conCategoriaCorrecta(candidatos);
      if (!elegido) {
        console.warn('[buscarProductoShopify] resultados pero ninguno calzó con la categoría esperada', clave, `esperaba "${palabraEsperada}"`, 'candidatos:', candidatos.map(c => c.node.title));
        continue;
      }
      return { titulo: elegido.node.title, url: elegido.node.onlineStoreUrl, confianza: nivel.confianza };
    }

    console.warn('[buscarProductoShopify] ningún nivel de búsqueda encontró un producto válido', { producto, categoria, marca, modelo, especificaciones });
    return null;
  } catch (err) {
    console.warn('[buscarProductoShopify] error inesperado', { producto, marca, modelo }, err);
    return null; // mejor esfuerzo -- no interrumpe el análisis IA
  }
}

// Vendedores del equipo de IndexStore que atienden WhatsApp -- WhatsApp no
// dice qué persona respondió desde la app, así que se detecta por si firma
// o se menciona en los mensajes salientes (ej. "Te habla Stefanie 😊").
// Lista fija por ahora; si el equipo cambia, hay que actualizarla acá.
const WHATSAPP_VENDEDORES = ['Stefanie', 'David', 'Nathalia', 'Fernando', 'Nicolas'];

// Series/líneas reales de notebooks por marca -- ayuda a la IA a leer bien
// una etiqueta o lo que escribe el cliente: el modelo real casi siempre
// empieza con una de estas series seguida de un número de generación (ej.
// "IdeaPad Gaming 3 15IMH05"). Sin esto, la IA a veces toma cualquier
// código alfanumérico de la etiqueta como si fuera el modelo (ej. tomó
// "41WH106" -- casi seguro la capacidad de la batería en Wh, no el
// modelo -- en vez de "IdeaPad Gaming 3 15IMH05" que sí estaba en la
// misma foto). Lista dada por el usuario; si el catálogo de marcas/series
// que atienden cambia, hay que actualizarla acá.
const WHATSAPP_SERIES_NOTEBOOK = {
  Lenovo: ['Lenovo', 'Chromebook', 'Flex', 'IdeaCentre', 'IdeaPad', 'IdeaPad Flex', 'IdeaPad Gaming', 'IdeaPad Slim', 'Legion'],
  HP: ['Chromebook', 'Compaq', 'EliteBook', 'EliteDesk', 'Envy', 'Omen', 'Pavilion'],
  Asus: ['AsusPro', 'Chromebook', 'ExpertBook', 'ProArt StudioBook', 'ROG', 'ROG Flow', 'ROG Strix', 'ROG Zephyrus', 'TUF'],
  Dell: ['Inspiron', 'Latitude', 'OptiPlex', 'Precision', 'Vostro', 'Wyse', 'XPS'],
  Acer: ['Aspire', 'Chromebook', 'Nitro', 'Predator', 'Spin', 'Swift', 'Switch Alpha', 'TravelMate'],
};

// Genérico: acentos fuera + minúsculas, para comparar nombres de personas
// o títulos de producto sin que un tilde o mayúscula haga fallar el match.
function normalizarTexto(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Descarga una imagen recibida por WhatsApp para poder mandársela a Claude
// (que sí puede leer una etiqueta de modelo en una foto -- muy típico que
// el cliente no sepa el modelo exacto de su notebook y mande una foto de
// la etiqueta del fondo del equipo en su lugar). media_url en la base de
// datos guarda solo la referencia "whatsapp-media-id:{id}" (ver
// extraerContenidoMensajeWhatsapp) porque Meta no manda una URL de
// descarga directa en el webhook -- hay que resolverla en dos pasos:
// 1) pedir la URL temporal real con el media id, 2) descargar esa URL,
// ambos pasos autenticados con el mismo token de acceso permanente.
// Requiere WHATSAPP_ACCESS_TOKEN; sin él, o ante cualquier error, mejor
// esfuerzo -- se sigue analizando el resto de la conversación sin la foto.
async function obtenerImagenWhatsapp(mediaRef) {
  const accessToken = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  if (!accessToken) { console.warn('[obtenerImagenWhatsapp] WHATSAPP_ACCESS_TOKEN no configurado'); return null; }
  if (!mediaRef || !mediaRef.startsWith('whatsapp-media-id:')) { console.warn('[obtenerImagenWhatsapp] media_url sin el formato esperado:', mediaRef); return null; }
  const mediaId = mediaRef.slice('whatsapp-media-id:'.length);
  try {
    const rInfo = await fetchConTimeout(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, 10000);
    if (!rInfo.ok) {
      console.warn('[obtenerImagenWhatsapp] error pidiendo info del media', mediaId, rInfo.status, await rInfo.text().catch(() => ''));
      return null;
    }
    const info = await rInfo.json().catch(() => ({}));
    if (!info.url) { console.warn('[obtenerImagenWhatsapp] respuesta sin url', mediaId, JSON.stringify(info).slice(0, 300)); return null; }

    const rDescarga = await fetchConTimeout(info.url, { headers: { Authorization: `Bearer ${accessToken}` } }, 15000);
    if (!rDescarga.ok) { console.warn('[obtenerImagenWhatsapp] error descargando el archivo', mediaId, rDescarga.status); return null; }
    const buffer = Buffer.from(await rDescarga.arrayBuffer());
    if (buffer.length > 5 * 1024 * 1024) { console.warn('[obtenerImagenWhatsapp] imagen muy grande, se omite', mediaId, buffer.length); return null; }

    const TIPOS_SOPORTADOS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const mediaType = TIPOS_SOPORTADOS.includes(info.mime_type) ? info.mime_type : 'image/jpeg';
    return { mediaType, base64: buffer.toString('base64') };
  } catch (err) {
    console.warn('[obtenerImagenWhatsapp] error inesperado', mediaId, err);
    return null;
  }
}

// Puente entre el navegador y la imagen real de WhatsApp -- el navegador
// no puede pedirle la foto directo a la API de Meta (necesita el
// WHATSAPP_ACCESS_TOKEN, que nunca sale del servidor), así que esto la
// descarga acá y se la sirve tal cual. Requiere sesión (como todo lo
// demás de este archivo, ver el chequeo al principio del handler).
async function manejarWhatsappMedia(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'Falta ref' });
  const imagen = await obtenerImagenWhatsapp(ref);
  if (!imagen) return res.status(404).json({ error: 'No se pudo obtener la imagen' });
  res.setHeader('Content-Type', imagen.mediaType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.status(200).send(Buffer.from(imagen.base64, 'base64'));
}

const WHATSAPP_ANALISIS_TOOL = {
  name: 'registrar_analisis',
  description: 'Registra el análisis estructurado de una conversación de WhatsApp de atención al cliente de IndexStore (venta y servicio técnico de notebooks).',
  input_schema: {
    type: 'object',
    properties: {
      resumen: { type: 'string', description: 'Resumen de 1-2 frases de qué necesitaba el cliente y en qué quedó la conversación.' },
      vendedor: { type: 'string', enum: [...WHATSAPP_VENDEDORES, ''], description: `Nombre del vendedor/a de IndexStore que firma o es mencionado en los mensajes salientes (del negocio) de la conversación, ej. "Te habla Stefanie", "Saludos, David". Solo puede ser uno de: ${WHATSAPP_VENDEDORES.join(', ')}. Cadena vacía si ningún mensaje del negocio menciona su nombre.` },
      intencion: { type: 'string', enum: WHATSAPP_INTENCIONES, description: 'Intención principal del cliente.' },
      categoria: { type: 'string', enum: WHATSAPP_CATEGORIAS, description: 'Categoría del producto o servicio consultado. DEBE ser coherente con el campo "producto" y con "intencion": si el producto es una pantalla usa "pantalla", si es un cargador usa "cargador", si es una batería usa "bateria", si es una reparación/revisión técnica usa "servicio_tecnico", si es otra pieza suelta (teclado, bisagra, etc.) usa "repuestos", si es un reclamo de garantía usa "garantia", si es seguimiento de un pedido ya hecho usa "estado_pedido", si es atención post-compra (devolución, duda después de comprar) usa "postventa", si pregunta si algo es compatible con su equipo usa "compatibilidad", si pide cotización general sin precisar aún la pieza usa "cotizacion". Usa "otra" SOLO cuando de verdad ninguna aplica: saludo sin ningún detalle todavía, pregunta de ubicación/horario, mensaje de prueba, spam o queja sin relación a un producto/servicio. No uses "otra" solo porque la conversación es corta o el negocio no ha respondido -- si ya se puede inferir qué busca el cliente (por su mensaje, por una plantilla de menú que respondió, o por una foto), usa esa categoría específica.' },
      producto: { type: 'string', description: 'Nombre corto del producto específico (ej. "Pantalla", "Cargador", "Teclado"). Cadena vacía si no se menciona ninguno.' },
      marca: { type: 'string', description: 'Marca del equipo mencionada (ej. HP, Lenovo, Dell, Asus, Acer). Cadena vacía si no se menciona.' },
      modelo: { type: 'string', description: 'Modelo específico del equipo mencionado. Cadena vacía si no se menciona.' },
      problema_cliente: { type: 'string', description: 'Problema o necesidad concreta del cliente, en sus palabras.' },
      especificaciones: { type: 'string', description: 'Detalles técnicos específicos que el cliente o el negocio mencionan y que distinguen el producto exacto de otros similares. Dos casos particularmente importantes: (1) en cargadores, potencia/voltaje/amperaje/tipo de conector (ej. "65W USB-C", "20V 3.25A"); (2) en pantallas, el TIPO DE EQUIPO -- "All in One" (PC de escritorio todo-en-uno) es un producto completamente distinto a una pantalla de notebook, aunque sea la misma marca, así que si el cliente dice "All in One", "todo en uno", "PC de escritorio" o similar, regístralo tal cual acá (ej. "All in One"). También aplica a otros casos: "táctil", "Full HD", "Macbook" vs notebook normal, etc. Cadena vacía si no se menciona ningún detalle así.' },
      probabilidad_compra: { type: 'integer', description: 'Probabilidad de 0 a 100 de que esta conversación termine en una venta, según el interés mostrado.' },
      resultado: { type: 'string', enum: WHATSAPP_RESULTADOS, description: 'En qué terminó (o va quedando) la conversación.' },
      motivo_perdida: { type: 'string', enum: Object.keys(WHATSAPP_MOTIVOS_PERDIDA_LABEL), description: 'Si el resultado indica que se perdió la venta, por qué. Omitir el campo si no aplica. Usa la razón más específica posible según lo que digan los mensajes o lo que tú mismo hayas notado en la conversación: si el cliente dice que ya compró o va a comprar en otro lado / la competencia, usa "compro_en_otro_lugar"; si el negocio nunca respondió o respondió muy tarde, usa "respuesta_lenta"; si el negocio respondió pero nunca volvió a contactar al cliente para cerrar, usa "sin_seguimiento"; si el cliente dejó de responder sin motivo claro, "cliente_no_responde"; si fue por precio, "precio"; si fue por falta de stock, "sin_stock"; si el producto no era compatible con su equipo, "producto_incompatible". Usa "otro" SOLO si de verdad ninguna de esas aplica (ej. conversación demasiado confusa o corta para saber qué pasó).' },
      sentimiento: { type: 'string', enum: ['positivo', 'neutro', 'negativo'], description: 'Tono general del cliente en la conversación.' },
      calidad_atencion_score: { type: 'integer', description: 'De 0 a 100, qué tan buena fue la atención del negocio (rapidez, claridad, resolución). Si el negocio todavía no ha respondido nada, usar 0.' },
      requiere_seguimiento: { type: 'boolean', description: 'Si esta conversación debería seguirse contactando (ej. cotización enviada sin respuesta, cliente evaluando).' },
      observaciones: { type: 'string', description: 'Cualquier detalle adicional relevante para el equipo comercial. Cadena vacía si no hay nada que agregar.' },
    },
    required: ['resumen', 'sentimiento', 'probabilidad_compra', 'calidad_atencion_score', 'requiere_seguimiento'],
  },
};

// Lógica central del Análisis IA, sin nada de HTTP -- la usa tanto el
// botón manual (manejarWhatsappAnalizar, con usuario real para la
// auditoría) como el disparo automático desde el webhook (con "quien" =
// 'sistema (automático)'). Devuelve {ok:true} o {ok:false, motivo} en vez
// de tirar error para los casos esperables (sin API key, sin mensajes,
// conversación inexistente) -- errores de verdad (Anthropic caído, etc.)
// sí se propagan, que el llamador decida cómo mostrarlos.
async function ejecutarAnalisisIA(sql, conversacionId, quien) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, motivo: 'sin_api_key' };

  const { rows: mensajes } = await sql`
    SELECT direccion, tipo, contenido_texto, media_url, marca_tiempo FROM whatsapp_mensajes
    WHERE conversacion_id = ${conversacionId} ORDER BY marca_tiempo ASC;
  `;
  if (mensajes.length === 0) return { ok: false, motivo: 'sin_mensajes' };

  // Backfill del origen (ver extraerUtmDeTexto): si esta conversación es
  // vieja y nunca pasó por el chequeo en vivo del webhook (o el link con
  // UTM llegó en un mensaje que no era el primero), reanalizar la deja al
  // día igual, sin depender de un mensaje nuevo. No cuesta nada extra (no
  // llama a la IA), así que se hace siempre, independiente de si el
  // análisis con Claude más abajo llega a correr o falla.
  for (const m of mensajes) {
    const utm = extraerUtmDeTexto(m.contenido_texto);
    if (!utm) continue;
    await sql`
      UPDATE whatsapp_conversaciones SET
        fuente_tipo = COALESCE(fuente_tipo, 'utm'),
        fuente_titulo = COALESCE(fuente_titulo, ${utm.etiqueta}),
        fuente_url = COALESCE(fuente_url, ${utm.urlLimpia}),
        fuente_id = COALESCE(fuente_id, ${utm.id})
      WHERE id = ${conversacionId};
    `;
    break; // ya se encontró uno, no hace falta seguir mirando el resto
  }

  const { rows: convRows } = await sql`
    SELECT c.id, c.contacto_id, c.responsable_id, c.iniciada_en, c.venta_detectada, ct.telefono AS contacto_telefono
    FROM whatsapp_conversaciones c JOIN whatsapp_contactos ct ON ct.id = c.contacto_id
    WHERE c.id = ${conversacionId};
  `;
  if (!convRows[0]) return { ok: false, motivo: 'no_encontrada' };

  // Un seguimiento ("Gracias por la info", "Lo voy a pensar") a veces cae
  // en una conversación NUEVA (se cortó por las 24h sin actividad, ver
  // obtenerOCrearConversacionWhatsapp) sin mencionar de nuevo el producto
  // -- si no se le da contexto, la IA no tiene cómo saber de qué se está
  // haciendo seguimiento. Se le pasa como referencia (no se copia
  // directo) la conversación anterior más reciente de este mismo
  // contacto que tenga algún dato de producto.
  //
  // Se filtra por los campos de whatsapp_conversaciones (c2.producto/
  // marca/categoria), NO por whatsapp_analisis_ia -- esos campos son los
  // "de trabajo" reales (los rellena el auto-fill de un análisis previo,
  // pero también los puede haber editado una persona a mano) y existen
  // aunque esa conversación anterior nunca se haya llegado a analizar con
  // IA. Antes esto exigía (JOIN normal) que la conversación anterior
  // tuviera análisis, así que una anterior sin analizar quedaba invisible
  // aunque tuviera datos útiles -- LEFT JOIN solo para traer el resumen
  // si existe, opcional.
  const { rows: anteriorRows } = await sql`
    SELECT c2.iniciada_en, a2.resumen, c2.categoria, c2.producto, c2.marca, c2.modelo
    FROM whatsapp_conversaciones c2
    LEFT JOIN whatsapp_analisis_ia a2 ON a2.conversacion_id = c2.id
    WHERE c2.contacto_id = ${convRows[0].contacto_id} AND c2.id != ${conversacionId} AND c2.iniciada_en < ${convRows[0].iniciada_en}
      AND (c2.producto IS NOT NULL OR c2.marca IS NOT NULL OR c2.categoria IS NOT NULL)
    ORDER BY c2.iniciada_en DESC LIMIT 1;
  `;
  const conversacionAnterior = anteriorRows[0] || null;

  // Las fotos SÍ se le mandan a Claude (que puede leerlas) -- es muy común
  // que el cliente no sepa el modelo exacto de su notebook y en vez de
  // escribirlo mande una foto de la etiqueta pegada en la carcasa. Tope de
  // 2 imágenes por conversación (bajado de 4 tras revisión de costo de API
  // de visión, ver conversación con el usuario) y se descargan todas en
  // paralelo antes de armar el mensaje para no encadenar la espera. Si el
  // cliente manda más de 2 fotos, se usan las 2 primeras (normalmente la
  // más relevante -- la etiqueta del equipo -- llega temprano).
  const TOPE_IMAGENES = 2;
  const indicesConImagen = mensajes
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.tipo === 'imagen' && m.media_url)
    .slice(0, TOPE_IMAGENES)
    .map(({ i }) => i);
  const imagenesDescargadas = new Map(); // índice en "mensajes" -> {mediaType, base64} | null
  await Promise.all(indicesConImagen.map(async (i) => {
    imagenesDescargadas.set(i, await obtenerImagenWhatsapp(mensajes[i].media_url));
  }));

  const contenido = [];
  if (conversacionAnterior) {
    const detalles = [
      conversacionAnterior.categoria ? `categoría: ${conversacionAnterior.categoria}` : null,
      conversacionAnterior.producto ? `producto: ${conversacionAnterior.producto}` : null,
      conversacionAnterior.marca ? `marca: ${conversacionAnterior.marca}` : null,
      conversacionAnterior.modelo ? `modelo: ${conversacionAnterior.modelo}` : null,
    ].filter(Boolean).join(', ');
    contenido.push({
      type: 'text',
      text: `Contexto (NO es la conversación a analizar, solo referencia): este mismo cliente tuvo una conversación anterior el ${new Date(conversacionAnterior.iniciada_en).toLocaleDateString('es-CL')} donde se detectó ${detalles || 'sin detalles adicionales'}. Resumen de esa conversación anterior: "${conversacionAnterior.resumen || 'sin resumen'}". Si la conversación de abajo es claramente un seguimiento de eso (el cliente no menciona un producto nuevo, ej. "gracias por la info", "lo voy a pensar", "sí, las dos"), puedes usar esos datos para completar categoría/producto/marca/modelo de la conversación actual también. Si la conversación de abajo es sobre algo distinto, ignora este contexto.`,
    });
  }
  contenido.push({ type: 'text', text: 'Conversación de WhatsApp a analizar (en orden cronológico):' });
  mensajes.forEach((m, i) => {
    const remitente = m.direccion === 'in' ? 'Cliente' : 'IndexStore';
    const hora = new Date(m.marca_tiempo).toLocaleString('es-CL');
    const imagen = imagenesDescargadas.get(i);
    if (m.tipo === 'imagen' && imagen) {
      contenido.push({ type: 'text', text: `[${hora}] ${remitente} envió esta imagen:` });
      contenido.push({ type: 'image', source: { type: 'base64', media_type: imagen.mediaType, data: imagen.base64 } });
    } else {
      const texto = m.tipo === 'texto' ? (m.contenido_texto || '') : `[${m.tipo}, no disponible para ver]`;
      contenido.push({ type: 'text', text: `[${hora}] ${remitente}: ${texto}` });
    }
  });

  const respuestaIA = await fetchConTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `Eres un analista comercial de IndexStore, una tienda chilena de repuestos y servicio técnico de notebooks. El equipo de vendedores que atiende WhatsApp es: ${WHATSAPP_VENDEDORES.join(', ')} -- si alguno de ellos firma o es mencionado por nombre en un mensaje saliente (del negocio), regístralo en el campo "vendedor". Prioridad para los campos marca/modelo: (1) si el cliente ESCRIBE el modelo en el texto de algún mensaje de la conversación, usa eso -- es la fuente más confiable, por encima de cualquier foto. (2) Si el cliente no escribe el modelo pero manda una foto de la etiqueta/sticker pegada en la carcasa o la base del equipo, léela para identificarlo. (3) Si manda las dos cosas (un modelo escrito Y una foto), el modelo que el cliente escribió manda -- usa la foto solo para completar marca/modelo si el texto no los menciona, no para contradecir lo que el cliente ya escribió. Estas etiquetas suelen traer VARIOS códigos distintos -- usa el que sea el modelo comercial del producto (el que identifica al equipo específico que compraría alguien, ej. "24-dd0092la" en un HP All-in-One, o "15-ef2xxx" en un notebook), y NO el "Regulatory model number"/"Model reglamentario" (un código interno de certificación FCC/IC que no corresponde al modelo real, ej. "TPC-0089-24"), ni el número de serie ("Serial No."/"S/N"), ni el PPID. Series/líneas reales de notebooks por marca (el modelo real casi siempre empieza con una de estas seguida de un número de generación, ej. "IdeaPad Gaming 3 15IMH05"): ${Object.entries(WHATSAPP_SERIES_NOTEBOOK).map(([marca, series]) => `${marca}: ${series.join(', ')}`).join(' | ')}. Esta lista es SOLO para que reconozcas si un texto que sí leíste en la imagen es una serie real -- NUNCA la uses para adivinar o suponer una serie "típica" o "probable" según el contexto (ej. NO asumas "Legion" solo porque el cliente pidió un notebook gamer; eso sería inventar, aunque sea una suposición razonable). El modelo/marca solo se registran si están literalmente escritos y legibles en la foto o en el texto del cliente -- transcribe exactamente lo que dice la etiqueta, letra por letra, no lo que te parezca más probable. Si el único código visible en la etiqueta NO corresponde a ninguna serie conocida (puede ser la capacidad de la batería en Wh, un part number, un código regulatorio, etc.) Y no hay otro texto de serie legible en la misma foto, deja el campo modelo vacío en vez de adivinar. A veces el mensaje del usuario incluye primero un bloque de "Contexto" con datos de una conversación anterior del mismo cliente (las conversaciones se cortan automáticamente tras 24h sin actividad, así que un seguimiento corto como "gracias por la info" puede quedar en una conversación separada sin mencionar el producto de nuevo) -- úsalo solo si la conversación actual es claramente ese seguimiento, nunca si trata de algo distinto. Analiza la conversación completa (incluidas las imágenes) y registra el análisis usando la herramienta registrar_analisis. Responde solo con la llamada a la herramienta, sin texto adicional. Si un campo de texto no aplica o no hay información suficiente, usa una cadena vacía en vez de inventar datos.`,
      messages: [{ role: 'user', content: contenido }],
      tools: [WHATSAPP_ANALISIS_TOOL],
      tool_choice: { type: 'tool', name: 'registrar_analisis' },
    }),
  }, 30000);

  if (!respuestaIA.ok) {
    const texto = await respuestaIA.text().catch(() => '');
    throw new Error(`Anthropic HTTP ${respuestaIA.status}: ${texto.slice(0, 300)}`);
  }
  const dataIA = await respuestaIA.json();
  const bloqueHerramienta = (dataIA.content || []).find(b => b.type === 'tool_use');
  if (!bloqueHerramienta) throw new Error('La IA no devolvió un análisis estructurado');
  const a = bloqueHerramienta.input || {};

  const limpiar = (v) => (v && String(v).trim()) ? String(v).trim() : null;
  const intencion = WHATSAPP_INTENCIONES.includes(a.intencion) ? a.intencion : null;
  const categoria = WHATSAPP_CATEGORIAS.includes(a.categoria) ? a.categoria : null;
  const resultado = WHATSAPP_RESULTADOS.includes(a.resultado) ? a.resultado : null;
  const motivoPerdida = Object.keys(WHATSAPP_MOTIVOS_PERDIDA_LABEL).includes(a.motivo_perdida) ? a.motivo_perdida : null;
  const producto = limpiar(a.producto);
  const marca = limpiar(a.marca);
  const modelo = limpiar(a.modelo);
  const especificaciones = limpiar(a.especificaciones);
  const probabilidad = Math.max(0, Math.min(100, Math.round(Number(a.probabilidad_compra) || 0)));
  const scoreAtencion = Math.max(0, Math.min(100, Math.round(Number(a.calidad_atencion_score) || 0)));
  const vendedorDetectado = WHATSAPP_VENDEDORES.includes(a.vendedor) ? a.vendedor : null;
  const productoShopify = await buscarProductoShopify(producto, categoria, marca, modelo, especificaciones);
  // Si ya hay una venta confirmada a mano ("Asociar venta"), no hace falta
  // gastar una consulta a Bsale/Shopify buscando una sugerencia -- ya está
  // resuelto. Variable se sigue llamando "ventaBsale" en el resto de esta
  // función por simplicidad, aunque ahora puede venir de Shopify también
  // (ver buscarVentaPorTelefono).
  const ventaBsale = convRows[0].venta_detectada
    ? null
    : await buscarVentaPorTelefono(sql, convRows[0].contacto_telefono, convRows[0].iniciada_en);

  // Si el vendedor detectado ya tiene cuenta creada en el ERP (match por
  // nombre, sin distinguir acentos/mayúsculas), y la conversación no
  // tiene responsable asignado todavía, se asigna solo -- mientras no
  // exista la cuenta, igual queda guardado en vendedor_detectado para no
  // perder la información hasta que se cree.
  let responsableIdAsignado = null;
  let responsableNombreAsignado = null;
  if (vendedorDetectado && !convRows[0].responsable_id) {
    const { rows: usuariosActivos } = await sql`SELECT id, nombre FROM usuarios WHERE activo = true;`;
    const buscado = normalizarTexto(vendedorDetectado);
    const match = usuariosActivos.find(u => normalizarTexto(u.nombre).includes(buscado));
    if (match) { responsableIdAsignado = match.id; responsableNombreAsignado = match.nombre; }
  }

  await sql`
    INSERT INTO whatsapp_analisis_ia (
      conversacion_id, resumen, intencion, categoria, producto, marca, modelo, problema_cliente, especificaciones,
      probabilidad_compra, resultado, motivo_perdida, sentimiento, calidad_atencion_score,
      requiere_seguimiento, observaciones, updated_at
    ) VALUES (
      ${conversacionId}, ${limpiar(a.resumen)}, ${intencion}, ${categoria}, ${producto}, ${marca}, ${modelo},
      ${limpiar(a.problema_cliente)}, ${especificaciones}, ${probabilidad}, ${resultado}, ${motivoPerdida}, ${limpiar(a.sentimiento)}, ${scoreAtencion},
      ${!!a.requiere_seguimiento}, ${limpiar(a.observaciones)}, now()
    )
    ON CONFLICT (conversacion_id) DO UPDATE SET
      resumen = EXCLUDED.resumen, intencion = EXCLUDED.intencion, categoria = EXCLUDED.categoria,
      producto = EXCLUDED.producto, marca = EXCLUDED.marca, modelo = EXCLUDED.modelo,
      problema_cliente = EXCLUDED.problema_cliente, especificaciones = EXCLUDED.especificaciones, probabilidad_compra = EXCLUDED.probabilidad_compra,
      resultado = EXCLUDED.resultado, motivo_perdida = EXCLUDED.motivo_perdida, sentimiento = EXCLUDED.sentimiento,
      calidad_atencion_score = EXCLUDED.calidad_atencion_score, requiere_seguimiento = EXCLUDED.requiere_seguimiento,
      observaciones = EXCLUDED.observaciones, updated_at = now();
  `;

  // Los campos "de trabajo" ahora SÍ se pueden corregir en cada
  // reanálisis (antes con COALESCE(campo, nuevo) un valor mal leído por
  // la IA quedaba pegado para siempre, porque nunca volvía a estar NULL)
  // -- pero nunca si una persona ya lo editó a mano (ver
  // campos_editados_manualmente, seteado en el PUT de
  // manejarWhatsappConversaciones). Y si la IA esta vez no detectó nada
  // nuevo para un campo (${producto} etc. viene NULL), se conserva el
  // valor anterior en vez de borrarlo. Importante porque el análisis
  // también se dispara automático en cada mensaje nuevo (debounced) -- sin
  // el bloqueo por campos_editados_manualmente, ese disparo automático
  // podría pisar una corrección manual reciente.
  //
  // requiere_seguimiento queda fuera a propósito: al ser NOT NULL
  // DEFAULT false en la tabla, no hay forma de distinguir "nunca
  // tocado" de "una persona lo dejó en false a propósito" -> la persona
  // sigue decidiendo eso a mano, informada por lo que sugiere la IA acá.
  // El link de Shopify es la excepción: SÍ se pisa siempre (no COALESCE)
  // porque no lo edita ningún humano -- cada reanálisis debe poder
  // corregir un match anterior que haya quedado mal, no dejarlo pegado.
  await sql`
    UPDATE whatsapp_conversaciones SET
      intencion = CASE WHEN 'intencion' = ANY(campos_editados_manualmente) THEN intencion WHEN ${intencion}::text IS NOT NULL THEN ${intencion} ELSE intencion END,
      categoria = CASE WHEN 'categoria' = ANY(campos_editados_manualmente) THEN categoria WHEN ${categoria}::text IS NOT NULL THEN ${categoria} ELSE categoria END,
      producto = CASE WHEN 'producto' = ANY(campos_editados_manualmente) THEN producto WHEN ${producto}::text IS NOT NULL THEN ${producto} ELSE producto END,
      marca = CASE WHEN 'marca' = ANY(campos_editados_manualmente) THEN marca WHEN ${marca}::text IS NOT NULL THEN ${marca} ELSE marca END,
      modelo = CASE WHEN 'modelo' = ANY(campos_editados_manualmente) THEN modelo WHEN ${modelo}::text IS NOT NULL THEN ${modelo} ELSE modelo END,
      resultado = CASE WHEN 'resultado' = ANY(campos_editados_manualmente) THEN resultado WHEN ${resultado}::text IS NOT NULL THEN ${resultado} ELSE resultado END,
      motivo_perdida = CASE WHEN 'motivo_perdida' = ANY(campos_editados_manualmente) THEN motivo_perdida WHEN ${motivoPerdida}::text IS NOT NULL THEN ${motivoPerdida} ELSE motivo_perdida END,
      vendedor_detectado = COALESCE(${vendedorDetectado}, vendedor_detectado),
      responsable_id = COALESCE(responsable_id, ${responsableIdAsignado}),
      shopify_producto_url = ${productoShopify?.url || null},
      shopify_producto_titulo = ${productoShopify?.titulo || null},
      shopify_producto_confianza = ${productoShopify?.confianza ?? null},
      bsale_documento_numero = ${ventaBsale?.numero || null},
      bsale_documento_tipo = ${ventaBsale?.tipo || null},
      bsale_documento_monto = ${ventaBsale?.monto ?? null},
      bsale_documento_fecha = ${ventaBsale?.fecha || null},
      bsale_documento_url = ${ventaBsale?.url || null},
      updated_at = now()
    WHERE id = ${conversacionId};
  `;

  const detalleAuditoria = responsableIdAsignado
    ? `Se generó el análisis con IA (vendedor detectado: ${vendedorDetectado} → asignado como responsable: ${responsableNombreAsignado})`
    : vendedorDetectado
      ? `Se generó el análisis con IA (vendedor detectado: ${vendedorDetectado}, sin cuenta de usuario todavía)`
      : 'Se generó el análisis con IA';
  await sql`INSERT INTO whatsapp_auditoria (conversacion_id, usuario_email, accion, detalle) VALUES (${conversacionId}, ${quien}, 'analisis_ia', ${detalleAuditoria});`;

  return { ok: true };
}

// Botón manual "Analizar con IA" en el detalle de conversación.
async function manejarWhatsappAnalizar(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { conversacionId } = req.body || {};
  if (!conversacionId) return res.status(400).json({ error: 'Falta conversacionId' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);
    const resultado = await ejecutarAnalisisIA(sql, conversacionId, sesion.nombre || sesion.email);
    if (!resultado.ok) {
      const mensajesError = {
        sin_api_key: 'ANTHROPIC_API_KEY no está configurada en el servidor',
        sin_mensajes: 'Esta conversación no tiene mensajes para analizar',
        no_encontrada: 'Conversación no encontrada',
      };
      const status = resultado.motivo === 'no_encontrada' ? 404 : resultado.motivo === 'sin_mensajes' ? 400 : 200;
      return res.status(status).json({ error: mensajesError[resultado.motivo] || 'No se pudo analizar la conversación' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Error al analizar la conversación con IA', detail: String(err) });
  }
}

// Analiza en lote las conversaciones que quedaron sin Análisis IA -- el
// disparo automático del webhook (ver manejarWhatsappWebhook) solo corre
// para mensajes NUEVOS que llegan después de que esa función quedó
// desplegada; conversaciones que ya existían antes se quedan sin analizar
// para siempre a menos que alguien las abra y le dé "Analizar con IA" una
// por una, o corra esto. Admin-only (golpea la API de Claude repetidas
// veces). Resumible como el resto de sincronizaciones del proyecto: tope
// de 15 por llamada para no arriesgar el límite de duración de la
// función, el frontend la vuelve a llamar hasta que completo=true.
// ?horas=N (opcional): acota a conversaciones iniciadas en las últimas N
// horas -- para el botón rápido "Analizar recientes" (ver conversación con
// el usuario), que solo quiere ponerse al día con lo de hoy sin disparar
// una corrida sobre todo el backlog histórico de conversaciones sin
// analizar (eso sigue siendo lo que hace este mismo endpoint sin ?horas=,
// usado por "Analizar pendientes").
async function manejarWhatsappAnalizarPendientes(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede analizar en lote' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);

    const horas = Math.max(0, parseInt(req.query.horas, 10) || 0);
    const condHoras = horas > 0 ? `AND c.iniciada_en >= now() - (INTERVAL '1 hour' * ${horas})` : '';

    // Lote de 5 (no 15): cada análisis puede leer hasta 2 fotos con Claude,
    // y 15 seguidas alguna vez superó el maxDuration de 60s de la función
    // (FUNCTION_INVOCATION_TIMEOUT, devuelve HTML en vez de JSON -- ver
    // mismo ajuste ya hecho en whatsapp-recategorizar).
    const { rows: pendientes } = await sql.query(
      `SELECT c.id FROM whatsapp_conversaciones c
       LEFT JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id
       WHERE a.conversacion_id IS NULL AND c.cantidad_mensajes > 0 ${condHoras}
       ORDER BY c.iniciada_en ASC LIMIT 5;`
    );

    let analizadas = 0, errores = 0;
    for (const fila of pendientes) {
      try {
        const resultado = await ejecutarAnalisisIA(sql, fila.id, 'Sistema (análisis en lote)');
        if (resultado.ok) analizadas++; else errores++;
      } catch (err) {
        errores++;
        console.error('[whatsapp-analizar-pendientes] error analizando conversación', fila.id, err);
      }
    }

    const { rows: restantesRows } = await sql.query(
      `SELECT COUNT(*)::int AS n FROM whatsapp_conversaciones c
       LEFT JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id
       WHERE a.conversacion_id IS NULL AND c.cantidad_mensajes > 0 ${condHoras};`
    );
    const restantes = restantesRows[0]?.n || 0;

    return res.status(200).json({ analizadas, errores, restantes, completo: restantes === 0 });
  } catch (err) {
    return res.status(500).json({ error: 'Error analizando conversaciones pendientes', detail: String(err) });
  }
}

// Reanaliza conversaciones cuyo análisis quedó DESACTUALIZADO -- llegaron
// mensajes nuevos después de la última vez que se analizaron. Pasa sobre
// todo por la limitación real del disparo automático (ver el comentario
// junto a DEBOUNCE_ANALISIS_IA_MS en manejarWhatsappWebhook): si el
// cliente manda varios mensajes en una ráfaga, el primer webhook puede
// analizar con muy poca información todavía (ej. solo el saludo, sin el
// producto que pide después), y ese resultado incompleto se queda pegado
// hasta que algo lo actualice. Este botón es ese "algo" para ponerse al
// día en lote sin tener que abrir conversación por conversación.
//
// La condición (¿hay algún mensaje MÁS NUEVO que la última vez que se
// analizó?) usa la marca de tiempo real de los mensajes, no
// c.updated_at -- ese campo lo toca tanto un mensaje nuevo como el
// propio análisis (que actualiza c.updated_at al terminar), así que
// comparar contra él daría falsos positivos justo después de analizar.
async function manejarWhatsappReanalizarDesactualizadas(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede reanalizar en lote' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);

    // Lote de 5 (no 15) -- mismo ajuste que whatsapp-analizar-pendientes,
    // ver comentario ahí sobre el timeout de 60s con lotes más grandes.
    const { rows: desactualizadas } = await sql`
      SELECT c.id FROM whatsapp_conversaciones c
      JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id
      WHERE EXISTS (
        SELECT 1 FROM whatsapp_mensajes m WHERE m.conversacion_id = c.id AND m.marca_tiempo > a.updated_at
      )
      ORDER BY c.iniciada_en ASC LIMIT 5;
    `;

    let reanalizadas = 0, errores = 0;
    for (const fila of desactualizadas) {
      try {
        const resultado = await ejecutarAnalisisIA(sql, fila.id, 'Sistema (reanálisis en lote)');
        if (resultado.ok) reanalizadas++; else errores++;
      } catch (err) {
        errores++;
        console.error('[whatsapp-reanalizar-desactualizadas] error reanalizando conversación', fila.id, err);
      }
    }

    const { rows: restantesRows } = await sql`
      SELECT COUNT(*)::int AS n FROM whatsapp_conversaciones c
      JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id
      WHERE EXISTS (
        SELECT 1 FROM whatsapp_mensajes m WHERE m.conversacion_id = c.id AND m.marca_tiempo > a.updated_at
      );
    `;
    const restantes = restantesRows[0]?.n || 0;

    return res.status(200).json({ reanalizadas, errores, restantes, completo: restantes === 0 });
  } catch (err) {
    return res.status(500).json({ error: 'Error reanalizando conversaciones desactualizadas', detail: String(err) });
  }
}

// Vuelve a correr el Análisis IA completo (Claude, con costo real de API)
// sobre TODAS las conversaciones que ya tienen un análisis previo, para
// que apliquen mejoras hechas al prompt/tool después de ese análisis --
// el caso concreto que motivó esto: categoria='otra' quedaba pegada en
// muchas conversaciones donde el producto ya era claro (ver instrucción
// agregada al campo "categoria" en WHATSAPP_ANALISIS_TOOL), y solo un
// mensaje nuevo dispara un reanálisis automático (ver
// manejarWhatsappReanalizarDesactualizadas), no un cambio de prompt.
// Paginado por offset explícito, igual que manejarWhatsappActualizarShopify,
// a propósito: tiene que poder re-tocar TODAS las filas, incluidas las que
// ya están bien categorizadas (si se filtrara por categoria='otra' las
// conversaciones correctamente categorizadas como 'otra' nunca saldrían
// del WHERE y el lote no terminaría de avanzar nunca). Admin-only. Lote
// de solo 5 (no 15 como whatsapp-analizar-pendientes): a diferencia de
// "pendientes" (que en su mayoría son conversaciones cortas recién
// llegadas), este recorre TODO el historial incluyendo conversaciones
// largas con varias fotos -- 15 de esas seguidas superó el
// maxDuration de 60s de la función (Vercel corta con
// FUNCTION_INVOCATION_TIMEOUT, que ni siquiera devuelve JSON) y el
// frontend seguía sin problema con la próxima llamada por el offset.
async function manejarWhatsappRecategorizar(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede recategorizar en lote' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);
    const offset = Math.max(0, Number(req.body?.offset) || 0);

    const { rows: candidatas } = await sql`
      SELECT c.id FROM whatsapp_conversaciones c
      JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id
      ORDER BY c.iniciada_en ASC LIMIT 5 OFFSET ${offset};
    `;

    let reanalizadas = 0, errores = 0;
    for (const fila of candidatas) {
      try {
        const resultado = await ejecutarAnalisisIA(sql, fila.id, 'Sistema (recategorización en lote)');
        if (resultado.ok) reanalizadas++; else errores++;
      } catch (err) {
        errores++;
        console.error('[whatsapp-recategorizar] error en conversación', fila.id, err);
      }
    }

    const { rows: totalRows } = await sql`
      SELECT COUNT(*)::int AS n FROM whatsapp_conversaciones c JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id;
    `;
    const total = totalRows[0]?.n || 0;
    const nuevoOffset = offset + candidatas.length;

    return res.status(200).json({ reanalizadas, errores, offset: nuevoOffset, total, completo: nuevoOffset >= total });
  } catch (err) {
    return res.status(500).json({ error: 'Error recategorizando conversaciones', detail: String(err) });
  }
}

// Actualiza SOLO el link de Shopify de conversaciones que ya tienen
// Análisis IA -- sin volver a llamar a Claude. Sirve para corregir en
// lote matches viejos (guardados con una versión anterior de
// buscarProductoShopify) sin gastar de nuevo en la API de Anthropic; solo
// consume la API de Shopify. Admin-only. Paginado por offset explícito
// (no por "WHERE shopify IS NULL") a propósito: se quiere poder
// refrescar TODAS las conversaciones, incluidas las que ya tienen un
// link (posiblemente incorrecto), no solo las que no tienen ninguno.
async function manejarWhatsappActualizarShopify(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede actualizar los links de Shopify en lote' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);
    const offset = Math.max(0, Number(req.body?.offset) || 0);

    const { rows: candidatas } = await sql`
      SELECT c.id, a.producto, a.categoria, a.marca, a.modelo, a.especificaciones
      FROM whatsapp_conversaciones c
      JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id
      WHERE a.producto IS NOT NULL OR a.marca IS NOT NULL
      ORDER BY c.iniciada_en ASC LIMIT 30 OFFSET ${offset};
    `;

    let actualizadas = 0;
    for (const fila of candidatas) {
      try {
        const productoShopify = await buscarProductoShopify(fila.producto, fila.categoria, fila.marca, fila.modelo, fila.especificaciones);
        await sql`
          UPDATE whatsapp_conversaciones SET
            shopify_producto_url = ${productoShopify?.url || null},
            shopify_producto_titulo = ${productoShopify?.titulo || null},
            shopify_producto_confianza = ${productoShopify?.confianza ?? null}
          WHERE id = ${fila.id};
        `;
        actualizadas++;
      } catch (err) {
        console.error('[whatsapp-actualizar-shopify] error en conversación', fila.id, err);
      }
    }

    const { rows: totalRows } = await sql`
      SELECT COUNT(*)::int AS n FROM whatsapp_conversaciones c
      JOIN whatsapp_analisis_ia a ON a.conversacion_id = c.id
      WHERE a.producto IS NOT NULL OR a.marca IS NOT NULL;
    `;
    const total = totalRows[0]?.n || 0;
    const nuevoOffset = offset + candidatas.length;

    return res.status(200).json({ actualizadas, offset: nuevoOffset, total, completo: nuevoOffset >= total });
  } catch (err) {
    return res.status(500).json({ error: 'Error actualizando links de Shopify', detail: String(err) });
  }
}

// Busca ventas (Bsale primero, Shopify como respaldo -- ver
// buscarVentaPorTelefono) para conversaciones que todavía no tienen ni una
// venta confirmada a mano ni una sugerencia encontrada. Admin-only. Lote
// más chico que el de buscarProductoShopify (15, no 30) y con pausa entre
// cada una -- golpea la API real de Bsale (rate limit ~8 req/s, mismo
// límite que usan las demás sincronizaciones de este archivo).
//
// bsale_documento_numero = '' (string vacío, NO NULL) marca "ya se
// revisó, no se encontró nada" -- necesario para que el WHERE
// "bsale_documento_numero IS NULL" se vaya vaciando de verdad en cada
// llamada (si se dejara NULL para "no encontrado", la misma conversación
// se re-revisaría en cada llamada para siempre, sin avanzar nunca).
async function manejarWhatsappActualizarVentasBsale(req, res, sesion) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede buscar ventas de Bsale en lote' });
  if (!(process.env.BSALE_ACCESS_TOKEN || '').trim()) return res.status(200).json({ error: 'BSALE_ACCESS_TOKEN no está configurada en el servidor' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);

    const { rows: candidatas } = await sql`
      SELECT c.id, c.iniciada_en, ct.telefono AS contacto_telefono
      FROM whatsapp_conversaciones c
      JOIN whatsapp_contactos ct ON ct.id = c.contacto_id
      WHERE c.venta_detectada = false AND c.bsale_documento_numero IS NULL
      ORDER BY c.iniciada_en ASC LIMIT 15;
    `;

    let encontradas = 0;
    for (const fila of candidatas) {
      try {
        const ventaBsale = await buscarVentaPorTelefono(sql, fila.contacto_telefono, fila.iniciada_en);
        await sql`
          UPDATE whatsapp_conversaciones SET
            bsale_documento_numero = ${ventaBsale?.numero || ''},
            bsale_documento_tipo = ${ventaBsale?.tipo || null},
            bsale_documento_monto = ${ventaBsale?.monto ?? null},
            bsale_documento_fecha = ${ventaBsale?.fecha || null},
            bsale_documento_url = ${ventaBsale?.url || null}
          WHERE id = ${fila.id};
        `;
        if (ventaBsale) encontradas++;
      } catch (err) {
        console.error('[whatsapp-actualizar-ventas-bsale] error en conversación', fila.id, err);
      }
      await new Promise(r => setTimeout(r, PUNTOS_SYNC_INTERVALO_MIN_MS)); // ritmo bajo el límite de Bsale
    }

    const { rows: restantesRows } = await sql`
      SELECT COUNT(*)::int AS n FROM whatsapp_conversaciones
      WHERE venta_detectada = false AND bsale_documento_numero IS NULL;
    `;
    const restantes = restantesRows[0]?.n || 0;

    return res.status(200).json({ revisadas: candidatas.length, encontradas, restantes, completo: restantes === 0 });
  } catch (err) {
    return res.status(500).json({ error: 'Error buscando ventas de Bsale', detail: String(err) });
  }
}

// ---- Analítica (puntos 5/6/7/29/30 del pedido) ----
async function manejarWhatsappAnalitica(req, res, sesion) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const sql = await getSql();
    await asegurarTablaWhatsapp(sql);

    // Dos formas de elegir el período: los botones rápidos de siempre
    // (?rango=7d|30d|90d|anio), o un rango de fechas explícito
    // (?desde=YYYY-MM-DD&hasta=YYYY-MM-DD, ambos inclusive) para el nuevo
    // selector de fechas. El rango explícito manda si viene completo.
    const esFechaValida = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const qDesde = esFechaValida(req.query.desde) ? req.query.desde : null;
    const qHasta = esFechaValida(req.query.hasta) ? req.query.hasta : null;
    const rango = req.query.rango || (qDesde && qHasta ? 'personalizado' : '30d');

    let desde, hasta, agrupacion;
    if (qDesde && qHasta) {
      // Límites del rango en hora de Chile, no UTC (mismo criterio que el
      // Dashboard -- ver conversación sobre timezone_sesion='GMT'):
      // "hasta" es EXCLUSIVO (medianoche del día siguiente en Santiago),
      // así que el día "hasta" queda incluido completo.
      const { rows: rangoRows } = await sql.query(
        `SELECT
           ($1::date)::timestamp AT TIME ZONE 'America/Santiago' AS desde_ts,
           (($2::date + 1))::timestamp AT TIME ZONE 'America/Santiago' AS hasta_ts;`,
        [qDesde, qHasta]
      );
      desde = rangoRows[0].desde_ts;
      hasta = rangoRows[0].hasta_ts;
      const diasSpan = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000));
      agrupacion = diasSpan <= 31 ? 'day' : (diasSpan <= 180 ? 'week' : 'month');
    } else {
      const dias = { '7d': 7, '30d': 30, '90d': 90, 'anio': 365 }[rango] || 30;
      // 7/30 días: por día. 90 días: por semana (si no, son demasiadas
      // barras). Año: por mes.
      agrupacion = (rango === '7d' || rango === '30d') ? 'day' : (rango === '90d' ? 'week' : 'month');
      desde = new Date(Date.now() - dias * 86400000).toISOString();
      hasta = new Date().toISOString();
    }

    const { rows: serie } = await sql.query(
      `SELECT date_trunc($1, c.iniciada_en) AS bucket,
              COUNT(*)::int AS conversaciones,
              COUNT(DISTINCT c.contacto_id)::int AS clientes_unicos,
              COUNT(*) FILTER (WHERE c.venta_detectada)::int AS ventas
       FROM whatsapp_conversaciones c
       WHERE c.iniciada_en >= $2 AND c.iniciada_en < $3
       GROUP BY bucket ORDER BY bucket ASC;`,
      [agrupacion, desde, hasta]
    );

    const { rows: categoriaRows } = await sql.query(
      `SELECT COALESCE(categoria,'otra') AS categoria, COUNT(*)::int AS n
       FROM whatsapp_conversaciones WHERE iniciada_en >= $1 AND iniciada_en < $2 GROUP BY categoria ORDER BY n DESC;`,
      [desde, hasta]
    );

    // Motivos de pérdida: solo conversaciones que NO terminaron en venta ni
    // siguen en curso (cotización/seguimiento son "todavía no perdidas").
    const { rows: motivosRows } = await sql.query(
      `SELECT COALESCE(motivo_perdida, resultado, 'otro') AS motivo, COUNT(*)::int AS n
       FROM whatsapp_conversaciones
       WHERE iniciada_en >= $1 AND iniciada_en < $2 AND venta_detectada = false
         AND resultado IS NOT NULL AND resultado NOT IN ('cotizacion','seguimiento')
       GROUP BY motivo ORDER BY n DESC;`,
      [desde, hasta]
    );
    const totalPerdidas = motivosRows.reduce((a, r) => a + r.n, 0);

    const { rows: productosRows } = await sql.query(
      `SELECT producto, COUNT(*)::int AS consultas, COUNT(*) FILTER (WHERE venta_detectada)::int AS ventas
       FROM whatsapp_conversaciones WHERE iniciada_en >= $1 AND iniciada_en < $2 AND producto IS NOT NULL
       GROUP BY producto ORDER BY consultas DESC LIMIT 15;`,
      [desde, hasta]
    );
    const { rows: marcasRows } = await sql.query(
      `SELECT marca, COUNT(*)::int AS consultas FROM whatsapp_conversaciones WHERE iniciada_en >= $1 AND iniciada_en < $2 AND marca IS NOT NULL GROUP BY marca ORDER BY consultas DESC LIMIT 10;`,
      [desde, hasta]
    );
    const { rows: modelosRows } = await sql.query(
      `SELECT modelo, COUNT(*)::int AS consultas FROM whatsapp_conversaciones WHERE iniciada_en >= $1 AND iniciada_en < $2 AND modelo IS NOT NULL GROUP BY modelo ORDER BY consultas DESC LIMIT 10;`,
      [desde, hasta]
    );
    const { rows: resultadosRows } = await sql.query(
      `SELECT COALESCE(resultado,'sin_resultado') AS resultado, COUNT(*)::int AS n
       FROM whatsapp_conversaciones WHERE iniciada_en >= $1 AND iniciada_en < $2 GROUP BY resultado ORDER BY n DESC;`,
      [desde, hasta]
    );
    // "Venta" del embudo cuenta tanto las confirmadas a mano
    // (venta_detectada, botón "Asociar venta") como las sugeridas
    // automáticamente por teléfono contra Bsale o Shopify
    // (bsale_documento_numero -- ver buscarVentaPorTelefono). Ese campo
    // queda en '' (string vacío) cuando ya se buscó y no se encontró nada,
    // y en NULL cuando nunca se ha buscado -- por eso el filtro exige que
    // no sea NULL y tampoco ''.
    const { rows: embudoRows } = await sql.query(
      `SELECT
        COUNT(*)::int AS conversaciones,
        COUNT(*) FILTER (WHERE intencion = 'compra')::int AS intencion_compra,
        COUNT(*) FILTER (WHERE resultado = 'cotizacion' OR venta_detectada OR (bsale_documento_numero IS NOT NULL AND bsale_documento_numero <> ''))::int AS cotizacion,
        COUNT(*) FILTER (WHERE venta_detectada OR (bsale_documento_numero IS NOT NULL AND bsale_documento_numero <> ''))::int AS venta
       FROM whatsapp_conversaciones WHERE iniciada_en >= $1 AND iniciada_en < $2;`,
      [desde, hasta]
    );

    // Fuente de ingreso (de dónde viene el cliente): referral de anuncios
    // Click-to-WhatsApp, UTM detectado en un link que el cliente mandó, o
    // desconocido si no se detectó ninguno de los dos (ver fuente_tipo en
    // extraerUtmDeTexto / el campo "referral" del webhook de Meta). Se
    // agrupa en 3 baldes (utm/anuncio/desconocido), no por el fuente_tipo
    // crudo -- Meta manda distintos source_type según el formato del
    // anuncio (ad/post/ig_reels/...) y aquí solo interesa distinguir
    // "vino de un anuncio" de "vino de un link con UTM", igual que ya
    // hace fuenteInfo() en el frontend para la ficha de cada conversación.
    const BALDE_FUENTE = `CASE WHEN fuente_tipo IS NULL THEN 'desconocido' WHEN fuente_tipo = 'utm' THEN 'utm' ELSE 'anuncio' END`;
    const { rows: fuenteRows } = await sql.query(
      `SELECT ${BALDE_FUENTE} AS tipo, COUNT(*)::int AS cantidad,
              COUNT(*) FILTER (WHERE venta_detectada OR (bsale_documento_numero IS NOT NULL AND bsale_documento_numero <> ''))::int AS ventas
       FROM whatsapp_conversaciones WHERE iniciada_en >= $1 AND iniciada_en < $2
       GROUP BY tipo ORDER BY cantidad DESC;`,
      [desde, hasta]
    );
    const { rows: fuenteDetalleRows } = await sql.query(
      `SELECT ${BALDE_FUENTE} AS tipo, fuente_titulo AS titulo, COUNT(*)::int AS cantidad
       FROM whatsapp_conversaciones WHERE iniciada_en >= $1 AND iniciada_en < $2 AND fuente_titulo IS NOT NULL
       GROUP BY tipo, titulo ORDER BY cantidad DESC LIMIT 15;`,
      [desde, hasta]
    );

    return res.status(200).json({
      rango, agrupacion,
      desde: new Date(desde).toISOString().slice(0, 10),
      hasta: new Date(new Date(hasta).getTime() - 1).toISOString().slice(0, 10), // vuelve a ser inclusivo para mostrar en el UI
      serie: serie.map(r => ({ fecha: r.bucket, conversaciones: r.conversaciones, clientesUnicos: r.clientes_unicos, ventas: r.ventas })),
      distribucionCategoria: categoriaRows.map(r => ({ categoria: r.categoria, cantidad: r.n })),
      motivosPerdida: motivosRows.map(r => ({
        motivo: r.motivo, etiqueta: WHATSAPP_MOTIVOS_PERDIDA_LABEL[r.motivo] || r.motivo,
        cantidad: r.n, porcentaje: totalPerdidas > 0 ? Math.round((r.n / totalPerdidas) * 1000) / 10 : 0,
      })),
      rankingProductos: productosRows.map(r => ({
        producto: r.producto, consultas: r.consultas, ventas: r.ventas,
        conversion: r.consultas > 0 ? Math.round((r.ventas / r.consultas) * 1000) / 10 : 0,
      })),
      rankingMarcas: marcasRows.map(r => ({ marca: r.marca, consultas: r.consultas })),
      rankingModelos: modelosRows.map(r => ({ modelo: r.modelo, consultas: r.consultas })),
      resultados: resultadosRows.map(r => ({ resultado: r.resultado, cantidad: r.n })),
      embudo: embudoRows[0] || { conversaciones: 0, intencion_compra: 0, cotizacion: 0, venta: 0 },
      fuentes: fuenteRows.map(r => ({ tipo: r.tipo, cantidad: r.cantidad, ventas: r.ventas })),
      fuentesDetalle: fuenteDetalleRows.map(r => ({ tipo: r.tipo, titulo: r.titulo, cantidad: r.cantidad })),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error calculando analítica de WhatsApp', detail: String(err) });
  }
}


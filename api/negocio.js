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

import { getSql, asegurarTablaProductosCriticos, asegurarTablaReportesError } from '../lib/db.js';
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
  return res.status(400).json({ error: 'Falta ?recurso=criticos, ?recurso=reportes o ?recurso=zoho-tickets' });
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

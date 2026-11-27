// /lib/tickets-zoho.js
// Migración de Zoho Desk al módulo de Tickets del ERP y operación en paralelo.
// Departamentos que entran en la fase 1 (los IDs salen de la API de Zoho Desk): Solicitudes Venta, NAS Leads, Post-Venta IndexStore, S.Técnico Casa Matriz y ST retiro
// inmediato. Soporte TI (INDEXPRO) sigue en Zoho. Las consultas a Zoho llegan inyectadas (`zohoGet(ruta)` -> JSON): sin red acá, para poder probarlo.
//
// Idempotente: cada ticket se guarda con su zoho_ticket_id, así que repetir la importación actualiza en vez de duplicar. Si alguien ya modificó el ticket en el ERP
// después de la última copia desde Zoho, la copia NO lo pisa (gana el ERP) y se cuenta como conflicto.

import { asegurarTablasTickets, buscarOCrearCliente, normalizarTipoProducto, recortarCita, MOTIVOS_POSTVENTA, cargarListas, LISTAS } from './tickets.js';
import { limpiarAsunto } from './tickets-correo.js';
import { unaVez } from './una-vez.js';

export const DEPARTAMENTOS_ZOHO = {
  '299066000010931332': { nombre: 'Solicitudes Venta', tipo: 'lead' },
  '299066000065007029': { nombre: 'NAS Leads', tipo: 'lead', origen: 'nas' },
  '299066000005641045': { nombre: 'Post-Venta IndexStore', tipo: 'postventa' },
  '299066000010202045': { nombre: 'S.Técnico Casa Matriz', tipo: 'servicio_tecnico' },
  '299066000041314035': { nombre: 'ST retiro inmediato', tipo: 'servicio_tecnico', retiro: true },
  '299066000000006907': { nombre: 'INDEXPRO (Soporte TI)', tipo: 'soporte_ti' },
};
const NUMERO_INICIAL_TICKET = 26633; // desde acá el correlativo es del ERP; los tickets de Zoho anteriores conservan su número
const NUMERO_INICIAL_OS = 3162;
const POR_PAGINA = 100;
const CONCURRENCIA = 5;

// ---------------- Migración de columnas ----------------
export async function asegurarColumnasZoho(sql) { return unaVez('asegurarColumnasZoho', () => _asegurarColumnasZoho(sql)); }
async function _asegurarColumnasZoho(sql) {
  await asegurarTablasTickets(sql); // las columnas zoho_* viven en la migración de tickets.js
}

// ---------------- Utilidades de mapeo ----------------
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const vacio = (v) => v == null || String(v).trim() === '' || String(v).trim() === 'false';
export function textoDeHtml(html) {
  return String(html ?? '').replace(/<(br|\/div|\/p|\/li|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&deg;/g, '°').replace(/&Oacute;/g, 'Ó').replace(/&oacute;/g, 'ó').replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í').replace(/&uacute;/g, 'ú')
    .replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í').replace(/&Uacute;/g, 'Ú').replace(/&ntilde;/g, 'ñ').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Campo personalizado por su nombre visible ("Numero Pedido") o, si no está, por su nombre de API (cf_numero_pedido). Ignora tildes y mayúsculas.
export function campoZoho(det, nombres, clavesCf = []) {
  const cf = det.customFields || {};
  const claves = Object.keys(cf).map((k) => [norm(k), k]);
  for (const n of nombres) { const f = claves.find(([a]) => a === norm(n)); if (f && !vacio(cf[f[1]])) return String(cf[f[1]]).trim(); }
  for (const k of clavesCf) { const v = det.cf?.[k]; if (!vacio(v)) return String(v).trim(); }
  return null;
}

// Los nombres de estado vienen de Zoho tal cual ("Contactado WSP (cerrado)"; el departamento NAS usa "Open" / "Closed"): se comparan sin tildes ni mayúsculas.
const ESTADOS_LEAD = {
  abierto: ['abierto'], open: ['abierto'], closed: ['cerrado_contactado'],
  'contactado wsp': ['cerrado_contactado', 'whatsapp'], 'contactado wsp cerrado': ['cerrado_contactado', 'whatsapp'],
  'contactado correo': ['cerrado_contactado', 'correo'], 'contactado correo cerrado': ['cerrado_contactado', 'correo'],
  'sin datos de contacto': ['cerrado_sin_datos'], 'sin datos de contacto cerrado': ['cerrado_sin_datos'],
};
const ESTADOS_POSTVENTA = { abierto: ['abierto'], open: ['abierto'], designado: ['designado'], 'por transferir': ['por_transferir'], abandonado: ['abandonado'], cerrado: ['cerrado'], closed: ['cerrado'] };
// En servicio técnico el "Cerrado" de Zoho es el equipo entregado.
const ESTADOS_ST = { abierto: ['abierto'], open: ['abierto'], designado: ['designado'], extension: ['extension'], 'por retirar': ['por_retirar'], cerrado: ['entregado'], closed: ['entregado'] };
// Soporte TI: el departamento INDEXPRO usa "Abierto", "En Desarrollo" y "Cerrado".
const ESTADOS_TI = { abierto: ['abierto'], open: ['abierto'], 'en desarrollo': ['en_desarrollo'], 'en espera': ['en_espera'], 'on hold': ['en_espera'], cerrado: ['cerrado'], closed: ['cerrado'] };
const POR_TIPO = { lead: ESTADOS_LEAD, postventa: ESTADOS_POSTVENTA, servicio_tecnico: ESTADOS_ST, soporte_ti: ESTADOS_TI };
const CIERRE_POR_DEFECTO = { lead: 'cerrado_contactado', postventa: 'cerrado', servicio_tecnico: 'entregado', soporte_ti: 'cerrado' };
const ESTADOS_QUE_CIERRAN = new Set(['cerrado_contactado', 'cerrado_sin_datos', 'cerrado', 'abandonado', 'entregado']);

export function mapearEstado(tipo, status, statusType) {
  const conocido = POR_TIPO[tipo][norm(status)];
  if (conocido) return { estado: conocido[0], canal: conocido[1] || null, desconocido: false };
  const cerrado = /closed/i.test(statusType || '');
  return { estado: cerrado ? CIERRE_POR_DEFECTO[tipo] : 'abierto', canal: null, desconocido: true };
}
const PRIORIDAD = { high: 'alta', medium: 'media', low: 'baja' };

// Valor de una línea "Etiqueta: valor" del texto del ticket (los formularios y las órdenes de servicio llegan así). `etiquetas` es una expresión regular (alternativas).
export function valorLinea(texto, etiquetas) {
  const m = new RegExp('^[\\s•*-]*(?:' + etiquetas + ')\\s*:\\s*(.+)$', 'im').exec(texto || '');
  return m ? m[1].trim() : null;
}
const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
export function fechaEspanol(t) { // "12-ago-2026" -> 2026-08-12
  const m = /(\d{1,2})[-\s/]([A-Za-zñÑ]{3})[A-Za-z.]*[-\s/](\d{4})/.exec(String(t || ''));
  const mes = m && MESES[m[2].toLowerCase()];
  return mes ? `${m[3]}-${String(mes).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : null;
}

// Origen de un lead según lo que dice Zoho: la "clasificación" ("LEAD Pantalla", "Carrito Abandonado"), el asunto y la línea "De donde viene:" del formulario.
// Es una inferencia: la simulación muestra la distribución para poder revisarla antes de importar.
export function inferirOrigenLead(det, dept, texto) {
  if (dept.origen) return dept.origen;
  const t = norm(`${det.classification || ''} ${det.subject || ''} ${valorLinea(texto, 'De donde viene') || ''}`);
  if (/carrito|abandon|checkout/.test(t)) return 'carrito_abandonado';
  if (/zohobot|salesiq|\bbot\b/.test(t)) return 'zohobot';
  if (/landing/.test(t) && /pantalla/.test(t)) return 'landing_pantallas';
  if (/landing/.test(t) && /cargador/.test(t)) return 'landing_cargadores';
  if (/^chat$/i.test(String(det.channel || '')) || /\bchat\b/.test(t)) return 'chat';
  return 'migracion_zoho';
}

function motivoDePostventa(subject) {
  const s = norm(subject);
  const lista = (LISTAS?.motivos || MOTIVOS_POSTVENTA);
  const f = lista.find((m) => norm(m.etiqueta) === s || norm(m.clave) === s);
  return f ? f.clave : null;
}
function digitos(v) { const d = String(v ?? '').replace(/\D/g, ''); return d || null; }
const primerCorreo = (v) => (/[^\s,;<>]+@[^\s,;<>]+/.exec(String(v ?? '')) || [null])[0];

// Pasa el ticket de Zoho (detalle) a los campos del ERP. Puro: no toca la base.
export function mapearTicketZoho(det, deptId, { agentes = new Map(), nombres = new Map() } = {}) {
  const dept = DEPARTAMENTOS_ZOHO[deptId];
  if (!dept) throw new Error('Departamento de Zoho no incluido en la fase 1: ' + deptId);
  const completo = textoDeHtml(det.description);
  // Los avisos de postventa y de servicio técnico traen al final el texto legal de siempre (políticas, términos y condiciones): no se copia en cada ticket.
  const corte = dept.tipo === 'postventa' ? /Informaci[oó]n adicional relevante/i : dept.tipo === 'servicio_tecnico' ? /T[ÉE]RMINOS Y CONDICIONES/i : null;
  const descripcion = (corte ? completo.split(corte)[0] : completo).trim();
  const contacto = det.contact || {};
  // Los leads dejan nombre, correo y teléfono solo en la descripción (el ticket y el contacto de Zoho suelen venir vacíos).
  const nombreContacto = [contacto.firstName, contacto.lastName].filter(Boolean).join(' ').trim() || valorLinea(completo, 'Nombre y apellido|NOMBRE CLIENTE|Nombre') || null;
  const telDesc = valorLinea(completo, 'WhatsApp|Tel[eé]fono|FONO|Celular|M[oó]vil');
  const { estado, canal, desconocido } = mapearEstado(dept.tipo, det.status, det.statusType);
  const cierra = ESTADOS_QUE_CIERRAN.has(estado);
  const creado = det.createdTime;
  const cerrado = cierra ? (det.closedTime || det.modifiedTime || creado) : null;
  const movimiento = det.modifiedTime || det.closedTime || creado;
  const m = {
    zoho_id: String(det.id), zoho_numero: digitos(det.ticketNumber) ? Number(digitos(det.ticketNumber)) : null, zoho_dept_id: String(deptId),
    tipo: dept.tipo, estado, estado_desconocido: desconocido ? String(det.status || '') : null, prioridad: PRIORIDAD[String(det.priority || '').toLowerCase()] || 'media',
    asunto: String(det.subject || '').trim().slice(0, 200) || (dept.tipo === 'servicio_tecnico' ? 'Orden de servicio' : 'Ticket de Zoho'), descripcion: descripcion.slice(0, 4000) || null,
    creado_en: creado, cerrado_en: cerrado, ultimo_movimiento_en: movimiento,
    cliente: {
      nombre: nombreContacto, email: primerCorreo(det.email) || primerCorreo(contacto.email) || primerCorreo(valorLinea(completo, 'Correo|E-?mail|CORREO')) || null,
      telefono: det.phone || contacto.phone || contacto.mobile || telDesc || null, rut: campoZoho(det, ['Rut'], ['cf_rut']) || valorLinea(completo, 'RUT'),
    },
    agente_zoho_id: det.assigneeId ? String(det.assigneeId) : null,
    agente_id: det.assigneeId ? (agentes.get(String(det.assigneeId)) ?? null) : null,
    agente_nombre_zoho: (det.assignee ? [det.assignee.firstName, det.assignee.lastName].filter(Boolean).join(' ') || det.assignee.name || null : null) || (det.assigneeId ? nombres.get(String(det.assigneeId)) || null : null),
    zoho_url: det.webUrl || null,
    hilos_n: (Number(det.threadCount) || 0) + (Number(det.commentCount) || 0),
  };
  if (dept.tipo === 'lead') {
    m.origen = inferirOrigenLead(det, dept, completo);
    // Producto: campo de Zoho, o lo que escribió en el formulario ("marca y modelo"), o el producto del carrito, o el asunto sin su prefijo.
    const porAsunto = String(det.subject || '').replace(/^(Nuevo Lead|Contactar)\s*:\s*/i, '').trim();
    const producto = campoZoho(det, ['¿ Que producto o servicio deseas ?', 'Que producto o servicio deseas'], ['cf_que_producto_o_servicio_deseas'])
      || valorLinea(completo, 'Ingrese marca y modelo[^:]*') || (/Detalle del Producto:\s*\n?\s*Nombre:\s*(.+)/i.exec(completo) || [])[1]?.trim()
      || (/^carrito abandonado/i.test(porAsunto) ? null : porAsunto);
    const total = /Precio Total:\s*(\d+)/i.exec(completo);
    m.lead = { producto_interes: producto ? producto.slice(0, 200) : null, origen_detalle: m.origen, canal_contacto: canal, monto_estimado: total ? Number(total[1]) : null };
  } else if (dept.tipo === 'postventa') {
    m.origen = 'migracion_zoho';
    const pedidoDoc = campoZoho(det, ['Número Pedido, Boleta o Factura'], ['cf_numero_boleta_o_factura']);
    const tipoProd = campoZoho(det, ['Tipo de producto'], ['cf_tipo_de_producto']);
    m.postventa = {
      motivo: motivoDePostventa(det.subject), tipo_producto: tipoProd ? normalizarTipoProducto(tipoProd) : null,
      numero_pedido: digitos(campoZoho(det, ['Numero Pedido'], ['cf_numero_pedido'])) || digitos(pedidoDoc), numero_documento: digitos(pedidoDoc),
      nota_credito_numero: digitos(campoZoho(det, ['Nota de crédito'], ['cf_nota_de_credito'])),
      resumen_resolucion: campoZoho(det, ['Resumen Resolución'], ['cf_resumen_resolucion', 'cf_lista_de_seleccion_1']) || (det.resolution ? textoDeHtml(det.resolution) : null),
    };
  } else if (dept.tipo === 'servicio_tecnico') {
    m.origen = 'meson';
    const motivo = campoZoho(det, ['Motivo ingreso'], ['cf_motivo_ingreso']);
    const os = /N\s*[°º]\s*(\d{2,6})/i.exec(det.subject || '') || /Orden de Servi[a-z]+\s*N\s*[°º]\s*(\d{2,6})/i.exec(completo);
    // El servicio viene como "(SER008) - Diagnóstico para Notebook y PC": además del código se rescata el nombre para el catálogo.
    const srv = /\((SER\d{3})\)\s*-?\s*([^\n]+)/i.exec(motivo || '');
    m.orden = {
      numero_os: os ? Number(os[1]) : null, servicio_codigo: srv ? srv[1].toUpperCase() : ((/SER\d{3}/i.exec(`${motivo || ''} ${det.subject || ''}`) || [null])[0] || '').toUpperCase() || null,
      servicio_nombre: srv ? srv[2].trim().slice(0, 120) : null,
      equipo_tipo: campoZoho(det, ['Tipo de producto'], ['cf_tipo_de_producto']), marca: campoZoho(det, ['Marca del equipo'], ['cf_marca_del_equipo']), motivo_ingreso: motivo,
      retiro_inmediato: !!dept.retiro, fecha_entrega: estado === 'entregado' && cerrado ? String(cerrado).slice(0, 10) : null,
      fecha_entrega_estimada: fechaEspanol(valorLinea(completo, 'F\\.?\\s?E\\.? de Entrega|FECHA ENTREGA')),
    };
  } else {
    // Soporte TI: casi todo llega por correo; el cuerpo del correo es la descripción (sin la cita de los mensajes anteriores).
    m.origen = /^email$/i.test(String(det.channel || '')) ? 'correo' : 'migracion_zoho';
    m.descripcion = recortarCita(completo).slice(0, 4000) || null;
  }
  return m;
}

// ---------------- Agentes de Zoho -> usuarios del ERP ----------------
export async function mapaAgentes(sql, zohoGet) {
  const mapa = new Map(); const nombres = new Map(); const sinEquivalente = [];
  let agentes = [];
  try { const r = await zohoGet('/agents?limit=200'); agentes = r?.data || []; } catch { /* sin lista: los tickets quedan sin propietario */ }
  const { rows: usuarios } = await sql.query('SELECT id, email, nombre FROM usuarios');
  for (const a of agentes) {
    nombres.set(String(a.id), a.name || [a.firstName, a.lastName].filter(Boolean).join(' ') || '');
    const email = String(a.emailId || a.email || '').toLowerCase();
    const nombre = norm(a.name || [a.firstName, a.lastName].filter(Boolean).join(' '));
    const u = usuarios.find((x) => email && String(x.email || '').toLowerCase() === email) || usuarios.find((x) => nombre && norm(x.nombre) === nombre);
    if (u) mapa.set(String(a.id), u.id); else sinEquivalente.push({ id: String(a.id), nombre: a.name || [a.firstName, a.lastName].filter(Boolean).join(' ') || email });
  }
  return { mapa, sinEquivalente, nombres };
}

// ---------------- Guardar un ticket mapeado ----------------
export async function guardarTicketMapeado(sql, m) {
  const { rows: ex } = await sql.query('SELECT id, estado, actualizado_en, zoho_sync_en FROM tickets WHERE zoho_ticket_id = $1', [m.zoho_id]);
  if (ex[0]) {
    const t = ex[0];
    // Si en el ERP se tocó el ticket después de la última copia, gana el ERP.
    if (t.zoho_sync_en && new Date(t.actualizado_en).getTime() > new Date(t.zoho_sync_en).getTime()) return { accion: 'conflicto', id: t.id };
    if (t.estado === m.estado) { await sql.query('UPDATE tickets SET zoho_sync_en = now(), zoho_hilos_en = CASE WHEN zoho_hilos_n IS DISTINCT FROM $2 THEN NULL ELSE zoho_hilos_en END, zoho_hilos_n = $2 WHERE id = $1', [t.id, m.hilos_n]); return { accion: 'sin_cambios', id: t.id }; }
    await sql.query(`UPDATE tickets SET estado = $2, cerrado_en = $3, ultimo_movimiento_en = COALESCE($4::timestamptz, ultimo_movimiento_en), zoho_sync_en = now(),
       zoho_hilos_en = CASE WHEN zoho_hilos_n IS DISTINCT FROM $5 THEN NULL ELSE zoho_hilos_en END, zoho_hilos_n = $5 WHERE id = $1`, [t.id, m.estado, m.cerrado_en, m.ultimo_movimiento_en, m.hilos_n]);
    await sql.query(`INSERT INTO tk_eventos (ticket_id, tipo, autor_nombre, contenido, estado_anterior, estado_nuevo, creado_en) VALUES ($1, 'cambio_estado', 'Zoho Desk', 'Cambio de estado copiado desde Zoho', $2, $3, COALESCE($4::timestamptz, now()))`,
      [t.id, t.estado, m.estado, m.cerrado_en || m.ultimo_movimiento_en]);
    if (m.tipo === 'servicio_tecnico') await sql.query('UPDATE tk_ordenes_servicio SET fecha_entrega = $2 WHERE ticket_id = $1', [t.id, m.orden.fecha_entrega]);
    return { accion: 'actualizado', id: t.id };
  }

  await cargarListas(sql);
  // Soporte TI: si ese correo ya llegó directo al ERP (soporteti@), el ticket del ERP y el de Zoho son el mismo: se enlazan en vez de duplicarlos.
  if (m.tipo === 'soporte_ti' && m.cliente.email) {
    const { rows: cand } = await sql.query(
      `SELECT t.id, t.asunto FROM tickets t JOIN tk_clientes c ON c.id = t.cliente_id
       WHERE t.tipo = 'soporte_ti' AND t.zoho_ticket_id IS NULL AND t.correo_hilo IS NOT NULL AND c.email = $1 AND abs(extract(epoch FROM (t.creado_en - $2::timestamptz))) < 86400 LIMIT 20`, [String(m.cliente.email).toLowerCase(), m.creado_en]);
    const gemelo = cand.find((r) => limpiarAsunto(r.asunto).toLowerCase() === limpiarAsunto(m.asunto).toLowerCase());
    if (gemelo) {
      // zoho_desc_hilo = 'primero': el primer hilo de Zoho es el correo que el ERP ya tiene como descripción (no se repite como mensaje)
      await sql.query(`UPDATE tickets SET zoho_ticket_id = $2, zoho_numero = $3, zoho_dept_id = $4, zoho_sync_en = now(), zoho_hilos_n = $5, zoho_hilos_en = NULL, zoho_desc_hilo = 'primero' WHERE id = $1`,
        [gemelo.id, m.zoho_id, m.zoho_numero, m.zoho_dept_id, m.hilos_n]);
      return { accion: 'enlazado', id: gemelo.id };
    }
  }
  const cliente = await buscarOCrearCliente(sql, m.cliente);
  // El número de ticket de Zoho se conserva si es anterior al correlativo del ERP y no está tomado; si no, se asigna el siguiente y el de Zoho queda en zoho_numero.
  let numero = null;
  if (m.zoho_numero && m.zoho_numero < NUMERO_INICIAL_TICKET) { const { rows } = await sql.query('SELECT 1 FROM tickets WHERE numero = $1', [m.zoho_numero]); if (!rows[0]) numero = m.zoho_numero; }
  const { rows: ins } = await sql.query(
    `INSERT INTO tickets (numero, tipo, estado, prioridad, cliente_id, agente_id, origen, asunto, descripcion, creado_en, actualizado_en, ultimo_movimiento_en, cerrado_en, zoho_ticket_id, zoho_numero, zoho_dept_id, zoho_sync_en, zoho_hilos_n)
     VALUES (COALESCE($1::int, nextval('tk_ticket_numero_seq')), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, $13, $14, $15, now(), $16) RETURNING id, numero`,
    [numero, m.tipo, m.estado, m.prioridad, cliente?.id ?? null, m.agente_id, m.origen, m.asunto, m.descripcion, m.creado_en, m.ultimo_movimiento_en || m.creado_en, m.cerrado_en, m.zoho_id, m.zoho_numero, m.zoho_dept_id, m.hilos_n]);
  const id = ins[0].id;
  if (m.tipo === 'lead') {
    await sql.query('INSERT INTO tk_leads (ticket_id, producto_interes, origen_detalle, canal_contacto, monto_estimado) VALUES ($1, $2, $3, $4, $5)', [id, m.lead.producto_interes, m.lead.origen_detalle, m.lead.canal_contacto, m.lead.monto_estimado]);
  } else if (m.tipo === 'postventa') {
    const p = m.postventa;
    await sql.query('INSERT INTO tk_postventa (ticket_id, motivo, tipo_producto, numero_pedido, numero_documento, nota_credito_numero, resumen_resolucion) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, p.motivo, p.tipo_producto, p.numero_pedido, p.numero_documento, p.nota_credito_numero, p.resumen_resolucion]);
  } else if (m.tipo === 'servicio_tecnico') {
    const o = m.orden;
    let servicio = null;
    // El catálogo de servicios se completa con los nombres reales que usa Zoho ("(SER008) - Diagnóstico para Notebook y PC"): se crea el que falte y se corrige el nombre
    // de uno que aún no tiene precio (o sea, que nadie ha trabajado en el catálogo).
    if (o.servicio_codigo && o.servicio_nombre) {
      await sql.query(`INSERT INTO tk_servicios (codigo, nombre) VALUES ($1, $2) ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre WHERE tk_servicios.precio_clp IS NULL`, [o.servicio_codigo, o.servicio_nombre]);
    }
    if (o.servicio_codigo) { const { rows } = await sql.query('SELECT codigo FROM tk_servicios WHERE codigo = $1', [o.servicio_codigo]); servicio = rows[0]?.codigo || null; }
    // El N° de orden de Zoho se conserva si es anterior al correlativo del ERP y no está tomado.
    let numeroOs = null;
    if (o.numero_os && o.numero_os < NUMERO_INICIAL_OS) { const { rows } = await sql.query('SELECT 1 FROM tk_ordenes_servicio WHERE numero_os = $1', [o.numero_os]); if (!rows[0]) numeroOs = o.numero_os; }
    await sql.query(
      `INSERT INTO tk_ordenes_servicio (ticket_id, numero_os, servicio_codigo, equipo_tipo, marca, motivo_ingreso, retiro_inmediato, fecha_entrega, fecha_entrega_estimada) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, numeroOs, servicio, o.equipo_tipo, o.marca, o.motivo_ingreso, o.retiro_inmediato, o.fecha_entrega, o.fecha_entrega_estimada]);
  }
  await sql.query(`INSERT INTO tk_eventos (ticket_id, tipo, autor_nombre, contenido, estado_nuevo, creado_en) VALUES ($1, 'cambio_estado', 'Migración Zoho', $2, $3, $4)`,
    [id, `Importado de Zoho Desk (ticket #${m.zoho_numero ?? m.zoho_id})`, m.estado, m.cerrado_en || m.creado_en]);
  if (m.agente_zoho_id && !m.agente_id) {
    await sql.query(`INSERT INTO tk_eventos (ticket_id, tipo, autor_nombre, contenido, creado_en) VALUES ($1, 'actualizacion', 'Migración Zoho', $2, $3)`,
      [id, `Propietario en Zoho: ${m.agente_nombre_zoho || m.agente_zoho_id} (sin usuario equivalente en el ERP)`, m.creado_en]);
  }
  return { accion: 'creado', id, numero: ins[0].numero };
}

// ---------------- Lotes ----------------
// Mapea el ticket; si no se encontró el nombre del cliente ni en el ticket ni en su descripción, lo pide al contacto de Zoho (una vez por contacto).
async function mapearConContacto(zohoGet, it, det, deptId, ctx, cache) {
  const completo = { ...it, ...det, contact: it.contact || det.contact, assignee: it.assignee || det.assignee };
  let m = mapearTicketZoho(completo, deptId, ctx);
  if (!m.cliente.nombre && completo.contactId) {
    try {
      let c = cache.get(completo.contactId);
      if (!c) { c = await zohoGet(`/contacts/${completo.contactId}`); cache.set(completo.contactId, c); }
      m = mapearTicketZoho({ ...completo, contact: c }, deptId, ctx);
    } catch { /* sin permiso o sin contacto: se importa sin nombre */ }
  }
  return m;
}
async function enParalelo(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
const PROGRESO = 'migracion_zoho';
async function leerProgreso(sql) { const { rows } = await sql.query(`SELECT valor FROM tk_config WHERE clave = $1`, [PROGRESO]); try { return rows[0] ? JSON.parse(rows[0].valor) : {}; } catch { return {}; } }
async function guardarProgreso(sql, p) { await sql.query(`INSERT INTO tk_config (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`, [PROGRESO, JSON.stringify(p)]); }

// Procesa UNA página (100 tickets) de un departamento, de los más nuevos a los más antiguos, hasta llegar a `desde` (YYYY-MM-DD).
// `simular`: no escribe nada; devuelve cómo quedaría. Devuelve el `siguiente` desde donde seguir, o terminado: true.
export async function procesarLote(sql, zohoGet, { dept, from = 0, desde, simular = false, agentes = null }) {
  if (!DEPARTAMENTOS_ZOHO[dept]) return { error: 'Departamento no válido', status: 400 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || '')) return { error: 'Falta la fecha desde la que se migra', status: 400 };
  await asegurarColumnasZoho(sql);
  const ag = agentes || await mapaAgentes(sql, zohoGet);
  const cacheContactos = new Map();
  const lista = await zohoGet(`/tickets?departmentId=${dept}&limit=${POR_PAGINA}&from=${from}&sortBy=-createdTime&include=contacts,assignee`);
  const items = lista?.data || [];
  const corte = new Date(desde + 'T00:00:00-03:00').getTime();
  const dentro = items.filter((t) => new Date(t.createdTime).getTime() >= corte);
  const llegoAlCorte = dentro.length < items.length;
  const res = { dept, nombre: DEPARTAMENTOS_ZOHO[dept].nombre, revisados: dentro.length, creados: 0, actualizados: 0, sin_cambios: 0, conflictos: 0, errores: [], porEstado: {}, porOrigen: {}, estadosDesconocidos: [], muestra: [], sinEquivalente: ag.sinEquivalente, simulado: !!simular };
  await enParalelo(dentro, CONCURRENCIA, async (it) => {
    try {
      const det = await zohoGet(`/tickets/${it.id}`);
      const m = await mapearConContacto(zohoGet, it, det, dept, { agentes: ag.mapa, nombres: ag.nombres }, cacheContactos);
      res.porEstado[m.estado] = (res.porEstado[m.estado] || 0) + 1; res.porOrigen[m.origen] = (res.porOrigen[m.origen] || 0) + 1;
      if (m.estado_desconocido && !res.estadosDesconocidos.includes(m.estado_desconocido)) res.estadosDesconocidos.push(m.estado_desconocido);
      if (simular) { if (res.muestra.length < 3) res.muestra.push({ zoho: m.zoho_numero, asunto: m.asunto, estado: m.estado, origen: m.origen, cliente: m.cliente.nombre, tipo: m.tipo }); return; }
      const r = await guardarTicketMapeado(sql, m);
      if (r.accion === 'creado') res.creados++; else if (r.accion === 'enlazado') res.sin_cambios++; else if (r.accion === 'actualizado') res.actualizados++; else if (r.accion === 'conflicto') res.conflictos++; else res.sin_cambios++;
    } catch (e) { res.errores.push({ zoho_id: it.id, error: String(e.message || e).slice(0, 150) }); }
  });
  const ultima = dentro.length ? dentro[dentro.length - 1].createdTime : null;
  res.ultima_fecha = ultima; res.terminado = llegoAlCorte || items.length < POR_PAGINA; res.siguiente = res.terminado ? null : from + POR_PAGINA;
  if (!simular) {
    const p = await leerProgreso(sql);
    const d = (p[dept] && from > 0 && p[dept].desde === desde) ? p[dept] : { desde, revisados: 0, por_estado: {}, errores: 0 };
    d.revisados += res.revisados; d.errores += res.errores.length; d.ultima_fecha = ultima || d.ultima_fecha; d.terminado = res.terminado; d.actualizado = new Date().toISOString();
    for (const [k, v] of Object.entries(res.porEstado)) d.por_estado[k] = (d.por_estado[k] || 0) + v;
    p[dept] = d; await guardarProgreso(sql, p);
  }
  return res;
}

// Cuadre: lo que se recorrió de Zoho vs lo que hay en el ERP, por departamento y estado.
export async function cuadreMigracion(sql) {
  await asegurarColumnasZoho(sql);
  const p = await leerProgreso(sql);
  const filas = [];
  for (const [id, d] of Object.entries(DEPARTAMENTOS_ZOHO)) {
    const prog = p[id] || null;
    // Solo cuenta lo creado desde la fecha con la que se migró ese departamento (el resto del historial no se importó)
    const { rows } = await sql.query(`SELECT estado, count(*)::int AS n FROM tickets WHERE zoho_ticket_id IS NOT NULL AND zoho_dept_id = $1 AND creado_en >= $2::timestamptz GROUP BY 1`,
      [id, prog?.desde ? prog.desde + 'T00:00:00-03:00' : '1970-01-01']);
    const erp = {}; let erpTotal = 0;
    for (const r of rows) { erp[r.estado] = r.n; erpTotal += r.n; }
    // El ERP puede tener de más (tickets creados en el ERP no entran acá porque no tienen zoho_ticket_id) o de menos (aún no importado)
    const zoho = prog ? prog.por_estado : {}; const zohoTotal = prog ? prog.revisados : 0;
    const estados = [...new Set([...Object.keys(zoho), ...Object.keys(erp)])];
    const detalle = estados.map((e) => ({ estado: e, zoho: zoho[e] || 0, erp: erp[e] || 0 }));
    const cuadra = !!prog && prog.terminado && erpTotal >= zohoTotal && detalle.every((x) => x.erp >= x.zoho);
    filas.push({ dept: id, nombre: d.nombre, tipo: d.tipo, zoho_revisados: zohoTotal, erp_total: erpTotal, terminado: !!prog?.terminado, desde: prog?.desde || null, ultima_fecha: prog?.ultima_fecha || null, errores: prog?.errores || 0, detalle, cuadra });
  }
  // "Todo cuadra" mira solo los departamentos que ya se importaron (uno nunca importado aparece como "Sin importar").
  const importadas = filas.filter((f) => f.desde);
  return { filas, todoCuadra: importadas.length > 0 && importadas.every((f) => f.cuadra) };
}

// ---------------- Operación en paralelo ----------------
const CLAVE_PARALELO = 'zoho_paralelo';
export async function leerParalelo(sql) { const { rows } = await sql.query(`SELECT valor FROM tk_config WHERE clave = $1`, [CLAVE_PARALELO]); try { return rows[0] ? JSON.parse(rows[0].valor) : { activo: false }; } catch { return { activo: false }; } }
export async function guardarParalelo(sql, cambios) { const a = await leerParalelo(sql); const n = { ...a, ...cambios }; await sql.query(`INSERT INTO tk_config (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`, [CLAVE_PARALELO, JSON.stringify(n)]); return n; }

// Copia lo nuevo que haya entrado a Zoho en los últimos días y refresca el estado de los tickets abiertos que vienen de Zoho.
export async function sincronizarParalelo(sql, zohoGet, { dias = 3, maxRefrescos = 40, ahora = Date.now() } = {}) {
  await asegurarColumnasZoho(sql);
  const ag = await mapaAgentes(sql, zohoGet);
  const cacheContactos = new Map();
  const corte = ahora - dias * 86400000;
  const r = { nuevos: 0, actualizados: 0, sin_cambios: 0, conflictos: 0, errores: [], refrescados: 0 };
  const sumar = (x) => { if (x.accion === 'creado') r.nuevos++; else if (x.accion === 'enlazado') r.sin_cambios++; else if (x.accion === 'actualizado') r.actualizados++; else if (x.accion === 'conflicto') r.conflictos++; else r.sin_cambios++; };
  for (const dept of Object.keys(DEPARTAMENTOS_ZOHO)) {
    for (let from = 0; from < POR_PAGINA * 5; from += POR_PAGINA) {
      let items; try { items = (await zohoGet(`/tickets?departmentId=${dept}&limit=${POR_PAGINA}&from=${from}&sortBy=-createdTime&include=contacts,assignee`))?.data || []; } catch (e) { r.errores.push({ dept, error: String(e.message || e).slice(0, 120) }); break; }
      const nuevos = items.filter((t) => new Date(t.createdTime).getTime() >= corte);
      await enParalelo(nuevos, CONCURRENCIA, async (it) => {
        try { const det = await zohoGet(`/tickets/${it.id}`); sumar(await guardarTicketMapeado(sql, await mapearConContacto(zohoGet, it, det, dept, { agentes: ag.mapa, nombres: ag.nombres }, cacheContactos))); }
        catch (e) { r.errores.push({ zoho_id: it.id, error: String(e.message || e).slice(0, 120) }); }
      });
      if (nuevos.length < items.length || items.length < POR_PAGINA) break;
    }
  }
  // Refrescar los abiertos que vienen de Zoho (los más desactualizados primero)
  const { rows: abiertos } = await sql.query(`SELECT zoho_ticket_id, zoho_dept_id FROM tickets WHERE zoho_ticket_id IS NOT NULL AND cerrado_en IS NULL AND zoho_dept_id IS NOT NULL ORDER BY zoho_sync_en NULLS FIRST LIMIT $1`, [maxRefrescos]);
  await enParalelo(abiertos, CONCURRENCIA, async (a) => {
    try { const det = await zohoGet(`/tickets/${a.zoho_ticket_id}`); sumar(await guardarTicketMapeado(sql, mapearTicketZoho(det, a.zoho_dept_id, { agentes: ag.mapa, nombres: ag.nombres }))); r.refrescados++; }
    catch (e) { r.errores.push({ zoho_id: a.zoho_ticket_id, error: String(e.message || e).slice(0, 120) }); }
  });
  // Conversaciones de lo nuevo (y de los tickets con mensajes nuevos): los correos de Soporte TI traen su cuerpo en el primer hilo. 2 rondas por pasada; lo que quede se copia en la siguiente.
  r.conversaciones = 0;
  let cursorHilos = 0;
  for (let ronda = 0; ronda < 2; ronda++) {
    try {
      const h = await procesarHilos(sql, zohoGet, { depts: Object.keys(DEPARTAMENTOS_ZOHO), cursor: cursorHilos, limite: 12 });
      r.conversaciones += h.procesados || 0; for (const e of h.errores || []) r.errores.push(e);
      if (h.terminado || !h.siguiente) break; cursorHilos = h.siguiente;
    } catch (e) { r.errores.push({ error: String(e.message || e).slice(0, 120) }); break; }
  }
  await guardarParalelo(sql, { ultima_sync: new Date(ahora).toISOString(), ultimo_resultado: { ...r, errores: r.errores.slice(0, 5) } });
  return r;
}

// ---------------- Respaldo de las conversaciones ----------------
// Lo que dejó el cliente por correo y lo que respondieron los técnicos (hilos) y las notas internas (comentarios) se copian como eventos del ticket. Del texto de cada
// correo se quita la cita del mensaje anterior ("---- en Lunes … escribió ----"), que repetiría el hilo entero en cada respuesta. Los archivos adjuntos NO se copian:
// queda anotado su nombre en el mensaje.
export function textoDeHilo(plano) {
  const t = String(plano ?? '').split(/-{3,}\s*(?:en|el|on)\s+[^\n]{3,120}?(?:escribi[oó]|wrote)\s*-{3,}/i)[0];
  return t.replace(/\s+/g, ' ').trim().slice(0, 3000);
}
// Texto de un mensaje de Zoho CON sus saltos de línea y listas (el "plainText" de Zoho viene todo en una línea, el HTML no): se usa el HTML, se corta en la primera cita
// (<blockquote>) y se quitan las marcas de "… escribió:". Si solo hay texto plano, se usa ese.
export function textoDeMensaje(html, plano) {
  if (html) return recortarCita(textoDeHtml(String(html).split(/<blockquote/i)[0]).split(/-{3,}\s*(?:en|el|on)\s+[^\n]{3,120}?(?:escribi[oó]|wrote)\s*-{3,}/i)[0]).slice(0, 6000);
  return textoDeHilo(plano);
}
export function eventosDeConversacion(hilos, comentarios) {
  const ev = [];
  for (const h of hilos) {
    if (h.isDescriptionThread) continue; // el primer hilo es la descripción del ticket, que ya está guardada
    const entrante = String(h.direction || '').toLowerCase() === 'in';
    const quien = h.author?.name || h.author?.email || (entrante ? 'Cliente' : 'IndexStore');
    const medio = String(h.channel || '').toLowerCase() === 'email' ? 'Correo' : 'Mensaje';
    const cabecera = entrante ? `${medio} recibido del cliente` : `${medio} enviado al cliente${h.to ? ' (' + h.to + ')' : ''}`;
    const adj = Number(h.attachmentCount) > 0 || h.hasAttach ? `\n[Tenía ${Number(h.attachmentCount) > 0 ? h.attachmentCount + ' ' : ''}archivo(s) adjunto(s) en Zoho: no se copiaron]` : '';
    ev.push({ ref: 'h' + h.id, tipo: 'contacto_cliente', autor: quien, creado: h.createdTime, contenido: `${cabecera}\n${textoDeMensaje(h.content, h.plainText || h.summary)}${adj}`.trim(), privado: String(h.visibility || '').toLowerCase() === 'private' });
  }
  for (const c of comentarios) {
    ev.push({ ref: 'c' + c.id, tipo: 'comentario_interno', autor: c.commenter?.name || 'Zoho', creado: c.commentedTime || c.createdTime, contenido: textoDeMensaje(c.content || '', null) });
  }
  return ev.filter((e) => e.contenido).sort((a, b) => new Date(a.creado) - new Date(b.creado));
}

// Copia los mensajes de un ticket. Los correos que llegan a Zoho (departamento INDEXPRO) vienen con la descripción VACÍA: el cuerpo del correo está en el primer hilo.
// Por eso, si el ticket no tiene descripción, el primer hilo pasa a ser la descripción del ticket (completa) y los demás quedan como mensajes.
export async function copiarConversacion(sql, zohoGet, ticket) {
  const lista = await zohoGet(`/tickets/${ticket.zoho_ticket_id}/threads?limit=100&sortBy=sendDateTime`);
  const hilos = lista?.data || [];
  const sinDescripcion = !String(ticket.descripcion ?? '').trim();
  let desc = hilos.find((h) => h.isDescriptionThread) || hilos.find((h) => ticket.zoho_desc_hilo && String(h.id) === String(ticket.zoho_desc_hilo)) || (ticket.zoho_desc_hilo === 'primero' ? hilos[0] : null) || null;
  if (sinDescripcion && !desc) desc = hilos[0] || null;
  // El listado trae solo un resumen de ~200 caracteres: el texto completo se pide hilo por hilo (el hilo de la descripción solo si hace falta su texto).
  const aPedir = hilos.filter((h) => !h.isDescriptionThread || (sinDescripcion && h === desc));
  const completos = await enParalelo(aPedir, CONCURRENCIA, async (h) => {
    try { return { ...h, ...(await zohoGet(`/tickets/${ticket.zoho_ticket_id}/threads/${h.id}?include=plainText`)) }; } catch { return h; }
  });
  if (sinDescripcion && desc) {
    const full = completos.find((h) => h.id === desc.id) || desc;
    const texto = textoDeMensaje(full.content, full.plainText || full.summary).slice(0, 6000);
    if (texto) await sql.query(`UPDATE tickets SET descripcion = $2, zoho_desc_hilo = $3 WHERE id = $1 AND COALESCE(descripcion, '') = ''`, [ticket.id, texto, String(desc.id)]);
  }
  let comentarios = [];
  try { comentarios = (await zohoGet(`/tickets/${ticket.zoho_ticket_id}/comments?limit=100&sortBy=commentedTime`))?.data || []; } catch { /* sin comentarios o sin permiso */ }
  // Si el correo entra directo al ERP (el ticket tiene hilo de Gmail), los mensajes ENTRANTES ya llegan por ahí: de Zoho solo se copian las respuestas enviadas y las notas.
  const entraDirecto = !!ticket.correo_hilo;
  const ev = eventosDeConversacion(completos.filter((h) => (!desc || h.id !== desc.id) && !(entraDirecto && String(h.direction || '').toLowerCase() === 'in')), comentarios);
  let nuevos = 0;
  for (const e of ev) {
    const r = await sql.query(
      `INSERT INTO tk_eventos (ticket_id, tipo, autor_nombre, contenido, creado_en, zoho_ref) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (ticket_id, zoho_ref) WHERE zoho_ref IS NOT NULL DO NOTHING RETURNING id`,
      [ticket.id, e.tipo, String(e.autor || '').slice(0, 120), e.contenido, e.creado, e.ref]);
    if (r.rows[0]) nuevos++;
  }
  await sql.query('UPDATE tickets SET zoho_hilos_en = now() WHERE id = $1', [ticket.id]);
  return { eventos: nuevos, descripcion: sinDescripcion && !!desc };
}

// Copia las conversaciones de hasta `limite` tickets de Zoho (de los departamentos dados) que todavía no las tienen. `cursor` = último id ya visto (así un ticket con error
// no se repite sin fin). Un ticket con un solo hilo (la descripción) y sin comentarios no necesita llamadas a Zoho.
export async function procesarHilos(sql, zohoGet, { depts = [], cursor = 0, limite = 10 } = {}) {
  await asegurarColumnasZoho(sql);
  const ids = depts.filter((d) => DEPARTAMENTOS_ZOHO[d]);
  if (!ids.length) return { error: 'Elige al menos un departamento', status: 400 };
  const base = `FROM tickets WHERE zoho_ticket_id IS NOT NULL AND zoho_hilos_en IS NULL AND (COALESCE(zoho_hilos_n, 0) > 1 OR COALESCE(descripcion, '') = '') AND zoho_dept_id = ANY($1::text[])`;
  const { rows: pend } = await sql.query(`SELECT count(*)::int AS n ${base}`, [ids]);
  const { rows: lote } = await sql.query(`SELECT id, zoho_ticket_id, descripcion, zoho_desc_hilo, correo_hilo ${base} AND id > $2 ORDER BY id LIMIT $3`, [ids, Number(cursor) || 0, Math.min(Math.max(Number(limite) || 10, 1), 25)]);
  const res = { pendientes: pend[0].n, procesados: 0, eventos: 0, errores: [], siguiente: lote.length ? lote[lote.length - 1].id : null, terminado: !lote.length };
  await enParalelo(lote, 3, async (t) => {
    try { const r = await copiarConversacion(sql, zohoGet, t); res.procesados++; res.eventos += r.eventos; }
    catch (e) { res.errores.push({ ticket_id: t.id, error: String(e.message || e).slice(0, 120) }); }
  });
  return res;
}

// ---------------- Descarga del respaldo ----------------
// Devuelve una página de tickets completos (cliente, detalle por tipo, todos los eventos y los adjuntos guardados) para armar el archivo en el navegador:
// la respuesta de una función de Vercel no puede pasar de ~4,5 MB, así que el archivo se arma por partes.
export async function exportarRespaldo(sql, { tipo = null, cursor = 0, limite = 50 } = {}) {
  await asegurarColumnasZoho(sql);
  const t = ['lead', 'postventa', 'servicio_tecnico'].includes(tipo) ? tipo : null;
  const { rows: total } = await sql.query('SELECT count(*)::int AS n FROM tickets WHERE ($1::text IS NULL OR tipo = $1)', [t]);
  const { rows } = await sql.query(
    `SELECT t.id, t.numero, t.zoho_numero, t.zoho_ticket_id, t.tipo, t.estado, t.prioridad, t.origen, t.asunto, t.descripcion, t.creado_en, t.cerrado_en, t.ultimo_movimiento_en,
            COALESCE(NULLIF(u.nombre, ''), u.email) AS agente, row_to_json(c.*) AS cliente, row_to_json(l.*) AS lead, row_to_json(p.*) AS postventa, row_to_json(o.*) AS orden,
            (SELECT COALESCE(json_agg(json_build_object('tipo', e.tipo, 'autor', e.autor_nombre, 'contenido', e.contenido, 'estado_anterior', e.estado_anterior, 'estado_nuevo', e.estado_nuevo, 'fecha', e.creado_en) ORDER BY e.creado_en, e.id), '[]'::json)
               FROM tk_eventos e WHERE e.ticket_id = t.id) AS eventos,
            (SELECT COALESCE(json_agg(json_build_object('nombre', a.nombre, 'tipo', a.mime, 'bytes', a.bytes, 'fecha', a.creado_en)), '[]'::json) FROM tk_adjuntos a WHERE a.ticket_id = t.id) AS adjuntos
     FROM tickets t LEFT JOIN usuarios u ON u.id = t.agente_id LEFT JOIN tk_clientes c ON c.id = t.cliente_id LEFT JOIN tk_leads l ON l.ticket_id = t.id
     LEFT JOIN tk_postventa p ON p.ticket_id = t.id LEFT JOIN tk_ordenes_servicio o ON o.ticket_id = t.id
     WHERE t.id > $2 AND ($1::text IS NULL OR t.tipo = $1) ORDER BY t.id LIMIT $3`, [t, Number(cursor) || 0, Math.min(Math.max(Number(limite) || 50, 1), 100)]);
  return { total: total[0].n, tickets: rows, siguiente: rows.length ? rows[rows.length - 1].id : null, terminado: rows.length < Math.min(Math.max(Number(limite) || 50, 1), 100) };
}

// ---------------- Manejador del recurso `tickets-migracion` (solo administradores) ----------------
export async function manejarTicketsMigracion(req, res, sesion, { getSql, zohoGet }) {
  try {
    if (sesion.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede migrar desde Zoho' });
    const sql = await getSql();
    await asegurarColumnasZoho(sql);
    if (req.method === 'GET' && req.query.respaldo !== undefined) return res.status(200).json(await exportarRespaldo(sql, { tipo: req.query.tipo, cursor: req.query.cursor, limite: req.query.limite }));
    if (req.method === 'GET') {
      return res.status(200).json({ configurado: !!zohoGet, departamentos: Object.entries(DEPARTAMENTOS_ZOHO).map(([id, d]) => ({ id, ...d })), cuadre: await cuadreMigracion(sql), paralelo: await leerParalelo(sql) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!zohoGet) return res.status(200).json({ error: 'Zoho Desk no está configurado en el servidor (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN y ZOHO_ORG_ID)' });
    const b = req.body || {};
    if (b.accion === 'lote') {
      const r = await procesarLote(sql, zohoGet, { dept: String(b.dept || ''), from: Number(b.from) || 0, desde: b.desde, simular: b.simular === true });
      if (r.error) return res.status(r.status || 400).json({ error: r.error });
      return res.status(200).json({ ok: true, ...r });
    }
    if (b.accion === 'hilos') {
      const r = await procesarHilos(sql, zohoGet, { depts: Array.isArray(b.depts) ? b.depts.map(String) : [], cursor: b.cursor, limite: b.limite });
      if (r.error) return res.status(r.status || 400).json({ error: r.error });
      return res.status(200).json({ ok: true, ...r });
    }
    if (b.accion === 'paralelo') return res.status(200).json({ ok: true, paralelo: await guardarParalelo(sql, { activo: b.activo === true }) });
    if (b.accion === 'sincronizar') return res.status(200).json({ ok: true, ...(await sincronizarParalelo(sql, zohoGet)) });
    return res.status(400).json({ error: 'Acción no válida' });
  } catch (err) {
    return res.status(200).json({ error: 'Error en la migración desde Zoho', detail: String(err.message || err).slice(0, 300) });
  }
}

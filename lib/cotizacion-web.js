// /lib/cotizacion-web.js
// ══════════════════════════════════════════════════════════════════════
// Cotización web (PROTOTIPO): el cliente arma su cotización en indexstore.cl (productos, envío, datos de facturación) y el ERP crea una
// cotización REAL en Bsale, la guarda con un enlace privado y se la manda por correo. Durante 3 días puede volver (enlace del correo o de la
// página) y pulsar "Generar compra": el ERP revisa precios y stock y lo lleva al carro de Shopify con los productos y los datos cargados.
//
// LÍMITES CONOCIDOS (a propósito, para un prototipo):
//  - No se reserva stock de verdad: Shopify solo reserva con borradores de pedido (falta el permiso write_draft_orders) y Bsale no
//    reserva con una cotización. La página y el correo lo dicen ("sujeto a disponibilidad"); al comprar se vuelve a revisar el stock.
//  - El precio se vuelve a leer de Shopify al comprar. Si cambió, se avisa y se pide confirmar.
//  - El medio de pago se elige en el checkout de Shopify (no se puede bloquear desde un enlace de carro); aquí queda solo como preferencia.
//  - El envío cobrado es el que calcule Shopify en el checkout con la misma comuna; la cotización muestra el mismo cálculo (firmado por
//    el Worker para que el cliente no pueda inventar un precio).
// Casi todo son funciones puras o reciben sus dependencias (sql, gql, bsale, correo) para poder probarlas sin red.
// ══════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import { rutValido, rutLimpio, rutConGuion } from './bsale-emision.js';

export const VIGENCIA_DIAS = 3;
export const TIENDA = 'https://www.indexstore.cl';
export const PAGINA_COTIZAR = TIENDA + '/pages/cotizar';
export const RETIRO_NOMBRE = 'Retiro en tienda';
export const MAX_LINEAS = 15;
export const MAX_CANTIDAD = 50;
export const FIRMA_ENVIO_MINUTOS = 90; // las tarifas firmadas por el Worker valen 90 minutos
const IVA = 0.19;

// ───────────── Tabla ─────────────
export async function asegurarTablaCotizacionesWeb(sql) {
  await sql.query(`CREATE TABLE IF NOT EXISTS cotizaciones_web (
    id SERIAL PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    estado TEXT NOT NULL DEFAULT 'vigente',
    bsale_id BIGINT,
    bsale_numero TEXT,
    bsale_url TEXT,
    email TEXT NOT NULL,
    nombre TEXT,
    telefono TEXT,
    rut TEXT,
    razon_social TEXT,
    giro TEXT,
    region TEXT,
    comuna TEXT,
    direccion TEXT,
    metodo_pago TEXT,
    envio_nombre TEXT,
    envio_precio INTEGER NOT NULL DEFAULT 0,
    items JSONB NOT NULL DEFAULT '[]',
    total_productos INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    vid TEXT,
    correo_enviado BOOLEAN NOT NULL DEFAULT false,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    vence_en TIMESTAMPTZ NOT NULL,
    pago_iniciado_en TIMESTAMPTZ,
    vistas INTEGER NOT NULL DEFAULT 0
  )`);
  await sql.query('CREATE INDEX IF NOT EXISTS cotizaciones_web_creado_idx ON cotizaciones_web (creado_en DESC)');
  await sql.query(`CREATE TABLE IF NOT EXISTS cotizaciones_web_config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL DEFAULT '')`);
  await sql.query(`CREATE TABLE IF NOT EXISTS cotizaciones_web_codigos (
    id SERIAL PRIMARY KEY, email TEXT NOT NULL, codigo_hash TEXT NOT NULL, intentos INTEGER NOT NULL DEFAULT 0,
    usado BOOLEAN NOT NULL DEFAULT false, creado_en TIMESTAMPTZ NOT NULL DEFAULT now(), expira_en TIMESTAMPTZ NOT NULL)`);
}

// ───────────── Interruptor ─────────────
// estado: 'apagado' (nadie) | 'prototipo' (solo los correos de la lista) | 'abierto' (todos los clientes)
export const ESTADOS_COTIZACION = ['apagado', 'prototipo', 'abierto'];
export async function leerConfig(sql) {
  const { rows } = await sql.query('SELECT clave, valor FROM cotizaciones_web_config');
  const c = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
  return {
    estado: ESTADOS_COTIZACION.includes(c.estado) ? c.estado : 'prototipo',
    correos: String(c.correos || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean),
  };
}
export async function guardarConfig(sql, { estado, correos }) {
  const pares = [];
  if (estado !== undefined) {
    if (!ESTADOS_COTIZACION.includes(estado)) throw new Error('Estado no válido');
    pares.push(['estado', estado]);
  }
  if (correos !== undefined) {
    const lista = [...new Set(String(correos).split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))];
    pares.push(['correos', lista.join(',')]);
  }
  for (const [k, v] of pares) {
    await sql.query('INSERT INTO cotizaciones_web_config (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor', [k, v]);
  }
}
export function puedeCotizar(cfg, email) {
  if (cfg.estado === 'abierto') return true;
  if (cfg.estado === 'prototipo') return cfg.correos.includes(String(email || '').trim().toLowerCase());
  return false;
}

// ───────────── Firma de las tarifas de envío (Worker -> ERP) ─────────────
// El Worker calcula las tarifas con Shopify y las firma con la clave que ya comparte con el ERP; el ERP comprueba la firma antes de
// aceptar un precio de envío. Así el navegador no puede mandar "envío $0".
const textoFirma = e => [e.nombre, Math.round(Number(e.precio)), e.region, e.comuna, e.exp].join('|');
export function firmarEnvio(clave, e) {
  return crypto.createHmac('sha256', clave).update(textoFirma(e)).digest('hex').slice(0, 40);
}
export function envioValido(clave, e, ahoraMs = Date.now()) {
  if (!clave || !e || !e.firma || !Number.isFinite(Number(e.precio)) || Number(e.precio) < 0) return false;
  if (!Number.isFinite(Number(e.exp)) || Number(e.exp) < ahoraMs) return false;
  const esperada = Buffer.from(firmarEnvio(clave, e)), recibida = Buffer.from(String(e.firma));
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

// ───────────── Validación de la solicitud ─────────────
const limpiar = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validarSolicitud(b) {
  b = b || {};
  const items = [];
  const vistos = new Set();
  for (const it of Array.isArray(b.items) ? b.items : []) {
    const variante = Number(it && it.variante), cantidad = Math.round(Number(it && it.cantidad));
    if (!Number.isInteger(variante) || variante <= 0 || !Number.isFinite(cantidad) || cantidad < 1) return { ok: false, error: 'Hay un producto con datos no válidos.' };
    if (vistos.has(variante)) return { ok: false, error: 'Un producto está repetido; sube su cantidad en vez de agregarlo dos veces.' };
    vistos.add(variante);
    items.push({ variante, cantidad: Math.min(cantidad, MAX_CANTIDAD) });
  }
  if (!items.length) return { ok: false, error: 'Agrega al menos un producto.' };
  if (items.length > MAX_LINEAS) return { ok: false, error: `Máximo ${MAX_LINEAS} productos distintos por cotización.` };

  const cli = b.cliente || {};
  const email = limpiar(cli.email, 120).toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: 'El correo no es válido.' };
  const nombre = limpiar(cli.nombre, 80);
  if (nombre.length < 3) return { ok: false, error: 'Indica el nombre de contacto.' };
  const telefono = limpiar(cli.telefono, 25);
  if (telefono.replace(/\D/g, '').length < 8) return { ok: false, error: 'Indica un teléfono de contacto.' };
  if (!rutValido(cli.rut)) return { ok: false, error: 'El RUT no es válido (revisa el dígito verificador).' };
  const razon_social = limpiar(cli.razon_social, 120);
  if (razon_social.length < 3) return { ok: false, error: 'Indica la razón social.' };
  const giro = limpiar(cli.giro, 80);
  if (giro.length < 3) return { ok: false, error: 'Indica el giro de la empresa.' };

  const dir = b.direccion || {};
  const region = limpiar(dir.region, 60), comuna = limpiar(dir.comuna, 60), calle = limpiar(dir.calle, 120);
  if (!region || !comuna) return { ok: false, error: 'Elige la región y la comuna de despacho.' };
  if (calle.length < 4) return { ok: false, error: 'Indica la dirección de despacho (calle y número).' };

  const metodo_pago = ['transferencia', 'tarjeta'].includes(b.metodo_pago) ? b.metodo_pago : 'transferencia';
  const envio = b.envio || null;
  if (!envio || (!limpiar(envio.nombre, 80) && envio.tipo !== 'retiro')) return { ok: false, error: 'Elige un método de envío.' };
  // Retiro en tienda: gratis y sin tarifa firmada; la dirección sigue siendo necesaria como dirección de facturación.
  const retiro = envio.tipo === 'retiro';

  return {
    ok: true,
    datos: {
      items, metodo_pago, vid: limpiar(b.vid, 40) || null,
      cliente: { email, nombre, telefono, rut: rutConGuion(cli.rut), razon_social, giro },
      direccion: { region, comuna, calle },
      envio: retiro
        ? { nombre: RETIRO_NOMBRE, precio: 0, retiro: true }
        : { nombre: limpiar(envio.nombre, 80), precio: Math.round(Number(envio.precio)), region: limpiar(envio.region, 60), comuna: limpiar(envio.comuna, 60), exp: Number(envio.exp), firma: String(envio.firma || '') },
    },
  };
}

// ───────────── Precios y stock desde Shopify ─────────────
// gql(query, variables) -> respuesta de la Admin API. Los precios de Shopify en Chile ya incluyen IVA.
export async function leerVariantes(gql, ids) {
  const gids = ids.map(id => 'gid://shopify/ProductVariant/' + id);
  const body = await gql(
    `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id sku title price inventoryQuantity inventoryPolicy product { title handle status } } } }`,
    { ids: gids },
  );
  const porId = new Map();
  for (const n of (body && body.data && body.data.nodes) || []) {
    if (!n || !n.id) continue;
    porId.set(Number(String(n.id).split('/').pop()), {
      variante: Number(String(n.id).split('/').pop()),
      sku: n.sku || '',
      titulo: (n.product && n.product.title || '') + (n.title && n.title !== 'Default Title' ? ' - ' + n.title : ''),
      handle: n.product && n.product.handle || '',
      precio: Math.round(Number(n.price) || 0),
      stock: Number.isFinite(Number(n.inventoryQuantity)) ? Number(n.inventoryQuantity) : null,
      sigueSinStock: n.inventoryPolicy === 'CONTINUE',
      activo: !n.product || n.product.status === 'ACTIVE',
    });
  }
  return porId;
}

// Arma las líneas con precio de Shopify. Devuelve { lineas } o { error } (producto inexistente, inactivo o sin stock).
export function armarLineas(items, variantes) {
  const lineas = [];
  for (const it of items) {
    const v = variantes.get(it.variante);
    if (!v || !v.activo) return { error: 'Un producto de tu cotización ya no está disponible en la tienda.' };
    if (!v.precio) return { error: `"${v.titulo}" no tiene precio publicado.` };
    if (!v.sigueSinStock && v.stock !== null && v.stock < it.cantidad) {
      return { error: v.stock > 0 ? `De "${v.titulo}" quedan solo ${v.stock} unidades.` : `"${v.titulo}" está sin stock por ahora.` };
    }
    lineas.push({ variante: v.variante, sku: v.sku, titulo: v.titulo, handle: v.handle, cantidad: it.cantidad, precio: v.precio, subtotal: v.precio * it.cantidad });
  }
  return { lineas };
}

export const totalProductos = lineas => lineas.reduce((s, l) => s + l.subtotal, 0);

// ───────────── Documento de Bsale ─────────────
const neto = bruto => Math.round((bruto / (1 + IVA)) * 100) / 100;

export function armarCuerpoBsale({ tipoId, officeId, clienteId, cliente, direccion, lineas, envio, ahoraSeg, dias = VIGENCIA_DIAS, variantesBsale = {}, comentario }) {
  const detalle = lineas.map(l => {
    const vid = variantesBsale[l.sku];
    return vid
      ? { variantId: vid, netUnitValue: neto(l.precio), quantity: l.cantidad, taxId: '[1]' }
      : { netUnitValue: neto(l.precio), quantity: l.cantidad, taxId: '[1]', comment: (l.sku ? l.sku + ' - ' : '') + l.titulo.slice(0, 180) };
  });
  if (envio && envio.precio > 0) {
    detalle.push({ netUnitValue: neto(envio.precio), quantity: 1, taxId: '[1]', comment: `Envío: ${envio.nombre} (${direccion.comuna})`.slice(0, 200) });
  }
  const dia = Math.floor(ahoraSeg / 86400) * 86400; // Bsale guarda la fecha a medianoche UTC
  return {
    documentTypeId: tipoId, ...(officeId ? { officeId } : {}), emissionDate: dia, expirationDate: dia + dias * 86400,
    declareSii: 0, sendEmail: 0,
    // Quién pidió la cotización (el cliente existente de Bsale no se modifica, así que su contacto no aparece en el PDF). Se manda en los dos campos
    // que Bsale puede usar para las observaciones; si Bsale rechaza alguno, crearDocumentoBsale reintenta sin ellos.
    ...(comentario ? { comment: comentario.slice(0, 250), description: comentario.slice(0, 250) } : {}),
    ...(clienteId ? { clientId: clienteId } : {
      client: {
        code: cliente.rut, company: cliente.razon_social, activity: cliente.giro,
        firstName: cliente.nombre.split(' ')[0], lastName: cliente.nombre.split(' ').slice(1).join(' ') || '.',
        email: cliente.email, phone: cliente.telefono, address: direccion.calle, municipality: direccion.comuna, city: direccion.region,
      },
    }),
    details: detalle,
  };
}

// Crea la cotización en Bsale. "bsale(ruta, init)" devuelve una Response (fetch). Reintenta el cliente con menos campos si Bsale rechaza alguno.
export async function crearDocumentoBsale(bsale, { datos, lineas, ahoraSeg }) {
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const tipos = ((await (await bsale('/document_types.json?limit=50')).json().catch(() => ({}))).items) || [];
  const tipo = tipos.find(t => /COTIZ/.test(norm(t.name)) && t.state === 0) || tipos.find(t => /COTIZ/.test(norm(t.name)));
  if (!tipo) return { error: 'No encuentro el tipo de documento "cotización" en Bsale.' };

  let officeId = Number(process.env.BSALE_OFFICE_ID) || null;
  if (!officeId) {
    const of = ((await (await bsale('/offices.json?limit=10')).json().catch(() => ({}))).items || []).find(o => o.state === 0) || {};
    officeId = of.id || null;
  }
  const cli = await (await bsale('/clients.json?code=' + encodeURIComponent(datos.cliente.rut) + '&limit=1')).json().catch(() => ({}));
  const existente = (cli.items || [])[0] || null;

  // Variantes de Bsale por SKU (para que la línea quede con su producto y el stock/costeo del ERP la reconozca).
  const variantesBsale = {};
  for (const l of lineas) {
    if (!l.sku) continue;
    const r = await (await bsale('/variants.json?code=' + encodeURIComponent(l.sku) + '&limit=1')).json().catch(() => ({}));
    const v = (r.items || [])[0];
    if (v && v.id) variantesBsale[l.sku] = v.id;
  }

  const comentario = `Cotización web indexstore.cl - ${datos.metodo_pago}${datos.envio.retiro ? ' - RETIRO EN TIENDA' : ''}. Contacto: ${datos.cliente.nombre}, ${datos.cliente.email}, ${datos.cliente.telefono}. Sujeta a disponibilidad de stock.`;
  const base = { tipoId: tipo.id, officeId, clienteId: existente && existente.id, cliente: datos.cliente, direccion: datos.direccion, lineas, envio: datos.envio, ahoraSeg, variantesBsale, comentario };
  let cuerpo = armarCuerpoBsale(base);
  const publicar = async c => {
    const r = await bsale('/documents.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
    const texto = await r.text();
    let d = null; try { d = JSON.parse(texto); } catch {}
    return { ok: r.ok && d && d.id, d, status: r.status, texto };
  };
  const sinObservaciones = c => { const x = { ...c }; delete x.comment; delete x.description; return x; };
  let r = await publicar(cuerpo);
  if (!r.ok) { const r2 = await publicar(sinObservaciones(cuerpo)); if (r2.ok) r = r2; } // Bsale no aceptó el texto de observaciones
  if (!r.ok && !existente) { // el cliente nuevo pudo fallar por algún campo: se reintenta con lo mínimo
    cuerpo = armarCuerpoBsale(base);
    cuerpo.client = { code: datos.cliente.rut, firstName: datos.cliente.razon_social.slice(0, 60), lastName: '.', email: datos.cliente.email };
    r = await publicar(cuerpo);
    if (!r.ok) { const r2 = await publicar(sinObservaciones(cuerpo)); if (r2.ok) r = r2; }
  }
  if (!r.ok) return { error: 'Bsale rechazó la cotización (HTTP ' + r.status + ')', detalle: String(r.texto).slice(0, 400) };
  return { id: r.d.id, numero: String(r.d.number || ''), url: r.d.urlPublicView || r.d.urlPdf || '', total: Math.round(Number(r.d.totalAmount) || 0), clienteExistente: !!existente };
}

// ───────────── Enlace al carro de Shopify ─────────────
// Carro con los productos y, ya cargados, los datos del cliente y de despacho (así Shopify calcula el mismo envío que se cotizó) y los
// atributos con que el ERP emite la factura (mismas claves que usa lib/bsale-emision.js).
export function enlaceCarro(c, lineas) {
  const partes = lineas.map(l => `${l.variante}:${l.cantidad}`).join(',');
  const [nombre, ...ape] = String(c.nombre || '').split(' ');
  const q = new URLSearchParams();
  q.set('checkout[email]', c.email);
  if (c.envio_nombre !== RETIRO_NOMBRE) { // con retiro en tienda no se precarga despacho: en el checkout se elige "Retiro" y la dirección de facturación no es de entrega
    q.set('checkout[shipping_address][first_name]', nombre || '');
    q.set('checkout[shipping_address][last_name]', ape.join(' '));
    q.set('checkout[shipping_address][address1]', c.direccion || '');
    q.set('checkout[shipping_address][city]', c.comuna || '');
    q.set('checkout[shipping_address][province]', c.region || '');
    q.set('checkout[shipping_address][country]', 'Chile');
    q.set('checkout[shipping_address][phone]', c.telefono || '');
  }
  const attr = {
    tipo_documento: 'FACTURA', rut: c.rut, razon_social: c.razon_social, giro: c.giro, region: c.region, comuna: c.comuna,
    direccion_tributaria: c.direccion, telefono: c.telefono, cotizacion_web: c.bsale_numero || String(c.id || ''),
  };
  for (const [k, v] of Object.entries(attr)) if (v) q.set(`attributes[${k}]`, v);
  return `${TIENDA}/cart/${partes}?${q.toString()}`;
}

// ───────────── Correo ─────────────
const clp = n => '$' + Math.round(n).toLocaleString('es-CL');
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const fechaLarga = d => new Date(d).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', weekday: 'long', day: 'numeric', month: 'long' });

export function enlaceCotizacion(token) { return `${PAGINA_COTIZAR}?t=${encodeURIComponent(token)}`; }

export function correoCotizacion(cot, lineas) {
  const url = enlaceCotizacion(cot.token);
  const vence = fechaLarga(cot.vence_en);
  const filas = lineas.map(l => `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb">${esc(l.titulo)}<br><span style="color:#6b7280;font-size:12px">${esc(l.sku)} · ${l.cantidad} × ${clp(l.precio)}</span></td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap">${clp(l.subtotal)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">
<h2 style="margin:0 0 4px">Tu cotización ${cot.bsale_numero ? 'N° ' + esc(cot.bsale_numero) : ''}</h2>
<p style="margin:0 0 16px;color:#4b5563">Hola ${esc(String(cot.nombre).split(' ')[0])}, esta es la cotización que armaste en indexstore.cl. Puedes pagarla hasta el <strong>${esc(vence)}</strong>.</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${filas}
<tr><td style="padding:8px 0">${cot.envio_nombre === RETIRO_NOMBRE ? esc(RETIRO_NOMBRE) + ' (La Concepción 81, of. 1904, Providencia)' : 'Envío: ' + esc(cot.envio_nombre) + ' (' + esc(cot.comuna) + ')'}</td><td style="padding:8px 0;text-align:right">${cot.envio_precio ? clp(cot.envio_precio) : 'Gratis'}</td></tr>
<tr><td style="padding:10px 0;font-weight:bold">Total (IVA incluido)</td><td style="padding:10px 0;text-align:right;font-weight:bold">${clp(cot.total)}</td></tr></table>
<p style="text-align:center;margin:22px 0"><a href="${esc(url)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:bold;display:inline-block">Ver mi cotización y pagar</a></p>
<p style="font-size:12px;color:#6b7280">Los precios y el stock se confirman al momento de pagar: esta cotización no garantiza disponibilidad de stock. ${cot.bsale_url ? `<a href="${esc(cot.bsale_url)}">Descargar PDF</a>.` : ''}</p>
</div>`;
  const texto = `Tu cotización ${cot.bsale_numero || ''}\nTotal: ${clp(cot.total)} (IVA incluido). Válida hasta el ${vence}.\nVer y pagar: ${url}\nNo garantiza disponibilidad de stock; se confirma al pagar.`;
  return { asunto: `Tu cotización ${cot.bsale_numero ? 'N° ' + cot.bsale_numero + ' ' : ''}de IndexStore - válida hasta el ${vence}`, html, texto };
}

// ───────────── Flujos ─────────────
const generarToken = () => crypto.randomBytes(24).toString('base64url');
const vista = (f, lineas) => ({
  token: f.token, numero: f.bsale_numero, pdf: f.bsale_url, estado: estadoEfectivo(f), creada: f.creado_en, vence: f.vence_en,
  cliente: { nombre: f.nombre, email: f.email, rut: f.rut, razon_social: f.razon_social, giro: f.giro, telefono: f.telefono },
  direccion: { region: f.region, comuna: f.comuna, calle: f.direccion }, metodo_pago: f.metodo_pago,
  envio: { nombre: f.envio_nombre, precio: f.envio_precio }, total_productos: f.total_productos, total: f.total,
  items: lineas || f.items,
});
export function estadoEfectivo(f, ahora = Date.now()) {
  if (f.estado === 'vigente' && new Date(f.vence_en).getTime() < ahora) return 'vencida';
  return f.estado;
}

// deps: { sql, gql, bsale, enviarCorreo, clave, ahora }
export async function crearCotizacion(deps, cuerpo) {
  const { sql, gql, bsale, enviarCorreo, clave } = deps; const ahora = deps.ahora ? deps.ahora() : Date.now();
  const v = validarSolicitud(cuerpo);
  if (!v.ok) return { status: 400, error: v.error };
  const datos = v.datos;

  const cfg = await leerConfig(sql);
  if (!puedeCotizar(cfg, datos.cliente.email)) {
    return { status: 403, error: cfg.estado === 'apagado' ? 'Las cotizaciones en línea no están disponibles por ahora.' : 'Las cotizaciones en línea están en pruebas y todavía no están abiertas a todos los clientes. Escríbenos por WhatsApp y te cotizamos.' };
  }
  // Frenos: por visitante (hora), por correo (día) y total (día).
  const lim = async (cond, params, tope) => Number((await sql.query(`SELECT count(*)::int AS n FROM cotizaciones_web WHERE ${cond}`, params)).rows[0].n) >= tope;
  if (datos.vid && await lim(`vid = $1 AND creado_en > now() - interval '1 hour'`, [datos.vid], 6)) return { status: 429, error: 'Has creado varias cotizaciones seguidas. Intenta de nuevo en un rato o escríbenos por WhatsApp.' };
  if (await lim(`email = $1 AND creado_en > now() - interval '1 day'`, [datos.cliente.email], 8)) return { status: 429, error: 'Este correo ya tiene varias cotizaciones hoy. Revisa tu bandeja o escríbenos por WhatsApp.' };
  if (await lim(`creado_en > now() - interval '1 day'`, [], 300)) return { status: 429, error: 'Hay demasiadas cotizaciones por ahora. Intenta más tarde.' };

  if (!datos.envio.retiro && (!envioValido(clave, { ...datos.envio }, ahora) || datos.envio.comuna !== datos.direccion.comuna || datos.envio.region !== datos.direccion.region)) {
    return { status: 400, error: 'Las tarifas de envío caducaron o no corresponden a la dirección. Vuelve a elegir el envío.' };
  }

  const variantes = await leerVariantes(gql, datos.items.map(i => i.variante));
  const armado = armarLineas(datos.items, variantes);
  if (armado.error) return { status: 409, error: armado.error };
  const lineas = armado.lineas, productos = totalProductos(lineas);
  const total = productos + datos.envio.precio;

  const doc = await crearDocumentoBsale(bsale, { datos, lineas, ahoraSeg: Math.floor(ahora / 1000) });
  if (doc.error) return { status: 502, error: 'No pudimos generar la cotización. Intenta de nuevo o escríbenos por WhatsApp.', interno: doc };

  const token = generarToken();
  const vence = new Date(ahora + VIGENCIA_DIAS * 86400000);
  const ins = await sql.query(
    `INSERT INTO cotizaciones_web (token, bsale_id, bsale_numero, bsale_url, email, nombre, telefono, rut, razon_social, giro, region, comuna, direccion, metodo_pago, envio_nombre, envio_precio, items, total_productos, total, vid, vence_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [token, doc.id, doc.numero, doc.url, datos.cliente.email, datos.cliente.nombre, datos.cliente.telefono, datos.cliente.rut, datos.cliente.razon_social, datos.cliente.giro,
      datos.direccion.region, datos.direccion.comuna, datos.direccion.calle, datos.metodo_pago, datos.envio.nombre, datos.envio.precio, JSON.stringify(lineas), productos, total, datos.vid, vence.toISOString()],
  );
  const fila = ins.rows[0];

  let correo = { enviado: false };
  try { const m = correoCotizacion(fila, lineas); correo = await enviarCorreo({ para: fila.email, asunto: m.asunto, html: m.html, texto: m.texto }); } catch (e) { correo = { enviado: false, motivo: String(e) }; }
  if (correo && correo.enviado) await sql.query('UPDATE cotizaciones_web SET correo_enviado = true WHERE id = $1', [fila.id]);

  return { status: 200, ok: true, cotizacion: vista(fila, lineas), url: enlaceCotizacion(token), correo_enviado: !!(correo && correo.enviado) };
}

async function buscar(sql, token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token || ''))) return null;
  const { rows } = await sql.query('SELECT * FROM cotizaciones_web WHERE token = $1', [token]);
  return rows[0] || null;
}

export async function verCotizacion(deps, token) {
  const f = await buscar(deps.sql, token);
  if (!f) return { status: 404, error: 'No encontramos esa cotización. Revisa el enlace del correo.' };
  await deps.sql.query('UPDATE cotizaciones_web SET vistas = vistas + 1 WHERE id = $1', [f.id]);
  return { status: 200, ok: true, cotizacion: vista(f), nota: 'No garantiza disponibilidad de stock; se confirma al pagar.' };
}

// Revisa precios y stock y entrega el enlace al carro. Si algún precio cambió, pide confirmar (acepta = true).
export async function comprarCotizacion(deps, token, acepta) {
  const { sql, gql } = deps; const ahora = deps.ahora ? deps.ahora() : Date.now();
  const f = await buscar(sql, token);
  if (!f) return { status: 404, error: 'No encontramos esa cotización.' };
  const estado = estadoEfectivo(f, ahora);
  if (estado === 'vencida') return { status: 410, error: 'Esta cotización venció. Puedes armar una nueva con los mismos productos.', estado };
  if (estado !== 'vigente') return { status: 409, error: 'Esta cotización ya no está vigente.', estado };

  const guardadas = f.items || [];
  const variantes = await leerVariantes(gql, guardadas.map(l => l.variante));
  const armado = armarLineas(guardadas.map(l => ({ variante: l.variante, cantidad: l.cantidad })), variantes);
  if (armado.error) return { status: 409, error: armado.error + ' Escríbenos por WhatsApp y te ayudamos a reemplazarlo.' };
  const cambios = armado.lineas.filter(l => { const antes = guardadas.find(g => g.variante === l.variante); return antes && antes.precio !== l.precio; })
    .map(l => ({ titulo: l.titulo, antes: guardadas.find(g => g.variante === l.variante).precio, ahora: l.precio }));
  if (cambios.length && !acepta) return { status: 200, ok: true, requiere_confirmar: true, cambios, total_nuevo: totalProductos(armado.lineas) + f.envio_precio };

  await sql.query('UPDATE cotizaciones_web SET pago_iniciado_en = now() WHERE id = $1', [f.id]);
  return { status: 200, ok: true, enlace: enlaceCarro(f, armado.lineas), cambios };
}

// ───────────── Clientes que ya compraron o cotizaron: autocompletar con código al correo ─────────────
// Mostrar datos personales solo porque alguien escribió un correo filtraría el RUT, el teléfono y la dirección de otra persona. Por eso se
// manda un código de 6 dígitos al correo y los datos se entregan únicamente a quien lo ingresa. La respuesta al pedir el código es siempre la
// misma, tenga o no historial, para que no sirva para averiguar qué correos son clientes.
export const CODIGO_MINUTOS = 10;
const hashCodigo = (email, codigo) => crypto.createHash('sha256').update(`${email}|${codigo}|${process.env.AUTH_SECRET || ''}`).digest('hex');
const correoValido = e => EMAIL.test(String(e || ''));

function perfilDeCotizacion(f) {
  return { origen: 'cotización anterior', nombre: f.nombre, telefono: f.telefono, rut: f.rut, razon_social: f.razon_social, giro: f.giro, region: f.region, comuna: f.comuna, calle: f.direccion };
}
// Último pedido de Shopify con ese correo (datos de despacho y, si la factura se pidió, los de facturación que dejó en el carro).
async function perfilDePedido(gql, email) {
  const body = await gql(
    `query($q: String!) { orders(first: 1, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { customAttributes { key value } shippingAddress { name phone address1 city province } } } }`,
    { q: `email:'${email}'` },
  );
  const o = ((body && body.data && body.data.orders && body.data.orders.nodes) || [])[0];
  if (!o) return null;
  const a = {}; for (const x of o.customAttributes || []) a[x.key] = x.value;
  const d = o.shippingAddress || {};
  return {
    origen: 'compra anterior', nombre: d.name || '', telefono: a.telefono || d.phone || '', rut: a.rut || '', razon_social: a.razon_social || '', giro: a.giro || '',
    region: a.region || d.province || '', comuna: a.comuna || d.city || '', calle: a.direccion_tributaria || d.address1 || '',
  };
}
export async function buscarPerfil({ sql, gql }, email) {
  const { rows } = await sql.query('SELECT * FROM cotizaciones_web WHERE email = $1 ORDER BY creado_en DESC LIMIT 1', [email]);
  if (rows[0]) return perfilDeCotizacion(rows[0]);
  try { return await perfilDePedido(gql, email); } catch { return null; }
}

export async function solicitarPerfil(deps, cuerpo) {
  const { sql, enviarCorreo } = deps;
  const email = String(cuerpo && cuerpo.email || '').trim().toLowerCase();
  if (!correoValido(email)) return { status: 400, error: 'El correo no es válido.' };
  const respuesta = { status: 200, ok: true, mensaje: `Si tienes compras o cotizaciones anteriores, te enviamos un código de 6 dígitos a ${email}. Vale ${CODIGO_MINUTOS} minutos.` };
  const { rows } = await sql.query(`SELECT count(*)::int AS n FROM cotizaciones_web_codigos WHERE email = $1 AND creado_en > now() - interval '1 hour'`, [email]);
  if (rows[0].n >= 3) return { status: 429, error: 'Ya te enviamos varios códigos. Revisa tu correo (también el spam) o intenta en una hora.' };
  const perfil = await buscarPerfil(deps, email);
  const codigo = perfil ? String(crypto.randomInt(0, 1000000)).padStart(6, '0') : null;
  // Se anota el intento aunque no haya historial (cuenta para el límite por hora); sin historial queda sin código y no se envía nada.
  await sql.query(`INSERT INTO cotizaciones_web_codigos (email, codigo_hash, expira_en) VALUES ($1, $2, now() + make_interval(mins => $3))`, [email, codigo ? hashCodigo(email, codigo) : 'sin-codigo', CODIGO_MINUTOS]);
  if (!perfil) return respuesta;
  try {
    await enviarCorreo({
      para: email, asunto: `Tu código IndexStore: ${codigo}`,
      texto: `Tu código para autocompletar tus datos en la cotización es ${codigo}. Vale ${CODIGO_MINUTOS} minutos. Si no lo pediste, ignora este correo.`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#111827"><p>Tu código para autocompletar tus datos en la cotización:</p><p style="font-size:30px;letter-spacing:6px;font-weight:bold;margin:8px 0">${codigo}</p><p style="color:#6b7280;font-size:13px">Vale ${CODIGO_MINUTOS} minutos. Si no lo pediste, ignora este correo.</p></div>`,
    });
  } catch {}
  return respuesta;
}

export async function verificarPerfil(deps, cuerpo) {
  const { sql } = deps;
  const email = String(cuerpo && cuerpo.email || '').trim().toLowerCase();
  const codigo = String(cuerpo && cuerpo.codigo || '').replace(/\D/g, '');
  if (!correoValido(email) || codigo.length !== 6) return { status: 400, error: 'Ingresa el código de 6 dígitos que te enviamos.' };
  const { rows } = await sql.query(`SELECT * FROM cotizaciones_web_codigos WHERE email = $1 AND usado = false AND expira_en > now() AND codigo_hash <> 'sin-codigo' ORDER BY id DESC LIMIT 1`, [email]);
  const f = rows[0];
  if (!f || f.intentos >= 5) return { status: 400, error: 'El código venció o ya no es válido. Pide uno nuevo.' };
  if (hashCodigo(email, codigo) !== f.codigo_hash) {
    await sql.query('UPDATE cotizaciones_web_codigos SET intentos = intentos + 1 WHERE id = $1', [f.id]);
    return { status: 400, error: 'El código no es correcto.' };
  }
  await sql.query('UPDATE cotizaciones_web_codigos SET usado = true WHERE id = $1', [f.id]);
  const perfil = await buscarPerfil(deps, email);
  if (!perfil) return { status: 404, error: 'No encontramos datos anteriores para completar.' };
  return { status: 200, ok: true, perfil };
}

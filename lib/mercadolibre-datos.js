// /lib/mercadolibre-datos.js
// ══════════════════════════════════════════════════════════════════════
// Datos y métricas de Mercado Libre (SOLO LECTURA) -- ver lib/mercadolibre.js para la conexión.
// ══════════════════════════════════════════════════════════════════════
// Qué se mide (pedido del usuario):
//   1) Embudo por publicación: visitas -> órdenes -> conversión.
//   2) Margen real: ingreso - comisión - costo de envío del vendedor - costo de Bsale.
//   3) Reputación: nivel y tasas de reclamos / cancelaciones / demoras.
//   4) Atención: preguntas, tiempo de respuesta y preguntas que no terminan en venta.
//   5) Publicidad (Product Ads): gasto vs ventas (ACOS / ROAS), si la cuenta la tiene.
//   6) Stock: publicado en Mercado Libre vs stock de Bsale.
//   7) Canal: ventas por SKU en Mercado Libre vs lo vendido según Bsale.
//
// Cómo se obtienen: una "sincronización" por pasos (items, visitas, ordenes, envios, preguntas, reputacion, publicidad, costos). Cada
// paso trabaja un rato acotado (cabe en una función de Vercel), guarda hasta dónde llegó (tabla ml_sync) y se puede repetir hasta
// terminar: así se ve el avance en % y se puede retomar si se corta. Las métricas se calculan después SOLO desde las tablas
// guardadas (nada de esto llama a Mercado Libre al mostrar la página).
//
// Importante: los nombres de campo de la API están tomados de su documentación pública, pero esta parte se escribió sin poder
// llamar a la cuenta real. Cada lectura es defensiva (si un dato no viene, queda vacío y se informa) y la página muestra el
// error de cada paso, para ajustar al primer uso real. No se guardan datos personales de compradores (ni nombres ni textos).

export const VENTANA_DIAS = 30;      // período de las métricas de embudo, margen, atención y canal
export const HISTORIA_DIAS = 90;     // cuánto se trae de órdenes y preguntas
export const PASOS = ['items', 'visitas', 'ordenes', 'envios', 'preguntas', 'reputacion', 'publicidad', 'costos'];
export const ETIQUETA_PASO = {
  items: 'Publicaciones', visitas: 'Visitas', ordenes: 'Órdenes', envios: 'Costos de envío', preguntas: 'Preguntas',
  reputacion: 'Reputación', publicidad: 'Publicidad', costos: 'Costos de Bsale',
};
// En la API de órdenes "sale_fee" es la comisión de cada unidad de la línea; se multiplica por la cantidad.
// Se confirma al primer uso comparando con el panel de Mercado Libre.
const COMISION_ES_POR_UNIDAD = true;
const UMBRAL_TRAFICO_SIN_VENTAS = 30;   // visitas sin ninguna orden en la ventana
const UMBRAL_CONVERSION_BAJA = { visitas: 100, tasa: 0.005 };
const UMBRAL_PREGUNTAS_SIN_VENTA = 3;
const MARGEN_BAJO = 0.10;

const DIA_MS = 24 * 3600 * 1000;
const iso = d => new Date(d).toISOString();
const dia = d => iso(d).slice(0, 10);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const quitarNulos = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export async function asegurarTablasMLDatos(sql) {
  await sql`CREATE TABLE IF NOT EXISTS ml_items (
    item_id TEXT PRIMARY KEY, sku TEXT, titulo TEXT, precio NUMERIC, stock_ml INTEGER, vendidas_total INTEGER, estado TEXT,
    tipo_publicacion TEXT, permalink TEXT, categoria_id TEXT, salud NUMERIC, creada TIMESTAMPTZ, visto_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  await sql`CREATE TABLE IF NOT EXISTS ml_visitas (
    item_id TEXT NOT NULL, dias INTEGER NOT NULL, visitas INTEGER NOT NULL DEFAULT 0, actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (item_id, dias));`;
  await sql`ALTER TABLE ml_visitas ALTER COLUMN visitas DROP NOT NULL;`;
  await sql`CREATE TABLE IF NOT EXISTS ml_ordenes (
    orden_id TEXT PRIMARY KEY, fecha TIMESTAMPTZ, estado TEXT, total NUMERIC, envio_id TEXT,
    costo_envio_vendedor NUMERIC, envio_consultado BOOLEAN NOT NULL DEFAULT false);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ml_ordenes_fecha ON ml_ordenes (fecha);`;
  await sql`CREATE TABLE IF NOT EXISTS ml_orden_items (
    orden_id TEXT NOT NULL, item_id TEXT NOT NULL, sku TEXT, titulo TEXT, cantidad INTEGER NOT NULL DEFAULT 1,
    precio_unit NUMERIC, comision NUMERIC, PRIMARY KEY (orden_id, item_id));`;
  await sql`CREATE TABLE IF NOT EXISTS ml_preguntas (
    pregunta_id TEXT PRIMARY KEY, item_id TEXT, creada TIMESTAMPTZ, respondida TIMESTAMPTZ, estado TEXT);`;
  await sql`CREATE TABLE IF NOT EXISTS ml_reputacion (fecha DATE PRIMARY KEY, datos JSONB NOT NULL);`;
  await sql`CREATE TABLE IF NOT EXISTS ml_publicidad (id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), calculado_en TIMESTAMPTZ NOT NULL DEFAULT now(), datos JSONB NOT NULL);`;
  await sql`CREATE TABLE IF NOT EXISTS ml_costos_sku (sku TEXT PRIMARY KEY, costo NUMERIC, origen TEXT, motivo TEXT, actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
  await sql`CREATE TABLE IF NOT EXISTS ml_sync (
    paso TEXT PRIMARY KEY, cursor JSONB, total INTEGER, hechos INTEGER NOT NULL DEFAULT 0, terminado BOOLEAN NOT NULL DEFAULT false,
    error TEXT, actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now());`;
}

// ---------------------------------------------------------------- estado de la sincronización
async function leerPaso(sql, paso) {
  const { rows } = await sql`SELECT paso, cursor, total, hechos, terminado, error, actualizado_en FROM ml_sync WHERE paso = ${paso};`;
  return rows[0] || null;
}
async function guardarPaso(sql, paso, { cursor, total, hechos, terminado, error }) {
  await sql`
    INSERT INTO ml_sync (paso, cursor, total, hechos, terminado, error, actualizado_en)
    VALUES (${paso}, ${JSON.stringify(cursor || {})}::jsonb, ${total ?? null}, ${hechos || 0}, ${Boolean(terminado)}, ${error || null}, now())
    ON CONFLICT (paso) DO UPDATE SET cursor = EXCLUDED.cursor, total = EXCLUDED.total, hechos = EXCLUDED.hechos,
      terminado = EXCLUDED.terminado, error = EXCLUDED.error, actualizado_en = now();`;
}
// Empieza una vuelta nueva: todos los pasos vuelven a cero y se anota cuándo empezó (para saber qué datos son de esta vuelta).
export async function reiniciarSync(sql, ahora = Date.now()) {
  await sql`DELETE FROM ml_sync;`;
  await guardarPaso(sql, '_vuelta', { cursor: { inicio: iso(ahora) }, hechos: 0, terminado: false });
}
async function inicioVuelta(sql, ahora) {
  const p = await leerPaso(sql, '_vuelta');
  if (p && p.cursor && p.cursor.inicio) return p.cursor.inicio;
  await guardarPaso(sql, '_vuelta', { cursor: { inicio: iso(ahora) }, hechos: 0, terminado: false });
  return iso(ahora);
}
export async function estadoSync(sql) {
  const { rows } = await sql`SELECT paso, total, hechos, terminado, error, actualizado_en FROM ml_sync WHERE paso <> '_vuelta';`;
  const porPaso = Object.fromEntries(rows.map(r => [r.paso, r]));
  const v = await leerPaso(sql, '_vuelta');
  const pasos = PASOS.map(p => {
    const r = porPaso[p];
    const total = r && r.total != null ? Number(r.total) : null;
    const hechos = r ? Number(r.hechos) : 0;
    const pct = !r ? 0 : r.terminado ? 100 : (total ? Math.min(99, Math.round(hechos / total * 100)) : null);
    return { paso: p, etiqueta: ETIQUETA_PASO[p], terminado: Boolean(r && r.terminado), total, hechos, porcentaje: pct, error: r ? r.error : null, actualizadoEn: r ? r.actualizado_en : null };
  });
  const terminados = pasos.filter(p => p.terminado).length;
  return { inicio: v && v.cursor ? v.cursor.inicio : null, pasos, completo: terminados === PASOS.length, porcentaje: Math.round(pasos.reduce((a, p) => a + (p.porcentaje ?? 0), 0) / PASOS.length) };
}
// Primer paso pendiente (para que la página o el cron sepan cuál toca).
export async function siguientePaso(sql) {
  const e = await estadoSync(sql);
  return e.pasos.find(p => !p.terminado)?.paso || null;
}

// ---------------------------------------------------------------- normalización de lo que devuelve la API
export function normalizarItem(b) {
  if (!b || !b.id) return null;
  const attr = Array.isArray(b.attributes) ? b.attributes.find(a => a && a.id === 'SELLER_SKU') : null;
  const sku = String(b.seller_custom_field || (attr && (attr.value_name || attr.value)) || '').trim() || null;
  return {
    item_id: String(b.id), sku, titulo: b.title || null, precio: num(b.price), stock_ml: num(b.available_quantity), vendidas_total: num(b.sold_quantity),
    estado: b.status || null, tipo_publicacion: b.listing_type_id || null, permalink: b.permalink || null, categoria_id: b.category_id || null,
    salud: num(b.health), creada: b.date_created || null,
  };
}
export function normalizarOrden(o) {
  if (!o || o.id == null) return null;
  return {
    orden_id: String(o.id), fecha: o.date_created || null, estado: o.status || null, total: num(o.total_amount ?? o.paid_amount),
    envio_id: o.shipping && o.shipping.id != null ? String(o.shipping.id) : null,
    items: (o.order_items || []).map(oi => ({
      item_id: oi.item && oi.item.id != null ? String(oi.item.id) : null,
      sku: String((oi.item && (oi.item.seller_sku || oi.item.seller_custom_field)) || '').trim() || null,
      titulo: (oi.item && oi.item.title) || null, cantidad: num(oi.quantity) || 1, precio_unit: num(oi.unit_price), comision: num(oi.sale_fee),
    })).filter(i => i.item_id),
  };
}
export function normalizarPregunta(q) {
  if (!q || q.id == null) return null;
  const resp = q.answer && q.answer.date_created ? q.answer.date_created : null;
  return { pregunta_id: String(q.id), item_id: q.item_id != null ? String(q.item_id) : null, creada: q.date_created || null, respondida: resp, estado: q.status || null };
}
// La respuesta de visitas puede venir como lista de {item_id,total_visits}, como objeto por id o como un solo objeto.
export function normalizarVisitas(resp, ids) {
  const out = {};
  const poner = (id, v) => { if (id != null && ids.includes(String(id))) { const n = num(typeof v === 'object' && v ? (v.total_visits ?? v.visits ?? v.total) : v); if (n != null) out[String(id)] = n; } };
  if (Array.isArray(resp)) resp.forEach(r => r && poner(r.item_id ?? r.id, r));
  else if (resp && typeof resp === 'object') {
    if (resp.item_id != null) poner(resp.item_id, resp);
    else Object.entries(resp).forEach(([k, v]) => poner(k, v));
  }
  return out;
}
export function normalizarEnvio(c) {
  if (!c || typeof c !== 'object') return null;
  const senders = Array.isArray(c.senders) ? c.senders : [];
  const suma = senders.reduce((a, s) => a + (num(s && s.cost) || 0), 0);
  return senders.length ? suma : (num(c.sender_cost) ?? null);
}
export function normalizarReputacion(user) {
  const r = (user && user.seller_reputation) || {};
  const m = r.metrics || {};
  const tasa = x => (x && x.rate != null ? num(x.rate) : null);
  const t = r.transactions || {};
  const rat = t.ratings || {};
  return {
    nickname: (user && user.nickname) || null, nivel: r.level_id || null, estadoLider: r.power_seller_status || null,
    transacciones: { total: num(t.total), completadas: num(t.completed), canceladas: num(t.canceled), periodo: t.period || null },
    calificaciones: { positivas: num(rat.positive), neutras: num(rat.neutral), negativas: num(rat.negative) },
    reclamos: tasa(m.claims), cancelaciones: tasa(m.cancellations), demoras: tasa(m.delayed_handling_time),
    ventasPeriodo: m.sales ? { completadas: num(m.sales.completed), periodo: m.sales.period || null } : null,
  };
}

// ---------------------------------------------------------------- pasos de la sincronización
// ctx = { leer(ruta, {headers}) -> JSON, userId, ahora(), costosBsale?(skus) -> {costos, motivos} }.
const queryEnc = encodeURIComponent;
const sinTiempo = (t0, limiteMs, ahora) => ahora() - t0 >= limiteMs;
const esRechazo = e => e && (e.status === 400 || e.status === 403 || e.status === 404);

async function pasoItems(sql, ctx, limiteMs) {
  const t0 = ctx.ahora();
  const inicio = await inicioVuelta(sql, t0);
  const est = (await leerPaso(sql, 'items')) || { cursor: { scroll: null }, total: null, hechos: 0 };
  let scroll = (est.cursor && est.cursor.scroll) || null, total = est.total, hechos = est.hechos, terminado = false;
  while (!sinTiempo(t0, limiteMs, ctx.ahora)) {
    const r = await ctx.leer(`/users/${queryEnc(ctx.userId)}/items/search?status=active&search_type=scan&limit=100${scroll ? '&scroll_id=' + queryEnc(scroll) : ''}`);
    const ids = (r && r.results) || [];
    if (r && r.paging && r.paging.total != null) total = r.paging.total;
    if (!ids.length) { terminado = true; break; }
    for (let i = 0; i < ids.length; i += 20) {
      const lote = ids.slice(i, i + 20);
      const resp = await ctx.leer(`/items?ids=${lote.map(queryEnc).join(',')}&attributes=id,title,price,available_quantity,sold_quantity,status,seller_custom_field,attributes,permalink,listing_type_id,category_id,health,date_created`);
      for (const e of Array.isArray(resp) ? resp : []) {
        const it = e && (e.code == null || e.code === 200) ? normalizarItem(e.body || e) : null;
        if (!it) continue;
        await sql`
          INSERT INTO ml_items (item_id, sku, titulo, precio, stock_ml, vendidas_total, estado, tipo_publicacion, permalink, categoria_id, salud, creada, visto_en)
          VALUES (${it.item_id}, ${it.sku}, ${it.titulo}, ${it.precio}, ${it.stock_ml}, ${it.vendidas_total}, ${it.estado}, ${it.tipo_publicacion}, ${it.permalink}, ${it.categoria_id}, ${it.salud}, ${it.creada}, now())
          ON CONFLICT (item_id) DO UPDATE SET sku = EXCLUDED.sku, titulo = EXCLUDED.titulo, precio = EXCLUDED.precio, stock_ml = EXCLUDED.stock_ml,
            vendidas_total = EXCLUDED.vendidas_total, estado = EXCLUDED.estado, tipo_publicacion = EXCLUDED.tipo_publicacion, permalink = EXCLUDED.permalink,
            categoria_id = EXCLUDED.categoria_id, salud = EXCLUDED.salud, creada = EXCLUDED.creada, visto_en = now();`;
      }
    }
    hechos += ids.length;
    scroll = (r && r.scroll_id) || scroll;
    await guardarPaso(sql, 'items', { cursor: { scroll }, total, hechos, terminado: false });
  }
  if (terminado) {
    // las publicaciones que ya no aparecieron como activas en esta vuelta se marcan aparte (no se borran: tienen órdenes asociadas)
    await sql`UPDATE ml_items SET estado = 'no_activa' WHERE visto_en < ${inicio}::timestamptz AND estado = 'active';`;
    await guardarPaso(sql, 'items', { cursor: { scroll: null }, total: total ?? hechos, hechos: total ?? hechos, terminado: true });
  }
  return { terminado };
}

async function pasoVisitas(sql, ctx, limiteMs) {
  const t0 = ctx.ahora();
  const inicio = await inicioVuelta(sql, t0);
  // Mercado Libre rechaza las fechas con hora ("unknown date format"): acepta solo AAAA-MM-DD (confirmado con la cuenta real). Termina ayer.
  const desde = dia(t0 - VENTANA_DIAS * DIA_MS), hasta = dia(t0 - DIA_MS);
  const est = (await leerPaso(sql, 'visitas')) || { cursor: {} };
  let omitirBloque = Boolean(est.cursor && est.cursor.sinBloque);
  const { rows: [tot] } = await sql`SELECT count(*)::int AS n FROM ml_items WHERE estado = 'active';`;
  let terminado = false;
  while (!sinTiempo(t0, limiteMs, ctx.ahora)) {
    const { rows } = await sql`
      SELECT i.item_id FROM ml_items i WHERE i.estado = 'active'
        AND NOT EXISTS (SELECT 1 FROM ml_visitas v WHERE v.item_id = i.item_id AND v.dias = ${VENTANA_DIAS} AND v.actualizado_en >= ${inicio}::timestamptz)
      ORDER BY i.item_id LIMIT 20;`;
    if (!rows.length) { terminado = true; break; }
    const ids = rows.map(r => r.item_id);
    let visitas = {}, ultimoError = null;
    if (!omitirBloque) {
      try {
        visitas = normalizarVisitas(await ctx.leer(`/items/visits?ids=${ids.join(',')}&date_from=${queryEnc(desde)}&date_to=${queryEnc(hasta)}`), ids);
      } catch (e) {
        if (!esRechazo(e)) throw e;
        ultimoError = e;
      }
      if (!Object.keys(visitas).length) omitirBloque = true; // no se vuelve a intentar en cada tramo
    }
    if (!Object.keys(visitas).length) {
      // de a una publicación: primero la ventana de días (es la forma que responde bien), luego el rango de fechas
      for (let k = 0; k < ids.length; k += 5) {
        await Promise.all(ids.slice(k, k + 5).map(async id => {
          for (const ruta of [`/items/${queryEnc(id)}/visits/time_window?last=${VENTANA_DIAS}&unit=day`, `/items/${queryEnc(id)}/visits?date_from=${queryEnc(desde)}&date_to=${queryEnc(hasta)}`]) {
            try {
              const v = normalizarVisitas(await ctx.leer(ruta), [id]);
              if (v[id] != null) { visitas[id] = v[id]; return; }
              ultimoError = new Error('Mercado Libre respondió sin visitas reconocibles en ' + ruta.split('?')[0]);
            } catch (e2) { if (!esRechazo(e2)) throw e2; ultimoError = e2; }
          }
        }));
      }
    }
    // Sin ningún dato no se guarda nada (antes quedaban ceros que parecían reales): el paso muestra el error de Mercado Libre.
    if (!Object.keys(visitas).length) throw ultimoError || new Error('Mercado Libre no entregó visitas');
    for (const id of ids) {
      await sql`INSERT INTO ml_visitas (item_id, dias, visitas, actualizado_en) VALUES (${id}, ${VENTANA_DIAS}, ${visitas[id] ?? null}, now())
        ON CONFLICT (item_id, dias) DO UPDATE SET visitas = EXCLUDED.visitas, actualizado_en = now();`;
    }
    const { rows: [pend] } = await sql`
      SELECT count(*)::int AS n FROM ml_items i WHERE i.estado = 'active'
        AND NOT EXISTS (SELECT 1 FROM ml_visitas v WHERE v.item_id = i.item_id AND v.dias = ${VENTANA_DIAS} AND v.actualizado_en >= ${inicio}::timestamptz);`;
    await guardarPaso(sql, 'visitas', { cursor: { sinBloque: omitirBloque }, total: tot.n, hechos: tot.n - pend.n, terminado: false });
  }
  if (terminado) await guardarPaso(sql, 'visitas', { cursor: { sinBloque: omitirBloque }, total: tot.n, hechos: tot.n, terminado: true });
  return { terminado };
}

async function pasoOrdenes(sql, ctx, limiteMs) {
  const t0 = ctx.ahora();
  const est = (await leerPaso(sql, 'ordenes')) || { cursor: { offset: 0 }, total: null, hechos: 0 };
  let offset = (est.cursor && est.cursor.offset) || 0, total = est.total, terminado = false;
  const desde = iso(t0 - HISTORIA_DIAS * DIA_MS), hasta = iso(t0);
  while (!sinTiempo(t0, limiteMs, ctx.ahora)) {
    const r = await ctx.leer(`/orders/search?seller=${queryEnc(ctx.userId)}&order.date_created.from=${queryEnc(desde)}&order.date_created.to=${queryEnc(hasta)}&sort=date_desc&limit=50&offset=${offset}`);
    const lista = (r && r.results) || [];
    if (r && r.paging && r.paging.total != null) total = r.paging.total;
    for (const o of lista) {
      const n = normalizarOrden(o);
      if (!n) continue;
      await sql`
        INSERT INTO ml_ordenes (orden_id, fecha, estado, total, envio_id) VALUES (${n.orden_id}, ${n.fecha}, ${n.estado}, ${n.total}, ${n.envio_id})
        ON CONFLICT (orden_id) DO UPDATE SET fecha = EXCLUDED.fecha, estado = EXCLUDED.estado, total = EXCLUDED.total, envio_id = EXCLUDED.envio_id;`;
      for (const it of n.items) {
        await sql`
          INSERT INTO ml_orden_items (orden_id, item_id, sku, titulo, cantidad, precio_unit, comision)
          VALUES (${n.orden_id}, ${it.item_id}, ${it.sku}, ${it.titulo}, ${it.cantidad}, ${it.precio_unit}, ${it.comision})
          ON CONFLICT (orden_id, item_id) DO UPDATE SET sku = EXCLUDED.sku, titulo = EXCLUDED.titulo, cantidad = EXCLUDED.cantidad,
            precio_unit = EXCLUDED.precio_unit, comision = EXCLUDED.comision;`;
      }
    }
    offset += lista.length;
    if (!lista.length || (total != null && offset >= total)) { terminado = true; break; }
    await guardarPaso(sql, 'ordenes', { cursor: { offset }, total, hechos: offset, terminado: false });
  }
  if (terminado) await guardarPaso(sql, 'ordenes', { cursor: { offset }, total: total ?? offset, hechos: total ?? offset, terminado: true });
  return { terminado };
}

async function pasoEnvios(sql, ctx, limiteMs) {
  const t0 = ctx.ahora();
  const { rows: [tot] } = await sql`SELECT count(*)::int AS n FROM ml_ordenes WHERE envio_id IS NOT NULL AND estado = 'paid';`;
  let terminado = false;
  while (!sinTiempo(t0, limiteMs, ctx.ahora)) {
    const { rows } = await sql`SELECT orden_id, envio_id FROM ml_ordenes WHERE envio_id IS NOT NULL AND estado = 'paid' AND NOT envio_consultado ORDER BY fecha DESC LIMIT 15;`;
    if (!rows.length) { terminado = true; break; }
    await Promise.all(rows.map(async o => {
      let costo = null;
      try { costo = normalizarEnvio(await ctx.leer(`/shipments/${queryEnc(o.envio_id)}/costs`)); } catch (e) { if (!esRechazo(e)) throw e; }
      await sql`UPDATE ml_ordenes SET costo_envio_vendedor = ${costo}, envio_consultado = true WHERE orden_id = ${o.orden_id};`;
    }));
    const { rows: [pend] } = await sql`SELECT count(*)::int AS n FROM ml_ordenes WHERE envio_id IS NOT NULL AND estado = 'paid' AND NOT envio_consultado;`;
    await guardarPaso(sql, 'envios', { cursor: {}, total: tot.n, hechos: tot.n - pend.n, terminado: false });
  }
  if (terminado) await guardarPaso(sql, 'envios', { cursor: {}, total: tot.n, hechos: tot.n, terminado: true });
  return { terminado };
}

async function pasoPreguntas(sql, ctx, limiteMs) {
  const t0 = ctx.ahora();
  const est = (await leerPaso(sql, 'preguntas')) || { cursor: { offset: 0 }, total: null, hechos: 0 };
  let offset = (est.cursor && est.cursor.offset) || 0, total = est.total, terminado = false;
  const corte = t0 - HISTORIA_DIAS * DIA_MS;
  while (!sinTiempo(t0, limiteMs, ctx.ahora)) {
    const r = await ctx.leer(`/questions/search?seller_id=${queryEnc(ctx.userId)}&sort_fields=date_created&sort_types=DESC&limit=50&offset=${offset}&api_version=4`);
    const lista = (r && r.questions) || [];
    if (r && r.total != null) total = r.total;
    let hayViejas = false;
    for (const q of lista) {
      const n = normalizarPregunta(q);
      if (!n) continue;
      if (n.creada && new Date(n.creada).getTime() < corte) { hayViejas = true; continue; }
      await sql`
        INSERT INTO ml_preguntas (pregunta_id, item_id, creada, respondida, estado) VALUES (${n.pregunta_id}, ${n.item_id}, ${n.creada}, ${n.respondida}, ${n.estado})
        ON CONFLICT (pregunta_id) DO UPDATE SET respondida = EXCLUDED.respondida, estado = EXCLUDED.estado;`;
    }
    offset += lista.length;
    if (!lista.length || hayViejas || (total != null && offset >= total)) { terminado = true; break; }
    await guardarPaso(sql, 'preguntas', { cursor: { offset }, total, hechos: offset, terminado: false });
  }
  if (terminado) await guardarPaso(sql, 'preguntas', { cursor: { offset }, total: offset, hechos: offset, terminado: true });
  return { terminado };
}

async function pasoReputacion(sql, ctx) {
  const user = await ctx.leer(`/users/${queryEnc(ctx.userId)}`);
  const datos = normalizarReputacion(user);
  await sql`INSERT INTO ml_reputacion (fecha, datos) VALUES (${dia(ctx.ahora())}::date, ${JSON.stringify(datos)}::jsonb)
    ON CONFLICT (fecha) DO UPDATE SET datos = EXCLUDED.datos;`;
  await guardarPaso(sql, 'reputacion', { cursor: {}, total: 1, hechos: 1, terminado: true });
  return { terminado: true };
}

// Product Ads: solo si la cuenta lo tiene y el permiso lo deja. Si no, se guarda el motivo y el paso se da por terminado.
async function pasoPublicidad(sql, ctx) {
  const t0 = ctx.ahora();
  const desde = dia(t0 - VENTANA_DIAS * DIA_MS), hasta = dia(t0);
  let datos;
  try {
    const adv = await ctx.leer('/advertising/advertisers?product_id=PADS', { headers: { 'api-version': '1' } });
    const lista = (adv && (adv.advertisers || adv.results)) || (Array.isArray(adv) ? adv : []);
    const a = lista.find(x => !x.site_id || x.site_id === 'MLC') || lista[0];
    if (!a || !(a.advertiser_id ?? a.id)) {
      datos = { disponible: false, motivo: 'La cuenta no tiene un anunciante de Product Ads' };
    } else {
      const advId = a.advertiser_id ?? a.id, sitio = a.site_id || 'MLC';
      const metricas = 'clicks,prints,cost,acos,roas,total_amount,units_quantity';
      const c = await ctx.leer(`/advertising/${queryEnc(sitio)}/advertisers/${queryEnc(advId)}/product_ads/campaigns/search?limit=50&offset=0&date_from=${desde}&date_to=${hasta}&metrics=${metricas}`, { headers: { 'api-version': '2' } });
      const campañas = ((c && (c.results || c.campaigns)) || []).map(x => ({
        id: x.id ?? x.campaign_id ?? null, nombre: x.name || x.campaign_name || null, estado: x.status || null,
        metricas: quitarNulos({ costo: num((x.metrics || x).cost), ventas: num((x.metrics || x).total_amount), clics: num((x.metrics || x).clicks), impresiones: num((x.metrics || x).prints), acos: num((x.metrics || x).acos), roas: num((x.metrics || x).roas), unidades: num((x.metrics || x).units_quantity) }),
      }));
      datos = { disponible: true, desde, hasta, anunciante: String(advId), campañas };
    }
  } catch (e) {
    if (!esRechazo(e)) throw e;
    datos = { disponible: false, motivo: 'Mercado Libre no entrega datos de publicidad para esta cuenta (' + String(e.message).slice(0, 120) + ')' };
  }
  await sql`INSERT INTO ml_publicidad (id, calculado_en, datos) VALUES (1, now(), ${JSON.stringify(datos)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET calculado_en = now(), datos = EXCLUDED.datos;`;
  await guardarPaso(sql, 'publicidad', { cursor: {}, total: 1, hechos: 1, terminado: true });
  return { terminado: true };
}

// Costo de Bsale por SKU de lo que se vendió en Mercado Libre (con respaldo en la tabla para no repetir consultas cada vez).
async function pasoCostos(sql, ctx, limiteMs) {
  const t0 = ctx.ahora();
  const inicio = await inicioVuelta(sql, t0);
  const desde = iso(t0 - HISTORIA_DIAS * DIA_MS);
  const pendientes = async () => (await sql`
    SELECT DISTINCT oi.sku FROM ml_orden_items oi JOIN ml_ordenes o ON o.orden_id = oi.orden_id
    WHERE oi.sku IS NOT NULL AND o.fecha >= ${desde}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM ml_costos_sku c WHERE c.sku = oi.sku AND c.actualizado_en >= ${inicio}::timestamptz)
    ORDER BY oi.sku;`).rows.map(r => r.sku);
  const { rows: [tot] } = await sql`SELECT count(DISTINCT oi.sku)::int AS n FROM ml_orden_items oi JOIN ml_ordenes o ON o.orden_id = oi.orden_id WHERE oi.sku IS NOT NULL AND o.fecha >= ${desde}::timestamptz;`;
  let terminado = false;
  while (!sinTiempo(t0, limiteMs, ctx.ahora)) {
    const lista = (await pendientes()).slice(0, 20);
    if (!lista.length) { terminado = true; break; }
    let res = { costos: {}, motivos: {} };
    if (ctx.costosBsale) res = await ctx.costosBsale(lista);
    else lista.forEach(s => { res.motivos[s] = 'Sin conexión con Bsale'; });
    for (const sku of lista) {
      const c = res.costos[sku];
      await sql`INSERT INTO ml_costos_sku (sku, costo, origen, motivo, actualizado_en) VALUES (${sku}, ${c ? c.costo : null}, ${c ? c.origen : null}, ${c ? null : (res.motivos[sku] || 'Sin dato')}, now())
        ON CONFLICT (sku) DO UPDATE SET costo = EXCLUDED.costo, origen = EXCLUDED.origen, motivo = EXCLUDED.motivo, actualizado_en = now();`;
    }
    const resto = (await pendientes()).length;
    await guardarPaso(sql, 'costos', { cursor: {}, total: tot.n, hechos: tot.n - resto, terminado: false });
  }
  if (terminado) await guardarPaso(sql, 'costos', { cursor: {}, total: tot.n, hechos: tot.n, terminado: true });
  return { terminado };
}

// Ejecuta un paso (o continúa donde quedó). Un error se guarda en el paso y se devuelve: la página lo muestra sin perder lo avanzado.
export async function ejecutarPaso(sql, ctx, paso, { limiteMs = 40000 } = {}) {
  const fn = { items: pasoItems, visitas: pasoVisitas, ordenes: pasoOrdenes, envios: pasoEnvios, preguntas: pasoPreguntas, reputacion: pasoReputacion, publicidad: pasoPublicidad, costos: pasoCostos }[paso];
  if (!fn) throw new Error('Paso desconocido: ' + paso);
  try {
    await fn(sql, ctx, limiteMs);
    const actual = await leerPaso(sql, paso);
    if (actual && actual.error) await sql`UPDATE ml_sync SET error = NULL WHERE paso = ${paso};`;
  } catch (e) {
    const previo = (await leerPaso(sql, paso)) || { cursor: {}, total: null, hechos: 0 };
    await guardarPaso(sql, paso, { cursor: previo.cursor, total: previo.total, hechos: previo.hechos, terminado: false, error: String(e.message || e).slice(0, 300) });
  }
  return (await estadoSync(sql)).pasos.find(p => p.paso === paso);
}

// ---------------------------------------------------------------- métricas (solo desde lo guardado)
const redondear = (v, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const mediana = lista => { if (!lista.length) return null; const s = [...lista].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Entradas externas (opcionales): stockBsale = { SKU: unidades } | null; ventasBsale = [{ sku, unidades, monto }] (mismo período).
export async function calcularMetricasML(sql, { stockBsale = null, ventasBsale = null, ahora = Date.now() } = {}) {
  const desde = iso(ahora - VENTANA_DIAS * DIA_MS);
  const { rows: items } = await sql`SELECT item_id, sku, titulo, precio, stock_ml, vendidas_total, estado, permalink FROM ml_items;`;
  const { rows: visitasRows } = await sql`SELECT item_id, visitas FROM ml_visitas WHERE dias = ${VENTANA_DIAS};`;
  const { rows: lineas } = await sql`
    SELECT o.orden_id, o.total, o.costo_envio_vendedor AS envio, o.envio_consultado, oi.item_id, oi.sku, oi.titulo, oi.cantidad, oi.precio_unit, oi.comision
    FROM ml_orden_items oi JOIN ml_ordenes o ON o.orden_id = oi.orden_id
    WHERE o.estado = 'paid' AND o.fecha >= ${desde}::timestamptz;`;
  const { rows: costosRows } = await sql`SELECT sku, costo, origen, motivo FROM ml_costos_sku;`;
  const { rows: preguntas } = await sql`SELECT pregunta_id, item_id, creada, respondida, estado FROM ml_preguntas WHERE creada >= ${desde}::timestamptz;`;
  const { rows: repRows } = await sql`SELECT fecha::text AS fecha, datos FROM ml_reputacion ORDER BY fecha DESC LIMIT 30;`;
  const { rows: pubRows } = await sql`SELECT calculado_en, datos FROM ml_publicidad WHERE id = 1;`;
  const { rows: [{ n: ordenesTotal }] } = await sql`SELECT count(*)::int AS n FROM ml_ordenes;`;

  const costos = Object.fromEntries(costosRows.map(c => [c.sku, c]));
  const activos = items.filter(i => i.estado === 'active');
  const visitasPorItem = Object.fromEntries(visitasRows.map(v => [v.item_id, v.visitas == null ? null : Number(v.visitas)]));
  const itemPorId = Object.fromEntries(items.map(i => [i.item_id, i]));

  // ---- ventas de la ventana, por publicación (cada línea de orden: ingreso, comisión, parte del envío y costo de Bsale)
  const totalOrden = {};
  for (const l of lineas) totalOrden[l.orden_id] = (totalOrden[l.orden_id] || 0) + (Number(l.cantidad) || 0) * (Number(l.precio_unit) || 0);
  const ventas = {};
  const ordenesPorItem = {};
  for (const l of lineas) {
    const v = ventas[l.item_id] || (ventas[l.item_id] = { unidades: 0, ingresos: 0, comision: 0, envio: 0, costo: 0, costoConocido: 0, ingresoConCosto: 0, margen: 0, ordenes: new Set(), sinEnvio: 0 });
    const cant = Number(l.cantidad) || 0, precio = Number(l.precio_unit) || 0, ingreso = cant * precio;
    const comision = (Number(l.comision) || 0) * (COMISION_ES_POR_UNIDAD ? cant : 1);
    // el envío es por orden: se reparte entre sus líneas según lo que aportó cada una
    const tieneEnvio = l.envio_consultado && l.envio != null;
    const envio = tieneEnvio && totalOrden[l.orden_id] > 0 ? Number(l.envio) * ingreso / totalOrden[l.orden_id] : 0;
    v.unidades += cant; v.ingresos += ingreso; v.comision += comision; v.envio += envio; v.ordenes.add(l.orden_id);
    if (!tieneEnvio) v.sinEnvio += 1;
    const c = l.sku ? costos[l.sku] : null;
    if (c && c.costo != null) {
      const costo = Number(c.costo) * cant;
      v.costo += costo; v.costoConocido += cant; v.ingresoConCosto += ingreso; v.margen += ingreso - comision - envio - costo;
    }
    (ordenesPorItem[l.item_id] = ordenesPorItem[l.item_id] || new Set()).add(l.orden_id);
  }

  // 1) embudo
  const filasEmbudo = activos.map(i => {
    const vis = visitasPorItem[i.item_id] ?? null, v = ventas[i.item_id];
    const ord = v ? v.ordenes.size : 0;
    const conv = vis ? ord / vis : null;
    const banderas = [];
    if (vis != null && vis >= UMBRAL_TRAFICO_SIN_VENTAS && ord === 0) banderas.push('trafico_sin_ventas');
    if (vis != null && vis >= UMBRAL_CONVERSION_BAJA.visitas && conv != null && conv < UMBRAL_CONVERSION_BAJA.tasa && ord > 0) banderas.push('conversion_baja');
    if (vis != null && vis < 5 && ord === 0) banderas.push('sin_visitas');
    return { itemId: i.item_id, sku: i.sku, titulo: i.titulo, enlace: i.permalink, precio: num(i.precio), visitas: vis, ordenes: ord, unidades: v ? v.unidades : 0, ingresos: v ? Math.round(v.ingresos) : 0, conversion: conv, banderas };
  });
  const totVisitas = filasEmbudo.reduce((a, f) => a + (f.visitas || 0), 0);
  const totOrdenes = new Set(lineas.map(l => l.orden_id)).size;
  const embudo = {
    resumen: {
      visitas: totVisitas, ordenes: totOrdenes, unidades: filasEmbudo.reduce((a, f) => a + f.unidades, 0),
      ingresos: Math.round(lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio_unit) || 0), 0)),
      conversion: totVisitas ? totOrdenes / totVisitas : null, publicacionesActivas: activos.length,
      traficoSinVentas: filasEmbudo.filter(f => f.banderas.includes('trafico_sin_ventas')).length,
      conVisitas: visitasRows.filter(v => v.visitas != null).length,
    },
    filas: filasEmbudo.sort((a, b) => (b.visitas || 0) - (a.visitas || 0)),
  };

  // 2) margen real
  const filasMargen = Object.entries(ventas).map(([itemId, v]) => {
    const it = itemPorId[itemId] || {};
    const hayCosto = v.costoConocido > 0;
    return {
      itemId, sku: it.sku || null, titulo: it.titulo || null, unidades: v.unidades, ingresos: Math.round(v.ingresos), comision: Math.round(v.comision), envio: Math.round(v.envio),
      costo: hayCosto ? Math.round(v.costo) : null, margen: hayCosto ? Math.round(v.margen) : null,
      margenPct: hayCosto && v.ingresoConCosto ? v.margen / v.ingresoConCosto : null, costoCompleto: v.costoConocido === v.unidades, envioPendiente: v.sinEnvio > 0,
      ingresoConCosto: Math.round(v.ingresoConCosto),
    };
  }).sort((a, b) => (a.margenPct ?? 9) - (b.margenPct ?? 9));
  const conMargen = filasMargen.filter(f => f.margen != null);
  const sumIng = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio_unit) || 0), 0);
  const sumCom = Object.values(ventas).reduce((a, v) => a + v.comision, 0), sumEnv = Object.values(ventas).reduce((a, v) => a + v.envio, 0);
  const margen = {
    resumen: {
      ingresos: Math.round(sumIng), comision: Math.round(sumCom), comisionPct: sumIng ? sumCom / sumIng : null, envio: Math.round(sumEnv), envioPct: sumIng ? sumEnv / sumIng : null,
      margen: conMargen.length ? Math.round(conMargen.reduce((a, f) => a + f.margen, 0)) : null,
      margenPct: (() => { const base = conMargen.reduce((a, f) => a + (f.ingresoConCosto || 0), 0); return base ? conMargen.reduce((a, f) => a + f.margen, 0) / base : null; })(),
      publicacionesConCosto: conMargen.length, publicacionesVendidas: filasMargen.length,
      ventasBajoMargen: filasMargen.filter(f => f.margenPct != null && f.margenPct < MARGEN_BAJO).length,
      pendientesEnvio: filasMargen.filter(f => f.envioPendiente).length,
    },
    filas: filasMargen,
  };

  // 3) reputación
  const rep = repRows[0] ? { fecha: repRows[0].fecha, ...repRows[0].datos } : null;
  const prev = repRows.find(r => rep && (new Date(rep.fecha).getTime() - new Date(r.fecha).getTime()) >= 6 * DIA_MS);
  const reputacion = {
    actual: rep,
    anterior: prev ? { fecha: prev.fecha, ...prev.datos } : null,
    historial: repRows.slice().reverse().map(r => ({ fecha: r.fecha, nivel: r.datos.nivel, reclamos: r.datos.reclamos, cancelaciones: r.datos.cancelaciones, demoras: r.datos.demoras })),
  };

  // 4) atención
  const respondidas = preguntas.filter(q => q.respondida);
  const minutos = respondidas.map(q => (new Date(q.respondida).getTime() - new Date(q.creada).getTime()) / 60000).filter(m => Number.isFinite(m) && m >= 0);
  const sinResponder = preguntas.filter(q => !q.respondida && /UNANSWERED/i.test(q.estado || ''));
  const porItemPreg = {};
  preguntas.forEach(q => { if (q.item_id) porItemPreg[q.item_id] = (porItemPreg[q.item_id] || 0) + 1; });
  const preguntasSinVenta = Object.entries(porItemPreg)
    .filter(([id, n]) => n >= UMBRAL_PREGUNTAS_SIN_VENTA && !(ordenesPorItem[id] && ordenesPorItem[id].size))
    .map(([id, n]) => ({ itemId: id, titulo: (itemPorId[id] || {}).titulo || null, sku: (itemPorId[id] || {}).sku || null, preguntas: n, visitas: visitasPorItem[id] ?? null }))
    .sort((a, b) => b.preguntas - a.preguntas).slice(0, 30);
  const atencion = {
    resumen: {
      preguntas: preguntas.length, respondidas: respondidas.length, sinResponder: sinResponder.length,
      porcentajeRespondidas: preguntas.length ? respondidas.length / preguntas.length : null,
      medianaMinutos: redondear(mediana(minutos), 0),
      dentroDe1h: minutos.length ? minutos.filter(m => m <= 60).length / minutos.length : null,
      dentroDe24h: minutos.length ? minutos.filter(m => m <= 1440).length / minutos.length : null,
      sinResponderMas24h: sinResponder.filter(q => ahora - new Date(q.creada).getTime() > DIA_MS).length,
      preguntasPorOrden: totOrdenes ? preguntas.length / totOrdenes : null,
    },
    preguntasSinVenta,
  };

  // 5) publicidad
  let publicidad = { disponible: false, motivo: 'Todavía no se ha consultado' };
  if (pubRows[0]) {
    const d = pubRows[0].datos;
    if (!d.disponible) publicidad = { disponible: false, motivo: d.motivo };
    else {
      const gasto = d.campañas.reduce((a, c) => a + (c.metricas.costo || 0), 0), vtas = d.campañas.reduce((a, c) => a + (c.metricas.ventas || 0), 0);
      publicidad = { disponible: true, desde: d.desde, hasta: d.hasta, gasto: Math.round(gasto), ventas: Math.round(vtas), acos: vtas ? gasto / vtas : null, roas: gasto ? vtas / gasto : null, campañas: d.campañas, calculadoEn: pubRows[0].calculado_en };
    }
  }

  // 6) stock (por SKU: se suman las publicaciones que comparten SKU)
  let stock = { disponible: false, motivo: 'No se pudo leer el stock de Bsale' };
  const sinSku = activos.filter(i => !i.sku).length;
  if (stockBsale) {
    const porSku = {};
    activos.filter(i => i.sku).forEach(i => {
      const s = porSku[i.sku] || (porSku[i.sku] = { sku: i.sku, titulo: i.titulo, stockMl: 0, publicaciones: 0 });
      s.stockMl += Number(i.stock_ml) || 0; s.publicaciones += 1;
    });
    const filas = Object.values(porSku).map(s => {
      const b = stockBsale[s.sku];
      let estado = 'ok';
      if (b === undefined) estado = 'sin_sku_en_bsale';
      else if (s.stockMl > 0 && b <= 0) estado = 'sobreventa';
      else if (s.stockMl === 0 && b > 0) estado = 'venta_perdida';
      else if (s.stockMl !== b) estado = 'desfase';
      return { ...s, stockBsale: b === undefined ? null : b, diferencia: b === undefined ? null : s.stockMl - b, estado };
    });
    const cuenta = e => filas.filter(f => f.estado === e).length;
    stock = {
      disponible: true, sinSku,
      resumen: { skus: filas.length, sobreventa: cuenta('sobreventa'), ventaPerdida: cuenta('venta_perdida'), desfase: cuenta('desfase'), sinSkuEnBsale: cuenta('sin_sku_en_bsale'), ok: cuenta('ok') },
      filas: filas.filter(f => f.estado !== 'ok').sort((a, b) => ['sobreventa', 'venta_perdida', 'desfase', 'sin_sku_en_bsale'].indexOf(a.estado) - ['sobreventa', 'venta_perdida', 'desfase', 'sin_sku_en_bsale'].indexOf(b.estado)),
    };
  }

  // 7) canal: ML vs lo que Bsale registra por SKU en el mismo período
  let canal = { disponible: false, motivo: 'No se pudieron leer las ventas de Bsale' };
  if (ventasBsale) {
    const bs = Object.fromEntries(ventasBsale.map(v => [v.sku, v]));
    const ml = {};
    lineas.filter(l => l.sku).forEach(l => {
      const m = ml[l.sku] || (ml[l.sku] = { sku: l.sku, titulo: l.titulo, unidadesMl: 0, ingresosMl: 0 });
      m.unidadesMl += Number(l.cantidad) || 0; m.ingresosMl += (Number(l.cantidad) || 0) * (Number(l.precio_unit) || 0);
    });
    const filas = Object.values(ml).map(m => {
      const b = bs[m.sku];
      return { ...m, ingresosMl: Math.round(m.ingresosMl), unidadesBsale: b ? Number(b.unidades) : 0, ingresosBsale: b ? Math.round(Number(b.monto)) : 0, razon: b && Number(b.unidades) ? m.unidadesMl / Number(b.unidades) : null };
    }).sort((a, b) => b.ingresosMl - a.ingresosMl);
    canal = {
      disponible: true,
      resumen: { skusConVentaMl: filas.length, unidadesMl: filas.reduce((a, f) => a + f.unidadesMl, 0), unidadesBsale: filas.reduce((a, f) => a + f.unidadesBsale, 0), ventasMlSinSku: lineas.filter(l => !l.sku).length },
      filas: filas.slice(0, 60),
    };
  }

  return { actualizadoEn: iso(ahora), ventanaDias: VENTANA_DIAS, hayDatos: ordenesTotal > 0 || activos.length > 0, embudo, margen, reputacion, atencion, publicidad, stock, canal };
}

// ---------------------------------------------------------------- diagnóstico de la API
// Muestra, para la cuenta conectada, lo que Mercado Libre responde realmente a cada lectura que usa el ERP (recortado y sin datos de
// compradores ni textos de preguntas). Sirve para confirmar o ajustar los nombres de campo cuando algún dato sale vacío.
export async function diagnosticoLectura(ctx) {
  const t0 = ctx.ahora();
  const out = [];
  const recorte = x => { const s = JSON.stringify(x, null, 1); return s.length > 1500 ? s.slice(0, 1500) + ' …' : s; };
  const probar = async (nombre, ruta, opc, reducir) => {
    try {
      const r = await ctx.leer(ruta, opc);
      out.push({ nombre, ruta, estado: 'ok', muestra: recorte(reducir ? reducir(r) : r) });
      return r;
    } catch (e) {
      out.push({ nombre, ruta, estado: 'error', http: e.status || null, muestra: String(e.message || e).slice(0, 300) });
      return null;
    }
  };
  const desdeDia = dia(t0 - VENTANA_DIAS * DIA_MS), hastaDia = dia(t0 - DIA_MS);
  const uid = queryEnc(ctx.userId);
  const lista = await probar('Publicaciones activas', `/users/${uid}/items/search?status=active&limit=1`, {}, r => ({ seller_id: r && r.seller_id, paging: r && r.paging, results: r && r.results }));
  const itemId = lista && lista.results && lista.results[0];
  if (itemId) {
    await probar('Visitas en bloque', `/items/visits?ids=${queryEnc(itemId)}&date_from=${desdeDia}&date_to=${hastaDia}`);
    await probar('Visitas de una publicación (rango)', `/items/${queryEnc(itemId)}/visits?date_from=${desdeDia}&date_to=${hastaDia}`);
    await probar('Visitas por ventana de días', `/items/${queryEnc(itemId)}/visits/time_window?last=${VENTANA_DIAS}&unit=day`);
    await probar('Publicación', `/items/${queryEnc(itemId)}?attributes=id,title,price,available_quantity,sold_quantity,status,seller_custom_field,health`);
  }
  const ord = await probar('Última orden', `/orders/search?seller=${uid}&sort=date_desc&limit=1`, {}, r => ({
    total: r && r.paging && r.paging.total, camposOrden: r && r.results && r.results[0] ? Object.keys(r.results[0]) : [],
    orden: r && r.results && r.results[0] ? {
      id: r.results[0].id, status: r.results[0].status, total_amount: r.results[0].total_amount, date_created: r.results[0].date_created, shipping: r.results[0].shipping && { id: r.results[0].shipping.id },
      order_items: (r.results[0].order_items || []).map(oi => ({ item: oi.item && { id: oi.item.id, title: oi.item.title, seller_sku: oi.item.seller_sku, seller_custom_field: oi.item.seller_custom_field }, quantity: oi.quantity, unit_price: oi.unit_price, sale_fee: oi.sale_fee })),
    } : null,
  }));
  const envioId = ord && ord.results && ord.results[0] && ord.results[0].shipping && ord.results[0].shipping.id;
  if (envioId) await probar('Costos de envío de esa orden', `/shipments/${queryEnc(envioId)}/costs`);
  await probar('Preguntas', `/questions/search?seller_id=${uid}&sort_fields=date_created&sort_types=DESC&limit=1&api_version=4`, {}, r => ({
    total: r && r.total, camposPregunta: r && r.questions && r.questions[0] ? Object.keys(r.questions[0]) : [], camposRespuesta: r && r.questions && r.questions[0] && r.questions[0].answer ? Object.keys(r.questions[0].answer) : [],
  }));
  await probar('Reputación', `/users/${uid}`, {}, r => (r && r.seller_reputation) || null);
  await probar('Anunciantes de Product Ads', '/advertising/advertisers?product_id=PADS', { headers: { 'api-version': '1' } });
  return out;
}

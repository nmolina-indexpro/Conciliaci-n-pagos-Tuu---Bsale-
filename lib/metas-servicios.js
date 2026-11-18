// /lib/metas-servicios.js
// Metas de servicios (Comercial > Metas de venta): cuántas LIMPIEZAS (de cualquier tipo) vendió cada vendedor en el mes. Meta: 10 limpiezas por vendedor al mes.
// Una limpieza es una línea de venta de un SERVICIO (SKU que empieza con "SER", o nombre de servicio) cuyo nombre, descripción o comentario dice "limpi…".
// El kit de limpiadores de LCD (producto "SET", SKU KCL…) es un accesorio de vitrina, no un servicio: no cuenta aquí.
// Funciones puras (reciben las ventas de Bsale ya leídas); el cálculo del mes y la lectura de Bsale están en api/negocio.js (manejarAccesoriosVendedores).

export const META_LIMPIEZAS_MENSUAL = 10;

// Mismo criterio que categoriaLinea() de api/negocio.js para reconocer un servicio (se repite aquí para poder probarlo sin ese archivo).
export function esLineaDeServicio(codigo, texto) {
  const c = String(codigo || '').toUpperCase();
  if (/^SER/.test(c)) return true;
  if (/^(CAR|BAT|PSLIM|PNORMAL|PTBEZEL|FDP)/.test(c)) return false;
  return /servicio|instalaci[oó]n|garant[ií]a|mano de obra|diagn[oó]stico|reparaci[oó]n/i.test(String(texto || ''));
}
// Servicios de la colección «Limpiezas y Mantenimientos» de la tienda (indexstore.cl/collections/limpiezas-y-mantenimientos), por SKU: cuentan aunque en Bsale
// no estén escritos con la palabra «limpieza». Si se crea una limpieza nueva con otro SKU, cuenta igual mientras su nombre diga «limpi…».
export const SKUS_LIMPIEZA = ['SER009', 'SER010', 'SER020', 'SER024', 'SER025', 'SER030'];
export function esLimpieza(codigo, texto) {
  if (SKUS_LIMPIEZA.includes(String(codigo || '').trim().toUpperCase())) return true;
  return esLineaDeServicio(codigo, texto) && /limpi/i.test(String(texto || ''));
}

const limpio = (s, max = 70) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

// Progreso ACUMULADO semana a semana dentro del mes (semana 1 = días 1-7, etc.), igual que el de accesorios pero en unidades.
export function semanasAcumuladas(porDia, hoyDia, meta) {
  const total = Math.ceil(hoyDia / 7), semanas = [];
  for (let s = 1; s <= total; s++) {
    const diaHasta = Math.min(s * 7, hoyDia);
    let acumulado = 0;
    for (const [fecha, n] of porDia.entries()) if (Number(fecha.slice(8, 10)) <= diaHasta) acumulado += n;
    semanas.push({ semana: s, diaHasta, acumulado, faltante: Math.max(0, meta - acumulado), cumplida: acumulado >= meta });
  }
  return semanas;
}

// ventas: documentos de venta de Bsale con details y user. catalogoPorSku: Map code -> { nombre, descripcion }.
// base: vendedores que deben salir aunque tengan 0 [{ vendedorId, nombre, email }]. permitidos: textos que el nombre debe contener (ya normalizados con normalizar).
export function limpiezasPorVendedor(ventas, { catalogoPorSku = new Map(), vendedoresPorId = new Map(), emailPorId = new Map(), base = [], permitidos = [], normalizar = (s) => String(s || '').toLowerCase(), hastaStr, meta = META_LIMPIEZAS_MENSUAL } = {}) {
  const porVendedor = new Map(); // id -> { ..., porDia, porTipo }
  const nuevo = (vendedorId, nombre, email) => ({ vendedorId, nombre, email: email || null, unidades: 0, porDia: new Map(), porTipo: new Map() });
  for (const b of base) porVendedor.set(b.vendedorId, nuevo(b.vendedorId, b.nombre, b.email));
  const vistos = new Map(); // nombre del servicio -> { unidades, cuenta }
  let sinVendedor = 0;
  for (const doc of ventas || []) {
    const fecha = doc.emissionDate ? new Date(doc.emissionDate * 1000).toISOString().slice(0, 10) : hastaStr;
    const vendedorId = doc.user && doc.user.id != null ? doc.user.id : -1;
    for (const det of (doc.details && doc.details.items) || []) {
      const codigo = (det.variant && det.variant.code) || '';
      const info = catalogoPorSku.get(codigo) || {};
      const textos = [info.nombre, info.descripcion, det.variant && det.variant.description, det.comment, det.note].filter(Boolean);
      const texto = textos.join(' ');
      if (!esLineaDeServicio(codigo, texto)) continue;
      const cantidad = Number(det.quantity) || 0;
      const nombreServicio = limpio(info.descripcion || (det.variant && det.variant.description) || det.comment || info.nombre || codigo || 'Servicio sin nombre');
      const cuenta = esLimpieza(codigo, texto);
      const v = vistos.get(nombreServicio) || { nombre: nombreServicio, codigo: codigo || null, unidades: 0, cuenta };
      v.unidades += cantidad; v.cuenta = v.cuenta || cuenta; vistos.set(nombreServicio, v);
      if (!cuenta) continue;
      if (vendedorId === -1) { sinVendedor += cantidad; continue; }
      if (!porVendedor.has(vendedorId)) porVendedor.set(vendedorId, nuevo(vendedorId, vendedoresPorId.get(vendedorId) || `Usuario #${vendedorId}`, emailPorId.get(vendedorId)));
      const e = porVendedor.get(vendedorId);
      e.unidades += cantidad;
      e.porDia.set(fecha, (e.porDia.get(fecha) || 0) + cantidad);
      e.porTipo.set(nombreServicio, (e.porTipo.get(nombreServicio) || 0) + cantidad);
    }
  }
  const hoyDia = Number(String(hastaStr).slice(8, 10)) || 1;
  // Bsale puede tener dos usuarios con el mismo nombre (uno descontinuado): de cada nombre repetido se deja solo el que tiene ventas;
  // si ninguno tiene, queda el primero (así el vendedor sale una sola vez, con 0).
  const porNombre = new Map();
  for (const v of porVendedor.values()) {
    const k = normalizar(v.nombre).replace(/\s+/g, ' ').trim();
    if (!porNombre.has(k)) porNombre.set(k, []);
    porNombre.get(k).push(v);
  }
  const unicos = [...porNombre.values()].flatMap((grupo) => { const conVentas = grupo.filter((v) => v.unidades > 0); return conVentas.length ? conVentas : [grupo[0]]; });
  const vendedores = unicos
    .filter((v) => !permitidos.length || permitidos.some((p) => normalizar(v.nombre).includes(p)))
    .map((v) => ({
      vendedorId: v.vendedorId, nombre: v.nombre, email: v.email, unidades: v.unidades,
      faltante: Math.max(0, meta - v.unidades), cumplioMeta: v.unidades >= meta,
      semanas: semanasAcumuladas(v.porDia, hoyDia, meta),
      porTipo: [...v.porTipo.entries()].map(([nombre, unidades]) => ({ nombre, unidades })).sort((a, b) => b.unidades - a.unidades),
    }))
    .sort((a, b) => b.unidades - a.unidades || a.nombre.localeCompare(b.nombre));
  return { vendedores, sinVendedor, vistos: [...vistos.values()].sort((a, b) => b.unidades - a.unidades) };
}

// Cuál de los vendedores es el usuario que mira la página: primero por correo (exacto en los dos sistemas), después por nombre.
export function vincularVendedor(vendedores, sesion, normalizar = (s) => String(s || '').toLowerCase()) {
  const email = String((sesion && sesion.email) || '').trim().toLowerCase();
  if (email) { const v = vendedores.find((x) => x.email === email); if (v) return v.vendedorId; }
  const nombre = normalizar((sesion && sesion.nombre) || '');
  if (!nombre) return null;
  const exacto = vendedores.find((x) => normalizar(x.nombre) === nombre);
  const parcial = exacto || vendedores.find((x) => normalizar(x.nombre).includes(nombre) || nombre.includes(normalizar(x.nombre)));
  return parcial ? parcial.vendedorId : null;
}

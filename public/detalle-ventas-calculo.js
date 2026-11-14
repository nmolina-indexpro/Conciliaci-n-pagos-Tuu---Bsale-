// /public/detalle-ventas-calculo.js
// Cálculo de la página "Detalle de ventas": períodos y comparaciones, filtros, totales, agrupaciones y series de tiempo.
// Funciones puras (sin DOM ni red): en el navegador quedan en window.DV y en Node se cargan con require (así se prueban).
// Las cifras siguen el criterio de Bsale: "Venta total" lleva IVA (neto x 1,19) y el margen se calcula sobre el neto.
// Las notas de crédito vienen con cantidad y monto NEGATIVOS: restan de la venta (es la venta real). No cuentan como "ventas" (N° de ventas).
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica(); else raiz.DV = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const IVA = 1.19;
  const MS_DIA = 86400000;
  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // ---------- fechas ('AAAA-MM-DD', siempre calendario, sin husos)
  const aMs = (iso) => Date.parse(iso + 'T00:00:00Z');
  const deMs = (ms) => new Date(ms).toISOString().slice(0, 10);
  const sumarDias = (iso, n) => deMs(aMs(iso) + n * MS_DIA);
  const diasEntre = (desde, hasta) => Math.round((aMs(hasta) - aMs(desde)) / MS_DIA);
  const primeroDelMes = (iso) => iso.slice(0, 8) + '01';
  const ultimoDelMes = (iso) => { const [a, m] = iso.split('-').map(Number); return deMs(Date.UTC(a, m, 0)); };
  const sumarMeses = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(a, m - 1 + n, 1)); const ult = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return deMs(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, ult))); };
  const lunesDe = (iso) => { const dow = (new Date(aMs(iso)).getUTCDay() + 6) % 7; return sumarDias(iso, -dow); };
  const fechaCorta = (iso) => { const [a, m, d] = iso.split('-'); return `${d}-${m}-${a}`; };
  const mesNombre = (periodo) => { const [a, m] = periodo.split('-').map(Number); return `${MESES[m - 1]} ${a}`; };
  const mesCorto = (periodo) => { const [a, m] = periodo.split('-').map(Number); return `${MESES_CORTOS[m - 1]} ${String(a).slice(2)}`; };

  // ---------- períodos
  const PRESETS = [
    ['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['semana_pasada', 'Semana pasada'], ['mes', 'Este mes'], ['mes_pasado', 'Mes pasado'],
    ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'], ['90d', 'Últimos 90 días'], ['anio', 'Este año'], ['12m', 'Últimos 12 meses'],
  ];
  function presetRango(id, hoy) {
    switch (id) {
      case 'hoy': return { desde: hoy, hasta: hoy };
      case 'ayer': return { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) };
      case 'semana': return { desde: lunesDe(hoy), hasta: hoy };
      case 'semana_pasada': { const l = sumarDias(lunesDe(hoy), -7); return { desde: l, hasta: sumarDias(l, 6) }; }
      case 'mes': return { desde: primeroDelMes(hoy), hasta: hoy };
      case 'mes_pasado': { const p = sumarMeses(primeroDelMes(hoy), -1); return { desde: p, hasta: ultimoDelMes(p) }; }
      case '7d': return { desde: sumarDias(hoy, -6), hasta: hoy };
      case '30d': return { desde: sumarDias(hoy, -29), hasta: hoy };
      case '90d': return { desde: sumarDias(hoy, -89), hasta: hoy };
      case 'anio': return { desde: hoy.slice(0, 4) + '-01-01', hasta: hoy };
      case '12m': return { desde: sumarMeses(primeroDelMes(hoy), -11), hasta: hoy };
      default: return null;
    }
  }
  const esMesCalendario = (r) => r.desde === primeroDelMes(r.desde) && r.hasta.slice(0, 7) === r.desde.slice(0, 7);
  // modo 'mes': las mismas fechas un mes antes; modo 'anterior': el período inmediatamente anterior (un mes calendario se compara con el mes anterior hasta el mismo día; lo demás, con la misma cantidad de días);
  // modo 'anio': las mismas fechas un año antes; 'ninguna': null.
  function rangoComparacion(r, modo) {
    if (!r || !modo || modo === 'ninguna') return null;
    if (modo === 'mes') return { desde: sumarMeses(r.desde, -1), hasta: sumarMeses(r.hasta, -1) }; // las mismas fechas, un mes antes (el día se recorta al largo del mes: 31 de marzo -> 28 de febrero)
    if (modo === 'anio') return { desde: sumarMeses(r.desde, -12), hasta: sumarMeses(r.hasta, -12) };
    if (esMesCalendario(r)) {
      const d = sumarMeses(r.desde, -1);
      const dia = Number(r.hasta.slice(8, 10));
      const tope = Math.min(dia, Number(ultimoDelMes(d).slice(8, 10)));
      return { desde: d, hasta: d.slice(0, 8) + String(tope).padStart(2, '0') };
    }
    const n = diasEntre(r.desde, r.hasta) + 1;
    return { desde: sumarDias(r.desde, -n), hasta: sumarDias(r.desde, -1) };
  }
  const etiquetaRango = (r) => (r.desde === r.hasta ? fechaCorta(r.desde) : `${fechaCorta(r.desde)} - ${fechaCorta(r.hasta)}`);

  // ---------- líneas
  // datos = respuesta de ?recurso=ventas-detalle. Cada línea trae referencias ya resueltas (sku, vendedor, sucursal) para filtrar y agrupar rápido.
  function prepararLineas(datos) {
    const d = datos.dic;
    return datos.lineas.map((l) => ({
      f: l[0], doc: l[1], sku: d.skus[l[2]], vend: d.vendedores[l[3]], suc: d.sucursales[l[4]], ml: (l[5] & 1) === 1, on: (l[5] & 2) === 2, nc: (l[5] & 4) === 4, cant: l[6], neto: l[7], costo: l[8],
      tdoc: d.tiposDoc && l[9] != null ? d.tiposDoc[l[9]] : null,
    }));
  }
  const enRango = (l, r) => l.f >= r.desde && l.f <= r.hasta;
  const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // filtros: { q, tipoVenta: ''|'online'|'directa', ml: boolean, sucursales|vendedores|marcas|tipos: arreglo (vacío = todos) }
  function filtrar(lineas, f) {
    const q = sinTildes(f && f.q).trim();
    const lista = (a) => (a && a.length ? new Set(a) : null);
    const suc = lista(f && f.sucursales), ven = lista(f && f.vendedores), mar = lista(f && f.marcas), tip = lista(f && f.tipos);
    return lineas.filter((l) => {
      if (f && f.tipoVenta === 'online' && !l.on) return false;
      if (f && f.tipoVenta === 'directa' && l.on) return false;
      if (f && f.ml && !l.ml) return false;
      if (suc && !suc.has(l.suc)) return false;
      if (ven && !ven.has(l.vend)) return false;
      if (mar && !mar.has(l.sku.marca)) return false;
      if (tip && !tip.has(l.sku.tipo)) return false;
      if (q && !(sinTildes(l.sku.nombre).includes(q) || sinTildes(l.sku.sku).includes(q) || sinTildes(l.sku.producto).includes(q))) return false;
      return true;
    });
  }

  // ---------- totales y agrupaciones
  const vacio = () => ({ cant: 0, neto: 0, docs: new Set(), ncDocs: new Set(), ncNeto: 0, ncCant: 0, netoConCosto: 0, costo: 0 });
  function sumar(t, l) {
    t.cant += l.cant; t.neto += l.neto;
    if (l.nc) { t.ncDocs.add(l.doc); t.ncNeto += l.neto; t.ncCant += l.cant; } else t.docs.add(l.doc); // una nota de crédito resta venta pero no es una venta
    if (l.costo != null) { t.netoConCosto += l.neto; t.costo += l.costo; }
  }
  function cerrar(t) {
    const margen = t.netoConCosto - t.costo;
    return {
      cant: t.cant, neto: t.neto, venta: t.neto * IVA, ventas: t.docs.size, ticket: t.docs.size ? (t.neto * IVA) / t.docs.size : null,
      ncVenta: t.ncNeto * IVA, ncCant: t.ncCant, ncDocs: t.ncDocs.size,
      // Solo cuenta lo que tiene costo conocido; el % es sobre esas mismas ventas y la cobertura dice qué parte de la venta tenía costo.
      margen: t.netoConCosto > 0 ? margen : null, margenPct: t.netoConCosto > 0 ? (margen / t.netoConCosto) * 100 : null, cobertura: t.neto > 0 ? (t.netoConCosto / t.neto) * 100 : null,
    };
  }
  function totales(lineas) { const t = vacio(); for (const l of lineas) sumar(t, l); return cerrar(t); }
  const CLAVES = {
    producto: (l) => l.sku.producto || l.sku.nombre, vendedor: (l) => l.vend, sucursal: (l) => l.suc, marca: (l) => l.sku.marca, tipo: (l) => l.sku.tipo,
  };
  const NOMBRES = { producto: (l) => l.sku.producto || l.sku.nombre, vendedor: (l) => l.vend, sucursal: (l) => l.suc, marca: (l) => l.sku.marca, tipo: (l) => l.sku.tipo };
  function agrupar(lineas, dimension) {
    const clave = CLAVES[dimension], nombre = NOMBRES[dimension], m = new Map();
    for (const l of lineas) {
      const k = clave(l);
      if (!m.has(k)) m.set(k, { clave: k, nombre: nombre(l), t: vacio(), skus: new Set(), sku: l.sku.sku });
      const g = m.get(k); sumar(g.t, l); g.skus.add(l.sku.sku);
    }
    const total = [...m.values()].reduce((s, g) => s + g.t.neto, 0) * IVA;
    return [...m.values()].map((g) => { const c = cerrar(g.t); return { clave: g.clave, nombre: g.nombre, sku: g.sku, ...c, participacion: total > 0 ? (c.venta / total) * 100 : 0, productos: g.skus.size }; }).sort((a, b) => b.venta - a.venta);
  }
  // Une el período actual con el comparado por clave: añade comparacion (venta, cant), difVenta y varPct.
  function conComparacion(filas, filasBase) {
    const base = new Map((filasBase || []).map((f) => [f.clave, f]));
    return filas.map((f) => { const b = base.get(f.clave); return { ...f, base: b ? { venta: b.venta, cant: b.cant, margen: b.margen } : null, difVenta: b ? f.venta - b.venta : f.venta, varPct: variacion(f.venta, b ? b.venta : 0) }; });
  }
  // Ventas por tipo de documento (boleta, factura, nota de crédito...): sirve para conciliar el total contra el reporte de Bsale.
  function desglosePorTipoDoc(lineas) {
    const m = new Map();
    for (const l of lineas) {
      const k = l.tdoc || (l.nc ? 'Nota de crédito' : 'Documento de venta');
      if (!m.has(k)) m.set(k, { nombre: k, docs: new Set(), cant: 0, neto: 0, nc: false });
      const x = m.get(k); x.docs.add(l.doc); x.cant += l.cant; x.neto += l.neto; if (l.nc) x.nc = true;
    }
    return [...m.values()].map((x) => ({ nombre: x.nombre, docs: x.docs.size, cant: x.cant, venta: x.neto * IVA, nc: x.nc })).sort((a, b) => (a.nc - b.nc) || (b.venta - a.venta));
  }
  // Variación porcentual (null si no hay base: dividir por cero no dice nada).
  const variacion = (actual, base) => (base > 0 ? ((actual - base) / base) * 100 : null);
  // Top N para el gráfico; lo demás se junta en "Otros".
  function topN(filas, n, campo) {
    const f = filas.filter((x) => x[campo || 'venta'] > 0);
    const top = f.slice(0, n);
    const resto = f.slice(n);
    return { top, otros: resto.length ? { nombre: `Otros (${resto.length})`, venta: resto.reduce((s, x) => s + x.venta, 0), cant: resto.reduce((s, x) => s + x.cant, 0) } : null };
  }

  // ---------- series de tiempo
  // Casillas de un rango: por día, por semana (lunes a domingo) o por mes. Cada una con desde/hasta recortados al rango.
  function casillas(r, gran) {
    const out = [];
    if (gran === 'dia') { for (let d = r.desde; d <= r.hasta; d = sumarDias(d, 1)) out.push({ desde: d, hasta: d, etiqueta: d.slice(8) + '/' + d.slice(5, 7) }); return out; }
    if (gran === 'semana') {
      for (let l = lunesDe(r.desde); l <= r.hasta; l = sumarDias(l, 7)) { const d = l < r.desde ? r.desde : l, h = sumarDias(l, 6) > r.hasta ? r.hasta : sumarDias(l, 6); out.push({ desde: d, hasta: h, etiqueta: l.slice(8) + '/' + l.slice(5, 7) }); }
      return out;
    }
    for (let m = primeroDelMes(r.desde); m <= r.hasta; m = sumarMeses(m, 1)) { const d = m < r.desde ? r.desde : m, u = ultimoDelMes(m), h = u > r.hasta ? r.hasta : u; out.push({ desde: d, hasta: h, etiqueta: mesCorto(m.slice(0, 7)) }); }
    return out;
  }
  // Granularidad que conviene según el largo del rango (se puede cambiar a mano).
  function granularidadSugerida(r) { const n = diasEntre(r.desde, r.hasta) + 1; return n <= 31 ? 'dia' : n <= 120 ? 'semana' : 'mes'; }
  function serie(lineas, r, gran) {
    const cs = casillas(r, gran);
    const venta = new Array(cs.length).fill(0), cant = new Array(cs.length).fill(0);
    let i = 0;
    const ord = lineas.filter((l) => enRango(l, r)).sort((a, b) => (a.f < b.f ? -1 : 1));
    for (const l of ord) { while (i < cs.length - 1 && l.f > cs[i].hasta) i++; if (l.f >= cs[i].desde && l.f <= cs[i].hasta) { venta[i] += l.neto * IVA; cant[i] += l.cant; } }
    return cs.map((c, k) => ({ ...c, venta: venta[k], cant: cant[k] }));
  }

  // ---------- comparativo mensual: filas = elementos de la dimensión, columnas = meses
  // metrica: 'venta' | 'cant' | 'margen'. Devuelve { meses, filas: [{ clave, nombre, valores: [], total, var }], totales: [] } con los n elementos más vendidos (el resto en "Otros").
  function matrizMensual(lineas, dimension, metrica, meses, n, hoy) {
    const clave = CLAVES[dimension], nombre = NOMBRES[dimension], idx = new Map(meses.map((m, i) => [m, i]));
    const valor = (l) => (metrica === 'cant' ? l.cant : metrica === 'margen' ? (l.costo != null ? (l.neto - l.costo) : 0) : l.neto * IVA);
    // Si el último mes es el mes en curso, está incompleto: se compara con el mes anterior pero solo hasta el mismo día (no contra el mes entero).
    const ult = meses[meses.length - 1], prev = meses[meses.length - 2];
    const parcial = !!(hoy && prev && ult === hoy.slice(0, 7) && hoy !== ultimoDelMes(hoy));
    const diaTope = parcial ? hoy.slice(8, 10) : null;
    const g = new Map();
    for (const l of lineas) {
      const mes = l.f.slice(0, 7), i = idx.get(mes); if (i == null) continue;
      const k = clave(l);
      if (!g.has(k)) g.set(k, { clave: k, nombre: nombre(l), valores: new Array(meses.length).fill(0), total: 0, prevMismoDia: 0 });
      const x = g.get(k); const v = valor(l); x.valores[i] += v; x.total += v;
      if (parcial && mes === prev && l.f.slice(8, 10) <= diaTope) x.prevMismoDia += v;
    }
    const todos = [...g.values()].sort((a, b) => b.total - a.total);
    const filas = todos.slice(0, n);
    const resto = todos.slice(n);
    if (resto.length) filas.push({ clave: '__otros', nombre: `Otros (${resto.length})`, valores: meses.map((_, i) => resto.reduce((s, x) => s + x.valores[i], 0)), total: resto.reduce((s, x) => s + x.total, 0), prevMismoDia: resto.reduce((s, x) => s + x.prevMismoDia, 0) });
    const tot = meses.map((_, i) => todos.reduce((s, x) => s + x.valores[i], 0));
    const totPrevMismoDia = todos.reduce((s, x) => s + x.prevMismoDia, 0);
    for (const f of filas) { const u = f.valores[f.valores.length - 1], p = parcial ? f.prevMismoDia : f.valores[f.valores.length - 2]; f.var = f.valores.length > 1 ? variacion(u, p) : null; }
    const pt = parcial ? totPrevMismoDia : tot[tot.length - 2];
    return { meses, filas, totales: tot, totalGeneral: tot.reduce((s, x) => s + x, 0), varUltimo: tot.length > 1 ? variacion(tot[tot.length - 1], pt) : null, parcial, hastaDia: diaTope };
  }
  const mesesDeLineas = (lineas) => [...new Set(lineas.map((l) => l.f.slice(0, 7)))].sort();
  // Los n meses que terminan en el mes de "hoy" (incluido), del más antiguo al más reciente.
  function ultimosMeses(hoy, n) { const out = []; let m = primeroDelMes(hoy); for (let i = 0; i < n; i++) { out.unshift(m.slice(0, 7)); m = sumarMeses(m, -1); } return out; }

  // ---------- pronóstico de venta del mes ----------
  // Dos métodos, ambos sobre la venta real con IVA por día (las notas de crédito restan):
  //  - ritmo: en los meses anteriores, los primeros c días fueron el X% del mes; si este mes llevamos A, el mes cerraría en A / X%. Se toma la mediana de los meses base.
  //  - día de la semana: lo vendido hasta hoy + lo que se espera vender cada día que falta, según el promedio de ese día de la semana en las últimas 12 semanas.
  // El pronóstico es el promedio de los dos. La prueba de meses anteriores repite el cálculo como si se hubiera hecho el mismo día de cada mes pasado (usando solo
  // los meses anteriores a ese) y lo compara con lo que de verdad se vendió, para saber cuánto fiarse. No considera feriados ni eventos: eso lo ve la IA como riesgo.
  const pad2 = (n) => String(n).padStart(2, '0');
  const diasDelMes = (mes) => Number(ultimoDelMes(mes + '-01').slice(8, 10));
  const NOMBRES_DIA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const diaSemana = (iso) => (new Date(aMs(iso)).getUTCDay() + 6) % 7; // lunes = 0
  function ventaPorDia(lineas) { const m = {}; for (const l of lineas) m[l.f] = (m[l.f] || 0) + l.neto * IVA; return m; }
  function percentil(arr, p) {
    const a = [...arr].sort((x, y) => x - y); if (!a.length) return null;
    const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return a[lo] + (a[hi] - a[lo]) * (i - lo);
  }
  const mediana = (a) => percentil(a, 0.5);
  const promedio = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  // Promedio sin el valor más alto ni el más bajo (un día excepcional no debe mover el promedio de un día de la semana)
  function mediaRecortada(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const u = s.length >= 6 ? s.slice(1, -1) : s; return u.reduce((q, x) => q + x, 0) / u.length; }
  function acumulado(porDia, mes, c) { let s = 0; const n = diasDelMes(mes); for (let d = 1; d <= Math.min(c, n); d++) s += porDia[mes + '-' + pad2(d)] || 0; return s; }

  function porRitmo(porDia, mes, c, base) {
    const acum = acumulado(porDia, mes, c), proy = [], ratios = [];
    for (const m of base) {
      const tot = acumulado(porDia, m, 31), cum = acumulado(porDia, m, c);
      if (tot > 0 && cum > 0) { ratios.push(cum / tot); proy.push(acum / (cum / tot)); }
    }
    if (!proy.length || !(acum > 0)) return null;
    return { valor: mediana(proy), minimo: Math.min(...proy), maximo: Math.max(...proy), p20: percentil(proy, 0.2), p80: percentil(proy, 0.8), meses: proy.length, ratioTipico: mediana(ratios) };
  }
  function porDiaSemana(porDia, mes, c, semanas) {
    const corte = mes + '-' + pad2(c), desde = sumarDias(corte, -(semanas * 7) + 1);
    const muestras = [[], [], [], [], [], [], []];
    for (let d = desde; d <= corte; d = sumarDias(d, 1)) muestras[diaSemana(d)].push(porDia[d] || 0);
    const prom = muestras.map(mediaRecortada);
    const acum = acumulado(porDia, mes, c), n = diasDelMes(mes), diario = [];
    let restante = 0;
    for (let k = c + 1; k <= n; k++) { const fecha = mes + '-' + pad2(k), e = prom[diaSemana(fecha)]; restante += e; diario.push({ dia: k, fecha, esperado: e }); }
    return { valor: acum + restante, restante, promedios: prom, diario };
  }
  // mes 'AAAA-MM'; corte = último día completo ('AAAA-MM-DD', dentro del mes); base = meses completos anteriores ('AAAA-MM'). null si no se puede.
  function pronosticoMes(porDia, mes, corte, base) {
    if (!corte || corte.slice(0, 7) !== mes) return null;
    const c = Number(corte.slice(8, 10)), n = diasDelMes(mes);
    if (c < 1 || c >= n) return null;
    const acum = acumulado(porDia, mes, c);
    const r = porRitmo(porDia, mes, c, base), d = porDiaSemana(porDia, mes, c, 12);
    const valores = [r && r.valor, d.valor].filter((x) => x != null && Number.isFinite(x));
    if (!valores.length || !(acum > 0)) return null;
    const combinada = promedio(valores);
    const bajos = [r && r.p20, d.valor, combinada].filter((x) => x != null), altos = [r && r.p80, d.valor, combinada].filter((x) => x != null);
    const desde = Math.max(acum, Math.min(...bajos)), hasta = Math.max(...altos);
    // ruta acumulada para el gráfico: lo real hasta el corte y, desde ahí, lo esperado de cada día escalado para llegar a la cifra pronosticada
    const falta = n - c, k = d.restante > 0 ? (combinada - acum) / d.restante : null;
    const real = [], previsto = []; let a = 0, p = acum;
    for (let i = 1; i <= n; i++) {
      if (i <= c) { a += porDia[mes + '-' + pad2(i)] || 0; real.push(a); previsto.push(i === c ? acum : null); }
      else { p += k != null ? d.diario[i - c - 1].esperado * k : (combinada - acum) / falta; real.push(null); previsto.push(p); }
    }
    return {
      mes, corte, c, dias: n, acumulado: acum, ritmo: r, diaSemana: d, combinada, rango: { desde, hasta }, porcentajeTipico: r ? r.ratioTipico * 100 : null,
      restante: combinada - acum, promedioDiarioActual: acum / c, promedioDiarioFalta: (combinada - acum) / falta, diasFaltan: falta, ruta: { real, previsto },
    };
  }
  // Repite el pronóstico en los últimos meses completos, usando solo los meses anteriores a cada uno y el mismo día de corte.
  function pruebaMeses(porDia, mesesCompletos, c, max) {
    const ms = [...mesesCompletos].sort(), filas = [];
    for (let i = ms.length - 1; i >= 0 && filas.length < (max || 8); i--) {
      const m = ms[i], base = ms.slice(Math.max(0, i - 12), i);
      if (base.length < 3) continue;
      const cc = Math.min(c, diasDelMes(m) - 1);
      const p = pronosticoMes(porDia, m, m + '-' + pad2(cc), base), real = acumulado(porDia, m, 31);
      if (!p || !(real > 0)) continue;
      filas.push({ mes: m, corteDia: cc, proyectado: p.combinada, real, errorPct: ((p.combinada - real) / real) * 100 });
    }
    filas.reverse();
    return { filas, errorMedioPct: filas.length ? promedio(filas.map((x) => Math.abs(x.errorPct))) : null, sesgoPct: filas.length ? promedio(filas.map((x) => x.errorPct)) : null };
  }
  // Todo junto para la página. lineas: ya filtradas (los filtros de la página se aplican antes). mesesCompletos: meses leídos por completo de Bsale, sin el mes en curso.
  function pronostico({ lineas, hoy, corte, mesesCompletos }) {
    const mes = hoy.slice(0, 7), porDia = ventaPorDia(lineas);
    const completos = (mesesCompletos || []).filter((m) => m < mes && acumulado(porDia, m, 31) > 0).sort();
    const base = completos.slice(-12);
    const actual = pronosticoMes(porDia, mes, corte, base);
    const prev = DVmesAnterior(mes), anio = sumarMeses(mes + '-01', -12).slice(0, 7);
    const total = (m) => (completos.includes(m) ? acumulado(porDia, m, 31) : null);
    let anterior = null;
    if (actual) { // ruta del mes anterior para compararla en el gráfico
      const np = diasDelMes(prev); anterior = [];
      let a = 0; for (let i = 1; i <= Math.min(actual.dias, np); i++) { a += porDia[prev + '-' + pad2(i)] || 0; anterior.push(a); }
    }
    return {
      mes, base, actual, rutaAnterior: anterior, totalMesAnterior: total(prev), totalMismoMesAnio: total(anio), mesAnterior: prev, mesAnio: anio,
      prueba: actual ? pruebaMeses(porDia, completos, actual.c, 8) : null,
      totales: completos.slice(-13).map((m) => ({ mes: m, total: acumulado(porDia, m, 31) })),
      promedioDiaSemana: actual ? actual.diaSemana.promedios.map((v, i) => ({ dia: NOMBRES_DIA[i], promedio: v })) : [],
    };
  }
  const DVmesAnterior = (mes) => sumarMeses(mes + '-01', -1).slice(0, 7);

  // ---------- exportar
  function aCsv(filas, columnas) {
    const celda = (v) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [columnas.map((c) => celda(c.titulo)).join(';'), ...filas.map((f) => columnas.map((c) => celda(c.valor(f))).join(';'))].join('\n');
  }

  return {
    IVA, PRESETS, desglosePorTipoDoc, ventaPorDia, pronosticoMes, pruebaMeses, pronostico, NOMBRES_DIA, presetRango, rangoComparacion, etiquetaRango, prepararLineas, enRango, filtrar, totales, agrupar, conComparacion, variacion, topN, casillas, granularidadSugerida, serie,
    matrizMensual, mesesDeLineas, ultimosMeses, aCsv, sumarDias, diasEntre, sumarMeses, primeroDelMes, ultimoDelMes, lunesDe, fechaCorta, mesNombre, mesCorto,
  };
});

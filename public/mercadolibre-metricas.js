// Métricas de Mercado Libre (solo lectura): botón "Actualizar datos" con avance y una pestaña por cada cosa que se mide.
// Lo usa public/mercadolibre.html cuando la cuenta está conectada. Los datos vienen de /api/negocio?recurso=mercadolibre
// (acciones sync-estado, sync, sync-reiniciar y metricas); ver lib/mercadolibre-datos.js.
(function () {
  const $ = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const API = '/api/negocio?recurso=mercadolibre';
  const clp = n => (n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-CL'));
  const ent = n => (n == null ? '—' : Math.round(n).toLocaleString('es-CL'));
  const pct = (x, d = 1) => (x == null ? '—' : (x * 100).toFixed(d).replace('.', ',') + '%');
  const fechaHora = iso => (iso ? new Date(iso).toLocaleString('es-CL') : '—');
  const minutos = m => { if (m == null) return '—'; if (m < 60) return Math.round(m) + ' min'; const h = Math.floor(m / 60); return h + ' h' + (Math.round(m % 60) ? ' ' + Math.round(m % 60) + ' min' : ''); };
  const NIVELES = { '5_green': ['Verde', '#15803D'], '4_light_green': ['Verde claro', '#65A30D'], '3_yellow': ['Amarillo', '#B45309'], '2_orange': ['Naranja', '#EA580C'], '1_red': ['Rojo', '#DC2626'] };
  const BANDERAS = { trafico_sin_ventas: 'Tráfico sin ventas', conversion_baja: 'Conversión baja', sin_visitas: 'Casi sin visitas' };
  const ESTADOS_STOCK = {
    sobreventa: 'ML tiene stock y Bsale no (riesgo de sobreventa)', venta_perdida: 'ML en 0 y Bsale tiene stock (venta perdida)',
    desfase: 'Cantidades distintas', sin_sku_en_bsale: 'El SKU no existe en Bsale',
  };
  let metricas = null, tabActiva = 'resumen', corriendo = false;

  async function pedir(accion, metodo, extra) {
    const res = await fetch(API + '&accion=' + accion + (extra || ''), { method: metodo || 'GET' });
    const texto = await res.text();
    let data = null;
    try { data = JSON.parse(texto); } catch (e) { throw new Error('El servidor respondió con un error (HTTP ' + res.status + ')'); }
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  // ---------------------------------------------------------------- actualizar datos
  function barra(p) {
    const v = p == null ? 0 : p;
    return '<div style="background:var(--surface-2);border-radius:999px;height:8px;overflow:hidden;min-width:120px;"><div style="background:var(--primary);height:8px;width:' + v + '%;"></div></div>';
  }
  function dibujarProgreso(est, extra) {
    if (!est) return;
    const filas = est.pasos.map(p => {
      const estado = p.error ? '<span style="color:var(--red);">Error: ' + esc(p.error) + '</span>'
        : p.terminado ? '<span style="color:var(--green);">Listo</span>'
        : (p.porcentaje != null ? p.porcentaje + '%' + (p.total ? ' · ' + ent(p.hechos) + ' de ' + ent(p.total) : '') : (p.hechos ? ent(p.hechos) : 'Pendiente'));
      return '<tr><td style="width:170px;">' + esc(p.etiqueta) + '</td><td style="width:160px;">' + barra(p.terminado ? 100 : p.porcentaje) + '</td><td>' + estado + '</td></tr>';
    }).join('');
    $('progresoDatos').innerHTML = '<div style="font-weight:700;margin:6px 0;">' + (est.completo ? 'Datos al día' : 'Avance total: ' + est.porcentaje + '%') + (est.inicio ? '<span class="empty-note" style="font-weight:400;"> · vuelta iniciada el ' + esc(fechaHora(est.inicio)) + '</span>' : '') + '</div>' +
      '<table data-sin-orden><tbody>' + filas + '</tbody></table>' + (extra || '');
  }
  async function actualizarDatos() {
    if (corriendo) return;
    corriendo = true;
    const b = $('btnActualizarDatos'); b.disabled = true; b.textContent = 'Actualizando...';
    try {
      let est = await pedir('sync-estado');
      if (est.completo) est = await pedir('sync-reiniciar', 'POST');
      dibujarProgreso(est);
      let guardia = 0;
      while (!est.completo && guardia++ < 400) {
        const r = await pedir('sync', 'POST');
        est = r;
        if (r.error) { dibujarProgreso(r, '<div class="error-box" style="margin-top:8px;">' + esc(r.error) + '</div>'); break; }
        dibujarProgreso(r);
        const conError = r.pasos.find(p => p.error && !p.terminado);
        if (conError) {
          dibujarProgreso(r, '<div class="aviso-box" style="margin-top:8px;">El paso «' + esc(conError.etiqueta) + '» tuvo un error y se detuvo la actualización. Lo avanzado queda guardado; vuelve a intentarlo o avísame con este mensaje.</div>');
          break;
        }
      }
      await cargarMetricas();
    } catch (err) {
      $('progresoDatos').innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
    } finally {
      corriendo = false; b.disabled = false; b.textContent = 'Actualizar datos';
    }
  }

  // ---------------------------------------------------------------- tablas y tarjetas
  function tarjetas(lista) {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:12px;">' +
      lista.map(([t, v, s]) => '<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--bg);"><div class="empty-note" style="text-transform:uppercase;font-size:10.5px;letter-spacing:.4px;">' + esc(t) + '</div><div style="font-family:\'IBM Plex Mono\',monospace;font-size:20px;font-weight:600;margin-top:2px;">' + v + '</div>' + (s ? '<div class="empty-note" style="font-size:11.5px;">' + s + '</div>' : '') + '</div>').join('') + '</div>';
  }
  function tabla(cols, filas, vacio) {
    if (!filas.length) return '<p class="empty-note" style="padding:8px 0;">' + esc(vacio || 'Sin datos') + '</p>';
    return '<div class="tabla-wrap"><table><thead><tr>' + cols.map(c => '<th>' + esc(c[0]) + '</th>').join('') + '</tr></thead><tbody>' +
      filas.map(f => '<tr>' + cols.map(c => '<td' + (c[2] ? ' style="' + c[2] + '"' : '') + '>' + c[1](f) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  const titulo = (f) => (f.enlace ? '<a href="' + esc(f.enlace) + '" target="_blank" rel="noopener">' + esc(f.titulo || f.itemId) + '</a>' : esc(f.titulo || f.itemId || ''));
  const nota = t => '<div class="empty-note" style="margin-top:10px;line-height:1.5;">' + t + '</div>';
  const h = t => '<h2 style="font-family:\'Space Grotesk\',sans-serif;font-size:15px;margin:16px 0 6px;">' + t + '</h2>';
  const insignia = (t, color) => '<span class="badge" style="background:' + color + '22;color:' + color + ';">' + esc(t) + '</span>';

  // ---------------------------------------------------------------- una función por cosa que se mide
  function vResumen(m) {
    const e = m.embudo.resumen, g = m.margen.resumen, a = m.atencion.resumen, r = m.reputacion.actual, p = m.publicidad;
    const nivel = r && r.nivel ? (NIVELES[r.nivel] || [r.nivel, '#6B7568']) : null;
    return '<p class="empty-note">Últimos ' + m.ventanaDias + ' días, según los datos guardados el ' + esc(fechaHora(m.actualizadoEn)) + '</p>' +
      tarjetas([
        ['Visitas', ent(e.visitas), ent(e.publicacionesActivas) + ' publicaciones activas'],
        ['Órdenes', ent(e.ordenes), ent(e.unidades) + ' unidades'],
        ['Conversión', pct(e.conversion, 2), 'órdenes / visitas'],
        ['Ingresos', clp(e.ingresos), 'precio de venta, sin descontar comisión'],
        ['Margen real', g.margen == null ? '—' : clp(g.margen), g.margenPct == null ? 'faltan costos de Bsale' : pct(g.margenPct) + ' · ' + g.publicacionesConCosto + ' de ' + g.publicacionesVendidas + ' publicaciones con costo'],
        ['Comisión + envío', pct((g.comisionPct || 0) + (g.envioPct || 0)), 'comisión ' + pct(g.comisionPct) + ' · envío ' + pct(g.envioPct)],
        ['Reputación', nivel ? '<span style="color:' + nivel[1] + ';">' + esc(nivel[0]) + '</span>' : '—', r ? 'reclamos ' + pct(r.reclamos) + ' · cancelaciones ' + pct(r.cancelaciones) : ''],
        ['Preguntas sin responder', ent(a.sinResponder), 'mediana de respuesta ' + minutos(a.medianaMinutos)],
        ['Publicidad (ACOS)', p.disponible ? pct(p.acos) : '—', p.disponible ? 'gasto ' + clp(p.gasto) : 'no disponible'],
      ]);
  }
  function vEmbudo(m) {
    const e = m.embudo.resumen;
    const filas = m.embudo.filas;
    return tarjetas([['Visitas', ent(e.visitas)], ['Órdenes', ent(e.ordenes)], ['Conversión global', pct(e.conversion, 2)], ['Con tráfico y sin ventas', ent(e.traficoSinVentas), 'publicaciones con 30 visitas o más y ninguna orden']]) +
      h('Publicaciones activas: visitas → órdenes') +
      tabla([
        ['Publicación', f => titulo(f)], ['SKU', f => esc(f.sku || '—')], ['Visitas', f => ent(f.visitas), 'text-align:right;'], ['Órdenes', f => ent(f.ordenes), 'text-align:right;'],
        ['Unidades', f => ent(f.unidades), 'text-align:right;'], ['Conversión', f => pct(f.conversion, 2), 'text-align:right;'], ['Ingresos', f => clp(f.ingresos), 'text-align:right;'],
        ['Alerta', f => f.banderas.map(b => insignia(BANDERAS[b] || b, b === 'trafico_sin_ventas' ? '#DC2626' : '#B45309')).join(' ')],
      ], filas, 'Aún no hay publicaciones: actualiza los datos.') +
      nota('<b>Cómo leerlo:</b> mucha visita y ninguna orden suele ser precio, fotos, título o envío que no convence; poca visita es posicionamiento o publicidad. La conversión es órdenes / visitas de los últimos ' + m.ventanaDias + ' días.');
  }
  function vMargen(m) {
    const g = m.margen.resumen;
    return tarjetas([
      ['Margen real', g.margen == null ? '—' : clp(g.margen), g.margenPct == null ? '' : pct(g.margenPct) + ' sobre lo vendido con costo'],
      ['Ingresos', clp(g.ingresos)], ['Comisión de Mercado Libre', clp(g.comision), pct(g.comisionPct) + ' de lo vendido'], ['Envío que paga el vendedor', clp(g.envio), pct(g.envioPct) + ' de lo vendido'],
      ['Ventas con margen bajo', ent(g.ventasBajoMargen), 'publicaciones con menos de 10%'],
    ]) + h('Margen por publicación (de menor a mayor)') +
      tabla([
        ['Publicación', f => esc(f.titulo || f.itemId)], ['SKU', f => esc(f.sku || '—')], ['Unidades', f => ent(f.unidades), 'text-align:right;'], ['Ingresos', f => clp(f.ingresos), 'text-align:right;'],
        ['Comisión', f => clp(f.comision), 'text-align:right;'], ['Envío', f => clp(f.envio) + (f.envioPendiente ? ' *' : ''), 'text-align:right;'], ['Costo Bsale', f => f.costo == null ? '<span class="empty-note">sin costo</span>' : clp(f.costo) + (f.costoCompleto ? '' : ' *'), 'text-align:right;'],
        ['Margen', f => f.margen == null ? '—' : '<b style="color:' + (f.margen < 0 ? 'var(--red)' : 'inherit') + ';">' + clp(f.margen) + '</b>', 'text-align:right;'], ['Margen %', f => pct(f.margenPct), 'text-align:right;'],
      ], m.margen.filas, 'Sin ventas en el período.') +
      nota('<b>Margen = ingreso − comisión − envío del vendedor − costo de Bsale.</b> El costo es el promedio de Bsale (o la última compra). * Dato incompleto: el costo de envío todavía no se consulta o algunas unidades no tienen costo. La comisión se toma de cada orden de Mercado Libre; si la cifra no calza con tu panel, avísame y lo ajusto.');
  }
  function vReputacion(m) {
    const r = m.reputacion.actual;
    if (!r) return '<p class="empty-note">Aún no hay datos de reputación: actualiza los datos.</p>';
    const nivel = NIVELES[r.nivel] || [r.nivel || '—', '#6B7568'];
    const ant = m.reputacion.anterior;
    const dif = (a, b) => (a == null || b == null ? '' : (a - b > 0 ? ' ▲ ' : a - b < 0 ? ' ▼ ' : ' = ') + pct(Math.abs(a - b)));
    return tarjetas([
      ['Nivel', '<span style="color:' + nivel[1] + ';">' + esc(nivel[0]) + '</span>', r.estadoLider ? 'MercadoLíder: ' + esc(r.estadoLider) : 'sin MercadoLíder'],
      ['Reclamos', pct(r.reclamos), ant ? 'vs. ' + esc(ant.fecha) + dif(r.reclamos, ant.reclamos) : ''],
      ['Cancelaciones', pct(r.cancelaciones), ant ? dif(r.cancelaciones, ant.cancelaciones) : ''],
      ['Demoras en despacho', pct(r.demoras), ant ? dif(r.demoras, ant.demoras) : ''],
      ['Calificaciones positivas', pct(r.calificaciones.positivas), 'neutras ' + pct(r.calificaciones.neutras) + ' · negativas ' + pct(r.calificaciones.negativas)],
      ['Ventas del período', ent(r.ventasPeriodo && r.ventasPeriodo.completadas), r.ventasPeriodo ? esc(r.ventasPeriodo.periodo || '') : ''],
    ]) + h('Historial guardado') +
      tabla([['Fecha', f => esc(f.fecha)], ['Nivel', f => esc((NIVELES[f.nivel] || [f.nivel || '—'])[0])], ['Reclamos', f => pct(f.reclamos)], ['Cancelaciones', f => pct(f.cancelaciones)], ['Demoras', f => pct(f.demoras)]], m.reputacion.historial.slice().reverse(), 'Sin historial todavía.') +
      nota('Las tasas son las que informa Mercado Libre para el período que él define (normalmente los últimos 60 días). El historial se arma con cada actualización diaria, así se ve si la reputación mejora o empeora. Los umbrales para conservar o perder beneficios los fija Mercado Libre.');
  }
  function vAtencion(m) {
    const a = m.atencion.resumen;
    return tarjetas([
      ['Preguntas', ent(a.preguntas), 'últimos ' + m.ventanaDias + ' días'], ['Respondidas', pct(a.porcentajeRespondidas), ent(a.respondidas) + ' de ' + ent(a.preguntas)],
      ['Sin responder', ent(a.sinResponder), ent(a.sinResponderMas24h) + ' con más de 24 horas'], ['Tiempo mediano', minutos(a.medianaMinutos)],
      ['Respondidas en 1 hora', pct(a.dentroDe1h), 'en 24 horas: ' + pct(a.dentroDe24h)], ['Preguntas por orden', a.preguntasPorOrden == null ? '—' : a.preguntasPorOrden.toFixed(1).replace('.', ',')],
    ]) + h('Publicaciones con muchas preguntas y ninguna venta') +
      tabla([['Publicación', f => esc(f.titulo || f.itemId)], ['SKU', f => esc(f.sku || '—')], ['Preguntas', f => ent(f.preguntas), 'text-align:right;'], ['Visitas', f => ent(f.visitas), 'text-align:right;']], m.atencion.preguntasSinVenta, 'Ninguna publicación con 3 preguntas o más sin ventas.') +
      nota('Responder rápido mejora la conversión y la reputación. Una publicación con muchas preguntas y sin ventas suele tener una duda sin resolver en la ficha (compatibilidad, garantía, envío): conviene agregarla al texto. No se guardan los textos de las preguntas ni datos de compradores.');
  }
  function vPublicidad(m) {
    const p = m.publicidad;
    if (!p.disponible) return '<div class="aviso-box">Publicidad no disponible: ' + esc(p.motivo || '') + '</div>' + nota('Si la cuenta usa Product Ads y aun así no aparece, puede faltar el permiso de publicidad en la aplicación de Mercado Libre.');
    return tarjetas([['Gasto', clp(p.gasto), esc(p.desde) + ' al ' + esc(p.hasta)], ['Ventas por publicidad', clp(p.ventas)], ['ACOS', pct(p.acos), 'gasto / ventas por publicidad'], ['ROAS', p.roas == null ? '—' : p.roas.toFixed(1).replace('.', ',') + 'x', 'ventas por cada $1 invertido']]) +
      h('Campañas') + tabla([['Campaña', f => esc(f.nombre || f.id || '—')], ['Estado', f => esc(({ active: 'Activa', paused: 'Pausada', idle: 'Sin actividad' })[f.estado] || f.estado || '—')], ['Gasto', f => clp(f.metricas.costo), 'text-align:right;'], ['Ventas', f => clp(f.metricas.ventas), 'text-align:right;'],
        ['ACOS', f => pct(f.metricas.costo && f.metricas.ventas ? f.metricas.costo / f.metricas.ventas : f.metricas.acos), 'text-align:right;'], ['Clics', f => ent(f.metricas.clics), 'text-align:right;'], ['Impresiones', f => ent(f.metricas.impresiones), 'text-align:right;']], p.campañas, 'Sin campañas.') +
      nota('ACOS = gasto en publicidad / ventas atribuidas a la publicidad. Si es más alto que tu margen, esa campaña pierde plata aunque venda.');
  }
  function vStock(m) {
    const s = m.stock;
    if (!s.disponible) return '<div class="aviso-box">' + esc(s.motivo) + '</div>';
    const r = s.resumen;
    return tarjetas([['SKU comparados', ent(r.skus)], ['Riesgo de sobreventa', ent(r.sobreventa), 'Mercado Libre vende y Bsale no tiene'], ['Venta perdida', ent(r.ventaPerdida), 'Bsale tiene y Mercado Libre está en 0'], ['Cantidades distintas', ent(r.desfase)], ['SKU que no existe en Bsale', ent(r.sinSkuEnBsale)], ['Publicaciones sin SKU', ent(s.sinSku), 'no se pueden cruzar']]) +
      h('Diferencias entre Mercado Libre y Bsale') +
      tabla([['SKU', f => esc(f.sku)], ['Producto', f => esc(f.titulo || '')], ['Publicaciones', f => ent(f.publicaciones), 'text-align:right;'], ['Stock Mercado Libre', f => ent(f.stockMl), 'text-align:right;'], ['Stock Bsale', f => ent(f.stockBsale), 'text-align:right;'],
        ['Diferencia', f => (f.diferencia == null ? '—' : ent(f.diferencia)), 'text-align:right;'], ['Situación', f => insignia(ESTADOS_STOCK[f.estado] || f.estado, f.estado === 'sobreventa' ? '#DC2626' : '#B45309')]], s.filas, 'Todo el stock coincide.') +
      nota('Se cruza por SKU (el SKU de Bsale debe estar en el campo SKU de cada publicación). Si varias publicaciones comparten un SKU, se suma su stock. Solo se mira; el ERP no cambia el stock de Mercado Libre.');
  }
  function vCanal(m) {
    const c = m.canal;
    if (!c.disponible) return '<div class="aviso-box">' + esc(c.motivo) + '</div>';
    const r = c.resumen;
    return tarjetas([['SKU con venta en ML', ent(r.skusConVentaMl)], ['Unidades en Mercado Libre', ent(r.unidadesMl)], ['Unidades según Bsale (mismos SKU)', ent(r.unidadesBsale)], ['Líneas de venta sin SKU', ent(r.ventasMlSinSku)]]) +
      h('Mercado Libre frente a Bsale, por SKU') +
      tabla([['SKU', f => esc(f.sku)], ['Producto', f => esc(f.titulo || '')], ['Unid. Mercado Libre', f => ent(f.unidadesMl), 'text-align:right;'], ['Ingresos Mercado Libre', f => clp(f.ingresosMl), 'text-align:right;'],
        ['Unid. Bsale', f => ent(f.unidadesBsale), 'text-align:right;'], ['Ingresos Bsale', f => clp(f.ingresosBsale), 'text-align:right;'], ['ML / Bsale', f => pct(f.razon, 0), 'text-align:right;']], c.filas, 'Sin ventas con SKU en el período.') +
      nota('Bsale suma lo vendido en todos los canales. Si las ventas de Mercado Libre también se facturan en Bsale, «ML / Bsale» es la participación de Mercado Libre en ese SKU; si no se facturan ahí, es solo una comparación de volumen. Dime cuál es tu caso y lo dejo calculado como participación real.');
  }

  const TABS = [['resumen', 'Resumen', vResumen], ['embudo', 'Embudo', vEmbudo], ['margen', 'Margen', vMargen], ['reputacion', 'Reputación', vReputacion], ['atencion', 'Atención', vAtencion], ['publicidad', 'Publicidad', vPublicidad], ['stock', 'Stock', vStock], ['canal', 'Canal', vCanal]];
  function dibujarMetricas() {
    const cont = $('contenidoMetricas');
    if (!metricas) { cont.innerHTML = '<p class="empty-note">Cargando...</p>'; return; }
    if (!metricas.hayDatos) {
      $('tabsMetricas').style.display = 'none';
      cont.innerHTML = '<p class="empty-note">Todavía no hay datos de Mercado Libre. Aprieta <b>Actualizar datos</b> para traer las publicaciones, visitas, órdenes, preguntas y reputación.</p>';
      return;
    }
    $('tabsMetricas').style.display = 'flex';
    $('tabsMetricas').innerHTML = TABS.map(t => '<button class="tab' + (t[0] === tabActiva ? ' activa' : '') + '" onclick="MLMetricas.tab(\'' + t[0] + '\')">' + t[1] + '</button>').join('');
    const t = TABS.find(x => x[0] === tabActiva) || TABS[0];
    cont.innerHTML = t[2](metricas);
  }
  async function cargarMetricas() {
    try {
      metricas = await pedir('metricas');
      dibujarMetricas();
    } catch (err) {
      $('contenidoMetricas').innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
    }
  }

  async function iniciar() {
    $('seccionDatos').style.display = '';
    try {
      const est = await pedir('sync-estado');
      dibujarProgreso(est);
    } catch (err) { /* sin estado todavía */ }
    cargarMetricas();
  }
  window.MLMetricas = { iniciar, actualizarDatos, tab: t => { tabActiva = t; dibujarMetricas(); }, ocultar: () => { $('seccionDatos').style.display = 'none'; } };
})();

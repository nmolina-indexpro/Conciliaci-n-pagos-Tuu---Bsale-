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
  let rangoPedido = { desde: null, hasta: null }; // vacío = últimos 30 días

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

  const fechaCorta = iso => { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '—'; };
  const periodo = m => (m.rango ? fechaCorta(m.rango.desde) + ' al ' + fechaCorta(m.rango.hasta) + ' (' + m.rango.dias + (m.rango.dias === 1 ? ' día' : ' días') + ')' : 'últimos ' + m.ventanaDias + ' días');
  // ---------------------------------------------------------------- una función por cosa que se mide
  function vResumen(m) {
    const e = m.embudo.resumen, g = m.margen.resumen, gn = m.margenNeto.resumen, a = m.atencion.resumen, r = m.reputacion.actual, p = m.publicidad;
    const nivel = r && r.nivel ? (NIVELES[r.nivel] || [r.nivel, '#6B7568']) : null;
    return '<p class="empty-note">Período: ' + periodo(m) + ' · datos guardados el ' + esc(fechaHora(m.actualizadoEn)) + '</p>' +
      tarjetas([
        ['Visitas', ent(e.visitas), ent(e.publicacionesActivas) + ' publicaciones activas'],
        ['Órdenes', ent(e.ordenes), ent(e.unidades) + ' unidades'],
        ['Conversión', pct(e.conversion, 2), 'órdenes / visitas'],
        ['Ingresos', clp(e.ingresos), 'precio de venta, sin descontar comisión'],
        ['Margen (precios con IVA)', g.margen == null ? '—' : clp(g.margen), g.margenPct == null ? 'faltan costos de Bsale' : pct(g.margenPct) + ' · ' + g.publicacionesConCosto + ' de ' + g.publicacionesVendidas + ' publicaciones con costo'],
        ['Margen neto de IVA', gn.margen == null ? '—' : clp(gn.margen), gn.margenPct == null ? 'faltan costos de Bsale' : pct(gn.margenPct) + ' sobre el ingreso neto'],
        ['Comisión + envío', pct((g.comisionPct || 0) + (g.envioPct || 0)), 'comisión ' + pct(g.comisionPct) + ' · envío ' + pct(g.envioPct)],
        ['Reputación', nivel ? '<span style="color:' + nivel[1] + ';">' + esc(nivel[0]) + '</span>' : '—', r ? 'reclamos ' + pct(r.reclamos) + ' · cancelaciones ' + pct(r.cancelaciones) : ''],
        ['Preguntas sin responder', ent(a.sinResponder), 'mediana de respuesta ' + minutos(a.medianaMinutos)],
        ['Publicidad (ACOS)', p.disponible ? pct(p.acos) : '—', p.disponible ? 'gasto ' + clp(p.gasto) : 'no disponible'],
      ]);
  }
  function vEmbudo(m) {
    const e = m.embudo.resumen;
    const filas = m.embudo.filas;
    return tarjetas([['Visitas', ent(e.visitas)], ['Órdenes', ent(e.ordenes)], ['Conversión global', pct(e.conversion, 2)], ['Con tráfico y sin ventas', ent(e.traficoSinVentas), 'publicaciones con visitas (30 por cada 30 días del período) y ninguna orden']]) +
      h('Publicaciones activas: visitas → órdenes') +
      tabla([
        ['Publicación', f => titulo(f)], ['SKU', f => esc(f.sku || '—')], ['Visitas', f => ent(f.visitas), 'text-align:right;'], ['Órdenes', f => ent(f.ordenes), 'text-align:right;'],
        ['Unidades', f => ent(f.unidades), 'text-align:right;'], ['Conversión', f => pct(f.conversion, 2), 'text-align:right;'], ['Ingresos', f => clp(f.ingresos), 'text-align:right;'],
        ['Alerta', f => f.banderas.map(b => insignia(BANDERAS[b] || b, b === 'trafico_sin_ventas' ? '#DC2626' : '#B45309')).join(' ')],
      ], filas, 'Aún no hay publicaciones: actualiza los datos.') +
      nota('<b>Cómo leerlo:</b> mucha visita y ninguna orden suele ser precio, fotos, título o envío que no convence; poca visita es posicionamiento o publicidad. La conversión es órdenes / visitas del período (' + periodo(m) + ').');
  }
  // ---------------------------------------------------------------- Margen: lo vendido y el catálogo completo de Bsale
  let ivaNeto = true; // valores netos de IVA (el costo de Bsale es neto)
  const cat = { q: '', filtro: 'todos', col: 'unidades', dir: -1, mostrar: 200 };
  const MARGEN_BAJO = 0.10;

  function vModeloMargen(datos, titulo, explicacion) {
    const g = datos.resumen;
    return h(titulo) + '<div class="empty-note" style="margin:-2px 0 8px;line-height:1.5;">' + explicacion + '</div>' +
      tarjetas([
        ['Margen', g.margen == null ? '—' : clp(g.margen), g.margenPct == null ? '' : pct(g.margenPct) + ' sobre lo vendido con costo'],
        ['Ingresos', clp(g.ingresos)], ['Comisión de Mercado Libre', clp(g.comision), pct(g.comisionPct) + ' de lo vendido'], ['Envío que paga el vendedor', clp(g.envio), pct(g.envioPct) + ' de lo vendido'],
        ['Ventas con margen bajo', ent(g.ventasBajoMargen), 'publicaciones con menos de 10%'],
      ]) +
      tabla([
        ['Publicación', f => esc(f.titulo || f.itemId)], ['SKU', f => esc(f.sku || '—')], ['Unidades', f => ent(f.unidades), 'text-align:right;'], ['Ingresos', f => clp(f.ingresos), 'text-align:right;'],
        ['Comisión', f => clp(f.comision), 'text-align:right;'], ['Envío', f => clp(f.envio) + (f.envioPendiente ? ' *' : ''), 'text-align:right;'], ['Costo Bsale', f => f.costo == null ? '<span class="empty-note">sin costo</span>' : clp(f.costo) + (f.costoCompleto ? '' : ' *'), 'text-align:right;'],
        ['Margen', f => f.margen == null ? '—' : '<b style="color:' + (f.margen < 0 ? 'var(--red)' : 'inherit') + ';">' + clp(f.margen) + '</b>', 'text-align:right;'], ['Margen %', f => pct(f.margenPct), 'text-align:right;'],
      ], datos.filas, 'Sin ventas en el período.');
  }

  // economía por unidad de una fila del catálogo, con o sin IVA (el costo de Bsale no se divide: ya es neto)
  function econ(r) {
    const f = ivaNeto ? 1 / (1 + ((metricas.catalogo && metricas.catalogo.iva) || 0.19)) : 1;
    const completo = r.precio != null && r.costo != null && r.comision != null && r.envio != null;
    const margen = completo ? (r.precio - r.comision - r.envio) * f - r.costo : null;
    return {
      precioLista: r.precioLista == null ? null : r.precioLista * f, precioPublicado: r.precioPublicado == null ? null : r.precioPublicado * f,
      precio: r.precio == null ? null : r.precio * f, comision: r.comision == null ? null : r.comision * f, envio: r.envio == null ? null : r.envio * f,
      margen, pct: margen != null && r.precio ? margen / (r.precio * f) : null, ingresos: r.ingresos * f,
      margenPeriodo: margen != null && r.unidades ? margen * r.unidades : null,
    };
  }
  const VALOR_ORDEN = {
    sku: r => r.sku, nombre: r => r.nombre, enMl: r => (r.estadoMl === 'activa' ? 2 : r.estadoMl === 'pausada' ? 1 : 0),
    precioLista: (r, e) => e.precioLista, precioPublicado: (r, e) => e.precioPublicado, precio: (r, e) => e.precio, costo: r => r.costo, comision: (r, e) => e.comision, envio: (r, e) => e.envio, margen: (r, e) => e.margen, pct: (r, e) => e.pct,
    unidades: r => r.unidades, ingresos: (r, e) => e.ingresos, margenPeriodo: (r, e) => e.margenPeriodo,
  };
  function filasCatalogo() {
    const c = metricas.catalogo, q = cat.q.trim().toLowerCase();
    let filas = c.filas.map(r => ({ r, e: econ(r) }));
    filas = filas.filter(({ r, e }) => {
      if (q && !((r.sku || '') + ' ' + (r.nombre || '') + ' ' + r.publicaciones.map(p => p.titulo || '').join(' ')).toLowerCase().includes(q)) return false;
      switch (cat.filtro) {
        case 'enMl': return r.estadoMl === 'activa';
        case 'pausadas': return r.estadoMl === 'pausada';
        case 'sinPublicar': return r.enBsale && !r.estadoMl;
        case 'conVentas': return r.unidades > 0;
        case 'sinCosto': return r.enBsale && r.costo == null;
        case 'bajo': return e.pct != null && e.pct < MARGEN_BAJO;
        case 'negativo': return e.margen != null && e.margen < 0;
        case 'sinBsale': return !r.enBsale;
        case 'precioDistinto': return r.precioDistinto;
        case 'sinPrecioLista': return r.enBsale && r.estadoMl === 'activa' && r.precioLista == null;
        case 'potencial': return r.enBsale && !r.estadoMl && r.precioLista != null;
        default: return true;
      }
    });
    const get = VALOR_ORDEN[cat.col] || VALOR_ORDEN.unidades;
    filas.sort((a, b) => {
      const x = get(a.r, a.e), y = get(b.r, b.e);
      if (x == null && y == null) return 0;
      if (x == null) return 1;      // sin dato siempre al final
      if (y == null) return -1;
      const c = typeof x === 'string' ? x.localeCompare(y, 'es') : x - y;
      return c * cat.dir || (a.r.sku || '').localeCompare(b.r.sku || '', 'es');
    });
    return filas;
  }
  const marca = (estimado, texto) => (estimado && texto !== '—' ? '<span title="Estimado con la comisión y el envío que se observan en tus órdenes de los últimos 90 días" style="color:var(--muted);">≈ </span>' + texto : texto);
  function dibujarCatalogo() {
    const cont = $('catTabla');
    if (!cont || !metricas || !metricas.catalogo) return;
    const c = metricas.catalogo;
    if (!c.disponible) { cont.innerHTML = '<div class="aviso-box">' + esc(c.motivo) + '</div>'; return; }
    const filas = filasCatalogo();
    const visibles = filas.slice(0, cat.mostrar);
    const COLS = [['enMl', 'En Mercado Libre'], ['sku', 'SKU'], ['nombre', 'Producto (Bsale)'], [null, 'Publicación'], ['precioLista', 'Precio lista Bsale (ML)'], ['precioPublicado', 'Precio publicado en ML'], ['precio', 'Precio usado en el margen'], ['costo', 'Costo Bsale'], ['comision', 'Comisión'], ['envio', 'Envío'],
      ['margen', 'Margen'], ['pct', 'Margen %'], ['unidades', 'Unidades'], ['ingresos', 'Ingresos'], ['margenPeriodo', 'Margen del período']];
    const flecha = col => (cat.col === col ? (cat.dir > 0 ? ' ▲' : ' ▼') : '');
    const num = 'text-align:right;white-space:nowrap;';
    const filaHtml = ({ r, e }) => {
      const pub = r.publicaciones[0];
      const estado = r.estadoMl === 'pausada' ? ' <span class="badge" style="background:#B4530922;color:#B45309;">Pausada</span>' : (!r.enBsale ? ' <span class="badge" style="background:#DC262622;color:#DC2626;">Sin SKU en Bsale</span>' : '');
      const pubHtml = pub ? '<a href="' + esc(pub.enlace || '#') + '" target="_blank" rel="noopener" title="' + esc(pub.titulo || pub.id) + '">' + esc((pub.titulo || pub.id).slice(0, 48)) + ((pub.titulo || '').length > 48 ? '…' : '') + '</a>' + (r.publicaciones.length > 1 ? ' <span class="empty-note">(+' + (r.publicaciones.length - 1) + ')</span>' : '') : '<span class="empty-note">—</span>';
      const mg = e.margen == null ? (r.costo == null && r.enBsale ? '<span class="empty-note" title="' + esc(r.motivoCosto || 'Sin costo en Bsale') + '">sin costo</span>' : '—') : '<b style="color:' + (e.margen < 0 ? 'var(--red)' : 'inherit') + ';">' + marca(r.estimado, clp(e.margen)) + '</b>';
      return '<tr><td style="white-space:nowrap;"><input type="checkbox" disabled ' + (r.estadoMl === 'activa' ? 'checked' : '') + ' title="' + (r.estadoMl === 'activa' ? 'Publicado y activo en Mercado Libre' : r.estadoMl === 'pausada' ? 'Publicación pausada' : 'No está en Mercado Libre') + '">' + estado + '</td>' +
        '<td>' + esc(r.sku || '—') + '</td><td>' + esc((r.nombre || '').slice(0, 70)) + '</td><td>' + pubHtml + '</td>' +
        '<td style="' + num + '">' + (e.precioLista == null ? '<span class="empty-note" title="Este SKU no tiene precio en la lista de Bsale">—</span>' : clp(e.precioLista)) + '</td>' +
        '<td style="' + num + '">' + (e.precioPublicado == null ? '—' : clp(e.precioPublicado)) + (r.precioDistinto ? ' <span class="badge" style="background:#DC262622;color:#DC2626;" title="El precio publicado en Mercado Libre (' + clp(r.precioPublicado) + ') es distinto al de la lista de Bsale (' + clp(r.precioLista) + ')">≠ lista</span>' : '') + '</td>' +
        '<td style="' + num + '" title="' + (r.precioFuente === 'ventas' ? 'Precio real al que se vendió en el período (promedio)' : r.precioFuente === 'lista' ? 'Precio de la lista de Bsale' : r.precioFuente === 'publicado' ? 'Precio publicado en Mercado Libre (el SKU no está en la lista de Bsale)' : '') + '">' + (e.precio == null ? '—' : clp(e.precio)) + (r.precioFuente ? ' <span class="empty-note" style="font-size:10.5px;">' + (r.precioFuente === 'ventas' ? 'real' : r.precioFuente === 'lista' ? 'lista' : 'publ.') + '</span>' : '') + '</td>' +
        '<td style="' + num + '">' + (r.costo == null ? '<span class="empty-note">—</span>' : clp(r.costo)) + '</td>' +
        '<td style="' + num + '">' + marca(r.comisionEst, e.comision == null ? '—' : clp(e.comision)) + '</td>' +
        '<td style="' + num + '">' + marca(r.envioEst, e.envio == null ? '—' : clp(e.envio)) + '</td>' +
        '<td style="' + num + '">' + mg + '</td><td style="' + num + '">' + (e.pct == null ? '—' : marca(r.estimado, pct(e.pct))) + '</td>' +
        '<td style="' + num + '">' + (r.unidades ? ent(r.unidades) : '—') + '</td><td style="' + num + '">' + (r.unidades ? clp(e.ingresos) : '—') + '</td>' +
        '<td style="' + num + '">' + (e.margenPeriodo == null ? '—' : clp(e.margenPeriodo)) + '</td></tr>';
    };
    cont.innerHTML = '<div style="margin:6px 0;" class="empty-note">Mostrando ' + ent(visibles.length) + ' de ' + ent(filas.length) + ' productos' + (filas.length !== c.filas.length ? ' (filtrados de ' + ent(c.filas.length) + ')' : '') + '. Haz clic en el título de una columna para ordenar.</div>' +
      '<div class="tabla-wrap" style="max-height:640px;overflow:auto;"><table data-sin-orden><thead><tr>' +
      COLS.map(([k, t]) => '<th' + (k ? ' style="cursor:pointer;user-select:none;" onclick="MLMetricas.catOrden(\'' + k + '\')"' : '') + '>' + esc(t) + flecha(k) + '</th>').join('') +
      '</tr></thead><tbody>' + (visibles.length ? visibles.map(filaHtml).join('') : '<tr><td colspan="15" class="empty-note" style="padding:14px;">Ningún producto coincide con el filtro.</td></tr>') + '</tbody></table></div>' +
      (filas.length > visibles.length ? '<div style="margin:10px 0;"><button class="btn-ghost btn-sm" onclick="MLMetricas.catMas()">Mostrar 200 más</button></div>' : '');
  }
  function vMargen(m) {
    const c = m.catalogo, r = c && c.disponible ? c.resumen : null;
    const datos = ivaNeto ? m.margenNeto : m.margen;
    const opciones = [['todos', 'Todos los productos'], ['enMl', 'En Mercado Libre (activos)'], ['pausadas', 'Pausados en Mercado Libre'], ['sinPublicar', 'No publicados'], ['conVentas', 'Con ventas en el período'],
      ['sinCosto', 'Sin costo en Bsale'], ['bajo', 'Margen bajo (menos de 10%)'], ['negativo', 'Margen negativo'], ['precioDistinto', 'Precio publicado distinto a la lista de Bsale'], ['sinPrecioLista', 'Activos sin precio en la lista de Bsale'],
      ['potencial', 'No publicados con precio en la lista'], ['sinBsale', 'Publicaciones sin SKU en Bsale']];
    return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;"><span class="empty-note" style="font-weight:700;">Valores</span>' +
      '<button class="btn-' + (ivaNeto ? 'primary' : 'ghost') + ' btn-sm" onclick="MLMetricas.setIva(true)">Netos de IVA (recomendado)</button>' +
      '<button class="btn-' + (ivaNeto ? 'ghost' : 'primary') + ' btn-sm" onclick="MLMetricas.setIva(false)">Con IVA</button>' +
      '<span class="empty-note">Período: ' + periodo(m) + '. El costo de Bsale es neto, por eso lo comparable es el precio sin IVA.</span></div>' +
      vModeloMargen(datos, 'Modelo 1: lo vendido en el período', 'Publicaciones con ventas en el período: ingreso, comisión y envío reales de las órdenes, menos el costo de Bsale.') +
      h('Modelo 2: catálogo completo de Bsale') +
      '<div class="empty-note" style="margin:-2px 0 8px;line-height:1.5;">Todos los productos de Bsale, estén o no en Mercado Libre. El check indica si tienen una publicación <b>activa</b>. Para lo vendido en el período los valores son reales; para lo que no vendió se usa el precio de la <b>lista de Bsale «LISTA PRECIOS MERCADO LIBRE»</b> (o el publicado si el SKU no está en esa lista) con la comisión y el envío que se observan en tus órdenes (marcado con ≈). «Precio publicado en ML» es el que hoy tiene la publicación y se marca ≠ lista si difiere de la lista de Bsale.</div>' +
      (r ? tarjetas([['Productos en Bsale', ent(r.productos)], ['Activos en Mercado Libre', ent(r.activas), pct(r.productos ? r.activas / r.productos : null, 0) + ' del catálogo'], ['Pausados', ent(r.pausadas)], ['No publicados', ent(r.sinPublicar)],
        ['Con ventas en el período', ent(r.conVentas)], ['Sin costo en Bsale', ent(r.sinCosto), 'no se puede calcular su margen'], ['Publicaciones sin SKU en Bsale', ent(r.mlSinBsale), 'no se pueden emparejar'],
        ['Precio publicado ≠ lista', ent(r.preciosDistintos), 'activos con más de 1% de diferencia'], ['Activos sin precio en la lista', ent(r.activasSinPrecioLista)], ['No publicados con precio en la lista', ent(r.potencial), 'se puede estimar su margen']]) +
      (c.lista && c.lista.nombre ? '<div class="empty-note" style="margin-bottom:6px;">Lista de precios de Bsale usada como precio de Mercado Libre: <b>' + esc(c.lista.nombre) + '</b> (con IVA).</div>' : '') : '') +
      (c && c.disponible ? '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;"><input type="search" id="catBuscar" placeholder="Buscar por SKU, producto o publicación..." value="' + esc(cat.q) + '" oninput="MLMetricas.catQ(this.value)" style="flex:1 1 260px;max-width:380px;">' +
        '<select id="catFiltro" onchange="MLMetricas.catFiltro(this.value)">' + opciones.map(o => '<option value="' + o[0] + '"' + (cat.filtro === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' : '') +
      '<div id="catTabla"></div>' +
      nota('<b>Margen = precio − comisión − envío del vendedor − costo de Bsale</b>, por unidad. El precio es el real si vendió en el período; si no, el de la lista de Bsale. «Margen del período» = margen por unidad × unidades vendidas. El costo es el promedio de Bsale. Los productos sin costo en Bsale no tienen margen calculable. La comisión y el envío observados hoy: ' +
        (c && c.disponible ? 'comisión ' + pct(c.tasas.comision) + ' · envío ' + pct(c.tasas.envio) + ' del precio.' : 'sin datos.') + ' * Dato incompleto: el costo de envío todavía no se consulta o algunas unidades no tienen costo.');
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
      ['Preguntas', ent(a.preguntas), periodo(m)], ['Respondidas', pct(a.porcentajeRespondidas), ent(a.respondidas) + ' de ' + ent(a.preguntas)],
      ['Sin responder', ent(a.sinResponder), ent(a.sinResponderMas24h) + ' con más de 24 horas'], ['Tiempo mediano', minutos(a.medianaMinutos)],
      ['Respondidas en 1 hora', pct(a.dentroDe1h), 'en 24 horas: ' + pct(a.dentroDe24h)], ['Preguntas por orden', a.preguntasPorOrden == null ? '—' : a.preguntasPorOrden.toFixed(1).replace('.', ',')],
    ]) + h('Publicaciones con muchas preguntas y ninguna venta') +
      tabla([['Publicación', f => esc(f.titulo || f.itemId)], ['SKU', f => esc(f.sku || '—')], ['Preguntas', f => ent(f.preguntas), 'text-align:right;'], ['Visitas', f => ent(f.visitas), 'text-align:right;']], m.atencion.preguntasSinVenta, 'Ninguna publicación con 3 preguntas o más sin ventas.') +
      nota('Responder rápido mejora la conversión y la reputación. Una publicación con muchas preguntas y sin ventas suele tener una duda sin resolver en la ficha (compatibilidad, garantía, envío): conviene agregarla al texto. No se guardan los textos de las preguntas ni datos de compradores.');
  }
  function vPublicidad(m) {
    const p = m.publicidad;
    if (!p.disponible) return '<div class="aviso-box">Publicidad no disponible: ' + esc(p.motivo || '') + '</div>' + nota('Si la cuenta no usa Product Ads, no hay publicidad que medir aquí y esta pestaña puede ignorarse. Si la usa y aun así no aparece, puede faltar el permiso de publicidad en la aplicación de Mercado Libre.');
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
    if (tabActiva === 'margen') dibujarCatalogo();
  }
  const PRESETS = [7, 14, 30, 90];
  const diasAtras = (n, hoy) => { const d = new Date(hoy + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  function dibujarFiltro() {
    const cont = $('filtroFechas'), r = metricas && metricas.rango;
    if (!r || !metricas.hayDatos) { cont.style.display = 'none'; return; }
    cont.style.display = '';
    const activo = n => r.hasta === r.hoy && r.desde === diasAtras(n - 1, r.hoy);
    cont.innerHTML = '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
      '<span class="empty-note" style="font-weight:700;">Período</span>' +
      PRESETS.map(n => '<button class="btn-' + (activo(n) ? 'primary' : 'ghost') + ' btn-sm" onclick="MLMetricas.preset(' + n + ')">Últimos ' + n + ' días</button>').join('') +
      '<span class="empty-note" style="margin-left:6px;">Desde</span><input type="date" id="fDesde" value="' + esc(r.desde) + '" min="' + esc(r.minimo) + '" max="' + esc(r.hoy) + '">' +
      '<span class="empty-note">hasta</span><input type="date" id="fHasta" value="' + esc(r.hasta) + '" min="' + esc(r.minimo) + '" max="' + esc(r.hoy) + '">' +
      '<button class="btn-ghost btn-sm" onclick="MLMetricas.aplicarRango()">Aplicar</button></div>' +
      '<div class="empty-note" style="margin-top:4px;">Se puede elegir cualquier rango dentro de los últimos ' + r.maximoDias + ' días. Reputación, stock y publicidad muestran siempre lo último guardado.</div>';
  }
  function aplicarRango() {
    const d = $('fDesde').value, h = $('fHasta').value;
    if (!d || !h) { alert('Elige las dos fechas'); return; }
    if (d > h) { alert('La fecha inicial no puede ser posterior a la final'); return; }
    rangoPedido = { desde: d, hasta: h };
    cargarMetricas();
  }
  function preset(n) {
    const hoy = metricas && metricas.rango ? metricas.rango.hoy : new Date().toISOString().slice(0, 10);
    rangoPedido = { desde: diasAtras(n - 1, hoy), hasta: hoy };
    cargarMetricas();
  }
  async function cargarMetricas() {
    try {
      $('contenidoMetricas').style.opacity = '.5';
      metricas = await pedir('metricas', 'GET', rangoPedido.desde ? '&desde=' + encodeURIComponent(rangoPedido.desde) + '&hasta=' + encodeURIComponent(rangoPedido.hasta) : '');
      $('contenidoMetricas').style.opacity = '';
      dibujarFiltro();
      dibujarMetricas();
    } catch (err) {
      $('contenidoMetricas').style.opacity = '';
      $('contenidoMetricas').innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
    }
  }

  async function diagnostico() {
    const b = $('btnDiagnostico'), cont = $('resultadoDiagnostico');
    b.disabled = true; cont.innerHTML = '<p class="empty-note">Consultando Mercado Libre...</p>';
    try {
      const d = await pedir('diagnostico');
      if (!d.ok) { cont.innerHTML = '<div class="error-box">' + esc(d.error) + '</div>'; return; }
      cont.innerHTML = '<div class="empty-note" style="margin:8px 0;">Respuestas reales de Mercado Libre (recortadas, sin datos de compradores). Si algún dato sale vacío en las métricas, copia esto y mándamelo.</div>' +
        d.resultados.map(r => '<div style="margin:8px 0;"><b>' + esc(r.nombre) + '</b> ' + (r.estado === 'ok' ? '<span style="color:var(--green);">OK</span>' : '<span style="color:var(--red);">Error' + (r.http ? ' ' + r.http : '') + '</span>') +
          ' <code style="font-size:11.5px;">' + esc(r.ruta) + '</code><pre style="background:var(--surface-2);border-radius:8px;padding:8px 10px;font-size:11.5px;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;margin:4px 0 0;">' + esc(r.muestra) + '</pre></div>').join('');
    } catch (err) {
      cont.innerHTML = '<div class="error-box">' + esc(err.message) + '</div>';
    } finally { b.disabled = false; }
  }

  async function iniciar() {
    $('seccionDatos').style.display = '';
    try {
      const est = await pedir('sync-estado');
      dibujarProgreso(est);
    } catch (err) { /* sin estado todavía */ }
    cargarMetricas();
  }
  window.MLMetricas = {
    iniciar, actualizarDatos, diagnostico, preset, aplicarRango,
    setIva: v => { ivaNeto = Boolean(v); dibujarMetricas(); },
    catQ: v => { cat.q = v; cat.mostrar = 200; dibujarCatalogo(); },
    catFiltro: v => { cat.filtro = v; cat.mostrar = 200; dibujarCatalogo(); },
    catOrden: col => { if (cat.col === col) cat.dir = -cat.dir; else { cat.col = col; cat.dir = (col === 'sku' || col === 'nombre') ? 1 : -1; } dibujarCatalogo(); },
    catMas: () => { cat.mostrar += 200; dibujarCatalogo(); }, tab: t => { tabActiva = t; dibujarMetricas(); }, ocultar: () => { $('seccionDatos').style.display = 'none'; } };
})();

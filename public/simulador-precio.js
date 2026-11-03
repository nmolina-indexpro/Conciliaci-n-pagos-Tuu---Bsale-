// /public/simulador-precio.js
// "Frecuencia y simulador de precio" de Productos estancados. Se abre por SKU con
//   abrirSimuladorPrecio({ sku, nombre, stock, esAdmin, costoNeto })     // costoNeto solo se manda a un admin (null = sin costo registrado)
// Trae de /api/negocio?recurso=frecuencia-precio-sku (lib/frecuencia-precio.js) cada cuántos días vende el SKU, su serie mensual con el precio y qué
// pasó con las unidades cuando se bajó el precio en todo el catálogo, y deja probar un precio nuevo: unidades = actuales x (precio nuevo / precio actual)^-E,
// con la elasticidad E a elección (prudente, media, alta u observada en las ventas propias). Es una guía: no considera competencia ni temporada.
// Con el stock y la reposición en camino (Compras > Productos en tránsito: llegada a Chile + 5 a 7 días de aduana) dice cuándo se agota el stock y si habría quiebre antes de que llegue la carga.
(function () {
  if (window.abrirSimuladorPrecio) return;
  const IVA = 1.19, DIAS_MES = 30.4;
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const ESC = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, d = 0) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
  const mon = n => '$' + num(Math.round(n));
  const signo = (n, d = 0) => (n > 0 ? '+' : '') + num(n, d) + ' %';
  const mesTxt = m => { const [y, mm] = m.split('-'); return MESES[Number(mm) - 1] + ' ' + y; };

  const css = document.createElement('style');
  css.textContent = `
  .sp-overlay{display:none;position:fixed;inset:0;background:rgba(31,42,36,.45);z-index:120;align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto;}
  .sp-overlay.open{display:flex;}
  .sp-box{background:var(--surface,#fff);border-radius:16px;padding:22px 26px;box-shadow:0 8px 32px rgba(0,0,0,.25);width:min(920px,100%);box-sizing:border-box;}
  .sp-box h3{margin:0;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:17px;}
  .sp-box h4{margin:20px 0 8px;font-family:'Space Grotesk',sans-serif;font-size:13.5px;}
  .sp-sub{color:var(--muted,#6b7a72);font-size:12px;margin-top:2px;}
  .sp-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px;}
  .sp-card{border:1.5px solid var(--line,#dfe6e2);border-radius:10px;padding:10px 12px;background:var(--surface-2,#f6f8f7);}
  .sp-card b{display:block;font-size:18px;font-family:'IBM Plex Mono',monospace;margin-top:2px;}
  .sp-card span{font-size:11px;color:var(--muted,#6b7a72);}
  .sp-box table{width:100%;border-collapse:collapse;font-size:12.5px;}
  .sp-box td.num,.sp-box th.num{text-align:right;font-family:'IBM Plex Mono',monospace;}
  .sp-barra{display:inline-block;height:8px;border-radius:4px;background:var(--primary,#0F766E);vertical-align:middle;margin-left:6px;opacity:.75;}
  .sp-nota{font-size:12px;color:var(--muted,#6b7a72);line-height:1.5;margin:6px 0;}
  .sp-aviso{font-size:12px;line-height:1.5;margin:8px 0;padding:8px 12px;border-radius:8px;background:#FFF4D6;color:#7a4a05;}
  .sp-ok{background:#E3F6EA;color:#14693a;} .sp-mal{background:#FDE6E6;color:#a12626;}
  .sp-form{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:flex-end;margin:10px 0 4px;}
  .sp-form label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted,#6b7a72);}
  .sp-form input,.sp-form select{border:1.5px solid var(--line,#dfe6e2);border-radius:8px;padding:7px 10px;font-size:13px;background:var(--surface,#fff);color:var(--text,#1f2a24);font-family:inherit;}
  .sp-form input{width:130px;font-family:'IBM Plex Mono',monospace;}
  .sp-rapidos{display:flex;gap:6px;flex-wrap:wrap;}
  .sp-rapidos button{border:1.5px solid var(--line,#dfe6e2);background:var(--surface,#fff);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;font-weight:600;}
  .sp-rapidos button:hover{border-color:var(--primary,#0F766E);background:var(--primary-dim,#e4f3f0);}
  .sp-res{border:1.5px solid var(--primary,#0F766E);border-radius:12px;padding:6px 14px;margin-top:12px;}
  .sp-res .fila{display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px solid var(--line,#dfe6e2);font-size:13px;}
  .sp-res .fila:last-child{border-bottom:0;}
  .sp-res .fila b{font-family:'IBM Plex Mono',monospace;text-align:right;}
  .sp-cerrar{float:right;border:0;background:transparent;font-size:22px;cursor:pointer;color:var(--muted,#6b7a72);line-height:1;}
  `;
  document.head.appendChild(css);

  const overlay = document.createElement('div');
  overlay.className = 'sp-overlay';
  overlay.innerHTML = '<div class="sp-box"><button class="sp-cerrar" title="Cerrar" onclick="cerrarSimuladorPrecio()">×</button><div id="spCuerpo"></div></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('mousedown', ev => { if (ev.target === overlay) cerrarSimuladorPrecio(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrarSimuladorPrecio(); });
  const cuerpo = () => document.getElementById('spCuerpo');

  let est = null; // { ctx, datos, precioActual, precioNuevo, base, elast }

  window.cerrarSimuladorPrecio = function () { overlay.classList.remove('open'); est = null; };

  window.abrirSimuladorPrecio = async function (ctx) {
    overlay.classList.add('open');
    cuerpo().innerHTML = `<h3>📉 Frecuencia de venta y simulador de precio</h3><div class="sp-sub">${ESC(ctx.sku)} · ${ESC(ctx.nombre || '')}</div><p class="sp-nota">Analizando las ventas de los últimos 12 meses…</p>`;
    try {
      const res = await fetch('/api/negocio?recurso=frecuencia-precio-sku&sku=' + encodeURIComponent(ctx.sku));
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.detail || d.error || 'No se pudo analizar');
      est = { ctx, datos: d, precioActual: d.precioVigenteNeto != null ? Math.round(d.precioVigenteNeto * IVA) : null, precioNuevo: null, base: '12', elast: 'media' };
      if (d.evidencia && d.evidencia.confiable) est.elast = 'obs';
      if (est.precioActual != null) est.precioNuevo = Math.round(est.precioActual * 0.9);
      pintar();
    } catch (err) {
      cuerpo().innerHTML = `<h3>📉 Frecuencia de venta y simulador de precio</h3><div class="sp-sub">${ESC(ctx.sku)}</div><p class="sp-aviso sp-mal">No se pudo analizar: ${ESC(err.message)}</p>`;
    }
  };

  function pintar() {
    const { ctx, datos: d } = est;
    const sinVentas = d.ventas === 0;
    let h = `<h3>📉 Frecuencia de venta y simulador de precio</h3><div class="sp-sub">${ESC(ctx.sku)} · ${ESC(ctx.nombre || '')}</div>`;

    // ---- A) Cómo vende hoy ----
    h += '<h4>Cómo vende (últimos 12 meses)</h4>';
    if (sinVentas) {
      h += '<p class="sp-aviso">Este producto <b>no registra ventas en los últimos 12 meses</b>: no hay una frecuencia de venta de la cual partir, así que no se puede proyectar cuánto subiría con otro precio. Para estos productos conviene definir el precio mirando el mercado y medir el resultado después con "¿Funcionó?".</p>';
    } else {
      const meses = ctx.stock > 0 && d.unidadesPorMes > 0 ? ctx.stock / d.unidadesPorMes : null;
      h += `<div class="sp-cards">
        <div class="sp-card"><span>Ventas / unidades</span><b>${num(d.ventas)} / ${num(d.unidades)}</b></div>
        <div class="sp-card"><span>Frecuencia</span><b>1 venta cada ${num(d.diasEntreVentas)} d</b><span>${d.diasEntreVentasMediana != null ? 'entre una y otra, típico: ' + num(d.diasEntreVentasMediana) + ' d' : ''}</span></div>
        <div class="sp-card"><span>Unidades por mes</span><b>${num(d.unidadesPorMes, 1)}</b></div>
        <div class="sp-card"><span>Última venta</span><b>hace ${num(d.diasSinVenta)} d</b></div>
        <div class="sp-card"><span>Últimos 90 d vs 90 previos</span><b>${d.tendenciaPct != null ? signo(d.tendenciaPct) : '—'}</b><span>${num(d.ult90.unidades)} u. vs ${num(d.prev90.unidades)} u.</span></div>
        ${ctx.stock != null ? `<div class="sp-card"><span>Stock actual</span><b>${num(ctx.stock)} u.</b><span>${meses != null ? 'alcanza para ' + num(meses, 1) + ' meses a este ritmo (se agota ~' + fechaEn(meses * DIAS_MES) + ')' : ''}</span></div>` : ''}
        ${tarjetaReposicion(d)}
      </div>`;
      if (d.pocaHistoria) h += '<p class="sp-aviso">Este producto tiene poca historia de ventas (menos de 90 días): la frecuencia es todavía muy variable.</p>';
      if (d.ult90.ventas === 0) h += '<p class="sp-aviso">No vendió en los últimos 90 días: el ritmo de 12 meses puede ser optimista para hoy. Abajo puedes elegir los últimos 90 días como base.</p>';

      // ---- B) Mes a mes ----
      const maxU = Math.max(1, ...d.meses.map(m => m.unidades));
      h += '<h4>Mes a mes</h4><div style="overflow-x:auto;"><table><thead><tr><th>Mes</th><th class="num">Unidades</th><th class="num">Ventas</th><th class="num">Precio prom. (c/IVA)</th><th>Cambio de precio</th></tr></thead><tbody>';
      for (const m of d.meses) {
        const cambio = d.cambiosPrecio.find(c => c.hasta === m.mes);
        h += `<tr><td data-valor="${m.mes}">${mesTxt(m.mes)}${m.parcial ? ' <span class="sp-sub">(en curso)</span>' : ''}</td>
          <td class="num" data-valor="${m.unidades}">${num(m.unidades)}<span class="sp-barra" style="width:${Math.round(m.unidades / maxU * 90)}px"></span></td>
          <td class="num">${num(m.ventas)}</td>
          <td class="num">${m.precioNeto != null ? mon(m.precioNeto * IVA) : '—'}</td>
          <td>${cambio ? `<b style="color:${cambio.pct < 0 ? 'var(--red,#c0392b)' : 'var(--green,#1b8a4b)'}">${signo(cambio.pct, 1)}</b> <span class="sp-sub">(${num(cambio.unidadesAntes)} → ${num(cambio.unidadesDespues)} u.)</span>` : ''}</td></tr>`;
      }
      h += '</tbody></table></div>';
    }

    // ---- B2) Reposición en camino ----
    h += bloqueReposicion(d);

    // ---- C) Evidencia de bajas pasadas ----
    h += '<h4>¿Qué pasó antes cuando bajaron los precios?</h4>' + textoEvidencia(d);

    // ---- D) Simulador ----
    if (!sinVentas) {
      const ev = d.evidencia;
      const f10 = e => signo((Math.pow(0.9, -e) - 1) * 100);
      h += `<h4>Simular un precio nuevo</h4>
      <div class="sp-form">
        <label>Precio actual (c/IVA)<input id="spPrecioActual" value="${est.precioActual != null ? num(est.precioActual) : ''}" inputmode="numeric" oninput="spCambioPrecios()"></label>
        <label>Precio nuevo (c/IVA)<input id="spPrecioNuevo" value="${est.precioNuevo != null ? num(est.precioNuevo) : ''}" inputmode="numeric" oninput="spCambioPrecios()"></label>
        <div class="sp-rapidos">${[5, 10, 15, 20, 25].map(p => `<button type="button" onclick="spBajar(${p})">−${p} %</button>`).join('')}</div>
        <label>Ritmo de partida<select id="spBase" onchange="spCambioOpciones()">
          <option value="12" ${est.base === '12' ? 'selected' : ''}>Últimos 12 meses (${num(d.unidadesPorMes, 1)} u./mes)</option>
          <option value="90" ${est.base === '90' ? 'selected' : ''}>Últimos 90 días (${num(d.ult90.unidades / 90 * DIAS_MES, 1)} u./mes)</option></select></label>
        <label>Cuánto sube la venta al bajar el precio<select id="spElast" onchange="spCambioOpciones()">
          ${ev && ev.elasticidad ? `<option value="obs" ${est.elast === 'obs' ? 'selected' : ''}>Observado en tus ventas (−10 % de precio → ${f10(ev.elasticidad)} u.)${ev.confiable ? '' : ' · pocos datos'}</option>` : ''}
          <option value="prudente" ${est.elast === 'prudente' ? 'selected' : ''}>Prudente (−10 % de precio → ${f10(1)} u.)</option>
          <option value="media" ${est.elast === 'media' ? 'selected' : ''}>Media (−10 % de precio → ${f10(2)} u.)</option>
          <option value="alta" ${est.elast === 'alta' ? 'selected' : ''}>Alta: producto muy comparado (−10 % → ${f10(3)} u.)</option></select></label>
      </div>
      <div id="spSimulacion"></div>`;
    }
    cuerpo().innerHTML = h;
    if (!sinVentas) pintarSimulacion();
  }

  function textoEvidencia(d) {
    const ev = d.evidencia;
    let h = '';
    if (!ev) h += `<p class="sp-nota">No se pudo calcular la evidencia del catálogo${d.errorEvidencia ? ' (' + ESC(d.errorEvidencia) + ')' : ''}.</p>`;
    else if (!ev.bajas.eventos) h += '<p class="sp-nota">En los últimos 12 meses no hay bajas de precio (de 5 % o más) registradas en las ventas de ningún producto, así que no hay historia propia para medir el efecto.</p>';
    else {
      const b = ev.bajas, s = ev.estables;
      h += `<p class="sp-nota">En los últimos 12 meses hubo <b>${num(b.eventos)} bajas de precio</b> (mediana ${signo(b.bajaMedianaPct, 1)}) en ${num(b.skus)} productos. El mes siguiente las unidades vendidas cambiaron <b>${signo(b.cambioUnidadesPct)}</b>, mientras que en los productos que NO cambiaron de precio, esos mismos meses, cambiaron ${s.cambioUnidadesPct != null ? signo(s.cambioUnidadesPct) : '—'}. En ${num(b.pctSubieron)} % de las bajas las unidades subieron.</p>`;
      if (ev.elasticidad) h += `<p class="sp-nota">Eso equivale a una elasticidad de ≈ <b>${num(ev.elasticidad, 1)}</b>: bajar el precio 10 % se asoció a ${signo((Math.pow(0.9, -ev.elasticidad) - 1) * 100)} en unidades.${ev.confiable ? '' : ' <b>Son pocos casos: tómalo solo como referencia.</b>'}</p>`;
      else h += '<p class="sp-aviso">En conjunto, las unidades <b>no subieron más</b> en los productos que bajaron de precio que en los que no. No hay evidencia en tu historial de que bajar precios, por sí solo, haya aumentado las ventas (ojo: muchas bajas se hacen justo cuando un producto se enfría, y eso las hace verse peor de lo que son).</p>';
    }
    if (d.cambiosPrecio.length) h += '<p class="sp-nota"><b>En este producto:</b> ' + d.cambiosPrecio.map(c => `${mesTxt(c.desde)} → ${mesTxt(c.hasta)}: precio ${signo(c.pct, 1)}, unidades ${num(c.unidadesAntes)} → ${num(c.unidadesDespues)}`).join(' · ') + '.</p>';
    h += '<p class="sp-nota"><i>Es historial, no un experimento: no separa el efecto del precio del de la temporada, el stock, las promociones o la competencia.</i></p>';
    return h;
  }

  const ELAST = { prudente: 1, media: 2, alta: 3 };
  const elastActual = () => est.elast === 'obs' ? est.datos.evidencia.elasticidad : (ELAST[est.elast] || 2);
  const leerNum = id => { const v = String(document.getElementById(id).value || '').replace(/[^\d]/g, ''); return v ? Number(v) : null; };

  window.spCambioPrecios = function () { est.precioActual = leerNum('spPrecioActual'); est.precioNuevo = leerNum('spPrecioNuevo'); pintarSimulacion(); };
  window.spCambioOpciones = function () { est.base = document.getElementById('spBase').value; est.elast = document.getElementById('spElast').value; pintarSimulacion(); };
  window.spBajar = function (p) {
    est.precioActual = leerNum('spPrecioActual');
    if (!est.precioActual) return;
    est.precioNuevo = Math.round(est.precioActual * (1 - p / 100));
    document.getElementById('spPrecioNuevo').value = num(est.precioNuevo);
    pintarSimulacion();
  };

  // ---------- Reposición en camino ----------
  // La carga llega a Chile en la fecha de ETA y sale de aduana, por lo general, 5 a 7 días después: hasta entonces no se puede vender.
  const ADUANA_MIN = 5, ADUANA_MAX = 7;
  const aMs = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const sumarDias = (iso, n) => new Date(aMs(iso) + Math.round(n) * 86400000).toISOString().slice(0, 10);
  const diasDesdeHoy = iso => Math.round((aMs(iso) - aMs(est.datos.hoy)) / 86400000);
  const fechaTxt = iso => { const dd = new Date(aMs(iso)); return dd.getUTCDate() + ' ' + MESES[dd.getUTCMonth()] + (dd.getUTCFullYear() !== +est.datos.hoy.slice(0, 4) ? ' ' + dd.getUTCFullYear() : ''); };
  const fechaEn = dias => fechaTxt(sumarDias(est.datos.hoy, dias)); // fecha dentro de "dias" días
  // Cada envío con su ventana de disponibilidad, en días desde hoy
  function envios(d) {
    return (d.reposicion || []).filter(r => r.fechaEta).map(r => {
      let desde = diasDesdeHoy(r.fechaEta) + ADUANA_MIN, hasta = diasDesdeHoy(r.fechaEta) + ADUANA_MAX, atrasada = false;
      if (hasta < 0) { atrasada = true; desde = 0; hasta = 2; } // la ETA ya pasó y debería estar liberada: se asume que sale en los próximos días
      else if (desde < 0) desde = 0;
      return { ...r, desde, hasta, atrasada, liberadaDesde: sumarDias(d.hoy, desde), liberadaHasta: sumarDias(d.hoy, hasta) };
    }).sort((a, b) => a.hasta - b.hasta);
  }
  function tarjetaReposicion(d) {
    const e = envios(d);
    if (!e.length) return '';
    const total = e.reduce((s, x) => s + x.cantidad, 0), p = e[0];
    return `<div class="sp-card"><span>En camino</span><b>${num(total)} u.</b><span>${p.atrasada ? 'ETA ya pasó: por liberar' : 'llega a Chile ' + fechaTxt(p.fechaEta) + ', liberada ≈ ' + fechaTxt(p.liberadaDesde) + '–' + fechaTxt(p.liberadaHasta)}${e.length > 1 ? ' (+' + (e.length - 1) + ' envío' + (e.length > 2 ? 's' : '') + ')' : ''}</span></div>`;
  }
  function bloqueReposicion(d) {
    const e = envios(d);
    if (d.errorReposicion) return '<h4>Reposición en camino</h4><p class="sp-nota">No se pudo leer Productos en tránsito (' + ESC(d.errorReposicion) + ').</p>';
    if (!e.length) return '<h4>Reposición en camino</h4><p class="sp-nota">No hay ningún envío en Compras &gt; Productos en tránsito con este SKU: el cálculo de stock asume que no llega nada.</p>';
    let h = '<h4>Reposición en camino</h4><ul class="sp-nota" style="margin:4px 0;padding-left:18px;">';
    for (const x of e) {
      h += `<li><b>${num(x.cantidad)} u.</b> · envío ${ESC(x.referencia)}${x.tipoTransporte ? ' (' + (x.tipoTransporte === 'aereo' ? 'aéreo' : 'marítimo') + ')' : ''} · llega a Chile el <b>${fechaTxt(x.fechaEta)}</b> · liberada de aduana ≈ <b>${fechaTxt(x.liberadaDesde)}–${fechaTxt(x.liberadaHasta)}</b>${x.atrasada ? ' <span style="color:#a12626;">· la ETA ya pasó: confirma si llegó y se recibió en Bsale; aquí se asume que sale en los próximos días</span>' : ''}</li>`;
    }
    return h + `</ul><p class="sp-nota">Se estima que la carga sale de aduana de ${ADUANA_MIN} a ${ADUANA_MAX} días después de llegar a Chile y solo entonces se puede vender.</p>`;
  }
  // Cuándo se agota el stock a un ritmo (unidades/mes) y si hay quiebre antes de que llegue cada envío. Todo en días desde hoy.
  function proyectarStock(stock, ritmoMes) {
    const r = ritmoMes / DIAS_MES;
    if (!(r > 0)) return null;
    let sale = Math.max(0, stock || 0) / r;
    const agota = sale, quiebres = [], e = envios(est.datos);
    let sobra = null;
    e.forEach((x, i) => {
      if (sale >= x.hasta) { if (i === 0) sobra = Math.round((sale - x.hasta) * r); sale += x.cantidad / r; }
      else { quiebres.push({ min: Math.max(0, x.desde - sale), max: x.hasta - sale }); sale = x.hasta + x.cantidad / r; }
    });
    return { agota, fin: sale, quiebres, sobra, hayEnvios: e.length > 0 };
  }
  function veredicto(pr) {
    if (!pr || !pr.hayEnvios) return { txt: '—', mal: false };
    if (!pr.quiebres.length) return { txt: '✔ llega con ' + (pr.sobra != null ? '~' + num(pr.sobra) + ' u. de stock' : 'stock'), mal: false };
    const q = pr.quiebres[0], mn = Math.round(q.min), mx = Math.max(1, Math.round(q.max));
    return { txt: '⚠ quiebre ' + (mn >= 1 && mn !== mx ? mn + '–' + mx : mn >= 1 ? 'de ' + mx : 'hasta ' + mx) + ' d', mal: true };
  }
  function filaReposicion(pr0, pr1) {
    const e = envios(est.datos);
    if (!e.length) return est.ctx.stock > 0 ? '<div class="fila"><span>Reposición en tránsito</span><b class="sp-sub">ninguna registrada: al agotarse queda en quiebre</b></div>' : '';
    const a = veredicto(pr0), b = veredicto(pr1), total = e.reduce((s, x) => s + x.cantidad, 0);
    const color = v => v.mal ? 'color:#a12626;' : 'color:#14693a;';
    return `<div class="fila"><span>Reposición en camino (+${num(total)} u., liberada ≈ ${fechaTxt(e[0].liberadaDesde)}–${fechaTxt(e[0].liberadaHasta)})</span><b>Hoy: <span style="${color(a)}">${a.txt}</span><br>Con el precio nuevo: <span style="${color(b)}">${b.txt}</span></b></div>
      <div class="fila"><span>Con la reposición, el stock alcanza hasta</span><b>~${fechaEn(pr0.fin)} → ~${fechaEn(pr1.fin)}</b></div>`;
  }

  function pintarSimulacion() {
    const cont = document.getElementById('spSimulacion');
    if (!cont) return;
    const { ctx, datos: d } = est;
    const p0 = est.precioActual, p1 = est.precioNuevo;
    const baseUnid = est.base === '90' ? d.ult90.unidades / 90 * DIAS_MES : d.unidadesPorMes;
    const baseVentas = est.base === '90' ? d.ult90.ventas / 90 * DIAS_MES : d.ventasPorMes;
    if (!(p0 > 0)) { cont.innerHTML = '<p class="sp-nota">Escribe el precio actual (c/IVA) para simular.</p>'; return; }
    if (!(baseVentas > 0)) { cont.innerHTML = '<p class="sp-aviso">Con este ritmo de partida no hubo ventas (en los últimos 90 días no se vendió): elige "Últimos 12 meses" o define el precio mirando el mercado.</p>'; return; }
    const E = elastActual();
    const calc = pn => {
      const factor = Math.pow(pn / p0, -E);
      const unid = baseUnid * factor, ventas = baseVentas * factor;
      return { pn, factor, unid, diasVenta: DIAS_MES / ventas, mesesStock: ctx.stock > 0 && unid > 0 ? ctx.stock / unid : null };
    };
    const margenDe = pn => (ctx.costoNeto != null ? pn / IVA - ctx.costoNeto : null); // margen unitario neto
    const admin = !!ctx.esAdmin && ctx.costoNeto != null;
    const filaMargen = r => {
      const m0 = margenDe(p0), m1 = margenDe(r.pn);
      return { m0, m1, mensual0: m0 * baseUnid, mensual1: m1 * r.unid, necesario: m1 > 0 ? (m0 / m1 - 1) * 100 : null };
    };

    let h = '';
    if (p1 > 0) {
      const r = calc(p1), bajaPct = (p1 / p0 - 1) * 100;
      const pr0 = proyectarStock(ctx.stock, baseUnid), pr1 = proyectarStock(ctx.stock, r.unid);
      const aumento = (r.factor - 1) * 100;
      h += `<div class="sp-res">
        <div class="fila"><span>Precio (c/IVA)</span><b>${mon(p0)} → ${mon(p1)} (${signo(bajaPct, 1)})</b></div>
        <div class="fila"><span>Unidades por mes</span><b>${num(baseUnid, 1)} → ${num(r.unid, 1)} (${signo(aumento)})</b></div>
        <div class="fila"><span>Una venta cada</span><b>${num(DIAS_MES / baseVentas)} d → ${num(r.diasVenta)} d</b></div>
        ${ctx.stock > 0 ? `<div class="fila"><span>Stock actual (${num(ctx.stock)} u.) alcanza para</span><b>${num(ctx.stock / baseUnid, 1)} → ${num(r.mesesStock, 1)} meses<br><span class="sp-sub">se agota ~${fechaEn(pr0.agota)} → ~${fechaEn(pr1.agota)}</span></b></div>` : ''}
        ${filaReposicion(pr0, pr1)}`;
      if (admin) {
        const m = filaMargen(r);
        h += `<div class="fila"><span>Margen por unidad (sin IVA)</span><b>${mon(m.m0)} → ${mon(m.m1)}</b></div>
        <div class="fila"><span>Margen mensual</span><b>${mon(m.mensual0)} → ${mon(m.mensual1)} (${signo((m.mensual1 - m.mensual0) / Math.abs(m.mensual0 || 1) * 100)})</b></div>`;
        if (m.m1 <= 0) h += '<div class="fila"><span class="sp-mal" style="padding:6px 10px;border-radius:8px;">⚠ El precio nuevo queda por debajo del costo: cada venta pierde plata.</span><b></b></div>';
        else if (bajaPct < 0) h += `<div class="fila"><span>Para no perder margen total habría que vender</span><b>${signo(m.necesario)} unidades${aumento >= m.necesario ? ' ✔ la simulación lo supera' : ' ✖ la simulación no lo alcanza'}</b></div>`;
      }
      h += '</div>';
    }

    // Escenarios
    const hayRepos = envios(d).length > 0;
    h += '<h4 style="margin-top:16px;">Escenarios de baja</h4><div style="overflow-x:auto;"><table><thead><tr><th class="num">Baja</th><th class="num">Precio (c/IVA)</th><th class="num">Unid./mes</th><th class="num">Una venta cada (d)</th><th class="num">Stock alcanza (meses)</th>' + (hayRepos ? '<th>Reposición</th>' : '') + (admin ? '<th class="num">Margen mensual</th><th class="num">Venta extra necesaria</th>' : '') + '</tr></thead><tbody>';
    for (const p of [0, 5, 10, 15, 20, 25]) {
      const pn = Math.round(p0 * (1 - p / 100)), r = calc(pn);
      h += `<tr><td class="num" data-valor="${-p}">${p ? '−' + p + ' %' : 'Hoy'}</td><td class="num">${mon(pn)}</td><td class="num">${num(r.unid, 1)}</td><td class="num">${num(r.diasVenta)}</td><td class="num">${r.mesesStock != null ? num(r.mesesStock, 1) : '—'}</td>`;
      if (hayRepos) { const v = veredicto(proyectarStock(ctx.stock, r.unid)); h += `<td style="white-space:nowrap;${v.mal ? 'color:#a12626;font-weight:600;' : ''}">${v.txt}</td>`; }
      if (admin) { const m = filaMargen(r); h += `<td class="num">${mon(m.mensual1)}</td><td class="num">${!p ? '—' : m.necesario != null ? signo(m.necesario) : 'Sin margen'}</td>`; }
      h += '</tr>';
    }
    h += '</tbody></table></div>';
    if (!ctx.esAdmin) h += '<p class="sp-nota">El margen solo lo ve un administrador.</p>';
    else if (ctx.costoNeto == null) h += '<p class="sp-nota">Sin costo registrado en Bsale: no se puede calcular el margen.</p>';
    h += `<p class="sp-nota">Cálculo: unidades = ritmo de partida × (precio nuevo ÷ precio actual) elevado a −${num(E, 1)}. Es una guía para decidir, no una promesa: si después marcas "💲 Variación de precio" en el producto, la columna "¿Funcionó?" mide lo que pasó de verdad.</p>`;
    cont.innerHTML = h;
  }
})();

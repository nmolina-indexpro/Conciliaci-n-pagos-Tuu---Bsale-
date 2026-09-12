// /lib/comparadorProveedores.js
// Lógica de comparación de cotizaciones de proveedores para el módulo
// "Comparativa de proveedores" de Compras (Coimco vs Laptop Center hoy,
// pensado para N proveedores -- ver comparador_proveedores en lib/db.js).
// Sin llamadas a red ni a Postgres acá: recibe datos ya cargados y devuelve
// la tabla comparativa + la decisión recomendada. api/negocio.js hace las
// consultas y le pasa los datos a este servicio.

// ---------- Normalización de texto ----------

export function normalizarTexto(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // saca tildes
    .replace(/[^a-z0-9.,x"'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrae del texto (pedido o descripción de proveedor) las especificaciones
// técnicas que importan para decidir equivalencia (ver punto 4 y 20 del
// pedido del usuario). Heurística por regex -- no pretende ser perfecta,
// pero cualquier caso que no pueda determinar con confianza cae a "baja" o
// "revision" en evaluarEquivalencia, nunca se asume.
export function extraerEspecificaciones(textoOriginal) {
  const t = normalizarTexto(textoOriginal);
  const especificaciones = {};

  const voltaje = t.match(/(\d+(?:\.\d+)?)\s*v\b/);
  if (voltaje) especificaciones.voltaje = parseFloat(voltaje[1]);

  const amperaje = t.match(/(\d+(?:\.\d+)?)\s*a\b/);
  if (amperaje) especificaciones.amperaje = parseFloat(amperaje[1]);

  const watt = t.match(/(\d+(?:\.\d+)?)\s*w\b/);
  if (watt) especificaciones.watt = parseFloat(watt[1]);

  const conector = t.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*mm/);
  if (conector) especificaciones.conector = `${conector[1]}x${conector[2]}`;

  if (/usb[\s-]?c/.test(t)) especificaciones.usbC = true;

  const pantalla = t.match(/(\d{2}(?:\.\d)?)\s*(?:"|''|pulgadas)/);
  if (pantalla) especificaciones.tamanoPantalla = parseFloat(pantalla[1]);

  const pines = t.match(/\b(\d{2})\s*p\b/);
  if (pines) especificaciones.pines = parseInt(pines[1], 10);

  if (/\bfhd\b|full\s*hd/.test(t)) especificaciones.resolucion = 'FHD';
  else if (/\bhd\b/.test(t)) especificaciones.resolucion = 'HD';

  const hz = t.match(/(\d{2,3})\s*hz/);
  if (hz) especificaciones.hz = parseInt(hz[1], 10);

  if (/sin\s*bracket/.test(t)) especificaciones.bracket = false;
  else if (/\bbracket\b/.test(t)) especificaciones.bracket = true;

  if (/\bips\b/.test(t)) especificaciones.panel = 'IPS';
  else if (/\btn\b/.test(t)) especificaciones.panel = 'TN';

  // Modelo específico de panel, ej. NV140FHM-N48, N140JCA-EEK -- se busca
  // sobre el texto ORIGINAL (con mayúsculas) porque estos códigos son
  // case-sensitive en la práctica y normalizarTexto los pone en minúscula.
  const modelo = String(textoOriginal || '').match(/\b([A-Z]{2,4}\d{2,3}[A-Z]{1,4}-[A-Z0-9]{2,5})\b/);
  if (modelo) especificaciones.modeloPanel = modelo[1].toUpperCase();

  if (/\boriginal\b|\borg\b/.test(t)) especificaciones.tipo = 'original';
  else if (/alternativ[oa]/.test(t)) especificaciones.tipo = 'alternativo';

  return especificaciones;
}

const NIVELES_CONFIANZA = ['alta', 'media', 'baja', 'revision'];

// Compara las especificaciones detectadas en el pedido contra las
// detectadas en la descripción de un proveedor. Regla explícita del pedido
// del usuario (punto 5 y 20): nunca asumir equivalencia solo porque el
// tamaño o la potencia se "parecen" -- cualquier especificación que
// aparezca en AMBOS lados pero con valor distinto es un conflicto real
// (ej. IPS vs TN, HD vs FHD, bracket vs sin bracket) y baja la confianza a
// "revision" sin excepción.
export function evaluarEquivalencia(especificacionesPedido, especificacionesCotizacion) {
  const razones = [];

  // Modelo específico de panel: si el pedido lo pide, es el criterio que
  // manda por sobre cualquier otro spec (punto 4: "NO debe suponerse
  // automáticamente que otra pantalla genérica es equivalente").
  if (especificacionesPedido.modeloPanel) {
    if (!especificacionesCotizacion.modeloPanel) {
      return { confianza: 'revision', razones: [`Pedido pide el modelo específico ${especificacionesPedido.modeloPanel}; el proveedor no menciona ningún modelo de panel.`] };
    }
    if (especificacionesCotizacion.modeloPanel !== especificacionesPedido.modeloPanel) {
      return { confianza: 'revision', razones: [`Modelo de panel distinto: pedido ${especificacionesPedido.modeloPanel} vs proveedor ${especificacionesCotizacion.modeloPanel}.`] };
    }
    razones.push(`Modelo de panel coincide (${especificacionesPedido.modeloPanel}).`);
    return { confianza: 'alta', razones };
  }

  const campos = ['voltaje', 'amperaje', 'conector', 'tamanoPantalla', 'pines', 'resolucion', 'hz', 'bracket', 'panel', 'usbC'];
  let coincidencias = 0;
  let noVerificables = 0;
  for (const campo of campos) {
    const valorPedido = especificacionesPedido[campo];
    if (valorPedido === undefined) continue;
    const valorCotizacion = especificacionesCotizacion[campo];
    if (valorCotizacion === undefined) {
      noVerificables++;
      continue;
    }
    if (valorCotizacion !== valorPedido) {
      return { confianza: 'revision', razones: [`Diferencia técnica en ${campo}: pedido ${valorPedido} vs proveedor ${valorCotizacion}.`] };
    }
    coincidencias++;
    razones.push(`${campo} coincide (${valorPedido}).`);
  }

  if (coincidencias === 0 && noVerificables === 0) {
    return { confianza: 'baja', razones: ['No se detectaron especificaciones técnicas comparables en el pedido; equivalencia solo por nombre.'] };
  }
  if (noVerificables > 0) {
    return { confianza: 'media', razones: [...razones, `${noVerificables} especificación(es) del pedido no se pudo(eron) confirmar en la descripción del proveedor.`] };
  }
  return { confianza: 'alta', razones };
}

// ---------- Selección de proveedor ----------

const ESTADOS_STOCK_CON_STOCK = new Set(['disponible', 'parcial']);

// candidatosPorProveedor: [{ proveedorId, proveedorNombre, diasEntrega, item: cotizacionItem|null, confianza }]
// cotizacionItem trae precio_neto, estado_stock, cantidad_disponible.
// decisionManual: { proveedorSeleccionadoId, motivoAjuste } | null
export function decidirProveedor(candidatosPorProveedor, umbralAhorroMinimo, decisionManual) {
  const conCotizacion = candidatosPorProveedor.filter(c => c.item);
  const peorConfianza = conCotizacion.length === 0 ? null : conCotizacion.reduce((peor, c) => {
    const rango = NIVELES_CONFIANZA.indexOf(c.confianza);
    return rango > NIVELES_CONFIANZA.indexOf(peor) ? c.confianza : peor;
  }, 'alta');

  const conStock = conCotizacion.filter(c => ESTADOS_STOCK_CON_STOCK.has(c.item.estado_stock));

  let resultado;
  if (conStock.length === 0) {
    resultado = {
      estado: 'pendiente',
      proveedorRecomendadoId: null,
      precioRecomendado: null,
      motivo: conCotizacion.length === 0
        ? 'Sin cotización de ningún proveedor para este producto.'
        : 'Sin stock / sin cotización equivalente en ningún proveedor.',
      ahorroUnitario: null,
      alertaConveniencia: null,
    };
  } else {
    const ordenados = [...conStock].sort((a, b) => a.item.precio_neto - b.item.precio_neto);
    const masBarato = ordenados[0];
    const segundo = ordenados[1] || null;

    if (!segundo) {
      const sinStock = candidatosPorProveedor.filter(c => c !== masBarato);
      const nombresSinStock = sinStock.map(c => c.proveedorNombre).join(', ');
      resultado = {
        estado: 'comprar',
        proveedorRecomendadoId: masBarato.proveedorId,
        precioRecomendado: masBarato.item.precio_neto,
        motivo: sinStock.length > 0
          ? `${nombresSinStock} sin stock; ${masBarato.proveedorNombre} tiene disponibilidad.`
          : `Único proveedor con cotización para este producto.`,
        ahorroUnitario: null,
        alertaConveniencia: null,
      };
    } else {
      const diferencia = segundo.item.precio_neto - masBarato.item.precio_neto;
      const ahorroSuficiente = diferencia >= umbralAhorroMinimo;
      resultado = {
        estado: ahorroSuficiente ? 'comprar' : 'revisar_conveniencia',
        proveedorRecomendadoId: masBarato.proveedorId,
        precioRecomendado: masBarato.item.precio_neto,
        motivo: `${masBarato.proveedorNombre} es $${Math.round(diferencia).toLocaleString('es-CL')} neto más barato por unidad.`,
        ahorroUnitario: diferencia,
        alertaConveniencia: ahorroSuficiente
          ? null
          : (segundo.diasEntrega != null && masBarato.diasEntrega != null && segundo.diasEntrega < masBarato.diasEntrega
              ? `Ahorro marginal ($${Math.round(diferencia).toLocaleString('es-CL')}). Evaluar comprar a ${segundo.proveedorNombre} por menor tiempo de entrega.`
              : `Ahorro marginal ($${Math.round(diferencia).toLocaleString('es-CL')}). Evaluar disponibilidad/tiempo de entrega antes de decidir.`),
      };
    }
  }

  // La confianza de equivalencia manda por sobre precio/stock (punto 20:
  // "Si existe duda: NO realizar compra automática"), salvo que ya esté
  // pendiente por falta de stock.
  if (resultado.estado === 'comprar' && (peorConfianza === 'revision' || peorConfianza === 'baja')) {
    resultado.estado = 'revisar_equivalencia';
  }

  resultado.confianzaEquivalencia = peorConfianza;
  resultado.proveedorElegidoId = resultado.proveedorRecomendadoId;
  resultado.precioElegido = resultado.precioRecomendado;
  resultado.ajusteManual = false;

  if (decisionManual && decisionManual.proveedorSeleccionadoId) {
    const elegido = candidatosPorProveedor.find(c => c.proveedorId === decisionManual.proveedorSeleccionadoId);
    resultado.proveedorElegidoId = decisionManual.proveedorSeleccionadoId;
    resultado.precioElegido = elegido && elegido.item ? elegido.item.precio_neto : null;
    resultado.motivo = decisionManual.motivoAjuste;
    resultado.ajusteManual = true;
    resultado.estado = 'comprar';
  }

  return resultado;
}

// ---------- Emparejar una línea de cotización con un ítem del pedido ----------

// items: [{ id, nombre, especificaciones }] del pedido base.
// Devuelve { solicitudItemId, confianza, razones } del mejor match, o
// { solicitudItemId: null, confianza: 'revision', razones: [...] } si
// ninguno alcanza un mínimo de similitud (queda para vincular a mano).
export function emparejarLineaCotizacion(descripcionProveedor, items) {
  const tokensProveedor = new Set(normalizarTexto(descripcionProveedor).split(' ').filter(w => w.length > 2));
  const especificacionesProveedor = extraerEspecificaciones(descripcionProveedor);

  let mejor = null;
  for (const item of items) {
    const tokensPedido = new Set(normalizarTexto(item.nombre).split(' ').filter(w => w.length > 2));
    const interseccion = [...tokensPedido].filter(t => tokensProveedor.has(t)).length;
    const union = new Set([...tokensPedido, ...tokensProveedor]).size;
    const similitudTexto = union === 0 ? 0 : interseccion / union;
    if (similitudTexto < 0.2) continue; // demasiado distinto, ni vale la pena evaluar specs

    const especificacionesPedido = item.especificaciones || extraerEspecificaciones(item.nombre);
    const { confianza, razones } = evaluarEquivalencia(especificacionesPedido, especificacionesProveedor);
    const puntaje = similitudTexto + (NIVELES_CONFIANZA.length - NIVELES_CONFIANZA.indexOf(confianza)) * 0.1;
    if (!mejor || puntaje > mejor.puntaje) {
      mejor = { solicitudItemId: item.id, confianza, razones, puntaje };
    }
  }

  if (!mejor) return { solicitudItemId: null, confianza: 'revision', razones: ['No se encontró ningún producto del pedido con similitud suficiente; vincular a mano.'] };
  return mejor;
}

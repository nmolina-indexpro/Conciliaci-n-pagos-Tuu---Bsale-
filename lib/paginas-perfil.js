// /lib/paginas-perfil.js
// Sin imports a propósito: lo usan tanto funciones Node (/api) como el
// middleware Edge.
//
// Cotizaciones, Compra Ágil y Metas de venta (antes "Panel de Accesorios")
// eran pestañas dentro de oportunidades-comerciales.html y pasaron a
// páginas propias. Un perfil que ya tenía "Oportunidades" debe seguir viendo
// esas pantallas sin que un admin tenga que editarlo a mano: mientras el
// perfil no lleve la marca de abajo, se le suman las 3 páginas nuevas. Al
// guardar un perfil desde Usuarios (api/usuarios.js) se agrega la marca, y
// desde ahí manda exactamente lo que el admin dejó marcado.
export const PAGINAS_COMERCIAL_NUEVAS = ['cotizaciones-clientes.html', 'compra-agil.html', 'metas-de-venta.html'];
export const MARCA_COMERCIAL_V2 = 'comercial-v2';
const PAGINA_ORIGEN = 'oportunidades-comerciales.html';

// Insumos de Servicio Técnico era una sección de servicio-tecnico.html y pasó a página propia (insumos-servicio-tecnico.html, dentro de Compras).
// Mismo criterio: un perfil que ya tenía Servicio Técnico sigue viendo los insumos hasta que un admin lo guarde desde Usuarios (ahí se agrega la
// marca y manda lo que quedó marcado).
export const PAGINA_INSUMOS = 'insumos-servicio-tecnico.html';
export const MARCA_INSUMOS = 'insumos-v1';
const PAGINA_ORIGEN_INSUMOS = 'servicio-tecnico.html';
// Las pestañas de compras.html (Catálogo completo, Recomendación, Importación Daxis, Compras DM, Compras Intcomex y Comparativa) tienen permiso propio:
// "compras.html#<pestaña>". El Resumen va con la página (compras.html) e Insumos es una página aparte. Mismo criterio que arriba: un perfil que ya tenía
// Compras sigue viendo todas las pestañas hasta que un admin lo guarde desde Usuarios (ahí se agrega la marca y manda lo que quedó marcado).
export const PAGINA_COMPRAS = 'compras.html';
export const PERMISOS_COMPRAS = ['catalogo', 'recomendacion', 'daxis', 'dm', 'intcomex', 'comparador'].map(m => `${PAGINA_COMPRAS}#${m}`);
export const MARCA_COMPRAS = 'compras-v1';
// El panel del Bot de WhatsApp (bot-whatsapp.html) nació como página propia a partir de Clientes WhatsApp. Mismo criterio: un perfil que ya tenía
// Clientes WhatsApp sigue viendo el panel del bot hasta que un admin lo guarde desde Usuarios (ahí se agrega la marca y manda lo que quedó marcado).
export const PAGINA_BOT_WHATSAPP = 'bot-whatsapp.html';
export const MARCA_BOT_WHATSAPP = 'bot-whatsapp-v1';
const PAGINA_ORIGEN_BOT_WHATSAPP = 'clientes-whatsapp.html';
const MARCAS = [MARCA_COMERCIAL_V2, MARCA_INSUMOS, MARCA_COMPRAS, MARCA_BOT_WHATSAPP];

export function paginasEfectivas(paginas) {
  if (!Array.isArray(paginas)) return paginas; // null = sin restricción
  let r = paginas;
  if (!paginas.includes(MARCA_COMERCIAL_V2) && paginas.includes(PAGINA_ORIGEN)) r = [...r, ...PAGINAS_COMERCIAL_NUEVAS.filter(p => !paginas.includes(p))];
  if (!paginas.includes(MARCA_INSUMOS) && paginas.includes(PAGINA_ORIGEN_INSUMOS) && !r.includes(PAGINA_INSUMOS)) r = [...r, PAGINA_INSUMOS];
  if (!paginas.includes(MARCA_COMPRAS) && paginas.includes(PAGINA_COMPRAS)) r = [...r, ...PERMISOS_COMPRAS.filter(p => !r.includes(p))];
  if (!paginas.includes(MARCA_BOT_WHATSAPP) && paginas.includes(PAGINA_ORIGEN_BOT_WHATSAPP) && !r.includes(PAGINA_BOT_WHATSAPP)) r = [...r, PAGINA_BOT_WHATSAPP];
  return r.some(p => MARCAS.includes(p)) ? r.filter(p => !MARCAS.includes(p)) : r;
}

// Una pestaña de Compras sin la página Compras no sirve de nada (el middleware exige la página): se descartan al guardar.
export function paginasParaGuardar(paginasValidas) {
  const sinPestanasHuerfanas = paginasValidas.includes(PAGINA_COMPRAS) ? paginasValidas : paginasValidas.filter(p => !PERMISOS_COMPRAS.includes(p));
  return [...sinPestanasHuerfanas.filter(p => !MARCAS.includes(p)), ...MARCAS];
}

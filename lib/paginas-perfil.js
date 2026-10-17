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
const MARCAS = [MARCA_COMERCIAL_V2, MARCA_INSUMOS];

export function paginasEfectivas(paginas) {
  if (!Array.isArray(paginas)) return paginas; // null = sin restricción
  let r = paginas;
  if (!paginas.includes(MARCA_COMERCIAL_V2) && paginas.includes(PAGINA_ORIGEN)) r = [...r, ...PAGINAS_COMERCIAL_NUEVAS.filter(p => !paginas.includes(p))];
  if (!paginas.includes(MARCA_INSUMOS) && paginas.includes(PAGINA_ORIGEN_INSUMOS) && !r.includes(PAGINA_INSUMOS)) r = [...r, PAGINA_INSUMOS];
  return r.some(p => MARCAS.includes(p)) ? r.filter(p => !MARCAS.includes(p)) : r;
}

export function paginasParaGuardar(paginasValidas) {
  return [...paginasValidas.filter(p => !MARCAS.includes(p)), ...MARCAS];
}

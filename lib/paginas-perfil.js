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

export function paginasEfectivas(paginas) {
  if (!Array.isArray(paginas)) return paginas; // null = sin restricción
  if (paginas.includes(MARCA_COMERCIAL_V2)) return paginas.filter(p => p !== MARCA_COMERCIAL_V2);
  if (!paginas.includes(PAGINA_ORIGEN)) return paginas;
  return [...paginas, ...PAGINAS_COMERCIAL_NUEVAS.filter(p => !paginas.includes(p))];
}

export function paginasParaGuardar(paginasValidas) {
  return [...paginasValidas.filter(p => p !== MARCA_COMERCIAL_V2), MARCA_COMERCIAL_V2];
}

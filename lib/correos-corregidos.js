// Correos de clientes mal escritos en Bsale que el ERP corrige solo (el dato de origen viene de la ficha del cliente en Bsale).
// Clave en minúsculas -> correo correcto. Se aplica al sincronizar desde Bsale y se repara lo ya guardado (ver lib/db.js).
export const CORRECCIONES_CORREO = {
  'vnta@indexstore.cl': 'venta@indexstore.cl',
};

export function corregirCorreo(correo) {
  const limpio = String(correo ?? '').trim();
  return CORRECCIONES_CORREO[limpio.toLowerCase()] || limpio;
}

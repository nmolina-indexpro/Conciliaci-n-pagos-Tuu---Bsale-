# Pantallas a pedido (Compras > Pantallas a pedido)

Para modelos de pantalla de notebook que no se tienen en stock pero se pueden importar (la mayoría tarda entre 15 y 25 días). Los pedidos se **anotan a mano**
y la lista les sigue la pista hasta entregarlos. No hay nada automático con Shopify: no hay producto de abono ni avisos de pedidos.

## Anotar un pedido (primera pestaña)

1. **Cliente:** nombre (obligatorio), WhatsApp, correo (hace falta al menos uno de los dos), comuna. Si la empresa quiere **factura**: RUT (se valida el dígito
   verificador), razón social, giro, dirección y comuna de facturación.
2. **Producto:** se busca en el catálogo de la tienda por SKU o modelo y se elige de la lista (muestra la foto, el SKU, el stock y el precio). Al elegirlo se
   llenan el modelo, el SKU y la foto. Si el modelo no está en el catálogo se escribe a mano. Opcional: número de parte.
3. **Abono:** ¿se realizó abono? Si es que sí: monto y medio (**Link de pago**, **Transferencia** o **Shopify**).
4. **Tiempo de espera** que se le dijo al cliente, en días (botones de 15, 18, 20, 22 y 25, o cualquier número; por defecto 20). Con eso se calcula la fecha
   prometida.

El pedido queda **pendiente de compra**, se enciende la alerta de la página y sale un correo (notificación «Pantalla a pedido pendiente de compra»; se administra
en Usuarios > Notificaciones y se puede apagar o cambiar de destinatarios). El correo no lleva montos.

## Lista de pedidos (segunda pestaña)

Estados: **Pendiente de compra → Comprado → En tránsito → Recibido, por entregar → Entregado** (o **Cancelado**). Se puede saltar pasos y volver atrás.
Cada fila muestra cliente (con WhatsApp y marca de factura), producto con foto, abono, la espera dicha al cliente (y si ya pasó la fecha prometida), estado y
la compra al proveedor (proveedor, referencia, llegada estimada). «Ver / editar» abre el mismo formulario más la compra al proveedor, el historial de cambios y
un botón de WhatsApp con el mensaje según el estado. El costo de compra solo lo ve y edita un administrador.

Al pasar a **Comprado** o **En tránsito** se anota la fecha de compra y, si no se escribió una llegada estimada, se calcula con los días dichos al cliente.

## Lo que no hace

- No cobra el saldo ni descuenta el abono: eso se gestiona como siempre (cotización o venta en Bsale). Al cancelar, la página recuerda gestionar la devolución del
  abono si corresponde.
- No crea el envío en «Productos en tránsito» ni lo cruza con la compra.

Código: `lib/pedidos-pantalla.js` (reglas, validaciones y base de datos), `lib/pedidos-pantalla-catalogo.js` (búsqueda de productos con foto, solo lectura),
`lib/correo-pedido-pantalla.js` (correo), recurso `?recurso=pedidos-pantalla` en `api/negocio.js`. Prueba: `test-pedidos-pantalla.mjs`.

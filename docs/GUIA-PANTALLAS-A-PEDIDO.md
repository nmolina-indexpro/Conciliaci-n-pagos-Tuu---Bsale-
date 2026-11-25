# Productos a pedido (Compras > Productos a pedido)

Para cualquier producto que no se tiene en stock y se compra a pedido (pantallas, baterías, cargadores u otros; la mayoría tarda entre 15 y 25 días). Antes el módulo
se llamaba «Pantallas a pedido» y solo era para pantallas; la dirección de la página (pedidos-pantallas.html) y los permisos no cambian. Los pedidos se **anotan a mano**
y la lista les sigue la pista hasta entregarlos. No hay nada automático con Shopify: no hay producto de abono ni avisos de pedidos.

## Anotar un pedido (primera pestaña)

1. **Cliente:** nombre (obligatorio), WhatsApp, correo (hace falta al menos uno de los dos), comuna. Si la empresa quiere **factura**: RUT (se valida el dígito
   verificador), razón social, giro, dirección y comuna de facturación.
2. **Producto:** puede ser cualquiera. Se busca en el catálogo de la tienda por SKU, nombre o modelo y se elige de la lista (muestra la foto, el SKU, el stock y el
   precio); al elegirlo se llenan el nombre, el SKU y la foto. Si el producto **no está en el catálogo**, se marca la casilla «Este producto no está en el catálogo» y se
   describe a mano (nombre y modelo); en la lista queda con la marca «fuera de catálogo». Opcional: número de parte o referencia.
3. **Abono:** ¿se realizó abono? Si es que sí: monto y medio (**Link de pago**, **Transferencia** o **Shopify**).
4. **Tiempo de espera** que se le dijo al cliente, en días (botones de 15, 18, 20, 22 y 25, o cualquier número; por defecto 20). Con eso se calcula la fecha
   prometida.

El pedido queda **pendiente de compra**, se enciende la alerta de la página y sale un correo «Nuevo pedido de producto: ejecutar la compra» (notificación
«Producto a pedido nuevo»). Llega a nmolina@indexpro.cl y a nathalia@indexstore.cl (direcciones fijas; se pueden sumar más personas, apagar o cambiar en
Usuarios > Notificaciones). El correo no lleva montos.

## Recordatorio a los 3 días

Todas las mañanas (cron 13:10 UTC) el ERP revisa los pedidos **pendientes de compra**. Si uno lleva **3 días o más sin comprarse**, sale un correo de
recordatorio (notificación «Producto a pedido sin comprar tras 3 días», mismos destinatarios) con una tabla de todos los que cumplen, el más antiguo primero. Si
siguen sin comprarse, el recordatorio **se repite cada 3 días**. En cuanto el pedido pasa a «Comprado» (o a cualquier otro estado) deja de avisar; los comprados, en
tránsito, recibidos, entregados y cancelados no generan recordatorio. Editar otros datos (proveedor, notas, etc.) no reinicia la cuenta, solo el cambio de estado.
Si no hay ningún pedido que cumpla no sale correo. «Enviar prueba» en Usuarios > Notificaciones manda un ejemplo con los pendientes que haya (o datos de ejemplo).

## Consultar precio (cuando el vendedor todavía no tiene el precio)

En «Anotar pedido» se marca la casilla **«Todavía no tengo el precio: consultar precio»**. El producto queda en el estado **Consultar precio** y sale un correo al administrador
(notificación «Producto a pedido: consulta de precio nueva»). Después:

1. El administrador cotiza y anota en el pedido (Ver / editar → «Precio al cliente») el **precio que se le entrega al cliente, con IVA incluido**. Solo un administrador puede
   anotar el precio; todos lo ven en la columna **Precio al cliente (IVA incl.)** de la lista (mientras falta aparece «Por cotizar»).
2. Cuando el cliente acepta, se usa **«Cliente acepta»** (o «El cliente acepta: pasar a pendiente de compra» en la ventana del pedido). **No se puede pasar a Pendiente de compra
   sin precio.** Desde ahí corren los días de espera prometidos y sale el aviso de «ejecutar la compra».
3. Si el cliente no lo quiere, se cancela. Un pedido pendiente de compra también puede volver a «Consultar precio».

## Foto de referencia y comentario

Al lado del producto (en el formulario y en la ventana del pedido) hay una caja **Foto de referencia**: se sube o se toma una foto (por ejemplo, la estructura de la pantalla, el
conector o cualquier detalle) y se escribe un **comentario de la foto**. El navegador la reduce antes de subirla (JPG/PNG/WebP, máximo 1,5 MB). La foto y el comentario se ven en la
columna **Producto** de la lista; al hacer clic en la foto se abre en grande. Se puede cambiar o quitar cuando se quiera.

## Avisos de cada cambio

Cada vez que se guarda un cambio en un pedido —de estado, un precio, una foto o cualquier dato, por mínimo que sea— sale un correo («Producto a pedido: cada cambio en un pedido») a los
inscritos en esa notificación (Usuarios > Notificaciones > Compras): nmolina@indexpro.cl y, por defecto, Nathalia; se pueden sumar o quitar personas. El correo dice qué cambió y quién lo hizo,
**sin montos** (del precio solo dice si se anotó, se modificó o se quitó). Guardar sin cambiar nada no manda correo. Cuando un pedido pasa de «Consultar precio» a «Pendiente de compra» salen
dos correos: el del cambio y el aviso de ejecutar la compra.

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

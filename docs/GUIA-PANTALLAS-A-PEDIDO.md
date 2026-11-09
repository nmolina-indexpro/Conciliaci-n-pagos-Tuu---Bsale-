# Pantallas a pedido (Compras > Pantallas a pedido)

Para modelos de pantalla de notebook que no se tienen en stock pero se pueden importar (10 a 20 días). El cliente paga un **abono** en la tienda y el pedido se
convierte en una solicitud de compra en el ERP.

## Cómo funciona

1. **Producto de abono en Shopify.** Se crea desde la página (panel «Producto de abono y avisos de Shopify», solo administrador) con el monto que se quiera
   ($25.000, $35.000…). Queda como **borrador**, con SKU `ABONO-PANTALLA-<monto>`, sin inventario y sin envío. Hay que revisar la ficha y publicarla en Shopify.
   Para ofrecer otro abono se crea otro producto con otro monto. Todo SKU que empiece con `ABONO-PANTALLA` cuenta como abono.
2. **El cliente compra el abono** y escribe el modelo de su notebook (ver «Pedirle el modelo al cliente»).
3. **El pedido llega al ERP** por un aviso (webhook) de Shopify (pedido nuevo, pagado y cancelado). Si el aviso falla, el botón «Revisar pedidos en Shopify»
   trae los de los últimos 45 días. Es idempotente: no duplica ni pisa lo que se editó a mano.
4. **Alerta.** Cuando el abono queda pagado, el pedido pasa a «Por comprar» y se manda **un** correo (notificación «Pantalla a pedido por comprar», se administra
   en Usuarios > Notificaciones) y se enciende la alerta de la página. El correo no lleva montos.
5. **Seguimiento:** Pago pendiente → Por comprar → Comprado, en camino → Recibido → Entregado (o Cancelado). Al marcar la compra se anota proveedor,
   referencia y días; la fecha de llegada se calcula con los días estimados. Hay botón de WhatsApp con el mensaje según el estado.

## Configuración (una sola vez)

- Registrar los avisos: botón «Registrar avisos de pedidos» (crea los avisos `ORDERS_CREATE`, `ORDERS_PAID` y `ORDERS_CANCELLED` hacia
  `https://erp.indexstore.cl/api/negocio?recurso=pedidos-pantalla-aviso&k=…`). La app de Shopify necesita el permiso `read_orders`. Cada aviso se valida con la
  clave de la URL y con la firma HMAC de Shopify (`SHOPIFY_CLIENT_SECRET`); un aviso sin firma válida se rechaza.
- Dar acceso a la página en Usuarios > Perfiles (aparece como «Pantallas a pedido», grupo Compras).

## Pedirle el modelo al cliente

El ERP lee el modelo de las propiedades de la línea del pedido («Modelo del notebook», «Número de parte»). Si no hay propiedades usa la nota del pedido; si no
hay nada, el pedido queda «sin modelo» y hay que confirmarlo con el cliente (no se puede marcar la compra sin modelo).

Para que el cliente lo escriba al comprar, agregar en la ficha del producto de abono un bloque «Liquid personalizado» dentro del formulario de compra
(el código también está en la página, con botón para copiarlo). Funciona en temas basados en Dawn; en otros temas hay que revisar que los campos queden dentro del
formulario del producto:

```liquid
{% if product.tags contains 'abono-pantalla' %}
<div class="abono-pantalla" style="margin:14px 0;">
  <label for="abono-modelo"><b>Modelo de tu notebook</b> (obligatorio)</label>
  <input id="abono-modelo" type="text" name="properties[Modelo del notebook]" required form="{{ product_form_id }}" placeholder="Ej: HP Pavilion 15-eg0010la" style="width:100%;padding:10px;margin:4px 0 10px;">
  <label for="abono-parte">Número de parte de la pantalla (opcional)</label>
  <input id="abono-parte" type="text" name="properties[Número de parte]" form="{{ product_form_id }}" placeholder="Ej: L12345-001" style="width:100%;padding:10px;margin-top:4px;">
</div>
{% endif %}
```

## Lo que no hace (por ahora)

- No cobra el saldo ni descuenta el abono: el saldo se gestiona como hoy (cotización o venta en Bsale). Tampoco devuelve abonos: al cancelar, el ERP recuerda
  gestionar la devolución en Shopify.
- No crea el envío en «Productos en tránsito» ni lo cruza con la compra.

Código: `lib/pedidos-pantalla.js` (lógica y base de datos), `lib/pedidos-pantalla-shopify.js` (producto, pedidos y avisos), `lib/correo-pedido-pantalla.js`
(correo), recurso `?recurso=pedidos-pantalla` y aviso público `?recurso=pedidos-pantalla-aviso` en `api/negocio.js`. Prueba: `test-pedidos-pantalla.mjs`.

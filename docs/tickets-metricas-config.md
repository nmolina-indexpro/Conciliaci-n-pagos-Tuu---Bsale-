# Tickets: métricas, Cliente 360 y configuración

Las tres vistas están en la página Tickets (pestañas **Bandeja | Métricas | Configuración**; Cliente 360 se abre desde "Ver cliente 360" en el ticket).
Código: `lib/tickets-metricas.js` (recurso `tickets-metricas`) y `lib/tickets.js` (configuración).

## Métricas

Rango de fechas por creación del ticket (zona horaria de Chile). Muestra:

- **Por tipo:** creados, sin resolver, resueltos y "sin resolución" (leads sin datos, postventa abandonada, órdenes cerradas sin entrega), con el tiempo de cierre
  promedio y mediana. El tiempo de cierre **no** incluye lo cerrado sin resolución.
- **Por origen:** de dónde llegan los tickets, separado por tipo.
- **Primer contacto de los leads:** mediana entre la creación del lead y el primer "contacto con el cliente" registrado.
- **Tasa de abandono en postventa:** abandonados / (cerrados + abandonados).
- **Carga por agente:** lo abierto hoy y lo sin movimiento por más de 24 h (sin importar el rango) y lo cerrado dentro del rango.
- **Conversión de lead a pedido:** un lead cuenta como convertido si el mismo correo o teléfono hizo un pedido en Shopify dentro de los 7 días siguientes al lead
  (pedido posterior al lead). Es una pista, no una prueba de causa. Se revisan hasta 2.500 pedidos; si hay más, la vista lo avisa. Si la app de Shopify no tiene el
  permiso de historial completo de pedidos, Shopify solo entrega los últimos 60 días. Esta parte se calcula aparte: si Shopify falla, el resto de las métricas sale igual.

## Cliente 360

Todos los tickets del cliente, sus pedidos de Shopify y sus documentos de Bsale del último año.

- Pedidos: se buscan por el correo del cliente y se suman los pedidos enlazados en sus tickets de postventa. **No se busca por teléfono** (Shopify no permite filtrar
  pedidos por teléfono): un cliente sin correo solo muestra los pedidos enlazados.
- Bsale: se ubica al cliente por RUT (código) o por correo, y se piden los documentos **con rango de fechas** (sin rango, Bsale no los devuelve en orden cronológico).
  Las notas de crédito se marcan porque restan.

## Configuración

- **Agentes:** son los usuarios del ERP; se gestionan en Usuarios.
- **Catálogo de servicios y condiciones** de la orden de servicio (ver `tickets-postventa-ordenes.md`).
- **Motivos de postventa y tipos de producto:** listas cerradas editables. Un ítem nuevo recibe una clave a partir de su nombre; un ítem que se quita
  **se desactiva, no se borra** (los tickets antiguos lo siguen usando). Cada lista exige al menos una opción activa.
- **Plantillas de WhatsApp** (lead, postventa, servicio técnico, equipo listo para retirar) con `{nombre}`, `{producto}`, `{pedido}` y `{orden}`; si el dato no existe se omite.

Solo los administradores guardan cambios; el resto puede verlos.

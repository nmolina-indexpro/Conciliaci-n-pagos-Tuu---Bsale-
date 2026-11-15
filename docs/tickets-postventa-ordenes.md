# Tickets: postventa y órdenes de servicio

## Postventa (`lib/tickets-postventa.js`, recurso `tickets-postventa`)

La ficha "Pedido y documentos" de un ticket de postventa consulta en vivo:

- **Shopify:** el pedido (por el id guardado o por el N° de pedido), estado de pago y de despacho, productos y los números de seguimiento con su enlace.
- **Bsale:** los documentos que indican las etiquetas del pedido (`BO-####`, `FA-####`, `NV-####`). Un N° de boleta/factura escrito a mano en el ticket
  se busca aparte y se marca **"Sin confirmar"** (si es igual al N° de pedido no se busca: sería el documento de otro cliente).
- Completa en el ticket, solo con documentos confirmados por las etiquetas, el id del pedido, el N° de pedido y el N° y id de la boleta o factura.
- Si Shopify o Bsale fallan, se muestra el error de esa parte y lo demás sigue funcionando.

### Nota de crédito

**El ERP no emite la nota de crédito.** Es un documento tributario irreversible (se declara al SII) y hoy el ERP solo emite nota de venta, boleta y factura,
con interruptor y confirmación escrita. El botón **"Registrar nota de crédito"** guarda en el ticket el número de una NC ya emitida en Bsale,
confirmando antes que exista una nota de crédito con ese número (si Bsale no responde, la guarda y avisa que quedó sin verificar).
Un ticket admite una sola NC. Emitirla desde el ERP requiere un paso aparte, con su interruptor y una prueba con un documento real.

## Órdenes de servicio

- **Nueva orden de servicio** (botón de la página Tickets): busca al cliente por RUT, teléfono, correo o nombre; si no existe lo crea (se deduplica por RUT, teléfono o correo).
  El N° de orden sale de una secuencia de Postgres (`tk_os_numero_seq`) que parte en **3162**, continuando el 3161 de Zoho. El N° de ticket parte en 26633.
- Estados: Recibido → Designado → Extensión → Por retirar → **Entregado** (cierra y registra la fecha de entrega; al reabrirla se borra). "Cerrado" cierra sin entrega.
- **Imprimir orden:** abre una hoja A4 con N° de orden, cliente, equipo, accesorios, motivo, servicio, presupuesto, firmas y condiciones; imprime o guarda como PDF
  desde el diálogo del navegador (requiere permitir ventanas emergentes).
- **Catálogo de servicios** (administradores): los códigos SER003, SER009, SER013, SER020 y SER038 se cargaron con los nombres que salen del análisis del historial
  y **sin precio**; hay que completar nombres y precios. Las condiciones impresas son un texto genérico, también editable ahí; **revísalas antes de usarlas**.
- Pendiente: emitir la boleta del servicio en Bsale al entregar (mismo motivo que la nota de crédito).

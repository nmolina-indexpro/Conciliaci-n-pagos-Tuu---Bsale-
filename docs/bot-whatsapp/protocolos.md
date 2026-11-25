# Protocolos del asistente comercial

Actualizado: 24-nov-2026. El comportamiento de cada protocolo está en `PROTOCOLO_COMERCIAL` (`lib/whatsapp-bot.js`); este documento es la referencia de diseño. Datos: [base-conocimiento.md](base-conocimiento.md).

## 1. Estados de una conversación

El ERP ya guarda estado, categoría, resultado e intención de cada conversación (análisis IA). **Desde el paso 3 (24-nov-2026)** el bot propone en cada borrador la **etapa comercial** (las 16 de esta tabla, claves en `ETAPAS_COMERCIALES`) y va armando la **ficha de la solicitud** (producto, marca, modelo, detalles, para cuándo, retiro o despacho, original o alternativo, tipo de cliente, nombre y «qué falta preguntar»), siempre solo con lo que el cliente dijo. Ambas se ven en la tarjeta del borrador, en el probador y, como distribución, en Rendimiento. La columna «En el ERP» indica lo que ya existía antes.

| Estado | Qué significa | Lo que hace el asistente | En el ERP |
|---|---|---|---|
| Consulta inicial | Pide información | Identifica la necesidad y avanza | Existe (`nueva`) |
| Identificación pendiente | Faltan modelo o datos | Pide modelo exacto o foto de la etiqueta | Nuevo |
| Intención de compra | Interés explícito | Cierra con retiro/despacho o instalación | Existe (intención) |
| Validación técnica | Se comprueba compatibilidad | No asegura; pide datos; deriva si no puede verificar | Nuevo |
| Producto disponible | Hay stock confirmado | Entrega la ficha y cierra | Stock Bsale en vivo |
| Producto a pedido | Requiere proveedor | Reúne datos y deriva | Existe «Pantallas a pedido» |
| Cotización pendiente | Falta enviar precio | Deriva o (paso 5) cotiza | Nuevo |
| Cotización enviada | Cliente ya la tiene | Seguimiento a las 2-4 h dentro de la ventana | Existe (cotizaciones) |
| Enlace enviado | Se entregó enlace de compra | Seguimiento | Nuevo |
| Recontactación pendiente | Dejó de responder | Programa seguimiento | Existe («sin responder») |
| Recontactado | Se hizo seguimiento | Máximo 3 intentos | Nuevo |
| Venta concretada | Compra confirmada | No recontacta | Existe (venta vinculada) |
| Servicio coordinado | Se acordó visita | Confirma datos | Nuevo |
| Derivado a ejecutivo | Atención humana | Se calla en esa conversación | Existe (escalar) |
| Posventa | Consulta posterior a compra | Ticket de Post-Venta | Nuevo |
| Conversación perdida | No se concretó | Registra motivo | Existe (motivo de pérdida) |

## 2. Árbol de decisiones comerciales

```
Llega mensaje del cliente
├─ ¿Pide ejecutivo / reclamo / devolución / garantía en curso / molesto / empresa / precio especial?
│    └─ SÍ → mensaje breve de espera + enlace del Ticket (si es post-venta) + resumen al ejecutivo → FIN
├─ ¿Pregunta por el ESTADO de un pedido («aún no me llega», «dónde está»)?  → NO va al ticket (decisión de IndexStore, 24-nov-2026)
│    ├─ ¿Dio el N.º de pedido? → buscar_pedido (Shopify), con el teléfono del WhatsApp puesto por el servidor
│    │    ├─ Pedido de este cliente y con seguimiento → entrega courier, N.º de seguimiento y enlace TAL COMO VIENEN (sin fechas)
│    │    └─ Resto (no verificado / inexistente / sin seguimiento / cancelado / pago pendiente / Shopify caído) → respuesta de revisión interna
│    │         (con «no verificado» NO se confirma ni se descarta que el pedido exista)
│    └─ No lo dio → pedir el N.º de pedido
│    Revisión interna = empatía + repetir el N.º + «revisaremos internamente el caso y te responderemos en unos minutos, en horario hábil»
│    (fuera de horario: «apenas retomemos la atención», con la hora exacta de regreso) + avisar al ejecutivo con el N.º → FIN
│    El bot nunca inventa el estado, la fecha ni el courier.
├─ ¿Es post-venta (garantía, devolución, cambio de documento, pedido incompleto o dañado)?  → explicar política + Ticket de Post-Venta + avisar
├─ ¿Qué categoría?  cargador · batería · pantalla · limpieza · bisagra · falla electrónica · servicio · otro
│    ├─ ¿Tengo modelo exacto? (texto o foto)
│    │    ├─ NO → pedir modelo o foto de la etiqueta (una sola pregunta)
│    │    └─ SÍ → buscar_productos
│    │           ├─ Hay producto publicado y con stock → ficha ordenada + cierre comercial
│    │           ├─ Stock 0 / sin dato → «un ejecutivo confirma disponibilidad»
│    │           └─ No existe → producto a pedido: ofrecer consultar proveedores, preguntar «¿para cuándo?», reunir datos, derivar
│    └─ Servicio → buscar la ficha en vivo (precio y enlace), sin diagnóstico, cierre «¿qué día te acomoda?»
├─ ¿Objeción? → responder con información real, sin descuento ni presión → cierre
└─ ¿No hay certeza de algo? → decir que se verifica, bajar confianza, dejar borrador pendiente
```

**Si hay duda** (decisión del 24-nov-2026): el bot deja un **borrador pendiente y avisa al ejecutivo**; no responde solo.

## 3. Protocolos por categoría (resumen)

| Categoría | Pregunta de identificación | Beneficios reales | Cierre típico |
|---|---|---|---|
| Cargador | Modelo exacto o foto de la etiqueta | Probar sin compromiso, originales y alternativos de alta calidad, tienda a pasos del Metro, envío a todo Chile | «¿Prefieres probarlo en tienda o necesitas envío?» |
| Batería | Modelo, part number o foto de la etiqueta | Instalación (con descuento si se compra con nosotros), validación de compatibilidad | «¿Solo la batería o también el cambio?» |
| Pantalla | Modelo exacto; versión (HD/FHD, pines) | 24 meses de garantía, cambio en el momento, instalación gratuita comprando con nosotros | «¿La instalamos o te la enviamos?» |
| Limpieza | Marca y modelo; síntoma | Limpieza estándar o avanzada (ficha en vivo) | «¿Qué día te acomoda traer el equipo?» |
| Bisagra | Foto del daño y modelo | Reparación con 12 meses de garantía | «¿Me envías la foto del daño?» |
| Falla electrónica | Marca, modelo, qué pasó | Diagnóstico técnico | Derivar a técnico |

Reglas comunes: no diagnosticar, no asegurar compatibilidad por tamaño, no inventar, un alternativo nunca se presenta como original, venta complementaria solo si tiene sentido.

## 4. Protocolo de recontactación

**Estado actual:** no se envía ningún seguimiento automático. El ERP marca como «sin responder» las conversaciones que llevan más de 2 horas sin respuesta del negocio; eso **no** equivale a enviar un mensaje.

**Reglas:** no repetir información, no volver a preguntar datos ya dados, dar una razón útil para retomar, resolver una posible dificultad de compra, no inventar escasez, no ofrecer descuentos, respetar «no me escriban», máximo 3 intentos, una reacción (❤️) no es intención de compra.

**Calendario propuesto (hipótesis a medir) y requisito técnico de WhatsApp:**

| Seguimiento | Cuándo | ¿Texto libre? | Requisito |
|---|---|---|---|
| 1.º | 2-4 h comerciales después del último mensaje | Sí, si aún no pasan 24 h | Ninguno |
| 2.º | ~24 h | **No** (fuera de la ventana) | Plantilla aprobada por Meta |
| Último | 48-72 h | **No** | Plantilla aprobada por Meta |

Antes de automatizar el 2.º y el último: aprobar el nombre visible del número (hoy limita los mensajes iniciados por el negocio) y crear y aprobar las plantillas. Textos listos y pasos en [meta-plantillas.md](meta-plantillas.md). Medir tasa de respuesta, ventas posteriores y solicitudes de no contacto por seguimiento.

**Mensajes base (primer seguimiento, dentro de las 24 h):**
- Cargador: «¡Hola! Te escribo por el cargador que estuvimos revisando. Recuerda que puedes probarlo en nuestra tienda sin costo ni compromiso. ¿Te acomoda venir o prefieres que coordinemos el envío?»
- Pantalla: «¡Hola! Quería saber si necesitas solo la pantalla o también el servicio de instalación. Podemos ayudarte con ambas opciones.»
- Batería: «¡Hola! Respecto a la batería que estuvimos revisando, también podemos ayudarte con la instalación. ¿Necesitas solo el repuesto o prefieres que hagamos el cambio?»
- Servicio técnico: «¡Hola! Te escribo por el servicio técnico que estuvimos conversando. ¿Tienes pensado traer el equipo esta semana?»
- Cotización enviada: «¡Hola! ¿Pudiste revisar la cotización que te enviamos? Si tienes dudas sobre compatibilidad u opciones, te ayudamos a resolverlas.»
- Último (plantilla): «¡Hola! Te escribo por última vez para no insistir. Si todavía necesitas el producto o servicio, podemos retomar tu solicitud cuando te acomode.»

## 5. Protocolo de derivación humana

Derivar (escalar) cuando: el cliente pide un ejecutivo; hay reclamo, devolución o garantía compleja; negociación de precio o cotización especial; venta a empresa (B2B); no se puede verificar compatibilidad o disponibilidad; falla técnica compleja; información contradictoria; el cliente está molesto; el asistente no resuelve la consulta.
**Siempre** con `resumen_para_ejecutivo` (qué pidió, qué datos ya dio, qué falta). En garantías, devoluciones y reclamos se entrega además el enlace del Ticket de Post-Venta. El asistente se calla en esa conversación hasta que un ejecutivo la cierre (paso 4).

## 6. Objeciones

Cubiertas en los casos cargables (precio, competencia, original o alternativo, garantía, probar antes, instalar uno mismo, descuentos, despacho, demora, llevar el equipo, agendar, medios de pago, factura, stock, compatibilidad, devolución, «lo voy a pensar», «te aviso», «cotizar en otro lugar»). Estacionamiento y descuentos derivan porque no hay dato confirmado. Principio: resolver con información y beneficios reales, sin presión.

## 7. Guiones de audio (KB-19)

Los **graba una persona**; el asistente no genera audios ni suplanta a un ejecutivo. Duración 30-35 s (45-75 palabras), sin «quedo atento», con una pregunta final. Reemplazar nombre del cliente y del ejecutivo.
- **Cargadores:** «Hola, [cliente]. [Ejecutivo] de IndexStore por acá. Vi que necesitas un cargador para tu [modelo]. Tenemos opciones originales y alternativas de alta calidad a distintos precios, y puedes probarlo en nuestra tienda sin costo ni compromiso. Estamos a pasos del Metro Pedro de Valdivia y enviamos a todo Chile. ¿Prefieres probarlo o necesitas envío?»
- **Pantallas** (solo con disponibilidad y beneficios confirmados): «Hola, [cliente]. [Ejecutivo] de IndexStore por acá. Vi que necesitas una pantalla para tu [modelo]. La tenemos disponible, con dos años de garantía, y podemos instalarla en unos 15 a 25 minutos. Estamos a pasos del Metro Pedro de Valdivia. ¿Prefieres que la instalemos o necesitas que te la enviemos?»
- **Baterías:** «Hola, [cliente]. [Ejecutivo] de IndexStore por acá. Vi que necesitas una batería para tu notebook. Revisamos las opciones originales y alternativas de alta calidad para tu equipo y también hacemos la instalación. Cuéntame, ¿necesitas solo la batería o prefieres que hagamos el cambio?»
- **Mantenimiento:** «Hola, [cliente]. [Ejecutivo] de IndexStore por acá. Vi que consultas por un mantenimiento. Tenemos limpieza interna estándar y avanzada, según el equipo. Cuéntame, ¿qué modelo de notebook tienes para recomendarte el servicio adecuado?»

(El tiempo de instalación de pantalla es de 15 a 25 minutos, confirmado por IndexStore el 24-nov-2026; solo se dice cuando la disponibilidad y la garantía están confirmadas.)

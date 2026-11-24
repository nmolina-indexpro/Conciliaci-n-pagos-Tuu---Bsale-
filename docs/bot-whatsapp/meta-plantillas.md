# Meta: nombre visible y plantillas para recontactar

Actualizado: 24-nov-2026. Requisito del paso 4 (envío automático) y de la recontactación de [protocolos.md](protocolos.md). Esto se hace **en Meta**, no en el ERP.

## 1. Por qué hace falta

WhatsApp solo permite escribir texto libre dentro de las **24 horas** desde el último mensaje del cliente. Pasado ese plazo, solo se pueden enviar **plantillas aprobadas por Meta**. El primer seguimiento (2 a 4 horas) cabe en la ventana; el de 24 horas y el último (48 a 72 horas) **no**.

Además, escribir primero a un cliente cuenta contra el límite de conversaciones iniciadas por el negocio. El diagnóstico del 24-nov-2026 mostró `can_send_message: LIMITED` con el aviso «el nombre visible aún no se aprobó; el límite sube cuando se apruebe».

## 2. Nombre visible

Estado visto en la API (`/api/negocio?recurso=whatsapp-diagnostico-meta`): nombre verificado «Indexstore.cl», `name_status: NON_EXISTS`, aviso de nombre visible sin aprobar.

Qué hacer (en WhatsApp Manager → Números de teléfono → ⚙ del número → Perfil / Nombre visible):
1. Revisar qué estado muestra el nombre visible (aprobado, en revisión, rechazado) y el motivo si fue rechazado.
2. Si no está aprobado, solicitar el cambio con un nombre que coincida con el negocio y con sus sitios o documentos: «IndexStore» (sin «.cl»; Meta suele rechazar los nombres que incluyen una dirección web — **verificar en las reglas vigentes de nombre visible de Meta**).
3. Esperar la revisión (puede tardar días) y volver a abrir el diagnóstico: `can_send_message` debería pasar de `LIMITED` a `AVAILABLE`.

## 3. Plantillas propuestas

Crear en WhatsApp Manager → Herramientas de la cuenta → Plantillas de mensajes → Crear plantilla. Idioma: Español (la lista de Meta ofrece «Español» y variantes por país; elegir la que corresponda).

**Categoría:** Meta decide la categoría final. Los seguimientos comerciales suelen clasificarse como *Marketing* (con costo por conversación); un seguimiento de una cotización o de un pedido que el cliente pidió puede aceptarse como *Utilidad*. Se propone enviarlas como Utilidad y aceptar que Meta las reclasifique.

Todas incluyen una salida clara («responde NO») y botones de respuesta rápida: facilita respetar las solicitudes de no contacto y mantiene la calidad del número.

| Nombre | Uso | Texto del cuerpo | Variables | Botones |
|---|---|---|---|---|
| `seguimiento_consulta` | ~24 h después de una consulta sin respuesta | Hola {{1}}, soy del equipo de IndexStore. Ayer conversamos sobre {{2}}. ¿Sigues buscándolo? Si necesitas ayuda con la compatibilidad, la instalación o el envío, responde a este mensaje. Si no quieres que te escribamos, responde NO. | {{1}} nombre · {{2}} producto o servicio | «Sí, ayúdame» · «No, gracias» |
| `seguimiento_cotizacion` | Cotización enviada sin respuesta | Hola {{1}}, te escribimos de IndexStore por la cotización {{2}} que te enviamos. ¿Pudiste revisarla? Si tienes dudas sobre la compatibilidad o las opciones, te ayudamos. Si no quieres que te escribamos, responde NO. | {{1}} nombre · {{2}} número de cotización | «Tengo una duda» · «No, gracias» |
| `ultimo_seguimiento` | 48 a 72 h, último intento | Hola {{1}}, te escribo por última vez para no insistir. Si todavía necesitas {{2}}, podemos retomar tu solicitud cuando te acomode. Si prefieres que no te escribamos más, responde NO. | {{1}} nombre · {{2}} producto o servicio | «Retomar» · «No, gracias» |
| `producto_a_pedido_respuesta` | Ya hay respuesta del proveedor por un producto a pedido | Hola {{1}}, ya tenemos respuesta de nuestro proveedor por {{2}}. ¿Quieres que lo coordinemos? Si prefieres que no te escribamos, responde NO. | {{1}} nombre · {{2}} producto | «Sí, coordinemos» · «No, gracias» |

Reglas de redacción: sin precios ni plazos (cambian y no se pueden verificar en una plantilla), sin descuentos ni escasez, sin enlaces que no sean de indexstore.cl, sin la palabra «oferta».

## 4. Lo que falta desarrollar (paso 4)

- Guardar el **no contactar**: si el cliente responde «NO» o «BAJA», marcar el contacto y que el bot y los seguimientos **nunca** le vuelvan a escribir.
- Enviar una plantilla por la API en la nube (el envío de texto libre ya existe) y registrar el intento, el cliente que respondió y la venta posterior.
- Calendario: 1.er seguimiento 2 a 4 h (texto libre, dentro de la ventana), 2.º ~24 h y último 48 a 72 h (plantillas). Máximo 3 intentos por conversación.

## 5. Verificación

Con el enlace de diagnóstico (con sesión de administrador) aparece, por cuenta de WhatsApp, la sección `plantillas` con el nombre, estado, categoría e idioma de cada una. Las plantillas nuevas deben figurar como `APPROVED` antes de usarlas.

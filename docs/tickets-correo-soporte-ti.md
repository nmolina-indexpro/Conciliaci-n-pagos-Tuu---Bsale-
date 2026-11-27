# Soporte TI: correos a soporteti@indexpro.cl -> tickets

La tiquetera **Soporte TI** es el departamento INDEXPRO de Zoho Desk. Desde ahora, cada correo que llega a `soporteti@indexpro.cl` crea un ticket en ella (o se suma al ticket de su conversación).

## Cómo funciona

```
Correo -> soporteti@indexpro.cl (Gmail) -> Google Apps Script (cada minuto) -> ERP (?recurso=tickets-correo) -> ticket
```

- Un script de Google Apps Script instalado en la cuenta que recibe ese correo revisa los mensajes nuevos cada minuto y los envía al ERP. Así el ticket aparece en 1 a 2 minutos, sin servicios de pago ni cambios de DNS.
- **Correo nuevo → ticket nuevo** en Soporte TI (origen "Correo"): el asunto es el del correo (sin "Re:" / "Fwd:"), la descripción es el texto sin la cita de mensajes anteriores y el cliente se crea por su correo.
- **Respuesta del cliente → se suma al mismo ticket** como mensaje (se reconoce por el hilo de Gmail, o porque el asunto cita el ticket, por ejemplo `[#27010]`). Si el ticket estaba cerrado, **se reabre** y queda anotado.
- **Adjuntos:** se guardan en el ticket los de hasta 2 MB (máximo ~2,8 MB por correo). Los más grandes no se copian y en el ticket queda anotado su nombre.
- **No crean tickets:** rebotes (mailer-daemon), respuestas automáticas ("fuera de oficina"), correos con cabecera de envío automático y los que envía el propio buzón soporteti@.
- Un mismo correo nunca se procesa dos veces (se recuerda por su id), aunque el script lo reenvíe.

## Zoho y el buzón a la vez (no se duplican)

`soporteti@indexpro.cl` hoy también entra a Zoho Desk (departamento INDEXPRO). Mientras Zoho siga recibiéndolo, cada correo llega por **dos caminos**: el buzón (script) y la copia de Zoho (sincronización en paralelo).
El ERP los reconoce como el mismo correo (mismo remitente, mismo asunto y mismo día) y los une en **un solo ticket**, sin importar cuál llegue primero. De ahí en adelante:

- Los mensajes **entrantes** del cliente se toman del buzón (llegan en 1 a 2 minutos).
- De Zoho solo se copian las **respuestas que envió un técnico desde Zoho** y sus notas internas.
- El ticket guarda el N° de Zoho (enlace "Zoho #N ↗") y el hilo de Gmail.

Los correos de Zoho traen la **descripción vacía** (el texto está en el primer mensaje): al copiar las conversaciones, ese primer mensaje pasa a ser la descripción completa del ticket, con sus saltos de línea y listas, sin el mensaje citado.

## Instalación (una sola vez)

1. **Clave:** inventa una clave larga (por ejemplo, 40 caracteres al azar) y guárdala en Vercel como variable `TICKETS_CORREO_KEY`. Después de guardarla hay que volver a desplegar.
2. **Cuenta:** entra a Google con la cuenta que **recibe** `soporteti@indexpro.cl` (si es un alias, la cuenta dueña del alias; si es un Grupo de Google, un miembro que reciba los correos en su bandeja).
3. Abre <https://script.google.com> > **Nuevo proyecto**, borra lo que traiga y pega el contenido de `docs/apps-script-soporteti.gs`.
4. **Configuración del proyecto > Propiedades del script**, agrega:
   - `ERP_URL` = `https://DOMINIO-DEL-ERP/api/negocio?recurso=tickets-correo`
   - `ERP_KEY` = la misma clave del paso 1.
5. Elige la función `procesarSoporteTI` y pulsa **Ejecutar**: Google pedirá permiso para leer Gmail y conectarse a un servicio externo. Acepta.
6. Elige `instalarDisparador` y pulsa **Ejecutar** (crea la revisión cada minuto).
7. **Prueba:** envía un correo a soporteti@indexpro.cl desde otra dirección. En 1 a 2 minutos aparece en Tickets > tiquetera Soporte TI. Si no aparece, mira **Ejecuciones** en el editor de Apps Script (muestra el error).

La primera vez el script revisa las últimas 24 horas. Para empezar desde otra fecha, crea la propiedad `ULTIMO` con la fecha en milisegundos.

## Lo que no hace (todavía)

- **No responde ni confirma al cliente por correo.** Las respuestas se siguen enviando desde Gmail o Zoho; cuando el cliente conteste, su mensaje se suma solo al ticket. Responder desde el ERP queda para más adelante.
- Los tickets que lleguen a Zoho por otro correo (por ejemplo soporte@) siguen entrando a Zoho; durante el paralelo se copian al ERP con la sincronización de Zoho.

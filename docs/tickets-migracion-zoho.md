# Tickets: migración desde Zoho Desk y operación en paralelo

Código: `lib/tickets-zoho.js` (recurso `tickets-migracion`, solo administradores) y la sección **Migración desde Zoho Desk** de Tickets > Configuración.

## Qué se migra

Los 5 departamentos de la fase 1, con los IDs que entrega la API de Zoho Desk:

| Departamento de Zoho | ID | Tipo en el ERP |
|---|---|---|
| Solicitudes Venta | 299066000010931332 | lead |
| NAS - Leads ventas y serv. TI | 299066000065007029 | lead (origen `nas`) |
| Post-Venta IndexStore | 299066000005641045 | postventa |
| S.Técnico - Casa Matriz | 299066000010202045 | servicio técnico |
| ST - Ingreso con retiro inmediato | 299066000041314035 | servicio técnico (retiro inmediato) |

Soporte TI (INDEXPRO) sigue en Zoho hasta la fase 2.

Se traen los tickets creados desde la fecha que elijas (por defecto, 12 meses), del más nuevo al más antiguo, de a 100. **No se migran los hilos de conversación**: el ticket del ERP
lleva un enlace "Zoho #N ↗" al original, donde queda la conversación completa mientras se mantenga la licencia.

## Lo que se comprobó con datos reales (15-nov-2026)

Se leyeron tickets reales de cada departamento (solo lectura, desde el conector de Zoho Desk) y se ajustó el mapeo a lo que mostraron:

- Los estados de leads vienen como **"Contactado WSP (cerrado)"** (con el "(cerrado)") y el departamento NAS usa **"Open" / "Closed"** en inglés: ya se reconocen.
- En los **leads el ticket y el contacto de Zoho suelen venir sin correo ni teléfono**: el nombre, el correo y el WhatsApp están en la *descripción* ("Correo: …", "WhatsApp: …"). El origen se infiere de la
  *clasificación* ("LEAD Pantalla", "Carrito Abandonado"), del asunto ("Contactar: Landing cargadores") y de la línea "De donde viene:". En los carritos se rescatan producto y monto.
- Los avisos de **postventa** y de **servicio técnico** traen al final textos legales idénticos (políticas de retracto, términos y condiciones): no se copian a cada ticket.
- En servicio técnico el servicio llega como **"(SER008) - Diagnóstico para Notebook y PC"**: la migración crea en el catálogo los servicios que falten con su nombre real y corrige el nombre de los que aún no tienen precio.
  También se leen el RUT y la fecha de entrega estimada ("F.E. de Entrega: 12-ago-2026").
- El campo de Zoho **"Número Pedido, Boleta o Factura" trae casi siempre el N° de la boleta o factura** (p. ej. 42938), no el del pedido de Shopify (#10269). Muchas son ventas en tienda que no existen en Shopify.
  Por eso la ficha de postventa busca el pedido por nombre y, si no, por las etiquetas `BO-/FA-/NV-`; y el documento de Bsale con ese número solo se da por bueno si el correo o RUT del cliente del documento coincide
  con el del ticket (si no, "Sin confirmar" y no se enlaza).
- Las **condiciones impresas** de la orden de servicio ahora son, por defecto, los *Términos y condiciones* reales que IndexStore ya envía en Zoho (inventario, respaldo, intervenciones previas, riesgos, garantía de 6 meses y abandono).
- Contra la tienda real también se validaron las consultas de pedidos, de carritos abandonados y de pedidos por etiqueta. El ERP usa su propia app de Shopify: sus permisos pueden ser menores que los del conector.

## Cómo se mapea

- **N° de ticket:** se conserva el de Zoho si es anterior a 26633 y no está tomado. Si no, recibe el siguiente del ERP y el de Zoho queda en `zoho_numero` (se puede buscar por cualquiera de los dos).
- **Estados:** Abierto, Designado, Extensión, Por Retirar, Por Transferir, Abandonado y Cerrado pasan 1 a 1. `Contactado WSP` / `Contactado Correo` pasan a "Contactado" con su canal;
  `Sin datos de contacto` a "Sin datos". En servicio técnico el "Cerrado" de Zoho se toma como **Entregado** (supuesto: confírmalo). Un estado que no se reconoce se informa en la simulación y se
  cierra según el tipo de estado de Zoho (cerrado → el cierre normal del tipo; abierto → Abierto).
- **Postventa:** el motivo sale del **asunto** (en Zoho los motivos son el asunto del ticket); el tipo de producto se normaliza a la lista cerrada ("Caragdor" → cargador); el N° de pedido, de boleta o factura,
  la nota de crédito y el resumen de resolución salen de los campos personalizados (por su nombre visible o por su nombre de API).
- **Servicio técnico:** el N° de orden sale del asunto ("Orden de Servico N°3150"); un N° menor a 3162 se conserva, uno mayor recibe el siguiente. El código SER0xx se busca en el motivo de ingreso,
  la descripción y el asunto. El nombre, teléfono y correo del cliente se leen de la descripción si el contacto no los trae.
- **Leads:** el origen se **infiere del texto** (carrito, ZohoBot, chat, landing de pantallas o de cargadores; NAS por departamento) y si no se reconoce queda como "Migración Zoho".
  La simulación muestra la distribución para que se pueda revisar antes de importar.
- **Propietario:** se une al usuario del ERP por correo (o por nombre). Los agentes sin usuario equivalente se listan; sus tickets quedan sin propietario con una nota interna.
- **Clientes:** se deduplican por RUT, correo o teléfono.

## Pasos

1. **Simular** (no guarda nada): revisa estados, orígenes inferidos, agentes sin usuario y ejemplos.
2. **Importar**: avanza con porcentaje (de hoy hacia la fecha de corte) y se puede detener y repetir sin duplicar.
3. **Cuadre**: lo recorrido en Zoho contra lo que hay en el ERP, por departamento y estado.
4. **Operación en paralelo** (1 a 2 semanas): se enciende en Configuración. Una tarea (3 veces al día, ver `vercel.json`) o el botón "Copiar de Zoho ahora" copian lo nuevo que entre a Zoho en los últimos 3 días
   y refrescan el estado de hasta 40 tickets abiertos que vienen de Zoho. **Si alguien tocó el ticket en el ERP después de la última copia, no se pisa** (se cuenta como conflicto).
5. **Corte:** apagar la operación en paralelo, desactivar los 5 departamentos en Zoho y redirigir los formularios antiguos a los nuevos (ver `tickets-formularios.md`).

## Requisitos

Variables en Vercel: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID` (y `ZOHO_DC` si no es `com`), las mismas que ya usa el ERP.
El token necesita permiso para leer el **detalle** de los tickets (donde vienen los campos personalizados) y la lista de **agentes**; hasta ahora el ERP solo había usado el listado.
Si falta alguno, la importación informa el error HTTP de esa parte y se puede repetir después.

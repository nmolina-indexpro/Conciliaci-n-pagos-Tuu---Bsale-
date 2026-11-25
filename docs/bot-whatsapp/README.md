# Asistente comercial IA de IndexStore (WhatsApp)

Actualizado: 24-nov-2026. Documentos hermanos: [base-conocimiento.md](base-conocimiento.md) · [protocolos.md](protocolos.md) · [evaluacion.md](evaluacion.md).
Casos de entrenamiento cargables: `public/bot-casos-iniciales.json` (botón «Cargar casos iniciales» en Comercial → Bot WhatsApp → Preguntas y respuestas).

## 1. Qué es y dónde vive

El asistente **ya existe dentro del ERP**: lee las conversaciones del número oficial (+56 9 9315 5114) por la API de WhatsApp (Cloud API, coexistencia con la app del teléfono), usa Gemini y redacta borradores con precio, stock y enlace reales (Shopify y Bsale). Hoy trabaja en **modo sombra**: el ejecutivo revisa y envía; no envía nada solo.

```
Cliente ─ WhatsApp ─► Cloud API (Meta) ─► webhook del ERP ─► guarda mensaje/conversación
                                                  │
                    ┌─────────────────────────────┘
                    ▼
        Motor del bot (Gemini + herramientas)
          · Protocolo comercial (comportamiento)      lib/whatsapp-bot.js
          · Base de conocimiento (datos estables)     panel → Configuración
          · Preguntas y respuestas modelo             panel → Preguntas y respuestas
          · buscar_productos (Shopify) + stock (Bsale) en vivo
                    │
                    ▼
        Revisión automática (precios/enlaces/promesas) ─► borrador ─► ejecutivo ─► cliente
                                                         (paso 4: envío automático con reglas)
```

**Principio de diseño:** el *comportamiento* (cómo vende) vive en el código; los *datos* que cambian viven en el panel (conocimiento) y en el catálogo (precios, stock, servicios). Así se actualiza sin tocar el prompt.

## 2. Qué se puede hacer y con qué

| Capacidad | Estado |
|---|---|
| Responder con precio, stock y enlace reales | **Existe** (Shopify + Bsale por SKU) |
| Borradores revisados por el ejecutivo, con métricas de uso | **Existe** |
| Panel de entrenamiento, probador, preguntas modelo, saludo, tono y reglas | **Existe** (paso 1) |
| Leer fotos de etiquetas enviadas por el cliente | **Existe** (hasta 3 imágenes) |
| Responder solo, fuera de horario | **Falta desarrollo** (paso 4) |
| Aprender de las correcciones de los ejecutivos | **Falta desarrollo** (paso 2) |
| Estados de la conversación y recontactación | **Falta desarrollo** (paso 3 y 4) |
| Cotización automática (cotización express) | **Existe el servicio**, falta conectarlo al bot (paso 5) |
| Seguimiento fuera de las 24 h | **Requiere plantillas aprobadas por Meta** |
| IA nativa de Meta (Meta Business AI) | **No verificado** para la cuenta y el país: ver §4 |

## 3. Decisiones del brief que conviene cuestionar

1. **Meta Business AI contra el bot propio.** No hay forma de confirmar desde aquí que la IA nativa de Meta esté habilitada en Chile ni en esta cuenta, ni que acepte conectarse a Shopify, Bsale o el ERP. Dos asistentes sobre el mismo número se pisarían. **Recomendación:** el motor es el bot del ERP (nivel 3); la IA nativa de Meta, si se habilita, se usa solo para consultas simples y se evalúa aparte. Antes de invertir, revisar en el Administrador de WhatsApp qué herramientas de IA muestra la cuenta.
2. **Recontactación: el calendario 2-4 h / 24 h / 48-72 h no se puede cumplir con texto libre.** WhatsApp solo deja escribir texto libre dentro de las 24 h desde el último mensaje del cliente. El primer seguimiento (2-4 h) cabe; el de 24 h y el de 48-72 h **exigen plantillas aprobadas por Meta**, y escribir primero al cliente además cuenta contra el límite de conversaciones iniciadas por el negocio, hoy reducido porque el nombre visible del número no está aprobado. Hay que aprobar el nombre visible y preparar 3 plantillas antes del paso 4.
3. **Post-venta: el canal oficial es un ticket único**, no WhatsApp. El reglamento publicado (política de reembolso) pide un solo Ticket de Post-Venta por caso. El brief propone derivar a un ejecutivo en la conversación. **Solución adoptada:** el bot explica la política, entrega el enlace del ticket y avisa a un ejecutivo con un resumen. No gestiona garantías ni devoluciones por el chat. **Excepción decidida el 24-nov-2026:** la consulta por el *estado de un pedido* que no llega no va al ticket; se responde que se revisa internamente y que se contesta en unos minutos, en horario hábil.
4. **«Alternativo», no «compatible» (decidido el 24-nov-2026).** El brief pedía evitar «alternativo»; IndexStore decidió usarlo, igual que el sitio: **«alternativo de alta calidad»** para las baterías y los cargadores Daxis y **«alternativo»** para los demás productos que no son originales. «Compatibilidad» sigue siendo el término técnico (validar la compatibilidad). Nunca se presenta un alternativo como original.
5. **100 conversaciones inventadas no entrenan bien.** Hay unas 4.900 conversaciones reales en el ERP. La biblioteca debe salir de ahí (anonimizadas) y no de casos redactados. Se cargaron 41 casos de arranque basados en datos oficiales; el resto se extrae de conversaciones reales (paso 2).
6. **Cerrar siempre con una pregunta comercial** puede sonar insistente. Se mantiene como regla general con las excepciones del brief (conversación terminada, reclamo delicado, no contactar).
7. **Medir ventas reales, no clics.** El indicador de conversión debe salir de ventas de Bsale/Shopify vinculadas a la conversación, no de toques al botón de WhatsApp.
8. **Audios generados con IA:** se descartan para el bot; la biblioteca de audios es para que los grabe una persona (ver protocolos.md, guiones).

## 4. Tres niveles de implementación

| Nivel | Qué es | Veredicto |
|---|---|---|
| 1. IA nativa de Meta | Herramientas de IA de WhatsApp Business / Meta Business | **Sin verificar** su disponibilidad. Sin acceso a catálogo ni stock propios. Riesgo de duplicar respuestas |
| 2. Base de conocimiento externa | Documentos, preguntas frecuentes e instrucciones cargados en una herramienta de IA | **Hecho** en el panel del bot (conocimiento, preguntas modelo, protocolo) |
| 3. Integración por API | WhatsApp Cloud API + Shopify + Bsale + ERP | **Es la arquitectura vigente**. Falta: estados, envío automático, recontactación con plantillas, cotización |

## 5. Integración con Shopify, Bsale y el ERP

- **Hoy:** catálogo, precio, variantes, enlaces y descripción (Shopify); stock por SKU (Bsale); datos del cliente por teléfono (Bsale, informativo); análisis de cada conversación (categoría, producto, marca, modelo) y análisis de pérdidas.
- **Paso 3:** guardar en la conversación los datos de la solicitud (marca, modelo, producto, urgencia, retiro o despacho) y el estado de la conversación.
- **Paso 5:** crear la cotización express desde el bot (`lib/cotizacion-web.js`), con confirmación explícita del cliente y tope diario.
- **Pendiente de acceso:** estado de pedidos y compatibilidades técnicas (hoy no hay tabla maestra).

## 6. Mejora continua

Semanal: revisar en Rendimiento los motivos de escalamiento y las alertas; convertir las 5 correcciones más repetidas en preguntas modelo o reglas; revisar 20 borradores al azar con la rúbrica de [evaluacion.md](evaluacion.md); actualizar la base de conocimiento y el registro de cambios al final de [base-conocimiento.md](base-conocimiento.md).

## 6b. Cómo aprende (paso 2)

Dos fuentes de **casos candidatos**, que van a Comercial → Bot WhatsApp → 🎓 Aprendizaje. **Nada pasa al bot sin que una persona lo apruebe**; al aprobar se crea una pregunta y respuesta modelo (editable).
- **Correcciones de ejecutivos:** cuando un ejecutivo edita el borrador del bot y lo envía, queda un caso con lo que escribió el cliente, lo que propuso el bot, lo que se envió y un resumen de lo que cambió (más corto, agregó enlace, agregó una pregunta…). Se registra solo.
- **Conversaciones reales:** el administrador pulsa «Analizar conversaciones». La IA toma las de los últimos 180 días (primero las que terminaron en venta), extrae el primer intercambio útil entre cliente y ejecutivo, y propone: pregunta generalizada, respuesta optimizada según el protocolo comercial, problema detectado, regla de aprendizaje, módulo (categoría) y nivel de riesgo. Si la respuesta propuesta trae precios o enlaces que no están en la base de conocimiento, queda con **riesgo alto** y una advertencia.
- **Privacidad:** antes de guardar o mostrar, se reemplazan teléfonos, correos, RUT, números largos, el nombre del cliente y los enlaces que no son de indexstore.cl. Aun así conviene leer cada caso antes de aprobarlo.
- **Límites:** cada conversación se analiza una sola vez; las que no sirven (saludo suelto, spam, sin respuesta útil) quedan como rechazadas y no se vuelven a analizar. Cuesta tokens de Gemini: se puede probar con 12.

## 7. Hoja de ruta

| Paso | Contenido | Estado |
|---|---|---|
| 0 | Envío por la API funcionando | Hecho |
| 1 | Panel: probador, preguntas modelo, saludo, tono, reglas, rendimiento | Hecho |
| 1b | Base oficial, protocolo comercial y 41 casos iniciales | Hecho (este documento) |
| 2 | Correcciones de ejecutivos → casos candidatos; análisis de conversaciones reales anonimizadas; pestaña «Aprendizaje» para aprobar | Hecho (24-nov-2026) |
| 3 | Etapas comerciales y ficha de la solicitud (hecho en el ERP); nombre visible y plantillas de Meta (textos y pasos en [meta-plantillas.md](meta-plantillas.md), **lo hace IndexStore en Meta**) | Código hecho; Meta pendiente |
| 4 | Envío automático con reglas (fuera de horario, confianza alta, sin alertas) | Pendiente |
| 5 | Cotización express desde el bot | Pendiente |

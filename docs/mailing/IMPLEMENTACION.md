# Módulo de Mailing – estado de la implementación

Complementa `MAILING_MODULE.md` (especificación) y `schema.sql` (esquema de referencia). Última actualización: 16-nov-2026.

## Qué está hecho (primera tarea)

| Pieza | Dónde |
| --- | --- |
| Migración `mk_*` (9 tablas, idempotente) | `asegurarTablasMailing` en `lib/db.js` |
| Importar contactos y supresiones (CSV Zoho) | `lib/mailing/importar.js`, `csv.js`, `email.js` |
| Webhook de eventos de SES (firma SNS) | `lib/mailing/firma-sns.js`, `eventos-ses.js` |
| Lanzar campaña (congela HTML, arma `mk_sends`, encola en QStash) | `lib/mailing/lanzar.js`, `plantilla.js`, `firma-qstash.js` |
| Worker de lotes (envío por SES, SigV4 sin SDK) | `lib/mailing/worker.js`, `ses.js`, `sigv4.js` |
| Baja `/u/:token` (GET confirma, POST suprime / one-click) | `lib/mailing/baja.js`, `token-baja.js` |
| Pruebas | `tests/mailing/*.test.js` (`npm test`, 39 pruebas) |

## Decisiones que se apartan de la especificación

- **Base de datos:** el ERP usa **Vercel Postgres (Neon)** vía `@vercel/postgres`. Se mantuvo Postgres, pero la migración sigue la convención del ERP (`asegurar*` + `unaVez`), no un archivo SQL aparte. `schema.sql` queda como referencia. Cambios respecto a él: enums con bloque `DO` (idempotente), índices con nombre, sin `pgcrypto` (`gen_random_uuid` es nativo), `mk_events.event_key` único (SNS puede reentregar), `mk_campaigns.pause_reason`, índice `mk_sends(campaign_id, status, queued_at)`.
- **Sin funciones nuevas:** el plan Hobby permite 12 funciones y `api/` ya tiene 12. Todo entra como `?recurso=mk-*` en `api/negocio.js`; `/u/:token` se reescribe en `vercel.json`. Los nombres de endpoint de la especificación quedaron así:

| Especificación | Recurso real | Autenticación |
| --- | --- | --- |
| `POST /api/mk/contacts/import` | `POST /api/negocio?recurso=mk-contactos-importar` | sesión, solo admin |
| `POST /api/mk/campaigns/:id/launch` | `POST /api/negocio?recurso=mk-campana-lanzar&id=<uuid>` | sesión, solo admin |
| `POST /api/mk/webhooks/ses` | `POST /api/negocio?recurso=mk-webhook-ses` | firma SNS |
| `POST /api/mk/worker/send-batch` | `POST /api/negocio?recurso=mk-worker-enviar-lote` | firma QStash |
| `GET/POST /u/:token` | `/u/:token` → `?recurso=mk-baja&token=` | token HMAC |

- **Sin SDK de AWS ni de Upstash:** SigV4, verificación SNS y JWT de QStash se hacen con `node:crypto`. SigV4 se validó contra el vector oficial `get-vanilla` de AWS.
- **Reclamo de lotes con «arriendo»:** `mk_sends.queued_at` hace de arriendo (se reclaman 50 filas con `FOR UPDATE SKIP LOCKED` y `queued_at = ahora + 5 min`). Lotes simultáneos o reintentos de QStash no toman al mismo destinatario. Un lote caído a medias se recupera solo: al vencer el arriendo, el lote de seguimiento lo retoma.
- **Pausa automática** (rebotes > 5 % o quejas > 0,1 %): se evalúa solo con **≥ 200 envíos**, para que un rebote en una campaña chica no la pause. Es un supuesto mío; ajustar en `UMBRALES_PAUSA` (`eventos-ses.js`).
- **Pie de baja automático:** si la plantilla no trae `{{unsubscribe_url}}`, se agrega un pie con remitente, aviso de publicidad y enlace de baja (Ley 19.496).
- **Segmentos dinámicos:** no están (fase 4). Una campaña con `audience.segments` no vacío se rechaza con un mensaje claro; hoy la audiencia son listas (`lists` − `exclude_lists`).

## Importar desde Zoho

Dos pasadas, **supresiones primero**:

1. `tipo=supresiones`: exportar desuscritos, rebotes duros y quejas. Si el archivo trae una columna de motivo (`Reason`, `Motivo`, `Type`…) se clasifica solo; si no, indicar `categoria` (`unsubscribe`, `hard_bounce` o `complaint`). Las filas sin motivo reconocible se informan como inválidas en vez de suprimirse a ciegas.
2. `tipo=contactos`: el resto. Un contacto ya suprimido queda como `unsubscribed/bounced/complained`; un contacto existente **no se reactiva ni se pisa** (solo se completan vacíos y se suman etiquetas).

Cuerpo JSON `{ "csv": "...", "tipo": "contactos|supresiones", "categoria": "...", "origen": "zoho_import" }` o el CSV directo con `Content-Type: text/csv` (`?tipo=`, `?categoria=`). Máximo 20.000 filas por llamada; **Vercel limita la petición a 4,5 MB, así que partir el archivo en tandas de ~5.000 filas** (es idempotente). La pantalla del ERP que haga esto está pendiente.

## Variables de entorno (Vercel)

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=            # usuario IAM solo con ses:SendEmail
AWS_SECRET_ACCESS_KEY=
SES_CONFIGURATION_SET=mk-marketing
MK_SNS_TOPIC_ARN=             # ARN del tópico SNS; si se define, el webhook rechaza mensajes de otro tópico
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
MK_UNSUB_SECRET=              # largo y aleatorio; si se cambia, los enlaces de baja ya enviados dejan de funcionar
MK_PUBLIC_BASE_URL=https://erp.indexstore.cl
```

`POSTGRES_URL` ya existe. `MK_PUBLIC_BASE_URL` debe ser exactamente el origen que QStash llama: la firma de QStash incluye la URL del worker y se compara contra `MK_PUBLIC_BASE_URL + /api/negocio?recurso=mk-worker-enviar-lote`.

## Configuración externa pendiente (no se puede hacer desde el código)

1. SES: verificar `news.indexstore.cl` y `news.indexpro.cl` (Easy DKIM), SPF, DMARC `p=none`, Custom MAIL FROM `bounce.news.…`, dominio de tracking con HTTPS, lista de supresión de la cuenta activada, salida del sandbox.
2. SES → configuration set `mk-marketing` con destino de eventos **SNS** (Send, Delivery, Bounce, Complaint, Open, Click, Reject, Rendering Failure, Delivery Delay).
3. SNS: suscripción HTTPS a `https://erp.indexstore.cl/api/negocio?recurso=mk-webhook-ses`. La confirmación de suscripción la maneja el propio webhook (verifica la firma y que `SubscribeURL` sea de `sns.*.amazonaws.com`).
4. QStash: crear cuenta/token y copiar las claves de firma.
5. Cargar las variables de arriba en Vercel y volver a desplegar.

## Qué falta para operar

- Pantalla del ERP (Comercial > Mailing): importar, listas, plantillas, crear/lanzar campaña, reporte. Recordar agregarla a `PAGINAS_DISPONIBLES` + `GRUPOS_PAGINAS` (`usuarios.html`).
- `POST /campaigns/:id/test` (envío de prueba), `GET /campaigns/:id/report`, cron de campañas programadas (`scheduled_at`), `segments/:id/count`, sync nocturno Bsale/Shopify (fases 2–4 de la especificación).
- Calentamiento de volumen: lo define la operación (empezar con ~1.000 por envío); el código no lo limita.
- Plantillas: la pregunta abierta «¿editor visual o HTML/MJML?» sigue abierta; hoy la plantilla es HTML.

## Cómo se probó y qué no

`npm test` ejecuta 39 pruebas. Las de integración corren la migración y todas las consultas contra **Postgres real en memoria (PGlite)**, no contra Neon: cubren exclusión de supresiones, no duplicado en reintentos y lotes concurrentes, eventos de SES, pausa automática y baja. Las firmas SNS y QStash se prueban con claves generadas en la prueba. **No se probó contra SES, SNS ni QStash reales** (no hay cuentas todavía): el primer envío real debe hacerse con una lista interna.

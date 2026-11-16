# Módulo de Mailing – ERP IndexStore / IndexPro

Especificación para continuar el desarrollo en Claude Code. El esquema completo está en `schema.sql`, junto a este archivo.

## Objetivo

Reemplazar Zoho Campaigns por un módulo de envío masivo dentro del ERP, usando Amazon SES como proveedor de envío. El ERP es la fuente única de contactos, campañas y eventos; SES solo entrega y devuelve eventos.

## Contexto y volumen

- ~50.000 contactos depurados (hoy en Zoho Campaigns).
- Campañas de ~10.000 destinatarios, 2–3 por semana → 87.000–130.000 correos/mes.
- Líneas de negocio: IndexStore (B2C, Shopify), IndexPro (B2B), FonoIP.
- Costo objetivo: ≈ USD 15–50/mes (SES USD 0,10 por 1.000 correos + DB + cola). Sin IP dedicada.

## Stack

- Vercel serverless functions, Node.js, frontend HTML/JS vanilla (igual que el resto del ERP).
- Postgres (Supabase o Neon). **Confirmar qué base usa hoy el ERP y adaptar `schema.sql` si es otra.**
- Amazon SES (API v2, `SendEmail`) con configuration set → SNS → webhook.
- Upstash QStash como cola de lotes.
- Integraciones existentes: Bsale y Shopify (para sincronizar clientes y compras).

## Arquitectura

```
Bsale / Shopify / CSV Zoho ──► Sync nocturno (Vercel Cron) ──► Postgres
Panel Mailing (ERP) ──► Lanzar campaña ──► crea mk_sends en Postgres
                                       └─► encola lotes en QStash
QStash ──► Worker send-batch (lee/marca mk_sends) ──► Amazon SES ──► Destinatarios
Amazon SES ──► SNS ──► Webhook de eventos ──► Postgres (mk_events, mk_sends, supresiones, totales)
Destinatario ──► Baja one-click /u/:token ──► Postgres (mk_suppressions)
```

## Base de datos (prefijo `mk_`)

| Tabla | Propósito |
| --- | --- |
| mk_contacts | Contacto único por email, estado, origen, consentimiento, atributos JSON |
| mk_lists / mk_list_members | Listas estáticas |
| mk_segments | Filtros dinámicos en JSON |
| mk_suppressions | Bloqueo global: baja, rebote duro, queja |
| mk_templates | HTML/MJML, asunto, preheader, variables |
| mk_campaigns | Campaña, audiencia, estado, totales |
| mk_sends | Un registro por destinatario y campaña (`unique(campaign_id, contact_id)`) |
| mk_events | Eventos crudos de SES |

Reglas:
- `mk_suppressions` manda sobre el estado del contacto: se cruza al armar la audiencia y otra vez justo antes de enviar cada lote.
- La baja usa un token HMAC firmado (`contact_id` + `campaign_id`), sin tabla de tokens. Secreto en `MK_UNSUB_SECRET`.
- `mk_events` crece rápido: particionar por mes o purgar aperturas de más de 12 meses.

## Endpoints y jobs

| Endpoint / job | Disparador | Qué hace |
| --- | --- | --- |
| `POST /api/mk/contacts/import` | Manual (CSV de Zoho) | Importa contactos y supresiones, deduplica por email |
| `cron /api/mk/sync` | Vercel Cron, cada noche | Trae clientes y compras desde Bsale y Shopify, actualiza `attributes` |
| `POST /api/mk/segments/:id/count` | ERP | Calcula el tamaño de la audiencia |
| `POST /api/mk/campaigns/:id/test` | ERP | Envía prueba a correos internos |
| `POST /api/mk/campaigns/:id/launch` | ERP o cron de programadas | Congela HTML, arma `mk_sends` excluyendo supresiones, encola lotes en QStash |
| `POST /api/mk/worker/send-batch` | QStash | Toma 50 destinatarios `queued`, personaliza y envía con SES; respeta `rate_per_sec` |
| `POST /api/mk/webhooks/ses` | SNS | Valida firma SNS, guarda en `mk_events`, actualiza `mk_sends`, supresiones y totales |
| `GET /u/:token` | Link en el correo | Página de baja con confirmación |
| `POST /u/:token` | One-click (`List-Unsubscribe-Post`) | Baja inmediata, agrega a `mk_suppressions` |
| `GET /api/mk/campaigns/:id/report` | ERP | Entregados, rebotes, aperturas, clics, bajas |

Con 14 correos/seg (límite inicial típico de SES), una campaña de 10.000 tarda ~12 min.

## Entregabilidad y cumplimiento (obligatorio desde el primer envío)

- Enviar desde subdominio: `news.indexstore.cl` / `news.indexpro.cl`. SPF, DKIM (Easy DKIM) y DMARC `p=none` al inicio.
- Custom MAIL FROM: `bounce.news.indexstore.cl`.
- Dominio de tracking propio con HTTPS para aperturas y clics.
- Encabezados en cada correo: `List-Unsubscribe` y `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Pausa automática de campaña si rebotes > 5% o quejas > 0,1%.
- Rebote permanente o queja → `mk_suppressions` al instante. Activar también la lista de supresión de la cuenta SES.
- Antes de cancelar Zoho: exportar desuscritos, rebotes y quejas e importarlos como supresiones.
- Calentamiento: de ~1.000 a 10.000 por envío en 2–3 semanas, empezando por quienes abrieron recientemente.
- Ley 19.496 (Chile): identificar remitente, indicar que es publicidad, ofrecer baja expedita. Guardar `consent_source` y `consent_at`.
- Pedir salida del sandbox de SES describiendo consentimiento y bajas.

## Variables de entorno sugeridas

```
DATABASE_URL=
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
SES_CONFIGURATION_SET=mk-marketing
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
MK_UNSUB_SECRET=
MK_PUBLIC_BASE_URL=https://erp.indexstore.cl
```

## Plan por fases

1. **Infraestructura:** cuenta SES, verificación de dominio, DNS, configuration set con SNS, salida de sandbox, tablas en Postgres.
2. **Núcleo de envío:** importación desde Zoho, plantillas, lanzamiento, worker por lotes, webhook de eventos, baja one-click. Probar con listas internas.
3. **Calentamiento y operación:** campañas reales con volumen creciente, comparando contra Zoho. Al estabilizar, cancelar Zoho.
4. **Valor agregado:** segmentos con datos de Bsale y Shopify, sync nocturno, automatizaciones (carrito abandonado, aviso de stock, post-reparación), reportes en el ERP.

## Preguntas abiertas

- ¿Qué base de datos usa hoy el ERP?
- ¿Editor de plantillas visual o basta con HTML/MJML?

## Primera tarea para Claude Code

1. Revisar la estructura del repo del ERP y la base de datos actual; adaptar `schema.sql` si no es Postgres.
2. Crear la migración con las tablas `mk_*`.
3. Implementar en este orden: `contacts/import` (CSV Zoho + supresiones) → `webhooks/ses` → `campaigns/:id/launch` → `worker/send-batch` → `/u/:token`.
4. Agregar tests para: exclusión de supresiones, no-duplicado en reintentos, validación de firma SNS y de QStash, token de baja.

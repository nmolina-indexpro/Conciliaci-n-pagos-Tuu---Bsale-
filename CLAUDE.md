# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Internal back-office panel for IndexStore (Chilean retailer) built as **Vercel serverless
functions + static HTML pages, no framework, no build step, no bundler**. It reconciles
POS sales (TUU/Haulmer) against invoicing (Bsale), pulls Shopify orders and BCI bank
transfers, and adds purchasing/stock and cash-flow tooling on top of the same Bsale data.

All UI text and code comments are in Spanish (Chile) — match that when editing.

## Commands

There is no linter or build step. The only tests are for the Mailing module (`npm test` → `node --test "tests/**/*.test.js"`, Node ≥ 20): they run against an
in-memory Postgres (PGlite, a devDependency) with the real `asegurarTablasMailing` migration. Mailing lives in `lib/mailing/` and is exposed as `?recurso=mk-*`
inside `api/negocio.js` (see `docs/mailing/IMPLEMENTACION.md` for the endpoints, env vars and what is still pending).

```bash
npm i -g vercel
cp .env.example .env.local   # fill in tokens (see Environment variables below)
vercel dev                   # local dev server, serves /public and /api together
```

Deployment is via Vercel on git push (no manual deploy command in this repo).

## Architecture

### Two runtimes, one auth secret

- **`middleware.ts`** runs on Vercel's **Edge runtime** for every request and is what
  actually enforces login. It verifies the `session` cookie using Web Crypto (Edge has no
  Node `crypto` module). Public paths are hardcoded in `RUTAS_PUBLICAS` — everything else
  requires a valid session (401 JSON for `/api/*`, redirect to `/login.html` otherwise).
- **`lib/auth-node.js`** is the Node-runtime equivalent used *inside* individual `/api`
  functions (`usuarioDesdeRequest(req)`), for role checks (`sesion.rol === 'admin'`) etc.
- Both sides sign/verify the same HMAC-SHA256 token and **must share the `AUTH_SECRET`
  env var** — if you change one verification scheme, check the other.
- Passwords: Node `scrypt`, no external deps.

### `/api` — serverless functions

Every file in `/api` is a standalone Vercel function (`export default function handler(req, res)`).
Common conventions to follow when adding/editing one:

- External API calls use a local `fetchWithTimeout()` helper (AbortController) — copy this
  pattern rather than calling `fetch` bare, since Vercel functions have hard duration caps
  (see `vercel.json`, per-function `maxDuration`).
- Pagination against external APIs is done by fetching page 1 first to read the total
  count, then firing the remaining pages with `Promise.all` — not sequentially — to stay
  under the timeout.
- Endpoints accept `?date=` or `?startDate=&endDate=` (YYYY-MM-DD) and return normalized
  JSON shaped for the frontend to reconcile directly (e.g. `{ credito, debito,
  transferencia, efectivo, ... }`).
- Many report endpoints support `?debug=...` modes that dump raw/intermediate data
  (transaction classification counts, raw documents, etc.) — this is the primary tool for
  diagnosing "why did this transaction get classified wrong" issues. Check for an existing
  `debug` branch before adding new debug logging.
- Provider tokens (`BSALE_ACCESS_TOKEN`, `TUU_API_KEY`, Shopify credentials) are read from
  `process.env` inside the handler and **never** sent to the browser.
- **Vercel Hobby plan caps serverless functions at 12 per deployment.** `api/negocio.js`
  intentionally multiplexes two logical resources (`?recurso=criticos|reportes`) into one
  file to stay under that limit — prefer adding a `?recurso=` branch to an existing
  multiplexed endpoint over adding a brand-new top-level file, unless the function count
  has headroom.
- `lib/db.js` imports `@vercel/postgres` dynamically (inside the function, not at module
  scope) so a missing `POSTGRES_URL` produces a controlled JSON error instead of crashing
  the whole function at import time. Follow the same pattern for any new DB-backed endpoint
  (see `api/bci-transferencias-report.js` for another example).
- `lib/db.js` also holds `asegurar*` functions (`asegurarTablaUsuarios`, etc.) that run
  `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN IF NOT EXISTS` on every request —
  this is the migration mechanism; there's no separate migration tool/step.

### Data sources and their quirks (worth knowing before touching classification logic)

- **Bsale** (`api/bsale-report.js`, `api/bsale-sku-report.js`, `api/bsale-facturas-por-pagar.js`):
  `emissionDate` is stored as UTC midnight regardless of Chile's real timezone — date
  filtering compares in raw UTC, not Chile local time. Payment-method matching is by exact
  normalized name (`TARJETA CREDITO`, `TARJETA DEBITO`, ...), not substring, to avoid
  confusing similarly-named methods. Document `state !== 0` (voided) and Notas de
  Crédito/Cotizaciones are excluded from sales sums.
- **TUU** (`api/tuu-report.js`): only `status: completed` transactions count. Debit/credit
  classification is inferred (`transactionType`, or >1 installment ⇒ credit) because TUU's
  API doesn't reliably report the type; unresolved cases land in `otras` rather than being
  guessed. `EXCEPCIONES_SALE_ID` is a manually-curated override table for specific
  `saleId`s that were verified by hand against TUU's own dashboard — add to it (with a
  comment explaining how it was verified) rather than loosening the general inference rules.
- **Shopify** (`api/shopify-report.js`): uses OAuth Client Credentials Grant (fetches a
  fresh ~24h token per request from `SHOPIFY_CLIENT_ID`/`SECRET`), not a static Admin API
  token. Bsale document numbers are recovered from order tags (`NV-####`, `FA-####`).
- **BCI transfers** (`api/bci-transferencias-report.js`): reads from a `bci_notificaciones`
  Postgres table that a webhook handler populates — that webhook file is not currently
  present in this repo; treat its absence as expected, not a bug to fix.
- Bsale supplier/provider identification (`identificarProveedor`) is duplicated between
  `api/bsale-sku-report.js` and `api/bsale-facturas-por-pagar.js` (provider regex list +
  payment-term days) — keep both in sync if you change supplier terms.

### `/public` — frontend

Each page is a **single self-contained HTML file** (inline `<style>` and `<script>`, no
imports/bundler) that calls the `/api/*` endpoints directly with `fetch`. Pages share a
top `page-nav` bar (see `public/home.html`) linking: `home.html`, `index.html` ("Flujo de
Caja" — note this is a different/older page than `flujo-caja.html`), `conciliacion.html`,
`compras.html`, `alertas-stock.html`, `guia-uso.html`, `usuarios.html` (hidden unless
admin), plus standalone `login.html` and `reportar-error.html`.

- `public/restriccion-usuario.js` is included by pages to disable export/copy for the
  `usuario` role (vs `admin`) after reading the session — mark any new
  download/export button with class `btn-exportar` so it gets disabled automatically for
  non-admins.
- **Any resumable sync / long-running action triggered by a button (Sincronizar, Analizar
  en lote, etc.) must show progress as a percentage**, not just a raw "X de Y" count —
  compute `Math.round(actual / total * 100)` wherever a real total is known (or a good
  approximation, e.g. `procesados + pendientes` when the backend only reports what's
  left) and show it alongside the existing counts, e.g. `"42% — 1.234 de 2.938 documentos
  revisados"`. If no meaningful total exists yet (first page of a paginated sync before
  Bsale reports its count), keep the plain count instead of showing a fake/misleading %.
- Session state is fetched client-side via `/api/auth-session`; role-gated UI (like the
  "Usuarios" nav link) is toggled in JS after that call, not server-rendered.

## Environment variables

Set in Vercel → Settings → Environment Variables (and mirrored in local `.env.local` for
`vercel dev`):

- `AUTH_SECRET` — HMAC signing secret, must match between `middleware.ts` and
  `lib/auth-node.js` (same runtime env, so just needs to be set once).
- `BSALE_ACCESS_TOKEN`, `BSALE_OFFICE_ID` (optional, filters by office)
- `TUU_API_KEY`
- `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`
- `POSTGRES_URL` — Vercel Postgres, used for users, error reports, critical products, and
  BCI transfer notifications
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (optional) — welcome
  emails and error/objection alerts via `lib/mailer.js`; failures degrade gracefully
  (`{ enviado: false }`) rather than blocking the underlying action.

- Mailing (Amazon SES + QStash): `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_CONFIGURATION_SET`, `MK_SNS_TOPIC_ARN`, `QSTASH_TOKEN`,
  `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `MK_UNSUB_SECRET`, `MK_PUBLIC_BASE_URL` — details in `docs/mailing/IMPLEMENTACION.md`.

Every endpoint that depends on a missing env var should return a controlled JSON error
(often `200` with an `error` field, so the frontend can render a message instead of
crashing) rather than throwing — follow this pattern for new integrations.

## Notificaciones por correo (diseño estándar)

Todo correo de Usuarios > Notificaciones se arma con `lib/correo-base.js` (encabezado azul `IndexStore · Área`, tarjetas de cifras, avisos "Requiere atención" /
"Lo que destaca", tablas cortas con "… y N más en el ERP", botón al ERP, leyenda "Cómo leerlo" y pie "Notificación del sistema ERP · IndexStore"). Cada correo es
una función pura que devuelve `{ asunto, html }` (ver `lib/correos-notificaciones.js`, `lib/servicio-tecnico-correo.js`, `lib/cotizaciones-seguimiento.js`).
Sin montos, ventas ni costos de la empresa. Todo tipo nuevo se registra en `lib/notificaciones.js` (con categoría), debe aceptar `?probar=1&para=...` para el botón
"Enviar prueba" y guardar el último correo con `marcarNotificacionEnviada(sql, tipo, { asunto, html })`.
**Programación:** la frecuencia/día que se elige en Usuarios > Notificaciones solo funciona si el cron de `vercel.json` corre todos los días. Si una notificación corre solo
ciertos días (o es instantánea), debe figurar en `PROGRAMACION_NOTIFICACION` (`lib/notificaciones.js`): la página y la API entonces solo ofrecen lo que se puede cumplir y
avisan si la configuración guardada no se cumpliría. Al agregar o cambiar un cron de una notificación, actualizar esa lista. Nunca asumir en un handler que corre un día fijo
(calcular las fechas a partir de hoy en Chile).

-- Módulo de Mailing ERP IndexStore / IndexPro
-- Postgres (Supabase o Neon). Prefijo mk_ para no chocar con tablas existentes del ERP.

create extension if not exists citext;
create extension if not exists pgcrypto;

-- Tipos
create type mk_contact_status as enum ('subscribed','unsubscribed','bounced','complained','pending');
create type mk_campaign_status as enum ('draft','scheduled','sending','paused','sent','cancelled','failed');
create type mk_send_status as enum ('queued','sent','delivered','bounced','complained','failed','suppressed');
create type mk_event_type as enum ('send','delivery','bounce','complaint','open','click','reject','rendering_failure','delivery_delay');

-- Contactos
create table mk_contacts (
  id                  uuid primary key default gen_random_uuid(),
  email               citext not null unique,
  first_name          text,
  last_name           text,
  company_name        text,
  company_rut         text,
  business_line       text check (business_line in ('indexstore','indexpro','fonoip')),
  source              text not null default 'manual',   -- bsale | shopify | zoho_import | form | manual
  bsale_client_id     bigint,
  shopify_customer_id bigint,
  tags                text[] not null default '{}',
  attributes          jsonb  not null default '{}',     -- comuna, última compra, categorías, etc.
  status              mk_contact_status not null default 'subscribed',
  consent_source      text,                              -- dónde dio el consentimiento
  consent_at          timestamptz,
  unsubscribed_at     timestamptz,
  last_sent_at        timestamptz,
  last_open_at        timestamptz,
  last_click_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on mk_contacts (status);
create index on mk_contacts using gin (tags);
create index on mk_contacts using gin (attributes jsonb_path_ops);
create index on mk_contacts (bsale_client_id);
create index on mk_contacts (shopify_customer_id);

-- Listas estáticas
create table mk_lists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);
create table mk_list_members (
  list_id    uuid references mk_lists(id) on delete cascade,
  contact_id uuid references mk_contacts(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (list_id, contact_id)
);

-- Segmentos dinámicos
create table mk_segments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  rules        jsonb not null,   -- {"all":[{"field":"tags","op":"contains","value":"baterias"},{"field":"last_purchase_days","op":">","value":180}]}
  cached_count int,
  counted_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- Supresión global (se revisa al armar audiencia y justo antes de enviar)
create table mk_suppressions (
  email      citext primary key,
  reason     text not null check (reason in ('unsubscribe','hard_bounce','complaint','manual','zoho_import')),
  detail     text,
  created_at timestamptz not null default now()
);

-- Plantillas
create table mk_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  subject    text not null,
  preheader  text,
  mjml       text,
  html       text not null,
  text_body  text,
  variables  text[] not null default '{}',   -- {{first_name}}, {{unsubscribe_url}}...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Campañas
create table mk_campaigns (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  template_id        uuid references mk_templates(id),
  subject            text not null,          -- copia congelada al enviar
  html_snapshot      text,                   -- HTML final usado
  from_name          text not null default 'IndexStore',
  from_email         text not null,          -- ej: ofertas@news.indexstore.cl
  reply_to           text,
  audience           jsonb not null,         -- {"lists":[...],"segments":[...],"exclude_lists":[...]}
  status             mk_campaign_status not null default 'draft',
  scheduled_at       timestamptz,
  started_at         timestamptz,
  finished_at        timestamptz,
  rate_per_sec       int not null default 14, -- límite de envío de la cuenta SES
  total_recipients   int default 0,
  total_sent         int default 0,
  total_delivered    int default 0,
  total_bounced      int default 0,
  total_complaints   int default 0,
  unique_opens       int default 0,
  unique_clicks      int default 0,
  total_unsubscribes int default 0,
  created_by         text,
  created_at         timestamptz not null default now()
);
create index on mk_campaigns (status, scheduled_at);

-- Un registro por destinatario
create table mk_sends (
  id             bigserial primary key,
  campaign_id    uuid not null references mk_campaigns(id) on delete cascade,
  contact_id     uuid not null references mk_contacts(id),
  email          citext not null,
  status         mk_send_status not null default 'queued',
  ses_message_id text unique,
  attempts       smallint not null default 0,
  error          text,
  queued_at      timestamptz not null default now(),
  sent_at        timestamptz,
  delivered_at   timestamptz,
  first_open_at  timestamptz,
  first_click_at timestamptz,
  unique (campaign_id, contact_id)            -- evita duplicados en reintentos
);
create index on mk_sends (campaign_id, status);

-- Eventos crudos de SES (vía SNS → webhook)
create table mk_events (
  id             bigserial primary key,
  send_id        bigint references mk_sends(id) on delete set null,
  ses_message_id text not null,
  type           mk_event_type not null,
  url            text,                        -- para clics
  bounce_type    text,                        -- Permanent | Transient
  user_agent     text,
  payload        jsonb not null,
  occurred_at    timestamptz not null,
  received_at    timestamptz not null default now()
);
create index on mk_events (ses_message_id);
create index on mk_events (send_id, type);

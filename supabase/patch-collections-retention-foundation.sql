-- Sprint 3.1 / 3.1C — Cobrança + Retenção + histórico operacional unificado
--
-- Cria: collection_cases, retention_cases, *_case_events, operational_case_contact_attempts,
--       operational_sector_settings, operational_settings_events,
--       operational_attendances, customer_operational_history
-- RPC: escalate_collection_to_retention (service_role) — infraestrutura 3.1B, não exposta na UI 3.1C
--
-- Cron futuro: NÃO ativar nesta sprint. Sync = POST /api/admin/collections/sync (Admin Master).
-- Sem escrita no Controllr. Sem DML de clientes. Sem inferência de cancelamento ERP.
--
-- NÃO altera: rewards, wallet, Comercial legado, SLA Comercial, Auth users,
-- BRByte flags, planos Controllr, vercel cron.
-- Idempotente: CREATE IF NOT EXISTS, DROP TRIGGER IF EXISTS, CREATE OR REPLACE.
-- Membership NÃO autoriza /admin. Admin Master NÃO entra no round-robin
-- só por ser admin (o motor 2.2 já exige employee+membership ativa).

begin;

-- ============================================================
-- collection_cases
-- ============================================================
create table if not exists public.collection_cases (
  id uuid primary key default gen_random_uuid(),
  client_pk text,
  contract_pk text,
  invoice_pk text,
  customer_name text,
  customer_document text,
  days_overdue integer not null default 0,
  overdue_since date,
  outstanding_amount numeric,
  status text not null default 'open',
  sector_assignment_id uuid references public.sector_work_assignments(id) on delete set null,
  erp_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  closed_at timestamptz,
  constraint collection_cases_status_chk check (
    status in (
      'open',
      'in_contact',
      'promise_to_pay',
      'paid',
      'unresolved',
      'escalated_retention',
      'closed'
    )
  ),
  constraint collection_cases_days_overdue_chk check (days_overdue >= 0)
);

comment on table public.collection_cases is
  'Casos de Cobrança. Status de negócio NÃO vive em sector_work_assignments. Snapshot é auditoria; fonte de verdade continua o ERP/Controllr.';

comment on column public.collection_cases.erp_snapshot is
  'Snapshot sanitizado para auditoria. Não é fonte de verdade financeira.';

comment on column public.collection_cases.invoice_pk is
  'Identidade ERP da fatura (unicidade do caso). Não inventar PK.';

drop trigger if exists trg_collection_cases_set_updated_at on public.collection_cases;
create trigger trg_collection_cases_set_updated_at
before update on public.collection_cases
for each row execute function public.set_updated_at();

create unique index if not exists collection_cases_invoice_pk_uidx
  on public.collection_cases (invoice_pk)
  where invoice_pk is not null;

create index if not exists collection_cases_status_idx
  on public.collection_cases (status);

create index if not exists collection_cases_contract_pk_idx
  on public.collection_cases (contract_pk)
  where contract_pk is not null;

create index if not exists collection_cases_client_pk_idx
  on public.collection_cases (client_pk)
  where client_pk is not null;

create index if not exists collection_cases_assignment_idx
  on public.collection_cases (sector_assignment_id)
  where sector_assignment_id is not null;

-- ============================================================
-- retention_cases
-- ============================================================
create table if not exists public.retention_cases (
  id uuid primary key default gen_random_uuid(),
  client_pk text,
  contract_pk text,
  source text not null,
  reason text,
  status text not null default 'open',
  linked_collection_case_id uuid references public.collection_cases(id) on delete restrict,
  sector_assignment_id uuid references public.sector_work_assignments(id) on delete set null,
  erp_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  closed_at timestamptz,
  constraint retention_cases_status_chk check (
    status in (
      'open',
      'in_contact',
      'offer_made',
      'retained',
      'not_retained',
      'cancelled',
      'closed'
    )
  ),
  constraint retention_cases_source_chk check (
    source in ('collections_escalation', 'manual', 'future_erp')
  ),
  constraint retention_cases_linked_collection_key unique (linked_collection_case_id)
);

comment on table public.retention_cases is
  'Casos de Retenção. Escalada da Cobrança é idempotente via linked_collection_case_id.';

drop trigger if exists trg_retention_cases_set_updated_at on public.retention_cases;
create trigger trg_retention_cases_set_updated_at
before update on public.retention_cases
for each row execute function public.set_updated_at();

create index if not exists retention_cases_status_idx
  on public.retention_cases (status);

create index if not exists retention_cases_client_pk_idx
  on public.retention_cases (client_pk)
  where client_pk is not null;

create index if not exists retention_cases_assignment_idx
  on public.retention_cases (sector_assignment_id)
  where sector_assignment_id is not null;

-- ============================================================
-- Histórico de negócio (append-only). NÃO duplica sector_assignment_events.
-- ============================================================
create table if not exists public.collection_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.collection_cases(id) on delete restrict,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint collection_case_events_type_chk check (
    event_type in (
      'created',
      'assigned',
      'contact_attempt',
      'promise_to_pay',
      'payment_detected',
      'status_changed',
      'escalated',
      'transferred',
      'closed'
    )
  )
);

comment on table public.collection_case_events is
  'Histórico append-only de negócio da Cobrança. Motor 2.2 registra ownership; este módulo registra o caso.';

create index if not exists collection_case_events_case_created_idx
  on public.collection_case_events (case_id, created_at desc);

create table if not exists public.retention_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.retention_cases(id) on delete restrict,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint retention_case_events_type_chk check (
    event_type in (
      'created',
      'assigned',
      'contact_attempt',
      'offer_made',
      'retained',
      'not_retained',
      'status_changed',
      'transferred',
      'closed'
    )
  )
);

comment on table public.retention_case_events is
  'Histórico append-only de negócio da Retenção.';

create index if not exists retention_case_events_case_created_idx
  on public.retention_case_events (case_id, created_at desc);

create or replace function public.trg_collection_case_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'collection_case_events is append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_collection_case_events_append_only
  on public.collection_case_events;
create trigger trg_collection_case_events_append_only
before update or delete on public.collection_case_events
for each row execute function public.trg_collection_case_events_append_only();

create or replace function public.trg_retention_case_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'retention_case_events is append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_retention_case_events_append_only
  on public.retention_case_events;
create trigger trg_retention_case_events_append_only
before update or delete on public.retention_case_events
for each row execute function public.trg_retention_case_events_append_only();

-- ============================================================
-- Tentativas de contato (Cobrança e Retenção)
-- ============================================================
create table if not exists public.operational_case_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  case_type text not null,
  case_id uuid not null,
  channel text not null,
  outcome text not null,
  notes text,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  constraint operational_case_contact_attempts_type_chk check (
    case_type in ('collection_case', 'retention_case')
  ),
  constraint operational_case_contact_attempts_channel_chk check (
    channel in ('phone', 'whatsapp', 'email', 'other')
  ),
  constraint operational_case_contact_attempts_outcome_chk check (
    outcome in (
      'no_answer',
      'contacted',
      'promised_payment',
      'refused',
      'callback',
      'other'
    )
  )
);

comment on table public.operational_case_contact_attempts is
  'Tentativas de contato operacionais. Actor sempre vem do servidor (sessão). Sem PII excessiva.';

create index if not exists operational_case_contact_attempts_case_idx
  on public.operational_case_contact_attempts (case_type, case_id, created_at desc);

create index if not exists operational_case_contact_attempts_actor_idx
  on public.operational_case_contact_attempts (actor_profile_id, created_at desc);

-- ============================================================
-- Configurações operacionais por setor (JSONB validado no servidor)
-- ============================================================
create table if not exists public.operational_sector_settings (
  id uuid primary key default gen_random_uuid(),
  sector_code text not null,
  is_enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  updated_by_profile_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint operational_sector_settings_code_chk check (
    sector_code in (
      'collections',
      'retention',
      'post_sale',
      'upgrade',
      'technician',
      'commercial',
      'external_sales'
    )
  ),
  constraint operational_sector_settings_code_key unique (sector_code)
);

comment on table public.operational_sector_settings is
  'Configuração operacional por setor. Schema JSONB validado server-side. Sem DML de clientes.';

create table if not exists public.operational_settings_events (
  id uuid primary key default gen_random_uuid(),
  sector_code text not null,
  actor_profile_id uuid references public.profiles(id) on delete restrict,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.operational_settings_events is
  'Auditoria append-only de alterações em operational_sector_settings.';

create index if not exists operational_settings_events_sector_idx
  on public.operational_settings_events (sector_code, created_at desc);

create or replace function public.trg_operational_settings_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'operational_settings_events is append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_operational_settings_events_append_only
  on public.operational_settings_events;
create trigger trg_operational_settings_events_append_only
before update or delete on public.operational_settings_events
for each row execute function public.trg_operational_settings_events_append_only();

insert into public.operational_sector_settings (sector_code, is_enabled, settings)
values (
  'collections',
  true,
  jsonb_build_object(
    'minimum_days_overdue', 5,
    'include_cancelled_customers', false
  )
)
on conflict (sector_code) do nothing;

insert into public.operational_sector_settings (sector_code, is_enabled, settings)
values (
  'retention',
  true,
  jsonb_build_object('search_by_document', true)
)
on conflict (sector_code) do nothing;

-- ============================================================
-- Atendimentos operacionais (Retenção 3.1C: busca + relatório, sem assignment)
-- ============================================================
create table if not exists public.operational_attendances (
  id uuid primary key default gen_random_uuid(),
  sector_code text not null,
  client_pk text,
  contract_pk text,
  document_normalized text not null,
  customer_name_snapshot text,
  employee_id uuid not null references public.employees(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  reason text,
  action_taken text,
  notes text,
  customer_remains boolean,
  outcome text,
  status text not null default 'open',
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  erp_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint operational_attendances_sector_chk check (
    sector_code in (
      'collections',
      'retention',
      'post_sale',
      'upgrade',
      'technician',
      'commercial',
      'external_sales'
    )
  ),
  constraint operational_attendances_status_chk check (status in ('open', 'completed')),
  constraint operational_attendances_document_chk check (char_length(document_normalized) >= 11)
);

comment on table public.operational_attendances is
  'Atendimento operacional iniciado pelo employee. Sem sector_work_assignment. Actor/employee só do servidor.';

create index if not exists operational_attendances_document_idx
  on public.operational_attendances (document_normalized, started_at desc);

create index if not exists operational_attendances_client_idx
  on public.operational_attendances (client_pk, started_at desc);

create index if not exists operational_attendances_employee_idx
  on public.operational_attendances (employee_id, status, started_at desc);

create index if not exists operational_attendances_sector_idx
  on public.operational_attendances (sector_code, started_at desc);

-- ============================================================
-- Histórico operacional unificado do cliente (append-only, timeline humana)
-- ============================================================
create table if not exists public.customer_operational_history (
  id uuid primary key default gen_random_uuid(),
  client_pk text,
  contract_pk text,
  document_reference text,
  customer_name_snapshot text,
  sector_code text not null,
  employee_id uuid references public.employees(id) on delete restrict,
  actor_profile_id uuid references public.profiles(id) on delete restrict,
  source text not null,
  external_history_id text,
  event_type text not null,
  action text,
  result text,
  notes text,
  customer_remains boolean,
  occurred_at timestamptz not null default timezone('utc', now()),
  external_created_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint customer_operational_history_sector_chk check (
    sector_code in (
      'collections',
      'retention',
      'post_sale',
      'upgrade',
      'technician',
      'commercial',
      'external_sales'
    )
  ),
  constraint customer_operational_history_source_chk check (source in ('crm', 'controllr'))
);

comment on table public.customer_operational_history is
  'Timeline humana do cliente. Distinta de sector_assignment_events e collection_case_events. Append-only. source=controllr reservado; escrita ERP desligada na 3.1C.';

create unique index if not exists customer_operational_history_external_uidx
  on public.customer_operational_history (source, external_history_id)
  where external_history_id is not null;

create index if not exists customer_operational_history_client_idx
  on public.customer_operational_history (client_pk, occurred_at desc);

create index if not exists customer_operational_history_contract_idx
  on public.customer_operational_history (contract_pk, occurred_at desc);

create index if not exists customer_operational_history_document_idx
  on public.customer_operational_history (document_reference, occurred_at desc);

create index if not exists customer_operational_history_sector_idx
  on public.customer_operational_history (sector_code, occurred_at desc);

create index if not exists customer_operational_history_occurred_idx
  on public.customer_operational_history (occurred_at desc);

create or replace function public.trg_customer_operational_history_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'customer_operational_history is append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_customer_operational_history_append_only
  on public.customer_operational_history;
create trigger trg_customer_operational_history_append_only
before update or delete on public.customer_operational_history
for each row execute function public.trg_customer_operational_history_append_only();

-- ============================================================
-- RLS: leitura filtrada; escrita só service_role
-- ============================================================
alter table public.collection_cases enable row level security;
alter table public.retention_cases enable row level security;
alter table public.collection_case_events enable row level security;
alter table public.retention_case_events enable row level security;
alter table public.operational_case_contact_attempts enable row level security;

drop policy if exists collection_cases_select_policy on public.collection_cases;
create policy collection_cases_select_policy
on public.collection_cases
for select
to authenticated
using (
  public.is_admin_read_any()
  or exists (
    select 1
    from public.employees e
    join public.sector_work_assignments a
      on a.employee_id = e.id
     and a.work_type = 'collection_case'
     and a.work_id = collection_cases.id
    where e.profile_id = auth.uid()
  )
);

drop policy if exists retention_cases_select_policy on public.retention_cases;
create policy retention_cases_select_policy
on public.retention_cases
for select
to authenticated
using (
  public.is_admin_read_any()
  or exists (
    select 1
    from public.employees e
    join public.sector_work_assignments a
      on a.employee_id = e.id
     and a.work_type = 'retention_case'
     and a.work_id = retention_cases.id
    where e.profile_id = auth.uid()
  )
);

drop policy if exists collection_case_events_select_policy
  on public.collection_case_events;
create policy collection_case_events_select_policy
on public.collection_case_events
for select
to authenticated
using (
  public.is_admin_read_any()
  or exists (
    select 1
    from public.employees e
    join public.sector_work_assignments a
      on a.employee_id = e.id
     and a.work_type = 'collection_case'
     and a.work_id = collection_case_events.case_id
    where e.profile_id = auth.uid()
  )
);

drop policy if exists retention_case_events_select_policy
  on public.retention_case_events;
create policy retention_case_events_select_policy
on public.retention_case_events
for select
to authenticated
using (
  public.is_admin_read_any()
  or exists (
    select 1
    from public.employees e
    join public.sector_work_assignments a
      on a.employee_id = e.id
     and a.work_type = 'retention_case'
     and a.work_id = retention_case_events.case_id
    where e.profile_id = auth.uid()
  )
);

drop policy if exists operational_case_contact_attempts_select_policy
  on public.operational_case_contact_attempts;
create policy operational_case_contact_attempts_select_policy
on public.operational_case_contact_attempts
for select
to authenticated
using (
  public.is_admin_read_any()
  or (
    case_type = 'collection_case'
    and exists (
      select 1
      from public.employees e
      join public.sector_work_assignments a
        on a.employee_id = e.id
       and a.work_type = 'collection_case'
       and a.work_id = operational_case_contact_attempts.case_id
      where e.profile_id = auth.uid()
    )
  )
  or (
    case_type = 'retention_case'
    and exists (
      select 1
      from public.employees e
      join public.sector_work_assignments a
        on a.employee_id = e.id
       and a.work_type = 'retention_case'
       and a.work_id = operational_case_contact_attempts.case_id
      where e.profile_id = auth.uid()
    )
  )
);

-- Sem policies INSERT/UPDATE/DELETE para authenticated/anon.

revoke all on table public.collection_cases from public;
revoke all on table public.collection_cases from anon;
revoke all on table public.retention_cases from public;
revoke all on table public.retention_cases from anon;
revoke all on table public.collection_case_events from public;
revoke all on table public.collection_case_events from anon;
revoke all on table public.retention_case_events from public;
revoke all on table public.retention_case_events from anon;
revoke all on table public.operational_case_contact_attempts from public;
revoke all on table public.operational_case_contact_attempts from anon;

revoke insert, update, delete, truncate on table public.collection_cases from authenticated;
revoke insert, update, delete, truncate on table public.retention_cases from authenticated;
revoke insert, update, delete, truncate on table public.collection_case_events from authenticated;
revoke insert, update, delete, truncate on table public.retention_case_events from authenticated;
revoke insert, update, delete, truncate on table public.operational_case_contact_attempts from authenticated;

grant select on table public.collection_cases to authenticated;
grant select on table public.retention_cases to authenticated;
grant select on table public.collection_case_events to authenticated;
grant select on table public.retention_case_events to authenticated;
grant select on table public.operational_case_contact_attempts to authenticated;

grant all on table public.collection_cases to service_role;
grant all on table public.retention_cases to service_role;
grant all on table public.collection_case_events to service_role;
grant all on table public.retention_case_events to service_role;
grant all on table public.operational_case_contact_attempts to service_role;

alter table public.operational_sector_settings enable row level security;
alter table public.operational_settings_events enable row level security;
alter table public.operational_attendances enable row level security;
alter table public.customer_operational_history enable row level security;

drop policy if exists operational_sector_settings_select_policy
  on public.operational_sector_settings;
create policy operational_sector_settings_select_policy
on public.operational_sector_settings
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin_master', 'admin_consulta')
  )
);

drop policy if exists operational_settings_events_select_policy
  on public.operational_settings_events;
create policy operational_settings_events_select_policy
on public.operational_settings_events
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin_master', 'admin_consulta')
  )
);

drop policy if exists operational_attendances_select_policy
  on public.operational_attendances;
create policy operational_attendances_select_policy
on public.operational_attendances
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin_master', 'admin_consulta')
  )
  or exists (
    select 1
    from public.employees e
    join public.employee_sector_memberships m
      on m.employee_id = e.id
     and m.is_active = true
    join public.sectors s
      on s.id = m.sector_id
     and s.code = operational_attendances.sector_code
    where e.profile_id = auth.uid()
      and e.status = 'active'
  )
);

drop policy if exists customer_operational_history_select_policy
  on public.customer_operational_history;
create policy customer_operational_history_select_policy
on public.customer_operational_history
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin_master', 'admin_consulta')
  )
  or exists (
    select 1
    from public.employees e
    join public.employee_sector_memberships m
      on m.employee_id = e.id
     and m.is_active = true
    join public.sectors s
      on s.id = m.sector_id
     and s.code = customer_operational_history.sector_code
    where e.profile_id = auth.uid()
      and e.status = 'active'
  )
  or exists (
    select 1
    from public.collection_cases c
    join public.sector_work_assignments a
      on a.work_id = c.id
     and a.work_type = 'collection_case'
     and a.status = 'active'
    join public.employees e
      on e.id = a.employee_id
    where e.profile_id = auth.uid()
      and c.client_pk is not null
      and c.client_pk = customer_operational_history.client_pk
  )
);

revoke all on table public.operational_sector_settings from public;
revoke all on table public.operational_sector_settings from anon;
revoke all on table public.operational_settings_events from public;
revoke all on table public.operational_settings_events from anon;
revoke all on table public.operational_attendances from public;
revoke all on table public.operational_attendances from anon;
revoke all on table public.customer_operational_history from public;
revoke all on table public.customer_operational_history from anon;

revoke insert, update, delete, truncate on table public.operational_sector_settings from authenticated;
revoke insert, update, delete, truncate on table public.operational_settings_events from authenticated;
revoke insert, update, delete, truncate on table public.operational_attendances from authenticated;
revoke insert, update, delete, truncate on table public.customer_operational_history from authenticated;

grant select on table public.operational_sector_settings to authenticated;
grant select on table public.operational_settings_events to authenticated;
grant select on table public.operational_attendances to authenticated;
grant select on table public.customer_operational_history to authenticated;

grant all on table public.operational_sector_settings to service_role;
grant all on table public.operational_settings_events to service_role;
grant all on table public.operational_attendances to service_role;
grant all on table public.customer_operational_history to service_role;

revoke all on function public.trg_operational_settings_events_append_only() from public;
revoke all on function public.trg_operational_settings_events_append_only() from anon;
revoke all on function public.trg_operational_settings_events_append_only() from authenticated;

revoke all on function public.trg_customer_operational_history_append_only() from public;
revoke all on function public.trg_customer_operational_history_append_only() from anon;
revoke all on function public.trg_customer_operational_history_append_only() from authenticated;

revoke all on function public.trg_collection_case_events_append_only() from public;
revoke all on function public.trg_collection_case_events_append_only() from anon;
revoke all on function public.trg_collection_case_events_append_only() from authenticated;

revoke all on function public.trg_retention_case_events_append_only() from public;
revoke all on function public.trg_retention_case_events_append_only() from anon;
revoke all on function public.trg_retention_case_events_append_only() from authenticated;

-- ============================================================
-- Escalada Cobrança → Retenção (transação + lock + idempotência)
-- ============================================================
create or replace function public.escalate_collection_to_retention(
  p_collection_case_id uuid,
  p_actor_profile_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.collection_cases%rowtype;
  v_retention public.retention_cases%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_collections_asg public.sector_work_assignments%rowtype;
  v_assign jsonb;
  v_release jsonb;
  v_created boolean := false;
  v_assign_code text;
  v_fail_code text;
begin
  if p_collection_case_id is null or p_actor_profile_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_case
  from public.collection_cases
  where id = p_collection_case_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_case.status in ('paid', 'closed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'status', v_case.status);
  end if;

  -- Retry após sucesso: collection já escalada. Não desfaz. Assign deve ser idempotente.
  if v_case.status = 'escalated_retention' then
    select * into v_retention
    from public.retention_cases
    where linked_collection_case_id = v_case.id
    for update;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'exception', 'message', 'escalated without retention_case');
    end if;

    v_assign := public.assign_sector_work_item(
      'retention',
      'retention_case',
      v_retention.id,
      p_actor_profile_id,
      jsonb_build_object('source', 'collections_escalation', 'collection_case_id', v_case.id)
    );
    v_assign_code := coalesce(v_assign->>'code', '');

    if coalesce(v_assign->>'ok', 'false') is distinct from 'true'
       or v_assign_code not in ('assigned', 'already_assigned') then
      v_fail_code := case
        when v_assign_code = 'no_employee_available' then 'no_retention_employee_available'
        when v_assign_code = '' then 'retention_assign_failed'
        else v_assign_code
      end;
      return jsonb_build_object(
        'ok', false,
        'code', v_fail_code,
        'collection_case_id', v_case.id,
        'retention_case_id', v_retention.id,
        'assign_code', v_assign_code
      );
    end if;

    if v_assign->>'assignment_id' is not null then
      update public.retention_cases
      set sector_assignment_id = (v_assign->>'assignment_id')::uuid
      where id = v_retention.id;
    end if;

    select * into v_collections_asg
    from public.sector_work_assignments
    where work_type = 'collection_case'
      and work_id = v_case.id
      and status = 'active'
    for update;

    if found then
      v_release := public.release_sector_assignment(
        v_collections_asg.id,
        'completed',
        p_actor_profile_id,
        'escalated_retention'
      );
      update public.collection_cases
      set sector_assignment_id = null
      where id = v_case.id;
    end if;

    return jsonb_build_object(
      'ok', true,
      'code', 'already_escalated',
      'collection_case_id', v_case.id,
      'retention_case_id', v_retention.id,
      'assignment_id', v_assign->>'assignment_id',
      'employee_id', v_assign->>'employee_id',
      'assign_code', v_assign_code,
      'release_code', v_release->>'code'
    );
  end if;

  insert into public.retention_cases (
    client_pk,
    contract_pk,
    source,
    reason,
    status,
    linked_collection_case_id,
    erp_snapshot,
    metadata
  )
  values (
    v_case.client_pk,
    v_case.contract_pk,
    'collections_escalation',
    nullif(btrim(coalesce(p_reason, '')), ''),
    'open',
    v_case.id,
    coalesce(v_case.erp_snapshot, '{}'::jsonb),
    jsonb_build_object(
      'from_collection_case_id', v_case.id,
      'invoice_pk', v_case.invoice_pk
    )
  )
  on conflict (linked_collection_case_id) do nothing
  returning id into v_retention.id;

  if v_retention.id is not null then
    v_created := true;
  end if;

  select * into v_retention
  from public.retention_cases
  where linked_collection_case_id = v_case.id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'exception', 'message', 'retention_case missing after upsert');
  end if;

  -- Assign Retention ANTES de mutar Cobrança. Falha ⇒ RAISE ⇒ rollback (não persiste retention).
  v_assign := public.assign_sector_work_item(
    'retention',
    'retention_case',
    v_retention.id,
    p_actor_profile_id,
    jsonb_build_object(
      'source', 'collections_escalation',
      'collection_case_id', v_case.id
    )
  );
  v_assign_code := coalesce(v_assign->>'code', '');

  if coalesce(v_assign->>'ok', 'false') is distinct from 'true'
     or v_assign_code not in ('assigned', 'already_assigned') then
    v_fail_code := case
      when v_assign_code = 'no_employee_available' then 'no_retention_employee_available'
      when v_assign_code = '' then 'retention_assign_failed'
      else v_assign_code
    end;
    raise exception '%', v_fail_code
      using errcode = 'P0002';
  end if;

  if v_created then
    insert into public.retention_case_events (
      case_id, event_type, actor_profile_id, old_value, new_value, metadata
    )
    values (
      v_retention.id,
      'created',
      p_actor_profile_id,
      null,
      jsonb_build_object('status', 'open', 'source', 'collections_escalation'),
      jsonb_build_object('linked_collection_case_id', v_case.id)
    );
  end if;

  if v_assign_code = 'assigned' then
    insert into public.retention_case_events (
      case_id, event_type, actor_profile_id, old_value, new_value, metadata
    )
    values (
      v_retention.id,
      'assigned',
      p_actor_profile_id,
      null,
      jsonb_build_object(
        'assignment_id', v_assign->>'assignment_id',
        'employee_id', v_assign->>'employee_id'
      ),
      jsonb_build_object('engine_code', v_assign_code)
    );
  end if;

  update public.collection_cases
  set status = 'escalated_retention',
      closed_at = coalesce(closed_at, v_now),
      updated_at = v_now
  where id = v_case.id;

  insert into public.collection_case_events (
    case_id, event_type, actor_profile_id, old_value, new_value, metadata
  )
  values (
    v_case.id,
    'escalated',
    p_actor_profile_id,
    jsonb_build_object('status', v_case.status),
    jsonb_build_object('status', 'escalated_retention', 'retention_case_id', v_retention.id),
    jsonb_build_object('reason', p_reason)
  );

  select * into v_collections_asg
  from public.sector_work_assignments
  where work_type = 'collection_case'
    and work_id = v_case.id
    and status = 'active'
  for update;

  if found then
    v_release := public.release_sector_assignment(
      v_collections_asg.id,
      'completed',
      p_actor_profile_id,
      'escalated_retention'
    );
    update public.collection_cases
    set sector_assignment_id = null
    where id = v_case.id;
  end if;

  if v_assign->>'assignment_id' is not null then
    update public.retention_cases
    set sector_assignment_id = (v_assign->>'assignment_id')::uuid
    where id = v_retention.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'escalated',
    'collection_case_id', v_case.id,
    'retention_case_id', v_retention.id,
    'assignment_id', v_assign->>'assignment_id',
    'employee_id', v_assign->>'employee_id',
    'assign_code', v_assign_code,
    'release_code', v_release->>'code'
  );
exception
  when sqlstate 'P0002' then
    return jsonb_build_object(
      'ok', false,
      'code', sqlerrm,
      'collection_case_id', p_collection_case_id
    );
  when unique_violation then
    return jsonb_build_object(
      'ok', false,
      'code', 'unique_violation',
      'collection_case_id', p_collection_case_id
    );
  when others then
    return jsonb_build_object('ok', false, 'code', 'exception', 'message', sqlerrm);
end;
$$;

comment on function public.escalate_collection_to_retention(uuid, uuid, text) is
  'Escala Cobrança → Retenção. Assign retention (assigned/already_assigned) ANTES de mutar/release Cobrança. Falha dá rollback (P0002). actor é auditoria, não autorização. Sprint 3.1B. UI 3.1C não expõe escalada automática.';

revoke all on function public.escalate_collection_to_retention(uuid, uuid, text) from public;
revoke all on function public.escalate_collection_to_retention(uuid, uuid, text) from anon;
revoke all on function public.escalate_collection_to_retention(uuid, uuid, text) from authenticated;
grant execute on function public.escalate_collection_to_retention(uuid, uuid, text) to service_role;

commit;

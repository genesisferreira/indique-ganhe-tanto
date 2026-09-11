-- Sprint 3.1 — Cobrança + Retenção operacional sobre o motor genérico 2.2
--
-- Cria: collection_cases, retention_cases, *_case_events, operational_case_contact_attempts
-- RPC: escalate_collection_to_retention (service_role)
--
-- Cron futuro: NÃO ativar nesta sprint. Sync = POST /api/admin/collections/sync (Admin Master).
--
-- NÃO altera: rewards, wallet, Comercial legado, SLA Comercial, Auth users,
-- BRByte flags, planos Controllr, vercel cron.
-- NÃO executa sync/migração de dados reais.
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

  if v_case.status is distinct from 'escalated_retention' then
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

  if coalesce(v_assign->>'ok', 'false') = 'true'
     and v_assign->>'assignment_id' is not null then
    update public.retention_cases
    set sector_assignment_id = (v_assign->>'assignment_id')::uuid
    where id = v_retention.id;

    if v_created or coalesce(v_assign->>'code', '') = 'assigned' then
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
        jsonb_build_object('engine_code', v_assign->>'code')
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', case when v_created then 'escalated' else 'already_escalated' end,
    'collection_case_id', v_case.id,
    'retention_case_id', v_retention.id,
    'assignment_id', v_assign->>'assignment_id',
    'employee_id', v_assign->>'employee_id',
    'assign_code', v_assign->>'code',
    'release_code', v_release->>'code'
  );
exception
  when unique_violation then
    select * into v_retention
    from public.retention_cases
    where linked_collection_case_id = p_collection_case_id;
    return jsonb_build_object(
      'ok', true,
      'code', 'already_escalated',
      'collection_case_id', p_collection_case_id,
      'retention_case_id', v_retention.id
    );
  when others then
    return jsonb_build_object('ok', false, 'code', 'exception', 'message', sqlerrm);
end;
$$;

comment on function public.escalate_collection_to_retention(uuid, uuid, text) is
  'Escala Cobrança → Retenção com lock. Idempotente. Chama o motor 2.2; não duplica round-robin. actor é auditoria, não autorização. Sprint 3.1.';

revoke all on function public.escalate_collection_to_retention(uuid, uuid, text) from public;
revoke all on function public.escalate_collection_to_retention(uuid, uuid, text) from anon;
revoke all on function public.escalate_collection_to_retention(uuid, uuid, text) from authenticated;
grant execute on function public.escalate_collection_to_retention(uuid, uuid, text) to service_role;

commit;

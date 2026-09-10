-- Sprint 2.2 — Motor genérico de distribuição por setor
--
-- Requer Sprint 2.1 aplicada (employees, sectors, memberships, events).
-- Cria fila/atribuição genérica EM PARALELO ao Comercial legado.
--
-- NÃO altera: assign_referral_to_next_commercial, pick_next_available_commercial,
-- claim_referral_lead, commercial_lead_settings, commercial_availability,
-- commercial_profile_id, SLA, referrals existentes, rewards, wallet, Auth, BRByte.
-- NÃO faz backfill de leads comerciais.
-- NÃO migra o Comercial para este motor.
--
-- work_type text + work_id uuid (polimórfico sem FK impossível).
-- Estado de fila próprio (não compartilha commercial_lead_settings).
-- Reset diário lazy (sem cron/Vercel).
-- Idempotente: CREATE IF NOT EXISTS, ON CONFLICT DO NOTHING, DROP TRIGGER IF EXISTS.

begin;

-- ============================================================
-- Fila por setor
-- ============================================================
create table if not exists public.sector_assignment_settings (
  sector_id uuid primary key references public.sectors(id) on delete restrict,
  assignment_mode text not null default 'round_robin',
  is_enabled boolean not null default true,
  daily_limit_default integer not null default 20,
  max_active_assignments_default integer,
  allow_manual_claim boolean not null default true,
  allow_transfer boolean not null default true,
  allow_redistribution boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint sector_assignment_settings_mode_chk check (
    assignment_mode in ('round_robin')
  ),
  constraint sector_assignment_settings_daily_limit_chk check (
    daily_limit_default > 0
  ),
  constraint sector_assignment_settings_max_active_chk check (
    max_active_assignments_default is null or max_active_assignments_default > 0
  )
);

comment on table public.sector_assignment_settings is
  'Configuração da fila genérica por setor. Não autoriza rotas. Sprint 2.2. Independente de commercial_lead_settings.';

drop trigger if exists trg_sector_assignment_settings_set_updated_at
  on public.sector_assignment_settings;
create trigger trg_sector_assignment_settings_set_updated_at
before update on public.sector_assignment_settings
for each row execute function public.set_updated_at();

-- ============================================================
-- Estado de distribuição por membership (1:1)
-- ============================================================
create table if not exists public.employee_sector_assignment_settings (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.employee_sector_memberships(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  sector_id uuid not null references public.sectors(id) on delete restrict,
  receiving_assignments boolean not null default true,
  is_available boolean not null default true,
  daily_limit integer,
  max_active_assignments integer,
  active_assignments integer not null default 0,
  total_received_today integer not null default 0,
  last_assignment_at timestamptz,
  last_daily_reset_on date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employee_sector_assignment_settings_membership_key unique (membership_id),
  constraint employee_sector_assignment_settings_daily_limit_chk check (
    daily_limit is null or daily_limit > 0
  ),
  constraint employee_sector_assignment_settings_max_active_chk check (
    max_active_assignments is null or max_active_assignments > 0
  ),
  constraint employee_sector_assignment_settings_active_chk check (
    active_assignments >= 0
  ),
  constraint employee_sector_assignment_settings_today_chk check (
    total_received_today >= 0
  )
);

comment on table public.employee_sector_assignment_settings is
  'Estado de round-robin por vínculo funcionário↔setor. Não substitui commercial_lead_settings.';

create index if not exists employee_sector_assignment_settings_sector_rr_idx
  on public.employee_sector_assignment_settings (sector_id, last_assignment_at);

create index if not exists employee_sector_assignment_settings_employee_idx
  on public.employee_sector_assignment_settings (employee_id);

drop trigger if exists trg_employee_sector_assignment_settings_set_updated_at
  on public.employee_sector_assignment_settings;
create trigger trg_employee_sector_assignment_settings_set_updated_at
before update on public.employee_sector_assignment_settings
for each row execute function public.set_updated_at();

-- ============================================================
-- Atribuições (ownership genérico; módulo dono do status de negócio)
-- ============================================================
create table if not exists public.sector_work_assignments (
  id uuid primary key default gen_random_uuid(),
  sector_id uuid not null references public.sectors(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  membership_id uuid not null references public.employee_sector_memberships(id) on delete restrict,
  work_type text not null,
  work_id uuid not null,
  status text not null default 'active',
  assigned_at timestamptz not null default timezone('utc', now()),
  released_at timestamptz,
  previous_assignment_id uuid references public.sector_work_assignments(id) on delete set null,
  previous_employee_id uuid references public.employees(id) on delete set null,
  assignment_source text not null default 'auto_assign',
  actor_profile_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint sector_work_assignments_work_type_chk check (
    work_type ~ '^[a-z][a-z0-9_]*$'
  ),
  constraint sector_work_assignments_status_chk check (
    status in ('active', 'completed', 'released', 'cancelled')
  ),
  constraint sector_work_assignments_source_chk check (
    assignment_source in ('auto_assign', 'transfer', 'claim', 'redistribute')
  ),
  constraint sector_work_assignments_active_released_chk check (
    (status = 'active' and released_at is null)
    or (status <> 'active' and released_at is not null)
  )
);

comment on table public.sector_work_assignments is
  'Ownership genérico setor↔work item. work_type+work_id polimórfico sem FK. Uma assignment ativa por (setor, tipo, id).';

create unique index if not exists sector_work_assignments_active_uidx
  on public.sector_work_assignments (sector_id, work_type, work_id)
  where status = 'active';

create index if not exists sector_work_assignments_employee_status_idx
  on public.sector_work_assignments (employee_id, status);

create index if not exists sector_work_assignments_sector_status_idx
  on public.sector_work_assignments (sector_id, status);

create index if not exists sector_work_assignments_work_idx
  on public.sector_work_assignments (work_type, work_id);

drop trigger if exists trg_sector_work_assignments_set_updated_at
  on public.sector_work_assignments;
create trigger trg_sector_work_assignments_set_updated_at
before update on public.sector_work_assignments
for each row execute function public.set_updated_at();

-- ============================================================
-- Eventos append-only
-- ============================================================
create table if not exists public.sector_assignment_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.sector_work_assignments(id) on delete restrict,
  sector_id uuid not null references public.sectors(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint sector_assignment_events_type_chk check (
    event_type in (
      'assigned',
      'transferred',
      'released',
      'redistributed',
      'claimed',
      'completed',
      'cancelled'
    )
  )
);

comment on table public.sector_assignment_events is
  'Histórico append-only de atribuições genéricas. Sprint 2.2.';

create index if not exists sector_assignment_events_assignment_created_idx
  on public.sector_assignment_events (assignment_id, created_at desc);

create or replace function public.trg_sector_assignment_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'sector_assignment_events is append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_sector_assignment_events_append_only
  on public.sector_assignment_events;
create trigger trg_sector_assignment_events_append_only
before update or delete on public.sector_assignment_events
for each row execute function public.trg_sector_assignment_events_append_only();

-- Settings 1:1 quando nasce membership (não autoriza nada).
create or replace function public.trg_memberships_ensure_assignment_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.employee_sector_assignment_settings (
    membership_id, employee_id, sector_id
  )
  values (NEW.id, NEW.employee_id, NEW.sector_id)
  on conflict (membership_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists trg_memberships_ensure_assignment_settings
  on public.employee_sector_memberships;
create trigger trg_memberships_ensure_assignment_settings
after insert on public.employee_sector_memberships
for each row execute function public.trg_memberships_ensure_assignment_settings();

-- ============================================================
-- Seed de config (setores existentes + memberships 2.1). Sem DML de leads.
-- ============================================================
insert into public.sector_assignment_settings (sector_id)
select s.id
from public.sectors s
on conflict (sector_id) do nothing;

insert into public.employee_sector_assignment_settings (
  membership_id, employee_id, sector_id
)
select m.id, m.employee_id, m.sector_id
from public.employee_sector_memberships m
on conflict (membership_id) do nothing;

-- ============================================================
-- RLS
-- ============================================================
alter table public.sector_assignment_settings enable row level security;
alter table public.employee_sector_assignment_settings enable row level security;
alter table public.sector_work_assignments enable row level security;
alter table public.sector_assignment_events enable row level security;

drop policy if exists sector_assignment_settings_select_policy
  on public.sector_assignment_settings;
create policy sector_assignment_settings_select_policy
on public.sector_assignment_settings
for select
to authenticated
using (public.is_admin_read_any());

drop policy if exists employee_sector_assignment_settings_select_policy
  on public.employee_sector_assignment_settings;
create policy employee_sector_assignment_settings_select_policy
on public.employee_sector_assignment_settings
for select
to authenticated
using (
  public.is_admin_read_any()
  or exists (
    select 1
    from public.employees e
    where e.id = employee_sector_assignment_settings.employee_id
      and e.profile_id = auth.uid()
  )
);

drop policy if exists sector_work_assignments_select_policy
  on public.sector_work_assignments;
create policy sector_work_assignments_select_policy
on public.sector_work_assignments
for select
to authenticated
using (
  public.is_admin_read_any()
  or exists (
    select 1
    from public.employees e
    where e.id = sector_work_assignments.employee_id
      and e.profile_id = auth.uid()
  )
);

drop policy if exists sector_assignment_events_select_policy
  on public.sector_assignment_events;
create policy sector_assignment_events_select_policy
on public.sector_assignment_events
for select
to authenticated
using (
  public.is_admin_read_any()
  or exists (
    select 1
    from public.employees e
    where e.id = sector_assignment_events.employee_id
      and e.profile_id = auth.uid()
  )
);

revoke all on table public.sector_assignment_settings from public;
revoke all on table public.sector_assignment_settings from anon;
revoke all on table public.employee_sector_assignment_settings from public;
revoke all on table public.employee_sector_assignment_settings from anon;
revoke all on table public.sector_work_assignments from public;
revoke all on table public.sector_work_assignments from anon;
revoke all on table public.sector_assignment_events from public;
revoke all on table public.sector_assignment_events from anon;

revoke insert, update, delete, truncate on table public.sector_assignment_settings from authenticated;
revoke insert, update, delete, truncate on table public.employee_sector_assignment_settings from authenticated;
revoke insert, update, delete, truncate on table public.sector_work_assignments from authenticated;
revoke insert, update, delete, truncate on table public.sector_assignment_events from authenticated;

grant select on table public.sector_assignment_settings to authenticated;
grant select on table public.employee_sector_assignment_settings to authenticated;
grant select on table public.sector_work_assignments to authenticated;
grant select on table public.sector_assignment_events to authenticated;

grant all on table public.sector_assignment_settings to service_role;
grant all on table public.employee_sector_assignment_settings to service_role;
grant all on table public.sector_work_assignments to service_role;
grant all on table public.sector_assignment_events to service_role;

-- ============================================================
-- Internos
-- ============================================================
create or replace function public.lock_sector_work_item_xact(
  p_sector_id uuid,
  p_work_type text,
  p_work_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    ('x' || substr(
      md5(
        coalesce(p_sector_id::text, '') || chr(31) ||
        coalesce(p_work_type, '') || chr(31) ||
        coalesce(p_work_id::text, '')
      ),
      1,
      16
    ))::bit(64)::bigint
  );
end;
$$;

create or replace function public.reset_sector_assignment_daily_counters()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (timezone('utc', now()))::date;
begin
  update public.employee_sector_assignment_settings es
  set total_received_today = 0,
      last_daily_reset_on = v_today,
      updated_at = timezone('utc', now())
  from public.employee_sector_memberships m
  where m.id = es.membership_id
    and m.is_active = true
    and es.last_daily_reset_on is distinct from v_today
    and (es.total_received_today > 0 or es.last_daily_reset_on is null);
end;
$$;

create or replace function public.record_sector_assignment_event(
  p_assignment_id uuid,
  p_sector_id uuid,
  p_employee_id uuid,
  p_event_type text,
  p_actor_profile_id uuid,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sector_assignment_events (
    assignment_id, sector_id, employee_id, event_type,
    actor_profile_id, old_value, new_value, metadata
  )
  values (
    p_assignment_id, p_sector_id, p_employee_id, p_event_type,
    p_actor_profile_id, p_old_value, p_new_value, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- Settings operacionais: membership ATIVA (Sprint 2.1 unique parcial
-- employee_id+sector_id WHERE is_active). Nunca employee_id+sector_id sozinhos.
create or replace function public.lock_active_sector_assignment_settings(
  p_employee_id uuid,
  p_sector_id uuid
)
returns public.employee_sector_assignment_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.employee_sector_assignment_settings%rowtype;
begin
  select es.*
  into v_row
  from public.employee_sector_assignment_settings es
  inner join public.employee_sector_memberships m
    on m.id = es.membership_id
   and m.is_active = true
   and m.employee_id = p_employee_id
   and m.sector_id = p_sector_id
  where es.employee_id = p_employee_id
    and es.sector_id = p_sector_id
  for update of es;

  return v_row;
end;
$$;

comment on function public.lock_active_sector_assignment_settings(uuid, uuid) is
  'Trava a settings da membership ATIVA (employee+setor). Membership histórica é ignorada. Sprint 2.2B.';

-- Identidade: employee active + membership ativa + setor ativo + profile ativo.
-- NÃO exige profiles.role. Membership NÃO autoriza rota.
create or replace function public.is_sector_employee_assignment_eligible(
  p_employee_id uuid,
  p_sector_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    inner join public.profiles p on p.id = e.profile_id
    inner join public.employee_sector_memberships m
      on m.employee_id = e.id
      and m.sector_id = p_sector_id
      and m.is_active = true
    inner join public.sectors s
      on s.id = p_sector_id
      and s.is_active = true
    where e.id = p_employee_id
      and e.status = 'active'::public.employee_status
      and coalesce(p.is_active, true) = true
  );
$$;

comment on function public.is_sector_employee_assignment_eligible(uuid, uuid) is
  'Elegibilidade GLOBAL de NOVA atribuição setorial. Não autoriza rotas. Não usa commercial_lead_settings.';

-- ============================================================
-- Picker
-- ============================================================
create or replace function public.pick_next_sector_employee(
  p_sector_code text,
  p_exclude_employee_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_id uuid;
begin
  if p_sector_code is null or btrim(p_sector_code) = '' then
    return null;
  end if;

  perform public.reset_sector_assignment_daily_counters();

  select es.employee_id
  into v_employee_id
  from public.employee_sector_assignment_settings es
  inner join public.employee_sector_memberships m on m.id = es.membership_id
  inner join public.employees e on e.id = es.employee_id
  inner join public.profiles p on p.id = e.profile_id
  inner join public.sectors s on s.id = es.sector_id
  inner join public.sector_assignment_settings qs on qs.sector_id = s.id
  where s.code = p_sector_code
    and qs.is_enabled = true
    and qs.assignment_mode = 'round_robin'
    and s.is_active = true
    and m.is_active = true
    and e.status = 'active'::public.employee_status
    and coalesce(p.is_active, true) = true
    and es.receiving_assignments = true
    and es.is_available = true
    and es.total_received_today < coalesce(es.daily_limit, qs.daily_limit_default)
    and (
      coalesce(es.max_active_assignments, qs.max_active_assignments_default) is null
      or es.active_assignments < coalesce(es.max_active_assignments, qs.max_active_assignments_default)
    )
    and (p_exclude_employee_id is null or es.employee_id <> p_exclude_employee_id)
  order by es.last_assignment_at asc nulls first,
           es.total_received_today asc,
           es.employee_id asc
  limit 1
  for update of es;

  return v_employee_id;
end;
$$;

comment on function public.pick_next_sector_employee(text, uuid) is
  'Round-robin genérico. Estado próprio. last_assignment_at ASC NULLS FIRST, total_received_today, employee_id. Sprint 2.2.';

-- ============================================================
-- Assign
-- ============================================================
create or replace function public.assign_sector_work_item(
  p_sector_code text,
  p_work_type text,
  p_work_id uuid,
  p_actor_profile_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sector public.sectors%rowtype;
  v_queue public.sector_assignment_settings%rowtype;
  v_existing public.sector_work_assignments%rowtype;
  v_settings public.employee_sector_assignment_settings%rowtype;
  v_employee_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_assignment_id uuid;
begin
  if p_sector_code is null or btrim(p_sector_code) = ''
     or p_work_type is null or p_work_type !~ '^[a-z][a-z0-9_]*$'
     or p_work_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_sector
  from public.sectors
  where code = p_sector_code;

  if not found or v_sector.is_active is not true then
    return jsonb_build_object('ok', false, 'code', 'invalid_sector');
  end if;

  select * into v_queue
  from public.sector_assignment_settings
  where sector_id = v_sector.id;

  if not found or v_queue.is_enabled is not true then
    return jsonb_build_object('ok', false, 'code', 'queue_disabled');
  end if;

  perform public.lock_sector_work_item_xact(v_sector.id, p_work_type, p_work_id);

  select * into v_existing
  from public.sector_work_assignments
  where sector_id = v_sector.id
    and work_type = p_work_type
    and work_id = p_work_id
    and status = 'active';

  if found then
    return jsonb_build_object(
      'ok', true,
      'code', 'already_assigned',
      'assignment_id', v_existing.id,
      'employee_id', v_existing.employee_id,
      'membership_id', v_existing.membership_id,
      'sector_id', v_existing.sector_id,
      'status', v_existing.status
    );
  end if;

  v_employee_id := public.pick_next_sector_employee(p_sector_code, null);

  if v_employee_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'no_employee_available',
      'message', 'Nenhum funcionário elegível na fila deste setor.'
    );
  end if;

  v_settings := public.lock_active_sector_assignment_settings(v_employee_id, v_sector.id);

  if v_settings.id is null or v_settings.membership_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'no_employee_available',
      'message', 'Nenhum funcionário elegível na fila deste setor.'
    );
  end if;

  insert into public.sector_work_assignments (
    sector_id, employee_id, membership_id, work_type, work_id,
    status, assigned_at, assignment_source, actor_profile_id, metadata
  )
  values (
    v_sector.id, v_employee_id, v_settings.membership_id, p_work_type, p_work_id,
    'active', v_now, 'auto_assign', p_actor_profile_id, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_assignment_id;

  update public.employee_sector_assignment_settings
  set last_assignment_at = v_now,
      active_assignments = active_assignments + 1,
      total_received_today = total_received_today + 1,
      last_daily_reset_on = coalesce(last_daily_reset_on, (v_now at time zone 'utc')::date),
      updated_at = v_now
  where id = v_settings.id;

  perform public.record_sector_assignment_event(
    v_assignment_id,
    v_sector.id,
    v_employee_id,
    'assigned',
    p_actor_profile_id,
    null,
    jsonb_build_object(
      'assignment_id', v_assignment_id,
      'employee_id', v_employee_id,
      'source', 'auto_assign'
    ),
    jsonb_build_object('work_type', p_work_type, 'work_id', p_work_id)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'assigned',
    'assignment_id', v_assignment_id,
    'employee_id', v_employee_id,
    'membership_id', v_settings.membership_id,
    'sector_id', v_sector.id,
    'status', 'active'
  );
exception
  when unique_violation then
    select * into v_existing
    from public.sector_work_assignments
    where sector_id = v_sector.id
      and work_type = p_work_type
      and work_id = p_work_id
      and status = 'active';
    if found then
      return jsonb_build_object(
        'ok', true,
        'code', 'already_assigned',
        'assignment_id', v_existing.id,
        'employee_id', v_existing.employee_id,
        'membership_id', v_existing.membership_id,
        'sector_id', v_existing.sector_id,
        'status', v_existing.status
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'unique_violation', 'message', sqlerrm);
  when others then
    return jsonb_build_object('ok', false, 'code', 'exception', 'message', sqlerrm);
end;
$$;

comment on function public.assign_sector_work_item(text, text, uuid, uuid, jsonb) is
  'Atribui work item ao próximo funcionário elegível do setor. Idempotente se já ativo. actor_profile_id NÃO autoriza; caller valida sessão. Sprint 2.2.';

-- ============================================================
-- Transfer
-- ============================================================
create or replace function public.transfer_sector_assignment(
  p_assignment_id uuid,
  p_to_employee_id uuid,
  p_actor_profile_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asg public.sector_work_assignments%rowtype;
  v_queue public.sector_assignment_settings%rowtype;
  v_from public.employee_sector_assignment_settings%rowtype;
  v_to public.employee_sector_assignment_settings%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_new_id uuid;
begin
  if p_assignment_id is null or p_to_employee_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_asg
  from public.sector_work_assignments
  where id = p_assignment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_asg.status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'not_active', 'status', v_asg.status);
  end if;

  if v_asg.employee_id = p_to_employee_id then
    return jsonb_build_object(
      'ok', true,
      'code', 'same_employee',
      'assignment_id', v_asg.id,
      'employee_id', v_asg.employee_id
    );
  end if;

  select * into v_queue
  from public.sector_assignment_settings
  where sector_id = v_asg.sector_id;

  if not found or v_queue.is_enabled is not true then
    return jsonb_build_object('ok', false, 'code', 'queue_disabled');
  end if;

  if v_queue.allow_transfer is not true then
    return jsonb_build_object('ok', false, 'code', 'transfer_disabled');
  end if;

  perform public.lock_sector_work_item_xact(v_asg.sector_id, v_asg.work_type, v_asg.work_id);
  perform public.reset_sector_assignment_daily_counters();

  if not public.is_sector_employee_assignment_eligible(p_to_employee_id, v_asg.sector_id) then
    return jsonb_build_object('ok', false, 'code', 'not_eligible');
  end if;

  v_to := public.lock_active_sector_assignment_settings(p_to_employee_id, v_asg.sector_id);

  if v_to.id is null
     or v_to.membership_id is null
     or v_to.is_available is not true
     or v_to.receiving_assignments is not true
     or v_to.total_received_today >= coalesce(v_to.daily_limit, v_queue.daily_limit_default)
     or (
       coalesce(v_to.max_active_assignments, v_queue.max_active_assignments_default) is not null
       and v_to.active_assignments >= coalesce(v_to.max_active_assignments, v_queue.max_active_assignments_default)
     )
  then
    return jsonb_build_object('ok', false, 'code', 'not_eligible');
  end if;

  select * into v_from
  from public.employee_sector_assignment_settings
  where membership_id = v_asg.membership_id
  for update;

  update public.sector_work_assignments
  set status = 'released',
      released_at = v_now,
      updated_at = v_now,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'closed_by', 'transfer',
        'reason', p_reason
      )
  where id = v_asg.id
    and status = 'active';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_active');
  end if;

  insert into public.sector_work_assignments (
    sector_id, employee_id, membership_id, work_type, work_id,
    status, assigned_at, previous_assignment_id, previous_employee_id,
    assignment_source, actor_profile_id, metadata
  )
  values (
    v_asg.sector_id, p_to_employee_id, v_to.membership_id, v_asg.work_type, v_asg.work_id,
    'active', v_now, v_asg.id, v_asg.employee_id,
    'transfer', p_actor_profile_id,
    coalesce(v_asg.metadata, '{}'::jsonb) || jsonb_build_object('reason', p_reason)
  )
  returning id into v_new_id;

  if v_from.id is not null then
    update public.employee_sector_assignment_settings
    set active_assignments = greatest(active_assignments - 1, 0),
        updated_at = v_now
    where id = v_from.id;
  end if;

  update public.employee_sector_assignment_settings
  set last_assignment_at = v_now,
      active_assignments = active_assignments + 1,
      total_received_today = total_received_today + 1,
      last_daily_reset_on = coalesce(last_daily_reset_on, (v_now at time zone 'utc')::date),
      updated_at = v_now
  where id = v_to.id;

  perform public.record_sector_assignment_event(
    v_asg.id, v_asg.sector_id, v_asg.employee_id, 'transferred', p_actor_profile_id,
    jsonb_build_object('assignment_id', v_asg.id, 'employee_id', v_asg.employee_id),
    jsonb_build_object('assignment_id', v_new_id, 'employee_id', p_to_employee_id),
    jsonb_build_object('reason', p_reason)
  );

  perform public.record_sector_assignment_event(
    v_new_id, v_asg.sector_id, p_to_employee_id, 'assigned', p_actor_profile_id,
    null,
    jsonb_build_object('assignment_id', v_new_id, 'employee_id', p_to_employee_id, 'source', 'transfer'),
    jsonb_build_object('previous_assignment_id', v_asg.id)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'transferred',
    'assignment_id', v_new_id,
    'previous_assignment_id', v_asg.id,
    'employee_id', p_to_employee_id,
    'previous_employee_id', v_asg.employee_id,
    'status', 'active'
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'unique_violation', 'message', sqlerrm);
  when others then
    return jsonb_build_object('ok', false, 'code', 'exception', 'message', sqlerrm);
end;
$$;

comment on function public.transfer_sector_assignment(uuid, uuid, uuid, text) is
  'Encerra assignment ativa (released) e cria nova. Preserva histórico. Destino precisa ser elegível. actor não autoriza. Sprint 2.2.';

-- ============================================================
-- Complete / release / cancel
-- ============================================================
create or replace function public.release_sector_assignment(
  p_assignment_id uuid,
  p_close_status text,
  p_actor_profile_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asg public.sector_work_assignments%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_event text;
begin
  if p_assignment_id is null
     or p_close_status is null
     or p_close_status not in ('completed', 'released', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  v_event := p_close_status;

  select * into v_asg
  from public.sector_work_assignments
  where id = p_assignment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  perform public.lock_sector_work_item_xact(v_asg.sector_id, v_asg.work_type, v_asg.work_id);

  if v_asg.status is distinct from 'active' then
    return jsonb_build_object(
      'ok', true,
      'code', 'already_closed',
      'assignment_id', v_asg.id,
      'status', v_asg.status
    );
  end if;

  update public.sector_work_assignments
  set status = p_close_status,
      released_at = v_now,
      updated_at = v_now,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'closed_by', p_close_status,
        'reason', p_reason
      )
  where id = v_asg.id
    and status = 'active';

  if not found then
    return jsonb_build_object('ok', true, 'code', 'already_closed', 'assignment_id', v_asg.id);
  end if;

  update public.employee_sector_assignment_settings
  set active_assignments = greatest(active_assignments - 1, 0),
      updated_at = v_now
  where membership_id = v_asg.membership_id;

  perform public.record_sector_assignment_event(
    v_asg.id, v_asg.sector_id, v_asg.employee_id, v_event, p_actor_profile_id,
    jsonb_build_object('status', 'active'),
    jsonb_build_object('status', p_close_status),
    jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object(
    'ok', true,
    'code', p_close_status,
    'assignment_id', v_asg.id,
    'employee_id', v_asg.employee_id,
    'status', p_close_status
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'exception', 'message', sqlerrm);
end;
$$;

comment on function public.release_sector_assignment(uuid, text, uuid, text) is
  'Encerra assignment ativa (completed|released|cancelled). Não apaga histórico. Idempotente se já encerrada. Sprint 2.2.';

-- ============================================================
-- Claim manual (interno; autorização no caller)
-- ============================================================
create or replace function public.claim_sector_work_item(
  p_sector_code text,
  p_work_type text,
  p_work_id uuid,
  p_employee_id uuid,
  p_actor_profile_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sector public.sectors%rowtype;
  v_queue public.sector_assignment_settings%rowtype;
  v_existing public.sector_work_assignments%rowtype;
  v_settings public.employee_sector_assignment_settings%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_assignment_id uuid;
begin
  if p_sector_code is null or p_work_type is null or p_work_type !~ '^[a-z][a-z0-9_]*$'
     or p_work_id is null or p_employee_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into v_sector from public.sectors where code = p_sector_code;
  if not found or v_sector.is_active is not true then
    return jsonb_build_object('ok', false, 'code', 'invalid_sector');
  end if;

  select * into v_queue
  from public.sector_assignment_settings
  where sector_id = v_sector.id;

  if not found or v_queue.is_enabled is not true then
    return jsonb_build_object('ok', false, 'code', 'queue_disabled');
  end if;

  if v_queue.allow_manual_claim is not true then
    return jsonb_build_object('ok', false, 'code', 'claim_disabled');
  end if;

  perform public.lock_sector_work_item_xact(v_sector.id, p_work_type, p_work_id);
  perform public.reset_sector_assignment_daily_counters();

  select * into v_existing
  from public.sector_work_assignments
  where sector_id = v_sector.id
    and work_type = p_work_type
    and work_id = p_work_id
    and status = 'active';

  if found then
    if v_existing.employee_id = p_employee_id then
      return jsonb_build_object(
        'ok', true,
        'code', 'already_assigned',
        'assignment_id', v_existing.id,
        'employee_id', v_existing.employee_id
      );
    end if;
    return jsonb_build_object(
      'ok', false,
      'code', 'already_claimed',
      'assignment_id', v_existing.id,
      'employee_id', v_existing.employee_id
    );
  end if;

  if not public.is_sector_employee_assignment_eligible(p_employee_id, v_sector.id) then
    return jsonb_build_object('ok', false, 'code', 'not_eligible');
  end if;

  v_settings := public.lock_active_sector_assignment_settings(p_employee_id, v_sector.id);

  if v_settings.id is null
     or v_settings.membership_id is null
     or v_settings.is_available is not true
     or v_settings.receiving_assignments is not true
     or v_settings.total_received_today >= coalesce(v_settings.daily_limit, v_queue.daily_limit_default)
     or (
       coalesce(v_settings.max_active_assignments, v_queue.max_active_assignments_default) is not null
       and v_settings.active_assignments >= coalesce(v_settings.max_active_assignments, v_queue.max_active_assignments_default)
     )
  then
    return jsonb_build_object('ok', false, 'code', 'not_eligible');
  end if;

  insert into public.sector_work_assignments (
    sector_id, employee_id, membership_id, work_type, work_id,
    status, assigned_at, assignment_source, actor_profile_id, metadata
  )
  values (
    v_sector.id, p_employee_id, v_settings.membership_id, p_work_type, p_work_id,
    'active', v_now, 'claim', p_actor_profile_id, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_assignment_id;

  update public.employee_sector_assignment_settings
  set last_assignment_at = v_now,
      active_assignments = active_assignments + 1,
      total_received_today = total_received_today + 1,
      last_daily_reset_on = coalesce(last_daily_reset_on, (v_now at time zone 'utc')::date),
      updated_at = v_now
  where id = v_settings.id;

  perform public.record_sector_assignment_event(
    v_assignment_id, v_sector.id, p_employee_id, 'claimed', p_actor_profile_id,
    null,
    jsonb_build_object('assignment_id', v_assignment_id, 'employee_id', p_employee_id),
    jsonb_build_object('work_type', p_work_type, 'work_id', p_work_id)
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'claimed',
    'assignment_id', v_assignment_id,
    'employee_id', p_employee_id,
    'membership_id', v_settings.membership_id,
    'sector_id', v_sector.id,
    'status', 'active'
  );
exception
  when unique_violation then
    select * into v_existing
    from public.sector_work_assignments
    where sector_id = v_sector.id
      and work_type = p_work_type
      and work_id = p_work_id
      and status = 'active';
    if found and v_existing.employee_id = p_employee_id then
      return jsonb_build_object(
        'ok', true,
        'code', 'already_assigned',
        'assignment_id', v_existing.id,
        'employee_id', v_existing.employee_id
      );
    end if;
    if found then
      return jsonb_build_object('ok', false, 'code', 'already_claimed', 'assignment_id', v_existing.id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'unique_violation');
  when others then
    return jsonb_build_object('ok', false, 'code', 'exception', 'message', sqlerrm);
end;
$$;

comment on function public.claim_sector_work_item(text, text, uuid, uuid, uuid, jsonb) is
  'Claim interno. Não usa auth.uid nem membership como autorização. Caller server-side valida sessão. daily_limit aplica-se (motor genérico). Sprint 2.2.';

-- ============================================================
-- Grants: motor interno. Sem PUBLIC/anon/authenticated EXECUTE.
-- ============================================================
revoke all on function public.trg_sector_assignment_events_append_only() from public;
revoke all on function public.trg_sector_assignment_events_append_only() from anon;
revoke all on function public.trg_sector_assignment_events_append_only() from authenticated;

revoke all on function public.trg_memberships_ensure_assignment_settings() from public;
revoke all on function public.trg_memberships_ensure_assignment_settings() from anon;
revoke all on function public.trg_memberships_ensure_assignment_settings() from authenticated;

revoke all on function public.lock_sector_work_item_xact(uuid, text, uuid) from public;
revoke all on function public.lock_sector_work_item_xact(uuid, text, uuid) from anon;
revoke all on function public.lock_sector_work_item_xact(uuid, text, uuid) from authenticated;
grant execute on function public.lock_sector_work_item_xact(uuid, text, uuid) to service_role;

revoke all on function public.lock_active_sector_assignment_settings(uuid, uuid) from public;
revoke all on function public.lock_active_sector_assignment_settings(uuid, uuid) from anon;
revoke all on function public.lock_active_sector_assignment_settings(uuid, uuid) from authenticated;
grant execute on function public.lock_active_sector_assignment_settings(uuid, uuid) to service_role;

revoke all on function public.reset_sector_assignment_daily_counters() from public;
revoke all on function public.reset_sector_assignment_daily_counters() from anon;
revoke all on function public.reset_sector_assignment_daily_counters() from authenticated;
grant execute on function public.reset_sector_assignment_daily_counters() to service_role;

revoke all on function public.record_sector_assignment_event(uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb) from public;
revoke all on function public.record_sector_assignment_event(uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb) from anon;
revoke all on function public.record_sector_assignment_event(uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.record_sector_assignment_event(uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb) to service_role;

revoke all on function public.is_sector_employee_assignment_eligible(uuid, uuid) from public;
revoke all on function public.is_sector_employee_assignment_eligible(uuid, uuid) from anon;
revoke all on function public.is_sector_employee_assignment_eligible(uuid, uuid) from authenticated;
grant execute on function public.is_sector_employee_assignment_eligible(uuid, uuid) to service_role;

revoke all on function public.pick_next_sector_employee(text, uuid) from public;
revoke all on function public.pick_next_sector_employee(text, uuid) from anon;
revoke all on function public.pick_next_sector_employee(text, uuid) from authenticated;
grant execute on function public.pick_next_sector_employee(text, uuid) to service_role;

revoke all on function public.assign_sector_work_item(text, text, uuid, uuid, jsonb) from public;
revoke all on function public.assign_sector_work_item(text, text, uuid, uuid, jsonb) from anon;
revoke all on function public.assign_sector_work_item(text, text, uuid, uuid, jsonb) from authenticated;
grant execute on function public.assign_sector_work_item(text, text, uuid, uuid, jsonb) to service_role;

revoke all on function public.transfer_sector_assignment(uuid, uuid, uuid, text) from public;
revoke all on function public.transfer_sector_assignment(uuid, uuid, uuid, text) from anon;
revoke all on function public.transfer_sector_assignment(uuid, uuid, uuid, text) from authenticated;
grant execute on function public.transfer_sector_assignment(uuid, uuid, uuid, text) to service_role;

revoke all on function public.release_sector_assignment(uuid, text, uuid, text) from public;
revoke all on function public.release_sector_assignment(uuid, text, uuid, text) from anon;
revoke all on function public.release_sector_assignment(uuid, text, uuid, text) from authenticated;
grant execute on function public.release_sector_assignment(uuid, text, uuid, text) to service_role;

revoke all on function public.claim_sector_work_item(text, text, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.claim_sector_work_item(text, text, uuid, uuid, uuid, jsonb) from anon;
revoke all on function public.claim_sector_work_item(text, text, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.claim_sector_work_item(text, text, uuid, uuid, uuid, jsonb) to service_role;

commit;

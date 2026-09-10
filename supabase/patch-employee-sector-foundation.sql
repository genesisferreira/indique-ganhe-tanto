-- Sprint 2.1 — Fundação de funcionários, setores e múltiplas funções
--
-- Cria: employees, sectors, employee_sector_memberships, employee_events.
-- Backfill: profiles.role = 'comercial' → employee + membership no setor commercial.
--
-- NÃO altera schema de: commercial_lead_settings, commercial_availability,
-- referrals, rewards, wallet, Auth users, BRByte.
-- NÃO redistribui carteira já atribuída.
-- NÃO executa DML financeiro.
-- Idempotente: CREATE IF NOT EXISTS, ON CONFLICT DO NOTHING, DROP TRIGGER IF EXISTS.
--
-- Disponibilidade:
--   employees.status + membership commercial ativa
--     = elegibilidade GLOBAL para NOVAS atribuições (assign/pick/claim).
--   commercial_availability + commercial_lead_settings
--     = disponibilidade OPERACIONAL do setor Comercial (limites, pause de fila).
--   Leads já atribuídos (commercial_profile_id) permanecem intactos.

begin;

-- ============================================================
-- Enum de status (não confundir com user_role)
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'employee_status') then
    create type public.employee_status as enum (
      'active',
      'paused',
      'vacation',
      'away',
      'dismissed'
    );
  end if;
end$$;

-- ============================================================
-- sectors (configurável; NÃO é enum)
-- ============================================================
create table if not exists public.sectors (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint sectors_code_key unique (code),
  constraint sectors_code_format_chk check (code ~ '^[a-z][a-z0-9_]*$')
);

comment on table public.sectors is
  'Setores organizacionais configuráveis. Função operacional via membership, não via profiles.role.';

drop trigger if exists trg_sectors_set_updated_at on public.sectors;
create trigger trg_sectors_set_updated_at
before update on public.sectors
for each row execute function public.set_updated_at();

insert into public.sectors (code, name, description)
values
  ('commercial', 'Comercial', 'Atendimento e vendas do Indique e Ganhe / CRM comercial.'),
  ('collections', 'Cobrança', 'Cobrança e inadimplência.'),
  ('retention', 'Retenção', 'Retenção de clientes.'),
  ('post_sale', 'Pós-venda', 'Pós-venda e relacionamento.'),
  ('upgrade', 'Upgrade', 'Upgrade de planos.'),
  ('technician', 'Técnico', 'Operação técnica.'),
  ('external_sales', 'Vendas Externas', 'Vendas externas.')
on conflict (code) do nothing;

-- ============================================================
-- employees (1:1 com profiles; indicador NÃO entra no backfill)
-- ============================================================
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  status public.employee_status not null default 'active',
  hired_at timestamptz,
  dismissed_at timestamptz,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employees_profile_id_key unique (profile_id),
  constraint employees_dismissed_at_chk check (
    (status = 'dismissed' and dismissed_at is not null)
    or (status <> 'dismissed' and dismissed_at is null)
  )
);

comment on table public.employees is
  'Faceta de funcionário interno (0..1 por profile). Não é autorização de rota; profiles.role permanece a fonte de Auth.';

comment on column public.employees.status is
  'Estado global. Somente active será elegível a NOVAS distribuições futuras. Não substitui commercial_availability.';

comment on column public.employees.profile_id is
  'ON DELETE RESTRICT: desligar o funcionário não apaga o profile/Auth nem o histórico.';

create index if not exists employees_status_idx on public.employees (status);
create index if not exists employees_profile_id_idx on public.employees (profile_id);

drop trigger if exists trg_employees_set_updated_at on public.employees;
create trigger trg_employees_set_updated_at
before update on public.employees
for each row execute function public.set_updated_at();

-- Preenche dismissed_at de forma consistente com o CHECK.
create or replace function public.trg_employees_sync_dismissed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.status = 'dismissed'::public.employee_status then
    NEW.dismissed_at := coalesce(NEW.dismissed_at, timezone('utc', now()));
  else
    NEW.dismissed_at := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_employees_sync_dismissed_at on public.employees;
create trigger trg_employees_sync_dismissed_at
before insert or update of status, dismissed_at on public.employees
for each row execute function public.trg_employees_sync_dismissed_at();

-- ============================================================
-- employee_sector_memberships (N:N; histórico preservado)
-- ============================================================
create table if not exists public.employee_sector_memberships (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  sector_id uuid not null references public.sectors(id) on delete restrict,
  is_active boolean not null default true,
  joined_at timestamptz not null default timezone('utc', now()),
  left_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employee_sector_memberships_dates_chk check (
    left_at is null or left_at >= joined_at
  ),
  constraint employee_sector_memberships_active_left_chk check (
    (is_active = true and left_at is null)
    or (is_active = false)
  )
);

comment on table public.employee_sector_memberships is
  'Vínculo N:N funcionário↔setor. Membership NÃO concede privilégio administrativo nem rota.';

create unique index if not exists employee_sector_memberships_active_uidx
  on public.employee_sector_memberships (employee_id, sector_id)
  where is_active = true;

create index if not exists employee_sector_memberships_employee_idx
  on public.employee_sector_memberships (employee_id);

create index if not exists employee_sector_memberships_sector_idx
  on public.employee_sector_memberships (sector_id);

drop trigger if exists trg_employee_sector_memberships_set_updated_at
  on public.employee_sector_memberships;
create trigger trg_employee_sector_memberships_set_updated_at
before update on public.employee_sector_memberships
for each row execute function public.set_updated_at();

create or replace function public.trg_memberships_sync_left_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.is_active then
    NEW.left_at := null;
  elsif NEW.left_at is null then
    NEW.left_at := timezone('utc', now());
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_memberships_sync_left_at on public.employee_sector_memberships;
create trigger trg_memberships_sync_left_at
before insert or update of is_active, left_at on public.employee_sector_memberships
for each row execute function public.trg_memberships_sync_left_at();

-- ============================================================
-- employee_events (append-only)
-- ============================================================
create table if not exists public.employee_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  event_type text not null,
  sector_id uuid references public.sectors(id) on delete set null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.employee_events is
  'Auditoria append-only de funcionários. Sem UPDATE/DELETE para authenticated. Sprint 2.1: employee_created, status_changed, sector_added, sector_removed.';

create index if not exists employee_events_employee_created_idx
  on public.employee_events (employee_id, created_at desc);

create index if not exists employee_events_type_idx
  on public.employee_events (event_type);

create or replace function public.trg_employee_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'employee_events is append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_employee_events_append_only on public.employee_events;
create trigger trg_employee_events_append_only
before update or delete on public.employee_events
for each row execute function public.trg_employee_events_append_only();

-- ============================================================
-- Eventos via trigger (fundação; sem RPC pública)
-- actor_profile_id fica NULL no backfill/SQL direto (sem sessão).
-- ============================================================
create or replace function public.trg_employees_record_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.employee_events (
      employee_id, event_type, actor_profile_id, new_value, metadata
    )
    values (
      NEW.id,
      'employee_created',
      auth.uid(),
      jsonb_build_object(
        'status', NEW.status::text,
        'profile_id', NEW.profile_id
      ),
      jsonb_build_object('source', 'trg_employees_record_events')
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    insert into public.employee_events (
      employee_id, event_type, actor_profile_id, old_value, new_value, metadata
    )
    values (
      NEW.id,
      'status_changed',
      auth.uid(),
      jsonb_build_object('status', OLD.status::text),
      jsonb_build_object('status', NEW.status::text),
      jsonb_build_object('source', 'trg_employees_record_events')
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_employees_record_events on public.employees;
create trigger trg_employees_record_events
after insert or update of status on public.employees
for each row execute function public.trg_employees_record_events();

create or replace function public.trg_memberships_record_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' and NEW.is_active then
    insert into public.employee_events (
      employee_id, event_type, sector_id, actor_profile_id, new_value, metadata
    )
    values (
      NEW.employee_id,
      'sector_added',
      NEW.sector_id,
      auth.uid(),
      jsonb_build_object('membership_id', NEW.id, 'is_active', true),
      jsonb_build_object('source', 'trg_memberships_record_events')
    );
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.is_active is true and OLD.is_active is not true then
      insert into public.employee_events (
        employee_id, event_type, sector_id, actor_profile_id, old_value, new_value, metadata
      )
      values (
        NEW.employee_id,
        'sector_added',
        NEW.sector_id,
        auth.uid(),
        jsonb_build_object('is_active', OLD.is_active),
        jsonb_build_object('membership_id', NEW.id, 'is_active', true),
        jsonb_build_object('source', 'trg_memberships_record_events')
      );
    elsif NEW.is_active is not true and OLD.is_active is true then
      insert into public.employee_events (
        employee_id, event_type, sector_id, actor_profile_id, old_value, new_value, metadata
      )
      values (
        NEW.employee_id,
        'sector_removed',
        NEW.sector_id,
        auth.uid(),
        jsonb_build_object('is_active', true),
        jsonb_build_object('membership_id', NEW.id, 'is_active', false),
        jsonb_build_object('source', 'trg_memberships_record_events')
      );
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_memberships_record_events on public.employee_sector_memberships;
create trigger trg_memberships_record_events
after insert or update of is_active on public.employee_sector_memberships
for each row execute function public.trg_memberships_record_events();

-- ============================================================
-- RLS conservadora: sem anon; authenticated só SELECT filtrado;
-- escrita somente service_role / owner (rotas server-side futuras).
-- ============================================================
alter table public.sectors enable row level security;
alter table public.employees enable row level security;
alter table public.employee_sector_memberships enable row level security;
alter table public.employee_events enable row level security;

drop policy if exists sectors_select_policy on public.sectors;
create policy sectors_select_policy
on public.sectors
for select
to authenticated
using (
  public.is_admin_read_any()
  or exists (
    select 1
    from public.employees e
    join public.employee_sector_memberships m on m.employee_id = e.id
    where e.profile_id = auth.uid()
      and m.sector_id = sectors.id
      and m.is_active = true
  )
);

drop policy if exists employees_select_policy on public.employees;
create policy employees_select_policy
on public.employees
for select
to authenticated
using (
  profile_id = auth.uid()
  or public.is_admin_read_any()
);

drop policy if exists employee_sector_memberships_select_policy
  on public.employee_sector_memberships;
create policy employee_sector_memberships_select_policy
on public.employee_sector_memberships
for select
to authenticated
using (
  public.is_admin_read_any()
  or exists (
    select 1
    from public.employees e
    where e.id = employee_sector_memberships.employee_id
      and e.profile_id = auth.uid()
  )
);

drop policy if exists employee_events_select_policy on public.employee_events;
create policy employee_events_select_policy
on public.employee_events
for select
to authenticated
using (
  public.is_admin_read_any()
  or exists (
    select 1
    from public.employees e
    where e.id = employee_events.employee_id
      and e.profile_id = auth.uid()
  )
);

-- Sem policies de INSERT/UPDATE/DELETE para authenticated/anon.

revoke all on table public.sectors from public;
revoke all on table public.sectors from anon;
revoke all on table public.employees from public;
revoke all on table public.employees from anon;
revoke all on table public.employee_sector_memberships from public;
revoke all on table public.employee_sector_memberships from anon;
revoke all on table public.employee_events from public;
revoke all on table public.employee_events from anon;

revoke insert, update, delete on table public.sectors from authenticated;
revoke insert, update, delete on table public.employees from authenticated;
revoke insert, update, delete on table public.employee_sector_memberships from authenticated;
revoke insert, update, delete, truncate on table public.employee_events from authenticated;

grant select on table public.sectors to authenticated;
grant select on table public.employees to authenticated;
grant select on table public.employee_sector_memberships to authenticated;
grant select on table public.employee_events to authenticated;

grant all on table public.sectors to service_role;
grant all on table public.employees to service_role;
grant all on table public.employee_sector_memberships to service_role;
grant all on table public.employee_events to service_role;

-- Trigger functions: não são RPC. Revoga EXECUTE de clientes.
revoke all on function public.trg_employees_sync_dismissed_at() from public;
revoke all on function public.trg_employees_sync_dismissed_at() from anon;
revoke all on function public.trg_employees_sync_dismissed_at() from authenticated;

revoke all on function public.trg_memberships_sync_left_at() from public;
revoke all on function public.trg_memberships_sync_left_at() from anon;
revoke all on function public.trg_memberships_sync_left_at() from authenticated;

revoke all on function public.trg_employee_events_append_only() from public;
revoke all on function public.trg_employee_events_append_only() from anon;
revoke all on function public.trg_employee_events_append_only() from authenticated;

revoke all on function public.trg_employees_record_events() from public;
revoke all on function public.trg_employees_record_events() from anon;
revoke all on function public.trg_employees_record_events() from authenticated;

revoke all on function public.trg_memberships_record_events() from public;
revoke all on function public.trg_memberships_record_events() from anon;
revoke all on function public.trg_memberships_record_events() from authenticated;

-- ============================================================
-- Backfill Comercial (idempotente)
-- status: profile.is_active → active; senão paused (conservador, não dismissed)
-- ============================================================
insert into public.employees (profile_id, status, hired_at)
select
  p.id,
  case
    when coalesce(p.is_active, true) then 'active'::public.employee_status
    else 'paused'::public.employee_status
  end,
  p.created_at
from public.profiles p
where p.role = 'comercial'::public.user_role
on conflict (profile_id) do nothing;

insert into public.employee_sector_memberships (
  employee_id, sector_id, is_active, joined_at
)
select
  e.id,
  s.id,
  true,
  e.created_at
from public.employees e
inner join public.profiles p on p.id = e.profile_id
inner join public.sectors s on s.code = 'commercial'
where p.role = 'comercial'::public.user_role
on conflict (employee_id, sector_id) where is_active = true
do nothing;

-- ============================================================
-- Sprint 2.1B — elegibilidade de NOVAS atribuições comerciais
-- Helper interno (não é RPC de produto). Sem fallback se employee faltar:
-- o backfill acima cobre profiles.role='comercial'.
-- daily_limit NÃO entra no helper: assign/pick já aplicam; claim nunca aplicou.
-- SEM GRANT/REVOKE nas RPCs assign/pick/claim (preserva ACLs da sprint SLA).
-- ============================================================
create or replace function public.is_commercial_employee_assignment_eligible(
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    inner join public.employees e on e.profile_id = p.id
    inner join public.employee_sector_memberships m
      on m.employee_id = e.id
      and m.is_active = true
    inner join public.sectors s
      on s.id = m.sector_id
      and s.code = 'commercial'
      and s.is_active = true
    where p.id = p_profile_id
      and p.role = 'comercial'::public.user_role
      and coalesce(p.is_active, true) = true
      and e.status = 'active'::public.employee_status
  );
$$;

comment on function public.is_commercial_employee_assignment_eligible(uuid) is
  'Elegibilidade de NOVA atribuição Comercial: role comercial, profile ativo, employee active, membership commercial ativa. Não autoriza rotas. Sprint 2.1B.';

revoke all on function public.is_commercial_employee_assignment_eligible(uuid) from public;
revoke all on function public.is_commercial_employee_assignment_eligible(uuid) from anon;
revoke all on function public.is_commercial_employee_assignment_eligible(uuid) from authenticated;
grant execute on function public.is_commercial_employee_assignment_eligible(uuid) to service_role;

create or replace function public.assign_referral_to_next_commercial(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
  v_commercial_id uuid;
  v_old_status public.referral_status;
  v_now timestamptz := timezone('utc', now());
  v_today date := (v_now at time zone 'utc')::date;
begin
  perform public.log_lead_assignment_debug(
    'assign_referral_to_next_commercial',
    p_referral_id,
    null,
    jsonb_build_object('phase', 'start')
  );

  if p_referral_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_referral', 'message', 'Indicação inválida.');
  end if;

  select * into v_ref
  from public.referrals
  where id = p_referral_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Indicação não encontrada.');
  end if;

  if v_ref.commercial_profile_id is not null then
    perform public.log_lead_assignment_debug(
      'assign_referral_to_next_commercial',
      p_referral_id,
      v_ref.commercial_profile_id,
      jsonb_build_object('phase', 'already_assigned', 'status', v_ref.status::text)
    );
    return jsonb_build_object(
      'ok', true,
      'code', 'already_assigned',
      'referral_id', p_referral_id,
      'commercial_profile_id', v_ref.commercial_profile_id,
      'status', v_ref.status::text
    );
  end if;

  if v_ref.status in (
    'recusada'::public.referral_status,
    'paga'::public.referral_status
  ) then
    perform public.log_lead_assignment_debug(
      'assign_referral_to_next_commercial',
      p_referral_id,
      null,
      jsonb_build_object('phase', 'skip_terminal_status', 'status', v_ref.status::text)
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'terminal_status',
      'message', 'Indicação encerrada; distribuição automática não se aplica.',
      'status', v_ref.status::text
    );
  end if;

  update public.commercial_lead_settings s
  set total_received_today = 0,
      updated_at = v_now
  where (s.last_lead_received_at is null
         or (s.last_lead_received_at at time zone 'utc')::date < v_today)
    and s.total_received_today > 0;

  select s.commercial_profile_id
  into v_commercial_id
  from public.commercial_lead_settings s
  where public.is_commercial_employee_assignment_eligible(s.commercial_profile_id)
    and s.is_available = true
    and s.receiving_leads = true
    and s.total_received_today < s.daily_limit
  order by s.last_lead_received_at asc nulls first, s.active_leads asc, s.commercial_profile_id asc
  limit 1
  for update of s;

  if v_commercial_id is null then
    perform public.log_lead_assignment_debug(
      'assign_referral_to_next_commercial',
      p_referral_id,
      null,
      jsonb_build_object('phase', 'no_commercial_available', 'status', v_ref.status::text)
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'no_commercial_available',
      'message', 'Nenhum comercial disponível para receber leads no momento.',
      'status', v_ref.status::text
    );
  end if;

  v_old_status := v_ref.status;

  update public.referrals
  set commercial_profile_id = v_commercial_id,
      status = 'em_atendimento'::public.referral_status,
      assigned_at = coalesce(assigned_at, v_now),
      last_interaction_at = v_now,
      updated_at = v_now
  where id = p_referral_id
    and commercial_profile_id is null;

  if not found then
    perform public.log_lead_assignment_debug(
      'assign_referral_to_next_commercial',
      p_referral_id,
      null,
      jsonb_build_object('phase', 'race_already_assigned')
    );
    return jsonb_build_object(
      'ok', true,
      'code', 'already_assigned',
      'referral_id', p_referral_id,
      'message', 'Outro processo já atribuiu o lead.'
    );
  end if;

  update public.commercial_lead_settings
  set last_lead_received_at = v_now,
      active_leads = active_leads + 1,
      total_received_today = total_received_today + 1,
      updated_at = v_now
  where commercial_profile_id = v_commercial_id;

  insert into public.referral_history (
    referral_id,
    actor_profile_id,
    old_status,
    new_status,
    action_note,
    metadata
  )
  values (
    p_referral_id,
    v_commercial_id,
    v_old_status,
    'em_atendimento'::public.referral_status,
    'Lead atribuído automaticamente ao comercial',
    jsonb_build_object(
      'action', 'commercial_assigned',
      'assigned_commercial_id', v_commercial_id,
      'distribution', 'round_robin_last_lead_received_at'
    )
  );

  perform public.notify_commercial_lead_assigned(v_commercial_id, p_referral_id);

  perform public.log_lead_assignment_debug(
    'assign_referral_to_next_commercial',
    p_referral_id,
    v_commercial_id,
    jsonb_build_object(
      'phase', 'assigned',
      'commercial_profile_id', v_commercial_id,
      'previous_status', v_old_status::text
    )
  );

  return jsonb_build_object(
    'ok', true,
    'referral_id', p_referral_id,
    'commercial_profile_id', v_commercial_id,
    'status', 'em_atendimento',
    'previous_status', v_old_status::text
  );
exception
  when others then
    perform public.log_lead_assignment_debug(
      'assign_referral_to_next_commercial',
      p_referral_id,
      v_commercial_id,
      jsonb_build_object('phase', 'error', 'message', sqlerrm, 'sqlstate', sqlstate)
    );
    return jsonb_build_object('ok', false, 'code', 'exception', 'message', sqlerrm);
end;
$$;

comment on function public.assign_referral_to_next_commercial(uuid) is
  'Atribui lead do pool ao próximo comercial elegível (employee active + membership commercial + settings). Idempotente se já atribuído. Sprint 2.1B.';

create or replace function public.pick_next_available_commercial(
  p_exclude_commercial_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commercial_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_today date := (v_now at time zone 'utc')::date;
begin
  update public.commercial_lead_settings s
  set total_received_today = 0,
      updated_at = v_now
  where (s.last_lead_received_at is null
         or (s.last_lead_received_at at time zone 'utc')::date < v_today)
    and s.total_received_today > 0;

  select s.commercial_profile_id
  into v_commercial_id
  from public.commercial_lead_settings s
  where public.is_commercial_employee_assignment_eligible(s.commercial_profile_id)
    and s.is_available = true
    and s.receiving_leads = true
    and s.total_received_today < s.daily_limit
    and (p_exclude_commercial_id is null or s.commercial_profile_id <> p_exclude_commercial_id)
  order by s.last_lead_received_at asc nulls first, s.active_leads asc, s.commercial_profile_id asc
  limit 1
  for update of s;

  return v_commercial_id;
end;
$$;

comment on function public.pick_next_available_commercial(uuid) is
  'Próximo comercial para NOVA atribuição/SLA. Exige employee active + membership commercial. Não mexe em leads já atribuídos. Sprint 2.1B.';

create or replace function public.claim_referral_lead(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_ref public.referrals%rowtype;
  v_old_status public.referral_status;
  v_now timestamptz := timezone('utc', now());
  v_is_available boolean;
  v_receiving_leads boolean;
begin
  if v_uid is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'unauthorized',
      'message', 'Sessão inválida. Faça login novamente.'
    );
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_uid;

  if v_role is distinct from 'comercial'::public.user_role then
    return jsonb_build_object(
      'ok', false,
      'code', 'forbidden',
      'message', 'Apenas usuários com perfil comercial podem assumir leads.'
    );
  end if;

  if not public.is_commercial_employee_assignment_eligible(v_uid) then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_eligible',
      'message', 'Perfil inelegível para assumir novos leads (status, setor Comercial ou conta inativa).'
    );
  end if;

  -- daily_limit NÃO se aplica ao claim (semântica histórica). Aplica is_available/receiving_leads.
  select s.is_available, s.receiving_leads
  into v_is_available, v_receiving_leads
  from public.commercial_lead_settings s
  where s.commercial_profile_id = v_uid;

  if v_is_available is not true or v_receiving_leads is not true then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_eligible',
      'message', 'Disponibilidade comercial não permite assumir novos leads no momento.'
    );
  end if;

  select * into strict v_ref
  from public.referrals
  where id = p_referral_id
  for update;

  v_old_status := v_ref.status;

  if v_ref.commercial_profile_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already_claimed');
  end if;

  update public.referrals
  set
    commercial_profile_id = v_uid,
    status = 'em_atendimento'::public.referral_status,
    assigned_at = v_now,
    first_response_at = v_now,
    last_interaction_at = v_now,
    updated_at = v_now
  where id = p_referral_id;

  insert into public.referral_history (
    referral_id,
    actor_profile_id,
    old_status,
    new_status,
    action_note,
    metadata
  )
  values (
    p_referral_id,
    v_uid,
    v_old_status,
    'em_atendimento'::public.referral_status,
    'Lead assumido pelo comercial',
    jsonb_build_object('action', 'claim_lead_rpc')
  );

  return jsonb_build_object(
    'ok', true,
    'referral_id', p_referral_id,
    'commercial_profile_id', v_uid
  );
exception
  when no_data_found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
end;
$$;

comment on function public.claim_referral_lead(uuid) is
  'Comercial assume lead do pool. Exige employee active + membership commercial + settings disponíveis. daily_limit não se aplica (histórico). Sprint 2.1B.';

commit;

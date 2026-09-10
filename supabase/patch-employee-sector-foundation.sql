-- Sprint 2.1 — Fundação de funcionários, setores e múltiplas funções
--
-- Cria: employees, sectors, employee_sector_memberships, employee_events.
-- Backfill: profiles.role = 'comercial' → employee + membership no setor commercial.
--
-- NÃO altera: commercial_lead_settings, commercial_availability, referrals,
-- commercial_profile_id, round-robin, SLA, rewards, wallet, Auth users, BRByte.
-- NÃO executa DML financeiro.
-- Idempotente: CREATE IF NOT EXISTS, ON CONFLICT DO NOTHING, DROP TRIGGER IF EXISTS.
--
-- Disponibilidade (documentação):
--   employees.status     = elegibilidade GLOBAL futura (não alimenta o RR atual).
--   commercial_availability + commercial_lead_settings
--                        = disponibilidade OPERACIONAL do setor Comercial existente.
--   Regra futura de distribuição (NÃO implementada aqui):
--     status=active AND membership ativo AND regras do setor.
--   Round-robin Comercial desta sprint permanece inalterado.

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

commit;

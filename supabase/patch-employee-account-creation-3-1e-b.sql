-- Sprint 3.1E-B — Cadastro completo de funcionário + Auth
--
-- Adiciona campos HR em employees e tabela de idempotência da criação de conta.
-- NÃO altera: user_role, profiles.role default, Comercial 2.1B, Cobrança 2.2,
-- Retenção, BRByte, modelo financeiro, Vendas Internas.
-- NÃO persiste senha/token.
-- Idempotente. Sem backfill. NÃO executar em produção nesta sprint.

begin;

alter table public.employees
  add column if not exists job_title text;

alter table public.employees
  add column if not exists birth_date date;

alter table public.employees
  add column if not exists manager_employee_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_manager_employee_id_fkey'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_manager_employee_id_fkey
      foreign key (manager_employee_id)
      references public.employees(id)
      on delete set null;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_manager_not_self_chk'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_manager_not_self_chk
      check (manager_employee_id is null or manager_employee_id <> id);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_job_title_len_chk'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_job_title_len_chk
      check (job_title is null or char_length(btrim(job_title)) between 1 and 80);
  end if;
end$$;

comment on column public.employees.job_title is
  'Cargo organizacional textual (ex.: Atendente). Não é setor nem profiles.role.';

comment on column public.employees.birth_date is
  'Data de nascimento do funcionário. Domínio HR; não confundir com nascimento de cliente.';

comment on column public.employees.manager_employee_id is
  'Gestor direto (employees.id). Nullable. Sem auto-gerenciamento. Não concede acesso financeiro.';

create index if not exists employees_manager_employee_id_idx
  on public.employees (manager_employee_id);

create table if not exists public.employee_account_creations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'created', 'failed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employee_account_creations_idempotency_key_uidx unique (idempotency_key)
);

comment on table public.employee_account_creations is
  'Idempotência de POST /api/admin/employees/create. Sem senha, token ou PII.';

comment on column public.employee_account_creations.auth_user_id is
  'Auth user criado por ESTA operação. Ownership para recovery; nunca inferir por e-mail.';

create index if not exists employee_account_creations_actor_idx
  on public.employee_account_creations (actor_profile_id);

create index if not exists employee_account_creations_auth_user_idx
  on public.employee_account_creations (auth_user_id);

create index if not exists employee_account_creations_employee_idx
  on public.employee_account_creations (employee_id);

alter table public.employee_account_creations enable row level security;

-- Sem policies para authenticated: somente service role (bypassa RLS).

commit;

-- Mapeamento CRM → plan_pk Controllr/BRByte.
-- Aplicar após patch-referral-interested-fields.sql.
-- Não altera rewards, wallet, pipeline, SLA ou sync automático.

begin;

create table if not exists public.brbyte_plan_mappings (
  id uuid primary key default gen_random_uuid(),
  crm_plan_id text,
  crm_plan_code text,
  crm_plan_name text not null,
  brbyte_plan_pk text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.brbyte_plan_mappings is
  'Mapeamento de planos do CRM para plan_pk do Controllr/BRByte.';

create index if not exists brbyte_plan_mappings_crm_plan_id_idx
  on public.brbyte_plan_mappings (crm_plan_id)
  where crm_plan_id is not null;

create index if not exists brbyte_plan_mappings_crm_plan_code_idx
  on public.brbyte_plan_mappings (crm_plan_code)
  where crm_plan_code is not null;

create index if not exists brbyte_plan_mappings_crm_plan_name_idx
  on public.brbyte_plan_mappings (crm_plan_name);

create index if not exists brbyte_plan_mappings_brbyte_plan_pk_idx
  on public.brbyte_plan_mappings (brbyte_plan_pk);

create index if not exists brbyte_plan_mappings_is_active_idx
  on public.brbyte_plan_mappings (is_active);

alter table public.brbyte_plan_mappings enable row level security;

drop policy if exists brbyte_plan_mappings_select_admin on public.brbyte_plan_mappings;
create policy brbyte_plan_mappings_select_admin
  on public.brbyte_plan_mappings
  for select
  to authenticated
  using (public.is_admin_read_any());

drop policy if exists brbyte_plan_mappings_write_admin on public.brbyte_plan_mappings;
create policy brbyte_plan_mappings_write_admin
  on public.brbyte_plan_mappings
  for all
  to authenticated
  using (public.is_admin_write_any())
  with check (public.is_admin_write_any());

commit;

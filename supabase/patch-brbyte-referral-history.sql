-- Histórico de eventos BRByte por indicação (observabilidade).
-- Aplicar após patch-brbyte-referral-sync-status.sql.

begin;

create table if not exists public.brbyte_referral_history (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals (id) on delete cascade,
  phase text not null,
  old_status text,
  new_status text,
  endpoint text,
  http_status integer,
  message text,
  payload jsonb,
  created_by uuid,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.brbyte_referral_history is
  'Histórico de fases e transições BRByte por indicação.';

create index if not exists brbyte_referral_history_referral_id_idx
  on public.brbyte_referral_history (referral_id);

create index if not exists brbyte_referral_history_phase_idx
  on public.brbyte_referral_history (phase);

create index if not exists brbyte_referral_history_created_at_idx
  on public.brbyte_referral_history (created_at desc);

create index if not exists brbyte_referral_history_http_status_idx
  on public.brbyte_referral_history (http_status)
  where http_status is not null;

alter table public.brbyte_referral_history enable row level security;

drop policy if exists brbyte_referral_history_select_admin on public.brbyte_referral_history;
create policy brbyte_referral_history_select_admin
  on public.brbyte_referral_history
  for select
  to authenticated
  using (public.is_admin_read_any());

drop policy if exists brbyte_referral_history_insert_admin on public.brbyte_referral_history;
create policy brbyte_referral_history_insert_admin
  on public.brbyte_referral_history
  for insert
  to authenticated
  with check (public.is_admin_write_any());

commit;

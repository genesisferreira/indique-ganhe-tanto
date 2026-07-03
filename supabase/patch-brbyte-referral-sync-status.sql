-- Status interno da integração BRByte por referral + fase em brbyte_sync_runs.
-- Aplicar após patch-brbyte-plan-mapping.sql.
-- Não ativa sync automático nem altera fluxos financeiros.

begin;

alter table public.referrals
  add column if not exists brbyte_sync_status text not null default 'pending',
  add column if not exists brbyte_sync_error text,
  add column if not exists brbyte_sync_attempts integer not null default 0,
  add column if not exists brbyte_last_error_at timestamptz,
  add column if not exists brbyte_last_http_status integer,
  add column if not exists brbyte_last_endpoint text;

alter table public.referrals
  drop constraint if exists referrals_brbyte_sync_status_check;

alter table public.referrals
  add constraint referrals_brbyte_sync_status_check
  check (
    brbyte_sync_status in (
      'pending',
      'created',
      'waiting_conversion',
      'waiting_contract',
      'waiting_invoice',
      'synced',
      'completed',
      'error',
      'retry'
    )
  );

comment on column public.referrals.brbyte_sync_status is
  'Estado interno da integração BRByte para esta indicação.';
comment on column public.referrals.brbyte_sync_error is
  'Última mensagem de erro resumida da integração BRByte.';
comment on column public.referrals.brbyte_sync_attempts is
  'Quantidade de tentativas de integração BRByte (manual ou futura automação).';
comment on column public.referrals.brbyte_last_error_at is
  'Quando ocorreu o último erro de integração BRByte.';
comment on column public.referrals.brbyte_last_http_status is
  'Último HTTP status retornado pela BRByte.';
comment on column public.referrals.brbyte_last_endpoint is
  'Último endpoint BRByte chamado para esta indicação.';

create index if not exists referrals_brbyte_sync_status_idx
  on public.referrals (brbyte_sync_status);

alter table public.brbyte_sync_runs
  add column if not exists phase text;

comment on column public.brbyte_sync_runs.phase is
  'Fase da execução (login, create_interest, find_client, etc.). Mantém meta.phase para compatibilidade.';

create index if not exists brbyte_sync_runs_phase_idx
  on public.brbyte_sync_runs (phase)
  where phase is not null;

commit;

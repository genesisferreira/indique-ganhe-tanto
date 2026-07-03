-- Conversão manual Interessado → Cliente no Controllr.
-- Aplicar após patch-brbyte-referral-sync-status.sql.

begin;

alter table public.referrals
  add column if not exists brbyte_client_pk text,
  add column if not exists brbyte_client_synced_at timestamptz;

comment on column public.referrals.brbyte_client_pk is
  'client_pk retornado pelo Controllr após conversão do Interessado.';
comment on column public.referrals.brbyte_client_synced_at is
  'Quando o Interessado foi convertido em cliente no Controllr.';

create index if not exists referrals_brbyte_client_pk_idx
  on public.referrals (brbyte_client_pk)
  where brbyte_client_pk is not null;

alter table public.referrals
  drop constraint if exists referrals_brbyte_sync_status_check;

alter table public.referrals
  add constraint referrals_brbyte_sync_status_check
  check (
    brbyte_sync_status in (
      'pending',
      'created',
      'converted',
      'waiting_conversion',
      'waiting_contract',
      'waiting_invoice',
      'synced',
      'completed',
      'error',
      'retry'
    )
  );

commit;

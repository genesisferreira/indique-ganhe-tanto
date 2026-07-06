-- Sprint BRByte 3 — campos de primeira mensalidade e status paid_confirmed.
-- Aplicar após patch-brbyte-client-conversion.sql.

begin;

alter table public.referrals
  add column if not exists brbyte_contract_pk text,
  add column if not exists brbyte_first_invoice_pk text,
  add column if not exists brbyte_first_invoice_paid_at timestamptz,
  add column if not exists brbyte_first_invoice_payload jsonb;

comment on column public.referrals.brbyte_contract_pk is
  'contract_pk do Controllr vinculado ao cliente convertido.';
comment on column public.referrals.brbyte_first_invoice_pk is
  'invoice_pk da primeira mensalidade válida consultada no Controllr.';
comment on column public.referrals.brbyte_first_invoice_paid_at is
  'Data de crédito (invoice_date_credit) da primeira mensalidade paga no Controllr.';
comment on column public.referrals.brbyte_first_invoice_payload is
  'Payload bruto da consulta de fatura (list + list_info) no Controllr.';

create index if not exists referrals_brbyte_contract_pk_idx
  on public.referrals (brbyte_contract_pk)
  where brbyte_contract_pk is not null;

create index if not exists referrals_brbyte_first_invoice_pk_idx
  on public.referrals (brbyte_first_invoice_pk)
  where brbyte_first_invoice_pk is not null;

-- Backfill: contract_pk legado em brbyte_id_contrato
update public.referrals
set brbyte_contract_pk = brbyte_id_contrato
where brbyte_contract_pk is null
  and brbyte_id_contrato is not null;

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
      'paid_confirmed',
      'completed',
      'error',
      'retry'
    )
  );

commit;

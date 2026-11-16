-- J13B: status de nova tentativa técnica e leitura interna do id da indicação.
-- Não altera dados existentes. O service role continua sem acesso direto à tabela de submissões.

alter table public.referrals drop constraint referrals_brbyte_sync_status_check;

alter table public.referrals
  add constraint referrals_brbyte_sync_status_check
  check (
    brbyte_sync_status = any (
      array[
        'pending'::text,
        'created'::text,
        'converted'::text,
        'waiting_conversion'::text,
        'waiting_contract'::text,
        'waiting_invoice'::text,
        'synced'::text,
        'paid_confirmed'::text,
        'completed'::text,
        'error'::text,
        'retry'::text,
        'retryable_error'::text
      ]
    )
  );

create or replace function public.referral_share_referral_id_for_dispatch(p_key text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.opportunity_id
  from public.referral_share_submissions s
  where s.idempotency_key = p_key
  limit 1
$$;

revoke all on function public.referral_share_referral_id_for_dispatch(text) from public, anon, authenticated;
grant execute on function public.referral_share_referral_id_for_dispatch(text) to service_role;

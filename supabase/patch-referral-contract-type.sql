-- Tipo de contratação para indicações (Tanto Livre / Tanto Vantagens).
-- Aplicar após patch-referral-interested-fields.sql.
-- Aditivo: não altera rewards, wallet, pipeline, SLA, notifications ou integração BRByte.

begin;

alter table public.referrals
  add column if not exists referral_contract_type text default 'tanto_vantagens';

comment on column public.referrals.referral_contract_type is
  'Tipo de contratação: tanto_livre ou tanto_vantagens (padrão: tanto_vantagens).';

-- Constraint idempotente (nome fixo)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'referrals_referral_contract_type_check'
      and conrelid = 'public.referrals'::regclass
  ) then
    alter table public.referrals
      add constraint referrals_referral_contract_type_check
      check (
        referral_contract_type is null
        or referral_contract_type in ('tanto_livre', 'tanto_vantagens')
      );
  end if;
end $$;

create index if not exists referrals_referral_contract_type_idx
  on public.referrals (referral_contract_type)
  where referral_contract_type is not null;

commit;

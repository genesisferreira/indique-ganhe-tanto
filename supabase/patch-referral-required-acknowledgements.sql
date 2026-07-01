-- Confirmações obrigatórias no cadastro de indicação (proteção operacional/jurídica).
-- Aplicar após patch-referral-contract-type.sql.
-- Aditivo: indicações antigas permanecem com false/null.

begin;

alter table public.referrals
  add column if not exists installation_fee_awareness boolean not null default false,
  add column if not exists installation_fee_awareness_at timestamptz,
  add column if not exists contract_type_awareness boolean not null default false,
  add column if not exists contract_type_awareness_at timestamptz;

comment on column public.referrals.installation_fee_awareness is
  'Indicador declarou ciência sobre possíveis taxas de instalação/habilitação.';
comment on column public.referrals.installation_fee_awareness_at is
  'Data/hora da confirmação sobre taxas de instalação.';
comment on column public.referrals.contract_type_awareness is
  'Indicador declarou que explicou Tanto Livre vs Tanto Vantagens ao indicado.';
comment on column public.referrals.contract_type_awareness_at is
  'Data/hora da confirmação sobre tipo de contratação.';

commit;

-- Pré-cadastro público (captação direta, sem indicador/recompensa).
-- Aplicar após patches de referrals/BRByte existentes.

begin;

alter table public.referrals
  alter column indicator_profile_id drop not null;

alter table public.referrals
  alter column reward_type drop not null;

alter table public.referrals
  alter column reward_amount drop not null;

alter table public.referrals
  add column if not exists source text,
  add column if not exists reward_eligible boolean not null default true,
  add column if not exists preferred_installation_period text,
  add column if not exists public_pre_registration_at timestamptz,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists gclid text,
  add column if not exists fbclid text,
  add column if not exists ref_code text;

comment on column public.referrals.source is
  'Origem do registro no CRM (ex.: public_pre_registration).';
comment on column public.referrals.reward_eligible is
  'Se false, nunca participa de recompensa/carteira/Pix.';
comment on column public.referrals.preferred_installation_period is
  'Preferência de instalação: morning | afternoon | no_preference.';

alter table public.referrals
  drop constraint if exists referrals_preferred_installation_period_chk;

alter table public.referrals
  add constraint referrals_preferred_installation_period_chk
  check (
    preferred_installation_period is null
    or preferred_installation_period in ('morning', 'afternoon', 'no_preference')
  );

alter table public.referrals
  drop constraint if exists referrals_public_pre_registration_chk;

alter table public.referrals
  add constraint referrals_public_pre_registration_chk
  check (
    source is distinct from 'public_pre_registration'
    or (
      reward_eligible = false
      and indicator_profile_id is null
    )
  );

create index if not exists referrals_source_idx
  on public.referrals (source)
  where source is not null;

create index if not exists referrals_public_pre_document_idx
  on public.referrals (referred_document, created_at desc)
  where source = 'public_pre_registration';

commit;

-- Preferências de contato e rastreamento de página — pré-cadastro público.
-- Aplicar após patch-public-pre-registration.sql.

begin;

alter table public.referrals
  add column if not exists phone_has_whatsapp boolean,
  add column if not exists preferred_contact_period text,
  add column if not exists source_page text;

comment on column public.referrals.phone_has_whatsapp is
  'Indica se o telefone informado possui WhatsApp (pré-cadastro público).';
comment on column public.referrals.preferred_contact_period is
  'Preferência de horário para contato comercial: morning | afternoon | evening | no_preference.';
comment on column public.referrals.source_page is
  'Página pública que originou o cadastro (ex.: /pre-cadastro).';

alter table public.referrals
  drop constraint if exists referrals_preferred_contact_period_chk;

alter table public.referrals
  add constraint referrals_preferred_contact_period_chk
  check (
    preferred_contact_period is null
    or preferred_contact_period in ('morning', 'afternoon', 'evening', 'no_preference')
  );

commit;

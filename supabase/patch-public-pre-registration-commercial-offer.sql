-- Pré-cadastro público: oferta comercial escolhida no formulário
-- (catálogo estático; independente de public.plans / Controllr)

alter table public.referrals
  add column if not exists public_offer_code text;

alter table public.referrals
  add column if not exists public_offer_name text;

alter table public.referrals
  add column if not exists public_offer_price numeric(10, 2);

comment on column public.referrals.public_offer_code is
  'Código da oferta comercial do pré-cadastro público (catálogo próprio).';

comment on column public.referrals.public_offer_name is
  'Nome oficial da oferta comercial do pré-cadastro público.';

comment on column public.referrals.public_offer_price is
  'Preço oficial da oferta comercial do pré-cadastro público (não é reward_amount).';

create index if not exists referrals_public_offer_code_idx
  on public.referrals (public_offer_code)
  where public_offer_code is not null;

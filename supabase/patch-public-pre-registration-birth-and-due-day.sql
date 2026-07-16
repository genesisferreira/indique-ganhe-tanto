-- Pré-cadastro público: nascimento e preferência de vencimento
-- Aditivo e compatível com registros antigos (campos permanecem nullable).

alter table public.referrals
  add column if not exists referred_birth_date date;

alter table public.referrals
  add column if not exists preferred_invoice_due_day integer;

alter table public.referrals
  drop constraint if exists referrals_preferred_invoice_due_day_chk;

alter table public.referrals
  add constraint referrals_preferred_invoice_due_day_chk
  check (
    preferred_invoice_due_day is null
    or preferred_invoice_due_day in (5, 10, 15, 20, 25, 30)
  );

comment on column public.referrals.referred_birth_date is
  'Data de nascimento informada no pré-cadastro público.';

comment on column public.referrals.preferred_invoice_due_day is
  'Dia preferido para vencimento da fatura; confirmação ocorre na contratação.';

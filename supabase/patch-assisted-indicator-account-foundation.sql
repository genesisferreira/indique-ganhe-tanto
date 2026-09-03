-- =========================================================
-- CADASTRO ASSISTIDO — FASE 3B
-- Conta assistida do indicador + primeiro acesso
-- =========================================================
-- Adiciona:
--   profiles.must_change_password (default false — cadastro público intacto)
--   assisted_indicator_creations (idempotência interna, sem PII/senha)
--
-- NÃO altera: AUTH 1C trigger, reward, wallet, Controllr, Sprint 1.2.
-- Aplicável ANTES do código. Idempotente. Sem backfill.

begin;

-- Troca obrigatória no primeiro acesso (somente criação assistida seta true).
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'Se true, o usuário deve definir nova senha em /primeiro-acesso antes do dashboard. Default false (cadastro público e contas legadas).';

-- Idempotência da criação assistida de indicador (infra backend / service role).
create table if not exists public.assisted_indicator_creations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  indicator_profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'created', 'failed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assisted_indicator_creations_idempotency_key_uidx unique (idempotency_key)
);

comment on table public.assisted_indicator_creations is
  'Idempotência de POST /api/comercial/assisted-indicators. Sem senha/PII. Acesso via service role.';

create index if not exists assisted_indicator_creations_actor_idx
  on public.assisted_indicator_creations(actor_profile_id);

create index if not exists assisted_indicator_creations_indicator_idx
  on public.assisted_indicator_creations(indicator_profile_id);

alter table public.assisted_indicator_creations enable row level security;

-- Sem policies para roles autenticados: somente service role (bypassa RLS).
-- Garante que o browser não leia/escreva esta tabela.

commit;

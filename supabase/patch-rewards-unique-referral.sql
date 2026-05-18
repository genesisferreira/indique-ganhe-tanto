-- Garante índice único em rewards.referral_id (idempotência).
-- schema.sql já define: referral_id uuid not null unique
-- Aplicar em projetos legados onde a constraint possa estar ausente.

begin;

create unique index if not exists rewards_referral_id_unique
  on public.rewards (referral_id);

commit;

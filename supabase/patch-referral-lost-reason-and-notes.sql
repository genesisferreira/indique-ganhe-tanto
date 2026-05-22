-- Motivo e observações de perda/recusa (complementa patch-commercial-pipeline).
-- lost_reason pode já existir via patch-commercial-pipeline.sql

begin;

alter table public.referrals
  add column if not exists lost_reason text,
  add column if not exists lost_notes text;

comment on column public.referrals.lost_reason is
  'Motivo padronizado ou texto da perda/recusa (ex.: sem_contato, Sem contato)';
comment on column public.referrals.lost_notes is
  'Observação opcional ao recusar/perder o lead';

-- Backfill legado: rejection_reason → lost_reason quando vazio
update public.referrals r
set lost_reason = coalesce(nullif(trim(r.lost_reason), ''), r.rejection_reason)
where r.status = 'recusada'::public.referral_status
  and r.rejection_reason is not null
  and (r.lost_reason is null or trim(r.lost_reason) = '');

commit;

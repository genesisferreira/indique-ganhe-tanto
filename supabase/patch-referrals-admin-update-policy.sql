-- Aplicar no SQL Editor do Supabase se UPDATE em referrals pelo admin não persistir
-- (sintoma: histórico inserido mas commercial_profile_id/status não mudam — RLS bloqueando 0 linhas).
-- Alinha com supabase/rls-policies.sql: admin_financeiro + admin_master via is_admin_write_any().

begin;

drop policy if exists referrals_update_policy on public.referrals;
create policy referrals_update_policy
on public.referrals
for update
to authenticated
using (
  commercial_profile_id = auth.uid()
  or public.is_admin_write_any()
)
with check (
  commercial_profile_id = auth.uid()
  or public.is_admin_write_any()
);

commit;

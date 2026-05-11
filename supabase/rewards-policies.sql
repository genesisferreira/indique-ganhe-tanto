-- Permite criação automática de rewards ao comercial vender/aprovar lead.
-- Mantém admin_write_any e adiciona caso comercial autenticado responsável pelo lead.

drop policy if exists rewards_insert_policy on public.rewards;
create policy rewards_insert_policy
on public.rewards
for insert
to authenticated
with check (
  public.is_admin_write_any()
  or (
    public.is_comercial()
    and exists (
      select 1
      from public.referrals r
      where r.id = rewards.referral_id
        and r.commercial_profile_id = auth.uid()
    )
  )
);

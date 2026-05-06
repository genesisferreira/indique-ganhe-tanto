-- =========================================================
-- Indique e Ganhe - Tanto Telecom
-- RLS e Policies (Supabase)
-- =========================================================
-- Este arquivo assume que:
-- 1) o schema base já foi aplicado (supabase/schema.sql)
-- 2) auth.users está integrado com public.profiles (id = auth.uid())
-- 3) os roles funcionais estão em public.profiles.role
--
-- Perfis:
-- - indicador: vê e opera somente seus próprios dados
-- - comercial: vê apenas leads/referrals atribuídos a ele
-- - admin_consulta: leitura global, sem escrita
-- - admin_financeiro: gerencia financeiro (recompensas, pagamentos, comprovantes, carteira)
-- - admin_master: acesso total

begin;

-- =========================================================
-- FUNCOES AUXILIARES DE AUTORIZACAO
-- =========================================================

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
$$;

create or replace function public.is_admin_consulta()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin_consulta'
$$;

create or replace function public.is_admin_financeiro()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin_financeiro'
$$;

create or replace function public.is_admin_master()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin_master'
$$;

create or replace function public.is_admin_read_any()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin_consulta', 'admin_financeiro', 'admin_master')
$$;

create or replace function public.is_admin_write_any()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin_financeiro', 'admin_master')
$$;

create or replace function public.is_indicator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'indicador'
$$;

create or replace function public.is_comercial()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'comercial'
$$;

-- =========================================================
-- ENABLE RLS EM TODAS AS TABELAS DE NEGOCIO
-- =========================================================

alter table public.profiles enable row level security;
alter table public.pix_keys enable row level security;
alter table public.plans enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_history enable row level security;
alter table public.commercial_availability enable row level security;
alter table public.rewards enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- =========================================================
-- PROFILES
-- =========================================================

drop policy if exists profiles_select_policy on public.profiles;
create policy profiles_select_policy
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_admin_read_any()
  or (
    public.is_comercial()
    and exists (
      select 1
      from public.referrals r
      where r.indicator_profile_id = profiles.id
        and (
          r.commercial_profile_id = auth.uid()
          or r.commercial_profile_id is null
        )
    )
  )
);

drop policy if exists profiles_update_policy on public.profiles;
create policy profiles_update_policy
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
  or public.is_admin_master()
)
with check (
  id = auth.uid()
  or public.is_admin_master()
);

drop policy if exists profiles_insert_policy on public.profiles;
create policy profiles_insert_policy
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
  or public.is_admin_master()
);

drop policy if exists profiles_delete_policy on public.profiles;
create policy profiles_delete_policy
on public.profiles
for delete
to authenticated
using (public.is_admin_master());

-- =========================================================
-- PIX KEYS
-- =========================================================

drop policy if exists pix_keys_select_policy on public.pix_keys;
create policy pix_keys_select_policy
on public.pix_keys
for select
to authenticated
using (
  profile_id = auth.uid()
  or public.is_admin_read_any()
);

drop policy if exists pix_keys_insert_policy on public.pix_keys;
create policy pix_keys_insert_policy
on public.pix_keys
for insert
to authenticated
with check (
  profile_id = auth.uid()
  or public.is_admin_master()
);

drop policy if exists pix_keys_update_policy on public.pix_keys;
create policy pix_keys_update_policy
on public.pix_keys
for update
to authenticated
using (
  profile_id = auth.uid()
  or public.is_admin_master()
)
with check (
  profile_id = auth.uid()
  or public.is_admin_master()
);

drop policy if exists pix_keys_delete_policy on public.pix_keys;
create policy pix_keys_delete_policy
on public.pix_keys
for delete
to authenticated
using (
  profile_id = auth.uid()
  or public.is_admin_master()
);

-- =========================================================
-- PLANS (catálogo)
-- =========================================================

drop policy if exists plans_select_policy on public.plans;
create policy plans_select_policy
on public.plans
for select
to authenticated
using (
  is_active = true
  or public.is_admin_read_any()
);

drop policy if exists plans_write_policy on public.plans;
create policy plans_write_policy
on public.plans
for all
to authenticated
using (public.is_admin_master())
with check (public.is_admin_master());

-- =========================================================
-- REFERRALS (equivalente aos leads no fluxo comercial)
-- =========================================================

drop policy if exists referrals_select_policy on public.referrals;
create policy referrals_select_policy
on public.referrals
for select
to authenticated
using (
  indicator_profile_id = auth.uid() -- indicador vê suas indicações
  or commercial_profile_id = auth.uid() -- comercial vê as atribuídas a ele
  or (
    public.is_comercial()
    and commercial_profile_id is null
  ) -- pool até distribuição automática
  or public.is_admin_read_any() -- admins leitura global
);

drop policy if exists referrals_insert_policy on public.referrals;
create policy referrals_insert_policy
on public.referrals
for insert
to authenticated
with check (
  indicator_profile_id = auth.uid() -- indicador só cria para si
  or public.is_admin_master()
);

drop policy if exists referrals_update_policy on public.referrals;
create policy referrals_update_policy
on public.referrals
for update
to authenticated
using (
  commercial_profile_id = auth.uid() -- comercial atualiza apenas atribuídas a ele
  or public.is_admin_master()
)
with check (
  commercial_profile_id = auth.uid()
  or public.is_admin_master()
);

drop policy if exists referrals_delete_policy on public.referrals;
create policy referrals_delete_policy
on public.referrals
for delete
to authenticated
using (public.is_admin_master());

-- =========================================================
-- REFERRAL HISTORY
-- =========================================================

drop policy if exists referral_history_select_policy on public.referral_history;
create policy referral_history_select_policy
on public.referral_history
for select
to authenticated
using (
  exists (
    select 1
    from public.referrals r
    where r.id = referral_history.referral_id
      and (
        r.indicator_profile_id = auth.uid()
        or r.commercial_profile_id = auth.uid()
      )
  )
  or public.is_admin_read_any()
);

drop policy if exists referral_history_insert_policy on public.referral_history;
create policy referral_history_insert_policy
on public.referral_history
for insert
to authenticated
with check (
  actor_profile_id = auth.uid()
  or public.is_admin_master()
);

drop policy if exists referral_history_update_policy on public.referral_history;
create policy referral_history_update_policy
on public.referral_history
for update
to authenticated
using (public.is_admin_master())
with check (public.is_admin_master());

drop policy if exists referral_history_delete_policy on public.referral_history;
create policy referral_history_delete_policy
on public.referral_history
for delete
to authenticated
using (public.is_admin_master());

-- =========================================================
-- COMMERCIAL AVAILABILITY
-- =========================================================

drop policy if exists commercial_availability_select_policy on public.commercial_availability;
create policy commercial_availability_select_policy
on public.commercial_availability
for select
to authenticated
using (
  commercial_profile_id = auth.uid()
  or public.is_admin_read_any()
);

drop policy if exists commercial_availability_insert_policy on public.commercial_availability;
create policy commercial_availability_insert_policy
on public.commercial_availability
for insert
to authenticated
with check (
  commercial_profile_id = auth.uid()
  or public.is_admin_master()
);

drop policy if exists commercial_availability_update_policy on public.commercial_availability;
create policy commercial_availability_update_policy
on public.commercial_availability
for update
to authenticated
using (
  commercial_profile_id = auth.uid()
  or public.is_admin_master()
)
with check (
  commercial_profile_id = auth.uid()
  or public.is_admin_master()
);

drop policy if exists commercial_availability_delete_policy on public.commercial_availability;
create policy commercial_availability_delete_policy
on public.commercial_availability
for delete
to authenticated
using (
  commercial_profile_id = auth.uid()
  or public.is_admin_master()
);

-- =========================================================
-- REWARDS (financeiro)
-- =========================================================

drop policy if exists rewards_select_policy on public.rewards;
create policy rewards_select_policy
on public.rewards
for select
to authenticated
using (
  indicator_profile_id = auth.uid()
  or public.is_admin_read_any()
);

drop policy if exists rewards_insert_policy on public.rewards;
create policy rewards_insert_policy
on public.rewards
for insert
to authenticated
with check (
  public.is_admin_write_any()
);

drop policy if exists rewards_update_policy on public.rewards;
create policy rewards_update_policy
on public.rewards
for update
to authenticated
using (
  public.is_admin_write_any()
)
with check (
  public.is_admin_write_any()
);

drop policy if exists rewards_delete_policy on public.rewards;
create policy rewards_delete_policy
on public.rewards
for delete
to authenticated
using (
  public.is_admin_write_any()
);

-- =========================================================
-- WALLET TRANSACTIONS (financeiro)
-- =========================================================

drop policy if exists wallet_transactions_select_policy on public.wallet_transactions;
create policy wallet_transactions_select_policy
on public.wallet_transactions
for select
to authenticated
using (
  indicator_profile_id = auth.uid()
  or public.is_admin_read_any()
);

drop policy if exists wallet_transactions_insert_policy on public.wallet_transactions;
create policy wallet_transactions_insert_policy
on public.wallet_transactions
for insert
to authenticated
with check (
  public.is_admin_write_any()
);

drop policy if exists wallet_transactions_update_policy on public.wallet_transactions;
create policy wallet_transactions_update_policy
on public.wallet_transactions
for update
to authenticated
using (
  public.is_admin_write_any()
)
with check (
  public.is_admin_write_any()
);

drop policy if exists wallet_transactions_delete_policy on public.wallet_transactions;
create policy wallet_transactions_delete_policy
on public.wallet_transactions
for delete
to authenticated
using (
  public.is_admin_master()
);

-- =========================================================
-- PAYMENTS (financeiro)
-- =========================================================

drop policy if exists payments_select_policy on public.payments;
create policy payments_select_policy
on public.payments
for select
to authenticated
using (
  indicator_profile_id = auth.uid()
  or public.is_admin_read_any()
);

drop policy if exists payments_insert_policy on public.payments;
create policy payments_insert_policy
on public.payments
for insert
to authenticated
with check (
  public.is_admin_write_any()
);

drop policy if exists payments_update_policy on public.payments;
create policy payments_update_policy
on public.payments
for update
to authenticated
using (
  public.is_admin_write_any()
)
with check (
  public.is_admin_write_any()
);

drop policy if exists payments_delete_policy on public.payments;
create policy payments_delete_policy
on public.payments
for delete
to authenticated
using (
  public.is_admin_master()
);

-- =========================================================
-- NOTIFICATIONS
-- =========================================================

drop policy if exists notifications_select_policy on public.notifications;
create policy notifications_select_policy
on public.notifications
for select
to authenticated
using (
  profile_id = auth.uid()
  or public.is_admin_read_any()
);

drop policy if exists notifications_insert_policy on public.notifications;
create policy notifications_insert_policy
on public.notifications
for insert
to authenticated
with check (
  public.is_admin_write_any()
  or profile_id = auth.uid()
);

drop policy if exists notifications_update_policy on public.notifications;
create policy notifications_update_policy
on public.notifications
for update
to authenticated
using (
  profile_id = auth.uid()
  or public.is_admin_write_any()
)
with check (
  profile_id = auth.uid()
  or public.is_admin_write_any()
);

drop policy if exists notifications_delete_policy on public.notifications;
create policy notifications_delete_policy
on public.notifications
for delete
to authenticated
using (
  public.is_admin_master()
);

-- =========================================================
-- AUDIT LOGS
-- =========================================================

drop policy if exists audit_logs_select_policy on public.audit_logs;
create policy audit_logs_select_policy
on public.audit_logs
for select
to authenticated
using (
  public.is_admin_read_any()
);

drop policy if exists audit_logs_insert_policy on public.audit_logs;
create policy audit_logs_insert_policy
on public.audit_logs
for insert
to authenticated
with check (
  actor_profile_id = auth.uid()
  or public.is_admin_write_any()
);

drop policy if exists audit_logs_update_policy on public.audit_logs;
create policy audit_logs_update_policy
on public.audit_logs
for update
to authenticated
using (public.is_admin_master())
with check (public.is_admin_master());

drop policy if exists audit_logs_delete_policy on public.audit_logs;
create policy audit_logs_delete_policy
on public.audit_logs
for delete
to authenticated
using (public.is_admin_master());

-- =========================================================
-- STORAGE POLICIES - bucket: payment-proofs
-- =========================================================
-- Estrutura sugerida de caminho:
-- payment-proofs/{indicator_profile_id}/{payment_id}/{filename}
--
-- Regras:
-- - indicador: pode enviar/ler apenas comprovantes do seu próprio prefixo
-- - admin_financeiro e admin_master: leitura/escrita global
-- - admin_consulta: apenas leitura global

-- select (download/list)
drop policy if exists storage_payment_proofs_select on storage.objects;
create policy storage_payment_proofs_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    public.is_admin_read_any()
    or split_part(name, '/', 1) = auth.uid()::text
  )
);

-- insert (upload)
drop policy if exists storage_payment_proofs_insert on storage.objects;
create policy storage_payment_proofs_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-proofs'
  and (
    public.is_admin_write_any()
    or split_part(name, '/', 1) = auth.uid()::text
  )
);

-- update (replace/move)
drop policy if exists storage_payment_proofs_update on storage.objects;
create policy storage_payment_proofs_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    public.is_admin_write_any()
    or split_part(name, '/', 1) = auth.uid()::text
  )
)
with check (
  bucket_id = 'payment-proofs'
  and (
    public.is_admin_write_any()
    or split_part(name, '/', 1) = auth.uid()::text
  )
);

-- delete
drop policy if exists storage_payment_proofs_delete on storage.objects;
create policy storage_payment_proofs_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    public.is_admin_write_any()
    or split_part(name, '/', 1) = auth.uid()::text
  )
);

commit;

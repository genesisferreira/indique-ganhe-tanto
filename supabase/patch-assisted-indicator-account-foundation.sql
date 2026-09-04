-- =========================================================
-- CADASTRO ASSISTIDO — FASE 3B + HOTFIX P1
-- Conta assistida do indicador + primeiro acesso
-- =========================================================
-- Adiciona:
--   profiles.must_change_password (default false — cadastro público intacto)
--   assisted_indicator_creations (idempotência interna, sem PII/senha)
--   assisted_indicator_creations.auth_user_id (ownership da operação)
--   current_user_password_change_completed() + policies/RPC gate
--
-- NÃO altera: AUTH 1C trigger, reward/wallet lógica financeira server-side
-- (service role bypassa RLS), Controllr, Sprint 1.2.
-- Aplicável ANTES do código. Idempotente. Sem backfill.
-- Sem senha temporária persistida.

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
  auth_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'created', 'failed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint assisted_indicator_creations_idempotency_key_uidx unique (idempotency_key)
);

-- Tabelas já criadas sem auth_user_id (reexecução idempotente).
alter table public.assisted_indicator_creations
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

comment on table public.assisted_indicator_creations is
  'Idempotência de POST /api/comercial/assisted-indicators. Sem senha/PII. Acesso via service role.';

comment on column public.assisted_indicator_creations.auth_user_id is
  'Auth user criado por ESTA operação. Ownership para recovery; nunca inferir por e-mail.';

create index if not exists assisted_indicator_creations_actor_idx
  on public.assisted_indicator_creations(actor_profile_id);

create index if not exists assisted_indicator_creations_indicator_idx
  on public.assisted_indicator_creations(indicator_profile_id);

create index if not exists assisted_indicator_creations_auth_user_idx
  on public.assisted_indicator_creations(auth_user_id);

alter table public.assisted_indicator_creations enable row level security;

-- Sem policies para roles autenticados: somente service role (bypassa RLS).

-- =========================================================
-- P1-2 — Gate de autorização (must_change_password)
-- SECURITY DEFINER + search_path: lê profiles sem recursão RLS.
-- =========================================================

create or replace function public.current_user_password_change_completed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.must_change_password is not true
      from public.profiles p
      where p.id = auth.uid()
    ),
    false
  );
$$;

comment on function public.current_user_password_change_completed() is
  'True quando o usuário autenticado não tem must_change_password pendente. Deny-by-default se sem profile.';

revoke all on function public.current_user_password_change_completed() from public;
grant execute on function public.current_user_password_change_completed() to authenticated;

-- profiles: SELECT próprio permanece permitido (gate /primeiro-acesso).
-- UPDATE próprio exige senha já trocada (complete-first usa service role).
drop policy if exists profiles_update_policy on public.profiles;
create policy profiles_update_policy
on public.profiles
for update
to authenticated
using (
  (id = auth.uid() and public.current_user_password_change_completed())
  or public.is_admin_master()
)
with check (
  (id = auth.uid() and public.current_user_password_change_completed())
  or public.is_admin_master()
);

-- Pix: mutações e leitura própria bloqueadas até troca de senha.
drop policy if exists pix_keys_select_policy on public.pix_keys;
create policy pix_keys_select_policy
on public.pix_keys
for select
to authenticated
using (
  (profile_id = auth.uid() and public.current_user_password_change_completed())
  or public.is_admin_read_any()
);

drop policy if exists pix_keys_insert_policy on public.pix_keys;
create policy pix_keys_insert_policy
on public.pix_keys
for insert
to authenticated
with check (
  (profile_id = auth.uid() and public.current_user_password_change_completed())
  or public.is_admin_master()
);

drop policy if exists pix_keys_update_policy on public.pix_keys;
create policy pix_keys_update_policy
on public.pix_keys
for update
to authenticated
using (
  (profile_id = auth.uid() and public.current_user_password_change_completed())
  or public.is_admin_master()
)
with check (
  (profile_id = auth.uid() and public.current_user_password_change_completed())
  or public.is_admin_master()
);

drop policy if exists pix_keys_delete_policy on public.pix_keys;
create policy pix_keys_delete_policy
on public.pix_keys
for delete
to authenticated
using (
  (profile_id = auth.uid() and public.current_user_password_change_completed())
  or public.is_admin_master()
);

-- Referrals: indicador só lê/cria após troca de senha.
drop policy if exists referrals_select_policy on public.referrals;
create policy referrals_select_policy
on public.referrals
for select
to authenticated
using (
  (
    indicator_profile_id = auth.uid()
    and public.current_user_password_change_completed()
  )
  or commercial_profile_id = auth.uid()
  or (
    public.is_comercial()
    and commercial_profile_id is null
  )
  or public.is_admin_read_any()
);

drop policy if exists referrals_insert_policy on public.referrals;
create policy referrals_insert_policy
on public.referrals
for insert
to authenticated
with check (
  (
    indicator_profile_id = auth.uid()
    and public.current_user_password_change_completed()
  )
  or public.is_admin_master()
);

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
        (
          r.indicator_profile_id = auth.uid()
          and public.current_user_password_change_completed()
        )
        or r.commercial_profile_id = auth.uid()
      )
  )
  or public.is_admin_read_any()
);

-- Financeiro: leitura do indicador bloqueada até troca (service role intacto).
drop policy if exists rewards_select_policy on public.rewards;
create policy rewards_select_policy
on public.rewards
for select
to authenticated
using (
  (
    indicator_profile_id = auth.uid()
    and public.current_user_password_change_completed()
  )
  or public.is_admin_read_any()
);

drop policy if exists wallet_transactions_select_policy on public.wallet_transactions;
create policy wallet_transactions_select_policy
on public.wallet_transactions
for select
to authenticated
using (
  (
    indicator_profile_id = auth.uid()
    and public.current_user_password_change_completed()
  )
  or public.is_admin_read_any()
);

drop policy if exists payments_select_policy on public.payments;
create policy payments_select_policy
on public.payments
for select
to authenticated
using (
  (
    indicator_profile_id = auth.uid()
    and public.current_user_password_change_completed()
  )
  or public.is_admin_read_any()
);

-- Notificações: indicador só opera após troca.
drop policy if exists notifications_select_policy on public.notifications;
create policy notifications_select_policy
on public.notifications
for select
to authenticated
using (
  (
    profile_id = auth.uid()
    and public.current_user_password_change_completed()
  )
  or public.is_admin_read_any()
);

drop policy if exists notifications_update_policy on public.notifications;
create policy notifications_update_policy
on public.notifications
for update
to authenticated
using (
  (
    profile_id = auth.uid()
    and public.current_user_password_change_completed()
  )
  or public.is_admin_write_any()
)
with check (
  (
    profile_id = auth.uid()
    and public.current_user_password_change_completed()
  )
  or public.is_admin_write_any()
);

-- Disponibilidade comercial (leitura do indicador).
drop policy if exists commercial_availability_select_policy on public.commercial_availability;
create policy commercial_availability_select_policy
on public.commercial_availability
for select
to authenticated
using (
  commercial_profile_id = auth.uid()
  or public.is_admin_read_any()
  or (
    public.is_indicator()
    and public.current_user_password_change_completed()
    and availability_status = 'disponivel'
  )
);

-- Saque Pix (SECURITY DEFINER): gate explícito — RLS não cobre RPC.
-- Corpo alinhado a patch-notifications-pix-withdrawal.sql + check P1-2.
create or replace function public.request_pix_withdrawal(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_uid uuid := auth.uid();
  v_balance numeric(10,2);
  v_after numeric(10,2);
  v_key_value text;
  v_key_type public.pix_key_type;
  v_due timestamptz := timezone('utc', now()) + interval '30 days';
  v_payment_id uuid;
  v_reserve_tx uuid;
  v_now timestamptz := timezone('utc', now());
  v_notify_count int;
begin
  if not public.current_user_password_change_completed() then
    return jsonb_build_object(
      'ok', false,
      'code', 'PASSWORD_CHANGE_REQUIRED',
      'message', 'Defina sua nova senha antes de continuar.'
    );
  end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'indicador'::public.user_role then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Apenas indicadores podem solicitar saque Pix.');
  end if;

  if p_amount is null or p_amount < 100 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount', 'message', 'Valor mínimo para saque é R$ 100,00.');
  end if;

  v_balance := public.wallet_balance_latest(v_uid);
  if p_amount > v_balance then
    return jsonb_build_object('ok', false, 'code', 'insufficient_balance', 'message', 'Saldo disponível insuficiente para este valor.');
  end if;

  if exists (
    select 1 from public.payments x
    where x.indicator_profile_id = v_uid
      and x.payment_kind = 'pix_withdrawal'
      and x.status in ('pendente'::public.payment_status, 'aprovado'::public.payment_status)
  ) then
    return jsonb_build_object('ok', false, 'code', 'open_withdrawal_exists', 'message', 'Já existe um saque Pix pendente ou aprovado aguardando conclusão.');
  end if;

  select k.key_value, k.key_type into v_key_value, v_key_type
  from public.pix_keys k
  where k.profile_id = v_uid and k.is_primary = true
  limit 1;

  if v_key_value is null then
    return jsonb_build_object('ok', false, 'code', 'no_pix_key', 'message', 'Cadastre uma chave Pix principal antes de solicitar saque.');
  end if;

  v_after := greatest(0::numeric, v_balance - p_amount);

  insert into public.payments (
    indicator_profile_id, referral_id, reward_id, amount, reward_type,
    status, due_date, payment_kind, pix_key_snapshot, pix_key_type, notes
  )
  values (
    v_uid, null, null, p_amount, 'pix'::public.reward_type,
    'pendente'::public.payment_status, v_due, 'pix_withdrawal',
    v_key_value, v_key_type, 'Solicitação de saque Pix'
  )
  returning id into v_payment_id;

  insert into public.wallet_transactions (
    indicator_profile_id, reward_id, payment_id, transaction_type,
    amount, balance_before, balance_after, description, reference_code, created_at
  )
  values (
    v_uid, null, v_payment_id, 'saque_reserva'::public.wallet_transaction_type,
    p_amount, v_balance, v_after,
    'Reserva de saldo — saque Pix pendente',
    'pix:saque_reserva:' || v_payment_id::text,
    v_now
  )
  returning id into v_reserve_tx;

  update public.payments
  set wallet_reserve_transaction_id = v_reserve_tx, updated_at = v_now
  where id = v_payment_id;

  perform public.log_payment_audit(
    v_uid, v_payment_id, 'create'::public.audit_action, null::jsonb,
    jsonb_build_object('status', 'pendente', 'amount', p_amount, 'reserve_tx', v_reserve_tx),
    jsonb_build_object('flow', 'pix_withdrawal_request')
  );

  v_notify_count := public.notify_admins_pix_withdrawal_requested(v_payment_id, v_uid, p_amount);

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'status', 'pendente',
    'wallet_transaction_id', v_reserve_tx,
    'balance_after', v_after,
    'admin_notifications_created', v_notify_count
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'open_withdrawal_exists', 'message', 'Já existe um saque Pix em andamento.');
end;
$$;

commit;

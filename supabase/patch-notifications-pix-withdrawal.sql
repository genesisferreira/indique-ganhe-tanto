-- Notifica admin_financeiro e admin_master quando indicador solicita saque Pix.
-- OBRIGATÓRIO no Supabase SQL Editor após patch-pix-withdrawal-ledger.sql.
-- Corrige: is_active=false excluía admin; INSERT em lote sem debug.

begin;

-- Debug (reutiliza tabela do patch de indicador)
create table if not exists public.debug_notification_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  referral_id uuid,
  reward_id uuid,
  indicator_profile_id uuid,
  old_status text,
  new_status text,
  action text,
  detail jsonb not null default '{}'::jsonb,
  executed_at timestamptz not null default timezone('utc', now())
);

create index if not exists debug_notification_logs_executed_at_idx
  on public.debug_notification_logs (executed_at desc);

alter table public.debug_notification_logs enable row level security;

drop policy if exists debug_notification_logs_admin_select on public.debug_notification_logs;
create policy debug_notification_logs_admin_select
on public.debug_notification_logs
for select
to authenticated
using (public.is_admin_read_any());

create or replace function public.log_notification_debug(
  p_source text,
  p_referral_id uuid default null,
  p_indicator_profile_id uuid default null,
  p_old_status text default null,
  p_new_status text default null,
  p_action text default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.debug_notification_logs (
    source, referral_id, indicator_profile_id, old_status, new_status, action, detail
  )
  values (
    p_source, p_referral_id, p_indicator_profile_id, p_old_status, p_new_status, p_action,
    coalesce(p_detail, '{}'::jsonb)
  );
exception
  when others then
    null;
end;
$$;

drop function if exists public.notify_admins_pix_withdrawal_requested(uuid, uuid, numeric);

create or replace function public.notify_admins_pix_withdrawal_requested(
  p_payment_id uuid,
  p_indicator_profile_id uuid,
  p_amount numeric
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r_admin record;
  v_inserted int := 0;
  v_notification_id uuid;
  v_data jsonb;
begin
  if p_payment_id is null then
    return 0;
  end if;

  v_data := jsonb_build_object(
    'action', 'pix_withdrawal_requested',
    'payment_id', p_payment_id::text,
    'indicator_profile_id', coalesce(p_indicator_profile_id::text, ''),
    'amount', p_amount
  );

  for r_admin in
    select p.id as admin_profile_id, p.role, p.is_active, p.email
    from public.profiles p
    where p.role in (
      'admin_financeiro'::public.user_role,
      'admin_master'::public.user_role
    )
  loop
    perform public.log_notification_debug(
      'notify_admins_pix_withdrawal_requested',
      null,
      p_indicator_profile_id,
      null,
      null,
      'pix_withdrawal_requested',
      jsonb_build_object(
        'payment_id', p_payment_id::text,
        'admin_profile_id', r_admin.admin_profile_id,
        'admin_role', r_admin.role::text,
        'admin_email', r_admin.email,
        'admin_is_active', r_admin.is_active,
        'phase', 'candidate'
      )
    );

    -- Não excluir admin com is_active null/false por engano de seed; só pula se explicitamente false
    if r_admin.is_active is false then
      perform public.log_notification_debug(
        'notify_admins_pix_withdrawal_requested',
        null,
        p_indicator_profile_id,
        null, null, 'skipped_inactive',
        jsonb_build_object(
          'payment_id', p_payment_id::text,
          'admin_profile_id', r_admin.admin_profile_id
        )
      );
      continue;
    end if;

    if exists (
      select 1
      from public.notifications n
      where n.profile_id = r_admin.admin_profile_id
        and n.data->>'action' = 'pix_withdrawal_requested'
        and n.data->>'payment_id' = p_payment_id::text
    ) then
      perform public.log_notification_debug(
        'notify_admins_pix_withdrawal_requested',
        null,
        p_indicator_profile_id,
        null, null, 'skipped_idempotent',
        jsonb_build_object(
          'payment_id', p_payment_id::text,
          'admin_profile_id', r_admin.admin_profile_id
        )
      );
      continue;
    end if;

    insert into public.notifications (
      profile_id,
      notification_type,
      title,
      message,
      data,
      is_read,
      action_url
    )
    values (
      r_admin.admin_profile_id,
      'pagamento'::public.notification_type,
      'Novo saque Pix solicitado',
      'Um indicador solicitou um saque Pix para análise.',
      v_data,
      false,
      '/admin/pagamentos-pendentes'
    )
    returning id into v_notification_id;

    v_inserted := v_inserted + 1;

    perform public.log_notification_debug(
      'notify_admins_pix_withdrawal_requested',
      null,
      p_indicator_profile_id,
      null, null, 'inserted',
      jsonb_build_object(
        'payment_id', p_payment_id::text,
        'admin_profile_id', r_admin.admin_profile_id,
        'notification_id', v_notification_id,
        'notification_type', 'pagamento'
      )
    );
  end loop;

  perform public.log_notification_debug(
    'notify_admins_pix_withdrawal_requested',
    null,
    p_indicator_profile_id,
    null, null, 'summary',
    jsonb_build_object(
      'payment_id', p_payment_id::text,
      'inserted_count', v_inserted
    )
  );

  return v_inserted;
exception
  when others then
    perform public.log_notification_debug(
      'notify_admins_pix_withdrawal_requested',
      null,
      p_indicator_profile_id,
      null, null, 'error',
      jsonb_build_object(
        'payment_id', p_payment_id::text,
        'sqlstate', sqlstate,
        'message', sqlerrm
      )
    );
    return v_inserted;
end;
$$;

revoke all on function public.notify_admins_pix_withdrawal_requested(uuid, uuid, numeric) from public;
grant execute on function public.notify_admins_pix_withdrawal_requested(uuid, uuid, numeric) to authenticated;

-- request_pix_withdrawal (versão ledger)
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

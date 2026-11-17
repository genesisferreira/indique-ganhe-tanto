-- 3.1F-J15D: o cron pode criar o reward pendente pelo valor da regra.
-- Não credita fatura, não paga PIX e não altera comissão fixa.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.ensure_referral_reward(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_ref public.referrals%rowtype;
  v_reward_id uuid;
  v_amount numeric(10,2);
  v_sync boolean := current_user = 'service_role' and v_uid is null;
begin
  select p.role into v_role from public.profiles p where p.id = v_uid and coalesce(p.is_active, true);

  if not v_sync and (v_role is null or v_role not in ('admin_master', 'admin_financeiro', 'comercial')) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select * into v_ref from public.referrals where id = p_referral_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'referral_not_found');
  end if;

  if v_role = 'comercial' and v_ref.commercial_profile_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_ref.origin_kind in ('employee', 'partner_merchant')
     or not public.referral_is_financially_eligible(v_ref) then
    perform public.log_financial_security_event(
      'reward_creation_blocked', p_referral_id,
      case
        when v_ref.origin_kind = 'employee' then 'employee_origin'
        when v_ref.origin_kind = 'partner_merchant' then 'partner_origin'
        else 'not_reward_eligible'
      end,
      jsonb_build_object('origin_kind', v_ref.origin_kind, 'rpc', 'ensure_referral_reward')
    );
    return jsonb_build_object('ok', false, 'code', 'not_reward_eligible');
  end if;

  select r.id into v_reward_id from public.rewards r where r.referral_id = p_referral_id
  order by r.created_at asc limit 1;
  if v_reward_id is not null then
    return jsonb_build_object('ok', true, 'created', false, 'reward_id', v_reward_id);
  end if;

  v_amount := v_ref.reward_amount;
  if v_sync and (v_amount is null or v_amount <= 0) then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;
  v_amount := coalesce(v_amount, 0);
  if v_amount < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;

  insert into public.rewards (referral_id, indicator_profile_id, amount, reward_type, status, available_at, paid_at)
  values (
    p_referral_id,
    v_ref.indicator_profile_id,
    v_amount,
    case when v_ref.reward_type = 'desconto_fatura' then 'desconto_fatura'::public.reward_type else 'pix'::public.reward_type end,
    'pendente'::public.reward_status,
    null,
    null
  )
  on conflict (referral_id) do nothing
  returning id into v_reward_id;

  if v_reward_id is null then
    select r.id into v_reward_id from public.rewards r where r.referral_id = p_referral_id;
    return jsonb_build_object('ok', true, 'created', false, 'reward_id', v_reward_id);
  end if;

  perform public.log_financial_security_event(
    'reward_rpc_executed', p_referral_id, 'reward_created_pending',
    jsonb_build_object('rpc', 'ensure_referral_reward', 'origin_kind', v_ref.origin_kind, 'source', 'program_plan_rule')
  );

  return jsonb_build_object('ok', true, 'created', true, 'reward_id', v_reward_id);
end;
$$;

revoke all on function public.ensure_referral_reward(uuid) from public, anon;
grant execute on function public.ensure_referral_reward(uuid) to authenticated, service_role;

create or replace function public.notify_first_automatic_indicator_reward(
  p_referral_id uuid,
  p_contract_pk text,
  p_invoice_pk text,
  p_rule_version text,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if current_user is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select count(*) into v_count
  from public.wallet_transactions wt
  where wt.transaction_type = 'credito'
    and wt.reference_code like 'indicator_first_invoice_credit:%';

  if v_count is distinct from 1 then
    return jsonb_build_object('ok', true, 'alerted', false);
  end if;

  insert into public.notifications (
    profile_id, notification_type, title, message, data, is_read, action_url
  )
  select p.id,
         'recompensa',
         'Primeiro reward automático',
         'O Indique e Ganhe liberou o primeiro reward automático pela data de crédito.',
         jsonb_build_object(
           'result', 'created',
           'credit_key_type', 'indicator_first_invoice_credit',
           'referral_mask', substr(md5(p_referral_id::text), 1, 6),
           'contract_pk', p_contract_pk,
           'invoice_pk', p_invoice_pk,
           'rule_version', p_rule_version,
           'reward_amount', p_amount
         ),
         false,
         '/admin'
  from public.profiles p
  where p.role in ('admin_master', 'admin_financeiro')
    and coalesce(p.is_active, true);

  return jsonb_build_object('ok', true, 'alerted', true);
end;
$$;

revoke all on function public.notify_first_automatic_indicator_reward(uuid, text, text, text, numeric) from public, anon, authenticated;
grant execute on function public.notify_first_automatic_indicator_reward(uuid, text, text, text, numeric) to service_role;

create or replace function public.mark_first_invoice_paid_from_sync(
  p_referral_id uuid,
  p_paid_at timestamp with time zone default null,
  p_external_reference text default null,
  p_payload jsonb default '{}'::jsonb,
  p_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
  v_reward public.rewards%rowtype;
  v_balance_before numeric(10, 2);
  v_balance_after numeric(10, 2);
  v_now timestamptz := coalesce(p_paid_at, timezone('utc', now()));
  v_tx_id uuid;
  v_existing_tx_id uuid;
  v_existing_balance_after numeric(10, 2);
  v_snapshot_id uuid;
  v_credit_amount numeric(10, 2);
begin
  select * into v_ref
  from public.referrals
  where id = p_referral_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'referral_not_found',
      'message', 'Indicação não encontrada.',
      'source', 'mark_first_invoice_paid_from_sync'
    );
  end if;

  if v_ref.origin_kind in ('employee', 'partner_merchant')
     or not public.referral_is_financially_eligible(v_ref) then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_reward_eligible',
      'message', 'Registro sem elegibilidade financeira.',
      'source', 'mark_first_invoice_paid_from_sync'
    );
  end if;

  if nullif(trim(coalesce(p_external_reference, '')), '') is not null then
    insert into public.brbyte_payment_snapshots (
      referral_id, brbyte_id_contrato, external_reference, valor,
      paid_detected, paid_at, source_endpoint, raw_payload
    )
    values (
      p_referral_id, v_ref.brbyte_id_contrato, trim(p_external_reference),
      v_ref.reward_amount, true, v_now, 'mark_first_invoice_paid_from_sync',
      coalesce(p_payload, '{}'::jsonb)
    )
    on conflict (referral_id, external_reference)
    where external_reference is not null
    do update set
      paid_detected = true,
      paid_at = excluded.paid_at,
      valor = coalesce(excluded.valor, public.brbyte_payment_snapshots.valor),
      raw_payload = excluded.raw_payload,
      source_endpoint = excluded.source_endpoint
    returning id into v_snapshot_id;
  elsif nullif(trim(coalesce(p_payload->>'periodo', '')), '') is not null then
    insert into public.brbyte_payment_snapshots (
      referral_id, brbyte_id_contrato, periodo, valor,
      paid_detected, paid_at, source_endpoint, raw_payload
    )
    values (
      p_referral_id, v_ref.brbyte_id_contrato, trim(p_payload->>'periodo'),
      v_ref.reward_amount, true, v_now, 'mark_first_invoice_paid_from_sync',
      coalesce(p_payload, '{}'::jsonb)
    )
    on conflict (referral_id, periodo)
    where periodo is not null and external_reference is null
    do update set
      paid_detected = true,
      paid_at = excluded.paid_at,
      valor = coalesce(excluded.valor, public.brbyte_payment_snapshots.valor),
      raw_payload = excluded.raw_payload,
      source_endpoint = excluded.source_endpoint
    returning id into v_snapshot_id;
  else
    insert into public.brbyte_payment_snapshots (
      referral_id, brbyte_id_contrato, valor,
      paid_detected, paid_at, source_endpoint, raw_payload
    )
    values (
      p_referral_id, v_ref.brbyte_id_contrato, v_ref.reward_amount,
      true, v_now, 'mark_first_invoice_paid_from_sync',
      coalesce(p_payload, '{}'::jsonb)
    )
    returning id into v_snapshot_id;
  end if;

  if v_ref.first_invoice_paid then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'code', 'already_paid',
      'referral_id', p_referral_id, 'snapshot_id', v_snapshot_id,
      'message', 'Primeira mensalidade já confirmada.',
      'source', 'mark_first_invoice_paid_from_sync'
    );
  end if;

  select * into v_reward
  from public.rewards
  where referral_id = p_referral_id
  for update;

  v_credit_amount := v_ref.reward_amount;

  if not found then
    if v_credit_amount is null or v_credit_amount <= 0 then
      raise exception 'invalid_amount' using errcode = 'P0001';
    end if;

    insert into public.rewards (
      referral_id, indicator_profile_id, amount, reward_type, status, available_at, paid_at
    )
    values (
      p_referral_id,
      v_ref.indicator_profile_id,
      v_credit_amount,
      case when v_ref.reward_type = 'desconto_fatura' then 'desconto_fatura'::public.reward_type else 'pix'::public.reward_type end,
      'pendente'::public.reward_status,
      null,
      null
    )
    returning * into v_reward;
  elsif v_credit_amount is null or v_credit_amount <= 0 then
    v_credit_amount := v_reward.amount;
  end if;

  select wt.id, wt.balance_after
  into v_existing_tx_id, v_existing_balance_after
  from public.wallet_transactions wt
  where wt.reward_id = v_reward.id
    and wt.transaction_type = 'credito'::public.wallet_transaction_type
  order by wt.created_at desc, wt.id desc
  limit 1;

  if v_existing_tx_id is not null then
    update public.referrals
    set first_invoice_paid = true,
        first_invoice_paid_at = coalesce(v_ref.first_invoice_paid_at, v_now),
        updated_at = v_now
    where id = p_referral_id;

    update public.rewards
    set status = 'disponivel'::public.reward_status,
        available_at = coalesce(v_reward.available_at, v_now),
        updated_at = v_now
    where id = v_reward.id;

    perform public.notify_indicator_reward_released(p_referral_id);

    return jsonb_build_object(
      'ok', true, 'idempotent', true,
      'referral_id', p_referral_id, 'reward_id', v_reward.id,
      'transaction_id', v_existing_tx_id,
      'balance_after', coalesce(v_existing_balance_after, 0),
      'snapshot_id', v_snapshot_id, 'amount', v_reward.amount,
      'source', 'mark_first_invoice_paid_from_sync'
    );
  end if;

  if v_reward.status is distinct from 'pendente'::public.reward_status then
    raise exception 'reward_not_pending' using errcode = 'P0001';
  end if;

  if v_credit_amount is null or v_credit_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  select wt.balance_after into v_balance_before
  from public.wallet_transactions wt
  where wt.indicator_profile_id = v_ref.indicator_profile_id
  order by wt.created_at desc, wt.id desc
  limit 1;

  if v_balance_before is null then
    v_balance_before := 0;
  end if;

  v_balance_after := greatest(0::numeric, v_balance_before + v_credit_amount);

  update public.referrals
  set first_invoice_paid = true,
      first_invoice_paid_at = v_now,
      reward_amount = v_credit_amount,
      updated_at = v_now
  where id = p_referral_id;

  update public.rewards
  set amount = v_credit_amount,
      status = 'disponivel'::public.reward_status,
      available_at = v_now,
      updated_at = v_now
  where id = v_reward.id;

  insert into public.wallet_transactions (
    indicator_profile_id, reward_id, payment_id, transaction_type,
    amount, balance_before, balance_after, description, reference_code, created_at
  )
  values (
    v_ref.indicator_profile_id, v_reward.id, null,
    'credito'::public.wallet_transaction_type,
    v_credit_amount, v_balance_before, v_balance_after,
    'Recompensa liberada via sync BRByte (primeira mensalidade)',
    coalesce(nullif(trim(p_external_reference), ''), p_referral_id::text),
    v_now
  )
  returning id into v_tx_id;

  perform public.notify_indicator_reward_released(p_referral_id);

  return jsonb_build_object(
    'ok', true, 'idempotent', false,
    'referral_id', p_referral_id, 'reward_id', v_reward.id,
    'transaction_id', v_tx_id, 'balance_after', v_balance_after,
    'snapshot_id', v_snapshot_id, 'amount', v_credit_amount,
    'source', 'mark_first_invoice_paid_from_sync'
  );
exception
  when unique_violation then
    if v_reward.id is null then
      select * into v_reward from public.rewards where referral_id = p_referral_id;
    end if;

    select wt.id, wt.balance_after
    into v_existing_tx_id, v_existing_balance_after
    from public.wallet_transactions wt
    where wt.reward_id = v_reward.id
      and wt.transaction_type = 'credito'::public.wallet_transaction_type
    order by wt.created_at desc, wt.id desc
    limit 1;

    if v_existing_tx_id is not null then
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'referral_id', p_referral_id, 'reward_id', v_reward.id,
        'transaction_id', v_existing_tx_id,
        'balance_after', coalesce(v_existing_balance_after, 0),
        'source', 'mark_first_invoice_paid_from_sync'
      );
    end if;

    return jsonb_build_object(
      'ok', false, 'code', 'already_released',
      'message', 'Crédito de carteira já existente para esta recompensa.',
      'source', 'mark_first_invoice_paid_from_sync'
    );
  when others then
    if sqlstate = 'P0001' and sqlerrm in ('invalid_amount', 'reward_not_pending') then
      return jsonb_build_object(
        'ok', false,
        'code', sqlerrm,
        'message', 'Valor da regra do Indique e Ganhe ausente ou recompensa fora do estado pendente.',
        'source', 'mark_first_invoice_paid_from_sync'
      );
    end if;
    raise;
end;
$$;

commit;

-- ============================================================
-- Recompensa pela 1ª fatura Controllr (valor real pago)
-- ============================================================
-- Substitui mark_first_invoice_paid_from_sync para:
-- 1) Aceitar p_amount (valor da fatura: invoice_amount_paid / document)
-- 2) Bloquear pré-cadastro / reward_eligible=false / sem indicador
-- 3) Atualizar rewards.amount com o valor da fatura ANTES do crédito
--    (somente se ainda pendente e sem wallet_transaction)
-- 4) Preservar idempotência e registros já pagosados (sem recálculo)
--
-- Aplicar no Supabase SQL Editor após deploy do app.
-- Não executa backfill financeiro.
-- ============================================================

begin;

drop function if exists public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb);
drop function if exists public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb, numeric);

create or replace function public.mark_first_invoice_paid_from_sync(
  p_referral_id uuid,
  p_paid_at timestamptz default null,
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

  -- Auditoria / snapshot (idempotente por external_reference ou periodo)
  if nullif(trim(coalesce(p_external_reference, '')), '') is not null then
    insert into public.brbyte_payment_snapshots (
      referral_id,
      brbyte_id_contrato,
      external_reference,
      valor,
      paid_detected,
      paid_at,
      source_endpoint,
      raw_payload
    )
    values (
      p_referral_id,
      v_ref.brbyte_id_contrato,
      trim(p_external_reference),
      case when p_amount is not null and p_amount > 0 then p_amount else null end,
      true,
      v_now,
      'mark_first_invoice_paid_from_sync',
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
      referral_id,
      brbyte_id_contrato,
      periodo,
      valor,
      paid_detected,
      paid_at,
      source_endpoint,
      raw_payload
    )
    values (
      p_referral_id,
      v_ref.brbyte_id_contrato,
      trim(p_payload->>'periodo'),
      case when p_amount is not null and p_amount > 0 then p_amount else null end,
      true,
      v_now,
      'mark_first_invoice_paid_from_sync',
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
      referral_id,
      brbyte_id_contrato,
      valor,
      paid_detected,
      paid_at,
      source_endpoint,
      raw_payload
    )
    values (
      p_referral_id,
      v_ref.brbyte_id_contrato,
      case when p_amount is not null and p_amount > 0 then p_amount else null end,
      true,
      v_now,
      'mark_first_invoice_paid_from_sync',
      coalesce(p_payload, '{}'::jsonb)
    )
    returning id into v_snapshot_id;
  end if;

  -- Já confirmado: não recalcula valor histórico
  if v_ref.first_invoice_paid then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'already_paid',
      'referral_id', p_referral_id,
      'snapshot_id', v_snapshot_id,
      'message', 'Primeira mensalidade já confirmada.',
      'source', 'mark_first_invoice_paid_from_sync'
    );
  end if;

  -- Guardas: pré-cadastro / inelegível nunca credita carteira
  if coalesce(v_ref.reward_eligible, true) = false
     or coalesce(v_ref.source, '') = 'public_pre_registration'
     or coalesce(v_ref.erp_lead_source, '') = 'Pré-cadastro Web'
     or v_ref.indicator_profile_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_reward_eligible',
      'message', 'Registro sem elegibilidade financeira (pré-cadastro ou sem indicador).',
      'snapshot_id', v_snapshot_id,
      'source', 'mark_first_invoice_paid_from_sync'
    );
  end if;

  select * into v_reward
  from public.rewards
  where referral_id = p_referral_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'reward_not_found',
      'message', 'Não há recompensa vinculada a esta indicação.',
      'snapshot_id', v_snapshot_id,
      'source', 'mark_first_invoice_paid_from_sync'
    );
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
    set
      first_invoice_paid = true,
      first_invoice_paid_at = coalesce(v_ref.first_invoice_paid_at, v_now),
      updated_at = v_now
    where id = p_referral_id;

    update public.rewards
    set
      status = 'disponivel'::public.reward_status,
      available_at = coalesce(v_reward.available_at, v_now),
      updated_at = v_now
    where id = v_reward.id;

    perform public.notify_indicator_reward_released(p_referral_id);

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'referral_id', p_referral_id,
      'reward_id', v_reward.id,
      'transaction_id', v_existing_tx_id,
      'balance_after', coalesce(v_existing_balance_after, 0),
      'snapshot_id', v_snapshot_id,
      'amount', v_reward.amount,
      'source', 'mark_first_invoice_paid_from_sync'
    );
  end if;

  if v_reward.status is distinct from 'pendente'::public.reward_status then
    return jsonb_build_object(
      'ok', false,
      'code', 'reward_not_pending',
      'message', format('Recompensa não pendente (status: %s).', v_reward.status::text),
      'snapshot_id', v_snapshot_id,
      'source', 'mark_first_invoice_paid_from_sync'
    );
  end if;

  -- Aplica valor confirmado da 1ª fatura (não usa public_offer_price / plans.reward_amount)
  if p_amount is not null and p_amount > 0 then
    update public.rewards
    set
      amount = p_amount,
      updated_at = v_now
    where id = v_reward.id;

    update public.referrals
    set
      reward_amount = p_amount,
      updated_at = v_now
    where id = p_referral_id;

    v_credit_amount := p_amount;
  else
    v_credit_amount := v_reward.amount;
  end if;

  if v_credit_amount is null or v_credit_amount <= 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_amount',
      'message', 'Valor da primeira fatura inválido ou ausente.',
      'snapshot_id', v_snapshot_id,
      'source', 'mark_first_invoice_paid_from_sync'
    );
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
  set
    first_invoice_paid = true,
    first_invoice_paid_at = v_now,
    reward_amount = v_credit_amount,
    updated_at = v_now
  where id = p_referral_id;

  update public.rewards
  set
    amount = v_credit_amount,
    status = 'disponivel'::public.reward_status,
    available_at = v_now,
    updated_at = v_now
  where id = v_reward.id;

  insert into public.wallet_transactions (
    indicator_profile_id,
    reward_id,
    payment_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description,
    reference_code,
    created_at
  )
  values (
    v_ref.indicator_profile_id,
    v_reward.id,
    null,
    'credito'::public.wallet_transaction_type,
    v_credit_amount,
    v_balance_before,
    v_balance_after,
    'Recompensa liberada via sync BRByte (primeira mensalidade)',
    coalesce(nullif(trim(p_external_reference), ''), p_referral_id::text),
    v_now
  )
  returning id into v_tx_id;

  perform public.notify_indicator_reward_released(p_referral_id);

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'referral_id', p_referral_id,
    'reward_id', v_reward.id,
    'transaction_id', v_tx_id,
    'balance_after', v_balance_after,
    'snapshot_id', v_snapshot_id,
    'amount', v_credit_amount,
    'source', 'mark_first_invoice_paid_from_sync'
  );
exception
  when unique_violation then
    select wt.id, wt.balance_after
    into v_existing_tx_id, v_existing_balance_after
    from public.wallet_transactions wt
    where wt.reward_id = v_reward.id
      and wt.transaction_type = 'credito'::public.wallet_transaction_type
    order by wt.created_at desc, wt.id desc
    limit 1;

    if v_existing_tx_id is not null then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'referral_id', p_referral_id,
        'reward_id', v_reward.id,
        'transaction_id', v_existing_tx_id,
        'balance_after', coalesce(v_existing_balance_after, 0),
        'source', 'mark_first_invoice_paid_from_sync'
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'code', 'already_released',
      'message', 'Crédito de carteira já existente para esta recompensa.',
      'source', 'mark_first_invoice_paid_from_sync'
    );
end;
$$;

comment on function public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb, numeric) is
  'Confirma 1ª mensalidade via Controllr. Credita wallet com p_amount (valor real da fatura). Bloqueia pré-cadastro.';

revoke all on function public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb, numeric) from public;
revoke all on function public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb, numeric) from authenticated;
revoke all on function public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb, numeric) from anon;
grant execute on function public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb, numeric) to service_role;

commit;

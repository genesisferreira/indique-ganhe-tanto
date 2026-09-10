-- Sprint 1.2R-D — defesa em profundidade financeira
--
-- Objetivo:
--   Nenhuma referral inelegível (reward_eligible=false, pré-cadastro web,
--   Rede Neutra, sem indicador) pode criar reward nem crédito de wallet,
--   independentemente do caller.
--
-- Não revoga GRANT authenticated de mark_first_invoice_paid
-- (UI admin/comercial legítima).
-- Não altera GRANT de mark_first_invoice_paid_from_sync (service_role).
-- Não executa DML em clientes/rewards/wallet.
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS do trigger novo.

begin;

-- ============================================================
-- Helper compartilhado (espelha isReferralRewardEligible no app)
-- ============================================================
create or replace function public.referral_is_financially_eligible(p_ref public.referrals)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    coalesce(p_ref.reward_eligible, true) is not false
    and coalesce(p_ref.source, '') not in (
      'public_pre_registration',
      'neutral_network_pre_registration'
    )
    and coalesce(p_ref.erp_lead_source, '') not in (
      'Pré-cadastro Web',
      'Pré-cadastro Rede Neutra'
    )
    and p_ref.indicator_profile_id is not null;
$$;

comment on function public.referral_is_financially_eligible(public.referrals) is
  'Elegibilidade financeira: reward_eligible, source, erp_lead_source e indicador. Sprint 1.2R-D.';

revoke all on function public.referral_is_financially_eligible(public.referrals) from public;
revoke all on function public.referral_is_financially_eligible(public.referrals) from anon;
revoke all on function public.referral_is_financially_eligible(public.referrals) from authenticated;
grant execute on function public.referral_is_financially_eligible(public.referrals) to service_role;

-- ============================================================
-- Trigger: INSERT/UPDATE de rewards não ignora elegibilidade
-- Beneficiário é sempre referrals.indicator_profile_id
-- ============================================================
create or replace function public.trg_rewards_enforce_financial_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
begin
  if NEW.referral_id is null then
    raise exception 'not_reward_eligible: referral_id ausente'
      using errcode = 'P0001';
  end if;

  select * into v_ref
  from public.referrals
  where id = NEW.referral_id
  for share;

  if not found then
    raise exception 'not_reward_eligible: indicação não encontrada'
      using errcode = 'P0001';
  end if;

  if not public.referral_is_financially_eligible(v_ref) then
    raise exception 'not_reward_eligible: referral inelegível para recompensa'
      using errcode = 'P0001';
  end if;

  NEW.indicator_profile_id := v_ref.indicator_profile_id;
  return NEW;
end;
$$;

comment on function public.trg_rewards_enforce_financial_eligibility() is
  'Bloqueia reward em referral inelegível e força beneficiário = indicator_profile_id. Sprint 1.2R-D.';

drop trigger if exists trg_rewards_enforce_financial_eligibility on public.rewards;
create trigger trg_rewards_enforce_financial_eligibility
before insert or update of referral_id, indicator_profile_id
on public.rewards
for each row
execute function public.trg_rewards_enforce_financial_eligibility();

-- ============================================================
-- mark_first_invoice_paid (manual UI)
-- Preserva auth.uid + role + comercial atribuído.
-- Acrescenta elegibilidade, idempotência unique_violation e notify.
-- SEM GRANT/REVOKE nesta função.
-- ============================================================
create or replace function public.mark_first_invoice_paid(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_ref public.referrals%rowtype;
  v_reward public.rewards%rowtype;
  v_balance_before numeric(10,2);
  v_balance_after numeric(10,2);
  v_now timestamptz := timezone('utc', now());
  v_tx_id uuid;
  v_existing_tx_id uuid;
  v_existing_balance_after numeric(10,2);
begin
  select p.role into v_role
  from public.profiles p
  where p.id = auth.uid();

  if v_role is null or v_role not in ('admin_financeiro', 'admin_master', 'comercial') then
    return jsonb_build_object(
      'ok', false,
      'code', 'forbidden',
      'message', 'Sem permissão para confirmar a primeira mensalidade.'
    );
  end if;

  select * into v_ref
  from public.referrals
  where id = p_referral_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'referral_not_found',
      'message', 'Indicação não encontrada.'
    );
  end if;

  if v_role = 'comercial' and v_ref.commercial_profile_id is distinct from auth.uid() then
    return jsonb_build_object(
      'ok', false,
      'code', 'forbidden',
      'message', 'Apenas o comercial atribuído pode confirmar a primeira mensalidade.'
    );
  end if;

  if not public.referral_is_financially_eligible(v_ref) then
    return jsonb_build_object(
      'ok', false,
      'code', 'not_reward_eligible',
      'message', 'Registro sem elegibilidade financeira (pré-cadastro ou sem indicador).'
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
      'message', 'Não há recompensa vinculada a esta indicação. Verifique se o lead foi marcado como vendido.'
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

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'referral_id', p_referral_id,
      'reward_id', v_reward.id,
      'transaction_id', v_existing_tx_id,
      'balance_after', coalesce(v_existing_balance_after, 0)
    );
  end if;

  if v_ref.first_invoice_paid then
    return jsonb_build_object(
      'ok', false,
      'code', 'already_paid',
      'message', 'A primeira mensalidade deste cliente já foi confirmada.'
    );
  end if;

  if v_reward.status is distinct from 'pendente'::public.reward_status then
    return jsonb_build_object(
      'ok', false,
      'code', 'reward_not_pending',
      'message', format('A recompensa não está pendente (status atual: %s).', v_reward.status::text)
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

  v_balance_after := greatest(0::numeric, v_balance_before + v_reward.amount);

  update public.referrals
  set
    first_invoice_paid = true,
    first_invoice_paid_at = v_now,
    updated_at = v_now
  where id = p_referral_id;

  update public.rewards
  set
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
    v_reward.amount,
    v_balance_before,
    v_balance_after,
    'Recompensa liberada após pagamento da primeira mensalidade',
    p_referral_id::text,
    v_now
  )
  returning id into v_tx_id;

  perform public.notify_indicator_reward_released(p_referral_id);

  perform public.log_notification_debug(
    'mark_first_invoice_paid',
    p_referral_id,
    v_ref.indicator_profile_id,
    'pendente',
    'disponivel',
    'reward_released',
    jsonb_build_object(
      'reward_id', v_reward.id,
      'transaction_id', v_tx_id,
      'balance_after', v_balance_after
    )
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'referral_id', p_referral_id,
    'reward_id', v_reward.id,
    'transaction_id', v_tx_id,
    'balance_after', v_balance_after
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
        'balance_after', coalesce(v_existing_balance_after, 0)
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'code', 'already_released',
      'message', 'Esta recompensa já gerou crédito na carteira.'
    );
end;
$$;

comment on function public.mark_first_invoice_paid(uuid) is
  'Confirma 1ª mensalidade (UI). auth.uid+role+ownership. Bloqueia inelegíveis. Idempotente. Sprint 1.2R-D.';

-- ============================================================
-- mark_first_invoice_paid_from_sync
-- Mesma semântica financeira; guarda Rede Neutra via helper.
-- SEM GRANT/REVOKE nesta função.
-- ============================================================
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

  if not public.referral_is_financially_eligible(v_ref) then
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
  'Confirma 1ª mensalidade via Controllr. Credita wallet com p_amount. Bloqueia inelegíveis incl. Rede Neutra. Sprint 1.2R-D.';

commit;

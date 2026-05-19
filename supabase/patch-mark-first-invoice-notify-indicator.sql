-- Chama notify_indicator_reward_released ao final de mark_first_invoice_paid (redundante com trigger, idempotente).
-- Aplicar APÓS patch-first-invoice-comercial.sql (ou first-invoice-paid.sql equivalente).

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

  if v_ref.first_invoice_paid then
    return jsonb_build_object(
      'ok', false,
      'code', 'already_paid',
      'message', 'A primeira mensalidade deste cliente já foi confirmada.'
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

  if v_reward.status is distinct from 'pendente'::public.reward_status then
    return jsonb_build_object(
      'ok', false,
      'code', 'reward_not_pending',
      'message', format('A recompensa não está pendente (status atual: %s).', v_reward.status::text)
    );
  end if;

  if exists (
    select 1
    from public.wallet_transactions wt
    where wt.reward_id = v_reward.id
      and wt.transaction_type = 'credito'::public.wallet_transaction_type
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'already_released',
      'message', 'Esta recompensa já gerou crédito na carteira.'
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

  v_balance_after := v_balance_before + v_reward.amount;

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

  -- Garante notificação mesmo se trigger rewards não existir
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
    'referral_id', p_referral_id,
    'reward_id', v_reward.id,
    'transaction_id', v_tx_id,
    'balance_after', v_balance_after
  );
end;
$$;

grant execute on function public.mark_first_invoice_paid(uuid) to authenticated;

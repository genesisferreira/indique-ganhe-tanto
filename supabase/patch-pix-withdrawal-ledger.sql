-- Ledger de saque Pix: reserva na solicitação, reversão na rejeição, débito idempotente na conclusão
-- Aplicar após supabase/pix-withdrawal-flow.sql

begin;

-- Tipos de lançamento padronizados (PG 15+)
alter type public.wallet_transaction_type add value if not exists 'saque_reserva';
alter type public.wallet_transaction_type add value if not exists 'reversao_saque';

alter table public.payments
  add column if not exists wallet_reserve_transaction_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_wallet_reserve_tx_fkey'
  ) then
    alter table public.payments
      add constraint payments_wallet_reserve_tx_fkey
      foreign key (wallet_reserve_transaction_id)
      references public.wallet_transactions(id)
      on delete set null;
  end if;
end$$;

-- Uma reserva por payment Pix
create unique index if not exists wallet_transactions_one_reserve_per_payment_idx
  on public.wallet_transactions (payment_id)
  where payment_id is not null
    and transaction_type = 'saque_reserva'::public.wallet_transaction_type;

-- Um débito definitivo (saque) por payment Pix
create unique index if not exists wallet_transactions_one_saque_per_payment_idx
  on public.wallet_transactions (payment_id)
  where payment_id is not null
    and transaction_type = 'saque'::public.wallet_transaction_type;

-- Uma reversão por payment Pix
create unique index if not exists wallet_transactions_one_reversal_per_payment_idx
  on public.wallet_transactions (payment_id)
  where payment_id is not null
    and transaction_type = 'reversao_saque'::public.wallet_transaction_type;

-- Um open withdrawal por indicador (pendente ou aprovado aguardando conclusão)
create unique index if not exists payments_one_open_pix_withdrawal_per_indicator_idx
  on public.payments (indicator_profile_id)
  where payment_kind = 'pix_withdrawal'
    and status in ('pendente'::public.payment_status, 'aprovado'::public.payment_status);

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

  return jsonb_build_object(
    'ok', true, 'payment_id', v_payment_id, 'status', 'pendente',
    'wallet_transaction_id', v_reserve_tx, 'balance_after', v_after
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'open_withdrawal_exists', 'message', 'Já existe um saque Pix em andamento.');
end;
$$;

create or replace function public.approve_pix_withdrawal(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_row public.payments%rowtype;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('admin_financeiro'::public.user_role, 'admin_master'::public.user_role) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Apenas administradores financeiros ou master podem aprovar saques.');
  end if;

  select * into v_row from public.payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Pagamento não encontrado.');
  end if;

  if v_row.payment_kind is distinct from 'pix_withdrawal' then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind', 'message', 'Este registro não é um saque Pix.');
  end if;

  if v_row.status = 'aprovado'::public.payment_status then
    return jsonb_build_object('ok', true, 'idempotent', true, 'payment_id', p_payment_id, 'status', 'aprovado');
  end if;

  if v_row.status = 'pago'::public.payment_status then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'message', 'Saque já foi concluído.');
  end if;

  if v_row.status is distinct from 'pendente'::public.payment_status then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'message', format('Status atual não permite aprovação (%s).', v_row.status::text));
  end if;

  update public.payments
  set status = 'aprovado'::public.payment_status, approved_by_profile_id = auth.uid(), updated_at = timezone('utc', now())
  where id = p_payment_id;

  perform public.log_payment_audit(
    v_row.indicator_profile_id, p_payment_id, 'approve'::public.audit_action,
    jsonb_build_object('status', 'pendente'),
    jsonb_build_object('status', 'aprovado', 'approved_by', auth.uid()::text),
    jsonb_build_object('flow', 'pix_withdrawal_approve')
  );

  return jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'status', 'aprovado');
end;
$$;

create or replace function public.reject_pix_withdrawal(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_row public.payments%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_bb numeric(10,2);
  v_after numeric(10,2);
  v_reversal_tx uuid;
  v_now timestamptz := timezone('utc', now());
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('admin_financeiro'::public.user_role, 'admin_master'::public.user_role) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Apenas administradores financeiros ou master podem rejeitar saques.');
  end if;

  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'Informe o motivo da rejeição.');
  end if;

  select * into v_row from public.payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Pagamento não encontrado.');
  end if;

  if v_row.payment_kind is distinct from 'pix_withdrawal' then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind', 'message', 'Este registro não é um saque Pix.');
  end if;

  if v_row.status = 'rejeitado'::public.payment_status then
    return jsonb_build_object('ok', true, 'idempotent', true, 'payment_id', p_payment_id, 'status', 'rejeitado');
  end if;

  if v_row.status is distinct from 'pendente'::public.payment_status then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'message', 'Só é possível rejeitar solicitações pendentes.');
  end if;

  if v_row.wallet_reserve_transaction_id is not null
     and not exists (
       select 1 from public.wallet_transactions wt
       where wt.payment_id = p_payment_id
         and wt.transaction_type = 'reversao_saque'::public.wallet_transaction_type
     )
  then
    v_bb := public.wallet_balance_latest(v_row.indicator_profile_id);
    v_after := v_bb + v_row.amount;

    insert into public.wallet_transactions (
      indicator_profile_id, reward_id, payment_id, transaction_type,
      amount, balance_before, balance_after, description, reference_code, created_at
    )
    values (
      v_row.indicator_profile_id, null, p_payment_id, 'reversao_saque'::public.wallet_transaction_type,
      v_row.amount, v_bb, v_after,
      'Reversão de reserva — saque Pix rejeitado',
      'pix:reversao_saque:' || p_payment_id::text,
      v_now
    )
    returning id into v_reversal_tx;
  end if;

  update public.payments
  set
    status = 'rejeitado'::public.payment_status,
    rejection_reason = left(v_reason, 2000),
    approved_by_profile_id = auth.uid(),
    updated_at = v_now
  where id = p_payment_id;

  perform public.log_payment_audit(
    v_row.indicator_profile_id, p_payment_id, 'reject'::public.audit_action,
    jsonb_build_object('status', 'pendente'),
    jsonb_build_object('status', 'rejeitado', 'rejection_reason', v_reason, 'reversal_tx', v_reversal_tx),
    jsonb_build_object('flow', 'pix_withdrawal_reject')
  );

  return jsonb_build_object(
    'ok', true, 'payment_id', p_payment_id, 'status', 'rejeitado',
    'wallet_transaction_id', v_reversal_tx, 'balance_after', v_after
  );
end;
$$;

create or replace function public.complete_pix_withdrawal(p_payment_id uuid, p_receipt_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_row public.payments%rowtype;
  v_receipt text := nullif(trim(coalesce(p_receipt_url, '')), '');
  v_bb numeric(10,2);
  v_after numeric(10,2);
  v_tx uuid;
  v_now timestamptz := timezone('utc', now());
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('admin_financeiro'::public.user_role, 'admin_master'::public.user_role) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'Apenas administradores financeiros ou master podem concluir saques.');
  end if;

  if v_receipt is null then
    return jsonb_build_object('ok', false, 'code', 'receipt_required', 'message', 'Informe a URL ou caminho do comprovante do Pix enviado.');
  end if;

  select * into v_row from public.payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Pagamento não encontrado.');
  end if;

  if v_row.payment_kind is distinct from 'pix_withdrawal' then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind', 'message', 'Este registro não é um saque Pix.');
  end if;

  if v_row.status = 'pago'::public.payment_status and v_row.wallet_debit_transaction_id is not null then
    select wt.balance_after into v_after
    from public.wallet_transactions wt
    where wt.id = v_row.wallet_debit_transaction_id;
    return jsonb_build_object(
      'ok', true, 'idempotent', true,
      'payment_id', p_payment_id, 'status', 'pago',
      'wallet_transaction_id', v_row.wallet_debit_transaction_id,
      'balance_after', coalesce(v_after, public.wallet_balance_latest(v_row.indicator_profile_id))
    );
  end if;

  if v_row.status is distinct from 'aprovado'::public.payment_status then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'message', 'Só é possível concluir saques já aprovados.');
  end if;

  if v_row.wallet_reserve_transaction_id is not null then
    update public.wallet_transactions
    set
      transaction_type = 'saque'::public.wallet_transaction_type,
      description = 'Saque Pix concluído — débito definitivo (reserva convertida)',
      reference_code = 'pix:saque_aprovado:' || p_payment_id::text
    where id = v_row.wallet_reserve_transaction_id;

    v_tx := v_row.wallet_reserve_transaction_id;

    select wt.balance_after into v_after
    from public.wallet_transactions wt
    where wt.id = v_tx;
  else
    v_bb := public.wallet_balance_latest(v_row.indicator_profile_id);
    if v_row.amount > v_bb then
      return jsonb_build_object('ok', false, 'code', 'insufficient_balance', 'message', 'Saldo insuficiente no momento do débito.');
    end if;
    v_after := greatest(0::numeric, v_bb - v_row.amount);

    insert into public.wallet_transactions (
      indicator_profile_id, reward_id, payment_id, transaction_type,
      amount, balance_before, balance_after, description, reference_code, created_at
    )
    values (
      v_row.indicator_profile_id, null, p_payment_id, 'saque'::public.wallet_transaction_type,
      v_row.amount, v_bb, v_after,
      'Saque Pix — débito após envio e comprovante',
      'pix:saque_aprovado:' || p_payment_id::text,
      v_now
    )
    returning id into v_tx;
  end if;

  update public.payments
  set
    status = 'pago'::public.payment_status,
    paid_at = v_now,
    receipt_url = left(v_receipt, 2048),
    wallet_debit_transaction_id = v_tx,
    updated_at = v_now
  where id = p_payment_id;

  perform public.log_payment_audit(
    v_row.indicator_profile_id, p_payment_id, 'update'::public.audit_action,
    jsonb_build_object('status', 'aprovado'),
    jsonb_build_object('status', 'pago', 'paid_at', v_now, 'wallet_transaction_id', v_tx),
    jsonb_build_object('flow', 'pix_withdrawal_complete')
  );

  return jsonb_build_object(
    'ok', true, 'payment_id', p_payment_id, 'status', 'pago',
    'wallet_transaction_id', v_tx, 'balance_after', v_after
  );
exception
  when unique_violation then
    select wallet_debit_transaction_id into v_tx from public.payments where id = p_payment_id;
    if v_tx is not null then
      select wt.balance_after into v_after from public.wallet_transactions wt where wt.id = v_tx;
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'payment_id', p_payment_id, 'status', 'pago',
        'wallet_transaction_id', v_tx, 'balance_after', coalesce(v_after, 0)
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'already_completed', 'message', 'Este saque já foi concluído.');
end;
$$;

commit;

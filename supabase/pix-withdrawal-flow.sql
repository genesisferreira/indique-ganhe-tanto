-- Fluxo completo de saque Pix: solicitação, aprovação, rejeição, comprovante, débito, auditoria
-- Aplicar após schema.sql e rls-policies.sql

begin;

-- ---------------------------------------------------------------------------
-- Colunas em payments
-- ---------------------------------------------------------------------------

alter table public.payments
  alter column referral_id drop not null;

alter table public.payments
  add column if not exists payment_kind text not null default 'referral_reward';

alter table public.payments
  add column if not exists rejection_reason text;

alter table public.payments
  add column if not exists pix_key_snapshot text;

alter table public.payments
  add column if not exists pix_key_type public.pix_key_type;

alter table public.payments
  add column if not exists wallet_debit_transaction_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_payment_kind_chk'
  ) then
    alter table public.payments
      add constraint payments_payment_kind_chk
      check (payment_kind in ('referral_reward', 'pix_withdrawal'));
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_referral_kind_consistency_chk'
  ) then
    alter table public.payments
      add constraint payments_referral_kind_consistency_chk
      check (
        (payment_kind = 'referral_reward' and referral_id is not null)
        or (payment_kind = 'pix_withdrawal' and referral_id is null)
      );
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payments_wallet_debit_tx_fkey'
  ) then
    alter table public.payments
      add constraint payments_wallet_debit_tx_fkey
      foreign key (wallet_debit_transaction_id)
      references public.wallet_transactions(id)
      on delete set null;
  end if;
end$$;

create index if not exists payments_pix_withdrawal_status_idx
  on public.payments (payment_kind, status)
  where payment_kind = 'pix_withdrawal';

comment on column public.payments.payment_kind is
  'referral_reward: pagamento ligado a indicação; pix_withdrawal: saque solicitado pelo indicador.';
comment on column public.payments.pix_key_snapshot is
  'Cópia da chave Pix no momento da solicitação (auditoria).';
comment on column public.payments.wallet_debit_transaction_id is
  'Lançamento de saque na carteira ao marcar como pago com comprovante.';

-- ---------------------------------------------------------------------------
-- Saldo atual (último balance_after)
-- ---------------------------------------------------------------------------

create or replace function public.wallet_balance_latest(p_indicator uuid)
returns numeric(10,2)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select wt.balance_after
      from public.wallet_transactions wt
      where wt.indicator_profile_id = p_indicator
      order by wt.created_at desc, wt.id desc
      limit 1
    ),
    0::numeric(10,2)
  );
$$;

-- ---------------------------------------------------------------------------
-- Auditoria (helper)
-- ---------------------------------------------------------------------------

create or replace function public.log_payment_audit(
  p_target_profile uuid,
  p_entity_id uuid,
  p_action public.audit_action,
  p_old jsonb,
  p_new jsonb,
  p_meta jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    actor_profile_id,
    target_profile_id,
    entity_name,
    entity_id,
    action,
    old_data,
    new_data,
    metadata
  )
  values (
    auth.uid(),
    p_target_profile,
    'payment',
    p_entity_id::text,
    p_action,
    p_old,
    p_new,
    p_meta
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Notificação admins: definida em patch-notifications-pix-withdrawal.sql (aplicar antes deste fluxo).

-- 1) Solicitação de saque (indicador)
-- ---------------------------------------------------------------------------

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
  v_key_value text;
  v_key_type public.pix_key_type;
  v_due timestamptz := timezone('utc', now()) + interval '30 days';
  v_payment_id uuid;
begin
  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'indicador'::public.user_role then
    return jsonb_build_object(
      'ok', false,
      'code', 'forbidden',
      'message', 'Apenas indicadores podem solicitar saque Pix.'
    );
  end if;

  if p_amount is null or p_amount < 100 then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_amount',
      'message', 'Valor mínimo para saque é R$ 100,00.'
    );
  end if;

  v_balance := public.wallet_balance_latest(v_uid);
  if p_amount > v_balance then
    return jsonb_build_object(
      'ok', false,
      'code', 'insufficient_balance',
      'message', 'Saldo disponível insuficiente para este valor.'
    );
  end if;

  if exists (
    select 1
    from public.payments x
    where x.indicator_profile_id = v_uid
      and x.payment_kind = 'pix_withdrawal'
      and x.status in ('pendente'::public.payment_status, 'aprovado'::public.payment_status)
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'open_withdrawal_exists',
      'message', 'Já existe um saque Pix pendente ou aprovado aguardando conclusão.'
    );
  end if;

  select k.key_value, k.key_type
    into v_key_value, v_key_type
  from public.pix_keys k
  where k.profile_id = v_uid
    and k.is_primary = true
  limit 1;

  if v_key_value is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'no_pix_key',
      'message', 'Cadastre uma chave Pix principal antes de solicitar saque.'
    );
  end if;

  insert into public.payments (
    indicator_profile_id,
    referral_id,
    reward_id,
    amount,
    reward_type,
    status,
    due_date,
    payment_kind,
    pix_key_snapshot,
    pix_key_type,
    notes
  )
  values (
    v_uid,
    null,
    null,
    p_amount,
    'pix'::public.reward_type,
    'pendente'::public.payment_status,
    v_due,
    'pix_withdrawal',
    v_key_value,
    v_key_type,
    'Solicitação de saque Pix'
  )
  returning id into v_payment_id;

  perform public.log_payment_audit(
    v_uid,
    v_payment_id,
    'create'::public.audit_action,
    null::jsonb,
    jsonb_build_object(
      'status', 'pendente',
      'amount', p_amount,
      'payment_kind', 'pix_withdrawal'
    ),
    jsonb_build_object('flow', 'pix_withdrawal_request')
  );

  perform public.notify_admins_pix_withdrawal_requested(v_payment_id, v_uid, p_amount);

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'status', 'pendente'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Aprovar (financeiro / master)
-- ---------------------------------------------------------------------------

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
    return jsonb_build_object(
      'ok', false,
      'code', 'forbidden',
      'message', 'Apenas administradores financeiros ou master podem aprovar saques.'
    );
  end if;

  select * into v_row from public.payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Pagamento não encontrado.');
  end if;

  if v_row.payment_kind is distinct from 'pix_withdrawal' then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind', 'message', 'Este registro não é um saque Pix.');
  end if;

  if v_row.status is distinct from 'pendente'::public.payment_status then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_status',
      'message', format('Status atual não permite aprovação (%s).', v_row.status::text)
    );
  end if;

  update public.payments
  set
    status = 'aprovado'::public.payment_status,
    approved_by_profile_id = auth.uid(),
    updated_at = timezone('utc', now())
  where id = p_payment_id;

  perform public.log_payment_audit(
    v_row.indicator_profile_id,
    p_payment_id,
    'approve'::public.audit_action,
    jsonb_build_object('status', 'pendente'),
    jsonb_build_object('status', 'aprovado', 'approved_by', auth.uid()::text),
    jsonb_build_object('flow', 'pix_withdrawal_approve')
  );

  return jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'status', 'aprovado');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Rejeitar (pendente apenas)
-- ---------------------------------------------------------------------------

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
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('admin_financeiro'::public.user_role, 'admin_master'::public.user_role) then
    return jsonb_build_object(
      'ok', false,
      'code', 'forbidden',
      'message', 'Apenas administradores financeiros ou master podem rejeitar saques.'
    );
  end if;

  if v_reason is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'reason_required',
      'message', 'Informe o motivo da rejeição.'
    );
  end if;

  select * into v_row from public.payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Pagamento não encontrado.');
  end if;

  if v_row.payment_kind is distinct from 'pix_withdrawal' then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind', 'message', 'Este registro não é um saque Pix.');
  end if;

  if v_row.status is distinct from 'pendente'::public.payment_status then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_status',
      'message', 'Só é possível rejeitar solicitações pendentes.'
    );
  end if;

  update public.payments
  set
    status = 'rejeitado'::public.payment_status,
    rejection_reason = left(v_reason, 2000),
    approved_by_profile_id = auth.uid(),
    updated_at = timezone('utc', now())
  where id = p_payment_id;

  perform public.log_payment_audit(
    v_row.indicator_profile_id,
    p_payment_id,
    'reject'::public.audit_action,
    jsonb_build_object('status', 'pendente'),
    jsonb_build_object('status', 'rejeitado', 'rejection_reason', v_reason),
    jsonb_build_object('flow', 'pix_withdrawal_reject')
  );

  return jsonb_build_object('ok', true, 'payment_id', p_payment_id, 'status', 'rejeitado');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Concluir com comprovante + débito na carteira
-- ---------------------------------------------------------------------------

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
    return jsonb_build_object(
      'ok', false,
      'code', 'forbidden',
      'message', 'Apenas administradores financeiros ou master podem concluir saques.'
    );
  end if;

  if v_receipt is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'receipt_required',
      'message', 'Informe a URL ou caminho do comprovante do Pix enviado.'
    );
  end if;

  select * into v_row from public.payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Pagamento não encontrado.');
  end if;

  if v_row.payment_kind is distinct from 'pix_withdrawal' then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind', 'message', 'Este registro não é um saque Pix.');
  end if;

  if v_row.status is distinct from 'aprovado'::public.payment_status then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_status',
      'message', 'Só é possível concluir saques já aprovados.'
    );
  end if;

  if v_row.wallet_debit_transaction_id is not null then
    return jsonb_build_object(
      'ok', false,
      'code', 'already_completed',
      'message', 'Este saque já foi concluído e debitado.'
    );
  end if;

  v_bb := public.wallet_balance_latest(v_row.indicator_profile_id);
  if v_row.amount > v_bb then
    return jsonb_build_object(
      'ok', false,
      'code', 'insufficient_balance',
      'message', 'Saldo insuficiente no momento do débito. Atualize o status com o indicador.'
    );
  end if;

  v_after := v_bb - v_row.amount;
  if v_after < 0 then
    return jsonb_build_object('ok', false, 'code', 'balance_negative', 'message', 'Saldo resultante inválido.');
  end if;

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
    v_row.indicator_profile_id,
    null,
    p_payment_id,
    'saque'::public.wallet_transaction_type,
    v_row.amount,
    v_bb,
    v_after,
    'Saque Pix — débito após envio e comprovante',
    p_payment_id::text,
    v_now
  )
  returning id into v_tx;

  update public.payments
  set
    status = 'pago'::public.payment_status,
    paid_at = v_now,
    receipt_url = left(v_receipt, 2048),
    wallet_debit_transaction_id = v_tx,
    updated_at = v_now
  where id = p_payment_id;

  perform public.log_payment_audit(
    v_row.indicator_profile_id,
    p_payment_id,
    'update'::public.audit_action,
    jsonb_build_object('status', 'aprovado'),
    jsonb_build_object(
      'status', 'pago',
      'paid_at', v_now,
      'receipt_url', left(v_receipt, 2048),
      'wallet_transaction_id', v_tx
    ),
    jsonb_build_object('flow', 'pix_withdrawal_complete')
  );

  return jsonb_build_object(
    'ok', true,
    'payment_id', p_payment_id,
    'status', 'pago',
    'wallet_transaction_id', v_tx,
    'balance_after', v_after
  );
end;
$$;

grant execute on function public.request_pix_withdrawal(numeric) to authenticated;
grant execute on function public.approve_pix_withdrawal(uuid) to authenticated;
grant execute on function public.reject_pix_withdrawal(uuid, text) to authenticated;
grant execute on function public.complete_pix_withdrawal(uuid, text) to authenticated;

commit;

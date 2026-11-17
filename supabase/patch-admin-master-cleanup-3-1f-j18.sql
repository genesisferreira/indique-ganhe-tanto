-- 3.1F-J18: purga financeira interna sem pagamento externo, recálculo do ledger e métricas do período.
-- Não chama Controllr, ERP, Sync, PIX nem pagamento. Não apaga folha nem entitlement.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.admin_recalculate_wallet_ledger(p_indicator uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_balance numeric := 0;
  v_delta numeric;
begin
  for v_row in
    select id, transaction_type::text as kind, amount
    from public.wallet_transactions
    where indicator_profile_id = p_indicator
    order by created_at, id
    for update
  loop
    v_delta := case when v_row.kind in ('credito', 'reversao_saque') then v_row.amount else -v_row.amount end;
    update public.wallet_transactions
      set balance_before = greatest(v_balance, 0),
          balance_after = greatest(v_balance + v_delta, 0)
    where id = v_row.id;
    v_balance := greatest(v_balance + v_delta, 0);
  end loop;
  return v_balance;
end;
$$;

create or replace function public.admin_referral_deletion_facts(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ref public.referrals%rowtype;
  v_rewards integer;
  v_wallet integer;
  v_payments integer;
  v_receipts integer;
  v_entitlements integer;
  v_partner integer;
  v_audit integer;
  v_contract integer;
  v_pending_ops integer;
  v_notifications integer;
  v_events integer;
  v_originator text;
  v_blockers jsonb := '[]'::jsonb;
  v_internal boolean;
  v_class text;
begin
  select * into v_ref from public.referrals r where r.id = p_id;
  if v_ref.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select count(*) into v_rewards from public.rewards r where r.referral_id = p_id;
  select count(*) into v_wallet from public.wallet_transactions w
    where w.reward_id in (select r.id from public.rewards r where r.referral_id = p_id)
       or w.payment_id in (select p.id from public.payments p where p.referral_id = p_id);
  select count(*) into v_payments from public.payments p where p.referral_id = p_id;
  select count(*) into v_receipts from public.payments p
    where p.referral_id = p_id and nullif(btrim(coalesce(p.receipt_url, '')), '') is not null;
  select count(*) into v_entitlements from public.employee_commission_entitlements e where e.opportunity_id = p_id;
  select count(*) into v_partner from public.partner_commission_entitlements e where e.opportunity_id = p_id;
  select count(*) into v_audit from public.finance_audit_events a where a.entity_id = p_id;
  select count(*) into v_contract from public.brbyte_payment_snapshots s where s.referral_id = p_id;
  if v_ref.brbyte_contract_pk is not null or v_ref.brbyte_first_invoice_pk is not null or coalesce(v_ref.first_invoice_paid, false) then
    v_contract := v_contract + 1;
  end if;
  select count(*) into v_pending_ops from public.brbyte_interest_operations o where o.referral_id = p_id and o.status in ('pending', 'retryable');
  select count(*) into v_notifications from public.notifications n
    where n.data ->> 'referralId' = p_id::text or n.data ->> 'referral_id' = p_id::text or n.action_url = '/admin/indicacoes/' || p_id::text;
  select count(*) into v_events from public.referral_history h where h.referral_id = p_id;
  select public.admin_deletion_mask(p.full_name) into v_originator from public.profiles p where p.id = v_ref.indicator_profile_id;
  if v_receipts > 0 or v_entitlements > 0 then v_blockers := v_blockers || jsonb_build_array('external_payment'); end if;
  if v_partner > 0 then v_blockers := v_blockers || jsonb_build_array('entitlement'); end if;
  v_internal := v_rewards + v_wallet + v_payments > 0;
  v_class := case
    when v_receipts > 0 or v_entitlements > 0 then 'REGISTRO_COM_PAGAMENTO_EXTERNO'
    when coalesce(v_ref.is_controlled_test, false) and v_internal then 'TESTE_COM_FINANCEIRO_INTERNO'
    when coalesce(v_ref.is_controlled_test, false) then 'TESTE_SEM_FINANCEIRO'
    else 'REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO'
  end;
  return jsonb_build_object(
    'ok', true,
    'masked', public.admin_deletion_mask(v_ref.referred_name),
    'origin', coalesce(v_ref.origin_kind, v_ref.source),
    'originatorMasked', coalesce(v_originator, '***'),
    'controllrInterest', v_ref.brbyte_id_interessado is not null or v_ref.brbyte_client_pk is not null,
    'controllrWarning', case when v_ref.brbyte_id_interessado is not null or v_ref.brbyte_client_pk is not null then 'O cadastro no Controllr não será apagado' else null end,
    'rewards', v_rewards,
    'wallet', v_wallet,
    'payments', v_payments,
    'withdrawals', 0,
    'entitlements', v_entitlements + v_partner,
    'competences', 0,
    'financialAttributions', v_partner,
    'contractOrInvoice', v_contract,
    'pendingFinancial', 0,
    'financeAudit', v_audit,
    'pendingOperations', v_pending_ops,
    'notifications', v_notifications,
    'operationalEvents', v_events,
    'externalPayment', v_receipts > 0 or v_entitlements > 0,
    'testRecord', coalesce(v_ref.is_controlled_test, false),
    'classification', v_class,
    'financeConfirmationRequired', v_internal and v_receipts = 0 and v_entitlements = 0 and v_partner = 0,
    'tableCounts', jsonb_build_object('rewards', v_rewards, 'wallet', v_wallet, 'payments', v_payments, 'snapshots', v_contract, 'notifications', v_notifications, 'events', v_events, 'audit', v_audit),
    'canHardDelete', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'preserveMessage', case when jsonb_array_length(v_blockers) > 0 then 'Registro preservado por vínculo financeiro' else null end
  );
end;
$$;

create or replace function public.admin_purge_referral_internal(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_indicator uuid;
  v_rewards integer;
  v_wallet integer;
  v_payments integer;
  v_audit integer;
  v_snapshots integer;
begin
  select r.indicator_profile_id into v_indicator from public.referrals r where r.id = p_id;
  if exists (
    select 1 from public.payments p
    where p.referral_id = p_id and nullif(btrim(coalesce(p.receipt_url, '')), '') is not null
  ) or exists (
    select 1 from public.employee_commission_entitlements e where e.opportunity_id = p_id
  ) then
    raise exception 'external_payment' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.partner_commission_entitlements e where e.opportunity_id = p_id) then
    raise exception 'entitlement_preserved' using errcode = 'P0001';
  end if;
  select count(*) into v_wallet from public.wallet_transactions w
    where w.reward_id in (select id from public.rewards where referral_id = p_id)
       or w.payment_id in (select id from public.payments where referral_id = p_id);
  delete from public.wallet_transactions w
    where w.reward_id in (select id from public.rewards where referral_id = p_id)
       or w.payment_id in (select id from public.payments where referral_id = p_id);
  select count(*) into v_audit from public.finance_audit_events a
    where a.entity_id = p_id or a.entity_id in (select id from public.rewards where referral_id = p_id);
  delete from public.finance_audit_events a
    where a.entity_id = p_id or a.entity_id in (select id from public.rewards where referral_id = p_id);
  select count(*) into v_payments from public.payments p where p.referral_id = p_id;
  delete from public.payments p where p.referral_id = p_id;
  select count(*) into v_rewards from public.rewards r where r.referral_id = p_id;
  delete from public.rewards r where r.referral_id = p_id;
  select count(*) into v_snapshots from public.brbyte_payment_snapshots s where s.referral_id = p_id;
  delete from public.brbyte_payment_snapshots s where s.referral_id = p_id;
  if v_indicator is not null then
    perform public.admin_recalculate_wallet_ledger(v_indicator);
  end if;
  return jsonb_build_object('rewards', v_rewards, 'wallet', v_wallet, 'payments', v_payments, 'audit', v_audit, 'snapshots', v_snapshots);
end;
$$;

drop function if exists public.admin_delete_referral(uuid, text, text, text);
create or replace function public.admin_delete_referral(
  p_referral_id uuid,
  p_reason text,
  p_confirmation text,
  p_idempotency_key text,
  p_finance_confirmation text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb := public.admin_deletion_actor();
  v_reason text := public.admin_deletion_reason(p_reason);
  v_facts jsonb;
  v_existing public.admin_deletion_tombstones%rowtype;
  v_operation uuid := gen_random_uuid();
  v_counts jsonb := '{}'::jsonb;
begin
  perform set_config('statement_timeout', '15000', true);
  if v_actor ->> 'ok' <> 'true' then return v_actor; end if;
  if p_confirmation is distinct from 'EXCLUIR INDICACAO' then
    return jsonb_build_object('ok', false, 'code', 'confirmation_mismatch');
  end if;
  if v_reason is null then return jsonb_build_object('ok', false, 'code', 'reason_invalid'); end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if p_finance_confirmation is not null and p_finance_confirmation is distinct from 'EXCLUIR HISTORICO FINANCEIRO DE TESTE' then
    return jsonb_build_object('ok', false, 'code', 'finance_confirmation_mismatch');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.j17.referral:' || p_referral_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('igt.j17.key:' || p_idempotency_key, 0));
  select * into v_existing from public.admin_deletion_tombstones t where t.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.object_id_hash is distinct from public.partner_sha256_hex(p_referral_id::text) then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'removedCount', v_existing.removed_count, 'authAction', 'none');
  end if;
  v_facts := public.admin_referral_deletion_facts(p_referral_id);
  if v_facts ->> 'ok' <> 'true' then return v_facts; end if;
  if (v_facts ->> 'canHardDelete')::boolean is not true then
    return jsonb_build_object('ok', false, 'code', 'hard_delete_blocked', 'blockers', v_facts -> 'blockers', 'classification', v_facts ->> 'classification', 'preserveMessage', v_facts ->> 'preserveMessage');
  end if;
  if v_facts ->> 'classification' = 'REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO' and char_length(v_reason) < 40 then
    return jsonb_build_object('ok', false, 'code', 'reason_too_short');
  end if;
  if (v_facts ->> 'financeConfirmationRequired')::boolean and p_finance_confirmation is distinct from 'EXCLUIR HISTORICO FINANCEIRO DE TESTE' then
    return jsonb_build_object('ok', false, 'code', 'finance_confirmation_required');
  end if;
  v_counts := public.admin_purge_referral_internal(p_referral_id);
  perform public.admin_delete_referral_owned(p_referral_id);
  perform public.admin_record_tombstone(v_operation, p_idempotency_key, 'referral', p_referral_id, (v_actor ->> 'actor')::uuid, v_actor ->> 'role', v_reason, 1, (v_facts - 'masked' - 'originatorMasked') || jsonb_build_object('removedByTable', v_counts), 'none');
  return jsonb_build_object('ok', true, 'idempotent', false, 'removedCount', 1, 'authAction', 'none', 'classification', v_facts ->> 'classification');
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'external_payment' then return jsonb_build_object('ok', false, 'code', 'external_payment'); end if;
    return jsonb_build_object('ok', false, 'code', 'delete_failed');
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'code', 'financial_dependency');
  when others then
    return jsonb_build_object('ok', false, 'code', 'delete_failed');
end;
$$;

create or replace function public.admin_preview_bulk_referral_deletion(p_referral_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb := public.admin_deletion_actor();
  v_id uuid;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_blocked integer := 0;
  v_finance boolean := false;
begin
  perform set_config('statement_timeout', '15000', true);
  if v_actor ->> 'ok' <> 'true' then return v_actor; end if;
  if p_referral_ids is null or cardinality(p_referral_ids) < 1 or cardinality(p_referral_ids) > 20 then
    return jsonb_build_object('ok', false, 'code', 'bulk_limit');
  end if;
  foreach v_id in array p_referral_ids loop
    v_item := public.admin_referral_deletion_facts(v_id);
    if v_item ->> 'ok' <> 'true' or (v_item ->> 'canHardDelete')::boolean is not true then
      v_blocked := v_blocked + 1;
    end if;
    if (v_item ->> 'financeConfirmationRequired')::boolean then v_finance := true; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'canHardDelete', coalesce(v_item -> 'canHardDelete', 'false'::jsonb),
      'blockers', coalesce(v_item -> 'blockers', '[]'::jsonb),
      'classification', to_jsonb(coalesce(v_item ->> 'classification', 'REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO')),
      'controllrInterest', coalesce(v_item -> 'controllrInterest', 'false'::jsonb)
    ));
  end loop;
  return jsonb_build_object('ok', true, 'count', cardinality(p_referral_ids), 'blocked', v_blocked, 'canHardDelete', v_blocked = 0, 'financeConfirmationRequired', v_finance, 'items', v_items, 'confirmation', 'EXCLUIR SELECIONADOS');
end;
$$;

drop function if exists public.admin_bulk_delete_referrals(uuid[], text, text, text);
create or replace function public.admin_bulk_delete_referrals(
  p_referral_ids uuid[],
  p_reason text,
  p_confirmation text,
  p_idempotency_key text,
  p_finance_confirmation text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb := public.admin_deletion_actor();
  v_reason text := public.admin_deletion_reason(p_reason);
  v_preview jsonb;
  v_id uuid;
  v_facts jsonb;
  v_existing public.admin_deletion_tombstones%rowtype;
  v_operation uuid := gen_random_uuid();
  v_sorted uuid[];
begin
  perform set_config('statement_timeout', '15000', true);
  if v_actor ->> 'ok' <> 'true' then return v_actor; end if;
  if v_reason is null then return jsonb_build_object('ok', false, 'code', 'reason_invalid'); end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  v_preview := public.admin_preview_bulk_referral_deletion(p_referral_ids);
  if v_preview ->> 'ok' <> 'true' then return v_preview; end if;
  if p_confirmation is distinct from 'EXCLUIR SELECIONADOS' then
    return jsonb_build_object('ok', false, 'code', 'confirmation_mismatch');
  end if;
  if (v_preview ->> 'canHardDelete')::boolean is not true then
    return jsonb_build_object('ok', false, 'code', 'bulk_blocked', 'blocked', v_preview -> 'blocked');
  end if;
  if (v_preview ->> 'financeConfirmationRequired')::boolean and p_finance_confirmation is distinct from 'EXCLUIR HISTORICO FINANCEIRO DE TESTE' then
    return jsonb_build_object('ok', false, 'code', 'finance_confirmation_required');
  end if;
  select array_agg(x order by x) into v_sorted from unnest(p_referral_ids) x;
  perform pg_advisory_xact_lock(hashtextextended('igt.j17.key:' || p_idempotency_key, 0));
  select * into v_existing from public.admin_deletion_tombstones t where t.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'removedCount', v_existing.removed_count, 'authAction', 'none');
  end if;
  foreach v_id in array v_sorted loop
    perform pg_advisory_xact_lock(hashtextextended('igt.j17.referral:' || v_id::text, 0));
  end loop;
  foreach v_id in array v_sorted loop
    v_facts := public.admin_referral_deletion_facts(v_id);
    if v_facts ->> 'ok' <> 'true' or (v_facts ->> 'canHardDelete')::boolean is not true then
      raise exception 'bulk_blocked' using errcode = 'P0001';
    end if;
    if v_facts ->> 'classification' = 'REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO' and char_length(v_reason) < 40 then
      raise exception 'bulk_blocked' using errcode = 'P0001';
    end if;
    perform public.admin_purge_referral_internal(v_id);
    perform public.admin_delete_referral_owned(v_id);
  end loop;
  perform public.admin_record_tombstone(v_operation, p_idempotency_key, 'bulk', v_sorted[1], (v_actor ->> 'actor')::uuid, v_actor ->> 'role', v_reason, cardinality(v_sorted), v_preview - 'items', 'none');
  return jsonb_build_object('ok', true, 'removedCount', cardinality(v_sorted), 'authAction', 'none');
exception
  when sqlstate 'P0001' then
    return jsonb_build_object('ok', false, 'code', 'bulk_blocked');
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'code', 'financial_dependency');
  when others then
    return jsonb_build_object('ok', false, 'code', 'delete_failed');
end;
$$;

create or replace function public.admin_indicator_deletion_facts(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_test boolean;
  v_referrals integer;
  v_blocked integer := 0;
  v_finance boolean := false;
  v_active_links integer;
  v_revoked_links integer;
  v_rewards integer;
  v_wallet integer;
  v_withdrawals integer;
  v_payments integer;
  v_receipts integer;
  v_audit integer;
  v_employees integer;
  v_competences integer;
  v_notifications integer;
  v_ref uuid;
  v_facts jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_class text;
begin
  select p.role::text, coalesce(p.is_controlled_test, false) into v_role, v_test
  from public.profiles p where p.id = p_id;
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_role is distinct from 'indicador' then return jsonb_build_object('ok', false, 'code', 'not_indicator'); end if;
  select count(*) into v_referrals from public.referrals r where r.indicator_profile_id = p_id;
  for v_ref in select r.id from public.referrals r where r.indicator_profile_id = p_id loop
    v_facts := public.admin_referral_deletion_facts(v_ref);
    if (v_facts ->> 'canHardDelete')::boolean is not true then v_blocked := v_blocked + 1; end if;
    if (v_facts ->> 'financeConfirmationRequired')::boolean then v_finance := true; end if;
  end loop;
  select count(*) filter (where l.status = 'active'), count(*) filter (where l.status = 'revoked')
    into v_active_links, v_revoked_links
  from public.referral_share_links l
  where l.origin_kind = 'indicator' and l.originator_id = p_id;
  select count(*) into v_rewards from public.rewards r where r.indicator_profile_id = p_id;
  select count(*) into v_wallet from public.wallet_transactions w where w.indicator_profile_id = p_id;
  select count(*) into v_withdrawals from public.wallet_transactions w where w.indicator_profile_id = p_id and w.transaction_type::text = 'saque';
  select count(*) into v_payments from public.payments p where p.indicator_profile_id = p_id;
  select count(*) into v_receipts from public.payments p
    where p.indicator_profile_id = p_id and nullif(btrim(coalesce(p.receipt_url, '')), '') is not null;
  select count(*) into v_audit from public.finance_audit_events a where a.entity_id = p_id or a.actor_id = p_id;
  select count(*) into v_employees from public.employees e where e.profile_id = p_id;
  select count(*) into v_competences from public.payroll_competences c
    join public.employees e on e.id = c.employee_id where e.profile_id = p_id;
  select count(*) into v_notifications from public.notifications n where n.profile_id = p_id;
  if v_receipts > 0 or v_competences > 0 then v_blockers := v_blockers || jsonb_build_array('external_payment'); end if;
  if v_blocked > 0 then v_blockers := v_blockers || jsonb_build_array('referral_not_eligible'); end if;
  if v_employees > 0 then v_blockers := v_blockers || jsonb_build_array('shared_dependency'); end if;
  if v_rewards + v_wallet + v_payments > 0 then v_finance := true; end if;
  v_class := case
    when v_receipts > 0 or v_competences > 0 then 'REGISTRO_COM_PAGAMENTO_EXTERNO'
    when v_test and v_finance then 'TESTE_COM_FINANCEIRO_INTERNO'
    when v_test then 'TESTE_SEM_FINANCEIRO'
    else 'REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO'
  end;
  return jsonb_build_object(
    'ok', true,
    'referrals', v_referrals,
    'blockedReferrals', v_blocked,
    'activeLinks', v_active_links,
    'revokedLinks', v_revoked_links,
    'rewards', v_rewards,
    'wallet', v_wallet,
    'withdrawals', v_withdrawals,
    'payments', v_payments,
    'notifications', v_notifications,
    'financeAudit', v_audit,
    'competences', v_competences,
    'externalPayment', v_receipts > 0 or v_competences > 0,
    'testRecord', v_test,
    'classification', v_class,
    'financeConfirmationRequired', v_finance and jsonb_array_length(v_blockers) = 0,
    'tableCounts', jsonb_build_object('referrals', v_referrals, 'rewards', v_rewards, 'wallet', v_wallet, 'payments', v_payments, 'notifications', v_notifications),
    'hasAuthAccount', true,
    'canHardDelete', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'preserveMessage', case when jsonb_array_length(v_blockers) > 0 then 'Registro preservado por vínculo financeiro' else null end
  );
end;
$$;

drop function if exists public.admin_delete_or_deactivate_indicator(uuid, text, text, text, text, text);
create or replace function public.admin_delete_or_deactivate_indicator(
  p_indicator_id uuid,
  p_mode text,
  p_reason text,
  p_confirmation text,
  p_idempotency_key text,
  p_auth_confirmation text default null,
  p_finance_confirmation text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb := public.admin_deletion_actor();
  v_reason text := public.admin_deletion_reason(p_reason);
  v_facts jsonb;
  v_existing public.admin_deletion_tombstones%rowtype;
  v_operation uuid := gen_random_uuid();
  v_ref uuid;
  v_auth text := 'none';
  v_removed integer := 0;
begin
  perform set_config('statement_timeout', '15000', true);
  if v_actor ->> 'ok' <> 'true' then return v_actor; end if;
  if p_mode not in ('hard_delete', 'deactivate') then return jsonb_build_object('ok', false, 'code', 'invalid_mode'); end if;
  if p_mode = 'hard_delete' and p_confirmation is distinct from 'EXCLUIR INDICADOR' then
    return jsonb_build_object('ok', false, 'code', 'confirmation_mismatch');
  end if;
  if p_mode = 'deactivate' and p_confirmation is distinct from 'DESATIVAR REGISTRO' then
    return jsonb_build_object('ok', false, 'code', 'confirmation_mismatch');
  end if;
  if v_reason is null then return jsonb_build_object('ok', false, 'code', 'reason_invalid'); end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if p_auth_confirmation is not null and p_auth_confirmation is distinct from 'EXCLUIR CONTA DE ACESSO' then
    return jsonb_build_object('ok', false, 'code', 'auth_confirmation_mismatch');
  end if;
  if p_finance_confirmation is not null and p_finance_confirmation is distinct from 'EXCLUIR HISTORICO FINANCEIRO DE TESTE' then
    return jsonb_build_object('ok', false, 'code', 'finance_confirmation_mismatch');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.j17.indicator:' || p_indicator_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('igt.j17.key:' || p_idempotency_key, 0));
  select * into v_existing from public.admin_deletion_tombstones t where t.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.object_id_hash is distinct from public.partner_sha256_hex(p_indicator_id::text) then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'removedCount', v_existing.removed_count, 'authAction', v_existing.auth_action);
  end if;
  v_facts := public.admin_indicator_deletion_facts(p_indicator_id);
  if v_facts ->> 'ok' <> 'true' then return v_facts; end if;
  if p_mode = 'deactivate' then
    if (v_facts ->> 'canHardDelete')::boolean then
      return jsonb_build_object('ok', false, 'code', 'deactivation_not_required');
    end if;
    perform public.admin_revoke_indicator_links(p_indicator_id, (v_actor ->> 'actor')::uuid);
    perform public.admin_redact_indicator(p_indicator_id);
    v_auth := 'ban';
  else
    if (v_facts ->> 'canHardDelete')::boolean is not true then
      return jsonb_build_object('ok', false, 'code', 'hard_delete_blocked', 'blockers', v_facts -> 'blockers', 'classification', v_facts ->> 'classification', 'preserveMessage', v_facts ->> 'preserveMessage');
    end if;
    if v_facts ->> 'classification' = 'REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO' and char_length(v_reason) < 40 then
      return jsonb_build_object('ok', false, 'code', 'reason_too_short');
    end if;
    if (v_facts ->> 'financeConfirmationRequired')::boolean and p_finance_confirmation is distinct from 'EXCLUIR HISTORICO FINANCEIRO DE TESTE' then
      return jsonb_build_object('ok', false, 'code', 'finance_confirmation_required');
    end if;
    for v_ref in select r.id from public.referrals r where r.indicator_profile_id = p_indicator_id order by r.id loop
      perform pg_advisory_xact_lock(hashtextextended('igt.j17.referral:' || v_ref::text, 0));
      if (public.admin_referral_deletion_facts(v_ref) ->> 'canHardDelete')::boolean is not true then
        raise exception 'hard_delete_blocked' using errcode = 'P0001';
      end if;
      perform public.admin_purge_referral_internal(v_ref);
      perform public.admin_delete_referral_owned(v_ref);
      v_removed := v_removed + 1;
    end loop;
    delete from public.wallet_transactions w where w.indicator_profile_id = p_indicator_id;
    delete from public.payments p where p.indicator_profile_id = p_indicator_id and nullif(btrim(coalesce(p.receipt_url, '')), '') is null;
    delete from public.rewards r where r.indicator_profile_id = p_indicator_id;
    perform public.admin_recalculate_wallet_ledger(p_indicator_id);
    perform public.admin_revoke_indicator_links(p_indicator_id, (v_actor ->> 'actor')::uuid);
    if p_auth_confirmation = 'EXCLUIR CONTA DE ACESSO' then
      delete from public.pix_keys k where k.profile_id = p_indicator_id;
      delete from public.profiles p where p.id = p_indicator_id and p.role::text = 'indicador';
      v_auth := 'delete';
    else
      perform public.admin_redact_indicator(p_indicator_id);
      v_auth := 'ban';
    end if;
  end if;
  perform public.admin_record_tombstone(
    v_operation, p_idempotency_key, 'indicator', p_indicator_id, (v_actor ->> 'actor')::uuid,
    v_actor ->> 'role', v_reason, v_removed, v_facts, v_auth
  );
  return jsonb_build_object('ok', true, 'removedCount', v_removed, 'authAction', v_auth, 'classification', v_facts ->> 'classification', 'preserveMessage', case when p_mode = 'deactivate' then 'Registro preservado por vínculo financeiro' else null end);
exception
  when sqlstate 'P0001' then
    return jsonb_build_object('ok', false, 'code', 'hard_delete_blocked');
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'code', 'shared_dependency');
  when others then
    return jsonb_build_object('ok', false, 'code', 'delete_failed');
end;
$$;

create or replace function public.admin_period_referral_stats(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_total integer;
  v_pending integer;
  v_attendance integer;
  v_approved integer;
  v_rejected integer;
  v_paid numeric;
  v_open numeric;
  v_open_count integer;
  v_balance numeric;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'unauthenticated'); end if;
  select p.role::text into v_role from public.profiles p where p.id = auth.uid();
  if v_role not in ('admin_master', 'admin_financeiro', 'admin_consulta') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  select count(*) into v_total from public.referrals r
    where (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to);
  select count(*) filter (where r.status::text = 'pendente'),
         count(*) filter (where r.status::text = 'em_atendimento'),
         count(*) filter (where r.status::text = 'aprovada'),
         count(*) filter (where r.status::text = 'recusada')
    into v_pending, v_attendance, v_approved, v_rejected
  from public.referrals r
  where (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to);
  select coalesce(sum(p.amount) filter (where p.status::text = 'pago'), 0),
         coalesce(sum(p.amount) filter (where p.status::text in ('pendente', 'aprovado')), 0),
         count(*) filter (where p.status::text in ('pendente', 'aprovado'))
    into v_paid, v_open, v_open_count
  from public.payments p
  where (p_from is null or p.created_at >= p_from) and (p_to is null or p.created_at < p_to);
  select coalesce(sum(s.balance_after), 0) into v_balance from (
    select distinct on (w.indicator_profile_id) w.balance_after
    from public.wallet_transactions w
    order by w.indicator_profile_id, w.created_at desc, w.id desc
  ) s;
  return jsonb_build_object(
    'ok', true,
    'totalReferrals', v_total,
    'pendingReferrals', v_pending,
    'inAttendanceReferrals', v_attendance,
    'approvedReferrals', v_approved,
    'rejectedReferrals', v_rejected,
    'paidValue', v_paid,
    'pendingValue', v_open,
    'pendingCount', v_open_count,
    'currentBalance', v_balance,
    'currentBalanceLabel', 'Saldo atual'
  );
end;
$$;

revoke all on function public.admin_recalculate_wallet_ledger(uuid) from public, anon, authenticated;
revoke all on function public.admin_purge_referral_internal(uuid) from public, anon, authenticated;
revoke all on function public.admin_delete_referral(uuid, text, text, text, text) from public, anon;
revoke all on function public.admin_bulk_delete_referrals(uuid[], text, text, text, text) from public, anon;
revoke all on function public.admin_delete_or_deactivate_indicator(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function public.admin_period_referral_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_delete_referral(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_bulk_delete_referrals(uuid[], text, text, text, text) to authenticated;
grant execute on function public.admin_delete_or_deactivate_indicator(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_period_referral_stats(timestamptz, timestamptz) to authenticated;

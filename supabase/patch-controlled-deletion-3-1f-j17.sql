-- 3.1F-J17: exclusão controlada de indicação e indicador.
-- Não apaga reward, carteira, pagamento, entitlement, competência, auditoria financeira nem o Controllr.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.referrals
  add column if not exists is_controlled_test boolean not null default false,
  add column if not exists personal_data_redacted_at timestamptz;

alter table public.profiles
  add column if not exists is_controlled_test boolean not null default false,
  add column if not exists personal_data_redacted_at timestamptz;

alter table public.rewards drop constraint if exists rewards_referral_id_fkey;
alter table public.rewards
  add constraint rewards_referral_id_fkey
  foreign key (referral_id) references public.referrals(id) on delete restrict;

alter table public.brbyte_payment_snapshots drop constraint if exists brbyte_payment_snapshots_referral_id_fkey;
alter table public.brbyte_payment_snapshots
  add constraint brbyte_payment_snapshots_referral_id_fkey
  foreign key (referral_id) references public.referrals(id) on delete restrict;

create table if not exists public.admin_deletion_tombstones (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  idempotency_key text not null unique,
  object_type text not null,
  object_id_hash text not null,
  actor_id uuid not null,
  actor_role text not null,
  reason_digest text not null,
  reason_length integer not null,
  removed_count integer not null,
  financial_preflight jsonb not null,
  auth_action text not null default 'none',
  created_at timestamptz not null default timezone('utc', now()),
  constraint admin_deletion_tombstones_type_chk check (object_type in ('referral', 'indicator', 'bulk')),
  constraint admin_deletion_tombstones_auth_chk check (auth_action in ('none', 'ban', 'delete')),
  constraint admin_deletion_tombstones_reason_chk check (reason_length between 20 and 500),
  constraint admin_deletion_tombstones_removed_chk check (removed_count >= 0)
);

alter table public.admin_deletion_tombstones enable row level security;
revoke all on table public.admin_deletion_tombstones from public, anon, authenticated;

create or replace function public.trg_admin_deletion_tombstones_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_deletion_tombstone_append_only' using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_admin_deletion_tombstones_append_only on public.admin_deletion_tombstones;
create trigger trg_admin_deletion_tombstones_append_only
before update or delete on public.admin_deletion_tombstones
for each row execute function public.trg_admin_deletion_tombstones_append_only();

create or replace function public.admin_deletion_actor()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  select p.role::text into v_role from public.profiles p where p.id = auth.uid();
  -- Bloqueados: admin_consulta, admin_financeiro, comercial, indicador, funcionario, tecnico, vendedor_externo, parceiro.
  if v_role is distinct from 'admin_master' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'actor', auth.uid(), 'role', v_role);
end;
$$;

create or replace function public.admin_deletion_reason(p_reason text)
returns text
language plpgsql
immutable
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 20 or char_length(v_reason) > 500 or v_reason ~ '[0-9]{8,}' or position('@' in v_reason) > 0 then
    return null;
  end if;
  return v_reason;
end;
$$;

create or replace function public.admin_deletion_mask(p_text text)
returns text
language sql
immutable
as $$
  select case when p_text is null or btrim(p_text) = '' then '***' else left(btrim(p_text), 1) || '***' end
$$;

-- A máscara precisa existir antes dos fatos. Recria os fatos depois da máscara.
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
  v_entitlements integer;
  v_audit integer;
  v_contract integer;
  v_pending_financial integer;
  v_pending_ops integer;
  v_notifications integer;
  v_events integer;
  v_originator text;
  v_blockers jsonb := '[]'::jsonb;
begin
  select * into v_ref from public.referrals r where r.id = p_id;
  if v_ref.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select count(*) into v_rewards from public.rewards r where r.referral_id = p_id;
  select count(*) into v_wallet from public.wallet_transactions w join public.rewards r on r.id = w.reward_id where r.referral_id = p_id;
  select count(*) into v_payments from public.payments p where p.referral_id = p_id;
  select count(*) into v_entitlements from (
    select e.id from public.employee_commission_entitlements e where e.opportunity_id = p_id
    union all
    select e.id from public.partner_commission_entitlements e where e.opportunity_id = p_id
  ) s;
  select count(*) into v_audit from public.finance_audit_events a where a.entity_id = p_id;
  select count(*) into v_contract from public.brbyte_payment_snapshots s where s.referral_id = p_id;
  if v_ref.brbyte_contract_pk is not null or v_ref.brbyte_first_invoice_pk is not null or coalesce(v_ref.first_invoice_paid, false) then
    v_contract := v_contract + 1;
  end if;
  select count(*) into v_pending_financial from public.rewards r where r.referral_id = p_id and r.status::text in ('pendente', 'solicitado');
  select count(*) into v_pending_ops from public.brbyte_interest_operations o where o.referral_id = p_id and o.status in ('pending', 'retryable');
  select count(*) into v_notifications from public.notifications n
    where n.data ->> 'referralId' = p_id::text or n.data ->> 'referral_id' = p_id::text or n.action_url = '/admin/indicacoes/' || p_id::text;
  select count(*) into v_events from public.referral_history h where h.referral_id = p_id;
  select public.admin_deletion_mask(p.full_name) into v_originator from public.profiles p where p.id = v_ref.indicator_profile_id;
  if v_rewards > 0 then v_blockers := v_blockers || jsonb_build_array('reward'); end if;
  if v_wallet > 0 then v_blockers := v_blockers || jsonb_build_array('wallet'); end if;
  if v_payments > 0 then v_blockers := v_blockers || jsonb_build_array('payment'); end if;
  if v_entitlements > 0 then v_blockers := v_blockers || jsonb_build_array('entitlement'); end if;
  if v_audit > 0 then v_blockers := v_blockers || jsonb_build_array('finance_audit'); end if;
  if v_contract > 0 then v_blockers := v_blockers || jsonb_build_array('contract_or_invoice'); end if;
  if v_pending_financial > 0 then v_blockers := v_blockers || jsonb_build_array('pending_financial'); end if;
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
    'entitlements', v_entitlements,
    'competences', 0,
    'financialAttributions', v_entitlements,
    'contractOrInvoice', v_contract,
    'pendingFinancial', v_pending_financial,
    'financeAudit', v_audit,
    'pendingOperations', v_pending_ops,
    'notifications', v_notifications,
    'operationalEvents', v_events,
    'testRecord', coalesce(v_ref.is_controlled_test, false),
    'canHardDelete', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'preserveMessage', case when jsonb_array_length(v_blockers) > 0 then 'Registro preservado por vínculo financeiro' else null end
  );
end;
$$;
create or replace function public.admin_delete_referral_owned(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.referral_share_competing_attempts a where a.existing_opportunity_id = p_id;
  delete from public.partner_merchant_competing_attempts a where a.existing_opportunity_id = p_id;
  delete from public.partner_merchant_attribution_corrections a where a.opportunity_id = p_id;
  delete from public.partner_merchant_attributions a where a.opportunity_id = p_id;
  delete from public.sales_opportunity_attributions a where a.opportunity_id = p_id;
  delete from public.referral_share_submissions s where s.opportunity_id = p_id;
  delete from public.brbyte_interest_operations o where o.referral_id = p_id;
  delete from public.brbyte_referral_history h where h.referral_id = p_id;
  delete from public.referral_history h where h.referral_id = p_id;
  delete from public.notifications n
    where n.data ->> 'referralId' = p_id::text
       or n.data ->> 'referral_id' = p_id::text
       or n.action_url = '/admin/indicacoes/' || p_id::text;
  delete from public.referrals r where r.id = p_id;
end;
$$;

create or replace function public.admin_redact_referral(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.referrals set
    referred_name = 'Registro preservado por vínculo financeiro',
    referred_phone = 'REDACTED',
    referred_email = null,
    referred_document = null,
    referred_birth_date = null,
    referred_observation = null,
    referred_company_trade_name = null,
    referred_zipcode = null,
    referred_street = null,
    referred_number = null,
    referred_complement = null,
    referred_neighborhood = null,
    referred_city = null,
    personal_data_redacted_at = timezone('utc', now())
  where id = p_id;
end;
$$;

create or replace function public.admin_record_tombstone(
  p_operation uuid,
  p_key text,
  p_type text,
  p_object uuid,
  p_actor uuid,
  p_role text,
  p_reason text,
  p_removed integer,
  p_preflight jsonb,
  p_auth text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.admin_deletion_tombstones (
    operation_id, idempotency_key, object_type, object_id_hash, actor_id, actor_role,
    reason_digest, reason_length, removed_count, financial_preflight, auth_action
  ) values (
    p_operation, p_key, p_type, public.partner_sha256_hex(p_object::text), p_actor, p_role,
    public.partner_sha256_hex(p_reason), char_length(p_reason), p_removed, p_preflight, p_auth
  );
end;
$$;

create or replace function public.admin_preview_referral_deletion(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb := public.admin_deletion_actor();
begin
  perform set_config('statement_timeout', '15000', true);
  if v_actor ->> 'ok' <> 'true' then return v_actor; end if;
  return public.admin_referral_deletion_facts(p_referral_id);
end;
$$;

create or replace function public.admin_delete_referral(
  p_referral_id uuid,
  p_reason text,
  p_confirmation text,
  p_idempotency_key text
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
begin
  perform set_config('statement_timeout', '15000', true);
  if v_actor ->> 'ok' <> 'true' then return v_actor; end if;
  if p_confirmation is distinct from 'EXCLUIR INDICAÇÃO' then
    return jsonb_build_object('ok', false, 'code', 'confirmation_mismatch');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_invalid');
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
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
  if (v_facts ->> 'canHardDelete')::boolean is not true or not ((v_facts ->> 'testRecord')::boolean or v_reason is not null) then
    return jsonb_build_object('ok', false, 'code', 'hard_delete_blocked', 'blockers', v_facts -> 'blockers', 'preserveMessage', v_facts ->> 'preserveMessage');
  end if;
  perform public.admin_delete_referral_owned(p_referral_id);
  perform public.admin_record_tombstone(v_operation, p_idempotency_key, 'referral', p_referral_id, (v_actor ->> 'actor')::uuid, v_actor ->> 'role', v_reason, 1, v_facts - 'masked' - 'originatorMasked', 'none');
  return jsonb_build_object('ok', true, 'idempotent', false, 'removedCount', 1, 'authAction', 'none');
exception
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'code', 'financial_dependency');
  when others then
    if sqlerrm = 'admin_deletion_tombstone_append_only' then
      return jsonb_build_object('ok', false, 'code', 'tombstone_protected');
    end if;
    return jsonb_build_object('ok', false, 'code', 'delete_failed');
end;
$$;

create or replace function public.admin_deactivate_referral(
  p_referral_id uuid,
  p_reason text,
  p_confirmation text,
  p_idempotency_key text
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
begin
  perform set_config('statement_timeout', '15000', true);
  if v_actor ->> 'ok' <> 'true' then return v_actor; end if;
  if p_confirmation is distinct from 'DESATIVAR REGISTRO' then
    return jsonb_build_object('ok', false, 'code', 'confirmation_mismatch');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_invalid');
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.j17.referral:' || p_referral_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('igt.j17.key:' || p_idempotency_key, 0));
  select * into v_existing from public.admin_deletion_tombstones t where t.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'removedCount', 0, 'authAction', 'none', 'preserveMessage', 'Registro preservado por vínculo financeiro');
  end if;
  v_facts := public.admin_referral_deletion_facts(p_referral_id);
  if v_facts ->> 'ok' <> 'true' then return v_facts; end if;
  if (v_facts ->> 'canHardDelete')::boolean then
    return jsonb_build_object('ok', false, 'code', 'deactivation_not_required');
  end if;
  perform public.admin_redact_referral(p_referral_id);
  perform public.admin_record_tombstone(v_operation, p_idempotency_key, 'referral', p_referral_id, (v_actor ->> 'actor')::uuid, v_actor ->> 'role', v_reason, 0, v_facts - 'masked' - 'originatorMasked', 'none');
  return jsonb_build_object('ok', true, 'removedCount', 0, 'authAction', 'none', 'preserveMessage', 'Registro preservado por vínculo financeiro');
exception when others then
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
    v_items := v_items || jsonb_build_array(jsonb_build_object('canHardDelete', coalesce(v_item -> 'canHardDelete', 'false'::jsonb), 'blockers', coalesce(v_item -> 'blockers', '[]'::jsonb), 'controllrInterest', coalesce(v_item -> 'controllrInterest', 'false'::jsonb)));
  end loop;
  return jsonb_build_object('ok', true, 'count', cardinality(p_referral_ids), 'blocked', v_blocked, 'canHardDelete', v_blocked = 0, 'items', v_items, 'confirmation', 'EXCLUIR ' || cardinality(p_referral_ids)::text || ' REGISTROS');
end;
$$;

create or replace function public.admin_bulk_delete_referrals(
  p_referral_ids uuid[],
  p_reason text,
  p_confirmation text,
  p_idempotency_key text
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
  if p_confirmation is distinct from (v_preview ->> 'confirmation') then
    return jsonb_build_object('ok', false, 'code', 'confirmation_mismatch');
  end if;
  if (v_preview ->> 'canHardDelete')::boolean is not true then
    return jsonb_build_object('ok', false, 'code', 'bulk_blocked', 'blocked', v_preview -> 'blocked', 'items', v_preview -> 'items');
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
    perform public.admin_delete_referral_owned(v_id);
  end loop;
  perform public.admin_record_tombstone(v_operation, p_idempotency_key, 'bulk', v_sorted[1], (v_actor ->> 'actor')::uuid, v_actor ->> 'role', v_reason, cardinality(v_sorted), v_preview - 'items', 'none');
  return jsonb_build_object('ok', true, 'removedCount', cardinality(v_sorted), 'authAction', 'none');
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'bulk_blocked' then
      return jsonb_build_object('ok', false, 'code', 'bulk_blocked');
    end if;
    return jsonb_build_object('ok', false, 'code', 'delete_failed');
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
  v_active_links integer;
  v_revoked_links integer;
  v_rewards integer;
  v_wallet integer;
  v_withdrawals integer;
  v_payments integer;
  v_audit integer;
  v_employees integer;
  v_competences integer;
  v_notifications integer;
  v_ref uuid;
  v_facts jsonb;
  v_blockers jsonb := '[]'::jsonb;
begin
  select p.role::text, coalesce(p.is_controlled_test, false) into v_role, v_test
  from public.profiles p where p.id = p_id;
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_role is distinct from 'indicador' then
    return jsonb_build_object('ok', false, 'code', 'not_indicator');
  end if;
  select count(*) into v_referrals from public.referrals r where r.indicator_profile_id = p_id;
  for v_ref in select r.id from public.referrals r where r.indicator_profile_id = p_id loop
    v_facts := public.admin_referral_deletion_facts(v_ref);
    if (v_facts ->> 'canHardDelete')::boolean is not true then
      v_blocked := v_blocked + 1;
    end if;
  end loop;
  select count(*) filter (where l.status = 'active'), count(*) filter (where l.status = 'revoked')
    into v_active_links, v_revoked_links
  from public.referral_share_links l
  where l.origin_kind = 'indicator' and l.originator_id = p_id;
  select count(*) into v_rewards from public.rewards r where r.indicator_profile_id = p_id;
  select count(*) into v_wallet from public.wallet_transactions w where w.indicator_profile_id = p_id;
  select count(*) into v_withdrawals from public.wallet_transactions w where w.indicator_profile_id = p_id and w.transaction_type::text = 'saque';
  select count(*) into v_payments from public.payments p where p.indicator_profile_id = p_id;
  select count(*) into v_audit from public.finance_audit_events a where a.entity_id = p_id or a.actor_id = p_id;
  select count(*) into v_employees from public.employees e where e.profile_id = p_id;
  select count(*) into v_competences from public.payroll_competences c
    join public.employees e on e.id = c.employee_id where e.profile_id = p_id;
  select count(*) into v_notifications from public.notifications n where n.profile_id = p_id;
  if v_rewards > 0 then v_blockers := v_blockers || jsonb_build_array('reward'); end if;
  if v_wallet > 0 then v_blockers := v_blockers || jsonb_build_array('wallet'); end if;
  if v_withdrawals > 0 then v_blockers := v_blockers || jsonb_build_array('withdrawal'); end if;
  if v_payments > 0 then v_blockers := v_blockers || jsonb_build_array('payment'); end if;
  if v_blocked > 0 then v_blockers := v_blockers || jsonb_build_array('referral_not_eligible'); end if;
  if v_audit > 0 then v_blockers := v_blockers || jsonb_build_array('finance_audit'); end if;
  if v_employees > 0 or v_competences > 0 then v_blockers := v_blockers || jsonb_build_array('shared_dependency'); end if;
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
    'testRecord', v_test,
    'hasAuthAccount', true,
    'canHardDelete', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'preserveMessage', case when jsonb_array_length(v_blockers) > 0 then 'Registro preservado por vínculo financeiro' else null end
  );
end;
$$;

create or replace function public.admin_revoke_indicator_links(p_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.referral_share_links
    set status = 'revoked', is_primary = false, revoked_at = timezone('utc', now()), revoked_by = p_actor
  where origin_kind = 'indicator' and originator_id = p_id and status = 'active';
end;
$$;

create or replace function public.admin_redact_indicator(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles set
    full_name = 'Registro preservado por vínculo financeiro',
    email = 'preservado+' || substr(replace(id::text, '-', ''), 1, 16) || '@invalid.local',
    phone = 'REDACTED',
    cpf = null,
    cnpj = null,
    avatar_url = null,
    is_active = false,
    personal_data_redacted_at = timezone('utc', now())
  where id = p_id and role::text = 'indicador';
end;
$$;

create or replace function public.admin_preview_indicator_deletion(p_indicator_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb := public.admin_deletion_actor();
begin
  perform set_config('statement_timeout', '15000', true);
  if v_actor ->> 'ok' <> 'true' then return v_actor; end if;
  return public.admin_indicator_deletion_facts(p_indicator_id);
end;
$$;

create or replace function public.admin_delete_or_deactivate_indicator(
  p_indicator_id uuid,
  p_mode text,
  p_reason text,
  p_confirmation text,
  p_idempotency_key text,
  p_auth_confirmation text
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
  if p_mode not in ('hard_delete', 'deactivate') then
    return jsonb_build_object('ok', false, 'code', 'invalid_mode');
  end if;
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
      return jsonb_build_object('ok', false, 'code', 'hard_delete_blocked', 'blockers', v_facts -> 'blockers', 'preserveMessage', v_facts ->> 'preserveMessage');
    end if;
    for v_ref in select r.id from public.referrals r where r.indicator_profile_id = p_indicator_id order by r.id loop
      perform pg_advisory_xact_lock(hashtextextended('igt.j17.referral:' || v_ref::text, 0));
      if (public.admin_referral_deletion_facts(v_ref) ->> 'canHardDelete')::boolean is not true then
        raise exception 'hard_delete_blocked' using errcode = 'P0001';
      end if;
      perform public.admin_delete_referral_owned(v_ref);
      v_removed := v_removed + 1;
    end loop;
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
  return jsonb_build_object('ok', true, 'removedCount', v_removed, 'authAction', v_auth, 'preserveMessage', case when p_mode = 'deactivate' then 'Registro preservado por vínculo financeiro' else null end);
exception
  when sqlstate 'P0001' then
    if sqlerrm = 'hard_delete_blocked' then
      return jsonb_build_object('ok', false, 'code', 'hard_delete_blocked');
    end if;
    return jsonb_build_object('ok', false, 'code', 'delete_failed');
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'code', 'shared_dependency');
  when others then
    return jsonb_build_object('ok', false, 'code', 'delete_failed');
end;
$$;

revoke all on function public.admin_deletion_actor() from public, anon, authenticated;
revoke all on function public.admin_deletion_reason(text) from public, anon, authenticated;
revoke all on function public.admin_deletion_mask(text) from public, anon, authenticated;
revoke all on function public.admin_referral_deletion_facts(uuid) from public, anon, authenticated;
revoke all on function public.admin_delete_referral_owned(uuid) from public, anon, authenticated;
revoke all on function public.admin_redact_referral(uuid) from public, anon, authenticated;
revoke all on function public.admin_record_tombstone(uuid, text, text, uuid, uuid, text, text, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_indicator_deletion_facts(uuid) from public, anon, authenticated;
revoke all on function public.admin_revoke_indicator_links(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_redact_indicator(uuid) from public, anon, authenticated;

revoke all on function public.admin_preview_referral_deletion(uuid) from public, anon;
revoke all on function public.admin_delete_referral(uuid, text, text, text) from public, anon;
revoke all on function public.admin_deactivate_referral(uuid, text, text, text) from public, anon;
revoke all on function public.admin_preview_bulk_referral_deletion(uuid[]) from public, anon;
revoke all on function public.admin_bulk_delete_referrals(uuid[], text, text, text) from public, anon;
revoke all on function public.admin_preview_indicator_deletion(uuid) from public, anon;
revoke all on function public.admin_delete_or_deactivate_indicator(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.admin_preview_referral_deletion(uuid) to authenticated;
grant execute on function public.admin_delete_referral(uuid, text, text, text) to authenticated;
grant execute on function public.admin_deactivate_referral(uuid, text, text, text) to authenticated;
grant execute on function public.admin_preview_bulk_referral_deletion(uuid[]) to authenticated;
grant execute on function public.admin_bulk_delete_referrals(uuid[], text, text, text) to authenticated;
grant execute on function public.admin_preview_indicator_deletion(uuid) to authenticated;
grant execute on function public.admin_delete_or_deactivate_indicator(uuid, text, text, text, text, text) to authenticated;

commit;

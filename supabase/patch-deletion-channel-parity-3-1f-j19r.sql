-- 3.1F-J19R: a prévia e a exclusão usam a mesma exigência de motivo.
-- Motivo curto de registro real volta como reason_too_short, não como bulk_blocked.
-- Revisão enviada pela prévia bloqueia alteração concorrente. Revisão ausente permanece compatível.
-- Não chama Controllr, ERP, Sync, PIX nem pagamento.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.admin_deletion_reason_min(p_facts jsonb)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_facts ->> 'classification', '') = 'REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO' then 40
    else 20
  end;
$$;

create or replace function public.admin_deletion_revision(p_ids uuid[])
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select md5(coalesce((
    select string_agg(r.id::text || '|' || r.updated_at::text, ',' order by r.id)
    from public.referrals r
    where r.id = any(p_ids)
  ), ''));
$$;

revoke all on function public.admin_deletion_reason_min(jsonb) from public, anon, authenticated;
revoke all on function public.admin_deletion_revision(uuid[]) from public, anon, authenticated;

create or replace function public.admin_preview_referral_deletion(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb := public.admin_deletion_actor();
  v_facts jsonb;
begin
  perform set_config('statement_timeout', '15000', true);
  if v_actor ->> 'ok' <> 'true' then return v_actor; end if;
  v_facts := public.admin_referral_deletion_facts(p_referral_id);
  if v_facts ->> 'ok' <> 'true' then return v_facts; end if;
  return v_facts || jsonb_build_object(
    'reasonMin', public.admin_deletion_reason_min(v_facts),
    'revision', public.admin_deletion_revision(array[p_referral_id])
  );
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
  v_reason_min integer := 20;
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
    v_reason_min := greatest(v_reason_min, public.admin_deletion_reason_min(v_item));
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'canHardDelete', coalesce(v_item -> 'canHardDelete', 'false'::jsonb),
      'blockers', coalesce(v_item -> 'blockers', '[]'::jsonb),
      'classification', to_jsonb(coalesce(v_item ->> 'classification', 'REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO')),
      'reasonMin', public.admin_deletion_reason_min(v_item),
      'controllrInterest', coalesce(v_item -> 'controllrInterest', 'false'::jsonb)
    ));
  end loop;
  return jsonb_build_object(
    'ok', true,
    'count', cardinality(p_referral_ids),
    'blocked', v_blocked,
    'canHardDelete', v_blocked = 0,
    'financeConfirmationRequired', v_finance,
    'reasonMin', v_reason_min,
    'revision', public.admin_deletion_revision(p_referral_ids),
    'items', v_items,
    'confirmation', 'EXCLUIR SELECIONADOS'
  );
end;
$$;

drop function if exists public.admin_delete_referral(uuid, text, text, text, text);
drop function if exists public.admin_delete_referral(uuid, text, text, text);
create function public.admin_delete_referral(
  p_referral_id uuid,
  p_reason text,
  p_confirmation text,
  p_idempotency_key text,
  p_finance_confirmation text default null,
  p_revision text default null
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
    return jsonb_build_object('ok', false, 'code', case when v_facts ->> 'classification' = 'REGISTRO_COM_PAGAMENTO_EXTERNO' then 'external_payment' else 'hard_delete_blocked' end, 'blockers', v_facts -> 'blockers', 'classification', v_facts ->> 'classification', 'preserveMessage', v_facts ->> 'preserveMessage');
  end if;
  if char_length(v_reason) < public.admin_deletion_reason_min(v_facts) then
    return jsonb_build_object('ok', false, 'code', 'reason_too_short', 'reasonMin', public.admin_deletion_reason_min(v_facts));
  end if;
  if p_revision is not null and p_revision is distinct from public.admin_deletion_revision(array[p_referral_id]) then
    return jsonb_build_object('ok', false, 'code', 'stale_preview');
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
    return jsonb_build_object('ok', false, 'code', case sqlerrm when 'external_payment' then 'external_payment' else 'delete_failed' end, 'auditRef', v_operation, 'failureCode', sqlstate);
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'code', 'financial_dependency', 'auditRef', v_operation, 'failureCode', '23503');
  when others then
    return jsonb_build_object('ok', false, 'code', 'delete_failed', 'auditRef', v_operation, 'failureCode', sqlstate);
end;
$$;

drop function if exists public.admin_bulk_delete_referrals(uuid[], text, text, text, text);
drop function if exists public.admin_bulk_delete_referrals(uuid[], text, text, text);
create function public.admin_bulk_delete_referrals(
  p_referral_ids uuid[],
  p_reason text,
  p_confirmation text,
  p_idempotency_key text,
  p_finance_confirmation text default null,
  p_revision text default null
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
      return jsonb_build_object('ok', false, 'code', 'bulk_blocked', 'auditRef', v_operation);
    end if;
    if char_length(v_reason) < public.admin_deletion_reason_min(v_facts) then
      return jsonb_build_object('ok', false, 'code', 'reason_too_short', 'reasonMin', public.admin_deletion_reason_min(v_facts));
    end if;
  end loop;
  if p_revision is not null and p_revision is distinct from public.admin_deletion_revision(v_sorted) then
    return jsonb_build_object('ok', false, 'code', 'stale_preview');
  end if;
  foreach v_id in array v_sorted loop
    perform public.admin_purge_referral_internal(v_id);
    perform public.admin_delete_referral_owned(v_id);
  end loop;
  perform public.admin_record_tombstone(v_operation, p_idempotency_key, 'bulk', v_sorted[1], (v_actor ->> 'actor')::uuid, v_actor ->> 'role', v_reason, cardinality(v_sorted), v_preview - 'items', 'none');
  return jsonb_build_object('ok', true, 'removedCount', cardinality(v_sorted), 'authAction', 'none');
exception
  when sqlstate 'P0001' then
    return jsonb_build_object('ok', false, 'code', case sqlerrm when 'external_payment' then 'external_payment' else 'bulk_blocked' end, 'auditRef', v_operation, 'failureCode', sqlstate);
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'code', 'financial_dependency', 'auditRef', v_operation, 'failureCode', '23503');
  when others then
    return jsonb_build_object('ok', false, 'code', 'delete_failed', 'auditRef', v_operation, 'failureCode', sqlstate);
end;
$$;

revoke all on function public.admin_delete_referral(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.admin_bulk_delete_referrals(uuid[], text, text, text, text, text) from public, anon;
grant execute on function public.admin_delete_referral(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.admin_bulk_delete_referrals(uuid[], text, text, text, text, text) to authenticated;
grant execute on function public.admin_preview_referral_deletion(uuid) to authenticated;
grant execute on function public.admin_preview_bulk_referral_deletion(uuid[]) to authenticated;

-- Sprint 3.1E-L — persistência fenced da descoberta de atrasados
--
-- A lease_generation de 3.1E-K protegia só advance/release.
-- Esta migration envolve insert/update de caso, evento created e
-- atribuição 2.2 na mesma transação que valida a lease.
--
-- NÃO aplica em produção nesta sprint.
-- NÃO altera regras financeiras, status operacional nem metadata.
-- NÃO infere pagamento por ausência.
--
-- Rollback: DROP FUNCTION persist_collection_discovery_invoice;
--           DROP INDEX collection_case_events_created_once_uidx;

begin;

create unique index if not exists collection_case_events_created_once_uidx
  on public.collection_case_events (case_id)
  where event_type = 'created';

comment on index public.collection_case_events_created_once_uidx is
  'Impede segundo evento created no reprocessamento da mesma fatura.';

create or replace function public.persist_collection_discovery_invoice(
  p_run_id uuid,
  p_owner text,
  p_generation integer,
  p_actor_profile_id uuid,
  p_write_model jsonb,
  p_assign boolean,
  p_statement_timeout_ms integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_run public.collection_discovery_runs;
  v_pk text;
  v_case_id uuid;
  v_status text;
  v_inserted boolean := false;
  v_assign jsonb := null;
  v_assignment_id uuid;
  v_newly_assigned boolean := false;
begin
  if p_run_id is null or p_owner is null or length(trim(p_owner)) = 0
     or p_generation is null or p_write_model is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if p_statement_timeout_ms is not null and p_statement_timeout_ms > 0 then
    perform set_config('statement_timeout', p_statement_timeout_ms::text, true);
  end if;

  select * into v_run
  from public.collection_discovery_runs
  where id = p_run_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_run.lease_owner is distinct from p_owner
     or v_run.lease_generation is distinct from p_generation
     or v_run.status is distinct from 'running'
     or v_run.lease_until is null
     or v_run.lease_until <= v_now then
    return jsonb_build_object('ok', false, 'code', 'stale_lease');
  end if;

  v_pk := nullif(btrim(p_write_model ->> 'invoice_pk'), '');
  if v_pk is null or v_pk !~ '^[1-9][0-9]*$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  insert into public.collection_cases (
    client_pk,
    contract_pk,
    invoice_pk,
    customer_name,
    customer_document,
    days_overdue,
    overdue_since,
    outstanding_amount,
    status,
    erp_snapshot
  ) values (
    p_write_model ->> 'client_pk',
    p_write_model ->> 'contract_pk',
    v_pk,
    p_write_model ->> 'customer_name',
    p_write_model ->> 'customer_document',
    coalesce((p_write_model ->> 'days_overdue')::integer, 0),
    nullif(p_write_model ->> 'overdue_since', '')::date,
    nullif(p_write_model ->> 'outstanding_amount', '')::numeric,
    'open',
    coalesce(p_write_model -> 'erp_snapshot', '{}'::jsonb)
  )
  on conflict (invoice_pk) where invoice_pk is not null
  do nothing
  returning id into v_case_id;

  if v_case_id is null then
    select id, status into v_case_id, v_status
    from public.collection_cases
    where invoice_pk = v_pk;

    if v_case_id is null then
      return jsonb_build_object('ok', false, 'code', 'persist_error');
    end if;

    update public.collection_cases
    set client_pk = p_write_model ->> 'client_pk',
        contract_pk = p_write_model ->> 'contract_pk',
        customer_name = p_write_model ->> 'customer_name',
        customer_document = p_write_model ->> 'customer_document',
        days_overdue = coalesce((p_write_model ->> 'days_overdue')::integer, days_overdue),
        overdue_since = coalesce(nullif(p_write_model ->> 'overdue_since', '')::date, overdue_since),
        outstanding_amount = coalesce(nullif(p_write_model ->> 'outstanding_amount', '')::numeric, outstanding_amount),
        erp_snapshot = coalesce(p_write_model -> 'erp_snapshot', erp_snapshot)
    where id = v_case_id;
  else
    v_inserted := true;
    v_status := 'open';
    insert into public.collection_case_events (
      case_id,
      event_type,
      actor_profile_id,
      new_value,
      metadata
    )
    values (
      v_case_id,
      'created',
      p_actor_profile_id,
      jsonb_build_object('invoice_pk', v_pk, 'status', 'open'),
      jsonb_build_object('source', 'collections_controllr_discovery')
    )
    on conflict (case_id) where event_type = 'created'
    do nothing;
  end if;

  if p_assign is true
     and coalesce(v_status, 'open') is distinct from 'escalated_retention'
     and to_regprocedure('public.assign_sector_work_item(text, text, uuid, uuid, jsonb)') is not null then
    v_assign := public.assign_sector_work_item(
      'collections',
      'collection_case',
      v_case_id,
      p_actor_profile_id,
      jsonb_build_object('source', 'collection_sync')
    );
    if (v_assign ->> 'ok') = 'true' and nullif(v_assign ->> 'assignment_id', '') is not null then
      v_assignment_id := (v_assign ->> 'assignment_id')::uuid;
      v_newly_assigned := (v_assign ->> 'code') = 'assigned';
      update public.collection_cases
      set sector_assignment_id = v_assignment_id
      where id = v_case_id
        and sector_assignment_id is distinct from v_assignment_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', case when v_inserted then 'created' else 'updated' end,
    'inserted', v_inserted,
    'caseId', v_case_id,
    'status', v_status,
    'newlyAssigned', v_newly_assigned,
    'assignmentId', v_assignment_id,
    'unassigned', v_assignment_id is null and p_assign is true and coalesce(v_status, 'open') is distinct from 'escalated_retention'
  );
end;
$$;

comment on function public.persist_collection_discovery_invoice(uuid, text, integer, uuid, jsonb, boolean, integer) is
  'Persiste fatura da descoberta só com lease/generation vigentes. Worker antigo recebe stale_lease. service_role only.';

revoke all on function public.persist_collection_discovery_invoice(uuid, text, integer, uuid, jsonb, boolean, integer) from public;
revoke all on function public.persist_collection_discovery_invoice(uuid, text, integer, uuid, jsonb, boolean, integer) from anon;
revoke all on function public.persist_collection_discovery_invoice(uuid, text, integer, uuid, jsonb, boolean, integer) from authenticated;
grant execute on function public.persist_collection_discovery_invoice(uuid, text, integer, uuid, jsonb, boolean, integer) to service_role;

commit;

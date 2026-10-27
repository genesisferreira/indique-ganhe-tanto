-- Sprint 3.1E-AU — Cobrança: lote operacional por CONTRATO com várias faturas.
--
-- ADITIVA e transacional. Sem DELETE de dados, sem resetar run, sem editar
-- cursor, sem tocar a fila. NÃO APLICAR REMOTAMENTE sem release review.
-- Depende de: patch-collection-ar-operational-batch.sql (collection_case_invoices).
--
-- LIMITAÇÃO FORMAL (CUSTOMER_DEDUPLICATION_SCOPE = contract_only):
--   client_pk não comprovado em invoice/list nem invoice_info; não há consulta
--   oficial contract→client. Nunca usar nome/CPF/telefone/endereço/e-mail como
--   chave. Um cliente com dois contratos pode aparecer em dois blocos.
--
-- Modelo:
--   * um caso ATIVO por contract_pk (status open/in_contact/promise_to_pay/unresolved);
--   * faturas do mesmo contrato vinculam ao mesmo caso (collection_case_invoices);
--   * contrato que volta a ficar inadimplente após caso fechado → NOVO ciclo
--     (novo caso); casos fechados permanecem no histórico;
--   * vínculo legado collection_cases.invoice_pk preservado (fatura âncora).
--
-- Rollback (sem apagar efeitos persistidos):
--   * código: voltar a chamar persist_collection_discovery_invoice (permanece);
--   * schema: as funções novas podem ser removidas; tabelas/colunas novas
--     permanecem (não apagar casos/eventos/assignments/vínculos sem auditoria);
--   * rollback de código NÃO desfaz casos, eventos ou vínculos já gravados.

begin;

-- ------------------------------------------------------------------
-- 1) collection_cases: unidade do caso + vencimento de promessa/retorno
-- ------------------------------------------------------------------
alter table public.collection_cases
  add column if not exists case_unit text not null default 'invoice',
  add column if not exists contract_status integer,
  add column if not exists follow_up_due_at timestamptz;

alter table public.collection_cases
  drop constraint if exists collection_cases_case_unit_chk;
alter table public.collection_cases
  add constraint collection_cases_case_unit_chk check (case_unit in ('invoice', 'contract'));

comment on column public.collection_cases.case_unit is
  'invoice = caso legado por fatura; contract = caso operacional por contract_pk (3.1E-AU).';
comment on column public.collection_cases.follow_up_due_at is
  'Vencimento da promessa/retorno. Futuro válido não ocupa capacidade; vencido ocupa.';

-- Um caso ativo por contrato (casos novos). Casos legados são tratados pela
-- RPC sob advisory lock por contrato (anexa ao legado ativo existente).
create unique index if not exists collection_cases_active_contract_uidx
  on public.collection_cases (contract_pk)
  where case_unit = 'contract'
    and status in ('open', 'in_contact', 'promise_to_pay', 'unresolved');

create index if not exists collection_cases_contract_status_idx
  on public.collection_cases (contract_pk, status)
  where contract_pk is not null;

-- ------------------------------------------------------------------
-- 2) collection_case_invoices: updated_at + sem DELETE
-- ------------------------------------------------------------------
drop trigger if exists trg_collection_case_invoices_set_updated_at on public.collection_case_invoices;
create trigger trg_collection_case_invoices_set_updated_at
before update on public.collection_case_invoices
for each row execute function public.set_updated_at();

create or replace function public.trg_collection_case_invoices_no_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'collection_case_invoices é histórico: DELETE proibido';
end;
$$;

drop trigger if exists trg_collection_case_invoices_no_delete on public.collection_case_invoices;
create trigger trg_collection_case_invoices_no_delete
before delete on public.collection_case_invoices
for each row execute function public.trg_collection_case_invoices_no_delete();

-- ------------------------------------------------------------------
-- 3) payment_detected idempotente POR FATURA (antes: por caso)
-- ------------------------------------------------------------------
create unique index if not exists collection_case_events_payment_detected_invoice_uidx
  on public.collection_case_events (case_id, (coalesce(new_value ->> 'invoice_pk', '')))
  where event_type = 'payment_detected';

drop index if exists public.collection_case_events_payment_detected_once_uidx;

-- ------------------------------------------------------------------
-- 4) Trava de contato por CONTRATO (nunca por cliente/PII)
-- ------------------------------------------------------------------
create table if not exists public.collection_contract_contact_locks (
  contract_pk text primary key,
  case_id uuid not null references public.collection_cases(id) on delete restrict,
  holder_profile_id uuid not null,
  lock_generation integer not null default 1,
  acquired_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint collection_contract_contact_locks_pk_chk check (contract_pk ~ '^[1-9][0-9]*$'),
  constraint collection_contract_contact_locks_gen_chk check (lock_generation >= 1)
);

create table if not exists public.collection_contract_lock_events (
  id uuid primary key default gen_random_uuid(),
  contract_pk text not null,
  case_id uuid not null references public.collection_cases(id) on delete restrict,
  event_type text not null,
  from_profile_id uuid,
  to_profile_id uuid,
  lock_generation integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint collection_contract_lock_events_type_chk check (
    event_type in ('acquired', 'renewed', 'released', 'transferred', 'recovered_expired')
  )
);

create index if not exists collection_contract_lock_events_contract_idx
  on public.collection_contract_lock_events (contract_pk, created_at desc);

alter table public.collection_contract_contact_locks enable row level security;
alter table public.collection_contract_lock_events enable row level security;
revoke all on table public.collection_contract_contact_locks from public, anon, authenticated;
revoke all on table public.collection_contract_lock_events from public, anon, authenticated;
grant select on table public.collection_contract_contact_locks to service_role;
grant select on table public.collection_contract_lock_events to service_role;

drop trigger if exists trg_collection_contract_contact_locks_set_updated_at on public.collection_contract_contact_locks;
create trigger trg_collection_contract_contact_locks_set_updated_at
before update on public.collection_contract_contact_locks
for each row execute function public.set_updated_at();

create or replace function public.acquire_collection_contract_lock(
  p_case_id uuid,
  p_profile_id uuid,
  p_ttl_seconds integer default 900
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_case public.collection_cases;
  v_lock public.collection_contract_contact_locks;
  v_ttl integer := least(greatest(coalesce(p_ttl_seconds, 900), 30), 7200);
begin
  if p_case_id is null or p_profile_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  select * into v_case from public.collection_cases where id = p_case_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_case.contract_pk is null or v_case.contract_pk !~ '^[1-9][0-9]*$' then
    -- caso legado sem contrato comprovado: sem escopo de trava por contrato.
    return jsonb_build_object('ok', true, 'code', 'no_contract_scope', 'generation', 0);
  end if;

  perform pg_advisory_xact_lock(872147, hashtext(v_case.contract_pk));

  select * into v_lock
  from public.collection_contract_contact_locks
  where contract_pk = v_case.contract_pk
  for update;

  if not found then
    insert into public.collection_contract_contact_locks (
      contract_pk, case_id, holder_profile_id, lock_generation, acquired_at, expires_at
    ) values (
      v_case.contract_pk, v_case.id, p_profile_id, 1, v_now,
      v_now + make_interval(secs => v_ttl)
    ) returning * into v_lock;
    insert into public.collection_contract_lock_events (contract_pk, case_id, event_type, to_profile_id, lock_generation)
    values (v_lock.contract_pk, v_case.id, 'acquired', p_profile_id, v_lock.lock_generation);
    return jsonb_build_object('ok', true, 'code', 'acquired', 'generation', v_lock.lock_generation,
                              'expiresAt', v_lock.expires_at);
  end if;

  if v_lock.holder_profile_id = p_profile_id and v_lock.expires_at > v_now then
    update public.collection_contract_contact_locks
    set expires_at = v_now + make_interval(secs => v_ttl), case_id = v_case.id
    where contract_pk = v_lock.contract_pk
    returning * into v_lock;
    insert into public.collection_contract_lock_events (contract_pk, case_id, event_type, to_profile_id, lock_generation)
    values (v_lock.contract_pk, v_case.id, 'renewed', p_profile_id, v_lock.lock_generation);
    return jsonb_build_object('ok', true, 'code', 'renewed', 'generation', v_lock.lock_generation,
                              'expiresAt', v_lock.expires_at);
  end if;

  if v_lock.expires_at <= v_now then
    update public.collection_contract_contact_locks
    set holder_profile_id = p_profile_id,
        case_id = v_case.id,
        lock_generation = v_lock.lock_generation + 1,
        acquired_at = v_now,
        expires_at = v_now + make_interval(secs => v_ttl)
    where contract_pk = v_lock.contract_pk
    returning * into v_lock;
    insert into public.collection_contract_lock_events (
      contract_pk, case_id, event_type, from_profile_id, to_profile_id, lock_generation
    ) values (v_lock.contract_pk, v_case.id, 'recovered_expired', null, p_profile_id, v_lock.lock_generation);
    return jsonb_build_object('ok', true, 'code', 'recovered_expired', 'generation', v_lock.lock_generation,
                              'expiresAt', v_lock.expires_at);
  end if;

  return jsonb_build_object('ok', false, 'code', 'locked_by_other', 'expiresAt', v_lock.expires_at);
end;
$$;

create or replace function public.release_collection_contract_lock(
  p_case_id uuid,
  p_profile_id uuid,
  p_generation integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.collection_cases;
  v_lock public.collection_contract_contact_locks;
begin
  select * into v_case from public.collection_cases where id = p_case_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_case.contract_pk is null or v_case.contract_pk !~ '^[1-9][0-9]*$' then
    return jsonb_build_object('ok', true, 'code', 'no_contract_scope');
  end if;
  perform pg_advisory_xact_lock(872147, hashtext(v_case.contract_pk));
  select * into v_lock from public.collection_contract_contact_locks
  where contract_pk = v_case.contract_pk for update;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'already_released');
  end if;
  if v_lock.holder_profile_id is distinct from p_profile_id
     or v_lock.lock_generation is distinct from p_generation then
    return jsonb_build_object('ok', false, 'code', 'stale_lock');
  end if;
  -- libera expirando agora (sem DELETE: histórico preservado em eventos).
  update public.collection_contract_contact_locks
  set expires_at = timezone('utc', now())
  where contract_pk = v_lock.contract_pk;
  insert into public.collection_contract_lock_events (contract_pk, case_id, event_type, from_profile_id, lock_generation)
  values (v_lock.contract_pk, v_lock.case_id, 'released', p_profile_id, v_lock.lock_generation);
  return jsonb_build_object('ok', true, 'code', 'released');
end;
$$;

create or replace function public.transfer_collection_contract_lock(
  p_case_id uuid,
  p_from_profile_id uuid,
  p_to_profile_id uuid,
  p_force boolean default false,
  p_ttl_seconds integer default 900
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_case public.collection_cases;
  v_lock public.collection_contract_contact_locks;
  v_ttl integer := least(greatest(coalesce(p_ttl_seconds, 900), 30), 7200);
begin
  if p_case_id is null or p_to_profile_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  select * into v_case from public.collection_cases where id = p_case_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_case.contract_pk is null or v_case.contract_pk !~ '^[1-9][0-9]*$' then
    return jsonb_build_object('ok', true, 'code', 'no_contract_scope');
  end if;
  perform pg_advisory_xact_lock(872147, hashtext(v_case.contract_pk));
  select * into v_lock from public.collection_contract_contact_locks
  where contract_pk = v_case.contract_pk for update;
  if not found then
    return public.acquire_collection_contract_lock(p_case_id, p_to_profile_id, v_ttl);
  end if;
  if not coalesce(p_force, false)
     and v_lock.expires_at > v_now
     and v_lock.holder_profile_id is distinct from p_from_profile_id then
    return jsonb_build_object('ok', false, 'code', 'not_holder');
  end if;
  update public.collection_contract_contact_locks
  set holder_profile_id = p_to_profile_id,
      case_id = v_case.id,
      lock_generation = v_lock.lock_generation + 1,
      acquired_at = v_now,
      expires_at = v_now + make_interval(secs => v_ttl)
  where contract_pk = v_lock.contract_pk
  returning * into v_lock;
  insert into public.collection_contract_lock_events (
    contract_pk, case_id, event_type, from_profile_id, to_profile_id, lock_generation
  ) values (v_lock.contract_pk, v_case.id, 'transferred', p_from_profile_id, p_to_profile_id, v_lock.lock_generation);
  return jsonb_build_object('ok', true, 'code', 'transferred', 'generation', v_lock.lock_generation);
end;
$$;

-- ------------------------------------------------------------------
-- 5) Persistência fenced POR CONTRATO
-- ------------------------------------------------------------------
create or replace function public.persist_collection_contract_invoice(
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
  v_contract text;
  v_contract_status integer;
  v_days integer;
  v_due date;
  v_snapshot jsonb;
  v_link public.collection_case_invoices;
  v_case public.collection_cases;
  v_case_id uuid;
  v_assign jsonb := null;
  v_assignment_id uuid;
  v_newly_assigned boolean := false;
  v_open text[] := array['open', 'in_contact', 'promise_to_pay', 'unresolved'];
begin
  if p_run_id is null or p_owner is null or length(trim(p_owner)) = 0
     or p_generation is null or p_write_model is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if p_statement_timeout_ms is not null and p_statement_timeout_ms > 0 then
    perform set_config('statement_timeout', p_statement_timeout_ms::text, true);
  end if;

  select * into v_run from public.collection_discovery_runs where id = p_run_id for update;
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

  v_contract := nullif(btrim(p_write_model ->> 'contract_pk'), '');
  if v_contract is null or v_contract !~ '^[1-9][0-9]*$' then
    -- sem contract_pk comprovado: não agrupa, não inventa, não cria caso.
    return jsonb_build_object('ok', true, 'code', 'inconclusive', 'inserted', false);
  end if;

  if jsonb_typeof(p_write_model -> 'contract_status') = 'number' then
    v_contract_status := (p_write_model ->> 'contract_status')::integer;
  end if;
  v_days := coalesce((p_write_model ->> 'days_overdue')::integer, 0);
  v_due := nullif(p_write_model ->> 'overdue_since', '')::date;
  v_snapshot := coalesce(p_write_model -> 'erp_snapshot', '{}'::jsonb);

  -- serializa por contrato: impede dois casos ativos simultâneos.
  perform pg_advisory_xact_lock(872146, hashtext(v_contract));

  select * into v_link from public.collection_case_invoices where invoice_pk = v_pk for update;
  if found then
    select * into v_case from public.collection_cases where id = v_link.case_id for update;
    if v_case.status <> all (v_open) then
      return jsonb_build_object('ok', true, 'code', 'already_resolved', 'inserted', false, 'caseId', v_case.id);
    end if;
    if v_contract_status = 5 then
      update public.collection_case_invoices
      set payment_status = case when payment_status = 'paid' then 'paid' else 'cancelled_contract' end,
          last_seen_at = v_now
      where id = v_link.id;
      update public.collection_cases set contract_status = 5 where id = v_case.id;
      return jsonb_build_object('ok', true, 'code', 'cancelled_contract', 'inserted', false, 'caseId', v_case.id);
    end if;
    update public.collection_case_invoices
    set contract_pk = coalesce(contract_pk, v_contract),
        due_date = coalesce(v_due, due_date),
        days_overdue = v_days,
        invoice_snapshot = v_snapshot,
        last_seen_at = v_now
    where id = v_link.id;
    update public.collection_cases
    set days_overdue = greatest(days_overdue, v_days),
        contract_status = coalesce(v_contract_status, contract_status)
    where id = v_case.id;
    return jsonb_build_object('ok', true, 'code', 'invoice_updated', 'inserted', false, 'caseId', v_case.id);
  end if;

  if v_contract_status = 5 then
    return jsonb_build_object('ok', true, 'code', 'cancelled_contract', 'inserted', false);
  end if;

  -- caso legado ancorado nesta fatura (anterior ao backfill)
  select * into v_case from public.collection_cases where invoice_pk = v_pk for update;
  if found then
    if v_case.status <> all (v_open) then
      return jsonb_build_object('ok', true, 'code', 'already_resolved', 'inserted', false, 'caseId', v_case.id);
    end if;
  else
    -- caso ativo do contrato (contrato novo ou legado). Preferência: unidade contract.
    select * into v_case
    from public.collection_cases
    where contract_pk = v_contract
      and status = any (v_open)
    order by (case_unit = 'contract') desc, created_at, id
    limit 1
    for update;
  end if;

  if found then
    insert into public.collection_case_invoices (
      case_id, invoice_pk, contract_pk, due_date, payment_status, days_overdue,
      invoice_snapshot, first_seen_at, last_seen_at
    ) values (
      v_case.id, v_pk, v_contract, v_due, 'open', v_days, v_snapshot, v_now, v_now
    )
    on conflict (invoice_pk) do nothing;
    -- preserva status manual, responsável e metadata; sem created/assignment.
    update public.collection_cases
    set days_overdue = greatest(days_overdue, v_days),
        overdue_since = least(coalesce(overdue_since, v_due), coalesce(v_due, overdue_since)),
        contract_pk = coalesce(contract_pk, v_contract),
        contract_status = coalesce(v_contract_status, contract_status)
    where id = v_case.id;
    return jsonb_build_object('ok', true, 'code', 'invoice_attached', 'inserted', false, 'caseId', v_case.id);
  end if;

  -- contrato sem caso ativo → novo ciclo (casos fechados ficam no histórico)
  insert into public.collection_cases (
    client_pk, contract_pk, invoice_pk, customer_name, customer_document,
    days_overdue, overdue_since, outstanding_amount, status, erp_snapshot,
    case_unit, contract_status
  ) values (
    null,
    v_contract,
    v_pk,
    p_write_model ->> 'customer_name',
    p_write_model ->> 'customer_document',
    v_days,
    v_due,
    nullif(p_write_model ->> 'outstanding_amount', '')::numeric,
    'open',
    v_snapshot,
    'contract',
    v_contract_status
  )
  returning id into v_case_id;

  insert into public.collection_case_invoices (
    case_id, invoice_pk, contract_pk, due_date, payment_status, days_overdue,
    invoice_snapshot, first_seen_at, last_seen_at
  ) values (
    v_case_id, v_pk, v_contract, v_due, 'open', v_days, v_snapshot, v_now, v_now
  );

  insert into public.collection_case_events (case_id, event_type, actor_profile_id, new_value, metadata)
  values (
    v_case_id, 'created', p_actor_profile_id,
    jsonb_build_object('invoice_pk', v_pk, 'status', 'open', 'case_unit', 'contract'),
    jsonb_build_object('source', 'collections_controllr_discovery', 'customer_deduplication_scope', 'contract_only')
  )
  on conflict (case_id) where event_type = 'created' do nothing;

  if p_assign is true
     and to_regprocedure('public.assign_sector_work_item(text, text, uuid, uuid, jsonb)') is not null then
    v_assign := public.assign_sector_work_item(
      'collections', 'collection_case', v_case_id, p_actor_profile_id,
      jsonb_build_object('source', 'collection_sync')
    );
    if (v_assign ->> 'ok') = 'true' and nullif(v_assign ->> 'assignment_id', '') is not null then
      v_assignment_id := (v_assign ->> 'assignment_id')::uuid;
      v_newly_assigned := (v_assign ->> 'code') = 'assigned';
      update public.collection_cases
      set sector_assignment_id = v_assignment_id
      where id = v_case_id and sector_assignment_id is distinct from v_assignment_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'case_created',
    'inserted', true,
    'caseId', v_case_id,
    'newlyAssigned', v_newly_assigned,
    'assignmentId', v_assignment_id,
    'unassigned', v_assignment_id is null and p_assign is true
  );
end;
$$;

-- ------------------------------------------------------------------
-- 6) Reconciliação por FATURA: pagamento parcial não fecha o caso
-- ------------------------------------------------------------------
create or replace function public.list_open_collection_cases_after(
  p_run_id uuid,
  p_owner text,
  p_generation integer,
  p_after_invoice_pk text,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_run public.collection_discovery_runs;
  v_limit integer := least(greatest(coalesce(p_limit, 15), 1), 15);
  v_cases jsonb;
begin
  if p_run_id is null or p_owner is null or p_generation is null
     or (p_after_invoice_pk is not null and p_after_invoice_pk !~ '^[1-9][0-9]*$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  select * into v_run from public.collection_discovery_runs where id = p_run_id;
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

  select coalesce(jsonb_agg(row_json order by pk_num), '[]'::jsonb)
  into v_cases
  from (
    select jsonb_build_object('id', x.case_id, 'status', x.status, 'invoicePk', x.invoice_pk) as row_json,
           x.invoice_pk::numeric as pk_num
    from (
      select i.case_id, c.status, i.invoice_pk
      from public.collection_case_invoices i
      join public.collection_cases c on c.id = i.case_id
      where i.payment_status = 'open'
        and c.status in ('open', 'in_contact', 'promise_to_pay', 'unresolved')
      union
      select c.id, c.status, c.invoice_pk
      from public.collection_cases c
      where c.invoice_pk ~ '^[1-9][0-9]*$'
        and c.status in ('open', 'in_contact', 'promise_to_pay', 'unresolved')
        and not exists (select 1 from public.collection_case_invoices i2 where i2.invoice_pk = c.invoice_pk)
    ) x
    where x.invoice_pk ~ '^[1-9][0-9]*$'
      and (p_after_invoice_pk is null or x.invoice_pk::numeric > p_after_invoice_pk::numeric)
    order by x.invoice_pk::numeric
    limit v_limit
  ) listed;

  return jsonb_build_object('ok', true, 'code', 'listed', 'cases', v_cases);
end;
$$;

create or replace function public.reconcile_collection_case_paid(
  p_run_id uuid,
  p_owner text,
  p_generation integer,
  p_actor_profile_id uuid,
  p_case_id uuid,
  p_invoice_pk text,
  p_evidence jsonb default '{}'::jsonb,
  p_statement_timeout_ms integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_run public.collection_discovery_runs;
  v_case public.collection_cases;
  v_link public.collection_case_invoices;
  v_asg public.sector_work_assignments;
  v_event_inserted boolean := false;
  v_inserted int;
  v_pending int;
begin
  if p_run_id is null or p_owner is null or length(trim(p_owner)) = 0
     or p_generation is null or p_case_id is null
     or p_invoice_pk is null or p_invoice_pk !~ '^[1-9][0-9]*$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  if p_statement_timeout_ms is not null and p_statement_timeout_ms > 0 then
    perform set_config('statement_timeout', p_statement_timeout_ms::text, true);
  end if;

  select * into v_run from public.collection_discovery_runs where id = p_run_id for update;
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

  select * into v_case from public.collection_cases where id = p_case_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select * into v_link from public.collection_case_invoices where invoice_pk = p_invoice_pk for update;
  if found then
    if v_link.case_id is distinct from v_case.id then
      return jsonb_build_object('ok', false, 'code', 'identity_mismatch', 'caseId', v_case.id);
    end if;
  elsif v_case.invoice_pk is distinct from p_invoice_pk then
    return jsonb_build_object('ok', false, 'code', 'identity_mismatch', 'caseId', v_case.id);
  end if;

  if v_case.status = 'paid' then
    return jsonb_build_object('ok', true, 'code', 'already_paid', 'closed', false, 'alreadyPaid', true,
                              'eventInserted', false, 'caseId', v_case.id, 'assigned', false);
  end if;
  if v_case.status not in ('open', 'in_contact', 'promise_to_pay', 'unresolved') then
    return jsonb_build_object('ok', true, 'code', 'skipped_terminal', 'closed', false, 'alreadyPaid', false,
                              'eventInserted', false, 'caseId', v_case.id, 'assigned', false);
  end if;

  if v_link.id is not null then
    update public.collection_case_invoices
    set payment_status = 'paid',
        resolved_at = coalesce(resolved_at, v_now),
        credit_date = coalesce(nullif(p_evidence ->> 'invoice_date_credit', '')::date, credit_date),
        last_seen_at = v_now
    where id = v_link.id;
  end if;

  insert into public.collection_case_events (case_id, event_type, actor_profile_id, old_value, new_value, metadata)
  values (
    v_case.id, 'payment_detected', p_actor_profile_id,
    jsonb_build_object('status', v_case.status),
    jsonb_build_object('invoice_pk', p_invoice_pk, 'payment_status', 'paid'),
    jsonb_build_object('source', 'collections_controllr_reconciliation')
  )
  on conflict (case_id, (coalesce(new_value ->> 'invoice_pk', ''))) where event_type = 'payment_detected'
  do nothing;
  get diagnostics v_inserted = row_count;
  v_event_inserted := v_inserted > 0;

  -- fecha só quando TODAS as faturas aplicáveis estão positivamente pagas.
  select count(*) into v_pending
  from public.collection_case_invoices
  where case_id = v_case.id and payment_status <> 'paid';

  if v_pending > 0 then
    return jsonb_build_object('ok', true, 'code', 'partial_paid', 'closed', false, 'alreadyPaid', false,
                              'eventInserted', v_event_inserted, 'caseId', v_case.id, 'assigned', false,
                              'pending', v_pending);
  end if;

  update public.collection_cases
  set status = 'paid',
      closed_at = coalesce(closed_at, v_now),
      erp_snapshot = coalesce(erp_snapshot, '{}'::jsonb) || coalesce(p_evidence, '{}'::jsonb)
  where id = v_case.id
    and status in ('open', 'in_contact', 'promise_to_pay', 'unresolved');
  if not found then
    return jsonb_build_object('ok', false, 'code', 'persist_error');
  end if;

  if to_regprocedure('public.release_sector_assignment(uuid, text, uuid, text)') is not null then
    select * into v_asg
    from public.sector_work_assignments
    where work_type = 'collection_case' and work_id = v_case.id and status = 'active'
    for update;
    if found then
      perform public.release_sector_assignment(v_asg.id, 'completed', p_actor_profile_id, 'payment_detected');
      update public.collection_cases set sector_assignment_id = null where id = v_case.id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'code', 'closed', 'closed', true, 'alreadyPaid', false,
                            'eventInserted', v_event_inserted, 'caseId', v_case.id, 'assigned', false);
end;
$$;

-- ------------------------------------------------------------------
-- 7) Capacidade por contrato distinto + relatório de backfill (agregados)
-- ------------------------------------------------------------------
create or replace function public.collection_contract_capacity_summary(
  p_now timestamptz default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_configured integer;
  v_raw text;
  v_keyed integer;
  v_unkeyed integer;
  v_future_promises integer;
  v_running boolean;
begin
  select settings ->> 'active_contract_capacity' into v_raw
  from public.operational_sector_settings where sector_code = 'collections';
  v_configured := case when v_raw ~ '^[0-9]{1,3}$' then least(v_raw::integer, 200) else 15 end;

  with occ as (
    select c.contract_pk
    from public.collection_cases c
    where c.status in ('open', 'in_contact', 'unresolved')
       or (c.status = 'promise_to_pay' and (c.follow_up_due_at is null or c.follow_up_due_at <= v_now))
  )
  select count(distinct contract_pk) filter (where contract_pk ~ '^[1-9][0-9]*$'),
         count(*) filter (where contract_pk is null or contract_pk !~ '^[1-9][0-9]*$')
  into v_keyed, v_unkeyed
  from occ;

  select count(*) into v_future_promises
  from public.collection_cases
  where status = 'promise_to_pay' and follow_up_due_at > v_now;

  select exists (
    select 1 from public.collection_discovery_runs
    where status = 'running' and lease_until is not null and lease_until > v_now
  ) into v_running;

  return jsonb_build_object(
    'configured', v_configured,
    'occupying', v_keyed + v_unkeyed,
    'unkeyed', v_unkeyed,
    'available', greatest(0, v_configured - (v_keyed + v_unkeyed)),
    'futurePromises', v_future_promises,
    'futureCallbacks', 0,
    'busy', v_running,
    'scope', 'contract_only'
  );
end;
$$;

create or replace function public.collection_case_invoice_backfill_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'casesTotal', (select count(*) from public.collection_cases),
    'casesWithValidInvoicePk', (select count(*) from public.collection_cases where invoice_pk ~ '^[1-9][0-9]*$'),
    'casesLinked', (select count(distinct case_id) from public.collection_case_invoices),
    'casesWithoutContractPk', (select count(*) from public.collection_cases
                               where contract_pk is null or contract_pk !~ '^[1-9][0-9]*$'),
    'contractsWithMultipleActiveCases', (
      select count(*) from (
        select contract_pk from public.collection_cases
        where contract_pk ~ '^[1-9][0-9]*$'
          and status in ('open', 'in_contact', 'promise_to_pay', 'unresolved')
        group by contract_pk having count(*) > 1
      ) d
    )
  );
$$;

-- ------------------------------------------------------------------
-- 8) Permissões: service_role only
-- ------------------------------------------------------------------
revoke all on function public.acquire_collection_contract_lock(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.acquire_collection_contract_lock(uuid, uuid, integer) to service_role;
revoke all on function public.release_collection_contract_lock(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.release_collection_contract_lock(uuid, uuid, integer) to service_role;
revoke all on function public.transfer_collection_contract_lock(uuid, uuid, uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.transfer_collection_contract_lock(uuid, uuid, uuid, boolean, integer) to service_role;
revoke all on function public.persist_collection_contract_invoice(uuid, text, integer, uuid, jsonb, boolean, integer) from public, anon, authenticated;
grant execute on function public.persist_collection_contract_invoice(uuid, text, integer, uuid, jsonb, boolean, integer) to service_role;
revoke all on function public.list_open_collection_cases_after(uuid, text, integer, text, integer) from public, anon, authenticated;
grant execute on function public.list_open_collection_cases_after(uuid, text, integer, text, integer) to service_role;
revoke all on function public.reconcile_collection_case_paid(uuid, text, integer, uuid, uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.reconcile_collection_case_paid(uuid, text, integer, uuid, uuid, text, jsonb, integer) to service_role;
revoke all on function public.collection_contract_capacity_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.collection_contract_capacity_summary(timestamptz) to service_role;
revoke all on function public.collection_case_invoice_backfill_report() from public, anon, authenticated;
grant execute on function public.collection_case_invoice_backfill_report() to service_role;
revoke all on function public.trg_collection_case_invoices_no_delete() from public, anon, authenticated;

commit;

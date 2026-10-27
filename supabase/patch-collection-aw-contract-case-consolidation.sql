-- Sprint 3.1E-AW - Cobrança: consolidação auditável de casos legados duplicados
-- por contrato (modelo antigo: um caso por fatura; modelo novo: um caso ATIVO
-- por contract_pk).
--
-- ADITIVA e transacional. NÃO consolida nada durante a instalação, NÃO contém
-- IDs de produção, NÃO faz UPDATE em casos, NÃO apaga caso/evento/assignment/
-- fatura, NÃO toca collection_discovery_runs (cursor/counters/generation).
-- NÃO APLICAR REMOTAMENTE sem autorização específica.
--
-- Ordem de release: AR -> (backfill report) -> AW -> RPC (uma vez, autorizada)
--                   -> verificação -> AU -> deploy.
--
-- Status terminal 'consolidated':
--   * não ocupa capacidade (fora do conjunto ativo open/in_contact/promise_to_pay/unresolved);
--   * não é paid/cancelled/closed; não recebe contato nem nova atribuição;
--   * aponta para o caso canônico (consolidated_into_case_id), mesmo contract_pk;
--   * sem cadeias/ciclos: o canônico nunca está consolidated.
--
-- Política de caso canônico (CANONICAL_SELECTION_POLICY):
--   modo 'auto_oldest' (somente grupos AUTO_ONLY: apenas created/assigned,
--   assignment auto_assign, sem contato, sem pagamento): canônico = menor
--   (created_at, id). Qualquer atividade humana/financeira -> recusa; exige modo
--   'explicit' com p_actor_id. Pagamento detectado -> recusa em ambos os modos
--   (decisão financeira separada). Nunca por valor, nome, invoice_pk, funcionário,
--   posição de query ou metadata.
--
-- Rollback: a RPC pode ser removida; colunas/tabela de auditoria permanecem.
-- Uma consolidação executada NÃO é desfeita automaticamente.

begin;

-- 1) Status consolidated + colunas dedicadas (não só metadata)
alter table public.collection_cases
  drop constraint if exists collection_cases_status_chk;
alter table public.collection_cases
  add constraint collection_cases_status_chk check (
    status in (
      'open', 'in_contact', 'promise_to_pay', 'paid', 'unresolved',
      'escalated_retention', 'closed', 'consolidated'
    )
  );

alter table public.collection_cases
  add column if not exists consolidated_into_case_id uuid
    references public.collection_cases(id) on delete restrict,
  add column if not exists consolidated_at timestamptz,
  add column if not exists consolidation_reason text,
  add column if not exists consolidated_by uuid,
  add column if not exists consolidation_operation_id uuid;

alter table public.collection_cases
  drop constraint if exists collection_cases_consolidation_shape_chk;
alter table public.collection_cases
  add constraint collection_cases_consolidation_shape_chk check (
    (status = 'consolidated'
       and consolidated_into_case_id is not null
       and consolidated_at is not null
       and consolidation_reason = 'duplicate_invoice_cases_same_contract'
       and consolidation_operation_id is not null)
    or
    (status <> 'consolidated'
       and consolidated_into_case_id is null
       and consolidated_at is null
       and consolidation_reason is null
       and consolidated_by is null
       and consolidation_operation_id is null)
  );

alter table public.collection_cases
  drop constraint if exists collection_cases_consolidation_self_chk;
alter table public.collection_cases
  add constraint collection_cases_consolidation_self_chk check (
    consolidated_into_case_id is null or consolidated_into_case_id <> id
  );

create index if not exists collection_cases_consolidated_into_idx
  on public.collection_cases (consolidated_into_case_id)
  where consolidated_into_case_id is not null;

create unique index if not exists collection_cases_consolidation_operation_uidx
  on public.collection_cases (consolidation_operation_id)
  where consolidation_operation_id is not null;

comment on column public.collection_cases.consolidated_into_case_id is
  '3.1E-AW: caso canônico (mesmo contract_pk) que incorporou este caso. Terminal.';

-- 2) Guarda: consolidated é terminal; canônico válido; sem ciclos/cadeias
create or replace function public.trg_collection_cases_consolidation_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_target record;
begin
  if tg_op = 'UPDATE' and old.status = 'consolidated' then
    if new.status is distinct from 'consolidated'
       or new.consolidated_into_case_id is distinct from old.consolidated_into_case_id
       or new.consolidation_operation_id is distinct from old.consolidation_operation_id
       or new.contract_pk is distinct from old.contract_pk then
      raise exception 'collection_cases: consolidated é terminal';
    end if;
    return new;
  end if;

  if new.status = 'consolidated' then
    select id, status, contract_pk into v_target
    from public.collection_cases where id = new.consolidated_into_case_id;
    if not found then
      raise exception 'collection_cases: canônico inexistente';
    end if;
    if v_target.status = 'consolidated' then
      raise exception 'collection_cases: canônico não pode estar consolidated';
    end if;
    if new.contract_pk is null or new.contract_pk !~ '^[1-9][0-9]*$'
       or v_target.contract_pk is distinct from new.contract_pk then
      raise exception 'collection_cases: consolidação exige mesmo contract_pk';
    end if;
    if exists (select 1 from public.collection_cases where consolidated_into_case_id = new.id) then
      raise exception 'collection_cases: caso com consolidados não pode ser consolidado (ciclo/cadeia)';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_collection_cases_consolidation_guard on public.collection_cases;
create trigger trg_collection_cases_consolidation_guard
before insert or update on public.collection_cases
for each row execute function public.trg_collection_cases_consolidation_guard();

-- 3) Auditoria da operação (uma linha por secundário; sem PII)
create table if not exists public.collection_case_consolidations (
  operation_id uuid primary key,
  contract_pk text not null,
  canonical_case_id uuid not null references public.collection_cases(id) on delete restrict,
  secondary_case_id uuid not null references public.collection_cases(id) on delete restrict,
  reason text not null,
  selection_mode text not null,
  actor_id uuid,
  invoices_moved integer not null default 0,
  secondary_assignment_released boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  constraint collection_case_consolidations_secondary_uniq unique (secondary_case_id),
  constraint collection_case_consolidations_distinct_chk check (canonical_case_id <> secondary_case_id),
  constraint collection_case_consolidations_reason_chk check (reason = 'duplicate_invoice_cases_same_contract'),
  constraint collection_case_consolidations_mode_chk check (selection_mode in ('auto_oldest', 'explicit')),
  constraint collection_case_consolidations_contract_chk check (contract_pk ~ '^[1-9][0-9]*$')
);

create index if not exists collection_case_consolidations_canonical_idx
  on public.collection_case_consolidations (canonical_case_id);

alter table public.collection_case_consolidations enable row level security;
revoke all on table public.collection_case_consolidations from public, anon, authenticated;
grant select on table public.collection_case_consolidations to service_role;

create or replace function public.trg_collection_case_consolidations_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'collection_case_consolidations é histórico: % proibido', tg_op;
end;
$$;

drop trigger if exists trg_collection_case_consolidations_immutable on public.collection_case_consolidations;
create trigger trg_collection_case_consolidations_immutable
before update or delete on public.collection_case_consolidations
for each row execute function public.trg_collection_case_consolidations_immutable();

-- 4) RPC fenced, idempotente por operation_id
create or replace function public.consolidate_collection_cases_by_contract(
  p_canonical_case_id uuid,
  p_secondary_case_id uuid,
  p_expected_canonical_status text,
  p_expected_secondary_status text,
  p_reason text,
  p_operation_id uuid,
  p_actor_id uuid default null,
  p_selection_mode text default 'auto_oldest'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- now() (timestamptz) direto: independe do TimeZone da sessão.
  v_now timestamptz := now();
  v_active constant text[] := array['open', 'in_contact', 'promise_to_pay', 'unresolved'];
  v_prev record;
  v_pre_c record;
  v_pre_s record;
  v_can public.collection_cases;
  v_sec public.collection_cases;
  v_first uuid;
  v_second uuid;
  v_contract text;
  v_oldest uuid;
  v_human_c boolean;
  v_human_s boolean;
  v_financial boolean;
  v_can_asg_active integer;
  v_sec_asg record;
  v_rel jsonb;
  v_moved integer := 0;
  v_released boolean := false;
  v_link record;
begin
  if p_canonical_case_id is null or p_secondary_case_id is null or p_operation_id is null
     or p_expected_canonical_status is null or p_expected_secondary_status is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;
  if p_canonical_case_id = p_secondary_case_id then
    return jsonb_build_object('ok', false, 'code', 'same_case');
  end if;
  if p_reason is distinct from 'duplicate_invoice_cases_same_contract' then
    return jsonb_build_object('ok', false, 'code', 'invalid_reason');
  end if;
  if p_selection_mode is null or p_selection_mode not in ('auto_oldest', 'explicit') then
    return jsonb_build_object('ok', false, 'code', 'invalid_selection_mode');
  end if;
  if p_selection_mode = 'explicit' and p_actor_id is null then
    return jsonb_build_object('ok', false, 'code', 'explicit_requires_actor');
  end if;

  -- serializa a mesma operação
  perform pg_advisory_xact_lock(872148, hashtext(p_operation_id::text));

  select * into v_prev from public.collection_case_consolidations where operation_id = p_operation_id;
  if found then
    if v_prev.canonical_case_id = p_canonical_case_id and v_prev.secondary_case_id = p_secondary_case_id then
      return jsonb_build_object('ok', true, 'code', 'already_consolidated', 'idempotent', true,
                                'invoicesMoved', 0, 'canonicalCaseId', p_canonical_case_id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'operation_id_conflict');
  end if;

  -- leitura prévia para obter o contrato e travar no mesmo escopo do persist AU
  select id, contract_pk into v_pre_c from public.collection_cases where id = p_canonical_case_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select id, contract_pk into v_pre_s from public.collection_cases where id = p_secondary_case_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_pre_c.contract_pk is null or v_pre_c.contract_pk !~ '^[1-9][0-9]*$'
     or v_pre_s.contract_pk is distinct from v_pre_c.contract_pk then
    return jsonb_build_object('ok', false, 'code', 'contract_mismatch');
  end if;
  v_contract := v_pre_c.contract_pk;
  perform pg_advisory_xact_lock(872146, hashtext(v_contract));

  -- FOR UPDATE em ordem determinística (uuid)
  v_first := least(p_canonical_case_id, p_secondary_case_id);
  v_second := greatest(p_canonical_case_id, p_secondary_case_id);
  perform 1 from public.collection_cases where id = v_first for update;
  perform 1 from public.collection_cases where id = v_second for update;
  select * into v_can from public.collection_cases where id = p_canonical_case_id;
  select * into v_sec from public.collection_cases where id = p_secondary_case_id;

  if v_can.contract_pk is distinct from v_contract or v_sec.contract_pk is distinct from v_contract then
    return jsonb_build_object('ok', false, 'code', 'contract_mismatch');
  end if;

  -- estados terminais / idempotência por estado final
  if v_sec.status = 'consolidated' then
    if v_sec.consolidated_into_case_id = v_can.id then
      return jsonb_build_object('ok', false, 'code', 'secondary_already_consolidated',
                                'sameCanonical', true, 'noop', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'secondary_consolidated_elsewhere');
  end if;
  if v_can.status = 'consolidated' then
    return jsonb_build_object('ok', false, 'code', 'canonical_consolidated');
  end if;
  if exists (select 1 from public.collection_cases where consolidated_into_case_id = v_sec.id) then
    return jsonb_build_object('ok', false, 'code', 'cycle_refused');
  end if;
  if not (v_can.status = any (v_active)) or not (v_sec.status = any (v_active)) then
    return jsonb_build_object('ok', false, 'code', 'terminal_status');
  end if;
  if v_can.status is distinct from p_expected_canonical_status
     or v_sec.status is distinct from p_expected_secondary_status then
    return jsonb_build_object('ok', false, 'code', 'stale_state');
  end if;

  -- sem lease/execução concorrente relevante (run NÃO é alterada)
  if exists (
    select 1 from public.collection_discovery_runs
    where status = 'running' and lease_until is not null and lease_until > v_now
  ) then
    return jsonb_build_object('ok', false, 'code', 'active_lease');
  end if;
  if to_regclass('public.collection_contract_contact_locks') is not null then
    if exists (
      select 1 from public.collection_contract_contact_locks
      where contract_pk = v_contract and expires_at > v_now
    ) then
      return jsonb_build_object('ok', false, 'code', 'contact_lock_active');
    end if;
  end if;

  -- financeiro: pagamento detectado ou fatura não-aberta -> decisão separada
  select exists (
           select 1 from public.collection_case_events
           where case_id in (v_can.id, v_sec.id) and event_type = 'payment_detected'
         )
      or exists (
           select 1 from public.collection_case_invoices
           where case_id in (v_can.id, v_sec.id) and payment_status <> 'open'
         )
  into v_financial;
  if v_financial then
    return jsonb_build_object('ok', false, 'code', 'financial_conflict_requires_decision');
  end if;

  -- atividade humana por caso
  select (v_can.status <> 'open')
      or exists (select 1 from public.collection_case_events
                 where case_id = v_can.id and event_type not in ('created', 'assigned'))
      or exists (select 1 from public.sector_work_assignments
                 where work_type = 'collection_case' and work_id = v_can.id
                   and assignment_source <> 'auto_assign')
      or (to_regclass('public.operational_case_contact_attempts') is not null
          and exists (select 1 from public.operational_case_contact_attempts
                      where case_type = 'collection_case' and case_id = v_can.id))
  into v_human_c;
  select (v_sec.status <> 'open')
      or exists (select 1 from public.collection_case_events
                 where case_id = v_sec.id and event_type not in ('created', 'assigned'))
      or exists (select 1 from public.sector_work_assignments
                 where work_type = 'collection_case' and work_id = v_sec.id
                   and assignment_source <> 'auto_assign')
      or (to_regclass('public.operational_case_contact_attempts') is not null
          and exists (select 1 from public.operational_case_contact_attempts
                      where case_type = 'collection_case' and case_id = v_sec.id))
  into v_human_s;

  if p_selection_mode = 'auto_oldest' then
    if v_human_c or v_human_s then
      return jsonb_build_object('ok', false, 'code', 'human_activity_requires_explicit_choice');
    end if;
    select id into v_oldest from public.collection_cases
    where id in (v_can.id, v_sec.id) order by created_at, id limit 1;
    if v_oldest is distinct from v_can.id then
      return jsonb_build_object('ok', false, 'code', 'canonical_not_oldest');
    end if;
  elsif v_human_s and not v_human_c then
    -- atividade só no secundário: canônico explícito não pode descartar o caso ativo humano
    return jsonb_build_object('ok', false, 'code', 'human_activity_on_secondary');
  end if;

  select count(*) into v_can_asg_active from public.sector_work_assignments
  where work_type = 'collection_case' and work_id = v_can.id and status = 'active';
  select * into v_sec_asg from public.sector_work_assignments
  where work_type = 'collection_case' and work_id = v_sec.id and status = 'active'
  for update;
  if found and v_can_asg_active = 0 then
    -- não criar nova assignment nem mover silenciosamente
    return jsonb_build_object('ok', false, 'code', 'canonical_assignment_missing');
  end if;

  -- validação de faturas antes de escrever: âncoras legadas não podem pertencer a terceiro
  for v_link in
    select l.invoice_pk, l.case_id from public.collection_case_invoices l
    where l.invoice_pk in (v_can.invoice_pk, v_sec.invoice_pk)
      and l.case_id not in (v_can.id, v_sec.id)
  loop
    return jsonb_build_object('ok', false, 'code', 'invoice_conflict');
  end loop;

  -- ===== escrita (tudo-ou-nada) =====
  begin
    -- garante relação da âncora legada de cada caso (idempotente; nunca sobrescreve terceiro)
    insert into public.collection_case_invoices (
      case_id, invoice_pk, contract_pk, due_date, payment_status, days_overdue, first_seen_at, last_seen_at
    )
    select c.id, c.invoice_pk, c.contract_pk, c.overdue_since, 'open', c.days_overdue, c.created_at, v_now
    from public.collection_cases c
    where c.id in (v_can.id, v_sec.id) and c.invoice_pk ~ '^[1-9][0-9]*$'
    on conflict (invoice_pk) do nothing;

    update public.collection_case_invoices
    set case_id = v_can.id, last_seen_at = v_now
    where case_id = v_sec.id;
    get diagnostics v_moved = row_count;

    if exists (
      select 1 from public.collection_case_invoices
      where invoice_pk in (v_can.invoice_pk, v_sec.invoice_pk) and case_id <> v_can.id
    ) then
      raise exception 'invoice_conflict_after_move';
    end if;

    update public.collection_cases
    set status = 'consolidated',
        consolidated_into_case_id = v_can.id,
        consolidated_at = v_now,
        consolidation_reason = p_reason,
        consolidated_by = p_actor_id,
        consolidation_operation_id = p_operation_id
    where id = v_sec.id and status = p_expected_secondary_status;
    if not found then
      raise exception 'secondary_update_failed';
    end if;

    insert into public.collection_case_events (case_id, event_type, actor_profile_id, old_value, new_value, metadata)
    values (
      v_sec.id, 'status_changed', null,
      jsonb_build_object('status', v_sec.status),
      jsonb_build_object('status', 'consolidated', 'reason', p_reason),
      jsonb_build_object('source', 'contract_case_consolidation', 'selection_mode', p_selection_mode,
                         'operation_id', p_operation_id)
    );

    if v_sec_asg.id is not null then
      v_rel := public.release_sector_assignment(v_sec_asg.id, 'released', null, 'contract_case_consolidated');
      if coalesce((v_rel ->> 'ok')::boolean, false) is not true then
        raise exception 'secondary_assignment_release_failed';
      end if;
      v_released := true;
    end if;

    insert into public.collection_case_consolidations (
      operation_id, contract_pk, canonical_case_id, secondary_case_id, reason, selection_mode,
      actor_id, invoices_moved, secondary_assignment_released
    ) values (
      p_operation_id, v_contract, v_can.id, v_sec.id, p_reason, p_selection_mode,
      p_actor_id, v_moved, v_released
    );
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'rolled_back', 'sqlstate', sqlstate);
  end;

  return jsonb_build_object(
    'ok', true, 'code', 'consolidated', 'idempotent', false,
    'canonicalCaseId', v_can.id, 'invoicesMoved', v_moved,
    'secondaryAssignmentReleased', v_released, 'selectionMode', p_selection_mode
  );
end;
$$;

comment on function public.consolidate_collection_cases_by_contract(uuid, uuid, text, text, text, uuid, uuid, text) is
  '3.1E-AW: consolida secundário no canônico (mesmo contract_pk). Fenced, idempotente por operation_id, sem tocar runs.';

-- 5) Permissões: service_role only
revoke all on function public.consolidate_collection_cases_by_contract(uuid, uuid, text, text, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.consolidate_collection_cases_by_contract(uuid, uuid, text, text, text, uuid, uuid, text) to service_role;
revoke all on function public.trg_collection_cases_consolidation_guard() from public, anon, authenticated;
revoke all on function public.trg_collection_case_consolidations_immutable() from public, anon, authenticated;

commit;

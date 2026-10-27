-- Sprint 3.1E-AR — Cobrança: prefixo confirmado monotônico + faturas por caso de contrato.
-- ADITIVA. Sem DELETE, sem reescrever histórico, sem resetar cursor, sem tocar runs.
-- NÃO APLICAR REMOTAMENTE sem release review.
--
-- client_pk NÃO está comprovado em invoice/list nem invoice_info; por isso esta
-- migration NÃO cria trava de contato por cliente nem agrupa por cliente.
-- 3.1E-AU: coluna client_pk removida da tabela nova (não comprovada; não usar).
--
-- Rollback (sem apagar efeitos financeiros): restaurar a função
-- advance_collection_discovery_checkpoint de patch-collection-discovery-progress-guarantee.sql;
-- collection_case_invoices pode permanecer (somente leitura pela app antiga).

begin;

-- 1) Faturas vinculadas ao caso do contrato. invoice_pk continua único.
create table if not exists public.collection_case_invoices (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.collection_cases(id) on delete restrict,
  invoice_pk text not null,
  contract_pk text,
  due_date date,
  credit_date date,
  payment_status text not null default 'open',
  days_overdue integer,
  invoice_snapshot jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint collection_case_invoices_invoice_pk_uniq unique (invoice_pk),
  constraint collection_case_invoices_invoice_pk_chk check (invoice_pk ~ '^[1-9][0-9]*$'),
  constraint collection_case_invoices_contract_pk_chk check (
    contract_pk is null or contract_pk ~ '^[1-9][0-9]*$'
  ),
  constraint collection_case_invoices_status_chk check (
    payment_status in ('open', 'paid', 'cancelled_contract', 'inconclusive')
  )
);

create index if not exists collection_case_invoices_case_idx on public.collection_case_invoices (case_id);
create index if not exists collection_case_invoices_contract_idx on public.collection_case_invoices (contract_pk);
create index if not exists collection_case_invoices_status_idx on public.collection_case_invoices (payment_status);
create index if not exists collection_case_invoices_due_idx on public.collection_case_invoices (due_date);

alter table public.collection_case_invoices enable row level security;
revoke all on table public.collection_case_invoices from public;
revoke all on table public.collection_case_invoices from anon;
revoke all on table public.collection_case_invoices from authenticated;
grant select, insert, update on table public.collection_case_invoices to service_role;

-- 2) Backfill determinístico: cada caso existente com invoice_pk válido ganha
-- exatamente uma linha (os três casos atuais). Idempotente. contract_pk só é
-- copiado quando válido (nunca inventado); ausente → null, caso preservado.
insert into public.collection_case_invoices (
  case_id, invoice_pk, contract_pk, due_date, payment_status,
  days_overdue, first_seen_at, last_seen_at, resolved_at
)
select c.id, c.invoice_pk,
       case when c.contract_pk ~ '^[1-9][0-9]*$' then c.contract_pk else null end,
       c.overdue_since,
       case when c.status = 'paid' then 'paid' else 'open' end,
       c.days_overdue, c.created_at, c.updated_at,
       case when c.status = 'paid' then c.closed_at else null end
from public.collection_cases c
where c.invoice_pk ~ '^[1-9][0-9]*$'
order by c.created_at, c.id
on conflict (invoice_pk) do nothing;

-- 3) Cursor monotônico no avanço do checkpoint (fencing preservado).
create or replace function public.advance_collection_discovery_checkpoint(
  p_run_id uuid,
  p_owner text,
  p_generation integer,
  p_cursor_last_invoice_pk text,
  p_scanned_pages integer,
  p_scanned_invoices integer,
  p_created_count integer,
  p_updated_count integer,
  p_skipped_count integer,
  p_assigned_count integer,
  p_unassigned_count integer,
  p_error_count integer,
  p_reported_total integer,
  p_last_error_class text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_row public.collection_discovery_runs;
begin
  if p_cursor_last_invoice_pk is null or p_cursor_last_invoice_pk !~ '^[1-9][0-9]*$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_cursor');
  end if;

  update public.collection_discovery_runs
  set cursor_last_invoice_pk = p_cursor_last_invoice_pk,
      scanned_pages = p_scanned_pages,
      scanned_invoices = p_scanned_invoices,
      created_count = p_created_count,
      updated_count = p_updated_count,
      skipped_count = p_skipped_count,
      assigned_count = p_assigned_count,
      unassigned_count = p_unassigned_count,
      error_count = p_error_count,
      reported_total = p_reported_total,
      last_error_class = p_last_error_class,
      consecutive_no_progress = 0
  where id = p_run_id
    and lease_owner = p_owner
    and lease_generation = p_generation
    and status = 'running'
    and lease_until is not null
    and lease_until > v_now
    and (
      cursor_last_invoice_pk is null
      or p_cursor_last_invoice_pk::numeric > cursor_last_invoice_pk::numeric
    )
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'stale_lease');
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'advanced',
    'run', public.collection_discovery_run_to_json(v_row)
  );
end;
$$;

revoke all on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) from public;
revoke all on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) from anon;
revoke all on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) from authenticated;
grant execute on function public.advance_collection_discovery_checkpoint(uuid, text, integer, text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) to service_role;

commit;

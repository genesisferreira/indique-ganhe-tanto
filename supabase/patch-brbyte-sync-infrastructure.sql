-- Infraestrutura BRByte: vínculos, auditoria de sync e RPC futura (sem alterar fluxo manual).
-- Aplicar após schema.sql e patches de primeira mensalidade.
-- Não altera mark_first_invoice_paid(uuid), rewards, wallet, triggers ou RLS existentes em tabelas antigas.

begin;

-- ============================================================
-- referrals — colunas nullable (matching / sync)
-- ============================================================
alter table public.referrals
  add column if not exists brbyte_id_tercero text,
  add column if not exists brbyte_id_cliente text,
  add column if not exists brbyte_id_contrato text,
  add column if not exists brbyte_no_contrato text,
  add column if not exists brbyte_matched_at timestamptz,
  add column if not exists brbyte_last_sync_at timestamptz,
  add column if not exists referred_document text;

comment on column public.referrals.brbyte_id_tercero is
  'ID do tercero/pessoa na BRByte após matching.';
comment on column public.referrals.brbyte_id_cliente is
  'ID do cliente institucional na BRByte após matching.';
comment on column public.referrals.brbyte_id_contrato is
  'ID do contrato principal na BRByte após matching.';
comment on column public.referrals.brbyte_no_contrato is
  'Número/código do contrato na BRByte (auditoria).';
comment on column public.referrals.brbyte_matched_at is
  'Quando o vínculo referral ↔ BRByte foi estabelecido.';
comment on column public.referrals.brbyte_last_sync_at is
  'Última varredura do cron BRByte para esta indicação.';
comment on column public.referrals.referred_document is
  'CPF/CNPJ normalizado do indicado (prioridade de matching futuro).';

create index if not exists referrals_brbyte_id_cliente_idx
  on public.referrals (brbyte_id_cliente)
  where brbyte_id_cliente is not null;

create index if not exists referrals_brbyte_id_contrato_idx
  on public.referrals (brbyte_id_contrato)
  where brbyte_id_contrato is not null;

create index if not exists referrals_referred_document_idx
  on public.referrals (referred_document)
  where referred_document is not null;

-- ============================================================
-- brbyte_sync_runs — auditoria de execuções do cron
-- ============================================================
create table if not exists public.brbyte_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'ok', 'partial', 'error', 'skipped')),
  configured boolean not null default false,
  api_reachable boolean,
  fetched int not null default 0,
  processed int not null default 0,
  matched int not null default 0,
  snapshots_upserted int not null default 0,
  marked_paid int not null default 0,
  skipped_records int not null default 0,
  errors_count int not null default 0,
  duration_ms int,
  error_summary jsonb,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists brbyte_sync_runs_started_at_idx
  on public.brbyte_sync_runs (started_at desc);

comment on table public.brbyte_sync_runs is
  'Histórico de execuções do job /api/cron/brbyte-sync.';

alter table public.brbyte_sync_runs enable row level security;

-- ============================================================
-- brbyte_payment_snapshots — observações / idempotência futura
-- ============================================================
create table if not exists public.brbyte_payment_snapshots (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals (id) on delete cascade,
  sync_run_id uuid references public.brbyte_sync_runs (id) on delete set null,
  brbyte_id_contrato text,
  periodo text,
  external_reference text,
  valor numeric(12, 2),
  saldo numeric(12, 2),
  nomenclatura_estado text,
  paid_detected boolean not null default false,
  paid_at timestamptz,
  source_endpoint text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists brbyte_payment_snapshots_referral_id_idx
  on public.brbyte_payment_snapshots (referral_id);

create index if not exists brbyte_payment_snapshots_brbyte_id_contrato_idx
  on public.brbyte_payment_snapshots (brbyte_id_contrato)
  where brbyte_id_contrato is not null;

create unique index if not exists brbyte_payment_snapshots_referral_external_ref_idx
  on public.brbyte_payment_snapshots (referral_id, external_reference)
  where external_reference is not null;

create unique index if not exists brbyte_payment_snapshots_referral_periodo_idx
  on public.brbyte_payment_snapshots (referral_id, periodo)
  where periodo is not null and external_reference is null;

comment on table public.brbyte_payment_snapshots is
  'Snapshots de cobrança BRByte; paid_detected=false até endpoint oficial + RPC de sync ativa.';

alter table public.brbyte_payment_snapshots enable row level security;

-- ============================================================
-- RPC futura: confirmação via sync (service_role apenas)
-- Não substitui mark_first_invoice_paid(uuid) — fluxo manual intacto.
-- ============================================================
create or replace function public.mark_first_invoice_paid_from_sync(
  p_referral_id uuid,
  p_paid_at timestamptz default null,
  p_external_reference text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
  v_reward public.rewards%rowtype;
  v_balance_before numeric(10, 2);
  v_balance_after numeric(10, 2);
  v_now timestamptz := coalesce(p_paid_at, timezone('utc', now()));
  v_tx_id uuid;
  v_existing_tx_id uuid;
  v_existing_balance_after numeric(10, 2);
  v_snapshot_id uuid;
begin
  select * into v_ref
  from public.referrals
  where id = p_referral_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'referral_not_found',
      'message', 'Indicação não encontrada.',
      'source', 'mark_first_invoice_paid_from_sync'
    );
  end if;

  -- Auditoria / snapshot (idempotente por external_reference ou periodo)
  if nullif(trim(coalesce(p_external_reference, '')), '') is not null then
    insert into public.brbyte_payment_snapshots (
      referral_id,
      brbyte_id_contrato,
      external_reference,
      paid_detected,
      paid_at,
      source_endpoint,
      raw_payload
    )
    values (
      p_referral_id,
      v_ref.brbyte_id_contrato,
      trim(p_external_reference),
      true,
      v_now,
      'mark_first_invoice_paid_from_sync',
      coalesce(p_payload, '{}'::jsonb)
    )
    on conflict (referral_id, external_reference)
    where external_reference is not null
    do update set
      paid_detected = true,
      paid_at = excluded.paid_at,
      raw_payload = excluded.raw_payload,
      source_endpoint = excluded.source_endpoint
    returning id into v_snapshot_id;
  elsif nullif(trim(coalesce(p_payload->>'periodo', '')), '') is not null then
    insert into public.brbyte_payment_snapshots (
      referral_id,
      brbyte_id_contrato,
      periodo,
      paid_detected,
      paid_at,
      source_endpoint,
      raw_payload
    )
    values (
      p_referral_id,
      v_ref.brbyte_id_contrato,
      trim(p_payload->>'periodo'),
      true,
      v_now,
      'mark_first_invoice_paid_from_sync',
      coalesce(p_payload, '{}'::jsonb)
    )
    on conflict (referral_id, periodo)
    where periodo is not null and external_reference is null
    do update set
      paid_detected = true,
      paid_at = excluded.paid_at,
      raw_payload = excluded.raw_payload,
      source_endpoint = excluded.source_endpoint
    returning id into v_snapshot_id;
  else
    insert into public.brbyte_payment_snapshots (
      referral_id,
      brbyte_id_contrato,
      paid_detected,
      paid_at,
      source_endpoint,
      raw_payload
    )
    values (
      p_referral_id,
      v_ref.brbyte_id_contrato,
      true,
      v_now,
      'mark_first_invoice_paid_from_sync',
      coalesce(p_payload, '{}'::jsonb)
    )
    returning id into v_snapshot_id;
  end if;

  perform public.log_notification_debug(
    'mark_first_invoice_paid_from_sync',
    p_referral_id,
    v_ref.indicator_profile_id,
    'sync',
    'audit',
    'snapshot_recorded',
    jsonb_build_object(
      'snapshot_id', v_snapshot_id,
      'external_reference', p_external_reference,
      'paid_at', v_now
    )
  );

  if v_ref.first_invoice_paid then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'code', 'already_paid',
      'referral_id', p_referral_id,
      'snapshot_id', v_snapshot_id,
      'message', 'Primeira mensalidade já confirmada.',
      'source', 'mark_first_invoice_paid_from_sync'
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
      'message', 'Não há recompensa vinculada a esta indicação.',
      'snapshot_id', v_snapshot_id,
      'source', 'mark_first_invoice_paid_from_sync'
    );
  end if;

  select wt.id, wt.balance_after
  into v_existing_tx_id, v_existing_balance_after
  from public.wallet_transactions wt
  where wt.reward_id = v_reward.id
    and wt.transaction_type = 'credito'::public.wallet_transaction_type
  order by wt.created_at desc, wt.id desc
  limit 1;

  if v_existing_tx_id is not null then
    update public.referrals
    set
      first_invoice_paid = true,
      first_invoice_paid_at = coalesce(v_ref.first_invoice_paid_at, v_now),
      updated_at = v_now
    where id = p_referral_id;

    update public.rewards
    set
      status = 'disponivel'::public.reward_status,
      available_at = coalesce(v_reward.available_at, v_now),
      updated_at = v_now
    where id = v_reward.id;

    perform public.notify_indicator_reward_released(p_referral_id);

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'referral_id', p_referral_id,
      'reward_id', v_reward.id,
      'transaction_id', v_existing_tx_id,
      'balance_after', coalesce(v_existing_balance_after, 0),
      'snapshot_id', v_snapshot_id,
      'source', 'mark_first_invoice_paid_from_sync'
    );
  end if;

  if v_reward.status is distinct from 'pendente'::public.reward_status then
    return jsonb_build_object(
      'ok', false,
      'code', 'reward_not_pending',
      'message', format('Recompensa não pendente (status: %s).', v_reward.status::text),
      'snapshot_id', v_snapshot_id,
      'source', 'mark_first_invoice_paid_from_sync'
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

  v_balance_after := greatest(0::numeric, v_balance_before + v_reward.amount);

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
    'Recompensa liberada via sync BRByte (primeira mensalidade)',
    coalesce(nullif(trim(p_external_reference), ''), p_referral_id::text),
    v_now
  )
  returning id into v_tx_id;

  perform public.notify_indicator_reward_released(p_referral_id);

  perform public.log_notification_debug(
    'mark_first_invoice_paid_from_sync',
    p_referral_id,
    v_ref.indicator_profile_id,
    'pendente',
    'disponivel',
    'reward_released',
    jsonb_build_object(
      'reward_id', v_reward.id,
      'transaction_id', v_tx_id,
      'balance_after', v_balance_after,
      'external_reference', p_external_reference
    )
  );

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'referral_id', p_referral_id,
    'reward_id', v_reward.id,
    'transaction_id', v_tx_id,
    'balance_after', v_balance_after,
    'snapshot_id', v_snapshot_id,
    'source', 'mark_first_invoice_paid_from_sync'
  );
exception
  when unique_violation then
    select wt.id, wt.balance_after
    into v_existing_tx_id, v_existing_balance_after
    from public.wallet_transactions wt
    where wt.reward_id = v_reward.id
      and wt.transaction_type = 'credito'::public.wallet_transaction_type
    order by wt.created_at desc, wt.id desc
    limit 1;

    if v_existing_tx_id is not null then
      return jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'referral_id', p_referral_id,
        'reward_id', v_reward.id,
        'transaction_id', v_existing_tx_id,
        'balance_after', coalesce(v_existing_balance_after, 0),
        'source', 'mark_first_invoice_paid_from_sync'
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'code', 'already_released',
      'message', 'Crédito de carteira já existente para esta recompensa.',
      'source', 'mark_first_invoice_paid_from_sync'
    );
end;
$$;

comment on function public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb) is
  'Confirma 1ª mensalidade via integração BRByte (service_role). Não usar no cron até endpoint oficial de cobrança.';

revoke all on function public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb) from public;
revoke all on function public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb) from authenticated;
revoke all on function public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb) from anon;
grant execute on function public.mark_first_invoice_paid_from_sync(uuid, timestamptz, text, jsonb) to service_role;

commit;

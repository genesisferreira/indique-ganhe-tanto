-- 3.1F-J15E: a fila de interessado passa a exigir operação explícita.
-- Não altera dados de negócio das indicações. Só classifica o backlog operacional.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.brbyte_interest_operations (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals (id),
  operation_type text not null default 'create_interest',
  status text not null,
  idempotency_key text,
  origin text,
  flow text not null,
  attempts integer not null default 0,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint brbyte_interest_operations_type_chk check (operation_type = 'create_interest'),
  constraint brbyte_interest_operations_status_chk check (status in (
    'pending', 'retryable', 'succeeded', 'legacy_not_queued', 'permanent_error_not_retryable'
  )),
  constraint brbyte_interest_operations_flow_chk check (flow in (
    'automatic_current', 'admin_explicit', 'legacy_backlog', 'permanent_error'
  )),
  constraint brbyte_interest_operations_attempts_chk check (attempts >= 0)
);

create unique index if not exists brbyte_interest_operations_referral_flow_uidx
  on public.brbyte_interest_operations (referral_id, flow);

create unique index if not exists brbyte_interest_operations_key_uidx
  on public.brbyte_interest_operations (idempotency_key)
  where idempotency_key is not null;

create index if not exists brbyte_interest_operations_due_idx
  on public.brbyte_interest_operations (created_at)
  where operation_type = 'create_interest'
    and status in ('pending', 'retryable')
    and flow in ('automatic_current', 'admin_explicit');

alter table public.brbyte_interest_operations enable row level security;
revoke all on table public.brbyte_interest_operations from public, anon, authenticated;
grant select, insert, update on table public.brbyte_interest_operations to service_role;

do $$
declare
  v_legacy integer;
  v_permanent integer;
begin
  select count(*) into v_legacy
  from public.referrals r
  where r.source is null
    and r.origin_kind = 'legacy'
    and r.brbyte_sync_status = 'pending'
    and r.brbyte_id_interessado is null;

  select count(*) into v_permanent
  from public.referrals r
  where r.brbyte_sync_status = 'error'
    and r.brbyte_id_interessado is null
    and r.source in ('public_pre_registration', 'neutral_network_pre_registration');

  if v_legacy <> 32 or v_permanent <> 14 then
    raise exception 'interest_backlog_count_mismatch';
  end if;

  insert into public.brbyte_interest_operations (
    referral_id, operation_type, status, origin, flow, attempts
  )
  select r.id, 'create_interest', 'legacy_not_queued', 'legacy', 'legacy_backlog', 0
  from public.referrals r
  where r.source is null
    and r.origin_kind = 'legacy'
    and r.brbyte_sync_status = 'pending'
    and r.brbyte_id_interessado is null
  on conflict (referral_id, flow) do nothing;

  insert into public.brbyte_interest_operations (
    referral_id, operation_type, status, origin, flow, attempts
  )
  select r.id, 'create_interest', 'permanent_error_not_retryable', r.source, 'permanent_error',
         coalesce(r.brbyte_sync_attempts, 0)
  from public.referrals r
  where r.brbyte_sync_status = 'error'
    and r.brbyte_id_interessado is null
    and r.source in ('public_pre_registration', 'neutral_network_pre_registration')
  on conflict (referral_id, flow) do nothing;
end $$;

create or replace function public.enqueue_automatic_interest_operation(
  p_referral_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source text;
  v_existing public.brbyte_interest_operations%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;

  select r.source into v_source
  from public.referrals r
  where r.id = p_referral_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'referral_not_found');
  end if;
  if v_source is null or v_source not in (
    'referral_share_link',
    'employee_sales_opportunity',
    'partner_merchant_referral',
    'public_pre_registration',
    'neutral_network_pre_registration'
  ) then
    return jsonb_build_object('ok', false, 'code', 'origin_not_authorized');
  end if;

  select * into v_existing
  from public.brbyte_interest_operations o
  where o.referral_id = p_referral_id
    and o.flow = 'automatic_current';
  if found then
    return jsonb_build_object('ok', true, 'replayed', true, 'status', v_existing.status);
  end if;

  insert into public.brbyte_interest_operations (
    referral_id, operation_type, status, idempotency_key, origin, flow, attempts
  ) values (
    p_referral_id, 'create_interest', 'pending', p_idempotency_key, v_source, 'automatic_current', 0
  );
  return jsonb_build_object('ok', true, 'replayed', false, 'status', 'pending');
exception
  when unique_violation then
    return jsonb_build_object('ok', true, 'replayed', true);
end;
$$;

revoke all on function public.enqueue_automatic_interest_operation(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_automatic_interest_operation(uuid, text) to service_role;

create or replace function public.authorize_legacy_interest_operation(
  p_referral_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if not exists (
    select 1 from public.brbyte_interest_operations o
    where o.referral_id = p_referral_id and o.status = 'legacy_not_queued'
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_legacy_backlog');
  end if;

  insert into public.brbyte_interest_operations (
    referral_id, operation_type, status, idempotency_key, origin, flow, attempts
  ) values (
    p_referral_id, 'create_interest', 'pending', p_idempotency_key, 'legacy', 'admin_explicit', 0
  )
  on conflict (referral_id, flow) do nothing;
  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

revoke all on function public.authorize_legacy_interest_operation(uuid, text) from public, anon, authenticated;
grant execute on function public.authorize_legacy_interest_operation(uuid, text) to service_role;

commit;

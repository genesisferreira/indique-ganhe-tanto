-- Redistribuição automática de leads em SLA redistribution_ready (>= 45 min).
-- Aplicar após patch-commercial-lead-distribution.sql e patch-commercial-sla-escalation.sql
-- Manual: select public.redistribute_overdue_commercial_leads();

begin;

-- ============================================================
-- Colunas de auditoria em referrals
-- ============================================================
alter table public.referrals
  add column if not exists redistribution_count integer not null default 0,
  add column if not exists last_redistributed_at timestamptz,
  add column if not exists previous_commercial_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists sla_redistributed boolean not null default false;

create index if not exists referrals_sla_redistribution_idx
  on public.referrals (commercial_profile_id, redistribution_count)
  where first_response_at is null and commercial_profile_id is not null;

-- ============================================================
-- Debug redistribuição
-- ============================================================
create table if not exists public.debug_commercial_redistribution_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  referral_id uuid,
  commercial_profile_id uuid,
  detail jsonb not null default '{}'::jsonb,
  executed_at timestamptz not null default timezone('utc', now())
);

create index if not exists debug_commercial_redistribution_logs_executed_at_idx
  on public.debug_commercial_redistribution_logs (executed_at desc);

alter table public.debug_commercial_redistribution_logs enable row level security;

drop policy if exists debug_commercial_redistribution_logs_select on public.debug_commercial_redistribution_logs;
create policy debug_commercial_redistribution_logs_select
on public.debug_commercial_redistribution_logs
for select
to authenticated
using (public.is_admin_read_any() or public.is_comercial());

create or replace function public.log_commercial_redistribution_debug(
  p_source text,
  p_referral_id uuid default null,
  p_commercial_profile_id uuid default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.debug_commercial_redistribution_logs (
    source, referral_id, commercial_profile_id, detail
  )
  values (
    p_source, p_referral_id, p_commercial_profile_id, coalesce(p_detail, '{}'::jsonb)
  );
exception
  when others then
    null;
end;
$$;

-- ============================================================
-- Selecionar próximo comercial (mesma regra de assign + exclusão)
-- ============================================================
create or replace function public.pick_next_available_commercial(
  p_exclude_commercial_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_commercial_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_today date := (v_now at time zone 'utc')::date;
begin
  update public.commercial_lead_settings s
  set total_received_today = 0,
      updated_at = v_now
  where (s.last_lead_received_at is null
         or (s.last_lead_received_at at time zone 'utc')::date < v_today)
    and s.total_received_today > 0;

  select s.commercial_profile_id
  into v_commercial_id
  from public.commercial_lead_settings s
  inner join public.profiles p on p.id = s.commercial_profile_id
  where p.role = 'comercial'::public.user_role
    and coalesce(p.is_active, true) = true
    and s.is_available = true
    and s.receiving_leads = true
    and s.total_received_today < s.daily_limit
    and (p_exclude_commercial_id is null or s.commercial_profile_id <> p_exclude_commercial_id)
  order by s.last_lead_received_at asc nulls first, s.active_leads asc, s.commercial_profile_id asc
  limit 1
  for update of s;

  return v_commercial_id;
end;
$$;

-- ============================================================
-- Notificação redistribuição (dedupe: referral + action + count)
-- ============================================================
create or replace function public.notify_commercial_sla_redistributed(
  p_profile_id uuid,
  p_referral_id uuid,
  p_action text,
  p_title text,
  p_message text,
  p_redistribution_count integer,
  p_action_url text,
  p_extra jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile_id is null or p_referral_id is null or p_action is null then
    return false;
  end if;

  if exists (
    select 1
    from public.notifications n
    where n.profile_id = p_profile_id
      and n.data->>'action' = p_action
      and n.data->>'referral_id' = p_referral_id::text
      and coalesce((n.data->>'redistribution_count')::integer, -1) = coalesce(p_redistribution_count, -1)
  ) then
    return false;
  end if;

  insert into public.notifications (
    profile_id,
    notification_type,
    title,
    message,
    data,
    is_read,
    action_url
  )
  values (
    p_profile_id,
    'sistema'::public.notification_type,
    p_title,
    p_message,
    coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
      'action', p_action,
      'referral_id', p_referral_id::text,
      'redistribution_count', p_redistribution_count
    ),
    false,
    p_action_url
  );

  return true;
exception
  when others then
    return false;
end;
$$;

-- ============================================================
-- Redistribuir um lead (interno)
-- ============================================================
create or replace function public.redistribute_single_commercial_lead(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
  v_now timestamptz := timezone('utc', now());
  v_previous_commercial uuid;
  v_new_commercial uuid;
  v_new_count integer;
  v_old_status public.referral_status;
  v_notified integer := 0;
  v_admin record;
begin
  if p_referral_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_referral');
  end if;

  select * into v_ref
  from public.referrals
  where id = p_referral_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_ref.first_response_at is not null then
    perform public.log_commercial_redistribution_debug(
      'redistribute_single_commercial_lead', p_referral_id, v_ref.commercial_profile_id,
      jsonb_build_object('phase', 'skip', 'reason', 'already_responded')
    );
    return jsonb_build_object('ok', false, 'code', 'already_responded', 'referral_id', p_referral_id);
  end if;

  if v_ref.commercial_profile_id is null or v_ref.assigned_at is null then
    return jsonb_build_object('ok', false, 'code', 'not_assigned', 'referral_id', p_referral_id);
  end if;

  if v_ref.redistribution_count >= 3 then
    perform public.log_commercial_redistribution_debug(
      'redistribute_single_commercial_lead', p_referral_id, v_ref.commercial_profile_id,
      jsonb_build_object('phase', 'skip', 'reason', 'max_redistributions', 'count', v_ref.redistribution_count)
    );
    return jsonb_build_object('ok', false, 'code', 'max_redistributions', 'referral_id', p_referral_id);
  end if;

  if v_ref.status not in (
    'pendente'::public.referral_status,
    'em_atendimento'::public.referral_status,
    'em_andamento'::public.referral_status,
    'em_negociacao'::public.referral_status
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'status', v_ref.status::text);
  end if;

  if v_now <= v_ref.assigned_at + interval '45 minutes' then
    return jsonb_build_object('ok', false, 'code', 'sla_not_ready', 'referral_id', p_referral_id);
  end if;

  if v_ref.last_redistributed_at is not null
     and v_now <= v_ref.last_redistributed_at + interval '15 minutes' then
    perform public.log_commercial_redistribution_debug(
      'redistribute_single_commercial_lead', p_referral_id, v_ref.commercial_profile_id,
      jsonb_build_object('phase', 'skip', 'reason', 'cooldown', 'last_redistributed_at', v_ref.last_redistributed_at)
    );
    return jsonb_build_object('ok', false, 'code', 'cooldown', 'referral_id', p_referral_id);
  end if;

  v_previous_commercial := v_ref.commercial_profile_id;
  v_new_commercial := public.pick_next_available_commercial(v_previous_commercial);

  if v_new_commercial is null then
    perform public.log_commercial_redistribution_debug(
      'redistribute_single_commercial_lead', p_referral_id, v_previous_commercial,
      jsonb_build_object('phase', 'skip', 'reason', 'no_commercial_available')
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'no_commercial_available',
      'referral_id', p_referral_id,
      'previous_commercial_profile_id', v_previous_commercial
    );
  end if;

  v_new_count := coalesce(v_ref.redistribution_count, 0) + 1;
  v_old_status := v_ref.status;

  update public.commercial_lead_settings
  set active_leads = greatest(0, active_leads - 1),
      updated_at = v_now
  where commercial_profile_id = v_previous_commercial
    and active_leads > 0;

  update public.referrals
  set previous_commercial_profile_id = v_previous_commercial,
      commercial_profile_id = v_new_commercial,
      redistribution_count = v_new_count,
      last_redistributed_at = v_now,
      sla_redistributed = true,
      assigned_at = v_now,
      last_interaction_at = v_now,
      status = 'em_atendimento'::public.referral_status,
      updated_at = v_now
  where id = p_referral_id
    and commercial_profile_id = v_previous_commercial
    and first_response_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'race_conflict', 'referral_id', p_referral_id);
  end if;

  update public.commercial_lead_settings
  set last_lead_received_at = v_now,
      active_leads = active_leads + 1,
      total_received_today = total_received_today + 1,
      updated_at = v_now
  where commercial_profile_id = v_new_commercial;

  insert into public.referral_history (
    referral_id,
    actor_profile_id,
    old_status,
    new_status,
    action_note,
    metadata
  )
  values (
    p_referral_id,
    v_new_commercial,
    v_old_status,
    'em_atendimento'::public.referral_status,
    'Lead redistribuído automaticamente por SLA',
    jsonb_build_object(
      'action', 'commercial_sla_redistributed',
      'previous_commercial_profile_id', v_previous_commercial,
      'new_commercial_profile_id', v_new_commercial,
      'redistribution_count', v_new_count,
      'redistributed_at', v_now
    )
  );

  for v_admin in
    select p.id as admin_profile_id
    from public.profiles p
    where p.role in (
      'admin_master'::public.user_role,
      'admin_financeiro'::public.user_role
    )
  loop
    if public.notify_commercial_sla_redistributed(
      v_admin.admin_profile_id,
      p_referral_id,
      'commercial_sla_redistributed_admin',
      'Lead redistribuído automaticamente',
      'Um lead foi redistribuído para outro comercial por SLA.',
      v_new_count,
      '/admin/indicacoes/' || p_referral_id::text,
      jsonb_build_object(
        'previous_commercial_profile_id', v_previous_commercial::text,
        'new_commercial_profile_id', v_new_commercial::text
      )
    ) then
      v_notified := v_notified + 1;
    end if;
  end loop;

  if public.notify_commercial_sla_redistributed(
    v_previous_commercial,
    p_referral_id,
    'commercial_sla_redistributed_removed',
    'Lead removido por SLA',
    'O lead foi redistribuído para outro comercial por falta de primeiro contato.',
    v_new_count,
    '/comercial/leads/' || p_referral_id::text,
    jsonb_build_object('new_commercial_profile_id', v_new_commercial::text)
  ) then
    v_notified := v_notified + 1;
  end if;

  if public.notify_commercial_sla_redistributed(
    v_new_commercial,
    p_referral_id,
    'commercial_sla_redistributed_assigned',
    'Novo lead redistribuído para você',
    'Um lead foi redistribuído automaticamente e atribuído a você.',
    v_new_count,
    '/comercial/leads/' || p_referral_id::text,
    jsonb_build_object('previous_commercial_profile_id', v_previous_commercial::text)
  ) then
    v_notified := v_notified + 1;
  end if;

  perform public.log_commercial_redistribution_debug(
    'redistribute_single_commercial_lead',
    p_referral_id,
    v_new_commercial,
    jsonb_build_object(
      'phase', 'success',
      'previous_commercial_profile_id', v_previous_commercial,
      'redistribution_count', v_new_count,
      'notifications_created', v_notified
    )
  );

  return jsonb_build_object(
    'ok', true,
    'referral_id', p_referral_id,
    'previous_commercial_profile_id', v_previous_commercial,
    'commercial_profile_id', v_new_commercial,
    'redistribution_count', v_new_count,
    'notifications_created', v_notified
  );
exception
  when others then
    perform public.log_commercial_redistribution_debug(
      'redistribute_single_commercial_lead',
      p_referral_id,
      null,
      jsonb_build_object('phase', 'error', 'message', sqlerrm, 'sqlstate', sqlstate)
    );
    return jsonb_build_object('ok', false, 'code', 'exception', 'message', sqlerrm);
end;
$$;

-- ============================================================
-- RPC: redistribuir leads elegíveis em lote
-- ============================================================
create or replace function public.redistribute_overdue_commercial_leads()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_checked_count integer := 0;
  v_redistributed_count integer := 0;
  v_skipped_count integer := 0;
  v_error_count integer := 0;
  v_notifications_created integer := 0;
  v_referrals jsonb := '[]'::jsonb;
  v_row record;
  v_result jsonb;
begin
  perform public.log_commercial_redistribution_debug(
    'redistribute_overdue_commercial_leads',
    null,
    null,
    jsonb_build_object('phase', 'start', 'now', v_now)
  );

  select count(*)::integer
  into v_checked_count
  from public.referrals r
  where r.commercial_profile_id is not null
    and r.assigned_at is not null
    and r.first_response_at is null
    and r.redistribution_count < 3
    and r.status in (
      'pendente'::public.referral_status,
      'em_atendimento'::public.referral_status,
      'em_andamento'::public.referral_status,
      'em_negociacao'::public.referral_status
    )
    and v_now > r.assigned_at + interval '45 minutes'
    and (
      r.last_redistributed_at is null
      or v_now > r.last_redistributed_at + interval '15 minutes'
    );

  for v_row in
    select r.id
    from public.referrals r
    where r.commercial_profile_id is not null
      and r.assigned_at is not null
      and r.first_response_at is null
      and r.redistribution_count < 3
      and r.status in (
        'pendente'::public.referral_status,
        'em_atendimento'::public.referral_status,
        'em_andamento'::public.referral_status,
        'em_negociacao'::public.referral_status
      )
      and v_now > r.assigned_at + interval '45 minutes'
      and (
        r.last_redistributed_at is null
        or v_now > r.last_redistributed_at + interval '15 minutes'
      )
    order by r.assigned_at asc
    for update of r skip locked
  loop
    v_result := public.redistribute_single_commercial_lead(v_row.id);

    if coalesce((v_result->>'ok')::boolean, false) then
      v_redistributed_count := v_redistributed_count + 1;
      v_notifications_created := v_notifications_created
        + coalesce((v_result->>'notifications_created')::integer, 0);
      v_referrals := v_referrals || jsonb_build_array(v_result);
    elsif (v_result->>'code') in (
      'no_commercial_available',
      'cooldown',
      'max_redistributions',
      'already_responded',
      'sla_not_ready',
      'not_assigned'
    ) then
      v_skipped_count := v_skipped_count + 1;
      perform public.log_commercial_redistribution_debug(
        'redistribute_overdue_commercial_leads',
        v_row.id,
        null,
        jsonb_build_object('phase', 'skip', 'result', v_result)
      );
    else
      v_error_count := v_error_count + 1;
      perform public.log_commercial_redistribution_debug(
        'redistribute_overdue_commercial_leads',
        v_row.id,
        null,
        jsonb_build_object('phase', 'error', 'result', v_result)
      );
    end if;
  end loop;

  perform public.log_commercial_redistribution_debug(
    'redistribute_overdue_commercial_leads',
    null,
    null,
    jsonb_build_object(
      'phase', 'done',
      'checked_count', v_checked_count,
      'redistributed_count', v_redistributed_count,
      'skipped_count', v_skipped_count,
      'error_count', v_error_count,
      'notifications_created', v_notifications_created
    )
  );

  return jsonb_build_object(
    'ok', true,
    'checked_count', v_checked_count,
    'redistributed_count', v_redistributed_count,
    'skipped_count', v_skipped_count,
    'error_count', v_error_count,
    'notifications_created', v_notifications_created,
    'referrals', coalesce(v_referrals, '[]'::jsonb)
  );
exception
  when others then
    perform public.log_commercial_redistribution_debug(
      'redistribute_overdue_commercial_leads',
      null,
      null,
      jsonb_build_object('phase', 'exception', 'message', sqlerrm)
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'exception',
      'message', sqlerrm,
      'checked_count', v_checked_count,
      'redistributed_count', v_redistributed_count
    );
end;
$$;

revoke all on function public.redistribute_overdue_commercial_leads() from public;
grant execute on function public.redistribute_overdue_commercial_leads() to authenticated;
grant execute on function public.redistribute_overdue_commercial_leads() to service_role;

revoke all on function public.redistribute_single_commercial_lead(uuid) from public;
grant execute on function public.redistribute_single_commercial_lead(uuid) to service_role;

revoke all on function public.pick_next_available_commercial(uuid) from public;
grant execute on function public.pick_next_available_commercial(uuid) to service_role;

revoke all on function public.notify_commercial_sla_redistributed(uuid, uuid, text, text, text, integer, text, jsonb) from public;
grant execute on function public.notify_commercial_sla_redistributed(uuid, uuid, text, text, text, integer, text, jsonb) to service_role;

commit;

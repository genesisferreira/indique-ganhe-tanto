-- SLA comercial: detectar leads sem primeiro contato após 15 min de assigned_at.
-- Execução manual (sem cron): select public.detect_overdue_commercial_leads();
-- Aplicar após schema.sql, rls-policies.sql e patches de referrals/notifications.

begin;

-- ============================================================
-- Debug
-- ============================================================
create table if not exists public.debug_commercial_sla_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  referral_id uuid,
  commercial_profile_id uuid,
  detail jsonb not null default '{}'::jsonb,
  executed_at timestamptz not null default timezone('utc', now())
);

create index if not exists debug_commercial_sla_logs_executed_at_idx
  on public.debug_commercial_sla_logs (executed_at desc);

alter table public.debug_commercial_sla_logs enable row level security;

drop policy if exists debug_commercial_sla_logs_select on public.debug_commercial_sla_logs;
create policy debug_commercial_sla_logs_select
on public.debug_commercial_sla_logs
for select
to authenticated
using (public.is_admin_read_any() or public.is_comercial());

create or replace function public.log_commercial_sla_debug(
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
  insert into public.debug_commercial_sla_logs (
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
-- Notificação SLA (dedupe por referral + action)
-- ============================================================
create or replace function public.notify_commercial_sla_overdue(
  p_profile_id uuid,
  p_referral_id uuid,
  p_commercial_profile_id uuid,
  p_assigned_at timestamptz,
  p_action_url text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile_id is null or p_referral_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.notifications n
    where n.profile_id = p_profile_id
      and n.data->>'action' = 'commercial_sla_overdue'
      and n.data->>'referral_id' = p_referral_id::text
  ) then
    perform public.log_commercial_sla_debug(
      'notify_commercial_sla_overdue',
      p_referral_id,
      p_commercial_profile_id,
      jsonb_build_object('phase', 'skip_duplicate', 'profile_id', p_profile_id)
    );
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
    'Lead vencido por SLA',
    'Um lead está sem resposta há mais de 15 minutos.',
    jsonb_build_object(
      'action', 'commercial_sla_overdue',
      'referral_id', p_referral_id::text,
      'commercial_profile_id', coalesce(p_commercial_profile_id::text, ''),
      'assigned_at', coalesce(p_assigned_at::text, '')
    ),
    false,
    p_action_url
  );

  perform public.log_commercial_sla_debug(
    'notify_commercial_sla_overdue',
    p_referral_id,
    p_commercial_profile_id,
    jsonb_build_object('phase', 'inserted', 'profile_id', p_profile_id, 'action_url', p_action_url)
  );

  return true;
exception
  when others then
    perform public.log_commercial_sla_debug(
      'notify_commercial_sla_overdue',
      p_referral_id,
      p_commercial_profile_id,
      jsonb_build_object('phase', 'error', 'profile_id', p_profile_id, 'message', sqlerrm)
    );
    return false;
end;
$$;

-- ============================================================
-- Histórico SLA (opcional, dedupe por metadata.action)
-- ============================================================
create or replace function public.insert_commercial_sla_overdue_history(
  p_referral_id uuid,
  p_commercial_profile_id uuid,
  p_old_status public.referral_status,
  p_assigned_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_referral_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.referral_history h
    where h.referral_id = p_referral_id
      and h.metadata->>'action' = 'commercial_sla_overdue'
  ) then
    return false;
  end if;

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
    p_commercial_profile_id,
    p_old_status,
    p_old_status,
    'SLA comercial vencido: sem primeiro contato em 15 minutos',
    jsonb_build_object(
      'action', 'commercial_sla_overdue',
      'commercial_profile_id', p_commercial_profile_id,
      'assigned_at', p_assigned_at,
      'sla_minutes', 15
    )
  );

  return true;
exception
  when others then
    return false;
end;
$$;

-- ============================================================
-- Detecção manual de leads vencidos
-- ============================================================
create or replace function public.detect_overdue_commercial_leads()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_sla interval := interval '15 minutes';
  v_checked_count integer := 0;
  v_overdue_count integer := 0;
  v_notifications_created integer := 0;
  v_history_created integer := 0;
  v_referrals jsonb := '[]'::jsonb;
  v_row record;
  v_admin record;
  v_notified boolean;
begin
  perform public.log_commercial_sla_debug(
    'detect_overdue_commercial_leads',
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
    and r.status in (
      'pendente'::public.referral_status,
      'em_atendimento'::public.referral_status,
      'em_andamento'::public.referral_status,
      'em_negociacao'::public.referral_status
    );

  for v_row in
    select
      r.id,
      r.commercial_profile_id,
      r.assigned_at,
      r.status,
      r.referred_name
    from public.referrals r
    where r.commercial_profile_id is not null
      and r.assigned_at is not null
      and r.first_response_at is null
      and r.status in (
        'pendente'::public.referral_status,
        'em_atendimento'::public.referral_status,
        'em_andamento'::public.referral_status,
        'em_negociacao'::public.referral_status
      )
      and v_now > r.assigned_at + v_sla
    order by r.assigned_at asc
  loop
    v_overdue_count := v_overdue_count + 1;

    if public.insert_commercial_sla_overdue_history(
      v_row.id,
      v_row.commercial_profile_id,
      v_row.status,
      v_row.assigned_at
    ) then
      v_history_created := v_history_created + 1;
    end if;

    for v_admin in
      select p.id as admin_profile_id
      from public.profiles p
      where p.role in (
        'admin_master'::public.user_role,
        'admin_financeiro'::public.user_role
      )
    loop
      v_notified := public.notify_commercial_sla_overdue(
        v_admin.admin_profile_id,
        v_row.id,
        v_row.commercial_profile_id,
        v_row.assigned_at,
        '/admin/indicacoes/' || v_row.id::text
      );
      if v_notified then
        v_notifications_created := v_notifications_created + 1;
      end if;
    end loop;

    v_notified := public.notify_commercial_sla_overdue(
      v_row.commercial_profile_id,
      v_row.id,
      v_row.commercial_profile_id,
      v_row.assigned_at,
      '/comercial/leads/' || v_row.id::text
    );
    if v_notified then
      v_notifications_created := v_notifications_created + 1;
    end if;

    v_referrals := v_referrals || jsonb_build_array(
      jsonb_build_object(
        'referral_id', v_row.id,
        'commercial_profile_id', v_row.commercial_profile_id,
        'assigned_at', v_row.assigned_at,
        'status', v_row.status::text,
        'referred_name', v_row.referred_name,
        'minutes_overdue', extract(epoch from (v_now - (v_row.assigned_at + v_sla))) / 60.0
      )
    );
  end loop;

  perform public.log_commercial_sla_debug(
    'detect_overdue_commercial_leads',
    null,
    null,
    jsonb_build_object(
      'phase', 'done',
      'checked_count', v_checked_count,
      'overdue_count', v_overdue_count,
      'notifications_created', v_notifications_created,
      'history_created', v_history_created
    )
  );

  return jsonb_build_object(
    'ok', true,
    'checked_count', v_checked_count,
    'overdue_count', v_overdue_count,
    'notifications_created', v_notifications_created,
    'history_created', v_history_created,
    'referrals', coalesce(v_referrals, '[]'::jsonb)
  );
exception
  when others then
    perform public.log_commercial_sla_debug(
      'detect_overdue_commercial_leads',
      null,
      null,
      jsonb_build_object('phase', 'error', 'message', sqlerrm, 'sqlstate', sqlstate)
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'exception',
      'message', sqlerrm,
      'checked_count', v_checked_count,
      'overdue_count', v_overdue_count,
      'referrals', coalesce(v_referrals, '[]'::jsonb)
    );
end;
$$;

revoke all on function public.detect_overdue_commercial_leads() from public;
grant execute on function public.detect_overdue_commercial_leads() to authenticated;
grant execute on function public.detect_overdue_commercial_leads() to service_role;

revoke all on function public.notify_commercial_sla_overdue(uuid, uuid, uuid, timestamptz, text) from public;
grant execute on function public.notify_commercial_sla_overdue(uuid, uuid, uuid, timestamptz, text) to service_role;

commit;

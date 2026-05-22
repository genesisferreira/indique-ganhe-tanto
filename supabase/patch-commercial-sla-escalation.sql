-- Escalonamento SLA comercial (15 / 30 / 45 min) — sem redistribuição automática.
-- Aplicar após patch-commercial-sla.sql
-- Manual: select public.detect_commercial_sla_escalations();

begin;

-- ============================================================
-- Notificação por nível (dedupe referral_id + action)
-- ============================================================
create or replace function public.notify_commercial_sla_escalation(
  p_profile_id uuid,
  p_referral_id uuid,
  p_commercial_profile_id uuid,
  p_assigned_at timestamptz,
  p_action text,
  p_title text,
  p_message text,
  p_action_url text
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
  ) then
    perform public.log_commercial_sla_debug(
      'notify_commercial_sla_escalation',
      p_referral_id,
      p_commercial_profile_id,
      jsonb_build_object(
        'phase', 'skip_duplicate',
        'profile_id', p_profile_id,
        'action', p_action
      )
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
    p_title,
    p_message,
    jsonb_build_object(
      'action', p_action,
      'referral_id', p_referral_id::text,
      'commercial_profile_id', coalesce(p_commercial_profile_id::text, ''),
      'assigned_at', coalesce(p_assigned_at::text, '')
    ),
    false,
    p_action_url
  );

  perform public.log_commercial_sla_debug(
    'notify_commercial_sla_escalation',
    p_referral_id,
    p_commercial_profile_id,
    jsonb_build_object(
      'phase', 'inserted',
      'profile_id', p_profile_id,
      'action', p_action,
      'action_url', p_action_url
    )
  );

  return true;
exception
  when others then
    perform public.log_commercial_sla_debug(
      'notify_commercial_sla_escalation',
      p_referral_id,
      p_commercial_profile_id,
      jsonb_build_object(
        'phase', 'error',
        'action', p_action,
        'message', sqlerrm
      )
    );
    return false;
end;
$$;

-- ============================================================
-- Histórico por nível (dedupe metadata.action)
-- ============================================================
create or replace function public.insert_commercial_sla_escalation_history(
  p_referral_id uuid,
  p_commercial_profile_id uuid,
  p_old_status public.referral_status,
  p_assigned_at timestamptz,
  p_action text,
  p_action_note text,
  p_sla_minutes integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_referral_id is null or p_action is null then
    return false;
  end if;

  if exists (
    select 1
    from public.referral_history h
    where h.referral_id = p_referral_id
      and h.metadata->>'action' = p_action
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
    p_action_note,
    jsonb_build_object(
      'action', p_action,
      'commercial_profile_id', p_commercial_profile_id,
      'assigned_at', p_assigned_at,
      'sla_minutes', p_sla_minutes
    )
  );

  return true;
exception
  when others then
    return false;
end;
$$;

-- ============================================================
-- Disparo de um nível (notifica comercial + admins)
-- ============================================================
create or replace function public.process_commercial_sla_escalation_level(
  p_referral_id uuid,
  p_commercial_profile_id uuid,
  p_assigned_at timestamptz,
  p_status public.referral_status,
  p_referred_name text,
  p_action text,
  p_title text,
  p_message text,
  p_sla_minutes integer,
  p_action_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_notifications_created integer := 0;
  v_history_created integer := 0;
  v_notified boolean;
begin
  if public.insert_commercial_sla_escalation_history(
    p_referral_id,
    p_commercial_profile_id,
    p_status,
    p_assigned_at,
    p_action,
    p_action_note,
    p_sla_minutes
  ) then
    v_history_created := 1;
  end if;

  for v_admin in
    select p.id as admin_profile_id
    from public.profiles p
    where p.role in (
      'admin_master'::public.user_role,
      'admin_financeiro'::public.user_role
    )
  loop
    v_notified := public.notify_commercial_sla_escalation(
      v_admin.admin_profile_id,
      p_referral_id,
      p_commercial_profile_id,
      p_assigned_at,
      p_action,
      p_title,
      p_message,
      '/admin/indicacoes/' || p_referral_id::text
    );
    if v_notified then
      v_notifications_created := v_notifications_created + 1;
    end if;
  end loop;

  v_notified := public.notify_commercial_sla_escalation(
    p_commercial_profile_id,
    p_referral_id,
    p_commercial_profile_id,
    p_assigned_at,
    p_action,
    p_title,
    p_message,
    '/comercial/leads/' || p_referral_id::text
  );
  if v_notified then
    v_notifications_created := v_notifications_created + 1;
  end if;

  return jsonb_build_object(
    'action', p_action,
    'notifications_created', v_notifications_created,
    'history_created', v_history_created,
    'referral_id', p_referral_id,
    'referred_name', p_referred_name,
    'sla_minutes', p_sla_minutes
  );
end;
$$;

-- ============================================================
-- Detecção escalonada (15 / 30 / 45 min)
-- ============================================================
create or replace function public.detect_commercial_sla_escalations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_checked_count integer := 0;
  v_warning_count integer := 0;
  v_critical_count integer := 0;
  v_redistribution_ready_count integer := 0;
  v_notifications_created integer := 0;
  v_history_created integer := 0;
  v_referrals jsonb := '[]'::jsonb;
  v_row record;
  v_elapsed interval;
  v_level_result jsonb;
begin
  perform public.log_commercial_sla_debug(
    'detect_commercial_sla_escalations',
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
    order by r.assigned_at asc
  loop
    v_elapsed := v_now - v_row.assigned_at;

    -- 15 min: alerta
    if v_elapsed >= interval '15 minutes' then
      v_level_result := public.process_commercial_sla_escalation_level(
        v_row.id,
        v_row.commercial_profile_id,
        v_row.assigned_at,
        v_row.status,
        v_row.referred_name,
        'commercial_sla_warning',
        'Lead próximo do vencimento',
        'Um lead está sem resposta há mais de 15 minutos.',
        15,
        'SLA comercial: alerta — sem primeiro contato em 15 minutos'
      );
      v_warning_count := v_warning_count + 1;
      v_notifications_created := v_notifications_created
        + coalesce((v_level_result->>'notifications_created')::integer, 0);
      v_history_created := v_history_created
        + coalesce((v_level_result->>'history_created')::integer, 0);
    end if;

    -- 30 min: crítico
    if v_elapsed >= interval '30 minutes' then
      v_level_result := public.process_commercial_sla_escalation_level(
        v_row.id,
        v_row.commercial_profile_id,
        v_row.assigned_at,
        v_row.status,
        v_row.referred_name,
        'commercial_sla_critical',
        'Lead em SLA crítico',
        'Um lead está sem resposta há mais de 30 minutos.',
        30,
        'SLA comercial: crítico — sem primeiro contato em 30 minutos'
      );
      v_critical_count := v_critical_count + 1;
      v_notifications_created := v_notifications_created
        + coalesce((v_level_result->>'notifications_created')::integer, 0);
      v_history_created := v_history_created
        + coalesce((v_level_result->>'history_created')::integer, 0);
    end if;

    -- 45 min: elegível redistribuição (ainda sem redistribuir)
    if v_elapsed >= interval '45 minutes' then
      v_level_result := public.process_commercial_sla_escalation_level(
        v_row.id,
        v_row.commercial_profile_id,
        v_row.assigned_at,
        v_row.status,
        v_row.referred_name,
        'commercial_sla_redistribution_ready',
        'Lead pronto para redistribuição',
        'Um lead está sem resposta há mais de 45 minutos e pode ser redistribuído.',
        45,
        'SLA comercial: elegível para redistribuição — sem primeiro contato em 45 minutos'
      );
      v_redistribution_ready_count := v_redistribution_ready_count + 1;
      v_notifications_created := v_notifications_created
        + coalesce((v_level_result->>'notifications_created')::integer, 0);
      v_history_created := v_history_created
        + coalesce((v_level_result->>'history_created')::integer, 0);
    end if;

    if v_elapsed >= interval '15 minutes' then
      v_referrals := v_referrals || jsonb_build_array(
        jsonb_build_object(
          'referral_id', v_row.id,
          'commercial_profile_id', v_row.commercial_profile_id,
          'assigned_at', v_row.assigned_at,
          'status', v_row.status::text,
          'referred_name', v_row.referred_name,
          'minutes_elapsed', extract(epoch from v_elapsed) / 60.0,
          'sla_level',
          case
            when v_elapsed >= interval '45 minutes' then 'redistribution_ready'
            when v_elapsed >= interval '30 minutes' then 'critical'
            else 'warning'
          end
        )
      );
    end if;
  end loop;

  perform public.log_commercial_sla_debug(
    'detect_commercial_sla_escalations',
    null,
    null,
    jsonb_build_object(
      'phase', 'done',
      'checked_count', v_checked_count,
      'warning_count', v_warning_count,
      'critical_count', v_critical_count,
      'redistribution_ready_count', v_redistribution_ready_count,
      'notifications_created', v_notifications_created,
      'history_created', v_history_created
    )
  );

  return jsonb_build_object(
    'ok', true,
    'checked_count', v_checked_count,
    'warning_count', v_warning_count,
    'critical_count', v_critical_count,
    'redistribution_ready_count', v_redistribution_ready_count,
    'notifications_created', v_notifications_created,
    'history_created', v_history_created,
    'referrals', coalesce(v_referrals, '[]'::jsonb)
  );
exception
  when others then
    perform public.log_commercial_sla_debug(
      'detect_commercial_sla_escalations',
      null,
      null,
      jsonb_build_object('phase', 'error', 'message', sqlerrm, 'sqlstate', sqlstate)
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'exception',
      'message', sqlerrm,
      'checked_count', v_checked_count,
      'referrals', coalesce(v_referrals, '[]'::jsonb)
    );
end;
$$;

revoke all on function public.detect_commercial_sla_escalations() from public;
grant execute on function public.detect_commercial_sla_escalations() to authenticated;
grant execute on function public.detect_commercial_sla_escalations() to service_role;

revoke all on function public.notify_commercial_sla_escalation(uuid, uuid, uuid, timestamptz, text, text, text, text) from public;
grant execute on function public.notify_commercial_sla_escalation(uuid, uuid, uuid, timestamptz, text, text, text, text) to service_role;

revoke all on function public.process_commercial_sla_escalation_level(uuid, uuid, timestamptz, public.referral_status, text, text, text, text, integer, text) from public;
grant execute on function public.process_commercial_sla_escalation_level(uuid, uuid, timestamptz, public.referral_status, text, text, text, text, integer, text) to service_role;

commit;

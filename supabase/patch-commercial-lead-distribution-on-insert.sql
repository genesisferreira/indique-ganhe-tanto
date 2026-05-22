-- Distribuição de leads na CRIAÇÃO da indicação (AFTER INSERT).
-- Mantém trigger de aprovação; idempotência via commercial_profile_id IS NULL na RPC.
-- Aplicar após patch-commercial-lead-distribution.sql no SQL Editor.

begin;

-- ============================================================
-- RPC: atribuir próximo comercial (criação + aprovação)
-- ============================================================
create or replace function public.assign_referral_to_next_commercial(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
  v_commercial_id uuid;
  v_old_status public.referral_status;
  v_now timestamptz := timezone('utc', now());
  v_today date := (v_now at time zone 'utc')::date;
begin
  perform public.log_lead_assignment_debug(
    'assign_referral_to_next_commercial',
    p_referral_id,
    null,
    jsonb_build_object('phase', 'start')
  );

  if p_referral_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_referral', 'message', 'Indicação inválida.');
  end if;

  select * into v_ref
  from public.referrals
  where id = p_referral_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Indicação não encontrada.');
  end if;

  -- Idempotência: já atribuída (INSERT com comercial manual, trigger anterior, etc.)
  if v_ref.commercial_profile_id is not null then
    perform public.log_lead_assignment_debug(
      'assign_referral_to_next_commercial',
      p_referral_id,
      v_ref.commercial_profile_id,
      jsonb_build_object('phase', 'already_assigned', 'status', v_ref.status::text)
    );
    return jsonb_build_object(
      'ok', true,
      'code', 'already_assigned',
      'referral_id', p_referral_id,
      'commercial_profile_id', v_ref.commercial_profile_id,
      'status', v_ref.status::text
    );
  end if;

  -- Não distribuir indicações encerradas
  if v_ref.status in (
    'recusada'::public.referral_status,
    'paga'::public.referral_status
  ) then
    perform public.log_lead_assignment_debug(
      'assign_referral_to_next_commercial',
      p_referral_id,
      null,
      jsonb_build_object('phase', 'skip_terminal_status', 'status', v_ref.status::text)
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'terminal_status',
      'message', 'Indicação encerrada; distribuição automática não se aplica.',
      'status', v_ref.status::text
    );
  end if;

  -- Reset contador diário (UTC) para comerciais elegíveis
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
  order by s.last_lead_received_at asc nulls first, s.active_leads asc, s.commercial_profile_id asc
  limit 1
  for update of s;

  if v_commercial_id is null then
    perform public.log_lead_assignment_debug(
      'assign_referral_to_next_commercial',
      p_referral_id,
      null,
      jsonb_build_object('phase', 'no_commercial_available', 'status', v_ref.status::text)
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'no_commercial_available',
      'message', 'Nenhum comercial disponível para receber leads no momento.',
      'status', v_ref.status::text
    );
  end if;

  v_old_status := v_ref.status;

  update public.referrals
  set commercial_profile_id = v_commercial_id,
      status = 'em_atendimento'::public.referral_status,
      assigned_at = coalesce(assigned_at, v_now),
      last_interaction_at = v_now,
      updated_at = v_now
  where id = p_referral_id
    and commercial_profile_id is null;

  if not found then
    perform public.log_lead_assignment_debug(
      'assign_referral_to_next_commercial',
      p_referral_id,
      null,
      jsonb_build_object('phase', 'race_already_assigned')
    );
    return jsonb_build_object(
      'ok', true,
      'code', 'already_assigned',
      'referral_id', p_referral_id,
      'message', 'Outro processo já atribuiu o lead.'
    );
  end if;

  update public.commercial_lead_settings
  set last_lead_received_at = v_now,
      active_leads = active_leads + 1,
      total_received_today = total_received_today + 1,
      updated_at = v_now
  where commercial_profile_id = v_commercial_id;

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
    v_commercial_id,
    v_old_status,
    'em_atendimento'::public.referral_status,
    'Lead atribuído automaticamente ao comercial',
    jsonb_build_object(
      'action', 'commercial_assigned',
      'assigned_commercial_id', v_commercial_id,
      'distribution', 'round_robin_last_lead_received_at'
    )
  );

  perform public.notify_commercial_lead_assigned(v_commercial_id, p_referral_id);

  perform public.log_lead_assignment_debug(
    'assign_referral_to_next_commercial',
    p_referral_id,
    v_commercial_id,
    jsonb_build_object(
      'phase', 'assigned',
      'commercial_profile_id', v_commercial_id,
      'previous_status', v_old_status::text
    )
  );

  return jsonb_build_object(
    'ok', true,
    'referral_id', p_referral_id,
    'commercial_profile_id', v_commercial_id,
    'status', 'em_atendimento',
    'previous_status', v_old_status::text
  );
exception
  when others then
    perform public.log_lead_assignment_debug(
      'assign_referral_to_next_commercial',
      p_referral_id,
      v_commercial_id,
      jsonb_build_object('phase', 'error', 'message', sqlerrm, 'sqlstate', sqlstate)
    );
    return jsonb_build_object('ok', false, 'code', 'exception', 'message', sqlerrm);
end;
$$;

revoke all on function public.assign_referral_to_next_commercial(uuid) from public;
grant execute on function public.assign_referral_to_next_commercial(uuid) to authenticated;

-- ============================================================
-- Trigger: INSERT → distribuir se pool (commercial_profile_id null)
-- ============================================================
create or replace function public.trg_referrals_assign_commercial_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.commercial_profile_id is not null then
    perform public.log_lead_assignment_debug(
      'trg_referrals_assign_commercial_on_insert',
      NEW.id,
      NEW.commercial_profile_id,
      jsonb_build_object('phase', 'skip_prefilled_commercial', 'status', NEW.status::text)
    );
    return NEW;
  end if;

  if NEW.status in (
    'recusada'::public.referral_status,
    'paga'::public.referral_status
  ) then
    perform public.log_lead_assignment_debug(
      'trg_referrals_assign_commercial_on_insert',
      NEW.id,
      null,
      jsonb_build_object('phase', 'skip_terminal_status', 'status', NEW.status::text)
    );
    return NEW;
  end if;

  perform public.log_lead_assignment_debug(
    'trg_referrals_assign_commercial_on_insert',
    NEW.id,
    null,
    jsonb_build_object('phase', 'invoke_rpc', 'status', NEW.status::text)
  );

  perform public.assign_referral_to_next_commercial(NEW.id);

  return NEW;
exception
  when others then
    perform public.log_lead_assignment_debug(
      'trg_referrals_assign_commercial_on_insert',
      NEW.id,
      null,
      jsonb_build_object('phase', 'error', 'message', sqlerrm, 'sqlstate', sqlstate)
    );
    return NEW;
end;
$$;

drop trigger if exists trg_referrals_assign_commercial_on_insert on public.referrals;
create trigger trg_referrals_assign_commercial_on_insert
after insert on public.referrals
for each row
execute function public.trg_referrals_assign_commercial_on_insert();

-- ============================================================
-- Trigger: aprovação (fallback se criação não conseguiu comercial)
-- ============================================================
create or replace function public.trg_referrals_assign_commercial_on_aprovada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'aprovada'::public.referral_status
     and OLD.status is distinct from NEW.status
     and NEW.commercial_profile_id is null then
    perform public.log_lead_assignment_debug(
      'trg_referrals_assign_commercial_on_aprovada',
      NEW.id,
      null,
      jsonb_build_object('phase', 'invoke_rpc', 'old_status', OLD.status::text)
    );
    perform public.assign_referral_to_next_commercial(NEW.id);
  end if;
  return NEW;
exception
  when others then
    perform public.log_lead_assignment_debug(
      'trg_referrals_assign_commercial_on_aprovada',
      NEW.id,
      null,
      jsonb_build_object('phase', 'error', 'message', sqlerrm, 'sqlstate', sqlstate)
    );
    return NEW;
end;
$$;

drop trigger if exists trg_referrals_assign_commercial_on_aprovada on public.referrals;
create trigger trg_referrals_assign_commercial_on_aprovada
after update of status on public.referrals
for each row
execute function public.trg_referrals_assign_commercial_on_aprovada();

-- Realtime (idempotente)
do $$
begin
  alter publication supabase_realtime add table public.commercial_lead_settings;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.referrals;
exception
  when duplicate_object then null;
end $$;

commit;

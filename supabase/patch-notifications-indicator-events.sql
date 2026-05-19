-- Notificações do indicador (referral_progress / reward_released).
-- OBRIGATÓRIO no Supabase SQL Editor. Comercial/admin não passam RLS de INSERT em notifications.
-- Aplicar também: patch-mark-first-invoice-notify-indicator.sql (se usar mark_first_invoice_paid).

-- ============================================================
-- Debug (temporário — remover em produção se desejar)
-- ============================================================
create table if not exists public.debug_notification_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  referral_id uuid,
  reward_id uuid,
  indicator_profile_id uuid,
  old_status text,
  new_status text,
  action text,
  detail jsonb not null default '{}'::jsonb,
  executed_at timestamptz not null default timezone('utc', now())
);

create index if not exists debug_notification_logs_executed_at_idx
  on public.debug_notification_logs (executed_at desc);

alter table public.debug_notification_logs enable row level security;

drop policy if exists debug_notification_logs_admin_select on public.debug_notification_logs;
create policy debug_notification_logs_admin_select
on public.debug_notification_logs
for select
to authenticated
using (public.is_admin_read_any());

-- ============================================================
-- Helper debug (nunca quebra fluxo)
-- ============================================================
create or replace function public.log_notification_debug(
  p_source text,
  p_referral_id uuid default null,
  p_indicator_profile_id uuid default null,
  p_old_status text default null,
  p_new_status text default null,
  p_action text default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.debug_notification_logs (
    source,
    referral_id,
    indicator_profile_id,
    old_status,
    new_status,
    action,
    detail
  )
  values (
    p_source,
    p_referral_id,
    p_indicator_profile_id,
    p_old_status,
    p_new_status,
    p_action,
    coalesce(p_detail, '{}'::jsonb)
  );
exception
  when others then
    null;
end;
$$;

revoke all on function public.log_notification_debug(text, uuid, uuid, text, text, text, jsonb) from public;
grant execute on function public.log_notification_debug(text, uuid, uuid, text, text, text, jsonb) to authenticated;

-- ============================================================
-- referral_progress
-- ============================================================
create or replace function public.notify_indicator_referral_progress(p_referral_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_indicator_id uuid;
  v_status text;
  v_inserted int;
begin
  if p_referral_id is null then
    perform public.log_notification_debug(
      'notify_indicator_referral_progress',
      null, null, null, null,
      'referral_progress',
      jsonb_build_object('skip', 'null_referral_id')
    );
    return;
  end if;

  select r.indicator_profile_id, r.status::text
  into v_indicator_id, v_status
  from public.referrals r
  where r.id = p_referral_id;

  if v_indicator_id is null then
    perform public.log_notification_debug(
      'notify_indicator_referral_progress',
      p_referral_id, null, null, v_status,
      'referral_progress',
      jsonb_build_object('skip', 'no_indicator')
    );
    return;
  end if;

  if v_status not in (
    'em_atendimento', 'em_negociacao', 'aprovada', 'paga', 'recusada',
    'em_andamento', 'pendente'
  ) then
    perform public.log_notification_debug(
      'notify_indicator_referral_progress',
      p_referral_id, v_indicator_id, null, v_status,
      'referral_progress',
      jsonb_build_object('skip', 'status_not_notifiable', 'status', v_status)
    );
    return;
  end if;

  insert into public.notifications (
    profile_id,
    notification_type,
    title,
    message,
    data,
    action_url
  )
  select
    v_indicator_id,
    'indicacao'::public.notification_type,
    'Sua indicação avançou',
    'O lead indicado por você avançou no funil comercial.',
    jsonb_build_object(
      'action', 'referral_progress',
      'referral_id', p_referral_id::text,
      'new_status', v_status
    ),
    '/indicador/indicacoes/' || p_referral_id::text
  where not exists (
    select 1
    from public.notifications n
    where n.profile_id = v_indicator_id
      and n.notification_type = 'indicacao'
      and n.data->>'action' = 'referral_progress'
      and n.data->>'referral_id' = p_referral_id::text
      and n.data->>'new_status' = v_status
  );

  get diagnostics v_inserted = row_count;

  perform public.log_notification_debug(
    'notify_indicator_referral_progress',
    p_referral_id,
    v_indicator_id,
    null,
    v_status,
    'referral_progress',
    jsonb_build_object('inserted_rows', v_inserted)
  );
exception
  when others then
    perform public.log_notification_debug(
      'notify_indicator_referral_progress',
      p_referral_id,
      v_indicator_id,
      null,
      v_status,
      'referral_progress',
      jsonb_build_object('error', sqlerrm)
    );
end;
$$;

-- ============================================================
-- reward_released
-- ============================================================
create or replace function public.notify_indicator_reward_released(p_referral_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_indicator_id uuid;
  v_reward_id uuid;
  v_inserted int;
begin
  if p_referral_id is null then
    perform public.log_notification_debug(
      'notify_indicator_reward_released',
      null, null, null, null,
      'reward_released',
      jsonb_build_object('skip', 'null_referral_id')
    );
    return;
  end if;

  select r.indicator_profile_id, rw.id
  into v_indicator_id, v_reward_id
  from public.referrals r
  left join public.rewards rw on rw.referral_id = r.id
  where r.id = p_referral_id;

  if v_indicator_id is null then
    perform public.log_notification_debug(
      'notify_indicator_reward_released',
      p_referral_id, null, null, null,
      'reward_released',
      jsonb_build_object('skip', 'no_indicator')
    );
    return;
  end if;

  insert into public.notifications (
    profile_id,
    notification_type,
    title,
    message,
    data,
    action_url
  )
  select
    v_indicator_id,
    'recompensa'::public.notification_type,
    'Recompensa liberada',
    'Sua recompensa já está disponível.',
    jsonb_build_object(
      'action', 'reward_released',
      'referral_id', p_referral_id::text,
      'reward_id', coalesce(v_reward_id::text, '')
    ),
    '/indicador/carteira'
  where not exists (
    select 1
    from public.notifications n
    where n.profile_id = v_indicator_id
      and n.notification_type = 'recompensa'
      and n.data->>'action' = 'reward_released'
      and n.data->>'referral_id' = p_referral_id::text
  );

  get diagnostics v_inserted = row_count;

  perform public.log_notification_debug(
    'notify_indicator_reward_released',
    p_referral_id,
    v_indicator_id,
    null,
    null,
    'reward_released',
    jsonb_build_object('inserted_rows', v_inserted, 'reward_id', v_reward_id)
  );
exception
  when others then
    perform public.log_notification_debug(
      'notify_indicator_reward_released',
      p_referral_id,
      v_indicator_id,
      null,
      null,
      'reward_released',
      jsonb_build_object('error', sqlerrm)
    );
end;
$$;

revoke all on function public.notify_indicator_referral_progress(uuid) from public;
revoke all on function public.notify_indicator_reward_released(uuid) from public;
grant execute on function public.notify_indicator_referral_progress(uuid) to authenticated;
grant execute on function public.notify_indicator_reward_released(uuid) to authenticated;

-- ============================================================
-- Triggers
-- ============================================================
create or replace function public.trg_referrals_notify_indicator_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform public.log_notification_debug(
      'trg_referrals_notify_indicator_progress',
      new.id,
      new.indicator_profile_id,
      old.status::text,
      new.status::text,
      'referral_progress',
      jsonb_build_object('tg_op', tg_op)
    );
    perform public.notify_indicator_referral_progress(new.id);
  end if;
  return new;
end;
$$;

create or replace function public.trg_rewards_notify_indicator_released()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.status is distinct from new.status
    and new.status = 'disponivel'::public.reward_status
  then
    perform public.log_notification_debug(
      'trg_rewards_notify_indicator_released',
      new.referral_id,
      null,
      old.status::text,
      new.status::text,
      'reward_released',
      jsonb_build_object('reward_id', new.id)
    );
    perform public.notify_indicator_reward_released(new.referral_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_referrals_notify_indicator_progress on public.referrals;
create trigger trg_referrals_notify_indicator_progress
after update of status on public.referrals
for each row
execute function public.trg_referrals_notify_indicator_progress();

drop trigger if exists trg_rewards_notify_indicator_released on public.rewards;
create trigger trg_rewards_notify_indicator_released
after update of status on public.rewards
for each row
execute function public.trg_rewards_notify_indicator_released();

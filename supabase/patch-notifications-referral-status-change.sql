-- Notificações unificadas quando referrals.status muda (indicador + admin).
-- Depende de: patch-notifications-indicator-events.sql (debug_notification_logs + log_notification_debug)
-- Depende de: patch-referral-lost-reason-and-notes.sql (lost_reason, lost_notes) — opcional com fallback
-- Substitui o trigger trg_referrals_notify_indicator_progress.
--
-- Dedupe: apenas repetição em 30s (referral_id + action + new_status + profile_id).
-- Mudanças legítimas em leads antigos NÃO são bloqueadas por histórico antigo.

begin;

-- ============================================================
-- Helpers de dedupe (janela curta)
-- ============================================================
create or replace function public.notification_status_last_created_at(
  p_profile_id uuid,
  p_action text,
  p_referral_id uuid,
  p_new_status text
)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(n.created_at)
  from public.notifications n
  where n.profile_id = p_profile_id
    and n.data->>'action' = p_action
    and n.data->>'referral_id' = p_referral_id::text
    and n.data->>'new_status' = p_new_status;
$$;

create or replace function public.notification_status_recent_duplicate(
  p_profile_id uuid,
  p_action text,
  p_referral_id uuid,
  p_new_status text,
  p_window interval default interval '30 seconds'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.notifications n
    where n.profile_id = p_profile_id
      and n.data->>'action' = p_action
      and n.data->>'referral_id' = p_referral_id::text
      and n.data->>'new_status' = p_new_status
      and n.created_at > timezone('utc', now()) - p_window
  );
$$;

revoke all on function public.notification_status_last_created_at(uuid, text, uuid, text) from public;
revoke all on function public.notification_status_recent_duplicate(uuid, text, uuid, text, interval) from public;
grant execute on function public.notification_status_last_created_at(uuid, text, uuid, text) to authenticated;
grant execute on function public.notification_status_recent_duplicate(uuid, text, uuid, text, interval) to authenticated;

-- ============================================================
-- RPC: notify_referral_status_changed
-- ============================================================
create or replace function public.notify_referral_status_changed(
  p_referral_id uuid,
  p_old_status text,
  p_new_status text,
  p_lost_reason text default null,
  p_lost_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_indicator_id uuid;
  v_commercial_id uuid;
  v_lost_reason text;
  v_lost_notes text;
  v_reason_label text;
  v_indicator_action text;
  v_indicator_title text;
  v_indicator_message text;
  v_indicator_inserted int := 0;
  v_indicator_skipped_recent boolean := false;
  v_indicator_last_dup timestamptz;
  v_admin_inserted int := 0;
  v_admin_skipped_recent int := 0;
  v_admin_last_dup timestamptz;
  v_action_url_indicador text;
  v_action_url_admin text;
  v_dedupe_window interval := interval '30 seconds';
  v_admin_row record;
begin
  if p_referral_id is null then
    perform public.log_notification_debug(
      'notify_referral_status_changed',
      null, null, p_old_status, p_new_status,
      'skip',
      jsonb_build_object('reason', 'null_referral_id')
    );
    return jsonb_build_object('skipped', true, 'reason', 'null_referral_id');
  end if;

  if coalesce(trim(p_old_status), '') = coalesce(trim(p_new_status), '') then
    perform public.log_notification_debug(
      'notify_referral_status_changed',
      p_referral_id, null, p_old_status, p_new_status,
      'skip',
      jsonb_build_object('reason', 'same_status')
    );
    return jsonb_build_object('skipped', true, 'reason', 'same_status');
  end if;

  select
    r.indicator_profile_id,
    r.commercial_profile_id,
    coalesce(nullif(trim(p_lost_reason), ''), nullif(trim(r.lost_reason), ''), nullif(trim(r.rejection_reason), '')),
    coalesce(nullif(trim(p_lost_notes), ''), nullif(trim(r.lost_notes), ''))
  into
    v_indicator_id,
    v_commercial_id,
    v_lost_reason,
    v_lost_notes
  from public.referrals r
  where r.id = p_referral_id;

  if not found then
    perform public.log_notification_debug(
      'notify_referral_status_changed',
      p_referral_id, null, p_old_status, p_new_status,
      'skip',
      jsonb_build_object('reason', 'referral_not_found')
    );
    return jsonb_build_object('skipped', true, 'reason', 'referral_not_found');
  end if;

  v_action_url_indicador := '/indicador/indicacoes/' || p_referral_id::text;
  v_action_url_admin := '/admin/indicacoes/' || p_referral_id::text;

  v_reason_label := coalesce(
    case v_lost_reason
      when 'sem_viabilidade_tecnica' then 'Sem viabilidade técnica'
      when 'sem_contato' then 'Sem contato'
      when 'debitos_empresa' then 'Possui débitos com a empresa'
      when 'cliente_desistiu' then 'Cliente desistiu'
      when 'outro_provedor' then 'Já possui outro provedor'
      when 'fora_cobertura' then 'Endereço fora da área de cobertura'
      when 'dados_invalidos' then 'Dados inválidos'
      when 'nao_reconhece_indicacao' then 'Não reconhece indicação'
      when 'duplicado' then 'Duplicado'
      when 'outros' then 'Outros'
      else null
    end,
    nullif(trim(v_lost_reason), ''),
    'Não informado'
  );

  -- Indicador: recusada → referral_rejected; aprovada/paga → referral_progress
  if v_indicator_id is not null then
    if p_new_status = 'recusada' then
      v_indicator_action := 'referral_rejected';
      v_indicator_title := 'Indicação recusada';
      v_indicator_message := 'Sua indicação foi recusada. Motivo: ' || v_reason_label;
      if v_lost_notes is not null and length(trim(v_lost_notes)) > 0 then
        v_indicator_message := v_indicator_message || ' — ' || trim(v_lost_notes);
      end if;
    elsif p_new_status in ('aprovada', 'paga') then
      v_indicator_action := 'referral_progress';
      v_indicator_title := 'Sua indicação avançou';
      v_indicator_message := 'O lead indicado por você avançou no funil comercial.';
    end if;

    if v_indicator_action is not null then
      v_indicator_last_dup := public.notification_status_last_created_at(
        v_indicator_id,
        v_indicator_action,
        p_referral_id,
        p_new_status
      );

      v_indicator_skipped_recent := public.notification_status_recent_duplicate(
        v_indicator_id,
        v_indicator_action,
        p_referral_id,
        p_new_status,
        v_dedupe_window
      );

      if v_indicator_skipped_recent then
        perform public.log_notification_debug(
          'notify_referral_status_changed',
          p_referral_id,
          v_indicator_id,
          p_old_status,
          p_new_status,
          v_indicator_action,
          jsonb_build_object(
            'audience', 'indicador',
            'inserted', 0,
            'skipped_recent_duplicate', true,
            'old_status', p_old_status,
            'new_status', p_new_status,
            'last_duplicate_created_at', v_indicator_last_dup,
            'dedupe_window_seconds', 30
          )
        );
      else
        insert into public.notifications (
          profile_id,
          notification_type,
          title,
          message,
          data,
          action_url
        )
        values (
          v_indicator_id,
          'indicacao'::public.notification_type,
          v_indicator_title,
          v_indicator_message,
          jsonb_build_object(
            'action', v_indicator_action,
            'referral_id', p_referral_id::text,
            'old_status', p_old_status,
            'new_status', p_new_status,
            'lost_reason', v_lost_reason,
            'lost_reason_label', v_reason_label,
            'lost_notes', v_lost_notes
          ),
          v_action_url_indicador
        );

        get diagnostics v_indicator_inserted = row_count;

        perform public.log_notification_debug(
          'notify_referral_status_changed',
          p_referral_id,
          v_indicator_id,
          p_old_status,
          p_new_status,
          v_indicator_action,
          jsonb_build_object(
            'audience', 'indicador',
            'inserted', v_indicator_inserted,
            'skipped_recent_duplicate', false,
            'old_status', p_old_status,
            'new_status', p_new_status,
            'last_duplicate_created_at', null,
            'dedupe_window_seconds', 30
          )
        );
      end if;
    end if;
  end if;

  -- Admin master/financeiro: qualquer mudança relevante de status
  if p_new_status is not null and trim(p_new_status) <> '' then
    for v_admin_row in
      select p.id as profile_id
      from public.profiles p
      where p.role in ('admin_master', 'admin_financeiro')
        and p.is_active = true
    loop
      v_admin_last_dup := public.notification_status_last_created_at(
        v_admin_row.profile_id,
        'commercial_status_changed',
        p_referral_id,
        p_new_status
      );

      if public.notification_status_recent_duplicate(
        v_admin_row.profile_id,
        'commercial_status_changed',
        p_referral_id,
        p_new_status,
        v_dedupe_window
      ) then
        v_admin_skipped_recent := v_admin_skipped_recent + 1;

        perform public.log_notification_debug(
          'notify_referral_status_changed',
          p_referral_id,
          v_indicator_id,
          p_old_status,
          p_new_status,
          'commercial_status_changed',
          jsonb_build_object(
            'audience', 'admin',
            'admin_profile_id', v_admin_row.profile_id,
            'inserted', 0,
            'skipped_recent_duplicate', true,
            'old_status', p_old_status,
            'new_status', p_new_status,
            'last_duplicate_created_at', v_admin_last_dup,
            'dedupe_window_seconds', 30
          )
        );
      else
        insert into public.notifications (
          profile_id,
          notification_type,
          title,
          message,
          data,
          action_url
        )
        values (
          v_admin_row.profile_id,
          'indicacao'::public.notification_type,
          'Status de lead atualizado',
          'O comercial alterou o status do lead de ' ||
            coalesce(p_old_status, '?') || ' para ' || coalesce(p_new_status, '?') || '.',
          jsonb_build_object(
            'action', 'commercial_status_changed',
            'referral_id', p_referral_id::text,
            'old_status', p_old_status,
            'new_status', p_new_status,
            'commercial_profile_id', coalesce(v_commercial_id::text, ''),
            'lost_reason', v_lost_reason,
            'lost_notes', v_lost_notes
          ),
          v_action_url_admin
        );

        v_admin_inserted := v_admin_inserted + 1;

        perform public.log_notification_debug(
          'notify_referral_status_changed',
          p_referral_id,
          v_indicator_id,
          p_old_status,
          p_new_status,
          'commercial_status_changed',
          jsonb_build_object(
            'audience', 'admin',
            'admin_profile_id', v_admin_row.profile_id,
            'inserted', 1,
            'skipped_recent_duplicate', false,
            'old_status', p_old_status,
            'new_status', p_new_status,
            'last_duplicate_created_at', null,
            'dedupe_window_seconds', 30
          )
        );
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'referral_id', p_referral_id,
    'old_status', p_old_status,
    'new_status', p_new_status,
    'indicator_inserted', v_indicator_inserted,
    'indicator_skipped_recent_duplicate', v_indicator_skipped_recent,
    'indicator_last_duplicate_created_at', v_indicator_last_dup,
    'admin_inserted', v_admin_inserted,
    'admin_skipped_recent_duplicate', v_admin_skipped_recent,
    'dedupe_window_seconds', 30
  );
exception
  when others then
    perform public.log_notification_debug(
      'notify_referral_status_changed',
      p_referral_id,
      v_indicator_id,
      p_old_status,
      p_new_status,
      'error',
      jsonb_build_object(
        'error', sqlerrm,
        'old_status', p_old_status,
        'new_status', p_new_status
      )
    );
    return jsonb_build_object('error', sqlerrm);
end;
$$;

revoke all on function public.notify_referral_status_changed(uuid, text, text, text, text) from public;
grant execute on function public.notify_referral_status_changed(uuid, text, text, text, text) to authenticated;

-- ============================================================
-- Trigger: substitui trg_referrals_notify_indicator_progress
-- ============================================================
create or replace function public.trg_referrals_notify_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    perform public.log_notification_debug(
      'trg_referrals_notify_status_changed',
      new.id,
      new.indicator_profile_id,
      old.status::text,
      new.status::text,
      'status_change',
      jsonb_build_object(
        'commercial_profile_id', new.commercial_profile_id,
        'lost_reason', new.lost_reason,
        'lost_notes', new.lost_notes
      )
    );
    v_result := public.notify_referral_status_changed(
      new.id,
      old.status::text,
      new.status::text,
      new.lost_reason,
      new.lost_notes
    );
    perform public.log_notification_debug(
      'trg_referrals_notify_status_changed',
      new.id,
      new.indicator_profile_id,
      old.status::text,
      new.status::text,
      'status_change_result',
      v_result
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_referrals_notify_indicator_progress on public.referrals;
drop trigger if exists trg_referrals_notify_status_changed on public.referrals;
create trigger trg_referrals_notify_status_changed
after update of status on public.referrals
for each row
execute function public.trg_referrals_notify_status_changed();

commit;

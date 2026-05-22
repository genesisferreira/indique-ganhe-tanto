-- Pipeline comercial CRM (etapas, histórico, métricas).
-- Aplicar após patches de referrals / SLA / distribuição.

begin;

-- ============================================================
-- Enum pipeline_stage
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pipeline_stage') then
    create type public.pipeline_stage as enum (
      'novo',
      'tentativa_contato',
      'contato_realizado',
      'negociacao',
      'agendado',
      'instalacao',
      'ativado',
      'perdido'
    );
  end if;
end$$;

-- ============================================================
-- Colunas em referrals
-- ============================================================
alter table public.referrals
  add column if not exists pipeline_stage public.pipeline_stage not null default 'novo',
  add column if not exists moved_to_stage_at timestamptz not null default timezone('utc', now()),
  add column if not exists won_at timestamptz,
  add column if not exists lost_at timestamptz,
  add column if not exists lost_reason text,
  add column if not exists pipeline_order integer not null default 0;

create index if not exists referrals_pipeline_stage_idx
  on public.referrals (pipeline_stage, commercial_profile_id);

create index if not exists referrals_pipeline_order_idx
  on public.referrals (pipeline_stage, pipeline_order);

-- Backfill etapas a partir do status legado
update public.referrals r
set
  pipeline_stage = case
    when r.status = 'recusada'::public.referral_status then 'perdido'::public.pipeline_stage
    when r.status in ('aprovada'::public.referral_status, 'paga'::public.referral_status) then 'ativado'::public.pipeline_stage
    when r.status = 'em_negociacao'::public.referral_status then 'negociacao'::public.pipeline_stage
    when r.status in ('em_atendimento'::public.referral_status, 'em_andamento'::public.referral_status) then 'tentativa_contato'::public.pipeline_stage
    else 'novo'::public.pipeline_stage
  end,
  moved_to_stage_at = coalesce(r.moved_to_stage_at, r.assigned_at, r.created_at),
  won_at = case
    when r.status in ('aprovada'::public.referral_status, 'paga'::public.referral_status)
    then coalesce(r.won_at, r.approved_at, r.updated_at)
    else r.won_at
  end,
  lost_at = case
    when r.status = 'recusada'::public.referral_status
    then coalesce(r.lost_at, r.rejected_at, r.updated_at)
    else r.lost_at
  end,
  lost_reason = coalesce(r.lost_reason, r.rejection_reason)
where r.pipeline_stage = 'novo'::public.pipeline_stage
  and (
    r.status <> 'pendente'::public.referral_status
    or r.commercial_profile_id is not null
  );

-- ============================================================
-- Novos leads → etapa novo
-- ============================================================
create or replace function public.trg_referrals_pipeline_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.pipeline_stage := coalesce(new.pipeline_stage, 'novo'::public.pipeline_stage);
  new.moved_to_stage_at := coalesce(new.moved_to_stage_at, timezone('utc', now()));
  new.pipeline_order := coalesce(new.pipeline_order, 0);
  return new;
end;
$$;

drop trigger if exists trg_referrals_pipeline_on_insert on public.referrals;
create trigger trg_referrals_pipeline_on_insert
before insert on public.referrals
for each row
execute function public.trg_referrals_pipeline_on_insert();

-- ============================================================
-- RPC: mover etapa do pipeline
-- ============================================================
create or replace function public.move_referral_pipeline_stage(
  p_referral_id uuid,
  p_new_stage public.pipeline_stage,
  p_pipeline_order integer default null,
  p_lost_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_now timestamptz := timezone('utc', now());
  v_old_stage public.pipeline_stage;
  v_order integer;
begin
  if p_referral_id is null or p_new_stage is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;

  select * into v_ref
  from public.referrals
  where id = p_referral_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if v_role = 'comercial'::public.user_role
     and v_ref.commercial_profile_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_role not in (
    'comercial'::public.user_role,
    'admin_master'::public.user_role,
    'admin_financeiro'::public.user_role,
    'admin_consulta'::public.user_role
  ) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_ref.first_response_at is not null
     and p_new_stage = 'novo'::public.pipeline_stage then
    return jsonb_build_object('ok', false, 'code', 'invalid_stage_transition');
  end if;

  v_old_stage := v_ref.pipeline_stage;

  if p_pipeline_order is null then
    select coalesce(max(r.pipeline_order), -1) + 1
    into v_order
    from public.referrals r
    where r.pipeline_stage = p_new_stage
      and (
        v_role <> 'comercial'::public.user_role
        or r.commercial_profile_id = v_uid
        or (v_role = 'comercial'::public.user_role and r.commercial_profile_id is null)
      );
  else
    v_order := p_pipeline_order;
  end if;

  update public.referrals
  set
    pipeline_stage = p_new_stage,
    moved_to_stage_at = v_now,
    pipeline_order = v_order,
    won_at = case
      when p_new_stage = 'ativado'::public.pipeline_stage then coalesce(won_at, v_now)
      when p_new_stage = 'perdido'::public.pipeline_stage then won_at
      else null
    end,
    lost_at = case
      when p_new_stage = 'perdido'::public.pipeline_stage then coalesce(lost_at, v_now)
      when p_new_stage = 'ativado'::public.pipeline_stage then lost_at
      else null
    end,
    lost_reason = case
      when p_new_stage = 'perdido'::public.pipeline_stage then coalesce(p_lost_reason, lost_reason)
      else null
    end,
    updated_at = v_now
  where id = p_referral_id;

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
    v_uid,
    v_ref.status,
    v_ref.status,
    'Etapa do pipeline alterada',
    jsonb_build_object(
      'action', 'pipeline_stage_changed',
      'old_pipeline_stage', v_old_stage::text,
      'new_pipeline_stage', p_new_stage::text,
      'pipeline_order', v_order,
      'lost_reason', p_lost_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'referral_id', p_referral_id,
    'pipeline_stage', p_new_stage::text,
    'pipeline_order', v_order,
    'won_at', (select won_at from public.referrals where id = p_referral_id),
    'lost_at', (select lost_at from public.referrals where id = p_referral_id)
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'exception', 'message', sqlerrm);
end;
$$;

revoke all on function public.move_referral_pipeline_stage(uuid, public.pipeline_stage, integer, text) from public;
grant execute on function public.move_referral_pipeline_stage(uuid, public.pipeline_stage, integer, text) to authenticated;

commit;

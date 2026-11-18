-- 3.1F-J19 — separação de canal sem reescrever a origem financeira.
-- origin_kind existente permanece imutável e continua regendo reward.
-- origin_group + acquisition_kind classificam o canal comercial.
-- O backfill só preenche as colunas novas e não altera datas, status ou financeiro.

alter table public.referrals
  add column if not exists origin_group text,
  add column if not exists acquisition_kind text;

create table if not exists public.origin_correction_events (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null,
  actor_id uuid not null,
  previous_group text not null,
  previous_kind text not null,
  next_group text not null,
  next_kind text not null,
  reason_sha256 text not null,
  reason_length integer not null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.origin_correction_events enable row level security;
revoke all on table public.origin_correction_events from public, anon, authenticated;

create or replace function public.referral_channel_classification(
  p_origin_kind text,
  p_source text,
  p_erp text,
  p_indicator uuid,
  p_partner_key text,
  p_employee_key text,
  p_campaign text,
  p_employee_role text
) returns table(origin_group text, acquisition_kind text)
language plpgsql
immutable
as $$
declare
  v_partner boolean := coalesce(p_origin_kind = 'partner_merchant', false) or nullif(btrim(coalesce(p_partner_key, '')), '') is not null;
  v_employee boolean := coalesce(p_origin_kind = 'employee', false) or nullif(btrim(coalesce(p_employee_key, '')), '') is not null;
  v_indicator boolean := p_indicator is not null and (
    coalesce(p_origin_kind in ('indicator', 'assisted_indicator'), false)
    or coalesce(p_erp, '') = 'Indique e Ganhe'
    or coalesce(p_source in ('referral_share_link', 'commercial_assisted_referral'), false)
  );
  v_direct boolean := p_indicator is null
    and nullif(btrim(coalesce(p_partner_key, '')), '') is null
    and nullif(btrim(coalesce(p_employee_key, '')), '') is null
    and p_origin_kind is distinct from 'partner_merchant'
    and p_origin_kind is distinct from 'employee'
    and (
      (coalesce(p_source = 'public_pre_registration', false) and coalesce(p_erp, '') = 'Pr' || chr(233) || '-cadastro Web')
      or coalesce(p_origin_kind = 'web_preregistration', false)
      or coalesce(p_source = 'neutral_network_pre_registration', false)
      or coalesce(p_erp, '') = 'Pr' || chr(233) || '-cadastro Rede Neutra'
      or coalesce(p_origin_kind = 'neutral_network', false)
    );
  v_signals integer := (coalesce(v_partner, false)::int + coalesce(v_employee, false)::int + coalesce(v_indicator, false)::int + coalesce(v_direct, false)::int);
begin
  if v_signals <> 1 then
    origin_group := 'unclassified';
    acquisition_kind := 'unclassified_legacy';
    return next;
    return;
  end if;
  if v_partner then
    origin_group := 'referral';
    acquisition_kind := 'partner_merchant';
  elsif v_employee then
    if p_employee_role = 'technician_originator' then
      origin_group := 'referral';
      acquisition_kind := 'employee_technician';
    elsif p_employee_role = 'external_sales_originator' then
      origin_group := 'referral';
      acquisition_kind := 'employee_external_sales';
    else
      origin_group := 'unclassified';
      acquisition_kind := 'unclassified_legacy';
    end if;
  elsif v_indicator then
    origin_group := 'referral';
    acquisition_kind := 'indicator';
  elsif nullif(btrim(coalesce(p_campaign, '')), '') is not null then
    origin_group := 'direct';
    acquisition_kind := 'direct_campaign';
  elsif p_source = 'public_pre_registration' or p_origin_kind = 'web_preregistration' or coalesce(p_erp, '') = 'Pr' || chr(233) || '-cadastro Web' then
    origin_group := 'direct';
    acquisition_kind := 'direct_preregistration';
  else
    origin_group := 'direct';
    acquisition_kind := 'direct_other';
  end if;
  return next;
end;
$$;

revoke all on function public.referral_channel_classification(text, text, text, uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.trg_referrals_channel_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group text;
  v_kind text;
  v_role text := nullif(current_setting('igt.acquisition_kind', true), '');
begin
  if TG_OP = 'INSERT' then
    if NEW.origin_kind = 'employee' and coalesce(current_setting('igt.employee_opportunity_rpc', true), '') = 'on'
       and v_role in ('employee_technician', 'employee_external_sales') then
      NEW.origin_group := 'referral';
      NEW.acquisition_kind := v_role;
    else
      select c.origin_group, c.acquisition_kind into v_group, v_kind
      from public.referral_channel_classification(
        NEW.origin_kind, NEW.source, NEW.erp_lead_source, NEW.indicator_profile_id,
        NEW.partner_referral_idempotency_key, NEW.employee_opportunity_idempotency_key,
        NEW.utm_campaign, null
      ) c;
      NEW.origin_group := v_group;
      NEW.acquisition_kind := v_kind;
    end if;
    if NEW.origin_group = 'direct' then
      NEW.reward_eligible := false;
    end if;
    return NEW;
  end if;

  if NEW.origin_group is distinct from OLD.origin_group or NEW.acquisition_kind is distinct from OLD.acquisition_kind then
    if coalesce(current_setting('igt.origin_correction', true), '') is distinct from 'on' then
      raise exception 'origin_channel_immutable' using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;

revoke all on function public.trg_referrals_channel_guard() from public, anon, authenticated;

drop trigger if exists trg_referrals_channel_guard on public.referrals;
create trigger trg_referrals_channel_guard
before insert or update on public.referrals
for each row
execute function public.trg_referrals_channel_guard();

alter table public.referrals disable trigger trg_referrals_set_updated_at;
alter table public.referrals disable trigger trg_referrals_channel_guard;

do $$
declare
  v_before text;
  v_after text;
  v_rewards integer;
  v_wallet integer;
  v_employee integer;
  v_partner integer;
  v_payments integer;
  v_total integer;
  v_classified integer;
begin
  select count(*) into v_rewards from public.rewards;
  select count(*) into v_wallet from public.wallet_transactions;
  select count(*) into v_employee from public.employee_commission_entitlements;
  select count(*) into v_partner from public.partner_commission_entitlements;
  select count(*) into v_payments from public.payments;
  select md5(coalesce(string_agg(
    r.id::text || '|' || r.origin_kind || '|' || r.reward_eligible::text || '|' || r.status
      || '|' || coalesce(r.indicator_profile_id::text, '') || '|' || r.updated_at::text,
    ',' order by r.id
  ), '')) into v_before
  from public.referrals r;

  update public.referrals r
  set origin_group = sub.origin_group,
      acquisition_kind = sub.acquisition_kind
  from (
    select x.id, c.origin_group, c.acquisition_kind
    from public.referrals x
    cross join lateral public.referral_channel_classification(
      x.origin_kind, x.source, x.erp_lead_source, x.indicator_profile_id,
      x.partner_referral_idempotency_key, x.employee_opportunity_idempotency_key,
      x.utm_campaign, null
    ) c
  ) sub
  where r.id = sub.id
    and (r.origin_group is null or r.acquisition_kind is null);

  select md5(coalesce(string_agg(
    r.id::text || '|' || r.origin_kind || '|' || r.reward_eligible::text || '|' || r.status
      || '|' || coalesce(r.indicator_profile_id::text, '') || '|' || r.updated_at::text,
    ',' order by r.id
  ), '')) into v_after
  from public.referrals r;
  if v_before is distinct from v_after then
    raise exception 'channel_backfill_touched_protected_fields';
  end if;
  if (select count(*) from public.rewards) is distinct from v_rewards
     or (select count(*) from public.wallet_transactions) is distinct from v_wallet
     or (select count(*) from public.employee_commission_entitlements) is distinct from v_employee
     or (select count(*) from public.partner_commission_entitlements) is distinct from v_partner
     or (select count(*) from public.payments) is distinct from v_payments then
    raise exception 'financial_baseline_moved';
  end if;
  select count(*) into v_total from public.referrals;
  select count(*) into v_classified from public.referrals
  where origin_group is not null and acquisition_kind is not null;
  if v_classified is distinct from v_total then
    raise exception 'channel_classification_incomplete';
  end if;
end $$;

alter table public.referrals enable trigger trg_referrals_channel_guard;
alter table public.referrals enable trigger trg_referrals_set_updated_at;

alter table public.referrals drop constraint if exists referrals_origin_group_chk;
alter table public.referrals
  add constraint referrals_origin_group_chk
  check (origin_group in ('direct', 'referral', 'unclassified')) not valid;

alter table public.referrals drop constraint if exists referrals_acquisition_kind_chk;
alter table public.referrals
  add constraint referrals_acquisition_kind_chk
  check (
    (origin_group = 'direct' and acquisition_kind in ('direct_preregistration', 'direct_website', 'direct_campaign', 'direct_admin', 'direct_other'))
    or (origin_group = 'referral' and acquisition_kind in ('indicator', 'partner_merchant', 'employee_technician', 'employee_external_sales'))
    or (origin_group = 'unclassified' and acquisition_kind = 'unclassified_legacy')
  ) not valid;

alter table public.referrals drop constraint if exists referrals_direct_no_reward_chk;
alter table public.referrals
  add constraint referrals_direct_no_reward_chk
  check (origin_group is distinct from 'direct' or reward_eligible = false) not valid;

alter table public.referrals validate constraint referrals_origin_group_chk;
alter table public.referrals validate constraint referrals_acquisition_kind_chk;
alter table public.referrals validate constraint referrals_direct_no_reward_chk;

alter table public.referrals alter column origin_group set not null;
alter table public.referrals alter column acquisition_kind set not null;

create index if not exists referrals_origin_group_created_idx on public.referrals (origin_group, created_at desc);
create index if not exists referrals_acquisition_kind_created_idx on public.referrals (acquisition_kind, created_at desc);
create index if not exists referrals_status_origin_group_idx on public.referrals (status, origin_group);
create index if not exists referrals_commercial_origin_group_idx on public.referrals (commercial_profile_id, origin_group);
create index if not exists referrals_indicator_origin_group_idx on public.referrals (indicator_profile_id, origin_group) where indicator_profile_id is not null;

create or replace function public.trg_sales_attribution_sets_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.attribution_role not in ('technician_originator', 'external_sales_originator') then
    return NEW;
  end if;
  perform set_config('igt.origin_correction', 'on', true);
  update public.referrals r
  set origin_group = 'referral',
      acquisition_kind = case NEW.attribution_role
        when 'technician_originator' then 'employee_technician'
        else 'employee_external_sales'
      end
  where r.id = NEW.opportunity_id
    and r.origin_kind = 'employee';
  perform set_config('igt.origin_correction', '', true);
  return NEW;
end;
$$;

revoke all on function public.trg_sales_attribution_sets_channel() from public, anon, authenticated;
drop trigger if exists trg_sales_attribution_sets_channel on public.sales_opportunity_attributions;
create trigger trg_sales_attribution_sets_channel
after insert on public.sales_opportunity_attributions
for each row
execute function public.trg_sales_attribution_sets_channel();

create or replace function public.admin_correct_referral_origin(
  p_id uuid,
  p_group text,
  p_kind text,
  p_reason text,
  p_confirmation text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_row public.referrals%rowtype;
  v_financial boolean;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = auth.uid();
  if v_role is distinct from 'admin_master' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if char_length(v_reason) < 20 then
    raise exception 'reason_too_short' using errcode = '22023';
  end if;
  if p_group not in ('direct', 'referral', 'unclassified') then
    raise exception 'invalid_group' using errcode = '22023';
  end if;
  if not (
    (p_group = 'direct' and p_kind in ('direct_preregistration', 'direct_website', 'direct_campaign', 'direct_admin', 'direct_other'))
    or (p_group = 'referral' and p_kind in ('indicator', 'partner_merchant', 'employee_technician', 'employee_external_sales'))
    or (p_group = 'unclassified' and p_kind = 'unclassified_legacy')
  ) then
    raise exception 'invalid_channel' using errcode = '22023';
  end if;
  select * into v_row from public.referrals where id = p_id;
  if v_row.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_group = 'referral' and p_kind = 'indicator' and v_row.indicator_profile_id is null then
    raise exception 'originator_required' using errcode = '22023';
  end if;
  if p_group = 'referral' and p_kind = 'partner_merchant' and v_row.partner_referral_idempotency_key is null and v_row.origin_kind is distinct from 'partner_merchant' then
    raise exception 'originator_required' using errcode = '22023';
  end if;
  if p_group = 'referral' and p_kind in ('employee_technician', 'employee_external_sales') and v_row.origin_kind is distinct from 'employee' then
    raise exception 'originator_required' using errcode = '22023';
  end if;
  select exists (
    select 1 from public.rewards w where w.referral_id = p_id
    union all
    select 1 from public.employee_commission_entitlements e where e.opportunity_id = p_id
    union all
    select 1 from public.partner_commission_entitlements n where n.opportunity_id = p_id
  ) into v_financial;
  if v_financial and p_confirmation is distinct from 'CORRIGIR ORIGEM FINANCEIRA' then
    raise exception 'financial_confirmation_required' using errcode = '22023';
  end if;
  if not v_financial and p_confirmation is distinct from 'CORRIGIR ORIGEM' then
    raise exception 'confirmation_required' using errcode = '22023';
  end if;
  perform set_config('igt.origin_correction', 'on', true);
  update public.referrals
  set origin_group = p_group,
      acquisition_kind = p_kind,
      reward_eligible = case when p_group = 'direct' then false else reward_eligible end
  where id = p_id;
  perform set_config('igt.origin_correction', '', true);
  insert into public.origin_correction_events (
    referral_id, actor_id, previous_group, previous_kind, next_group, next_kind, reason_sha256, reason_length
  ) values (
    p_id, auth.uid(), v_row.origin_group, v_row.acquisition_kind, p_group, p_kind,
    encode(extensions.digest(convert_to(v_reason, 'UTF8'), 'sha256'), 'hex'),
    char_length(v_reason)
  );
  return jsonb_build_object('ok', true, 'financial', v_financial);
exception
  when undefined_column or undefined_table then
    perform set_config('igt.origin_correction', '', true);
    raise;
end;
$$;

revoke all on function public.admin_correct_referral_origin(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_correct_referral_origin(uuid, text, text, text, text) to authenticated;

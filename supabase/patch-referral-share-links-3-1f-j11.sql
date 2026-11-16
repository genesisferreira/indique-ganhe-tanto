-- 3.1F-J11: motor único de link e QR.
-- Não gera token, não cria reward, não grava carteira e não chama ERP.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists public.referral_share_links (
  id uuid primary key default gen_random_uuid(),
  origin_kind text not null,
  originator_id uuid not null,
  attribution_role text not null,
  token_hash text not null,
  status text not null,
  public_display_name text not null,
  campaign text,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  rotated_from uuid,
  last_used_at timestamptz,
  use_count integer not null default 0,
  expires_at timestamptz,
  is_primary boolean not null default true,
  idempotency_key text,
  partner_link_id uuid,
  sector_id uuid,
  membership_id uuid,
  constraint referral_share_links_origin_chk check (origin_kind in ('indicator', 'employee', 'partner_merchant')),
  constraint referral_share_links_role_chk check (attribution_role in (
    'indicator', 'technician_originator', 'external_sales_originator', 'partner_merchant_originator'
  )),
  constraint referral_share_links_pair_chk check (
    (origin_kind = 'indicator' and attribution_role = 'indicator')
    or (origin_kind = 'employee' and attribution_role in ('technician_originator', 'external_sales_originator'))
    or (origin_kind = 'partner_merchant' and attribution_role = 'partner_merchant_originator')
  ),
  constraint referral_share_links_status_chk check (status in ('active', 'revoked', 'expired')),
  constraint referral_share_links_hash_chk check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint referral_share_links_hash_uidx unique (token_hash),
  constraint referral_share_links_use_chk check (use_count >= 0),
  constraint referral_share_links_name_chk check (length(btrim(public_display_name)) between 2 and 120)
);

create unique index if not exists referral_share_links_one_primary_uidx
  on public.referral_share_links (origin_kind, originator_id, attribution_role)
  where status = 'active' and is_primary;

create unique index if not exists referral_share_links_idem_uidx
  on public.referral_share_links (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists referral_share_links_partner_link_uidx
  on public.referral_share_links (partner_link_id)
  where partner_link_id is not null;

create table if not exists public.referral_share_submissions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.referral_share_links(id) on delete restrict,
  opportunity_id uuid not null references public.referrals(id) on delete restrict,
  idempotency_key text not null,
  request_hash text not null,
  public_protocol text not null,
  consent_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint referral_share_submissions_idem_uidx unique (idempotency_key),
  constraint referral_share_submissions_protocol_uidx unique (public_protocol),
  constraint referral_share_submissions_opp_uidx unique (opportunity_id)
);

create table if not exists public.referral_share_competing_attempts (
  id uuid primary key default gen_random_uuid(),
  existing_opportunity_id uuid not null references public.referrals(id) on delete restrict,
  attempted_link_id uuid not null references public.referral_share_links(id) on delete restrict,
  phone_hash text not null,
  document_hash text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.referral_share_links enable row level security;
alter table public.referral_share_submissions enable row level security;
alter table public.referral_share_competing_attempts enable row level security;
revoke all on table public.referral_share_links from public, anon, authenticated, service_role;
revoke all on table public.referral_share_submissions from public, anon, authenticated, service_role;
revoke all on table public.referral_share_competing_attempts from public, anon, authenticated, service_role;

create or replace function public.trg_referral_share_links_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'referral_share_link_delete_forbidden' using errcode = 'P0001';
  end if;
  if NEW.attribution_role is distinct from OLD.attribution_role
     or NEW.origin_kind is distinct from OLD.origin_kind
     or NEW.originator_id is distinct from OLD.originator_id
     or NEW.token_hash is distinct from OLD.token_hash
     or NEW.public_display_name is distinct from OLD.public_display_name then
    raise exception 'referral_share_link_immutable' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_referral_share_links_guard on public.referral_share_links;
create trigger trg_referral_share_links_guard
before update or delete on public.referral_share_links
for each row execute function public.trg_referral_share_links_guard();

create or replace function public.trg_mirror_partner_share_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_prev uuid;
begin
  if TG_OP = 'UPDATE' and OLD.status = 'active' and NEW.status = 'revoked' then
    update public.referral_share_links
      set status = 'revoked', is_primary = false, revoked_at = coalesce(NEW.revoked_at, timezone('utc', now())), revoked_by = NEW.revoked_by
    where partner_link_id = NEW.id and status = 'active';
    return NEW;
  end if;
  if TG_OP = 'INSERT' and NEW.status = 'active' and NEW.is_primary then
    select m.public_display_name into v_name from public.partner_merchants m where m.id = NEW.partner_merchant_id;
    select l.id into v_prev
    from public.referral_share_links l
    where l.origin_kind = 'partner_merchant'
      and l.originator_id = NEW.partner_merchant_id
      and l.attribution_role = 'partner_merchant_originator'
      and l.status = 'revoked'
    order by l.revoked_at desc nulls last
    limit 1;
    insert into public.referral_share_links (
      origin_kind, originator_id, attribution_role, token_hash, status, public_display_name,
      campaign, created_by, rotated_from, is_primary, partner_link_id
    ) values (
      'partner_merchant', NEW.partner_merchant_id, 'partner_merchant_originator', NEW.token_hash, 'active',
      coalesce(nullif(btrim(v_name), ''), 'Comércio parceiro'),
      NEW.campaign_code, NEW.created_by, v_prev, true, NEW.id
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_mirror_partner_share_link on public.partner_merchant_links;
create trigger trg_mirror_partner_share_link
after insert or update on public.partner_merchant_links
for each row execute function public.trg_mirror_partner_share_link();

create or replace function public.trg_share_count_partner_use()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.referral_share_links
    set use_count = use_count + 1, last_used_at = timezone('utc', now())
  where partner_link_id = NEW.link_id and status = 'active';
  return NEW;
end;
$$;

drop trigger if exists trg_share_count_partner_use on public.partner_merchant_attributions;
create trigger trg_share_count_partner_use
after insert on public.partner_merchant_attributions
for each row execute function public.trg_share_count_partner_use();

create or replace function public.referral_share_link_usable(p_link public.referral_share_links)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_active boolean;
  v_role text;
  v_employee uuid;
begin
  if p_link.status is distinct from 'active' or p_link.is_primary is not true then
    return false;
  end if;
  if p_link.expires_at is not null and p_link.expires_at <= timezone('utc', now()) then
    return false;
  end if;
  if p_link.origin_kind = 'indicator' then
    select coalesce(p.is_active, false), p.role::text into v_active, v_role
    from public.profiles p where p.id = p_link.originator_id;
    return coalesce(v_active, false) and v_role in ('indicador', 'comercial', 'admin_master');
  end if;
  if p_link.origin_kind = 'employee' then
    select e.id into v_employee
    from public.employees e
    join public.profiles p on p.id = e.profile_id
    where e.id = p_link.originator_id and e.status = 'active' and coalesce(p.is_active, false);
    if v_employee is null then
      return false;
    end if;
    return exists (
      select 1 from public.employee_opportunity_eligible_roles(v_employee) er
      where er.attribution_role = p_link.attribution_role
    );
  end if;
  if p_link.origin_kind = 'partner_merchant' then
    return exists (
      select 1 from public.partner_merchants m
      where m.id = p_link.originator_id and m.status = 'active'
    );
  end if;
  return false;
end;
$$;

create or replace function public.referral_share_my_links()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_profile_active boolean;
  v_employee uuid;
  v_links jsonb;
  v_roles jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  select p.role::text, coalesce(p.is_active, false) into v_role, v_profile_active
  from public.profiles p where p.id = v_uid;
  if v_profile_active is not true or v_role not in ('indicador', 'funcionario') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_role = 'indicador' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'linkId', l.id, 'originKind', l.origin_kind, 'attributionRole', l.attribution_role,
      'status', l.status, 'useCount', l.use_count, 'campaign', l.campaign,
      'publicDisplayName', l.public_display_name
    ) order by l.created_at desc), '[]'::jsonb)
      into v_links
    from public.referral_share_links l
    where l.origin_kind = 'indicator' and l.originator_id = v_uid and l.status = 'active';
    v_roles := '["indicator"]'::jsonb;
  else
    select e.id into v_employee from public.employees e where e.profile_id = v_uid and e.status = 'active';
    if v_employee is null then
      return jsonb_build_object('ok', true, 'links', '[]'::jsonb, 'eligibleRoles', '[]'::jsonb);
    end if;
    select coalesce(jsonb_agg(er.attribution_role order by er.attribution_role), '[]'::jsonb)
      into v_roles
    from public.employee_opportunity_eligible_roles(v_employee) er;
    select coalesce(jsonb_agg(jsonb_build_object(
      'linkId', l.id, 'originKind', l.origin_kind, 'attributionRole', l.attribution_role,
      'status', l.status, 'useCount', l.use_count, 'campaign', l.campaign,
      'publicDisplayName', l.public_display_name
    ) order by l.attribution_role), '[]'::jsonb)
      into v_links
    from public.referral_share_links l
    where l.origin_kind = 'employee' and l.originator_id = v_employee and l.status = 'active';
  end if;
  return jsonb_build_object('ok', true, 'links', coalesce(v_links, '[]'::jsonb), 'eligibleRoles', v_roles);
end;
$$;

create or replace function public.issue_referral_share_link(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array['idempotencyKey','mode','originKind','attributionRole','originatorId','campaign'];
  v_uid uuid := auth.uid();
  v_actor_role text;
  v_actor_active boolean;
  v_cap text := public.partner_admin_capability();
  v_k text;
  v_key text;
  v_mode text;
  v_origin text;
  v_role text;
  v_originator uuid;
  v_campaign text;
  v_self_employee uuid;
  v_name text;
  v_sector uuid;
  v_membership uuid;
  v_existing uuid;
  v_prev uuid;
  v_token text;
  v_hash text;
  v_link uuid;
  v_replay public.referral_share_links%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  select p.role::text, coalesce(p.is_active, false) into v_actor_role, v_actor_active
  from public.profiles p where p.id = v_uid;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  for v_k in select jsonb_object_keys(p_payload) loop
    if not (v_k = any (c_allowed)) then
      return jsonb_build_object('ok', false, 'code', 'unknown_field');
    end if;
  end loop;
  v_key := p_payload ->> 'idempotencyKey';
  v_mode := coalesce(p_payload ->> 'mode', 'issue');
  v_origin := p_payload ->> 'originKind';
  v_role := p_payload ->> 'attributionRole';
  v_campaign := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'campaign', '')), '\s+', ' ', 'g'), '');
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if v_mode not in ('issue', 'rotate') or v_origin not in ('indicator', 'employee') then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  if v_campaign is not null and (length(v_campaign) > 40 or v_campaign !~ '^[A-Za-z0-9_-]+$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'campaign');
  end if;
  if p_payload ? 'originatorId' and nullif(p_payload ->> 'originatorId', '') is not null then
    if (p_payload ->> 'originatorId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'originatorId');
    end if;
    v_originator := (p_payload ->> 'originatorId')::uuid;
  end if;
  if v_origin = 'indicator' then
    v_role := 'indicator';
    if v_originator is null then
      v_originator := v_uid;
    end if;
    if v_originator is distinct from v_uid and v_cap is distinct from 'master' then
      return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
    if v_originator = v_uid and (v_actor_active is not true or v_actor_role is distinct from 'indicador') and v_cap is distinct from 'master' then
      return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
    select coalesce(nullif(btrim(p.full_name), ''), 'Indicador'), coalesce(p.is_active, false) and p.role::text = 'indicador'
      into v_name, v_actor_active
    from public.profiles p where p.id = v_originator;
    if v_actor_active is not true then
      return jsonb_build_object('ok', false, 'code', 'originator_inactive');
    end if;
  else
    if v_role not in ('technician_originator', 'external_sales_originator') then
      return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'attributionRole');
    end if;
    if v_originator is null then
      select e.id into v_originator from public.employees e where e.profile_id = v_uid;
    end if;
    select e.id, coalesce(nullif(btrim(p.full_name), ''), 'Atendimento'), e.status = 'active' and coalesce(p.is_active, false)
      into v_self_employee, v_name, v_actor_active
    from public.employees e
    join public.profiles p on p.id = e.profile_id
    where e.id = v_originator;
    if v_self_employee is null then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if v_originator is distinct from (select e.id from public.employees e where e.profile_id = v_uid) and v_cap is distinct from 'master' then
      return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
    if v_actor_active is not true then
      return jsonb_build_object('ok', false, 'code', 'originator_inactive');
    end if;
    select er.sector_id, er.membership_id into v_sector, v_membership
    from public.employee_opportunity_eligible_roles(v_originator) er
    where er.attribution_role = v_role;
    if v_membership is null then
      return jsonb_build_object('ok', false, 'code', 'role_not_eligible');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('igt.j11.link:' || v_origin || ':' || v_originator::text || ':' || v_role, 0));
  select * into v_replay from public.referral_share_links l where l.idempotency_key = v_key;
  if v_replay.id is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'linkId', v_replay.id, 'tokenRevealed', false);
  end if;
  select l.id into v_existing
  from public.referral_share_links l
  where l.origin_kind = v_origin and l.originator_id = v_originator and l.attribution_role = v_role
    and l.status = 'active' and l.is_primary;
  if v_mode = 'issue' and v_existing is not null then
    return jsonb_build_object('ok', false, 'code', 'active_link_exists');
  end if;
  if v_mode = 'rotate' and v_existing is null then
    return jsonb_build_object('ok', false, 'code', 'no_active_link');
  end if;
  if v_existing is not null then
    update public.referral_share_links
      set status = 'revoked', is_primary = false, revoked_at = timezone('utc', now()), revoked_by = v_uid
    where id = v_existing;
    v_prev := v_existing;
  end if;
  v_token := public.partner_random_token();
  if v_token is null or v_token !~ '^[A-Za-z0-9_-]{43}$' or position(v_originator::text in v_token) > 0 then
    raise exception 'referral_share_token_failed' using errcode = 'P0001';
  end if;
  v_hash := public.partner_sha256_hex(v_token);
  insert into public.referral_share_links (
    origin_kind, originator_id, attribution_role, token_hash, status, public_display_name,
    campaign, created_by, rotated_from, is_primary, idempotency_key, sector_id, membership_id
  ) values (
    v_origin, v_originator, v_role, v_hash, 'active', v_name,
    v_campaign, v_uid, v_prev, true, v_key, v_sector, v_membership
  ) returning id into v_link;
  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'linkId', v_link, 'tokenRevealed', true,
    'token', v_token, 'url', 'https://crm.tantotelecom.com.br/indicacao/' || v_token,
    'attributionRole', v_role
  );
end;
$$;

create or replace function public.revoke_referral_share_link(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array['idempotencyKey','linkId','reason'];
  v_uid uuid := auth.uid();
  v_cap text := public.partner_admin_capability();
  v_k text;
  v_link uuid;
  v_row public.referral_share_links%rowtype;
  v_own boolean := false;
  v_employee uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  for v_k in select jsonb_object_keys(p_payload) loop
    if not (v_k = any (c_allowed)) then
      return jsonb_build_object('ok', false, 'code', 'unknown_field');
    end if;
  end loop;
  if (p_payload ->> 'linkId') !~* '^[0-9a-f-]{36}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  v_link := (p_payload ->> 'linkId')::uuid;
  select * into v_row from public.referral_share_links where id = v_link for update;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_row.origin_kind = 'indicator' and v_row.originator_id = v_uid then
    v_own := true;
  end if;
  select e.id into v_employee from public.employees e where e.profile_id = v_uid;
  if v_row.origin_kind = 'employee' and v_employee is not null and v_row.originator_id = v_employee then
    v_own := true;
  end if;
  if v_own is not true and v_cap is distinct from 'master' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status = 'revoked' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'linkId', v_link);
  end if;
  update public.referral_share_links
    set status = 'revoked', is_primary = false, revoked_at = timezone('utc', now()), revoked_by = v_uid
  where id = v_link;
  if v_row.partner_link_id is not null then
    update public.partner_merchant_links
      set status = 'revoked', is_primary = false, revoked_at = timezone('utc', now()), revoked_by = v_uid, revoke_reason = 'revogacao'
    where id = v_row.partner_link_id and status = 'active';
  end if;
  return jsonb_build_object('ok', true, 'idempotent', false, 'linkId', v_link);
end;
$$;

create or replace function public.admin_list_referral_share_links(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array['originKind','originatorId'];
  v_cap text := public.partner_admin_capability();
  v_role text;
  v_k text;
  v_origin text;
  v_originator uuid;
  v_links jsonb;
  v_roles jsonb := '[]'::jsonb;
begin
  select p.role::text into v_role from public.profiles p where p.id = auth.uid() and coalesce(p.is_active, false);
  if v_cap = 'none' and v_role not in ('admin_master', 'admin_financeiro', 'admin_consulta') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  for v_k in select jsonb_object_keys(p_payload) loop
    if not (v_k = any (c_allowed)) then
      return jsonb_build_object('ok', false, 'code', 'unknown_field');
    end if;
  end loop;
  v_origin := p_payload ->> 'originKind';
  if v_origin not in ('indicator', 'employee', 'partner_merchant')
     or (p_payload ->> 'originatorId') !~* '^[0-9a-f-]{36}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  v_originator := (p_payload ->> 'originatorId')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object(
    'linkId', l.id, 'originKind', l.origin_kind, 'attributionRole', l.attribution_role,
    'status', l.status, 'useCount', l.use_count, 'campaign', l.campaign,
    'publicDisplayName', l.public_display_name, 'createdAt', l.created_at
  ) order by l.created_at desc), '[]'::jsonb)
    into v_links
  from public.referral_share_links l
  where l.origin_kind = v_origin and l.originator_id = v_originator;
  if v_origin = 'indicator' then
    select case when p.role::text = 'indicador' and coalesce(p.is_active, false) then '["indicator"]'::jsonb else '[]'::jsonb end
      into v_roles from public.profiles p where p.id = v_originator;
  elsif v_origin = 'employee' then
    select coalesce(jsonb_agg(er.attribution_role order by er.attribution_role), '[]'::jsonb)
      into v_roles from public.employee_opportunity_eligible_roles(v_originator) er;
  end if;
  return jsonb_build_object('ok', true, 'links', v_links, 'eligibleRoles', coalesce(v_roles, '[]'::jsonb));
end;
$$;

create or replace function public.referral_share_public_context(p_token text, p_client_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_link public.referral_share_links%rowtype;
  v_headline text;
  v_plans jsonb;
  v_cnpj text;
begin
  if p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  if not public.partner_rate_hit('j11g', 240, 60) or not public.partner_rate_hit('j11c:' || p_client_key, 20, 600) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  v_hash := public.partner_sha256_hex(coalesce(p_token, ''));
  if not public.partner_rate_hit('j11t:' || v_hash, 30, 600) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  select * into v_link from public.referral_share_links l where l.token_hash = v_hash;
  if v_link.id is null or not public.referral_share_link_usable(v_link) then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end if;
  if v_link.attribution_role = 'indicator' then
    v_headline := 'Indicação enviada por ' || v_link.public_display_name;
  elsif v_link.attribution_role = 'partner_merchant_originator' then
    v_headline := 'Indicação enviada por ' || v_link.public_display_name;
    select case when m.publish_cnpj then m.cnpj else null end into v_cnpj
    from public.partner_merchants m where m.id = v_link.originator_id;
  else
    v_headline := 'Atendimento indicado por ' || v_link.public_display_name;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.sort_order, p.name), '[]'::jsonb)
    into v_plans
  from public.plans p where p.is_active;
  return jsonb_build_object('ok', true, 'headline', v_headline, 'publicDisplayName', v_link.public_display_name, 'cnpj', v_cnpj, 'plans', v_plans);
end;
$$;

create or replace function public.submit_referral_share(p_token text, p_client_key text, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array[
    'idempotencyKey','planId','name','phone','document','zipcode','street','number',
    'complement','neighborhood','city','observation','consent','confirmRecentDuplicate'
  ];
  c_forbidden constant text[] := array[
    'origin_kind','originator_id','originatorId','employee_id','employeeId','profile_id','profileId',
    'partner_id','partnerId','attribution_role','attributionRole','reward_eligible','indicator_profile_id'
  ];
  v_k text;
  v_key text;
  v_hash_token text;
  v_link public.referral_share_links%rowtype;
  v_name text;
  v_phone text;
  v_document text;
  v_zipcode text;
  v_street text;
  v_number text;
  v_complement text;
  v_neighborhood text;
  v_city text;
  v_observation text;
  v_confirm boolean;
  v_plan uuid;
  v_hash text;
  v_existing public.referral_share_submissions%rowtype;
  v_dup_open boolean;
  v_dup_recent boolean;
  v_open uuid;
  v_referral uuid;
  v_protocol text;
  v_try int;
  v_sector uuid;
  v_membership uuid;
  v_profile uuid;
begin
  if p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  if not public.partner_rate_hit('j11g', 240, 60) or not public.partner_rate_hit('j11c:' || p_client_key, 20, 600) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  v_hash_token := public.partner_sha256_hex(coalesce(p_token, ''));
  if not public.partner_rate_hit('j11t:' || v_hash_token, 30, 600) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  select * into v_link from public.referral_share_links l where l.token_hash = v_hash_token;
  if v_link.id is null or not public.referral_share_link_usable(v_link) then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  for v_k in select jsonb_object_keys(p_payload) loop
    if v_k = any (c_forbidden) or not (v_k = any (c_allowed)) then
      return jsonb_build_object('ok', false, 'code', 'unknown_field');
    end if;
  end loop;
  for v_k in select unnest(array['idempotencyKey','planId','name','phone','document','zipcode','street','number','complement','neighborhood','city','observation']) loop
    if p_payload ? v_k and jsonb_typeof(p_payload -> v_k) not in ('string', 'null') then
      return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', v_k);
    end if;
  end loop;
  if (p_payload ? 'consent' and jsonb_typeof(p_payload -> 'consent') <> 'boolean')
     or (p_payload ? 'confirmRecentDuplicate' and jsonb_typeof(p_payload -> 'confirmRecentDuplicate') not in ('boolean', 'null')) then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'consent');
  end if;
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  v_name := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'name', '')), '\s+', ' ', 'g'), '');
  v_phone := public.employee_opportunity_normalize_phone(p_payload ->> 'phone');
  v_document := nullif(regexp_replace(coalesce(p_payload ->> 'document', ''), '[^0-9]', '', 'g'), '');
  v_zipcode := nullif(regexp_replace(coalesce(p_payload ->> 'zipcode', ''), '[^0-9]', '', 'g'), '');
  v_street := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'street', '')), '\s+', ' ', 'g'), '');
  v_number := nullif(btrim(coalesce(p_payload ->> 'number', '')), '');
  v_complement := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'complement', '')), '\s+', ' ', 'g'), '');
  v_neighborhood := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'neighborhood', '')), '\s+', ' ', 'g'), '');
  v_city := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'city', '')), '\s+', ' ', 'g'), '');
  v_observation := nullif(btrim(coalesce(p_payload ->> 'observation', '')), '');
  v_confirm := coalesce((p_payload ->> 'confirmRecentDuplicate')::boolean, false);
  if v_name is null or length(v_name) < 3 or length(v_name) > 120
     or v_phone is null or length(v_phone) not in (10, 11)
     or (v_document is not null and length(v_document) not in (11, 14))
     or v_zipcode is null or length(v_zipcode) <> 8
     or v_street is null or length(v_street) > 160
     or v_number is null or length(v_number) > 20
     or (v_complement is not null and length(v_complement) > 80)
     or v_neighborhood is null or length(v_neighborhood) > 100
     or v_city is null or length(v_city) > 100
     or (v_observation is not null and length(v_observation) > 500) then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  if coalesce((p_payload ->> 'consent')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'consent_required');
  end if;
  if coalesce(p_payload ->> 'planId', '') !~* '^[0-9a-f-]{36}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'planId');
  end if;
  select p.id into v_plan from public.plans p where p.id = (p_payload ->> 'planId')::uuid and p.is_active;
  if v_plan is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'planId');
  end if;
  v_hash := md5(concat_ws('|', v_link.id::text, v_plan::text, lower(v_name), v_phone, coalesce(v_document, ''),
    v_zipcode, lower(v_street), lower(v_number), lower(coalesce(v_complement, '')), lower(v_neighborhood), lower(v_city), coalesce(v_observation, '')));
  perform pg_advisory_xact_lock(hashtextextended('igt.j11.idem:' || v_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('igt.j11.phone:' || v_phone, 0));
  if v_document is not null then
    perform pg_advisory_xact_lock(hashtextextended('igt.j11.doc:' || v_document, 0));
  end if;
  select * into v_existing from public.referral_share_submissions s where s.idempotency_key = v_key;
  if v_existing.id is not null then
    if v_existing.request_hash is distinct from v_hash or v_existing.link_id is distinct from v_link.id then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'protocol', v_existing.public_protocol);
  end if;
  select
    bool_or(r.pipeline_stage::text not in ('ativado', 'perdido') and r.status::text not in ('recusada', 'paga')),
    bool_or(
      not (r.pipeline_stage::text not in ('ativado', 'perdido') and r.status::text not in ('recusada', 'paga'))
      and coalesce(r.lost_at, r.won_at, r.rejected_at, r.moved_to_stage_at, r.updated_at) >= timezone('utc', now()) - interval '90 days'
    )
    into v_dup_open, v_dup_recent
  from public.referrals r
  where public.employee_opportunity_normalize_phone(r.referred_phone) = v_phone
     or (v_document is not null and r.referred_document is not null and regexp_replace(r.referred_document, '[^0-9]', '', 'g') = v_document);
  if coalesce(v_dup_open, false) then
    select r.id into v_open
    from public.referrals r
    where (
      public.employee_opportunity_normalize_phone(r.referred_phone) = v_phone
      or (v_document is not null and r.referred_document is not null and regexp_replace(r.referred_document, '[^0-9]', '', 'g') = v_document)
    )
      and r.pipeline_stage::text not in ('ativado', 'perdido')
      and r.status::text not in ('recusada', 'paga')
    order by r.created_at
    limit 1;
    if v_open is not null then
      insert into public.referral_share_competing_attempts (existing_opportunity_id, attempted_link_id, phone_hash, document_hash)
      values (v_open, v_link.id, public.partner_sha256_hex(v_phone), case when v_document is null then null else public.partner_sha256_hex(v_document) end);
    end if;
    return jsonb_build_object('ok', false, 'code', 'duplicate_open');
  end if;
  if coalesce(v_dup_recent, false) and not v_confirm then
    return jsonb_build_object('ok', false, 'code', 'duplicate_recent_closed', 'requiresConfirmation', true);
  end if;
  v_try := 0;
  loop
    v_try := v_try + 1;
    v_protocol := upper(encode(substring(decode(public.partner_sha256_hex(v_key || ':' || v_try::text || ':' || clock_timestamp()::text), 'hex') from 1 for 5), 'hex'));
    exit when not exists (select 1 from public.referral_share_submissions s where s.public_protocol = v_protocol);
    if v_try > 5 then
      return jsonb_build_object('ok', false, 'code', 'unavailable');
    end if;
  end loop;
  if v_link.origin_kind = 'employee' then
    perform set_config('igt.employee_opportunity_rpc', 'on', true);
  elsif v_link.origin_kind = 'partner_merchant' then
    perform set_config('igt.partner_merchant_referral_rpc', 'on', true);
  end if;
  if v_link.origin_kind = 'indicator' then
    insert into public.referrals (
      indicator_profile_id, referred_name, referred_phone, referred_document, referred_person_type,
      referred_zipcode, referred_street, referred_number, referred_complement, referred_neighborhood,
      referred_city, referred_observation, plan_id, reward_type, reward_amount, reward_eligible,
      source, erp_lead_source, origin_kind, status, pipeline_stage
    ) values (
      v_link.originator_id, v_name, v_phone, v_document, case when length(v_document) = 14 then 'pj' else 'pf' end,
      v_zipcode, v_street, v_number, v_complement, v_neighborhood, v_city, v_observation, v_plan,
      'pix'::public.reward_type, null, true, 'referral_share_link', 'Indique e Ganhe', 'indicator', 'pendente', 'novo'
    ) returning id into v_referral;
  elsif v_link.origin_kind = 'employee' then
    insert into public.referrals (
      indicator_profile_id, referred_name, referred_phone, referred_document, referred_person_type,
      referred_zipcode, referred_street, referred_number, referred_complement, referred_neighborhood,
      referred_city, referred_observation, plan_id, reward_type, reward_amount, reward_eligible,
      source, erp_lead_source, origin_kind, created_by_profile_id, employee_opportunity_idempotency_key,
      status, pipeline_stage
    ) values (
      null, v_name, v_phone, v_document, case when length(v_document) = 14 then 'pj' else 'pf' end,
      v_zipcode, v_street, v_number, v_complement, v_neighborhood, v_city, v_observation, v_plan,
      null, null, false, 'employee_sales_opportunity', 'Oportunidade Funcionário', 'employee', null, v_key,
      'pendente', 'novo'
    ) returning id into v_referral;
    select er.sector_id, er.membership_id into v_sector, v_membership
    from public.employee_opportunity_eligible_roles(v_link.originator_id) er
    where er.attribution_role = v_link.attribution_role;
    select e.profile_id into v_profile from public.employees e where e.id = v_link.originator_id;
    insert into public.sales_opportunity_attributions (
      opportunity_id, employee_id, attribution_role, sector_id, membership_id, attributed_by, source, metadata, idempotency_key
    ) values (
      v_referral, v_link.originator_id, v_link.attribution_role, v_sector, v_membership, v_profile,
      'employee_opportunity_rpc', jsonb_build_object('rpc', 'submit_referral_share', 'request_hash', v_hash), v_key
    );
  else
    insert into public.referrals (
      indicator_profile_id, referred_name, referred_phone, referred_document, referred_person_type,
      referred_zipcode, referred_street, referred_number, referred_complement, referred_neighborhood,
      referred_city, referred_observation, plan_id, reward_type, reward_amount, reward_eligible,
      source, erp_lead_source, origin_kind, partner_referral_idempotency_key, partner_public_protocol,
      status, pipeline_stage
    ) values (
      null, v_name, v_phone, v_document, case when length(v_document) = 14 then 'pj' else 'pf' end,
      v_zipcode, v_street, v_number, v_complement, v_neighborhood, v_city, v_observation, v_plan,
      null, null, false, 'partner_merchant_referral', 'Comércio Parceiro', 'partner_merchant', v_key, v_protocol,
      'pendente', 'novo'
    ) returning id into v_referral;
    insert into public.partner_merchant_attributions (
      opportunity_id, partner_merchant_id, link_id, campaign_code, idempotency_key, request_hash, public_protocol
    ) values (
      v_referral, v_link.originator_id, v_link.partner_link_id, v_link.campaign, v_key, v_hash, v_protocol
    );
  end if;
  perform set_config('igt.employee_opportunity_rpc', '', true);
  perform set_config('igt.partner_merchant_referral_rpc', '', true);
  insert into public.referral_share_submissions (link_id, opportunity_id, idempotency_key, request_hash, public_protocol)
  values (v_link.id, v_referral, v_key, v_hash, v_protocol);
  if v_link.origin_kind is distinct from 'partner_merchant' then
    update public.referral_share_links
      set use_count = use_count + 1, last_used_at = timezone('utc', now())
    where id = v_link.id;
  end if;
  return jsonb_build_object('ok', true, 'idempotent', false, 'protocol', v_protocol);
end;
$$;

revoke all on function public.referral_share_link_usable(public.referral_share_links) from public, anon, authenticated, service_role;
revoke all on function public.referral_share_my_links() from public, anon, authenticated, service_role;
revoke all on function public.issue_referral_share_link(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.revoke_referral_share_link(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_referral_share_links(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.referral_share_public_context(text, text) from public, anon, authenticated, service_role;
revoke all on function public.submit_referral_share(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.trg_referral_share_links_guard() from public, anon, authenticated, service_role;
revoke all on function public.trg_mirror_partner_share_link() from public, anon, authenticated, service_role;
revoke all on function public.trg_share_count_partner_use() from public, anon, authenticated, service_role;

grant execute on function public.referral_share_my_links() to authenticated;
grant execute on function public.issue_referral_share_link(jsonb) to authenticated;
grant execute on function public.revoke_referral_share_link(jsonb) to authenticated;
grant execute on function public.admin_list_referral_share_links(jsonb) to authenticated;
grant execute on function public.referral_share_public_context(text, text) to anon, authenticated;
grant execute on function public.submit_referral_share(text, text, jsonb) to anon, authenticated;

commit;

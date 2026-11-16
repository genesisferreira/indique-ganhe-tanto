-- 3.1F-J11S: a revogação administrativa existente passa a aceitar Admin Financeiro.
-- Não cria link, não apaga registro e não mexe em recompensa, carteira ou competência.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
  if v_own is not true and v_cap not in ('master', 'finance') then
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
  return jsonb_build_object(
    'ok', true,
    'links', v_links,
    'eligibleRoles', coalesce(v_roles, '[]'::jsonb),
    'canRevoke', v_cap in ('master', 'finance')
  );
end;
$$;

commit;

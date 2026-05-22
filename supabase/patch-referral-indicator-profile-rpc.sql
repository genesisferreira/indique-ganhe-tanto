-- Perfil público mínimo do indicador para tela /comercial/leads/[id].
-- Contorna RLS de profiles quando o EXISTS com referrals falha no cliente.

begin;

create or replace function public.get_referral_indicator_public_profile(p_referral_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_ref record;
  v_prof record;
  v_display_name text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;

  if v_role is null then
    return jsonb_build_object('ok', false, 'message', 'profile_not_found');
  end if;

  select
    r.id,
    r.indicator_profile_id,
    r.commercial_profile_id
  into v_ref
  from public.referrals r
  where r.id = p_referral_id;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'referral_not_found');
  end if;

  if v_role in (
    'admin_master'::public.user_role,
    'admin_financeiro'::public.user_role,
    'admin_consulta'::public.user_role
  ) then
    null;
  elsif v_role = 'comercial'::public.user_role then
    if v_ref.commercial_profile_id is null then
      return jsonb_build_object('ok', false, 'message', 'referral_not_assigned');
    end if;
    if v_ref.commercial_profile_id is distinct from v_uid then
      return jsonb_build_object('ok', false, 'message', 'forbidden');
    end if;
  else
    return jsonb_build_object('ok', false, 'message', 'forbidden');
  end if;

  select p.id, p.full_name, p.email, p.phone
  into v_prof
  from public.profiles p
  where p.id = v_ref.indicator_profile_id;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'id', v_ref.indicator_profile_id,
      'name', 'Indicador não identificado',
      'email', null,
      'phone', null
    );
  end if;

  v_display_name := coalesce(
    nullif(trim(v_prof.full_name), ''),
    nullif(trim(v_prof.email), ''),
    'Indicador não identificado'
  );

  return jsonb_build_object(
    'ok', true,
    'id', v_prof.id,
    'name', v_display_name,
    'email', v_prof.email,
    'phone', v_prof.phone
  );
end;
$$;

revoke all on function public.get_referral_indicator_public_profile(uuid) from public;
grant execute on function public.get_referral_indicator_public_profile(uuid) to authenticated;

comment on function public.get_referral_indicator_public_profile(uuid) is
  'Retorna id, name, email, phone do indicador de uma referral se o usuário for admin ou comercial atribuído.';

-- Reforço opcional em profiles (security definer no EXISTS)
create or replace function public.comercial_can_read_indicator_profile(p_indicator_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.referrals r
    where r.indicator_profile_id = p_indicator_profile_id
      and r.commercial_profile_id = auth.uid()
  );
$$;

revoke all on function public.comercial_can_read_indicator_profile(uuid) from public;
grant execute on function public.comercial_can_read_indicator_profile(uuid) to authenticated;

drop policy if exists profiles_select_comercial_indicator_assigned on public.profiles;
create policy profiles_select_comercial_indicator_assigned
on public.profiles
for select
to authenticated
using (
  public.comercial_can_read_indicator_profile(profiles.id)
);

commit;

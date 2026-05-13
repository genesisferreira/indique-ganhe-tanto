-- =========================================================
-- Assumir lead do pool (comercial) — RPC SECURITY DEFINER
-- Aplicar após supabase/schema.sql e supabase/rls-policies.sql
--
-- Motivo: a policy de UPDATE em referrals exige commercial_profile_id = auth.uid()
-- na linha atual; leads no pool têm commercial_profile_id IS NULL, bloqueando UPDATE
-- direto pelo cliente. Esta função realiza claim com checagens no servidor.
-- =========================================================

begin;

create or replace function public.claim_referral_lead(p_referral_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_ref public.referrals%rowtype;
  v_old_status public.referral_status;
  v_now timestamptz := timezone('utc', now());
begin
  if v_uid is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'unauthorized',
      'message', 'Sessão inválida. Faça login novamente.'
    );
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_uid;

  if v_role is distinct from 'comercial'::public.user_role then
    return jsonb_build_object(
      'ok', false,
      'code', 'forbidden',
      'message', 'Apenas usuários com perfil comercial podem assumir leads.'
    );
  end if;

  select * into strict v_ref
  from public.referrals
  where id = p_referral_id
  for update;

  v_old_status := v_ref.status;

  if v_ref.commercial_profile_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already_claimed');
  end if;

  update public.referrals
  set
    commercial_profile_id = v_uid,
    status = 'em_atendimento'::public.referral_status,
    assigned_at = v_now,
    first_response_at = v_now,
    last_interaction_at = v_now,
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
    v_old_status,
    'em_atendimento'::public.referral_status,
    'Lead assumido pelo comercial',
    jsonb_build_object('action', 'claim_lead_rpc')
  );

  return jsonb_build_object(
    'ok', true,
    'referral_id', p_referral_id,
    'commercial_profile_id', v_uid
  );
exception
  when no_data_found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
end;
$$;

comment on function public.claim_referral_lead(uuid) is
  'Comercial assume lead do pool: trava linha, valida role, atualiza referral e registra histórico.';

revoke all on function public.claim_referral_lead(uuid) from public;
grant execute on function public.claim_referral_lead(uuid) to authenticated;

commit;

-- Notifica admins ao criar indicação (indicador não pode INSERT em notifications de terceiros via RLS).
-- OBRIGATÓRIO para nova indicação → notificação admin. Aplicar no Supabase SQL Editor.

create or replace function public.notify_admins_new_referral(p_referral_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_referral_id is null then
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
    p.id,
    'indicacao'::public.notification_type,
    'Nova indicação recebida',
    'Uma nova indicação foi cadastrada no sistema.',
    jsonb_build_object(
      'action', 'referral_created',
      'referral_id', p_referral_id::text
    ),
    '/admin/indicacoes/' || p_referral_id::text
  from public.profiles p
  where p.role in ('admin_master', 'admin_financeiro', 'admin_consulta')
    and p.is_active = true
    and not exists (
      select 1
      from public.notifications n
      where n.profile_id = p.id
        and n.notification_type = 'indicacao'
        and n.data->>'action' = 'referral_created'
        and n.data->>'referral_id' = p_referral_id::text
    );
end;
$$;

revoke all on function public.notify_admins_new_referral(uuid) from public;
grant execute on function public.notify_admins_new_referral(uuid) to authenticated;

-- Garante notificação mesmo se o cliente não chamar a RPC (idempotente via função acima).
create or replace function public.trg_referrals_notify_admins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.notify_admins_new_referral(new.id);
  return new;
end;
$$;

drop trigger if exists trg_referrals_notify_admins on public.referrals;
create trigger trg_referrals_notify_admins
after insert on public.referrals
for each row
execute function public.trg_referrals_notify_admins();

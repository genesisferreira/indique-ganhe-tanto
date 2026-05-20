-- Diagnóstico: notificações de saque Pix para admin financeiro/master.
-- Substituir :admin_id pelo profiles.id do admin logado (ex.: 94afcdb3-fca0-423d-9b08-934972788dfb).

-- 1) Perfil admin
select id, email, role, is_active, created_at
from public.profiles
where id = '94afcdb3-fca0-423d-9b08-934972788dfb'::uuid
   or role in ('admin_financeiro', 'admin_master')
order by role, email;

-- 2) Notificações pix_withdrawal_requested
select
  id,
  profile_id,
  notification_type,
  title,
  is_read,
  action_url,
  data->>'payment_id' as payment_id,
  data->>'indicator_profile_id' as indicator_profile_id,
  created_at
from public.notifications
where data->>'action' = 'pix_withdrawal_requested'
order by created_at desc
limit 20;

-- 3) Notificações pagamento para o admin logado
select id, notification_type, title, is_read, data, created_at
from public.notifications
where profile_id = '94afcdb3-fca0-423d-9b08-934972788dfb'::uuid
  and notification_type = 'pagamento'
order by created_at desc
limit 10;

-- 4) Debug logs da função
select
  source,
  action,
  indicator_profile_id,
  detail->>'payment_id' as payment_id,
  detail->>'admin_profile_id' as admin_profile_id,
  detail->>'notification_id' as notification_id,
  detail->>'inserted_count' as inserted_count,
  detail,
  executed_at
from public.debug_notification_logs
where source = 'notify_admins_pix_withdrawal_requested'
order by executed_at desc
limit 30;

-- 5) Função RPC instalada e chama notify?
select pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'request_pix_withdrawal';

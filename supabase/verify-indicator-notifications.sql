-- Verificação manual (SQL Editor)
-- NOTA: status no banco é referral_status enum — "vendido" do comercial vira "aprovada".

-- 1) Triggers existem?
select tgname, tgrelid::regclass as table_name
from pg_trigger
where tgname in (
  'trg_referrals_notify_indicator_progress',
  'trg_rewards_notify_indicator_released'
);

-- 2) Funções existem?
select proname
from pg_proc
where proname in (
  'notify_indicator_referral_progress',
  'notify_indicator_reward_released',
  'log_notification_debug'
);

-- 3) Simular venda (troca para aprovada)
-- update public.referrals
-- set status = 'aprovada'::public.referral_status
-- where id = 'SEU_REFERRAL_UUID';

-- 4) Notificações do indicador
select
  id,
  profile_id,
  notification_type,
  title,
  data->>'action' as action,
  data->>'referral_id' as referral_id,
  data->>'new_status' as new_status,
  action_url,
  created_at
from public.notifications
where data->>'action' in ('referral_progress', 'reward_released')
order by created_at desc
limit 20;

-- 5) Logs de debug
select *
from public.debug_notification_logs
order by executed_at desc
limit 30;

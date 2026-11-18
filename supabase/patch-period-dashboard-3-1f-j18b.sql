-- 3.1F-J18B: agregação somente leitura. Não apaga, não paga e não grava ledger.
create or replace function public.admin_period_dashboard(
  p_from timestamptz,
  p_to timestamptz,
  p_grain text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_grain text := case when p_grain = 'day' then 'day' else 'month' end;
  v_pattern text := case when p_grain = 'day' then 'YYYY-MM-DD' else 'YYYY-MM' end;
  v_today_from timestamptz := (date_trunc('day', timezone('America/Sao_Paulo', now())) at time zone 'America/Sao_Paulo');
  v_referral_series jsonb;
  v_payment_series jsonb;
  v_top jsonb;
  v_commercials jsonb;
  v_origins jsonb;
  v_plans jsonb;
  v_pending integer;
  v_attendance integer;
  v_approved integer;
  v_rejected integer;
  v_cancelled integer;
  v_total integer;
  v_paid numeric;
  v_open numeric;
  v_open_count integer;
  v_paid_count integer;
  v_cancelled_count integer;
  v_rewards integer;
  v_reward_amount numeric;
  v_indicators integer;
  v_active_indicators integer;
  v_commercial_count integer;
  v_available integer;
  v_employees integer;
  v_partners integer;
  v_balance numeric;
  v_today integer;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'unauthenticated'); end if;
  select p.role::text into v_role from public.profiles p where p.id = auth.uid();
  if v_role not in ('admin_master', 'admin_financeiro', 'admin_consulta') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', s.bucket, 'indicacoes', s.indicacoes, 'conversoes', s.conversoes) order by s.bucket), '[]'::jsonb)
    into v_referral_series
  from (
    select to_char(timezone('America/Sao_Paulo', r.created_at), v_pattern) as bucket,
           count(*)::int as indicacoes,
           count(*) filter (where r.status::text in ('aprovada', 'paga'))::int as conversoes
    from public.referrals r
    where (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to)
    group by 1
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', s.bucket, 'pago', s.pago, 'pendente', s.pendente) order by s.bucket), '[]'::jsonb)
    into v_payment_series
  from (
    select to_char(timezone('America/Sao_Paulo', p.created_at), v_pattern) as bucket,
           coalesce(sum(p.amount) filter (where p.status::text = 'pago'), 0) as pago,
           coalesce(sum(p.amount) filter (where p.status::text in ('pendente', 'aprovado')), 0) as pendente
    from public.payments p
    where (p_from is null or p.created_at >= p_from) and (p_to is null or p.created_at < p_to)
    group by 1
  ) s;

  select count(*) filter (where r.status::text = 'pendente'),
         count(*) filter (where r.status::text = 'em_atendimento'),
         count(*) filter (where r.status::text = 'aprovada'),
         count(*) filter (where r.status::text = 'recusada'),
         count(*) filter (where r.status::text = 'cancelada'),
         count(*)
    into v_pending, v_attendance, v_approved, v_rejected, v_cancelled, v_total
  from public.referrals r
  where (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to);

  select coalesce(sum(p.amount) filter (where p.status::text = 'pago'), 0),
         coalesce(sum(p.amount) filter (where p.status::text in ('pendente', 'aprovado')), 0),
         count(*) filter (where p.status::text in ('pendente', 'aprovado')),
         count(*) filter (where p.status::text = 'pago'),
         count(*) filter (where p.status::text in ('cancelado', 'rejeitado'))
    into v_paid, v_open, v_open_count, v_paid_count, v_cancelled_count
  from public.payments p
  where (p_from is null or p.created_at >= p_from) and (p_to is null or p.created_at < p_to);

  select count(*), coalesce(sum(r.amount), 0) into v_rewards, v_reward_amount
  from public.rewards r
  where (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to);

  select coalesce(jsonb_agg(jsonb_build_object('nome', s.nome, 'conversoes', s.conversoes, 'total', s.total) order by s.conversoes desc, s.total desc), '[]'::jsonb)
    into v_top
  from (
    select left(coalesce(p.full_name, 'Indicador'), 40) as nome,
           count(*) filter (where r.status::text in ('aprovada', 'paga'))::int as conversoes,
           count(*)::int as total
    from public.referrals r
    join public.profiles p on p.id = r.indicator_profile_id
    where (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to)
    group by p.id, p.full_name
    order by 2 desc, 3 desc, p.id
    limit 5
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('nome', s.nome, 'conversoes', s.conversoes, 'total', s.total) order by s.conversoes desc, s.total desc), '[]'::jsonb)
    into v_commercials
  from (
    select left(coalesce(p.full_name, 'Comercial'), 40) as nome,
           count(*) filter (where r.status::text in ('aprovada', 'paga'))::int as conversoes,
           count(*)::int as total
    from public.referrals r
    join public.profiles p on p.id = r.commercial_profile_id
    where (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to)
    group by p.id, p.full_name
    order by 2 desc, 3 desc, p.id
    limit 5
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('nome', s.nome, 'total', s.total) order by s.total desc), '[]'::jsonb)
    into v_origins
  from (
    select left(coalesce(nullif(r.origin_kind, ''), 'sem_origem'), 40) as nome, count(*)::int as total
    from public.referrals r
    where (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to)
    group by 1
    order by 2 desc
    limit 8
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('plano', s.plano, 'quantidade', s.quantidade) order by s.quantidade desc), '[]'::jsonb)
    into v_plans
  from (
    select left(coalesce(pl.name, 'Sem plano'), 40) as plano, count(*)::int as quantidade
    from public.referrals r
    left join public.plans pl on pl.id = r.plan_id
    where (p_from is null or r.created_at >= p_from) and (p_to is null or r.created_at < p_to)
    group by 1
    order by 2 desc
    limit 8
  ) s;

  select count(*) into v_indicators from public.profiles p where p.role::text = 'indicador';
  select count(*) into v_active_indicators from public.profiles p where p.role::text = 'indicador' and p.is_active is true;
  select count(*) into v_commercial_count from public.profiles p where p.role::text = 'comercial';
  select count(*) into v_available from public.commercial_availability a where a.availability_status = 'disponivel';
  select count(*) into v_employees from public.profiles p where p.role::text = 'funcionario' and p.is_active is true;
  select count(*) into v_partners from public.partner_merchants m where m.terminated_at is null;
  select count(*) into v_today from public.referrals r
    where r.status::text in ('aprovada', 'paga')
      and r.approved_at >= v_today_from
      and r.approved_at < v_today_from + interval '1 day';
  select coalesce(sum(s.balance_after), 0) into v_balance from (
    select distinct on (w.indicator_profile_id) w.balance_after
    from public.wallet_transactions w
    order by w.indicator_profile_id, w.created_at desc, w.id desc
  ) s;

  return jsonb_build_object(
    'ok', true,
    'granularity', v_grain,
    'referralSeries', v_referral_series,
    'paymentSeries', v_payment_series,
    'totalReferrals', v_total,
    'pendingReferrals', v_pending,
    'inAttendanceReferrals', v_attendance,
    'approvedReferrals', v_approved,
    'rejectedReferrals', v_rejected,
    'cancelledReferrals', v_cancelled,
    'paidValue', v_paid,
    'pendingValue', v_open,
    'pendingCount', v_open_count,
    'paidCount', v_paid_count,
    'cancelledCount', v_cancelled_count,
    'rewards', v_rewards,
    'rewardAmount', v_reward_amount,
    'topIndicadores', v_top,
    'topComerciais', v_commercials,
    'origins', v_origins,
    'plans', v_plans,
    'currentIndicators', v_indicators,
    'activeIndicators', v_active_indicators,
    'currentCommercials', v_commercial_count,
    'availableCommercials', v_available,
    'activeEmployees', v_employees,
    'activePartners', v_partners,
    'todayConversions', v_today,
    'currentBalance', v_balance,
    'currentBalanceLabel', 'Saldo atual'
  );
end;
$$;

create or replace function public.self_period_referral_stats(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_total integer;
  v_pending integer;
  v_approved integer;
  v_rejected integer;
  v_paid numeric;
  v_balance numeric;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'unauthenticated'); end if;
  select p.role::text into v_role from public.profiles p where p.id = auth.uid();
  if v_role not in ('indicador', 'comercial', 'funcionario') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  select count(*),
         count(*) filter (where r.status::text = 'pendente'),
         count(*) filter (where r.status::text in ('aprovada', 'paga')),
         count(*) filter (where r.status::text = 'recusada')
    into v_total, v_pending, v_approved, v_rejected
  from public.referrals r
  where (p_from is null or r.created_at >= p_from)
    and (p_to is null or r.created_at < p_to)
    and (
      (v_role = 'indicador' and r.indicator_profile_id = auth.uid())
      or (v_role = 'comercial' and r.commercial_profile_id = auth.uid())
      or (v_role = 'funcionario' and r.created_by_profile_id = auth.uid())
    );
  select coalesce(sum(p.amount) filter (where p.status::text = 'pago'), 0) into v_paid
  from public.payments p
  where p.indicator_profile_id = auth.uid()
    and (p_from is null or p.created_at >= p_from)
    and (p_to is null or p.created_at < p_to);
  select coalesce((
    select w.balance_after
    from public.wallet_transactions w
    where w.indicator_profile_id = auth.uid()
    order by w.created_at desc, w.id desc
    limit 1
  ), 0) into v_balance;
  return jsonb_build_object(
    'ok', true,
    'totalReferrals', v_total,
    'pendingReferrals', v_pending,
    'approvedReferrals', v_approved,
    'rejectedReferrals', v_rejected,
    'paidValue', v_paid,
    'currentBalance', v_balance,
    'currentBalanceLabel', 'Saldo atual'
  );
end;
$$;

revoke all on function public.admin_period_dashboard(timestamptz, timestamptz, text) from public, anon;
revoke all on function public.self_period_referral_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_period_dashboard(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.self_period_referral_stats(timestamptz, timestamptz) to authenticated;

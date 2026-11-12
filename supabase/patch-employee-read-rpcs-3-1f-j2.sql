-- ============================================================================
-- 3.1F-J2 — RPCs SOMENTE LEITURA da área do funcionário
-- ============================================================================
-- Escopo (aditivo, transacional, reaplicável):
--   * cria 2 helpers internos + 5 RPCs de leitura;
--   * NÃO cria tabela, coluna, policy, trigger, dado, backfill ou escrita;
--   * NÃO altera objetos financeiros existentes (somente novas funções/grants).
--
-- Por que SECURITY DEFINER: as tabelas financeiras de 3.1F-I1 não concedem
-- SELECT a authenticated (por desenho). A leitura do PRÓPRIO dado precisa de
-- funções definer com filtro fixo em auth.uid(). Nenhuma RPC recebe
-- employee_id/profile_id: o funcionário é resolvido no servidor.
--
-- Política de estado (documentada em docs/employee-sales-payroll/16-j2-read-only.md):
--   active                    -> leitura própria
--   paused | vacation | away  -> leitura própria (somente leitura; não há escrita)
--   dismissed                 -> bloqueado (histórico fica para Admin/Financeiro)
--   profiles.is_active=false  -> bloqueado
--   role <> funcionario       -> bloqueado (Admin não usa estas RPCs)
--
-- Erros (mensagens estáveis, sem PII):
--   employee_portal_unauthenticated | employee_portal_forbidden |
--   employee_portal_not_found       | employee_portal_invalid_parameter
--
-- Rollback (somente as funções novas): supabase/rollback-employee-read-rpcs-3-1f-j2.sql
-- ============================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Pré-requisitos (fail-closed): fundação I1/H1 presente.
do $$
begin
  if to_regclass('public.sales_opportunity_attributions') is null
     or to_regclass('public.employee_commission_entitlements') is null
     or to_regclass('public.employee_compensation_profiles') is null
     or to_regclass('public.payroll_competences') is null
     or to_regclass('public.payroll_competence_lines') is null
     or to_regclass('public.employees') is null then
    raise exception 'j2_prerequisite_missing: aplicar 3.1F-H1/I1 antes';
  end if;
end$$;

-- ----------------------------------------------------------------------------
-- Helper interno: resolve o funcionário autenticado (sem EXECUTE para clientes)
-- ----------------------------------------------------------------------------
create or replace function public.employee_portal_self()
returns table (employee_id uuid, employee_status text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_emp uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'employee_portal_unauthenticated' using errcode = 'P0001';
  end if;
  select p.role::text, p.is_active into v_role, v_active
  from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'funcionario' or v_active is false then
    raise exception 'employee_portal_forbidden' using errcode = 'P0001';
  end if;
  select e.id, e.status::text into v_emp, v_status
  from public.employees e where e.profile_id = v_uid;
  if v_emp is null or v_status not in ('active', 'paused', 'vacation', 'away') then
    raise exception 'employee_portal_forbidden' using errcode = 'P0001';
  end if;
  employee_id := v_emp;
  employee_status := v_status;
  return next;
end;
$$;
revoke all on function public.employee_portal_self() from public, anon, authenticated, service_role;

-- Nome do interessado mascarado: primeiro nome + inicial do último.
create or replace function public.employee_portal_mask_name(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_name is null or btrim(p_name) = '' then null
    when array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1) = 1
      then left(btrim(p_name), 40)
    else left(split_part(btrim(p_name), ' ', 1), 40) || ' '
      || upper(left((regexp_split_to_array(btrim(p_name), '\s+'))[array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1)], 1)) || '.'
  end;
$$;
revoke all on function public.employee_portal_mask_name(text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1. Resumo do painel
-- ----------------------------------------------------------------------------
create or replace function public.employee_sales_dashboard_summary(p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_self record;
  v_month date;
  v_next date;
  v_comp record;
  v_recent jsonb;
begin
  select * into v_self from public.employee_portal_self();
  if p_month is not null and (p_month < date '2020-01-01' or p_month > date '2100-01-01') then
    raise exception 'employee_portal_invalid_parameter' using errcode = '22023';
  end if;
  v_month := date_trunc('month', coalesce(p_month, (now() at time zone 'America/Sao_Paulo')::date))::date;
  v_next := (v_month + interval '1 month')::date;

  select c.competence_month, c.status into v_comp
  from public.payroll_competences c
  where c.employee_id = v_self.employee_id and c.is_current and c.competence_month = v_month;

  select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]'::jsonb) into v_recent
  from (
    select r.created_at, jsonb_build_object(
      'id', r.id,
      'createdAt', r.created_at,
      'stage', r.pipeline_stage::text,
      'status', r.status::text,
      'role', a.attribution_role
    ) j
    from public.sales_opportunity_attributions a
    join public.referrals r on r.id = a.opportunity_id
    where a.employee_id = v_self.employee_id
    order by r.created_at desc
    limit 5
  ) x;

  return jsonb_build_object(
    'competenceMonth', v_month,
    'employeeStatus', v_self.employee_status,
    'readOnly', v_self.employee_status <> 'active',
    'opportunitiesInMonth', (
      select count(*) from public.sales_opportunity_attributions a
      join public.referrals r on r.id = a.opportunity_id
      where a.employee_id = v_self.employee_id
        and (r.created_at at time zone 'America/Sao_Paulo')::date >= v_month
        and (r.created_at at time zone 'America/Sao_Paulo')::date < v_next),
    'salesInProgress', (
      select count(*) from public.sales_opportunity_attributions a
      join public.referrals r on r.id = a.opportunity_id
      where a.employee_id = v_self.employee_id
        and r.pipeline_stage not in ('ativado', 'perdido')
        and r.status not in ('recusada', 'paga')),
    -- Conversão comprovada = primeira mensalidade confirmada (first_invoice_paid).
    -- Etapa "instalacao"/"ativado" sozinha NÃO conta como comprovada.
    'provenConversions', (
      select count(*) from public.sales_opportunity_attributions a
      join public.referrals r on r.id = a.opportunity_id
      where a.employee_id = v_self.employee_id and r.first_invoice_paid is true),
    'commissionsAwaitingEvidence', (
      select count(*) from public.employee_commission_entitlements e
      where e.employee_id = v_self.employee_id and e.status = 'pending_evidence'),
    'commissionAccruedInCompetence', (
      select coalesce(sum(e.amount), 0)::numeric(12,2) from public.employee_commission_entitlements e
      where e.employee_id = v_self.employee_id
        and e.competence_month = v_month
        and e.status in ('accrued', 'approved', 'included_in_payroll', 'paid')),
    'currentCompetence', case when v_comp.competence_month is null then null
      else jsonb_build_object('month', v_comp.competence_month, 'status', v_comp.status) end,
    'recent', v_recent
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Minhas vendas (lista paginada; filtros/ordenação por allowlist)
-- ----------------------------------------------------------------------------
create or replace function public.list_employee_sales(
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'created_desc',
  p_from date default null,
  p_to date default null,
  p_stage text default null,
  p_status text default null,
  p_commission text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_self record;
  v_total bigint;
  v_items jsonb;
begin
  select * into v_self from public.employee_portal_self();
  if p_limit is null or p_limit < 1 or p_limit > 50
     or p_offset is null or p_offset < 0 or p_offset > 10000
     or p_sort is null or p_sort not in ('created_desc', 'created_asc', 'updated_desc')
     or (p_stage is not null and p_stage not in ('novo', 'tentativa_contato', 'contato_realizado', 'negociacao', 'agendado', 'instalacao', 'ativado', 'perdido'))
     or (p_status is not null and p_status not in ('pendente', 'em_andamento', 'em_atendimento', 'em_negociacao', 'aprovada', 'recusada', 'paga'))
     or (p_commission is not null and p_commission not in ('none', 'pending_evidence', 'accrued', 'approved', 'included_in_payroll', 'paid', 'reversed', 'rejected'))
     or (p_from is not null and p_to is not null and p_to < p_from)
     or (p_from is not null and p_from < date '2020-01-01')
     or (p_to is not null and p_to > date '2100-01-01') then
    raise exception 'employee_portal_invalid_parameter' using errcode = '22023';
  end if;

  with base as (
    select r.id, r.created_at, r.updated_at, r.referred_name, r.plan_id,
           r.pipeline_stage::text stage, r.status::text status, a.attribution_role role,
           coalesce((
             select e.status from public.employee_commission_entitlements e
             where e.opportunity_id = r.id and e.employee_id = v_self.employee_id
             order by e.created_at desc limit 1), 'none') commission_status
    from public.sales_opportunity_attributions a
    join public.referrals r on r.id = a.opportunity_id
    where a.employee_id = v_self.employee_id
      and (p_from is null or (r.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
      and (p_to is null or (r.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
      and (p_stage is null or r.pipeline_stage::text = p_stage)
      and (p_status is null or r.status::text = p_status)
  ), filtered as (
    select * from base where p_commission is null or commission_status = p_commission
  ), page as (
    select f.*, pl.name plan_name from filtered f
    left join public.plans pl on pl.id = f.plan_id
    order by
      case when p_sort = 'created_asc' then f.created_at end asc,
      case when p_sort = 'created_desc' then f.created_at end desc,
      case when p_sort = 'updated_desc' then f.updated_at end desc,
      f.id
    limit p_limit offset p_offset
  )
  select (select count(*) from filtered),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'reference', upper(left(replace(p.id::text, '-', ''), 8)),
           'createdAt', p.created_at,
           'interested', public.employee_portal_mask_name(p.referred_name),
           'plan', p.plan_name,
           'stage', p.stage,
           'status', p.status,
           'role', p.role,
           'commissionStatus', p.commission_status,
           'updatedAt', p.updated_at
         ) order by
           case when p_sort = 'created_asc' then p.created_at end asc,
           case when p_sort = 'created_desc' then p.created_at end desc,
           case when p_sort = 'updated_desc' then p.updated_at end desc,
           p.id), '[]'::jsonb)
    into v_total, v_items
  from page p;

  return jsonb_build_object('items', v_items, 'total', coalesce(v_total, 0), 'limit', p_limit, 'offset', p_offset, 'sort', p_sort);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Detalhe de uma venda própria (alheia/inexistente => mesmo erro)
-- ----------------------------------------------------------------------------
create or replace function public.get_employee_sale_detail(p_opportunity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_self record;
  v_row record;
begin
  select * into v_self from public.employee_portal_self();
  if p_opportunity_id is null then
    raise exception 'employee_portal_invalid_parameter' using errcode = '22023';
  end if;
  select r.id, r.created_at, r.updated_at, r.referred_name, r.pipeline_stage::text stage,
         r.status::text status, r.moved_to_stage_at, a.attribution_role role, pl.name plan_name
    into v_row
  from public.sales_opportunity_attributions a
  join public.referrals r on r.id = a.opportunity_id
  left join public.plans pl on pl.id = r.plan_id
  where a.employee_id = v_self.employee_id and a.opportunity_id = p_opportunity_id;
  if v_row.id is null then
    raise exception 'employee_portal_not_found' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'reference', upper(left(replace(v_row.id::text, '-', ''), 8)),
    'createdAt', v_row.created_at,
    'updatedAt', v_row.updated_at,
    'interested', public.employee_portal_mask_name(v_row.referred_name),
    'plan', v_row.plan_name,
    'stage', v_row.stage,
    'stageSince', v_row.moved_to_stage_at,
    'status', v_row.status,
    'role', v_row.role,
    -- Linha do tempo sanitizada: somente transições de status (sem notas/autor/metadata).
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('at', h.created_at, 'from', h.old_status::text, 'to', h.new_status::text) order by h.created_at, h.id)
      from (select * from public.referral_history h0 where h0.referral_id = v_row.id order by h0.created_at desc limit 50) h
    ), '[]'::jsonb),
    -- Situação financeira resumida (sem contract/invoice/regra/evidência).
    'commissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', e.status,
        'competenceMonth', e.competence_month,
        'amount', case when e.status in ('accrued', 'approved', 'included_in_payroll', 'paid', 'reversed') then e.amount end
      ) order by e.created_at)
      from public.employee_commission_entitlements e
      where e.opportunity_id = v_row.id and e.employee_id = v_self.employee_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Visibilidade de linha da competência (interno):
--   commission/other_earning/discount/adjustment => sempre visível (Q4);
--   base_salary/meal/transport/fuel => somente se habilitado E visível no perfil
--   referenciado; reversal => segue a linha original.
-- ----------------------------------------------------------------------------
create or replace function public.employee_portal_line_visible(p_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive chain as (
    select l.id, l.line_type, l.compensation_profile_id, l.reversal_of_line_id, 0 depth
    from public.payroll_competence_lines l where l.id = p_line_id
    union all
    select o.id, o.line_type, o.compensation_profile_id, o.reversal_of_line_id, c.depth + 1
    from chain c join public.payroll_competence_lines o on o.id = c.reversal_of_line_id
    where c.line_type = 'reversal' and c.depth < 5
  )
  select coalesce((
    select case
      when c.line_type in ('commission', 'other_earning', 'discount', 'adjustment') then true
      when c.line_type = 'base_salary' then coalesce(p.salary_enabled and p.show_salary, false)
      when c.line_type = 'meal' then coalesce(p.meal_enabled and p.show_meal, false)
      when c.line_type = 'transport' then coalesce(p.transport_enabled and p.show_transport, false)
      when c.line_type = 'fuel' then coalesce(p.fuel_enabled and p.show_fuel, false)
      else false end
    from chain c left join public.employee_compensation_profiles p on p.id = c.compensation_profile_id
    where c.line_type <> 'reversal'
    order by c.depth desc limit 1
  ), false);
$$;
revoke all on function public.employee_portal_line_visible(uuid) from public, anon, authenticated, service_role;

create or replace function public.employee_portal_line_kind(p_line_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive chain as (
    select l.id, l.line_type, l.reversal_of_line_id, 0 depth
    from public.payroll_competence_lines l where l.id = p_line_id
    union all
    select o.id, o.line_type, o.reversal_of_line_id, c.depth + 1
    from chain c join public.payroll_competence_lines o on o.id = c.reversal_of_line_id
    where c.line_type = 'reversal' and c.depth < 5
  )
  select case
    when x.line_type = 'base_salary' then 'salary'
    when x.line_type in ('commission', 'meal', 'transport', 'fuel') then x.line_type
    when x.line_type = 'discount' then 'discounts'
    else 'otherEarnings' end
  from (select line_type from chain where line_type <> 'reversal' order by depth desc limit 1) x;
$$;
revoke all on function public.employee_portal_line_kind(uuid) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Minha remuneração: perfil visível vigente + competências próprias
-- ----------------------------------------------------------------------------
create or replace function public.employee_compensation_summary(p_limit integer default 12, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_self record;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_prof public.employee_compensation_profiles;
  v_profile jsonb := null;
  v_items jsonb;
  v_total bigint;
begin
  select * into v_self from public.employee_portal_self();
  if p_limit is null or p_limit < 1 or p_limit > 24 or p_offset is null or p_offset < 0 or p_offset > 1000 then
    raise exception 'employee_portal_invalid_parameter' using errcode = '22023';
  end if;

  -- Somente perfil ATIVO e vigente. Draft/inactive nunca aparece ao funcionário.
  select * into v_prof from public.employee_compensation_profiles p
  where p.employee_id = v_self.employee_id and p.status = 'active'
    and p.valid_from <= v_today and (p.valid_until is null or p.valid_until >= v_today)
  order by p.version desc limit 1;
  if v_prof.id is not null then
    -- Componente oculto/desabilitado é OMITIDO (nunca zero).
    v_profile := jsonb_strip_nulls(jsonb_build_object(
      'validFrom', v_prof.valid_from,
      'salary', case when v_prof.salary_enabled and v_prof.show_salary then jsonb_build_object('amount', v_prof.salary_amount) end,
      'meal', case when v_prof.meal_enabled and v_prof.show_meal then jsonb_build_object('dailyAmount', v_prof.meal_daily_amount) end,
      'transport', case when v_prof.transport_enabled and v_prof.show_transport then jsonb_build_object('amount', v_prof.transport_amount, 'method', v_prof.transport_method) end,
      'fuel', case when v_prof.fuel_enabled and v_prof.show_fuel then jsonb_build_object('amount', v_prof.fuel_amount, 'method', v_prof.fuel_method) end
    ));
  end if;

  select count(*) into v_total from public.payroll_competences c
  where c.employee_id = v_self.employee_id and c.is_current;

  select coalesce(jsonb_agg(x.j order by x.m desc), '[]'::jsonb) into v_items
  from (
    select c.competence_month m, jsonb_build_object(
      'competenceMonth', c.competence_month,
      'status', c.status,
      'visibleTotal', (
        select coalesce(sum(l.amount), 0)::numeric(12,2) from public.payroll_competence_lines l
        where l.competence_id = c.id and public.employee_portal_line_visible(l.id)),
      'totalKind', case when c.status in ('closed', 'paid') then 'closed' else 'expected' end
    ) j
    from public.payroll_competences c
    where c.employee_id = v_self.employee_id and c.is_current
    order by c.competence_month desc
    limit p_limit offset p_offset
  ) x;

  return jsonb_build_object(
    'employeeStatus', v_self.employee_status,
    'readOnly', v_self.employee_status <> 'active',
    'profile', v_profile,
    'competences', v_items,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Linhas de uma competência própria (somente linhas visíveis)
-- ----------------------------------------------------------------------------
create or replace function public.list_employee_competence_lines(p_competence_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_self record;
  v_comp record;
  v_components jsonb;
  v_lines jsonb;
  v_total numeric(12,2);
begin
  select * into v_self from public.employee_portal_self();
  if p_competence_month is null or extract(day from p_competence_month) <> 1
     or p_competence_month < date '2020-01-01' or p_competence_month > date '2100-01-01' then
    raise exception 'employee_portal_invalid_parameter' using errcode = '22023';
  end if;
  select c.id, c.competence_month, c.status, c.version into v_comp
  from public.payroll_competences c
  where c.employee_id = v_self.employee_id and c.is_current and c.competence_month = p_competence_month;
  if v_comp.id is null then
    raise exception 'employee_portal_not_found' using errcode = 'P0001';
  end if;

  with vis as (
    select l.*, public.employee_portal_line_kind(l.id) kind
    from public.payroll_competence_lines l
    where l.competence_id = v_comp.id and public.employee_portal_line_visible(l.id)
  )
  select
    coalesce((select jsonb_object_agg(k.kind, k.s) from (select kind, sum(amount)::numeric(12,2) s from vis group by kind) k), '{}'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
        'kind', v.kind, 'type', v.line_type, 'description', v.description,
        'quantity', v.quantity, 'amount', v.amount, 'createdAt', v.created_at
      ) order by v.created_at, v.id) from (select * from vis order by created_at, id limit 500) v), '[]'::jsonb),
    coalesce((select sum(amount) from vis), 0)::numeric(12,2)
  into v_components, v_lines, v_total;

  -- Comissão é sempre componente visível: zero real quando não houver linha.
  if not (v_components ? 'commission') then
    v_components := v_components || jsonb_build_object('commission', 0::numeric(12,2));
  end if;

  return jsonb_build_object(
    'competenceMonth', v_comp.competence_month,
    'status', v_comp.status,
    'version', v_comp.version,
    'components', v_components,
    'total', jsonb_build_object('kind', case when v_comp.status in ('closed', 'paid') then 'closed' else 'expected' end, 'amount', v_total),
    'lines', v_lines
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants: authenticated somente; PUBLIC/anon/service_role sem EXECUTE.
-- ----------------------------------------------------------------------------
revoke all on function public.employee_sales_dashboard_summary(date) from public, anon, authenticated, service_role;
revoke all on function public.list_employee_sales(integer, integer, text, date, date, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_employee_sale_detail(uuid) from public, anon, authenticated, service_role;
revoke all on function public.employee_compensation_summary(integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.list_employee_competence_lines(date) from public, anon, authenticated, service_role;

grant execute on function public.employee_sales_dashboard_summary(date) to authenticated;
grant execute on function public.list_employee_sales(integer, integer, text, date, date, text, text, text) to authenticated;
grant execute on function public.get_employee_sale_detail(uuid) to authenticated;
grant execute on function public.employee_compensation_summary(integer, integer) to authenticated;
grant execute on function public.list_employee_competence_lines(date) to authenticated;

comment on function public.employee_sales_dashboard_summary(date) is '3.1F-J2: leitura do próprio painel (auth.uid). Sem escrita.';
comment on function public.list_employee_sales(integer, integer, text, date, date, text, text, text) is '3.1F-J2: vendas atribuídas ao próprio funcionário. Paginação/allowlist. Sem escrita.';
comment on function public.get_employee_sale_detail(uuid) is '3.1F-J2: detalhe de venda própria; alheia => employee_portal_not_found. Sem escrita.';
comment on function public.employee_compensation_summary(integer, integer) is '3.1F-J2: perfil ativo visível + competências próprias. Oculto => omitido. Sem escrita.';
comment on function public.list_employee_competence_lines(date) is '3.1F-J2: linhas visíveis da competência própria. Sem escrita.';

commit;

-- Sprint 3.1F-J3 — Oportunidade de venda do funcionário (Técnico / Vendedor Externo), ponta a ponta.
--
-- ADITIVA, transacional e reaplicável (CREATE OR REPLACE / IF NOT EXISTS). Sem backfill, sem UPDATE
-- de dados existentes, sem tabela nova, sem policy nova/alterada, sem ALTER TABLE.
-- Nenhuma regra financeira: não cria reward, carteira, saque, entitlement nem regra de comissão;
-- nenhum valor monetário padrão.
--
-- Conteúdo:
--  1. employee_opportunity_normalize_phone(text)   — normalização idêntica a normalizeReferralPhone (TS)
--  2. referrals_phone_norm_idx                     — índice de expressão para a detecção de duplicidade
--  3. employee_opportunity_eligible_roles(uuid)    — papéis elegíveis derivados SOMENTE de vínculos reais
--  4. employee_opportunity_form_context()          — papéis + planos ativos para o formulário (leitura)
--  5. submit_employee_sales_opportunity(jsonb)     — criação atômica (contrato JSON fechado)
--  6. list_employee_sales_filtered(...)            — "Minhas vendas" com filtro de papel e busca
--  7. list_employee_opportunity_origins(uuid[])    — origem/originador para o pipeline Admin/Comercial
--  8. grants mínimos; a RPC H1 (create_employee_sales_opportunity, papel escolhido pelo cliente)
--     deixa de ser executável por authenticated — o único caminho é a RPC J3.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.sales_opportunity_attributions') is null
     or to_regclass('public.financial_security_audit_events') is null
     or to_regclass('public.employee_sector_memberships') is null
     or to_regclass('public.sectors') is null
     or to_regprocedure('public.employee_portal_self()') is null
     or to_regprocedure('public.employee_portal_mask_name(text)') is null
     or to_regprocedure('public.log_financial_security_event(text,uuid,text,jsonb)') is null
     or to_regprocedure('public.is_admin_read_any()') is null
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'public.referrals'::regclass and attname = 'origin_kind' and not attisdropped
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.referrals'::regclass and conname = 'referrals_employee_origin_no_reward_chk'
     )
     or not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.rewards'::regclass and tgname = 'trg_rewards_enforce_financial_eligibility'
     ) then
    raise exception 'j3_prerequisite_missing: aplicar 3.1F-H1/H1B/I1/J2 antes';
  end if;
end$$;

-- ============================================================
-- 1. Normalização de telefone (espelha lib/referral-field-normalize.ts normalizeReferralPhone)
-- ============================================================
create or replace function public.employee_opportunity_normalize_phone(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, pg_temp
as $$
  select case
    when length(x) in (10, 11) then x
    when length(x) > 11 then right(x, 11)
    when length(x) >= 8 then x
    else null
  end
  from (
    select case when left(d, 2) = '55' and length(d) >= 12 then substr(d, 3) else d end as x
    from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) s0
  ) s1;
$$;
comment on function public.employee_opportunity_normalize_phone(text) is
  '3.1F-J3: telefone BR normalizado (somente dígitos, sem +55). Pura; usada no índice de duplicidade.';
-- Função pura e sem acesso a dados: EXECUTE mantido para PUBLIC (avaliação do índice em INSERTs existentes).
grant execute on function public.employee_opportunity_normalize_phone(text) to public;

-- ============================================================
-- 2. Índice de duplicidade por telefone normalizado (aditivo)
-- ============================================================
create index if not exists referrals_phone_norm_idx
  on public.referrals (public.employee_opportunity_normalize_phone(referred_phone));

-- ============================================================
-- 3. Papéis elegíveis — SOMENTE de vínculos reais (setor ativo + vínculo ativo)
--    technician → technician_originator; external_sales → external_sales_originator.
-- ============================================================
create or replace function public.employee_opportunity_eligible_roles(p_employee_id uuid)
returns table (attribution_role text, sector_id uuid, membership_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (r.role) r.role, m.sector_id, m.id
  from public.employee_sector_memberships m
  join public.sectors s on s.id = m.sector_id and s.is_active
  cross join lateral (
    select case s.code
      when 'technician' then 'technician_originator'
      when 'external_sales' then 'external_sales_originator'
    end as role
  ) r
  where m.employee_id = p_employee_id
    and m.is_active
    and r.role is not null
  order by r.role, m.joined_at, m.id;
$$;
revoke all on function public.employee_opportunity_eligible_roles(uuid) from public, anon, authenticated, service_role;

-- ============================================================
-- 4. Contexto do formulário (somente leitura)
-- ============================================================
create or replace function public.employee_opportunity_form_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_self record;
  v_roles jsonb;
  v_plans jsonb;
begin
  -- Mesma política do portal (J2): sessão, papel funcionario, profile ativo, employee legível.
  select * into v_self from public.employee_portal_self();

  select coalesce(jsonb_agg(er.attribution_role order by er.attribution_role), '[]'::jsonb)
    into v_roles
  from public.employee_opportunity_eligible_roles(v_self.employee_id) er;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.sort_order, p.name, p.id), '[]'::jsonb)
    into v_plans
  from public.plans p
  where p.is_active;

  return jsonb_build_object(
    'employeeStatus', v_self.employee_status,
    'canCreate', v_self.employee_status = 'active' and jsonb_array_length(v_roles) > 0,
    'eligibleRoles', v_roles,
    'roleChoiceRequired', jsonb_array_length(v_roles) > 1,
    'plans', v_plans
  );
end;
$$;
revoke all on function public.employee_opportunity_form_context() from public, anon, authenticated, service_role;
grant execute on function public.employee_opportunity_form_context() to authenticated;

-- ============================================================
-- 5. Criação atômica
-- ============================================================
create or replace function public.submit_employee_sales_opportunity(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array[
    'idempotencyKey', 'attributionRole', 'planId', 'name', 'phone', 'document', 'zipcode',
    'street', 'number', 'complement', 'neighborhood', 'city', 'observation', 'consent',
    'confirmRecentDuplicate'
  ];
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_profile_active boolean;
  v_employee_id uuid;
  v_employee_status text;
  v_key text;
  v_attr_role text;
  v_sector_id uuid;
  v_membership_id uuid;
  v_eligible_count int;
  v_plan_id uuid;
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
  v_hash text;
  v_existing_id uuid;
  v_existing_attr public.sales_opportunity_attributions;
  v_dup_open boolean;
  v_dup_recent boolean;
  v_referral_id uuid;
  v_k text;
begin
  -- 1. sessão
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  -- 2-3. profile/employee ativos (antes de ler o payload: quem não é funcionário não recebe validação)
  select p.role, coalesce(p.is_active, true) into v_role, v_profile_active
  from public.profiles p where p.id = v_uid;
  if v_role is distinct from 'funcionario' or v_profile_active is not true then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  select e.id, e.status::text into v_employee_id, v_employee_status
  from public.employees e where e.profile_id = v_uid;
  if v_employee_id is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_employee_status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'employee_not_active');
  end if;

  -- contrato fechado
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  for v_k in select jsonb_object_keys(p_payload) loop
    if not (v_k = any (c_allowed)) then
      return jsonb_build_object('ok', false, 'code', 'unknown_field');
    end if;
  end loop;
  -- tipos: todos os campos textuais são string (ou ausentes/null nos opcionais); booleanos são booleanos
  for v_k in select unnest(array['idempotencyKey','attributionRole','planId','name','phone','document','zipcode',
                                 'street','number','complement','neighborhood','city','observation']) loop
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

  -- 4. normalização + validação (servidor)
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

  if v_name is null or length(v_name) < 3 or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'name');
  end if;
  if v_phone is null or length(v_phone) not in (10, 11) then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'phone');
  end if;
  if v_document is not null and length(v_document) not in (11, 14) then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'document');
  end if;
  if v_zipcode is null or length(v_zipcode) <> 8 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'zipcode');
  end if;
  if v_street is null or length(v_street) > 160 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'street');
  end if;
  if v_number is null or length(v_number) > 20 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'number');
  end if;
  if v_complement is not null and length(v_complement) > 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'complement');
  end if;
  if v_neighborhood is null or length(v_neighborhood) > 100 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'neighborhood');
  end if;
  if v_city is null or length(v_city) > 100 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'city');
  end if;
  if v_observation is not null and length(v_observation) > 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'observation');
  end if;
  if coalesce((p_payload ->> 'consent')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'consent_required');
  end if;
  if coalesce(p_payload ->> 'planId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'planId');
  end if;
  select p.id into v_plan_id from public.plans p where p.id = (p_payload ->> 'planId')::uuid and p.is_active;
  if v_plan_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'planId');
  end if;

  -- 5. papel derivado dos vínculos reais (nunca do cliente sem validação)
  select count(*) into v_eligible_count from public.employee_opportunity_eligible_roles(v_employee_id);
  if v_eligible_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'no_eligible_role');
  end if;
  v_attr_role := nullif(p_payload ->> 'attributionRole', '');
  if v_attr_role is null then
    if v_eligible_count > 1 then
      return jsonb_build_object('ok', false, 'code', 'role_choice_required');
    end if;
    select er.attribution_role, er.sector_id, er.membership_id into v_attr_role, v_sector_id, v_membership_id
    from public.employee_opportunity_eligible_roles(v_employee_id) er;
  else
    select er.sector_id, er.membership_id into v_sector_id, v_membership_id
    from public.employee_opportunity_eligible_roles(v_employee_id) er
    where er.attribution_role = v_attr_role;
    if v_membership_id is null then
      return jsonb_build_object('ok', false, 'code', 'role_not_eligible');
    end if;
  end if;

  -- impressão digital do pedido (dados normalizados; não inclui a confirmação de aviso)
  v_hash := md5(concat_ws('|', v_attr_role, v_plan_id::text, lower(v_name), v_phone, coalesce(v_document, ''),
                          v_zipcode, lower(v_street), lower(v_number), lower(coalesce(v_complement, '')),
                          lower(v_neighborhood), lower(v_city), coalesce(v_observation, '')));

  -- concorrência: serializa por chave de idempotência e por telefone/documento (ordem fixa)
  perform pg_advisory_xact_lock(hashtextextended('igt.j3.idem:' || v_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('igt.j3.phone:' || v_phone, 0));
  if v_document is not null then
    perform pg_advisory_xact_lock(hashtextextended('igt.j3.doc:' || v_document, 0));
  end if;

  -- idempotência: replay devolve o original; mesma chave + outro pedido/funcionário => conflito
  select r.id into v_existing_id from public.referrals r where r.employee_opportunity_idempotency_key = v_key;
  if v_existing_id is not null then
    select * into v_existing_attr from public.sales_opportunity_attributions a
    where a.opportunity_id = v_existing_id and a.employee_id = v_employee_id
    order by a.created_at limit 1;
    if v_existing_attr.id is null or coalesce(v_existing_attr.metadata ->> 'request_hash', '') <> v_hash then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'opportunityId', v_existing_id,
      'protocol', upper(left(replace(v_existing_id::text, '-', ''), 8)),
      'attributionRole', v_existing_attr.attribution_role, 'stage', 'novo'
    );
  end if;
  if exists (select 1 from public.sales_opportunity_attributions a where a.idempotency_key = v_key) then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  -- 6. duplicidade (dentro da transação, depois dos locks); sem fusão automática
  select
    bool_or(r.pipeline_stage::text not in ('ativado', 'perdido') and r.status::text not in ('recusada', 'paga')),
    bool_or(
      not (r.pipeline_stage::text not in ('ativado', 'perdido') and r.status::text not in ('recusada', 'paga'))
      and coalesce(r.lost_at, r.won_at, r.rejected_at, r.moved_to_stage_at, r.updated_at)
          >= timezone('utc', now()) - interval '90 days'
    )
    into v_dup_open, v_dup_recent
  from public.referrals r
  where public.employee_opportunity_normalize_phone(r.referred_phone) = v_phone
     or (v_document is not null and r.referred_document is not null
         and regexp_replace(r.referred_document, '[^0-9]', '', 'g') = v_document);
  if coalesce(v_dup_open, false) then
    return jsonb_build_object('ok', false, 'code', 'duplicate_open');
  end if;
  if coalesce(v_dup_recent, false) and not v_confirm then
    return jsonb_build_object('ok', false, 'code', 'duplicate_recent_closed', 'requiresConfirmation', true);
  end if;

  -- 7-9. oportunidade no MESMO pipeline (referrals), estágio inicial 'novo', sem indicador e sem reward
  perform set_config('igt.employee_opportunity_rpc', 'on', true);
  insert into public.referrals (
    indicator_profile_id, referred_name, referred_phone, referred_email, referred_document,
    referred_person_type, referred_zipcode, referred_street, referred_number, referred_complement,
    referred_neighborhood, referred_city, referred_observation, plan_id,
    reward_type, reward_amount, reward_eligible, source, erp_lead_source, origin_kind,
    created_by_profile_id, employee_opportunity_idempotency_key, status, pipeline_stage
  )
  values (
    null, v_name, v_phone, null, v_document,
    case when length(v_document) = 14 then 'pj' else 'pf' end, v_zipcode, v_street, v_number, v_complement,
    v_neighborhood, v_city, v_observation, v_plan_id,
    null, null, false, 'employee_sales_opportunity', 'Oportunidade Funcionário', 'employee',
    v_uid, v_key, 'pendente', 'novo'
  )
  returning id into v_referral_id;
  perform set_config('igt.employee_opportunity_rpc', '', true);

  -- 8. atribuição imutável do próprio funcionário (append-only, trigger I1)
  insert into public.sales_opportunity_attributions (
    opportunity_id, employee_id, attribution_role, sector_id, membership_id,
    attributed_by, source, metadata, idempotency_key
  )
  values (
    v_referral_id, v_employee_id, v_attr_role, v_sector_id, v_membership_id,
    v_uid, 'employee_opportunity_rpc',
    jsonb_build_object('rpc', 'submit_employee_sales_opportunity', 'request_hash', v_hash),
    v_key
  );

  -- 10. auditoria sanitizada (sem nome, telefone, documento ou endereço)
  perform public.log_financial_security_event(
    'employee_opportunity_created', v_referral_id, 'employee_origin',
    jsonb_build_object('origin_kind', 'employee', 'reward_eligible', false, 'attribution_role', v_attr_role,
                       'rpc', 'submit_employee_sales_opportunity', 'duplicate_warning_confirmed', coalesce(v_dup_recent, false))
  );
  perform public.log_financial_security_event(
    'attribution_created', v_referral_id, v_attr_role,
    jsonb_build_object('attribution_role', v_attr_role)
  );

  -- 11. contrato fechado
  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'opportunityId', v_referral_id,
    'protocol', upper(left(replace(v_referral_id::text, '-', ''), 8)),
    'attributionRole', v_attr_role, 'stage', 'novo'
  );
end;
$$;
revoke all on function public.submit_employee_sales_opportunity(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_employee_sales_opportunity(jsonb) to authenticated;

-- ============================================================
-- 6. Minhas vendas com papel e busca (busca SOMENTE no que o funcionário já vê:
--    referência, nome mascarado e plano). Mesma política/validação do J2.
-- ============================================================
create or replace function public.list_employee_sales_filtered(
  p_limit integer default 20,
  p_offset integer default 0,
  p_sort text default 'created_desc',
  p_from date default null,
  p_to date default null,
  p_stage text default null,
  p_status text default null,
  p_commission text default null,
  p_role text default null,
  p_search text default null
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
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  select * into v_self from public.employee_portal_self();
  if p_limit is null or p_limit < 1 or p_limit > 50
     or p_offset is null or p_offset < 0 or p_offset > 10000
     or p_sort is null or p_sort not in ('created_desc', 'created_asc', 'updated_desc')
     or (p_stage is not null and p_stage not in ('novo', 'tentativa_contato', 'contato_realizado', 'negociacao', 'agendado', 'instalacao', 'ativado', 'perdido'))
     or (p_status is not null and p_status not in ('pendente', 'em_andamento', 'em_atendimento', 'em_negociacao', 'aprovada', 'recusada', 'paga'))
     or (p_commission is not null and p_commission not in ('none', 'pending_evidence', 'accrued', 'approved', 'included_in_payroll', 'paid', 'reversed', 'rejected'))
     or (p_role is not null and p_role not in ('technician_originator', 'external_sales_originator', 'internal_sales_responsible'))
     or (v_search is not null and (length(v_search) < 2 or length(v_search) > 40))
     or (p_from is not null and p_to is not null and p_to < p_from)
     or (p_from is not null and p_from < date '2020-01-01')
     or (p_to is not null and p_to > date '2100-01-01') then
    raise exception 'employee_portal_invalid_parameter' using errcode = '22023';
  end if;

  with base as (
    select r.id, r.created_at, r.updated_at, public.employee_portal_mask_name(r.referred_name) masked,
           pl.name plan_name, r.pipeline_stage::text stage, r.status::text status, a.attribution_role role,
           upper(left(replace(r.id::text, '-', ''), 8)) reference,
           coalesce((
             select e.status from public.employee_commission_entitlements e
             where e.opportunity_id = r.id and e.employee_id = v_self.employee_id
             order by e.created_at desc limit 1), 'none') commission_status
    from public.sales_opportunity_attributions a
    join public.referrals r on r.id = a.opportunity_id
    left join public.plans pl on pl.id = r.plan_id
    where a.employee_id = v_self.employee_id
      and (p_from is null or (r.created_at at time zone 'America/Sao_Paulo')::date >= p_from)
      and (p_to is null or (r.created_at at time zone 'America/Sao_Paulo')::date <= p_to)
      and (p_stage is null or r.pipeline_stage::text = p_stage)
      and (p_status is null or r.status::text = p_status)
      and (p_role is null or a.attribution_role = p_role)
  ), filtered as (
    select * from base
    where (p_commission is null or commission_status = p_commission)
      and (v_search is null
           or position(v_search in lower(concat_ws(' ', reference, masked, plan_name))) > 0)
  ), page as (
    select f.* from filtered f
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
           'reference', p.reference,
           'createdAt', p.created_at,
           'interested', p.masked,
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
revoke all on function public.list_employee_sales_filtered(integer, integer, text, date, date, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.list_employee_sales_filtered(integer, integer, text, date, date, text, text, text, text, text) to authenticated;

-- ============================================================
-- 7. Origem/originador no pipeline (Admin leitura: todas; Comercial: somente os seus leads)
-- ============================================================
create or replace function public.list_employee_opportunity_origins(p_opportunity_ids uuid[])
returns table (opportunity_id uuid, attribution_role text, originator_name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_admin boolean;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_opportunity_ids is null or cardinality(p_opportunity_ids) > 2000 then
    raise exception 'invalid_parameter' using errcode = '22023';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = v_uid and coalesce(p.is_active, true);
  v_admin := v_role in ('admin_master', 'admin_financeiro', 'admin_consulta');
  if not v_admin and v_role is distinct from 'comercial' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select a.opportunity_id, a.attribution_role, coalesce(nullif(btrim(pr.full_name), ''), 'Funcionário')
    from public.sales_opportunity_attributions a
    join public.referrals r on r.id = a.opportunity_id and r.origin_kind = 'employee'
    join public.employees e on e.id = a.employee_id
    left join public.profiles pr on pr.id = e.profile_id
    where a.opportunity_id = any (p_opportunity_ids)
      and a.attribution_role in ('technician_originator', 'external_sales_originator')
      and (v_admin or r.commercial_profile_id = v_uid);
end;
$$;
revoke all on function public.list_employee_opportunity_origins(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.list_employee_opportunity_origins(uuid[]) to authenticated;

-- ============================================================
-- 8. RPC H1 legada: papel/setor escolhidos pelo cliente => sem EXECUTE para clientes.
--    Função preservada (sem DROP); caminho único = submit_employee_sales_opportunity.
-- ============================================================
revoke all on function public.create_employee_sales_opportunity(text, text, uuid, uuid, text, text, text, text) from public, anon, authenticated, service_role;

commit;

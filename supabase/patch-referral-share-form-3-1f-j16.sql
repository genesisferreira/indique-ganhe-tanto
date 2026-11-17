-- 3.1F-J16: nascimento e vencimento no formulário público único.
-- Reutiliza as colunas já existentes. Não cria plano, link nem reward.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
  v_plans jsonb := jsonb_build_array(
    jsonb_build_object('code', 'plan_400_fixed_line', 'name', 'Plano 400 Mega com linha fixa'),
    jsonb_build_object('code', 'corporate_broadband', 'name', 'Banda Larga Corporativa'),
    jsonb_build_object('code', 'business_internet', 'name', 'Internet Empresarial'),
    jsonb_build_object('code', 'mega_500', 'name', '500 Mega'),
    jsonb_build_object('code', 'mega_1000', 'name', '1000 Mega')
  );
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
    'idempotencyKey','planCode','name','phone','document','zipcode','street','number',
    'complement','neighborhood','city','observation','consent','confirmRecentDuplicate',
    'birthDate','preferredInvoiceDueDay'
  ];
  c_forbidden constant text[] := array[
    'origin_kind','originator_id','originatorId','employee_id','employeeId','profile_id','profileId',
    'partner_id','partnerId','attribution_role','attributionRole','reward_eligible','indicator_profile_id','planId'
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
  v_birth text;
  v_birth_date date;
  v_due integer;
  v_confirm boolean;
  v_code text;
  v_offer_name text;
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
  v_sum int;
  v_i int;
  v_dv int;
  v_doc_ok boolean := false;
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
  for v_k in select unnest(array['idempotencyKey','planCode','name','phone','document','zipcode','street','number','complement','neighborhood','city','observation','birthDate']) loop
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
  v_birth := nullif(btrim(coalesce(p_payload ->> 'birthDate', '')), '');
  v_confirm := coalesce((p_payload ->> 'confirmRecentDuplicate')::boolean, false);
  if v_document is not null and v_document !~ '^(\d)\1+$' and length(v_document) = 11 then
    v_sum := 0;
    for v_i in 1..9 loop
      v_sum := v_sum + substr(v_document, v_i, 1)::int * (11 - v_i);
    end loop;
    v_dv := (v_sum * 10) % 11;
    if v_dv = 10 then v_dv := 0; end if;
    if v_dv = substr(v_document, 10, 1)::int then
      v_sum := 0;
      for v_i in 1..10 loop
        v_sum := v_sum + substr(v_document, v_i, 1)::int * (12 - v_i);
      end loop;
      v_dv := (v_sum * 10) % 11;
      if v_dv = 10 then v_dv := 0; end if;
      v_doc_ok := v_dv = substr(v_document, 11, 1)::int;
    end if;
  elsif v_document is not null and v_document !~ '^(\d)\1+$' and length(v_document) = 14 then
    v_sum := 0;
    for v_i in 1..12 loop
      v_sum := v_sum + substr(v_document, v_i, 1)::int * (array[5,4,3,2,9,8,7,6,5,4,3,2])[v_i];
    end loop;
    v_dv := v_sum % 11;
    v_dv := case when v_dv < 2 then 0 else 11 - v_dv end;
    if v_dv = substr(v_document, 13, 1)::int then
      v_sum := 0;
      for v_i in 1..13 loop
        v_sum := v_sum + substr(v_document, v_i, 1)::int * (array[6,5,4,3,2,9,8,7,6,5,4,3,2])[v_i];
      end loop;
      v_dv := v_sum % 11;
      v_dv := case when v_dv < 2 then 0 else 11 - v_dv end;
      v_doc_ok := v_dv = substr(v_document, 14, 1)::int;
    end if;
  end if;
  if v_doc_ok is not true then
    return jsonb_build_object('ok', false, 'code', 'invalid_document');
  end if;
  if jsonb_typeof(p_payload -> 'preferredInvoiceDueDay') is distinct from 'number'
     or (p_payload ->> 'preferredInvoiceDueDay') !~ '^(5|10|15|20|25|30)$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_due_day');
  end if;
  v_due := (p_payload ->> 'preferredInvoiceDueDay')::integer;
  if length(v_document) = 11 or v_birth is not null then
    if v_birth is null or v_birth !~ '^\d{4}-\d{2}-\d{2}$' then
      return jsonb_build_object('ok', false, 'code', 'birth_date_invalid');
    end if;
    begin
      v_birth_date := v_birth::date;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'birth_date_invalid');
    end;
    if to_char(v_birth_date, 'YYYY-MM-DD') is distinct from v_birth then
      return jsonb_build_object('ok', false, 'code', 'birth_date_invalid');
    end if;
    if v_birth_date > (timezone('America/Sao_Paulo', now()))::date then
      return jsonb_build_object('ok', false, 'code', 'birth_date_future');
    end if;
  end if;
  if v_name is null or length(v_name) < 3 or length(v_name) > 120
     or v_phone is null or length(v_phone) not in (10, 11)
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
  v_code := p_payload ->> 'planCode';
  v_offer_name := case v_code
    when 'plan_400_fixed_line' then 'Plano 400 Mega com linha fixa'
    when 'corporate_broadband' then 'Banda Larga Corporativa'
    when 'business_internet' then 'Internet Empresarial'
    when 'mega_500' then '500 Mega'
    when 'mega_1000' then '1000 Mega'
    else null
  end;
  if v_offer_name is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_plan');
  end if;
  if v_code = 'mega_500' then
    select p.id into v_plan from public.plans p
    where p.is_active and lower(btrim(p.name)) = '500 mega'
    order by p.sort_order, p.name limit 1;
  elsif v_code = 'mega_1000' then
    select p.id into v_plan from public.plans p
    where p.is_active and lower(btrim(p.name)) = '1000 mega'
    order by p.sort_order, p.name limit 1;
  else
    select p.id into v_plan from public.plans p
    where p.is_active
    order by p.sort_order, p.name limit 1;
  end if;
  if v_plan is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_plan');
  end if;
  v_hash := md5(concat_ws('|', v_link.id::text, v_code, v_plan::text, lower(v_name), v_phone, v_document,
    v_zipcode, lower(v_street), lower(v_number), lower(coalesce(v_complement, '')), lower(v_neighborhood), lower(v_city), coalesce(v_observation, ''),
    coalesce(v_birth, ''), v_due::text));
  perform pg_advisory_xact_lock(hashtextextended('igt.j11.idem:' || v_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('igt.j11.phone:' || v_phone, 0));
  perform pg_advisory_xact_lock(hashtextextended('igt.j11.doc:' || v_document, 0));
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
     or (r.referred_document is not null and regexp_replace(r.referred_document, '[^0-9]', '', 'g') = v_document);
  if coalesce(v_dup_open, false) then
    select r.id into v_open
    from public.referrals r
    where (
      public.employee_opportunity_normalize_phone(r.referred_phone) = v_phone
      or (r.referred_document is not null and regexp_replace(r.referred_document, '[^0-9]', '', 'g') = v_document)
    )
      and r.pipeline_stage::text not in ('ativado', 'perdido')
      and r.status::text not in ('recusada', 'paga')
    order by r.created_at
    limit 1;
    if v_open is not null then
      insert into public.referral_share_competing_attempts (existing_opportunity_id, attempted_link_id, phone_hash, document_hash)
      values (v_open, v_link.id, public.partner_sha256_hex(v_phone), public.partner_sha256_hex(v_document));
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
      referred_city, referred_observation, referred_birth_date, preferred_invoice_due_day, plan_id, public_offer_code, public_offer_name, reward_type, reward_amount, reward_eligible,
      source, erp_lead_source, origin_kind, status, pipeline_stage
    ) values (
      v_link.originator_id, v_name, v_phone, v_document, case when length(v_document) = 14 then 'pj' else 'pf' end,
      v_zipcode, v_street, v_number, v_complement, v_neighborhood, v_city, v_observation, v_birth_date, v_due, v_plan, v_code, v_offer_name,
      'pix'::public.reward_type, null, true, 'referral_share_link', 'Indique e Ganhe', 'indicator', 'pendente', 'novo'
    ) returning id into v_referral;
  elsif v_link.origin_kind = 'employee' then
    insert into public.referrals (
      indicator_profile_id, referred_name, referred_phone, referred_document, referred_person_type,
      referred_zipcode, referred_street, referred_number, referred_complement, referred_neighborhood,
      referred_city, referred_observation, referred_birth_date, preferred_invoice_due_day, plan_id, public_offer_code, public_offer_name, reward_type, reward_amount, reward_eligible,
      source, erp_lead_source, origin_kind, created_by_profile_id, employee_opportunity_idempotency_key,
      status, pipeline_stage
    ) values (
      null, v_name, v_phone, v_document, case when length(v_document) = 14 then 'pj' else 'pf' end,
      v_zipcode, v_street, v_number, v_complement, v_neighborhood, v_city, v_observation, v_birth_date, v_due, v_plan, v_code, v_offer_name,
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
      referred_city, referred_observation, referred_birth_date, preferred_invoice_due_day, plan_id, public_offer_code, public_offer_name, reward_type, reward_amount, reward_eligible,
      source, erp_lead_source, origin_kind, partner_referral_idempotency_key, partner_public_protocol,
      status, pipeline_stage
    ) values (
      null, v_name, v_phone, v_document, case when length(v_document) = 14 then 'pj' else 'pf' end,
      v_zipcode, v_street, v_number, v_complement, v_neighborhood, v_city, v_observation, v_birth_date, v_due, v_plan, v_code, v_offer_name,
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

commit;

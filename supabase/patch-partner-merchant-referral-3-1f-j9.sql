-- Sprint 3.1F-J9 — Comércios parceiros, ponta a ponta.
-- Aditiva, transacional e reaplicável. Sem backfill, sem UPDATE de dados existentes,
-- sem reward, sem carteira, sem saque, sem entitlement e sem regra ativa criada.
-- Portal de login do parceiro não faz parte desta entrega.
-- Token público: 256 bits, somente o hash é persistido. O token volta uma única vez.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.referrals') is null
     or to_regclass('public.plans') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure('public.employee_opportunity_normalize_phone(text)') is null
     or to_regprocedure('public.referral_is_financially_eligible(public.referrals)') is null
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'public.referrals'::regclass and attname = 'origin_kind' and not attisdropped
     )
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'public.referrals'::regclass and attname = 'brbyte_first_invoice_pk' and not attisdropped
     ) then
    raise exception 'j9_prerequisite_missing: aplicar 3.1F-H1 e 3.1F-J7 antes';
  end if;
  if exists (
    select 1 from public.referrals
    where origin_kind not in (
      'indicator', 'assisted_indicator', 'web_preregistration', 'neutral_network', 'employee', 'legacy'
    )
  ) then
    raise exception 'j9_origin_kind_unknown_existing';
  end if;
end$$;

-- ============================================================
-- 1. Origem partner_merchant (somente adiciona valor ao CHECK)
-- ============================================================
alter table public.referrals drop constraint if exists referrals_origin_kind_chk;
alter table public.referrals
  add constraint referrals_origin_kind_chk
  check (
    origin_kind is not null
    and origin_kind in (
      'indicator',
      'assisted_indicator',
      'web_preregistration',
      'neutral_network',
      'employee',
      'legacy',
      'partner_merchant'
    )
  ) not valid;
alter table public.referrals validate constraint referrals_origin_kind_chk;

alter table public.referrals drop constraint if exists referrals_partner_origin_no_reward_chk;
alter table public.referrals
  add constraint referrals_partner_origin_no_reward_chk
  check (
    origin_kind is distinct from 'partner_merchant'
    or (indicator_profile_id is null and reward_eligible = false)
  );

alter table public.referrals
  add column if not exists partner_referral_idempotency_key text;
alter table public.referrals
  add column if not exists partner_public_protocol text;

create unique index if not exists referrals_partner_idem_uidx
  on public.referrals (partner_referral_idempotency_key)
  where partner_referral_idempotency_key is not null;
create unique index if not exists referrals_partner_protocol_uidx
  on public.referrals (partner_public_protocol)
  where partner_public_protocol is not null;

-- ============================================================
-- 2. Hash e token (pgcrypto já presente em public ou extensions)
-- ============================================================
do $$
declare
  v_digest text;
  v_rand text;
begin
  if to_regprocedure('extensions.digest(bytea,text)') is not null then
    v_digest := 'extensions.digest';
    v_rand := 'extensions.gen_random_bytes';
  elsif to_regprocedure('public.digest(bytea,text)') is not null then
    v_digest := 'public.digest';
    v_rand := 'public.gen_random_bytes';
  else
    create extension if not exists pgcrypto;
    if to_regprocedure('extensions.digest(bytea,text)') is not null then
      v_digest := 'extensions.digest';
      v_rand := 'extensions.gen_random_bytes';
    elsif to_regprocedure('public.digest(bytea,text)') is not null then
      v_digest := 'public.digest';
      v_rand := 'public.gen_random_bytes';
    else
      raise exception 'j9_prerequisite_missing: pgcrypto';
    end if;
  end if;
  execute format($f$
    create or replace function public.partner_sha256_hex(p_text text)
    returns text language sql immutable set search_path = public, pg_temp
    as $b$ select encode(%s(convert_to(coalesce(p_text, ''), 'utf8'), 'sha256'), 'hex') $b$
  $f$, v_digest);
  execute format($f$
    create or replace function public.partner_random_token()
    returns text language sql volatile set search_path = public, pg_temp
    as $b$ select translate(rtrim(encode(%s(32), 'base64'), '='), '+/', '-_') $b$
  $f$, v_rand);
end$$;

revoke all on function public.partner_sha256_hex(text) from public, anon, authenticated, service_role;
revoke all on function public.partner_random_token() from public, anon, authenticated, service_role;

create or replace function public.partner_cnpj_is_valid(p_cnpj text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  d text := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  i int;
  s int;
  w int;
  r int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then
    return false;
  end if;
  s := 0;
  w := 5;
  for i in 1..12 loop
    s := s + substr(d, i, 1)::int * w;
    w := case when w = 2 then 9 else w - 1 end;
  end loop;
  r := s % 11;
  if (case when r < 2 then 0 else 11 - r end) <> substr(d, 13, 1)::int then
    return false;
  end if;
  s := 0;
  w := 6;
  for i in 1..13 loop
    s := s + substr(d, i, 1)::int * w;
    w := case when w = 2 then 9 else w - 1 end;
  end loop;
  r := s % 11;
  return (case when r < 2 then 0 else 11 - r end) = substr(d, 14, 1)::int;
end;
$$;
revoke all on function public.partner_cnpj_is_valid(text) from public, anon, authenticated, service_role;

create or replace function public.partner_admin_capability()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return 'none';
  end if;
  select p.role::text into v_role
  from public.profiles p
  where p.id = auth.uid() and coalesce(p.is_active, true);
  return case v_role
    when 'admin_master' then 'master'
    when 'admin_financeiro' then 'finance'
    when 'comercial' then 'commercial'
    when 'admin_consulta' then 'readonly'
    else 'none'
  end;
end;
$$;
revoke all on function public.partner_admin_capability() from public, anon, authenticated, service_role;
grant execute on function public.partner_admin_capability() to authenticated;

-- ============================================================
-- 3. Tabelas
-- ============================================================
create table if not exists public.partner_merchants (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text not null,
  cnpj text,
  responsible_name text not null,
  phone text not null,
  email text,
  address text,
  status text not null default 'draft',
  public_display_name text not null,
  publish_cnpj boolean not null default false,
  current_status_reason text,
  create_idempotency_key text,
  create_request_hash text,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid,
  activated_at timestamptz,
  activated_by uuid,
  terminated_at timestamptz,
  terminated_by uuid,
  constraint partner_merchants_status_chk check (status in ('draft', 'active', 'paused', 'terminated')),
  constraint partner_merchants_cnpj_fmt_chk check (cnpj is null or cnpj ~ '^[0-9]{14}$'),
  constraint partner_merchants_publish_cnpj_chk check (publish_cnpj = false or cnpj is not null)
);

create unique index if not exists partner_merchants_cnpj_uidx
  on public.partner_merchants (cnpj) where cnpj is not null;
create unique index if not exists partner_merchants_create_idem_uidx
  on public.partner_merchants (create_idempotency_key) where create_idempotency_key is not null;
create index if not exists partner_merchants_status_idx
  on public.partner_merchants (status);

create table if not exists public.partner_merchant_status_events (
  id uuid primary key default gen_random_uuid(),
  partner_merchant_id uuid not null references public.partner_merchants(id) on delete restrict,
  from_status text not null,
  to_status text not null,
  reason text,
  idempotency_key text not null,
  request_hash text not null,
  actor_profile_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  constraint partner_merchant_status_events_idem_uidx unique (idempotency_key)
);
create index if not exists partner_merchant_status_events_partner_idx
  on public.partner_merchant_status_events (partner_merchant_id, created_at desc);

create table if not exists public.partner_merchant_links (
  id uuid primary key default gen_random_uuid(),
  partner_merchant_id uuid not null references public.partner_merchants(id) on delete restrict,
  token_hash text not null,
  status text not null,
  is_primary boolean not null default false,
  campaign_code text,
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  constraint partner_merchant_links_status_chk check (status in ('active', 'revoked')),
  constraint partner_merchant_links_hash_chk check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint partner_merchant_links_idem_uidx unique (idempotency_key),
  constraint partner_merchant_links_hash_uidx unique (token_hash)
);
create unique index if not exists partner_merchant_links_one_primary_uidx
  on public.partner_merchant_links (partner_merchant_id)
  where status = 'active' and is_primary;
create index if not exists partner_merchant_links_hash_status_idx
  on public.partner_merchant_links (token_hash, status);

create table if not exists public.partner_merchant_attributions (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.referrals(id) on delete restrict,
  partner_merchant_id uuid not null references public.partner_merchants(id) on delete restrict,
  link_id uuid not null references public.partner_merchant_links(id) on delete restrict,
  campaign_code text,
  idempotency_key text not null,
  request_hash text not null,
  public_protocol text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint partner_merchant_attributions_opp_uidx unique (opportunity_id),
  constraint partner_merchant_attributions_idem_uidx unique (idempotency_key),
  constraint partner_merchant_attributions_protocol_uidx unique (public_protocol)
);
create index if not exists partner_merchant_attributions_partner_idx
  on public.partner_merchant_attributions (partner_merchant_id, created_at desc);
create index if not exists partner_merchant_attributions_link_idx
  on public.partner_merchant_attributions (link_id);

create table if not exists public.partner_merchant_attribution_corrections (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.referrals(id) on delete restrict,
  previous_partner_merchant_id uuid not null references public.partner_merchants(id) on delete restrict,
  new_partner_merchant_id uuid not null references public.partner_merchants(id) on delete restrict,
  reason text not null,
  idempotency_key text not null,
  actor_profile_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  constraint partner_merchant_attr_corrections_idem_uidx unique (idempotency_key),
  constraint partner_merchant_attr_corrections_distinct_chk check (previous_partner_merchant_id <> new_partner_merchant_id)
);
create index if not exists partner_merchant_attr_corrections_opp_idx
  on public.partner_merchant_attribution_corrections (opportunity_id, created_at desc);

create table if not exists public.partner_merchant_competing_attempts (
  id uuid primary key default gen_random_uuid(),
  existing_opportunity_id uuid not null references public.referrals(id) on delete restrict,
  existing_partner_merchant_id uuid references public.partner_merchants(id) on delete restrict,
  attempted_partner_merchant_id uuid not null references public.partner_merchants(id) on delete restrict,
  attempted_link_id uuid not null references public.partner_merchant_links(id) on delete restrict,
  phone_hash text not null,
  document_hash text,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists partner_merchant_competing_opp_idx
  on public.partner_merchant_competing_attempts (existing_opportunity_id, created_at desc);

create table if not exists public.partner_merchant_rules (
  id uuid primary key default gen_random_uuid(),
  partner_merchant_id uuid not null references public.partner_merchants(id) on delete restrict,
  version integer not null,
  kind text not null,
  trigger_kind text not null,
  status text not null,
  fixed_amount_cents integer,
  percentage_bps integer,
  block_reason text,
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid,
  constraint partner_merchant_rules_kind_chk check (kind in ('fixed_amount', 'first_invoice_value', 'percentage')),
  constraint partner_merchant_rules_status_chk check (status in ('configured', 'blocked')),
  constraint partner_merchant_rules_version_uidx unique (partner_merchant_id, version),
  constraint partner_merchant_rules_idem_uidx unique (idempotency_key),
  constraint partner_merchant_rules_amount_chk check (
    (kind = 'fixed_amount' and status = 'configured' and fixed_amount_cents is not null and fixed_amount_cents > 0 and percentage_bps is null and block_reason is null and trigger_kind = 'invoice_generated')
    or (kind = 'first_invoice_value' and status = 'blocked' and fixed_amount_cents is null and percentage_bps is null and block_reason = 'full_payment_unproven' and trigger_kind = 'first_invoice_paid')
    or (kind = 'percentage' and status = 'blocked' and fixed_amount_cents is null and percentage_bps is not null and percentage_bps between 1 and 10000 and block_reason = 'percentage_base_not_proven' and trigger_kind = 'percentage_base')
  )
);
create index if not exists partner_merchant_rules_partner_idx
  on public.partner_merchant_rules (partner_merchant_id, version desc);

create table if not exists public.partner_commission_entitlements (
  id uuid primary key default gen_random_uuid(),
  partner_merchant_id uuid not null,
  opportunity_id uuid not null,
  rule_id uuid not null,
  trigger_kind text not null,
  evidence_invoice_pk text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint partner_commission_entitlements_natural_uidx unique (
    partner_merchant_id, opportunity_id, rule_id, trigger_kind, evidence_invoice_pk
  )
);
create unique index if not exists partner_commission_entitlements_fixed_once_uidx
  on public.partner_commission_entitlements (partner_merchant_id, opportunity_id, rule_id, trigger_kind)
  where trigger_kind = 'invoice_generated';

comment on table public.partner_commission_entitlements is
  '3.1F-J9: unicidade futura (parceiro, oportunidade, regra, gatilho, fatura). Insert bloqueado nesta entrega. fixed_amount: uma comissão por oportunidade, mesmo com várias faturas.';

create table if not exists public.partner_merchant_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  partner_merchant_id uuid,
  referral_id uuid,
  actor_profile_id uuid,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint partner_merchant_audit_events_type_chk check (event_type in (
    'partner_created', 'partner_updated', 'partner_status_changed', 'partner_link_issued',
    'partner_link_revoked', 'partner_referral_created', 'partner_competing_attempt',
    'partner_attribution_corrected', 'partner_rule_configured', 'partner_activation_withheld'
  )),
  constraint partner_merchant_audit_events_meta_chk check (
    jsonb_typeof(metadata) = 'object'
    and not (metadata ?| array[
      'salary','salario','commission','comissao','commission_amount','amount','valor','fixed_amount_cents',
      'token','access_token','cookie','password','erp_payload','payload',
      'cpf','cnpj','document','phone','telefone','name','nome','email','address','endereco'
    ])
  )
);
create index if not exists partner_merchant_audit_events_created_idx
  on public.partner_merchant_audit_events (created_at desc);

create table if not exists public.partner_public_rate_buckets (
  bucket_key text primary key,
  window_start timestamptz not null,
  hits integer not null,
  constraint partner_public_rate_buckets_hits_chk check (hits >= 0)
);

comment on table public.partner_merchants is
  '3.1F-J9: comércio parceiro. Sem exclusão com histórico. Portal read-only futuro não é exposto agora.';

-- ============================================================
-- 4. Imutabilidade
-- ============================================================
create or replace function public.trg_partner_merchants_no_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'partner_merchant_delete_forbidden' using errcode = 'P0001';
end;
$$;
drop trigger if exists trg_partner_merchants_no_delete on public.partner_merchants;
create trigger trg_partner_merchants_no_delete
before delete on public.partner_merchants
for each row execute function public.trg_partner_merchants_no_delete();

create or replace function public.trg_partner_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'partner_append_only' using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_partner_status_events_append_only on public.partner_merchant_status_events;
create trigger trg_partner_status_events_append_only
before update or delete on public.partner_merchant_status_events
for each row execute function public.trg_partner_append_only();

drop trigger if exists trg_partner_attributions_append_only on public.partner_merchant_attributions;
create trigger trg_partner_attributions_append_only
before update or delete on public.partner_merchant_attributions
for each row execute function public.trg_partner_append_only();

drop trigger if exists trg_partner_corrections_append_only on public.partner_merchant_attribution_corrections;
create trigger trg_partner_corrections_append_only
before update or delete on public.partner_merchant_attribution_corrections
for each row execute function public.trg_partner_append_only();

drop trigger if exists trg_partner_competing_append_only on public.partner_merchant_competing_attempts;
create trigger trg_partner_competing_append_only
before update or delete on public.partner_merchant_competing_attempts
for each row execute function public.trg_partner_append_only();

drop trigger if exists trg_partner_rules_append_only on public.partner_merchant_rules;
create trigger trg_partner_rules_append_only
before update or delete on public.partner_merchant_rules
for each row execute function public.trg_partner_append_only();

drop trigger if exists trg_partner_audit_append_only on public.partner_merchant_audit_events;
create trigger trg_partner_audit_append_only
before update or delete on public.partner_merchant_audit_events
for each row execute function public.trg_partner_append_only();

create or replace function public.trg_partner_links_revoke_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'partner_link_delete_forbidden' using errcode = 'P0001';
  end if;
  if NEW.token_hash is distinct from OLD.token_hash
     or NEW.partner_merchant_id is distinct from OLD.partner_merchant_id
     or NEW.idempotency_key is distinct from OLD.idempotency_key
     or NEW.created_by is distinct from OLD.created_by then
    raise exception 'partner_link_immutable_identity' using errcode = 'P0001';
  end if;
  if OLD.status = 'revoked' or NEW.status is distinct from 'revoked' or OLD.status is distinct from 'active' then
    raise exception 'partner_link_revoke_only' using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_partner_links_revoke_only on public.partner_merchant_links;
create trigger trg_partner_links_revoke_only
before update or delete on public.partner_merchant_links
for each row execute function public.trg_partner_links_revoke_only();

create or replace function public.trg_partner_entitlements_withheld()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'partner_entitlements_withheld_this_release' using errcode = 'P0001';
end;
$$;
drop trigger if exists trg_partner_entitlements_withheld on public.partner_commission_entitlements;
create trigger trg_partner_entitlements_withheld
before insert or update or delete on public.partner_commission_entitlements
for each row execute function public.trg_partner_entitlements_withheld();

create or replace function public.partner_audit(
  p_event text,
  p_partner uuid,
  p_referral uuid,
  p_reason text,
  p_metadata jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.partner_merchant_audit_events (event_type, partner_merchant_id, referral_id, actor_profile_id, reason, metadata)
  values (p_event, p_partner, p_referral, auth.uid(), p_reason, coalesce(p_metadata, '{}'::jsonb));
$$;
revoke all on function public.partner_audit(text, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- ============================================================
-- 5. Origem e reward (superset do H1; employee/web/indicador preservados)
-- ============================================================
create or replace function public.trg_referrals_enforce_origin_kind()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_indicator_role public.user_role;
  v_rpc text := coalesce(current_setting('igt.employee_opportunity_rpc', true), '');
  v_partner text := coalesce(current_setting('igt.partner_merchant_referral_rpc', true), '');
  v_expand_default boolean;
begin
  if TG_OP = 'UPDATE' then
    if NEW.origin_kind is distinct from OLD.origin_kind then
      raise exception 'origin_kind_immutable' using errcode = 'P0001';
    end if;
    if OLD.origin_kind = 'employee' then
      NEW.indicator_profile_id := null;
      NEW.reward_eligible := false;
      return NEW;
    end if;
    if OLD.origin_kind = 'partner_merchant' then
      NEW.indicator_profile_id := null;
      NEW.reward_eligible := false;
      return NEW;
    end if;
    if OLD.origin_kind in ('web_preregistration', 'neutral_network') then
      NEW.reward_eligible := false;
      return NEW;
    end if;
    if OLD.origin_kind in ('indicator', 'assisted_indicator')
       and NEW.reward_eligible is true
       and (NEW.indicator_profile_id is distinct from OLD.indicator_profile_id
            or OLD.reward_eligible is distinct from true) then
      if NEW.indicator_profile_id is null then
        NEW.reward_eligible := false;
        return NEW;
      end if;
      select p.role into v_indicator_role from public.profiles p where p.id = NEW.indicator_profile_id;
      if v_indicator_role = 'funcionario' then
        raise exception 'employee_must_use_employee_opportunity_rpc' using errcode = '42501';
      end if;
      if v_indicator_role is null
         or v_indicator_role::text not in ('indicador', 'comercial', 'admin_master') then
        NEW.reward_eligible := false;
      end if;
    end if;
    return NEW;
  end if;

  if NEW.origin_kind is null then
    raise exception 'origin_kind_required' using errcode = '23502';
  end if;

  if NEW.origin_kind = 'legacy' then
    select exists (
      select 1
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.referrals'::regclass
        and a.attname = 'origin_kind'
        and not a.attisdropped
    ) into v_expand_default;
    if v_expand_default is not true then
      raise exception 'origin_kind_legacy_reserved' using errcode = 'P0001';
    end if;
    if NEW.source = 'employee_sales_opportunity' then
      raise exception 'employee_opportunity_requires_rpc' using errcode = '42501';
    end if;
    if NEW.source = 'partner_merchant_referral' then
      raise exception 'partner_merchant_requires_rpc' using errcode = '42501';
    end if;
    if NEW.indicator_profile_id is not null then
      select p.role into v_indicator_role from public.profiles p where p.id = NEW.indicator_profile_id;
      if v_indicator_role = 'funcionario' then
        raise exception 'employee_must_use_employee_opportunity_rpc' using errcode = '42501';
      end if;
    end if;
    return NEW;
  end if;

  if NEW.origin_kind = 'employee' then
    if v_rpc <> 'on' then
      raise exception 'employee_opportunity_requires_rpc' using errcode = '42501';
    end if;
    if NEW.indicator_profile_id is not null or NEW.reward_eligible is distinct from false then
      raise exception 'employee_origin_cannot_be_reward_eligible' using errcode = 'P0001';
    end if;
    return NEW;
  end if;

  if NEW.origin_kind = 'partner_merchant' then
    if v_partner <> 'on' then
      raise exception 'partner_merchant_requires_rpc' using errcode = '42501';
    end if;
    if NEW.indicator_profile_id is not null or NEW.reward_eligible is distinct from false then
      raise exception 'partner_origin_cannot_be_reward_eligible' using errcode = 'P0001';
    end if;
    if NEW.source is distinct from 'partner_merchant_referral' then
      raise exception 'partner_origin_source_mismatch' using errcode = 'P0001';
    end if;
    NEW.indicator_profile_id := null;
    NEW.reward_eligible := false;
    return NEW;
  end if;

  if NEW.origin_kind in ('web_preregistration', 'neutral_network') then
    NEW.reward_eligible := false;
    return NEW;
  end if;

  if NEW.indicator_profile_id is null then
    NEW.reward_eligible := false;
    return NEW;
  end if;

  select p.role into v_indicator_role from public.profiles p where p.id = NEW.indicator_profile_id;
  if v_indicator_role = 'funcionario' then
    raise exception 'employee_must_use_employee_opportunity_rpc' using errcode = '42501';
  end if;
  if v_indicator_role is null
     or v_indicator_role::text not in ('indicador', 'comercial', 'admin_master') then
    NEW.reward_eligible := false;
  end if;
  return NEW;
end;
$$;
revoke all on function public.trg_referrals_enforce_origin_kind() from public, anon, authenticated, service_role;

create or replace function public.referral_is_financially_eligible(p_ref public.referrals)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select
    p_ref.reward_eligible is true
    and p_ref.origin_kind in ('indicator', 'assisted_indicator', 'legacy')
    and coalesce(p_ref.source, '') not in (
      'public_pre_registration',
      'neutral_network_pre_registration',
      'employee_sales_opportunity',
      'partner_merchant_referral'
    )
    and coalesce(p_ref.erp_lead_source, '') not in (
      'Pré-cadastro Web',
      'Pré-cadastro Rede Neutra',
      'Comércio Parceiro'
    )
    and p_ref.indicator_profile_id is not null;
$$;
comment on function public.referral_is_financially_eligible(public.referrals) is
  'Elegibilidade financeira: origem indicador/legacy. employee, web, neutral e partner_merchant nunca. 3.1F-J9.';
revoke all on function public.referral_is_financially_eligible(public.referrals) from public, anon, authenticated;
grant execute on function public.referral_is_financially_eligible(public.referrals) to service_role;

create or replace function public.trg_rewards_enforce_financial_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ref public.referrals%rowtype;
begin
  if NEW.referral_id is null then
    raise exception 'not_reward_eligible: referral_id ausente' using errcode = 'P0001';
  end if;
  select * into v_ref from public.referrals where id = NEW.referral_id for share;
  if not found then
    raise exception 'not_reward_eligible: indicação não encontrada' using errcode = 'P0001';
  end if;
  if v_ref.origin_kind = 'employee' then
    raise exception 'not_reward_eligible: origem funcionário nunca gera reward' using errcode = 'P0001';
  end if;
  if v_ref.origin_kind = 'partner_merchant' then
    raise exception 'not_reward_eligible: origem comércio parceiro nunca gera reward' using errcode = 'P0001';
  end if;
  if not public.referral_is_financially_eligible(v_ref) then
    raise exception 'not_reward_eligible: referral inelegível para recompensa' using errcode = 'P0001';
  end if;
  NEW.indicator_profile_id := v_ref.indicator_profile_id;
  return NEW;
end;
$$;
revoke all on function public.trg_rewards_enforce_financial_eligibility() from public, anon, authenticated, service_role;

-- ============================================================
-- 6. Rate limit e evidência de fatura gerada (leitura local, sem ERP)
-- ============================================================
create or replace function public.partner_rate_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hits integer;
begin
  if p_key is null or length(p_key) < 4 or length(p_key) > 128 or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.j9.rate:' || p_key, 0));
  insert into public.partner_public_rate_buckets (bucket_key, window_start, hits)
  values (p_key, timezone('utc', now()), 1)
  on conflict (bucket_key) do update
    set hits = case
          when partner_public_rate_buckets.window_start < timezone('utc', now()) - make_interval(secs => p_window_seconds)
            then 1
          else partner_public_rate_buckets.hits + 1
        end,
        window_start = case
          when partner_public_rate_buckets.window_start < timezone('utc', now()) - make_interval(secs => p_window_seconds)
            then timezone('utc', now())
          else partner_public_rate_buckets.window_start
        end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.partner_rate_hit(text, integer, integer) from public, anon, authenticated, service_role;

create or replace function public.partner_invoice_generated_evidence(p_opportunity uuid)
returns table(contract_pk text, invoice_pk text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(rf.brbyte_contract_pk, rf.brbyte_id_contrato) as contract_pk,
         rf.brbyte_first_invoice_pk as invoice_pk
    from public.referrals rf
   where rf.id = p_opportunity
     and rf.origin_kind = 'partner_merchant'
     and coalesce(rf.brbyte_contract_pk, rf.brbyte_id_contrato) ~ '^[0-9]{1,20}$'
     and rf.brbyte_first_invoice_pk ~ '^[0-9]{1,20}$'
     and not (
       coalesce((rf.brbyte_first_invoice_payload -> 'invoice_deleted') = 'true'::jsonb, false)
       or coalesce(rf.brbyte_first_invoice_payload ->> 'invoice_deleted' in ('true', 't', '1'), false)
       or coalesce((rf.brbyte_first_invoice_payload -> 'info' -> 'invoice_deleted') = 'true'::jsonb, false)
       or coalesce((rf.brbyte_first_invoice_payload -> 'info' ->> 'invoice_deleted') in ('true', 't', '1'), false)
       or lower(coalesce(rf.brbyte_first_invoice_payload ->> 'invoice_msg', '')) ~ '(cancel|exclu|delet)'
       or lower(coalesce(rf.brbyte_first_invoice_payload -> 'info' ->> 'invoice_msg', '')) ~ '(cancel|exclu|delet)'
     );
$$;
revoke all on function public.partner_invoice_generated_evidence(uuid) from public, anon, authenticated, service_role;

-- ============================================================
-- 7. Admin: cadastro, status, link, regra, correção, leitura
-- ============================================================
create or replace function public.admin_save_partner_merchant(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array[
    'idempotencyKey','id','legalName','tradeName','cnpj','responsibleName','phone','email',
    'address','publicDisplayName','publishCnpj'
  ];
  v_cap text := public.partner_admin_capability();
  v_k text;
  v_key text;
  v_id uuid;
  v_legal text;
  v_trade text;
  v_cnpj text;
  v_resp text;
  v_phone text;
  v_email text;
  v_address text;
  v_public text;
  v_publish boolean;
  v_hash text;
  v_row public.partner_merchants%rowtype;
  v_constraint text;
begin
  if v_cap = 'none' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_cap is distinct from 'master' then
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
  v_key := p_payload ->> 'idempotencyKey';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  v_legal := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'legalName', '')), '\s+', ' ', 'g'), '');
  v_trade := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'tradeName', '')), '\s+', ' ', 'g'), '');
  v_public := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'publicDisplayName', '')), '\s+', ' ', 'g'), '');
  v_resp := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'responsibleName', '')), '\s+', ' ', 'g'), '');
  v_phone := public.employee_opportunity_normalize_phone(p_payload ->> 'phone');
  v_cnpj := nullif(regexp_replace(coalesce(p_payload ->> 'cnpj', ''), '[^0-9]', '', 'g'), '');
  v_email := nullif(lower(btrim(coalesce(p_payload ->> 'email', ''))), '');
  v_address := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'address', '')), '\s+', ' ', 'g'), '');
  if p_payload ? 'publishCnpj' and jsonb_typeof(p_payload -> 'publishCnpj') <> 'boolean' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'publishCnpj');
  end if;
  v_publish := coalesce((p_payload ->> 'publishCnpj')::boolean, false);
  if v_legal is null or length(v_legal) > 160 or v_trade is null or length(v_trade) > 160
     or v_public is null or length(v_public) > 160 or v_resp is null or length(v_resp) > 160 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'name');
  end if;
  if v_phone is null or length(v_phone) not in (10, 11) then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'phone');
  end if;
  if v_cnpj is not null and not public.partner_cnpj_is_valid(v_cnpj) then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'cnpj');
  end if;
  if v_email is not null and (length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'email');
  end if;
  if v_address is not null and length(v_address) > 240 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'address');
  end if;
  if v_publish and v_cnpj is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'publishCnpj');
  end if;
  v_hash := md5(concat_ws('|', lower(v_legal), lower(v_trade), coalesce(v_cnpj, ''), v_phone, coalesce(v_email, ''), lower(v_public), v_publish::text));
  perform pg_advisory_xact_lock(hashtextextended('igt.j9.merchant:' || v_key, 0));
  if coalesce(p_payload ->> 'id', '') = '' then
    select * into v_row from public.partner_merchants m where m.create_idempotency_key = v_key;
    if v_row.id is not null then
      if v_row.create_request_hash is distinct from v_hash then
        return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
      end if;
      return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_row.id, 'status', v_row.status);
    end if;
    begin
      insert into public.partner_merchants (
        legal_name, trade_name, cnpj, responsible_name, phone, email, address, status,
        public_display_name, publish_cnpj, create_idempotency_key, create_request_hash, created_by, updated_by
      ) values (
        v_legal, v_trade, v_cnpj, v_resp, v_phone, v_email, v_address, 'draft',
        v_public, v_publish, v_key, v_hash, auth.uid(), auth.uid()
      ) returning * into v_row;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'partner_merchants_cnpj_uidx' then
        return jsonb_build_object('ok', false, 'code', 'cnpj_conflict');
      end if;
      raise;
    end;
    perform public.partner_audit('partner_created', v_row.id, null, null, jsonb_build_object('status', 'draft'));
    return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_row.id, 'status', 'draft');
  end if;
  if (p_payload ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'id');
  end if;
  v_id := (p_payload ->> 'id')::uuid;
  update public.partner_merchants set
    legal_name = v_legal,
    trade_name = v_trade,
    cnpj = v_cnpj,
    responsible_name = v_resp,
    phone = v_phone,
    email = v_email,
    address = v_address,
    public_display_name = v_public,
    publish_cnpj = v_publish,
    updated_at = timezone('utc', now()),
    updated_by = auth.uid()
  where id = v_id
  returning * into v_row;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  perform public.partner_audit('partner_updated', v_id, null, null, jsonb_build_object('status', v_row.status));
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_row.id, 'status', v_row.status);
exception when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'partner_merchants_cnpj_uidx' then
    return jsonb_build_object('ok', false, 'code', 'cnpj_conflict');
  end if;
  raise;
end;
$$;

create or replace function public.admin_set_partner_merchant_status(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array['idempotencyKey','id','status','reason'];
  v_cap text := public.partner_admin_capability();
  v_k text;
  v_key text;
  v_id uuid;
  v_status text;
  v_reason text;
  v_hash text;
  v_row public.partner_merchants%rowtype;
  v_event public.partner_merchant_status_events%rowtype;
  v_link uuid;
begin
  if v_cap is distinct from 'master' then
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
  v_key := p_payload ->> 'idempotencyKey';
  v_status := p_payload ->> 'status';
  v_reason := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'reason', '')), '\s+', ' ', 'g'), '');
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if v_status is null or v_status not in ('active', 'paused', 'terminated') then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'status');
  end if;
  if (p_payload ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'id');
  end if;
  if v_status in ('paused', 'terminated') or v_status = 'active' then
    if v_status <> 'active' and (v_reason is null or length(v_reason) < 8 or length(v_reason) > 400) then
      return jsonb_build_object('ok', false, 'code', 'reason_required');
    end if;
  end if;
  v_id := (p_payload ->> 'id')::uuid;
  v_hash := md5(concat_ws('|', v_id::text, v_status, coalesce(v_reason, '')));
  perform pg_advisory_xact_lock(hashtextextended('igt.j9.status:' || v_key, 0));
  select * into v_event from public.partner_merchant_status_events e where e.idempotency_key = v_key;
  if v_event.id is not null then
    if v_event.request_hash is distinct from v_hash then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_event.partner_merchant_id, 'status', v_event.to_status);
  end if;
  select * into v_row from public.partner_merchants where id = v_id for update;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_row.status = v_status then
    return jsonb_build_object('ok', false, 'code', 'invalid_transition');
  end if;
  if v_status = 'active' and v_row.status in ('paused', 'terminated')
     and (v_reason is null or length(v_reason) < 8) then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if v_row.status = 'draft' and v_status = 'active' then
    null;
  elsif v_row.status = 'active' and v_status in ('paused', 'terminated') then
    null;
  elsif v_row.status = 'paused' and v_status in ('active', 'terminated') then
    null;
  elsif v_row.status = 'terminated' and v_status = 'active' then
    null;
  elsif v_row.status = 'draft' and v_status = 'terminated' then
    null;
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_transition');
  end if;
  if v_status = 'terminated' then
    for v_link in
      select l.id from public.partner_merchant_links l
      where l.partner_merchant_id = v_id and l.status = 'active'
    loop
      update public.partner_merchant_links
        set status = 'revoked', is_primary = false, revoked_at = timezone('utc', now()),
            revoked_by = auth.uid(), revoke_reason = coalesce(v_reason, 'encerramento')
      where id = v_link;
    end loop;
  end if;
  update public.partner_merchants set
    status = v_status,
    current_status_reason = v_reason,
    updated_at = timezone('utc', now()),
    updated_by = auth.uid(),
    activated_at = case when v_status = 'active' and activated_at is null then timezone('utc', now()) else activated_at end,
    activated_by = case when v_status = 'active' and activated_by is null then auth.uid() else activated_by end,
    terminated_at = case when v_status = 'terminated' then timezone('utc', now()) else terminated_at end,
    terminated_by = case when v_status = 'terminated' then auth.uid() else terminated_by end
  where id = v_id;
  insert into public.partner_merchant_status_events (
    partner_merchant_id, from_status, to_status, reason, idempotency_key, request_hash, actor_profile_id
  ) values (v_id, v_row.status, v_status, v_reason, v_key, v_hash, auth.uid());
  perform public.partner_audit('partner_status_changed', v_id, null, v_reason, jsonb_build_object('from', v_row.status, 'to', v_status));
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'status', v_status);
end;
$$;

create or replace function public.admin_issue_partner_link(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array['idempotencyKey','partnerId','campaignCode','mode'];
  v_cap text := public.partner_admin_capability();
  v_k text;
  v_key text;
  v_partner uuid;
  v_mode text;
  v_campaign text;
  v_status text;
  v_existing uuid;
  v_token text;
  v_hash text;
  v_link uuid;
  v_prev public.partner_merchant_links%rowtype;
begin
  if v_cap is distinct from 'master' then
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
  v_key := p_payload ->> 'idempotencyKey';
  v_mode := coalesce(p_payload ->> 'mode', 'issue');
  v_campaign := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'campaignCode', '')), '\s+', ' ', 'g'), '');
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if v_mode not in ('issue', 'rotate') then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'mode');
  end if;
  if v_campaign is not null and (length(v_campaign) > 40 or v_campaign !~ '^[A-Za-z0-9_-]+$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'campaignCode');
  end if;
  if (p_payload ->> 'partnerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'partnerId');
  end if;
  v_partner := (p_payload ->> 'partnerId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('igt.j9.link:' || v_partner::text, 0));
  select * into v_prev from public.partner_merchant_links l where l.idempotency_key = v_key;
  if v_prev.id is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'linkId', v_prev.id, 'tokenRevealed', false);
  end if;
  select m.status into v_status from public.partner_merchants m where m.id = v_partner;
  if v_status is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'partner_not_active');
  end if;
  select l.id into v_existing
  from public.partner_merchant_links l
  where l.partner_merchant_id = v_partner and l.status = 'active' and l.is_primary;
  if v_mode = 'issue' and v_existing is not null then
    return jsonb_build_object('ok', false, 'code', 'active_link_exists');
  end if;
  if v_mode = 'rotate' and v_existing is null then
    return jsonb_build_object('ok', false, 'code', 'no_active_link');
  end if;
  if v_existing is not null then
    update public.partner_merchant_links
      set status = 'revoked', is_primary = false, revoked_at = timezone('utc', now()),
          revoked_by = auth.uid(), revoke_reason = 'rotacao'
    where id = v_existing;
    perform public.partner_audit('partner_link_revoked', v_partner, null, 'rotacao', jsonb_build_object('mode', 'rotate'));
  end if;
  v_token := public.partner_random_token();
  if v_token is null or v_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'partner_token_generation_failed' using errcode = 'P0001';
  end if;
  v_hash := public.partner_sha256_hex(v_token);
  insert into public.partner_merchant_links (
    partner_merchant_id, token_hash, status, is_primary, campaign_code, idempotency_key, created_by
  ) values (
    v_partner, v_hash, 'active', true, v_campaign, v_key, auth.uid()
  ) returning id into v_link;
  perform public.partner_audit('partner_link_issued', v_partner, null, null, jsonb_build_object('mode', v_mode));
  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'linkId', v_link, 'tokenRevealed', true,
    'token', v_token, 'url', 'https://crm.tantotelecom.com.br/parceiro/' || v_token
  );
end;
$$;

create or replace function public.admin_revoke_partner_link(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array['idempotencyKey','linkId','reason'];
  v_cap text := public.partner_admin_capability();
  v_k text;
  v_key text;
  v_link uuid;
  v_reason text;
  v_partner uuid;
  v_status text;
begin
  if v_cap is distinct from 'master' then
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
  v_key := p_payload ->> 'idempotencyKey';
  v_reason := nullif(btrim(coalesce(p_payload ->> 'reason', '')), '');
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if v_reason is null or length(v_reason) < 8 or length(v_reason) > 400 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if (p_payload ->> 'linkId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'linkId');
  end if;
  v_link := (p_payload ->> 'linkId')::uuid;
  select l.partner_merchant_id, l.status into v_partner, v_status
  from public.partner_merchant_links l where l.id = v_link for update;
  if v_partner is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_status = 'revoked' then
    return jsonb_build_object('ok', true, 'idempotent', true, 'linkId', v_link);
  end if;
  update public.partner_merchant_links
    set status = 'revoked', is_primary = false, revoked_at = timezone('utc', now()),
        revoked_by = auth.uid(), revoke_reason = v_reason
  where id = v_link;
  perform public.partner_audit('partner_link_revoked', v_partner, null, null, jsonb_build_object('mode', 'revoke'));
  return jsonb_build_object('ok', true, 'idempotent', false, 'linkId', v_link);
end;
$$;

create or replace function public.admin_save_partner_compensation_rule(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array['idempotencyKey','partnerId','kind','fixedAmountCents','percentageBps'];
  v_cap text := public.partner_admin_capability();
  v_k text;
  v_key text;
  v_partner uuid;
  v_kind text;
  v_cents integer;
  v_bps integer;
  v_version integer;
  v_id uuid;
  v_prev public.partner_merchant_rules%rowtype;
begin
  if v_cap not in ('master', 'finance') then
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
  v_key := p_payload ->> 'idempotencyKey';
  v_kind := p_payload ->> 'kind';
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if v_kind not in ('fixed_amount', 'first_invoice_value', 'percentage') then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'kind');
  end if;
  if (p_payload ->> 'partnerId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'partnerId');
  end if;
  v_partner := (p_payload ->> 'partnerId')::uuid;
  if not exists (select 1 from public.partner_merchants m where m.id = v_partner) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_kind = 'fixed_amount' then
    if p_payload -> 'fixedAmountCents' is null or jsonb_typeof(p_payload -> 'fixedAmountCents') <> 'number'
       or (p_payload ->> 'fixedAmountCents') !~ '^[0-9]+$' then
      return jsonb_build_object('ok', false, 'code', 'amount_required');
    end if;
    v_cents := (p_payload ->> 'fixedAmountCents')::integer;
    if v_cents is null or v_cents < 1 or v_cents > 100000000 then
      return jsonb_build_object('ok', false, 'code', 'amount_required');
    end if;
    if p_payload ? 'percentageBps' and p_payload -> 'percentageBps' is not null then
      return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'percentageBps');
    end if;
  elsif v_kind = 'percentage' then
    if p_payload -> 'percentageBps' is null or jsonb_typeof(p_payload -> 'percentageBps') <> 'number'
       or (p_payload ->> 'percentageBps') !~ '^[0-9]+$' then
      return jsonb_build_object('ok', false, 'code', 'percentage_required');
    end if;
    v_bps := (p_payload ->> 'percentageBps')::integer;
    if v_bps is null or v_bps < 1 or v_bps > 10000 then
      return jsonb_build_object('ok', false, 'code', 'percentage_required');
    end if;
    if p_payload ? 'fixedAmountCents' and p_payload -> 'fixedAmountCents' is not null then
      return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'fixedAmountCents');
    end if;
  else
    if (p_payload ? 'fixedAmountCents' and p_payload -> 'fixedAmountCents' is not null)
       or (p_payload ? 'percentageBps' and p_payload -> 'percentageBps' is not null) then
      return jsonb_build_object('ok', false, 'code', 'invalid_payload');
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('igt.j9.rule:' || v_partner::text, 0));
  select * into v_prev from public.partner_merchant_rules r where r.idempotency_key = v_key;
  if v_prev.id is not null then
    if v_prev.kind is distinct from v_kind
       or v_prev.partner_merchant_id is distinct from v_partner
       or v_prev.fixed_amount_cents is distinct from v_cents
       or v_prev.percentage_bps is distinct from v_bps then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'ruleId', v_prev.id, 'status', v_prev.status, 'blockReason', v_prev.block_reason, 'entitlementCreated', false);
  end if;
  select coalesce(max(version), 0) + 1 into v_version
  from public.partner_merchant_rules where partner_merchant_id = v_partner;
  if v_kind = 'fixed_amount' then
    insert into public.partner_merchant_rules (
      partner_merchant_id, version, kind, trigger_kind, status, fixed_amount_cents, idempotency_key, created_by
    ) values (
      v_partner, v_version, 'fixed_amount', 'invoice_generated', 'configured', v_cents, v_key, auth.uid()
    ) returning id into v_id;
    perform public.partner_audit('partner_rule_configured', v_partner, null, null, jsonb_build_object('kind', 'fixed_amount', 'status', 'configured', 'version', v_version));
    return jsonb_build_object('ok', true, 'idempotent', false, 'ruleId', v_id, 'status', 'configured', 'blockReason', null, 'entitlementCreated', false);
  elsif v_kind = 'percentage' then
    insert into public.partner_merchant_rules (
      partner_merchant_id, version, kind, trigger_kind, status, percentage_bps, block_reason, idempotency_key, created_by
    ) values (
      v_partner, v_version, 'percentage', 'percentage_base', 'blocked', v_bps, 'percentage_base_not_proven', v_key, auth.uid()
    ) returning id into v_id;
    perform public.partner_audit('partner_rule_configured', v_partner, null, 'percentage_base_not_proven', jsonb_build_object('kind', 'percentage', 'status', 'blocked', 'version', v_version));
    return jsonb_build_object('ok', true, 'idempotent', false, 'ruleId', v_id, 'status', 'blocked', 'blockReason', 'percentage_base_not_proven', 'entitlementCreated', false);
  else
    insert into public.partner_merchant_rules (
      partner_merchant_id, version, kind, trigger_kind, status, block_reason, idempotency_key, created_by
    ) values (
      v_partner, v_version, 'first_invoice_value', 'first_invoice_paid', 'blocked', 'full_payment_unproven', v_key, auth.uid()
    ) returning id into v_id;
    perform public.partner_audit('partner_rule_configured', v_partner, null, 'full_payment_unproven', jsonb_build_object('kind', 'first_invoice_value', 'status', 'blocked', 'version', v_version));
    return jsonb_build_object('ok', true, 'idempotent', false, 'ruleId', v_id, 'status', 'blocked', 'blockReason', 'full_payment_unproven', 'entitlementCreated', false);
  end if;
end;
$$;

create or replace function public.admin_preview_partner_fixed_activation(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array['partnerId','opportunityId'];
  v_cap text := public.partner_admin_capability();
  v_k text;
  v_partner uuid;
  v_opp uuid;
  v_rule public.partner_merchant_rules%rowtype;
  v_evidence boolean;
begin
  if v_cap not in ('master', 'finance') then
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
  if (p_payload ->> 'partnerId') !~* '^[0-9a-f-]{36}$' or (p_payload ->> 'opportunityId') !~* '^[0-9a-f-]{36}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  v_partner := (p_payload ->> 'partnerId')::uuid;
  v_opp := (p_payload ->> 'opportunityId')::uuid;
  select * into v_rule from public.partner_merchant_rules r
  where r.partner_merchant_id = v_partner
  order by r.version desc limit 1;
  if v_rule.id is null then
    return jsonb_build_object('ok', true, 'supported', false, 'evidence', false, 'entitlementCreated', false, 'code', 'no_rule');
  end if;
  if v_rule.kind = 'percentage' then
    return jsonb_build_object('ok', true, 'supported', false, 'evidence', false, 'entitlementCreated', false, 'code', 'percentage_base_not_proven', 'blockReason', v_rule.block_reason);
  end if;
  if v_rule.kind = 'first_invoice_value' then
    return jsonb_build_object('ok', true, 'supported', false, 'evidence', false, 'entitlementCreated', false, 'code', 'full_payment_unproven', 'blockReason', v_rule.block_reason);
  end if;
  select exists (select 1 from public.partner_invoice_generated_evidence(v_opp)) into v_evidence;
  if not coalesce(v_evidence, false) then
    return jsonb_build_object('ok', true, 'supported', true, 'evidence', false, 'entitlementCreated', false, 'code', 'invoice_generated_unproven');
  end if;
  return jsonb_build_object('ok', true, 'supported', true, 'evidence', true, 'entitlementCreated', false, 'code', 'entitlement_withheld_this_release');
end;
$$;

create or replace function public.admin_correct_partner_attribution(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array['idempotencyKey','opportunityId','newPartnerId','reason'];
  v_cap text := public.partner_admin_capability();
  v_k text;
  v_key text;
  v_opp uuid;
  v_new uuid;
  v_reason text;
  v_attr public.partner_merchant_attributions%rowtype;
  v_effective uuid;
  v_prev public.partner_merchant_attribution_corrections%rowtype;
  v_new_status text;
begin
  if v_cap is distinct from 'master' then
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
  v_key := p_payload ->> 'idempotencyKey';
  v_reason := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'reason', '')), '\s+', ' ', 'g'), '');
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if v_reason is null or length(v_reason) < 8 or length(v_reason) > 400 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if (p_payload ->> 'opportunityId') !~* '^[0-9a-f-]{36}$' or (p_payload ->> 'newPartnerId') !~* '^[0-9a-f-]{36}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  v_opp := (p_payload ->> 'opportunityId')::uuid;
  v_new := (p_payload ->> 'newPartnerId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('igt.j9.correct:' || v_opp::text, 0));
  select * into v_prev from public.partner_merchant_attribution_corrections c where c.idempotency_key = v_key;
  if v_prev.id is not null then
    if v_prev.opportunity_id is distinct from v_opp or v_prev.new_partner_merchant_id is distinct from v_new then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'opportunityId', v_opp);
  end if;
  select * into v_attr from public.partner_merchant_attributions a where a.opportunity_id = v_opp;
  if v_attr.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select m.status into v_new_status from public.partner_merchants m where m.id = v_new;
  if v_new_status is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_new_status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'partner_not_active');
  end if;
  select coalesce(
    (select c.new_partner_merchant_id from public.partner_merchant_attribution_corrections c
      where c.opportunity_id = v_opp order by c.created_at desc, c.id desc limit 1),
    v_attr.partner_merchant_id
  ) into v_effective;
  if v_effective = v_new then
    return jsonb_build_object('ok', false, 'code', 'same_partner');
  end if;
  insert into public.partner_merchant_attribution_corrections (
    opportunity_id, previous_partner_merchant_id, new_partner_merchant_id, reason, idempotency_key, actor_profile_id
  ) values (v_opp, v_effective, v_new, v_reason, v_key, auth.uid());
  perform public.partner_audit('partner_attribution_corrected', v_new, v_opp, null, jsonb_build_object('corrected', true));
  return jsonb_build_object('ok', true, 'idempotent', false, 'opportunityId', v_opp, 'originalPreserved', true);
end;
$$;

create or replace function public.admin_list_partner_merchants()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap text := public.partner_admin_capability();
  v_items jsonb;
begin
  if v_cap = 'none' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'legalName', m.legal_name,
    'tradeName', m.trade_name,
    'publicDisplayName', m.public_display_name,
    'status', m.status,
    'responsibleName', m.responsible_name,
    'hasActiveLink', exists (
      select 1 from public.partner_merchant_links l
      where l.partner_merchant_id = m.id and l.status = 'active' and l.is_primary
    ),
    'referralCount', (
      select count(*) from public.partner_merchant_attributions a where a.partner_merchant_id = m.id
    ),
    'conversionCount', (
      select count(*) from public.partner_merchant_attributions a
      join public.referrals r on r.id = a.opportunity_id
      where a.partner_merchant_id = m.id and r.pipeline_stage::text = 'ativado'
    ),
    'rule', case when v_cap in ('master', 'finance') then (
      select jsonb_build_object(
        'kind', rr.kind, 'status', rr.status, 'blockReason', rr.block_reason,
        'triggerKind', rr.trigger_kind, 'fixedAmountCents', rr.fixed_amount_cents,
        'percentageBps', rr.percentage_bps, 'version', rr.version
      )
      from public.partner_merchant_rules rr
      where rr.partner_merchant_id = m.id
      order by rr.version desc limit 1
    ) else null end
  ) order by m.created_at desc), '[]'::jsonb) into v_items
  from public.partner_merchants m;
  return jsonb_build_object('ok', true, 'capability', v_cap, 'items', v_items);
end;
$$;

create or replace function public.admin_get_partner_merchant(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap text := public.partner_admin_capability();
  v_row public.partner_merchants%rowtype;
  v_link uuid;
  v_campaign text;
  v_rule jsonb;
  v_stages jsonb;
  v_audit jsonb;
begin
  if v_cap = 'none' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into v_row from public.partner_merchants where id = p_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select l.id, l.campaign_code into v_link, v_campaign
  from public.partner_merchant_links l
  where l.partner_merchant_id = p_id and l.status = 'active' and l.is_primary;
  if v_cap in ('master', 'finance') then
    select jsonb_build_object(
      'kind', rr.kind, 'status', rr.status, 'blockReason', rr.block_reason,
      'triggerKind', rr.trigger_kind, 'fixedAmountCents', rr.fixed_amount_cents,
      'percentageBps', rr.percentage_bps, 'version', rr.version
    ) into v_rule
    from public.partner_merchant_rules rr
    where rr.partner_merchant_id = p_id
    order by rr.version desc limit 1;
  end if;
  select coalesce(jsonb_object_agg(s.stage, s.n), '{}'::jsonb) into v_stages
  from (
    select r.pipeline_stage::text as stage, count(*) as n
    from public.partner_merchant_attributions a
    join public.referrals r on r.id = a.opportunity_id
    where a.partner_merchant_id = p_id
    group by r.pipeline_stage::text
  ) s;
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventType', e.event_type, 'createdAt', e.created_at, 'reason', e.reason
  ) order by e.created_at desc), '[]'::jsonb) into v_audit
  from (
    select event_type, created_at, reason
    from public.partner_merchant_audit_events
    where partner_merchant_id = p_id
    order by created_at desc
    limit 20
  ) e;
  return jsonb_build_object(
    'ok', true,
    'capability', v_cap,
    'merchant', jsonb_build_object(
      'id', v_row.id,
      'legalName', v_row.legal_name,
      'tradeName', v_row.trade_name,
      'cnpj', v_row.cnpj,
      'responsibleName', v_row.responsible_name,
      'phone', v_row.phone,
      'email', v_row.email,
      'address', v_row.address,
      'status', v_row.status,
      'statusReason', v_row.current_status_reason,
      'publicDisplayName', v_row.public_display_name,
      'publishCnpj', v_row.publish_cnpj,
      'hasActiveLink', v_link is not null,
      'linkId', case when v_cap = 'master' then v_link else null end,
      'campaignCode', v_campaign,
      'createdAt', v_row.created_at,
      'activatedAt', v_row.activated_at,
      'terminatedAt', v_row.terminated_at
    ),
    'rule', v_rule,
    'byStage', v_stages,
    'referralCount', (select count(*) from public.partner_merchant_attributions a where a.partner_merchant_id = p_id),
    'conversionCount', (
      select count(*) from public.partner_merchant_attributions a
      join public.referrals r on r.id = a.opportunity_id
      where a.partner_merchant_id = p_id and r.pipeline_stage::text = 'ativado'
    ),
    'competingAttempts', (select count(*) from public.partner_merchant_competing_attempts c where c.attempted_partner_merchant_id = p_id or c.existing_partner_merchant_id = p_id),
    'audit', v_audit
  );
end;
$$;

create or replace function public.admin_list_partner_referrals(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cap text := public.partner_admin_capability();
  v_items jsonb;
begin
  if v_cap = 'none' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_id is null or not exists (select 1 from public.partner_merchants m where m.id = p_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'protocol', a.public_protocol,
    'stage', r.pipeline_stage,
    'status', r.status,
    'name', r.referred_name,
    'phone', r.referred_phone,
    'createdAt', a.created_at,
    'publicDisplayName', m.public_display_name
  ) order by a.created_at desc), '[]'::jsonb) into v_items
  from public.partner_merchant_attributions a
  join public.referrals r on r.id = a.opportunity_id
  join public.partner_merchants m on m.id = a.partner_merchant_id
  where a.partner_merchant_id = p_id
    and (v_cap is distinct from 'commercial' or r.commercial_profile_id = auth.uid());
  return jsonb_build_object('ok', true, 'capability', v_cap, 'items', coalesce(v_items, '[]'::jsonb));
end;
$$;

-- ============================================================
-- 8. Formulário público
-- ============================================================
create or replace function public.partner_public_form_context(p_token text, p_client_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_partner uuid;
  v_name text;
  v_cnpj text;
  v_publish boolean;
  v_plans jsonb;
begin
  if p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  if not public.partner_rate_hit('glob', 240, 60) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  if not public.partner_rate_hit('c:' || p_client_key, 20, 600) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  v_hash := public.partner_sha256_hex(coalesce(p_token, ''));
  if not public.partner_rate_hit('t:' || v_hash, 30, 600) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  select m.id, m.public_display_name, case when m.publish_cnpj then m.cnpj else null end, m.publish_cnpj
    into v_partner, v_name, v_cnpj, v_publish
  from public.partner_merchant_links l
  join public.partner_merchants m on m.id = l.partner_merchant_id
  where l.token_hash = v_hash and l.status = 'active' and l.is_primary and m.status = 'active';
  if v_partner is null then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.sort_order, p.name), '[]'::jsonb)
    into v_plans
  from public.plans p
  where p.is_active;
  return jsonb_build_object(
    'ok', true,
    'publicDisplayName', v_name,
    'cnpj', case when v_publish then v_cnpj else null end,
    'plans', v_plans
  );
end;
$$;

create or replace function public.submit_partner_merchant_referral(p_token text, p_client_key text, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array[
    'idempotencyKey','planId','name','phone','document','zipcode','street','number',
    'complement','neighborhood','city','observation','consent','confirmRecentDuplicate'
  ];
  v_k text;
  v_key text;
  v_hash_token text;
  v_partner uuid;
  v_link uuid;
  v_campaign text;
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
  v_plan uuid;
  v_hash text;
  v_existing public.partner_merchant_attributions%rowtype;
  v_dup_open boolean;
  v_dup_recent boolean;
  v_open_id uuid;
  v_open_partner uuid;
  v_referral uuid;
  v_protocol text;
  v_try int;
begin
  if p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  if not public.partner_rate_hit('glob', 240, 60) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  if not public.partner_rate_hit('c:' || p_client_key, 20, 600) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  v_hash_token := public.partner_sha256_hex(coalesce(p_token, ''));
  if not public.partner_rate_hit('t:' || v_hash_token, 30, 600) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited');
  end if;
  select l.id, l.partner_merchant_id, l.campaign_code
    into v_link, v_partner, v_campaign
  from public.partner_merchant_links l
  join public.partner_merchants m on m.id = l.partner_merchant_id
  where l.token_hash = v_hash_token and l.status = 'active' and l.is_primary and m.status = 'active';
  if v_partner is null then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  for v_k in select jsonb_object_keys(p_payload) loop
    if not (v_k = any (c_allowed)) then
      return jsonb_build_object('ok', false, 'code', 'unknown_field');
    end if;
  end loop;
  for v_k in select unnest(array['idempotencyKey','planId','name','phone','document','zipcode','street','number','complement','neighborhood','city','observation']) loop
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
  if v_street is null or length(v_street) > 160 or v_number is null or length(v_number) > 20 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'street');
  end if;
  if v_complement is not null and length(v_complement) > 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'complement');
  end if;
  if v_neighborhood is null or length(v_neighborhood) > 100 or v_city is null or length(v_city) > 100 then
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
  select p.id into v_plan from public.plans p where p.id = (p_payload ->> 'planId')::uuid and p.is_active;
  if v_plan is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload', 'field', 'planId');
  end if;
  v_hash := md5(concat_ws('|', v_partner::text, v_link::text, v_plan::text, lower(v_name), v_phone,
    coalesce(v_document, ''), v_zipcode, lower(v_street), lower(v_number), lower(coalesce(v_complement, '')),
    lower(v_neighborhood), lower(v_city), coalesce(v_observation, '')));
  perform pg_advisory_xact_lock(hashtextextended('igt.j9.idem:' || v_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('igt.j9.phone:' || v_phone, 0));
  if v_document is not null then
    perform pg_advisory_xact_lock(hashtextextended('igt.j9.doc:' || v_document, 0));
  end if;
  select * into v_existing from public.partner_merchant_attributions a where a.idempotency_key = v_key;
  if v_existing.id is not null then
    if v_existing.request_hash is distinct from v_hash or v_existing.partner_merchant_id is distinct from v_partner then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'protocol', v_existing.public_protocol);
  end if;
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
    select r.id into v_open_id
    from public.referrals r
    where (
      public.employee_opportunity_normalize_phone(r.referred_phone) = v_phone
      or (v_document is not null and r.referred_document is not null
          and regexp_replace(r.referred_document, '[^0-9]', '', 'g') = v_document)
    )
      and r.pipeline_stage::text not in ('ativado', 'perdido')
      and r.status::text not in ('recusada', 'paga')
    order by r.created_at
    limit 1;
    select a.partner_merchant_id into v_open_partner
    from public.partner_merchant_attributions a where a.opportunity_id = v_open_id;
    if v_open_id is not null then
      insert into public.partner_merchant_competing_attempts (
        existing_opportunity_id, existing_partner_merchant_id, attempted_partner_merchant_id,
        attempted_link_id, phone_hash, document_hash
      ) values (
        v_open_id, v_open_partner, v_partner, v_link,
        public.partner_sha256_hex(v_phone),
        case when v_document is null then null else public.partner_sha256_hex(v_document) end
      );
      perform public.partner_audit('partner_competing_attempt', v_partner, v_open_id, null, jsonb_build_object('kept_original', true));
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
    exit when not exists (select 1 from public.partner_merchant_attributions a where a.public_protocol = v_protocol);
    if v_try > 5 then
      return jsonb_build_object('ok', false, 'code', 'unavailable');
    end if;
  end loop;
  perform set_config('igt.partner_merchant_referral_rpc', 'on', true);
  insert into public.referrals (
    indicator_profile_id, referred_name, referred_phone, referred_email, referred_document,
    referred_person_type, referred_zipcode, referred_street, referred_number, referred_complement,
    referred_neighborhood, referred_city, referred_observation, plan_id,
    reward_type, reward_amount, reward_eligible, source, erp_lead_source, origin_kind,
    created_by_profile_id, partner_referral_idempotency_key, partner_public_protocol, status, pipeline_stage
  ) values (
    null, v_name, v_phone, null, v_document,
    case when length(v_document) = 14 then 'pj' else 'pf' end, v_zipcode, v_street, v_number, v_complement,
    v_neighborhood, v_city, v_observation, v_plan,
    null, null, false, 'partner_merchant_referral', 'Comércio Parceiro', 'partner_merchant',
    auth.uid(), v_key, v_protocol, 'pendente', 'novo'
  ) returning id into v_referral;
  perform set_config('igt.partner_merchant_referral_rpc', '', true);
  insert into public.partner_merchant_attributions (
    opportunity_id, partner_merchant_id, link_id, campaign_code, idempotency_key, request_hash, public_protocol
  ) values (
    v_referral, v_partner, v_link, v_campaign, v_key, v_hash, v_protocol
  );
  perform public.partner_audit(
    'partner_referral_created', v_partner, v_referral, 'partner_origin',
    jsonb_build_object('origin_kind', 'partner_merchant', 'reward_eligible', false, 'duplicate_warning_confirmed', coalesce(v_dup_recent, false))
  );
  return jsonb_build_object('ok', true, 'idempotent', false, 'protocol', v_protocol);
end;
$$;

create or replace function public.list_partner_opportunity_origins(p_opportunity_ids uuid[])
returns table (opportunity_id uuid, public_display_name text)
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
    select a.opportunity_id,
      coalesce(
        (select m.public_display_name
         from public.partner_merchant_attribution_corrections c
         join public.partner_merchants m on m.id = c.new_partner_merchant_id
         where c.opportunity_id = a.opportunity_id
         order by c.created_at desc, c.id desc
         limit 1),
        m0.public_display_name
      )
    from public.partner_merchant_attributions a
    join public.partner_merchants m0 on m0.id = a.partner_merchant_id
    join public.referrals r on r.id = a.opportunity_id and r.origin_kind = 'partner_merchant'
    where a.opportunity_id = any (p_opportunity_ids)
      and (v_admin or r.commercial_profile_id = v_uid);
end;
$$;

-- ============================================================
-- 9. Grants mínimos e RLS
-- ============================================================
revoke all on function public.admin_save_partner_merchant(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_partner_merchant_status(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_issue_partner_link(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_revoke_partner_link(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_save_partner_compensation_rule(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_preview_partner_fixed_activation(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_correct_partner_attribution(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_partner_merchants() from public, anon, authenticated, service_role;
revoke all on function public.admin_get_partner_merchant(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_partner_referrals(uuid) from public, anon, authenticated, service_role;
revoke all on function public.partner_public_form_context(text, text) from public, anon, authenticated, service_role;
revoke all on function public.submit_partner_merchant_referral(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.list_partner_opportunity_origins(uuid[]) from public, anon, authenticated, service_role;

grant execute on function public.admin_save_partner_merchant(jsonb) to authenticated;
grant execute on function public.admin_set_partner_merchant_status(jsonb) to authenticated;
grant execute on function public.admin_issue_partner_link(jsonb) to authenticated;
grant execute on function public.admin_revoke_partner_link(jsonb) to authenticated;
grant execute on function public.admin_save_partner_compensation_rule(jsonb) to authenticated;
grant execute on function public.admin_preview_partner_fixed_activation(jsonb) to authenticated;
grant execute on function public.admin_correct_partner_attribution(jsonb) to authenticated;
grant execute on function public.admin_list_partner_merchants() to authenticated;
grant execute on function public.admin_get_partner_merchant(uuid) to authenticated;
grant execute on function public.admin_list_partner_referrals(uuid) to authenticated;
grant execute on function public.partner_public_form_context(text, text) to anon, authenticated;
grant execute on function public.submit_partner_merchant_referral(text, text, jsonb) to anon, authenticated;
grant execute on function public.list_partner_opportunity_origins(uuid[]) to authenticated;

alter table public.partner_merchants enable row level security;
alter table public.partner_merchant_status_events enable row level security;
alter table public.partner_merchant_links enable row level security;
alter table public.partner_merchant_attributions enable row level security;
alter table public.partner_merchant_attribution_corrections enable row level security;
alter table public.partner_merchant_competing_attempts enable row level security;
alter table public.partner_merchant_rules enable row level security;
alter table public.partner_commission_entitlements enable row level security;
alter table public.partner_merchant_audit_events enable row level security;
alter table public.partner_public_rate_buckets enable row level security;

revoke all on table public.partner_merchants from public, anon, authenticated, service_role;
revoke all on table public.partner_merchant_status_events from public, anon, authenticated, service_role;
revoke all on table public.partner_merchant_links from public, anon, authenticated, service_role;
revoke all on table public.partner_merchant_attributions from public, anon, authenticated, service_role;
revoke all on table public.partner_merchant_attribution_corrections from public, anon, authenticated, service_role;
revoke all on table public.partner_merchant_competing_attempts from public, anon, authenticated, service_role;
revoke all on table public.partner_merchant_rules from public, anon, authenticated, service_role;
revoke all on table public.partner_commission_entitlements from public, anon, authenticated, service_role;
revoke all on table public.partner_merchant_audit_events from public, anon, authenticated, service_role;
revoke all on table public.partner_public_rate_buckets from public, anon, authenticated, service_role;

grant select on table public.partner_merchants to authenticated;
grant select on table public.partner_merchant_status_events to authenticated;
grant select on table public.partner_merchant_attributions to authenticated;
grant select on table public.partner_merchant_attribution_corrections to authenticated;
grant select on table public.partner_merchant_competing_attempts to authenticated;
grant select on table public.partner_merchant_rules to authenticated;
grant select on table public.partner_merchant_audit_events to authenticated;

drop policy if exists partner_merchants_select on public.partner_merchants;
create policy partner_merchants_select on public.partner_merchants
for select to authenticated
using (public.partner_admin_capability() in ('master', 'finance', 'commercial', 'readonly'));

drop policy if exists partner_status_events_select on public.partner_merchant_status_events;
create policy partner_status_events_select on public.partner_merchant_status_events
for select to authenticated
using (public.partner_admin_capability() in ('master', 'finance', 'readonly'));

drop policy if exists partner_attributions_select on public.partner_merchant_attributions;
create policy partner_attributions_select on public.partner_merchant_attributions
for select to authenticated
using (public.partner_admin_capability() in ('master', 'finance', 'commercial', 'readonly'));

drop policy if exists partner_corrections_select on public.partner_merchant_attribution_corrections;
create policy partner_corrections_select on public.partner_merchant_attribution_corrections
for select to authenticated
using (public.partner_admin_capability() = 'master');

drop policy if exists partner_competing_select on public.partner_merchant_competing_attempts;
create policy partner_competing_select on public.partner_merchant_competing_attempts
for select to authenticated
using (public.partner_admin_capability() in ('master', 'readonly'));

drop policy if exists partner_rules_select on public.partner_merchant_rules;
create policy partner_rules_select on public.partner_merchant_rules
for select to authenticated
using (public.partner_admin_capability() in ('master', 'finance'));

drop policy if exists partner_audit_select on public.partner_merchant_audit_events;
create policy partner_audit_select on public.partner_merchant_audit_events
for select to authenticated
using (public.partner_admin_capability() in ('master', 'finance', 'readonly'));

commit;

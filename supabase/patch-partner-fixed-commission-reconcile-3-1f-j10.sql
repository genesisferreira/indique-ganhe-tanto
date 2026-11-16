-- 3.1F-J10: reconciliação da comissão fixa do comércio parceiro.
-- Não chama ERP, não cria percentual, não cria primeira fatura paga e não grava na carteira.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists public.partner_commission_reconcile_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  partner_id uuid,
  opportunity_id uuid,
  status text not null,
  scanned integer not null default 0,
  accrued integer not null default 0,
  skipped_unproven integer not null default 0,
  skipped_existing integer not null default 0,
  skipped_no_rule integer not null default 0,
  actor_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  constraint partner_commission_reconcile_runs_key_uidx unique (idempotency_key),
  constraint partner_commission_reconcile_runs_status_chk check (status = 'completed')
);

alter table public.partner_commission_reconcile_runs enable row level security;
revoke all on table public.partner_commission_reconcile_runs from public, anon, authenticated, service_role;

alter table public.partner_merchant_audit_events drop constraint if exists partner_merchant_audit_events_type_chk;
alter table public.partner_merchant_audit_events add constraint partner_merchant_audit_events_type_chk check (event_type in (
  'partner_created', 'partner_updated', 'partner_status_changed', 'partner_link_issued',
  'partner_link_revoked', 'partner_referral_created', 'partner_competing_attempt',
  'partner_attribution_corrected', 'partner_rule_configured', 'partner_activation_withheld',
  'partner_entitlement_accrued'
));

create or replace function public.trg_partner_entitlements_withheld()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'partner_entitlement_delete_forbidden' using errcode = 'P0001';
  end if;
  if TG_OP = 'UPDATE' then
    raise exception 'partner_entitlement_append_only' using errcode = 'P0001';
  end if;
  if current_setting('igt.partner_entitlement_reconcile', true) is distinct from 'on' then
    raise exception 'partner_entitlements_withheld_this_release' using errcode = 'P0001';
  end if;
  if NEW.trigger_kind is distinct from 'invoice_generated' then
    raise exception 'partner_entitlement_trigger_blocked' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.partner_commission_entitlements e
    where e.partner_merchant_id = NEW.partner_merchant_id
      and e.opportunity_id = NEW.opportunity_id
      and e.trigger_kind = 'invoice_generated'
  ) then
    raise exception 'partner_entitlement_already_recorded' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from public.partner_invoice_generated_evidence(NEW.opportunity_id) ev
    where ev.invoice_pk = NEW.evidence_invoice_pk
  ) then
    raise exception 'partner_entitlement_evidence_required' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from public.partner_merchant_rules r
    join public.partner_merchant_attributions a
      on a.partner_merchant_id = r.partner_merchant_id
     and a.opportunity_id = NEW.opportunity_id
    join public.referrals rf
      on rf.id = NEW.opportunity_id
     and rf.origin_kind = 'partner_merchant'
     and rf.reward_eligible = false
     and rf.indicator_profile_id is null
    where r.id = NEW.rule_id
      and r.partner_merchant_id = NEW.partner_merchant_id
      and r.kind = 'fixed_amount'
      and r.status = 'configured'
      and r.trigger_kind = 'invoice_generated'
      and r.fixed_amount_cents is not null
  ) then
    raise exception 'partner_entitlement_rule_required' using errcode = 'P0001';
  end if;
  return NEW;
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
  v_exists boolean;
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
  select exists (
    select 1 from public.partner_commission_entitlements e
    where e.partner_merchant_id = v_partner and e.opportunity_id = v_opp and e.trigger_kind = 'invoice_generated'
  ) into v_exists;
  if coalesce(v_exists, false) then
    return jsonb_build_object('ok', true, 'supported', true, 'evidence', coalesce(v_evidence, false), 'entitlementCreated', true, 'code', 'already_recorded');
  end if;
  if not coalesce(v_evidence, false) then
    return jsonb_build_object('ok', true, 'supported', true, 'evidence', false, 'entitlementCreated', false, 'code', 'invoice_generated_unproven');
  end if;
  return jsonb_build_object('ok', true, 'supported', true, 'evidence', true, 'entitlementCreated', false, 'code', 'ready_to_reconcile');
end;
$$;

create or replace function public.admin_reconcile_partner_commissions(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_allowed constant text[] := array['idempotencyKey','partnerId','opportunityId','limit'];
  v_cap text := public.partner_admin_capability();
  v_k text;
  v_key text;
  v_partner uuid;
  v_only uuid;
  v_limit integer := 50;
  v_existing public.partner_commission_reconcile_runs%rowtype;
  v_attr record;
  v_rule public.partner_merchant_rules%rowtype;
  v_invoice text;
  v_n integer := 0;
  v_accrued integer := 0;
  v_skip_unproven integer := 0;
  v_skip_exist integer := 0;
  v_skip_rule integer := 0;
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
  if v_key is null or v_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  end if;
  if p_payload ? 'partnerId' then
    if (p_payload ->> 'partnerId') !~* '^[0-9a-f-]{36}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_payload');
    end if;
    v_partner := (p_payload ->> 'partnerId')::uuid;
    if not exists (select 1 from public.partner_merchants m where m.id = v_partner) then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  end if;
  if p_payload ? 'opportunityId' then
    if (p_payload ->> 'opportunityId') !~* '^[0-9a-f-]{36}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_payload');
    end if;
    v_only := (p_payload ->> 'opportunityId')::uuid;
  end if;
  if p_payload ? 'limit' then
    if jsonb_typeof(p_payload -> 'limit') <> 'number' then
      return jsonb_build_object('ok', false, 'code', 'invalid_payload');
    end if;
    v_limit := (p_payload ->> 'limit')::integer;
    if v_limit < 1 or v_limit > 200 then
      return jsonb_build_object('ok', false, 'code', 'invalid_payload');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('igt.partner.commission.reconcile', 0));
  select * into v_existing from public.partner_commission_reconcile_runs rr where rr.idempotency_key = v_key;
  if v_existing.id is not null then
    if v_existing.partner_id is distinct from v_partner or v_existing.opportunity_id is distinct from v_only then
      return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'scanned', v_existing.scanned, 'accrued', v_existing.accrued,
      'skippedUnproven', v_existing.skipped_unproven, 'skippedExisting', v_existing.skipped_existing,
      'skippedNoRule', v_existing.skipped_no_rule, 'erpRequests', 0
    );
  end if;

  for v_attr in
    select a.partner_merchant_id, a.opportunity_id
    from public.partner_merchant_attributions a
    join public.referrals rf on rf.id = a.opportunity_id
    where rf.origin_kind = 'partner_merchant'
      and (v_partner is null or a.partner_merchant_id = v_partner)
      and (v_only is null or a.opportunity_id = v_only)
    order by a.opportunity_id
    limit v_limit
  loop
    v_n := v_n + 1;
    if exists (
      select 1 from public.partner_commission_entitlements e
      where e.partner_merchant_id = v_attr.partner_merchant_id
        and e.opportunity_id = v_attr.opportunity_id
        and e.trigger_kind = 'invoice_generated'
    ) then
      v_skip_exist := v_skip_exist + 1;
      continue;
    end if;
    select * into v_rule
    from public.partner_merchant_rules r
    where r.partner_merchant_id = v_attr.partner_merchant_id
    order by r.version desc
    limit 1;
    if v_rule.id is null or v_rule.kind is distinct from 'fixed_amount' or v_rule.status is distinct from 'configured' then
      v_skip_rule := v_skip_rule + 1;
      continue;
    end if;
    v_invoice := null;
    select ev.invoice_pk into v_invoice
    from public.partner_invoice_generated_evidence(v_attr.opportunity_id) ev;
    if v_invoice is null then
      v_skip_unproven := v_skip_unproven + 1;
      continue;
    end if;
    perform set_config('igt.partner_entitlement_reconcile', 'on', true);
    insert into public.partner_commission_entitlements (
      partner_merchant_id, opportunity_id, rule_id, trigger_kind, evidence_invoice_pk
    ) values (
      v_attr.partner_merchant_id, v_attr.opportunity_id, v_rule.id, 'invoice_generated', v_invoice
    );
    perform set_config('igt.partner_entitlement_reconcile', 'off', true);
    perform public.partner_audit(
      'partner_entitlement_accrued', v_attr.partner_merchant_id, v_attr.opportunity_id, null,
      jsonb_build_object('kind', 'fixed_amount', 'trigger', 'invoice_generated', 'status', 'accrued')
    );
    v_accrued := v_accrued + 1;
  end loop;

  insert into public.partner_commission_reconcile_runs (
    idempotency_key, partner_id, opportunity_id, status, scanned, accrued,
    skipped_unproven, skipped_existing, skipped_no_rule, actor_id
  ) values (
    v_key, v_partner, v_only, 'completed', v_n, v_accrued,
    v_skip_unproven, v_skip_exist, v_skip_rule, auth.uid()
  );
  return jsonb_build_object(
    'ok', true, 'idempotent', false, 'scanned', v_n, 'accrued', v_accrued,
    'skippedUnproven', v_skip_unproven, 'skippedExisting', v_skip_exist,
    'skippedNoRule', v_skip_rule, 'erpRequests', 0
  );
end;
$$;

revoke all on function public.admin_reconcile_partner_commissions(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_reconcile_partner_commissions(jsonb) to authenticated;

commit;

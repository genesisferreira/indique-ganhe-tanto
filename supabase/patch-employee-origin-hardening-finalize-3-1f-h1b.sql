-- Sprint 3.1F-H1b/H1c - Employee origin hardening (FINALIZE, fail-closed)
--
-- LOCAL ONLY nesta sprint. NÃO aplicar em produção sem release controlado.
-- Ordem obrigatória do release: (1) expand
-- patch-employee-origin-and-rewards-hardening-3-1f-h1.sql -> (2) deploy do código
-- que envia origin_kind explícito -> (3) ESTA finalize.
--
-- Única alteração permitida: remover o DEFAULT 'legacy' de referrals.origin_kind
-- (metadado de coluna). Nenhuma linha é escrita (sem UPDATE/DELETE/INSERT), nada
-- é convertido, updated_at e rewards ficam intactos. Sem CASCADE.
-- Qualquer condição não comprovada => RAISE EXCEPTION 'h1b_finalize_abort:<código>'
-- (rollback total; mensagens só com contagens, nunca IDs/PII).
--
-- GUC OBRIGATÓRIO (enquanto o DEFAULT 'legacy' existir), somente na sessão:
--   select set_config('igt.h1b_expand_started_at', '2026-11-06T14:00:00Z', false);
--   (ou com offset explícito: '2026-11-06T11:00:00-03:00')
-- Formato: ISO 8601 'YYYY-MM-DDTHH:MI[:SS[.ffffff]]' + 'Z' ou '+HH:MM'/'-HH:MM'.
-- Sem fuso explícito, vazio, ausente, 'now', só data => abort. O fuso da sessão
-- nunca é usado nem alterado. Limites: não pode estar mais de 10 minutos no
-- futuro (tolerância de relógio) nem antes de 2026-11-01T00:00:00Z (início da
-- sprint 3.1F-H1; qualquer valor anterior é absurdo para esta expand).
-- O valor não é gravado em tabela. created_at é timestamptz; a comparação é
-- absoluta (independe do fuso da sessão da finalize).
--
-- Reaplicação: se o DEFAULT já foi removido e a estrutura final está correta,
-- termina como no-op SEM exigir o GUC. Estrutura divergente => abort. O DEFAULT
-- nunca é recolocado.
--
-- Ordem das validações:
--  1. tabela/coluna   2. GUC   3. dados/invariantes   4. legacy da janela por papel
--  5. tipo exato      6. NOT NULL   7. CHECKs (semântica)   8. trigger (função/eventos)
--  9. default esperado   10. DROP DEFAULT   11. revalidação pós-alteração   12. commit

begin;

do $finalize$
declare
  c_expected_origin_chk constant text :=
    '((origin_kind IS NOT NULL) AND (origin_kind = ANY (ARRAY[''indicator''::text, ''assisted_indicator''::text, ''web_preregistration''::text, ''neutral_network''::text, ''employee''::text, ''legacy''::text])))';
  c_expected_employee_chk constant text :=
    '((origin_kind IS DISTINCT FROM ''employee''::text) OR ((indicator_profile_id IS NULL) AND (reward_eligible = false)))';
  -- tgtype: ROW(1) | BEFORE(2) | INSERT(4) | UPDATE(16) = 23 (sem DELETE 8, TRUNCATE 32, INSTEAD 64)
  c_expected_tgtype constant int := 23;
  c_guc_lower_bound constant timestamptz := '2026-11-01T00:00:00Z';
  c_guc_future_tolerance constant interval := interval '10 minutes';
  c_guc_regex constant text :=
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$';

  v_rel oid;
  v_att record;
  v_default text;
  v_has_default boolean;
  v_guc_raw text;
  v_started timestamptz;
  v_n bigint;
  v_w record;
  v_c record;
  v_t record;
  v_pass int;
  v_expected_func oid;
begin
  -- ---------- 1. tabela e coluna ----------
  v_rel := to_regclass('public.referrals');
  if v_rel is null then
    raise exception 'h1b_finalize_abort:table_missing';
  end if;
  select a.attnum, a.atttypid, a.attndims, a.attnotnull, a.attgenerated, a.attidentity, a.atthasdef
    into v_att
  from pg_catalog.pg_attribute a
  where a.attrelid = v_rel and a.attname = 'origin_kind' and not a.attisdropped;
  if not found then
    raise exception 'h1b_finalize_abort:column_missing';
  end if;
  -- guarda mínima: coluna array não é comparável com os predicados de dados do
  -- passo 3; aborta já aqui com o mesmo código do passo 5 (tipo exato).
  if v_att.attndims <> 0
     or exists (select 1 from pg_catalog.pg_type ty where ty.oid = v_att.atttypid and ty.typcategory = 'A') then
    raise exception 'h1b_finalize_abort:column_type_not_text';
  end if;

  select pg_catalog.pg_get_expr(d.adbin, d.adrelid) into v_default
  from pg_catalog.pg_attrdef d
  where d.adrelid = v_rel and d.adnum = v_att.attnum;
  v_has_default := v_default is not null;

  -- ---------- 2. GUC obrigatório (somente enquanto o default existir) ----------
  if v_has_default then
    v_guc_raw := current_setting('igt.h1b_expand_started_at', true);
    if v_guc_raw is null or btrim(v_guc_raw) = '' then
      raise exception 'h1b_finalize_abort:guc_missing';
    end if;
    if v_guc_raw !~ c_guc_regex then
      raise exception 'h1b_finalize_abort:guc_format_requires_iso8601_with_explicit_offset';
    end if;
    begin
      v_started := v_guc_raw::timestamptz;  -- offset explícito: fuso da sessão não interfere
    exception when others then
      raise exception 'h1b_finalize_abort:guc_unparseable';
    end;
    if v_started > clock_timestamp() + c_guc_future_tolerance then
      raise exception 'h1b_finalize_abort:guc_in_future';
    end if;
    if v_started < c_guc_lower_bound then
      raise exception 'h1b_finalize_abort:guc_before_lower_bound';
    end if;
  end if;

  -- ---------- 3. dados / invariantes (somente contagens) ----------
  select count(*) into v_n from public.referrals where origin_kind is null;
  if v_n > 0 then raise exception 'h1b_finalize_abort:data_null_origin count=%', v_n; end if;

  select count(*) into v_n from public.referrals
  where origin_kind not in ('indicator','assisted_indicator','web_preregistration','neutral_network','employee','legacy');
  if v_n > 0 then raise exception 'h1b_finalize_abort:data_invalid_origin count=%', v_n; end if;

  select count(*) into v_n from public.referrals where origin_kind = 'employee' and indicator_profile_id is not null;
  if v_n > 0 then raise exception 'h1b_finalize_abort:data_employee_with_indicator count=%', v_n; end if;

  select count(*) into v_n from public.referrals where origin_kind = 'employee' and reward_eligible is distinct from false;
  if v_n > 0 then raise exception 'h1b_finalize_abort:data_employee_reward_eligible count=%', v_n; end if;

  select count(*) into v_n from public.rewards rw join public.referrals rf on rf.id = rw.referral_id
  where rf.origin_kind = 'employee';
  if v_n > 0 then raise exception 'h1b_finalize_abort:data_employee_has_reward count=%', v_n; end if;

  -- contrato H1: oportunidade employee nasce com attribution (RPC atômica) e
  -- attribution só pode apontar para origem employee (trigger guard).
  select count(*) into v_n from public.referrals rf
  where rf.origin_kind = 'employee'
    and not exists (select 1 from public.sales_opportunity_attributions a where a.opportunity_id = rf.id);
  if v_n > 0 then raise exception 'h1b_finalize_abort:data_employee_missing_attribution count=%', v_n; end if;

  select count(*) into v_n from public.sales_opportunity_attributions a
  join public.referrals rf on rf.id = a.opportunity_id
  where rf.origin_kind is distinct from 'employee';
  if v_n > 0 then raise exception 'h1b_finalize_abort:data_attribution_on_non_employee count=%', v_n; end if;

  -- combinações impossíveis no H1: web/neutral elegível ou com reward;
  -- indicator/assisted sem indicador e elegível.
  select count(*) into v_n from public.referrals
  where origin_kind in ('web_preregistration','neutral_network') and reward_eligible is distinct from false;
  if v_n > 0 then raise exception 'h1b_finalize_abort:data_non_reward_origin_eligible count=%', v_n; end if;

  select count(*) into v_n from public.rewards rw join public.referrals rf on rf.id = rw.referral_id
  where rf.origin_kind in ('web_preregistration','neutral_network');
  if v_n > 0 then raise exception 'h1b_finalize_abort:data_non_reward_origin_has_reward count=%', v_n; end if;

  select count(*) into v_n from public.referrals
  where origin_kind in ('indicator','assisted_indicator') and indicator_profile_id is null and reward_eligible is true;
  if v_n > 0 then raise exception 'h1b_finalize_abort:data_indicator_origin_without_indicator_eligible count=%', v_n; end if;

  -- ---------- 4. legacy criado na janela, por categoria de papel ----------
  if v_has_default then
    select
      count(*) filter (where cat = 'indicator_role_indicador') as indicador,
      count(*) filter (where cat = 'indicator_role_comercial') as comercial,
      count(*) filter (where cat = 'indicator_role_admin_master') as admin_master,
      count(*) filter (where cat = 'no_indicator_ineligible') as no_ind_inelig,
      count(*) filter (where cat = 'admin_financeiro') as admin_financeiro,
      count(*) filter (where cat = 'funcionario') as funcionario,
      count(*) filter (where cat = 'other_role') as other_role,
      count(*) filter (where cat = 'missing_role_with_indicator') as missing_role,
      count(*) filter (where cat = 'no_indicator_but_eligible') as no_ind_elig,
      count(*) filter (where cat = 'inconsistent') as inconsistent
    into v_w
    from (
      select case
        when rf.indicator_profile_id is not null
             and coalesce(rf.source, '') in ('public_pre_registration','neutral_network_pre_registration','employee_sales_opportunity')
          then 'inconsistent'
        when rf.indicator_profile_id is null and coalesce(rf.source, '') = 'employee_sales_opportunity'
          then 'inconsistent'
        when rf.indicator_profile_id is null and rf.reward_eligible is false then 'no_indicator_ineligible'
        when rf.indicator_profile_id is null then 'no_indicator_but_eligible'
        when p.role is null then 'missing_role_with_indicator'
        when p.role::text = 'indicador' then 'indicator_role_indicador'
        when p.role::text = 'comercial' then 'indicator_role_comercial'
        when p.role::text = 'admin_master' then 'indicator_role_admin_master'
        when p.role::text = 'admin_financeiro' then 'admin_financeiro'
        when p.role::text = 'funcionario' then 'funcionario'
        else 'other_role'
      end as cat
      from public.referrals rf
      left join public.profiles p on p.id = rf.indicator_profile_id
      where rf.origin_kind = 'legacy' and rf.created_at >= v_started
    ) q;

    raise notice 'h1b_finalize_report window_legacy indicator_role_indicador=% indicator_role_comercial=% indicator_role_admin_master=% no_indicator_ineligible=% admin_financeiro=% funcionario=% other_role=% missing_role_with_indicator=% no_indicator_but_eligible=% inconsistent=%',
      v_w.indicador, v_w.comercial, v_w.admin_master, v_w.no_ind_inelig, v_w.admin_financeiro,
      v_w.funcionario, v_w.other_role, v_w.missing_role, v_w.no_ind_elig, v_w.inconsistent;

    if v_w.admin_financeiro + v_w.funcionario + v_w.other_role + v_w.missing_role + v_w.no_ind_elig + v_w.inconsistent > 0 then
      raise exception 'h1b_finalize_abort:window_unexpected_legacy admin_financeiro=% funcionario=% other_role=% missing_role_with_indicator=% no_indicator_but_eligible=% inconsistent=%',
        v_w.admin_financeiro, v_w.funcionario, v_w.other_role, v_w.missing_role, v_w.no_ind_elig, v_w.inconsistent;
    end if;
  end if;

  v_expected_func := to_regprocedure('public.trg_referrals_enforce_origin_kind()');

  -- passes: 1 = antes do DROP DEFAULT; 2 = revalidação pós-alteração
  for v_pass in 1..2 loop
    select a.attnum, a.atttypid, a.attndims, a.attnotnull, a.attgenerated, a.attidentity, a.atthasdef
      into v_att
    from pg_catalog.pg_attribute a
    where a.attrelid = v_rel and a.attname = 'origin_kind' and not a.attisdropped;

    -- ---------- 5. tipo exato ----------
    if v_att.atttypid <> 'pg_catalog.text'::regtype or v_att.attndims <> 0 then
      raise exception 'h1b_finalize_abort:column_type_not_text';
    end if;
    if v_att.attgenerated <> '' or v_att.attidentity <> '' then
      raise exception 'h1b_finalize_abort:column_generated_or_identity';
    end if;

    -- ---------- 6. NOT NULL ----------
    if v_att.attnotnull is not true then
      raise exception 'h1b_finalize_abort:column_not_null_missing';
    end if;

    -- ---------- 7. CHECKs (definição semântica, não só o nome) ----------
    for v_c in
      select x.name, x.expected, x.cols,
             (select count(*) from pg_catalog.pg_constraint k where k.conrelid = v_rel and k.conname = x.name) as n,
             (select k.contype from pg_catalog.pg_constraint k where k.conrelid = v_rel and k.conname = x.name limit 1) as contype,
             (select k.convalidated from pg_catalog.pg_constraint k where k.conrelid = v_rel and k.conname = x.name limit 1) as validated,
             (select regexp_replace(pg_catalog.pg_get_expr(k.conbin, k.conrelid), '\s+', ' ', 'g')
                from pg_catalog.pg_constraint k where k.conrelid = v_rel and k.conname = x.name limit 1) as actual,
             (select array(select a2.attname::text from pg_catalog.pg_attribute a2
                           where a2.attrelid = v_rel and a2.attnum = any(k.conkey) order by a2.attname)
                from pg_catalog.pg_constraint k where k.conrelid = v_rel and k.conname = x.name limit 1) as actual_cols
      from (values
        ('referrals_origin_kind_chk', c_expected_origin_chk, array['origin_kind']),
        ('referrals_employee_origin_no_reward_chk', c_expected_employee_chk, array['indicator_profile_id','origin_kind','reward_eligible'])
      ) as x(name, expected, cols)
    loop
      if v_c.n <> 1 then
        raise exception 'h1b_finalize_abort:check_missing name=%', v_c.name;
      end if;
      if v_c.contype <> 'c' then
        raise exception 'h1b_finalize_abort:check_wrong_type name=%', v_c.name;
      end if;
      if v_c.validated is not true then
        raise exception 'h1b_finalize_abort:check_not_validated name=%', v_c.name;
      end if;
      if v_c.actual_cols is distinct from v_c.cols then
        raise exception 'h1b_finalize_abort:check_wrong_columns name=%', v_c.name;
      end if;
      if v_c.actual is distinct from regexp_replace(v_c.expected, '\s+', ' ', 'g') then
        raise exception 'h1b_finalize_abort:check_definition_mismatch name=%', v_c.name;
      end if;
    end loop;

    -- ---------- 8. trigger de origem (função, schema, nível, timing, eventos) ----------
    select count(*) into v_n from pg_catalog.pg_trigger
    where tgrelid = v_rel and tgname = 'trg_referrals_enforce_origin_kind' and not tgisinternal;
    if v_n <> 1 then
      raise exception 'h1b_finalize_abort:trigger_missing';
    end if;
    select t.tgenabled, t.tgtype::int as tgtype, t.tgfoid, t.tgnargs, t.tgattr::text as tgattr,
           t.tgqual is null as no_when, p.proname, n.nspname, p.pronargs, p.prorettype
      into v_t
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = v_rel and t.tgname = 'trg_referrals_enforce_origin_kind' and not t.tgisinternal;
    if v_t.tgenabled <> 'O' then
      raise exception 'h1b_finalize_abort:trigger_not_enabled';
    end if;
    if v_expected_func is null or v_t.tgfoid <> v_expected_func
       or v_t.proname <> 'trg_referrals_enforce_origin_kind' or v_t.nspname <> 'public'
       or v_t.pronargs <> 0 or v_t.prorettype <> 'pg_catalog.trigger'::regtype then
      raise exception 'h1b_finalize_abort:trigger_wrong_function';
    end if;
    if (v_t.tgtype & 1) = 0 then
      raise exception 'h1b_finalize_abort:trigger_not_row_level';
    end if;
    if (v_t.tgtype & 2) = 0 or (v_t.tgtype & 64) <> 0 then
      raise exception 'h1b_finalize_abort:trigger_not_before';
    end if;
    if v_t.tgtype <> c_expected_tgtype then
      raise exception 'h1b_finalize_abort:trigger_wrong_events';
    end if;
    if v_t.tgnargs <> 0 or coalesce(v_t.tgattr, '') <> '' or v_t.no_when is not true then
      raise exception 'h1b_finalize_abort:trigger_unexpected_args_columns_or_when';
    end if;

    if v_pass = 1 then
      -- ---------- 9. default esperado ----------
      if v_has_default then
        if v_default <> '''legacy''::text' then
          raise exception 'h1b_finalize_abort:unexpected_default';
        end if;
        -- ---------- 10. remoção do default (único metadado alterado) ----------
        execute 'alter table public.referrals alter column origin_kind drop default';
      else
        raise notice 'h1b_finalize_report default_already_removed=true structure_ok=true (no-op)';
      end if;
    else
      -- ---------- 11. revalidação pós-alteração ----------
      if exists (select 1 from pg_catalog.pg_attrdef d where d.adrelid = v_rel and d.adnum = v_att.attnum) then
        raise exception 'h1b_finalize_abort:post_default_still_present';
      end if;
      select count(*) into v_n from public.referrals where origin_kind is null;
      if v_n > 0 then raise exception 'h1b_finalize_abort:post_null_origin count=%', v_n; end if;
    end if;
  end loop;

  raise notice 'h1b_finalize_report ok default_removed=true';
end;
$finalize$;

-- ---------- 12. commit ----------
commit;
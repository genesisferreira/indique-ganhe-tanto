// 3.1F-H1c finalize fail-closed lab (127.0.0.1 only; no remote, no probe, no ERP).
// Every finalize abort is exercised individually inside a rolled-back transaction,
// and every run (abort, success, reapply) is checked for zero row writes
// (xmin/ctid/updated_at/business columns, rewards, attributions, audit, relfilenode).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { startCollectionsLab, stopCollectionsLab, REPO_ROOT } from "./local-pg-collections-lab/run.mjs"

const PRE = [
  "patch-referral-interested-fields", "patch-public-pre-registration", "patch-pre-registration-pj-neutral-network",
  "patch-commercial-assisted-referral-foundation", "patch-assisted-indicator-account-foundation",
  "patch-notifications-referral-events", "patch-notifications-indicator-events", "patch-brbyte-sync-infrastructure",
  "patch-first-invoice-reward-from-controllr-amount", "patch-financial-reward-eligibility-hardening",
].map(f => `supabase/${f}.sql`)
const EXPAND = readFileSync(join(REPO_ROOT, "supabase/patch-employee-origin-and-rewards-hardening-3-1f-h1.sql"), "utf8")
const FINALIZE = readFileSync(join(REPO_ROOT, "supabase/patch-employee-origin-hardening-finalize-3-1f-h1b.sql"), "utf8")
const BODY = FINALIZE.replace(/^\s*begin;\s*$/m, "").replace(/^\s*commit;\s*$/m, "")
const iso = (d) => d.toISOString()

const out = []; let ok = true
const t = async (name, fn) => { try { const v = await fn(); const pass = v === true; out.push([name, pass ? "PASS" : "FAIL " + JSON.stringify(v)]); if (!pass) ok = false } catch (e) { out.push([name, "FAIL " + e.message]); ok = false } }
const { client: c, conn, Client } = await startCollectionsLab()
// Escritores em produção (PostgREST/Supabase) usam TimeZone=UTC; default de
// created_at é timezone('utc', now()) em coluna timestamptz. O lab espelha isso.
await c.query("set timezone='UTC'")
const q = async (sql, p = []) => (await c.query(sql, p)).rows
const asUser = async (uid, sql, p = []) => { await c.query("begin"); try { await c.query("set local role authenticated"); await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]); const r = await c.query(sql, p); await c.query("commit"); return r.rows } catch (e) { await c.query("rollback"); throw e } }

const snapshot = async () => JSON.stringify({
  ref: (await q(`select id, xmin::text x, ctid::text t, updated_at, to_jsonb(r) j from public.referrals r order by id`)),
  rew: (await q(`select id, xmin::text x, ctid::text t, to_jsonb(r) j from public.rewards r order by id`)),
  att: (await q(`select id, xmin::text x, ctid::text t, to_jsonb(a) j from public.sales_opportunity_attributions a order by id`)),
  aud: (await q(`select count(*)::int n, coalesce(max(xmin::text),'') x from public.financial_security_audit_events`)),
  files: (await q(`select pg_relation_filenode('public.referrals')::text r, pg_relation_filenode('public.rewards')::text w, pg_relation_filenode('public.sales_opportunity_attributions')::text a`)),
})
const rowsOnly = (s) => { const o = JSON.parse(s); return JSON.stringify({ ref: o.ref, rew: o.rew, att: o.att, aud: o.aud, files: o.files }) }

try {
  for (const f of PRE) await c.query(readFileSync(join(REPO_ROOT, f), "utf8"))
  await c.query("grant all on all tables in schema public to anon, authenticated; grant all on all functions in schema public to anon, authenticated, public")
  const P = { ind: "66666666-0000-0000-0000-000000000001", com: "66666666-0000-0000-0000-000000000002", adm: "66666666-0000-0000-0000-000000000003", fin: "66666666-0000-0000-0000-000000000004", emp: "66666666-0000-0000-0000-000000000005", con: "66666666-0000-0000-0000-000000000006" }
  await q(`insert into public.profiles(id,email,role) values ($1,'i@x','indicador'),($2,'c@x','comercial'),($3,'a@x','admin_master'),($4,'f@x','admin_financeiro'),($5,'e@x','funcionario'),($6,'k@x','admin_consulta')`, Object.values(P))
  const plan = (await q(`select id from public.plans limit 1`))[0]?.id ?? (await q(`insert into public.plans(name, speed_label, price, reward_amount) values ('p','1M',1,30) returning id`))[0].id
  const sector = (await q(`select id from public.sectors limit 1`))[0].id
  const empId = (await q(`insert into public.employees(profile_id,status) values ($1,'active') returning id`, [P.emp]))[0].id
  await q(`insert into public.employee_sector_memberships(employee_id,sector_id) values ($1,$2)`, [empId, sector])
  // historical rows (pre-expand), some with rewards
  await q(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source,erp_lead_source,created_at,updated_at)
    select case when g%4=0 then null when g%4=1 then $1::uuid when g%4=2 then $2::uuid else $3::uuid end,'n','1',$4,g%4<>0,
           case when g%4=0 then 'public_pre_registration' end, case when g%4=0 then 'Pré-cadastro Web' else 'Indique e Ganhe' end,
           now()-(g||' days')::interval, now()-(g||' hours')::interval from generate_series(1,40) g`, [P.ind, P.com, P.adm, plan])
  for (const r of await q(`select id, indicator_profile_id i from public.referrals where reward_eligible order by id limit 6`)) await q(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type,status) values ($1,$2,30,'pix','disponivel')`, [r.id, r.i])
  await new Promise(r => setTimeout(r, 1100))
  const started = new Date(); const STARTED_Z = iso(started)
  await new Promise(r => setTimeout(r, 1100))
  await c.query(EXPAND)
  // window (old code, legacy) allowed categories
  const old = (uid) => asUser(uid, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_type,reward_amount) values ($1,'n','1',$2,'pix',30) returning id`, [uid, plan])
  await old(P.ind); await old(P.com); await old(P.adm)
  await q(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source,erp_lead_source) values (null,'n','1',$1,false,'public_pre_registration','Pré-cadastro Web')`, [plan])
  // new code rows
  const indRow = (await asUser(P.com, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind) values ($1,'n','1',$2,true,'indicator') returning id`, [P.com, plan]))[0].id
  const webRow = (await q(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source,erp_lead_source,origin_kind) values (null,'n','1',$1,false,'public_pre_registration','Pré-cadastro Web','web_preregistration') returning id`, [plan]))[0].id
  await q(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source,erp_lead_source,origin_kind) values (null,'n','1',$1,false,'neutral_network_pre_registration','Pré-cadastro Rede Neutra','neutral_network')`, [plan])
  const o = (await asUser(P.emp, `select public.create_employee_sales_opportunity('h1c-emp-key-000000001','technician_originator',$1,$2,'n','1') r`, [sector, plan]))[0].r
  const empRow = o.opportunity_id
  const legacyPre = (await q(`select id from public.referrals where origin_kind='legacy' and created_at < $1 order by id limit 1`, [STARTED_Z]))[0].id
  await t("setup_employee_rpc_ok", () => o.ok === true || o)

  const B = await snapshot()
  const FUT_OK = () => iso(new Date(Date.now() + 2 * 60 * 1000)) // window empty, within tolerance
  // run finalize body in a rolled-back tx after fixture; expect specific abort code
  const abort = async (fixture, code, guc = STARTED_Z) => {
    await c.query("begin"); let msg = "did not abort"
    try {
      if (guc !== null) await c.query(`select set_config('igt.h1b_expand_started_at',$1,true)`, [guc])
      if (fixture) await c.query(fixture)
      await c.query(BODY)
    } catch (e) { msg = e.message }
    await c.query("rollback").catch(() => {})
    const same = (await snapshot()) === B
    return (msg.includes(`h1b_finalize_abort:${code}`) && same) || { msg, same }
  }
  const succeedsInTx = async (guc) => { await c.query("begin"); try { await c.query(`select set_config('igt.h1b_expand_started_at',$1,true)`, [guc]); await c.query(BODY); const d = (await q(`select count(*)::int n from pg_attrdef d join pg_attribute a on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.referrals'::regclass and a.attname='origin_kind'`))[0].n; return d === 0 } catch (e) { return e.message } finally { await c.query("rollback").catch(() => {}) } }

  // ---------- GUC ----------
  await t("GUC_missing_aborts", () => abort(null, "guc_missing", null))
  await t("GUC_empty_aborts", () => abort(null, "guc_missing", ""))
  await t("GUC_no_timezone_aborts", () => abort(null, "guc_format_requires_iso8601_with_explicit_offset", "2026-11-06 11:00:00"))
  await t("GUC_no_T_with_offset_aborts", () => abort(null, "guc_format_requires_iso8601_with_explicit_offset", "2026-11-06 11:00:00-03:00"))
  await t("GUC_date_only_aborts", () => abort(null, "guc_format_requires_iso8601_with_explicit_offset", "2026-11-06"))
  await t("GUC_now_aborts", () => abort(null, "guc_format_requires_iso8601_with_explicit_offset", "now"))
  await t("GUC_short_offset_aborts", () => abort(null, "guc_format_requires_iso8601_with_explicit_offset", "2026-11-06T11:00:00-03"))
  await t("GUC_unparseable_aborts", () => abort(null, "guc_unparseable", "2026-13-45T25:00:00Z"))
  await t("GUC_future_aborts", () => abort(null, "guc_in_future", iso(new Date(Date.now() + 24 * 3600 * 1000))))
  await t("GUC_before_lower_bound_aborts", () => abort(null, "guc_before_lower_bound", "2026-10-01T00:00:00Z"))
  const off = (d) => { const l = new Date(d.getTime() - 3 * 3600 * 1000); return l.toISOString().replace(/\.\d+Z$/, "-03:00") }
  await t("GUC_accepts_Z", async () => (await succeedsInTx(STARTED_Z)) === true)
  await t("GUC_accepts_explicit_offset", async () => (await succeedsInTx(off(started))) === true)
  await t("GUC_session_timezone_unchanged", async () => { const before = (await q(`show timezone`))[0].TimeZone; await c.query("begin"); try { await c.query(`select set_config('igt.h1b_expand_started_at',$1,true)`, [off(started)]); await c.query(BODY); return (await q(`show timezone`))[0].TimeZone === before } finally { await c.query("rollback") } })

  // ---------- data (before constraint checks; CHECKs/triggers removed in fixture to reach them) ----------
  const NOTRG = `alter table public.referrals disable trigger trg_referrals_enforce_origin_kind;`
  await t("DATA_null_origin_aborts", () => abort(`alter table public.referrals drop constraint referrals_origin_kind_chk; alter table public.referrals alter column origin_kind drop not null; ${NOTRG} update public.referrals set origin_kind=null where id='${legacyPre}'`, "data_null_origin"))
  await t("DATA_invalid_origin_aborts", () => abort(`alter table public.referrals drop constraint referrals_origin_kind_chk; ${NOTRG} update public.referrals set origin_kind='bogus' where id='${legacyPre}'`, "data_invalid_origin"))
  await t("DATA_employee_with_indicator_aborts", () => abort(`alter table public.referrals drop constraint referrals_employee_origin_no_reward_chk; ${NOTRG} update public.referrals set indicator_profile_id='${P.ind}' where id='${empRow}'`, "data_employee_with_indicator"))
  await t("DATA_employee_reward_eligible_aborts", () => abort(`alter table public.referrals drop constraint referrals_employee_origin_no_reward_chk; ${NOTRG} update public.referrals set reward_eligible=true where id='${empRow}'`, "data_employee_reward_eligible"))
  await t("DATA_employee_has_reward_aborts", () => abort(`alter table public.rewards disable trigger trg_rewards_enforce_financial_eligibility; insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ('${empRow}','${P.ind}',1,'pix')`, "data_employee_has_reward"))
  await t("DATA_employee_missing_attribution_aborts", () => abort(`delete from public.sales_opportunity_attributions where opportunity_id='${empRow}'`, "data_employee_missing_attribution"))
  await t("DATA_attribution_on_non_employee_aborts", () => abort(`alter table public.sales_opportunity_attributions disable trigger trg_sales_opportunity_attributions_guard; insert into public.sales_opportunity_attributions(opportunity_id,employee_id,attribution_role,sector_id,attributed_by,source) select '${indRow}',employee_id,attribution_role,sector_id,attributed_by,source from public.sales_opportunity_attributions where opportunity_id='${empRow}'`, "data_attribution_on_non_employee"))
  await t("DATA_web_eligible_aborts", () => abort(`alter table public.referrals drop constraint referrals_public_pre_registration_chk; ${NOTRG} update public.referrals set reward_eligible=true where id='${webRow}'`, "data_non_reward_origin_eligible"))
  await t("DATA_web_has_reward_aborts", () => abort(`alter table public.rewards disable trigger trg_rewards_enforce_financial_eligibility; insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ('${webRow}','${P.ind}',1,'pix')`, "data_non_reward_origin_has_reward"))
  await t("DATA_indicator_origin_null_indicator_eligible_aborts", () => abort(`${NOTRG} update public.referrals set indicator_profile_id=null, reward_eligible=true where id='${indRow}'`, "data_indicator_origin_without_indicator_eligible"))
  await t("DATA_check_missing_does_not_hide_employee_inconsistency", () => abort(`alter table public.referrals drop constraint referrals_employee_origin_no_reward_chk; alter table public.referrals drop constraint referrals_origin_kind_chk; ${NOTRG} update public.referrals set indicator_profile_id='${P.ind}' where id='${empRow}'`, "data_employee_with_indicator"))

  // ---------- window legacy by role ----------
  const legacyIns = (ind, extra = "", vals = "") => `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible${extra}) values (${ind ? `'${ind}'` : "null"},'n','1','${plan}',${ind ? "true" : "true"}${vals});`
  await t("WINDOW_admin_financeiro_aborts", () => abort(legacyIns(P.fin), "window_unexpected_legacy"))
  await t("WINDOW_funcionario_aborts", () => abort(`${NOTRG} ${legacyIns(P.emp)}`, "window_unexpected_legacy"))
  await t("WINDOW_other_role_aborts", () => abort(legacyIns(P.con), "window_unexpected_legacy"))
  await t("WINDOW_missing_role_with_indicator_aborts", () => abort(`alter table public.profiles alter column role drop not null; update public.profiles set role=null where id='${P.con}'; ${legacyIns(P.con)}`, "window_unexpected_legacy"))
  await t("WINDOW_no_indicator_but_eligible_aborts", () => abort(legacyIns(null), "window_unexpected_legacy"))
  await t("WINDOW_inconsistent_aborts", () => abort(`alter table public.referrals drop constraint referrals_public_pre_registration_chk; insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source) values ('${P.ind}','n','1','${plan}',false,'public_pre_registration');`, "window_unexpected_legacy"))
  await t("WINDOW_admin_financeiro_before_start_not_counted", async () => { await c.query("begin"); try { await c.query(`select set_config('igt.h1b_expand_started_at',$1,true)`, [FUT_OK()]); await c.query(legacyIns(P.fin)); await c.query(BODY); return true } catch (e) { return e.message } finally { await c.query("rollback") } })
  const notices = []; const onN = (n) => notices.push(n.message); c.on("notice", onN)
  await t("WINDOW_allowed_categories_pass_with_counts", async () => { const r = await succeedsInTx(STARTED_Z); const m = notices.find(x => /window_legacy/.test(x)) || ""; return (r === true && /indicator_role_indicador=1 indicator_role_comercial=1 indicator_role_admin_master=1 no_indicator_ineligible=1 admin_financeiro=0 funcionario=0 other_role=0 missing_role_with_indicator=0 no_indicator_but_eligible=0 inconsistent=0/.test(m) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(m)) || { r, m } })

  // ---------- type ----------
  const S = FUT_OK()
  await t("TYPE_varchar_aborts", () => abort(`alter table public.referrals alter column origin_kind type varchar(40)`, "column_type_not_text", S))
  await t("TYPE_domain_aborts", () => abort(`create domain public.h1c_lab_text as text; alter table public.referrals alter column origin_kind type public.h1c_lab_text`, "column_type_not_text", S))
  await t("TYPE_array_aborts", () => abort(`alter table public.referrals rename column origin_kind to origin_kind_h1c_old; alter table public.referrals add column origin_kind text[] not null default '{legacy}'`, "column_type_not_text", S))
  await t("TYPE_generated_aborts", () => abort(`delete from public.sales_opportunity_attributions; alter table public.referrals drop column origin_kind cascade; alter table public.referrals add column origin_kind text not null generated always as ('legacy') stored`, "column_generated_or_identity", S))
  await t("NOT_NULL_missing_aborts", () => abort(`alter table public.referrals alter column origin_kind drop not null`, "column_not_null_missing", S))
  await t("COLUMN_missing_aborts", () => abort(`alter table public.referrals drop column origin_kind cascade`, "column_missing", S))

  // ---------- CHECK semantics ----------
  const OK_LIST = `'indicator','assisted_indicator','web_preregistration','neutral_network','employee','legacy'`
  const reorigin = (expr, nv = "") => `alter table public.referrals drop constraint referrals_origin_kind_chk; alter table public.referrals add constraint referrals_origin_kind_chk check (${expr}) ${nv}`
  await t("CHECK_wrong_expression_same_name_aborts", () => abort(reorigin(`origin_kind is not null`), "check_definition_mismatch", S))
  await t("CHECK_too_permissive_aborts", () => abort(reorigin(`origin_kind is not null and origin_kind in (${OK_LIST},'other')`), "check_definition_mismatch", S))
  await t("CHECK_wrongly_restrictive_aborts", () => abort(reorigin(`origin_kind is not null and origin_kind in (${OK_LIST}) and length(origin_kind) < 30`), "check_definition_mismatch", S))
  await t("CHECK_not_valid_aborts", () => abort(reorigin(`origin_kind is not null and origin_kind in (${OK_LIST})`, "not valid"), "check_not_validated", S))
  await t("CHECK_wrong_column_aborts", () => abort(`alter table public.referrals drop constraint referrals_origin_kind_chk; alter table public.referrals add constraint referrals_origin_kind_chk check (source is distinct from 'zzz')`, "check_wrong_columns", S))
  await t("CHECK_missing_aborts", () => abort(`alter table public.referrals drop constraint referrals_origin_kind_chk`, "check_missing", S))
  await t("CHECK_identical_recreate_passes", async () => { await c.query("begin"); try { await c.query(`select set_config('igt.h1b_expand_started_at',$1,true)`, [S]); await c.query(reorigin(`origin_kind is not null and origin_kind in (${OK_LIST})`)); await c.query(BODY); return true } catch (e) { return e.message } finally { await c.query("rollback") } })
  const reemp = (expr) => `alter table public.referrals drop constraint referrals_employee_origin_no_reward_chk; alter table public.referrals add constraint referrals_employee_origin_no_reward_chk check (${expr})`
  await t("CHECK_employee_wrong_expression_aborts", () => abort(reemp(`origin_kind is distinct from 'employee' or indicator_profile_id is null or reward_eligible = false`), "check_definition_mismatch", S))
  await t("CHECK_employee_missing_aborts", () => abort(`alter table public.referrals drop constraint referrals_employee_origin_no_reward_chk`, "check_missing", S))
  await t("CHECK_employee_not_valid_aborts", () => abort(`alter table public.referrals drop constraint referrals_employee_origin_no_reward_chk; alter table public.referrals add constraint referrals_employee_origin_no_reward_chk check (origin_kind is distinct from 'employee' or (indicator_profile_id is null and reward_eligible = false)) not valid`, "check_not_validated", S))

  // ---------- trigger semantics ----------
  const retrg = (spec, fn = "public.trg_referrals_enforce_origin_kind()") => `drop trigger trg_referrals_enforce_origin_kind on public.referrals; create trigger trg_referrals_enforce_origin_kind ${spec} on public.referrals ${/statement/.test(spec) ? "" : ""} execute function ${fn}`
  await t("TRG_missing_aborts", () => abort(`drop trigger trg_referrals_enforce_origin_kind on public.referrals`, "trigger_missing", S))
  await t("TRG_disabled_aborts", () => abort(NOTRG, "trigger_not_enabled", S))
  await t("TRG_wrong_function_aborts", () => abort(`drop trigger trg_referrals_enforce_origin_kind on public.referrals; create trigger trg_referrals_enforce_origin_kind before insert or update on public.referrals for each row execute function public.set_updated_at()`, "trigger_wrong_function", S))
  await t("TRG_after_instead_of_before_aborts", () => abort(`drop trigger trg_referrals_enforce_origin_kind on public.referrals; create trigger trg_referrals_enforce_origin_kind after insert or update on public.referrals for each row execute function public.trg_referrals_enforce_origin_kind()`, "trigger_not_before", S))
  await t("TRG_insert_only_aborts", () => abort(`drop trigger trg_referrals_enforce_origin_kind on public.referrals; create trigger trg_referrals_enforce_origin_kind before insert on public.referrals for each row execute function public.trg_referrals_enforce_origin_kind()`, "trigger_wrong_events", S))
  await t("TRG_update_only_aborts", () => abort(`drop trigger trg_referrals_enforce_origin_kind on public.referrals; create trigger trg_referrals_enforce_origin_kind before update on public.referrals for each row execute function public.trg_referrals_enforce_origin_kind()`, "trigger_wrong_events", S))
  await t("TRG_extra_delete_event_aborts", () => abort(`drop trigger trg_referrals_enforce_origin_kind on public.referrals; create trigger trg_referrals_enforce_origin_kind before insert or update or delete on public.referrals for each row execute function public.trg_referrals_enforce_origin_kind()`, "trigger_wrong_events", S))
  await t("TRG_statement_level_aborts", () => abort(`drop trigger trg_referrals_enforce_origin_kind on public.referrals; create trigger trg_referrals_enforce_origin_kind before insert or update on public.referrals for each statement execute function public.trg_referrals_enforce_origin_kind()`, "trigger_not_row_level", S))
  await t("TRG_same_name_function_other_schema_aborts", () => abort(`create schema h1c_lab_shadow; create function h1c_lab_shadow.trg_referrals_enforce_origin_kind() returns trigger language plpgsql as $f$ begin return NEW; end $f$; drop trigger trg_referrals_enforce_origin_kind on public.referrals; create trigger trg_referrals_enforce_origin_kind before insert or update on public.referrals for each row execute function h1c_lab_shadow.trg_referrals_enforce_origin_kind()`, "trigger_wrong_function", S))
  await t("TRG_update_of_columns_aborts", () => abort(`drop trigger trg_referrals_enforce_origin_kind on public.referrals; create trigger trg_referrals_enforce_origin_kind before insert or update of source on public.referrals for each row execute function public.trg_referrals_enforce_origin_kind()`, "trigger_unexpected_args_columns_or_when", S))

  // ---------- default ----------
  await t("DEFAULT_other_value_aborts", () => abort(`alter table public.referrals alter column origin_kind set default 'indicator'`, "unexpected_default", S))
  // PostgreSQL não grava default para SET DEFAULT NULL (equivale a DROP DEFAULT): o estado é
  // indistinguível de "já finalizado" sem persistir estado (proibido). A finalize então faz a
  // validação completa de dados+estrutura e termina no-op, sem escrever linhas.
  await t("DEFAULT_set_null_equals_absent_full_validation_noop_no_writes", async () => { await c.query("begin"); try { await c.query(`alter table public.referrals alter column origin_kind set default null`); const n = (await q(`select count(*)::int n from pg_attrdef d join pg_attribute a on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.referrals'::regclass and a.attname='origin_kind'`))[0].n; const ns = []; const h = m => ns.push(m.message); c.on("notice", h); await c.query(BODY); c.off("notice", h); const s = rowsOnly(await snapshot()) === rowsOnly(B); return (n === 0 && s && ns.some(m => /default_already_removed=true structure_ok=true/.test(m))) || { n, s, ns } } catch (e) { return e.message } finally { await c.query("rollback") } })
  await t("DEFAULT_absent_but_divergent_aborts", () => abort(`alter table public.referrals alter column origin_kind drop default; alter table public.referrals alter column origin_kind drop not null`, "column_not_null_missing", null))

  await t("ALL_ABORTS_LEFT_STATE_IDENTICAL", async () => (await snapshot()) === B)
  await t("DEFAULT_still_present_after_aborts", async () => (await q(`select pg_get_expr(d.adbin,d.adrelid) e from pg_attrdef d join pg_attribute a on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.referrals'::regclass and a.attname='origin_kind'`))[0]?.e === "'legacy'::text")

  // ---------- success (committed) ----------
  notices.length = 0
  await q(`select set_config('igt.h1b_expand_started_at',$1,false)`, [STARTED_Z])
  await c.query(FINALIZE)
  const A = await snapshot()
  const ja = JSON.parse(A), jb = JSON.parse(B)
  await t("SUCCESS_row_writes_0", () => JSON.stringify(ja.ref.map(r => [r.id, r.x, r.t])) === JSON.stringify(jb.ref.map(r => [r.id, r.x, r.t])))
  await t("SUCCESS_updated_at_changes_0", () => ja.ref.every((r, i) => r.updated_at === jb.ref[i].updated_at && JSON.stringify(r.j) === JSON.stringify(jb.ref[i].j)))
  await t("SUCCESS_reward_writes_0", () => JSON.stringify(ja.rew) === JSON.stringify(jb.rew))
  await t("SUCCESS_attribution_writes_0", () => JSON.stringify(ja.att) === JSON.stringify(jb.att) && JSON.stringify(ja.aud) === JSON.stringify(jb.aud))
  await t("SUCCESS_no_physical_rewrite", () => JSON.stringify(ja.files) === JSON.stringify(jb.files))
  await t("SUCCESS_default_removed_structure_kept", async () => (await q(`select count(*)::int n from pg_attrdef d join pg_attribute a on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.referrals'::regclass and a.attname='origin_kind'`))[0].n === 0 && (await q(`select attnotnull v from pg_attribute where attrelid='public.referrals'::regclass and attname='origin_kind'`))[0].v === true)
  await t("SUCCESS_notice_counts_only", () => notices.some(m => /h1b_finalize_report ok default_removed=true/.test(m)) && notices.every(m => !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(m)) || notices)

  // ---------- reapply ----------
  const k = new Client(conn); await k.connect(); await k.query("set timezone='UTC'")
  try {
    const kn = []; k.on("notice", n => kn.push(n.message))
    let r1 = "ok"; try { await k.query(FINALIZE) } catch (e) { r1 = e.message }
    await t("REAPPLY_noop_without_guc", () => (r1 === "ok" && kn.some(m => /default_already_removed=true structure_ok=true/.test(m))) || { r1, kn })
    await t("REAPPLY_no_writes", async () => rowsOnly(await snapshot()) === rowsOnly(A))
    const divergent = async (fixture, code) => { await k.query("begin"); let m = "did not abort"; try { await k.query(fixture); await k.query(BODY) } catch (e) { m = e.message } await k.query("rollback").catch(() => {}); return m.includes(`h1b_finalize_abort:${code}`) || m }
    await t("REAPPLY_divergent_check_aborts", () => divergent(`alter table public.referrals drop constraint referrals_employee_origin_no_reward_chk`, "check_missing"))
    await t("REAPPLY_divergent_trigger_aborts", () => divergent(NOTRG, "trigger_not_enabled"))
    await t("REAPPLY_divergent_type_aborts", () => divergent(`alter table public.referrals alter column origin_kind type varchar(40)`, "column_type_not_text"))
    await t("REAPPLY_never_restores_default", async () => (await q(`select count(*)::int n from pg_attrdef d join pg_attribute a on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.referrals'::regclass and a.attname='origin_kind'`))[0].n === 0)
  } finally { await k.end().catch(() => {}) }
  await t("POST_insert_without_origin_fails", async () => { try { await asUser(P.ind, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id) values ($1,'n','1',$2)`, [P.ind, plan]); return false } catch (e) { return /origin_kind_required/.test(e.message) } })
  await t("POST_comercial_explicit_indicator_eligible", async () => (await asUser(P.com, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind) values ($1,'n','1',$2,true,'indicator') returning reward_eligible`, [P.com, plan]))[0].reward_eligible === true)
  await t("POST_admin_financeiro_explicit_indicator_ineligible", async () => (await asUser(P.fin, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind) values ($1,'n','1',$2,true,'indicator') returning reward_eligible`, [P.fin, plan]))[0].reward_eligible === false)
} finally { await stopCollectionsLab() }
for (const r of out) console.log(r.join(" | "))
const pass = out.filter(r => r[1] === "PASS").length
console.log(`H1C_FINALIZE_LAB=${ok ? "PASS" : "FAIL"} (${pass}/${out.length})`)
process.exit(ok ? 0 : 1)
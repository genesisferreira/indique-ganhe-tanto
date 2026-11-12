// 3.1F-I1 local PG validation (127.0.0.1 only). No remote. No ERP.
// Lab isolado: IGT_PG_LAB_ROOT (default %LOCALAPPDATA%/igt-pg-i1-lab-r2).
// Porta própria (IGT_PG_LAB_PORT, default 55454) para não colidir com labs antigos
// em 55434. O harness compartilhado é carregado sem alteração no repositório:
// apenas PORT e o diretório-base são substituídos numa cópia dentro do lab root.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const HERE = dirname(fileURLToPath(import.meta.url))
const LAB_ROOT = (process.env.IGT_PG_LAB_ROOT ||= join(process.env.LOCALAPPDATA || homedir(), "igt-pg-i1-lab-r2"))
const LAB_PORT = Number(process.env.IGT_PG_LAB_PORT || 55454)
if (!Number.isInteger(LAB_PORT) || LAB_PORT === 55434) throw new Error("I1 lab must not use port 55434")
let runSrc = readFileSync(join(HERE, "local-pg-collections-lab/run.mjs"), "utf8")
const portLine = "const PORT = 55434"
const hereLine = "const here = dirname(fileURLToPath(import.meta.url))"
if (!runSrc.includes(portLine) || !runSrc.includes(hereLine)) throw new Error("lab harness shape changed")
// io_method=sync: evita io_workers órfãos segurando a porta/memória compartilhada no Windows.
const flagsLine = 'postgresFlags: ["-c", "listen_addresses=127.0.0.1"]'
if (!runSrc.includes(flagsLine)) throw new Error("lab harness flags changed")
runSrc = runSrc.replace(flagsLine, 'postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "io_method=sync"]')
runSrc = runSrc.replace(portLine, `const PORT = ${LAB_PORT}`).replace(hereLine, `const here = ${JSON.stringify(join(HERE, "local-pg-collections-lab"))}`)
mkdirSync(LAB_ROOT, { recursive: true })
const runCopy = join(LAB_ROOT, "run-i1.mjs")
writeFileSync(runCopy, runSrc)
const { startCollectionsLab, stopCollectionsLab, REPO_ROOT } = await import(pathToFileURL(runCopy).href)

const I1 = "supabase/patch-employee-commission-payroll-ledger-foundation-3-1f-i1.sql"
const PRE = [
  "supabase/patch-referral-interested-fields.sql",
  "supabase/patch-public-pre-registration.sql",
  "supabase/patch-pre-registration-pj-neutral-network.sql",
  "supabase/patch-commercial-assisted-referral-foundation.sql",
  "supabase/patch-assisted-indicator-account-foundation.sql",
  "supabase/patch-notifications-referral-events.sql",
  "supabase/patch-notifications-indicator-events.sql",
  "supabase/patch-brbyte-sync-infrastructure.sql",
  "supabase/patch-first-invoice-reward-from-controllr-amount.sql",
  "supabase/patch-financial-reward-eligibility-hardening.sql",
]
const H1 = "supabase/patch-employee-origin-and-rewards-hardening-3-1f-h1.sql"
const H1B = "supabase/patch-employee-origin-hardening-finalize-3-1f-h1b.sql"
const NEW_TABLES = ["finance_audit_events", "employee_commission_rules", "employee_commission_entitlements", "employee_compensation_profiles", "employee_worked_days", "payroll_competences", "payroll_competence_lines"]
const RPCS = [
  "public.attribute_employee_sales_opportunity(text, uuid, uuid, text, uuid)",
  "public.create_commission_rule_draft(text, uuid, text, text, text, numeric, numeric, text, date, date)",
  "public.version_commission_rule_draft(text, uuid, text, text, numeric, numeric, text, date, date)",
  "public.configure_employee_compensation_draft(text, uuid, date, date, numeric, numeric, numeric, text, numeric, text, boolean, boolean, boolean, boolean)",
  "public.record_employee_worked_day(text, uuid, date, text, boolean)",
  "public.open_payroll_competence_draft(text, uuid, date)",
  "public.add_manual_payroll_adjustment(text, uuid, text, numeric, text, text)",
]
const I1_FUNCS = ["attribute_employee_sales_opportunity", "create_commission_rule_draft", "version_commission_rule_draft", "configure_employee_compensation_draft", "record_employee_worked_day", "open_payroll_competence_draft", "add_manual_payroll_adjustment", "finance_audit_log", "finance_admin_actor_role", "trg_employee_commission_entitlements_origin_guard", "trg_employee_commission_entitlements_immutable", "trg_employee_commission_entitlements_foundation_gate", "trg_employee_worked_days_closed_guard", "trg_payroll_competence_lines_guard", "trg_payroll_competences_guard"]
const res = []
let ok = true
const key = (s) => (s + "-i1-lab-key-000000000000").slice(0, 32)
const { client: c, conn, Client } = await startCollectionsLab()
const pool = []
try {
  const q = async (sql, p = []) => (await c.query(sql, p)).rows
  const one = async (sql, p = []) => (await q(sql, p))[0]
  const t = async (name, fn) => { try { const v = await fn(); res.push([name, v ? "PASS" : "FAIL"]); if (!v) ok = false } catch (e) { await c.query("rollback").catch(() => {}); res.push([name, "FAIL " + e.message]); console.log("FAIL", name, e.message); ok = false } }
  const failsWith = async (sql, re, p = []) => { await c.query("begin"); try { await c.query(sql, p); await c.query("rollback"); return false } catch (e) { await c.query("rollback"); return re.test(e.message) } }
  const asUser = async (uid, sql, p = []) => { await c.query("begin"); try { await c.query("set local role authenticated"); await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]); const r = await c.query(sql, p); await c.query("commit"); return r.rows } catch (e) { await c.query("rollback"); throw e } }
  const rpc = async (uid, sql, p = []) => (await asUser(uid, `select ${sql} r`, p))[0].r
  const deniedAs = async (role, uid, sql) => { await c.query("begin"); try { await c.query(`set local role ${role}`); if (uid) await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]); await c.query(sql); await c.query("rollback"); return false } catch (e) { await c.query("rollback"); return /permission denied|row-level security|42501/.test(e.message) } }

  // ---------- chain + production-like seed (lab only; no production connection) ----------
  const applyFile = async (f) => { try { await c.query(readFileSync(join(REPO_ROOT, f), "utf8")); await c.query("select 1") } catch (e) { await c.query("rollback").catch(() => {}); throw new Error(`apply ${f}: ${e.message}`) } }
  for (const f of PRE) await applyFile(f)
  const ind = "22222222-0000-0000-0000-000000000001"
  await c.query(`insert into public.profiles(id,email,role) values ($1,'seed@x','indicador')`, [ind])
  const plan = (await one(`select id from public.plans limit 1`))?.id ?? (await one(`insert into public.plans(name, speed_label, price, reward_amount) values ('p','1M',1,30) returning id`)).id
  // 249 referrals (24 reward-eligible com reward), todas viram legacy na H1.
  await c.query(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible)
                 select $1,'n','1',$2,(g<=24) from generate_series(1,249) g`, [ind, plan])
  await c.query(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type)
                 select id,$1,30,'pix' from public.referrals where reward_eligible order by id limit 24`, [ind])
  await c.query("grant all on all tables in schema public to anon, authenticated; grant all on all functions in schema public to anon, authenticated, public")
  // Mesma ordem do lab H1: instante registrado ANTES da expand (GUC exigido pela finalize).
  await new Promise(r => setTimeout(r, 1100))
  const h1bStartedAt = new Date().toISOString()
  await applyFile(H1)
  await c.query(`select set_config('igt.h1b_expand_started_at',$1,false)`, [h1bStartedAt])
  await applyFile(H1B)
  res.push(["chain_pre_i1", "OK"])

  const finHash = async () => one(`select
     (select md5(coalesce(string_agg(r::text, '|' order by r.id), '')) from public.rewards r) rewards,
     (select md5(coalesce(string_agg(w::text, '|' order by w.id), '')) from public.wallet_transactions w) wallet,
     (select md5(coalesce(string_agg(x.id::text || x.updated_at::text || x.origin_kind, '|' order by x.id), '')) from public.referrals x) referrals,
     (select count(*)::int from public.referrals) n_ref,
     (select count(*)::int from public.referrals where origin_kind='legacy') n_legacy,
     (select count(*)::int from public.rewards) n_rewards,
     (select count(*)::int from public.sales_opportunity_attributions) n_attr`)
  const pre = await finHash()
  await t("seed_production_like_249_legacy_24_rewards_0_attr", () => pre.n_ref === 249 && pre.n_legacy === 249 && pre.n_rewards === 24 && pre.n_attr === 0)

  // ---------- apply I1 twice (re-apply safe) ----------
  const sql = readFileSync(join(REPO_ROOT, I1), "utf8")
  await t("apply_i1_first", async () => { await c.query(sql); return true })
  await t("apply_i1_reapply_idempotent", async () => { await c.query(sql); return true })
  const post = await finHash()
  await t("upgrade_no_mutation_rewards_wallet_referrals", () => JSON.stringify(pre) === JSON.stringify(post))
  const countsAll = async () => Object.fromEntries(await Promise.all(NEW_TABLES.map(async x => [x, (await one(`select count(*)::int n from public.${x}`)).n])))
  await t("migration_creates_zero_financial_rows_no_backfill", async () => Object.values(await countsAll()).every(n => n === 0))
  await t("DEFAULT_RULES_CREATED_NO", async () => (await one(`select count(*)::int n from public.employee_commission_rules`)).n === 0)
  await t("preflight_report_runs_read_only", async () => { const r = await c.query(readFileSync(join(REPO_ROOT, "supabase/preflight-employee-commission-payroll-ledger-3-1f-i1.sql"), "utf8")); const rows = r.find(x => x.command === "SELECT").rows; return rows.find(x => x.metric === "backfill_required").value === "0" })

  // ---------- catalog: RLS / grants / FKs / functions ----------
  await t("rls_enabled_all_new_tables_and_attributions", async () => (await one(`select bool_and(relrowsecurity) v from pg_class where relnamespace='public'::regnamespace and relname = any($1)`, [[...NEW_TABLES, "sales_opportunity_attributions"]])).v === true)
  await t("no_policies_on_new_tables", async () => (await one(`select count(*)::int n from pg_policies where schemaname='public' and tablename = any($1)`, [NEW_TABLES])).n === 0)
  await t("anon_authenticated_no_table_privileges", async () => (await one(`select bool_or(has_table_privilege(r, 'public.'||t, p)) v from unnest($1::text[]) t, unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete','truncate','references','trigger']) p`, [NEW_TABLES])).v === false)
  await t("service_role_select_only_no_delete_truncate", async () => (await one(`select bool_and(has_table_privilege('service_role','public.'||t,'select')) s, bool_or(has_table_privilege('service_role','public.'||t,p)) w from unnest($1::text[]) t, unnest(array['insert','update','delete','truncate']) p`, [NEW_TABLES])).w === false)
  await t("no_on_delete_cascade_on_financial_fks", async () => (await one(`select count(*)::int n from pg_constraint where contype='f' and confdeltype='c' and conrelid::regclass::text = any($1)`, [NEW_TABLES.map(x => x).concat(["sales_opportunity_attributions"])])).n === 0)
  await t("rpc_grants_authenticated_only", async () => { for (const s of RPCS) { const r = await one(`select has_function_privilege('authenticated',$1,'execute') a, has_function_privilege('anon',$1,'execute') n, has_function_privilege('service_role',$1,'execute') s, (select bool_or(x.grantee=0) from pg_proc p, aclexplode(p.proacl) x where p.oid=$1::regprocedure) pub, (select prosecdef from pg_proc where oid=$1::regprocedure) d, (select array_to_string(proconfig, ',') from pg_proc where oid=$1::regprocedure) cfg`, [s]); if (!(r.a && !r.n && !r.s && r.pub !== true && r.d && /search_path=public, pg_temp/.test(r.cfg))) return false } return true })
  await t("internal_helpers_not_executable_by_clients", async () => (await one(`select bool_or(has_function_privilege(r, f, 'execute')) v from unnest(array['public.finance_audit_log(text, text, uuid, jsonb, jsonb, text, text)','public.finance_admin_actor_role()']) f, unnest(array['anon','authenticated']) r`)).v === false)
  await t("forbidden_rpcs_absent", async () => (await one(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and (proname in ('activate_commission_rule','evaluate_invoice_commission') or proname ~ '(mark|set).*entitlement.*paid' or proname ~ '^(close|pay)_payroll')`)).n === 0)
  await t("no_function_inserts_entitlements", async () => (await one(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and prosrc ~* 'insert\\s+into\\s+public\\.employee_commission_entitlements'`)).n === 0)
  await t("invoice_pk_not_used_as_temporal_order", async () => (await one(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname = any($1) and prosrc ~* 'order\\s+by[^;]*invoice_pk'`, [I1_FUNCS])).n === 0 && (await one(`select count(*)::int n from pg_indexes where tablename='employee_commission_entitlements' and indexdef ~ 'invoice_pk'`)).n === 0)
  await t("attribution_unique_one_employee_per_role_kept", async () => (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname='sales_opportunity_attributions_role_uq'`)).d === "UNIQUE (opportunity_id, attribution_role)")

  // ---------- fixtures ----------
  const P = { am: "33333333-0000-0000-0000-000000000001", af: "33333333-0000-0000-0000-000000000002", ac: "33333333-0000-0000-0000-000000000003", co: "33333333-0000-0000-0000-000000000004", tec: "33333333-0000-0000-0000-000000000005", ext: "33333333-0000-0000-0000-000000000006", com: "33333333-0000-0000-0000-000000000007", pau: "33333333-0000-0000-0000-000000000008", ind: "33333333-0000-0000-0000-000000000009" }
  await c.query(`insert into public.profiles(id,email,role) values ($1,'am@x','admin_master'),($2,'af@x','admin_financeiro'),($3,'ac@x','admin_consulta'),($4,'co@x','comercial'),($5,'te@x','funcionario'),($6,'ex@x','funcionario'),($7,'cm@x','funcionario'),($8,'pa@x','funcionario'),($9,'in@x','indicador')`, Object.values(P))
  const sec = Object.fromEntries((await q(`select code, id from public.sectors`)).map(r => [r.code, r.id]))
  const E = {}
  for (const [k, s] of [["tec", "technician"], ["ext", "external_sales"], ["com", "commercial"], ["pau", "technician"]]) {
    E[k] = (await one(`insert into public.employees(profile_id,status) values ($1,'active') returning id`, [P[k]])).id
    await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id) values ($1,$2) on conflict do nothing`, [E[k], sec[s]])
  }
  await c.query(`update public.employees set status='paused' where id=$1`, [E.pau])
  const newOpp = async (k) => (await rpc(P.tec, `public.create_employee_sales_opportunity($1,'technician_originator',$2,$3,'n','1')`, [key("opp-" + k), sec.technician, plan])).opportunity_id
  const opp1 = await newOpp("1")
  const legacyRef = (await one(`select id from public.referrals where origin_kind='legacy' limit 1`)).id
  const rewards0 = (await one(`select count(*)::int n from public.rewards`)).n

  // ---------- authorization ----------
  for (const [who, uid] of [["funcionario", P.tec], ["comercial", P.co], ["admin_consulta", P.ac], ["indicador", P.ind]]) {
    await t(`forbidden_rule_draft_${who}`, async () => (await rpc(uid, `public.create_commission_rule_draft($1,null,'technician_originator','fixed_amount','first_valid_invoice_generated',30,null,null,'2027-01-01')`, [key("f-" + who)])).code === "forbidden")
  }
  await t("anon_cannot_execute_rpcs", () => deniedAs("anon", null, `select public.create_commission_rule_draft('${key("anon")}',null,'technician_originator','fixed_amount','first_valid_invoice_generated',30,null,null,'2027-01-01')`))
  await t("authenticated_direct_insert_rules_denied", () => deniedAs("authenticated", P.am, `insert into public.employee_commission_rules(rule_family_id,attribution_role,method,trigger_kind,fixed_amount,effective_from,idempotency_key) values (gen_random_uuid(),'technician_originator','fixed_amount','first_valid_invoice_generated',30,'2027-01-01','${key("dir")}')`))
  await t("cross_employee_salary_read_denied", async () => (await deniedAs("authenticated", P.ext, `select * from public.employee_compensation_profiles`)) && (await deniedAs("authenticated", P.am, `select * from public.employee_compensation_profiles`)) && (await deniedAs("authenticated", P.ext, `select * from public.payroll_competences`)) && (await deniedAs("authenticated", P.ext, `select * from public.employee_commission_entitlements`)))

  // ---------- commission rules (ephemeral lab drafts with the specified future defaults) ----------
  const draft = (uid, k, role, method, trig, fixed, rate, base, from = "2027-01-01", until = null) => rpc(uid, `public.create_commission_rule_draft($1,null,$2,$3,$4,$5,$6,$7,$8,$9)`, [key(k), role, method, trig, fixed, rate, base, from, until])
  const rTec = await draft(P.am, "r-tec", "technician_originator", "fixed_amount", "first_valid_invoice_generated", 30, null, null)
  const rExt = await draft(P.af, "r-ext", "external_sales_originator", "fixed_amount", "first_valid_invoice_generated", 50, null, null)
  const rInt = await draft(P.am, "r-int", "internal_sales_responsible", "percentage", "first_valid_invoice_generated", null, 0.02, null)
  await t("rule_drafts_created_admin_master_and_financeiro", () => rTec.ok && rExt.ok && rInt.ok)
  await t("rule_drafts_inactive_not_retroactive", async () => (await one(`select bool_and(not active and status='draft' and not retroactive) v from public.employee_commission_rules`)).v === true)
  await t("percentage_draft_base_nullable", async () => (await one(`select percentage_base from public.employee_commission_rules where id=$1`, [rInt.rule_id])).percentage_base === null)
  await t("rule_draft_idempotent_same_key", async () => (await draft(P.am, "r-tec", "technician_originator", "fixed_amount", "first_valid_invoice_generated", 30, null, null)).idempotent === true)
  await t("fixed_requires_positive", async () => (await draft(P.am, "bad1", "technician_originator", "fixed_amount", "first_valid_invoice_generated", 0, null, null)).code === "invalid_rule")
  await t("fixed_rejects_percentage_extras", async () => (await draft(P.am, "bad2", "technician_originator", "fixed_amount", "first_valid_invoice_generated", 30, 0.02, null)).code === "invalid_rule")
  await t("percentage_rate_gt_zero", async () => (await draft(P.am, "bad3", "internal_sales_responsible", "percentage", "first_valid_invoice_generated", null, 0, null)).code === "invalid_percentage_rate")
  await t("percentage_rate_le_technical_max_1", async () => (await draft(P.am, "bad4", "internal_sales_responsible", "percentage", "first_valid_invoice_generated", null, 1.01, null)).code === "invalid_percentage_rate" && (await draft(P.am, "ok-max", "internal_sales_responsible", "percentage", "first_valid_invoice_generated", null, 1.00, null)).ok === true)
  await t("first_invoice_value_only_fully_paid", async () => (await draft(P.am, "bad5", "technician_originator", "first_invoice_value", "first_valid_invoice_generated", null, null, null)).code === "invalid_rule" && (await draft(P.am, "ok-fiv", "technician_originator", "first_invoice_value", "first_valid_invoice_fully_paid", null, null, null)).ok === true)
  await t("first_invoice_value_rejects_fixed_and_rate", async () => (await draft(P.am, "bad6", "technician_originator", "first_invoice_value", "first_valid_invoice_fully_paid", 10, null, null)).code === "invalid_rule" && (await draft(P.am, "bad7", "technician_originator", "first_invoice_value", "first_valid_invoice_fully_paid", null, 0.1, null)).code === "invalid_rule")
  await t("fixed_with_fully_paid_rejected", async () => (await draft(P.am, "bad8", "technician_originator", "fixed_amount", "first_valid_invoice_fully_paid", 30, null, null)).code === "invalid_rule")
  await t("effective_period_valid", async () => (await draft(P.am, "bad9", "technician_originator", "fixed_amount", "first_valid_invoice_generated", 30, null, null, "2027-02-01", "2027-01-31")).code === "invalid_rule")
  await t("money_explicit_rounding_numeric_10_2", async () => { const r = await draft(P.am, "round", "technician_originator", "fixed_amount", "first_valid_invoice_generated", 30.005, null, null); return (await one(`select fixed_amount::text v, pg_typeof(fixed_amount)::text ty from public.employee_commission_rules where id=$1`, [r.rule_id])).v === "30.01" })
  await t("activation_impossible_foundation_gate", () => failsWith(`update public.employee_commission_rules set active=true, status='active', approved_by='${P.am}', approved_at=now() where id='${rTec.rule_id}'`, /snapshot_immutable|transition_forbidden|foundation_inactive/))
  await t("activation_impossible_direct_insert", () => failsWith(`insert into public.employee_commission_rules(rule_family_id,attribution_role,method,trigger_kind,fixed_amount,effective_from,idempotency_key,status,active,approved_by,approved_at) values (gen_random_uuid(),'technician_originator','fixed_amount','first_valid_invoice_generated',30,'2027-01-01','${key("act")}','active',true,'${P.am}',now())`, /foundation_inactive/))
  await t("retroactive_impossible", () => failsWith(`insert into public.employee_commission_rules(rule_family_id,attribution_role,method,trigger_kind,fixed_amount,effective_from,idempotency_key,retroactive) values (gen_random_uuid(),'technician_originator','fixed_amount','first_valid_invoice_generated',30,'2027-01-01','${key("retro")}',true)`, /no_retroactive/))
  // Readiness implication (lab tx only, constraint dropped then rolled back): incomplete percentage cannot activate.
  await t("incomplete_percentage_cannot_activate", async () => {
    await c.query("begin"); try {
      await c.query(`alter table public.employee_commission_rules drop constraint employee_commission_rules_foundation_inactive_chk`)
      await c.query("savepoint s")
      let blocked = false
      try { await c.query(`insert into public.employee_commission_rules(rule_family_id,attribution_role,method,trigger_kind,percentage_rate,effective_from,idempotency_key,status,active,approved_by,approved_at) values (gen_random_uuid(),'internal_sales_responsible','percentage','first_valid_invoice_generated',0.02,'2027-01-01','${key("ready1")}','active',true,'${P.am}',now())`) } catch (e) { blocked = /activation_ready/.test(e.message) }
      await c.query("rollback to savepoint s")
      let unapproved = false
      try { await c.query(`insert into public.employee_commission_rules(rule_family_id,attribution_role,method,trigger_kind,fixed_amount,effective_from,idempotency_key,status,active) values (gen_random_uuid(),'technician_originator','fixed_amount','first_valid_invoice_generated',30,'2027-01-01','${key("ready2")}','active',true)`) } catch (e) { unapproved = /activation_ready/.test(e.message) }
      return blocked && unapproved
    } finally { await c.query("rollback") }
  })
  await t("ACTIVE_RULES_CREATED_NO", async () => (await one(`select count(*)::int n from public.employee_commission_rules where active or status='active' or retroactive`)).n === 0)

  // ---------- versioning ----------
  const v2 = await rpc(P.am, `public.version_commission_rule_draft($1,$2,'fixed_amount','first_valid_invoice_generated',55,null,null,'2027-03-01')`, [key("v2"), rExt.rule_id])
  await t("version_creates_new_row_v2", () => v2.ok && v2.version === 2)
  await t("version_keeps_previous_snapshot", async () => { const r = await one(`select fixed_amount::text a, status, version from public.employee_commission_rules where id=$1`, [rExt.rule_id]); return r.a === "50.00" && r.status === "superseded" && r.version === 1 })
  await t("version_from_non_latest_rejected", async () => (await rpc(P.am, `public.version_commission_rule_draft($1,$2,'fixed_amount','first_valid_invoice_generated',60,null,null,'2027-03-01')`, [key("v2b"), rExt.rule_id])).code === "rule_not_latest_draft")
  await t("rule_snapshot_update_blocked_even_owner", () => failsWith(`update public.employee_commission_rules set fixed_amount=99 where id='${v2.rule_id}'`, /snapshot_immutable/))
  await t("rule_delete_blocked_even_owner", () => failsWith(`delete from public.employee_commission_rules where id='${v2.rule_id}'`, /no_delete/))

  // ---------- attributions ----------
  const att = (uid, k, opp, emp, role, s) => rpc(uid, `public.attribute_employee_sales_opportunity($1,$2,$3,$4,$5)`, [key(k), opp, emp, role, s])
  const a1 = await att(P.am, "a1", opp1, E.ext, "external_sales_originator", sec.external_sales)
  const a2 = await att(P.af, "a2", opp1, E.com, "internal_sales_responsible", sec.commercial)
  await t("attribution_three_roles_one_opportunity", async () => a1.ok && a2.ok && (await one(`select count(distinct employee_id)::int n from public.sales_opportunity_attributions where opportunity_id=$1`, [opp1])).n === 3)
  await t("attribution_idempotent_same_key", async () => (await att(P.am, "a1", opp1, E.ext, "external_sales_originator", sec.external_sales)).idempotent === true)
  await t("attribution_role_taken_by_other_employee", async () => (await att(P.am, "a3", opp1, E.com, "external_sales_originator", sec.external_sales)).code === "attribution_role_taken")
  await t("attribution_requires_employee_origin", async () => (await att(P.am, "a4", legacyRef, E.ext, "external_sales_originator", sec.external_sales)).code === "attribution_requires_employee_origin")
  const opp2 = await newOpp("2")
  await t("attribution_employee_must_be_active", async () => (await att(P.am, "a5", opp2, E.pau, "internal_sales_responsible", sec.commercial)).code === "employee_not_active")
  await t("attribution_role_sector_compatible", async () => (await att(P.am, "a6", opp2, E.ext, "external_sales_originator", sec.commercial)).code === "role_sector_incompatible")
  await t("attribution_membership_required", async () => (await att(P.am, "a7", opp2, E.com, "external_sales_originator", sec.external_sales)).code === "membership_not_active")
  await t("attribution_forbidden_for_funcionario", async () => (await att(P.tec, "a8", opp2, E.ext, "external_sales_originator", sec.external_sales)).code === "forbidden")
  await t("employee_never_creates_rewards", async () => (await one(`select count(*)::int n from public.rewards`)).n === rewards0 && (await one(`select count(*)::int n from public.rewards w join public.referrals r on r.id=w.referral_id where r.origin_kind='employee'`)).n === 0)
  await t("employee_reward_still_blocked_by_h1", () => failsWith(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ('${opp1}','${ind}',1,'pix')`, /not_reward_eligible/))

  // ---------- entitlements ----------
  // 3.1F-I1B: snapshot sintético no esquema fechado (ids opacos de laboratório).
  const ruleSnap = `'{"ruleId":"${rTec.rule_id}","ruleVersion":1,"method":"fixed_amount","trigger":"first_valid_invoice_generated","fixedAmount":"30.00","attributionRole":"technician_originator","currency":"BRL"}'::jsonb`
  const attrId = (await one(`select id from public.sales_opportunity_attributions where opportunity_id=$1 and attribution_role='technician_originator'`, [opp1])).id
  const entIns = (extra = "", vals = "", k = "e1", opp = opp1) => `insert into public.employee_commission_entitlements(opportunity_id,employee_id,attribution_id,rule_id,attribution_role,trigger_kind,idempotency_key,rule_snapshot${extra}) values ('${opp}','${E.tec}','${attrId}','${rTec.rule_id}','technician_originator','first_valid_invoice_generated','${key(k)}',${ruleSnap}${vals})`
  await t("entitlement_creation_blocked_financial_rules_inactive", () => failsWith(entIns(), /financial_rules_inactive/))
  await t("entitlement_blocked_for_non_employee_origin", () => failsWith(entIns("", "", "e0", legacyRef), /commission_requires_employee_origin/))
  // Lab-only (rolled back): disable the foundation gate to prove the remaining invariants.
  const withGateOff = async (fn) => { await c.query("begin"); try { await c.query(`alter table public.employee_commission_entitlements disable trigger trg_employee_commission_entitlements_z_foundation_gate`); return await fn() } finally { await c.query("rollback") } }
  const sp = async (sqlText, re) => { await c.query("savepoint x"); try { await c.query(sqlText); await c.query("release savepoint x"); return re ? false : true } catch (e) { await c.query("rollback to savepoint x"); return re ? re.test(e.message) : false } }
  await t("entitlement_no_duplicate_same_opp_emp_role_trigger_rule", () => withGateOff(async () => (await sp(entIns())) && (await sp(entIns("", "", "e2"), /dedupe_uidx|duplicate key/))))
  await t("entitlement_evidence_rejects_erp_payload_and_pii", () => withGateOff(async () => (await sp(entIns(",evidence_snapshot", `,'{"invoice_pk":"1"}'`, "e3"), /evidence_shape/)) && (await sp(entIns(",evidence_snapshot", `,'{"payload":{}}'`, "e4"), /evidence_shape/)) && (await sp(entIns(",evidence_snapshot", `,'{"nome":"x"}'`, "e5"), /evidence_shape/)) && (await sp(entIns(",evidence_snapshot", `,'{"unknown":1}'`, "e6"), /evidence_shape/)) && (await sp(entIns(",evidence_snapshot", `,'{"evidenceKind":"not_collected","fullPaymentProven":null}'`, "e7")))))
  await t("entitlement_paid_impossible_without_close_approval", () => withGateOff(async () => (await sp(entIns(",status,amount,accrued_at", `,'paid',30,now()`, "e8"), /paid_chk|approved_chk/)) ))
  await t("entitlement_immutable_after_accrued", () => withGateOff(async () => { await c.query(entIns(",status,amount,accrued_at", `,'accrued',30,now()`, "e9")); return (await sp(`update public.employee_commission_entitlements set amount=31 where idempotency_key='${key("e9")}'`, /immutable_after_accrued/)) && (await sp(`update public.employee_commission_entitlements set employee_id='${E.ext}' where idempotency_key='${key("e9")}'`, /immutable_after_accrued/)) && (await sp(`update public.employee_commission_entitlements set rule_snapshot='{}' where idempotency_key='${key("e9")}'`, /immutable_after_accrued/)) && (await sp(`update public.employee_commission_entitlements set source='manual_admin' where idempotency_key='${key("e9")}'`, /immutable_after_accrued/)) && (await sp(`update public.employee_commission_entitlements set status='paid', approved_at=now(), approved_by='${P.am}', paid_at=now(), paid_by='${P.am}' where idempotency_key='${key("e9")}'`, /transition_forbidden/)) && (await sp(`delete from public.employee_commission_entitlements where idempotency_key='${key("e9")}'`, /no_delete/)) }))
  await t("REAL_ENTITLEMENTS_CREATED_NO", async () => (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n === 0)

  // ---------- compensation ----------
  const comp = (k, emp, salary, meal, tr, trm, fuel, fm, ss = false, sm = false, st = false, sf = false) => rpc(P.af, `public.configure_employee_compensation_draft($1,$2,'2027-01-01',null,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [key(k), emp, salary, meal, tr, trm, fuel, fm, ss, sm, st, sf])
  const cp1 = await comp("c1", E.tec, null, 22, null, null, null, null, false, true)
  await t("compensation_draft_created", async () => cp1.ok && (await one(`select status from public.employee_compensation_profiles where id=$1`, [cp1.profile_id])).status === "draft")
  await t("missing_salary_employee_sees_only_commission_and_enabled", async () => JSON.stringify((await one(`select public.employee_compensation_visible_components(p) v from public.employee_compensation_profiles p where id=$1`, [cp1.profile_id])).v) === JSON.stringify(["commission", "meal"]))
  const cp0 = await comp("c0", E.ext, null, null, null, null, null, null)
  await t("no_components_configured_only_commission", async () => JSON.stringify((await one(`select public.employee_compensation_visible_components(p) v from public.employee_compensation_profiles p where id=$1`, [cp0.profile_id])).v) === JSON.stringify(["commission"]))
  const cp2 = await comp("c2", E.tec, 1000, 22, 10, "per_worked_day", null, null, false, true, true)
  await t("disabled_or_hidden_components_do_not_appear", async () => cp2.version === 2 && JSON.stringify((await one(`select public.employee_compensation_visible_components(p) v from public.employee_compensation_profiles p where id=$1`, [cp2.profile_id])).v) === JSON.stringify(["commission", "meal", "transport"]))
  await t("show_without_enabled_rejected", async () => (await comp("c3", E.tec, null, null, null, null, null, null, true)).code === "invalid_compensation")
  await t("compensation_forbidden_for_non_finance", async () => (await rpc(P.co, `public.configure_employee_compensation_draft($1,$2,'2027-01-01',null,null,22,null,null,null,null)`, [key("c4"), E.tec])).code === "forbidden")
  await t("compensation_active_impossible", () => failsWith(`update public.employee_compensation_profiles set status='active' where id='${cp1.profile_id}'`, /transition_forbidden|foundation_inactive/))
  await t("compensation_snapshot_immutable", () => failsWith(`update public.employee_compensation_profiles set meal_daily_amount=30 where id='${cp1.profile_id}'`, /snapshot_immutable/))

  // ---------- calendar / timezone ----------
  await t("competence_feb_non_leap", async () => (await one(`select public.payroll_competence_period_end('2027-02-01')::text v`)).v === "2027-02-28")
  await t("competence_feb_leap", async () => (await one(`select public.payroll_competence_period_end('2028-02-01')::text v`)).v === "2028-02-29")
  await t("competence_dec_end", async () => (await one(`select public.payroll_competence_period_end('2026-12-01')::text v`)).v === "2026-12-31")
  await t("tz_dec_jan_rollover_sao_paulo", async () => { const r = await one(`select public.payroll_competence_month_for('2027-01-01T02:59:59Z')::text a, public.payroll_competence_month_for('2027-01-01T03:00:00Z')::text b`); return r.a === "2026-12-01" && r.b === "2027-01-01" })
  await t("tz_leap_day_boundary_sao_paulo", async () => { const r = await one(`select public.payroll_competence_month_for('2028-03-01T02:30:00Z')::text a, public.payroll_competence_month_for('2028-03-01T03:00:00Z')::text b`); return r.a === "2028-02-01" && r.b === "2028-03-01" })
  await t("tz_america_sao_paulo_offset_utc_minus_3", async () => (await one(`select to_char(('2026-11-06T12:00:00Z'::timestamptz at time zone 'America/Sao_Paulo'), 'HH24:MI') v`)).v === "09:00")

  // ---------- worked days + daily benefit ----------
  const wd = (k, emp, d, st, meal) => rpc(P.af, `public.record_employee_worked_day($1,$2,$3,$4,$5)`, [key(k), emp, d, st, meal])
  for (const [k, d] of [["w1", "2028-02-27"], ["w2", "2028-02-28"], ["w3", "2028-02-29"]]) await wd(k, E.tec, d, "worked", true)
  await wd("w4", E.tec, "2028-02-26", "absent", false)
  const eligible = async () => (await one(`select count(*)::int n from public.employee_worked_days where employee_id=$1 and meal_eligible and work_date between '2028-02-01' and public.payroll_competence_period_end('2028-02-01')`, [E.tec])).n
  await t("daily_benefit_times_eligible_days", async () => (await eligible()) === 3 && (await one(`select public.payroll_daily_benefit_preview(22, 3)::text v`)).v === "66.00")
  await t("worked_day_same_operation_idempotent", async () => (await wd("w1", E.tec, "2028-02-27", "worked", true)).idempotent === true && (await one(`select count(*)::int n from public.employee_worked_days where employee_id=$1 and work_date='2028-02-27'`, [E.tec])).n === 1)
  await t("worked_day_change_audited_before_after", async () => { const r = await wd("w5", E.tec, "2028-02-29", "holiday", false); const a = await one(`select before_state, after_state from public.finance_audit_events where action='worked_day_changed' and entity_id=$1`, [r.worked_day_id]); return r.ok && a.before_state.status === "worked" && a.after_state.status === "holiday" && (await eligible()) === 2 })
  await t("meal_only_for_worked_days", async () => (await wd("w6", E.tec, "2028-02-25", "absent", true)).code === "invalid_worked_day")
  await t("worked_day_forbidden_for_non_finance", async () => (await rpc(P.tec, `public.record_employee_worked_day($1,$2,'2028-02-24','worked',true)`, [key("w7"), E.tec])).code === "forbidden")
  await t("worked_day_after_closed_requires_adjustment", async () => { await c.query("begin"); try { await c.query(`alter table public.payroll_competences drop constraint payroll_competences_foundation_no_close_pay_chk`); await c.query(`insert into public.payroll_competences(employee_id,competence_month,period_start,period_end,status,closed_at,closed_by,idempotency_key) values ($1,'2028-03-01','2028-03-01','2028-03-31','closed',now(),$2,$3)`, [E.tec, P.am, key("closed")]); await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [P.af]); const r = (await c.query(`select public.record_employee_worked_day($1,$2,'2028-03-02','worked',true) r`, [key("w8"), E.tec])).rows[0].r; let direct = false; try { await c.query("savepoint d"); await c.query(`insert into public.employee_worked_days(employee_id,work_date,status,operation_id) values ($1,'2028-03-03','worked',$2)`, [E.tec, key("w9")]) } catch (e) { direct = /competence_closed_requires_adjustment/.test(e.message); await c.query("rollback to savepoint d") } return r.code === "competence_closed_requires_adjustment" && direct } finally { await c.query("rollback") } })
  await t("worked_day_delete_blocked", () => failsWith(`delete from public.employee_worked_days`, /no_delete/))

  // ---------- competences + adjustments ----------
  const op = (k, emp, m) => rpc(P.am, `public.open_payroll_competence_draft($1,$2,$3)`, [key(k), emp, m])
  const cmp = await op("p1", E.tec, "2028-02-15")
  await t("competence_open_normalized_draft_no_lines_no_calc", async () => { const r = await one(`select competence_month::text m, period_end::text e, status, net_total::text n, timezone, (select count(*)::int from public.payroll_competence_lines l where l.competence_id=c.id) lines from public.payroll_competences c where id=$1`, [cmp.competence_id]); return r.m === "2028-02-01" && r.e === "2028-02-29" && r.status === "draft" && r.n === "0.00" && r.lines === 0 && r.timezone === "America/Sao_Paulo" })
  await t("competence_open_twice_same_month_idempotent", async () => (await op("p2", E.tec, "2028-02-01")).competence_id === cmp.competence_id && (await one(`select count(*)::int n from public.payroll_competences where employee_id=$1 and competence_month='2028-02-01'`, [E.tec])).n === 1)
  await t("competence_close_pay_impossible", () => failsWith(`update public.payroll_competences set status='closed', closed_at=now(), closed_by='${P.am}' where id='${cmp.competence_id}'`, /no_close_pay/))
  const adj = (k, comp, type, amt, reason, desc = "Ajuste manual lab") => rpc(P.af, `public.add_manual_payroll_adjustment($1,$2,$3,$4,$5,$6)`, [key(k), comp, type, amt, desc, reason])
  await t("adjustment_reason_required", async () => (await adj("j0", cmp.competence_id, "adjustment", 10, "")).code === "reason_required")
  const j1 = await adj("j1", cmp.competence_id, "adjustment", 10.004, "correcao lab")
  await t("adjustment_added_with_audit_reason", async () => j1.ok && (await one(`select amount::text a from public.payroll_competence_lines where id=$1`, [j1.line_id])).a === "10.00" && (await one(`select a.reason from public.payroll_competence_lines l join public.finance_audit_events a on a.id=l.adjustment_audit_event_id where l.id=$1`, [j1.line_id])).reason === "correcao lab")
  await t("adjustment_same_key_idempotent", async () => (await adj("j1", cmp.competence_id, "adjustment", 10, "correcao lab")).idempotent === true && (await one(`select count(*)::int n from public.payroll_competence_lines where competence_id=$1`, [cmp.competence_id])).n === 1)
  await t("adjustment_same_key_different_payload_conflict", async () => (await adj("j1", cmp.competence_id, "adjustment", 11, "correcao lab")).code === "idempotency_conflict")
  await t("adjustment_description_sanitized", async () => (await adj("j2", cmp.competence_id, "adjustment", 5, "lab", "cpf 12345678901")).code === "invalid_adjustment")
  await t("adjustment_only_draft_or_reviewed", async () => { await c.query(`update public.payroll_competences set status='calculated' where id=$1`, [cmp.competence_id]); const r = await adj("j3", cmp.competence_id, "adjustment", 5, "lab motivo"); await c.query(`update public.payroll_competences set status='reviewed' where id=$1`, [cmp.competence_id]); const r2 = await adj("j4", cmp.competence_id, "discount", -5, "lab motivo"); return r.code === "competence_not_adjustable" && r2.ok })
  await t("lines_append_only", async () => (await failsWith(`update public.payroll_competence_lines set amount=1`, /append_only/)) && (await failsWith(`delete from public.payroll_competence_lines`, /append_only/)) && (await failsWith(`truncate public.payroll_competence_lines`, /append_only/)))
  await t("audit_append_only_even_owner", async () => (await failsWith(`update public.finance_audit_events set reason='x'`, /append_only/)) && (await failsWith(`delete from public.finance_audit_events`, /append_only/)) && (await failsWith(`truncate public.finance_audit_events`, /append_only|referenced in a foreign key/)) && (await failsWith(`truncate public.finance_audit_events cascade`, /append_only/)))
  await t("audit_reason_required_for_sensitive_actions", async () => { for (const a of ["approve", "adjust", "reverse", "reopen", "pay"]) if (!(await failsWith(`insert into public.finance_audit_events(action,entity_type,entity_id,operation_id) values ('${a}','payroll_competence','${cmp.competence_id}','${key("aud-" + a)}')`, /reason_required/))) return false; return true })
  await t("audit_rejects_pii_keys", () => failsWith(`insert into public.finance_audit_events(action,entity_type,entity_id,operation_id,after_state) values ('worked_day_recorded','employee_worked_day',(select id from public.employee_worked_days limit 1),'${key("aud-pii")}','{"cpf":"x"}')`, /after_safe/))

  // ---------- transactional rollback ----------
  await t("full_rollback_on_error", async () => { const n0 = (await one(`select count(*)::int n from public.payroll_competences`)).n; const a0 = (await one(`select count(*)::int n from public.finance_audit_events`)).n; await c.query("begin"); try { await c.query("set local role authenticated"); await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [P.am]); await c.query(`select public.open_payroll_competence_draft($1,$2,'2029-05-01')`, [key("rb"), E.ext]); await c.query(`select 1/0`) } catch { } finally { await c.query("rollback") } return (await one(`select count(*)::int n from public.payroll_competences`)).n === n0 && (await one(`select count(*)::int n from public.finance_audit_events`)).n === a0 })

  // ---------- concurrency (independent PG connections) ----------
  for (let i = 0; i < 6; i++) { const k = new Client(conn); await k.connect(); pool.push(k) }
  const onUser = async (k, uid, s, p) => { try { await k.query("begin"); await k.query("set local role authenticated"); await k.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]); const r = (await k.query(`select ${s} r`, p)).rows[0].r; await k.query("commit"); return r } catch (e) { await k.query("rollback").catch(() => {}); return { ok: false, err: e.message } } }
  const par = (s, pFn, uid = P.am) => Promise.all(pool.map((k, i) => onUser(k, uid, s, pFn(i))))
  const opp3 = await newOpp("3")
  const ca = await par(`public.attribute_employee_sales_opportunity($1,$2,$3,'external_sales_originator',$4)`, () => [key("ca"), opp3, E.ext, sec.external_sales])
  await t("CC1_parallel_identical_attributions_one_row", async () => ca.every(x => x.ok) && (await one(`select count(*)::int n from public.sales_opportunity_attributions where opportunity_id=$1 and attribution_role='external_sales_originator'`, [opp3])).n === 1)
  const crd = await par(`public.create_commission_rule_draft($1,null,'technician_originator','fixed_amount','first_valid_invoice_generated',30,null,null,'2027-06-01')`, (i) => [key("cr" + i)])
  await t("CC2_parallel_distinct_drafts_all_allowed", async () => crd.every(x => x.ok && !x.idempotent) && (await one(`select count(*)::int n from public.employee_commission_rules where effective_from='2027-06-01'`)).n === 6)
  const crs = await par(`public.create_commission_rule_draft($1,null,'technician_originator','fixed_amount','first_valid_invoice_generated',30,null,null,'2027-07-01')`, () => [key("crsame")])
  await t("CC3_parallel_same_key_draft_one_row", async () => crs.every(x => x.ok) && (await one(`select count(*)::int n from public.employee_commission_rules where effective_from='2027-07-01'`)).n === 1)
  const cv = await par(`public.version_commission_rule_draft($1,$2,'fixed_amount','first_valid_invoice_generated',70,null,null,'2027-08-01')`, (i) => [key("cv" + i), v2.rule_id])
  await t("CC4_parallel_versioning_single_winner", async () => cv.filter(x => x.ok).length === 1 && cv.filter(x => x.code === "rule_not_latest_draft").length === 5 && (await one(`select count(*)::int n from public.employee_commission_rules where rule_family_id=(select rule_family_id from public.employee_commission_rules where id=$1)`, [v2.rule_id])).n === 3)
  const cc = await par(`public.open_payroll_competence_draft($1,$2,'2029-01-20')`, (i) => [key("cc" + i), E.ext])
  await t("CC5_parallel_same_competence_one_row", async () => cc.every(x => x.ok) && new Set(cc.map(x => x.competence_id)).size === 1 && (await one(`select count(*)::int n from public.payroll_competences where employee_id=$1 and competence_month='2029-01-01'`, [E.ext])).n === 1)
  const cw = await par(`public.record_employee_worked_day($1,$2,'2029-01-15','worked',true)`, () => [key("cw"), E.ext], P.af)
  await t("CC6_parallel_same_worked_day_one_row", async () => cw.every(x => x.ok) && (await one(`select count(*)::int n from public.employee_worked_days where employee_id=$1 and work_date='2029-01-15'`, [E.ext])).n === 1)
  const cj = await par(`public.add_manual_payroll_adjustment($1,$2,'adjustment',7,'Ajuste lab','motivo lab')`, () => [key("cj"), cc[0].competence_id], P.af)
  await t("CC7_parallel_same_adjustment_key_one_line", async () => cj.every(x => x.ok) && (await one(`select count(*)::int n from public.payroll_competence_lines where competence_id=$1`, [cc[0].competence_id])).n === 1)
  const cpr = await par(`public.configure_employee_compensation_draft($1,$2,'2027-01-01',null,null,22,null,null,null,null)`, (i) => [key("cp" + i), E.com], P.af)
  await t("CC8_parallel_compensation_versions_serialized", async () => cpr.every(x => x.ok) && JSON.stringify(cpr.map(x => x.version).sort()) === JSON.stringify([1, 2, 3, 4, 5, 6]))

  // ---------- final invariants ----------
  await t("REAL_PAYROLL_CREATED_NO_only_lab_fixtures", async () => (await one(`select count(*)::int n from public.payroll_competences c join public.employees e on e.id=c.employee_id where e.profile_id <> all($1::uuid[])`, [Object.values(P)])).n === 0)
  await t("RETROACTIVE_CALCULATION_NO", async () => (await one(`select count(*)::int n from public.employee_commission_rules where retroactive`)).n === 0 && (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n === 0)
  await t("final_no_mutation_rewards_wallet", async () => { const h = await finHash(); return h.rewards === pre.rewards && h.wallet === pre.wallet && h.n_rewards === 24 })
  await t("reapply_with_data_preserves_rows", async () => { const before = await countsAll(); await c.query(sql); return JSON.stringify(before) === JSON.stringify(await countsAll()) })
} finally {
  await Promise.all(pool.map(k => k.end().catch(() => {})))
  await stopCollectionsLab()
}
for (const r of res) console.log(r.join(" | "))
const pass = res.filter(r => r[1] === "PASS").length
console.log(`I1_TESTS=${pass}/${res.filter(r => r[1] === "PASS" || String(r[1]).startsWith("FAIL")).length}`)
console.log(ok ? "I1_LAB=PASS" : "I1_LAB=FAIL")
process.exit(ok ? 0 : 1)

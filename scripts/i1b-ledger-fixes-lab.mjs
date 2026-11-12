// 3.1F-I1B local PG validation of the I2 review fixes (127.0.0.1 only). No remote. No ERP.
// Lab isolado: IGT_PG_LAB_ROOT (default %LOCALAPPDATA%/igt-pg-i1b-lab).
// Porta própria (IGT_PG_LAB_PORT, default 55464) para não colidir com labs antigos
// em 55434. O harness compartilhado é carregado sem alteração no repositório:
// apenas PORT e o diretório-base são substituídos numa cópia dentro do lab root.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
const HERE = dirname(fileURLToPath(import.meta.url))
const LAB_ROOT = (process.env.IGT_PG_LAB_ROOT ||= join(process.env.LOCALAPPDATA || homedir(), "igt-pg-i1b-lab"))
const LAB_PORT = Number(process.env.IGT_PG_LAB_PORT || 55464)
if (!Number.isInteger(LAB_PORT) || LAB_PORT === 55434) throw new Error("I1B lab must not use port 55434")
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
const runCopy = join(LAB_ROOT, "run-i1b.mjs")
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
const key = (s) => (s + "-i1b-lab-key-00000000000").slice(0, 32)
const { client: c, conn, Client } = await startCollectionsLab()
const pool = []
try {
  const q = async (sql, p = []) => (await c.query(sql, p)).rows
  const one = async (sql, p = []) => (await q(sql, p))[0]
  const t = async (name, fn) => { try { const v = await fn(); res.push([name, v === true ? "PASS" : "FAIL " + JSON.stringify(v)]); if (v !== true) ok = false } catch (e) { await c.query("rollback").catch(() => {}); res.push([name, "FAIL " + e.message]); console.log("FAIL", name, e.message); ok = false } }
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
  // (after H1/H1B so their own fail-closed checks are unaffected)
  // Supabase-like default privileges: new tables/functions would be granted to client roles unless explicitly revoked.
  await c.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant execute on functions to anon, authenticated, service_role")

  const finHash = async () => one(`select
     (select md5(coalesce(string_agg(r::text, '|' order by r.id), '')) from public.rewards r) rewards,
     (select md5(coalesce(string_agg(w::text, '|' order by w.id), '')) from public.wallet_transactions w) wallet,
     (select md5(coalesce(string_agg(x.id::text || x.updated_at::text || x.origin_kind, '|' order by x.id), '')) from public.referrals x) referrals,
     (select count(*)::int from public.referrals) n_ref,
     (select count(*)::int from public.referrals where origin_kind='legacy') n_legacy,
     (select count(*)::int from public.rewards) n_rewards,
     (select count(*)::int from public.sales_opportunity_attributions) n_attr`)
  const pre = await finHash()
  // ---------- H. lock strategy: conflicting lock => whole migration aborts, no residue ----------
  const sql = readFileSync(join(REPO_ROOT, I1), "utf8")
  const procs0 = (await q(`select oid::int o from pg_proc where pronamespace='public'::regnamespace`)).map(r => r.o)
  {
    const holder = new Client(conn); await holder.connect(); pool.push(holder)
    await holder.query("begin"); await holder.query("lock table public.sales_opportunity_attributions in access share mode")
    const t0 = Date.now(); let err = ""
    try { await c.query(sql) } catch (e) { err = e.message + " " + (e.code || "") } finally { await c.query("rollback").catch(() => {}) }
    const ms = Date.now() - t0
    await holder.query("rollback")
    await t("LOCK_timeout_aborts_migration", () => /lock timeout|55P03/.test(err) || err)
    await t("LOCK_never_waits_indefinitely_lt_10s", () => ms < 10000 || ms)
    await t("LOCK_rollback_no_residue", async () => (await one(`select to_regclass('public.finance_audit_events') a, to_regclass('public.payroll_competence_lines') b, (select count(*)::int from information_schema.columns where table_name='sales_opportunity_attributions' and column_name='idempotency_key') c, (select count(*)::int from pg_proc where pronamespace='public'::regnamespace and proname like 'finance_%') f`)).a === null && (await one(`select to_regclass('public.payroll_competence_lines') b`)).b === null && (await one(`select count(*)::int c from information_schema.columns where table_name='sales_opportunity_attributions' and column_name='idempotency_key'`)).c === 0 && (await one(`select count(*)::int f from pg_proc where pronamespace='public'::regnamespace and proname like 'finance\\_%'`)).f === 0)
    await t("LOCK_rollback_financial_data_unchanged", async () => JSON.stringify(await finHash()) === JSON.stringify(pre))
    await t("LOCK_settings_local_not_leaked", async () => (await one(`select current_setting('lock_timeout') l, current_setting('statement_timeout') s`)).l === "0" )
  }

  // ---------- apply / reapply ----------
  await t("apply_i1b_first", async () => { await c.query(sql); return true })
  await t("apply_i1b_reapply_idempotent", async () => { await c.query(sql); return true })
  await t("apply_no_mutation_rewards_wallet_referrals", async () => JSON.stringify(await finHash()) === JSON.stringify(pre))
  const countsAll = async () => Object.fromEntries(await Promise.all(NEW_TABLES.map(async x => [x, (await one(`select count(*)::int n from public.${x}`)).n])))
  await t("apply_zero_financial_rows", async () => Object.values(await countsAll()).every(n => n === 0))
  await t("preflight_duplicates_zero_backfill_zero", async () => { const r = await c.query(readFileSync(join(REPO_ROOT, "supabase/preflight-employee-commission-payroll-ledger-3-1f-i1.sql"), "utf8")); const rows = r.find(x => x.command === "SELECT").rows; const m = Object.fromEntries(rows.map(x => [x.metric, String(x.value)])); return (m.backfill_required === "0" && m.attributions_duplicate_opportunity_employee === "0" && m.attributions_duplicate_opportunity_role === "0") || m })
  const newProcs = (await q(`select oid::int o, proname, oid::regprocedure::text sig, prosrc, proacl::text acl from pg_proc where pronamespace='public'::regnamespace`)).filter(r => !procs0.includes(r.o))
  await t("new_functions_detected", () => newProcs.length >= 30 || newProcs.length)

  // ---------- E/G. dynamic SQL + grants ----------
  await t("DYNAMIC_SQL_NONE_in_new_functions", () => newProcs.filter(p => /\bexecute\b/i.test(p.prosrc) || /format\s*\(/i.test(p.prosrc)).map(p => p.proname).join(",") === "" || newProcs.filter(p => /\bexecute\b/i.test(p.prosrc) || /format\s*\(/i.test(p.prosrc)).map(p => p.proname).join(","))
  await t("DYNAMIC_SQL_NONE_in_migration_text", () => !/\bexecute\s+(format|'|\$|v_)/i.test(sql.replace(/--[^\n]*/g, "")) && !/format\s*\(/i.test(sql.replace(/--[^\n]*/g, "")))
  await t("no_new_function_executable_by_PUBLIC", () => newProcs.every(p => p.acl !== null && !/(^|[{,])=X/.test(p.acl)) || newProcs.filter(p => p.acl === null || /(^|[{,])=X/.test(p.acl)).map(p => p.proname).join(","))
  const RPC_NAMES = RPCS.map(s => s.replace(/^public\.|\(.*$/g, ""))
  const grantRows = await q(`select p.proname, has_function_privilege('anon',p.oid,'execute') an, has_function_privilege('authenticated',p.oid,'execute') au, has_function_privilege('service_role',p.oid,'execute') sr from pg_proc p where p.oid = any($1::oid[])`, [newProcs.map(p => p.o)])
  await t("RPCS_execute_authenticated_only", () => grantRows.filter(r => RPC_NAMES.includes(r.proname)).every(r => r.au && !r.an && !r.sr) && grantRows.filter(r => RPC_NAMES.includes(r.proname)).length === 7)
  await t("HELPERS_TRIGGERS_no_client_or_service_role_execute", () => grantRows.filter(r => !RPC_NAMES.includes(r.proname)).every(r => !r.au && !r.an && !r.sr) || grantRows.filter(r => !RPC_NAMES.includes(r.proname) && (r.au || r.an || r.sr)).map(r => r.proname).join(","))
  await t("tables_no_client_privileges_service_role_select_only", async () => (await one(`select bool_or(has_table_privilege(r, 'public.'||t, p)) v from unnest($1::text[]) t, unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete','truncate','references','trigger']) p`, [NEW_TABLES])).v === false && (await one(`select bool_or(has_table_privilege('service_role','public.'||t,p)) w, bool_and(has_table_privilege('service_role','public.'||t,'select')) s from unnest($1::text[]) t, unnest(array['insert','update','delete','truncate','references','trigger']) p`, [NEW_TABLES])).w === false)
  await t("attributions_no_write_privileges_clients_service_role", async () => (await one(`select bool_or(has_table_privilege(r,'public.sales_opportunity_attributions',p)) v from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate']) p`)).v === false)
  await t("RLS_enabled_all_and_no_new_policies", async () => (await one(`select bool_and(relrowsecurity) v from pg_class where relnamespace='public'::regnamespace and relname = any($1)`, [[...NEW_TABLES, "sales_opportunity_attributions"]])).v === true && (await one(`select count(*)::int n from pg_policies where schemaname='public' and tablename = any($1)`, [NEW_TABLES])).n === 0)
  await t("no_float_columns_new_tables", async () => (await one(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name = any($1) and data_type in ('real','double precision')`, [NEW_TABLES])).n === 0)
  await t("percentage_rate_numeric_7_6", async () => (await one(`select numeric_precision p, numeric_scale s from information_schema.columns where table_name='employee_commission_rules' and column_name='percentage_rate'`)).s === 6)

  // ---------- fixtures ----------
  const P = { am: "44444444-0000-0000-0000-000000000001", af: "44444444-0000-0000-0000-000000000002", tec: "44444444-0000-0000-0000-000000000003", ext: "44444444-0000-0000-0000-000000000004", com: "44444444-0000-0000-0000-000000000005", mul: "44444444-0000-0000-0000-000000000006", ex2: "44444444-0000-0000-0000-000000000007", ac: "44444444-0000-0000-0000-000000000008" }
  await c.query(`insert into public.profiles(id,email,role) values ($1,'am1@x','admin_master'),($2,'af1@x','admin_financeiro'),($3,'te1@x','funcionario'),($4,'ex1@x','funcionario'),($5,'cm1@x','funcionario'),($6,'mu1@x','funcionario'),($7,'e21@x','funcionario'),($8,'ac1@x','admin_consulta')`, Object.values(P))
  const sec = Object.fromEntries((await q(`select code, id from public.sectors`)).map(r => [r.code, r.id]))
  const E = {}
  for (const [k, ss] of [["tec", ["technician"]], ["ext", ["external_sales"]], ["com", ["commercial"]], ["mul", ["external_sales", "commercial"]], ["ex2", ["external_sales"]]]) {
    E[k] = (await one(`insert into public.employees(profile_id,status) values ($1,'active') returning id`, [P[k]])).id
    for (const s of ss) await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id) values ($1,$2) on conflict do nothing`, [E[k], sec[s]])
  }
  const newOpp = async (k) => (await rpc(P.tec, `public.create_employee_sales_opportunity($1,'technician_originator',$2,$3,'n','1')`, [key("opp-" + k), sec.technician, plan])).opportunity_id
  const att = (uid, k, opp, emp, role, s) => rpc(uid, `public.attribute_employee_sales_opportunity($1,$2,$3,$4,$5)`, [key(k), opp, emp, role, s])
  const rewards0 = (await one(`select count(*)::int n from public.rewards`)).n

  // ---------- A. attributions ----------
  const opp1 = await newOpp("1")
  const a1 = await att(P.am, "a1", opp1, E.ext, "external_sales_originator", sec.external_sales)
  const a2 = await att(P.af, "a2", opp1, E.com, "internal_sales_responsible", sec.commercial)
  await t("A_different_roles_different_employees_allowed", async () => a1.ok && a2.ok && !a1.idempotent && (await one(`select count(*)::int n, count(distinct employee_id)::int d from public.sales_opportunity_attributions where opportunity_id=$1`, [opp1])).d === 3)
  await t("A_unique_opportunity_employee_exists", async () => (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname='sales_opportunity_attributions_employee_uq'`)).d === "UNIQUE (opportunity_id, employee_id)")
  await t("A_unique_opportunity_role_kept", async () => (await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname='sales_opportunity_attributions_role_uq'`)).d === "UNIQUE (opportunity_id, attribution_role)")
  const opp2 = await newOpp("2")
  await t("A_same_employee_two_roles_rpc_blocked", async () => (await att(P.am, "a3", opp2, E.tec, "external_sales_originator", sec.external_sales)).code === "employee_already_attributed")
  const am1 = await att(P.am, "a4", opp2, E.mul, "external_sales_originator", sec.external_sales)
  await t("A_multi_sector_employee_second_role_rpc_blocked", async () => am1.ok && (await att(P.am, "a5", opp2, E.mul, "internal_sales_responsible", sec.commercial)).code === "employee_already_attributed")
  await t("A_same_employee_two_roles_direct_insert_unique_violation", () => failsWith(`insert into public.sales_opportunity_attributions(opportunity_id,employee_id,attribution_role,source) values ('${opp2}','${E.mul}','internal_sales_responsible','attribution_rpc')`, /employee_uq/))
  await t("A_two_employees_same_role_rpc_blocked", async () => (await att(P.am, "a6", opp2, E.ex2, "external_sales_originator", sec.external_sales)).code === "attribution_role_taken")
  await t("A_two_employees_same_role_direct_insert_unique_violation", () => failsWith(`insert into public.sales_opportunity_attributions(opportunity_id,employee_id,attribution_role,source) values ('${opp2}','${E.ex2}','external_sales_originator','attribution_rpc')`, /role_uq/))
  await t("A_idempotent_replay_returns_original_row", async () => { const r = await att(P.am, "a1", opp1, E.ext, "external_sales_originator", sec.external_sales); return r.ok && r.idempotent === true && r.attribution_id === a1.attribution_id && (await one(`select count(*)::int n from public.sales_opportunity_attributions where opportunity_id=$1`, [opp1])).n === 3 })
  await t("A_idempotency_key_reuse_other_payload_conflict", async () => (await att(P.am, "a1", opp2, E.com, "internal_sales_responsible", sec.commercial)).code === "idempotency_conflict")
  for (const [col, val] of [["opportunity_id", `'${opp2}'`], ["employee_id", `'${E.ex2}'`], ["attribution_role", `'internal_sales_responsible'`], ["source", `'employee_opportunity_rpc'`], ["idempotency_key", `'${key("zz")}'`], ["attributed_at", "now()"], ["attributed_by", "null"], ["created_at", "now()"], ["metadata", `'{}'`], ["updated_at", "now()"]])
    await t(`A_owner_update_${col}_blocked`, () => failsWith(`update public.sales_opportunity_attributions set ${col}=${val} where id='${a1.attribution_id}'`, /attribution_immutable/))
  await t("A_owner_delete_blocked", () => failsWith(`delete from public.sales_opportunity_attributions where id='${a1.attribution_id}'`, /attribution_no_delete/))
  await t("A_owner_truncate_blocked", () => failsWith(`truncate public.sales_opportunity_attributions`, /append_only|referenced in a foreign key/))
  await t("A_owner_truncate_cascade_blocked_by_trigger", () => failsWith(`truncate public.sales_opportunity_attributions cascade`, /append_only|no_delete/))
  await t("A_no_reassignment_rpc", async () => (await one(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname ~ '(reassign|replace|update|delete).*attribution'`)).n === 0)
  await t("A_h1_create_employee_opportunity_replay_still_idempotent", async () => { const r = await rpc(P.tec, `public.create_employee_sales_opportunity($1,'technician_originator',$2,$3,'n','1')`, [key("opp-1"), sec.technician, plan]); return r.ok && r.idempotent === true && r.opportunity_id === opp1 })
  await t("A_employee_never_creates_reward", async () => (await one(`select count(*)::int n from public.rewards`)).n === rewards0 && (await one(`select count(*)::int n from public.rewards w join public.referrals r on r.id=w.referral_id where r.origin_kind='employee'`)).n === 0)
  await t("A_attribution_audit_event_entity_exists", async () => (await one(`select count(*)::int n from public.finance_audit_events where entity_type='sales_opportunity_attribution' and entity_id=$1`, [a1.attribution_id])).n === 1)

  // ---------- F. percentage storage + rounding ----------
  const draft = (k, method, trig, fixed, rate) => rpc(P.am, `public.create_commission_rule_draft($1,null,'internal_sales_responsible',$2,$3,$4,$5,null,'2027-01-01')`, [key(k), method, trig, fixed, rate])
  for (const [k, rate, txt] of [["p2", "0.02", "0.020000"], ["p15", "0.015", "0.015000"], ["p0125", "0.00125", "0.001250"], ["p100", "1", "1.000000"]]) {
    const r = await draft(k, "percentage", "first_valid_invoice_generated", null, rate)
    await t(`F_rate_${k}_stored_${txt}`, async () => r.ok && (await one(`select percentage_rate::text v from public.employee_commission_rules where id=$1`, [r.rule_id])).v === txt)
  }
  for (const [k, rate] of [["z0", "0"], ["neg", "-0.01"], ["gt1", "1.000001"], ["gt1b", "1.5"], ["prec7", "0.0000001"], ["prec7b", "0.0150001"]])
    await t(`F_rate_${k}_rejected`, async () => (await draft(k, "percentage", "first_valid_invoice_generated", null, rate)).code === "invalid_percentage_rate")
  for (const [b, r, exp] of [["0.25", "0.02", "0.01"], ["10.25", "0.5", "5.13"], ["-10.25", "0.5", "-5.13"], ["100", "0.015", "1.50"], ["99.99", "0.00125", "0.12"], ["1000", "1", "1000.00"], ["0.10", "0.05", "0.01"], ["0.09", "0.05", "0.00"]])
    await t(`F_round_${b}x${r}=${exp}`, async () => (await one(`select public.finance_percentage_amount($1::numeric,$2::numeric)::text v`, [b, r])).v === exp)
  await t("F_amount_helper_rejects_invalid_rate", async () => { const r = await one(`select public.finance_percentage_amount(10,0) a, public.finance_percentage_amount(10,1.5) b, public.finance_percentage_amount(10,0.0000001) c`); return r.a === null && r.b === null && r.c === null })
  await t("F_no_rpc_computes_percentage_money", () => newProcs.filter(p => RPC_NAMES.includes(p.proname)).every(p => !/finance_percentage_amount/.test(p.prosrc)))
  await t("F_no_rate_rounded_to_2_decimals", () => !/round\(\s*p_percentage_rate\s*,\s*2\s*\)/i.test(sql))

  // ---------- C. closed snapshot schemas ----------
  const v = async (fn, j) => (await one(`select public.${fn}($1::jsonb) v`, [j])).v
  const ruleOk = { ruleId: "00000000-0000-4000-8000-000000000001", ruleVersion: 1, method: "percentage", trigger: "first_valid_invoice_generated", fixedAmount: null, percentageRate: "0.015000", percentageBase: null, effectiveFrom: "2027-01-01", effectiveUntil: null, attributionRole: "internal_sales_responsible", currency: "BRL" }
  await t("C_rule_snapshot_full_valid", async () => (await v("finance_rule_snapshot_valid", JSON.stringify(ruleOk))) === true)
  await t("C_rule_snapshot_minimal_valid", async () => (await v("finance_rule_snapshot_valid", JSON.stringify({ ruleId: ruleOk.ruleId, ruleVersion: 2, method: "fixed_amount", trigger: "first_valid_invoice_generated", fixedAmount: "30.00", attributionRole: "technician_originator", currency: "BRL" }))) === true)
  const ruleBad = { extra: { ...ruleOk, foo: 1 }, name: { ...ruleOk, name: "x" }, nome: { ...ruleOk, nome: "x" }, phone: { ...ruleOk, phone: "1" }, email: { ...ruleOk, email: "a" }, cpf: { ...ruleOk, cpf: "1" }, cnpj: { ...ruleOk, cnpj: "1" }, address: { ...ruleOk, address: "x" }, erp_payload: { ...ruleOk, erp_payload: {} }, token: { ...ruleOk, token: "t" }, cookie: { ...ruleOk, cookie: "c" }, http_response: { ...ruleOk, http_response: "r" }, notes: { ...ruleOk, notes: "n" },
    ruleId_not_uuid: { ...ruleOk, ruleId: "abc" }, ruleVersion_string: { ...ruleOk, ruleVersion: "1" }, ruleVersion_float: { ...ruleOk, ruleVersion: 1.5 }, ruleVersion_zero: { ...ruleOk, ruleVersion: 0 }, method_unknown: { ...ruleOk, method: "bonus" }, trigger_unknown: { ...ruleOk, trigger: "x" }, currency_usd: { ...ruleOk, currency: "USD" }, role_unknown: { ...ruleOk, attributionRole: "boss" },
    fixed_number: { ...ruleOk, fixedAmount: 30 }, fixed_3dec: { ...ruleOk, fixedAmount: "30.005" }, rate_number: { ...ruleOk, percentageRate: 0.015 }, rate_7dec: { ...ruleOk, percentageRate: "0.0150001" }, rate_gt1: { ...ruleOk, percentageRate: "1.5" }, rate_zero: { ...ruleOk, percentageRate: "0" }, base_text: { ...ruleOk, percentageBase: "monthly" }, date_invalid: { ...ruleOk, effectiveFrom: "2027-13-01" }, date_ts: { ...ruleOk, effectiveFrom: "2027-01-01T00:00:00Z" }, nested: { ...ruleOk, method: { a: 1 } }, missing_required: (({ currency, ...r }) => r)(ruleOk) }
  for (const [k, j] of Object.entries(ruleBad)) await t(`C_rule_snapshot_rejects_${k}`, async () => (await v("finance_rule_snapshot_valid", JSON.stringify(j))) === false)
  await t("C_rule_snapshot_rejects_array_and_scalar", async () => (await v("finance_rule_snapshot_valid", "[]")) === false && (await v("finance_rule_snapshot_valid", '"x"')) === false)
  const evOk = { evidenceKind: "not_collected", contractIdentityPresent: false, invoiceIdentityPresent: null, invoiceGeneratedAt: "2027-01-05T10:00:00-03:00", invoicePaidAt: "2027-01-06T13:00:00Z", documentAmount: "99.90", paidAmount: null, fullPaymentProven: false, evidenceSource: "manual_review", evidenceVersion: 1 }
  await t("C_evidence_snapshot_empty_valid", async () => (await v("finance_evidence_snapshot_valid", "{}")) === true)
  await t("C_evidence_snapshot_full_valid", async () => (await v("finance_evidence_snapshot_valid", JSON.stringify(evOk))) === true)
  const evBad = { extra: { ...evOk, foo: 1 }, name: { name: "x" }, cpf: { cpf: "1" }, cnpj: { cnpj: "1" }, phone: { telefone: "1" }, email: { email: "x" }, address: { endereco: "x" }, erp_payload: { payload: {} }, invoice_pk: { invoice_pk: "1" }, contract_pk: { contract_pk: "1" }, token: { access_token: "x" }, cookie: { cookie: "x" }, http_response: { response: "x" }, notes: { observacao: "x" },
    kind_erp: { evidenceKind: "erp_invoice" }, source_erp: { evidenceSource: "brbyte" }, ts_no_offset: { invoicePaidAt: "2027-01-06T13:00:00" }, ts_date_only: { invoicePaidAt: "2027-01-06" }, ts_bad: { invoicePaidAt: "2027-02-30T00:00:00Z" }, amount_number: { documentAmount: 99.9 }, amount_3dec: { paidAmount: "1.005" }, bool_string: { fullPaymentProven: "true" }, version_string: { evidenceVersion: "1" }, nested: { evidenceKind: { a: 1 } } }
  for (const [k, j] of Object.entries(evBad)) await t(`C_evidence_snapshot_rejects_${k}`, async () => (await v("finance_evidence_snapshot_valid", JSON.stringify(j))) === false)
  await t("C_audit_snapshot_rejects_free_keys", async () => (await v("finance_audit_snapshot_valid", '{"status":"draft"}')) === true && (await v("finance_audit_snapshot_valid", '{"note":"x"}')) === false && (await v("finance_audit_snapshot_valid", '{"status":"anything"}')) === false && (await v("finance_audit_snapshot_valid", '{"amount":10}')) === false)
  await t("C_compensation_snapshot_closed", async () => (await v("finance_compensation_snapshot_valid", '{"version":1,"components":{"salary":true}}')) === true && (await v("finance_compensation_snapshot_valid", '{"version":1,"salary_amount":"1"}')) === false && (await v("finance_compensation_snapshot_valid", '{"components":{"salary":"1000"}}')) === false)

  // ---------- B. entitlement immutability (lab fixture, isolated tx, ROLLBACK) ----------
  const rTec = await rpc(P.am, `public.create_commission_rule_draft($1,null,'technician_originator','fixed_amount','first_valid_invoice_generated',30,null,null,'2027-01-01')`, [key("r-tec")])
  const attrTec = (await one(`select id from public.sales_opportunity_attributions where opportunity_id=$1 and attribution_role='technician_originator'`, [opp1])).id
  const attrExt = a1.attribution_id
  const snap = JSON.stringify({ ruleId: rTec.rule_id, ruleVersion: 1, method: "fixed_amount", trigger: "first_valid_invoice_generated", fixedAmount: "30.00", attributionRole: "technician_originator", currency: "BRL" })
  const entIns = (k, extraCols = "", extraVals = "", snapshot = snap) => `insert into public.employee_commission_entitlements(opportunity_id,employee_id,attribution_id,rule_id,attribution_role,trigger_kind,idempotency_key,rule_snapshot${extraCols}) values ('${opp1}','${E.tec}','${attrTec}','${rTec.rule_id}','technician_originator','first_valid_invoice_generated','${key(k)}','${snapshot}'::jsonb${extraVals})`
  await t("B_entitlement_insert_blocked_financial_rules_inactive", () => failsWith(entIns("g0"), /financial_rules_inactive/))
  const sp = async (sqlText, re) => { await c.query("savepoint x"); try { await c.query(sqlText); await c.query("release savepoint x"); return re ? false : true } catch (e) { await c.query("rollback to savepoint x"); return re ? (re.test(e.message) || e.message) : e.message } }
  const rOther = await rpc(P.am, `public.create_commission_rule_draft($1,null,'technician_originator','fixed_amount','first_valid_invoice_generated',31,null,null,'2027-01-01')`, [key("r-oth")])
  const ENTB = []
  await c.query("begin")
  try {
    await c.query(`alter table public.employee_commission_entitlements disable trigger trg_employee_commission_entitlements_z_foundation_gate`)
    const T = async (name, fn) => { const r = await fn(); ENTB.push([name, r === true ? "PASS" : "FAIL " + String(r)]) }
    await T("B_fixture_pending_inserted", () => sp(entIns("f1")))
    await T("B_rule_snapshot_bad_rejected_on_table", () => sp(entIns("f0", "", "", JSON.stringify({ method: "fixed_amount", version: 1 })), /rule_snapshot_chk/))
    await T("B_evidence_bad_rejected_on_table", () => sp(entIns("f00", ",evidence_snapshot", `,'{"nome":"x"}'`), /evidence_shape/))
    const id1 = (await one(`select id from public.employee_commission_entitlements where idempotency_key=$1`, [key("f1")])).id
    const W = `where id='${id1}'`
    await T("B_pending_identity_frozen", () => sp(`update public.employee_commission_entitlements set employee_id='${E.ext}' ${W}`, /immutable_after_accrued/))
    await T("B_pending_to_paid_forbidden", () => sp(`update public.employee_commission_entitlements set status='paid', amount=30, accrued_at=now(), approved_at=now(), approved_by='${P.am}', paid_at=now(), paid_by='${P.am}' ${W}`, /transition_forbidden/))
    await T("B_pending_to_accrued_allowed", () => sp(`update public.employee_commission_entitlements set status='accrued', amount=30, accrued_at='2027-01-10T12:00:00Z', competence_month='2027-01-01', evidence_at='2027-01-10T11:00:00Z', triggering_contract_pk='1', triggering_invoice_pk='2', evidence_snapshot='{"evidenceKind":"manual_review"}' ${W}`))
    const frozen = [["opportunity_id", `'${opp2}'`], ["employee_id", `'${E.ext}'`], ["attribution_id", `'${attrExt}'`], ["rule_id", `'${rOther.rule_id}'`], ["attribution_role", `'external_sales_originator'`], ["trigger_kind", `'first_valid_invoice_fully_paid'`], ["triggering_contract_pk", `'9'`], ["triggering_invoice_pk", `'8'`], ["amount", "31"], ["currency", `'USD'`], ["competence_month", `'2027-02-01'`], ["evidence_at", "now()"], ["accrued_at", "now()"], ["idempotency_key", `'${key("other")}'`], ["rule_snapshot", `'${snap.replace('"30.00"', '"31.00"')}'`], ["evidence_snapshot", `'{}'`], ["created_at", "now()"], ["source", `'manual_admin'`], ["approved_at", "now()"], ["paid_at", "now()"]]
    for (const [col, val] of frozen) {
      await T(`B_accrued_${col}_frozen`, () => sp(`update public.employee_commission_entitlements set ${col}=${val} ${W}`, /immutable_after_accrued/))
    }
    for (const st of ["pending_evidence", "included_in_payroll", "paid"]) await T(`B_accrued_to_${st}_forbidden`, () => sp(`update public.employee_commission_entitlements set status='${st}' ${W}`, /transition_forbidden/))
    await T("B_accrued_to_approved_allowed", () => sp(`update public.employee_commission_entitlements set status='approved', approved_at=now(), approved_by='${P.am}' ${W}`))
    await T("B_approved_fields_frozen_after", () => sp(`update public.employee_commission_entitlements set approved_at=now() - interval '1 day' ${W}`, /immutable_after_accrued/))
    await T("B_approved_to_accrued_regression_forbidden", () => sp(`update public.employee_commission_entitlements set status='accrued' ${W}`, /transition_forbidden/))
    await T("B_approved_to_included_allowed", () => sp(`update public.employee_commission_entitlements set status='included_in_payroll' ${W}`))
    await T("B_included_to_approved_regression_forbidden", () => sp(`update public.employee_commission_entitlements set status='approved' ${W}`, /transition_forbidden/))
    await T("B_included_to_paid_allowed", () => sp(`update public.employee_commission_entitlements set status='paid', paid_at=now(), paid_by='${P.am}' ${W}`))
    for (const st of ["reversed", "included_in_payroll", "accrued", "rejected"]) await T(`B_paid_terminal_to_${st}_forbidden`, () => sp(`update public.employee_commission_entitlements set status='${st}' ${W}`, /transition_forbidden/))
    await T("B_paid_amount_never_recalculated", () => sp(`update public.employee_commission_entitlements set amount=0 ${W}`, /immutable_after_accrued/))
    await T("B_delete_blocked", () => sp(`delete from public.employee_commission_entitlements ${W}`, /no_delete/))
    await T("B_truncate_blocked", () => sp(`truncate public.employee_commission_entitlements`, /no_delete|referenced in a foreign key/))
    await T("B_truncate_cascade_blocked_by_trigger", () => sp(`truncate public.employee_commission_entitlements cascade`, /no_delete|append_only/))
    await T("B_fixture2_pending_to_rejected", async () => (await sp(entIns("f2").replace("'first_valid_invoice_generated','" + key("f2"), "'first_valid_invoice_fully_paid','" + key("f2")))) === true && (await sp(`update public.employee_commission_entitlements set status='rejected' where idempotency_key='${key("f2")}'`)) === true)
    await T("B_rejected_terminal", () => sp(`update public.employee_commission_entitlements set status='accrued', amount=1, accrued_at=now() where idempotency_key='${key("f2")}'`, /transition_forbidden/))
  } finally { await c.query("rollback") }
  for (const r of ENTB) res.push(r), (r[1] !== "PASS" && (ok = false))
  await t("B_after_rollback_gate_enabled_and_zero_rows", async () => (await one(`select tgenabled::text e from pg_trigger where tgname='trg_employee_commission_entitlements_z_foundation_gate'`)).e === "O" && (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n === 0 && (await failsWith(entIns("g1"), /financial_rules_inactive/)))
  await t("B_entitlement_insert_denied_service_role_authenticated", async () => (await deniedAs("service_role", null, entIns("g2"))) && (await deniedAs("authenticated", P.am, entIns("g3"))))

  // ---------- D. payroll line references ----------
  await t("D_explicit_fks_restrict", async () => { const r = await q(`select a.attname, c.confdeltype::text d from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] where c.conrelid='public.payroll_competence_lines'::regclass and c.contype='f'`); const m = Object.fromEntries(r.map(x => [x.attname, x.d])); return ["commission_entitlement_id", "compensation_profile_id", "worked_day_id", "adjustment_audit_event_id", "reversal_of_line_id", "competence_id"].every(k => m[k] === "r") || JSON.stringify(m) })
  await t("D_no_cascade_or_set_null_on_new_financial_fks", async () => (await one(`select count(*)::int n from pg_constraint where contype='f' and confdeltype in ('c') and conrelid::regclass::text = any($1)`, [[...NEW_TABLES, "sales_opportunity_attributions"]])).n === 0 && (await one(`select count(*)::int n from pg_constraint c where contype='f' and confdeltype='n' and conrelid='public.payroll_competence_lines'::regclass and confrelid <> 'public.profiles'::regclass`)).n === 0)
  await t("D_source_table_source_id_removed", async () => (await one(`select count(*)::int n from information_schema.columns where table_name='payroll_competence_lines' and column_name in ('source_table','source_id')`)).n === 0)
  const comp = (k, emp, salary, meal) => rpc(P.af, `public.configure_employee_compensation_draft($1,$2,'2027-01-01',null,$3,$4,null,null,null,null)`, [key(k), emp, salary, meal])
  const cpTec = await comp("cp-tec", E.tec, 1000, 22)
  const cpExt = await comp("cp-ext", E.ext, 1000, 22)
  const cpNoSal = await comp("cp-tec2", E.tec, null, null)
  const wd = (k, emp, d, st, meal) => rpc(P.af, `public.record_employee_worked_day($1,$2,$3,$4,$5)`, [key(k), emp, d, st, meal])
  const wdOk = await wd("wd1", E.tec, "2028-02-10", "worked", true)
  const wdAbs = await wd("wd2", E.tec, "2028-02-11", "absent", false)
  const wdOut = await wd("wd3", E.tec, "2028-03-01", "worked", true)
  const wdExt = await wd("wd4", E.ext, "2028-02-10", "worked", true)
  const cmp = await rpc(P.am, `public.open_payroll_competence_draft($1,$2,'2028-02-01')`, [key("cmp1"), E.tec])
  const cmpExt = await rpc(P.am, `public.open_payroll_competence_draft($1,$2,'2028-02-01')`, [key("cmp2"), E.ext])
  const L = (cols, vals) => `insert into public.payroll_competence_lines(competence_id,description,idempotency_key,${cols}) values ('${cmp.competence_id}','Linha lab','${key("ln" + Math.random().toString(36).slice(2, 10))}',${vals})`
  const LINES = []
  await c.query("begin")
  try {
    const T = async (name, fn) => { const r = await fn(); LINES.push([name, r === true ? "PASS" : "FAIL " + String(r)]) }
    await T("D_commission_requires_entitlement", () => sp(L("line_type,amount", `'commission',10`), /refs_chk/))
    await T("D_commission_nonexistent_entitlement_fk", () => sp(L("line_type,amount,commission_entitlement_id", `'commission',10,gen_random_uuid()`), /foreign key|fkey|reference_invalid/))
    await T("D_incompatible_refs_rejected", () => sp(L("line_type,amount,compensation_profile_id,worked_day_id", `'base_salary',10,'${cpTec.profile_id}','${wdOk.worked_day_id}'`), /refs_chk/))
    await T("D_base_salary_other_employee_profile_rejected", () => sp(L("line_type,amount,compensation_profile_id", `'base_salary',10,'${cpExt.profile_id}'`), /reference_invalid/))
    await T("D_base_salary_disabled_component_rejected", () => sp(L("line_type,amount,compensation_profile_id", `'base_salary',10,'${cpNoSal.profile_id}'`), /reference_invalid/))
    await T("D_base_salary_nonexistent_profile_fk", () => sp(L("line_type,amount,compensation_profile_id", `'base_salary',10,gen_random_uuid()`), /foreign key|fkey|reference_invalid/))
    await T("D_base_salary_valid_lab_fixture", () => sp(L("line_type,amount,compensation_profile_id", `'base_salary',1000,'${cpTec.profile_id}'`)))
    await T("D_meal_requires_worked_day", () => sp(L("line_type,amount,unit_amount,compensation_profile_id", `'meal',22,22,'${cpTec.profile_id}'`), /refs_chk/))
    await T("D_meal_absent_day_rejected", () => sp(L("line_type,amount,unit_amount,compensation_profile_id,worked_day_id", `'meal',22,22,'${cpTec.profile_id}','${wdAbs.worked_day_id}'`), /reference_invalid/))
    await T("D_meal_day_outside_competence_rejected", () => sp(L("line_type,amount,unit_amount,compensation_profile_id,worked_day_id", `'meal',22,22,'${cpTec.profile_id}','${wdOut.worked_day_id}'`), /reference_invalid/))
    await T("D_meal_other_employee_day_rejected", () => sp(L("line_type,amount,unit_amount,compensation_profile_id,worked_day_id", `'meal',22,22,'${cpTec.profile_id}','${wdExt.worked_day_id}'`), /reference_invalid/))
    await T("D_meal_quantity_must_be_1", () => sp(L("line_type,quantity,amount,unit_amount,compensation_profile_id,worked_day_id", `'meal',2,44,22,'${cpTec.profile_id}','${wdOk.worked_day_id}'`), /refs_chk/))
    await T("D_meal_valid_lab_fixture", () => sp(L("line_type,amount,unit_amount,compensation_profile_id,worked_day_id", `'meal',22,22,'${cpTec.profile_id}','${wdOk.worked_day_id}'`)))
    await T("D_meal_same_day_twice_rejected", () => sp(L("line_type,amount,unit_amount,compensation_profile_id,worked_day_id", `'meal',22,22,'${cpTec.profile_id}','${wdOk.worked_day_id}'`), /meal_day_uidx|duplicate/))
    await T("D_referenced_worked_day_cannot_change", () => sp(`update public.employee_worked_days set status='absent', meal_eligible=false where id='${wdOk.worked_day_id}'`, /referenced_by_payroll_line/))
    await T("D_adjustment_requires_audit_event", () => sp(L("line_type,amount,reason", `'adjustment',5,'motivo lab'`), /refs_chk/))
    await T("D_adjustment_nonexistent_event_fk", () => sp(L("line_type,amount,reason,adjustment_audit_event_id", `'adjustment',5,'motivo lab',gen_random_uuid()`), /foreign key|fkey|reference_invalid/))
    const evOther = (await one(`select id from public.finance_audit_events where entity_type='payroll_competence' and entity_id=$1`, [cmpExt.competence_id])).id
    await T("D_adjustment_event_of_other_competence_rejected", () => sp(L("line_type,amount,reason,adjustment_audit_event_id", `'adjustment',5,'motivo lab','${evOther}'`), /reference_invalid/))
    await T("D_other_earning_discount_require_audit_event", async () => (await sp(L("line_type,amount", `'other_earning',5`), /refs_chk/)) === true && (await sp(L("line_type,amount,reason", `'discount',-5,'motivo lab'`), /refs_chk/)))
    const baseLine = (await one(`select id from public.payroll_competence_lines where competence_id=$1 and line_type='base_salary'`, [cmp.competence_id])).id
    await T("D_reversal_requires_line", () => sp(L("line_type,amount,reason", `'reversal',-1000,'estorno lab'`), /refs_chk/))
    await T("D_reversal_nonexistent_line_fk", () => sp(L("line_type,amount,reason,reversal_of_line_id", `'reversal',-1000,'estorno lab',gen_random_uuid()`), /foreign key|fkey|reference_invalid/))
    await T("D_reversal_wrong_amount_rejected", () => sp(L("line_type,amount,reason,reversal_of_line_id", `'reversal',-999,'estorno lab','${baseLine}'`), /reference_invalid/))
    await T("D_reversal_valid", () => sp(L("line_type,amount,reason,reversal_of_line_id", `'reversal',-1000,'estorno lab','${baseLine}'`)))
    await T("D_reversal_twice_rejected", () => sp(L("line_type,amount,reason,reversal_of_line_id", `'reversal',-1000,'estorno lab','${baseLine}'`), /reversal_uidx|duplicate/))
    await T("D_line_snapshot_closed", () => sp(L("line_type,amount,compensation_profile_id,snapshot", `'base_salary',10,'${cpTec.profile_id}','{"note":"x"}'`), /snapshot_chk/))
  } finally { await c.query("rollback") }
  for (const r of LINES) res.push(r), (r[1] !== "PASS" && (ok = false))
  await t("D_lab_line_fixtures_rolled_back", async () => (await one(`select count(*)::int n from public.payroll_competence_lines`)).n === 0)
  const audit0 = (await one(`select count(*)::int n from public.finance_audit_events`)).n
  const j1 = await rpc(P.af, `public.add_manual_payroll_adjustment($1,$2,'adjustment',10,'Ajuste lab','motivo lab')`, [key("j1"), cmp.competence_id])
  await t("D_rpc_adjustment_audit_first_and_linked", async () => { const r = await one(`select l.adjustment_audit_event_id e, a.action, a.entity_type, a.entity_id::text ent, a.created_at <= l.created_at ord from public.payroll_competence_lines l join public.finance_audit_events a on a.id=l.adjustment_audit_event_id where l.id=$1`, [j1.line_id]); return j1.ok && r && r.e === j1.audit_event_id && r.action === "payroll_adjustment_added" && r.entity_type === "payroll_competence" && r.ent === cmp.competence_id })
  await t("D_rpc_adjustment_replay_no_new_event", async () => { const n0 = (await one(`select count(*)::int n from public.finance_audit_events`)).n; const r = await rpc(P.af, `public.add_manual_payroll_adjustment($1,$2,'adjustment',10,'Ajuste lab','motivo lab')`, [key("j1"), cmp.competence_id]); return r.idempotent === true && (await one(`select count(*)::int n from public.finance_audit_events`)).n === n0 })
  await t("D_rpc_failed_adjustment_leaves_no_orphan_event", async () => { const n0 = (await one(`select count(*)::int n from public.finance_audit_events`)).n; const r = await rpc(P.af, `public.add_manual_payroll_adjustment($1,$2,'adjustment',5,'cpf 12345678901','motivo lab')`, [key("j2"), cmp.competence_id]); return r.code === "invalid_adjustment" && (await one(`select count(*)::int n from public.finance_audit_events`)).n === n0 })
  await t("D_rpc_discount_and_other_earning_linked", async () => { const d = await rpc(P.af, `public.add_manual_payroll_adjustment($1,$2,'discount',-3,'Desconto lab','motivo lab')`, [key("j3"), cmp.competence_id]); const o = await rpc(P.af, `public.add_manual_payroll_adjustment($1,$2,'other_earning',4,'Outro lab','motivo lab')`, [key("j4"), cmp.competence_id]); return d.ok && o.ok && (await one(`select count(*)::int n from public.payroll_competence_lines where adjustment_audit_event_id is not null and competence_id=$1`, [cmp.competence_id])).n === 3 })
  void audit0

  // ---------- E. audit entity references ----------
  const audIns = (type, idExpr, k) => `insert into public.finance_audit_events(action,entity_type,entity_id,operation_id) values ('worked_day_recorded','${type}',${idExpr},'${key(k)}')`
  await t("E_nonexistent_entity_rejected", () => failsWith(audIns("employee_worked_day", "gen_random_uuid()", "au1"), /entity_not_found/))
  await t("E_wrong_type_id_combo_rejected", () => failsWith(audIns("payroll_competence", `'${rTec.rule_id}'`, "au2"), /entity_not_found/))
  await t("E_unknown_entity_type_rejected", () => failsWith(audIns("referral", `'${opp1}'`, "au3"), /entity_not_found|entity_chk/))
  await t("E_null_entity_rejected", () => failsWith(audIns("payroll_competence", "null", "au4"), /entity_not_found|null value/))
  await t("E_existing_entity_accepted_each_type", async () => { await c.query("begin"); try { for (const [ty, id] of [["sales_opportunity_attribution", a1.attribution_id], ["employee_commission_rule", rTec.rule_id], ["employee_compensation_profile", cpTec.profile_id], ["employee_worked_day", wdOk.worked_day_id], ["payroll_competence", cmp.competence_id], ["payroll_competence_line", j1.line_id]]) await c.query(audIns(ty, `'${id}'`, "ok-" + ty.slice(0, 10))); return true } catch (e) { return e.message } finally { await c.query("rollback") } })
  await t("E_operation_id_validated", async () => (await failsWith(`insert into public.finance_audit_events(action,entity_type,entity_id,operation_id) values ('worked_day_recorded','payroll_competence','${cmp.competence_id}','short')`, /operation_chk/)) && (await failsWith(`insert into public.finance_audit_events(action,entity_type,entity_id) values ('worked_day_recorded','payroll_competence','${cmp.competence_id}')`, /null value|operation/)))
  await t("E_idempotency_key_validated", () => failsWith(`insert into public.finance_audit_events(action,entity_type,entity_id,operation_id,idempotency_key) values ('worked_day_recorded','payroll_competence','${cmp.competence_id}','${key("au5")}','bad key!')`, /idem_chk/))
  await t("E_before_after_closed_allow_list", async () => (await failsWith(`insert into public.finance_audit_events(action,entity_type,entity_id,operation_id,before_state) values ('worked_day_recorded','payroll_competence','${cmp.competence_id}','${key("au6")}','{"email":"x"}')`, /before_safe/)) && (await failsWith(`insert into public.finance_audit_events(action,entity_type,entity_id,operation_id,after_state) values ('worked_day_recorded','payroll_competence','${cmp.competence_id}','${key("au7")}','{"free":"x"}')`, /after_safe/)))
  await t("E_audit_append_only", async () => (await failsWith(`update public.finance_audit_events set reason='x'`, /append_only/)) && (await failsWith(`delete from public.finance_audit_events`, /append_only/)) && (await failsWith(`truncate public.finance_audit_events`, /append_only|referenced in a foreign key/)) && (await failsWith(`truncate public.finance_audit_events cascade`, /append_only/)))
  await t("E_triggers_fire_without_client_grants", async () => (await one(`select bool_or(has_function_privilege(r, 'public.trg_finance_audit_events_validate_entity()', 'execute')) v from unnest(array['anon','authenticated','service_role']) r`)).v === false && (await one(`select count(*)::int n from public.finance_audit_events where entity_type='sales_opportunity_attribution'`)).n >= 2)

  // ---------- concurrency (independent connections) ----------
  for (let i = 0; i < 6; i++) { const k = new Client(conn); await k.connect(); pool.push(k) }
  const workers = pool.slice(-6)
  const onUser = async (k, uid, s, p) => { try { await k.query("begin"); await k.query("set local role authenticated"); await k.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]); const r = (await k.query(`select ${s} r`, p)).rows[0].r; await k.query("commit"); return r } catch (e) { await k.query("rollback").catch(() => {}); return { ok: false, err: e.message } } }
  const opp4 = await newOpp("4")
  const cm = await Promise.all(workers.map((k, i) => onUser(k, P.am, `public.attribute_employee_sales_opportunity($1,$2,$3,$4,$5)`, i % 2 ? [key("cm" + i), opp4, E.mul, "external_sales_originator", sec.external_sales] : [key("cm" + i), opp4, E.mul, "internal_sales_responsible", sec.commercial])))
  await t("CC_same_employee_two_roles_parallel_one_row", async () => (await one(`select count(*)::int n from public.sales_opportunity_attributions where opportunity_id=$1 and employee_id=$2`, [opp4, E.mul])).n === 1 && cm.filter(x => x.ok && !x.idempotent).length === 1 && cm.filter(x => x.code === "employee_already_attributed").length === 3 && cm.every(x => x.ok || x.code === "employee_already_attributed") || JSON.stringify(cm))
  const opp5 = await newOpp("5")
  const cr = await Promise.all(workers.map((k, i) => onUser(k, P.am, `public.attribute_employee_sales_opportunity($1,$2,$3,'external_sales_originator',$4)`, [key("cr" + i), opp5, i % 2 ? E.ext : E.ex2, sec.external_sales])))
  await t("CC_two_employees_same_role_parallel_one_row", async () => (await one(`select count(*)::int n from public.sales_opportunity_attributions where opportunity_id=$1 and attribution_role='external_sales_originator'`, [opp5])).n === 1 && cr.every(x => x.ok || x.code === "attribution_role_taken") && cr.filter(x => x.ok && !x.idempotent).length === 1 || JSON.stringify(cr))
  const ci = await Promise.all(workers.map(k => onUser(k, P.am, `public.attribute_employee_sales_opportunity($1,$2,$3,'internal_sales_responsible',$4)`, [key("ci"), opp5, E.com, sec.commercial])))
  await t("CC_identical_replay_parallel_same_id", () => ci.every(x => x.ok) && new Set(ci.map(x => x.attribution_id)).size === 1 && ci.filter(x => !x.idempotent).length === 1)
  const cj = await Promise.all(workers.map(k => onUser(k, P.af, `public.add_manual_payroll_adjustment($1,$2,'adjustment',7,'Ajuste lab','motivo lab')`, [key("cj"), cmpExt.competence_id])))
  await t("CC_parallel_adjustment_one_line_one_event", async () => cj.every(x => x.ok) && (await one(`select count(*)::int n from public.payroll_competence_lines where competence_id=$1`, [cmpExt.competence_id])).n === 1 && (await one(`select count(*)::int n from public.finance_audit_events where action='payroll_adjustment_added' and entity_id=$1`, [cmpExt.competence_id])).n === 1)

  // ---------- final invariants ----------
  await t("ACTIVE_RULES_CREATED_NO", async () => (await one(`select count(*)::int n from public.employee_commission_rules where active or status='active' or retroactive`)).n === 0)
  await t("REAL_ENTITLEMENTS_CREATED_NO", async () => (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n === 0)
  await t("REAL_PAYROLL_CREATED_NO_only_lab_fixtures", async () => (await one(`select count(*)::int n from public.payroll_competences c join public.employees e on e.id=c.employee_id where e.profile_id <> all($1::uuid[])`, [Object.values(P)])).n === 0)
  await t("final_rewards_wallet_unchanged", async () => { const h = await finHash(); return h.rewards === pre.rewards && h.wallet === pre.wallet && h.n_rewards === 24 })
  await t("reapply_with_data_preserves_rows_and_constraints", async () => { const before = await countsAll(); await c.query(sql); return JSON.stringify(before) === JSON.stringify(await countsAll()) && (await one(`select count(*)::int n from pg_constraint where conname='sales_opportunity_attributions_employee_uq'`)).n === 1 })
} finally {
  await Promise.all(pool.map(k => k.end().catch(() => {})))
  await stopCollectionsLab()
}
for (const r of res) console.log(r.join(" | "))
const pass = res.filter(r => r[1] === "PASS").length
console.log(`I1B_TESTS=${pass}/${res.filter(r => r[1] === "PASS" || String(r[1]).startsWith("FAIL")).length}`)
console.log(ok ? "I1B_LAB=PASS" : "I1B_LAB=FAIL")
process.exit(ok ? 0 : 1)

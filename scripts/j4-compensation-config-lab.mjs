// 3.1F-J4 — configuração de comissão e remuneração (somente rascunho): cadeia real
// (base → H1 → H1B → I1 → J2 → J3 → J4) num PostgreSQL local descartável (127.0.0.1).
// Não usa DATABASE_URL, não conecta em produção, não chama ERP. Parada somente via lab.stop().
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { startJ2Lab, zeroWriteSnapshot } from "./j2-lab-chain.mjs"

export const J3_PATCH = "supabase/patch-employee-sales-opportunity-3-1f-j3.sql"
export const J4_PATCH = "supabase/patch-employee-compensation-configuration-3-1f-j4.sql"
export const J4_PREFLIGHT = "supabase/preflight-employee-compensation-configuration-3-1f-j4.sql"
export const J4_VERIFY = "supabase/verify-employee-compensation-configuration-3-1f-j4.sql"
const J4_FUNCS = ["admin_save_commission_rule_draft", "admin_archive_commission_rule_draft", "admin_save_employee_compensation_draft",
  "admin_archive_employee_compensation_draft", "admin_list_commission_rules", "admin_list_compensation_employees",
  "admin_get_employee_compensation", "employee_compensation_preview", "trg_employee_commission_rules_no_overlap",
  "comp_cfg_today", "comp_cfg_is_null", "comp_cfg_text_ok", "comp_cfg_opt_text_ok", "comp_cfg_opt_money_ok", "comp_cfg_opt_bool_ok", "comp_cfg_status_label"]
const LEGACY = ["create_commission_rule_draft", "version_commission_rule_draft", "configure_employee_compensation_draft",
  "record_employee_worked_day", "open_payroll_competence_draft", "add_manual_payroll_adjustment"]

const res = []
let ok = true
const lab = await startJ2Lab({ applyJ2: true })
const { c, conn, Client, REPO_ROOT, applyFile } = lab
const q = async (sql, p = []) => (await c.query(sql, p)).rows
const one = async (sql, p = []) => (await q(sql, p))[0]
const t = async (name, fn) => {
  try { const v = await fn(); res.push([name, v === true ? "PASS" : "FAIL " + JSON.stringify(v).slice(0, 900)]); if (v !== true) ok = false }
  catch (e) { await c.query("rollback").catch(() => {}); res.push([name, "FAIL " + e.message]); ok = false }
}
const call = async (role, uid, sql, p = [], commit = true, client = c) => {
  await client.query("begin")
  try {
    await client.query(`set local role ${role}`)
    if (uid) await client.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid])
    const r = await client.query(`select ${sql} as r`, p)
    await client.query(commit ? "commit" : "rollback")
    return { ok: true, r: r.rows[0].r }
  } catch (e) { await client.query("rollback").catch(() => {}); return { ok: false, msg: e.message, code: e.code } }
}
const rpc = (uid, fn, payload, client = c) => call("authenticated", uid, `public.${fn}($1::jsonb)`, [JSON.stringify(payload)], true, client)
const read = (uid, sql, p = []) => call("authenticated", uid, sql, p, false)
const id = (n) => `77777777-0000-4000-8000-${String(n).padStart(12, "0")}`
const P = { AM: id(1), AF: id(2), AC: id(3), F1: id(4), F2: id(5), F3: id(6), FX: id(7), CM: id(8), IND: id(9) }
let seq = 0
const key = () => `j4labkey${String(++seq).padStart(5, "0")}${"y".repeat(12)}`

try {
  await applyFile(J3_PATCH)
  const catalog = async () => one(`select
    (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','m','p')) rels,
    (select md5(string_agg(policyname||cmd||coalesce(qual,'')||coalesce(with_check,''), '|' order by tablename, policyname)) from pg_policies where schemaname='public') policies_md5,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select string_agg(k.relname||':'||t.tgname, ',' order by k.relname||':'||t.tgname) from pg_trigger t join pg_class k on k.oid=t.tgrelid where k.relnamespace='public'::regnamespace and not t.tgisinternal) triggers,
    (select md5(string_agg(conname||pg_get_constraintdef(oid), '|' order by conrelid::regclass::text, conname)) from pg_constraint where connamespace='public'::regnamespace
       and conname not like 'employee_commission_rules_%' and conname not like 'employee_compensation_profiles_%' and conname <> 'finance_audit_events_action_chk') other_constraints,
    (select md5(string_agg(conname||pg_get_constraintdef(oid), '|' order by conname)) from pg_constraint where conname like 'employee_commission_rules_%' or conname like 'employee_compensation_profiles_%') fin_constraints,
    (select md5(string_agg(p.oid::regprocedure::text || coalesce(p.proacl::text,'') || md5(p.prosrc), '|' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace='public'::regnamespace
       and p.proname <> all($1::text[]) and p.proname <> all($2::text[])) other_funcs,
    (select md5(string_agg(md5(p.prosrc), '|' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = any($2::text[])) legacy_src,
    (select md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,''), ',' order by table_name, column_name)) from information_schema.columns where table_schema='public'
       and table_name not in ('employee_commission_rules','employee_compensation_profiles')) other_cols`.replace(/\$1/g, "$1").replace(/\$2/g, "$2"), [J4_FUNCS, LEGACY])
  const cat0 = await catalog()
  const preM = Object.fromEntries((await c.query(readFileSync(join(REPO_ROOT, J4_PREFLIGHT), "utf8"))).rows.map((r) => [r.metric, r.value]))
  await t("PREFLIGHT_prereqs_true", () => Object.entries(preM).filter(([k]) => k.startsWith("prereq_")).every(([, v]) => v === "true") || preM)
  await t("PREFLIGHT_no_existing_j4_objects", () => (preM.existing_j4_functions === "0" && preM.existing_j4_columns === "0" && preM.existing_j4_one_draft_index === "false") || preM)
  await t("PREFLIGHT_legacy_rpcs_executable_before", () => (preM.legacy_rule_rpc_authenticated_execute === "true" && preM.legacy_competence_rpc_authenticated_execute === "true") || preM)
  await t("PREFLIGHT_financial_zero", () => Object.entries(preM).filter(([k]) => k.startsWith("count_") || k.startsWith("active_")).every(([, v]) => v === "0") || preM)
  const sql = readFileSync(join(REPO_ROOT, J4_PATCH), "utf8")
  await t("APPLY_first", async () => { await c.query(sql); return true })
  const acl = () => q(`select oid::regprocedure::text s, proacl::text a, md5(prosrc) m from pg_proc where pronamespace='public'::regnamespace and (proname = any($1::text[]) or proname = any($2::text[])) order by 1`, [J4_FUNCS, LEGACY])
  const acl1 = await acl()
  const cat1a = await catalog()
  await t("APPLY_reapply_idempotent", async () => { await c.query(sql); return true })
  await t("APPLY_reapply_acl_bodies_constraints_unchanged", async () => { const cat1b = await catalog(); return (JSON.stringify(await acl()) === JSON.stringify(acl1) && cat1a.fin_constraints === cat1b.fin_constraints && cat1a.triggers === cat1b.triggers) || { cat1a, cat1b } })
  const cat1 = await catalog()
  await t("ADDITIVE_no_new_table_no_policy_change", () => (cat0.rels === cat1.rels && cat0.policies === cat1.policies && cat0.policies_md5 === cat1.policies_md5) || { cat0, cat1 })
  await t("ADDITIVE_only_overlap_trigger_added", () => JSON.stringify(cat1.triggers.split(",").filter((x) => !cat0.triggers.split(",").includes(x))) === '["employee_commission_rules:trg_employee_commission_rules_no_overlap"]' && cat0.triggers.split(",").every((x) => cat1.triggers.split(",").includes(x)) || { a: cat0.triggers, b: cat1.triggers })
  await t("ADDITIVE_other_constraints_untouched", () => cat0.other_constraints === cat1.other_constraints)
  await t("ADDITIVE_other_functions_untouched", () => cat0.other_funcs === cat1.other_funcs)
  await t("ADDITIVE_legacy_bodies_untouched", () => cat0.legacy_src === cat1.legacy_src)
  await t("ADDITIVE_other_tables_columns_untouched", () => cat0.other_cols === cat1.other_cols)
  for (const r of (await c.query(readFileSync(join(REPO_ROOT, J4_VERIFY), "utf8"))).rows) await t(`VERIFY_${r.check_name}`, () => r.ok === true)
  await t("TRANSACTIONAL_begin_commit", () => /^\s*begin;/m.test(sql) && /^\s*commit;\s*$/m.test(sql))
  const sqlNoComments = sql.replace(/--[^\n]*/g, "")
  await t("MIGRATION_no_drop_table_column_function_no_backfill", () => !/\bdrop\s+(table|column|function|policy|type)\b|\bdelete\s+from\b|\btruncate\b|\bcreate\s+(table|policy)\b|alter\s+table[^;]*\b(drop\s+column|alter\s+column|disable)\b/i.test(sqlNoComments))
  await t("MIGRATION_never_activates", () => !/active\s*=\s*true|status\s*=\s*'active'|'active'\s*,\s*true|set\s+active\b/i.test(sqlNoComments.replace(/where active or status = 'active'|where status = 'active'|status='active'|or status = 'active'/g, "")))
  await t("MIGRATION_no_financial_inserts", () => !/insert\s+into\s+public\.(employee_commission_entitlements|payroll_competences|payroll_competence_lines|employee_worked_days|rewards|wallet_transactions|payments|collection_\w+|referrals)\b/i.test(sqlNoComments))
  await t("MIGRATION_no_money_defaults", () => !/\bdefault\s+[0-9]/i.test(sqlNoComments) && !/\b(30|50|22)\.00\b|0\.02\b/.test(sqlNoComments))
  await t("MIGRATION_no_dynamic_sql", () => !/\bexecute\s+(format|'|\$)/i.test(sqlNoComments))

  // ---------- fixtures ----------
  await c.query(`insert into public.profiles(id,email,role,is_active,full_name) values
    ($1,'am@lab.invalid','admin_master',true,'Admin Master Lab'),($2,'af@lab.invalid','admin_financeiro',true,'Admin Fin Lab'),
    ($3,'ac@lab.invalid','admin_consulta',true,'Admin Consulta Lab'),($4,'f1@lab.invalid','funcionario',true,'Funcionario Um Lab'),
    ($5,'f2@lab.invalid','funcionario',true,'Funcionario Dois Lab'),($6,'f3@lab.invalid','funcionario',true,'Funcionario Tres Lab'),
    ($7,'fx@lab.invalid','funcionario',true,'Desligado Lab'),($8,'cm@lab.invalid','comercial',true,'Comercial Lab'),
    ($9,'in@lab.invalid','indicador',true,'Indicador Lab') on conflict (id) do nothing`, Object.values(P))
  const S = Object.fromEntries((await q(`select code, id from public.sectors`)).map((r) => [r.code, r.id]))
  const E = {}
  for (const [k, st] of [["F1", "active"], ["F2", "active"], ["F3", "active"], ["FX", "dismissed"]]) {
    E[k] = (await one(`insert into public.employees(profile_id,status,dismissed_at) values ($1,$2::public.employee_status, case when $2='dismissed' then now() end) returning id`, [P[k], st])).id
  }
  await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id,is_active) values ($1,$2,true),($3,$4,true),($5,$6,true)`,
    [E.F1, S.technician, E.F2, S.external_sales, E.F3, S.commercial])
  const fin0 = await zeroWriteSnapshot(c)
  const money0 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet, (select count(*)::int from public.payments) payments`)
  const today = (await one(`select public.comp_cfg_today()::text d`)).d
  const day = async (n) => (await one(`select (public.comp_cfg_today() + $1::int)::text d`, [n])).d
  const D1 = await day(1), D30 = await day(30), D10 = await day(10), D31 = await day(31), DM1 = await day(-1)

  // ---------- regras: papéis ----------
  const rule = (over = {}) => ({ idempotencyKey: key(), name: "Comissão técnico lab", attributionRole: "technician_originator", method: "fixed_amount", fixedAmount: "31.50", effectiveFrom: D1, effectiveUntil: D30, reason: "Configuração inicial lab", ...over })
  const rA = await rpc(P.AM, "admin_save_commission_rule_draft", rule())
  await t("RULE_master_creates_draft", () => (rA.ok && rA.r.ok === true && rA.r.version === 1 && rA.r.status === "draft" && rA.r.activatable === false && rA.r.incomplete === false) || rA)
  const rowA = await one(`select * from public.employee_commission_rules where id=$1`, [rA.r.ruleId])
  await t("RULE_row_inactive_not_retroactive_trigger_derived", () => (rowA.active === false && rowA.retroactive === false && rowA.status === "draft" && rowA.trigger_kind === "first_valid_invoice_generated" && rowA.fixed_amount === "31.50" && rowA.rule_name === "Comissão técnico lab" && rowA.change_reason === "Configuração inicial lab" && rowA.created_by === P.AM && rowA.sector_id === null) || rowA)
  const rF = await rpc(P.AF, "admin_save_commission_rule_draft", rule({ attributionRole: "external_sales_originator", fixedAmount: "48.90", name: "Comissão externo lab" }))
  await t("RULE_financeiro_creates_draft", () => (rF.ok && rF.r.ok === true && rF.r.version === 1) || rF)
  for (const k of ["AC", "F1", "CM", "IND"]) {
    const r = await rpc(P[k], "admin_save_commission_rule_draft", rule({ effectiveFrom: D31, effectiveUntil: null }))
    await t(`RULE_${k}_forbidden`, () => (r.ok && r.r.ok === false && r.r.code === "forbidden") || r)
  }
  const anon = await call("anon", null, `public.admin_save_commission_rule_draft($1::jsonb)`, [JSON.stringify(rule())])
  await t("RULE_anon_no_execute", () => (!anon.ok && /permission denied/.test(anon.msg)) || anon)
  const noUid = await rpc(null, "admin_save_commission_rule_draft", rule())
  await t("RULE_unauthenticated_forbidden", () => (noUid.ok && noUid.r.code === "forbidden") || noUid)

  // ---------- regras: validação ----------
  const expect = async (name, payload, code, uid = P.AM) => { const r = await rpc(uid, "admin_save_commission_rule_draft", payload); await t(name, () => (r.ok && r.r.ok === false && r.r.code === code) || r) }
  await expect("RULE_unknown_field_active_rejected", { ...rule(), active: true }, "unknown_field")
  await expect("RULE_unknown_field_retroactive_rejected", { ...rule(), retroactive: false }, "unknown_field")
  await expect("RULE_unknown_field_trigger_rejected", { ...rule(), triggerKind: "first_valid_invoice_fully_paid" }, "unknown_field")
  await expect("RULE_reason_required", rule({ reason: "  " }), "reason_required")
  await expect("RULE_name_required", rule({ name: "x" }), "invalid_name")
  await expect("RULE_internal_seller_disabled", rule({ attributionRole: "internal_sales_responsible", method: "percentage", fixedAmount: null, percentageRate: "0.020000", effectiveFrom: D31, effectiveUntil: null }), "role_disabled")
  await expect("RULE_invalid_role", rule({ attributionRole: "gestor" }), "invalid_role")
  await expect("RULE_retroactive_forbidden", rule({ effectiveFrom: DM1, effectiveUntil: null }), "retroactive_forbidden")
  await expect("RULE_period_until_before_from", rule({ effectiveFrom: D30, effectiveUntil: D10 }), "invalid_period")
  await expect("RULE_fixed_zero_rejected", rule({ fixedAmount: "0", effectiveFrom: D31, effectiveUntil: null }), "invalid_fixed_amount")
  await expect("RULE_fixed_negative_rejected", rule({ fixedAmount: "-5.00", effectiveFrom: D31, effectiveUntil: null }), "invalid_fixed_amount")
  await expect("RULE_fixed_three_decimals_rejected", rule({ fixedAmount: "10.005", effectiveFrom: D31, effectiveUntil: null }), "invalid_fixed_amount")
  await expect("RULE_fixed_number_type_rejected", rule({ fixedAmount: 10, effectiveFrom: D31, effectiveUntil: null }), "invalid_fixed_amount")
  await expect("RULE_fixed_with_rate_rejected", rule({ percentageRate: "0.01", effectiveFrom: D31, effectiveUntil: null }), "invalid_method_values")
  const pct = (over = {}) => rule({ method: "percentage", fixedAmount: null, percentageRate: "0.123456", name: "Percentual lab", ...over })
  await expect("RULE_percentage_7_decimals_rejected_not_rounded", pct({ percentageRate: "0.1234567" }), "invalid_percentage_rate")
  await expect("RULE_percentage_above_100_rejected", pct({ percentageRate: "1.5" }), "invalid_percentage_rate")
  await expect("RULE_percentage_base_unproven_rejected", pct({ percentageBase: "monthly_plan" }), "percentage_base_not_proven")
  const rP = await rpc(P.AF, "admin_save_commission_rule_draft", pct())
  const rowP = rP.ok && rP.r.ok ? await one(`select percentage_rate::text r, percentage_base, trigger_kind from public.employee_commission_rules where id=$1`, [rP.r.ruleId]) : null
  await t("RULE_percentage_precision_kept_incomplete_draft", () => (rP.r?.ok === true && rP.r.incomplete === true && rowP.r === "0.123456" && rowP.percentage_base === null && rowP.trigger_kind === "first_valid_invoice_generated") || { rP, rowP })
  const rFI = await rpc(P.AM, "admin_save_commission_rule_draft", rule({ method: "first_invoice_value", fixedAmount: null, name: "Primeira fatura lab", attributionRole: "external_sales_originator" }))
  const rowFI = rFI.ok && rFI.r.ok ? await one(`select * from public.employee_commission_rules where id=$1`, [rFI.r.ruleId]) : null
  await t("RULE_first_invoice_value_draft_paid_trigger_not_activatable", () => (rFI.r?.ok === true && rFI.r.activatable === false && rowFI.trigger_kind === "first_valid_invoice_fully_paid" && rowFI.fixed_amount === null && rowFI.percentage_rate === null) || { rFI, rowFI })
  await expect("RULE_first_invoice_value_with_amount_rejected", rule({ method: "first_invoice_value", fixedAmount: "10.00", effectiveFrom: D31, effectiveUntil: null }), "invalid_method_values")
  await t("RULE_activation_impossible_even_superuser", async () => {
    try { await c.query(`update public.employee_commission_rules set status='active', active=true, approved_by=$2, approved_at=now() where id=$1`, [rFI.r.ruleId, P.AM]); return "activated!" }
    catch (e) { return /foundation_inactive|transition_forbidden|immutable|check constraint/.test(e.message) || e.message }
  })
  await t("RULE_retroactive_true_impossible_superuser", async () => {
    try { await c.query(`insert into public.employee_commission_rules(rule_family_id,version,attribution_role,method,trigger_kind,fixed_amount,effective_from,status,active,retroactive,idempotency_key) values (gen_random_uuid(),1,'technician_originator','fixed_amount','first_valid_invoice_generated',1,current_date+400,'draft',false,true,'j4labretroactive0000000')`); return "inserted!" }
    catch (e) { return /no_retroactive/.test(e.message) || e.message }
  })

  // ---------- sobreposição ----------
  await expect("RULE_overlap_same_role_type_blocked", rule({ effectiveFrom: D10, effectiveUntil: null }), "overlapping_rule")
  await expect("RULE_overlap_open_ended_contains_blocked", rule({ effectiveFrom: D1, effectiveUntil: D1 }), "overlapping_rule")
  const rNext = await rpc(P.AM, "admin_save_commission_rule_draft", rule({ effectiveFrom: D31, effectiveUntil: null, name: "Técnico período seguinte" }))
  await t("RULE_adjacent_period_allowed", () => rNext.r?.ok === true || rNext)
  const rOtherType = await rpc(P.AM, "admin_save_commission_rule_draft", pct({ attributionRole: "technician_originator", percentageRate: "0.015", effectiveFrom: D1, effectiveUntil: D30 }))
  await t("RULE_overlap_rule_scoped_by_type_and_role", () => (rOtherType.r?.ok === false && rOtherType.r.code === "overlapping_rule") || rOtherType)
  await t("RULE_overlap_trigger_blocks_direct_insert", async () => {
    try { await c.query(`insert into public.employee_commission_rules(rule_family_id,version,attribution_role,method,trigger_kind,fixed_amount,effective_from,effective_until,status,active,retroactive,idempotency_key) values (gen_random_uuid(),1,'technician_originator','fixed_amount','first_valid_invoice_generated',5,$1,$2,'draft',false,false,'j4labdirectoverlap00000')`, [D10, D10]); return "inserted!" }
    catch (e) { return /employee_commission_rule_overlap/.test(e.message) || e.message }
  })

  // ---------- versionamento / histórico ----------
  const before = await one(`select to_jsonb(r) - 'status' - 'updated_at' j from public.employee_commission_rules r where id=$1`, [rA.r.ruleId])
  const vPayload = rule({ previousRuleId: rA.r.ruleId, attributionRole: undefined, fixedAmount: "33.00", reason: "Reajuste lab" })
  delete vPayload.attributionRole
  const v2 = await rpc(P.AF, "admin_save_commission_rule_draft", vPayload)
  await t("VERSION_edit_creates_new_version", () => (v2.r?.ok === true && v2.r.version === 2 && v2.r.familyId === rA.r.familyId && v2.r.ruleId !== rA.r.ruleId) || v2)
  const after = await one(`select to_jsonb(r) - 'status' - 'updated_at' j, status from public.employee_commission_rules r where id=$1`, [rA.r.ruleId])
  await t("VERSION_previous_superseded_values_immutable", () => (after.status === "superseded" && JSON.stringify(after.j) === JSON.stringify(before.j)) || { before, after })
  const rowV2 = await one(`select * from public.employee_commission_rules where id=$1`, [v2.r.ruleId])
  await t("VERSION_chain_previous_version_id", () => (rowV2.previous_version_id === rA.r.ruleId && rowV2.attribution_role === "technician_originator" && rowV2.fixed_amount === "33.00" && rowV2.active === false) || rowV2)
  const stale = await rpc(P.AM, "admin_save_commission_rule_draft", { ...vPayload, idempotencyKey: key(), fixedAmount: "34.00" })
  await t("VERSION_stale_previous_rejected", () => (stale.r?.ok === false && stale.r.code === "stale_version") || stale)
  const roleChange = await rpc(P.AM, "admin_save_commission_rule_draft", { ...vPayload, idempotencyKey: key(), previousRuleId: v2.r.ruleId, attributionRole: "external_sales_originator" })
  await t("VERSION_role_immutable", () => (roleChange.r?.ok === false && roleChange.r.code === "role_immutable") || roleChange)
  await t("HISTORY_snapshot_update_blocked", async () => { try { await c.query(`update public.employee_commission_rules set fixed_amount=99 where id=$1`, [rA.r.ruleId]); return "updated!" } catch (e) { return /snapshot_immutable/.test(e.message) || e.message } })
  await t("HISTORY_delete_blocked", async () => { try { await c.query(`delete from public.employee_commission_rules where id=$1`, [rA.r.ruleId]); return "deleted!" } catch (e) { return /no_delete/.test(e.message) || e.message } })
  await t("HISTORY_superseded_cannot_return_to_draft", async () => { try { await c.query(`update public.employee_commission_rules set status='draft' where id=$1`, [rA.r.ruleId]); return "updated!" } catch (e) { return /transition_forbidden/.test(e.message) || e.message } })

  // ---------- idempotência ----------
  const replay = await rpc(P.AF, "admin_save_commission_rule_draft", vPayload)
  await t("IDEMPOTENCY_replay_returns_original_version", () => (replay.r?.ok === true && replay.r.idempotent === true && replay.r.ruleId === v2.r.ruleId && replay.r.version === 2) || replay)
  const conflict = await rpc(P.AF, "admin_save_commission_rule_draft", { ...vPayload, fixedAmount: "35.00" })
  await t("IDEMPOTENCY_same_key_different_payload_conflict", () => (conflict.r?.ok === false && conflict.r.code === "idempotency_conflict") || conflict)
  await t("IDEMPOTENCY_no_duplicate_rows", async () => (await one(`select count(*)::int n from public.employee_commission_rules where rule_family_id=$1`, [rA.r.familyId])).n === 2)

  // ---------- concorrência ----------
  const c2 = new Client(conn); await c2.connect()
  const c3 = new Client(conn); await c3.connect()
  const [ca, cb] = await Promise.all([
    rpc(P.AM, "admin_save_commission_rule_draft", { ...vPayload, idempotencyKey: key(), previousRuleId: v2.r.ruleId, fixedAmount: "36.00" }, c2),
    rpc(P.AF, "admin_save_commission_rule_draft", { ...vPayload, idempotencyKey: key(), previousRuleId: v2.r.ruleId, fixedAmount: "37.00" }, c3),
  ])
  await t("CONCURRENCY_parallel_versions_one_wins", () => ([ca, cb].filter((x) => x.r?.ok === true).length === 1 && [ca, cb].filter((x) => x.r?.ok === false && x.r.code === "stale_version").length === 1) || { ca, cb })
  await t("CONCURRENCY_single_draft_in_family", async () => (await one(`select count(*)::int n from public.employee_commission_rules where rule_family_id=$1 and status='draft'`, [rA.r.familyId])).n === 1)
  const [cc, cd] = await Promise.all([
    rpc(P.AM, "admin_save_commission_rule_draft", rule({ attributionRole: "external_sales_originator", method: "percentage", fixedAmount: null, percentageRate: "0.01", effectiveFrom: D31, effectiveUntil: null, name: "Concorrente A" }), c2),
    rpc(P.AF, "admin_save_commission_rule_draft", rule({ attributionRole: "external_sales_originator", method: "percentage", fixedAmount: null, percentageRate: "0.02", effectiveFrom: D31, effectiveUntil: null, name: "Concorrente B" }), c3),
  ])
  await t("CONCURRENCY_parallel_overlapping_creates_one_wins", () => ([cc, cd].filter((x) => x.r?.ok === true).length === 1 && [cc, cd].filter((x) => x.r?.code === "overlapping_rule").length === 1) || { cc, cd })

  // ---------- arquivamento ----------
  const arch = { idempotencyKey: key(), ruleId: rNext.r.ruleId, reason: "Rascunho não utilizado" }
  const a1 = await rpc(P.AM, "admin_archive_commission_rule_draft", arch)
  await t("ARCHIVE_unused_draft", () => (a1.r?.ok === true && a1.r.status === "archived") || a1)
  await t("ARCHIVE_row_kept_inactive", async () => { const r = await one(`select status, active from public.employee_commission_rules where id=$1`, [rNext.r.ruleId]); return (r.status === "inactive" && r.active === false) || r })
  const a2 = await rpc(P.AM, "admin_archive_commission_rule_draft", arch)
  await t("ARCHIVE_idempotent_replay", () => (a2.r?.ok === true && a2.r.idempotent === true) || a2)
  const a3 = await rpc(P.AM, "admin_archive_commission_rule_draft", { ...arch, reason: "Outro motivo" })
  await t("ARCHIVE_same_key_other_reason_conflict", () => a3.r?.code === "idempotency_conflict" || a3)
  const a4 = await rpc(P.AM, "admin_archive_commission_rule_draft", { idempotencyKey: key(), ruleId: rA.r.ruleId, reason: "Arquivar versão antiga" })
  await t("ARCHIVE_superseded_rejected", () => a4.r?.code === "stale_version" || a4)
  const a5 = await rpc(P.AC, "admin_archive_commission_rule_draft", { idempotencyKey: key(), ruleId: v2.r.ruleId, reason: "Tentativa consulta" })
  await t("ARCHIVE_consulta_forbidden", () => a5.r?.code === "forbidden" || a5)
  const a6 = await rpc(P.AM, "admin_archive_commission_rule_draft", { idempotencyKey: key(), ruleId: v2.r.ruleId, reason: "x" })
  await t("ARCHIVE_reason_required", () => a6.r?.code === "reason_required" || a6)

  // ---------- leitura admin regras ----------
  const lr = await read(P.AF, "public.admin_list_commission_rules()")
  await t("READ_rules_financeiro_history", () => (lr.ok && lr.r.activeRuleCount === 0 && lr.r.rules.some((x) => x.id === rA.r.ruleId && x.status === "superseded") && lr.r.rules.some((x) => x.id === rNext.r.ruleId && x.status === "archived" && x.archiveReason === "Rascunho não utilizado" && x.archivedBy === "Admin Master Lab")) || lr)
  await t("READ_rules_all_inactive_not_activatable", () => lr.r.rules.every((x) => x.active === false && x.retroactive === false && x.activatable === false) || lr.r.rules)
  for (const k of ["AC", "F1", "CM"]) {
    const r = await read(P[k], "public.admin_list_commission_rules()")
    await t(`READ_rules_${k}_forbidden`, () => (!r.ok && /compensation_config_forbidden/.test(r.msg)) || r)
  }

  // ---------- remuneração individual ----------
  const prof = (over = {}) => ({ idempotencyKey: key(), employeeId: E.F1, validFrom: today, reason: "Contratação lab", ...over })
  const p1 = await rpc(P.AM, "admin_save_employee_compensation_draft", prof({ salaryAmount: "2500.00", showSalary: true, mealDailyAmount: "21.75", showMeal: false }))
  await t("PROFILE_master_creates_with_optional_salary", () => (p1.r?.ok === true && p1.r.version === 1 && p1.r.status === "draft") || p1)
  const rowP1 = await one(`select * from public.employee_compensation_profiles where id=$1`, [p1.r.profileId])
  await t("PROFILE_row_draft_components", () => (rowP1.status === "draft" && rowP1.salary_enabled && rowP1.salary_amount === "2500.00" && rowP1.meal_enabled && rowP1.show_meal === false && rowP1.transport_enabled === false && rowP1.transport_amount === null && rowP1.fuel_amount === null && rowP1.change_reason === "Contratação lab") || rowP1)
  const pNoMeal = await rpc(P.AF, "admin_save_employee_compensation_draft", prof({ employeeId: E.F2, transportAmount: "180.00", transportMethod: "monthly_fixed", showTransport: true, fuelAmount: "15.40", fuelMethod: "per_worked_day", showFuel: true }))
  await t("PROFILE_financeiro_transport_fuel_without_salary", () => pNoMeal.r?.ok === true || pNoMeal)
  const rowP2 = await one(`select * from public.employee_compensation_profiles where id=$1`, [pNoMeal.r.profileId])
  await t("PROFILE_meal_22_not_default_absent_is_null", () => (rowP2.meal_enabled === false && rowP2.meal_daily_amount === null && rowP2.salary_enabled === false && rowP2.salary_amount === null) || rowP2)
  const pEmpty = await rpc(P.AF, "admin_save_employee_compensation_draft", prof({ employeeId: E.F3 }))
  await t("PROFILE_commission_only_profile_allowed", () => pEmpty.r?.ok === true || pEmpty)
  const pexp = async (name, payload, code, uid = P.AM) => { const r = await rpc(uid, "admin_save_employee_compensation_draft", payload); await t(name, () => (r.r?.ok === false && r.r.code === code) || r) }
  await pexp("PROFILE_visibility_without_component_rejected", prof({ employeeId: E.F1, previousProfileId: p1.r.profileId, showFuel: true }), "visibility_without_component")
  await pexp("PROFILE_transport_without_method_rejected", prof({ employeeId: E.F1, previousProfileId: p1.r.profileId, transportAmount: "10.00" }), "invalid_method")
  await pexp("PROFILE_method_without_amount_rejected", prof({ employeeId: E.F1, previousProfileId: p1.r.profileId, fuelMethod: "monthly_fixed" }), "invalid_method")
  await pexp("PROFILE_zero_salary_rejected", prof({ employeeId: E.F1, previousProfileId: p1.r.profileId, salaryAmount: "0.00" }), "invalid_amount")
  await pexp("PROFILE_unknown_field_rejected", { ...prof({ previousProfileId: p1.r.profileId }), status: "active" }, "unknown_field")
  await pexp("PROFILE_reason_required", prof({ previousProfileId: p1.r.profileId, reason: "" }), "reason_required")
  await pexp("PROFILE_retroactive_forbidden", prof({ previousProfileId: p1.r.profileId, validFrom: DM1 }), "retroactive_forbidden")
  await pexp("PROFILE_dismissed_employee_rejected", prof({ employeeId: E.FX }), "employee_dismissed")
  await pexp("PROFILE_stale_without_previous_rejected", prof({ salaryAmount: "2600.00" }), "stale_version")
  for (const k of ["AC", "F1", "CM"]) await pexp(`PROFILE_${k}_forbidden`, prof({ employeeId: E.F2, previousProfileId: pNoMeal.r.profileId }), "forbidden", P[k])
  const beforeP1 = await one(`select to_jsonb(c) - 'status' - 'updated_at' j from public.employee_compensation_profiles c where id=$1`, [p1.r.profileId])
  const pv2Payload = prof({ previousProfileId: p1.r.profileId, salaryAmount: "2650.00", showSalary: true, mealDailyAmount: "21.75", showMeal: false, notes: "Reajuste anual", reason: "Reajuste lab" })
  const pv2 = await rpc(P.AF, "admin_save_employee_compensation_draft", pv2Payload)
  await t("PROFILE_edit_creates_version_2", () => (pv2.r?.ok === true && pv2.r.version === 2) || pv2)
  const afterP1 = await one(`select to_jsonb(c) - 'status' - 'updated_at' j, status from public.employee_compensation_profiles c where id=$1`, [p1.r.profileId])
  await t("PROFILE_previous_inactive_values_immutable", () => (afterP1.status === "inactive" && JSON.stringify(afterP1.j) === JSON.stringify(beforeP1.j)) || { beforeP1, afterP1 })
  await t("PROFILE_history_update_blocked", async () => { try { await c.query(`update public.employee_compensation_profiles set salary_amount=1 where id=$1`, [p1.r.profileId]); return "updated!" } catch (e) { return /snapshot_immutable/.test(e.message) || e.message } })
  await t("PROFILE_history_delete_blocked", async () => { try { await c.query(`delete from public.employee_compensation_profiles where id=$1`, [p1.r.profileId]); return "deleted!" } catch (e) { return /no_delete/.test(e.message) || e.message } })
  await t("PROFILE_activation_impossible_superuser", async () => { try { await c.query(`update public.employee_compensation_profiles set status='active' where id=$1`, [pv2.r.profileId]); return "activated!" } catch (e) { return /foundation_inactive|transition_forbidden/.test(e.message) || e.message } })
  await t("PROFILE_second_draft_blocked_by_index", async () => { try { await c.query(`insert into public.employee_compensation_profiles(employee_id,version,valid_from,status,idempotency_key) values ($1,99,current_date+5,'draft','j4labdoubledraft0000000')`, [E.F1]); return "inserted!" } catch (e) { return /one_draft_uidx/.test(e.message) || e.message } })
  const prep = await rpc(P.AF, "admin_save_employee_compensation_draft", pv2Payload)
  await t("PROFILE_idempotent_replay", () => (prep.r?.ok === true && prep.r.idempotent === true && prep.r.profileId === pv2.r.profileId) || prep)
  const pconf = await rpc(P.AF, "admin_save_employee_compensation_draft", { ...pv2Payload, salaryAmount: "9999.00" })
  await t("PROFILE_idempotency_conflict", () => pconf.r?.code === "idempotency_conflict" || pconf)
  const [pa, pb] = await Promise.all([
    rpc(P.AM, "admin_save_employee_compensation_draft", prof({ previousProfileId: pv2.r.profileId, salaryAmount: "2700.00", showSalary: true, reason: "Concorrente A" }), c2),
    rpc(P.AF, "admin_save_employee_compensation_draft", prof({ previousProfileId: pv2.r.profileId, salaryAmount: "2710.00", showSalary: true, reason: "Concorrente B" }), c3),
  ])
  await t("PROFILE_concurrency_one_wins", () => ([pa, pb].filter((x) => x.r?.ok === true).length === 1 && [pa, pb].filter((x) => x.r?.code === "stale_version").length === 1) || { pa, pb })
  const pWin = pa.r?.ok ? pa : pb
  await t("PROFILE_single_draft_per_employee", async () => (await one(`select count(*)::int n from public.employee_compensation_profiles where employee_id=$1 and status='draft'`, [E.F1])).n === 1)

  // ---------- visibilidade do funcionário ----------
  const pv1 = await read(P.F1, "public.employee_compensation_preview()")
  await t("EMPLOYEE_sees_visible_salary_only", () => (pv1.ok && pv1.r.configured === true && Object.keys(pv1.r.components).join() === "salary" && ["2700.00", "2710.00"].includes(pv1.r.components.salary.amount)) || pv1)
  await t("EMPLOYEE_hidden_meal_not_present_not_zero", () => (!("meal" in pv1.r.components) && !JSON.stringify(pv1.r).includes("21.75")) || pv1.r)
  await t("EMPLOYEE_total_sum_visible_monthly", () => (pv1.r.estimatedTotal === (Number(pv1.r.components.salary.amount)).toFixed(2) && pv1.r.perDayComponentsExcluded === false && pv1.r.closedPayroll === false) || pv1.r)
  await t("EMPLOYEE_commission_not_calculated", () => (pv1.r.commission && pv1.r.commission.status === "not_calculated") || pv1.r)
  await t("EMPLOYEE_preview_closed_keys", () => Object.keys(pv1.r).sort().join() === "closedPayroll,commission,competenceMonth,components,configured,employeeStatus,estimatedTotal,perDayComponentsExcluded,readOnly" || Object.keys(pv1.r))
  await t("EMPLOYEE_competence_month_current", () => pv1.r.competenceMonth === today.slice(0, 8) + "01" || pv1.r)
  const pv2r = await read(P.F2, "public.employee_compensation_preview()")
  await t("EMPLOYEE_B_transport_fuel_no_salary", () => (pv2r.ok && Object.keys(pv2r.r.components).sort().join() === "fuel,transport" && pv2r.r.estimatedTotal === "180.00" && pv2r.r.perDayComponentsExcluded === true) || pv2r)
  await t("EMPLOYEE_A_never_sees_B", () => (!JSON.stringify(pv1.r).includes("180.00") && !JSON.stringify(pv1.r).includes("15.40") && !JSON.stringify(pv2r.r).includes("2700") && !JSON.stringify(pv2r.r).includes("2710")) || { pv1, pv2r })
  const pv3 = await read(P.F3, "public.employee_compensation_preview()")
  await t("EMPLOYEE_profile_without_components_no_commission_role_empty", () => (pv3.ok && pv3.r.configured === true && Object.keys(pv3.r.components).length === 0 && pv3.r.estimatedTotal === null && pv3.r.commission === null) || pv3)
  const aB = await read(P.F1, "public.admin_get_employee_compensation($1::uuid)", [E.F2])
  await t("EMPLOYEE_cannot_read_admin_detail_of_B", () => (!aB.ok && /compensation_config_forbidden/.test(aB.msg)) || aB)
  for (const k of ["AM", "AC", "CM", "IND"]) {
    const r = await read(P[k], "public.employee_compensation_preview()")
    await t(`EMPLOYEE_preview_${k}_forbidden`, () => (!r.ok && /employee_portal_forbidden/.test(r.msg)) || r)
  }
  const j2 = await read(P.F1, "public.employee_compensation_summary(12,0)")
  await t("J2_summary_unchanged_only_active_profile", () => (j2.ok && j2.r.profile === null) || j2)
  const parch = await rpc(P.AM, "admin_archive_employee_compensation_draft", { idempotencyKey: key(), profileId: pNoMeal.r.profileId, reason: "Desativar configuração lab" })
  await t("PROFILE_archive_deactivates_not_delete", async () => { const r = await one(`select status from public.employee_compensation_profiles where id=$1`, [pNoMeal.r.profileId]); return (parch.r?.ok === true && r.status === "inactive") || { parch, r } })
  const pv2b = await read(P.F2, "public.employee_compensation_preview()")
  await t("EMPLOYEE_archived_profile_friendly_empty", () => (pv2b.ok && pv2b.r.configured === false && Object.keys(pv2b.r.components).length === 0 && pv2b.r.estimatedTotal === null && pv2b.r.commission?.status === "not_calculated") || pv2b)

  // ---------- leitura admin remuneração ----------
  const le = await read(P.AM, "public.admin_list_compensation_employees()")
  const leF1 = le.ok ? le.r.employees.find((x) => x.employeeId === E.F1) : null
  await t("READ_employees_list_current_version", () => (leF1 && leF1.currentProfile.version === 3 && leF1.versionCount === 3 && leF1.sectors[0].code === "technician" && leF1.status === "active") || le)
  await t("READ_employees_list_no_amounts", () => (le.ok && !/2500|2650|2700|2710|21\.75|180\.00|15\.40/.test(JSON.stringify(le.r))) || "amount leaked")
  const ge = await read(P.AF, "public.admin_get_employee_compensation($1::uuid)", [E.F1])
  await t("READ_detail_history_statuses", () => (ge.ok && ge.r.versions.map((v) => `${v.version}:${v.status}`).join() === "3:draft,2:superseded,1:superseded" && ge.r.versions[1].notes === "Reajuste anual") || ge)
  const ge2 = await read(P.AF, "public.admin_get_employee_compensation($1::uuid)", [E.F2])
  await t("READ_detail_archived_status", () => (ge2.ok && ge2.r.versions[0].status === "archived" && ge2.r.versions[0].archiveReason === "Desativar configuração lab") || ge2)
  for (const k of ["AC", "F1"]) {
    const r = await read(P[k], "public.admin_list_compensation_employees()")
    await t(`READ_employees_${k}_forbidden`, () => (!r.ok && /compensation_config_forbidden/.test(r.msg)) || r)
  }

  // ---------- auditoria ----------
  const ev = await q(`select action, entity_type, actor_role, reason, before_state, after_state, operation_id from public.finance_audit_events order by created_at`)
  await t("AUDIT_events_for_every_write", () => ["commission_rule_draft_created", "commission_rule_draft_versioned", "commission_rule_draft_archived", "compensation_draft_configured", "compensation_draft_versioned", "compensation_draft_archived"].every((a) => ev.some((e) => e.action === a)) || ev.map((e) => e.action))
  await t("AUDIT_reason_and_actor_role_recorded", () => ev.every((e) => e.reason && e.reason.length >= 3 && ["admin_master", "admin_financeiro"].includes(e.actor_role)) || ev)
  await t("AUDIT_never_logs_salary_benefit_values", () => !/2500|2650|2700|2710|21\.75|180\.00|15\.40|31\.50|33\.00|48\.90|0\.123456/.test(JSON.stringify(ev.map((e) => [e.before_state, e.after_state]))) || "value in snapshot")
  const evCount = (await one(`select count(*)::int n from public.finance_audit_events`)).n
  const rowCount = (await one(`select (select count(*) from public.employee_commission_rules)::int + (select count(*) from public.employee_compensation_profiles)::int n`)).n
  await t("AUDIT_count_matches_writes", () => evCount === rowCount + 2 || { evCount, rowCount })
  await t("AUDIT_append_only", async () => { try { await c.query(`update public.finance_audit_events set reason='x'`); return "updated!" } catch (e) { return /append_only/.test(e.message) || e.message } })

  // ---------- legado sem execução por clientes ----------
  const leg1 = await call("authenticated", P.AF, `public.open_payroll_competence_draft('j4labopencompetence00000', $1::uuid, current_date)`, [E.F1])
  await t("LEGACY_open_competence_not_executable", () => (!leg1.ok && /permission denied/.test(leg1.msg)) || leg1)
  const leg2 = await call("authenticated", P.AF, `public.create_commission_rule_draft('j4lablegacyrule00000000', null, 'technician_originator', 'fixed_amount', 'first_valid_invoice_generated', 10, null, null, current_date + 100)`)
  await t("LEGACY_positional_rule_rpc_not_executable", () => (!leg2.ok && /permission denied/.test(leg2.msg)) || leg2)
  const leg3 = await call("authenticated", P.AF, `public.record_employee_worked_day('j4labworkedday000000000', $1::uuid, current_date, 'worked', true)`, [E.F1])
  await t("LEGACY_worked_day_not_executable", () => (!leg3.ok && /permission denied/.test(leg3.msg)) || leg3)

  // ---------- zero financeiro ----------
  const fin1 = await zeroWriteSnapshot(c)
  await t("ACTIVE_RULE_COUNT_0", async () => (await one(`select count(*)::int n from public.employee_commission_rules where active or status='active'`)).n === 0)
  await t("ACTIVE_PROFILE_COUNT_0", async () => (await one(`select count(*)::int n from public.employee_compensation_profiles where status='active'`)).n === 0)
  await t("ZERO_entitlements_worked_days_competences_lines", () => ["entitlements", "worked_days", "competences", "payroll_lines"].every((k) => fin1[k] === 0 && fin0[k] === 0) || fin1)
  const money1 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet, (select count(*)::int from public.payments) payments`)
  await t("UNCHANGED_rewards_wallet_payments", () => JSON.stringify(money0) === JSON.stringify(money1) || { money0, money1 })
  await t("UNCHANGED_referrals_rewards_wallet_collections_employees_profiles", () => (fin1.referrals_hash === fin0.referrals_hash && fin1.rewards_hash === fin0.rewards_hash && fin1.wallet_hash === fin0.wallet_hash && fin1.collections_hash === fin0.collections_hash && fin1.employees_hash === fin0.employees_hash && fin1.profiles_hash === fin0.profiles_hash) || { fin0, fin1 })
  await c2.end().catch(() => {}); await c3.end().catch(() => {})
} catch (e) {
  res.push(["FATAL", e.stack || e.message]); ok = false
} finally {
  await lab.stop().catch(() => {})
}
for (const r of res) console.log(r.join(" | "))
const pass = res.filter((r) => r[1] === "PASS").length, fail = res.filter((r) => r[1].startsWith("FAIL") || r[0] === "FATAL").length
console.log(`J4_LAB=${pass}/${pass + fail}`)
if (process.env.J4_LAB_OUT) writeFileSync(process.env.J4_LAB_OUT, JSON.stringify(res, null, 2))
process.exit(ok && fail === 0 ? 0 : 1)

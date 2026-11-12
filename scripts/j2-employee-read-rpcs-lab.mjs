// 3.1F-J2 — validação local (127.0.0.1) das RPCs somente leitura da área do funcionário.
// Sem produção, sem ERP, sem Sync. Dados 100% sintéticos e descartáveis.
// Fase 1: tabelas financeiras vazias (como produção) + invariante de escrita zero.
// Fase 2: SIMULAÇÃO de estados futuros SOMENTE NO LAB (triggers desligados via
//         session_replication_role=replica e CHECKs de fundação removidos no lab)
//         para provar isolamento A/B e omissão de componentes ocultos.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { startJ2Lab, zeroWriteSnapshot, J2_PATCH, J2_PREFLIGHT, J2_VERIFY, J2_ROLLBACK } from "./j2-lab-chain.mjs"

// ---------------------------------------------------------------------------
// 3.1F-J2E — verificação SEMÂNTICA de ocultação em list_employee_competence_lines.
// Sem varredura de substring no JSON: schema fechado, tipo de linha/componente por
// allowlist, consistência de totais. createdAt é metadado (validado só como data).
// ---------------------------------------------------------------------------
const LINES_TOP_KEYS = ["competenceMonth", "components", "lines", "status", "total", "version"]
const LINE_KEYS = ["amount", "createdAt", "description", "kind", "quantity", "type"]
const TOTAL_KEYS = ["amount", "kind"]
const LINE_KIND_BY_TYPE = { commission: "commission", meal: "meal", other_earning: "otherEarnings", discount: "discounts" }
// Política do funcionário A no lab: salário/transporte ocultos, combustível desabilitado, estorno nunca exposto.
const A_LINES_POLICY = {
  visibleComponents: ["commission", "discounts", "meal", "otherEarnings"],
  hiddenComponents: ["salary", "baseSalary", "transport", "fuel", "reversal"],
  visibleLineTypes: ["commission", "meal", "other_earning", "discount"],
  hiddenLineTypes: ["base_salary", "transport", "fuel", "reversal"],
}
const sameKeys = (o, keys) => o !== null && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join(",") === [...keys].sort().join(",")
const money = (v) => Math.round(Number(v) * 100)

/** true se a resposta respeita a política; caso contrário, objeto com o motivo (sem varrer texto). */
function checkCompetenceLinesHidden(r, policy) {
  if (!sameKeys(r, LINES_TOP_KEYS)) return { reason: "top_keys", keys: Object.keys(r ?? {}).sort() }
  if (!sameKeys(r.total, TOTAL_KEYS) || !["expected", "closed"].includes(r.total.kind)) return { reason: "total_schema" }
  const comps = r.components
  if (comps === null || typeof comps !== "object" || Array.isArray(comps)) return { reason: "components_schema" }
  for (const k of Object.keys(comps)) {
    if (policy.hiddenComponents.includes(k)) return { reason: "hidden_component", component: k }
    if (!policy.visibleComponents.includes(k)) return { reason: "unknown_component", component: k }
    if (!Number.isFinite(Number(comps[k])) || typeof comps[k] === "object") return { reason: "component_not_numeric", component: k }
  }
  if (!Array.isArray(r.lines)) return { reason: "lines_schema" }
  for (const [i, l] of r.lines.entries()) {
    if (!sameKeys(l, LINE_KEYS)) return { reason: "line_keys", index: i, keys: Object.keys(l ?? {}).sort() }
    if (policy.hiddenLineTypes.includes(l.type)) return { reason: "hidden_line_type", index: i, type: l.type }
    if (!policy.visibleLineTypes.includes(l.type)) return { reason: "unknown_line_type", index: i, type: l.type }
    if (LINE_KIND_BY_TYPE[l.type] !== l.kind || !policy.visibleComponents.includes(l.kind)) return { reason: "line_kind", index: i }
    if (!Number.isFinite(Number(l.amount)) || typeof l.amount === "object") return { reason: "line_amount_not_numeric", index: i }
    if (typeof l.createdAt !== "string" || Number.isNaN(Date.parse(l.createdAt))) return { reason: "line_created_at", index: i }
  }
  const linesSum = r.lines.reduce((a, l) => a + money(l.amount), 0)
  const compsSum = Object.values(comps).reduce((a, v) => a + money(v), 0)
  if (money(r.total.amount) !== linesSum) return { reason: "total_not_sum_of_visible_lines" }
  if (compsSum !== linesSum) return { reason: "components_not_sum_of_visible_lines" }
  for (const k of policy.visibleComponents) {
    if (!(k in comps)) continue
    const fromLines = r.lines.filter((l) => l.kind === k).reduce((a, l) => a + money(l.amount), 0)
    if (money(comps[k]) !== fromLines) return { reason: "component_not_sum_of_its_lines", component: k }
  }
  return true
}

/** Casos explícitos do 3.1F-J2E (fixtures sintéticas, sem banco). */
function semanticSelfTest() {
  const ts = "2026-11-12T21:11:19.833187-03:00" // contém "187" e nada mais de financeiro
  const ln = (type, amount, description, createdAt = "2026-11-12T10:00:00.000001-03:00") => ({ kind: LINE_KIND_BY_TYPE[type] ?? type, type, amount, quantity: 1, createdAt, description })
  const base = () => ({
    competenceMonth: "2026-11-01", status: "draft", version: 1,
    components: { commission: 30, meal: 22, otherEarnings: 10, discounts: -5 },
    total: { kind: "expected", amount: 57 },
    lines: [ln("commission", 30, "Linha lab"), ln("meal", 22, "Vale refeicao"), ln("other_earning", 10, "Outro ganho"), ln("discount", -5, "Desconto")],
  })
  const reorder = (o) => Array.isArray(o) ? o.map(reorder) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, reorder(v)])) : o
  const cases = [
    ["1_hidden_number_only_in_createdAt_passes", true, () => { const r = base(); r.lines.forEach((l) => { l.createdAt = ts }); r.lines[0].createdAt = "2026-11-12T21:43:21.094321-03:00"; return r }],
    ["2a_hidden_value_in_forbidden_component_fails", false, () => { const r = base(); r.components.transport = 187.65; return r }],
    ["2b_hidden_salary_component_fails", false, () => { const r = base(); r.components.salary = 4321.09; return r }],
    ["2c_hidden_value_leaks_into_total_fails", false, () => { const r = base(); r.total.amount = 57 + 187.65; return r }],
    ["3a_hidden_line_type_transport_fails", false, () => { const r = base(); r.lines.push(ln("transport", 187.65, "Transporte")); return r }],
    ["3b_hidden_line_type_base_salary_fails", false, () => { const r = base(); r.lines.push({ ...ln("commission", 0, "x"), type: "base_salary", kind: "salary", amount: 4321.09 }); return r }],
    ["3c_hidden_line_type_reversal_fails", false, () => { const r = base(); r.lines.push({ ...ln("discount", -187.65, "Estorno transporte"), type: "reversal" }); return r }],
    ["4_hidden_component_fully_omitted_passes", true, () => { const r = base(); return "transport" in r.components || "salary" in r.components ? null : r }],
    ["5_allowed_other_component_equal_187_passes", true, () => { const r = base(); r.components.otherEarnings = 187; r.lines[2].amount = 187; r.total.amount = 30 + 22 + 187 - 5; return r }],
    ["6a_extra_sensitive_line_key_fails", false, () => { const r = base(); r.lines[0].baseSalary = 4321.09; return r }],
    ["6b_extra_sensitive_top_key_fails", false, () => { const r = base(); r.salary = { amount: 4321.09 }; return r }],
    ["6c_extra_total_key_fails", false, () => { const r = base(); r.total.hiddenAmount = 187.65; return r }],
    ["7_json_key_order_irrelevant_passes", true, () => reorder(base())],
    ["8_variable_timestamps_irrelevant_passes", true, () => { const r = base(); r.lines.forEach((l, i) => { l.createdAt = new Date(Date.now() - i * 1234567).toISOString() }); return r }],
  ]
  return cases.map(([name, expectPass, build]) => {
    const r = build()
    const v = r === null ? { reason: "fixture_invalid" } : checkCompetenceLinesHidden(r, A_LINES_POLICY)
    return [name, (v === true) === expectPass ? "PASS" : "FAIL " + JSON.stringify(v)]
  })
}

const selfTest = semanticSelfTest()
if (process.argv.includes("--semantic-selftest")) {
  for (const r of selfTest) console.log(r.join(" | "))
  const n = selfTest.filter((r) => r[1] === "PASS").length
  console.log(`J2E_SEMANTIC_SELFTEST=${n}/${selfTest.length}`)
  process.exit(n === selfTest.length ? 0 : 1)
}

const res = []
let ok = selfTest.every((r) => r[1] === "PASS")
const lab = await startJ2Lab({ applyJ2: false })
const { c, REPO_ROOT } = lab
const q = async (sql, p = []) => (await c.query(sql, p)).rows
const one = async (sql, p = []) => (await q(sql, p))[0]
const t = async (name, fn) => {
  try { const v = await fn(); res.push([name, v === true ? "PASS" : "FAIL " + JSON.stringify(v).slice(0, 1200)]); if (v !== true) ok = false }
  catch (e) { await c.query("rollback").catch(() => {}); res.push([name, "FAIL " + e.message]); ok = false }
}
// Executa como cliente PostgREST (role + claim) e devolve também se houve XID (escrita).
const call = async (role, uid, sql, p = []) => {
  await c.query("begin")
  try {
    await c.query(`set local role ${role}`)
    if (uid) await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid])
    const r = await c.query(`select ${sql} as r`, p)
    const x = await c.query("select txid_current_if_assigned() x")
    await c.query("rollback")
    return { ok: true, r: r.rows[0].r, xid: x.rows[0].x }
  } catch (e) { await c.query("rollback"); return { ok: false, msg: e.message, code: e.code } }
}
const A = "55555555-0000-4000-8000-00000000000a", B = "55555555-0000-4000-8000-00000000000b"
const P = { A, B,
  paused: "55555555-0000-4000-8000-000000000001", vacation: "55555555-0000-4000-8000-000000000002", away: "55555555-0000-4000-8000-000000000003",
  dismissed: "55555555-0000-4000-8000-000000000004", inactive: "55555555-0000-4000-8000-000000000005", noemp: "55555555-0000-4000-8000-000000000006",
  am: "55555555-0000-4000-8000-000000000007", af: "55555555-0000-4000-8000-000000000008", ac: "55555555-0000-4000-8000-000000000009",
  cm: "55555555-0000-4000-8000-000000000010", ind: "55555555-0000-4000-8000-000000000011" }
const RPCS = [
  ["dashboard", "public.employee_sales_dashboard_summary()"],
  ["list", "public.list_employee_sales()"],
  ["detail", "public.get_employee_sale_detail('00000000-0000-4000-8000-000000000999'::uuid)"],
  ["summary", "public.employee_compensation_summary()"],
  ["lines", "public.list_employee_competence_lines('2026-11-01'::date)"],
]
try {
  // ---------- catálogo antes/depois do patch ----------
  const catalog = async () => one(`select
    (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','m','p')) rels,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select count(*)::int from pg_trigger t join pg_class k on k.oid=t.tgrelid where k.relnamespace='public'::regnamespace and not t.tgisinternal) triggers,
    (select count(*)::int from information_schema.columns where table_schema='public') cols,
    (select md5(string_agg(p.oid::regprocedure::text || coalesce(p.proacl::text,'') || md5(p.prosrc), '|' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname not like 'employee\\_portal\\_%' and p.proname not in ('employee_sales_dashboard_summary','list_employee_sales','get_employee_sale_detail','employee_compensation_summary','list_employee_competence_lines')) other_funcs`)
  const cat0 = await catalog()
  const pre = await c.query(readFileSync(join(REPO_ROOT, J2_PREFLIGHT), "utf8"))
  const preM = Object.fromEntries(pre.rows.map((r) => [r.metric, r.value]))
  await t("PREFLIGHT_prereqs_true", () => Object.entries(preM).filter(([k]) => k.startsWith("prereq_")).every(([, v]) => v === "true") || preM)
  await t("PREFLIGHT_no_existing_j2_functions", () => preM.existing_j2_functions === "0" || preM)
  await t("PREFLIGHT_financial_tables_zero", () => Object.entries(preM).filter(([k]) => k.startsWith("count_")).every(([, v]) => v === "0") || preM)
  const sql = readFileSync(join(REPO_ROOT, J2_PATCH), "utf8")
  await t("APPLY_first", async () => { await c.query(sql); return true })
  const acl1 = await q(`select oid::regprocedure::text s, proacl::text a from pg_proc where pronamespace='public'::regnamespace and (proname like 'employee\\_portal\\_%' or proname in ('employee_sales_dashboard_summary','list_employee_sales','get_employee_sale_detail','employee_compensation_summary','list_employee_competence_lines')) order by 1`)
  await t("APPLY_reapply_idempotent", async () => { await c.query(sql); return true })
  await t("APPLY_reapply_acl_unchanged", async () => JSON.stringify(await q(`select oid::regprocedure::text s, proacl::text a from pg_proc where pronamespace='public'::regnamespace and (proname like 'employee\\_portal\\_%' or proname in ('employee_sales_dashboard_summary','list_employee_sales','get_employee_sale_detail','employee_compensation_summary','list_employee_competence_lines')) order by 1`)) === JSON.stringify(acl1))
  const cat1 = await catalog()
  await t("ADDITIVE_no_new_tables_columns_policies_triggers", () => (cat0.rels === cat1.rels && cat0.policies === cat1.policies && cat0.triggers === cat1.triggers && cat0.cols === cat1.cols) || { cat0, cat1 })
  await t("ADDITIVE_existing_functions_untouched", () => cat0.other_funcs === cat1.other_funcs)
  const ver = await c.query(readFileSync(join(REPO_ROOT, J2_VERIFY), "utf8"))
  for (const r of ver.rows) await t(`VERIFY_${r.check_name}`, () => r.ok === true)
  await t("TRANSACTIONAL_begin_commit", () => /^\s*begin;/m.test(sql) && /^\s*commit;\s*$/m.test(sql))
  await t("NO_DYNAMIC_SQL_in_migration_text", () => !/\bexecute\b(?!\s+on\s+function)/i.test(sql.replace(/--[^\n]*/g, "").replace(/grant execute|revoke all/gi, "")) && !/format\s*\(/i.test(sql))
  await t("NO_DDL_on_existing_objects", () => !/\b(alter|drop)\s+(table|policy|trigger|type)\b|\bcreate\s+(table|policy|trigger|index)\b/i.test(sql.replace(/--[^\n]*/g, "")))
  const fns = await q(`select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) owner from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'employee\\_portal\\_%' or p.proname in ('employee_sales_dashboard_summary','list_employee_sales','get_employee_sale_detail','employee_compensation_summary','list_employee_competence_lines'))`)
  const tblOwner = (await one(`select pg_get_userbyid(relowner) o from pg_class where oid='public.payroll_competences'::regclass`)).o
  await t("OWNERSHIP_functions_owned_by_table_owner", () => fns.every((f) => f.owner === tblOwner) || fns)
  await t("SECDEF_only_where_needed", () => fns.filter((f) => f.prosecdef).map((f) => f.proname).sort().join(",") === "employee_compensation_summary,employee_portal_line_kind,employee_portal_line_visible,employee_portal_self,employee_sales_dashboard_summary,get_employee_sale_detail,list_employee_competence_lines,list_employee_sales" || fns)
  await t("GRANTS_tables_still_no_client_select", async () => (await one(`select bool_or(has_table_privilege(r, 'public.'||x, 'select')) v from unnest(array['employee_commission_rules','employee_commission_entitlements','employee_compensation_profiles','employee_worked_days','payroll_competences','payroll_competence_lines','finance_audit_events']) x, unnest(array['anon','authenticated']) r`)).v === false)

  // ---------- fixtures (sintéticos) ----------
  await c.query(`insert into public.profiles(id,email,role,is_active,full_name) values
    ($1,'a@lab.invalid','funcionario',true,'Lab A'),($2,'b@lab.invalid','funcionario',true,'Lab B'),
    ($3,'p@lab.invalid','funcionario',true,'Lab P'),($4,'v@lab.invalid','funcionario',true,'Lab V'),($5,'w@lab.invalid','funcionario',true,'Lab W'),
    ($6,'d@lab.invalid','funcionario',true,'Lab D'),($7,'i@lab.invalid','funcionario',false,'Lab I'),($8,'n@lab.invalid','funcionario',true,'Lab N'),
    ($9,'am@lab.invalid','admin_master',true,'Lab AM'),($10,'af@lab.invalid','admin_financeiro',true,'Lab AF'),($11,'ac@lab.invalid','admin_consulta',true,'Lab AC'),
    ($12,'cm@lab.invalid','comercial',true,'Lab CM'),($13,'in@lab.invalid','indicador',true,'Lab IN')`,
    [P.A, P.B, P.paused, P.vacation, P.away, P.dismissed, P.inactive, P.noemp, P.am, P.af, P.ac, P.cm, P.ind])
  const E = {}
  for (const [k, st] of [["A", "active"], ["B", "active"], ["paused", "paused"], ["vacation", "vacation"], ["away", "away"], ["dismissed", "dismissed"], ["inactive", "active"]])
    E[k] = (await one(`insert into public.employees(profile_id,status,dismissed_at) values ($1,$2::public.employee_status, case when $2='dismissed' then now() end) returning id`, [P[k], st])).id
  // E2E-like: admin employees (A gestor de B) — gestor NÃO ganha leitura financeira de B.
  await c.query(`update public.employees set manager_employee_id=$1 where id=$2`, [E.A, E.B]).catch(() => {})

  // ---------- FASE 1: banco financeiro vazio ----------
  const snap0 = await zeroWriteSnapshot(c)
  await t("P1_zero_financial_rows_before", () => ["commission_rules", "attributions", "entitlements", "compensation_profiles", "worked_days", "competences", "payroll_lines", "finance_audit_events"].every((k) => snap0[k] === 0) || snap0)
  const dA = await call("authenticated", P.A, RPCS[0][1])
  await t("P1_A_dashboard_real_zeros", () => (dA.ok && dA.r.opportunitiesInMonth === 0 && dA.r.salesInProgress === 0 && dA.r.provenConversions === 0 && dA.r.commissionsAwaitingEvidence === 0 && Number(dA.r.commissionAccruedInCompetence) === 0 && dA.r.currentCompetence === null && dA.r.recent.length === 0 && dA.r.readOnly === false) || dA)
  await t("P1_A_dashboard_closed_keys", () => Object.keys(dA.r).sort().join(",") === "commissionAccruedInCompetence,commissionsAwaitingEvidence,competenceMonth,currentCompetence,employeeStatus,opportunitiesInMonth,provenConversions,readOnly,recent,salesInProgress" || Object.keys(dA.r))
  const lA = await call("authenticated", P.A, RPCS[1][1])
  await t("P1_A_list_empty", () => (lA.ok && lA.r.total === 0 && lA.r.items.length === 0 && lA.r.limit === 20) || lA)
  const sA = await call("authenticated", P.A, RPCS[3][1])
  await t("P1_A_compensation_empty_no_profile_no_defaults", () => (sA.ok && sA.r.profile === null && sA.r.competences.length === 0 && sA.r.total === 0 && !/30|50|22|0\.02/.test(JSON.stringify(sA.r).replace(/"limit":12|"offset":0|"total":0/g, ""))) || sA)
  const lnA = await call("authenticated", P.A, RPCS[4][1])
  await t("P1_A_lines_no_competence_not_found", () => (!lnA.ok && /employee_portal_not_found/.test(lnA.msg)) || lnA)
  const dtA = await call("authenticated", P.A, RPCS[2][1])
  await t("P1_A_detail_unknown_not_found", () => (!dtA.ok && /employee_portal_not_found/.test(dtA.msg)) || dtA)
  for (const [name, s] of RPCS) {
    const r = await call("authenticated", P.A, s)
    await t(`P1_no_xid_assigned_${name}`, () => (r.ok ? r.xid === null : /not_found/.test(r.msg)) || r)
  }
  for (const k of ["paused", "vacation", "away"]) {
    const r = await call("authenticated", P[k], RPCS[0][1])
    await t(`STATUS_${k}_read_only_allowed`, () => (r.ok && r.r.readOnly === true && r.r.employeeStatus === k) || r)
  }
  for (const k of ["dismissed", "inactive", "noemp", "am", "af", "ac", "cm", "ind"]) for (const [name, s] of RPCS) {
    const r = await call("authenticated", P[k], s)
    await t(`DENY_${k}_${name}_forbidden`, () => (!r.ok && /employee_portal_forbidden/.test(r.msg)) || r)
  }
  for (const [name, s] of RPCS) {
    const an = await call("anon", null, s)
    await t(`DENY_anon_${name}_no_execute`, () => (!an.ok && an.code === "42501") || an)
    const sr = await call("service_role", null, s)
    await t(`DENY_service_role_${name}_no_execute`, () => (!sr.ok && sr.code === "42501") || sr)
    const nu = await call("authenticated", null, s)
    await t(`DENY_authenticated_without_sub_${name}`, () => (!nu.ok && /employee_portal_unauthenticated/.test(nu.msg)) || nu)
  }
  for (const h of ["public.employee_portal_self()", "public.employee_portal_mask_name('x')", "public.employee_portal_line_visible(null)", "public.employee_portal_line_kind(null)"]) {
    const r = await call("authenticated", P.A, h)
    await t(`HELPER_not_callable_${h.replace(/public\.|\(.*$/g, "")}`, () => (!r.ok && r.code === "42501") || r)
  }
  const bad = [
    ["limit_0", "public.list_employee_sales(p_limit => 0)"], ["limit_51", "public.list_employee_sales(p_limit => 51)"],
    ["offset_neg", "public.list_employee_sales(p_offset => -1)"], ["offset_huge", "public.list_employee_sales(p_offset => 10001)"],
    ["sort_unknown", "public.list_employee_sales(p_sort => 'referred_phone')"], ["sort_injection", "public.list_employee_sales(p_sort => 'created_desc; drop table referrals')"],
    ["stage_unknown", "public.list_employee_sales(p_stage => 'x')"], ["status_unknown", "public.list_employee_sales(p_status => 'x')"],
    ["commission_unknown", "public.list_employee_sales(p_commission => 'x')"], ["from_after_to", "public.list_employee_sales(p_from => '2026-02-01', p_to => '2026-01-01')"],
    ["lines_not_first_day", "public.list_employee_competence_lines('2026-11-15')"], ["summary_limit_25", "public.employee_compensation_summary(25)"],
    ["dashboard_month_out_of_range", "public.employee_sales_dashboard_summary('1990-01-01')"], ["detail_null", "public.get_employee_sale_detail(null)"],
  ]
  for (const [n, s] of bad) { const r = await call("authenticated", P.A, s); await t(`VALIDATION_${n}_rejected`, () => (!r.ok && /employee_portal_invalid_parameter/.test(r.msg)) || r) }
  const snap1 = await zeroWriteSnapshot(c)
  await t("ZERO_WRITE_INVARIANT_phase1", () => JSON.stringify(snap0) === JSON.stringify(snap1) || { snap0, snap1 })

  // ---------- FASE 2: simulação lab-only de dados futuros ----------
  await c.query("set session_replication_role = replica")
  for (const [tb, cn] of [["employee_compensation_profiles", "employee_compensation_profiles_foundation_inactive_chk"], ["payroll_competences", "payroll_competences_foundation_no_close_pay_chk"]])
    await c.query(`alter table public.${tb} drop constraint if exists ${cn}`)
  const ind = P.ind
  const plan = (await one(`select id from public.plans limit 1`))?.id ?? (await one(`insert into public.plans(name, speed_label, price, reward_amount) values ('Plano Lab','100M',1,0) returning id`)).id
  const mkRef = async (name, paid = false) => (await one(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind,first_invoice_paid) values ($1,$2,'11999990000',$3,false,'legacy',$4) returning id`, [ind, name, plan, paid])).id
  const rA1 = await mkRef("Fulano de Tal Silva")
  const rA2 = await mkRef("Beltrana Souza", true)
  await c.query(`update public.referrals set pipeline_stage='ativado' where id=$1`, [rA2])
  const rB1 = await mkRef("Ciclano Pereira")
  const att = async (opp, emp, role) => (await one(`insert into public.sales_opportunity_attributions(opportunity_id,employee_id,attribution_role,source) values ($1,$2,$3,'attribution_rpc') returning id`, [opp, emp, role])).id
  const atA1 = await att(rA1, E.A, "technician_originator")
  const atA2 = await att(rA2, E.A, "technician_originator")
  const atB1 = await att(rB1, E.B, "technician_originator")
  await att(rA1, E.B, "internal_sales_responsible")
  await c.query(`insert into public.referral_history(referral_id,actor_profile_id,old_status,new_status,action_note) values ($1,$2,'pendente','em_andamento','NOTA-INTERNA-SECRETA 11999990000')`, [rA1, P.am])
  const month = (await one(`select date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date::text m`)).m
  const prevMonth = (await one(`select (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) - interval '1 month')::date::text m`)).m
  const rule = (await one(`insert into public.employee_commission_rules(rule_family_id,attribution_role,method,trigger_kind,fixed_amount,effective_from,idempotency_key) values (gen_random_uuid(),'technician_originator','fixed_amount','first_valid_invoice_generated',30,'2026-01-01','labrule0000000000000001') returning id`)).id
  const snapR = (role) => JSON.stringify({ ruleId: rule, ruleVersion: 1, method: "fixed_amount", trigger: "first_valid_invoice_generated", attributionRole: role, currency: "BRL" })
  const ent = async (opp, emp, atId, status, amount, k, comp) => (await one(`insert into public.employee_commission_entitlements(opportunity_id,employee_id,attribution_id,rule_id,attribution_role,trigger_kind,status,amount,competence_month,accrued_at,idempotency_key,rule_snapshot,triggering_contract_pk,triggering_invoice_pk)
     values ($1,$2,$3,$4,'technician_originator','first_valid_invoice_generated',$5,$6,$7,case when $5<>'pending_evidence' then now() end,$8,$9::jsonb,'123456','654321') returning id`, [opp, emp, atId, rule, status, amount, comp, k, snapR("technician_originator")])).id
  await ent(rA1, E.A, atA1, "pending_evidence", null, "labent00000000000000000A1", null)
  const eA2 = await ent(rA2, E.A, atA2, "accrued", 30, "labent00000000000000000A2", month)
  const eB1 = await ent(rB1, E.B, atB1, "accrued", 50, "labent00000000000000000B1", month)
  const prof = async (emp, k, f) => (await one(`insert into public.employee_compensation_profiles(employee_id,version,valid_from,salary_enabled,salary_amount,meal_enabled,meal_daily_amount,transport_enabled,transport_amount,transport_method,fuel_enabled,fuel_amount,fuel_method,show_salary,show_meal,show_transport,show_fuel,status,idempotency_key)
     values ($1,1,'2026-01-01',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'active',$16) returning id`, [emp, ...f, k])).id
  // A: salário habilitado mas OCULTO (4321.09), vale visível (22.00), transporte habilitado OCULTO (187.65), combustível desabilitado.
  const pA = await prof(E.A, "labprof00000000000000000A", [true, 4321.09, true, 22, true, 187.65, "monthly_fixed", false, null, null, false, true, false, false])
  // B: salário visível.
  const pB = await prof(E.B, "labprof00000000000000000B", [true, 1234.56, false, null, false, null, null, false, null, null, true, false, false, false])
  const comp = async (emp, m, status, k) => (await one(`insert into public.payroll_competences(employee_id,competence_month,period_start,period_end,status,idempotency_key,closed_at,closed_by) values ($1,$2::date,$2::date,public.payroll_competence_period_end($2::date),$3,$4,case when $3 in ('closed','paid') then now() end,case when $3 in ('closed','paid') then $5::uuid end) returning id`, [emp, m, status, k, P.af])).id
  const cA = await comp(E.A, month, "draft", "labcomp00000000000000000A")
  const cAprev = await comp(E.A, prevMonth, "closed", "labcomp0000000000000000AP")
  const cB = await comp(E.B, month, "draft", "labcomp00000000000000000B")
  const wd = (await one(`insert into public.employee_worked_days(employee_id,work_date,status,meal_eligible,operation_id) values ($1,$2::date,'worked',true,'labwd000000000000000001') returning id`, [E.A, month])).id
  const audit = async (k) => (await one(`insert into public.finance_audit_events(actor_id,actor_role,action,entity_type,entity_id,operation_id,reason) values ($1,'admin_financeiro','payroll_adjustment_added','payroll_competence',$2,$3,'motivo lab sintetico') returning id`, [P.af, cA, k])).id
  const line = async (cid, type, amount, refs, k, desc = "Linha lab") => (await one(`insert into public.payroll_competence_lines(competence_id,line_type,commission_entitlement_id,compensation_profile_id,worked_day_id,adjustment_audit_event_id,reversal_of_line_id,description,amount,reason,idempotency_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,case when $2 in ('discount','adjustment','reversal') then 'motivo lab' end,$10) returning id`, [cid, type, refs.ent ?? null, refs.prof ?? null, refs.wd ?? null, refs.aud ?? null, refs.rev ?? null, desc, amount, k])).id
  await line(cA, "commission", 30, { ent: eA2 }, "labline0000000000000001")
  await line(cA, "base_salary", 4321.09, { prof: pA }, "labline0000000000000002", "Salario base")
  await line(cA, "meal", 22, { prof: pA, wd }, "labline0000000000000003", "Vale refeicao")
  const trA = await line(cA, "transport", 187.65, { prof: pA }, "labline0000000000000004", "Transporte")
  await line(cA, "reversal", -187.65, { rev: trA }, "labline0000000000000005", "Estorno transporte")
  await line(cA, "other_earning", 10, { aud: await audit("labaud0000000000000001") }, "labline0000000000000006", "Outro ganho")
  await line(cA, "discount", -5, { aud: await audit("labaud0000000000000002") }, "labline0000000000000007", "Desconto")
  await line(cAprev, "commission", 0, { ent: eA2 }, "labline0000000000000008").catch(() => {})
  await line(cB, "commission", 50, { ent: eB1 }, "labline0000000000000009")
  await line(cB, "base_salary", 1234.56, { prof: pB }, "labline0000000000000010", "Salario base")
  await c.query("set session_replication_role = origin")

  const snap2 = await zeroWriteSnapshot(c)
  const d2 = await call("authenticated", P.A, "public.employee_sales_dashboard_summary()")
  await t("P2_A_dashboard_counts_own_only", () => (d2.ok && d2.r.opportunitiesInMonth === 2 && d2.r.salesInProgress === 1 && d2.r.provenConversions === 1 && d2.r.commissionsAwaitingEvidence === 1 && Number(d2.r.commissionAccruedInCompetence) === 30 && d2.r.currentCompetence?.status === "draft" && d2.r.recent.length === 2) || d2)
  const l2 = await call("authenticated", P.A, "public.list_employee_sales()")
  const ids = (l2.r?.items ?? []).map((x) => x.id)
  await t("P2_A_list_only_own_sales", () => (l2.ok && l2.r.total === 2 && ids.includes(rA1) && ids.includes(rA2) && !ids.includes(rB1)) || l2)
  await t("P2_A_list_item_closed_keys", () => l2.r.items.every((x) => Object.keys(x).sort().join(",") === "commissionStatus,createdAt,id,interested,plan,reference,role,stage,status,updatedAt") || l2.r.items[0])
  await t("P2_A_list_interested_masked_no_phone", () => { const s = JSON.stringify(l2.r); return s.includes("Fulano S.") && !s.includes("Silva") && !s.includes("11999990000") && !/contract|invoice|pk|payload|notes/i.test(s) || s })
  await t("P2_A_list_commission_status", () => l2.r.items.find((x) => x.id === rA1)?.commissionStatus === "pending_evidence" && l2.r.items.find((x) => x.id === rA2)?.commissionStatus === "accrued")
  const f1 = await call("authenticated", P.A, "public.list_employee_sales(p_commission => 'pending_evidence')")
  await t("P2_filter_commission", () => (f1.r.total === 1 && f1.r.items[0].id === rA1) || f1)
  const f2 = await call("authenticated", P.A, "public.list_employee_sales(p_stage => 'ativado')")
  await t("P2_filter_stage", () => (f2.r.total === 1 && f2.r.items[0].id === rA2) || f2)
  const f3 = await call("authenticated", P.A, "public.list_employee_sales(p_limit => 1, p_offset => 1, p_sort => 'created_asc')")
  await t("P2_pagination_total_and_page", () => (f3.r.total === 2 && f3.r.items.length === 1 && f3.r.items[0].id === rA2) || f3)
  const f4 = await call("authenticated", P.A, "public.list_employee_sales(p_from => '2099-01-01')")
  await t("P2_filter_period", () => f4.r.total === 0 || f4)
  const dB = await call("authenticated", P.A, `public.get_employee_sale_detail('${rB1}'::uuid)`)
  const dX = await call("authenticated", P.A, `public.get_employee_sale_detail('00000000-0000-4000-8000-000000000999'::uuid)`)
  await t("P2_A_detail_of_B_same_error_as_nonexistent", () => (!dB.ok && !dX.ok && dB.msg === dX.msg && dB.code === dX.code) || { dB, dX })
  const d1 = await call("authenticated", P.A, `public.get_employee_sale_detail('${rA1}'::uuid)`)
  await t("P2_A_detail_own_sanitized", () => { const s = JSON.stringify(d1.r); return (d1.ok && d1.r.timeline.length === 1 && d1.r.timeline[0].to === "em_andamento" && !s.includes("NOTA-INTERNA") && !s.includes("11999990000") && !/123456|654321|contract|invoice|"rule|snapshot|actor|"note/i.test(s) && d1.r.commissions.length === 1 && d1.r.commissions[0].amount === null) || s })
  await t("P2_A_detail_shared_opportunity_shows_only_own_role", () => d1.r.role === "technician_originator" && d1.r.commissions.every((x) => x.status === "pending_evidence"))
  const dBown = await call("authenticated", P.B, `public.get_employee_sale_detail('${rA1}'::uuid)`)
  await t("P2_B_sees_shared_opportunity_with_own_role_only", () => (dBown.ok && dBown.r.role === "internal_sales_responsible" && dBown.r.commissions.length === 0) || dBown)
  const s2 = await call("authenticated", P.A, "public.employee_compensation_summary()")
  const s2txt = JSON.stringify(s2.r ?? {})
  await t("P2_A_profile_hidden_components_omitted", () => (s2.ok && s2.r.profile && !("salary" in s2.r.profile) && !("transport" in s2.r.profile) && !("fuel" in s2.r.profile) && Number(s2.r.profile.meal.dailyAmount) === 22) || s2.r)
  await t("P2_A_hidden_values_absent_from_json", () => !/4321|187\.65|187|1234/.test(s2txt) || s2txt)
  const cur = s2.r.competences.find((x) => x.competenceMonth === month)
  const prv = s2.r.competences.find((x) => x.competenceMonth === prevMonth)
  await t("P2_A_visible_total_excludes_hidden_and_reversal", () => (Number(cur?.visibleTotal) === 57 && cur.totalKind === "expected") || cur)
  await t("P2_A_closed_competence_total_kind_closed", () => (prv?.totalKind === "closed" && prv.status === "closed") || prv)
  await t("P2_A_summary_only_own_competences", () => s2.r.total === 2 && s2.r.competences.length === 2)
  const ln2 = await call("authenticated", P.A, `public.list_employee_competence_lines('${month}'::date)`)
  const ln2txt = JSON.stringify(ln2.r ?? {})
  await t("P2_A_lines_components_exact", () => (ln2.ok && Object.keys(ln2.r.components).sort().join(",") === "commission,discounts,meal,otherEarnings") || ln2.r?.components)
  // 3.1F-J2E: verificação semântica (schema fechado + allowlist de tipos/componentes + totais)
  // e conjunto EXATO de linhas visíveis esperadas para A; sem varredura de substring no JSON.
  const A_VISIBLE_LINES = ["commission|30|Linha lab", "discount|-5|Desconto", "meal|22|Vale refeicao", "other_earning|10|Outro ganho"]
  await t("P2_A_lines_hidden_types_absent", () => {
    const sem = checkCompetenceLinesHidden(ln2.r, A_LINES_POLICY)
    if (sem !== true) return { sem, ln2: ln2txt }
    const got = ln2.r.lines.map((l) => `${l.type}|${money(l.amount) / 100}|${l.description}`).sort()
    return JSON.stringify(got) === JSON.stringify(A_VISIBLE_LINES) || { got }
  })
  await t("P2_A_lines_total_expected_57", () => (ln2.r.total.kind === "expected" && Number(ln2.r.total.amount) === 57) || ln2.r.total)
  const lnB = await call("authenticated", P.A, `public.list_employee_competence_lines('${prevMonth}'::date)`)
  await t("P2_A_prev_month_closed_lines", () => (lnB.ok && lnB.r.total.kind === "closed") || lnB)
  const sB = await call("authenticated", P.B, "public.employee_compensation_summary()")
  await t("P2_B_visible_salary_shown_to_B_only", () => (sB.ok && Number(sB.r.profile.salary.amount) === 1234.56 && !("meal" in sB.r.profile)) || sB.r)
  await t("P2_B_does_not_see_A_values", () => !/4321|"22|57/.test(JSON.stringify(sB.r)))
  const dashB = await call("authenticated", P.B, "public.employee_sales_dashboard_summary()")
  await t("P2_manager_A_gets_no_B_finance_and_B_isolated", () => (dashB.ok && Number(dashB.r.commissionAccruedInCompetence) === 50 && dashB.r.opportunitiesInMonth === 2) || dashB.r)
  for (const [name, s] of RPCS.slice(0, 4)) {
    const r = await call("authenticated", P.A, s.replace("'00000000-0000-4000-8000-000000000999'", `'${rA1}'`))
    await t(`P2_no_xid_assigned_${name}`, () => (r.ok && r.xid === null) || r)
  }
  const snap3 = await zeroWriteSnapshot(c)
  await t("ZERO_WRITE_INVARIANT_phase2_reads", () => JSON.stringify(snap2) === JSON.stringify(snap3) || { snap2, snap3 })
  for (const k of ["dismissed", "ac", "am", "af"]) {
    const r = await call("authenticated", P[k], `public.get_employee_sale_detail('${rA1}'::uuid)`)
    await t(`P2_DENY_${k}_detail_with_data_present`, () => (!r.ok && /employee_portal_forbidden/.test(r.msg)) || r)
  }

  // ---------- rollback documentado ----------
  await t("ROLLBACK_removes_only_new_functions", async () => {
    const before = await zeroWriteSnapshot(c)
    await c.query(readFileSync(join(REPO_ROOT, J2_ROLLBACK), "utf8"))
    const n = (await one(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and (proname like 'employee\\_portal\\_%' or proname in ('employee_sales_dashboard_summary','list_employee_sales','get_employee_sale_detail','employee_compensation_summary','list_employee_competence_lines'))`)).n
    const cat2 = await catalog()
    return (n === 0 && JSON.stringify(before) === JSON.stringify(await zeroWriteSnapshot(c)) && cat2.other_funcs === cat0.other_funcs && cat2.rels === cat0.rels) || { n, cat2 }
  })
  await t("ROLLBACK_then_reapply_ok", async () => { await c.query(sql); return (await one(`select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname in ('employee_sales_dashboard_summary','list_employee_sales','get_employee_sale_detail','employee_compensation_summary','list_employee_competence_lines')`)).n === 5 })
} finally {
  await lab.stop()
}
for (const r of res) console.log(r.join(" | "))
for (const r of selfTest) console.log(["J2E_SELFTEST_" + r[0], r[1]].join(" | "))
console.log(`J2E_SEMANTIC_SELFTEST=${selfTest.filter((r) => r[1] === "PASS").length}/${selfTest.length}`)
const pass = res.filter((r) => r[1] === "PASS").length
console.log(`J2_PG_TESTS=${pass}/${res.length}`)
console.log(ok ? "J2_PG_LAB=PASS" : "J2_PG_LAB=FAIL")
if (process.env.J2_LAB_RESULT_FILE) writeFileSync(process.env.J2_LAB_RESULT_FILE, JSON.stringify({ pass, total: res.length, ok, res }, null, 2))
process.exit(ok ? 0 : 1)

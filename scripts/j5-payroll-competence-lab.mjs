// 3.1F-J5 — aprovação, dias, competência e cálculo controlado. Lab PG local 127.0.0.1.
// Não usa DATABASE_URL, não conecta em produção, não chama ERP.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

process.env.IGT_PG_LAB_PORT ||= "55476"

import { startJ2Lab, zeroWriteSnapshot } from "./j2-lab-chain.mjs"

const J3 = "supabase/patch-employee-sales-opportunity-3-1f-j3.sql"
const J4 = "supabase/patch-employee-compensation-configuration-3-1f-j4.sql"
const J5 = "supabase/patch-employee-payroll-competence-3-1f-j5.sql"
const PRE = "supabase/preflight-employee-payroll-competence-3-1f-j5.sql"
const VER = "supabase/verify-employee-payroll-competence-3-1f-j5.sql"
const LEGACY = ["create_commission_rule_draft", "version_commission_rule_draft", "configure_employee_compensation_draft",
  "record_employee_worked_day", "open_payroll_competence_draft", "add_manual_payroll_adjustment"]

const res = []
let ok = true
const lab = await startJ2Lab({ applyJ2: true })
const { c, conn, Client, REPO_ROOT, applyFile } = lab
const q = async (sql, p = []) => (await c.query(sql, p)).rows
const one = async (sql, p = []) => (await q(sql, p))[0]
const t = async (name, fn) => {
  try { const v = await fn(); res.push([name, v === true ? "PASS" : "FAIL " + JSON.stringify(v).slice(0, 1000)]); if (v !== true) ok = false }
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
const id = (n) => `88888888-0000-4000-8000-${String(n).padStart(12, "0")}`
const P = { AM: id(1), AF: id(2), AC: id(3), F1: id(4), F2: id(5), F3: id(6), FX: id(7) }
let seq = 0
const key = () => `j5labkey${String(++seq).padStart(5, "0")}${"z".repeat(12)}`

try {
  await applyFile(J3)
  await applyFile(J4)
  const sql = readFileSync(join(REPO_ROOT, J5), "utf8")
  const preM = Object.fromEntries((await c.query(readFileSync(join(REPO_ROOT, PRE), "utf8"))).rows.map((r) => [r.metric, r.value]))
  await t("PREFLIGHT_prereqs", () => Object.entries(preM).filter(([k]) => k.startsWith("prereq_")).every(([, v]) => v === "true") || preM)
  await t("PREFLIGHT_legacy_revoked", () => preM.legacy_worked_day_execute === "false" && preM.legacy_open_execute === "false" && preM.legacy_adjust_execute === "false")
  await t("PREFLIGHT_financial_zero", () => ["count_active_rules", "count_entitlements", "count_competences", "count_lines", "count_worked_days", "count_paid"].every((k) => preM[k] === "0") || preM)
  await t("APPLY_first", async () => { await c.query(sql); return true })
  await t("APPLY_reapply", async () => { await c.query(sql); return true })
  for (const r of (await c.query(readFileSync(join(REPO_ROOT, VER), "utf8"))).rows) await t(`VERIFY_${r.check_name}`, () => r.ok === true)
  await t("LEAP_FEB_COMMON", async () => (await one(`select public.payroll_competence_period_end('2023-02-01')::text d`)).d === "2023-02-28")
  await t("LEAP_FEB_BISSEXTO", async () => (await one(`select public.payroll_competence_period_end('2024-02-01')::text d`)).d === "2024-02-29")
  await t("DEC_JAN", async () => {
    const a = await one(`select public.payroll_competence_period_end('2025-12-01')::text d`)
    const b = await one(`select public.payroll_j5_month('2026-01-15'::date)::text d`)
    return a.d === "2025-12-31" && b.d === "2026-01-01"
  })
  await t("ROUND_HALF_AWAY", async () => {
    const r = await one(`select public.payroll_j5_round(1.225) a, public.payroll_j5_round(-1.225) b, public.payroll_daily_benefit_preview(22.15, 3) c`)
    return r.a === "1.23" && r.b === "-1.23" && r.c === "66.45"
  })

  await c.query(`insert into public.profiles(id,email,role,is_active,full_name) values
    ($1,'am@j5.invalid','admin_master',true,'Admin Master J5'),($2,'af@j5.invalid','admin_financeiro',true,'Admin Fin J5'),
    ($3,'ac@j5.invalid','admin_consulta',true,'Admin Consulta J5'),($4,'f1@j5.invalid','funcionario',true,'Funcionario A J5'),
    ($5,'f2@j5.invalid','funcionario',true,'Funcionario B J5'),($6,'f3@j5.invalid','funcionario',true,'Funcionario C J5'),
    ($7,'fx@j5.invalid','funcionario',true,'Desligado J5') on conflict (id) do nothing`, Object.values(P))
  const S = Object.fromEntries((await q(`select code, id from public.sectors`)).map((r) => [r.code, r.id]))
  const today = (await one(`select public.comp_cfg_today()::text d`)).d
  const month = `${today.slice(0, 7)}-01`
  const hire = (await one(`select (public.comp_cfg_today() - 10)::text d`)).d
  const E = {}
  E.F1 = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', (($2::date + time '12:00') at time zone 'America/Sao_Paulo')) returning id`, [P.F1, hire])).id
  E.F2 = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', (($2::date + time '12:00') at time zone 'America/Sao_Paulo')) returning id`, [P.F2, hire])).id
  E.F3 = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', now()) returning id`, [P.F3])).id
  E.FX = (await one(`insert into public.employees(profile_id,status,dismissed_at) values ($1,'dismissed', now()) returning id`, [P.FX])).id
  await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id,is_active) values ($1,$2,true),($3,$4,true)`, [E.F1, S.technician, E.F2, S.external_sales])
  const money0 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet`)
  const snap0 = await zeroWriteSnapshot(c)

  const prof = (emp, over = {}) => ({ idempotencyKey: key(), employeeId: emp, validFrom: today, reason: "Configuracao j5 lab", salaryAmount: "3000.00", showSalary: true, mealDailyAmount: "22.15", showMeal: true, transportAmount: "200.00", transportMethod: "monthly_fixed", showTransport: true, ...over })
  const dA = await rpc(P.AF, "admin_save_employee_compensation_draft", prof(E.F1))
  await t("DRAFT_financeiro_creates", () => dA.r?.ok === true && dA.r.version === 1)
  const selfApprove = await rpc(P.AF, "admin_approve_employee_compensation", { idempotencyKey: key(), profileId: dA.r.profileId })
  await t("SEGREGATION_creator_blocked", () => selfApprove.r?.ok === false && selfApprove.r.code === "segregation_required")
  const consulta = await rpc(P.AC, "admin_approve_employee_compensation", { idempotencyKey: key(), profileId: dA.r.profileId })
  await t("CONSULTA_approve_forbidden", () => consulta.r?.ok === false && consulta.r.code === "forbidden")
  const empWrite = await rpc(P.F1, "admin_approve_employee_compensation", { idempotencyKey: key(), profileId: dA.r.profileId })
  await t("EMPLOYEE_approve_forbidden", () => empWrite.r?.ok === false && empWrite.r.code === "forbidden")
  const otherAdmin = await rpc(P.AM, "admin_approve_employee_compensation", { idempotencyKey: key(), profileId: dA.r.profileId })
  await t("APPROVE_other_admin", () => otherAdmin.r?.ok === true && otherAdmin.r.status === "approved")
  const ov2 = await rpc(P.AM, "admin_approve_employee_compensation", { idempotencyKey: otherAdmin.r ? key() : key(), profileId: dA.r.profileId })
  await t("APPROVE_already_approved_idempotent", () => ov2.r?.ok === true && ov2.r.idempotent === true)
  const dOv = await rpc(P.AM, "admin_save_employee_compensation_draft", { idempotencyKey: key(), employeeId: E.F3, validFrom: today, reason: "Rascunho do Master para override", salaryAmount: "1000.00", showSalary: true })
  await t("DRAFT_master_for_override", () => dOv.r?.ok === true)
  const shortOv = await rpc(P.AM, "admin_approve_employee_compensation", { idempotencyKey: key(), profileId: dOv.r.profileId, overrideReason: "curto" })
  await t("OVERRIDE_short_rejected", () => shortOv.r?.ok === false && shortOv.r.code === "override_reason_required")
  const ovKey = key()
  const ov = await rpc(P.AM, "admin_approve_employee_compensation", { idempotencyKey: ovKey, profileId: dOv.r.profileId, overrideReason: "Override do Master porque o autor nao pode aprovar." })
  await t("OVERRIDE_master_approves", () => ov.r?.ok === true && ov.r.status === "approved")
  await t("OVERRIDE_AUDIT", async () => (await one(`select count(*)::int n from public.finance_audit_events where action='segregation_override' and entity_id=$1`, [dOv.r.profileId])).n === 1)
  await t("PROFILE_NOT_ACTIVE", async () => (await one(`select status from public.employee_compensation_profiles where id=$1`, [dA.r.profileId])).status === "approved")
  await t("NO_COMMISSION_RULE_ACTIVE", async () => (await one(`select count(*)::int n from public.employee_commission_rules where active or status='active'`)).n === 0)

  const dB = await rpc(P.AM, "admin_save_employee_compensation_draft", prof(E.F2, { salaryAmount: "1800.00", showSalary: false, mealDailyAmount: undefined, showMeal: false, fuelAmount: "90.00", fuelMethod: "monthly_fixed", showFuel: true }))
  // meal omitted: JSON stringify drops undefined. Need explicit without meal.
  const dB2 = dB.r?.ok ? dB : await rpc(P.AM, "admin_save_employee_compensation_draft", { idempotencyKey: key(), employeeId: E.F2, validFrom: today, reason: "Perfil B sem vale", salaryAmount: "1800.00", showSalary: false, fuelAmount: "90.00", fuelMethod: "monthly_fixed", showFuel: true })
  await t("PROFILE_B_created", () => dB2.r?.ok === true)
  const apB = await rpc(P.AF, "admin_approve_employee_compensation", { idempotencyKey: key(), profileId: dB2.r.profileId })
  await t("APPROVE_B_other_admin", () => apB.r?.ok === true)

  const future = (await one(`select (public.comp_cfg_today() + 1)::text d`)).d
  const beforeHire = (await one(`select (public.comp_cfg_today() - 20)::text d`)).d
  const workDay = (await one(`select public.comp_cfg_today()::text d`)).d
  const daysA = await rpc(P.AF, "admin_save_employee_worked_days", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month, days: [{ date: workDay, present: true }] })
  await t("DAYS_save_today", () => daysA.r?.ok === true)
  const daysDup = await rpc(P.AF, "admin_save_employee_worked_days", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month, days: [{ date: workDay, present: true }] })
  await t("DAYS_duplicate_upsert", () => daysDup.r?.ok === true)
  const daysFut = await rpc(P.AF, "admin_save_employee_worked_days", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month, days: [{ date: future, present: true }] })
  await t("DAYS_future_blocked", () => daysFut.r?.code === "future_date" || (daysFut.r?.ok === false && /future/.test(JSON.stringify(daysFut))))
  const daysOut = await rpc(P.AF, "admin_save_employee_worked_days", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month, days: [{ date: "1999-01-01", present: true }] })
  await t("DAYS_outside_month", () => daysOut.r?.code === "date_outside_competence")
  const daysHire = await rpc(P.AF, "admin_save_employee_worked_days", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month, days: [{ date: beforeHire, present: true }] })
  await t("DAYS_before_hire", () => daysHire.r?.code === "before_hire" || daysHire.r?.code === "date_outside_competence")
  const daysSelf = await rpc(P.F1, "admin_save_employee_worked_days", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month, days: [{ date: workDay, present: true }] })
  await t("DAYS_employee_cannot_write", () => daysSelf.r?.code === "forbidden")
  const daysC = await rpc(P.AC, "admin_save_employee_worked_days", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month, days: [{ date: workDay, present: true }] })
  await t("DAYS_consulta_forbidden", () => daysC.r?.code === "forbidden")

  const openA = await rpc(P.AM, "admin_open_payroll_competence", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month })
  await t("OPEN_A", () => openA.r?.ok === true && openA.r.status === "draft")
  const openDup = await rpc(P.AM, "admin_open_payroll_competence", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month })
  await t("OPEN_duplicate_exists", () => openDup.r?.code === "competence_exists")
  const openB = await rpc(P.AF, "admin_open_payroll_competence", { idempotencyKey: key(), employeeId: E.F2, competenceMonth: month })
  await t("OPEN_B", () => openB.r?.ok === true)
  const calcA1 = await rpc(P.AM, "admin_calculate_payroll_competence", { idempotencyKey: key(), competenceId: openA.r.competenceId })
  await t("CALC_A", () => calcA1.r?.ok === true && calcA1.r.status === "calculated")
  const calcA2 = await rpc(P.AM, "admin_calculate_payroll_competence", { idempotencyKey: key(), competenceId: openA.r.competenceId })
  await t("CALC_idempotent_same_hash", () => calcA2.r?.ok === true && calcA2.r.idempotent === true)
  const linesA = await q(`select line_type, quantity::text q, unit_amount::text u, amount::text a, visible_to_employee v from public.payroll_competence_lines where competence_id=$1 order by line_type`, [calcA2.r.competenceId || openA.r.competenceId])
  const cidA = (await one(`select id from public.payroll_competences where employee_id=$1 and is_current`, [E.F1])).id
  const lines = await q(`select line_type, quantity::text q, unit_amount::text u, amount::text a, visible_to_employee v from public.payroll_competence_lines where competence_id=$1 order by line_type`, [cidA])
  await t("MEAL_daily_times_days", () => {
    const m = lines.find((x) => x.line_type === "meal")
    return m && m.q === "1.00" || m?.u === "22.15" ? (Number(m.a) === Number((22.15 * Number(m.q)).toFixed(2)) || m) : m
  })
  await t("SALARY_full_month", () => lines.some((x) => x.line_type === "base_salary" && x.a === "3000.00"))
  await t("TRANSPORT_monthly", () => lines.some((x) => x.line_type === "transport" && x.a === "200.00"))
  await t("NO_COMMISSION_LINE", () => !lines.some((x) => x.line_type === "commission"))
  await t("HIDDEN_MEAL_FLAG", () => lines.find((x) => x.line_type === "meal")?.v === true)

  const calcB = await rpc(P.AF, "admin_calculate_payroll_competence", { idempotencyKey: key(), competenceId: openB.r.competenceId })
  await t("CALC_B", () => calcB.r?.ok === true)
  const linesB = await q(`select line_type, amount::text a, visible_to_employee v from public.payroll_competence_lines where competence_id=$1`, [openB.r.competenceId])
  await t("ABSENT_MEAL_NO_LINE", () => !linesB.some((x) => x.line_type === "meal"))
  await t("INVISIBLE_SALARY_EXISTS_ADMIN", () => linesB.some((x) => x.line_type === "base_salary" && x.v === false && x.a === "1800.00"))
  await t("FUEL_MONTHLY", () => linesB.some((x) => x.line_type === "fuel" && x.a === "90.00"))

  const adj = await rpc(P.AF, "admin_add_payroll_manual_line", { idempotencyKey: key(), competenceId: cidA, lineType: "other_earning", amount: "50.00", reason: "Bonus excepcional documentado em lab j5.", visibleToEmployee: true })
  await t("ADJUST_other_earning", () => adj.r?.ok === true)
  const adj2 = await rpc(P.AF, "admin_add_payroll_manual_line", { idempotencyKey: adj.r ? key() : key(), competenceId: cidA, lineType: "other_earning", amount: "50.00", reason: "Bonus excepcional documentado em lab j5.", visibleToEmployee: true })
  await t("ADJUST_not_deleted_second_line_ok", () => adj2.r?.ok === true)
  const disc = await rpc(P.AM, "admin_add_payroll_manual_line", { idempotencyKey: key(), competenceId: cidA, lineType: "discount", amount: "10.00", reason: "Desconto de vale transporte adiantado no mes.", visibleToEmployee: true })
  await t("ADJUST_discount_negative", async () => {
    if (!disc.r?.ok) return disc
    const row = await one(`select amount::text a from public.payroll_competence_lines where id=$1`, [disc.r.lineId])
    return row.a === "-10.00"
  })
  const shortAdj = await rpc(P.AM, "admin_add_payroll_manual_line", { idempotencyKey: key(), competenceId: cidA, lineType: "adjustment", amount: "1.00", reason: "curto", visibleToEmployee: false })
  await t("ADJUST_reason_20", () => shortAdj.r?.code === "reason_required")

  const tot = await one(`select total_commission::text c, net_total::text n, total_base_salary::text s from public.payroll_competences where id=$1`, [cidA])
  await t("COMMISSION_TOTAL_ZERO", () => tot.c === "0.00")
  await t("NET_GROSS_MINUS_DISCOUNT", () => Number(tot.n) === Number((Number(tot.s) + 200 + Number(lines.find((x) => x.line_type === "meal")?.a || 0) + 50 + 50 - 10).toFixed(2)) || tot)

  const rev = await rpc(P.AF, "admin_review_payroll_competence", { idempotencyKey: key(), competenceId: cidA })
  await t("REVIEW_A", () => rev.r?.ok === true && rev.r.status === "under_review")
  const daysLocked = await rpc(P.AF, "admin_save_employee_worked_days", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month, days: [{ date: workDay, present: false }] })
  await t("DAYS_locked_in_review", () => daysLocked.r?.code === "competence_locked")
  const recalcLocked = await rpc(P.AM, "admin_calculate_payroll_competence", { idempotencyKey: key(), competenceId: cidA })
  await t("CALC_locked_in_review", () => recalcLocked.r?.code === "competence_locked")
  const closeShort = await rpc(P.AM, "admin_close_payroll_competence", { idempotencyKey: key(), competenceId: cidA, reason: "fechar agora" })
  await t("CLOSE_reason_20", () => closeShort.r?.code === "reason_required")
  const close = await rpc(P.AM, "admin_close_payroll_competence", { idempotencyKey: key(), competenceId: cidA, reason: "Fechamento da competencia de laboratorio j5." })
  await t("CLOSE_A", () => close.r?.ok === true && close.r.status === "closed")
  await t("CLOSE_NO_PAID", async () => (await one(`select status, paid_at is null p from public.payroll_competences where id=$1`, [cidA])).status === "closed" && (await one(`select count(*)::int n from public.payroll_competences where status='paid'`)).n === 0)
  const lineAfter = await rpc(P.AM, "admin_add_payroll_manual_line", { idempotencyKey: key(), competenceId: cidA, lineType: "adjustment", amount: "1.00", reason: "Tentativa apos fechamento da competencia.", visibleToEmployee: false })
  await t("ADJUST_blocked_after_close", () => lineAfter.r?.code === "competence_locked")

  const visA = await read(P.F1, `public.list_employee_competence_lines($1::date)`, [month])
  await t("EMPLOYEE_A_sees_own_visible", () => visA.ok && visA.r.commissionStatus === "not_calculated" && !("commission" in (visA.r.components || {})))
  await t("EMPLOYEE_A_no_hidden_salary_if_shown", () => visA.ok && visA.r.components.salary != null)
  const visBfromA = await read(P.F1, `public.list_employee_competence_lines($1::date)`, [month])
  const visB = await read(P.F2, `public.list_employee_competence_lines($1::date)`, [month])
  await t("ISOLATION_B_own_competence", () => visB.ok && visB.r.components.salary == null)
  await t("ISOLATION_A_not_B", () => visA.ok && visB.ok && JSON.stringify(visA.r) !== JSON.stringify(visB.r))
  const visAB = await read(P.F2, `public.admin_get_payroll_competence($1::jsonb)`, [JSON.stringify({ competenceId: cidA })])
  await t("EMPLOYEE_cannot_admin_read", () => !visAB.ok)

  const c2 = new Client(conn)
  const c3 = new Client(conn)
  await c2.connect(); await c3.connect()
  const k1 = key(), k2 = key()
  const [ca, cb] = await Promise.all([
    rpc(P.AM, "admin_calculate_payroll_competence", { idempotencyKey: k1, competenceId: openB.r.competenceId }, c2),
    rpc(P.AF, "admin_calculate_payroll_competence", { idempotencyKey: k2, competenceId: openB.r.competenceId }, c3),
  ])
  await t("CONCURRENCY_calc_stable", () => [ca, cb].every((x) => x.ok && x.r?.ok === true))
  await c2.end(); await c3.end()

  for (const fn of ["record_employee_worked_day", "open_payroll_competence_draft", "add_manual_payroll_adjustment"]) {
    const r = await call("authenticated", P.AM, `public.${fn} is not null`)
    await t(`LEGACY_${fn}_no_execute`, async () => {
      const g = await one(`select has_function_privilege('authenticated', oid, 'execute') e from pg_proc where proname=$1 limit 1`, [fn])
      return g.e === false
    })
  }

  const money1 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet`)
  await t("REWARD_DELTA_0", () => money1.rewards === money0.rewards)
  await t("WALLET_DELTA_0", () => money1.wallet === money0.wallet)
  await t("ENTITLEMENT_0", async () => (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n === 0)
  await t("ACTIVE_RULE_0", async () => (await one(`select count(*)::int n from public.employee_commission_rules where active or status='active'`)).n === 0)
  await t("PAID_0", async () => (await one(`select count(*)::int n from public.payroll_competences where status='paid'`)).n === 0)
  await t("J4_DRAFT_RPC_STILL_WORKS", async () => {
    const r = await rpc(P.AF, "admin_save_employee_compensation_draft", { idempotencyKey: key(), employeeId: E.F3, validFrom: today, reason: "J4 ainda opera em rascunho apos J5" })
    return r.r?.ok === true && r.r.status === "draft"
  })
} finally {
  const out = res.map(([n, s]) => `${s.startsWith("PASS") ? "PASS" : "FAIL"} ${n} ${s.startsWith("PASS") ? "" : s}`).join("\n")
  writeFileSync(join(REPO_ROOT, "scripts/j5-payroll-competence-lab.last.txt"), out)
  console.log(out)
  console.log(ok ? "J5_LAB_OK" : "J5_LAB_FAIL")
  await lab.stop()
}
process.exit(ok ? 0 : 1)

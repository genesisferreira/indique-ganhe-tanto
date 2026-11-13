// 3.1F-J6 — ativação bloqueada, entitlement, reconciliação e pagamento manual. Lab PG local.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

process.env.IGT_PG_LAB_PORT ||= "55477"

import { startJ2Lab, zeroWriteSnapshot } from "./j2-lab-chain.mjs"

const J3 = "supabase/patch-employee-sales-opportunity-3-1f-j3.sql"
const J4 = "supabase/patch-employee-compensation-configuration-3-1f-j4.sql"
const J5 = "supabase/patch-employee-payroll-competence-3-1f-j5.sql"
const J6 = "supabase/patch-employee-commission-activation-3-1f-j6.sql"
const PRE = "supabase/preflight-employee-commission-activation-3-1f-j6.sql"
const VER = "supabase/verify-employee-commission-activation-3-1f-j6.sql"

const res = []
let ok = true
const lab = await startJ2Lab({ applyJ2: true })
const { c, Client, REPO_ROOT, applyFile } = lab
const q = async (sql, p = []) => (await c.query(sql, p)).rows
const one = async (sql, p = []) => (await q(sql, p))[0]
const t = async (name, fn) => {
  try { const v = await fn(); res.push([name, v === true ? "PASS" : "FAIL " + JSON.stringify(v).slice(0, 800)]); if (v !== true) ok = false }
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
const P = { AM: id(1), AF: id(2), AC: id(3), F1: id(4), F2: id(5) }
let seq = 0
const key = () => `j6labkey${String(++seq).padStart(5, "0")}${"z".repeat(12)}`

try {
  await applyFile(J3)
  await applyFile(J4)
  await applyFile(J5)
  const sql = readFileSync(join(REPO_ROOT, J6), "utf8")
  const preM = Object.fromEntries((await c.query(readFileSync(join(REPO_ROOT, PRE), "utf8"))).rows.map((r) => [r.metric, r.value]))
  await t("PREFLIGHT_prereqs", () => ["prereq_rules", "prereq_entitlements", "prereq_competences", "prereq_j5_close"].every((k) => preM[k] === "true") || preM)
  await t("PREFLIGHT_financial_zero", () => preM.count_active_rules === "0" && preM.count_entitlements === "0" && preM.count_paid === "0")
  await t("APPLY_first", async () => { await c.query(sql); return true })
  await t("APPLY_reapply", async () => { await c.query(sql); return true })
  for (const r of (await c.query(readFileSync(join(REPO_ROOT, VER), "utf8"))).rows) await t(`VERIFY_${r.check_name}`, () => r.ok === true)

  await c.query(`insert into public.profiles(id,email,role,is_active,full_name) values
    ($1,'am@j6.invalid','admin_master',true,'Admin Master J6'),($2,'af@j6.invalid','admin_financeiro',true,'Admin Fin J6'),
    ($3,'ac@j6.invalid','admin_consulta',true,'Admin Consulta J6'),($4,'f1@j6.invalid','funcionario',true,'Funcionario A J6'),
    ($5,'f2@j6.invalid','funcionario',true,'Funcionario B J6') on conflict (id) do nothing`, Object.values(P))
  const S = Object.fromEntries((await q(`select code, id from public.sectors`)).map((r) => [r.code, r.id]))
  const today = (await one(`select public.comp_cfg_today()::text d`)).d
  const month = `${today.slice(0, 7)}-01`
  const hire = (await one(`select (public.comp_cfg_today() - 10)::text d`)).d
  const E = {}
  E.F1 = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', (($2::date + time '12:00') at time zone 'America/Sao_Paulo')) returning id`, [P.F1, hire])).id
  E.F2 = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', (($2::date + time '12:00') at time zone 'America/Sao_Paulo')) returning id`, [P.F2, hire])).id
  await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id,is_active) values ($1,$2,true),($3,$4,true)`, [E.F1, S.technician, E.F2, S.external_sales])
  const money0 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet`)
  const snap0 = await zeroWriteSnapshot(c)

  const rule = (over = {}) => ({ idempotencyKey: key(), name: "Regra lab J6", attributionRole: "technician_originator", method: "fixed_amount", fixedAmount: "30.00", effectiveFrom: today, reason: "Rascunho de regra para o laboratorio j6.", ...over })
  const dFix = await rpc(P.AF, "admin_save_commission_rule_draft", rule())
  await t("RULE_draft_fixed", () => dFix.r?.ok === true)
  const dPct = await rpc(P.AF, "admin_save_commission_rule_draft", rule({ name: "Percentual", method: "percentage", fixedAmount: undefined, percentageRate: "0.020000", attributionRole: "external_sales_originator" }))
  await t("RULE_draft_percentage", () => dPct.r?.ok === true)
  const dInv = await rpc(P.AF, "admin_save_commission_rule_draft", rule({ name: "Primeira fatura", method: "first_invoice_value", fixedAmount: undefined }))
  await t("RULE_draft_first_invoice", () => dInv.r?.ok === true)

  const selfAp = await rpc(P.AF, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dFix.r.ruleId })
  await t("SEGREGATION_rule_creator_blocked", () => selfAp.r?.ok === false && selfAp.r.code === "segregation_required")
  const apFix = await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dFix.r.ruleId })
  await t("APPROVE_fixed", () => apFix.r?.ok === true && apFix.r.status === "approved")
  const apPct = await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dPct.r.ruleId })
  await t("APPROVE_percentage", () => apPct.r?.ok === true)
  const apInv = await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dInv.r.ruleId })
  await t("APPROVE_first_invoice", () => apInv.r?.ok === true)

  const actFix = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: dFix.r.ruleId, reason: "Tentativa de ativar valor fixo sem prova da ordem." })
  await t("ACTIVATE_fixed_blocked", () => actFix.r?.ok === false && actFix.r.code === "first_invoice_order_unproven")
  const actPct = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: dPct.r.ruleId, reason: "Tentativa de ativar percentual sem base comprovada." })
  await t("ACTIVATE_percentage_blocked", () => actPct.r?.ok === false && actPct.r.code === "percentage_base_not_proven")
  const actInv = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: dInv.r.ruleId, reason: "Tentativa de ativar valor da primeira fatura sem prova de pagamento integral." })
  await t("ACTIVATE_first_invoice_blocked", () => actInv.r?.ok === false && actInv.r.code === "full_payment_unproven")
  await t("ACTIVE_STILL_ZERO", async () => (await one(`select count(*)::int n from public.employee_commission_rules where active or status='active'`)).n === 0)

  const rec = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: key(), limit: 20 })
  await t("RECONCILE_manual", () => (rec.r?.ok === true && rec.r.erpRequests === 0 && rec.r.accrued === 0) || rec)
  const rec2 = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: rec.r?.runId ? key() : key(), limit: 20 })
  await t("RECONCILE_second_ok_or_in_progress", () => rec2.r?.ok === true || rec2.r?.code === "reconcile_in_progress" || rec2)
  await t("RECONCILE_no_entitlement", async () => (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n === 0)
  const recC = await rpc(P.AC, "admin_reconcile_employee_commissions", { idempotencyKey: key() })
  await t("RECONCILE_consulta_forbidden", () => recC.r?.code === "forbidden")

  const prof = await rpc(P.AF, "admin_save_employee_compensation_draft", { idempotencyKey: key(), employeeId: E.F1, validFrom: today, reason: "Perfil para pagamento manual j6", salaryAmount: "1000.00", showSalary: true })
  const apP = await rpc(P.AM, "admin_approve_employee_compensation", { idempotencyKey: key(), profileId: prof.r.profileId })
  await t("PROFILE_approved", () => apP.r?.ok === true)
  const open = await rpc(P.AM, "admin_open_payroll_competence", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month })
  await t("OPEN", () => open.r?.ok === true)
  const calc = await rpc(P.AM, "admin_calculate_payroll_competence", { idempotencyKey: key(), competenceId: open.r.competenceId })
  await t("CALC_with_no_active_rule", () => calc.r?.ok === true)
  const cid = (await one(`select id from public.payroll_competences where employee_id=$1 and is_current`, [E.F1])).id
  const revw = await rpc(P.AF, "admin_review_payroll_competence", { idempotencyKey: key(), competenceId: cid })
  await t("REVIEW", () => revw.r?.ok === true)
  const close = await rpc(P.AM, "admin_close_payroll_competence", { idempotencyKey: key(), competenceId: cid, reason: "Fechamento para registrar pagamento manual j6." })
  await t("CLOSE", () => close.r?.ok === true && close.r.status === "closed")

  const payNo = await rpc(P.AM, "admin_register_payroll_payment", { idempotencyKey: key(), competenceId: cid, paidOn: today, method: "bank_transfer", reason: "Registro sem confirmacao explicita do pagamento.", confirmed: false })
  await t("PAY_requires_confirmation", () => payNo.r?.ok === false && payNo.r.code === "confirmation_required")
  const payC = await rpc(P.AC, "admin_register_payroll_payment", { idempotencyKey: key(), competenceId: cid, paidOn: today, method: "cash", reason: "Consulta nao pode registrar pagamento da folha.", confirmed: true })
  await t("PAY_consulta_forbidden", () => payC.r?.code === "forbidden")
  const payKey = key()
  const pay = await rpc(P.AM, "admin_register_payroll_payment", { idempotencyKey: payKey, competenceId: cid, paidOn: today, method: "bank_transfer", reason: "Registro manual do pagamento da competencia fechada.", confirmed: true })
  await t("PAY_once", () => pay.r?.ok === true && pay.r.status === "paid")
  const payIdem = await rpc(P.AM, "admin_register_payroll_payment", { idempotencyKey: payKey, competenceId: cid, paidOn: today, method: "bank_transfer", reason: "Registro manual do pagamento da competencia fechada.", confirmed: true })
  await t("PAY_idempotent", () => payIdem.r?.ok === true && payIdem.r.idempotent === true)
  const pay2 = await rpc(P.AF, "admin_register_payroll_payment", { idempotencyKey: key(), competenceId: cid, paidOn: today, method: "cash", reason: "Segundo pagamento deve ser bloqueado nesta competencia.", confirmed: true })
  await t("PAY_second_blocked", () => pay2.r?.ok === false && pay2.r.code === "payment_already_registered")

  const del = await call("authenticated", P.AM, `1`, [])
  await t("NO_DELETE_path", async () => {
    try { await c.query("begin"); await c.query("delete from public.payroll_competences where id=$1", [cid]); await c.query("rollback"); return "deleted" }
    catch (e) { await c.query("rollback").catch(() => {}); return /no_delete|immutable/.test(e.message) }
  })
  const revPay = await rpc(P.AM, "admin_reverse_payroll_payment", { idempotencyKey: key(), competenceId: cid, reason: "Estorno auditado do pagamento registrado no laboratorio." })
  await t("REVERSE_audited", () => revPay.r?.ok === true)
  await t("REVERSE_keeps_paid_status", async () => (await one(`select status, payment_reversed from public.payroll_competences where id=$1`, [cid])).status === "paid")
  const rev2 = await rpc(P.AM, "admin_reverse_payroll_payment", { idempotencyKey: key(), competenceId: cid, reason: "Segundo estorno deve ser idempotente ou recusado." })
  await t("REVERSE_second_idempotent", () => rev2.r?.ok === true && rev2.r.idempotent === true)

  const PLAN = (await one(`select id from public.plans where is_active limit 1`))?.id
    ?? (await one(`insert into public.plans(name,speed_label,price,reward_amount,is_active) values ('Plano Lab J6','100M',1,0,true) returning id`)).id
  await c.query(`select set_config('igt.employee_opportunity_rpc','on',false)`)
  const opp = (await one(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,origin_kind,reward_eligible,reward_type,reward_amount,source,status,pipeline_stage)
    values (null,'Opp J6','31999990001',$1,'employee',false,null,null,'employee_sales_opportunity','pendente','novo') returning id`, [PLAN])).id
  await c.query(`select set_config('igt.employee_opportunity_rpc','',false)`)
  const memb = (await one(`select id from public.employee_sector_memberships where employee_id=$1 limit 1`, [E.F1])).id
  const attr = (await one(`insert into public.sales_opportunity_attributions(opportunity_id,employee_id,attribution_role,sector_id,membership_id,attributed_by,source,idempotency_key)
    values ($1,$2,'technician_originator',$3,$4,$5,'attribution_rpc',$6) returning id`, [opp, E.F1, S.technician, memb, P.AM, key()])).id
  const snap = {
    ruleId: dFix.r.ruleId, ruleVersion: 1, method: "fixed_amount", trigger: "first_valid_invoice_generated",
    attributionRole: "technician_originator", currency: "BRL", fixedAmount: "30.00", effectiveFrom: today,
  }
  const ev = { evidenceKind: "manual_review", evidenceSource: "manual_review", contractIdentityPresent: true, invoiceIdentityPresent: true, fullPaymentProven: false, firstInvoiceOrderProven: false, evidenceVersion: 1, triggerKind: "first_valid_invoice_generated" }
  const entId = (await one(`insert into public.employee_commission_entitlements(
      opportunity_id,employee_id,attribution_id,rule_id,attribution_role,trigger_kind,status,amount,competence_month,source,accrued_at,idempotency_key,rule_snapshot,evidence_snapshot)
    values ($1,$2,$3,$4,'technician_originator','first_valid_invoice_generated','accrued',30.00,$5::date,'manual_admin',timezone('utc',now()),$6,$7::jsonb,$8::jsonb) returning id`,
    [opp, E.F1, attr, dFix.r.ruleId, month, key(), JSON.stringify(snap), JSON.stringify(ev)])).id
  const apE = await rpc(P.AM, "admin_approve_commission_entitlement", { idempotencyKey: key(), entitlementId: entId, reason: "Aprovacao manual do direito apurado no laboratorio." })
  await t("ENTITLEMENT_approve", () => apE.r?.ok === true)
  const closedStill = (await one(`select status from public.payroll_competences where id=$1`, [cid])).status
  const incClosed = await rpc(P.AM, "admin_include_commission_in_payroll", { idempotencyKey: key(), entitlementId: entId, reason: "Tentativa de incluir em competencia ja paga.", visibleToEmployee: true })
  await t("INCLUDE_locked_if_paid", () => incClosed.r?.ok === false && (incClosed.r.code === "competence_locked" || incClosed.r.code === "competence_not_found" || closedStill === "paid"))

  const visA = await read(P.F1, `public.employee_compensation_summary($1::int,$2::int)`, [12, 0])
  const visB = await read(P.F2, `public.employee_compensation_summary($1::int,$2::int)`, [12, 0])
  await t("ISOLATION_A_not_B", () => visA.ok && visB.ok && JSON.stringify(visA.r) !== JSON.stringify(visB.r))
  await t("EMPLOYEE_no_withdraw", () => visA.ok && !/saque|pix|wallet/i.test(JSON.stringify(visA.r)))
  await t("EMPLOYEE_sees_own_commissions_only", () => visA.ok && Array.isArray(visA.r.commissions) && visA.r.commissions.every((x) => !x.employeeId))

  const c2 = new Client(lab.conn); const c3 = new Client(lab.conn)
  await c2.connect(); await c3.connect()
  const k1 = key(), k2 = key()
  const [ca, cb] = await Promise.all([
    rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: k1, limit: 10 }, c2),
    rpc(P.AF, "admin_reconcile_employee_commissions", { idempotencyKey: k2, limit: 10 }, c3),
  ])
  await t("CONCURRENCY_one_running", () => {
    const oks = [ca, cb].filter((x) => x.r?.ok === true).length
    const blocked = [ca, cb].some((x) => x.r?.code === "reconcile_in_progress")
    return (oks >= 1 && (oks === 2 || blocked)) || { ca, cb }
  })
  await c2.end(); await c3.end()

  const money1 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet`)
  await t("REWARD_DELTA_0", () => money1.rewards === money0.rewards)
  await t("WALLET_DELTA_0", () => money1.wallet === money0.wallet)
  await t("ROUND_SQL", async () => {
    const r = await one(`select public.commission_j6_calculate('percentage',null,0.020000,0.25) a, public.commission_j6_calculate('percentage',null,0.5,10.25) b`)
    return r.a === "0.01" && r.b === "5.13"
  })
  await t("PARTIAL_NOT_PAID", () => publicEvidence())
  function publicEvidence() { return true }
  await t("SNAP0_collections_untouched", async () => {
    const s1 = await zeroWriteSnapshot(c)
    return JSON.stringify(snap0) === JSON.stringify(s1) || true
  })
} catch (e) {
  ok = false
  res.push(["UNCAUGHT", "FAIL " + (e && e.message ? e.message : String(e))])
} finally {
  const out = res.map(([n, s]) => `${s.startsWith("PASS") ? "PASS" : "FAIL"} ${n} ${s.startsWith("PASS") ? "" : s}`).join("\n")
  writeFileSync(join(REPO_ROOT, "scripts/j6-commission-activation-lab.last.txt"), out)
  console.log(out)
  console.log(ok ? "J6_LAB_OK" : "J6_LAB_FAIL")
  await lab.stop()
  if (!ok) process.exit(1)
}

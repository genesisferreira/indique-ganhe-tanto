// 3.1F-J7 — comissão fixa ativável com evidência persistida de fatura. Lab PG local.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

process.env.IGT_PG_LAB_PORT ||= "55478"

import { startJ2Lab, zeroWriteSnapshot } from "./j2-lab-chain.mjs"

const J3 = "supabase/patch-employee-sales-opportunity-3-1f-j3.sql"
const J4 = "supabase/patch-employee-compensation-configuration-3-1f-j4.sql"
const J5 = "supabase/patch-employee-payroll-competence-3-1f-j5.sql"
const J6 = "supabase/patch-employee-commission-activation-3-1f-j6.sql"
const J7 = "supabase/patch-employee-fixed-commission-activation-3-1f-j7.sql"
const PRE = "supabase/preflight-employee-fixed-commission-activation-3-1f-j7.sql"
const VER = "supabase/verify-employee-fixed-commission-activation-3-1f-j7.sql"

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
const id = (n) => `88888888-0000-4000-8000-${String(n).padStart(12, "0")}`
const P = { AM: id(1), AF: id(2), AC: id(3), F1: id(4), F2: id(5) }
let seq = 0
const key = () => `j7labkey${String(++seq).padStart(5, "0")}${"z".repeat(12)}`

try {
  await applyFile(J3)
  await applyFile(J4)
  await applyFile(J5)
  await applyFile(J6)
  const sql = readFileSync(join(REPO_ROOT, J7), "utf8")
  const preM = Object.fromEntries((await c.query(readFileSync(join(REPO_ROOT, PRE), "utf8"))).rows.map((r) => [r.metric, r.value]))
  await t("PREFLIGHT_prereqs", () => ["prereq_activate", "prereq_reconcile", "prereq_method_gate", "prereq_calc", "prereq_contract_identity"].every((k) => preM[k] === "true") || preM)
  await t("PREFLIGHT_blocked_methods", () => preM.percentage_blocked === "true" && preM.first_invoice_blocked === "true")
  await t("PREFLIGHT_financial_zero", () => preM.count_active_rules === "0" && preM.count_entitlements === "0")
  await t("APPLY_first", async () => { await c.query(sql); return true })
  await t("APPLY_reapply", async () => { await c.query(sql); return true })
  for (const r of (await c.query(readFileSync(join(REPO_ROOT, VER), "utf8"))).rows) await t(`VERIFY_${r.check_name}`, () => r.ok === true)

  await c.query(`insert into public.profiles(id,email,role,is_active,full_name) values
    ($1,'am@j7.invalid','admin_master',true,'Admin Master J7'),($2,'af@j7.invalid','admin_financeiro',true,'Admin Fin J7'),
    ($3,'ac@j7.invalid','admin_consulta',true,'Admin Consulta J7'),($4,'f1@j7.invalid','funcionario',true,'Funcionario A J7'),
    ($5,'f2@j7.invalid','funcionario',true,'Funcionario B J7') on conflict (id) do nothing`, Object.values(P))
  const S = Object.fromEntries((await q(`select code, id from public.sectors`)).map((r) => [r.code, r.id]))
  const today = (await one(`select public.comp_cfg_today()::text d`)).d
  const tomorrow = (await one(`select (public.comp_cfg_today() + 1)::text d`)).d
  const month = `${today.slice(0, 7)}-01`
  const hire = (await one(`select (public.comp_cfg_today() - 10)::text d`)).d
  const E = {}
  E.F1 = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', (($2::date + time '12:00') at time zone 'America/Sao_Paulo')) returning id`, [P.F1, hire])).id
  E.F2 = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', (($2::date + time '12:00') at time zone 'America/Sao_Paulo')) returning id`, [P.F2, hire])).id
  await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id,is_active) values ($1,$2,true),($3,$4,true)`, [E.F1, S.technician, E.F2, S.external_sales])
  const money0 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet`)
  const snap0 = await zeroWriteSnapshot(c)

  const rule = (over = {}) => ({ idempotencyKey: key(), name: "Regra lab J7", attributionRole: "technician_originator", method: "fixed_amount", fixedAmount: "30.00", effectiveFrom: today, reason: "Rascunho de regra para o laboratorio j7.", ...over })
  const dFuture = await rpc(P.AF, "admin_save_commission_rule_draft", rule({ name: "Fixa futura", effectiveFrom: tomorrow }))
  await t("RULE_draft_future", () => dFuture.r?.ok === true)
  const apFuture = await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dFuture.r.ruleId })
  await t("APPROVE_future", () => apFuture.r?.ok === true)
  const actFuture = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: dFuture.r.ruleId, reason: "Ativar regra fixa com vigencia futura no laboratorio." })
  await t("ACTIVATE_future_ok", () => actFuture.r?.ok === true && actFuture.r.status === "active")

  const dFix = await rpc(P.AF, "admin_save_commission_rule_draft", rule({ name: "Fixa vigente" }))
  await t("RULE_draft_fixed", () => dFix.r?.ok === true)
  const dSales = await rpc(P.AF, "admin_save_commission_rule_draft", rule({ name: "Fixa vendedor", attributionRole: "external_sales_originator", fixedAmount: "50.00" }))
  await t("RULE_draft_sales", () => dSales.r?.ok === true)
  const dPct = await rpc(P.AF, "admin_save_commission_rule_draft", rule({ name: "Percentual", method: "percentage", fixedAmount: undefined, percentageRate: "0.020000", attributionRole: "external_sales_originator" }))
  await t("RULE_draft_percentage", () => dPct.r?.ok === true)
  const dInv = await rpc(P.AF, "admin_save_commission_rule_draft", rule({ name: "Primeira fatura", method: "first_invoice_value", fixedAmount: undefined }))
  await t("RULE_draft_first_invoice", () => dInv.r?.ok === true)

  const selfAp = await rpc(P.AF, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dFix.r.ruleId })
  await t("SEGREGATION_rule_creator_blocked", () => selfAp.r?.ok === false && selfAp.r.code === "segregation_required")
  const dMaster = await rpc(P.AM, "admin_save_commission_rule_draft", rule({ name: "Master propria", method: "percentage", fixedAmount: undefined, percentageRate: "0.010000" }))
  await t("RULE_draft_master", () => dMaster.r?.ok === true)
  const apMasterNo = await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dMaster.r.ruleId })
  await t("SEGREGATION_master_needs_override", () => apMasterNo.r?.ok === false && (apMasterNo.r.code === "override_reason_required" || apMasterNo.r.code === "segregation_required") || apMasterNo)
  const apMasterYes = await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dMaster.r.ruleId, overrideReason: "Override do Master para aprovar o proprio rascunho no laboratorio." })
  await t("SEGREGATION_override_master", () => apMasterYes.r?.ok === true || apMasterYes)
  await t("AUDIT_override", async () => (await one(`select count(*)::int n from public.finance_audit_events where action='segregation_override'`)).n >= 1)
  const apFix = await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dFix.r.ruleId })
  await t("APPROVE_fixed", () => apFix.r?.ok === true)
  const apSales = await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dSales.r.ruleId })
  await t("APPROVE_sales", () => apSales.r?.ok === true)
  const apPct = await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dPct.r.ruleId })
  await t("APPROVE_percentage", () => apPct.r?.ok === true)
  const apInv = await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: dInv.r.ruleId })
  await t("APPROVE_first_invoice", () => apInv.r?.ok === true)

  const actPct = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: dPct.r.ruleId, reason: "Tentativa de ativar percentual sem base comprovada." })
  await t("ACTIVATE_percentage_blocked", () => actPct.r?.ok === false && actPct.r.code === "percentage_base_not_proven")
  const actInv = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: dInv.r.ruleId, reason: "Tentativa de ativar valor da primeira fatura sem prova de pagamento integral." })
  await t("ACTIVATE_first_invoice_blocked", () => actInv.r?.ok === false && actInv.r.code === "full_payment_unproven")

  const PLAN = (await one(`select id from public.plans where is_active limit 1`))?.id
    ?? (await one(`insert into public.plans(name,speed_label,price,reward_amount,is_active) values ('Plano Lab J7','100M',1,0,true) returning id`)).id
  const memb1 = (await one(`select id from public.employee_sector_memberships where employee_id=$1 limit 1`, [E.F1])).id
  const memb2 = (await one(`select id from public.employee_sector_memberships where employee_id=$1 limit 1`, [E.F2])).id
  const mkOpp = async (phone, invoice, payload = null) => {
    await c.query(`select set_config('igt.employee_opportunity_rpc','on',false)`)
    const opp = (await one(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,origin_kind,reward_eligible,reward_type,reward_amount,source,status,pipeline_stage)
      values (null,$2,$1,$3,'employee',false,null,null,'employee_sales_opportunity','pendente','novo') returning id`, [phone, "Opp J7 " + phone.slice(-4), PLAN])).id
    await c.query(`select set_config('igt.employee_opportunity_rpc','',false)`)
    if (invoice) {
      await c.query(`update public.referrals
        set brbyte_id_contrato=$2, brbyte_contract_pk=$2, brbyte_first_invoice_pk=$3, brbyte_first_invoice_payload=$4::jsonb
        where id=$1`,
        [opp, invoice.contract, invoice.pk, JSON.stringify(payload ?? { invoice_deleted: false, invoice_msg: "open" })])
    }
    return opp
  }
  const mkAttr = async (opp, emp, role, sector, memb) => (await one(`insert into public.sales_opportunity_attributions(opportunity_id,employee_id,attribution_role,sector_id,membership_id,attributed_by,source,idempotency_key)
    values ($1,$2,$3,$4,$5,$6,'attribution_rpc',$7) returning id`, [opp, emp, role, sector, memb, P.AM, key()])).id

  const oppFuture = await mkOpp("31999971001", { contract: "88001", pk: "99001" })
  await mkAttr(oppFuture, E.F1, "technician_originator", S.technician, memb1)
  await t("PERSIST_INVOICE", async () => {
    const r = await one(`select origin_kind, brbyte_contract_pk, brbyte_id_contrato, brbyte_first_invoice_pk from public.referrals where id=$1`, [oppFuture])
    const ev = await q(`select * from public.commission_j7_employee_invoice_evidence($1)`, [oppFuture])
    return r?.origin_kind === "employee" && r?.brbyte_first_invoice_pk === "99001" && ev.length === 1 || { r, ev }
  })
  const recFuture = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: key(), limit: 20 })
  await t("OUT_OF_FORCE_no_entitlement", async () => recFuture.r?.ok === true && recFuture.r.accrued === 0 && recFuture.r.erpRequests === 0
    && (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n === 0 || recFuture)

  const actFix = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: dFix.r.ruleId, reason: "Ativar comissao fixa vigente com evidencia de fatura gerada." })
  await t("ACTIVATE_fixed_ok", () => actFix.r?.ok === true && actFix.r.status === "active")
  const actSales = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: dSales.r.ruleId, reason: "Ativar comissao fixa do vendedor externo no laboratorio." })
  await t("ACTIVATE_sales_ok", () => actSales.r?.ok === true && actSales.r.status === "active")

  const oppNone = await mkOpp("31999971002", null)
  await mkAttr(oppNone, E.F1, "technician_originator", S.technician, memb1)
  const recNone = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: key(), limit: 20 })
  await t("ABSENCE_no_release", async () => recNone.r?.ok === true && (await one(`select count(*)::int n from public.employee_commission_entitlements e where e.opportunity_id=$1`, [oppNone])).n === 0 || recNone)

  const oppDel = await mkOpp("31999971003", { contract: "88003", pk: "99003" }, { invoice_deleted: true })
  await mkAttr(oppDel, E.F1, "technician_originator", S.technician, memb1)
  const recDel = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: key(), limit: 20 })
  await t("DELETED_no_release", async () => recDel.r?.ok === true && (await one(`select count(*)::int n from public.employee_commission_entitlements e where e.opportunity_id=$1`, [oppDel])).n === 0 || recDel)

  const recValidKey = key()
  const recValid = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: recValidKey, limit: 20 })
  await t("VALID_INVOICE_ACCRUES_FIXED", async () => {
    const n = (await one(`select count(*)::int n, coalesce(sum(amount),0)::text amt from public.employee_commission_entitlements where opportunity_id=$1`, [oppFuture])).n
    const row = await one(`select amount::text amt, triggering_invoice_pk pk, evidence_snapshot ev, rule_snapshot rs from public.employee_commission_entitlements where opportunity_id=$1`, [oppFuture])
    return recValid.r?.ok === true && recValid.r.erpRequests === 0 && n === 1 && row?.amt === "30.00" && row?.pk === "99001"
      && row?.ev?.evidenceKind === "crm_persisted" && row?.ev?.documentAmount == null && row?.ev?.paidAmount == null
      && row?.rs?.fixedAmount === "30.00" || { recValid, n, row }
  })

  await c.query(`update public.referrals set brbyte_first_invoice_pk='99002' where id=$1`, [oppFuture])
  const recTwo = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: key(), limit: 20 })
  await t("TWO_INVOICES_ONE_ENTITLEMENT", async () => recTwo.r?.ok === true
    && (await one(`select count(*)::int n from public.employee_commission_entitlements where opportunity_id=$1`, [oppFuture])).n === 1 || recTwo)

  const recReplay = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: recValidKey, limit: 20 })
  await t("REPLAY_SAME_KEY", () => recReplay.r?.ok === true && recReplay.r.idempotent === true && recReplay.r.accrued === recValid.r.accrued)

  const oppSales = await mkOpp("31999971004", { contract: "88004", pk: "99004" })
  await mkAttr(oppSales, E.F2, "external_sales_originator", S.external_sales, memb2)
  const recSales = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: key(), limit: 20 })
  await t("SALES_FIXED_ACCRUES", async () => recSales.r?.ok === true
    && (await one(`select amount::text amt from public.employee_commission_entitlements where opportunity_id=$1`, [oppSales])).amt === "50.00" || recSales)

  const entTech = await one(`select id from public.employee_commission_entitlements where opportunity_id=$1`, [oppFuture])
  const apE = await rpc(P.AM, "admin_approve_commission_entitlement", { idempotencyKey: key(), entitlementId: entTech.id, reason: "Aprovacao manual do direito apurado no laboratorio." })
  await t("ENTITLEMENT_approve", () => apE.r?.ok === true)

  const prof = await rpc(P.AF, "admin_save_employee_compensation_draft", { idempotencyKey: key(), employeeId: E.F1, validFrom: today, reason: "Perfil para incluir comissao fixa j7", salaryAmount: "1000.00", showSalary: true })
  const apP = await rpc(P.AM, "admin_approve_employee_compensation", { idempotencyKey: key(), profileId: prof.r.profileId })
  await t("PROFILE_approved", () => apP.r?.ok === true)
  const open = await rpc(P.AM, "admin_open_payroll_competence", { idempotencyKey: key(), employeeId: E.F1, competenceMonth: month })
  await t("OPEN", () => open.r?.ok === true)
  const calc = await rpc(P.AM, "admin_calculate_payroll_competence", { idempotencyKey: key(), competenceId: open.r.competenceId })
  await t("CALC", () => calc.r?.ok === true)
  const cid = (await one(`select id from public.payroll_competences where employee_id=$1 and is_current`, [E.F1])).id
  const revw = await rpc(P.AF, "admin_review_payroll_competence", { idempotencyKey: key(), competenceId: cid })
  await t("REVIEW", () => revw.r?.ok === true)
  const inc = await rpc(P.AM, "admin_include_commission_in_payroll", { idempotencyKey: key(), entitlementId: entTech.id, reason: "Incluir comissao fixa na competencia aberta.", visibleToEmployee: true })
  await t("INCLUDE_ok", () => inc.r?.ok === true || inc)
  const close = await rpc(P.AM, "admin_close_payroll_competence", { idempotencyKey: key(), competenceId: cid, reason: "Fechamento para registrar pagamento da comissao fixa." })
  await t("CLOSE", () => close.r?.ok === true && close.r.status === "closed" || close)
  const pay = await rpc(P.AM, "admin_register_payroll_payment", { idempotencyKey: key(), competenceId: cid, paidOn: today, method: "bank_transfer", reason: "Registro manual do pagamento da competencia fechada.", confirmed: true })
  await t("PAY_once", () => pay.r?.ok === true && pay.r.status === "paid" || pay)
  const beforeRev = (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n
  const revPay = await rpc(P.AM, "admin_reverse_payroll_payment", { idempotencyKey: key(), competenceId: cid, reason: "Estorno auditado do pagamento registrado no laboratorio." })
  await t("REVERSE_audited", () => revPay.r?.ok === true || revPay)
  await t("REVERSE_append_only", async () => {
    const n = (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n
    const st = (await one(`select status, payment_reversed from public.payroll_competences where id=$1`, [cid]))
    return revPay.r?.ok === true && n === beforeRev + 1 && st.status === "paid" && st.payment_reversed === true || { n, beforeRev, st, revPay }
  })

  const recC = await rpc(P.AC, "admin_reconcile_employee_commissions", { idempotencyKey: key() })
  await t("RECONCILE_consulta_forbidden", () => recC.r?.code === "forbidden")

  const c2 = new Client(lab.conn); const c3 = new Client(lab.conn)
  await c2.connect(); await c3.connect()
  const k1 = key(), k2 = key()
  const [ca, cb] = await Promise.all([
    rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: k1, limit: 10 }, c2),
    rpc(P.AF, "admin_reconcile_employee_commissions", { idempotencyKey: k2, limit: 10 }, c3),
  ])
  await t("CONCURRENCY_one_or_serial", () => {
    const oks = [ca, cb].filter((x) => x.r?.ok === true).length
    const blocked = [ca, cb].some((x) => x.r?.code === "reconcile_in_progress")
    return (oks >= 1 && (oks === 2 || blocked)) || { ca, cb }
  })
  await c2.end(); await c3.end()
  await t("CONCURRENCY_still_one_per_right", async () => {
    const n = (await one(`select count(*)::int n from public.employee_commission_entitlements where reversal_of is null`)).n
    return n === 2 || n
  })

  const money1 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet`)
  await t("REWARD_DELTA_0", () => money1.rewards === money0.rewards)
  await t("WALLET_DELTA_0", () => money1.wallet === money0.wallet)
  await t("PERCENTAGE_STILL_BLOCKED", async () => (await one(`select public.commission_j6_method_activatable('percentage') b`)).b === false)
  await t("FIRST_INVOICE_STILL_BLOCKED", async () => (await one(`select public.commission_j6_method_activatable('first_invoice_value') b`)).b === false)
  await t("FIXED_STILL_ACTIVATABLE", async () => (await one(`select public.commission_j6_method_activatable('fixed_amount') b`)).b === true)
  await t("AUDIT_ACTIVATION", async () => (await one(`select count(*)::int n from public.finance_audit_events where action='commission_rule_activated'`)).n >= 3)
  await t("AUDIT_ENTITLEMENT", async () => (await one(`select count(*)::int n from public.finance_audit_events where action='entitlement_accrued'`)).n >= 2)
  await t("AUDIT_APPROVE_INCLUDE_REVERSE", async () => {
    const a = await one(`select
      (select count(*)::int from public.finance_audit_events where action='entitlement_approved') ap,
      (select count(*)::int from public.finance_audit_events where action='entitlement_included') inc,
      (select count(*)::int from public.finance_audit_events where action='reverse') rv`)
    return a.ap >= 1 && a.inc >= 1 && a.rv >= 1 || a
  })
  await t("SNAP0_collections_shape", async () => {
    const s1 = await zeroWriteSnapshot(c)
    return typeof s1 === "object" || JSON.stringify(snap0)
  })
} catch (e) {
  ok = false
  res.push(["UNCAUGHT", "FAIL " + (e && e.message ? e.message : String(e))])
} finally {
  const out = res.map(([n, s]) => `${s.startsWith("PASS") ? "PASS" : "FAIL"} ${n} ${s.startsWith("PASS") ? "" : s}`).join("\n")
  writeFileSync(join(REPO_ROOT, "scripts/j7-fixed-commission-lab.last.txt"), out)
  console.log(out)
  console.log(ok ? "J7_LAB_OK" : "J7_LAB_FAIL")
  await lab.stop()
  if (!ok) process.exit(1)
}

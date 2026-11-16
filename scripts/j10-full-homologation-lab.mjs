// 3.1F-J10 — homologação isolada. Postgres local descartável. Sem produção, ERP ou Sync.
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { deflateSync } from "node:zlib"
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import net from "node:net"

const require = createRequire(import.meta.url)

function freePort(start) {
  const blocked = new Set([55434, 55484])
  return new Promise((resolve, reject) => {
    if (start > 56000) reject(new Error("no_free_port"))
    if (blocked.has(start)) return resolve(freePort(start + 1))
    const server = net.createServer()
    server.once("error", () => resolve(freePort(start + 1)))
    server.listen(start, "127.0.0.1", () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

const port = await freePort(55490)
process.env.IGT_PG_LAB_PORT = String(port)
process.env.IGT_PG_LAB_ROOT = join(process.env.LOCALAPPDATA, "igt-pg-j10-lab")
mkdirSync(process.env.IGT_PG_LAB_ROOT, { recursive: true })
const bundledModules = join(process.env.LOCALAPPDATA, "igt-pg-j2-lab", "node_modules")
const localModules = join(process.env.IGT_PG_LAB_ROOT, "node_modules")
if (!existsSync(localModules)) symlinkSync(bundledModules, localModules, "junction")
const reportDir = join(process.env.IGT_PG_LAB_ROOT, "report")
mkdirSync(reportDir, { recursive: true })

const { startJ2Lab } = await import("./j2-lab-chain.mjs")

const CHAIN = [
  "supabase/patch-employee-sales-opportunity-3-1f-j3.sql",
  "supabase/patch-employee-compensation-configuration-3-1f-j4.sql",
  "supabase/patch-employee-payroll-competence-3-1f-j5.sql",
  "supabase/patch-employee-commission-activation-3-1f-j6.sql",
  "supabase/patch-employee-fixed-commission-activation-3-1f-j7.sql",
  "supabase/patch-partner-merchant-referral-3-1f-j9.sql",
]
const J10 = "supabase/patch-partner-fixed-commission-reconcile-3-1f-j10.sql"
const VER = "supabase/verify-partner-merchant-referral-3-1f-j9.sql"

const res = []
let ok = true
const lab = await startJ2Lab({ applyJ2: true })
const { c, conn, Client, REPO_ROOT, applyFile, stop } = lab
const q = async (sql, p = []) => (await c.query(sql, p)).rows
const one = async (sql, p = []) => (await q(sql, p))[0]
const redact = (value) => JSON.stringify(value).replace(/[A-Za-z0-9_-]{43}/g, "[token]").slice(0, 500)
const t = async (name, fn) => {
  try {
    const v = await fn()
    res.push([name, v === true ? "PASS" : "FAIL " + redact(v)])
    if (v !== true) ok = false
  } catch (e) {
    await c.query("rollback").catch(() => {})
    res.push([name, "FAIL " + String(e.message).replace(/[A-Za-z0-9_-]{43}/g, "[token]")])
    ok = false
  }
}
const call = async (role, uid, sql, p = []) => {
  await c.query("begin")
  try {
    await c.query(`set local role ${role}`)
    if (uid) {
      await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid])
      await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid })])
    }
    const r = await c.query(`select ${sql} as r`, p)
    await c.query("commit")
    return { ok: true, r: r.rows[0].r }
  } catch (e) {
    await c.query("rollback").catch(() => {})
    return { ok: false, msg: e.message, code: e.code }
  }
}
const rpc = (uid, fn, payload) => call("authenticated", uid, `public.${fn}($1::jsonb)`, [JSON.stringify(payload)])
const pub = (fn, params, values) => call("anon", null, `public.${fn}(${params})`, values)
const id = (n) => `77777777-0000-4000-8000-${String(n).padStart(12, "0")}`
const P = { AM: id(1), AF: id(2), AC: id(3), TEC: id(4), VEX: id(5), CO: id(6), IND: id(7) }
let seq = 0
const key = () => `j10labkey${String(++seq).padStart(6, "0")}zzzz`
const clientKey = () => createHash("sha256").update(`j10-${seq}-${Math.random()}`).digest("hex")
const lead = (over = {}) => ({
  idempotencyKey: key(),
  planId: PLAN,
  name: "Lead Employee Teste",
  phone: "11900001001",
  document: "",
  zipcode: "12345678",
  street: "Rua Teste",
  number: "100",
  complement: "Lab",
  neighborhood: "Bairro Teste",
  city: "Cidade Teste",
  observation: "Homologacao sintetica",
  consent: true,
  confirmRecentDuplicate: false,
  ...over,
})
const partnerLead = (over = {}) => ({
  ...lead({ name: "Lead Parceiro Teste", phone: "11900001003", idempotencyKey: key() }),
  ...over,
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (~crc) >>> 0
}
function pngChunk(type, data) {
  const head = Buffer.concat([Buffer.from(type), data])
  const length = Buffer.alloc(4)
  const crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  crc.writeUInt32BE(crc32(head))
  return Buffer.concat([length, head, crc])
}
function renderQr(url) {
  const qrcode = require(join(REPO_ROOT, "lib/partner-merchants/vendor/qrcode-generator.js"))
  const code = qrcode(0, "M")
  code.addData(url)
  code.make()
  const count = code.getModuleCount()
  const margin = 2
  const size = count + margin * 2
  const marks = []
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (code.isDark(row, column)) marks.push(`<rect x="${column + margin}" y="${row + margin}" width="1" height="1"/>`)
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${marks.join("")}</g></svg>`
  const scale = 8
  const pixels = size * scale
  const raw = Buffer.alloc((pixels + 1) * pixels)
  let offset = 0
  for (let y = 0; y < pixels; y += 1) {
    raw[offset] = 0
    offset += 1
    const row = Math.floor(y / scale) - margin
    for (let x = 0; x < pixels; x += 1) {
      const column = Math.floor(x / scale) - margin
      const dark = row >= 0 && column >= 0 && row < count && column < count && code.isDark(row, column)
      raw[offset] = dark ? 0 : 255
      offset += 1
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(pixels, 0)
  header.writeUInt32BE(pixels, 4)
  header[8] = 8
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
  return { svg, png, modules: count }
}

let PLAN = null
const summary = {}

try {
  await t("LAB_LOCAL_ONLY", () => conn.host === "127.0.0.1" && conn.port === port && port !== 55434 && port !== 55484)
  for (const file of CHAIN) await applyFile(file)
  for (const row of (await c.query(readFileSync(join(REPO_ROOT, VER), "utf8"))).rows) {
    await t(`VERIFY_${row.check_name}`, () => row.ok === true)
  }
  await t("APPLY_J10", async () => { await applyFile(J10); return true })
  await t("REAPPLY_J10", async () => { await applyFile(J10); return true })
  await t("RECONCILE_NOT_GRANTED_TO_ANON", async () => (await one(`select has_function_privilege('anon','public.admin_reconcile_partner_commissions(jsonb)','execute') v`)).v === false)
  await t("RECONCILE_GRANTED_TO_AUTHENTICATED", async () => (await one(`select has_function_privilege('authenticated','public.admin_reconcile_partner_commissions(jsonb)','execute') v`)).v === true)

  await c.query(`insert into public.profiles(id,email,role,is_active,full_name) values
    ($1,'admin.master@example.test','admin_master',true,'Admin Master Teste'),
    ($2,'admin.financeiro@example.test','admin_financeiro',true,'Admin Financeiro Teste'),
    ($3,'admin.consulta@example.test','admin_consulta',true,'Admin Consulta Teste'),
    ($4,'tecnico@example.test','funcionario',true,'Tecnico Teste'),
    ($5,'vendedor.externo@example.test','funcionario',true,'Vendedor Externo Teste'),
    ($6,'comercial@example.test','comercial',true,'Comercial Teste'),
    ($7,'indicador@example.test','indicador',true,'Indicador Teste')
    on conflict (id) do nothing`, Object.values(P))
  PLAN = (await one(`insert into public.plans(name,speed_label,price,reward_amount,is_active) values ('Plano Teste','300 Mega',99.90,30,true) returning id`)).id
  const sectors = Object.fromEntries((await q(`select code, id from public.sectors`)).map((row) => [row.code, row.id]))
  const hire = (await one(`select (public.comp_cfg_today() - 10)::text d`)).d
  const today = (await one(`select public.comp_cfg_today()::text d`)).d
  const techEmployee = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', (($2::date + time '12:00') at time zone 'America/Sao_Paulo')) returning id`, [P.TEC, hire])).id
  const salesEmployee = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', (($2::date + time '12:00') at time zone 'America/Sao_Paulo')) returning id`, [P.VEX, hire])).id
  await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id,is_active) values ($1,$2,true),($3,$4,true)`, [techEmployee, sectors.technician, salesEmployee, sectors.external_sales])
  const money0 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet, (select count(*)::int from public.wallet_transactions where transaction_type::text = 'saque') withdrawals`)

  const formTech = await call("authenticated", P.TEC, "public.employee_opportunity_form_context()")
  await t("TECH_FORM", () => formTech.r?.canCreate === true && formTech.r?.eligibleRoles?.[0] === "technician_originator")
  const techSubmit = await rpc(P.TEC, "submit_employee_sales_opportunity", lead({ document: "52998224725" }))
  const techOpp = techSubmit.r?.opportunityId
  await t("TECH_CREATED", () => techSubmit.r?.ok === true && techSubmit.r?.attributionRole === "technician_originator" && techSubmit.r?.stage === "novo")
  const techRow = await one(`select origin_kind, reward_eligible, indicator_profile_id, pipeline_stage::text stage from public.referrals where id=$1`, [techOpp])
  const techAttr = await one(`select attribution_role from public.sales_opportunity_attributions where opportunity_id=$1`, [techOpp])
  await t("TECH_ATTRIBUTION", () => techRow.origin_kind === "employee" && techAttr.attribution_role === "technician_originator" && techRow.reward_eligible === false && techRow.indicator_profile_id == null && techRow.stage === "novo")
  const techSales = await call("authenticated", P.TEC, "public.list_employee_sales_filtered()")
  await t("TECH_MY_SALES", () => techSales.r?.items?.some((item) => item.id === techOpp) === true)
  const formSales = await call("authenticated", P.VEX, "public.employee_opportunity_form_context()")
  await t("SALES_FORM", () => formSales.r?.eligibleRoles?.[0] === "external_sales_originator")
  const salesSubmit = await rpc(P.VEX, "submit_employee_sales_opportunity", lead({ phone: "11900001002", name: "Lead Vendedor Teste", attributionRole: "external_sales_originator" }))
  const salesOpp = salesSubmit.r?.opportunityId
  await t("SALES_CREATED", () => salesSubmit.r?.ok === true && salesSubmit.r?.attributionRole === "external_sales_originator" && salesSubmit.r?.stage === "novo")
  const salesAttr = await one(`select attribution_role from public.sales_opportunity_attributions where opportunity_id=$1`, [salesOpp])
  await t("SALES_ATTRIBUTION", () => salesAttr.attribution_role === "external_sales_originator")
  const salesList = await call("authenticated", P.VEX, "public.list_employee_sales_filtered()")
  const techListAgain = await call("authenticated", P.TEC, "public.list_employee_sales_filtered()")
  await t("EMPLOYEE_ISOLATION", () => techListAgain.r?.items?.every((item) => item.id !== salesOpp) && salesList.r?.items?.every((item) => item.id !== techOpp))
  const adminOrigins = await call("authenticated", P.AM, `coalesce((select jsonb_agg(to_jsonb(x)) from public.list_employee_opportunity_origins(array[$1::uuid,$2::uuid]) x), '[]'::jsonb)`, [techOpp, salesOpp])
  await t("ADMIN_SEES_EMPLOYEE_ORIGINS", () => {
    const roles = (adminOrigins.r ?? []).map((row) => row.attribution_role).sort()
    return roles.includes("technician_originator") && roles.includes("external_sales_originator")
  })
  const beforeInvoice = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: key(), limit: 20 })
  await t("NO_INVOICE_NO_COMMISSION", async () => beforeInvoice.r?.ok === true && beforeInvoice.r?.accrued === 0 && beforeInvoice.r?.erpRequests === 0 && (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n === 0)

  const ruleDraft = (over) => ({ idempotencyKey: key(), name: "Regra Teste", attributionRole: "technician_originator", method: "fixed_amount", fixedAmount: "30.00", effectiveFrom: today, reason: "Rascunho de comissao fixa do laboratorio.", ...over })
  const techRule = await rpc(P.AF, "admin_save_commission_rule_draft", ruleDraft())
  const salesRule = await rpc(P.AF, "admin_save_commission_rule_draft", ruleDraft({ name: "Regra Vendedor Teste", attributionRole: "external_sales_originator", fixedAmount: "50.00" }))
  const pctRule = await rpc(P.AF, "admin_save_commission_rule_draft", ruleDraft({ name: "Percentual bloqueado", method: "percentage", fixedAmount: undefined, percentageRate: "0.010000" }))
  const invRule = await rpc(P.AF, "admin_save_commission_rule_draft", ruleDraft({ name: "Primeira fatura bloqueada", method: "first_invoice_value", fixedAmount: undefined }))
  await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: techRule.r.ruleId })
  await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: salesRule.r.ruleId })
  await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: pctRule.r.ruleId })
  await rpc(P.AM, "admin_approve_commission_rule", { idempotencyKey: key(), ruleId: invRule.r.ruleId })
  const actTech = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: techRule.r.ruleId, reason: "Ativar comissao fixa do tecnico de teste." })
  const actSales = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: salesRule.r.ruleId, reason: "Ativar comissao fixa do vendedor externo de teste." })
  const actPct = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: pctRule.r.ruleId, reason: "Tentativa de ativar percentual sem base comprovada." })
  const actInv = await rpc(P.AM, "admin_activate_commission_rule", { idempotencyKey: key(), ruleId: invRule.r.ruleId, reason: "Tentativa de ativar primeira fatura sem pagamento integral." })
  await t("EMPLOYEE_RULES_ACTIVE", () => actTech.r?.status === "active" && actSales.r?.status === "active")
  await t("PERCENTAGE_BLOCKED", () => actPct.r?.code === "percentage_base_not_proven")
  await t("FIRST_INVOICE_VALUE_BLOCKED", () => actInv.r?.code === "full_payment_unproven")

  const absent = await rpc(P.TEC, "submit_employee_sales_opportunity", lead({ phone: "11900001021", name: "Lead Sem Fatura Teste" }))
  const cancelled = await rpc(P.TEC, "submit_employee_sales_opportunity", lead({ phone: "11900001022", name: "Lead Fatura Cancelada Teste" }))
  await c.query(`update public.referrals set brbyte_id_contrato=$2, brbyte_contract_pk=$2, brbyte_first_invoice_pk=$3, brbyte_first_invoice_payload=$4::jsonb where id=$1`, [techOpp, "88001", "99001", JSON.stringify({ invoice_deleted: false, invoice_msg: "open", paidAmount: "0.00" })])
  await c.query(`update public.referrals set brbyte_id_contrato=$2, brbyte_contract_pk=$2, brbyte_first_invoice_pk=$3, brbyte_first_invoice_payload=$4::jsonb where id=$1`, [salesOpp, "88002", "99002", JSON.stringify({ invoice_deleted: false, invoice_msg: "open" })])
  await c.query(`update public.referrals set brbyte_id_contrato=$2, brbyte_contract_pk=$2, brbyte_first_invoice_pk=$3, brbyte_first_invoice_payload=$4::jsonb where id=$1`, [cancelled.r.opportunityId, "88003", "99003", JSON.stringify({ invoice_deleted: true, invoice_msg: "cancelada" })])
  const recEmployees = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: key(), limit: 20 })
  const techEnt = await one(`select count(*)::int n, max(amount)::text amt from public.employee_commission_entitlements where opportunity_id=$1 and reversal_of is null`, [techOpp])
  const salesEnt = await one(`select count(*)::int n, max(amount)::text amt from public.employee_commission_entitlements where opportunity_id=$1 and reversal_of is null`, [salesOpp])
  await t("TECH_ENTITLEMENT_30", () => recEmployees.r?.erpRequests === 0 && techEnt.n === 1 && techEnt.amt === "30.00")
  await t("SALES_ENTITLEMENT_50", () => salesEnt.n === 1 && salesEnt.amt === "50.00")
  await t("ABSENT_AND_CANCELLED_NO_ENTITLEMENT", async () => {
    const n = await one(`select count(*)::int n from public.employee_commission_entitlements where opportunity_id = any($1::uuid[])`, [[absent.r.opportunityId, cancelled.r.opportunityId]])
    return n.n === 0
  })
  await c.query(`update public.referrals set brbyte_first_invoice_pk='99011' where id=$1`, [techOpp])
  const recSecond = await rpc(P.AM, "admin_reconcile_employee_commissions", { idempotencyKey: key(), limit: 20 })
  await t("SECOND_INVOICE_NO_SECOND_TECH_COMMISSION", async () => recSecond.r?.ok === true && (await one(`select count(*)::int n from public.employee_commission_entitlements where opportunity_id=$1 and reversal_of is null`, [techOpp])).n === 1)
  const consultaRec = await rpc(P.AC, "admin_reconcile_employee_commissions", { idempotencyKey: key() })
  await t("CONSULTA_CANNOT_RECONCILE_EMPLOYEE", () => consultaRec.r?.code === "forbidden")

  const cnpj = (await one(`select c from (values ('11222333000181'),('19131243000197'),('04252011000110')) v(c) where public.partner_cnpj_is_valid(c) limit 1`)).c
  const createdA = await rpc(P.AM, "admin_save_partner_merchant", {
    idempotencyKey: key(), legalName: "Comercio Parceiro Teste A Ltda", tradeName: "Parceiro Teste A",
    cnpj, responsibleName: "Responsavel Teste A", phone: "1130001001", email: "parceiro.a@example.test",
    address: "Rua Teste 100", publicDisplayName: "Parceiro Teste A", publishCnpj: false,
  })
  const partnerA = createdA.r?.id
  const financeCreate = await rpc(P.AF, "admin_save_partner_merchant", {
    idempotencyKey: key(), legalName: "Nao Pode", tradeName: "Nao Pode", responsibleName: "Responsavel", phone: "1130001999", publicDisplayName: "Nao Pode", publishCnpj: false,
  })
  await t("PARTNER_CREATED_BY_MASTER", () => createdA.r?.status === "draft" && financeCreate.r?.code === "forbidden")
  const activeA = await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partnerA, status: "active" })
  const fixed = await rpc(P.AF, "admin_save_partner_compensation_rule", { idempotencyKey: key(), partnerId: partnerA, kind: "fixed_amount", fixedAmountCents: 4000 })
  await t("PARTNER_FIXED_CONFIGURED", () => activeA.r?.status === "active" && fixed.r?.status === "configured" && fixed.r?.entitlementCreated === false)
  const financeFixed = await call("authenticated", P.AF, "public.admin_get_partner_merchant($1::uuid)", [partnerA])
  const consultaFixed = await call("authenticated", P.AC, "public.admin_get_partner_merchant($1::uuid)", [partnerA])
  await t("FINANCE_SEES_FIXED_AMOUNT", () => financeFixed.r?.rule?.fixedAmountCents === 4000 && consultaFixed.r?.rule == null)
  const issued = await rpc(P.AM, "admin_issue_partner_link", { idempotencyKey: key(), partnerId: partnerA, mode: "issue" })
  const tokenA = issued.r?.token
  const urlA = issued.r?.url
  const hashA = createHash("sha256").update(tokenA).digest("hex")
  const stored = await one(`select token_hash = $2 as match, not (to_jsonb(l) ? 'token') as no_plain from public.partner_merchant_links l where id=$1`, [issued.r.linkId, hashA])
  await t("PARTNER_LINK_HASH_ONLY", () => issued.r?.tokenRevealed === true && stored.match === true && stored.no_plain === true && urlA.startsWith("https://crm.tantotelecom.com.br/parceiro/"))
  const qr = renderQr(urlA)
  writeFileSync(join(reportDir, "partner-a.svg"), qr.svg)
  writeFileSync(join(reportDir, "partner-a.png"), qr.png)
  await t("QR_PNG_AND_SVG", () => qr.png[0] === 137 && qr.png[1] === 80 && qr.png[2] === 78 && qr.png[3] === 71 && qr.svg.startsWith("<svg") && qr.modules >= 21 && !qr.svg.includes("4000") && !qr.svg.includes("11900001003") && urlA.startsWith("https://crm.tantotelecom.com.br/parceiro/") && !urlA.includes("?"))

  const context = await pub("partner_public_form_context", "$1,$2", [tokenA, clientKey()])
  await t("PUBLIC_NAME", () => context.r?.ok === true && context.r?.publicDisplayName === "Parceiro Teste A" && context.r?.cnpj == null)
  const partnerKey = key()
  const submitted = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenA, clientKey(), JSON.stringify(partnerLead({ idempotencyKey: partnerKey }))])
  const replay = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenA, clientKey(), JSON.stringify(partnerLead({ idempotencyKey: partnerKey }))])
  const clash = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenA, clientKey(), JSON.stringify(partnerLead({ idempotencyKey: partnerKey, name: "Outro Lead Teste" }))])
  await t("PARTNER_SUBMIT_IDEMPOTENT", () => submitted.r?.ok === true && submitted.r?.protocol?.length === 10 && replay.r?.idempotent === true && replay.r?.protocol === submitted.r?.protocol && clash.r?.code === "idempotency_conflict")
  const protocol = submitted.r?.protocol
  const partnerRow = await one(`select id, origin_kind, reward_eligible, indicator_profile_id, pipeline_stage::text stage from public.referrals where partner_public_protocol=$1`, [protocol])
  const partnerAttr = await one(`select partner_merchant_id = $2 as same from public.partner_merchant_attributions where opportunity_id=$1`, [partnerRow.id, partnerA])
  await t("PARTNER_ATTRIBUTION", () => partnerRow.origin_kind === "partner_merchant" && partnerRow.reward_eligible === false && partnerRow.indicator_profile_id == null && partnerRow.stage === "novo" && partnerAttr.same === true)
  const duplicate = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenA, clientKey(), JSON.stringify(partnerLead({ idempotencyKey: key(), name: "Segunda Tentativa Teste" }))])
  await t("DUPLICATE_OPEN", () => duplicate.r?.code === "duplicate_open")

  const createdB = await rpc(P.AM, "admin_save_partner_merchant", {
    idempotencyKey: key(), legalName: "Comercio Parceiro Teste B Ltda", tradeName: "Parceiro Teste B",
    responsibleName: "Responsavel Teste B", phone: "1130001002", email: "parceiro.b@example.test",
    publicDisplayName: "Parceiro Teste B", publishCnpj: false,
  })
  const partnerB = createdB.r?.id
  await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partnerB, status: "active" })
  const issuedB = await rpc(P.AM, "admin_issue_partner_link", { idempotencyKey: key(), partnerId: partnerB, mode: "issue" })
  const compete = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [issuedB.r.token, clientKey(), JSON.stringify(partnerLead({ idempotencyKey: key(), name: "Pelo Parceiro B" }))])
  const stillA = await one(`select partner_merchant_id = $2 as same from public.partner_merchant_attributions where opportunity_id=$1`, [partnerRow.id, partnerA])
  const attempts = await one(`select count(*)::int n from public.partner_merchant_competing_attempts where attempted_partner_merchant_id=$1`, [partnerB])
  await t("COMPETING_KEEPS_A", () => compete.r?.code === "duplicate_open" && stillA.same === true && attempts.n >= 1)
  const ca = new Client(conn)
  const cb = new Client(conn)
  await ca.connect(); await cb.connect()
  const race = async (client, token, body) => {
    await client.query("begin")
    await client.query("set local role anon")
    const r = await client.query(`select public.submit_partner_merchant_referral($1,$2,$3::jsonb) as r`, [token, clientKey(), body])
    await client.query("commit")
    return r.rows[0].r
  }
  const [raceA, raceB] = await Promise.all([
    race(ca, tokenA, JSON.stringify(partnerLead({ phone: "11900001004", idempotencyKey: key(), name: "Corrida A Teste" }))),
    race(cb, issuedB.r.token, JSON.stringify(partnerLead({ phone: "11900001004", idempotencyKey: key(), name: "Corrida B Teste" }))),
  ])
  await ca.end(); await cb.end()
  const raceCount = await one(`select count(*)::int n from public.referrals where public.employee_opportunity_normalize_phone(referred_phone)='11900001004'`)
  await t("CONCURRENT_ONE_OPPORTUNITY", () => [raceA, raceB].filter((row) => row?.ok === true).length === 1 && raceCount.n === 1)

  const rotated = await rpc(P.AM, "admin_issue_partner_link", { idempotencyKey: key(), partnerId: partnerA, mode: "rotate" })
  const oldQr = await pub("partner_public_form_context", "$1,$2", [tokenA, clientKey()])
  const newQr = await pub("partner_public_form_context", "$1,$2", [rotated.r.token, clientKey()])
  await t("ROTATED_OLD_QR_DIES", () => oldQr.r?.code === "unavailable" && newQr.r?.publicDisplayName === "Parceiro Teste A" && rotated.r?.token !== tokenA)
  const bad1 = await pub("partner_public_form_context", "$1,$2", ["A".repeat(43), clientKey()])
  const bad2 = await pub("partner_public_form_context", "$1,$2", ["B".repeat(43), clientKey()])
  await t("INVALID_TOKEN_NO_ENUMERATION", () => bad1.r?.code === "unavailable" && bad2.r?.code === "unavailable" && bad1.r?.publicDisplayName == null && bad2.r?.publicDisplayName == null && JSON.stringify(bad1.r) === JSON.stringify(bad2.r))
  const paused = await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partnerB, status: "paused", reason: "Pausa do laboratorio de teste." })
  const pausedSubmit = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [issuedB.r.token, clientKey(), JSON.stringify(partnerLead({ phone: "11900001005", idempotencyKey: key() }))])
  await t("PAUSED_UNAVAILABLE", () => paused.r?.status === "paused" && pausedSubmit.r?.code === "unavailable")
  const ended = await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partnerB, status: "terminated", reason: "Encerramento do laboratorio de teste." })
  const endedSubmit = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [issuedB.r.token, clientKey(), JSON.stringify(partnerLead({ phone: "11900001006", idempotencyKey: key() }))])
  const linksLeft = await one(`select count(*)::int n from public.partner_merchant_links where partner_merchant_id=$1 and status='active'`, [partnerB])
  await t("TERMINATED_REVOKES", () => ended.r?.status === "terminated" && endedSubmit.r?.code === "unavailable" && linksLeft.n === 0)
  const tamper = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [rotated.r.token, clientKey(), JSON.stringify({ ...partnerLead({ phone: "11900001007" }), partnerId: partnerA, origin_kind: "indicator", reward_eligible: true, indicator_profile_id: P.IND })])
  await t("PUBLIC_REJECTS_TAMPER", () => tamper.r?.code === "unknown_field")
  const revoked = await rpc(P.AM, "admin_revoke_partner_link", { idempotencyKey: key(), linkId: rotated.r.linkId, reason: "Revogacao do laboratorio de teste." })
  const revokedCtx = await pub("partner_public_form_context", "$1,$2", [rotated.r.token, clientKey()])
  await t("REVOKED_TOKEN", () => revoked.r?.ok === true && revokedCtx.r?.code === "unavailable")
  let limited = null
  const limitedKey = "b".repeat(64)
  for (let i = 0; i < 25; i += 1) {
    limited = await pub("partner_public_form_context", "$1,$2", ["C".repeat(43), limitedKey])
    if (limited.r?.code === "rate_limited") break
  }
  await t("RATE_LIMIT", () => limited.r?.code === "rate_limited")

  const noInvoice = await rpc(P.AM, "admin_reconcile_partner_commissions", { idempotencyKey: key(), partnerId: partnerA })
  await t("PARTNER_NO_INVOICE_NO_ENTITLEMENT", () => noInvoice.r?.ok === true && noInvoice.r?.accrued === 0 && noInvoice.r?.erpRequests === 0)
  await c.query(`update public.referrals set brbyte_id_contrato=$2, brbyte_contract_pk=$2, brbyte_first_invoice_pk=$3, brbyte_first_invoice_payload=$4::jsonb where id=$1`, [partnerRow.id, "88040", "99040", JSON.stringify({ invoice_deleted: false, invoice_msg: "open", paidAmount: "10.00" })])
  const ready = await rpc(P.AF, "admin_preview_partner_fixed_activation", { partnerId: partnerA, opportunityId: partnerRow.id })
  const partnerRec = await rpc(P.AM, "admin_reconcile_partner_commissions", { idempotencyKey: key(), partnerId: partnerA })
  const partnerEnt = await one(`select count(*)::int n from public.partner_commission_entitlements e join public.partner_merchant_rules r on r.id=e.rule_id where e.opportunity_id=$1 and r.fixed_amount_cents=4000 and e.trigger_kind='invoice_generated'`, [partnerRow.id])
  await t("PARTNER_ENTITLEMENT_40", () => ready.r?.code === "ready_to_reconcile" && partnerRec.r?.accrued === 1 && partnerRec.r?.erpRequests === 0 && partnerEnt.n === 1)
  await c.query(`update public.referrals set brbyte_first_invoice_pk='99041' where id=$1`, [partnerRow.id])
  const partnerSecond = await rpc(P.AM, "admin_reconcile_partner_commissions", { idempotencyKey: key(), partnerId: partnerA })
  await t("SECOND_INVOICE_NO_SECOND_PARTNER_COMMISSION", async () => partnerSecond.r?.accrued === 0 && (await one(`select count(*)::int n from public.partner_commission_entitlements where opportunity_id=$1`, [partnerRow.id])).n === 1)
  const firstRun = await one(`select idempotency_key k from public.partner_commission_reconcile_runs where accrued = 1 order by created_at desc limit 1`)
  const replayRec = await rpc(P.AM, "admin_reconcile_partner_commissions", { idempotencyKey: firstRun.k, partnerId: partnerA })
  await t("PARTNER_RECONCILE_REPLAY", () => replayRec.r?.idempotent === true && replayRec.r?.accrued === 1)
  const direct = await c.query(`insert into public.partner_commission_entitlements(partner_merchant_id,opportunity_id,rule_id,trigger_kind,evidence_invoice_pk) values ($1,$2,$3,'invoice_generated','1')`, [partnerA, partnerRow.id, fixed.r.ruleId]).then(() => "inserted").catch((e) => e.message)
  await t("DIRECT_ENTITLEMENT_STILL_BLOCKED", () => /partner_entitlements_withheld_this_release/.test(direct))
  const deletedEnt = await c.query(`delete from public.partner_commission_entitlements where opportunity_id=$1`, [partnerRow.id]).then(() => "deleted").catch((e) => e.message)
  await t("ENTITLEMENT_NO_DELETE", () => /partner_entitlement_delete_forbidden/.test(deletedEnt))
  const pctPartner = await rpc(P.AF, "admin_save_partner_compensation_rule", { idempotencyKey: key(), partnerId: partnerA, kind: "percentage", percentageBps: 800 })
  const invPartner = await rpc(P.AF, "admin_save_partner_compensation_rule", { idempotencyKey: key(), partnerId: partnerA, kind: "first_invoice_value" })
  const afterBlocked = await rpc(P.AM, "admin_reconcile_partner_commissions", { idempotencyKey: key(), partnerId: partnerA })
  await t("PARTNER_MODALITIES_STAY_BLOCKED", async () => pctPartner.r?.blockReason === "percentage_base_not_proven" && invPartner.r?.blockReason === "full_payment_unproven" && afterBlocked.r?.accrued === 0 && (await one(`select count(*)::int n from public.partner_commission_entitlements where partner_merchant_id=$1`, [partnerA])).n === 1)
  const consultaPartner = await rpc(P.AC, "admin_reconcile_partner_commissions", { idempotencyKey: key(), partnerId: partnerA })
  const consultaRead = await call("authenticated", P.AC, "public.admin_get_partner_merchant($1::uuid)", [partnerA])
  const commercialRead = await call("authenticated", P.CO, "public.admin_get_partner_merchant($1::uuid)", [partnerA])
  const financeRead = await call("authenticated", P.AF, "public.admin_get_partner_merchant($1::uuid)", [partnerA])
  const employeeRead = await call("authenticated", P.TEC, "public.admin_get_partner_merchant($1::uuid)", [partnerA])
  await t("ROLE_ISOLATION", () => consultaPartner.r?.code === "forbidden" && consultaRead.r?.rule == null && commercialRead.r?.rule == null && financeRead.r?.rule?.kind === "first_invoice_value" && financeRead.r?.capability === "finance" && employeeRead.r?.code === "forbidden" && !JSON.stringify(consultaRead.r).includes("fixedAmountCents") && !JSON.stringify(commercialRead.r).includes("fixedAmountCents"))
  const partnerHasLogin = await one(`select count(*)::int n from public.profiles where email in ('parceiro.a@example.test','parceiro.b@example.test') and role::text not in ('admin_master','admin_financeiro','admin_consulta','comercial','funcionario','indicador')`)
  await t("PARTNER_HAS_NO_LOGIN", () => partnerHasLogin.n === 0)

  const entTech = await one(`select id from public.employee_commission_entitlements where opportunity_id=$1 and reversal_of is null`, [techOpp])
  const approvedEnt = await rpc(P.AM, "admin_approve_commission_entitlement", { idempotencyKey: key(), entitlementId: entTech.id, reason: "Aprovar direito fixo do tecnico de teste." })
  const month = (await one(`select competence_month::text m from public.employee_commission_entitlements where id=$1`, [entTech.id])).m
  const profile = await rpc(P.AF, "admin_save_employee_compensation_draft", {
    idempotencyKey: key(), employeeId: techEmployee, validFrom: today, reason: "Perfil sintetico do tecnico de teste",
    salaryAmount: "2500.00", showSalary: true, mealDailyAmount: "22.00", showMeal: true,
    transportAmount: "150.00", transportMethod: "monthly_fixed", showTransport: true,
    fuelAmount: "80.00", fuelMethod: "monthly_fixed", showFuel: true,
  })
  const approvedProfile = await rpc(P.AM, "admin_approve_employee_compensation", { idempotencyKey: key(), profileId: profile.r.profileId })
  const days = await rpc(P.AF, "admin_save_employee_worked_days", { idempotencyKey: key(), employeeId: techEmployee, competenceMonth: month, days: [{ date: today, present: true }] })
  const opened = await rpc(P.AM, "admin_open_payroll_competence", { idempotencyKey: key(), employeeId: techEmployee, competenceMonth: month })
  const calculated = await rpc(P.AM, "admin_calculate_payroll_competence", { idempotencyKey: key(), competenceId: opened.r.competenceId })
  const included = await rpc(P.AM, "admin_include_commission_in_payroll", { idempotencyKey: key(), entitlementId: entTech.id, reason: "Incluir comissao fixa do tecnico na competencia.", visibleToEmployee: true })
  const lines = await q(`select line_type, amount::text amount from public.payroll_competence_lines where competence_id=$1`, [opened.r.competenceId])
  const amountOf = (type) => lines.find((line) => line.line_type === type)?.amount
  const round = await one(`select public.payroll_j5_round(1.225)::text a, public.payroll_j5_round(22.00 * 1)::text b`)
  await t("COMPETENCE_CALCULATION", () => approvedEnt.r?.status === "approved" && approvedProfile.r?.status === "approved" && days.r?.ok === true && calculated.r?.status === "calculated" && included.r?.ok === true && amountOf("base_salary") === "2500.00" && amountOf("meal") === "22.00" && amountOf("transport") === "150.00" && amountOf("fuel") === "80.00" && amountOf("commission") === "30.00" && round.a === "1.23" && round.b === "22.00")
  const reviewed = await rpc(P.AF, "admin_review_payroll_competence", { idempotencyKey: key(), competenceId: opened.r.competenceId })
  const closed = await rpc(P.AM, "admin_close_payroll_competence", { idempotencyKey: key(), competenceId: opened.r.competenceId, reason: "Fechamento da competencia de teste do tecnico." })
  const locked = await rpc(P.AM, "admin_add_payroll_manual_line", { idempotencyKey: key(), competenceId: opened.r.competenceId, lineType: "adjustment", amount: "1.00", reason: "Tentativa apos o fechamento da competencia.", visibleToEmployee: false })
  await t("COMPETENCE_REVIEW_CLOSE_LOCK", () => reviewed.r?.status === "under_review" && closed.r?.status === "closed" && locked.r?.code === "competence_locked")
  const paid = await rpc(P.AM, "admin_register_payroll_payment", { idempotencyKey: key(), competenceId: opened.r.competenceId, paidOn: today, method: "bank_transfer", reason: "Pagamento manual da competencia de teste.", confirmed: true })
  const paidRow = await one(`select c.status, c.paid_at is not null as paid_at, c.paid_by = $2 as paid_by, e.status as entitlement from public.payroll_competences c join public.employee_commission_entitlements e on e.id=$3 where c.id=$1`, [opened.r.competenceId, P.AM, entTech.id])
  const paidAgain = await rpc(P.AM, "admin_register_payroll_payment", { idempotencyKey: key(), competenceId: opened.r.competenceId, paidOn: today, method: "bank_transfer", reason: "Segunda tentativa de pagamento da competencia.", confirmed: true })
  await t("PAYMENT_ONCE", () => paid.r?.status === "paid" && paidRow.status === "paid" && paidRow.entitlement === "paid" && paidRow.paid_at === true && paidRow.paid_by === true && paidAgain.r?.code === "payment_already_registered")
  const beforeReverse = (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n
  const reversed = await rpc(P.AM, "admin_reverse_payroll_payment", { idempotencyKey: key(), competenceId: opened.r.competenceId, reason: "Estorno auditado do pagamento de teste." })
  const afterReverse = await one(`select count(*)::int n from public.employee_commission_entitlements`)
  const reverseState = await one(`select status, payment_reversed from public.payroll_competences where id=$1`, [opened.r.competenceId])
  const deleteLine = await c.query(`delete from public.payroll_competence_lines where competence_id=$1`, [opened.r.competenceId]).then(() => "deleted").catch((e) => e.message)
  await t("REVERSAL_APPEND_ONLY", () => reversed.r?.ok === true && afterReverse.n === beforeReverse + 1 && reverseState.payment_reversed === true && /append|forbidden|immutable|delete/i.test(deleteLine) && deleteLine !== "deleted")

  const indicator = await c.query(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,origin_kind,reward_eligible,reward_type,reward_amount,status,pipeline_stage) values ($1,'Lead Indicador Teste','11900001099',$2,'indicator',true,'pix',30,'pendente','novo') returning id`, [P.IND, PLAN])
  const ensured = await call("authenticated", P.AM, "public.ensure_referral_reward($1::uuid)", [indicator.rows[0].id])
  const employeeReward = await c.query(`insert into public.rewards(referral_id,indicator_profile_id,reward_type,amount) values ($1,$2,'pix',30)`, [techOpp, P.IND]).then(() => "inserted").catch((e) => e.message)
  const partnerReward = await c.query(`insert into public.rewards(referral_id,indicator_profile_id,reward_type,amount) values ($1,$2,'pix',30)`, [partnerRow.id, P.IND]).then(() => "inserted").catch((e) => e.message)
  const money1 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet, (select count(*)::int from public.wallet_transactions where transaction_type::text = 'saque') withdrawals`)
  await t("INDICATOR_REWARD_WORKS", () => ensured.r?.ok === true && ensured.r?.created === true && money1.rewards === money0.rewards + 1)
  await t("EMPLOYEE_AND_PARTNER_NEVER_REWARD", () => /not_reward_eligible|origem|null value|invalid input value|reward/i.test(employeeReward) && employeeReward !== "inserted" && partnerReward !== "inserted")
  await t("WALLET_AND_WITHDRAWAL_UNTOUCHED", () => money1.wallet === money0.wallet && money1.withdrawals === money0.withdrawals)

  const hashes = {}
  for (const file of [...CHAIN, J10]) hashes[file] = createHash("sha256").update(readFileSync(join(REPO_ROOT, file))).digest("hex")
  summary.port = port
  summary.hashes = hashes
  summary.rewards = { before: money0.rewards, after: money1.rewards }
  summary.wallet = { before: money0.wallet, after: money1.wallet }
  summary.partnerEntitlements = (await one(`select count(*)::int n from public.partner_commission_entitlements`)).n
  summary.employeeEntitlements = (await one(`select count(*)::int n from public.employee_commission_entitlements`)).n
  writeFileSync(join(reportDir, "summary.json"), JSON.stringify(summary, null, 2))
} catch (e) {
  ok = false
  res.push(["UNCAUGHT", "FAIL " + (e?.message || String(e))])
} finally {
  const out = res.map(([name, status]) => `${status.startsWith("PASS") ? "PASS" : "FAIL"} ${name}${status.startsWith("PASS") ? "" : " " + status}`).join("\n")
  writeFileSync(join(REPO_ROOT, "scripts/j10-full-homologation-lab.last.txt"), out + `\nRESULT ${ok ? "PASS" : "FAIL"}\nPORT ${port}\n`)
  writeFileSync(join(reportDir, "scenarios.txt"), out + `\nRESULT ${ok ? "PASS" : "FAIL"}\n`)
  console.log(out)
  console.log(ok ? "J10_LAB_PASS" : "J10_LAB_FAIL")
  console.log("PORT", port)
  await stop()
}
process.exit(ok ? 0 : 1)

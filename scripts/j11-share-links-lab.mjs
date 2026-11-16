import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import net from "node:net"

function freePort(start) {
  const blocked = new Set([55434, 55484, 55490])
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

const port = await freePort(Number(process.env.IGT_PG_LAB_PORT || 55510))
process.env.IGT_PG_LAB_PORT = String(port)
if (!process.env.IGT_PG_LAB_ROOT) process.env.IGT_PG_LAB_ROOT = join(process.env.LOCALAPPDATA, "igt-pg-j11-lab")
mkdirSync(process.env.IGT_PG_LAB_ROOT, { recursive: true })
const bundledModules = process.env.IGT_PG_J2_MODULES || join(process.env.LOCALAPPDATA, "igt-pg-j2-lab", "node_modules")
const localModules = join(process.env.IGT_PG_LAB_ROOT, "node_modules")
if (!existsSync(localModules)) symlinkSync(bundledModules, localModules, "junction")

const { startJ2Lab } = await import("./j2-lab-chain.mjs")
const CHAIN = [
  "supabase/patch-employee-sales-opportunity-3-1f-j3.sql",
  "supabase/patch-employee-compensation-configuration-3-1f-j4.sql",
  "supabase/patch-employee-payroll-competence-3-1f-j5.sql",
  "supabase/patch-employee-commission-activation-3-1f-j6.sql",
  "supabase/patch-employee-fixed-commission-activation-3-1f-j7.sql",
  "supabase/patch-partner-merchant-referral-3-1f-j9.sql",
  "supabase/patch-partner-fixed-commission-reconcile-3-1f-j10.sql",
]
const J11 = "supabase/patch-referral-share-links-3-1f-j11.sql"
const VER = "supabase/verify-referral-share-links-3-1f-j11.sql"
const res = []
let ok = true
const lab = await startJ2Lab({ applyJ2: true })
const { c, conn, Client, REPO_ROOT, applyFile, stop } = lab
const q = async (sql, p = []) => (await c.query(sql, p)).rows
const one = async (sql, p = []) => (await q(sql, p))[0]
const t = async (name, fn) => {
  try {
    const value = await fn()
    res.push([name, value === true ? "PASS" : "FAIL"])
    if (value !== true) ok = false
  } catch (error) {
    await c.query("rollback").catch(() => {})
    res.push([name, "FAIL " + String(error.message).slice(0, 240)])
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
    const row = await c.query(`select ${sql} as r`, p)
    await c.query("commit")
    return { ok: true, r: row.rows[0].r }
  } catch (error) {
    await c.query("rollback").catch(() => {})
    return { ok: false, msg: error.message }
  }
}
const rpc = (uid, fn, payload) => call("authenticated", uid, `public.${fn}($1::jsonb)`, [JSON.stringify(payload)])
const pub = (fn, params, values) => call("anon", null, `public.${fn}(${params})`, values)
const id = (n) => `88888888-0000-4000-8000-${String(n).padStart(12, "0")}`
const P = { AM: id(1), TEC: id(2), VEX: id(3), IND: id(4), DUAL: id(5) }
let seq = 0
const key = () => `j11labkey${String(++seq).padStart(6, "0")}zzzz`
const clientKey = () => createHash("sha256").update(`j11-${seq}-${Math.random()}`).digest("hex")
const lead = (over = {}) => ({
  idempotencyKey: key(), planId: PLAN, name: "Lead Link Teste", phone: "11911112001", document: "",
  zipcode: "12345678", street: "Rua Teste", number: "10", complement: "", neighborhood: "Bairro",
  city: "Cidade", observation: "", consent: true, confirmRecentDuplicate: false, ...over,
})

let PLAN = null
try {
  await t("LAB_LOCAL_ONLY", () => conn.host === "127.0.0.1" && conn.port === port && port !== 55434 && port !== 55484 && port !== 55490)
  for (const file of CHAIN) await applyFile(file)
  await t("APPLY_J11", async () => { await applyFile(J11); return true })
  await t("REAPPLY_J11", async () => { await applyFile(J11); return true })
  for (const row of (await c.query(readFileSync(join(REPO_ROOT, VER), "utf8"))).rows) {
    await t(`VERIFY_${row.check_name}`, () => row.ok === true)
  }
  await c.query(`insert into public.profiles(id,email,role,is_active,full_name) values
    ($1,'admin.master.j11@example.test','admin_master',true,'Admin Master Teste'),
    ($2,'tecnico.j11@example.test','funcionario',true,'Tecnico Teste'),
    ($3,'vendedor.j11@example.test','funcionario',true,'Vendedor Externo Teste'),
    ($4,'indicador.j11@example.test','indicador',true,'Indicador Teste'),
    ($5,'duplo.j11@example.test','funcionario',true,'Funcionario Dois Papeis')
    on conflict (id) do nothing`, Object.values(P))
  PLAN = (await one(`insert into public.plans(name,speed_label,price,reward_amount,is_active) values ('Plano Link','300 Mega',99.90,30,true) returning id`)).id
  const sectors = Object.fromEntries((await q(`select code, id from public.sectors`)).map((row) => [row.code, row.id]))
  const hire = (await one(`select (public.comp_cfg_today() - 10)::text d`)).d
  const techEmployee = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', (($2::date + time '12:00') at time zone 'America/Sao_Paulo')) returning id`, [P.TEC, hire])).id
  const salesEmployee = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', (($2::date + time '12:00') at time zone 'America/Sao_Paulo')) returning id`, [P.VEX, hire])).id
  const dualEmployee = (await one(`insert into public.employees(profile_id,status,hired_at) values ($1,'active', (($2::date + time '12:00') at time zone 'America/Sao_Paulo')) returning id`, [P.DUAL, hire])).id
  await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id,is_active) values ($1,$2,true),($3,$4,true),($5,$2,true),($5,$4,true)`, [techEmployee, sectors.technician, salesEmployee, sectors.external_sales, dualEmployee])
  const before = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet, (select count(*)::int from public.referral_share_links) links`)
  await t("NO_AUTO_LINKS", () => before.links === 0)

  const issuedInd = await rpc(P.IND, "issue_referral_share_link", { idempotencyKey: key(), mode: "issue", originKind: "indicator", attributionRole: "indicator" })
  const tokenInd = issuedInd.r?.token
  await t("INDICATOR_LINK", () => issuedInd.r?.tokenRevealed === true && issuedInd.r?.url?.startsWith("https://crm.tantotelecom.com.br/indicacao/") && !issuedInd.r.url.includes(P.IND))
  const indKey = key()
  const indSubmit = await pub("submit_referral_share", "$1,$2,$3::jsonb", [tokenInd, clientKey(), JSON.stringify(lead({ idempotencyKey: indKey, phone: "11911112011" }))])
  const indReplay = await pub("submit_referral_share", "$1,$2,$3::jsonb", [tokenInd, clientKey(), JSON.stringify(lead({ idempotencyKey: indKey, phone: "11911112011" }))])
  const indClash = await pub("submit_referral_share", "$1,$2,$3::jsonb", [tokenInd, clientKey(), JSON.stringify(lead({ idempotencyKey: indKey, phone: "11911112011", name: "Outro Nome" }))])
  const indRow = await one(`select r.origin_kind, r.reward_eligible, r.indicator_profile_id, (select count(*)::int from public.sales_opportunity_attributions a where a.opportunity_id=s.opportunity_id) employee_attr, (select count(*)::int from public.rewards rw where rw.referral_id=s.opportunity_id) rewards from public.referral_share_submissions s join public.referrals r on r.id=s.opportunity_id where s.public_protocol=$1`, [indSubmit.r?.protocol])
  await t("INDICATOR_ATTRIBUTION", () => indSubmit.r?.ok === true && indReplay.r?.idempotent === true && indClash.r?.code === "idempotency_conflict" && indRow.origin_kind === "indicator" && indRow.reward_eligible === true && indRow.indicator_profile_id === P.IND && indRow.employee_attr === 0 && indRow.rewards === 0)

  const issuedTech = await rpc(P.TEC, "issue_referral_share_link", { idempotencyKey: key(), mode: "issue", originKind: "employee", attributionRole: "technician_originator" })
  const techSubmit = await pub("submit_referral_share", "$1,$2,$3::jsonb", [issuedTech.r.token, clientKey(), JSON.stringify(lead({ phone: "11911112021" }))])
  const techRow = await one(`select r.origin_kind, r.reward_eligible, r.indicator_profile_id, a.attribution_role from public.referral_share_submissions s join public.referrals r on r.id=s.opportunity_id join public.sales_opportunity_attributions a on a.opportunity_id=r.id where s.public_protocol=$1`, [techSubmit.r?.protocol])
  await t("TECHNICIAN_LINK", () => techSubmit.r?.ok === true && techRow.origin_kind === "employee" && techRow.reward_eligible === false && techRow.indicator_profile_id == null && techRow.attribution_role === "technician_originator")

  const issuedSales = await rpc(P.VEX, "issue_referral_share_link", { idempotencyKey: key(), mode: "issue", originKind: "employee", attributionRole: "external_sales_originator" })
  const salesSubmit = await pub("submit_referral_share", "$1,$2,$3::jsonb", [issuedSales.r.token, clientKey(), JSON.stringify(lead({ phone: "11911112031" }))])
  const salesRow = await one(`select a.attribution_role, r.reward_eligible from public.referral_share_submissions s join public.referrals r on r.id=s.opportunity_id join public.sales_opportunity_attributions a on a.opportunity_id=r.id where s.public_protocol=$1`, [salesSubmit.r?.protocol])
  await t("EXTERNAL_SALES_LINK", () => salesSubmit.r?.ok === true && salesRow.attribution_role === "external_sales_originator" && salesRow.reward_eligible === false)

  const dualTech = await rpc(P.DUAL, "issue_referral_share_link", { idempotencyKey: key(), mode: "issue", originKind: "employee", attributionRole: "technician_originator" })
  const dualSales = await rpc(P.DUAL, "issue_referral_share_link", { idempotencyKey: key(), mode: "issue", originKind: "employee", attributionRole: "external_sales_originator" })
  const dualCount = await one(`select count(*)::int n from public.referral_share_links where originator_id=$1 and status='active'`, [dualEmployee])
  await t("DUAL_ROLE_LINKS", () => dualTech.r?.attributionRole === "technician_originator" && dualSales.r?.attributionRole === "external_sales_originator" && dualCount.n === 2 && dualTech.r.token !== dualSales.r.token)

  const cnpj = (await one(`select c from (values ('11222333000181'),('19131243000197')) v(c) where public.partner_cnpj_is_valid(c) limit 1`)).c
  const partner = await rpc(P.AM, "admin_save_partner_merchant", { idempotencyKey: key(), legalName: "Comercio Link Teste Ltda", tradeName: "Parceiro Link", cnpj, responsibleName: "Responsavel", phone: "1130001888", email: "parceiro.link@example.test", address: "Rua Teste", publicDisplayName: "Parceiro Teste", publishCnpj: false })
  await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partner.r.id, status: "active" })
  const partnerLink = await rpc(P.AM, "admin_issue_partner_link", { idempotencyKey: key(), partnerId: partner.r.id, mode: "issue" })
  const partnerHash = createHash("sha256").update(partnerLink.r.token).digest("hex")
  const mirrored = await one(`select count(*)::int n from public.referral_share_links where token_hash=$1 and origin_kind='partner_merchant' and attribution_role='partner_merchant_originator'`, [partnerHash])
  const partnerSubmit = await pub("submit_referral_share", "$1,$2,$3::jsonb", [partnerLink.r.token, clientKey(), JSON.stringify(lead({ phone: "11911112041" }))])
  const partnerRow = await one(`select r.origin_kind, r.reward_eligible, r.indicator_profile_id, a.partner_merchant_id, l.use_count from public.referral_share_submissions s join public.referrals r on r.id=s.opportunity_id join public.partner_merchant_attributions a on a.opportunity_id=r.id join public.referral_share_links l on l.id=s.link_id where s.public_protocol=$1`, [partnerSubmit.r?.protocol])
  await t("PARTNER_PRESERVED", () => mirrored.n === 1 && partnerLink.r.url.includes("/parceiro/") && partnerSubmit.r?.ok === true && partnerRow.origin_kind === "partner_merchant" && partnerRow.reward_eligible === false && partnerRow.indicator_profile_id == null && partnerRow.partner_merchant_id === partner.r.id && partnerRow.use_count === 1)

  const bad = await pub("referral_share_public_context", "$1,$2", ["A".repeat(43), clientKey()])
  const bad2 = await pub("referral_share_public_context", "$1,$2", ["B".repeat(43), clientKey()])
  await t("INVALID_TOKEN", () => bad.r?.code === "unavailable" && bad2.r?.code === "unavailable" && !JSON.stringify(bad.r).includes("Indicador") && JSON.stringify(bad.r) === JSON.stringify(bad2.r))
  const rotated = await rpc(P.IND, "issue_referral_share_link", { idempotencyKey: key(), mode: "rotate", originKind: "indicator", attributionRole: "indicator" })
  const oldCtx = await pub("referral_share_public_context", "$1,$2", [tokenInd, clientKey()])
  const newCtx = await pub("referral_share_public_context", "$1,$2", [rotated.r.token, clientKey()])
  await t("ROTATION", () => oldCtx.r?.code === "unavailable" && newCtx.r?.ok === true && String(newCtx.r.headline).startsWith("Indicação enviada por"))
  const revoked = await rpc(P.TEC, "revoke_referral_share_link", { idempotencyKey: key(), linkId: issuedTech.r.linkId, reason: "revogacao de teste" })
  const revokedCtx = await pub("referral_share_public_context", "$1,$2", [issuedTech.r.token, clientKey()])
  await t("REVOCATION", () => revoked.r?.ok === true && revokedCtx.r?.code === "unavailable")
  await c.query(`update public.employees set status='paused' where id=$1`, [salesEmployee])
  const pausedCtx = await pub("referral_share_public_context", "$1,$2", [issuedSales.r.token, clientKey()])
  await c.query(`update public.employees set status='active' where id=$1`, [salesEmployee])
  await t("INACTIVE_ORIGINATOR", () => pausedCtx.r?.code === "unavailable")
  const forged = await pub("submit_referral_share", "$1,$2,$3::jsonb", [rotated.r.token, clientKey(), JSON.stringify({ ...lead({ phone: "11911112051" }), origin_kind: "employee", reward_eligible: true, employee_id: techEmployee })])
  await t("FORGED_ORIGIN_REJECTED", () => forged.r?.code === "unknown_field")
  const first = await pub("submit_referral_share", "$1,$2,$3::jsonb", [dualTech.r.token, clientKey(), JSON.stringify(lead({ phone: "11911112061" }))])
  const second = await pub("submit_referral_share", "$1,$2,$3::jsonb", [dualSales.r.token, clientKey(), JSON.stringify(lead({ phone: "11911112061", idempotencyKey: key() }))])
  const kept = await one(`select a.attribution_role from public.referral_share_submissions s join public.sales_opportunity_attributions a on a.opportunity_id=s.opportunity_id where s.public_protocol=$1`, [first.r?.protocol])
  await t("FIRST_ORIGINATOR_KEPT", () => first.r?.ok === true && second.r?.code === "duplicate_open" && kept.attribution_role === "technician_originator")

  const racePhone = "11911112071"
  const race = async (token, payload) => {
    const client = new Client(conn)
    await client.connect()
    try {
      await client.query("begin")
      await client.query("set local role anon")
      const row = await client.query(`select public.submit_referral_share($1,$2,$3::jsonb) as r`, [token, clientKey(), JSON.stringify(payload)])
      await client.query("commit")
      return row.rows[0].r
    } catch (error) {
      await client.query("rollback").catch(() => {})
      return { ok: false, code: "error", msg: error.message }
    } finally {
      await client.end()
    }
  }
  const [raceA, raceB] = await Promise.all([
    race(dualTech.r.token, lead({ phone: racePhone, idempotencyKey: key(), name: "Lead Concorrente A" })),
    race(dualSales.r.token, lead({ phone: racePhone, idempotencyKey: key(), name: "Lead Concorrente B" })),
  ])
  const raceWins = [raceA, raceB].filter((row) => row?.ok === true)
  const raceKept = raceWins.length === 1
    ? await one(`select a.attribution_role, (select count(*)::int from public.referrals r where public.employee_opportunity_normalize_phone(r.referred_phone)=$1) n from public.referral_share_submissions s join public.sales_opportunity_attributions a on a.opportunity_id=s.opportunity_id where s.public_protocol=$2`, [racePhone, raceWins[0].protocol])
    : null
  await t("CONCURRENT_ONE_OPPORTUNITY", () => raceWins.length === 1 && [raceA, raceB].some((row) => row?.code === "duplicate_open") && raceKept?.n === 1 && ["technician_originator", "external_sales_originator"].includes(raceKept.attribution_role))

  const direct = await call("authenticated", P.AM, `1`)
  const denied = await c.query("begin").then(async () => {
    await c.query("set local role authenticated")
    const attempt = await c.query(`insert into public.referral_share_links(origin_kind,originator_id,attribution_role,token_hash,status,public_display_name) values ('indicator',$1,'indicator',$2,'active','X')`, [P.IND, "a".repeat(64)]).then(() => "inserted").catch((error) => error.message)
    await c.query("rollback")
    return attempt
  })
  await t("DIRECT_INSERT_BLOCKED", () => direct.ok === true && /permission denied|42501/i.test(denied))
  const after = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet, (select count(*)::int from public.employee_commission_entitlements) employee_entitlements, (select count(*)::int from public.partner_commission_entitlements) partner_entitlements`)
  await t("REWARD_AND_WALLET_UNCHANGED", () => after.rewards === before.rewards && after.wallet === before.wallet && after.employee_entitlements === 0 && after.partner_entitlements === 0)
} finally {
  console.log(res.map(([name, status]) => `${status.startsWith("PASS") ? "PASS" : "FAIL"} ${name}${status.startsWith("PASS") ? "" : " " + status}`).join("\n"))
  console.log(ok ? "J11_LAB_PASS" : "J11_LAB_FAIL")
  await stop().catch(() => {})
}
process.exit(ok ? 0 : 1)

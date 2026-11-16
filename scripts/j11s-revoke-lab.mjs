import { existsSync, mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import net from "node:net"

function freePort(start) {
  const blocked = new Set([55434, 55484, 55490, 55510])
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

const port = await freePort(Number(process.env.IGT_PG_LAB_PORT || 55530))
process.env.IGT_PG_LAB_PORT = String(port)
if (!process.env.IGT_PG_LAB_ROOT) process.env.IGT_PG_LAB_ROOT = join(process.env.LOCALAPPDATA, "igt-pg-j11s-lab")
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
  "supabase/patch-referral-share-links-3-1f-j11.sql",
  "supabase/patch-referral-share-revoke-admin-3-1f-j11s.sql",
]
const res = []
let ok = true
const lab = await startJ2Lab({ applyJ2: true })
const { c, conn, Client, applyFile, stop } = lab
const one = async (sql, p = []) => (await c.query(sql, p)).rows[0]
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
const id = (n) => `77777777-0000-4000-8000-${String(n).padStart(12, "0")}`
const P = { AM: id(1), FIN: id(2), CON: id(3), COM: id(4), IND: id(5), OTHER: id(6) }
let seq = 0
const key = () => `j11srevoke${String(++seq).padStart(6, "0")}zzzz`

try {
  await t("LAB_LOCAL_ONLY", () => conn.host === "127.0.0.1" && conn.port === port)
  for (const file of CHAIN) await applyFile(file)
  await t("REAPPLY", async () => { await applyFile(CHAIN.at(-1)); return true })
  await c.query(`insert into public.profiles(id,email,role,is_active,full_name) values
    ($1,'master.j11s@example.test','admin_master',true,'Admin Master'),
    ($2,'finance.j11s@example.test','admin_financeiro',true,'Admin Financeiro'),
    ($3,'consulta.j11s@example.test','admin_consulta',true,'Admin Consulta'),
    ($4,'comercial.j11s@example.test','comercial',true,'Comercial'),
    ($5,'indicador.j11s@example.test','indicador',true,'Indicador'),
    ($6,'outro.j11s@example.test','indicador',true,'Outro Indicador')
    on conflict (id) do nothing`, Object.values(P))
  const before = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet, (select count(*)::int from public.employee_commission_entitlements) employee_entitlements, (select count(*)::int from public.partner_commission_entitlements) partner_entitlements, (select count(*)::int from public.payroll_competences) competences`)
  const issued = await rpc(P.IND, "issue_referral_share_link", { idempotencyKey: key(), mode: "issue", originKind: "indicator", attributionRole: "indicator" })
  const linkId = issued.r?.linkId
  const financeList = await rpc(P.FIN, "admin_list_referral_share_links", { originKind: "indicator", originatorId: P.IND })
  const consultaList = await rpc(P.CON, "admin_list_referral_share_links", { originKind: "indicator", originatorId: P.IND })
  await t("BUTTON_FLAGS", () => issued.r?.ok === true && financeList.r?.canRevoke === true && consultaList.r?.canRevoke === false && consultaList.r?.links?.[0]?.status === "active")
  const consulta = await rpc(P.CON, "revoke_referral_share_link", { idempotencyKey: key(), linkId, reason: "consulta" })
  const commercial = await rpc(P.COM, "revoke_referral_share_link", { idempotencyKey: key(), linkId, reason: "comercial" })
  const other = await rpc(P.OTHER, "revoke_referral_share_link", { idempotencyKey: key(), linkId, reason: "outro" })
  await t("UNAUTHORIZED_BLOCKED", () => consulta.r?.code === "forbidden" && commercial.r?.code === "forbidden" && other.r?.code === "forbidden")
  const stillActive = await one(`select count(*)::int n from public.referral_share_links where status='active'`)
  await t("CANCEL_LEAVES_ACTIVE", () => stillActive.n === 1)
  const race = async (uid) => {
    const client = new Client(conn)
    await client.connect()
    try {
      await client.query("begin")
      await client.query("set local role authenticated")
      await client.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid])
      await client.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid })])
      const row = await client.query(`select public.revoke_referral_share_link($1::jsonb) as r`, [JSON.stringify({ idempotencyKey: key(), linkId, reason: "concorrencia" })])
      await client.query("commit")
      return row.rows[0].r
    } catch (error) {
      await client.query("rollback").catch(() => {})
      return { ok: false, msg: error.message }
    } finally {
      await client.end()
    }
  }
  const [a, b] = await Promise.all([race(P.FIN), race(P.AM)])
  const afterRace = await one(`select count(*)::int n, count(*) filter (where status='revoked')::int revoked, count(*) filter (where status='active')::int active, min(attribution_role) role, min(originator_id::text) originator from public.referral_share_links`)
  await t("CONCURRENT_ONE_REVOKE", () => a?.ok === true && b?.ok === true && afterRace.n === 1 && afterRace.revoked === 1 && afterRace.active === 0 && afterRace.role === "indicator" && afterRace.originator === P.IND)
  const again = await rpc(P.FIN, "revoke_referral_share_link", { idempotencyKey: key(), linkId, reason: "repetir" })
  const afterAgain = await one(`select count(*)::int n from public.referral_share_links`)
  await t("IDEMPOTENT_REPEAT", () => again.r?.ok === true && again.r?.idempotent === true && afterAgain.n === 1)
  const oldCtx = await call("anon", null, `public.referral_share_public_context($1,$2)`, [issued.r.token, "a".repeat(64)])
  await t("OLD_LINK_UNAVAILABLE", () => oldCtx.r?.code === "unavailable" && !JSON.stringify(oldCtx.r).includes("Indicador"))
  const replacement = await rpc(P.AM, "issue_referral_share_link", { idempotencyKey: key(), mode: "issue", originKind: "indicator", attributionRole: "indicator", originatorId: P.IND })
  const finalLinks = await one(`select count(*)::int n, count(*) filter (where status='active' and is_primary)::int active from public.referral_share_links`)
  await t("EXPLICIT_NEW_LINK", () => replacement.r?.tokenRevealed === true && replacement.r?.linkId !== linkId && finalLinks.n === 2 && finalLinks.active === 1)
  const after = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet, (select count(*)::int from public.employee_commission_entitlements) employee_entitlements, (select count(*)::int from public.partner_commission_entitlements) partner_entitlements, (select count(*)::int from public.payroll_competences) competences`)
  await t("FINANCIAL_UNCHANGED", () => after.rewards === before.rewards && after.wallet === before.wallet && after.employee_entitlements === before.employee_entitlements && after.partner_entitlements === before.partner_entitlements && after.competences === before.competences)
} finally {
  console.log(res.map(([name, status]) => `${status.startsWith("PASS") ? "PASS" : "FAIL"} ${name}${status.startsWith("PASS") ? "" : " " + status}`).join("\n"))
  console.log(ok ? "J11S_LAB_PASS" : "J11S_LAB_FAIL")
  await stop().catch(() => {})
}
process.exit(ok ? 0 : 1)

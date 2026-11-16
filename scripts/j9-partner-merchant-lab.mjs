// 3.1F-J9 — comércio parceiro. Lab PG local. Não usa produção, não chama ERP nem Sync.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createHash, randomBytes } from "node:crypto"

process.env.IGT_PG_LAB_PORT ||= "55479"

import { startJ2Lab } from "./j2-lab-chain.mjs"

const CHAIN = [
  "supabase/patch-employee-sales-opportunity-3-1f-j3.sql",
  "supabase/patch-employee-compensation-configuration-3-1f-j4.sql",
  "supabase/patch-employee-payroll-competence-3-1f-j5.sql",
  "supabase/patch-employee-commission-activation-3-1f-j6.sql",
  "supabase/patch-employee-fixed-commission-activation-3-1f-j7.sql",
]
const J9 = "supabase/patch-partner-merchant-referral-3-1f-j9.sql"
const PRE = "supabase/preflight-partner-merchant-referral-3-1f-j9.sql"
const VER = "supabase/verify-partner-merchant-referral-3-1f-j9.sql"

const res = []
let ok = true
const lab = await startJ2Lab({ applyJ2: true })
const { c, conn, Client, REPO_ROOT, applyFile, stop } = lab
const q = async (sql, p = []) => (await c.query(sql, p)).rows
const one = async (sql, p = []) => (await q(sql, p))[0]
const t = async (name, fn) => {
  try {
    const v = await fn()
    res.push([name, v === true ? "PASS" : "FAIL " + JSON.stringify(v).slice(0, 500)])
    if (v !== true) ok = false
  } catch (e) {
    await c.query("rollback").catch(() => {})
    res.push([name, "FAIL " + e.message])
    ok = false
  }
}
const call = async (role, uid, sql, p = []) => {
  await c.query("begin")
  try {
    await c.query(`set local role ${role}`)
    if (uid) await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid])
    if (uid) await c.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: uid })])
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
const id = (n) => `99999999-0000-4000-8000-${String(n).padStart(12, "0")}`
const P = { AM: id(1), AF: id(2), AC: id(3), CO: id(4), FU: id(5) }
let seq = 0
const key = () => `j9labkey${String(++seq).padStart(6, "0")}zzzz`
const clientKey = () => createHash("sha256").update(`lab-${seq}-${Math.random()}`).digest("hex")
const payload = (over = {}) => ({
  idempotencyKey: key(),
  planId: PLAN,
  name: "Cliente Laboratório",
  phone: "11988887777",
  document: "",
  zipcode: "01310100",
  street: "Avenida Paulista",
  number: "1000",
  complement: "",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  observation: "",
  consent: true,
  confirmRecentDuplicate: false,
  ...over,
})

let PLAN = null
let money0 = null

try {
  for (const f of CHAIN) await applyFile(f)
  const pre = Object.fromEntries((await c.query(readFileSync(join(REPO_ROOT, PRE), "utf8"))).rows.map((r) => [r.metric, r.value]))
  await t("PREFLIGHT_prereqs", () => pre.prereq_origin_kind === "true" && pre.prereq_invoice_pk === "true" && pre.prereq_phone_fn === "true" && pre.origin_values_known === "true")
  money0 = { rewards: pre.rewards, wallet: pre.wallet_transactions }
  await t("APPLY_first", async () => { await c.query(readFileSync(join(REPO_ROOT, J9), "utf8")); return true })
  await t("APPLY_reapply", async () => { await c.query(readFileSync(join(REPO_ROOT, J9), "utf8")); return true })
  for (const r of (await c.query(readFileSync(join(REPO_ROOT, VER), "utf8"))).rows) {
    await t(`VERIFY_${r.check_name}`, () => r.ok === true)
  }

  await c.query(`insert into public.profiles(id,email,role,is_active,full_name) values
    ($1,'am@j9.invalid','admin_master',true,'Admin Master'),
    ($2,'af@j9.invalid','admin_financeiro',true,'Admin Fin'),
    ($3,'ac@j9.invalid','admin_consulta',true,'Admin Consulta'),
    ($4,'co@j9.invalid','comercial',true,'Comercial'),
    ($5,'fu@j9.invalid','funcionario',true,'Funcionario')
    on conflict (id) do nothing`, Object.values(P))
  PLAN = (await one(`insert into public.plans(name,speed_label,price,reward_amount,is_active) values ('Plano J9','300 Mega',99.90,0,true) returning id`)).id
  const cnpj = (await one(`select c from (values ('11222333000181'),('19131243000197'),('04252011000110'),('00000000000191')) v(c) where public.partner_cnpj_is_valid(c) limit 1`))?.c
  await t("CNPJ_fixture", () => typeof cnpj === "string")

  const created = await rpc(P.AM, "admin_save_partner_merchant", {
    idempotencyKey: key(), legalName: "Padaria Laboratório Ltda", tradeName: "Padaria Lab",
    cnpj, responsibleName: "Responsável Lab", phone: "1133334444", email: "padaria@example.com",
    address: "Rua A, 10", publicDisplayName: "Padaria do Bairro", publishCnpj: false,
  })
  await t("CREATE_draft", () => created.r?.ok === true && created.r.status === "draft")
  const partnerA = created.r?.id
  const replay = await rpc(P.AM, "admin_save_partner_merchant", {
    idempotencyKey: created.r ? (await one(`select create_idempotency_key k from public.partner_merchants where id = $1`, [partnerA])).k : key(),
    legalName: "Padaria Laboratório Ltda", tradeName: "Padaria Lab", cnpj, responsibleName: "Responsável Lab",
    phone: "1133334444", email: "padaria@example.com", address: "Rua A, 10", publicDisplayName: "Padaria do Bairro", publishCnpj: false,
  })
  await t("CREATE_idempotent", () => replay.r?.idempotent === true && replay.r.id === partnerA)
  const finCreate = await rpc(P.AF, "admin_save_partner_merchant", {
    idempotencyKey: key(), legalName: "Outra", tradeName: "Outra", responsibleName: "R", phone: "11911112222",
    publicDisplayName: "Outra", publishCnpj: false,
  })
  await t("FINANCE_CANNOT_CREATE", () => finCreate.r?.code === "forbidden")
  const funcCreate = await rpc(P.FU, "admin_save_partner_merchant", {
    idempotencyKey: key(), legalName: "Outra", tradeName: "Outra", responsibleName: "R", phone: "11911112222",
    publicDisplayName: "Outra", publishCnpj: false,
  })
  await t("EMPLOYEE_CANNOT_CREATE", () => funcCreate.r?.code === "forbidden")
  const anonAdmin = await pub("admin_save_partner_merchant", "$1::jsonb", [JSON.stringify({ idempotencyKey: key() })])
  await t("ANON_CANNOT_ADMIN", () => anonAdmin.ok === false)

  const activated = await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partnerA, status: "active" })
  await t("ACTIVATE", () => activated.r?.ok === true && activated.r.status === "active")
  const pauseNoReason = await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partnerA, status: "paused", reason: "curto" })
  await t("PAUSE_REASON_REQUIRED", () => pauseNoReason.r?.code === "reason_required")

  const issued = await rpc(P.AM, "admin_issue_partner_link", { idempotencyKey: key(), partnerId: partnerA, mode: "issue", campaignCode: "vitrine" })
  await t("ISSUE_LINK", () => issued.r?.tokenRevealed === true && /^[A-Za-z0-9_-]{43}$/.test(issued.r.token) && issued.r.url === `https://crm.tantotelecom.com.br/parceiro/${issued.r.token}`)
  const tokenA = issued.r.token
  const hashA = createHash("sha256").update(tokenA).digest("hex")
  const stored = await one(`select token_hash, token_hash = $2 as match, (to_jsonb(l) ? 'token') as has_token from public.partner_merchant_links l where id = $1`, [issued.r.linkId, hashA])
  await t("TOKEN_HASH_ONLY", () => stored.match === true && stored.has_token === false && stored.token_hash === hashA)
  const issueReplay = await rpc(P.AM, "admin_issue_partner_link", { idempotencyKey: (await one(`select idempotency_key k from public.partner_merchant_links where id = $1`, [issued.r.linkId])).k, partnerId: partnerA, mode: "issue" })
  await t("LINK_REPLAY_HIDES_TOKEN", () => issueReplay.r?.tokenRevealed === false && issueReplay.r.token == null)

  const ck = clientKey()
  const ctx = await pub("partner_public_form_context", "$1,$2", [tokenA, ck])
  await t("PUBLIC_CONTEXT", () => (ctx.r?.ok === true && ctx.r.publicDisplayName === "Padaria do Bairro" && ctx.r.cnpj == null && !JSON.stringify(ctx.r).includes(partnerA)) || ctx)
  const badCtx = await pub("partner_public_form_context", "$1,$2", ["nao-e-um-token-valido-com-43-chars-xxxxxx", clientKey()])
  await t("INVALID_TOKEN_GENERIC", () => badCtx.r?.code === "unavailable" || badCtx)

  const phone1 = "11977776666"
  const sub = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenA, clientKey(), JSON.stringify(payload({ phone: phone1, idempotencyKey: key() }))])
  await t("SUBMIT", () => (sub.r?.ok === true && typeof sub.r.protocol === "string" && sub.r.protocol.length === 10 && sub.r.opportunityId == null) || sub)
  const protocol = sub.r.protocol
  const row = await one(`select origin_kind, reward_eligible, indicator_profile_id, reward_amount, source, status::text, pipeline_stage::text as stage from public.referrals where partner_public_protocol = $1`, [protocol])
  await t("ATTRIBUTION_ROW", () => row.origin_kind === "partner_merchant" && row.reward_eligible === false && row.indicator_profile_id == null && row.reward_amount == null && row.source === "partner_merchant_referral" && row.status === "pendente" && row.stage === "novo")
  const attr = await one(`select a.partner_merchant_id = $2 as partner, a.public_protocol = $3 as protocol from public.partner_merchant_attributions a join public.referrals r on r.id = a.opportunity_id where r.partner_public_protocol = $1`, [protocol, partnerA, protocol])
  await t("ATTRIBUTION_PARTNER", () => attr.partner === true && attr.protocol === true)
  const sameKey = payload({ phone: phone1 })
  const idemKey = key()
  const first = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenA, clientKey(), JSON.stringify({ ...sameKey, idempotencyKey: idemKey, phone: "11966665555" })])
  const again = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenA, clientKey(), JSON.stringify({ ...sameKey, idempotencyKey: idemKey, phone: "11966665555" })])
  const clash = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenA, clientKey(), JSON.stringify({ ...sameKey, idempotencyKey: idemKey, phone: "11966665555", name: "Outro Nome" })])
  await t("IDEMPOTENT_REPLAY", () => first.r?.ok === true && again.r?.idempotent === true && again.r.protocol === first.r.protocol)
  await t("IDEMPOTENCY_CONFLICT", () => clash.r?.code === "idempotency_conflict")
  const dup = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenA, clientKey(), JSON.stringify(payload({ phone: phone1, idempotencyKey: key(), name: "Segunda Tentativa" }))])
  await t("DUPLICATE_OPEN", () => dup.r?.code === "duplicate_open")

  const createdB = await rpc(P.AM, "admin_save_partner_merchant", {
    idempotencyKey: key(), legalName: "Mercado Laboratório Ltda", tradeName: "Mercado Lab",
    responsibleName: "Responsável B", phone: "1144445555", publicDisplayName: "Mercado da Esquina", publishCnpj: false,
  })
  const partnerB = createdB.r.id
  await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partnerB, status: "active" })
  const issuedB = await rpc(P.AM, "admin_issue_partner_link", { idempotencyKey: key(), partnerId: partnerB, mode: "issue" })
  const tokenB = issuedB.r.token
  const compete = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenB, clientKey(), JSON.stringify(payload({ phone: phone1, idempotencyKey: key(), name: "Pelo Mercado" }))])
  const still = await one(`select a.partner_merchant_id = $2 as original from public.partner_merchant_attributions a join public.referrals r on r.id = a.opportunity_id where r.partner_public_protocol = $1`, [protocol, partnerA])
  const attempts = await one(`select count(*)::int n from public.partner_merchant_competing_attempts where attempted_partner_merchant_id = $1`, [partnerB])
  await t("COMPETING_KEEPS_ORIGINAL", () => compete.r?.code === "duplicate_open" && still.original === true && attempts.n >= 1)

  const phoneRace = "11955554444"
  const bodyA = JSON.stringify(payload({ phone: phoneRace, idempotencyKey: key(), name: "Corrida A" }))
  const bodyB = JSON.stringify(payload({ phone: phoneRace, idempotencyKey: key(), name: "Corrida B" }))
  const ca = new Client(conn)
  const cb = new Client(conn)
  await ca.connect()
  await cb.connect()
  const race = async (client, token, body) => {
    await client.query("begin")
    await client.query("set local role anon")
    const r = await client.query(`select public.submit_partner_merchant_referral($1,$2,$3::jsonb) as r`, [token, clientKey(), body])
    await client.query("commit")
    return r.rows[0].r
  }
  const [ra, rb] = await Promise.all([race(ca, tokenA, bodyA), race(cb, tokenB, bodyB)])
  await ca.end()
  await cb.end()
  const winners = [ra, rb].filter((x) => x?.ok === true)
  const blocked = [ra, rb].filter((x) => x?.code === "duplicate_open")
  const raceRows = await one(`select count(*)::int n from public.referrals where public.employee_opportunity_normalize_phone(referred_phone) = '11955554444' and origin_kind = 'partner_merchant'`)
  await t("CONCURRENT_ONE_OPPORTUNITY", () => winners.length === 1 && blocked.length === 1 && raceRows.n === 1)

  const rotated = await rpc(P.AM, "admin_issue_partner_link", { idempotencyKey: key(), partnerId: partnerA, mode: "rotate" })
  const oldSubmit = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenA, clientKey(), JSON.stringify(payload({ phone: "11944443333", idempotencyKey: key() }))])
  const newSubmit = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [rotated.r.token, clientKey(), JSON.stringify(payload({ phone: "11944443333", idempotencyKey: key() }))])
  await t("ROTATION_KILLS_OLD", () => rotated.r?.tokenRevealed === true && rotated.r.token !== tokenA && oldSubmit.r?.code === "unavailable" && newSubmit.r?.ok === true)

  const paused = await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partnerB, status: "paused", reason: "Pausa operacional do laboratório." })
  const pausedSubmit = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenB, clientKey(), JSON.stringify(payload({ phone: "11933332222", idempotencyKey: key() }))])
  await t("PAUSED_UNAVAILABLE", () => paused.r?.status === "paused" && pausedSubmit.r?.code === "unavailable")
  const resumed = await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partnerB, status: "active", reason: "Reativação operacional do laboratório." })
  const resumedSubmit = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenB, clientKey(), JSON.stringify(payload({ phone: "11933332222", idempotencyKey: key() }))])
  await t("REACTIVATE_SAME_LINK", () => resumed.r?.status === "active" && resumedSubmit.r?.ok === true)

  const ended = await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partnerB, status: "terminated", reason: "Encerramento do laboratório sem histórico financeiro." })
  const endedSubmit = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [tokenB, clientKey(), JSON.stringify(payload({ phone: "11922221111", idempotencyKey: key() }))])
  const linksLeft = await one(`select count(*)::int n from public.partner_merchant_links where partner_merchant_id = $1 and status = 'active'`, [partnerB])
  await t("TERMINATED_REVOKES", () => ended.r?.status === "terminated" && endedSubmit.r?.code === "unavailable" && linksLeft.n === 0)
  const del = await c.query(`delete from public.partner_merchants where id = $1`, [partnerA]).then(() => "deleted").catch((e) => e.message)
  await t("NO_DELETE", () => /partner_merchant_delete_forbidden/.test(del))

  const fixed = await rpc(P.AF, "admin_save_partner_compensation_rule", { idempotencyKey: key(), partnerId: partnerA, kind: "fixed_amount", fixedAmountCents: 1250 })
  const previewFixed = await rpc(P.AF, "admin_preview_partner_fixed_activation", { partnerId: partnerA, opportunityId: (await one(`select id from public.referrals where partner_public_protocol = $1`, [protocol])).id })
  const pct = await rpc(P.AF, "admin_save_partner_compensation_rule", { idempotencyKey: key(), partnerId: partnerA, kind: "percentage", percentageBps: 800 })
  const inv = await rpc(P.AF, "admin_save_partner_compensation_rule", { idempotencyKey: key(), partnerId: partnerA, kind: "first_invoice_value" })
  const def = await rpc(P.AF, "admin_save_partner_compensation_rule", { idempotencyKey: key(), partnerId: partnerA, kind: "fixed_amount" })
  await t("FIXED_CONFIGURED", () => fixed.r?.status === "configured" && fixed.r.entitlementCreated === false && fixed.r.blockReason == null)
  await t("PERCENTAGE_GATED", () => pct.r?.status === "blocked" && pct.r.blockReason === "percentage_base_not_proven" && pct.r.entitlementCreated === false)
  await t("FIRST_INVOICE_GATED", () => inv.r?.status === "blocked" && inv.r.blockReason === "full_payment_unproven")
  await t("NO_DEFAULT_AMOUNT", () => def.r?.code === "amount_required")
  const consultaRule = await call("authenticated", P.AC, "public.admin_get_partner_merchant($1::uuid)", [partnerA])
  await t("CONSULTA_NO_RULE_AMOUNTS", () => consultaRule.r?.ok === true && consultaRule.r.rule == null && !JSON.stringify(consultaRule.r).includes("1250"))
  const finRead = await call("authenticated", P.AF, "public.admin_get_partner_merchant($1::uuid)", [partnerA])
  await t("FINANCE_SEES_AMOUNT", () => finRead.r?.rule?.fixedAmountCents === 1250 || finRead.r?.rule?.kind === "first_invoice_value")
  await t("PREVIEW_WITHHELD", () => previewFixed.r?.entitlementCreated === false && previewFixed.r?.supported === true && previewFixed.r?.evidence === false && previewFixed.r?.code === "invoice_generated_unproven")
  const ent = await c.query(`insert into public.partner_commission_entitlements(partner_merchant_id,opportunity_id,rule_id,trigger_kind,evidence_invoice_pk) values ($1,$2,$3,'invoice_generated','1')`, [partnerA, (await one(`select id from public.referrals where partner_public_protocol = $1`, [protocol])).id, fixed.r.ruleId]).then(() => "inserted").catch((e) => e.message)
  await t("ENTITLEMENT_WITHHELD", () => /partner_entitlements_withheld_this_release/.test(ent))
  const rewardTry = await c.query(`insert into public.rewards(referral_id,indicator_profile_id,reward_type,amount) select id, $2, 'fixo', 30 from public.referrals where partner_public_protocol = $1`, [protocol, P.AM]).then(() => "inserted").catch((e) => e.message)
  await t("REWARD_BLOCKED", () => /not_reward_eligible|origem comércio parceiro|null value|invalid input value/.test(rewardTry) && !rewardTry.includes("inserted"))

  const oppEarly = (await one(`select id from public.referrals where partner_public_protocol = $1`, [protocol])).id
  const listed = await call("authenticated", P.CO, "coalesce((select jsonb_agg(to_jsonb(x)) from public.list_partner_opportunity_origins($1::uuid[]) x), '[]'::jsonb)", [[oppEarly]])
  await t("PIPELINE_RPC_COMMERCIAL_SCOPE", () => Array.isArray(listed.r) && listed.r.length === 0)
  const listedAdmin = await call("authenticated", P.AM, "coalesce((select jsonb_agg(to_jsonb(x)) from public.list_partner_opportunity_origins($1::uuid[]) x), '[]'::jsonb)", [[oppEarly]])
  await t("PIPELINE_RPC_ADMIN", () => Array.isArray(listedAdmin.r) && listedAdmin.r[0]?.public_display_name === "Padaria do Bairro")

  const opp = (await one(`select id from public.referrals where partner_public_protocol = $1`, [protocol])).id
  const corrected = await rpc(P.AM, "admin_correct_partner_attribution", {
    idempotencyKey: key(), opportunityId: opp, newPartnerId: partnerB, reason: "Correção auditada de laboratório.",
  })
  const original = await one(`select partner_merchant_id = $2 as original from public.partner_merchant_attributions where opportunity_id = $1`, [opp, partnerA])
  const corr = await one(`select count(*)::int n from public.partner_merchant_attribution_corrections where opportunity_id = $1`, [opp])
  await t("CORRECTION_KEEPS_ORIGINAL_ROW", () => corrected.r?.code === "partner_not_active" || (corrected.r?.originalPreserved === true && original.original === true && corr.n === 1))

  const reactivatedB = await rpc(P.AM, "admin_set_partner_merchant_status", { idempotencyKey: key(), id: partnerB, status: "active", reason: "Reabre só para testar correção auditada." })
  const issuedB2 = await rpc(P.AM, "admin_issue_partner_link", { idempotencyKey: key(), partnerId: partnerB, mode: "issue" })
  const corrected2 = await rpc(P.AM, "admin_correct_partner_attribution", {
    idempotencyKey: key(), opportunityId: opp, newPartnerId: partnerB, reason: "Correção auditada com parceiro ativo.",
  })
  const original2 = await one(`select partner_merchant_id = $2 as original from public.partner_merchant_attributions where opportunity_id = $1`, [opp, partnerA])
  const shown = await call("authenticated", P.AM, "coalesce((select jsonb_agg(to_jsonb(x)) from public.list_partner_opportunity_origins($1::uuid[]) x), '[]'::jsonb)", [[opp]])
  await t("CORRECTION_AUDIT_NO_SILENT_SWAP", () => reactivatedB.r?.status === "active" && issuedB2.r?.ok === true && corrected2.r?.originalPreserved === true && original2.original === true && shown.r?.[0]?.public_display_name === "Mercado da Esquina")

  const money1 = await one(`select (select count(*)::text from public.rewards) rewards, (select count(*)::text from public.wallet_transactions) wallet, (select count(*)::text from public.partner_commission_entitlements) entitlements`)
  await t("MONEY_UNCHANGED", () => money1.rewards === money0.rewards && money1.wallet === money0.wallet && money1.entitlements === "0")

  const limitedKey = "a".repeat(64)
  let limited = null
  for (let i = 0; i < 25; i += 1) {
    limited = await pub("partner_public_form_context", "$1,$2", ["token-invalido-para-rate-limit-xxxxxxxxxx", limitedKey])
    if (limited.r?.code === "rate_limited") break
  }
  await t("RATE_LIMIT", () => limited.r?.code === "rate_limited")

  const tamper = await pub("submit_partner_merchant_referral", "$1,$2,$3::jsonb", [rotated.r.token, clientKey(), JSON.stringify({ ...payload({ phone: "11910101010" }), partnerId: partnerA, reward_eligible: true })])
  await t("PUBLIC_REJECTS_PARTNER_ID", () => tamper.r?.code === "unknown_field")
} finally {
  const out = res.map(([n, v]) => `${v.startsWith("PASS") ? "PASS" : "FAIL"} ${n}${v.startsWith("PASS") ? "" : " " + v}`).join("\n")
  writeFileSync(join(REPO_ROOT, "scripts", "j9-partner-merchant-lab.last.txt"), out + `\nRESULT ${ok ? "PASS" : "FAIL"}\n`)
  console.log(out)
  console.log(ok ? "J9_LAB_PASS" : "J9_LAB_FAIL")
  await stop().catch(() => {})
  process.exit(ok ? 0 : 1)
}

// 3.1F-J2 — cadeia de SQL versionado num PostgreSQL local descartável (127.0.0.1 only).
// Não usa DATABASE_URL, não conecta em produção, não chama ERP.
// Lab isolado: IGT_PG_LAB_ROOT (default %LOCALAPPDATA%/igt-pg-j2-lab), porta própria
// IGT_PG_LAB_PORT (default 55474). O harness compartilhado é copiado sem alteração no repo.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

export const J2_PATCH = "supabase/patch-employee-read-rpcs-3-1f-j2.sql"
export const J2_PREFLIGHT = "supabase/preflight-employee-read-rpcs-3-1f-j2.sql"
export const J2_VERIFY = "supabase/verify-employee-read-rpcs-3-1f-j2.sql"
export const J2_ROLLBACK = "supabase/rollback-employee-read-rpcs-3-1f-j2.sql"
const PRE = [
  "supabase/sla-redistribution.sql",
  "supabase/patch-commercial-pipeline.sql",
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
const I1 = "supabase/patch-employee-commission-payroll-ledger-foundation-3-1f-i1.sql"

export async function startJ2Lab({ applyJ2 = true } = {}) {
  const LAB_ROOT = (process.env.IGT_PG_LAB_ROOT ||= join(process.env.LOCALAPPDATA || homedir(), "igt-pg-j2-lab"))
  const LAB_PORT = Number(process.env.IGT_PG_LAB_PORT || 55474)
  if (!Number.isInteger(LAB_PORT) || LAB_PORT === 55434) throw new Error("J2 lab must not use port 55434")
  let runSrc = readFileSync(join(HERE, "local-pg-collections-lab/run.mjs"), "utf8")
  const portLine = "const PORT = 55434"
  const hereLine = "const here = dirname(fileURLToPath(import.meta.url))"
  const flagsLine = 'postgresFlags: ["-c", "listen_addresses=127.0.0.1"]'
  if (!runSrc.includes(portLine) || !runSrc.includes(hereLine) || !runSrc.includes(flagsLine)) throw new Error("lab harness shape changed")
  runSrc = runSrc
    .replace(flagsLine, 'postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "io_method=sync"]')
    .replace(portLine, `const PORT = ${LAB_PORT}`)
    .replace(hereLine, `const here = ${JSON.stringify(join(HERE, "local-pg-collections-lab"))}`)
  mkdirSync(LAB_ROOT, { recursive: true })
  const runCopy = join(LAB_ROOT, "run-j2.mjs")
  writeFileSync(runCopy, runSrc)
  const { startCollectionsLab, stopCollectionsLab, REPO_ROOT } = await import(pathToFileURL(runCopy).href)
  const { client: c, conn, Client } = await startCollectionsLab()
  const applyFile = async (f) => {
    try { await c.query(readFileSync(join(REPO_ROOT, f), "utf8")) } catch (e) { await c.query("rollback").catch(() => {}); throw new Error(`apply ${f}: ${e.message}`) }
  }
  for (const f of PRE) await applyFile(f)
  // Supabase-like: privilégios amplos de tabela para clientes (as RLS/grants dos patches restringem).
  await c.query("grant all on all tables in schema public to anon, authenticated; grant all on all functions in schema public to anon, authenticated, public")
  await new Promise((r) => setTimeout(r, 1100))
  const h1bStartedAt = new Date().toISOString()
  await applyFile(H1)
  await c.query(`select set_config('igt.h1b_expand_started_at',$1,false)`, [h1bStartedAt])
  await applyFile(H1B)
  // Supabase default privileges: funções/tabelas novas seriam concedidas a clientes se não revogadas.
  await c.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant execute on functions to anon, authenticated, service_role")
  await applyFile(I1)
  if (applyJ2) await applyFile(J2_PATCH)
  return { c, conn, Client, REPO_ROOT, applyFile, stop: stopCollectionsLab }
}

// Invariante de escrita zero (P): contagens + hashes de tabelas sensíveis.
export async function zeroWriteSnapshot(c) {
  const one = async (sql) => (await c.query(sql)).rows[0]
  const h = (t, order = "id") => `(select md5(coalesce(string_agg(x::text, '|' order by x.${order}), '')) from public.${t} x)`
  return one(`select
    (select count(*)::int from public.employee_commission_rules) commission_rules,
    (select count(*)::int from public.sales_opportunity_attributions) attributions,
    (select count(*)::int from public.employee_commission_entitlements) entitlements,
    (select count(*)::int from public.employee_compensation_profiles) compensation_profiles,
    (select count(*)::int from public.employee_worked_days) worked_days,
    (select count(*)::int from public.payroll_competences) competences,
    (select count(*)::int from public.payroll_competence_lines) payroll_lines,
    (select count(*)::int from public.finance_audit_events) finance_audit_events,
    ${h("referrals")} referrals_hash,
    ${h("rewards")} rewards_hash,
    ${h("wallet_transactions")} wallet_hash,
    ${h("collection_cases")} collections_hash,
    ${h("profiles")} profiles_hash,
    ${h("employees")} employees_hash`)
}

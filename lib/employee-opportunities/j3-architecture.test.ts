import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const MIGRATION = read("supabase/patch-employee-sales-opportunity-3-1f-j3.sql")
const SQL = MIGRATION.replace(/--[^\n]*/g, "")
const J3_FILES = [
  "lib/employee-opportunities/contract.ts",
  "lib/employee-opportunities/handlers.ts",
  "lib/employee-opportunities/service.ts",
  "app/api/employee/opportunities/route.ts",
  "app/funcionario/nova-oportunidade/page.tsx",
  "components/employee-opportunities/opportunity-form.tsx",
]

describe("3.1F-J3 arquitetura: rota e identidade", () => {
  it("rota exporta somente POST, dinâmica, no-store, sem RPC/tabela direta", () => {
    const src = strip(read("app/api/employee/opportunities/route.ts"))
    assert.match(src, /export async function POST\(/)
    assert.equal(/export (async )?function (GET|PUT|PATCH|DELETE)\b/.test(src), false)
    assert.match(src, /dynamic = "force-dynamic"/)
    assert.match(src, /employeeJson\(/)
    assert.match(src, /runSubmitOpportunity\(await createEmployeeSessionClient\(\), request\)/)
    assert.equal(/\.rpc\(|\.from\(/.test(src), false)
  })
  it("nenhum arquivo J3 usa service role, insert direto, rewards/wallet/saque, ERP ou Sync", () => {
    for (const f of J3_FILES) {
      const src = strip(read(f))
      assert.equal(/createServiceRoleClient|getOpsDb|getPrivileged|SUPABASE_SERVICE_ROLE_KEY|service_role/.test(src), false, f)
      assert.equal(/\.from\(|\.(insert|upsert|update|delete)\(/.test(src), false, f)
      assert.equal(/rewards|wallet|withdraw|pix_|saque|brbyte|controllr|runSync|collections\/sync/i.test(src), false, f)
    }
  })
  it("handler: exatamente as 2 RPCs J3 e gate antes do corpo e da RPC", () => {
    const src = strip(read("lib/employee-opportunities/handlers.ts"))
    assert.deepEqual([...src.matchAll(/RPC = "([a-z_]+)"/g)].map((m) => m[1]).sort(), ["employee_opportunity_form_context", "submit_employee_sales_opportunity"])
    const run = src.slice(src.indexOf("export async function runSubmitOpportunity"))
    assert.ok(run.indexOf("gateEmployeeSession(") < run.indexOf("req.text()"))
    assert.ok(run.indexOf("req.text()") < run.indexOf("parseOpportunityPayload("))
    assert.ok(run.indexOf("parseOpportunityPayload(") < run.indexOf(".rpc("))
    assert.equal(/employee_id|profile_id|p_employee|p_profile/.test(src), false)
  })
  it("formulário: sem localStorage/sessionStorage, trava de duplo clique, chave por abertura", () => {
    const src = strip(read("components/employee-opportunities/opportunity-form.tsx"))
    assert.equal(/localStorage|sessionStorage|document\.cookie|indexedDB/.test(src), false)
    assert.match(src, /if \(submittingRef\.current\) return/)
    assert.match(src, /disabled=\{submitting/)
    assert.match(src, /keyRef\.current = newIdempotencyKey\(\)/)
    assert.match(src, /confirmRecentDuplicate = true/)
    assert.equal(/console\./.test(src), false)
  })
  it("painel: atalho real (sem 'em breve') e sem percentuais inventados", () => {
    const src = read("components/employee-portal/employee-dashboard-section.tsx")
    assert.equal(/em breve/i.test(src), false)
    assert.match(src, /\/funcionario\/nova-oportunidade/)
    assert.equal(/%|vs\.? mês|trend/i.test(src), false)
  })
  it("pipeline admin: origem via RPC autorizada, sem novo select em employees/profiles de funcionário", () => {
    const src = strip(read("lib/services/pipeline.service.ts"))
    assert.match(src, /rpc\("list_employee_opportunity_origins"/)
    assert.match(src, /origin_kind/)
    assert.equal(/from\("employees"\)|from\("sales_opportunity_attributions"\)/.test(src), false)
    assert.match(read("components/pipeline/pipeline-kanban-board.tsx"), /card\.originLabel/)
  })
})

describe("3.1F-J3 migration: aditiva, fechada, sem recompensa", () => {
  it("transacional com timeouts e pré-requisitos", () => {
    assert.match(MIGRATION, /^begin;/m)
    assert.match(MIGRATION, /^commit;\s*$/m)
    assert.match(MIGRATION, /set local lock_timeout/)
    assert.match(MIGRATION, /j3_prerequisite_missing/)
  })
  it("sem DDL de tabela/política/trigger/tipo, sem backfill, sem DROP", () => {
    assert.equal(/\b(alter|drop)\s+(table|policy|trigger|type|function|index)\b|\bcreate\s+(table|policy|trigger|type)\b|\bupdate\s+public\.|\bdelete\s+from\b|\btruncate\b/i.test(SQL), false)
  })
  it("todas as SECURITY DEFINER com search_path = public, pg_temp", () => {
    const defs = SQL.split(/create or replace function/i).slice(1)
    for (const d of defs.filter((x) => /security definer/i.test(x.slice(0, 600)))) assert.match(d.slice(0, 600), /set search_path = public, pg_temp/)
  })
  it("grants mínimos: RPCs só para authenticated; nada para anon/service_role/public (exceto normalizador imutável)", () => {
    for (const fn of ["employee_opportunity_form_context", "submit_employee_sales_opportunity", "list_employee_sales_filtered", "list_employee_opportunity_origins"]) {
      assert.match(SQL, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn)
      assert.match(SQL, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`), fn)
    }
    assert.match(SQL, /revoke all on function public\.employee_opportunity_eligible_roles\(uuid\) from public, anon, authenticated, service_role;/)
    assert.equal(/grant execute on function public\.employee_opportunity_eligible_roles/.test(SQL), false)
    assert.equal(/grant execute[^;]*to (anon|service_role)/i.test(SQL), false)
    assert.match(SQL, /revoke all on function public\.create_employee_sales_opportunity\(text, text, uuid, uuid, text, text, text, text\) from public, anon, authenticated, service_role;/)
  })
  it("submit força origem funcionário sem recompensa e nunca toca tabelas financeiras", () => {
    const sub = SQL.slice(SQL.indexOf("function public.submit_employee_sales_opportunity"), SQL.indexOf("function public.list_employee_sales_filtered"))
    assert.match(sub, /'employee'/)
    assert.match(sub, /reward_eligible[\s\S]{0,400}false/)
    assert.match(sub, /auth\.uid\(\)/)
    assert.equal(/insert into public\.(rewards|wallet_transactions|payments|employee_commission|payroll|finance_audit_events)/i.test(sub), false)
    assert.equal(/\bexecute\b\s+(format|'|\$|v_)/i.test(sub), false)
    assert.equal(/p_employee_id|p_profile_id|p_commission|p_reward/i.test(sub), false)
  })
  it("sem defaults R$30/R$50/2%/R$22 nem regra ativa", () => {
    assert.equal(/R\$\s?(30|50|22)\b|0\.02\b|insert into public\.employee_commission_rules/i.test(SQL), false)
  })
})

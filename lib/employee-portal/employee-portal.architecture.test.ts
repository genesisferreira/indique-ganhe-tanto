import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), "utf8")
const walk = (rel: string): string[] => {
  const abs = join(root, rel)
  if (!existsSync(abs)) return []
  if (statSync(abs).isFile()) return [rel.replace(/\\/g, "/")]
  return readdirSync(abs).flatMap((f) => walk(`${rel}/${f}`))
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const API_ROUTES = [
  "app/api/employee/dashboard/route.ts",
  "app/api/employee/sales/route.ts",
  "app/api/employee/sales/[id]/route.ts",
  "app/api/employee/compensation/route.ts",
  "app/api/employee/compensation/[competence]/route.ts",
  "app/api/admin/remuneracao/route.ts",
]
const EMPLOYEE_PAGES = [
  "app/funcionario/page.tsx",
  "app/funcionario/vendas/page.tsx",
  "app/funcionario/vendas/[id]/page.tsx",
  "app/funcionario/remuneracao/page.tsx",
  "app/funcionario/remuneracao/[competencia]/page.tsx",
]
const NEW_FILES = [
  ...walk("lib/employee-portal"),
  ...walk("lib/admin-remuneracao"),
  ...walk("components/employee-portal"),
  ...walk("components/admin-remuneracao"),
  ...walk("app/api/employee"),
  ...walk("app/api/admin/remuneracao"),
  ...walk("app/funcionario/vendas"),
  ...walk("app/funcionario/remuneracao"),
  ...walk("app/admin/remuneracao"),
].filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"))
const ADMIN_SHELL_FILES = [...walk("app/admin/remuneracao"), "components/admin-remuneracao/remuneracao-shell.tsx"]
const MIGRATION = read("supabase/patch-employee-read-rpcs-3-1f-j2.sql")

describe("3.1F-J2 arquitetura: APIs somente GET (F)", () => {
  for (const f of API_ROUTES) {
    it(`${f} exporta somente GET`, () => {
      const src = read(f)
      assert.match(src, /export async function GET\(/)
      assert.equal(/export (async )?function (POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(src), false)
      assert.equal(/export const (POST|PUT|PATCH|DELETE)\b/.test(src), false)
      assert.match(src, /dynamic = "force-dynamic"/)
    })
  }
  it("respostas financeiras com no-store (helper) ", () => {
    assert.match(read("lib/employee-portal/http.ts"), /applyNoStoreHeaders/)
    for (const f of API_ROUTES.slice(0, 5)) assert.match(read(f), /employeeOutcome|employeeJson|employeeError|employeeBadRequest/)
    assert.match(read("app/api/admin/remuneracao/route.ts"), /applyNoStoreHeaders/)
  })
})

describe("3.1F-J2 arquitetura: identidade e privilégios (E/F/Q)", () => {
  it("nenhum arquivo novo usa service role / getOpsDb / getPrivileged", () => {
    for (const f of NEW_FILES) {
      const src = strip(read(f))
      assert.equal(/createServiceRoleClient|getOpsDb|getPrivileged|SUPABASE_SERVICE_ROLE_KEY|service-role/.test(src), false, f)
    }
  })
  it("serviço usa somente a sessão (createClient) e somente as 5 RPCs de leitura", () => {
    const src = strip(read("lib/employee-portal/service.ts"))
    assert.match(src, /from "@\/lib\/supabase\/server"/)
    assert.equal(/\.from\(/.test(src), false)
    const rpcs = [...src.matchAll(/sessionRpc\("([a-z_]+)"/g)].map((m) => m[1]).sort()
    assert.deepEqual(rpcs, ["employee_compensation_summary", "employee_sales_dashboard_summary", "get_employee_sale_detail", "list_employee_competence_lines", "list_employee_sales"])
  })
  it("nenhum employee_id/profile_id enviado às RPCs", () => {
    const src = strip(read("lib/employee-portal/service.ts"))
    assert.equal(/p_employee_id|p_profile_id|employee_id|profile_id/.test(src), false)
  })
  it("sem escrita, rewards, wallet, saques, ERP ou Sync nos arquivos novos", () => {
    for (const f of NEW_FILES.filter((x) => !x.endsWith("terminology.ts") && !x.endsWith("admin-remuneracao/guard.ts") && !x.endsWith("employee-portal/api-gate.ts"))) {
      const src = strip(read(f))
      assert.equal(/supabase[\s\S]{0,40}\.from\(|\.from\("[a-z_]+"\)|\.(insert|upsert)\(/.test(src), false, f)
      if (!f.endsWith("service.ts") && !f.endsWith("guard.ts") && !f.endsWith("api-gate.ts")) assert.equal(/\.rpc\(/.test(src), false, f)
      assert.equal(/rewards|wallet|withdraw|pix_|saque|brbyte|controllr|collections\/sync|runSync|probe/i.test(src.replace(/Chave Pix|"Sacar"/g, "")), false, f)
    }
  })
  it("guard admin: somente SELECT do próprio perfil (sessão do usuário)", () => {
    const src = strip(read("lib/admin-remuneracao/guard.ts"))
    assert.deepEqual([...src.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]), ["profiles"])
    assert.match(src, /\.select\("role, is_active"\)/)
    assert.equal(/\.(insert|update|upsert|delete)\(|\.rpc\(/.test(src), false)
  })
  it("3.1F-J2B: gate das APIs lê somente o próprio profiles/employees (SELECT) e as 5 RPCs de leitura", () => {
    const src = strip(read("lib/employee-portal/api-gate.ts"))
    assert.deepEqual([...src.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]), ["profiles", "employees"])
    assert.equal(/\.(insert|update|upsert|delete)\(|createServiceRoleClient|getOpsDb|service_role/.test(src), false)
    const rpcs = [...src.matchAll(/rpc: "([a-z_]+)"/g)].map((m) => m[1]).sort()
    assert.deepEqual(rpcs, ["employee_compensation_summary", "employee_sales_dashboard_summary", "get_employee_sale_detail", "list_employee_competence_lines", "list_employee_sales"])
    const run = src.slice(src.indexOf("export async function runEmployeeGet"))
    assert.ok(run.indexOf("gateEmployeeSession(") < run.indexOf("spec.parse(") && run.indexOf("spec.parse(") < run.indexOf(".rpc("))
  })
  it("3.1F-J2B: rotas GET não validam path/query antes do gate", () => {
    for (const f of API_ROUTES.slice(0, 5)) {
      const src = strip(read(f))
      assert.match(src, /runEmployeeGet\(await createEmployeeSessionClient\(\), EMPLOYEE_API\.[a-zA-Z]+/)
      assert.equal(/parse[A-Z]\w*\(|rejectIdentityParams|employeeBadRequest|\.rpc\(/.test(src), false, f)
    }
  })
  it("rotas novas não importam código de ERP/rewards", () => {
    for (const f of [...API_ROUTES, ...EMPLOYEE_PAGES.slice(1)]) {
      assert.equal(/@\/lib\/(brbyte|collections|finance|services\/supabase-data)/.test(read(f)), false, f)
    }
  })
})

describe("3.1F-J2 arquitetura: admin shells sem ação (G/H)", () => {
  it("sem formulário, botão de ação ou RPC financeira", () => {
    for (const f of ADMIN_SHELL_FILES) {
      const src = strip(read(f))
      assert.equal(/<form|<button|<Button|onClick|Salvar|Ativar|Calcular|Fechar|Pagar|\.rpc\(|\.from\(/.test(src), false, f)
    }
  })
  it("guard server-side no layout E em cada página (via RemuneracaoShell)", () => {
    assert.match(read("app/admin/remuneracao/layout.tsx"), /requireAdminRemuneracaoPage\(\)/)
    for (const f of walk("app/admin/remuneracao").filter((x) => x.endsWith("page.tsx"))) assert.match(read(f), /RemuneracaoShell/, f)
    assert.match(read("components/admin-remuneracao/remuneracao-shell.tsx"), /await requireAdminRemuneracaoPage\(\)/)
    assert.match(read("app/api/admin/remuneracao/route.ts"), /authorizeAdminRemuneracao\(\)/)
    assert.match(read("lib/admin-remuneracao/guard.ts"), /canAccessAdminRemuneracao/)
  })
  it("middleware de rotas restringe /admin/remuneracao antes do /admin genérico", () => {
    const src = read("lib/auth/auth-audit.ts")
    assert.ok(src.indexOf("ADMIN_REMUNERACAO_PREFIX") < src.indexOf('pathname.startsWith("/admin")'))
  })
})

describe("3.1F-J2 terminologia isolada (D/J)", () => {
  const FORBIDDEN = /Saldo dispon[ií]vel|Solicitar saque|Sacar|Carteira|Chave Pix|Dispon[ií]vel para saque/
  it("telas/componentes do funcionário não usam termos de recompensa", () => {
    for (const f of NEW_FILES.filter((x) => !x.endsWith("terminology.ts"))) assert.equal(FORBIDDEN.test(read(f)), false, f)
  })
  it("não reutiliza o StatusBadge global no contexto de funcionário", () => {
    for (const f of NEW_FILES) assert.equal(/components\/ui\/status-badge/.test(strip(read(f))), false, f)
  })
  it("StatusBadge global do Indique e Ganhe permanece inalterado", () => {
    const src = read("components/ui/status-badge.tsx")
    assert.match(src, /label: "Paga"/)
    assert.match(src, /disponivel:/)
  })
  it("mapa contextual aprovado", async () => {
    const t = await import("@/lib/employee-portal/terminology")
    assert.equal(t.ENTITLEMENT_STATUS_LABEL.approved, "Revisada")
    assert.equal(t.ENTITLEMENT_STATUS_LABEL.included_in_payroll, "Incluída na competência")
    assert.equal(t.ENTITLEMENT_STATUS_LABEL.paid, "Pagamento registrado")
    assert.equal(t.ENTITLEMENT_STATUS_LABEL.accrued, "Em apuração")
    for (const v of Object.values(t.ENTITLEMENT_STATUS_LABEL)) assert.equal(FORBIDDEN.test(v) || /^Paga$|Dispon/.test(v), false)
  })
  it("sem defaults R$30/R$50/2%/R$22 nem dados de demonstração nas telas", () => {
    for (const f of NEW_FILES) {
      const src = read(f)
      assert.equal(/R\$\s?(30|50|22)\b|\b2\s?%|DADOS SINT|WIREFRAME|mock-data|MOCK_/.test(src), false, f)
    }
  })
  it("nova oportunidade não funcional: rota inexistente ou sem formulário", () => {
    const p = "app/funcionario/nova-oportunidade/page.tsx"
    assert.ok(!existsSync(join(root, p)) || !/<form|method=|onSubmit/.test(read(p)))
  })
  it("único formulário do funcionário é de CONSULTA (GET) sem POST", () => {
    const src = read("components/employee-portal/sales-filters.tsx")
    assert.match(src, /method="get"/)
    assert.equal(/method="post"|onSubmit|action=\{/i.test(src), false)
    for (const f of NEW_FILES.filter((x) => x !== "components/employee-portal/sales-filters.tsx")) assert.equal(/<form/.test(read(f)), false, f)
  })
})

describe("3.1F-J2 migration somente leitura (E/L)", () => {
  it("transacional, search_path fixo, sem DDL de objetos existentes", () => {
    assert.match(MIGRATION, /^begin;/m)
    assert.match(MIGRATION, /^commit;/m)
    assert.equal((MIGRATION.match(/security definer/g) ?? []).length, 8)
    assert.equal((MIGRATION.match(/set search_path = public, pg_temp/g) ?? []).length, 9)
    const code = MIGRATION.replace(/--[^\n]*/g, "")
    assert.equal(/\b(create|alter|drop)\s+(table|policy|trigger|index|type|view)\b/i.test(code), false)
    assert.equal(/\binsert\s+into|\bupdate\s+public\.|\bdelete\s+from|\btruncate\b/i.test(code), false)
    assert.equal(/format\s*\(|execute\s+(format|'|\$|v_)/i.test(code), false)
  })
  it("RPCs sem parâmetro de identidade e grants somente authenticated", () => {
    const code = MIGRATION.replace(/--[^\n]*/g, "")
    for (const m of code.matchAll(/create or replace function public\.([a-z_]+)\(([^)]*)\)/g)) {
      assert.equal(/employee_id|profile_id|user_id/.test(m[2]), false, m[1])
    }
    for (const fn of ["employee_sales_dashboard_summary", "list_employee_sales", "get_employee_sale_detail", "employee_compensation_summary", "list_employee_competence_lines"]) {
      assert.match(code, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`))
      assert.match(code, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`))
    }
    assert.equal(/grant execute[^;]*to (anon|service_role|public)/i.test(code), false)
  })
  it("rollback remove somente as funções novas", () => {
    const rb = read("supabase/rollback-employee-read-rpcs-3-1f-j2.sql").replace(/--[^\n]*/g, "")
    const drops = [...rb.matchAll(/drop function if exists public\.([a-z_]+)\(/g)].map((m) => m[1])
    assert.equal(drops.length, 9)
    assert.equal(/drop\s+(table|policy|trigger|type)|delete|truncate|update/i.test(rb), false)
  })
})

describe("3.1F-J2 wireframes fora do build", () => {
  it("nenhum arquivo de app importa docs/wireframes", () => {
    for (const f of NEW_FILES) assert.equal(/docs\/employee-sales-payroll|wireframes/.test(read(f)), false, f)
  })
})

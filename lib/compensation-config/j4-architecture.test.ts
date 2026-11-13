import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const root = process.cwd()
const read = (rel: string) => readFileSync(join(root, rel), "utf8")
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const SQL = read("supabase/patch-employee-compensation-configuration-3-1f-j4.sql")
const CODE = SQL.replace(/--[^\n]*/g, "")
const ROUTES = [
  ["app/api/admin/remuneracao/regras/route.ts", "rule_save"],
  ["app/api/admin/remuneracao/regras/arquivar/route.ts", "rule_archive"],
  ["app/api/admin/remuneracao/funcionarios/route.ts", "profile_save"],
  ["app/api/admin/remuneracao/funcionarios/arquivar/route.ts", "profile_archive"],
] as const
const J4_FILES = [
  "lib/compensation-config/contract.ts", "lib/compensation-config/handlers.ts", "lib/compensation-config/service.ts", "lib/compensation-config/client.ts",
  "components/compensation-config/ui.tsx", "components/compensation-config/rules-configurator.tsx", "components/compensation-config/employee-compensation-configurator.tsx",
  "app/admin/remuneracao/regras/page.tsx", "app/admin/remuneracao/funcionarios/page.tsx", "app/funcionario/remuneracao/page.tsx",
  ...ROUTES.map(([f]) => f),
]
const WRITE_RPCS = ["admin_save_commission_rule_draft", "admin_archive_commission_rule_draft", "admin_save_employee_compensation_draft", "admin_archive_employee_compensation_draft"]
const READ_RPCS = ["admin_list_commission_rules", "admin_list_compensation_employees", "admin_get_employee_compensation", "employee_compensation_preview"]

describe("3.1F-J4 migração", () => {
  it("transacional, aditiva, sem DROP de tabela/coluna/função/policy, sem backfill", () => {
    assert.match(SQL, /^begin;/m)
    assert.match(SQL, /^commit;\s*$/m)
    assert.equal(/\bdrop\s+(table|column|function|policy|type|index)\b|\bdelete\s+from\b|\btruncate\b|\bcreate\s+(table|policy)\b/i.test(CODE), false)
    assert.equal(/alter\s+table[^;]*(drop\s+column|alter\s+column|disable\s+row|no\s+force)/i.test(CODE), false)
  })
  it("RPCs novas: SECURITY DEFINER, search_path fixo, contrato jsonb, grants somente authenticated", () => {
    for (const fn of [...WRITE_RPCS, ...READ_RPCS]) {
      const i = CODE.indexOf(`function public.${fn}(`)
      assert.ok(i > 0, fn)
      const body = CODE.slice(i, CODE.indexOf("$$;", CODE.indexOf("as $$", i)))
      assert.match(body, /security definer/, fn)
      assert.match(body, /set search_path = public, pg_temp/, fn)
      assert.match(CODE, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn)
      assert.match(CODE, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`), fn)
    }
    for (const fn of WRITE_RPCS) assert.match(CODE, new RegExp(`function public\\.${fn}\\(p_payload jsonb\\)`), fn)
    assert.equal(/grant execute[^;]*to (anon|service_role|public)\b/i.test(CODE.replace(/grant execute on function public\.employee_opportunity_normalize_phone[^;]*;/, "")), false)
  })
  it("escritas exigem admin_master/admin_financeiro (finance_admin_actor_role) e motivo; chaves desconhecidas rejeitadas", () => {
    for (const fn of WRITE_RPCS) {
      const i = CODE.indexOf(`function public.${fn}(`)
      const body = CODE.slice(i, CODE.indexOf("$$;", CODE.indexOf("as $$", i)))
      assert.match(body, /v_role text := public\.finance_admin_actor_role\(\)/, fn)
      assert.match(body, /if v_role is null then\s+return jsonb_build_object\('ok', false, 'code', 'forbidden'\)/, fn)
      assert.match(body, /finance_jsonb_keys_allowed\(p_payload/, fn)
      assert.match(body, /'reason_required'/, fn)
      assert.match(body, /pg_advisory_xact_lock/, fn)
    }
  })
  it("nunca ativa, nunca retroage, nunca cria entitlement/competência/linha/dia/reward/carteira", () => {
    assert.equal(/active\s*=\s*true|set\s+status\s*=\s*'active'|'active',\s*true/i.test(CODE), false)
    assert.equal(/retroactive\s*=\s*true|'retroactive',\s*true/i.test(CODE), false)
    assert.equal(/insert\s+into\s+public\.(employee_commission_entitlements|payroll_competences|payroll_competence_lines|employee_worked_days|rewards|wallet_transactions|payments|referrals|collection_\w+)\b/i.test(CODE), false)
    assert.equal(/\bdefault\s+\d/i.test(CODE), false)
    assert.equal(/\b(30|50|22)\.00\b|0\.02\b/.test(CODE), false)
    assert.equal(/execute\s+(format|'|\$|v_)/i.test(CODE), false)
  })
  it("portões da fundação (CHECKs I1) não são removidos nem alterados", () => {
    for (const c of ["employee_commission_rules_foundation_inactive_chk", "employee_commission_rules_no_retroactive_chk", "employee_compensation_profiles_foundation_inactive_chk", "employee_commission_rules_active_status_consistent_chk"]) {
      assert.equal(new RegExp(`drop constraint (if exists )?${c}`).test(CODE), false, c)
    }
    const drops = [...CODE.matchAll(/drop constraint (?:if exists )?([a-z_]+)/g)].map((m) => m[1])
    assert.deepEqual(drops, ["finance_audit_events_action_chk"])
  })
  it("CHECK de auditoria só AMPLIADA (todas as ações I1 preservadas)", () => {
    const add = CODE.slice(CODE.indexOf("add constraint finance_audit_events_action_chk"), CODE.indexOf("));", CODE.indexOf("add constraint finance_audit_events_action_chk")))
    for (const a of ["attribution_created", "commission_rule_draft_created", "commission_rule_draft_versioned", "compensation_draft_configured", "worked_day_recorded", "worked_day_changed", "payroll_competence_draft_opened", "payroll_adjustment_added", "approve", "adjust", "reverse", "reopen", "pay", "commission_rule_draft_archived", "compensation_draft_versioned", "compensation_draft_archived"]) {
      assert.match(add, new RegExp(`'${a}'`), a)
    }
  })
  it("auditoria nunca registra valores (sem chave amount nos snapshots J4)", () => {
    const calls = [...CODE.matchAll(/perform public\.finance_audit_log\(([\s\S]*?)\);/g)].map((m) => m[1]).join("\n")
    const inserts = [...CODE.matchAll(/insert into public\.finance_audit_events[\s\S]*?\);/g)].map((m) => m[0]).join("\n")
    assert.equal([...CODE.matchAll(/perform public\.finance_audit_log\(/g)].length, 2)
    assert.equal([...CODE.matchAll(/insert into public\.finance_audit_events/g)].length, 2)
    assert.match(calls + inserts, /'version'/)
    assert.equal(/'amount'|salary|meal_daily|transport_amount|fuel_amount|fixed_amount|percentage_rate|p_payload ->> '(fixedAmount|salaryAmount|percentageRate)'/.test(calls + inserts), false)
  })
  it("RPCs posicionais I1 e de dias/competência/ajuste deixam de ser executáveis por clientes (sem DROP)", () => {
    for (const fn of ["create_commission_rule_draft", "version_commission_rule_draft", "configure_employee_compensation_draft", "record_employee_worked_day", "open_payroll_competence_draft", "add_manual_payroll_adjustment"]) {
      assert.match(CODE, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`), fn)
      assert.equal(new RegExp(`grant execute on function public\\.${fn}\\(`).test(CODE), false, fn)
    }
  })
  it("prévia do funcionário: identidade por employee_portal_self, sem parâmetro de id", () => {
    assert.match(CODE, /function public\.employee_compensation_preview\(\)/)
    const i = CODE.indexOf("function public.employee_compensation_preview()")
    const body = CODE.slice(i, CODE.indexOf("$$;", CODE.indexOf("as $$", i)))
    assert.match(body, /from public\.employee_portal_self\(\)/)
    assert.match(body, /salary_enabled and v_prof\.show_salary/)
    assert.match(body, /meal_enabled and v_prof\.show_meal/)
    assert.match(body, /'not_calculated'/)
    assert.match(body, /'closedPayroll', false/)
  })
  it("preflight e verify somente leitura", () => {
    for (const f of ["supabase/preflight-employee-compensation-configuration-3-1f-j4.sql", "supabase/verify-employee-compensation-configuration-3-1f-j4.sql"]) {
      const s = read(f).replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "''")
      assert.equal(/\b(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/i.test(s), false, f)
    }
  })
})

describe("3.1F-J4 app", () => {
  it("rotas: somente POST, guard + handler, no-store, sem .rpc/.from/service role", () => {
    for (const [f, kind] of ROUTES) {
      const src = strip(read(f))
      assert.match(src, /export async function POST\(/, f)
      assert.equal(/export (async )?function (GET|PUT|PATCH|DELETE)\b/.test(src), false, f)
      assert.match(src, new RegExp(`runAdminCompensationRoute\\("${kind}", request\\)`), f)
      assert.match(src, /applyNoStoreHeaders/, f)
      assert.match(src, /dynamic = "force-dynamic"/, f)
      assert.equal(/\.rpc\(|\.from\(|service_role|createServiceRoleClient|getOpsDb/.test(src), false, f)
    }
  })
  it("serviço: sessão do usuário + guard admin; somente RPCs J4; nunca tabela/service role", () => {
    const src = strip(read("lib/compensation-config/service.ts"))
    assert.match(src, /import "server-only"/)
    assert.match(src, /from "@\/lib\/supabase\/server"/)
    assert.match(src, /authorizeAdminRemuneracao\(\)/)
    assert.match(src, /auth\.getUser\(\)/)
    assert.equal(/getSession\(|\.from\(|service_role|createServiceRoleClient|getOpsDb|SUPABASE_SERVICE_ROLE_KEY/.test(src), false)
    const rpcs = [...src.matchAll(/sessionRead\("([a-z_]+)"/g)].map((m) => m[1]).sort()
    assert.deepEqual(rpcs, ["admin_get_employee_compensation", "admin_list_commission_rules", "admin_list_compensation_employees"])
    assert.match(src, /sessionRead\(EMPLOYEE_PREVIEW_RPC, \{\}\)/)
    assert.match(src, /EMPLOYEE_PREVIEW_RPC = "employee_compensation_preview"/)
    const h = strip(read("lib/compensation-config/handlers.ts"))
    assert.deepEqual([...h.matchAll(/: "(admin_[a-z_]+)"/g)].map((m) => m[1]).sort(), [...WRITE_RPCS].sort())
    assert.equal([...h.matchAll(/\.rpc\(/g)].length, 1)
  })
  it("nenhum arquivo J4 usa service role, localStorage/sessionStorage, getSession ou ERP/Sync", () => {
    for (const f of J4_FILES) {
      const src = strip(read(f))
      assert.equal(/createServiceRoleClient|getOpsDb|SUPABASE_SERVICE_ROLE_KEY|service_role|localStorage|sessionStorage|getSession\(|brbyte|controllr|runSync|probe|withdraw|wallet|Carteira|Sacar|saque/i.test(src), false, f)
    }
  })
  it("navegador J4 só chama as 4 rotas POST de rascunho; botão Ativar permanece gated", () => {
    const client = strip(read("lib/compensation-config/client.ts"))
    assert.deepEqual([...client.matchAll(/"(\/api\/[^"]+)"/g)].map((m) => m[1]).sort(), ["/api/admin/remuneracao/funcionarios", "/api/admin/remuneracao/funcionarios/arquivar", "/api/admin/remuneracao/regras", "/api/admin/remuneracao/regras/arquivar"])
    const ui = read("components/compensation-config/ui.tsx")
    assert.match(ui, /disabled\s+aria-disabled="true"/)
    assert.match(ui, /ACTIVATE_DISABLED_REASON/)
    assert.match(read("lib/compensation-config/contract.ts"), /ACTIVATE_DISABLED_REASON = "Aguardando validação da integração financeira"/)
  })
  it("formulários começam vazios; sugestões só por clique explícito", () => {
    const rules = read("components/compensation-config/rules-configurator.tsx")
    const emp = read("components/compensation-config/employee-compensation-configurator.tsx")
    const emptyRule = rules.slice(rules.indexOf("export const EMPTY_RULE_FORM"), rules.indexOf("}", rules.indexOf("export const EMPTY_RULE_FORM")))
    assert.equal(/: "[^"]+"/.test(emptyRule), false, emptyRule)
    const emptyProf = emp.slice(emp.indexOf("export const EMPTY_PROFILE_FORM"), emp.indexOf("}", emp.indexOf("export const EMPTY_PROFILE_FORM")))
    assert.equal(/: "[^"]+"|: true/.test(emptyProf), false, emptyProf)
    for (const src of [rules, emp]) {
      for (const line of src.split("\n").filter((l) => /UI_SUGGESTION\.|suggestion\.amount/.test(l))) {
        assert.ok(/onClick=\{\(\) => set\(|formatMoney\(/.test(line), line)
      }
    }
    assert.match(rules, /setValues\(EMPTY_RULE_FORM\)/)
    assert.match(emp, /current \? fromVersion\(current, today\) : EMPTY_PROFILE_FORM/)
  })
  it("checkbox nativo com label (acessibilidade) e banners de rascunho nas duas páginas", () => {
    assert.match(read("components/compensation-config/employee-compensation-configurator.tsx"), /<input id=\{`cc-\$\{c\}-show`\} type="checkbox"/)
    for (const f of ["app/admin/remuneracao/regras/page.tsx", "app/admin/remuneracao/funcionarios/page.tsx"]) {
      const src = read(f)
      assert.match(src, /<DraftBanners \/>/, f)
      assert.ok(src.indexOf("await requireAdminRemuneracaoPage()") < src.indexOf("await load"), f)
      assert.match(src, /RemuneracaoShell/, f)
    }
  })
  it("painel do funcionário: prévia própria, sem id enviado, componente ausente nunca vira zero", () => {
    const src = strip(read("app/funcionario/remuneracao/page.tsx"))
    assert.match(src, /loadEmployeeCompensationPreview\(\)/)
    assert.match(src, /Não calculada/)
    assert.match(src, /Não constituem folha fechada/)
    assert.match(src, /Nenhuma remuneração configurada para você ainda\./)
    for (const c of ["salary", "meal", "transport", "fuel"]) assert.match(src, new RegExp(`preview\\.data\\.components\\.${c} \\?`), c)
    assert.equal(/\?\? "0|\|\| "0|R\$ 0|0,00/.test(src), false)
    const svc = strip(read("lib/compensation-config/service.ts"))
    const fn = svc.slice(svc.indexOf("export async function loadEmployeeCompensationPreview"), svc.indexOf("/** Rotas POST"))
    assert.equal(/employee_id|employeeId|profile_id/.test(fn), false)
  })
  it("arquivos previstos existem", () => {
    for (const f of J4_FILES) assert.ok(existsSync(join(root, f)), f)
  })
})

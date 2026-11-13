import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { evaluateRouteAccessForRole } from "@/lib/auth/auth-audit"
import {
  adminNavGroupSpecs,
  filterNavGroups,
  funcionarioNavGroupSpecs,
  shouldShowSidebarHref,
} from "@/lib/employees/admin-policy"
import { ADMIN_REMUNERACAO_SECTIONS, canAccessAdminRemuneracao, isAdminRemuneracaoPath } from "@/lib/admin-remuneracao/policy"
import type { UserRole } from "@/types/user"

const ROLES: UserRole[] = ["indicador", "comercial", "funcionario", "admin_consulta", "admin_financeiro", "admin_master"]
const PATHS = ["/admin/remuneracao", ...ADMIN_REMUNERACAO_SECTIONS.map((s) => s.href), "/admin/remuneracao/x/y"]
const ALLOWED = new Set<UserRole>(["admin_master", "admin_financeiro"])

describe("3.1F-J2 matriz de permissões /admin/remuneracao (H)", () => {
  for (const role of ROLES) for (const p of PATHS) {
    it(`${role} ${p} => ${ALLOWED.has(role) ? "permitido" : "negado"}`, () => {
      assert.equal(evaluateRouteAccessForRole(p, role).allowed, ALLOWED.has(role))
    })
  }
  it("sem sessão => negado", () => assert.equal(evaluateRouteAccessForRole("/admin/remuneracao", null).allowed, false))
  it("canAccessAdminRemuneracao", () => {
    for (const role of ROLES) assert.equal(canAccessAdminRemuneracao(role), ALLOWED.has(role))
    assert.equal(canAccessAdminRemuneracao(null), false)
    assert.equal(canAccessAdminRemuneracao("gestor"), false)
  })
  it("prefixo não captura rotas vizinhas", () => {
    assert.equal(isAdminRemuneracaoPath("/admin/remuneracao-x"), false)
    assert.equal(isAdminRemuneracaoPath("/api/admin/remuneracao"), true)
    assert.equal(evaluateRouteAccessForRole("/admin/remuneracaox", "admin_consulta").allowed, true)
  })
  it("sem regressão: admin_consulta mantém /admin e /admin/financeiro (Indique e Ganhe)", () => {
    for (const p of ["/admin", "/admin/financeiro", "/admin/funcionarios", "/admin/auditoria", "/admin/indicacoes"]) {
      assert.equal(evaluateRouteAccessForRole(p, "admin_consulta").allowed, true, p)
    }
  })
  it("funcionário: rotas próprias permitidas; outros perfis negados", () => {
    for (const p of ["/funcionario", "/funcionario/vendas", "/funcionario/vendas/abc", "/funcionario/remuneracao", "/funcionario/remuneracao/2026-11"]) {
      for (const role of ROLES) assert.equal(evaluateRouteAccessForRole(p, role).allowed, role === "funcionario", `${role} ${p}`)
    }
  })
})

describe("3.1F-J2 menu e terminologia (I)", () => {
  const hrefsFor = (role: UserRole) => filterNavGroups(adminNavGroupSpecs(), { variant: "admin", role, membershipCodes: [] }).flatMap((g) => g.items.map((i) => i.href))
  it("Remuneração de Funcionários visível só para master/financeiro", () => {
    assert.equal(hrefsFor("admin_master").includes("/admin/remuneracao"), true)
    assert.equal(hrefsFor("admin_financeiro").includes("/admin/remuneracao"), true)
    assert.equal(hrefsFor("admin_consulta").includes("/admin/remuneracao"), false)
    for (const v of ["comercial", "funcionario", "indicador"] as const) {
      assert.equal(shouldShowSidebarHref({ href: "/admin/remuneracao", variant: v, role: v === "funcionario" ? "funcionario" : v, membershipCodes: [] }), false)
    }
  })
  it("rótulo do /admin/financeiro = Financeiro — Indique e Ganhe; URL preservada", () => {
    const item = adminNavGroupSpecs().flatMap((g) => g.items).find((i) => i.href === "/admin/financeiro")
    assert.equal(item?.label, "Financeiro — Indique e Ganhe")
    const remun = adminNavGroupSpecs().flatMap((g) => g.items).find((i) => i.href === "/admin/remuneracao")
    assert.equal(remun?.label, "Remuneração de Funcionários")
  })
  it("funcionário: Início, Minhas vendas, Minha remuneração; sem Nova oportunidade", () => {
    const groups = filterNavGroups(funcionarioNavGroupSpecs(), { variant: "funcionario", role: "funcionario", membershipCodes: [] })
    const items = groups.flatMap((g) => g.items)
    assert.deepEqual(items.map((i) => i.label).filter((l) => l !== "Notificações"), ["Início", "Minhas vendas", "Minha remuneração"])
    assert.equal(items.some((i) => i.href.includes("nova-oportunidade")), false)
  })
  it("3.1F-J3: Nova oportunidade só com vínculo real de Técnico ou Vendas Externas", () => {
    for (const [codes, visible] of [[["technician"], true], [["external_sales"], true], [["technician", "external_sales"], true], [["commercial"], false], [["collections", "retention"], false], [[], false]] as const) {
      const items = filterNavGroups(funcionarioNavGroupSpecs(), { variant: "funcionario", role: "funcionario", membershipCodes: [...codes] }).flatMap((g) => g.items)
      assert.equal(items.some((i) => i.href === "/funcionario/nova-oportunidade"), visible, codes.join(","))
    }
  })
})

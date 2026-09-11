import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { evaluateRouteAccessForRole } from "./auth-audit"
import type { UserRole } from "@/types/user"

describe("evaluateRouteAccessForRole — /primeiro-acesso", () => {
  it("permite role autenticado", () => {
    assert.equal(
      evaluateRouteAccessForRole("/primeiro-acesso", "indicador").allowed,
      true
    )
  })
})

describe("evaluateRouteAccessForRole — /comercial/nova-indicacao", () => {
  const path = "/comercial/nova-indicacao"

  it("anônimo bloqueado", () => {
    const r = evaluateRouteAccessForRole(path, null)
    assert.equal(r.allowed, false)
  })

  it("indicador bloqueado", () => {
    const r = evaluateRouteAccessForRole(path, "indicador")
    assert.equal(r.allowed, false)
  })

  it("admin_financeiro bloqueado", () => {
    const r = evaluateRouteAccessForRole(path, "admin_financeiro")
    assert.equal(r.allowed, false)
  })

  it("admin_consulta bloqueado", () => {
    const r = evaluateRouteAccessForRole(path, "admin_consulta")
    assert.equal(r.allowed, false)
  })

  it("comercial ativo permitido", () => {
    const r = evaluateRouteAccessForRole(path, "comercial")
    assert.equal(r.allowed, true)
  })

  it("admin_master permitido", () => {
    const r = evaluateRouteAccessForRole(path, "admin_master")
    assert.equal(r.allowed, true)
  })

  it("admin_financeiro ainda acessa leads comerciais", () => {
    const r = evaluateRouteAccessForRole("/comercial/leads/abc", "admin_financeiro")
    assert.equal(r.allowed, true)
  })

  it("matriz de roles em /comercial/nova-indicacao", () => {
    const matrix: Array<[UserRole | null, boolean]> = [
      [null, false],
      ["indicador", false],
      ["admin_financeiro", false],
      ["admin_consulta", false],
      ["comercial", true],
      ["admin_master", true],
    ]
    for (const [role, expected] of matrix) {
      assert.equal(
        evaluateRouteAccessForRole(path, role).allowed,
        expected,
        `role=${role}`
      )
    }
  })
})

describe("evaluateRouteAccessForRole — /cobranca e /retencao", () => {
  it("indicador bloqueado; comercial e admins permitidos no prefixo (membership no servidor)", () => {
    assert.equal(evaluateRouteAccessForRole("/cobranca", "indicador").allowed, false)
    assert.equal(evaluateRouteAccessForRole("/retencao", "indicador").allowed, false)
    assert.equal(evaluateRouteAccessForRole("/cobranca", "comercial").allowed, true)
    assert.equal(evaluateRouteAccessForRole("/retencao", "admin_master").allowed, true)
    assert.equal(evaluateRouteAccessForRole("/cobranca", "admin_consulta").allowed, true)
  })
})

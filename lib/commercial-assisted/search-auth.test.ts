import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { authorizeCommercialIndicatorSearch } from "./search-auth"

describe("commercial indicator search auth", () => {
  it("comercial ativo autorizado", () => {
    const result = authorizeCommercialIndicatorSearch({
      userId: "u1",
      profile: { id: "u1", role: "comercial", is_active: true },
    })
    assert.equal(result.ok, true)
  })

  it("admin_master ativo autorizado (suporte)", () => {
    const result = authorizeCommercialIndicatorSearch({
      userId: "u1",
      profile: { id: "u1", role: "admin_master", is_active: true },
    })
    assert.equal(result.ok, true)
  })

  it("comercial inativo negado", () => {
    const result = authorizeCommercialIndicatorSearch({
      userId: "u1",
      profile: { id: "u1", role: "comercial", is_active: false },
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 403)
  })

  it("indicador negado", () => {
    const result = authorizeCommercialIndicatorSearch({
      userId: "u1",
      profile: { id: "u1", role: "indicador", is_active: true },
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 403)
  })

  it("admin_consulta e admin_financeiro negados", () => {
    for (const role of ["admin_consulta", "admin_financeiro"] as const) {
      const result = authorizeCommercialIndicatorSearch({
        userId: "u1",
        profile: { id: "u1", role, is_active: true },
      })
      assert.equal(result.ok, false)
    }
  })

  it("usuário sem sessão negado", () => {
    const result = authorizeCommercialIndicatorSearch({
      userId: null,
      profile: null,
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 401)
  })
})

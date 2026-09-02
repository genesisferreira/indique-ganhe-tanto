import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  escapeIlikePattern,
  normalizeIndicatorSearchQuery,
} from "./search-query"

describe("commercial indicator search query", () => {
  it("query vazia negada", () => {
    assert.equal(normalizeIndicatorSearchQuery("").ok, false)
    assert.equal(normalizeIndicatorSearchQuery("   ").ok, false)
  })

  it("query curta negada", () => {
    const result = normalizeIndicatorSearchQuery("ab")
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, "too_short")
  })

  it("classifica nome, e-mail, telefone e CPF", () => {
    const name = normalizeIndicatorSearchQuery("Maria")
    assert.equal(name.ok, true)
    if (name.ok) assert.equal(name.queryType, "name")

    const email = normalizeIndicatorSearchQuery("joao@tanto.com")
    assert.equal(email.ok, true)
    if (email.ok) assert.equal(email.queryType, "email")

    const phone = normalizeIndicatorSearchQuery("3133334444")
    assert.equal(phone.ok, true)
    if (phone.ok) assert.equal(phone.queryType, "phone")

    // 11 dígitos: trata como CPF (e também busca telefone no filtro cpf).
    const cpf = normalizeIndicatorSearchQuery("52998224725")
    assert.equal(cpf.ok, true)
    if (cpf.ok) assert.equal(cpf.queryType, "cpf")
  })

  it("escapa curingas ILIKE", () => {
    assert.equal(escapeIlikePattern("100%_off"), "100\\%\\_off")
  })
})

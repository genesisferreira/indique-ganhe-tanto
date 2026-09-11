import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseOperationalDocument } from "@/lib/operational/document"

describe("O) documento inválido", () => {
  it("vazio e lixo", () => {
    assert.equal(parseOperationalDocument("").ok, false)
    assert.equal(parseOperationalDocument("123").ok, false)
    assert.equal(parseOperationalDocument("00000000000").ok, false)
  })
})

describe("M) CPF válido normaliza", () => {
  it("52998224725", () => {
    const r = parseOperationalDocument("529.982.247-25")
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.document.digits, "52998224725")
      assert.equal(r.document.kind, "cpf")
    }
  })
})

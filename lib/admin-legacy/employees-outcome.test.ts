import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { employeesOutcome } from "./employees-outcome"

const row = { id: "e1", name: "Lab", email: "e@lab.invalid", phone: null, status: "active", sectors: [], updatedAt: "2026-01-01T00:00:00Z" }

describe("K1 /admin/funcionarios — validação da resposta", () => {
  it("sucesso com 1 item", () => {
    assert.deepEqual(employeesOutcome(200, true, { ok: true, items: [row], canWrite: true }), { kind: "data", data: { items: [row], canWrite: true }, empty: false })
  })
  it("vazio real somente com ok:true e items []", () => {
    assert.deepEqual(employeesOutcome(200, true, { ok: true, items: [], canWrite: false }), { kind: "data", data: { items: [], canWrite: false }, empty: true })
  })
  for (const [status, cls] of [[401, "unauthenticated"], [403, "forbidden"], [500, "server_error"], [503, "server_error"]] as const) {
    it(`HTTP ${status} => ${cls} (nunca vazio)`, () => {
      assert.deepEqual(employeesOutcome(status, false, { ok: true, items: [] }), { kind: "error", errorClass: cls })
    })
  }
  for (const [name, body] of [["null", null], ["ok:false", { ok: false, items: [] }], ["sem items", { ok: true }], ["items não-array", { ok: true, items: {} }], ["item inválido", { ok: true, items: [{ name: "x" }] }]] as const) {
    it(`corpo ${name} com 200 => invalid_response`, () => {
      assert.deepEqual(employeesOutcome(200, true, body), { kind: "error", errorClass: "invalid_response" })
    })
  }
  it("canWrite só é true com true explícito", () => {
    const r = employeesOutcome(200, true, { ok: true, items: [row], canWrite: "yes" })
    assert.equal(r.kind === "data" && r.data.canWrite, false)
  })
})

/** Sprint 3.1E-AY — resumo de capacidade e modal usam a mesma fonte (puro, sem ERP). */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  decideNextBatch,
  nextBatchConfirmMessage,
  parseCapacitySummary,
  readCapacitySummaryResponse,
} from "@/lib/collections/next-batch"
import { nextBatchButtonState } from "@/lib/collections/contract-card"

const RPC = { busy: false, scope: "contract_only", unkeyed: 0, available: 13, occupying: 2, configured: 15, futurePromises: 0, futureCallbacks: 0 }

describe("3.1E-AY capacity summary", () => {
  it("15/2/13 com contrato sanitizado", () => {
    const s = parseCapacitySummary(RPC, null)!
    assert.deepEqual(
      { c: s.configuredCapacity, a: s.activeContracts, v: s.availableCapacity, f: s.capacityFull, src: s.source },
      { c: 15, a: 2, v: 13, f: false, src: "contract_capacity" }
    )
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}/.test(JSON.stringify(s)), false)
  })
  it("array de 1 linha, wrapper escalar e snake_case", () => {
    assert.equal(parseCapacitySummary([RPC], null)!.availableCapacity, 13)
    assert.equal(parseCapacitySummary([{ collection_contract_capacity_summary: RPC }], null)!.availableCapacity, 13)
    assert.equal(parseCapacitySummary({ configured_capacity: 15, active_contracts: 2 }, null)!.availableCapacity, 13)
    assert.equal(parseCapacitySummary({ configuredCapacity: 15, activeContracts: 2 }, null)!.availableCapacity, 13)
  })
  it("null/vazio/shape inválido => null (fail-closed, sem estimativa)", () => {
    assert.equal(parseCapacitySummary(null, null), null)
    assert.equal(parseCapacitySummary([], null), null)
    assert.equal(parseCapacitySummary([RPC, RPC], null), null)
    assert.equal(parseCapacitySummary({ configured: 15 }, null), null)
  })
  it("resposta HTTP: erro/PostgREST/403/401 => error sanitizado; ok => ready", () => {
    const summary = parseCapacitySummary(RPC, null)
    assert.equal(readCapacitySummaryResponse(true, { ok: true, summary }).status, "ready")
    for (const [ok, body] of [[false, { ok: false, message: "PGRST202 details" }], [false, null], [true, { ok: true, summary: { configured: 15 } }], [false, { ok: false, message: "Apenas Admin Master." }]] as const) {
      const st = readCapacitySummaryResponse(ok, body)
      assert.equal(st.status, "error")
      assert.equal(st.status === "error" && /PGRST|details/.test(st.message), false)
    }
  })
  it("resumo e modal usam o mesmo valor; botão mostra 'Carregar até 13'", () => {
    const s = parseCapacitySummary(RPC, null)!
    const b = nextBatchButtonState({ summary: s, submitting: false })
    assert.equal(b.disabled, false)
    assert.equal(b.label, "Carregar até 13")
    assert.equal(nextBatchConfirmMessage(s.availableCapacity), "Carregar até 13 novos contratos elegíveis?")
    const page = readFileSync("app/cobranca/page.tsx", "utf8")
    assert.match(page, /nextBatchConfirmMessage\(summary\.availableCapacity\)/)
    assert.match(page, /summary\.availableCapacity/)
    assert.equal(/summary\.configured\b|summary\.occupying\b|summary\.available\b/.test(page), false)
    assert.match(page, /Atualizar resumo/)
  })
  it("loading/falha desabilitam botão; capacityFull bloqueia antes do ERP", () => {
    assert.equal(nextBatchButtonState({ summary: null, submitting: false, loading: true }).disabled, true)
    assert.equal(nextBatchButtonState({ summary: null, submitting: false }).disabled, true)
    const full = parseCapacitySummary({ configured: 15, occupying: 15 }, null)!
    assert.equal(full.capacityFull, true)
    assert.equal(nextBatchButtonState({ summary: full, submitting: false }).disabled, true)
    const d = decideNextBatch({ summary: full, enabled: true, inFlight: false })
    assert.equal(d.proceed, false)
  })
  it("cliente não usa service_role nem chama RPC/ERP diretamente; rota exige Admin Master", () => {
    const page = readFileSync("app/cobranca/page.tsx", "utf8")
    assert.equal(/service_role|SERVICE_ROLE|\.rpc\(|brbyte|controllr\//i.test(page), false)
    const route = readFileSync("app/api/admin/collections/next-batch/route.ts", "utf8")
    assert.match(route, /admin_master/)
    assert.match(route, /export async function GET\(\) \{\s*const auth = await authorize\(\)/)
    const svc = readFileSync("lib/collections/next-batch.service.ts", "utf8")
    assert.match(svc, /import "server-only"/)
  })
})

/** Sprint 3.1F-H6 — guard do modo employee_commission_invoice_evidence (sem ERP, sem banco). */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import {
  EMPLOYEE_EVIDENCE_CONTRACT_FILTER_PROVEN,
  EMPLOYEE_EVIDENCE_GUARD_ERROR_CLASS,
  EMPLOYEE_EVIDENCE_GUARD_HTTP_STATUS,
  buildEmployeeEvidenceGuardResponse,
} from "@/lib/brbyte/employee-commission-invoice-evidence-result"

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const ROUTE = "app/api/admin/collections/invoice-list-probe/route.ts"
const RUNNER = "lib/brbyte/employee-commission-invoice-evidence.ts"
const ALLOWED_GUARD_KEYS = [
  "attempts", "contractFilterProven", "databaseWrites", "erpRequests", "errorClass",
  "firstInvoiceOrderProven", "mode", "ok", "retryExecuted",
]

describe("3.1F-H6 guard contract_filter_not_proven", () => {
  it("filtro de contrato marcado como não comprovado; HTTP 409", () => {
    assert.equal(EMPLOYEE_EVIDENCE_CONTRACT_FILTER_PROVEN, false)
    assert.equal(EMPLOYEE_EVIDENCE_GUARD_HTTP_STATUS, 409)
    assert.equal(EMPLOYEE_EVIDENCE_GUARD_ERROR_CLASS, "contract_filter_not_proven")
  })

  it("resposta do guard: schema fechado, zero ERP, zero escrita, sem IDs/valores/PII", () => {
    const r = buildEmployeeEvidenceGuardResponse()
    assert.deepEqual(Object.keys(r).sort(), ALLOWED_GUARD_KEYS)
    assert.equal(r.ok, false)
    assert.equal(r.errorClass, "contract_filter_not_proven")
    assert.equal(r.erpRequests, 0)
    assert.equal(r.attempts, 0)
    assert.equal(r.databaseWrites, 0)
    assert.equal(r.retryExecuted, false)
    assert.equal(r.firstInvoiceOrderProven, false)
    const json = JSON.stringify(r)
    assert.doesNotMatch(json, /contractPk|contract_pk|invoicePk|invoice_pk|amount|name|cpf|cnpj|phone|address|payload|cookie|token/i)
    assert.doesNotMatch(json, /\d{4,}/)
  })

  it("rota: Admin Master antes do guard; guard antes de body/runner/ERP; sem log no guard", () => {
    const route = read(ROUTE)
    const block = route.slice(route.indexOf("body.mode === EMPLOYEE_COMMISSION_INVOICE_EVIDENCE_MODE"))
    const iRole = block.indexOf('auth.context?.role !== "admin_master"')
    const iGuard = block.indexOf("!EMPLOYEE_EVIDENCE_CONTRACT_FILTER_PROVEN")
    const iRun = block.indexOf("runEmployeeCommissionInvoiceEvidence(")
    assert.ok(iRole >= 0 && iGuard > iRole && iRun > iGuard)
    const guardBlock = block.slice(iGuard, iRun)
    assert.match(guardBlock, /EMPLOYEE_EVIDENCE_GUARD_HTTP_STATUS/)
    assert.equal(/console\./.test(guardBlock), false)
    assert.match(block, /jsonError\(403, "Somente Admin Master\."\)/)
  })

  it("runner: guard antes de config/login/POST (defesa em profundidade)", () => {
    const runner = read(RUNNER)
    const body = runner.slice(runner.indexOf("export async function runEmployeeCommissionInvoiceEvidence"))
    const iGuard = body.indexOf("if (!EMPLOYEE_EVIDENCE_CONTRACT_FILTER_PROVEN) return buildEmployeeEvidenceGuardResponse()")
    assert.ok(iGuard > 0)
    for (const call of ["getBrbyteOperationalConfig()", "brbyteAdminLogin(", "brbyteAdminPostForm("]) {
      assert.ok(body.indexOf(call) > iGuard, call)
    }
    assert.ok(body.indexOf("parseEmployeeEvidenceContractPk") > iGuard)
  })

  it("sem imports de escrita no banco, sem detalhe, sem Sync", () => {
    for (const src of [read(ROUTE), read(RUNNER)]) {
      for (const bad of ["getOpsDb", ".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "syncCollectionsFromControllr"]) {
        assert.equal(src.includes(bad), false, bad)
      }
    }
    const runner = read(RUNNER)
    assert.equal(runner.includes("invoice_info") || runner.includes("invoiceInfo"), false)
  })

  it("demais modos preservados", () => {
    const route = read(ROUTE)
    assert.match(route, /runOverdueFirstPageHealthProbe/)
    assert.match(route, /runClientIdentityHealthProbe/)
    assert.match(route, /runInvoiceListProbe/)
    assert.match(route, /maxDuration = 120/)
  })
})

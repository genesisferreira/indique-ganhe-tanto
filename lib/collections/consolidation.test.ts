import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  CONSOLIDATION_REASON,
  CONSOLIDATED_HISTORY_NOTICE,
  classifyDuplicateGroup,
  consolidatedActionBlock,
  operationalCases,
  selectCanonicalCase,
  type DuplicateCaseFacts,
} from "@/lib/collections/consolidation"
import { capacityStateFromCaseStatus, occupiesCapacity } from "@/lib/collections/operational-model"
import { buildContractCardView } from "@/lib/collections/contract-card"
import { COLLECTION_OPEN_STATUSES, COLLECTION_TERMINAL_STATUSES } from "@/types/collections"

function fact(id: string, createdAt: string, extra: Partial<DuplicateCaseFacts> = {}): DuplicateCaseFacts {
  return {
    id, createdAt, status: "open", contractPk: "5001", invoicePk: id === "b" ? "102" : id === "c" ? "103" : "101",
    eventTypes: ["created"], assignmentSources: ["auto_assign"], activeAssigneeKey: "E1",
    contactAttempts: 0, nonOpenInvoices: 0, ...extra,
  }
}

describe("3.1E-AW consolidação (puro)", () => {
  it("A: AUTO_ONLY consolida no mais antigo; desempate por uuid", () => {
    const g = [fact("b", "2026-09-02T00:00:00Z"), fact("a", "2026-09-01T00:00:00Z")]
    assert.equal(classifyDuplicateGroup(g), "AUTO_ONLY_SAFE_TO_CONSOLIDATE")
    assert.deepEqual(selectCanonicalCase(g), { canonicalId: "a", secondaryIds: ["b"] })
    const tie = [fact("b", "2026-09-01T00:00:00Z"), fact("a", "2026-09-01T00:00:00Z")]
    assert.equal(selectCanonicalCase(tie)?.canonicalId, "a")
  })
  it("Q/R/S/E: humano, financeiro, responsáveis diferentes, integridade -> sem escolha automática", () => {
    const h = [fact("a", "2026-09-01T00:00:00Z"), fact("b", "2026-09-02T00:00:00Z", { eventTypes: ["created", "contact_attempt"] })]
    assert.equal(classifyDuplicateGroup(h), "HUMAN_ACTIVITY_REQUIRES_MANUAL_CHOICE")
    assert.equal(selectCanonicalCase(h), null)
    const p = [fact("a", "2026-09-01T00:00:00Z"), fact("b", "2026-09-02T00:00:00Z", { eventTypes: ["created", "payment_detected"] })]
    assert.equal(classifyDuplicateGroup(p), "FINANCIAL_CONFLICT")
    const s = [fact("a", "2026-09-01T00:00:00Z", { contactAttempts: 1 }), fact("b", "2026-09-02T00:00:00Z", { activeAssigneeKey: "E2" })]
    assert.equal(classifyDuplicateGroup(s), "ASSIGNMENT_CONFLICT")
    const sAuto = [fact("a", "2026-09-01T00:00:00Z"), fact("b", "2026-09-02T00:00:00Z", { activeAssigneeKey: "E2" })]
    assert.equal(classifyDuplicateGroup(sAuto), "AUTO_ONLY_SAFE_TO_CONSOLIDATE")
    const k = [fact("a", "2026-09-01T00:00:00Z"), fact("b", "2026-09-02T00:00:00Z", { contractPk: "5002" })]
    assert.equal(classifyDuplicateGroup(k), "DATA_INTEGRITY_CONFLICT")
    const t = [fact("a", "2026-09-01T00:00:00Z", { assignmentSources: ["auto_assign", "transfer"] }), fact("b", "2026-09-02T00:00:00Z")]
    assert.equal(classifyDuplicateGroup(t), "HUMAN_ACTIVITY_REQUIRES_MANUAL_CHOICE")
  })
  it("AA: consolidated não ocupa capacidade, é terminal e fora do conjunto ativo", () => {
    assert.equal(COLLECTION_OPEN_STATUSES.includes("consolidated" as never), false)
    assert.equal(COLLECTION_TERMINAL_STATUSES.includes("consolidated"), true)
    assert.equal(capacityStateFromCaseStatus("consolidated"), "consolidated")
    assert.equal(occupiesCapacity({ state: "consolidated" } as never, new Date()), false)
  })
  it("AB: UI não duplica bloco; secundário sem contato; aviso de histórico", () => {
    const items = [{ id: "a", status: "open" }, { id: "b", status: "consolidated" }]
    assert.deepEqual(operationalCases(items).map((i) => i.id), ["a"])
    assert.notEqual(consolidatedActionBlock("consolidated"), null)
    assert.equal(consolidatedActionBlock("open"), null)
    assert.match(CONSOLIDATED_HISTORY_NOTICE, /Histórico consolidado/)
    assert.equal(/[0-9a-f]{8}-/i.test(CONSOLIDATED_HISTORY_NOTICE), false)
  })
  it("AD: pagamento parcial — duas faturas rastreáveis no canônico", () => {
    const card = buildContractCardView({
      id: "a", clientPk: null, contractPk: "5001", invoicePk: "101", customerName: null, customerDocument: null,
      daysOverdue: 10, overdueSince: null, outstandingAmount: null, status: "open", sectorAssignmentId: null,
      erpSnapshot: {}, metadata: {}, createdAt: "", updatedAt: "", closedAt: null, assigneeEmployeeId: null,
      assigneeName: null, lastContactAt: null,
      invoices: [
        { invoicePk: "101", dueDate: null, daysOverdue: 10, paymentStatus: "paid", resolvedAt: null },
        { invoicePk: "102", dueDate: null, daysOverdue: 9, paymentStatus: "open", resolvedAt: null },
      ],
    })
    assert.deepEqual(card.invoices.map((i) => i.invoicePk), ["101", "102"])
    assert.equal(card.paidCount, 1)
    assert.equal(card.overdueCount, 1)
  })
  it("migration AW: sem consolidação na instalação, sem IDs, motivo controlado, service_role only", () => {
    const sql = readFileSync("supabase/patch-collection-aw-contract-case-consolidation.sql", "utf8")
    assert.equal(/\bdelete\s+from\b/i.test(sql), false)
    assert.equal(/\bdrop\s+table\b/i.test(sql), false)
    assert.equal(/\btruncate\b/i.test(sql), false)
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql), false)
    assert.equal(/update public\.collection_discovery_runs/i.test(sql), false)
    assert.match(sql, new RegExp(CONSOLIDATION_REASON))
    assert.match(sql, /'contract_case_consolidated'/)
    assert.match(sql, /security definer\s+set search_path = public/)
    assert.match(sql, /pg_advisory_xact_lock\(872146, hashtext\(v_contract\)\)/)
    assert.equal(/grant execute[^;]*to (anon|authenticated|public)/i.test(sql), false)
    // nenhuma escrita em casos fora da função (instalação não consolida)
    const outside = sql.replace(/\$\$[\s\S]*?\$\$/g, "")
    assert.equal(/\bupdate\s+public\.collection_cases\b/i.test(outside), false)
    assert.equal(/\binsert\s+into\b/i.test(outside), false)
  })
  it("AU gate: aborta com duplicata ativa não resolvida", () => {
    const sql = readFileSync("supabase/patch-collection-au-contract-batch.sql", "utf8")
    assert.match(sql, /AU abortada/)
    assert.ok(sql.indexOf("$aw_gate$") < sql.indexOf("collection_cases_active_contract_uidx"))
  })
})

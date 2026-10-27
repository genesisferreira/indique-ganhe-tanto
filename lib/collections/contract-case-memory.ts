/**
 * Sprint 3.1E-AU — repositório em memória do modelo CONTRATO → FATURAS.
 * Espelha persist_collection_contract_invoice / reconcile_collection_case_paid
 * para testes puros do runner (sem banco, sem ERP). Sem PII como chave.
 */
import type {
  ContractPersistOutcome,
  DiscoveryCaseRepo,
  DiscoveryLease,
} from "@/lib/collections/discovery-persist"
import type { ExistingCollectionCase } from "@/lib/collections/sync-decision"
import { parseProvenPk } from "@/lib/collections/operational-model"

const OPEN = new Set(["open", "in_contact", "promise_to_pay", "unresolved"])

export type MemoryContractCase = {
  id: string
  contractPk: string
  status: string
  assigneeId: string | null
  metadata: Record<string, unknown>
}

export type MemoryInvoiceLink = {
  caseId: string
  invoicePk: string
  contractPk: string
  paymentStatus: "open" | "paid" | "cancelled_contract"
}

export function createMemoryContractCaseRepo(options?: {
  leaseGate?: (lease: DiscoveryLease) => boolean
  failOnInvoicePk?: string | null
}): DiscoveryCaseRepo & {
  cases: Map<string, MemoryContractCase>
  links: Map<string, MemoryInvoiceLink>
  createdEvents: string[]
  assignments: string[]
  roundRobinTicks: number
  paymentEvents: string[]
  outcomes: ContractPersistOutcome[]
} {
  const cases = new Map<string, MemoryContractCase>()
  const links = new Map<string, MemoryInvoiceLink>()
  const createdEvents: string[] = []
  const assignments: string[] = []
  const paymentEvents: string[] = []
  const outcomes: ContractPersistOutcome[] = []
  let seq = 0
  let roundRobinTicks = 0
  const leaseOk = (lease: DiscoveryLease) => !options?.leaseGate || options.leaseGate(lease)
  const activeByContract = (contractPk: string) =>
    [...cases.values()].find((c) => c.contractPk === contractPk && OPEN.has(c.status)) ?? null
  const toExisting = (link: MemoryInvoiceLink): ExistingCollectionCase => ({
    id: link.caseId,
    status: cases.get(link.caseId)?.status ?? "open",
    invoicePk: link.invoicePk,
  })
  const repo = {
    cases,
    links,
    createdEvents,
    assignments,
    paymentEvents,
    outcomes,
    get roundRobinTicks() {
      return roundRobinTicks
    },
    async findByInvoicePk(invoicePk: string) {
      const link = links.get(invoicePk)
      return link ? toExisting(link) : null
    },
    async isContractActive(contractPk: string) {
      return Boolean(activeByContract(contractPk))
    },
    async persistFencedInvoice(input: Parameters<DiscoveryCaseRepo["persistFencedInvoice"]>[0]) {
      const base = {
        caseId: null,
        inserted: false,
        newlyAssigned: false,
        assignmentId: null,
        unassigned: false,
      }
      if (!leaseOk(input.lease)) return { ok: false, code: "stale_lease" as const, ...base }
      const invoicePk = parseProvenPk(input.writeModel.invoice_pk)
      if (!invoicePk) return { ok: false, code: "invalid_input" as const, ...base }
      if (options?.failOnInvoicePk && options.failOnInvoicePk === invoicePk) {
        return { ok: false, code: "persist_error" as const, ...base }
      }
      const contractPk = parseProvenPk(input.writeModel.contract_pk)
      const record = (outcome: ContractPersistOutcome, extra: Record<string, unknown> = {}) => {
        outcomes.push(outcome)
        return { ok: true, code: "updated" as const, outcome, ...base, ...extra }
      }
      if (!contractPk) return record("inconclusive")
      if (input.writeModel.contract_status === 5 || input.writeModel.contract_status === "5") {
        return record("cancelled_contract")
      }
      const link = links.get(invoicePk)
      if (link) {
        const c = cases.get(link.caseId)
        if (!c || !OPEN.has(c.status)) return record("already_resolved")
        return record("invoice_updated", { caseId: c.id })
      }
      const active = activeByContract(contractPk)
      if (active) {
        links.set(invoicePk, { caseId: active.id, invoicePk, contractPk, paymentStatus: "open" })
        return record("invoice_attached", { caseId: active.id })
      }
      seq += 1
      const created: MemoryContractCase = {
        id: `case-${seq}`,
        contractPk,
        status: "open",
        assigneeId: null,
        metadata: {},
      }
      cases.set(created.id, created)
      links.set(invoicePk, { caseId: created.id, invoicePk, contractPk, paymentStatus: "open" })
      createdEvents.push(created.id)
      let assignmentId: string | null = null
      if (input.assign) {
        roundRobinTicks += 1
        assignments.push(created.id)
        created.assigneeId = `emp-${roundRobinTicks}`
        assignmentId = `asg-${created.id}`
      }
      outcomes.push("case_created")
      return {
        ok: true,
        code: "created" as const,
        outcome: "case_created" as ContractPersistOutcome,
        caseId: created.id,
        inserted: true,
        newlyAssigned: Boolean(assignmentId),
        assignmentId,
        unassigned: !assignmentId,
      }
    },
    async listOpenAfter(input: Parameters<DiscoveryCaseRepo["listOpenAfter"]>[0]) {
      if (!leaseOk(input.lease)) return { ok: false as const, code: "stale_lease" as const }
      const after = input.afterInvoicePk
      const listed = [...links.values()]
        .filter((l) => l.paymentStatus === "open" && OPEN.has(cases.get(l.caseId)?.status ?? ""))
        .filter((l) => after == null || BigInt(l.invoicePk) > BigInt(after))
        .sort((a, b) => (BigInt(a.invoicePk) < BigInt(b.invoicePk) ? -1 : 1))
        .slice(0, input.limit)
        .map(toExisting)
      return { ok: true as const, cases: listed }
    },
    async reconcilePaidFenced(input: Parameters<DiscoveryCaseRepo["reconcilePaidFenced"]>[0]) {
      const no = { closed: false, alreadyPaid: false, eventInserted: false }
      if (!leaseOk(input.lease)) return { ok: false, code: "stale_lease" as const, caseId: null, ...no }
      const c = cases.get(input.caseId)
      const link = links.get(input.invoicePk)
      if (!c) return { ok: false, code: "not_found" as const, caseId: null, ...no }
      if (!link || link.caseId !== c.id) {
        return { ok: false, code: "identity_mismatch" as const, caseId: c.id, ...no }
      }
      if (c.status === "paid") return { ok: true, code: "already_paid" as const, caseId: c.id, ...no, alreadyPaid: true }
      if (!OPEN.has(c.status)) return { ok: true, code: "skipped_terminal" as const, caseId: c.id, ...no }
      const key = `${c.id}:${input.invoicePk}`
      const eventInserted = !paymentEvents.includes(key)
      if (eventInserted) paymentEvents.push(key)
      link.paymentStatus = "paid"
      const pending = [...links.values()].filter((l) => l.caseId === c.id && l.paymentStatus !== "paid")
      if (pending.length > 0) {
        return { ok: true, code: "partial_paid" as const, caseId: c.id, ...no, eventInserted }
      }
      c.status = "paid"
      return { ok: true, code: "closed" as const, caseId: c.id, closed: true, alreadyPaid: false, eventInserted }
    },
    async insertOpen() {
      throw new Error("not_supported_in_contract_mode")
    },
    async updateFinancials() {
      return undefined
    },
    async recordCreatedEvent() {
      return undefined
    },
    async ensureAssignment() {
      return { assignmentId: null, code: "not_supported", newlyAssigned: false }
    },
  }
  return repo as unknown as ReturnType<typeof createMemoryContractCaseRepo>
}

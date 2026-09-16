import { decideCollectionSyncAction } from "@/lib/collections/sync-decision"
import type { CollectionSyncInvoice, ExistingCollectionCase } from "@/lib/collections/sync-decision"
import { buildCollectionCaseWriteModel } from "@/lib/collections/sync-decision"

export type DiscoveryPersistAction = "skip" | "create" | "update_open"

export type DiscoveryLease = {
  runId: string
  owner: string
  generation: number
}

export type DiscoveryFencedPersistResult = {
  ok: boolean
  code: "created" | "updated" | "stale_lease" | "persist_error" | "not_found" | "invalid_input"
  caseId: string | null
  inserted: boolean
  newlyAssigned: boolean
  assignmentId: string | null
  unassigned: boolean
}

export type DiscoveryCaseRepo = {
  findByInvoicePk(invoicePk: string): Promise<ExistingCollectionCase | null>
  persistFencedInvoice(input: {
    lease: DiscoveryLease
    writeModel: Record<string, unknown>
    actorProfileId: string
    assign: boolean
    statementTimeoutMs?: number | null
  }): Promise<DiscoveryFencedPersistResult>
  insertOpen(writeModel: Record<string, unknown>): Promise<{ id: string; inserted: boolean }>
  updateFinancials(caseId: string, writeModel: Record<string, unknown>): Promise<void>
  recordCreatedEvent(input: { caseId: string; invoicePk: string; actorProfileId: string }): Promise<void>
  ensureAssignment(input: {
    caseId: string
    actorProfileId: string
  }): Promise<{ assignmentId: string | null; code: string; newlyAssigned: boolean }>
}

export type DiscoveryPersistResult = {
  action: DiscoveryPersistAction
  created: boolean
  updated: boolean
  skipped: boolean
  newlyAssigned: boolean
  unassigned: boolean
}

export function decideDiscoveryPersistAction(input: {
  invoice: CollectionSyncInvoice
  existing: ExistingCollectionCase | null
  now: Date
  minimumDaysOverdue: number
  collectionsEnabled: boolean
}): DiscoveryPersistAction {
  const decision = decideCollectionSyncAction({
    invoice: input.invoice,
    existing: input.existing,
    now: input.now,
    minimumDaysOverdue: input.minimumDaysOverdue,
    collectionsEnabled: input.collectionsEnabled,
  })
  if (decision.action === "create") return "create"
  if (decision.action === "update_open") return "update_open"
  if (decision.action === "close_paid" || decision.action === "reopen") return "skip"
  return "skip"
}

export async function persistDiscoveredOverdueInvoice(input: {
  invoice: CollectionSyncInvoice
  existing: ExistingCollectionCase | null
  now: Date
  minimumDaysOverdue: number
  collectionsEnabled: boolean
  actorProfileId: string
  repo: DiscoveryCaseRepo
  lease?: DiscoveryLease | null
  statementTimeoutMs?: number | null
}): Promise<DiscoveryPersistResult & { staleLease: boolean }> {
  const skipped: DiscoveryPersistResult & { staleLease: boolean } = {
    action: "skip",
    created: false,
    updated: false,
    skipped: true,
    newlyAssigned: false,
    unassigned: false,
    staleLease: false,
  }
  const action = decideDiscoveryPersistAction(input)
  if (action === "skip") return skipped

  const writeModel = buildCollectionCaseWriteModel({
    invoice: input.invoice,
    now: input.now,
  })

  if (input.lease) {
    const fenced = await input.repo.persistFencedInvoice({
      lease: input.lease,
      writeModel,
      actorProfileId: input.actorProfileId,
      assign: action === "create" || input.existing?.status !== "escalated_retention",
      statementTimeoutMs: input.statementTimeoutMs,
    })
    if (!fenced.ok) {
      return { ...skipped, skipped: false, staleLease: fenced.code === "stale_lease" }
    }
    return {
      action: fenced.inserted ? "create" : "update_open",
      created: fenced.inserted,
      updated: !fenced.inserted,
      skipped: false,
      newlyAssigned: fenced.newlyAssigned,
      unassigned: fenced.unassigned,
      staleLease: false,
    }
  }

  if (action === "create") {
    const inserted = await input.repo.insertOpen({ ...writeModel, status: "open" })
    if (!inserted.inserted) {
      await input.repo.updateFinancials(inserted.id, writeModel)
      return {
        action: "update_open",
        created: false,
        updated: true,
        skipped: false,
        newlyAssigned: false,
        unassigned: false,
        staleLease: false,
      }
    }
    await input.repo.recordCreatedEvent({
      caseId: inserted.id,
      invoicePk: input.invoice.invoicePk,
      actorProfileId: input.actorProfileId,
    })
    const assigned = await input.repo.ensureAssignment({
      caseId: inserted.id,
      actorProfileId: input.actorProfileId,
    })
    return {
      action: "create",
      created: true,
      updated: false,
      skipped: false,
      newlyAssigned: assigned.newlyAssigned,
      unassigned: !assigned.assignmentId,
      staleLease: false,
    }
  }

  if (!input.existing) return skipped
  await input.repo.updateFinancials(input.existing.id, writeModel)
  const assigned =
    input.existing.status === "escalated_retention"
      ? { assignmentId: input.existing.id, newlyAssigned: false }
      : await input.repo.ensureAssignment({
          caseId: input.existing.id,
          actorProfileId: input.actorProfileId,
        })
  return {
    action: "update_open",
    created: false,
    updated: true,
    skipped: false,
    newlyAssigned: assigned.newlyAssigned === true,
    unassigned: !assigned.assignmentId,
    staleLease: false,
  }
}

export function createMemoryDiscoveryCaseRepo(options?: {
  leaseGate?: (lease: DiscoveryLease) => boolean
}): DiscoveryCaseRepo & {
  cases: Map<string, ExistingCollectionCase>
  createdEvents: string[]
  assignments: string[]
} {
  const cases = new Map<string, ExistingCollectionCase>()
  const byId = new Map<string, ExistingCollectionCase>()
  const createdEvents: string[] = []
  const assignments: string[] = []
  let seq = 0
  return {
    cases,
    createdEvents,
    assignments,
    async findByInvoicePk(invoicePk) {
      return cases.get(invoicePk) ?? null
    },
    async persistFencedInvoice(input) {
      if (options?.leaseGate && !options.leaseGate(input.lease)) {
        return {
          ok: false,
          code: "stale_lease",
          caseId: null,
          inserted: false,
          newlyAssigned: false,
          assignmentId: null,
          unassigned: false,
        }
      }
      const invoicePk = String(input.writeModel.invoice_pk ?? "")
      const existing = cases.get(invoicePk)
      if (existing) {
        return {
          ok: true,
          code: "updated",
          caseId: existing.id,
          inserted: false,
          newlyAssigned: false,
          assignmentId: assignments.includes(existing.id) ? `asg-${existing.id}` : null,
          unassigned: !assignments.includes(existing.id) && input.assign,
        }
      }
      const inserted = await this.insertOpen({ ...input.writeModel, status: "open" })
      await this.recordCreatedEvent({
        caseId: inserted.id,
        invoicePk,
        actorProfileId: input.actorProfileId,
      })
      let assignmentId: string | null = null
      let newlyAssigned = false
      if (input.assign) {
        const assigned = await this.ensureAssignment({
          caseId: inserted.id,
          actorProfileId: input.actorProfileId,
        })
        assignmentId = assigned.assignmentId
        newlyAssigned = assigned.newlyAssigned
      }
      return {
        ok: true,
        code: "created",
        caseId: inserted.id,
        inserted: true,
        newlyAssigned,
        assignmentId,
        unassigned: !assignmentId,
      }
    },
    async insertOpen(writeModel) {
      const invoicePk = String(writeModel.invoice_pk ?? "")
      const existing = cases.get(invoicePk)
      if (existing) return { id: existing.id, inserted: false }
      seq += 1
      const created: ExistingCollectionCase = {
        id: `case-${seq}`,
        status: "open",
        invoicePk,
      }
      cases.set(invoicePk, created)
      byId.set(created.id, created)
      return { id: created.id, inserted: true }
    },
    async updateFinancials(caseId) {
      const current = [...cases.values()].find((row) => row.id === caseId)
      if (current) current.status = current.status
    },
    async recordCreatedEvent(input) {
      createdEvents.push(input.caseId)
    },
    async ensureAssignment(input) {
      if (assignments.includes(input.caseId)) {
        return { assignmentId: `asg-${input.caseId}`, code: "already_assigned", newlyAssigned: false }
      }
      assignments.push(input.caseId)
      return { assignmentId: `asg-${input.caseId}`, code: "assigned", newlyAssigned: true }
    },
  }
}

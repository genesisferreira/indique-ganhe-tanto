import { decideCollectionSyncAction } from "@/lib/collections/sync-decision"
import type { CollectionSyncInvoice, ExistingCollectionCase } from "@/lib/collections/sync-decision"
import { buildCollectionCaseWriteModel } from "@/lib/collections/sync-decision"

export type DiscoveryPersistAction = "skip" | "create" | "update_open"

export type DiscoveryCaseRepo = {
  findByInvoicePk(invoicePk: string): Promise<ExistingCollectionCase | null>
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
}): Promise<DiscoveryPersistResult> {
  const skipped: DiscoveryPersistResult = {
    action: "skip",
    created: false,
    updated: false,
    skipped: true,
    newlyAssigned: false,
    unassigned: false,
  }
  const action = decideDiscoveryPersistAction(input)
  if (action === "skip") return skipped

  const writeModel = buildCollectionCaseWriteModel({
    invoice: input.invoice,
    now: input.now,
  })

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
  }
}

export function createMemoryDiscoveryCaseRepo(): DiscoveryCaseRepo & {
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

import { randomUUID } from "node:crypto"
import { parseInvoiceListReferenceDate } from "@/lib/brbyte/overdue-invoice-list-query"
import { validateDiscoveryCheckpoint } from "@/lib/collections/discovery-checkpoint"
import {
  COLLECTION_DISCOVERY_LEASE_MS,
  COLLECTION_DISCOVERY_PAGINATION_STRATEGY,
  COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION,
  COLLECTION_DISCOVERY_TIMEZONE,
  emptyDiscoveryCounters,
  emptyDiscoveryReconciliationFields,
  type CollectionDiscoveryCounters,
  type CollectionDiscoveryRun,
  type CollectionDiscoveryStatus,
} from "@/lib/collections/discovery-contract"

export type DiscoveryClaimResult =
  | { ok: true; code: "created" | "claimed"; created: boolean; run: CollectionDiscoveryRun }
  | {
      ok: false
      code:
        | "busy"
        | "incompatible_contract"
        | "run_not_resumable"
        | "not_found"
        | "invalid_input"
        | "invalid_reference"
    }

export type DiscoveryWriteResult =
  | { ok: true; run: CollectionDiscoveryRun }
  | { ok: false; code: "stale_lease" | "not_found" | "invalid_input" | "missing_migration" }

export type DiscoveryStore = {
  claimOrStart(input: {
    owner: string
    now: Date
    leaseMs?: number
    referenceInstant: Date
    referenceDate: string
    runId?: string | null
  }): Promise<DiscoveryClaimResult>
  advance(input: {
    runId: string
    owner: string
    generation: number
    now: Date
    cursorLastInvoicePk: string | null
    counters: CollectionDiscoveryCounters
    lastErrorClass?: string | null
  }): Promise<DiscoveryWriteResult>
  enterReconciliation(input: {
    runId: string
    owner: string
    generation: number
    now: Date
  }): Promise<DiscoveryWriteResult>
  advanceReconciliation(input: {
    runId: string
    owner: string
    generation: number
    now: Date
    reconcileCursorInvoicePk: string | null
    reconcileScannedCount: number
    reconcileClosedCount: number
    reconcileSkippedCount: number
    lastErrorClass?: string | null
  }): Promise<DiscoveryWriteResult>
  release(input: {
    runId: string
    owner: string
    generation: number
    status: Extract<
      CollectionDiscoveryStatus,
      "paused" | "failed" | "pagination_ended" | "phases_completed"
    >
    lastErrorClass?: string | null
  }): Promise<DiscoveryWriteResult>
}

function cloneRun(run: CollectionDiscoveryRun): CollectionDiscoveryRun {
  return {
    ...emptyDiscoveryReconciliationFields(),
    ...run,
    phase: run.phase === "reconciliation" ? "reconciliation" : "discovery",
    reconcileCursorInvoicePk: run.reconcileCursorInvoicePk ?? null,
    reconcileScannedCount: Number(run.reconcileScannedCount ?? 0),
    reconcileClosedCount: Number(run.reconcileClosedCount ?? 0),
    reconcileSkippedCount: Number(run.reconcileSkippedCount ?? 0),
    coverageProven: false,
    uniqueOrderProven: false,
  }
}

function assertWritableLease(
  run: CollectionDiscoveryRun,
  input: { owner: string; generation: number; now: Date }
): boolean {
  return (
    run.leaseOwner === input.owner &&
    run.leaseGeneration === input.generation &&
    run.status === "running" &&
    Boolean(run.leaseUntil) &&
    Date.parse(String(run.leaseUntil)) > input.now.getTime()
  )
}

function toIso(value: Date): string {
  return value.toISOString()
}

export function createMemoryDiscoveryStore(seed: CollectionDiscoveryRun[] = []): DiscoveryStore {
  const runs = new Map<string, CollectionDiscoveryRun>()
  for (const run of seed) runs.set(run.id, cloneRun(run))
  let chain = Promise.resolve()

  const exclusive = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  const findResumable = (): CollectionDiscoveryRun | null => {
    for (const run of runs.values()) {
      if (run.status === "running" || run.status === "paused" || run.status === "failed") {
        return run
      }
    }
    return null
  }

  return {
    claimOrStart(input) {
      return exclusive(() => {
        const owner = input.owner.trim()
        const leaseMs = input.leaseMs ?? COLLECTION_DISCOVERY_LEASE_MS
        const frozenDate = parseInvoiceListReferenceDate(input.referenceDate)
        if (!owner || leaseMs < 1000 || !frozenDate) {
          return { ok: false, code: "invalid_input" } satisfies DiscoveryClaimResult
        }
        const nowMs = input.now.getTime()
        const leaseUntil = toIso(new Date(nowMs + leaseMs))
        const existing = input.runId
          ? (runs.get(input.runId) ?? null)
          : findResumable()
        if (input.runId && !existing) {
          return { ok: false, code: "not_found" } satisfies DiscoveryClaimResult
        }
        if (existing) {
          const validated = validateDiscoveryCheckpoint(existing)
          if (!validated.ok) {
            return {
              ok: false,
              code:
                validated.code === "invalid_cursor" || validated.code === "invalid_status"
                  ? "incompatible_contract"
                  : validated.code,
            } satisfies DiscoveryClaimResult
          }
          if (
            existing.status === "running" &&
            existing.leaseUntil &&
            Date.parse(existing.leaseUntil) > nowMs &&
            existing.leaseOwner !== owner
          ) {
            return { ok: false, code: "busy" } satisfies DiscoveryClaimResult
          }
          const claimed: CollectionDiscoveryRun = {
            ...existing,
            status: "running",
            leaseOwner: owner,
            leaseUntil,
            leaseGeneration: existing.leaseGeneration + 1,
            lastErrorClass: null,
            coverageProven: false,
            uniqueOrderProven: false,
          }
          runs.set(claimed.id, claimed)
          return { ok: true, code: "claimed", created: false, run: cloneRun(claimed) }
        }
        const created: CollectionDiscoveryRun = {
          id: randomUUID(),
          queryContractVersion: COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION,
          referenceInstant: toIso(input.referenceInstant),
          referenceDate: frozenDate,
          discoveryTimezone: COLLECTION_DISCOVERY_TIMEZONE,
          paginationStrategy: COLLECTION_DISCOVERY_PAGINATION_STRATEGY,
          cursorLastInvoicePk: null,
          status: "running",
          leaseOwner: owner,
          leaseUntil,
          leaseGeneration: 1,
          ...emptyDiscoveryCounters(),
          lastErrorClass: null,
          coverageProven: false,
          uniqueOrderProven: false,
          ...emptyDiscoveryReconciliationFields(),
        }
        runs.set(created.id, created)
        return { ok: true, code: "created", created: true, run: cloneRun(created) }
      })
    },
    advance(input) {
      return exclusive(() => {
        const run = runs.get(input.runId)
        if (!run) return { ok: false, code: "not_found" } satisfies DiscoveryWriteResult
        if (!assertWritableLease(run, input)) {
          return { ok: false, code: "stale_lease" } satisfies DiscoveryWriteResult
        }
        const next: CollectionDiscoveryRun = {
          ...run,
          cursorLastInvoicePk: input.cursorLastInvoicePk,
          ...input.counters,
          lastErrorClass: input.lastErrorClass ?? run.lastErrorClass,
          coverageProven: false,
          uniqueOrderProven: false,
        }
        runs.set(next.id, next)
        return { ok: true, run: cloneRun(next) }
      })
    },
    enterReconciliation(input) {
      return exclusive(() => {
        const run = runs.get(input.runId)
        if (!run) return { ok: false, code: "not_found" } satisfies DiscoveryWriteResult
        if (!assertWritableLease(run, input)) {
          return { ok: false, code: "stale_lease" } satisfies DiscoveryWriteResult
        }
        const next: CollectionDiscoveryRun = {
          ...run,
          phase: "reconciliation",
          coverageProven: false,
          uniqueOrderProven: false,
        }
        runs.set(next.id, next)
        return { ok: true, run: cloneRun(next) }
      })
    },
    advanceReconciliation(input) {
      return exclusive(() => {
        const run = runs.get(input.runId)
        if (!run) return { ok: false, code: "not_found" } satisfies DiscoveryWriteResult
        if (!assertWritableLease(run, input)) {
          return { ok: false, code: "stale_lease" } satisfies DiscoveryWriteResult
        }
        if (
          input.reconcileCursorInvoicePk != null &&
          !/^[1-9]\d*$/.test(input.reconcileCursorInvoicePk)
        ) {
          return { ok: false, code: "invalid_input" } satisfies DiscoveryWriteResult
        }
        const next: CollectionDiscoveryRun = {
          ...run,
          phase: "reconciliation",
          reconcileCursorInvoicePk: input.reconcileCursorInvoicePk,
          reconcileScannedCount: input.reconcileScannedCount,
          reconcileClosedCount: input.reconcileClosedCount,
          reconcileSkippedCount: input.reconcileSkippedCount,
          lastErrorClass: input.lastErrorClass ?? run.lastErrorClass,
          coverageProven: false,
          uniqueOrderProven: false,
        }
        runs.set(next.id, next)
        return { ok: true, run: cloneRun(next) }
      })
    },
    release(input) {
      return exclusive(() => {
        const run = runs.get(input.runId)
        if (!run) return { ok: false, code: "not_found" } satisfies DiscoveryWriteResult
        if (
          run.leaseOwner !== input.owner ||
          run.leaseGeneration !== input.generation ||
          run.status !== "running"
        ) {
          return { ok: false, code: "stale_lease" } satisfies DiscoveryWriteResult
        }
        const next: CollectionDiscoveryRun = {
          ...run,
          status: input.status,
          leaseOwner: null,
          leaseUntil: null,
          lastErrorClass: input.lastErrorClass ?? run.lastErrorClass,
          coverageProven: false,
          uniqueOrderProven: false,
        }
        runs.set(next.id, next)
        return { ok: true, run: cloneRun(next) }
      })
    },
  }
}

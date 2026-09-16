import { parseInvoiceListReferenceDate } from "@/lib/brbyte/overdue-invoice-list-query"
import {
  COLLECTION_DISCOVERY_PAGINATION_STRATEGY,
  COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION,
  COLLECTION_DISCOVERY_TIMEZONE,
  type CollectionDiscoveryRun,
  type CollectionDiscoveryStatus,
} from "@/lib/collections/discovery-contract"

export type DiscoveryCheckpointValidation =
  | { ok: true; run: CollectionDiscoveryRun }
  | {
      ok: false
      code:
        | "incompatible_contract"
        | "invalid_cursor"
        | "invalid_reference"
        | "run_not_resumable"
        | "invalid_status"
    }

const RESUMABLE: ReadonlySet<CollectionDiscoveryStatus> = new Set([
  "running",
  "paused",
  "failed",
])

export function isResumableDiscoveryStatus(
  status: CollectionDiscoveryStatus | string
): boolean {
  return RESUMABLE.has(status as CollectionDiscoveryStatus)
}

export function validateDiscoveryCheckpoint(
  run: CollectionDiscoveryRun
): DiscoveryCheckpointValidation {
  if (
    run.queryContractVersion !== COLLECTION_DISCOVERY_QUERY_CONTRACT_VERSION ||
    run.paginationStrategy !== COLLECTION_DISCOVERY_PAGINATION_STRATEGY ||
    run.discoveryTimezone !== COLLECTION_DISCOVERY_TIMEZONE
  ) {
    return { ok: false, code: "incompatible_contract" }
  }
  if (!parseInvoiceListReferenceDate(run.referenceDate)) {
    return { ok: false, code: "invalid_reference" }
  }
  const instant = Date.parse(run.referenceInstant)
  if (!Number.isFinite(instant)) {
    return { ok: false, code: "invalid_reference" }
  }
  if (run.cursorLastInvoicePk != null) {
    if (!/^[1-9]\d*$/.test(run.cursorLastInvoicePk)) {
      return { ok: false, code: "invalid_cursor" }
    }
  }
  if (run.status === "pagination_ended") {
    return { ok: false, code: "run_not_resumable" }
  }
  if (!isResumableDiscoveryStatus(run.status)) {
    return { ok: false, code: "invalid_status" }
  }
  return { ok: true, run }
}

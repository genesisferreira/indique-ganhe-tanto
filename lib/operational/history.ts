export const OPERATIONAL_HISTORY_SOURCES = ["crm", "controllr"] as const
export type OperationalHistorySource = (typeof OPERATIONAL_HISTORY_SOURCES)[number]

export const HUMAN_HISTORY_EVENT_TYPES = [
  "retention_attendance_started",
  "retention_attendance_completed",
  "collection_contact",
  "collection_promise_to_pay",
  "collection_payment_detected",
  "collection_closed",
] as const

export type HumanHistoryEventType = (typeof HUMAN_HISTORY_EVENT_TYPES)[number]

export const TECHNICAL_EVENT_TYPES_EXCLUDED_FROM_TIMELINE = [
  "assigned",
  "transferred",
  "created",
] as const

export type OperationalHistoryItem = {
  id: string
  clientPk: string | null
  contractPk: string | null
  documentMasked: string | null
  customerNameSnapshot: string | null
  sectorCode: string
  employeeId: string | null
  actorProfileId: string | null
  source: OperationalHistorySource
  externalHistoryId: string | null
  eventType: string
  action: string | null
  result: string | null
  notes: string | null
  customerRemains: boolean | null
  occurredAt: string
}

export type AppendOperationalHistoryInput = {
  clientPk?: string | null
  contractPk?: string | null
  documentReference?: string | null
  customerNameSnapshot?: string | null
  sectorCode: string
  employeeId?: string | null
  actorProfileId?: string | null
  eventType: HumanHistoryEventType | string
  action?: string | null
  result?: string | null
  notes?: string | null
  customerRemains?: boolean | null
  occurredAt?: string
  metadata?: Record<string, unknown>
}

export function isHumanHistoryEvent(eventType: string | null | undefined): boolean {
  return (HUMAN_HISTORY_EVENT_TYPES as readonly string[]).includes(eventType ?? "")
}

export function isTechnicalAssignmentEvent(eventType: string | null | undefined): boolean {
  return (TECHNICAL_EVENT_TYPES_EXCLUDED_FROM_TIMELINE as readonly string[]).includes(
    eventType ?? ""
  )
}

export function mergeOperationalTimeline(input: {
  crm: OperationalHistoryItem[]
  controllr: OperationalHistoryItem[]
}): OperationalHistoryItem[] {
  const seenExternal = new Set<string>()
  const merged: OperationalHistoryItem[] = []
  for (const item of [...input.crm, ...input.controllr]) {
    if (item.externalHistoryId) {
      if (seenExternal.has(item.externalHistoryId)) continue
      seenExternal.add(item.externalHistoryId)
    }
    merged.push(item)
  }
  merged.sort((a, b) => {
    const ta = Date.parse(a.occurredAt)
    const tb = Date.parse(b.occurredAt)
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
  })
  return merged
}

export function forceCrmHistorySource(_spoofed?: string | null): "crm" {
  return "crm"
}

export const CONTROLLR_HISTORY_WRITE_ENABLED = false

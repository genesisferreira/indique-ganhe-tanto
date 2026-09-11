export const COLLECTION_SECTOR_CODE = "collections" as const
export const RETENTION_SECTOR_CODE = "retention" as const

export const COLLECTION_WORK_TYPE = "collection_case" as const
export const RETENTION_WORK_TYPE = "retention_case" as const

export const COLLECTION_OVERDUE_THRESHOLD_DAYS = 5

export const COLLECTION_STATUSES = [
  "open",
  "in_contact",
  "promise_to_pay",
  "paid",
  "unresolved",
  "escalated_retention",
  "closed",
] as const

export type CollectionCaseStatus = (typeof COLLECTION_STATUSES)[number]

export const COLLECTION_OPEN_STATUSES: readonly CollectionCaseStatus[] = [
  "open",
  "in_contact",
  "promise_to_pay",
  "unresolved",
]

export const COLLECTION_TERMINAL_STATUSES: readonly CollectionCaseStatus[] = [
  "paid",
  "closed",
  "escalated_retention",
]

export const RETENTION_STATUSES = [
  "open",
  "in_contact",
  "offer_made",
  "retained",
  "not_retained",
  "cancelled",
  "closed",
] as const

export type RetentionCaseStatus = (typeof RETENTION_STATUSES)[number]

export const RETENTION_SOURCES = [
  "collections_escalation",
  "manual",
  "future_erp",
] as const

export type RetentionCaseSource = (typeof RETENTION_SOURCES)[number]

export const CONTACT_CHANNELS = ["phone", "whatsapp", "email", "other"] as const
export type ContactChannel = (typeof CONTACT_CHANNELS)[number]

export const CONTACT_OUTCOMES = [
  "no_answer",
  "contacted",
  "promised_payment",
  "refused",
  "callback",
  "other",
] as const
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number]

export const COLLECTION_CASE_EVENT_TYPES = [
  "created",
  "assigned",
  "contact_attempt",
  "promise_to_pay",
  "payment_detected",
  "status_changed",
  "escalated",
  "transferred",
  "closed",
] as const
export type CollectionCaseEventType = (typeof COLLECTION_CASE_EVENT_TYPES)[number]

export const RETENTION_CASE_EVENT_TYPES = [
  "created",
  "assigned",
  "contact_attempt",
  "offer_made",
  "retained",
  "not_retained",
  "status_changed",
  "transferred",
  "closed",
] as const
export type RetentionCaseEventType = (typeof RETENTION_CASE_EVENT_TYPES)[number]

export type CollectionCase = {
  id: string
  clientPk: string | null
  contractPk: string | null
  invoicePk: string | null
  customerName: string | null
  customerDocument: string | null
  daysOverdue: number
  overdueSince: string | null
  outstandingAmount: number | null
  status: CollectionCaseStatus
  sectorAssignmentId: string | null
  erpSnapshot: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

export type RetentionCase = {
  id: string
  clientPk: string | null
  contractPk: string | null
  source: RetentionCaseSource
  reason: string | null
  status: RetentionCaseStatus
  linkedCollectionCaseId: string | null
  sectorAssignmentId: string | null
  erpSnapshot: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

export type OperationalContactAttempt = {
  id: string
  caseType: typeof COLLECTION_WORK_TYPE | typeof RETENTION_WORK_TYPE
  caseId: string
  channel: ContactChannel
  outcome: ContactOutcome
  notes: string | null
  actorProfileId: string
  createdAt: string
}

export type CollectionCaseEvent = {
  id: string
  caseId: string
  eventType: CollectionCaseEventType | string
  actorProfileId: string | null
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type RetentionCaseEvent = {
  id: string
  caseId: string
  eventType: RetentionCaseEventType | string
  actorProfileId: string | null
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type CollectionCaseListItem = CollectionCase & {
  assigneeEmployeeId: string | null
  assigneeName: string | null
  lastContactAt: string | null
}

export type RetentionCaseListItem = RetentionCase & {
  assigneeEmployeeId: string | null
  assigneeName: string | null
  lastContactAt: string | null
}

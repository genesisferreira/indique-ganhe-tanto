export type SectorAssignmentMode = "round_robin"

export type SectorAssignmentStatus = "active" | "completed" | "released" | "cancelled"

export type SectorAssignmentSource = "auto_assign" | "transfer" | "claim" | "redistribute"

export type SectorAssignmentEventType =
  | "assigned"
  | "transferred"
  | "released"
  | "redistributed"
  | "claimed"
  | "completed"
  | "cancelled"

export const SECTOR_ASSIGNMENT_MODES: readonly SectorAssignmentMode[] = ["round_robin"]

export const SECTOR_ASSIGNMENT_STATUSES: readonly SectorAssignmentStatus[] = [
  "active",
  "completed",
  "released",
  "cancelled",
]

export const SECTOR_ASSIGNMENT_SOURCES: readonly SectorAssignmentSource[] = [
  "auto_assign",
  "transfer",
  "claim",
  "redistribute",
]

export const SECTOR_ASSIGNMENT_EVENT_TYPES: readonly SectorAssignmentEventType[] = [
  "assigned",
  "transferred",
  "released",
  "redistributed",
  "claimed",
  "completed",
  "cancelled",
]

export type SectorAssignmentSettings = {
  sectorId: string
  assignmentMode: SectorAssignmentMode
  isEnabled: boolean
  dailyLimitDefault: number
  maxActiveAssignmentsDefault: number | null
  allowManualClaim: boolean
  allowTransfer: boolean
  allowRedistribution: boolean
  createdAt: string
  updatedAt: string
}

export type EmployeeSectorAssignmentSettings = {
  id: string
  membershipId: string
  employeeId: string
  sectorId: string
  receivingAssignments: boolean
  isAvailable: boolean
  dailyLimit: number | null
  maxActiveAssignments: number | null
  activeAssignments: number
  totalReceivedToday: number
  lastAssignmentAt: string | null
  lastDailyResetOn: string | null
  createdAt: string
  updatedAt: string
}

export type SectorWorkAssignment = {
  id: string
  sectorId: string
  employeeId: string
  membershipId: string
  workType: string
  workId: string
  status: SectorAssignmentStatus
  assignedAt: string
  releasedAt: string | null
  previousAssignmentId: string | null
  previousEmployeeId: string | null
  assignmentSource: SectorAssignmentSource
  actorProfileId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type SectorAssignmentEvent = {
  id: string
  assignmentId: string
  sectorId: string
  employeeId: string
  eventType: SectorAssignmentEventType | string
  actorProfileId: string | null
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type SectorWorkItemRef = {
  sectorCode: string
  workType: string
  workId: string
}

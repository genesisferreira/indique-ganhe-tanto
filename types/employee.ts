export type EmployeeStatus =
  | "active"
  | "paused"
  | "vacation"
  | "away"
  | "dismissed"

export const EMPLOYEE_STATUSES: readonly EmployeeStatus[] = [
  "active",
  "paused",
  "vacation",
  "away",
  "dismissed",
] as const

export const CREATABLE_EMPLOYEE_STATUSES = [
  "active",
  "paused",
  "vacation",
  "away",
] as const satisfies readonly EmployeeStatus[]

export type CreatableEmployeeStatus = (typeof CREATABLE_EMPLOYEE_STATUSES)[number]

export const INITIAL_SECTOR_CODES = [
  "commercial",
  "collections",
  "retention",
  "post_sale",
  "upgrade",
  "technician",
  "external_sales",
] as const

export type SectorCode = (typeof INITIAL_SECTOR_CODES)[number]

export const INITIAL_SECTORS: ReadonlyArray<{
  code: SectorCode
  name: string
}> = [
  { code: "commercial", name: "Comercial" },
  { code: "collections", name: "Cobrança" },
  { code: "retention", name: "Retenção" },
  { code: "post_sale", name: "Pós-venda" },
  { code: "upgrade", name: "Upgrade" },
  { code: "technician", name: "Técnico" },
  { code: "external_sales", name: "Vendas Externas" },
]

export type EmployeeEventType =
  | "employee_created"
  | "status_changed"
  | "sector_added"
  | "sector_removed"
  | "employee_dismissed"
  | "employee_reactivated"
  | "availability_changed"
  | "assignment_received"
  | "assignment_transferred"

export type Employee = {
  id: string
  profileId: string
  status: EmployeeStatus
  hiredAt: string | null
  dismissedAt: string | null
  notes: string | null
  jobTitle: string | null
  birthDate: string | null
  managerEmployeeId: string | null
  createdAt: string
  updatedAt: string
}

export type Sector = {
  id: string
  code: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type EmployeeSectorMembership = {
  id: string
  employeeId: string
  sectorId: string
  isActive: boolean
  joinedAt: string
  leftAt: string | null
  createdAt: string
  updatedAt: string
}

export type EmployeeEvent = {
  id: string
  employeeId: string
  eventType: string
  sectorId: string | null
  actorProfileId: string | null
  oldValue: Record<string, unknown> | null
  newValue: Record<string, unknown> | null
  metadata: Record<string, unknown>
  createdAt: string
}

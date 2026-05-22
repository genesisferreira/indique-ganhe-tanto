/** SLA comercial escalonado: 15 / 30 / 45 min após assigned_at. */

export const COMMERCIAL_SLA_MINUTES_WARNING = 15
export const COMMERCIAL_SLA_MINUTES_CRITICAL = 30
export const COMMERCIAL_SLA_MINUTES_REDISTRIBUTION = 45

/** @deprecated Use COMMERCIAL_SLA_MINUTES_WARNING */
export const COMMERCIAL_SLA_MINUTES = COMMERCIAL_SLA_MINUTES_WARNING

export const COMMERCIAL_SLA_ELIGIBLE_STATUSES = new Set([
  "pendente",
  "em_atendimento",
  "em_andamento",
  "em_negociacao",
])

export type CommercialSlaLevel =
  | "none"
  | "warning"
  | "critical"
  | "redistribution_ready"

export type CommercialSlaCheckInput = {
  commercialProfileId?: string | null
  assignedAt?: Date | string | null
  firstResponseAt?: Date | string | null
  status: string
  now?: Date
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function isEligibleForSla(input: CommercialSlaCheckInput): boolean {
  if (!input.commercialProfileId) return false
  if (!toDate(input.assignedAt)) return false
  if (input.firstResponseAt != null && toDate(input.firstResponseAt)) return false
  return COMMERCIAL_SLA_ELIGIBLE_STATUSES.has(input.status)
}

export function getCommercialSlaLevel(
  input: CommercialSlaCheckInput
): CommercialSlaLevel {
  if (!isEligibleForSla(input)) return "none"

  const assigned = toDate(input.assignedAt)!
  const now = input.now ?? new Date()
  const elapsedMs = now.getTime() - assigned.getTime()

  if (elapsedMs >= COMMERCIAL_SLA_MINUTES_REDISTRIBUTION * 60 * 1000) {
    return "redistribution_ready"
  }
  if (elapsedMs >= COMMERCIAL_SLA_MINUTES_CRITICAL * 60 * 1000) {
    return "critical"
  }
  if (elapsedMs >= COMMERCIAL_SLA_MINUTES_WARNING * 60 * 1000) {
    return "warning"
  }
  return "none"
}

/** Legado: true se nível >= warning (15 min). */
export function isCommercialLeadSlaOverdue(
  input: CommercialSlaCheckInput
): boolean {
  return getCommercialSlaLevel(input) !== "none"
}

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

export function devLogCommercialSla(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[commercial-sla]", ...args)
}

export function devLogCommercialSlaOverdue(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[commercial-sla:overdue]", ...args)
}

export function devLogCommercialSlaWarning(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[commercial-sla:warning]", ...args)
}

export function devLogCommercialSlaCritical(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[commercial-sla:critical]", ...args)
}

export function devLogCommercialSlaRedistributionReady(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[commercial-sla:redistribution-ready]", ...args)
}

export function devLogCommercialSlaNotification(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[commercial-sla:notification]", ...args)
}

export function devLogCommercialSlaLevel(
  level: CommercialSlaLevel,
  context: unknown
): void {
  if (!isDev() || level === "none") return
  switch (level) {
    case "warning":
      devLogCommercialSlaWarning(context)
      break
    case "critical":
      devLogCommercialSlaCritical(context)
      break
    case "redistribution_ready":
      devLogCommercialSlaRedistributionReady(context)
      break
    default:
      break
  }
}

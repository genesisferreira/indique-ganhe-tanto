export const COLLECTION_DEFAULT_MIN_DAYS_OVERDUE = 5
export const COLLECTION_MIN_DAYS_OVERDUE = 1
export const COLLECTION_MAX_DAYS_OVERDUE = 365

export const OPERATIONAL_SECTOR_CODES = [
  "collections",
  "retention",
  "post_sale",
  "upgrade",
  "technician",
  "commercial",
  "external_sales",
] as const

export type OperationalSectorCodeSetting = (typeof OPERATIONAL_SECTOR_CODES)[number]

export type CollectionOperationalSettings = {
  isEnabled: boolean
  minimumDaysOverdue: number
  includeCancelledCustomers: boolean
  cancelledFilterOperational: false
}

export const COLLECTION_SETTINGS_DEFAULTS: CollectionOperationalSettings = {
  isEnabled: true,
  minimumDaysOverdue: COLLECTION_DEFAULT_MIN_DAYS_OVERDUE,
  includeCancelledCustomers: false,
  cancelledFilterOperational: false,
}

export type CollectionSettingsPatch = {
  isEnabled?: unknown
  minimumDaysOverdue?: unknown
  includeCancelledCustomers?: unknown
}

export type SettingsValidation =
  | { ok: true; settings: CollectionOperationalSettings }
  | { ok: false; message: string }

function asBoolean(value: unknown, fallback: boolean): boolean | null {
  if (value === undefined || value === null) return fallback
  if (typeof value === "boolean") return value
  return null
}

function asDays(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null) return fallback
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    if (Number.isInteger(n)) return n
  }
  return null
}

export function parseCollectionSettingsJson(
  raw: Record<string, unknown> | null | undefined,
  isEnabled = true
): CollectionOperationalSettings {
  const days = asDays(raw?.minimum_days_overdue ?? raw?.minimumDaysOverdue, COLLECTION_DEFAULT_MIN_DAYS_OVERDUE)
  const include = asBoolean(
    raw?.include_cancelled_customers ?? raw?.includeCancelledCustomers,
    false
  )
  return {
    isEnabled,
    minimumDaysOverdue:
      days != null && days >= COLLECTION_MIN_DAYS_OVERDUE && days <= COLLECTION_MAX_DAYS_OVERDUE
        ? days
        : COLLECTION_DEFAULT_MIN_DAYS_OVERDUE,
    includeCancelledCustomers: include === true,
    cancelledFilterOperational: false,
  }
}

export function validateCollectionSettingsPatch(
  patch: CollectionSettingsPatch,
  current: CollectionOperationalSettings = COLLECTION_SETTINGS_DEFAULTS
): SettingsValidation {
  const isEnabled = asBoolean(patch.isEnabled, current.isEnabled)
  if (isEnabled == null) {
    return { ok: false, message: "Cobrança ativa deve ser verdadeiro ou falso." }
  }

  const days = asDays(patch.minimumDaysOverdue, current.minimumDaysOverdue)
  if (days == null) {
    return { ok: false, message: "Dias mínimos de atraso inválidos." }
  }
  if (days < COLLECTION_MIN_DAYS_OVERDUE) {
    return { ok: false, message: "Dias mínimos de atraso devem ser no mínimo 1." }
  }
  if (days > COLLECTION_MAX_DAYS_OVERDUE) {
    return { ok: false, message: "Dias mínimos de atraso acima do limite." }
  }

  const include = asBoolean(patch.includeCancelledCustomers, current.includeCancelledCustomers)
  if (include == null) {
    return { ok: false, message: "Incluir cancelados deve ser verdadeiro ou falso." }
  }

  return {
    ok: true,
    settings: {
      isEnabled,
      minimumDaysOverdue: days,
      includeCancelledCustomers: include,
      cancelledFilterOperational: false,
    },
  }
}

export function collectionSettingsToRow(settings: CollectionOperationalSettings): {
  is_enabled: boolean
  settings: Record<string, unknown>
} {
  return {
    is_enabled: settings.isEnabled,
    settings: {
      minimum_days_overdue: settings.minimumDaysOverdue,
      include_cancelled_customers: settings.includeCancelledCustomers,
      cancelled_filter_operational: false,
    },
  }
}

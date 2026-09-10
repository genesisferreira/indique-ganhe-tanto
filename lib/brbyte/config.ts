import "server-only"

export type BrbyteCreateInterestConfig = {
  enabled: boolean
  apiUrl: string
  apiUser: string
  apiPassword: string
  defaultLeadPk: string
  defaultInterestStatus: string
  defaultPlanPk: string
  timeoutMs: number
}

function parseTruthy(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value ?? "")
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function isBrbyteCreateInterestEnabled(): boolean {
  return parseTruthy(process.env.BRBYTE_CREATE_INTEREST_ENABLED)
}

export function isBrbyteAutoCreateInterestOnReferralEnabled(): boolean {
  return (
    isBrbyteCreateInterestEnabled() &&
    parseTruthy(process.env.BRBYTE_AUTO_CREATE_INTEREST_ON_REFERRAL)
  )
}

export function isBrbyteSyncEnabled(): boolean {
  return parseTruthy(process.env.BRBYTE_SYNC_ENABLED)
}

export function isBrbyteAutoCheckConversionEnabled(): boolean {
  return (
    isBrbyteSyncEnabled() &&
    parseTruthy(process.env.BRBYTE_AUTO_CHECK_CONVERSION)
  )
}

export function isBrbyteAutoCheckFirstInvoiceEnabled(): boolean {
  return (
    isBrbyteSyncEnabled() &&
    parseTruthy(process.env.BRBYTE_AUTO_CHECK_FIRST_INVOICE)
  )
}

/** Autoriza crédito automático após detecção da 1ª fatura. Independente de AUTO_CHECK. */
export function isBrbyteAutoMarkPaidEnabled(): boolean {
  return parseTruthy(process.env.BRBYTE_AUTO_MARK_PAID_ENABLED)
}

export function getBrbyteSyncBatchSize(): number {
  return parsePositiveInt(process.env.BRBYTE_SYNC_BATCH_SIZE, 20)
}

export function getBrbyteSyncMaxAttempts(): number {
  return parsePositiveInt(process.env.BRBYTE_SYNC_MAX_ATTEMPTS, 5)
}

export function getBrbyteSyncRetryMinutes(): number {
  return parsePositiveInt(process.env.BRBYTE_SYNC_RETRY_MINUTES, 60)
}

function buildCreateInterestConfig(options?: {
  requireCreateFlag?: boolean
  preferPublicPlanPk?: boolean
}): BrbyteCreateInterestConfig | null {
  const requireCreateFlag = options?.requireCreateFlag !== false
  const enabled = isBrbyteCreateInterestEnabled()
  if (requireCreateFlag && !enabled) return null

  const apiUrl = process.env.BRBYTE_API_URL?.trim() ?? ""
  const apiUser = process.env.BRBYTE_API_USER?.trim() ?? ""
  const apiPassword = process.env.BRBYTE_API_PASSWORD?.trim() ?? ""
  const defaultLeadPk = process.env.BRBYTE_DEFAULT_LEAD_PK?.trim() ?? ""
  const defaultInterestStatus =
    process.env.BRBYTE_DEFAULT_INTEREST_STATUS?.trim() ?? ""
  const defaultPlanPk = options?.preferPublicPlanPk
    ? process.env.PUBLIC_PRE_REGISTRATION_DEFAULT_BRBYTE_PLAN_PK?.trim() ||
      process.env.BRBYTE_DEFAULT_PLAN_PK?.trim() ||
      ""
    : process.env.BRBYTE_DEFAULT_PLAN_PK?.trim() ?? ""
  const timeoutMs = Number(process.env.BRBYTE_SYNC_TIMEOUT_MS ?? "30000")

  if (
    !apiUrl ||
    !apiUser ||
    !apiPassword ||
    !defaultLeadPk ||
    !defaultInterestStatus ||
    !defaultPlanPk
  ) {
    return null
  }

  return {
    enabled: true,
    apiUrl,
    apiUser,
    apiPassword,
    defaultLeadPk,
    defaultInterestStatus,
    defaultPlanPk,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
  }
}

export function getBrbyteCreateInterestConfig(): BrbyteCreateInterestConfig | null {
  return buildCreateInterestConfig({ requireCreateFlag: true })
}

/** Configuração BRByte para fluxo público (não exige BRBYTE_CREATE_INTEREST_ENABLED). */
export function getBrbyteCreateInterestConfigForIntegration(): BrbyteCreateInterestConfig | null {
  return buildCreateInterestConfig({
    requireCreateFlag: false,
    preferPublicPlanPk: true,
  })
}

/** Credenciais operacionais para cron/consulta (login + defaults). */
export function getBrbyteOperationalConfig(): BrbyteCreateInterestConfig | null {
  return buildCreateInterestConfig({ requireCreateFlag: false })
}

export function isBrbyteCreateInterestConfigured(): boolean {
  return getBrbyteCreateInterestConfig() !== null
}

export type BrbytePublicIntegrationFlags = {
  createInterestEnabled: boolean
  autoCreateInterestOnReferralEnabled: boolean
  syncEnabled: boolean
  autoCheckConversionEnabled: boolean
  autoCheckFirstInvoiceEnabled: boolean
  autoMarkPaidEnabled: boolean
  apiUrlConfigured: boolean
  apiUrlHost: string | null
  isDemoEnvironment: boolean
}

/** Flags e metadados públicos para painel admin (sem credenciais). */
export function getBrbytePublicIntegrationFlags(): BrbytePublicIntegrationFlags {
  const apiUrl = process.env.BRBYTE_API_URL?.trim() ?? ""
  let apiUrlHost: string | null = null
  if (apiUrl) {
    try {
      apiUrlHost = new URL(apiUrl).host
    } catch {
      apiUrlHost = apiUrl.replace(/^https?:\/\//i, "").split("/")[0] || null
    }
  }

  const hostLower = (apiUrlHost ?? apiUrl).toLowerCase()
  const isDemoEnvironment = hostLower.includes("demo.controllr.com.br")

  return {
    createInterestEnabled: isBrbyteCreateInterestEnabled(),
    autoCreateInterestOnReferralEnabled:
      isBrbyteAutoCreateInterestOnReferralEnabled(),
    syncEnabled: isBrbyteSyncEnabled(),
    autoCheckConversionEnabled: isBrbyteAutoCheckConversionEnabled(),
    autoCheckFirstInvoiceEnabled: isBrbyteAutoCheckFirstInvoiceEnabled(),
    autoMarkPaidEnabled: isBrbyteAutoMarkPaidEnabled(),
    apiUrlConfigured: Boolean(apiUrl),
    apiUrlHost,
    isDemoEnvironment,
  }
}

export type BrbyteConnectionConfig = {
  apiUrl: string
  apiUser: string
  apiPassword: string
  timeoutMs: number
}

/** Credenciais mínimas para teste de conexão (login). */
export function getBrbyteConnectionConfig(): BrbyteConnectionConfig | null {
  const apiUrl = process.env.BRBYTE_API_URL?.trim() ?? ""
  const apiUser = process.env.BRBYTE_API_USER?.trim() ?? ""
  const apiPassword = process.env.BRBYTE_API_PASSWORD?.trim() ?? ""
  const timeoutMs = Number(process.env.BRBYTE_SYNC_TIMEOUT_MS ?? "30000")

  if (!apiUrl || !apiUser || !apiPassword) return null

  return {
    apiUrl,
    apiUser,
    apiPassword,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
  }
}

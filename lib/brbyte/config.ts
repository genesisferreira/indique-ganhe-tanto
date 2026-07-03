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

export function isBrbyteCreateInterestEnabled(): boolean {
  return parseTruthy(process.env.BRBYTE_CREATE_INTEREST_ENABLED)
}

export function getBrbyteCreateInterestConfig(): BrbyteCreateInterestConfig | null {
  const enabled = isBrbyteCreateInterestEnabled()
  if (!enabled) return null

  const apiUrl = process.env.BRBYTE_API_URL?.trim() ?? ""
  const apiUser = process.env.BRBYTE_API_USER?.trim() ?? ""
  const apiPassword = process.env.BRBYTE_API_PASSWORD?.trim() ?? ""
  const defaultLeadPk = process.env.BRBYTE_DEFAULT_LEAD_PK?.trim() ?? ""
  const defaultInterestStatus =
    process.env.BRBYTE_DEFAULT_INTEREST_STATUS?.trim() ?? ""
  const defaultPlanPk = process.env.BRBYTE_DEFAULT_PLAN_PK?.trim() ?? ""
  const timeoutMs = Number(process.env.BRBYTE_SYNC_TIMEOUT_MS ?? "30000")

  const config: BrbyteCreateInterestConfig = {
    enabled: true,
    apiUrl,
    apiUser,
    apiPassword,
    defaultLeadPk,
    defaultInterestStatus,
    defaultPlanPk,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
  }

  if (!enabled) return null

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

  return config
}

export function isBrbyteCreateInterestConfigured(): boolean {
  return getBrbyteCreateInterestConfig() !== null
}

function parseTruthyEnv(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

export function isBrbyteSyncEnabled(): boolean {
  return parseTruthyEnv(process.env.BRBYTE_SYNC_ENABLED)
}

export function isBrbyteAutoMarkPaidEnabled(): boolean {
  return parseTruthyEnv(process.env.BRBYTE_AUTO_MARK_PAID_ENABLED)
}

export type BrbytePublicIntegrationFlags = {
  createInterestEnabled: boolean
  syncEnabled: boolean
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
    syncEnabled: isBrbyteSyncEnabled(),
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

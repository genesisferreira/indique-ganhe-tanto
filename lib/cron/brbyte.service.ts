import "server-only"

const LOG_CONFIG = "[brbyte:config]"
const LOG_FETCH = "[brbyte:fetch]"
const LOG_SYNC = "[brbyte:sync]"
const LOG_ERROR = "[brbyte:error]"

export type BrbyteServiceConfig = {
  enabled: boolean
  apiUrl: string
  apiKey: string
  timeoutMs: number
}

export type BrbyteRemoteRecord = {
  externalId: string
  status?: string | null
  raw: Record<string, unknown>
}

export type BrbyteSyncPhaseError = {
  code: string
  message: string
  detail?: unknown
}

export type BrbyteSyncResult = {
  ok: boolean
  skipped: boolean
  reason?: string
  configured: boolean
  apiReachable: boolean | null
  durationMs: number
  fetched: number
  processed: number
  skippedRecords: number
  created: number
  updated: number
  errors: BrbyteSyncPhaseError[]
  message?: string
}

function logInfo(tag: string, payload?: unknown): void {
  if (payload !== undefined) {
    console.log(tag, payload)
  } else {
    console.log(tag)
  }
}

function logWarn(tag: string, payload?: unknown): void {
  if (payload !== undefined) {
    console.warn(tag, payload)
  } else {
    console.warn(tag)
  }
}

function logError(payload: unknown): void {
  console.error(LOG_ERROR, payload)
}

function parseEnabled(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

/**
 * Lê configuração BRByte do ambiente (sem lançar).
 */
export function getBrbyteServiceConfig(): BrbyteServiceConfig | null {
  const apiUrl = process.env.BRBYTE_API_URL?.trim() ?? ""
  const apiKey = process.env.BRBYTE_API_KEY?.trim() ?? ""
  const enabled = parseEnabled(process.env.BRBYTE_SYNC_ENABLED)
  const timeoutMs = Number(process.env.BRBYTE_SYNC_TIMEOUT_MS ?? "30000")

  const config: BrbyteServiceConfig = {
    enabled,
    apiUrl,
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
  }

  logInfo(LOG_CONFIG, {
    enabled: config.enabled,
    hasApiUrl: Boolean(config.apiUrl),
    hasApiKey: Boolean(config.apiKey),
    timeoutMs: config.timeoutMs,
  })

  if (!config.enabled) {
    return config
  }

  if (!config.apiUrl || !config.apiKey) {
    logWarn(LOG_CONFIG, {
      reason: "BRBYTE_SYNC_ENABLED sem BRBYTE_API_URL ou BRBYTE_API_KEY",
    })
    return null
  }

  return config
}

function buildBrbyteHeaders(apiKey: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-API-Key": apiKey,
  }
}

/**
 * Ping leve na API BRByte (preparado — ajustar path quando documentação estiver disponível).
 */
export async function pingBrbyteApi(
  config: BrbyteServiceConfig
): Promise<{ ok: boolean; status: number | null; message?: string }> {
  const base = config.apiUrl.replace(/\/$/, "")
  const url = `${base}/health`

  logInfo(LOG_FETCH, { step: "ping", url })

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    const res = await fetch(url, {
      method: "GET",
      headers: buildBrbyteHeaders(config.apiKey),
      signal: controller.signal,
      cache: "no-store",
    })

    clearTimeout(timeout)

    logInfo(LOG_FETCH, { step: "ping", status: res.status, ok: res.ok })

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: `HTTP ${res.status}`,
      }
    }

    return { ok: true, status: res.status }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError({ step: "ping", message })
    return { ok: false, status: null, message }
  }
}

/**
 * Busca registros na BRByte (estrutura preparada — endpoint a confirmar com fornecedor).
 */
export async function fetchBrbyteRemoteRecords(
  config: BrbyteServiceConfig
): Promise<{ ok: boolean; records: BrbyteRemoteRecord[]; message?: string }> {
  const base = config.apiUrl.replace(/\/$/, "")
  const url = `${base}/api/v1/referrals/sync`

  logInfo(LOG_FETCH, { step: "list", url })

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    const res = await fetch(url, {
      method: "GET",
      headers: buildBrbyteHeaders(config.apiKey),
      signal: controller.signal,
      cache: "no-store",
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      logWarn(LOG_FETCH, {
        step: "list",
        status: res.status,
        bodyPreview: text.slice(0, 200),
      })
      return {
        ok: false,
        records: [],
        message: `BRByte list HTTP ${res.status}`,
      }
    }

    const json = (await res.json()) as unknown
    const records = normalizeBrbyteListPayload(json)

    logInfo(LOG_FETCH, {
      step: "list",
      status: res.status,
      count: records.length,
    })

    return { ok: true, records }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logError({ step: "list", message })
    return { ok: false, records: [], message }
  }
}

function normalizeBrbyteListPayload(payload: unknown): BrbyteRemoteRecord[] {
  if (!payload || typeof payload !== "object") return []

  const root = payload as Record<string, unknown>
  const list = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.items)
      ? root.items
      : Array.isArray(payload)
        ? payload
        : []

  const out: BrbyteRemoteRecord[] = []

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue
    const row = entry as Record<string, unknown>
    const externalId =
      typeof row.id === "string"
        ? row.id
        : typeof row.external_id === "string"
          ? row.external_id
          : typeof row.referral_id === "string"
            ? row.referral_id
            : null
    if (!externalId) continue
    out.push({
      externalId,
      status: typeof row.status === "string" ? row.status : null,
      raw: row,
    })
  }

  return out
}

/**
 * Persistência local — placeholder seguro até mapeamento BRByte ↔ Supabase (ETAPA 5+).
 */
export async function persistBrbyteRecords(
  records: BrbyteRemoteRecord[]
): Promise<{
  processed: number
  skipped: number
  created: number
  updated: number
  errors: BrbyteSyncPhaseError[]
}> {
  logInfo(LOG_SYNC, {
    step: "persist",
    total: records.length,
    note: "placeholder — integração Supabase na próxima sub-etapa",
  })

  return {
    processed: 0,
    skipped: records.length,
    created: 0,
    updated: 0,
    errors: [],
  }
}

/**
 * Orquestra sincronização BRByte (config → ping → fetch → persist).
 */
export async function runBrbyteSync(): Promise<BrbyteSyncResult> {
  const started = Date.now()
  const errors: BrbyteSyncPhaseError[] = []

  logInfo(LOG_SYNC, { step: "start" })

  const config = getBrbyteServiceConfig()

  if (!config) {
    return {
      ok: false,
      skipped: true,
      reason: "invalid_config",
      configured: false,
      apiReachable: null,
      durationMs: Date.now() - started,
      fetched: 0,
      processed: 0,
      skippedRecords: 0,
      created: 0,
      updated: 0,
      errors: [
        {
          code: "invalid_config",
          message:
            "BRBYTE_SYNC_ENABLED=true requer BRBYTE_API_URL e BRBYTE_API_KEY",
        },
      ],
      message: "Configuração BRByte incompleta",
    }
  }

  if (!config.enabled) {
    logInfo(LOG_SYNC, { step: "skip", reason: "BRBYTE_SYNC_ENABLED=false" })
    return {
      ok: true,
      skipped: true,
      reason: "disabled",
      configured: Boolean(config.apiUrl && config.apiKey),
      apiReachable: null,
      durationMs: Date.now() - started,
      fetched: 0,
      processed: 0,
      skippedRecords: 0,
      created: 0,
      updated: 0,
      errors: [],
      message: "Sincronização BRByte desabilitada (BRBYTE_SYNC_ENABLED)",
    }
  }

  const ping = await pingBrbyteApi(config)
  if (!ping.ok) {
    errors.push({
      code: "api_unreachable",
      message: ping.message ?? "BRByte API não respondeu",
      detail: { status: ping.status },
    })
    return {
      ok: false,
      skipped: false,
      reason: "api_unreachable",
      configured: true,
      apiReachable: false,
      durationMs: Date.now() - started,
      fetched: 0,
      processed: 0,
      skippedRecords: 0,
      created: 0,
      updated: 0,
      errors,
      message: ping.message,
    }
  }

  const fetchResult = await fetchBrbyteRemoteRecords(config)
  if (!fetchResult.ok) {
    errors.push({
      code: "fetch_failed",
      message: fetchResult.message ?? "Falha ao buscar registros BRByte",
    })
    return {
      ok: false,
      skipped: false,
      reason: "fetch_failed",
      configured: true,
      apiReachable: true,
      durationMs: Date.now() - started,
      fetched: 0,
      processed: 0,
      skippedRecords: 0,
      created: 0,
      updated: 0,
      errors,
      message: fetchResult.message,
    }
  }

  const persist = await persistBrbyteRecords(fetchResult.records)
  errors.push(...persist.errors)

  const durationMs = Date.now() - started
  const result: BrbyteSyncResult = {
    ok: true,
    skipped: false,
    configured: true,
    apiReachable: true,
    durationMs,
    fetched: fetchResult.records.length,
    processed: persist.processed,
    skippedRecords: persist.skipped,
    created: persist.created,
    updated: persist.updated,
    errors,
    message: "Sincronização BRByte concluída (persistência local preparada)",
  }

  logInfo(LOG_SYNC, { step: "done", ...result })

  return result
}

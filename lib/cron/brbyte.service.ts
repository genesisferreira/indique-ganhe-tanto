import "server-only"

import { createServiceRoleClient } from "@/lib/supabase/service-role"
import {
  matchReferralToBrbyteCustomer,
  normalizeDocument,
  normalizeEmail,
  normalizePhone,
} from "@/lib/cron/brbyte-match"
import {
  BRBYTE_API_PATHS,
  type BrbyteApiEnvelope,
  type BrbyteClienteDto,
  type BrbyteContratoDto,
  type BrbytePaymentSnapshotInsert,
  type BrbyteSyncRunRow,
  type BrbyteSyncRunStatus,
  type BrbyteTerceroDto,
  type ReferralBrbyteMatchInput,
} from "@/types/brbyte"

const LOG_CONFIG = "[brbyte:config]"
const LOG_FETCH = "[brbyte:fetch]"
const LOG_SYNC = "[brbyte:sync]"
const LOG_DB = "[brbyte:db]"
const LOG_ERROR = "[brbyte:error]"

/** Pagamento automático desligado até endpoint oficial de cobrança. */
export const BRBYTE_AUTO_MARK_PAID_ENABLED = false

const MAX_REFERRALS_PER_RUN = 50
const FETCH_MAX_ATTEMPTS = 2
const FETCH_RETRY_DELAY_MS = 400

export type BrbyteServiceConfig = {
  enabled: boolean
  apiUrl: string
  apiKey: string
  timeoutMs: number
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
  syncRunId: string | null
  durationMs: number
  fetched: number
  processed: number
  matched: number
  snapshotsUpserted: number
  markedPaid: number
  skippedRecords: number
  errors: BrbyteSyncPhaseError[]
  message?: string
  autoMarkPaidEnabled: boolean
}

function logInfo(tag: string, payload?: unknown): void {
  if (payload !== undefined) console.log(tag, payload)
  else console.log(tag)
}

function logWarn(tag: string, payload?: unknown): void {
  if (payload !== undefined) console.warn(tag, payload)
  else console.warn(tag)
}

function logError(payload: unknown): void {
  console.error(LOG_ERROR, payload)
}

function parseEnabled(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
    autoMarkPaid: BRBYTE_AUTO_MARK_PAID_ENABLED,
  })

  if (!config.enabled) return config

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
  }
}

type FetchJsonResult<T> = {
  ok: boolean
  status: number | null
  data: T | null
  message?: string
}

async function fetchBrbyteJson<T>(
  config: BrbyteServiceConfig,
  path: string,
  options?: { query?: Record<string, string | number | undefined> }
): Promise<FetchJsonResult<T>> {
  const base = config.apiUrl.replace(/\/$/, "")
  const url = new URL(`${base}${path.startsWith("/") ? path : `/${path}`}`)

  if (options?.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v))
    }
  }

  let lastMessage: string | undefined

  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: buildBrbyteHeaders(config.apiKey),
        signal: controller.signal,
        cache: "no-store",
      })

      clearTimeout(timeout)

      if (!res.ok) {
        const text = await res.text().catch(() => "")
        lastMessage = `HTTP ${res.status}`
        logWarn(LOG_FETCH, {
          path,
          attempt,
          status: res.status,
          bodyPreview: text.slice(0, 200),
        })
        if (attempt < FETCH_MAX_ATTEMPTS) {
          await sleep(FETCH_RETRY_DELAY_MS * attempt)
          continue
        }
        return { ok: false, status: res.status, data: null, message: lastMessage }
      }

      const json = (await res.json()) as T | BrbyteApiEnvelope<T>
      const data =
        json &&
        typeof json === "object" &&
        "data" in (json as BrbyteApiEnvelope<T>) &&
        (json as BrbyteApiEnvelope<T>).data !== undefined
          ? (json as BrbyteApiEnvelope<T>).data ?? null
          : (json as T)

      return { ok: true, status: res.status, data }
    } catch (e) {
      lastMessage = e instanceof Error ? e.message : String(e)
      logError({ path, attempt, message: lastMessage })
      if (attempt < FETCH_MAX_ATTEMPTS) {
        await sleep(FETCH_RETRY_DELAY_MS * attempt)
        continue
      }
    }
  }

  return { ok: false, status: null, data: null, message: lastMessage }
}

export async function pingBrbyteApi(
  config: BrbyteServiceConfig
): Promise<{ ok: boolean; status: number | null; message?: string }> {
  logInfo(LOG_FETCH, { step: "ping", path: BRBYTE_API_PATHS.ping })
  const result = await fetchBrbyteJson<unknown>(config, BRBYTE_API_PATHS.ping, {
    query: { Size: 1, PageNumber: 0 },
  })
  return {
    ok: result.ok,
    status: result.status,
    message: result.message,
  }
}

/** Placeholder: busca tercero por documento (endpoint documentado). */
export async function fetchBrbyteTercerosByDocument(
  config: BrbyteServiceConfig,
  document: string,
  idTipoIdentificacion?: number
): Promise<BrbyteTerceroDto[]> {
  const result = await fetchBrbyteJson<BrbyteTerceroDto[]>(
    config,
    BRBYTE_API_PATHS.terceroByDocument,
    {
      query: {
        numeroIdentificacion: document,
        idTipoIdentificacion,
      },
    }
  )
  if (!result.ok || !result.data) return []
  return Array.isArray(result.data) ? result.data : []
}

export async function fetchBrbyteClienteByTercero(
  config: BrbyteServiceConfig,
  idTercero: string
): Promise<BrbyteClienteDto | null> {
  const path = `${BRBYTE_API_PATHS.clienteByTercero}/${idTercero}`
  const result = await fetchBrbyteJson<BrbyteClienteDto>(config, path)
  return result.ok && result.data ? result.data : null
}

export async function fetchBrbyteContratosByCliente(
  config: BrbyteServiceConfig,
  idCliente: string
): Promise<BrbyteContratoDto[]> {
  const result = await fetchBrbyteJson<BrbyteContratoDto[]>(
    config,
    BRBYTE_API_PATHS.contratosByCliente,
    { query: { idCliente } }
  )
  if (!result.ok || !result.data) return []
  return Array.isArray(result.data) ? result.data : []
}

/**
 * Placeholder seguro — endpoint oficial de cobrança ISP ainda não integrado.
 * Não infere pagamento; retorna lista vazia.
 */
export async function fetchBrbyteCobrancasPlaceholder(
  _config: BrbyteServiceConfig,
  _idCliente: string
): Promise<never[]> {
  logInfo(LOG_FETCH, {
    step: "cobranca_placeholder",
    path: BRBYTE_API_PATHS.cobrancaList,
    note: "awaiting_official_billing_endpoint",
  })
  return []
}

type ReferralSyncRow = {
  id: string
  referred_name: string
  referred_phone: string
  referred_email: string | null
  referred_document: string | null
  brbyte_id_tercero: string | null
  brbyte_id_cliente: string | null
  brbyte_id_contrato: string | null
  brbyte_no_contrato: string | null
  first_invoice_paid: boolean
}

type BrbyteLooseDb = {
  from: (table: string) => {
    insert: (
      values: unknown
    ) => {
      select: (
        cols: string
      ) => {
        single: () => Promise<{
          data: { id: string } | null
          error: { message: string; code?: string } | null
        }>
      }
    } & Promise<{
      data: unknown
      error: { message: string; code?: string } | null
    }>
    update: (values: unknown) => {
      eq: (
        col: string,
        val: string
      ) => Promise<{
        error: { message: string; code?: string } | null
      }>
    }
    select: (cols: string) => {
      eq: (
        col: string,
        val: unknown
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => {
          limit: (n: number) => Promise<{
            data: ReferralSyncRow[] | null
            error: { message: string } | null
          }>
        }
      }
    }
  }
}

/** Cliente sem tipagem estrita até `types/database.ts` incluir tabelas BRByte. */
function getBrbyteServiceDb(): BrbyteLooseDb {
  return createServiceRoleClient() as unknown as BrbyteLooseDb
}

async function createSyncRun(configured: boolean): Promise<string | null> {
  try {
    const supabase = getBrbyteServiceDb()
    const { data, error } = await supabase
      .from("brbyte_sync_runs")
      .insert({
        status: "running",
        configured,
        meta: {
          auto_mark_paid_enabled: BRBYTE_AUTO_MARK_PAID_ENABLED,
          phase: "infrastructure",
        },
      })
      .select("id")
      .single()

    if (error) {
      logError({ step: "create_sync_run", message: error.message })
      return null
    }

    const id = data?.id ?? null
    logInfo(LOG_DB, { step: "create_sync_run", syncRunId: id })
    return id
  } catch (e) {
    logError({
      step: "create_sync_run",
      message: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

async function finishSyncRun(
  runId: string | null,
  patch: Partial<BrbyteSyncRunRow> & { status: BrbyteSyncRunStatus }
): Promise<void> {
  if (!runId) return
  try {
    const supabase = getBrbyteServiceDb()
    const { error } = await supabase
      .from("brbyte_sync_runs")
      .update({
        ...patch,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId)

    if (error) logError({ step: "finish_sync_run", message: error.message })
    else logInfo(LOG_DB, { step: "finish_sync_run", syncRunId: runId, status: patch.status })
  } catch (e) {
    logError({
      step: "finish_sync_run",
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

async function loadReferralsForSync(): Promise<ReferralSyncRow[]> {
  const supabase = getBrbyteServiceDb()
  const { data, error } = await supabase
    .from("referrals")
    .select(
      "id, referred_name, referred_phone, referred_email, referred_document, brbyte_id_tercero, brbyte_id_cliente, brbyte_id_contrato, brbyte_no_contrato, first_invoice_paid"
    )
    .eq("first_invoice_paid", false)
    .order("updated_at", { ascending: false })
    .limit(MAX_REFERRALS_PER_RUN)

  if (error) {
    logError({ step: "load_referrals", message: error.message })
    return []
  }

  return (data ?? []) as ReferralSyncRow[]
}

async function persistReferralBrbyteLink(
  referralId: string,
  link: {
    brbyte_id_tercero: string | null
    brbyte_id_cliente: string | null
    brbyte_id_contrato: string | null
    brbyte_no_contrato: string | null
    referred_document?: string | null
    matched: boolean
  }
): Promise<boolean> {
  const now = new Date().toISOString()
  const supabase = getBrbyteServiceDb()
  const update: Record<string, unknown> = {
    brbyte_last_sync_at: now,
    updated_at: now,
  }

  if (link.brbyte_id_tercero) update.brbyte_id_tercero = link.brbyte_id_tercero
  if (link.brbyte_id_cliente) update.brbyte_id_cliente = link.brbyte_id_cliente
  if (link.brbyte_id_contrato) update.brbyte_id_contrato = link.brbyte_id_contrato
  if (link.brbyte_no_contrato) update.brbyte_no_contrato = link.brbyte_no_contrato
  if (link.referred_document) update.referred_document = link.referred_document
  if (link.matched) update.brbyte_matched_at = now

  const { error } = await supabase
    .from("referrals")
    .update(update)
    .eq("id", referralId)

  if (error) {
    logError({ step: "persist_link", referralId, message: error.message })
    return false
  }
  return true
}

async function upsertPaymentSnapshot(
  row: BrbytePaymentSnapshotInsert
): Promise<boolean> {
  const supabase = getBrbyteServiceDb()
  const { error } = await supabase.from("brbyte_payment_snapshots").insert(row)

  if (error) {
    if (error.code === "23505") {
      logInfo(LOG_DB, {
        step: "snapshot_dedupe",
        referralId: row.referral_id,
        external_reference: row.external_reference,
      })
      return true
    }
    logError({ step: "upsert_snapshot", message: error.message })
    return false
  }
  return true
}

async function processReferralMatch(
  config: BrbyteServiceConfig,
  row: ReferralSyncRow,
  syncRunId: string | null
): Promise<{
  matched: boolean
  snapshot: boolean
  error?: BrbyteSyncPhaseError
}> {
  const input: ReferralBrbyteMatchInput = {
    referralId: row.id,
    referredName: row.referred_name,
    referredPhone: row.referred_phone,
    referredEmail: row.referred_email,
    referredDocument: row.referred_document,
    brbyteIdTercero: row.brbyte_id_tercero,
    brbyteIdCliente: row.brbyte_id_cliente,
    brbyteIdContrato: row.brbyte_id_contrato,
  }

  const doc = normalizeDocument(row.referred_document ?? undefined)
  let candidates: BrbyteTerceroDto[] = []

  if (doc) {
    candidates = await fetchBrbyteTercerosByDocument(config, doc)
  }

  let match = matchReferralToBrbyteCustomer(input, candidates)

  if (match.matched && match.idTercero && !match.idCliente) {
    const cliente = await fetchBrbyteClienteByTercero(config, match.idTercero)
    if (cliente?.idCliente != null) {
      match = {
        ...match,
        idCliente: String(cliente.idCliente),
        noContrato: cliente.noContrato ?? null,
      }
    }
  }

  if (match.matched && match.idCliente && !match.idContrato) {
    const contratos = await fetchBrbyteContratosByCliente(config, match.idCliente)
    const primary = contratos[0]
    if (primary?.idContrato != null) {
      match = {
        ...match,
        idContrato: String(primary.idContrato),
        noContrato:
          primary.noContrato ?? primary.numeroContrato ?? match.noContrato,
      }
    }
  }

  await fetchBrbyteCobrancasPlaceholder(
    config,
    match.idCliente ?? row.brbyte_id_cliente ?? ""
  )

  const linkOk = await persistReferralBrbyteLink(row.id, {
    brbyte_id_tercero: match.idTercero,
    brbyte_id_cliente: match.idCliente,
    brbyte_id_contrato: match.idContrato,
    brbyte_no_contrato: match.noContrato,
    referred_document: doc,
    matched: match.matched,
  })

  const snapshotOk = await upsertPaymentSnapshot({
    referral_id: row.id,
    sync_run_id: syncRunId,
    brbyte_id_contrato: match.idContrato,
    periodo: null,
    external_reference: `infra:match:${row.id}`,
    paid_detected: false,
    source_endpoint: "brbyte-sync:infrastructure",
    raw_payload: {
      match_method: match.method,
      matched: match.matched,
      confidence: match.confidence,
      auto_mark_paid_enabled: BRBYTE_AUTO_MARK_PAID_ENABLED,
    },
    nomenclatura_estado: null,
  })

  if (!linkOk) {
    return {
      matched: match.matched,
      snapshot: snapshotOk,
      error: { code: "persist_link_failed", message: "Falha ao atualizar vínculo" },
    }
  }

  return { matched: match.matched, snapshot: snapshotOk }
}

/**
 * Orquestra sync BRByte: runs, matching, snapshots — sem marcar pagamento automático.
 */
export async function runBrbyteSync(): Promise<BrbyteSyncResult> {
  const started = Date.now()
  const errors: BrbyteSyncPhaseError[] = []

  logInfo(LOG_SYNC, {
    step: "start",
    autoMarkPaid: BRBYTE_AUTO_MARK_PAID_ENABLED,
  })

  const config = getBrbyteServiceConfig()

  if (config === null) {
    return {
      ok: false,
      skipped: true,
      reason: "invalid_config",
      configured: false,
      apiReachable: null,
      syncRunId: null,
      durationMs: Date.now() - started,
      fetched: 0,
      processed: 0,
      matched: 0,
      snapshotsUpserted: 0,
      markedPaid: 0,
      skippedRecords: 0,
      errors: [
        {
          code: "invalid_config",
          message:
            "BRBYTE_SYNC_ENABLED=true requer BRBYTE_API_URL e BRBYTE_API_KEY",
        },
      ],
      message: "Configuração BRByte incompleta",
      autoMarkPaidEnabled: BRBYTE_AUTO_MARK_PAID_ENABLED,
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
      syncRunId: null,
      durationMs: Date.now() - started,
      fetched: 0,
      processed: 0,
      matched: 0,
      snapshotsUpserted: 0,
      markedPaid: 0,
      skippedRecords: 0,
      errors: [],
      message: "Sincronização BRByte desabilitada (BRBYTE_SYNC_ENABLED=false)",
      autoMarkPaidEnabled: BRBYTE_AUTO_MARK_PAID_ENABLED,
    }
  }

  const syncRunId = await createSyncRun(true)

  const ping = await pingBrbyteApi(config)
  if (!ping.ok) {
    errors.push({
      code: "api_unreachable",
      message: ping.message ?? "BRByte API não respondeu",
      detail: { status: ping.status },
    })
    const durationMs = Date.now() - started
    await finishSyncRun(syncRunId, {
      status: "error",
      configured: true,
      api_reachable: false,
      errors_count: errors.length,
      duration_ms: durationMs,
      error_summary: { errors } as unknown as Record<string, unknown>,
    })
    return {
      ok: false,
      skipped: false,
      reason: "api_unreachable",
      configured: true,
      apiReachable: false,
      syncRunId,
      durationMs,
      fetched: 0,
      processed: 0,
      matched: 0,
      snapshotsUpserted: 0,
      markedPaid: 0,
      skippedRecords: 0,
      errors,
      message: ping.message,
      autoMarkPaidEnabled: BRBYTE_AUTO_MARK_PAID_ENABLED,
    }
  }

  const referrals = await loadReferralsForSync()
  let processed = 0
  let matched = 0
  let snapshotsUpserted = 0
  let skippedRecords = 0

  for (const row of referrals) {
    processed += 1
    try {
      const outcome = await processReferralMatch(config, row, syncRunId)
      if (outcome.matched) matched += 1
      if (outcome.snapshot) snapshotsUpserted += 1
      if (outcome.error) errors.push(outcome.error)
      if (!outcome.matched && !row.brbyte_id_cliente) skippedRecords += 1
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      errors.push({ code: "referral_process_error", message, detail: { referralId: row.id } })
      skippedRecords += 1
    }
  }

  const durationMs = Date.now() - started
  const status: BrbyteSyncRunStatus =
    errors.length > 0 ? (matched > 0 ? "partial" : "error") : "ok"

  await finishSyncRun(syncRunId, {
    status,
    configured: true,
    api_reachable: true,
    fetched: referrals.length,
    processed,
    matched,
    snapshots_upserted: snapshotsUpserted,
    marked_paid: 0,
    skipped_records: skippedRecords,
    errors_count: errors.length,
    duration_ms: durationMs,
    error_summary: errors.length ? ({ errors } as unknown as Record<string, unknown>) : null,
  })

  const result: BrbyteSyncResult = {
    ok: errors.length === 0 || matched > 0,
    skipped: false,
    configured: true,
    apiReachable: true,
    syncRunId,
    durationMs,
    fetched: referrals.length,
    processed,
    matched,
    snapshotsUpserted,
    markedPaid: 0,
    skippedRecords,
    errors,
    message:
      "Sync BRByte (infraestrutura): matching e snapshots; pagamento automático desligado",
    autoMarkPaidEnabled: BRBYTE_AUTO_MARK_PAID_ENABLED,
  }

  logInfo(LOG_SYNC, { step: "done", ...result })

  return result
}

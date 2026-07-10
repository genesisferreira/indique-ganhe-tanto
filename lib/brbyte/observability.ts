import type { BrbyteSyncRunPhase } from "@/types/brbyte"
import type { BrbyteSyncStatus } from "@/types/referral"

export const BRBYTE_CURRENT_PHASES = new Set<string>([
  "create_interest",
  "check_conversion",
  "check_first_invoice",
  "reset_manual",
  "release_reward",
  "find_invoice",
])

export const BRBYTE_RELEVANT_ERROR_PHASES = new Set<string>([
  "create_interest",
  "check_conversion",
  "check_first_invoice",
  "reset_manual",
])

/** Fases exibidas no resumo principal do dashboard (sem legado). */
export const BRBYTE_DASHBOARD_SUMMARY_PHASES = new Set<string>([
  "create_interest",
  "check_conversion",
  "check_first_invoice",
  "reset_manual",
])

export const BRBYTE_RELEVANT_ACTIVITY_PHASES = BRBYTE_DASHBOARD_SUMMARY_PHASES

export const BRBYTE_DEPRECATED_ENDPOINT_MARKERS = [
  "/controllrctl/client_interest/convert",
  "convert_interest",
  "convert-interest",
] as const

export const BRBYTE_DASHBOARD_STATUS_ORDER: {
  key: BrbyteSyncStatus
  label: string
}[] = [
  { key: "pending", label: "Pendente" },
  { key: "created", label: "Interessado criado" },
  { key: "converted", label: "Cliente convertido" },
  { key: "waiting_contract", label: "Aguardando contrato" },
  { key: "waiting_invoice", label: "Aguardando primeira mensalidade" },
  { key: "paid_confirmed", label: "Primeira mensalidade paga" },
  { key: "completed", label: "Concluído / crédito liberado" },
  { key: "error", label: "Erro" },
  { key: "retry", label: "Nova tentativa pendente" },
]

export const BRBYTE_LEGACY_STATUS_ORDER: {
  key: BrbyteSyncStatus
  label: string
}[] = [
  { key: "waiting_conversion", label: "Aguardando conversão (legado)" },
  { key: "synced", label: "Sincronizado (legado)" },
]

export type BrbyteFirstInvoicePipeline = {
  awaitingContract: number
  contractLocated: number
  firstInvoiceLocated: number
  firstInvoicePaid: number
  rewardReserved: number
  creditReleased: number
}

export type BrbyteReferralObservabilityInput = {
  brbyteSyncStatus?: string | null
  brbyteSyncError?: string | null
  brbyteIdInteressado?: string | null
  brbyteInteressadoCreatedAt?: string | null
  brbyteClientPk?: string | null
  brbyteClientSyncedAt?: string | null
  brbyteContractPk?: string | null
  brbyteFirstInvoicePk?: string | null
  brbyteFirstInvoicePaidAt?: string | null
  brbyteFirstInvoicePayload?: Record<string, unknown> | null
  brbyteLastSyncAt?: string | null
  firstInvoicePaid?: boolean
  rewardReserved?: boolean
  creditReleased?: boolean
  rewardId?: string | null
  walletTransactionId?: string | null
}

export type BrbyteTimelineStepState = "pending" | "done" | "error"

export type BrbyteTimelineStep = {
  id: string
  label: string
  state: BrbyteTimelineStepState
  date: string | null
  entityId: string | null
  hint: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const str = String(value).trim()
  return str.length > 0 ? str : null
}

export function isDeprecatedBrbyteEndpoint(
  endpoint: string | null | undefined
): boolean {
  if (!endpoint) return false
  const normalized = endpoint.toLowerCase()
  return BRBYTE_DEPRECATED_ENDPOINT_MARKERS.some((marker) =>
    normalized.includes(marker.toLowerCase())
  )
}

export function isCurrentBrbytePhase(phase: string | null | undefined): boolean {
  if (!phase) return false
  return BRBYTE_CURRENT_PHASES.has(phase)
}

export function getBrbytePhaseLabel(phase: string | null | undefined): string {
  switch (phase) {
    case "create_interest":
      return "Criação de interessado"
    case "check_conversion":
      return "Verificação de conversão"
    case "check_first_invoice":
      return "Verificação da primeira mensalidade"
    case "reset_manual":
      return "Reset manual"
    case "release_reward":
      return "Crédito liberado ao indicador"
    case "find_invoice":
      return "Consulta de faturas"
    case "convert_interest":
      return "Conversão (descontinuada)"
    default:
      return phase?.trim() || "Desconhecida"
  }
}

export function extractInvoiceFieldsFromPayload(
  payload: Record<string, unknown> | null | undefined
): {
  invoiceMsg: string | null
  invoiceDateCredit: string | null
} {
  if (!payload) return { invoiceMsg: null, invoiceDateCredit: null }

  const info = asRecord(payload.info) ?? asRecord(payload)
  const nestedInfo = asRecord(info?.info)

  const source = nestedInfo ?? info

  return {
    invoiceMsg: readString(
      source?.invoice_msg ?? source?.invoiceMsg ?? payload.invoice_msg
    ),
    invoiceDateCredit: readString(
      source?.invoice_date_credit ??
        source?.invoiceDateCredit ??
        payload.invoice_date_credit
    ),
  }
}

type FriendlyMessageContext = {
  phase?: string | null
  endpoint?: string | null
  syncStatus?: string | null
}

export function formatBrbyteFriendlyMessage(
  raw: string | null | undefined,
  context?: FriendlyMessageContext
): string | null {
  if (!raw?.trim()) return null

  const message = raw.trim()
  const lower = message.toLowerCase()

  if (/internal failure/i.test(message)) {
    const phase = getBrbytePhaseLabel(context?.phase)
    return `O ERP retornou falha interna na etapa ${phase}.`
  }

  if (
    lower.includes("contrato ainda não disponível") ||
    lower.includes("aguardando contrato") ||
    context?.syncStatus === "waiting_contract"
  ) {
    return "Cliente convertido, mas contrato ainda não localizado."
  }

  if (
    lower.includes("nenhuma fatura encontrada") ||
    lower.includes("primeira mensalidade ainda não consta")
  ) {
    return "Contrato localizado, mas primeira mensalidade ainda não encontrada."
  }

  if (
    lower.includes("ainda não consta como paga") ||
    lower.includes("aguardando baixa") ||
    context?.syncStatus === "waiting_invoice"
  ) {
    return "Primeira mensalidade encontrada, aguardando baixa/pagamento no ERP."
  }

  if (
    lower.includes("primeira mensalidade paga") ||
    lower.includes("recompensa liberada")
  ) {
    return "Primeira mensalidade paga confirmada no ERP."
  }

  if (
    lower.includes("já confirmada") ||
    lower.includes("já havia sido liberada") ||
    lower.includes("idempotente")
  ) {
    return "Crédito já havia sido liberado anteriormente."
  }

  if (lower.includes("ainda não convertido")) {
    return "Interessado criado no ERP. Aguardando conversão manual pelo comercial."
  }

  if (isDeprecatedBrbyteEndpoint(context?.endpoint ?? message)) {
    return "Erro de fluxo antigo (conversão no CRM). Use as ações atuais de verificação."
  }

  return message
}

export function buildBrbyteTimeline(
  input: BrbyteReferralObservabilityInput
): BrbyteTimelineStep[] {
  const syncStatus = input.brbyteSyncStatus ?? "pending"
  const isPendingFlow = syncStatus === "pending"
  const hasError = syncStatus === "error"
  const invoiceFields = extractInvoiceFieldsFromPayload(
    input.brbyteFirstInvoicePayload
  )

  const interestDone = Boolean(input.brbyteIdInteressado)
  const clientDone = Boolean(input.brbyteClientPk)
  const contractDone = Boolean(input.brbyteContractPk)
  const invoiceLocated = Boolean(input.brbyteFirstInvoicePk)
  const invoicePaid = Boolean(
    input.firstInvoicePaid || input.brbyteFirstInvoicePaidAt
  )
  const creditReleased = Boolean(
    input.creditReleased ?? input.walletTransactionId
  )
  const rewardReserved = Boolean(
    input.rewardReserved ?? (input.rewardId && !creditReleased)
  )

  const stepState = (
    done: boolean,
    isErrorStep = false
  ): BrbyteTimelineStepState => {
    if (isPendingFlow) return "pending"
    if (done) return "done"
    if (hasError && isErrorStep) return "error"
    return "pending"
  }

  return [
    {
      id: "interest_created",
      label: "Interessado criado",
      state: stepState(interestDone, !interestDone),
      date: input.brbyteInteressadoCreatedAt ?? null,
      entityId: input.brbyteIdInteressado ?? null,
      hint: interestDone
        ? null
        : "Aguardando criação do interessado no Controllr.",
    },
    {
      id: "client_converted",
      label: "Cliente convertido no ERP",
      state: stepState(clientDone, interestDone && !clientDone),
      date: input.brbyteClientSyncedAt ?? null,
      entityId: input.brbyteClientPk ?? null,
      hint: clientDone
        ? null
        : "Conversão manual no ERP; o CRM apenas consulta o status.",
    },
    {
      id: "contract_located",
      label: "Contrato localizado",
      state: stepState(contractDone, clientDone && !contractDone),
      date: contractDone ? input.brbyteLastSyncAt ?? null : null,
      entityId: input.brbyteContractPk ?? null,
      hint: contractDone
        ? null
        : "Cliente convertido, mas contrato ainda não localizado.",
    },
    {
      id: "first_invoice_located",
      label: "Primeira mensalidade localizada",
      state: stepState(invoiceLocated, contractDone && !invoiceLocated),
      date: invoiceLocated ? input.brbyteLastSyncAt ?? null : null,
      entityId: input.brbyteFirstInvoicePk ?? null,
      hint: invoiceLocated
        ? null
        : "Contrato localizado, mas primeira mensalidade ainda não encontrada.",
    },
    {
      id: "first_invoice_paid",
      label: "Primeira mensalidade paga",
      state: stepState(invoicePaid, invoiceLocated && !invoicePaid),
      date: input.brbyteFirstInvoicePaidAt ?? null,
      entityId: input.brbyteFirstInvoicePk ?? null,
      hint: invoicePaid
        ? invoiceFields.invoiceDateCredit
          ? `Crédito ERP: ${invoiceFields.invoiceDateCredit}`
          : null
        : "Primeira mensalidade encontrada, aguardando baixa/pagamento no ERP.",
    },
    {
      id: "reward_reserved",
      label: "Recompensa reservada",
      state: stepState(rewardReserved, invoicePaid && !rewardReserved),
      date: rewardReserved ? input.brbyteFirstInvoicePaidAt ?? null : null,
      entityId: input.rewardId ?? null,
      hint: rewardReserved
        ? "Recompensa registrada no CRM; crédito na carteira ainda pendente."
        : "Aguardando criação da recompensa após confirmação da mensalidade.",
    },
    {
      id: "credit_released",
      label: "Crédito liberado ao indicador",
      state: stepState(creditReleased, rewardReserved && !creditReleased),
      date: creditReleased ? input.brbyteFirstInvoicePaidAt ?? null : null,
      entityId: input.walletTransactionId ?? null,
      hint: creditReleased
        ? "Crédito disponível na carteira do indicador."
        : "Aguardando liberação do crédito na carteira do indicador.",
    },
  ]
}

export function isBrbyteFlowFinalized(input: {
  firstInvoicePaid?: boolean
  brbyteSyncStatus?: string | null
}): boolean {
  const status = input.brbyteSyncStatus
  return (
    Boolean(input.firstInvoicePaid) ||
    status === "paid_confirmed" ||
    status === "completed"
  )
}

export function accumulateFirstInvoicePipeline(
  row: {
    brbyte_sync_status: string | null
    first_invoice_paid: boolean | null
    brbyte_contract_pk: string | null
    brbyte_first_invoice_pk: string | null
    brbyte_first_invoice_paid_at: string | null
    has_reward?: boolean | null
    credit_released?: boolean | null
  },
  acc: BrbyteFirstInvoicePipeline
): void {
  const status = row.brbyte_sync_status ?? "pending"
  const hasContract = Boolean(row.brbyte_contract_pk?.trim())
  const hasInvoice = Boolean(row.brbyte_first_invoice_pk?.trim())
  const invoicePaid = Boolean(
    row.first_invoice_paid || row.brbyte_first_invoice_paid_at
  )
  const hasReward = Boolean(row.has_reward)
  const creditReleased = Boolean(row.credit_released)

  if (
    !hasContract &&
    (status === "converted" ||
      status === "waiting_contract" ||
      (status === "waiting_invoice" && !hasInvoice))
  ) {
    acc.awaitingContract += 1
  }

  if (hasContract && !hasInvoice && !invoicePaid) {
    acc.contractLocated += 1
  }

  if (hasInvoice && !invoicePaid) {
    acc.firstInvoiceLocated += 1
  }

  if (invoicePaid) {
    acc.firstInvoicePaid += 1
  }

  if (hasReward && !creditReleased) {
    acc.rewardReserved += 1
  }

  if (creditReleased) {
    acc.creditReleased += 1
  }
}

export function pickRelevantBrbyteHistoryError<
  T extends {
    referral_id: string | null
    created_at: string
    message: string | null
    endpoint: string | null
    http_status: number | null
    phase: string | null
  },
>(rows: T[]): T | null {
  for (const row of rows) {
    if (isDeprecatedBrbyteEndpoint(row.endpoint)) continue
    if (row.phase && !BRBYTE_RELEVANT_ERROR_PHASES.has(row.phase)) continue
    return row
  }
  return null
}

export function pickRelevantBrbyteHistoryActivity<
  T extends {
    referral_id: string | null
    created_at: string
    message: string | null
    endpoint: string | null
    http_status: number | null
    phase: string | null
    new_status?: string | null
  },
>(rows: T[]): T | null {
  for (const row of rows) {
    if (isDeprecatedBrbyteEndpoint(row.endpoint)) continue
    if (row.phase && !BRBYTE_RELEVANT_ACTIVITY_PHASES.has(row.phase)) continue
    return row
  }
  return null
}

export function emptyFirstInvoicePipeline(): BrbyteFirstInvoicePipeline {
  return {
    awaitingContract: 0,
    contractLocated: 0,
    firstInvoiceLocated: 0,
    firstInvoicePaid: 0,
    rewardReserved: 0,
    creditReleased: 0,
  }
}

export type BrbyteConnectionStatus = {
  /** Última operação BRByte atual teve sucesso (HTTP 2xx, sem erro). */
  connected: boolean
  /** Houve tentativa válida nas fases atuais hoje. */
  testedToday: boolean
  lastSuccessAt: string | null
}

export function resolveBrbyteConnectionStatus(input: {
  todayAttempts: number
  lastSuccessfulActivityAt: string | null
}): BrbyteConnectionStatus {
  const testedToday = input.todayAttempts > 0
  const connected = Boolean(input.lastSuccessfulActivityAt)
  return {
    connected,
    testedToday,
    lastSuccessAt: input.lastSuccessfulActivityAt,
  }
}

export function isBrbyteSummaryPhase(phase: string | null | undefined): boolean {
  if (!phase) return false
  return BRBYTE_DASHBOARD_SUMMARY_PHASES.has(phase)
}

export type BrbyteLastActivity = {
  referralId: string | null
  phase: string | null
  phaseLabel: string
  httpStatus: number | null
  message: string | null
  endpoint: string | null
  createdAt: string
  isError: boolean
}

export function mapHistoryRowToLastActivity(row: {
  referral_id: string | null
  created_at: string
  message: string | null
  endpoint: string | null
  http_status: number | null
  phase: string | null
  new_status?: string | null
}): BrbyteLastActivity {
  return {
    referralId: row.referral_id,
    phase: row.phase,
    phaseLabel: getBrbytePhaseLabel(row.phase),
    httpStatus: row.http_status,
    message: formatBrbyteFriendlyMessage(row.message, {
      phase: row.phase,
      endpoint: row.endpoint,
      syncStatus: row.new_status ?? null,
    }),
    endpoint: row.endpoint,
    createdAt: row.created_at,
    isError: row.new_status === "error",
  }
}

export function isBrbytePhaseCurrent(
  phase: BrbyteSyncRunPhase | string | null | undefined
): boolean {
  return isCurrentBrbytePhase(phase ?? null)
}

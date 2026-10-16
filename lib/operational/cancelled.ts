/**
 * Cancelamento de CONTRATO comprovado no desktop autenticado do Controllr:
 * BrByte.enums.CONTRACT.status_code + modelo invoice/list (invoice_invoice.js).
 *
 * Campo: contract_status (integer) no payload de /invoice_ctl/invoice/list.
 * Renderer: b.enums.CONTRACT.status_info[v]
 * Filtro: key 'contract_status', data status_info.slice(0, -1)
 *
 * CANCELED=5 "Cancelado" — exclusivo, distinto de BLOCKED=4 "Bloqueado".
 * ACTIVATED=1 "Ativado". ALL=6 é sentinela de filtro, não estado de linha.
 *
 * Cancelamento de CLIENTE NÃO comprovado:
 * ACL_CLIENT.status_code só ENABLED=0 "Habilitado", DISABLED=1 "Desabilitado",
 * ALL=2. client_status===3 aparece na tela de clientes (Recover/Delete) sem
 * label Cancelado em status_info da fatura. interest STATUS_CANCELED é outro enum.
 * client_status != 0, sozinho, não prova cancelamento.
 *
 * nomenclaturaEstadoContrato (DTO local) não é o campo operacional da lista.
 * include_cancelled_customers permanece não operacional.
 * idade da fatura > 60 dias não prova cancelamento.
 */

export const CANCELLED_SCOPE_NOT_PROVEN = "CANCELLED_SCOPE_NOT_PROVEN" as const
export const CONTRACT_CANCELLED_PROVEN = "CONTRACT_STATUS_CANCELED" as const
export const CONTRACT_STATUS_INCONCLUSIVE = "CONTRACT_STATUS_INCONCLUSIVE" as const

export const CONTROLLR_CLIENT_STATUS_CODE = {
  ENABLED: 0,
  DISABLED: 1,
  ALL: 2,
} as const

export const CONTROLLR_CONTRACT_STATUS_CODE = {
  DISABLED: 0,
  ACTIVATED: 1,
  ALERTED: 2,
  PENDING: 3,
  BLOCKED: 4,
  CANCELED: 5,
  ALL: 6,
} as const

export const CONTROLLR_CLIENT_STATUS_LABEL = {
  0: "Habilitado",
  1: "Desabilitado",
} as const

export const CONTROLLR_CONTRACT_STATUS_LABEL = {
  0: "Desabilitado",
  1: "Ativado",
  2: "Alertado",
  3: "Pendente",
  4: "Bloqueado",
  5: "Cancelado",
} as const

export type ControllrCancellationProbe = {
  confirmed: false
  cancelled: false
  reason: "controllr_cancellation_not_found"
  scope: typeof CANCELLED_SCOPE_NOT_PROVEN
}

export function probeControllrCancellation(_input?: unknown): ControllrCancellationProbe {
  return {
    confirmed: false,
    cancelled: false,
    reason: "controllr_cancellation_not_found",
    scope: CANCELLED_SCOPE_NOT_PROVEN,
  }
}

export function shouldExcludeCancelledFromCollections(input: {
  includeCancelledCustomers: boolean
  probe?: ControllrCancellationProbe
}): { exclude: false; operational: false; scope: typeof CANCELLED_SCOPE_NOT_PROVEN } {
  void input.includeCancelledCustomers
  void input.probe
  return { exclude: false, operational: false, scope: CANCELLED_SCOPE_NOT_PROVEN }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function parseControllrIntegerStatus(
  value: unknown
): { kind: "absent" } | { kind: "integer"; value: number } | { kind: "invalid" } {
  if (value === undefined || value === null) return { kind: "absent" }
  if (typeof value === "number" && Number.isInteger(value)) {
    return { kind: "integer", value }
  }
  return { kind: "invalid" }
}

/**
 * Lê um campo de status da lista. Chaves snake/camel divergentes viram inválido.
 * Ausência não vira ativo nem cancelado.
 */
export function coalesceControllrStatus(
  source: Record<string, unknown> | null | undefined,
  keys: readonly string[]
): unknown {
  const raw = asRecord(source)
  if (!raw) return undefined
  let found: unknown = undefined
  let present = false
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue
    const value = raw[key]
    if (value === undefined || value === null) continue
    if (!present) {
      found = value
      present = true
      continue
    }
    if (found !== value) return Number.NaN
  }
  return present ? found : undefined
}

export type ClientContractCancellationClassification = {
  cancelled: boolean
  skipAsCancelled: boolean
  skipAsInconclusive: boolean
  blockedOrSuspendedIsCancelled: false
  skipReason: "cancelled_contract" | "inconclusive" | null
  scope:
    | typeof CONTRACT_CANCELLED_PROVEN
    | typeof CONTRACT_STATUS_INCONCLUSIVE
    | typeof CANCELLED_SCOPE_NOT_PROVEN
}

const ELIGIBLE_CONTRACT_STATUSES = new Set<number>([
  CONTROLLR_CONTRACT_STATUS_CODE.DISABLED,
  CONTROLLR_CONTRACT_STATUS_CODE.ACTIVATED,
  CONTROLLR_CONTRACT_STATUS_CODE.ALERTED,
  CONTROLLR_CONTRACT_STATUS_CODE.PENDING,
  CONTROLLR_CONTRACT_STATUS_CODE.BLOCKED,
])

/**
 * Só contract_status integer 5 autoriza skip cancelled_contract.
 * 4 Bloqueado, 1 Ativado, 0/2/3 e client_status 0/1 permanecem elegíveis.
 * Tipo inválido, sentinela ALL=6 ou valor fora do enum → inconclusive.
 */
export function classifyClientContractCancellation(input?: {
  clientStatus?: unknown
  contractStatus?: unknown
  contractDeleted?: unknown
  blocked?: unknown
  suspended?: unknown
  raw?: Record<string, unknown>
}): ClientContractCancellationClassification {
  const eligible = {
    cancelled: false,
    skipAsCancelled: false,
    skipAsInconclusive: false,
    blockedOrSuspendedIsCancelled: false as const,
    skipReason: null,
  }
  void input?.blocked
  void input?.suspended
  void input?.contractDeleted

  const contractValue =
    input?.raw != null
      ? coalesceControllrStatus(input.raw, ["contract_status", "contractStatus"])
      : input?.contractStatus
  const parsed = parseControllrIntegerStatus(contractValue)

  if (parsed.kind === "invalid") {
    return {
      ...eligible,
      skipAsInconclusive: true,
      skipReason: "inconclusive",
      scope: CONTRACT_STATUS_INCONCLUSIVE,
    }
  }

  if (parsed.kind === "integer") {
    if (parsed.value === CONTROLLR_CONTRACT_STATUS_CODE.CANCELED) {
      return {
        cancelled: true,
        skipAsCancelled: true,
        skipAsInconclusive: false,
        blockedOrSuspendedIsCancelled: false,
        skipReason: "cancelled_contract",
        scope: CONTRACT_CANCELLED_PROVEN,
      }
    }
    if (ELIGIBLE_CONTRACT_STATUSES.has(parsed.value)) {
      return {
        ...eligible,
        scope: CONTRACT_CANCELLED_PROVEN,
      }
    }
    return {
      ...eligible,
      skipAsInconclusive: true,
      skipReason: "inconclusive",
      scope: CONTRACT_STATUS_INCONCLUSIVE,
    }
  }

  return {
    ...eligible,
    scope: CANCELLED_SCOPE_NOT_PROVEN,
  }
}

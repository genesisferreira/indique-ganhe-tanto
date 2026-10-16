/**
 * Cancelamento de cliente/contrato no Controllr NÃO está comprovado
 * no código, tipos, fixtures ou documentação local.
 *
 * Evidências auditadas e insuficientes:
 * - invoice_deleted IS false (fatura removida — este sim está comprovado).
 * - client_status oper 5 = 0 aparece só no probe wiki, não na query de atrasados;
 *   outros valores podem ser bloqueio/suspensão ainda cobrável.
 * - nomenclaturaEstadoContrato existe em BrbyteContratoDto, sem enum de cancelamento.
 * - include_cancelled_customers nas settings permanece não operacional.
 *
 * Não inventar filtro de cliente/contrato. Fail-closed só com evidência explícita
 * de fatura removida (invoice_deleted === true).
 */
export const CANCELLED_SCOPE_NOT_PROVEN = "CANCELLED_SCOPE_NOT_PROVEN" as const

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

export type ClientContractCancellationClassification = {
  cancelled: false
  skipAsCancelled: false
  blockedOrSuspendedIsCancelled: false
  scope: typeof CANCELLED_SCOPE_NOT_PROVEN
}

/**
 * client_status, contract_status, contract_deleted, blocked e suspended
 * não autorizam skip de cobrança: o significado de cancelamento definitivo
 * não está comprovado. Bloqueio/suspensão não vira cancelamento.
 */
export function classifyClientContractCancellation(_input?: {
  clientStatus?: unknown
  contractStatus?: unknown
  contractDeleted?: unknown
  blocked?: unknown
  suspended?: unknown
}): ClientContractCancellationClassification {
  void _input
  return {
    cancelled: false,
    skipAsCancelled: false,
    blockedOrSuspendedIsCancelled: false,
    scope: CANCELLED_SCOPE_NOT_PROVEN,
  }
}

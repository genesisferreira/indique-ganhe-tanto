/**
 * Cancelamento no Controllr NÃO está confirmado no código (sem endpoint/campo).
 * Esta função nunca infere cancelado por heurística.
 */
export type ControllrCancellationProbe = {
  confirmed: false
  cancelled: false
  reason: "controllr_cancellation_not_found"
}

export function probeControllrCancellation(_input?: unknown): ControllrCancellationProbe {
  return {
    confirmed: false,
    cancelled: false,
    reason: "controllr_cancellation_not_found",
  }
}

export function shouldExcludeCancelledFromCollections(input: {
  includeCancelledCustomers: boolean
  probe?: ControllrCancellationProbe
}): { exclude: false; operational: false } {
  void input.includeCancelledCustomers
  void input.probe
  return { exclude: false, operational: false }
}

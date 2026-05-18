/** Evento client-side para recarregar listas/detalhes após mutações em referrals/leads. */
export const REFERRAL_DATA_MUTATED_EVENT = "referral-data-mutated"

export function emitReferralDataMutated(): void {
  if (typeof window === "undefined") return
  // Deixa o setState da tela que mutou concluir antes de recarregar outras rotas.
  queueMicrotask(() => {
    window.dispatchEvent(new CustomEvent(REFERRAL_DATA_MUTATED_EVENT))
  })
}

export function subscribeReferralDataMutated(onMutated: () => void): () => void {
  if (typeof window === "undefined") return () => undefined
  const handler = () => onMutated()
  window.addEventListener(REFERRAL_DATA_MUTATED_EVENT, handler)
  return () => window.removeEventListener(REFERRAL_DATA_MUTATED_EVENT, handler)
}

import type { IndicacaoStatus } from "@/types/referral"

/** Valor persistido em referrals.lost_reason / rejection_reason */
export type LostReasonValue =
  | "sem_viabilidade_tecnica"
  | "sem_contato"
  | "debitos_empresa"
  | "cliente_desistiu"
  | "outro_provedor"
  | "fora_cobertura"
  | "dados_invalidos"
  | "nao_reconhece_indicacao"
  | "duplicado"
  | "outros"

export const LOST_REASON_OPTIONS: ReadonlyArray<{
  value: LostReasonValue
  label: string
}> = [
  { value: "sem_viabilidade_tecnica", label: "Sem viabilidade técnica" },
  { value: "sem_contato", label: "Sem contato" },
  { value: "debitos_empresa", label: "Possui débitos com a empresa" },
  { value: "cliente_desistiu", label: "Cliente desistiu" },
  { value: "outro_provedor", label: "Já possui outro provedor" },
  { value: "fora_cobertura", label: "Endereço fora da área de cobertura" },
  { value: "dados_invalidos", label: "Dados inválidos" },
  { value: "nao_reconhece_indicacao", label: "Não reconhece indicação" },
  { value: "duplicado", label: "Duplicado" },
  { value: "outros", label: "Outros" },
] as const

const LABEL_BY_VALUE = new Map(
  LOST_REASON_OPTIONS.map((o) => [o.value, o.label])
)

export function getLostReasonLabel(
  value: string | null | undefined
): string | null {
  if (!value?.trim()) return null
  const v = value.trim() as LostReasonValue
  return LABEL_BY_VALUE.get(v) ?? value.trim()
}

export function isComercialLeadRejectStatus(status: string): boolean {
  return status === "recusado" || status === "sem_viabilidade"
}

export function isIndicacaoRejectedStatus(status: IndicacaoStatus): boolean {
  return status === "recusada"
}

export function logLeadReject(...args: unknown[]): void {
  console.log("[lead-reject]", ...args)
}

export function logLeadLostReason(...args: unknown[]): void {
  console.log("[lead-lost-reason]", ...args)
}

export function logIndicatorReferralDetail(...args: unknown[]): void {
  console.log("[indicator-referral-detail]", ...args)
}

export function logCommercialLeadDetail(...args: unknown[]): void {
  console.log("[commercial-lead-detail]", ...args)
}

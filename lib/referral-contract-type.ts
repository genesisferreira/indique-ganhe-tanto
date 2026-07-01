import type { ReferralContractType } from "@/types/referral"

export const REFERRAL_CONTRACT_TYPE_OPTIONS: ReadonlyArray<{
  value: ReferralContractType
  label: string
}> = [
  { value: "tanto_livre", label: "Tanto Livre" },
  { value: "tanto_vantagens", label: "Tanto Vantagens" },
]

/** Rótulo amigável; indicações antigas sem valor usam fallback configurável. */
export function getReferralContractTypeLabel(
  value: ReferralContractType | string | null | undefined,
  options?: { legacyFallback?: "tanto_vantagens" | "nao_informado" }
): string {
  if (value === "tanto_livre") return "Tanto Livre"
  if (value === "tanto_vantagens") return "Tanto Vantagens"

  const legacy = options?.legacyFallback ?? "tanto_vantagens"
  return legacy === "nao_informado" ? "Não informado" : "Tanto Vantagens"
}

export function isReferralContractType(
  value: string | null | undefined
): value is ReferralContractType {
  return value === "tanto_livre" || value === "tanto_vantagens"
}

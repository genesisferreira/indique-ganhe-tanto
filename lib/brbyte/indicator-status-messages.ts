/** Mensagens amigáveis do ciclo BRByte para o indicador (sem dados técnicos). */

import type { BrbyteSyncStatus } from "@/types/referral"
import { normalizeBrbyteSyncStatus } from "@/types/referral"

export const INDICATOR_BRBYTE_STATUS_MESSAGES: Record<BrbyteSyncStatus, string> =
  {
    pending: "Estamos enviando sua indicação para análise.",
    created: "Indicação recebida pela equipe comercial.",
    converted: "O indicado foi convertido em cliente.",
    waiting_conversion: "O indicado foi convertido em cliente.",
    waiting_contract:
      "O cadastro foi aprovado e o contrato está em andamento.",
    waiting_invoice:
      "O cliente foi ativado. Estamos aguardando a primeira mensalidade.",
    synced: "Indicação recebida pela equipe comercial.",
    paid_confirmed: "A primeira mensalidade foi confirmada.",
    completed: "Sua recompensa foi processada.",
    error:
      "Sua indicação foi cadastrada. Nossa equipe dará continuidade ao processamento.",
    retry:
      "Sua indicação foi cadastrada. Nossa equipe dará continuidade ao processamento.",
  }

export function getIndicatorBrbyteStatusMessage(
  status: BrbyteSyncStatus | string | null | undefined
): string {
  const normalized = normalizeBrbyteSyncStatus(status)
  return INDICATOR_BRBYTE_STATUS_MESSAGES[normalized]
}

export const INDICATOR_REFERRAL_SAVED_MESSAGE =
  "Indicação cadastrada com sucesso. Nossa equipe dará continuidade ao processamento."

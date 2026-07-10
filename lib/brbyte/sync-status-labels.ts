import type { BrbyteSyncStatus } from "@/types/referral"

export const BRBYTE_SYNC_STATUS_LABELS: Record<BrbyteSyncStatus, string> = {
  pending: "Pendente",
  created: "Interessado criado",
  converted: "Cliente convertido",
  waiting_conversion: "Aguardando conversão em cliente",
  waiting_contract: "Aguardando contrato",
  waiting_invoice: "Aguardando primeira mensalidade",
  synced: "Sincronizado",
  paid_confirmed: "Primeira mensalidade paga",
  completed: "Concluído / crédito liberado",
  retry: "Nova tentativa pendente",
  error: "Erro",
}

export function getBrbyteSyncStatusLabel(
  status: BrbyteSyncStatus | string | null | undefined
): string {
  if (!status) return BRBYTE_SYNC_STATUS_LABELS.pending
  if (status in BRBYTE_SYNC_STATUS_LABELS) {
    return BRBYTE_SYNC_STATUS_LABELS[status as BrbyteSyncStatus]
  }
  return status
}

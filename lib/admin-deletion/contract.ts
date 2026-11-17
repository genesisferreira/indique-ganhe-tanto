import type { UserRole } from "@/types/user"

/** O rótulo de produto de admin_master é "Administrador (master)". Consulta e financeiro também usam a palavra Administrador e não autorizam exclusão. */
export const DELETION_AUTHORIZED_ROLES = ["admin_master"] as const
export const DELETION_BLOCKED_ROLES = [
  "admin_consulta",
  "admin_financeiro",
  "comercial",
  "indicador",
  "funcionario",
] as const satisfies readonly UserRole[]

export const REFERRAL_CONFIRMATION = "EXCLUIR INDICAÇÃO"
export const INDICATOR_CONFIRMATION = "EXCLUIR INDICADOR"
export const DEACTIVATE_CONFIRMATION = "DESATIVAR REGISTRO"
export const AUTH_DELETE_CONFIRMATION = "EXCLUIR CONTA DE ACESSO"
export const PRESERVE_MESSAGE = "Registro preservado por vínculo financeiro"
export const CONTROLLR_WARNING = "O cadastro no Controllr não será apagado"
export const BULK_LIMIT = 20
export const MIN_REASON = 20

export function isDeletionAuthorizedRole(role: string | null | undefined): boolean {
  return role === "admin_master"
}

export function bulkConfirmation(count: number): string {
  return `EXCLUIR ${count} REGISTROS`
}

export function reasonIssue(reason: string): "ok" | "short" | "digits" {
  const value = reason.trim()
  if (value.length < MIN_REASON || value.length > 500) return "short"
  if (/[0-9]{8,}/.test(value) || value.includes("@")) return "digits"
  return "ok"
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseUuidList(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > BULK_LIMIT) return null
  const out: string[] = []
  for (const id of ids) {
    if (typeof id !== "string" || !UUID.test(id) || out.includes(id)) return null
    out.push(id)
  }
  return out
}

export type ReferralGateInput = {
  rewards: number
  wallet: number
  payments: number
  withdrawals: number
  entitlements: number
  competences: number
  financialAttributions: number
  contractOrInvoice: number
  pendingFinancial: number
  financeAudit: number
  sharedDependency: number
  testRecord: boolean
}

export function referralBlockers(input: ReferralGateInput): string[] {
  const blockers: string[] = []
  if (input.rewards > 0) blockers.push("reward")
  if (input.wallet > 0) blockers.push("wallet")
  if (input.payments > 0) blockers.push("payment")
  if (input.withdrawals > 0) blockers.push("withdrawal")
  if (input.entitlements > 0) blockers.push("entitlement")
  if (input.competences > 0) blockers.push("competence")
  if (input.financialAttributions > 0) blockers.push("financial_attribution")
  if (input.contractOrInvoice > 0) blockers.push("contract_or_invoice")
  if (input.pendingFinancial > 0) blockers.push("pending_financial")
  if (input.financeAudit > 0) blockers.push("finance_audit")
  if (input.sharedDependency > 0) blockers.push("shared_dependency")
  return blockers
}

export function canHardDelete(input: ReferralGateInput, reason: string): boolean {
  return referralBlockers(input).length === 0 && (input.testRecord || reasonIssue(reason) === "ok")
}

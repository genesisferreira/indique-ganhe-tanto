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

export const REFERRAL_CONFIRMATION = "EXCLUIR INDICACAO"
export const INDICATOR_CONFIRMATION = "EXCLUIR INDICADOR"
export const BULK_CONFIRMATION = "EXCLUIR SELECIONADOS"
export const FINANCE_CONFIRMATION = "EXCLUIR HISTORICO FINANCEIRO DE TESTE"
export const DEACTIVATE_CONFIRMATION = "DESATIVAR REGISTRO"
export const AUTH_DELETE_CONFIRMATION = "EXCLUIR CONTA DE ACESSO"
export const PRESERVE_MESSAGE = "Registro preservado por vínculo financeiro"
export const CONTROLLR_WARNING = "O cadastro no Controllr não será apagado"
export const BULK_LIMIT = 20
export const MIN_REASON = 20
export const REAL_REASON_MIN = 40

export function isDeletionAuthorizedRole(role: string | null | undefined): boolean {
  return role === "admin_master"
}

export function bulkConfirmation(_count?: number): string {
  return BULK_CONFIRMATION
}

export function deletionFailureMessage(code: string, auditRef?: string | null): string {
  const audit = typeof auditRef === "string" && /^[0-9a-f-]{8,}$/i.test(auditRef) ? auditRef.slice(0, 8) : ""
  if (code === "confirmation_mismatch") return "A confirmação digitada não confere."
  if (code === "reason_invalid" || code === "reason_too_short") return "Registro real exige um motivo com pelo menos 40 caracteres, sem documento ou e-mail."
  if (code === "finance_confirmation_required" || code === "finance_confirmation_mismatch") return "A limpeza financeira exige a confirmação adicional."
  if (code === "external_payment" || code === "hard_delete_blocked") return "Há um vínculo financeiro protegido. Nenhum registro foi apagado."
  if (code === "financial_dependency") return "Há uma dependência que não pode ser removida. Nenhum registro foi apagado."
  if (code === "bulk_blocked") return "Um registro ficou bloqueado depois da prévia. Nenhum registro foi apagado."
  if (code === "stale_preview") return "O registro mudou depois da prévia. Abra a prévia novamente. Nenhum registro foi apagado."
  if (code === "forbidden" || code === "unauthenticated") return "A sessão ou o papel não autoriza a exclusão."
  if (audit) return `Falha interna ${audit}. Nenhum registro foi apagado.`
  return "Falha interna. Nenhum registro foi apagado."
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

export type DeletionClass =
  | "TESTE_SEM_FINANCEIRO"
  | "TESTE_COM_FINANCEIRO_INTERNO"
  | "REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO"
  | "REGISTRO_COM_PAGAMENTO_EXTERNO"

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
  externalPayment: boolean
  testRecord: boolean
}

export function classifyDeletion(input: Pick<ReferralGateInput, "testRecord" | "rewards" | "wallet" | "payments" | "externalPayment">): DeletionClass {
  if (input.externalPayment) return "REGISTRO_COM_PAGAMENTO_EXTERNO"
  const internal = input.rewards + input.wallet + input.payments > 0
  if (input.testRecord && internal) return "TESTE_COM_FINANCEIRO_INTERNO"
  if (input.testRecord) return "TESTE_SEM_FINANCEIRO"
  return "REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO"
}

export function referralBlockers(input: ReferralGateInput): string[] {
  const blockers: string[] = []
  if (input.externalPayment) blockers.push("external_payment")
  if (input.entitlements > 0) blockers.push("entitlement")
  if (input.competences > 0) blockers.push("competence")
  if (input.sharedDependency > 0) blockers.push("shared_dependency")
  return blockers
}

export function financeConfirmationRequired(input: ReferralGateInput): boolean {
  return !input.externalPayment && input.rewards + input.wallet + input.payments > 0 && referralBlockers(input).length === 0
}

export function canHardDelete(input: ReferralGateInput, reason: string, financeConfirmation?: string | null): boolean {
  if (referralBlockers(input).length > 0 || reasonIssue(reason) !== "ok") return false
  const classification = classifyDeletion(input)
  if (classification === "REGISTRO_REAL_SEM_PAGAMENTO_EXTERNO" && reason.trim().length < REAL_REASON_MIN) return false
  if (financeConfirmationRequired(input) && financeConfirmation !== FINANCE_CONFIRMATION) return false
  return true
}

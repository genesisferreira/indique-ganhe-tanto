import type { UserRole } from "@/types/user"

function strData(data: Record<string, unknown>, key: string): string | null {
  const v = data[key]
  if (typeof v === "string" && v.length > 0) return v
  return null
}

function metaStr(meta: Record<string, unknown>, key: string): string | null {
  return strData(meta, key)
}

function referralDetailHref(role: UserRole | null, referralId: string): string | null {
  if (!referralId) return null
  if (role === "indicador") return `/indicador/indicacoes/${referralId}`
  if (role === "comercial") return `/comercial/leads/${referralId}`
  if (
    role === "admin_consulta" ||
    role === "admin_financeiro" ||
    role === "admin_master"
  ) {
    return `/admin/indicacoes/${referralId}`
  }
  return null
}

function paymentsHref(role: UserRole | null): string | null {
  if (role === "indicador") return "/indicador/pagamentos"
  if (role === "admin_financeiro" || role === "admin_master") {
    return "/admin/pagamentos-pendentes"
  }
  if (role === "admin_consulta") return "/admin/historico-pagamentos"
  return null
}

function walletHref(role: UserRole | null): string | null {
  if (role === "indicador") return "/indicador/carteira"
  return null
}

/**
 * Resolve URL de navegação a partir de metadata (data jsonb) e perfil do usuário.
 */
export function resolveNotificationActionUrl(
  role: UserRole | null,
  data: Record<string, unknown>
): string | null {
  const explicit =
    metaStr(data, "action_url") ??
    (typeof data.action_url === "string" ? data.action_url : null)
  if (explicit && explicit.startsWith("/")) return explicit

  const action = metaStr(data, "action")
  const referralId = metaStr(data, "referral_id")
  const paymentId = metaStr(data, "payment_id")

  if (referralId) {
    const ref = referralDetailHref(role, referralId)
    if (ref) return ref
  }

  if (paymentId || action?.startsWith("pix_withdrawal")) {
    const pay = paymentsHref(role)
    if (pay) return pay
  }

  if (action === "referral_progress" && role === "indicador" && referralId) {
    return `/indicador/indicacoes/${referralId}`
  }

  if (action === "reward_released" && role === "indicador") {
    return walletHref(role)
  }

  if (
    action === "reward_created" ||
    action === "reward_available" ||
    action === "first_invoice_paid"
  ) {
    if (role === "indicador") return walletHref(role)
    if (referralId) return referralDetailHref(role, referralId)
  }

  if (action === "status_change" || action === "admin_assign_commercial") {
    if (referralId) return referralDetailHref(role, referralId)
    if (role === "comercial") return "/comercial/leads"
    if (role?.startsWith("admin")) return "/admin/indicacoes"
  }

  if (action === "pix_withdrawal_requested" && role?.startsWith("admin")) {
    return "/admin/pagamentos-pendentes"
  }

  return null
}

import { createHash, randomBytes } from "node:crypto"
import { partnerPublicUrl, PARTNER_PUBLIC_ORIGIN } from "@/lib/partner-merchants/public-url"

export const PARTNER_ORIGIN_KIND = "partner_merchant"
export const PARTNER_REFERRAL_SOURCE = "partner_merchant_referral"
export const PARTNER_ERP_LEAD_SOURCE = "Comércio Parceiro"
export { partnerPublicUrl, PARTNER_PUBLIC_ORIGIN }

export const PUBLIC_PAYLOAD_KEYS = [
  "idempotencyKey",
  "planId",
  "planCode",
  "name",
  "phone",
  "document",
  "zipcode",
  "street",
  "number",
  "complement",
  "neighborhood",
  "city",
  "observation",
  "consent",
  "confirmRecentDuplicate",
  "birthDate",
  "preferredInvoiceDueDay",
] as const

const FORBIDDEN_PUBLIC_KEYS = [
  "partnerId",
  "partner_id",
  "reward_eligible",
  "rewardEligible",
  "indicator_profile_id",
  "indicatorProfileId",
  "origin",
  "origin_kind",
  "originKind",
  "source",
]

export type PartnerCapability = "master" | "finance" | "commercial" | "readonly" | "none"
export type PartnerAction =
  | "manage_merchant"
  | "issue_link"
  | "save_rule"
  | "view_financial"
  | "view_operational"
  | "correct_attribution"

export function generatePartnerToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashPartnerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function capabilityForRole(role: string | null | undefined): PartnerCapability {
  switch (role) {
    case "admin_master":
      return "master"
    case "admin_financeiro":
      return "finance"
    case "comercial":
      return "commercial"
    case "admin_consulta":
      return "readonly"
    default:
      return "none"
  }
}

export function canPerform(capability: PartnerCapability, action: PartnerAction): boolean {
  if (action === "view_operational") {
    return capability === "master" || capability === "finance" || capability === "commercial" || capability === "readonly"
  }
  if (action === "view_financial" || action === "save_rule") {
    return capability === "master" || capability === "finance"
  }
  if (action === "manage_merchant" || action === "issue_link" || action === "correct_attribution") {
    return capability === "master"
  }
  return false
}

export function rejectForbiddenPublicKeys(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).some((key) => FORBIDDEN_PUBLIC_KEYS.includes(key) || !PUBLIC_PAYLOAD_KEYS.includes(key as (typeof PUBLIC_PAYLOAD_KEYS)[number]))
}

export function decideIdempotency(
  existing: { hash: string; partnerId: string } | null,
  hash: string,
  partnerId: string
): "create" | "replay" | "conflict" {
  if (!existing) return "create"
  if (existing.hash === hash && existing.partnerId === partnerId) return "replay"
  return "conflict"
}

export function decideDuplicate(input: {
  openOpportunityId: string | null
  recentClosed: boolean
  confirmRecent: boolean
}): { action: "create" } | { action: "reject"; code: "duplicate_open" | "duplicate_recent_closed"; recordCompeting: boolean } {
  if (input.openOpportunityId) {
    return { action: "reject", code: "duplicate_open", recordCompeting: true }
  }
  if (input.recentClosed && !input.confirmRecent) {
    return { action: "reject", code: "duplicate_recent_closed", recordCompeting: false }
  }
  return { action: "create" }
}

export function assessCompensationRule(input: {
  kind: string
  fixedAmountCents?: number | null
  percentageBps?: number | null
}):
  | { ok: true; status: "configured" | "blocked"; trigger: string; blockReason: string | null; entitlementCreated: false }
  | { ok: false; code: "amount_required" | "percentage_required" | "unknown_kind" } {
  if (input.kind === "fixed_amount") {
    if (!Number.isInteger(input.fixedAmountCents) || (input.fixedAmountCents ?? 0) < 1) {
      return { ok: false, code: "amount_required" }
    }
    return { ok: true, status: "configured", trigger: "invoice_generated", blockReason: null, entitlementCreated: false }
  }
  if (input.kind === "first_invoice_value") {
    if (input.fixedAmountCents != null || input.percentageBps != null) {
      return { ok: false, code: "unknown_kind" }
    }
    return { ok: true, status: "blocked", trigger: "first_invoice_paid", blockReason: "full_payment_unproven", entitlementCreated: false }
  }
  if (input.kind === "percentage") {
    if (!Number.isInteger(input.percentageBps) || (input.percentageBps ?? 0) < 1 || (input.percentageBps ?? 0) > 10000) {
      return { ok: false, code: "percentage_required" }
    }
    return { ok: true, status: "blocked", trigger: "percentage_base", blockReason: "percentage_base_not_proven", entitlementCreated: false }
  }
  return { ok: false, code: "unknown_kind" }
}

export function fixedCommissionAlreadyRecorded(
  existing: Array<{ partnerId: string; opportunityId: string; ruleId: string; trigger: string }>,
  next: { partnerId: string; opportunityId: string; ruleId: string; trigger: string }
): boolean {
  if (next.trigger !== "invoice_generated") return false
  return existing.some(
    (row) =>
      row.partnerId === next.partnerId &&
      row.opportunityId === next.opportunityId &&
      row.ruleId === next.ruleId &&
      row.trigger === "invoice_generated"
  )
}

const SENSITIVE_KEY = /token|phone|telefone|email|cnpj|cpf|document|nome|name|address|endereco|amount|valor|comiss/i

export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactForLog(item))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactForLog(item)
    }
    return out
  }
  if (typeof value === "string" && /parceiro\/[A-Za-z0-9_-]{20,}/.test(value)) return "[redacted-url]"
  return value
}

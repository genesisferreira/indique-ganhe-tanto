import {
  AUTH_DELETE_CONFIRMATION,
  BULK_LIMIT,
  DEACTIVATE_CONFIRMATION,
  FINANCE_CONFIRMATION,
  INDICATOR_CONFIRMATION,
  REFERRAL_CONFIRMATION,
  bulkConfirmation,
  parseUuidList,
  reasonIssue,
} from "@/lib/admin-deletion/contract"
import { sameOrigin, type WriteRequest } from "@/lib/payroll-competence/handlers"

export const DELETION_RPC = {
  preview_referral: "admin_preview_referral_deletion",
  delete_referral: "admin_delete_referral",
  deactivate_referral: "admin_deactivate_referral",
  preview_bulk: "admin_preview_bulk_referral_deletion",
  delete_bulk: "admin_bulk_delete_referrals",
  preview_indicator: "admin_preview_indicator_deletion",
  commit_indicator: "admin_delete_or_deactivate_indicator",
} as const

export type DeletionAction = keyof typeof DELETION_RPC
const ACTIONS = new Set<string>(Object.keys(DELETION_RPC))
const KEY = /^[A-Za-z0-9_-]{16,128}$/

export type DeletionRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>
}

export function deletionError(code: string, status = 400) {
  return { status, body: { ok: false, code } }
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export async function runDeletion(
  action: string,
  auth: { ok: true } | { ok: false; status: 401 | 403 },
  client: DeletionRpc | null,
  request: WriteRequest
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!sameOrigin(request)) return deletionError("forbidden", 403)
  if (!auth.ok) return deletionError(auth.status === 401 ? "unauthenticated" : "forbidden", auth.status)
  if (!ACTIONS.has(action)) return deletionError("unknown_action")
  let body: Record<string, unknown>
  try {
    body = record(JSON.parse(await request.text())) ?? {}
  } catch {
    return deletionError("invalid_payload")
  }
  const allowed = action.startsWith("preview")
    ? ["referralId", "referralIds", "indicatorId"]
    : ["referralId", "referralIds", "indicatorId", "reason", "confirmation", "idempotencyKey", "mode", "authConfirmation", "financeConfirmation", "revision"]
  if (Object.keys(body).some((key) => !allowed.includes(key))) return deletionError("unknown_field")
  if (!client) return deletionError("unavailable", 503)

  const kind = action as DeletionAction
  let args: Record<string, unknown>
  if (kind === "preview_referral" || kind === "delete_referral" || kind === "deactivate_referral") {
    const ids = parseUuidList([body.referralId])
    if (!ids) return deletionError("invalid_id")
    args = { p_referral_id: ids[0] }
  } else if (kind === "preview_indicator" || kind === "commit_indicator") {
    const ids = parseUuidList([body.indicatorId])
    if (!ids) return deletionError("invalid_id")
    args = { p_indicator_id: ids[0] }
  } else {
    const ids = parseUuidList(body.referralIds)
    if (!ids || ids.length > BULK_LIMIT) return deletionError("bulk_limit")
    args = { p_referral_ids: ids }
  }

  if (!kind.startsWith("preview")) {
    if (typeof body.reason !== "string" || reasonIssue(body.reason) !== "ok") return deletionError("reason_invalid")
    if (typeof body.idempotencyKey !== "string" || !KEY.test(body.idempotencyKey)) return deletionError("invalid_idempotency_key")
    const confirmation = body.confirmation
    const expected = kind === "delete_referral"
      ? REFERRAL_CONFIRMATION
      : kind === "delete_bulk"
        ? bulkConfirmation((args.p_referral_ids as string[]).length)
        : kind === "commit_indicator" && body.mode === "hard_delete"
          ? INDICATOR_CONFIRMATION
          : DEACTIVATE_CONFIRMATION
    if (confirmation !== expected) return deletionError("confirmation_mismatch")
    if (kind === "commit_indicator" && body.mode !== "hard_delete" && body.mode !== "deactivate") return deletionError("invalid_mode")
    if (body.authConfirmation != null && body.authConfirmation !== AUTH_DELETE_CONFIRMATION) return deletionError("auth_confirmation_mismatch")
    if (body.authConfirmation === AUTH_DELETE_CONFIRMATION && !(kind === "commit_indicator" && body.mode === "hard_delete")) {
      return deletionError("auth_confirmation_mismatch")
    }
    if (body.financeConfirmation != null && body.financeConfirmation !== FINANCE_CONFIRMATION) {
      return deletionError("finance_confirmation_mismatch")
    }
    const sendsFinance = kind === "delete_referral" || kind === "delete_bulk" || (kind === "commit_indicator" && body.mode === "hard_delete")
    const revision = body.revision
    if ((kind === "delete_referral" || kind === "delete_bulk") && revision != null && (typeof revision !== "string" || !/^[a-f0-9]{32}$/.test(revision))) {
      return deletionError("stale_preview")
    }
    args = {
      ...args,
      p_reason: body.reason.trim(),
      p_confirmation: confirmation,
      p_idempotency_key: body.idempotencyKey,
      ...(sendsFinance ? { p_finance_confirmation: body.financeConfirmation ?? null } : {}),
      ...(kind === "delete_referral" || kind === "delete_bulk" ? { p_revision: typeof revision === "string" ? revision : null } : {}),
      ...(kind === "commit_indicator" ? { p_mode: body.mode, p_auth_confirmation: body.authConfirmation ?? null } : {}),
    }
  }

  const result = await client.rpc(DELETION_RPC[kind], args)
  if (result.error) {
    console.warn("[admin-deletion]", kind, result.error.code ?? "rpc_error")
    return deletionError(result.error.code === "42501" ? "forbidden" : "unavailable", result.error.code === "42501" ? 403 : 503)
  }
  const data = record(result.data) ?? { ok: false, code: "unavailable" }
  if (data.ok !== true) console.warn("[admin-deletion]", kind, typeof data.code === "string" ? data.code : "rejected")
  return { status: data.ok === true ? 200 : data.code === "forbidden" || data.code === "unauthenticated" ? 403 : 400, body: data }
}

import "server-only"

import { createClient as createJsClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { NextResponse } from "next/server"

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
}

function anonRpc(): RpcClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ""
  if (!url || !key) throw new Error("share_public_unconfigured")
  return createJsClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as RpcClient
}

export function shareJson(body: unknown, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(body, { status }))
}

function withoutSecret(data: unknown) {
  if (!data || typeof data !== "object") return data
  const row = data as Record<string, unknown>
  if (!("token" in row)) return data
  return data
}

export async function shareAdminCapability() {
  const supabase = (await createClient()) as unknown as RpcClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.id) return null
  const { data } = await supabase.rpc("partner_admin_capability")
  return data === "master" || data === "finance" || data === "readonly" || data === "commercial" || data === "none" ? data : null
}

export async function shareSessionRpc(fn: string, args: Record<string, unknown> = {}) {
  const supabase = (await createClient()) as unknown as RpcClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.id) return { status: 401 as const, body: { ok: false, message: "Sessão expirada." } }
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    console.warn("[referral-share]", { fn, code: error.code ?? null })
    return { status: 503 as const, body: { ok: false, message: "Não foi possível concluir agora." } }
  }
  return mapResult(data)
}

export async function sharePublicRpc(fn: string, args: Record<string, unknown>) {
  try {
    const { data, error } = await anonRpc().rpc(fn, args)
    if (error) {
      console.warn("[referral-share-public]", { fn, code: error.code ?? null })
      return { status: 404 as const, body: { ok: false, message: "Não foi possível usar este link." } }
    }
    return mapResult(data)
  } catch {
    return { status: 503 as const, body: { ok: false, message: "Não foi possível usar este link." } }
  }
}

function mapResult(data: unknown): { status: number; body: unknown } {
  const row = (data ?? {}) as { ok?: boolean; code?: string; field?: string; protocol?: string; headline?: string }
  if (row.ok === false) {
    if (row.code === "forbidden" || row.code === "unauthenticated") return { status: 403, body: { ok: false, message: "Sem permissão para esta ação." } }
    if (row.code === "not_found") return { status: 404, body: { ok: false, message: "Não encontrado." } }
    if (row.code === "rate_limited") return { status: 429, body: { ok: false, message: "Muitas tentativas. Aguarde alguns minutos." } }
    if (row.code === "unavailable") return { status: 404, body: { ok: false, message: "Não foi possível usar este link." } }
    if (row.code === "duplicate_open") return { status: 409, body: { ok: false, code: "duplicate_open", message: "Já existe uma oportunidade em aberto para este contato." } }
    if (row.code === "duplicate_recent_closed") return { status: 409, body: { ok: false, code: "duplicate_recent_closed", requiresConfirmation: true, message: "Houve uma oportunidade encerrada há menos de 90 dias. Confirme para registrar uma nova." } }
    if (row.code === "consent_required") return { status: 400, body: { ok: false, message: "O consentimento é obrigatório." } }
    if (row.code === "invalid_document") return { status: 400, body: { ok: false, message: "Informe um CPF ou CNPJ válido." } }
    if (row.code === "invalid_plan") return { status: 400, body: { ok: false, message: "Escolha um plano de interesse." } }
    if (row.code === "idempotency_conflict") return { status: 409, body: { ok: false, message: "Este envio já foi usado com outros dados." } }
    if (row.code === "active_link_exists") return { status: 409, body: { ok: false, message: "Já existe um link ativo. Use a rotação." } }
    if (row.code === "originator_inactive") return { status: 409, body: { ok: false, message: "O originador não está ativo." } }
    if (row.code === "role_not_eligible") return { status: 409, body: { ok: false, message: "Esse papel não está disponível." } }
    if (row.code === "unknown_field") return { status: 400, body: { ok: false, message: "Não foi possível enviar a indicação." } }
    return { status: 400, body: { ok: false, message: "Não foi possível concluir.", code: row.code ?? "invalid_payload", field: row.field ?? null } }
  }
  return { status: 200, body: withoutSecret(data) }
}

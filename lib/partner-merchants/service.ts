import "server-only"

import { createClient as createJsClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { NextResponse } from "next/server"
import { redactForLog } from "@/lib/partner-merchants/domain"

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
}

function anonRpc(): RpcClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ""
  if (!url || !key) throw new Error("partner_public_unconfigured")
  return createJsClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as RpcClient
}

export function partnerJson(body: unknown, status = 200) {
  return applyNoStoreHeaders(NextResponse.json(body, { status }))
}

export async function sessionRpc(fn: string, args: Record<string, unknown>) {
  const supabase = (await createClient()) as unknown as RpcClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.id) return { status: 401 as const, body: { ok: false, message: "Sessão expirada." } }
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    console.warn("[partner-merchant]", { fn, code: error.code ?? null })
    return { status: 503 as const, body: { ok: false, message: "Não foi possível concluir agora." } }
  }
  return mapAdminResult(data)
}

export async function publicRpc(fn: string, args: Record<string, unknown>) {
  try {
    const { data, error } = await anonRpc().rpc(fn, args)
    if (error) {
      console.warn("[partner-public]", { fn, code: error.code ?? null })
      return { status: 404 as const, body: { ok: false, message: "Não foi possível usar este link." } }
    }
    return mapPublicResult(data)
  } catch {
    return { status: 503 as const, body: { ok: false, message: "Não foi possível usar este link." } }
  }
}

function mapAdminResult(data: unknown): { status: number; body: unknown } {
  const row = (data ?? {}) as { ok?: boolean; code?: string }
  if (row.ok === false) {
    if (row.code === "forbidden") return { status: 403, body: { ok: false, message: "Sem permissão para esta ação." } }
    if (row.code === "not_found") return { status: 404, body: { ok: false, message: "Comércio não encontrado." } }
    if (row.code === "reason_required") return { status: 400, body: { ok: false, message: "Informe o motivo, com pelo menos 8 caracteres." } }
    if (row.code === "cnpj_conflict") return { status: 409, body: { ok: false, message: "CNPJ já cadastrado." } }
    if (row.code === "idempotency_conflict") return { status: 409, body: { ok: false, message: "Esta operação já foi usada com outros dados." } }
    if (row.code === "partner_not_active") return { status: 409, body: { ok: false, message: "O comércio precisa estar ativo." } }
    if (row.code === "active_link_exists") return { status: 409, body: { ok: false, message: "Já existe um link ativo. Use a rotação." } }
    if (row.code === "amount_required") return { status: 400, body: { ok: false, message: "Informe o valor fixo. Não há valor padrão." } }
    if (row.code === "percentage_required") return { status: 400, body: { ok: false, message: "Informe a base percentual da estrutura." } }
    return { status: 400, body: { ok: false, message: "Não foi possível salvar.", code: row.code ?? "invalid_payload" } }
  }
  return { status: 200, body: redactTokenFromLogsOnly(data) }
}

function redactTokenFromLogsOnly(data: unknown) {
  return data
}

export function logPartnerSafe(event: string, detail: unknown) {
  console.warn("[partner-merchant]", event, redactForLog(detail))
}

function mapPublicResult(data: unknown): { status: number; body: unknown } {
  const row = (data ?? {}) as { ok?: boolean; code?: string; protocol?: string; publicDisplayName?: string; plans?: unknown; cnpj?: string | null; requiresConfirmation?: boolean; field?: string }
  if (row.ok === false) {
    if (row.code === "rate_limited") {
      return { status: 429, body: { ok: false, message: "Muitas tentativas. Aguarde alguns minutos." } }
    }
    if (row.code === "unavailable") {
      return { status: 404, body: { ok: false, message: "Não foi possível usar este link." } }
    }
    if (row.code === "duplicate_open") {
      return { status: 409, body: { ok: false, code: "duplicate_open", message: "Já existe uma oportunidade em aberto para este contato." } }
    }
    if (row.code === "duplicate_recent_closed") {
      return { status: 409, body: { ok: false, code: "duplicate_recent_closed", requiresConfirmation: true, message: "Houve uma oportunidade encerrada há menos de 90 dias. Confirme para registrar uma nova." } }
    }
    if (row.code === "consent_required") {
      return { status: 400, body: { ok: false, message: "O consentimento é obrigatório." } }
    }
    if (row.code === "idempotency_conflict") {
      return { status: 409, body: { ok: false, message: "Este envio já foi usado com outros dados." } }
    }
    return { status: 400, body: { ok: false, message: "Revise os dados e tente novamente.", field: row.field ?? null } }
  }
  if (row.protocol) {
    return { status: 200, body: { ok: true, protocol: row.protocol, idempotent: (data as { idempotent?: boolean }).idempotent === true } }
  }
  return {
    status: 200,
    body: {
      ok: true,
      publicDisplayName: row.publicDisplayName ?? null,
      cnpj: row.cnpj ?? null,
      plans: row.plans ?? [],
    },
  }
}

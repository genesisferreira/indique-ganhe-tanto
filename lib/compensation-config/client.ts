import { WRITE_ERROR_MESSAGE, type WriteErrorCode } from "@/lib/compensation-config/contract"

/**
 * 3.1F-J4 — POST do navegador para as rotas de rascunho. Somente cookies da sessão
 * (same-origin), JSON, sem localStorage, sem cache. Retorna classe de erro fechada.
 */
export type PostResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: WriteErrorCode | "network"; message: string; field?: string }

export const WRITE_ENDPOINT = {
  rule_save: "/api/admin/remuneracao/regras",
  rule_archive: "/api/admin/remuneracao/regras/arquivar",
  profile_save: "/api/admin/remuneracao/funcionarios",
  profile_archive: "/api/admin/remuneracao/funcionarios/arquivar",
} as const

export async function postDraft(endpoint: (typeof WRITE_ENDPOINT)[keyof typeof WRITE_ENDPOINT], payload: Record<string, unknown>): Promise<PostResult> {
  let res: Response
  try {
    res = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, code: "network", message: "Falha de conexão. Tente novamente (a operação não será duplicada)." }
  }
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  if (res.ok && body.ok === true) return { ok: true, body }
  const code = typeof body.code === "string" && body.code in WRITE_ERROR_MESSAGE ? (body.code as WriteErrorCode) : "unavailable"
  return { ok: false, code, message: WRITE_ERROR_MESSAGE[code], field: typeof body.field === "string" ? body.field : undefined }
}

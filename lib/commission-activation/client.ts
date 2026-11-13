import { J6_WRITE_ERROR_MESSAGE, type J6WriteErrorCode } from "@/lib/commission-activation/contract"

export type PostResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: J6WriteErrorCode | "network"; message: string; field?: string }

export const J6_ENDPOINT = {
  rule_approve: "/api/admin/remuneracao/regras/revisar",
  rule_activate: "/api/admin/remuneracao/regras/publicar",
  entitlement_approve: "/api/admin/remuneracao/comissao/aprovar",
  entitlement_include: "/api/admin/remuneracao/comissao/incluir",
  reconcile: "/api/admin/remuneracao/comissao/reconciliar",
  pay: "/api/admin/remuneracao/competencias/pagar",
  reverse: "/api/admin/remuneracao/competencias/estornar",
} as const

export async function postCommission(endpoint: (typeof J6_ENDPOINT)[keyof typeof J6_ENDPOINT], payload: Record<string, unknown>): Promise<PostResult> {
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
  const code = typeof body.code === "string" && body.code in J6_WRITE_ERROR_MESSAGE ? (body.code as J6WriteErrorCode) : "unavailable"
  return { ok: false, code, message: J6_WRITE_ERROR_MESSAGE[code], field: typeof body.field === "string" ? body.field : undefined }
}

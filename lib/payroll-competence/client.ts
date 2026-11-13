import { WRITE_ERROR_MESSAGE, type WriteErrorCode } from "@/lib/payroll-competence/contract"

export type PostResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: WriteErrorCode | "network"; message: string; field?: string }

export const PAYROLL_ENDPOINT = {
  approve: "/api/admin/remuneracao/funcionarios/aprovar",
  days: "/api/admin/remuneracao/dias-trabalhados",
  open: "/api/admin/remuneracao/competencias",
  calculate: "/api/admin/remuneracao/competencias/calcular",
  review: "/api/admin/remuneracao/competencias/revisar",
  adjust: "/api/admin/remuneracao/competencias/ajuste",
  close: "/api/admin/remuneracao/competencias/fechar",
  reopen: "/api/admin/remuneracao/competencias/reabrir",
} as const

export async function postPayroll(endpoint: (typeof PAYROLL_ENDPOINT)[keyof typeof PAYROLL_ENDPOINT], payload: Record<string, unknown>): Promise<PostResult> {
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

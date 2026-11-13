/**
 * 3.1F-K1B — Loaders das telas legadas /admin/comerciais e /admin/funcionarios.
 *
 * Extraídos das páginas para que os testes exercitem exatamente o caminho de produção:
 * useGuardedLoader (ctx.signal) → loader da página → service / fetch → transporte de rede.
 * O `signal` recebido é o do AbortController do carregamento e é repassado sem substituição.
 */
import {
  classifyHttpStatus,
  dataOutcome,
  errorOutcome,
  fetchJsonForLoader,
  listOutcome,
  type LoadOutcome,
  type LoaderErrorClass,
} from "@/lib/client/guarded-loader"
import { employeesOutcome, type EmployeesData } from "@/lib/admin-legacy/employees-outcome"
import {
  loadAdminComerciaisResultFromSupabase,
  type AdminListErrorClass,
} from "@/lib/services/supabase-data.service"
import type { Comercial } from "@/types"

export const ADMIN_LIST_ERROR_TO_LOADER: Record<AdminListErrorClass, LoaderErrorClass> = {
  unauthenticated: "unauthenticated",
  forbidden: "forbidden",
  query_failed: "server_error",
  invalid_response: "invalid_response",
  unexpected: "unexpected",
  // Cancelado: o controlador decide (timeout => `timeout`; desmontagem/retry => descartado).
  aborted: "unexpected",
}

export function isComercialRow(item: unknown): boolean {
  return Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")
}

export async function loadComerciaisPageOutcome(
  signal: AbortSignal,
  load: typeof loadAdminComerciaisResultFromSupabase = loadAdminComerciaisResultFromSupabase
): Promise<LoadOutcome<Comercial[]>> {
  const result = await load({ signal })
  if (!result.ok) return errorOutcome<Comercial[]>(ADMIN_LIST_ERROR_TO_LOADER[result.errorClass])
  return listOutcome<Comercial>(result.data, isComercialRow)
}

export type SectorOption = { code: string; name: string }

export async function loadSectorsPageOutcome(
  signal: AbortSignal,
  fetchImpl?: typeof fetch
): Promise<LoadOutcome<SectorOption[]>> {
  const res = await fetchJsonForLoader("/api/admin/sectors", signal, fetchImpl)
  if (!res.ok) return errorOutcome<SectorOption[]>(classifyHttpStatus(res.status))
  const body = res.json as { ok?: unknown; items?: unknown } | null
  if (!body || body.ok !== true || !Array.isArray(body.items)) return errorOutcome<SectorOption[]>("invalid_response")
  const options = (body.items as Array<{ code?: unknown; name?: unknown }>)
    .filter((row) => typeof row.code === "string" && typeof row.name === "string")
    .map((row) => ({ code: row.code as string, name: row.name as string }))
  return dataOutcome(options, options.length === 0)
}

export async function loadEmployeesPageOutcome(
  query: string,
  signal: AbortSignal,
  fetchImpl?: typeof fetch
): Promise<LoadOutcome<EmployeesData>> {
  const res = await fetchJsonForLoader(`/api/admin/employees?${query}`, signal, fetchImpl)
  return employeesOutcome(res.status, res.ok, res.json)
}

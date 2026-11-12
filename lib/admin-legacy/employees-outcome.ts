/**
 * 3.1F-K1: validação da resposta de GET /api/admin/employees.
 * HTTP de erro => classe por status; corpo nulo/shape inválido => invalid_response;
 * somente `{ ok: true, items: [] }` é vazio real.
 */
import {
  classifyHttpStatus,
  dataOutcome,
  errorOutcome,
  type LoadOutcome,
} from "@/lib/client/guarded-loader"
import type { EmployeeStatus } from "@/types/employee"

export type EmployeeRow = {
  id: string
  name: string
  email: string
  phone: string | null
  status: EmployeeStatus
  sectors: Array<{ code: string; name: string; isActive: boolean }>
  updatedAt: string
}

export type EmployeesData = { items: EmployeeRow[]; canWrite: boolean }

function isEmployeeRow(item: unknown): boolean {
  if (!item || typeof item !== "object") return false
  const row = item as { id?: unknown; sectors?: unknown }
  return typeof row.id === "string" && Array.isArray(row.sectors)
}

export function employeesOutcome(status: number, ok: boolean, json: unknown): LoadOutcome<EmployeesData> {
  if (!ok) return errorOutcome(classifyHttpStatus(status))
  const body = json as { ok?: unknown; items?: unknown; canWrite?: unknown } | null
  if (!body || body.ok !== true || !Array.isArray(body.items) || !body.items.every(isEmployeeRow)) {
    return errorOutcome("invalid_response")
  }
  const items = body.items as EmployeeRow[]
  return dataOutcome({ items, canWrite: body.canWrite === true }, items.length === 0)
}

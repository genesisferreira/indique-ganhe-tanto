import { createServiceRoleClient } from "@/lib/supabase/service-role"

export type OpsFilterBuilder = {
  eq: (col: string, val: unknown) => OpsFilterBuilder
  in: (col: string, val: unknown[]) => OpsFilterBuilder
  is: (col: string, val: unknown) => OpsFilterBuilder
  not: (col: string, op: string, val: unknown) => OpsFilterBuilder
  gte: (col: string, val: unknown) => OpsFilterBuilder
  lte: (col: string, val: unknown) => OpsFilterBuilder
  order: (col: string, opts?: { ascending?: boolean }) => OpsFilterBuilder
  limit: (n: number) => OpsFilterBuilder
  maybeSingle: () => Promise<{
    data: Record<string, unknown> | null
    error: { message: string; code?: string } | null
  }>
  single: () => Promise<{
    data: Record<string, unknown> | null
    error: { message: string; code?: string } | null
  }>
  then?: unknown
}

export type OpsQuery = OpsFilterBuilder &
  PromiseLike<{
    data: Record<string, unknown>[] | null
    error: { message: string; code?: string } | null
  }>

export type OpsTable = {
  select: (cols: string) => OpsQuery
  insert: (values: unknown) => {
    select: (cols: string) => {
      maybeSingle: () => Promise<{
        data: Record<string, unknown> | null
        error: { message: string; code?: string } | null
      }>
      single: () => Promise<{
        data: Record<string, unknown> | null
        error: { message: string; code?: string } | null
      }>
    }
  }
  update: (values: unknown) => {
    eq: (
      col: string,
      val: unknown
    ) => Promise<{ error: { message: string; code?: string } | null }> & {
      eq: (
        col: string,
        val: unknown
      ) => Promise<{ error: { message: string; code?: string } | null }>
      in: (
        col: string,
        val: unknown[]
      ) => Promise<{ error: { message: string; code?: string } | null }>
    }
  }
}

export type OpsDb = {
  from: (table: string) => OpsTable
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown
    error: { message: string; code?: string } | null
  }>
}

export function getOpsDb(): OpsDb {
  return createServiceRoleClient() as unknown as OpsDb
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asString(value: unknown): string | null {
  if (value == null) return null
  const str = String(value).trim()
  return str.length > 0 ? str : null
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function asBool(value: unknown): boolean {
  return value === true
}

export async function awaitQuery<T = Record<string, unknown>>(
  query: unknown
): Promise<{ data: T[] | null; error: { message: string; code?: string } | null }> {
  return query as Promise<{
    data: T[] | null
    error: { message: string; code?: string } | null
  }>
}

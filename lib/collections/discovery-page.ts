import {
  compareOverdueInvoicePk,
  parseOverdueInvoicePk,
} from "@/lib/brbyte/overdue-invoice-list-query"

export type DiscoveryPageValidation =
  | { ok: true; invoicePks: string[]; lastInvoicePk: string | null }
  | {
      ok: false
      code: "invalid_id" | "repeated_id" | "not_increasing" | "cursor_regression"
    }

export function validateDiscoveryPageProgression(input: {
  invoicePks: unknown[]
  afterInvoicePk: string | null
}): DiscoveryPageValidation {
  const parsed: string[] = []
  for (const raw of input.invoicePks) {
    const pk = parseOverdueInvoicePk(raw)
    if (!pk) return { ok: false, code: "invalid_id" }
    parsed.push(pk)
  }

  const seen = new Set<string>()
  let previous = input.afterInvoicePk
  if (previous != null && !parseOverdueInvoicePk(previous)) {
    return { ok: false, code: "invalid_id" }
  }

  for (const pk of parsed) {
    if (seen.has(pk)) return { ok: false, code: "repeated_id" }
    seen.add(pk)
    if (previous != null && compareOverdueInvoicePk(pk, previous) <= 0) {
      return previous === input.afterInvoicePk
        ? { ok: false, code: "cursor_regression" }
        : { ok: false, code: "not_increasing" }
    }
    previous = pk
  }

  return {
    ok: true,
    invoicePks: parsed,
    lastInvoicePk: parsed.at(-1) ?? input.afterInvoicePk,
  }
}

/**
 * Simula lista mutável: pagamentos removem IDs entre lotes.
 * Keyset usa invoice_pk > cursor; offset usa fatias por posição.
 */
export function simulateMutableOverduePages(input: {
  remainingPks: string[]
  afterInvoicePk: string | null
  offsetStart: number
  limit: number
}): { keyset: string[]; offset: string[] } {
  const sorted = [...input.remainingPks].sort((a, b) =>
    compareOverdueInvoicePk(a, b)
  )
  const keyset =
    input.afterInvoicePk == null
      ? sorted.slice(0, input.limit)
      : sorted
          .filter((pk) => compareOverdueInvoicePk(pk, input.afterInvoicePk!) > 0)
          .slice(0, input.limit)
  const offset = sorted.slice(input.offsetStart, input.offsetStart + input.limit)
  return { keyset, offset }
}

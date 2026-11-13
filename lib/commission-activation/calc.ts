/**
 * 3.1F-J6 — cálculo de comissão em inteiros (centavos). Nunca Number/float.
 * Meio centavo afasta de zero, igual a round(numeric, 2) do PostgreSQL.
 */

export type CalcMethod = "fixed_amount" | "percentage" | "first_invoice_value"

const MONEY = /^-?\d{1,8}\.\d{2}$/
const RATE = /^(0\.\d{1,6}|1\.0{1,6})$/
const ZERO = BigInt(0)
const HUNDRED = BigInt(100)
const MICRO = BigInt(1000000)
const HALF_MICRO = BigInt(500000)
const ONE = BigInt(1)

export function isMoney(v: unknown): v is string {
  return typeof v === "string" && MONEY.test(v)
}

function centsFromMoney(v: string): bigint {
  const neg = v.startsWith("-")
  const [i, f] = (neg ? v.slice(1) : v).split(".")
  const n = BigInt(i) * HUNDRED + BigInt(f)
  return neg ? -n : n
}

function moneyFromCents(c: bigint): string {
  const neg = c < ZERO
  const a = neg ? -c : c
  const i = a / HUNDRED
  const f = a % HUNDRED
  return `${neg ? "-" : ""}${i}.${f.toString().padStart(2, "0")}`
}

/** product = cents × (taxa × 1e6). round(numeric,2) — meio centavo para longe de zero. */
export function roundHalfAwayFromZeroMicros(product: bigint): bigint {
  const neg = product < ZERO
  const a = neg ? -product : product
  const truncated = a / MICRO
  const rem = a % MICRO
  const cents = truncated + (rem >= HALF_MICRO ? ONE : ZERO)
  return neg ? -cents : cents
}

export function percentageAmount(base: string, rate: string): string | null {
  if (!isMoney(base) || !RATE.test(rate) || base.startsWith("-") || base === "0.00") return null
  const [ri, rf = ""] = rate.split(".")
  const rateMicros = BigInt(ri) * MICRO + BigInt(rf.padEnd(6, "0"))
  if (rateMicros <= ZERO || rateMicros > MICRO) return null
  const baseCents = centsFromMoney(base)
  const productMicros = baseCents * rateMicros
  return moneyFromCents(roundHalfAwayFromZeroMicros(productMicros))
}

export function calculateCommission(input: {
  method: CalcMethod
  fixedAmount?: string | null
  percentageRate?: string | null
  baseAmount?: string | null
  invoiceDocumentAmount?: string | null
}): { ok: true; amount: string } | { ok: false; code: "missing_value" | "invalid_method_values" } {
  if (input.method === "fixed_amount") {
    if (!isMoney(input.fixedAmount) || input.fixedAmount.startsWith("-")) return { ok: false, code: "missing_value" }
    return { ok: true, amount: input.fixedAmount }
  }
  if (input.method === "percentage") {
    if (!input.baseAmount || !input.percentageRate) return { ok: false, code: "missing_value" }
    const amt = percentageAmount(input.baseAmount, input.percentageRate)
    if (!amt) return { ok: false, code: "missing_value" }
    return { ok: true, amount: amt }
  }
  if (!isMoney(input.invoiceDocumentAmount) || input.invoiceDocumentAmount.startsWith("-")) {
    return { ok: false, code: "missing_value" }
  }
  return { ok: true, amount: input.invoiceDocumentAmount }
}

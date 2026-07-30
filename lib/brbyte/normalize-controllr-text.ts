/**
 * Normalização textual destinada ao payload Controllr/BRByte.
 * Não aplicar em e-mail, CPF, telefone, CEP, datas ISO, UUIDs, IDs, plan_pk, UTMs ou URLs.
 */

export function normalizeControllrText(value: unknown): string | null {
  if (value == null) return null

  const normalized = String(value)
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("pt-BR")

  return normalized || null
}

export function formatControllrBirthDate(
  isoDate: string | null | undefined
): string | null {
  const match = isoDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return `${match[3]}/${match[2]}/${match[1]}`
}

const BR_BIRTH_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/

function isValidCalendarParts(year: number, month: number, day: number): boolean {
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

export type ControllrClientDateBirthResolution = {
  /** Valor para o payload Controllr (DD/MM/YYYY) ou null para omitir. */
  value: string | null
  status: "omitted" | "iso_converted" | "br_passthrough" | "invalid"
}

/**
 * Converte nascimento do domínio CRM (ISO) para o payload Controllr (DD/MM/YYYY).
 * Não altera o valor persistido no banco.
 */
export function resolveControllrClientDateBirthForPayload(
  value: string | null | undefined
): ControllrClientDateBirthResolution {
  if (value == null) return { value: null, status: "omitted" }

  const raw = String(value).trim()
  if (!raw) return { value: null, status: "omitted" }

  const fromIso = formatControllrBirthDate(raw)
  if (fromIso) {
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (isoMatch) {
      const year = Number(isoMatch[1])
      const month = Number(isoMatch[2])
      const day = Number(isoMatch[3])
      if (!isValidCalendarParts(year, month, day)) {
        return { value: null, status: "invalid" }
      }
    }
    return { value: fromIso, status: "iso_converted" }
  }

  const brMatch = raw.match(BR_BIRTH_DATE)
  if (brMatch) {
    const day = Number(brMatch[1])
    const month = Number(brMatch[2])
    const year = Number(brMatch[3])
    if (!isValidCalendarParts(year, month, day)) {
      return { value: null, status: "invalid" }
    }
    return { value: raw, status: "br_passthrough" }
  }

  return { value: null, status: "invalid" }
}

/**
 * Campo opcional do form Controllr — ausente quando vazio/inválido (sem inventar default).
 */
export function buildControllrClientDateBirthField(
  referredBirthDate: string | null | undefined
): { client_date_birth: string } | Record<string, never> {
  const resolved = resolveControllrClientDateBirthForPayload(referredBirthDate)
  if (!resolved.value) return {}
  return { client_date_birth: resolved.value }
}

export const CONTROLLR_INVOICE_DUE_DAYS = [5, 10, 15, 20, 25, 30] as const

const DUE_DAYS = new Set<number>(CONTROLLR_INVOICE_DUE_DAYS)

export function validateControllrBirthDate(
  value: unknown,
  today = new Date()
):
  | { ok: true; value: string }
  | { ok: false; reason: "missing" | "invalid" | "future" } {
  const raw = String(value ?? "").trim()
  if (!raw) return { ok: false, reason: "missing" }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return { ok: false, reason: "invalid" }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return { ok: false, reason: "invalid" }
  }

  const todayIso = [
    today.getFullYear().toString().padStart(4, "0"),
    (today.getMonth() + 1).toString().padStart(2, "0"),
    today.getDate().toString().padStart(2, "0"),
  ].join("-")
  if (raw > todayIso) return { ok: false, reason: "future" }

  return { ok: true, value: raw }
}

export function isValidControllrInvoiceDueDay(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    DUE_DAYS.has(value)
  )
}

export type ControllrErpTextFields = {
  name: string
  rg: string
  state: string
  city: string
  neighborhood: string
  street: string
  number: string
  complement: string
}

/** Campos textuais enviados ao Controllr; não inclui e-mail/documentos/datas. */
export function normalizeControllrErpTextFields(input: {
  name: string | null | undefined
  rg: string | null | undefined
  state: string | null | undefined
  city: string | null | undefined
  neighborhood: string | null | undefined
  street: string | null | undefined
  number: string | null | undefined
  complement: string | null | undefined
}): ControllrErpTextFields {
  return {
    name: normalizeControllrText(input.name) ?? "",
    rg: normalizeControllrText(input.rg) ?? "",
    state: normalizeControllrText(input.state) ?? "",
    city: normalizeControllrText(input.city) ?? "",
    neighborhood: normalizeControllrText(input.neighborhood) ?? "",
    street: normalizeControllrText(input.street) ?? "",
    number: normalizeControllrText(input.number) ?? "",
    complement: normalizeControllrText(input.complement) ?? "",
  }
}

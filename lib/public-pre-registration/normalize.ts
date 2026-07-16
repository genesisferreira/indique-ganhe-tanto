/**
 * Normalização textual exclusiva do pré-cadastro público.
 * Campos técnicos (e-mail, documentos, UTMs, URLs e códigos) não devem usar este helper.
 */
export function normalizePublicPreRegistrationText(
  value: unknown
): string | null {
  if (value == null) return null

  const normalized = String(value)
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("pt-BR")

  return normalized || null
}

export function formatPublicPreRegistrationBirthDate(
  isoDate: string | null | undefined
): string | null {
  const match = isoDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return `${match[3]}/${match[2]}/${match[1]}`
}

export const PUBLIC_PRE_REGISTRATION_DUE_DAYS = [
  5, 10, 15, 20, 25, 30,
] as const

const DUE_DAYS = new Set<number>(PUBLIC_PRE_REGISTRATION_DUE_DAYS)

export function validatePublicPreRegistrationBirthDate(
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

export function isValidPublicPreRegistrationDueDay(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    DUE_DAYS.has(value)
  )
}

export type PublicPreRegistrationErpTextFields = {
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
export function normalizePublicPreRegistrationErpTextFields(input: {
  name: string | null | undefined
  rg: string | null | undefined
  state: string | null | undefined
  city: string | null | undefined
  neighborhood: string | null | undefined
  street: string | null | undefined
  number: string | null | undefined
  complement: string | null | undefined
}): PublicPreRegistrationErpTextFields {
  return {
    name: normalizePublicPreRegistrationText(input.name) ?? "",
    rg: normalizePublicPreRegistrationText(input.rg) ?? "",
    state: normalizePublicPreRegistrationText(input.state) ?? "",
    city: normalizePublicPreRegistrationText(input.city) ?? "",
    neighborhood:
      normalizePublicPreRegistrationText(input.neighborhood) ?? "",
    street: normalizePublicPreRegistrationText(input.street) ?? "",
    number: normalizePublicPreRegistrationText(input.number) ?? "",
    complement: normalizePublicPreRegistrationText(input.complement) ?? "",
  }
}

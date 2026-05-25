import "server-only"

import type {
  BrbyteCustomerMatch,
  BrbyteTerceroDto,
  ReferralBrbyteMatchInput,
} from "@/types/brbyte"

const LOG_MATCH = "[brbyte:match]"

/** Apenas dígitos (CPF/CNPJ/telefone). */
export function normalizeDocument(value: string | null | undefined): string | null {
  if (value == null) return null
  const digits = value.replace(/\D/g, "")
  if (digits.length < 11) return null
  if (digits.length === 11 || digits.length === 14) return digits
  return digits.length >= 11 ? digits : null
}

/** E-mail em minúsculas, sem espaços. */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || !trimmed.includes("@")) return null
  return trimmed
}

/**
 * Telefone BR: preferência DDD+9 dígitos (11) ou 10 dígitos fixos.
 * Remove +55 e caracteres não numéricos.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (value == null) return null
  let digits = value.replace(/\D/g, "")
  if (digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2)
  }
  if (digits.length === 11 || digits.length === 10) return digits
  if (digits.length > 11) return digits.slice(-11)
  if (digits.length >= 8) return digits
  return null
}

function phonesEqual(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.length === 11 && b.length === 10 && a.slice(-10) === b) return true
  if (b.length === 11 && a.length === 10 && b.slice(-10) === a) return true
  return a.slice(-8) === b.slice(-8) && a.slice(-8).length === 8
}

function emailsEqual(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a === b)
}

function documentsEqual(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a === b)
}

function terceroPhones(tercero: BrbyteTerceroDto): string[] {
  const out: string[] = []
  const candidates = [
    tercero.celular,
    tercero.telefonoContacto,
    tercero.terceroContacto?.celular,
    tercero.terceroContacto?.telefono,
  ]
  for (const c of candidates) {
    const n = normalizePhone(c ?? undefined)
    if (n) out.push(n)
  }
  return out
}

function scoreTerceroMatch(
  referral: ReferralBrbyteMatchInput,
  tercero: BrbyteTerceroDto
): { score: number; method: BrbyteCustomerMatch["method"] } {
  const refDoc = normalizeDocument(
    referral.referredDocument ?? undefined
  )
  const refPhone = normalizePhone(referral.referredPhone)
  const refEmail = normalizeEmail(referral.referredEmail ?? undefined)
  const terDoc = normalizeDocument(tercero.numeroIdentificacion ?? undefined)
  const terEmail = normalizeEmail(
    tercero.email ?? tercero.terceroContacto?.email ?? undefined
  )

  if (documentsEqual(refDoc, terDoc)) {
    return { score: 100, method: "document" }
  }

  for (const tp of terceroPhones(tercero)) {
    if (phonesEqual(refPhone, tp)) {
      return { score: 80, method: "phone" }
    }
  }

  if (emailsEqual(refEmail, terEmail)) {
    return { score: 60, method: "email" }
  }

  return { score: 0, method: "none" }
}

/**
 * Prioridade futura: CPF/CNPJ > telefone > e-mail.
 * Compara referral com candidatos retornados pela API BRByte.
 */
export function matchReferralToBrbyteCustomer(
  referral: ReferralBrbyteMatchInput,
  candidates: BrbyteTerceroDto[]
): BrbyteCustomerMatch {
  if (referral.brbyteIdCliente && referral.brbyteIdTercero) {
    return {
      matched: true,
      method: "document",
      idTercero: referral.brbyteIdTercero,
      idCliente: referral.brbyteIdCliente,
      idContrato: referral.brbyteIdContrato ?? null,
      noContrato: null,
      confidence: "high",
      raw: { source: "cached_link" },
    }
  }

  let best: { tercero: BrbyteTerceroDto; score: number; method: BrbyteCustomerMatch["method"] } | null =
    null

  for (const tercero of candidates) {
    const { score, method } = scoreTerceroMatch(referral, tercero)
    if (score === 0) continue
    if (!best || score > best.score) {
      best = { tercero, score, method }
    }
  }

  if (!best || best.score < 60) {
    console.log(LOG_MATCH, {
      referralId: referral.referralId,
      matched: false,
      candidates: candidates.length,
    })
    return {
      matched: false,
      method: "none",
      idTercero: null,
      idCliente: null,
      idContrato: null,
      noContrato: null,
      confidence: "low",
    }
  }

  const idTercero =
    best.tercero.idTercero != null ? String(best.tercero.idTercero) : null

  const confidence: BrbyteCustomerMatch["confidence"] =
    best.method === "document"
      ? "high"
      : best.method === "phone"
        ? "medium"
        : "low"

  console.log(LOG_MATCH, {
    referralId: referral.referralId,
    matched: true,
    method: best.method,
    idTercero,
    confidence,
  })

  return {
    matched: true,
    method: best.method,
    idTercero,
    idCliente: null,
    idContrato: null,
    noContrato: null,
    confidence,
    raw: best.tercero as unknown as Record<string, unknown>,
  }
}

import { isValidCNPJ, isValidCPF, onlyDigits } from "@/lib/client/formatters"
import { sanitizeCustomerDocument } from "@/lib/collections/sanitize"

export type NormalizedDocument = {
  digits: string
  kind: "cpf" | "cnpj"
}

export function normalizeDocumentDigits(value: string | null | undefined): string {
  return onlyDigits(value ?? "")
}

export function parseOperationalDocument(
  value: string | null | undefined
): { ok: true; document: NormalizedDocument } | { ok: false; code: "invalid_document" } {
  const digits = normalizeDocumentDigits(value)
  if (digits.length === 11 && isValidCPF(digits)) {
    return { ok: true, document: { digits, kind: "cpf" } }
  }
  if (digits.length === 14 && isValidCNPJ(digits)) {
    return { ok: true, document: { digits, kind: "cnpj" } }
  }
  return { ok: false, code: "invalid_document" }
}

export function maskOperationalDocument(digits: string | null | undefined): string | null {
  return sanitizeCustomerDocument(digits)
}

export function documentsMatch(
  stored: string | null | undefined,
  digits: string
): boolean {
  if (!stored || !digits) return false
  return normalizeDocumentDigits(stored) === digits
}

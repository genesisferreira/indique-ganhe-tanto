export const BRBYTE_FIELD_MAX_LENGTH = 255

export type TruncateBrbyteFieldResult = {
  value: string
  truncated: boolean
  originalLength: number
}

/** Garante que campos textuais enviados ao Controllr respeitem o limite do ERP. */
export function truncateBrbyteField(
  value: string,
  max = BRBYTE_FIELD_MAX_LENGTH
): TruncateBrbyteFieldResult {
  const trimmed = value.trim()
  const originalLength = trimmed.length

  if (originalLength <= max) {
    return { value: trimmed, truncated: false, originalLength }
  }

  return {
    value: trimmed.slice(0, max),
    truncated: true,
    originalLength,
  }
}

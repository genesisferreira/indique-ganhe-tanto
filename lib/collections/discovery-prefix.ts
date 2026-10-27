/**
 * Sprint 3.1E-AR/AU — prefixo contíguo confirmado (puro, sem I/O).
 * O cursor só avança até o último invoice_pk consecutivo confirmado e nunca
 * retrocede (monotônico). Sem prefixo confirmado → não avança.
 * Erro técnico NÃO entra no prefixo; skip de negócio confirmado entra.
 */
const PK = /^[1-9]\d*$/

export function decideConfirmedPrefixAdvance(input: {
  cursorBefore: string | null
  confirmedPrefixPk: string | null
  confirmedPrefixRows: number
}): { advance: true; cursor: string; rows: number } | { advance: false } {
  const pk = input.confirmedPrefixPk?.trim() ?? ""
  if (input.confirmedPrefixRows <= 0 || !PK.test(pk)) return { advance: false }
  if (input.cursorBefore != null) {
    if (!PK.test(input.cursorBefore)) return { advance: false }
    if (BigInt(pk) <= BigInt(input.cursorBefore)) return { advance: false }
  }
  return { advance: true, cursor: pk, rows: input.confirmedPrefixRows }
}

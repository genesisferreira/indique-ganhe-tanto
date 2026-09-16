export type CollectionsInvoiceSourceDecision =
  | {
      use: "global"
      fullBaseCoverage: boolean
      degraded: boolean
    }
  | {
      use: "empty"
      fullBaseCoverage: true
      degraded: false
    }
  | {
      use: "fallback_error"
      fullBaseCoverage: false
      degraded: true
    }

export function resolveCollectionsInvoiceSource(input: {
  globalOk: boolean
  globalRowCount: number
  globalIncomplete: boolean
  coverageProven?: boolean
}): CollectionsInvoiceSourceDecision {
  if (input.globalOk && input.globalRowCount === 0 && !input.globalIncomplete) {
    return { use: "empty", fullBaseCoverage: true, degraded: false }
  }
  if (input.globalOk && !input.globalIncomplete) {
    const coverageProven = input.coverageProven !== false
    return {
      use: "global",
      fullBaseCoverage: coverageProven,
      degraded: false,
    }
  }
  if (input.globalRowCount > 0) {
    return {
      use: "global",
      fullBaseCoverage: false,
      degraded: true,
    }
  }
  return { use: "fallback_error", fullBaseCoverage: false, degraded: true }
}

export function collectionScanMayMutateCase(input: {
  invoicePk: string
  scannedInvoicePks: ReadonlySet<string>
}): boolean {
  const pk = input.invoicePk.trim()
  return Boolean(pk) && input.scannedInvoicePks.has(pk)
}

export function collectionsFallbackCoverageMessage(input: {
  fallbackContractsScanned: number
  fallbackLimit: number
  globalError?: string
}): string {
  const reason = input.globalError?.trim() || "falha na listagem global"
  return `Sync degradado: ${reason}. Fallback limitado a ${input.fallbackContractsScanned} contrato(s) de indicação (teto ${input.fallbackLimit}). Não cobre a base completa do Controllr.`
}

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
}): CollectionsInvoiceSourceDecision {
  if (input.globalOk && input.globalRowCount === 0 && !input.globalIncomplete) {
    return { use: "empty", fullBaseCoverage: true, degraded: false }
  }
  if (input.globalOk && !input.globalIncomplete) {
    return { use: "global", fullBaseCoverage: true, degraded: false }
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

export function collectionsFallbackCoverageMessage(input: {
  fallbackContractsScanned: number
  fallbackLimit: number
  globalError?: string
}): string {
  const reason = input.globalError?.trim() || "falha na listagem global"
  return `Sync degradado: ${reason}. Fallback limitado a ${input.fallbackContractsScanned} contrato(s) de indicação (teto ${input.fallbackLimit}). Não cobre a base completa do Controllr.`
}

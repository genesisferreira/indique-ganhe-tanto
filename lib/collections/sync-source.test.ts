import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  collectionScanMayMutateCase,
  collectionsFallbackCoverageMessage,
  resolveCollectionsInvoiceSource,
} from "@/lib/collections/sync-source"

describe("fonte da listagem de cobrança", () => {
  it("lista global válida e vazia não usa fallback", () => {
    const decision = resolveCollectionsInvoiceSource({
      globalOk: true,
      globalRowCount: 0,
      globalIncomplete: false,
    })
    assert.equal(decision.use, "empty")
    assert.equal(decision.fullBaseCoverage, true)
    assert.equal(decision.degraded, false)
  })

  it("lista global válida com faturas usa a base completa", () => {
    const decision = resolveCollectionsInvoiceSource({
      globalOk: true,
      globalRowCount: 250,
      globalIncomplete: false,
    })
    assert.equal(decision.use, "global")
    assert.equal(decision.fullBaseCoverage, true)
  })

  it("recorte paginado sem prova de ordenação única não declara cobertura completa", () => {
    const decision = resolveCollectionsInvoiceSource({
      globalOk: true,
      globalRowCount: 45,
      globalIncomplete: false,
      coverageProven: false,
    })
    assert.equal(decision.use, "global")
    assert.equal(decision.fullBaseCoverage, false)
    assert.equal(decision.degraded, false)
  })

  it("erro da listagem global dispara fallback degradado", () => {
    const decision = resolveCollectionsInvoiceSource({
      globalOk: false,
      globalRowCount: 0,
      globalIncomplete: false,
    })
    assert.equal(decision.use, "fallback_error")
    assert.equal(decision.fullBaseCoverage, false)
    assert.equal(decision.degraded, true)
  })

  it("página parcial com linhas processa a lista global e não cai no fallback", () => {
    const decision = resolveCollectionsInvoiceSource({
      globalOk: false,
      globalRowCount: 100,
      globalIncomplete: true,
    })
    assert.equal(decision.use, "global")
    assert.equal(decision.fullBaseCoverage, false)
    assert.equal(decision.degraded, true)
  })

  it("fatura ausente da varredura não pode ser fechada por omissão", () => {
    const scanned = new Set(["inv-seen"])
    assert.equal(
      collectionScanMayMutateCase({
        invoicePk: "inv-unseen",
        scannedInvoicePks: scanned,
      }),
      false
    )
    assert.equal(
      collectionScanMayMutateCase({
        invoicePk: "inv-seen",
        scannedInvoicePks: scanned,
      }),
      true
    )
  })

  it("mensagem de fallback não declara cobertura da base completa", () => {
    const message = collectionsFallbackCoverageMessage({
      fallbackContractsScanned: 37,
      fallbackLimit: 2000,
      globalError: "HTTP 500",
    })
    assert.match(message, /Sync degradado/)
    assert.match(message, /37 contrato/)
    assert.match(message, /Não cobre a base completa/)
    assert.equal(/sync completo/i.test(message), false)
  })
})

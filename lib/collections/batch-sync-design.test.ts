import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  COLLECTION_BATCH_TIME_BUDGET_MS,
  collectionBatchRemainingBudgetMs,
  collectionBatchShouldStopForTime,
} from "@/lib/collections/batch-sync-design"

describe("batch sync design helpers", () => {
  it("orçamento reserva margem abaixo de 300s", () => {
    assert.equal(COLLECTION_BATCH_TIME_BUDGET_MS < 300_000, true)
    assert.equal(
      collectionBatchRemainingBudgetMs({
        startedAtMs: 0,
        nowMs: 10_000,
        budgetMs: 240_000,
      }),
      230_000
    )
  })

  it("para o lote se a próxima página não cabe no orçamento", () => {
    assert.equal(
      collectionBatchShouldStopForTime({
        remainingMs: 8_000,
        lastPageDurationMs: 4_000,
      }),
      true
    )
    assert.equal(
      collectionBatchShouldStopForTime({
        remainingMs: 40_000,
        lastPageDurationMs: 4_000,
      }),
      false
    )
  })
})

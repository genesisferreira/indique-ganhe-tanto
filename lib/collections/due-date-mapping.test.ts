import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { extractInvoiceListRows } from "@/lib/brbyte/check-first-invoice-response"
import { presentCollectionInvoiceFromListRow } from "@/lib/collections/invoice-from-controllr"
import {
  computeDaysOverdue,
  parseInvoiceDueDate,
  shouldOpenCollectionCase,
} from "@/lib/collections/eligibility"
import { decideCollectionSyncAction } from "@/lib/collections/sync-decision"
import {
  classifyUnmappedDiscoveryRow,
  discoverySkipReasonFromDecision,
  emptyDiscoverySkipHistogram,
  incrementDiscoverySkip,
  sanitizeDiscoverySkipHistogram,
  sumDiscoverySkipHistogram,
} from "@/lib/collections/skip-reason"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../..")
const now = new Date("2026-09-11T12:00:00.000Z")

function listPayload(results: Record<string, unknown>[]) {
  return { success: true, results }
}

function classifyListRow(raw: Record<string, unknown>) {
  const parsed = extractInvoiceListRows(listPayload([raw]))[0]
  assert.ok(parsed)
  const presented = presentCollectionInvoiceFromListRow(parsed)
  if (!presented) {
    return {
      presented: null,
      reason: classifyUnmappedDiscoveryRow(parsed),
      daysOverdue: null as number | null,
    }
  }
  const decision = decideCollectionSyncAction({
    invoice: presented,
    existing: null,
    now,
    minimumDaysOverdue: 5,
    collectionsEnabled: true,
  })
  return {
    presented,
    reason: discoverySkipReasonFromDecision(decision),
    daysOverdue: computeDaysOverdue({
      invoiceDueDate: presented.invoiceDueDate,
      now,
    }),
    action: decision.action,
  }
}

describe("3.1E-AF mapeamento invoice_date_due", () => {
  it("A — campo comprovado invoice_date_due no formato do filtro é preservado", () => {
    const parsed = extractInvoiceListRows(
      listPayload([
        {
          invoice_pk: 90001,
          invoice_date_due: "2026-09-06 00:00:00",
          invoice_deleted: false,
        },
      ])
    )[0]
    assert.equal(parsed?.invoiceDueDate, "2026-09-06 00:00:00")
    assert.equal(computeDaysOverdue({ invoiceDueDate: parsed?.invoiceDueDate, now }), 5)
  })

  it("B — exatamente 5 dias é elegível", () => {
    const days = computeDaysOverdue({ invoiceDueDate: "2026-09-06 00:00:00", now })
    assert.equal(days, 5)
    assert.equal(
      shouldOpenCollectionCase({ daysOverdue: days, isPaid: false, invoicePk: "90002" }),
      true
    )
    const classified = classifyListRow({
      invoice_pk: 90002,
      invoice_date_due: "2026-09-06 00:00:00",
      invoice_deleted: false,
      invoice_msg: "open",
      contract_status: 1,
    })
    assert.equal(classified.action, "create")
    assert.equal(classified.reason, null)
  })

  it("C — 4 dias → not_old_enough", () => {
    const classified = classifyListRow({
      invoice_pk: 90003,
      invoice_date_due: "2026-09-07 00:00:00",
      invoice_deleted: false,
      invoice_msg: "open",
      contract_status: 1,
    })
    assert.equal(classified.daysOverdue, 4)
    assert.equal(classified.reason, "not_old_enough")
  })

  it("D — data ausente → insufficient_financial_data", () => {
    const classified = classifyListRow({
      invoice_pk: 90004,
      invoice_deleted: false,
      invoice_msg: "open",
      contract_status: 1,
    })
    assert.equal(classified.presented?.invoiceDueDate ?? null, null)
    assert.equal(classified.reason, "insufficient_financial_data")
  })

  it("E — data inválida ou calendário impossível → insufficient_financial_data", () => {
    assert.equal(parseInvoiceDueDate("not-a-date"), null)
    assert.equal(parseInvoiceDueDate("2026-13-40"), null)
    assert.equal(parseInvoiceDueDate("2026-02-31"), null)
    assert.equal(parseInvoiceDueDate("September 6, 2026"), null)
    const classified = classifyListRow({
      invoice_pk: 90005,
      invoice_date_due: "not-a-date",
      invoice_deleted: false,
      invoice_msg: "open",
      contract_status: 1,
    })
    assert.equal(classified.reason, "insufficient_financial_data")
  })

  it("F — emissão não substitui vencimento", () => {
    const classified = classifyListRow({
      invoice_pk: 90006,
      invoice_date: "2026-01-01 00:00:00",
      invoice_date_issue: "2026-01-01 00:00:00",
      invoice_deleted: false,
      invoice_msg: "open",
      contract_status: 1,
    })
    assert.equal(classified.presented?.invoiceDueDate ?? null, null)
    assert.equal(classified.reason, "insufficient_financial_data")
  })

  it("G — pagamento/crédito não substitui vencimento", () => {
    const classified = classifyListRow({
      invoice_pk: 90007,
      invoice_date_credit: "2026-09-01 00:00:00",
      invoice_deleted: false,
      invoice_msg: "open",
      contract_status: 1,
    })
    assert.equal(classified.presented?.invoiceDueDate ?? null, null)
    assert.equal(classified.reason, "insufficient_financial_data")
  })

  it("H — contract_status=5 → cancelled_contract", () => {
    const classified = classifyListRow({
      invoice_pk: 90008,
      invoice_date_due: "2026-08-01 00:00:00",
      invoice_deleted: false,
      invoice_msg: "open",
      contract_status: 5,
    })
    assert.equal(classified.reason, "cancelled_contract")
    assert.notEqual(classified.action, "create")
  })

  it("I — contract_status=4 com atraso >=5 permanece elegível", () => {
    const classified = classifyListRow({
      invoice_pk: 90009,
      invoice_date_due: "2026-08-01 00:00:00",
      invoice_deleted: false,
      invoice_msg: "open",
      contract_status: 4,
    })
    assert.equal(classified.action, "create")
    assert.equal(classified.reason, null)
  })

  it("J — invoice_deleted=true → removed_or_cancelled", () => {
    const classified = classifyListRow({
      invoice_pk: 90010,
      invoice_date_due: "2026-08-01 00:00:00",
      invoice_deleted: true,
    })
    assert.equal(classified.presented, null)
    assert.equal(classified.reason, "removed_or_cancelled")
  })

  it("K — fatura paga não cria caso novo", () => {
    const classified = classifyListRow({
      invoice_pk: 90011,
      invoice_date_due: "2026-08-01 00:00:00",
      invoice_deleted: false,
      invoice_msg: "paid",
      invoice_date_credit: "2026-09-01 00:00:00",
      contract_status: 1,
    })
    assert.equal(classified.reason, "paid_without_open_case")
    assert.notEqual(classified.action, "create")
  })

  it("L — calendário UTC da elegibilidade e referenceInstant preservados", () => {
    const due = "2026-09-06 00:00:00"
    const beforeUtc = new Date("2026-09-11T23:59:59.000Z")
    const afterUtc = new Date("2026-09-12T00:00:00.000Z")
    assert.equal(computeDaysOverdue({ invoiceDueDate: due, now: beforeUtc }), 5)
    assert.equal(computeDaysOverdue({ invoiceDueDate: due, now: afterUtc }), 6)
    const beforeSp = new Date("2026-09-16T02:59:59.000Z")
    const afterSp = new Date("2026-09-16T03:00:00.000Z")
    assert.equal(computeDaysOverdue({ invoiceDueDate: "2026-09-11T00:00:00.000Z", now: beforeSp }), 5)
    assert.equal(computeDaysOverdue({ invoiceDueDate: "2026-09-11T00:00:00.000Z", now: afterSp }), 5)
  })

  it("M/N — histograma da categoria certa e sem identificadores", () => {
    const histogram = emptyDiscoverySkipHistogram()
    incrementDiscoverySkip(histogram, "insufficient_financial_data")
    incrementDiscoverySkip(histogram, "not_old_enough")
    incrementDiscoverySkip(histogram, "cancelled_contract")
    assert.equal(histogram.insufficient_financial_data, 1)
    assert.equal(histogram.not_old_enough, 1)
    assert.equal(histogram.cancelled_contract, 1)
    assert.equal(sumDiscoverySkipHistogram(histogram), 3)
    const blob = JSON.stringify(sanitizeDiscoverySkipHistogram(histogram))
    assert.equal(blob.includes("90001"), false)
    assert.equal(blob.includes("Maria"), false)
    assert.equal(blob.includes("invoice_date_due"), false)
  })
})

describe("página sintética no formato real da lista", () => {
  it("15 linhas com invoice_date_due válido não viram 15 insufficient_financial_data", () => {
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < 15; i += 1) {
      rows.push({
        invoice_pk: 91001 + i,
        invoice_date_due: "2026-09-06 00:00:00",
        invoice_deleted: false,
        invoice_msg: "open",
        contract_status: i === 11 ? 5 : i === 12 ? 4 : 1,
        client_status: 0,
      })
    }
    const parsed = extractInvoiceListRows(listPayload(rows))
    assert.equal(parsed.length, 15)
    const histogram = emptyDiscoverySkipHistogram()
    let created = 0
    for (const row of parsed) {
      const presented = presentCollectionInvoiceFromListRow(row)
      if (!presented) {
        incrementDiscoverySkip(histogram, classifyUnmappedDiscoveryRow(row))
        continue
      }
      const decision = decideCollectionSyncAction({
        invoice: presented,
        existing: null,
        now,
        minimumDaysOverdue: 5,
        collectionsEnabled: true,
      })
      const reason = discoverySkipReasonFromDecision(decision)
      if (decision.action === "create") created += 1
      if (reason) incrementDiscoverySkip(histogram, reason)
    }
    assert.equal(histogram.insufficient_financial_data, 0)
    assert.equal(histogram.cancelled_contract, 1)
    assert.equal(created >= 1, true)
    assert.equal(sumDiscoverySkipHistogram(histogram) + created, 15)
  })

  it("reprodução AE: só invoice_date_due deixa de zerar daysOverdue", () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      invoice_pk: 92001 + i,
      invoice_date_due: "2026-08-01 00:00:00",
      invoice_deleted: false,
      invoice_msg: "open",
      contract_status: 1,
    }))
    const parsed = extractInvoiceListRows(listPayload(rows))
    const reasons = parsed.map((row) => {
      const presented = presentCollectionInvoiceFromListRow(row)
      assert.ok(presented)
      assert.equal(presented.invoiceDueDate, "2026-08-01 00:00:00")
      const decision = decideCollectionSyncAction({
        invoice: presented,
        existing: null,
        now,
        minimumDaysOverdue: 5,
        collectionsEnabled: true,
      })
      return discoverySkipReasonFromDecision(decision)
    })
    assert.equal(reasons.every((reason) => reason !== "insufficient_financial_data"), true)
    assert.equal(reasons.every((reason) => reason === null), true)
  })
})

describe("parser lê o campo comprovado antes dos nomes legados", () => {
  it("invoice_date_due vence invoice_due_date e emissão", () => {
    const parsed = extractInvoiceListRows(
      listPayload([
        {
          invoice_pk: 93001,
          invoice_date_due: "2026-09-06 00:00:00",
          invoice_due_date: "2020-01-01 00:00:00",
          invoiceDueDate: "2020-01-02",
          due_date: "2020-01-03",
          invoice_date: "2026-01-01 00:00:00",
          invoice_date_credit: "2026-09-10 00:00:00",
        },
      ])
    )[0]
    assert.equal(parsed?.invoiceDueDate, "2026-09-06 00:00:00")
  })

  it("fonte declara invoice_date_due como campo primário", () => {
    const src = readFileSync(
      join(repoRoot, "lib/brbyte/check-first-invoice-response.ts"),
      "utf8"
    )
    const proven = src.indexOf("row.invoice_date_due")
    const legacy = src.indexOf("row.invoice_due_date")
    assert.equal(proven >= 0, true)
    assert.equal(legacy >= 0, true)
    assert.equal(proven < legacy, true)
  })
})

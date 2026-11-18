import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { isDeletionAuthorizedRole } from "@/lib/admin-deletion/contract"
import { monthBounds, parsePeriod } from "@/lib/period/range"
import { ROUTE_COVERAGE } from "@/lib/period/route-coverage"
import { bucketKeys, fillBuckets, monthKeysBetween, seriesGranularity } from "@/lib/period/series"

const sql = readFileSync("supabase/patch-period-dashboard-3-1f-j18b.sql", "utf8")

describe("3.1F-J18B séries e cobertura", () => {
  it("agrupa todo o período por mês real e preenche zeros", () => {
    const period = parsePeriod(new URLSearchParams("period=all"))
    assert.equal(seriesGranularity(period.selection, period.from, period.to), "month")
    const keys = bucketKeys("month", period.selection, null, null, ["2026-10", "2026-12"], new Date("2026-11-17T15:00:00.000Z"))
    assert.deepEqual(keys, ["2026-10", "2026-11", "2026-12"])
    assert.equal(keys.includes("Todo o período"), false)
    const filled = fillBuckets([{ bucket: "2026-10", indicacoes: 2, conversoes: 1 }], keys, { indicacoes: 0, conversoes: 0 })
    assert.equal(filled[1]?.indicacoes, 0)
    assert.equal(filled[0]?.conversoes, 1)
    assert.deepEqual(filled.map((row) => row.bucket), keys)
  })

  it("trata mês, virada de ano e intervalo curto como dias", () => {
    const november = monthBounds("2026-11")!
    const month = parsePeriod(new URLSearchParams("month=2026-11"), new Date("2026-11-17T15:00:00.000Z"))
    assert.equal(seriesGranularity(month.selection, month.from, month.to), "day")
    assert.equal(bucketKeys("day", month.selection, november.from, november.to, []).length, 30)
    assert.deepEqual(monthKeysBetween("2026-12", "2027-01"), ["2026-12", "2027-01"])
    const range = parsePeriod(new URLSearchParams("from=2026-11-01&to=2026-11-03"))
    assert.equal(range.from?.toISOString(), "2026-11-01T03:00:00.000Z")
    assert.equal(range.to?.toISOString(), "2026-11-04T03:00:00.000Z")
  })

  it("classifica as rotas e não cria exclusão automática", () => {
    for (const entry of Object.values(ROUTE_COVERAGE)) {
      assert.ok(entry.coverage)
      assert.ok(entry.reason.length > 10)
    }
    assert.equal(ROUTE_COVERAGE["/admin"]?.coverage, "SERVER_FILTERED")
    assert.equal(ROUTE_COVERAGE["/admin/financeiro"]?.coverage, "SERVER_FILTERED")
    assert.equal(ROUTE_COVERAGE["/indicador/carteira"]?.coverage, "CURRENT_STATE_NOT_PERIOD_FILTERED")
    assert.equal(isDeletionAuthorizedRole("admin_master"), true)
    assert.equal(isDeletionAuthorizedRole("admin_financeiro"), false)
    assert.match(sql, /currentBalanceLabel', 'Saldo atual'/)
    assert.doesNotMatch(sql, /delete from|insert into public\.rewards|insert into public\.wallet/i)
    assert.doesNotMatch(sql, /net\.http|erp\.tantotelecom/i)
  })
})

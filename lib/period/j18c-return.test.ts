import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { inclusiveCivilDates, parsePeriod, recentMonthsRange } from "@/lib/period/range"
import { buildInternalReturn, resolveListReturn, safeInternalReturn } from "@/lib/period/return-to"
import { ROUTE_COVERAGE } from "@/lib/period/route-coverage"

describe("3.1F-J18C retorno e período único", () => {
  it("volta para a página 2 com os filtros e bloqueia destino externo", () => {
    const params = new URLSearchParams("month=2026-11&page=2&pageSize=20&q=ana%20%26%20bia&status=aprovada&origin=web&indicator=11111111-1111-4111-8111-111111111111&commercial=22222222-2222-4222-8222-222222222222&plan=33333333-3333-4333-8333-333333333333")
    const href = buildInternalReturn("/admin/indicacoes", params)
    assert.match(href, /page=2/)
    assert.match(href, /month=2026-11/)
    assert.match(href, /pageSize=20/)
    assert.match(href, /status=aprovada/)
    const back = resolveListReturn(new URLSearchParams(`returnTo=${encodeURIComponent(href)}`), "/admin/indicacoes")
    assert.equal(back, href)
    assert.equal(safeInternalReturn("https://evil.example/admin/indicacoes", "/admin/indicacoes"), null)
    assert.equal(safeInternalReturn("//evil.example/admin/indicacoes", "/admin/indicacoes"), null)
    assert.equal(safeInternalReturn("/\\evil.example", "/admin/indicacoes"), null)
    assert.equal(safeInternalReturn("javascript:alert(1)", "/admin/indicacoes"), null)
    const stripped = safeInternalReturn("/admin/indicacoes?page=2&next=https://evil.example", "/admin/indicacoes")
    assert.equal(stripped, "/admin/indicacoes?page=2")
    assert.equal(resolveListReturn(new URLSearchParams(), "/admin/indicacoes"), "/admin/indicacoes")
  })

  it("trata mês, intervalo vazio e os últimos seis meses em São Paulo", () => {
    const november = parsePeriod(new URLSearchParams("month=2026-11"))
    assert.deepEqual(inclusiveCivilDates(november), { from: "2026-11-01", to: "2026-11-30" })
    const yearTurn = parsePeriod(new URLSearchParams("month=2026-12"))
    assert.equal(inclusiveCivilDates(yearTurn).to, "2026-12-31")
    const empty = parsePeriod(new URLSearchParams("from=2026-11-03&to=2026-11-03"))
    assert.deepEqual(inclusiveCivilDates(empty), { from: "2026-11-03", to: "2026-11-03" })
    const all = parsePeriod(new URLSearchParams("period=all"))
    assert.deepEqual(inclusiveCivilDates(all), { from: null, to: null })
    const six = recentMonthsRange(6, new Date("2026-11-18T15:00:00.000Z"))
    assert.equal(six.from, "2026-06-01")
    assert.equal(six.to, "2026-11-30")
    const reports = readFileSync("app/admin/relatorios/page.tsx", "utf8")
    const history = readFileSync("app/admin/historico-pagamentos/page.tsx", "utf8")
    assert.equal(reports.includes("Últimos 6 meses"), false)
    assert.equal(history.includes("Todo período"), false)
    assert.equal(ROUTE_COVERAGE["/indicador/indicacoes"]?.coverage, "SERVER_FILTERED")
    assert.equal(ROUTE_COVERAGE["/comercial/desempenho"]?.coverage, "SERVER_FILTERED")
    assert.equal(ROUTE_COVERAGE["/funcionario/vendas"]?.coverage, "SERVER_FILTERED")
  })
})

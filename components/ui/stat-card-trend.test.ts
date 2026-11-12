import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { describeStatCardTrend, type StatCardTrend } from "./stat-card-trend"

describe("K1 StatCard — tendência", () => {
  it("sem histórico/comparação (prop ausente) => nada", () => {
    assert.equal(describeStatCardTrend(undefined), null)
    assert.equal(describeStatCardTrend(null), null)
  })
  it("período anterior zero => 'Sem comparação' somente quando explícito", () => {
    const v = describeStatCardTrend({ kind: "no_comparison" })
    assert.equal(v?.text, "Sem comparação")
    assert.equal(v?.tone, "neutral")
    assert.match(v!.srText, /Sem comparação/)
  })
  it("trend real positivo", () => {
    const v = describeStatCardTrend({ kind: "change", percent: 12.5, label: "vs. mês anterior" })
    assert.deepEqual(v, { text: "+12,5%", srText: "Aumento de 12,5% em relação ao período anterior", tone: "positive", label: "vs. mês anterior" })
  })
  it("trend real negativo usa sinal numérico (Math.sign), não texto", () => {
    const v = describeStatCardTrend({ kind: "change", percent: -3 })
    assert.equal(v?.text, "−3%")
    assert.equal(v?.tone, "negative")
    assert.match(v!.srText, /Queda de 3%/)
  })
  it("zero => neutro, sem seta/sinal", () => {
    const v = describeStatCardTrend({ kind: "change", percent: 0.04 })
    assert.equal(v?.text, "0%")
    assert.equal(v?.tone, "neutral")
  })
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    it(`percentual não finito (${bad}) => nada (sem infinito, sem 100% arbitrário)`, () => {
      assert.equal(describeStatCardTrend({ kind: "change", percent: bad }), null)
    })
  }
  it("valores textuais/inesperados são rejeitados", () => {
    assert.equal(describeStatCardTrend({ kind: "change", percent: "+12" as unknown as number }), null)
    assert.equal(describeStatCardTrend({ kind: "bogus" } as unknown as StatCardTrend), null)
  })
})

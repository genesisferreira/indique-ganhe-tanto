/**
 * 3.1F-K1 — Tendência do StatCard (pura, testável).
 *
 * Só existe tendência quando o chamador fornece explicitamente:
 * - `{ kind: "change", percent }`: comparação REAL já calculada (período anterior válido, denominador > 0);
 * - `{ kind: "no_comparison" }`: comparação real tentada com período anterior zero/ausente.
 * Sem prop => nada é renderizado (nenhuma tendência padrão, nenhum placeholder).
 * O sinal deriva do número (Math.sign), nunca de parse textual.
 */
export type StatCardTrend =
  | { kind: "change"; percent: number; label?: string }
  | { kind: "no_comparison"; label?: string }

export type StatCardTrendView = {
  /** texto visível (ex.: "+12,5%", "−3%", "0%", "Sem comparação") */
  text: string
  /** descrição completa para leitores de tela */
  srText: string
  tone: "positive" | "negative" | "neutral"
  label?: string
}

const NO_COMPARISON_TEXT = "Sem comparação"

export function describeStatCardTrend(trend: StatCardTrend | null | undefined): StatCardTrendView | null {
  if (!trend || typeof trend !== "object") return null
  const label = typeof trend.label === "string" && trend.label.trim() ? trend.label.trim() : undefined
  if (trend.kind === "no_comparison") {
    return {
      text: NO_COMPARISON_TEXT,
      srText: "Sem comparação com o período anterior",
      tone: "neutral",
      label,
    }
  }
  if (trend.kind !== "change") return null
  const percent = trend.percent
  if (typeof percent !== "number" || !Number.isFinite(percent)) return null
  const rounded = Math.round(percent * 10) / 10
  const sign = Math.sign(rounded)
  const magnitude = Math.abs(rounded).toLocaleString("pt-BR", { maximumFractionDigits: 1 })
  const text = `${sign > 0 ? "+" : sign < 0 ? "−" : ""}${magnitude}%`
  const srText =
    sign > 0
      ? `Aumento de ${magnitude}% em relação ao período anterior`
      : sign < 0
        ? `Queda de ${magnitude}% em relação ao período anterior`
        : "Sem variação em relação ao período anterior"
  return { text, srText, tone: sign > 0 ? "positive" : sign < 0 ? "negative" : "neutral", label }
}

/** Cores explícitas para o tema escuro. Preto puro não entra em série, eixo nem grade. */
export const CHART_COLORS = ["#38bdf8", "#f59e0b", "#34d399", "#a78bfa", "#fb7185", "#fbbf24"] as const

export const chartGrid = { stroke: "#334155", strokeDasharray: "3 3" }
export const chartAxis = { stroke: "#94a3b8", tick: { fill: "#cbd5e1", fontSize: 12 } }
export const chartTooltip = {
  contentStyle: {
    backgroundColor: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "8px",
    color: "#f8fafc",
  },
  labelStyle: { color: "#f8fafc" },
  itemStyle: { color: "#e2e8f0" },
}

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!
}

export function pieSlices<T extends { name: string; value: number }>(rows: T[]): T[] {
  return rows.filter((row) => row.value > 0)
}

export function chartIsEmpty(rows: Array<{ value?: number; indicacoes?: number; conversoes?: number; pago?: number; pendente?: number }>): boolean {
  return rows.length === 0 || rows.every((row) => (row.value ?? 0) + (row.indicacoes ?? 0) + (row.conversoes ?? 0) + (row.pago ?? 0) + (row.pendente ?? 0) === 0)
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const value = hex.replace("#", "")
    const channels = [0, 2, 4].map((start) => {
      const channel = Number.parseInt(value.slice(start, start + 2), 16) / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  }
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

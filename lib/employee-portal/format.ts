/** Formatação pt-BR sem float na origem (valores chegam como string decimal). */
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
const MONTH = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
const DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" })

export function formatMoney(value: string | null | undefined): string {
  if (value == null || value === "") return "—"
  const n = Number(value)
  return Number.isFinite(n) ? BRL.format(n) : "—"
}

export function formatCompetence(month: string | null | undefined): string {
  if (!month || !/^\d{4}-\d{2}/.test(month)) return "—"
  const d = new Date(`${month.slice(0, 7)}-01T00:00:00Z`)
  const s = MONTH.format(d)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : DATE.format(d)
}

const ALLOWED_KEYS = ["month", "period", "from", "to", "page", "pageSize", "q", "status", "origin", "indicator", "commercial", "plan", "offset", "limit", "sort", "stage", "commission", "role"] as const
const SCROLL_KEY = "igt-list-scroll"

function keep(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams()
  for (const key of ALLOWED_KEYS) {
    const value = params.get(key)
    if (value && value.length <= 200) next.set(key, value)
  }
  return next
}

export function buildInternalReturn(pathname: string, params: URLSearchParams): string {
  const query = keep(params).toString()
  return query ? `${pathname}?${query}` : pathname
}

/** Aceita só o caminho interno da lista. Destino externo, protocolo e barra invertida são descartados. */
export function safeInternalReturn(raw: string | null, pathname: string): string | null {
  if (!raw || raw.length > 1200) return null
  const decoded = raw.startsWith("/") ? raw : (() => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return ""
    }
  })()
  if (!decoded.startsWith("/") || decoded.length > 1200 || /[\u0000-\u001f\\]/.test(decoded)) return null
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) return null
  let url: URL
  try {
    url = new URL(decoded, "https://internal.local")
  } catch {
    return null
  }
  if (url.origin !== "https://internal.local" || url.pathname !== pathname) return null
  const query = keep(url.searchParams).toString()
  return query ? `${pathname}?${query}` : pathname
}

export function resolveListReturn(params: URLSearchParams, pathname: string): string {
  return safeInternalReturn(params.get("returnTo"), pathname) ?? buildInternalReturn(pathname, params)
}

export function rememberListScroll(href: string) {
  if (typeof window === "undefined") return
  sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ href, y: window.scrollY }))
}

export function restoreListScroll() {
  if (typeof window === "undefined") return
  const raw = sessionStorage.getItem(SCROLL_KEY)
  if (!raw) return
  sessionStorage.removeItem(SCROLL_KEY)
  try {
    const saved = JSON.parse(raw) as { href?: string; y?: number }
    const here = `${window.location.pathname}${window.location.search}`
    if (saved.href === here && Number.isFinite(saved.y)) window.scrollTo(0, Number(saved.y))
  } catch {
    sessionStorage.removeItem(SCROLL_KEY)
  }
}

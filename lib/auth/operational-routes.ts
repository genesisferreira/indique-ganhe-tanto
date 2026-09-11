/**
 * Mapa genérico setor → rota de UI.
 * Sem rota cadastrada = módulo ainda não implementado (não mostrar na sidebar).
 */
export const OPERATIONAL_SECTOR_ROUTE: Record<string, string> = {
  collections: "/cobranca",
  retention: "/retencao",
}

export function sectorCodeForOperationalHref(href: string): string | null {
  const path = href.trim()
  for (const [code, route] of Object.entries(OPERATIONAL_SECTOR_ROUTE)) {
    if (path === route || path.startsWith(`${route}/`)) return code
  }
  return null
}

export function operationalHrefForSectorCode(code: string): string | null {
  const route = OPERATIONAL_SECTOR_ROUTE[code]
  return route ?? null
}

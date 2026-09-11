export const SIDEBAR_NAV_GROUPS_STORAGE_PREFIX = "tanto.sidebar.nav-groups.v1"

export type CollapsibleNavGroupRef = {
  title: string
  items: ReadonlyArray<{ href: string }>
}

export function sidebarNavGroupsStorageKey(shell: string): string {
  return `${SIDEBAR_NAV_GROUPS_STORAGE_PREFIX}:${shell}`
}

export function navPathMatchesHref(pathname: string, href: string): boolean {
  const path = pathname.trim()
  const target = href.trim()
  if (!path || !target) return false
  if (path === target) return true
  if (target === "/") return false
  const prefix = target.endsWith("/") ? target : `${target}/`
  return path.startsWith(prefix)
}

export function resolveActiveNavHref(
  pathname: string,
  hrefs: readonly string[]
): string | null {
  const matches = hrefs.filter((href) => navPathMatchesHref(pathname, href))
  if (matches.length === 0) return null
  return [...matches].sort((a, b) => b.length - a.length)[0] ?? null
}

export function findNavGroupTitleForPathname(
  groups: readonly CollapsibleNavGroupRef[],
  pathname: string
): string | null {
  const hrefs = groups.flatMap((group) => group.items.map((item) => item.href))
  const activeHref = resolveActiveNavHref(pathname, hrefs)
  if (!activeHref) return null
  return groups.find((group) => group.items.some((item) => item.href === activeHref))?.title ?? null
}

export function parseStoredGroupOpenState(raw: string | null | undefined): Record<string, boolean> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const out: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") out[key] = value
    }
    return out
  } catch {
    return null
  }
}

export function serializeGroupOpenState(state: Record<string, boolean>): string {
  return JSON.stringify(state)
}

export function defaultGroupOpenState(
  groupTitles: readonly string[],
  activeTitle: string | null
): Record<string, boolean> {
  return Object.fromEntries(groupTitles.map((title) => [title, title === activeTitle]))
}

export function mergeUserGroupOpenState(input: {
  stored: Record<string, boolean> | null
  groupTitles: readonly string[]
  session?: Record<string, boolean>
}): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const title of input.groupTitles) {
    if (typeof input.stored?.[title] === "boolean") next[title] = input.stored[title]
    else if (typeof input.session?.[title] === "boolean") next[title] = input.session[title]
    else next[title] = false
  }
  return next
}

export function resolveDisplayGroupOpenState(
  userState: Record<string, boolean>,
  groupTitles: readonly string[],
  activeTitle: string | null
): Record<string, boolean> {
  const next = Object.fromEntries(
    groupTitles.map((title) => [title, userState[title] === true])
  )
  if (activeTitle) next[activeTitle] = true
  return next
}

export function mergeStoredGroupOpenState(input: {
  stored: Record<string, boolean> | null
  groupTitles: readonly string[]
  activeTitle: string | null
  session?: Record<string, boolean>
}): Record<string, boolean> {
  const user = mergeUserGroupOpenState({
    stored: input.stored,
    session: input.session,
    groupTitles: input.groupTitles,
  })
  return resolveDisplayGroupOpenState(user, input.groupTitles, input.activeTitle)
}

export function applyGroupOpenChange(input: {
  userState: Record<string, boolean>
  title: string
  open: boolean
  activeTitle: string | null
}): Record<string, boolean> {
  if (input.activeTitle && input.title === input.activeTitle) {
    return { ...input.userState }
  }
  return { ...input.userState, [input.title]: input.open }
}

export function toggleGroupOpenState(
  current: Record<string, boolean>,
  title: string
): Record<string, boolean> {
  return { ...current, [title]: current[title] !== true }
}

export function forceOpenGroupState(
  current: Record<string, boolean>,
  title: string | null
): Record<string, boolean> {
  if (!title) return current
  if (current[title] === true) return current
  return { ...current, [title]: true }
}

export function countExpandedNavGroups(state: Record<string, boolean>): number {
  return Object.values(state).filter(Boolean).length
}

export function navGroupPanelId(persistenceKey: string, title: string): string {
  const slug = `${persistenceKey}-${title}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return `nav-group-${slug}`
}

export function collapsibleNavTriggerAria(open: boolean): {
  "aria-expanded": "true" | "false"
} {
  return { "aria-expanded": open ? "true" : "false" }
}

export function safelyGetLocalStorageItem(getItem: () => string | null): string | null {
  try {
    return getItem()
  } catch {
    return null
  }
}

export function safelySetLocalStorageItem(
  setItem: (value: string) => void,
  value: string
): boolean {
  try {
    setItem(value)
    return true
  } catch {
    return false
  }
}

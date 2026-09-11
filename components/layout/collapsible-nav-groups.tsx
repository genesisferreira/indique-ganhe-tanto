"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import {
  applyGroupOpenChange,
  findNavGroupTitleForPathname,
  mergeUserGroupOpenState,
  navGroupPanelId,
  parseStoredGroupOpenState,
  resolveActiveNavHref,
  resolveDisplayGroupOpenState,
  safelyGetLocalStorageItem,
  safelySetLocalStorageItem,
  serializeGroupOpenState,
  sidebarNavGroupsStorageKey,
} from "@/lib/layout/collapsible-nav-groups"

export type CollapsibleNavGroup<T extends { href: string }> = {
  title: string
  items: T[]
}

function readStoredOpenState(storageKey: string): Record<string, boolean> | null {
  if (typeof window === "undefined") return null
  const raw = safelyGetLocalStorageItem(() => window.localStorage.getItem(storageKey))
  return parseStoredGroupOpenState(raw)
}

function persistUserOpenState(storageKey: string, state: Record<string, boolean>) {
  if (typeof window === "undefined") return
  safelySetLocalStorageItem(
    (value) => window.localStorage.setItem(storageKey, value),
    serializeGroupOpenState(state)
  )
}

export function CollapsibleNavGroups<T extends { href: string }>({
  groups,
  pathname,
  persistenceKey,
  renderItem,
  className,
}: {
  groups: Array<CollapsibleNavGroup<T>>
  pathname: string
  persistenceKey: string
  renderItem: (item: T, ctx: { isActive: boolean }) => React.ReactNode
  className?: string
}) {
  const reactId = useId()
  const storageKey = sidebarNavGroupsStorageKey(persistenceKey)
  const groupTitles = useMemo(() => groups.map((group) => group.title), [groups])
  const groupTitleKey = groupTitles.join("\0")
  const hrefs = useMemo(
    () => groups.flatMap((group) => group.items.map((item) => item.href)),
    [groups]
  )
  const activeHref = resolveActiveNavHref(pathname, hrefs)
  const activeTitle = findNavGroupTitleForPathname(groups, pathname)

  const [userOpenState, setUserOpenState] = useState<Record<string, boolean>>(() =>
    mergeUserGroupOpenState({
      stored: null,
      groupTitles,
    })
  )

  useEffect(() => {
    setUserOpenState(
      mergeUserGroupOpenState({
        stored: readStoredOpenState(storageKey),
        groupTitles,
      })
    )
  }, [storageKey, groupTitleKey, groupTitles])

  const openState = resolveDisplayGroupOpenState(userOpenState, groupTitles, activeTitle)

  function handleOpenChange(title: string, open: boolean) {
    setUserOpenState((current) => {
      const next = applyGroupOpenChange({
        userState: current,
        title,
        open,
        activeTitle,
      })
      persistUserOpenState(storageKey, next)
      return next
    })
  }

  return (
    <div className={cn("space-y-1", className)}>
      {groups.map((group) => {
        const open = openState[group.title] === true
        const panelId = `${navGroupPanelId(persistenceKey, group.title)}-${reactId}`
        return (
          <Collapsible
            key={group.title}
            open={open}
            onOpenChange={(next) => handleOpenChange(group.title, next)}
          >
            <CollapsibleTrigger
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold tracking-wider uppercase text-muted-foreground transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              )}
              aria-controls={panelId}
              aria-expanded={open}
            >
              <span>{group.title}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                  open && "rotate-180"
                )}
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent id={panelId}>
              <ul className="mt-1 space-y-1">
                {group.items.map((item) => (
                  <li key={item.href}>{renderItem(item, { isActive: item.href === activeHref })}</li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )
      })}
    </div>
  )
}

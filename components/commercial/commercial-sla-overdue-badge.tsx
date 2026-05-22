"use client"

import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CommercialSlaLevel } from "@/lib/commercial-sla"

type CommercialSlaOverdueBadgeProps = {
  /** Nível escalonado (preferido). */
  level?: CommercialSlaLevel
  /** Legado: equivalente a level !== 'none' com nível warning. */
  overdue?: boolean
  variant?: "default" | "compact"
  className?: string
}

const LEVEL_CONFIG: Record<
  Exclude<CommercialSlaLevel, "none">,
  {
    label: string
    compactLabel: string
    title: string
    className: string
  }
> = {
  warning: {
    label: "SLA 15 min",
    compactLabel: "15m",
    title: "Alerta SLA: sem primeiro contato há mais de 15 minutos",
    className:
      "bg-warning/15 text-warning border-warning/35",
  },
  critical: {
    label: "SLA crítico",
    compactLabel: "30m",
    title: "SLA crítico: sem primeiro contato há mais de 30 minutos",
    className:
      "bg-destructive/15 text-destructive border-destructive/35",
  },
  redistribution_ready: {
    label: "Redistribuir",
    compactLabel: "45m",
    title: "Elegível para redistribuição: sem primeiro contato há mais de 45 minutos",
    className:
      "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/35",
  },
}

function resolveLevel(
  level?: CommercialSlaLevel,
  overdue?: boolean
): CommercialSlaLevel {
  if (level && level !== "none") return level
  if (overdue) return "warning"
  return "none"
}

export function CommercialSlaOverdueBadge({
  level,
  overdue = false,
  variant = "default",
  className,
}: CommercialSlaOverdueBadgeProps) {
  const resolved = resolveLevel(level, overdue)
  if (resolved === "none") return null

  const config = LEVEL_CONFIG[resolved]

  if (variant === "compact") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border",
          config.className,
          className
        )}
        title={config.title}
      >
        <AlertTriangle className="h-2.5 w-2.5 shrink-0" aria-hidden />
        {config.compactLabel}
      </span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        config.className,
        className
      )}
      title={config.title}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      {config.label}
    </span>
  )
}

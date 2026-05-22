"use client"

import { RefreshCw } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type CommercialRedistributedBadgeProps = {
  redistributionCount?: number
  previousCommercialName?: string | null
  variant?: "default" | "compact"
  className?: string
}

export function CommercialRedistributedBadge({
  redistributionCount = 0,
  previousCommercialName,
  variant = "default",
  className,
}: CommercialRedistributedBadgeProps) {
  if (redistributionCount <= 0) return null

  const tooltipText = previousCommercialName
    ? `Redistribuído ${redistributionCount}x · Comercial anterior: ${previousCommercialName}`
    : `Redistribuído ${redistributionCount}x por SLA`

  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border font-medium",
        "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
        variant === "compact"
          ? "px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
          : "px-2 py-0.5 text-xs rounded-full",
        className
      )}
    >
      <RefreshCw className={variant === "compact" ? "h-2.5 w-2.5" : "h-3 w-3"} aria-hidden />
      {variant === "compact" ? `R${redistributionCount}` : `Redistribuído (${redistributionCount})`}
    </span>
  )

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{badge}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

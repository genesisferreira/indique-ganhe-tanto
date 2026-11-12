import { cn } from "@/lib/utils"
import type { BadgeTone } from "@/lib/employee-portal/terminology"

/**
 * Badge CONTEXTUAL da área do funcionário/remuneração (3.1F-J2).
 * Não reutiliza o StatusBadge global do Indique e Ganhe ("Paga"/"Disponível").
 */
const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-info/20 text-info border-info/30",
  warning: "bg-warning/20 text-warning border-warning/30",
  success: "bg-success/20 text-success border-success/30",
  danger: "bg-destructive/20 text-destructive border-destructive/30",
  primary: "bg-primary/20 text-primary border-primary/30",
}

export function StatusPill({ label, tone = "neutral", className }: { label: string; tone?: BadgeTone; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-medium break-words whitespace-normal",
        TONE_CLASS[tone],
        className
      )}
    >
      {label}
    </span>
  )
}

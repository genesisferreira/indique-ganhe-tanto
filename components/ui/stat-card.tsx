import { cn } from "@/lib/utils"
import { LucideIcon } from "lucide-react"
import { describeStatCardTrend, type StatCardTrend } from "@/components/ui/stat-card-trend"

export type { StatCardTrend } from "@/components/ui/stat-card-trend"

interface StatCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon?: LucideIcon
  /** 3.1F-K1: somente comparação real e explícita; ausente => nenhuma tendência é exibida. */
  trend?: StatCardTrend
  variant?: "default" | "primary" | "success" | "warning" | "destructive"
  className?: string
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  variant = "default",
  className,
}: StatCardProps) {
  const variantStyles = {
    default: "bg-card",
    primary: "bg-primary/10 border-primary/20",
    success: "bg-success/10 border-success/20",
    warning: "bg-warning/10 border-warning/20",
    destructive: "bg-destructive/10 border-destructive/20",
  }

  const trendView = describeStatCardTrend(trend)

  const iconStyles = {
    default: "text-muted-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-5 transition-all hover:shadow-lg hover:shadow-primary/5",
        variantStyles[variant],
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {Icon && (
          <div
            className={cn(
              "flex items-center justify-center w-10 h-10 rounded-lg bg-secondary",
              iconStyles[variant]
            )}
          >
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
      {trendView && (
        <p className="mt-3 flex items-center gap-1.5 text-xs" data-stat-trend={trendView.tone}>
          <span className="sr-only">{trendView.srText}</span>
          <span
            aria-hidden="true"
            className={cn(
              "font-medium",
              trendView.tone === "positive" && "text-success",
              trendView.tone === "negative" && "text-destructive",
              trendView.tone === "neutral" && "text-muted-foreground"
            )}
          >
            {trendView.text}
          </span>
          {trendView.label && <span className="text-muted-foreground">{trendView.label}</span>}
        </p>
      )}
    </div>
  )
}

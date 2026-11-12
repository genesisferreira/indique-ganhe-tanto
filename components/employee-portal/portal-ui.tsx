import Link from "next/link"
import { cn } from "@/lib/utils"

/** Card de métrica sem tendência fictícia (não reutiliza o StatCard com "+12%"). */
export function MetricCard({ title, value, hint, className }: { title: string; value: string; hint?: string; className?: string }) {
  return (
    <section
      aria-label={title}
      className={cn("min-w-0 rounded-xl border border-border/50 bg-card/50 p-4", className)}
    >
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground break-words">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </section>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: { href: string; label: string } }) {
  return (
    <div role="status" className="rounded-xl border border-dashed border-border/60 bg-card/30 p-6 text-center">
      <p className="font-medium text-foreground">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">{description}</p> : null}
      {action ? (
        <Link href={action.href} className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {action.label}
        </Link>
      ) : null}
    </div>
  )
}

export function ErrorState({ title, description }: { title: string; description: string }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-6">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-border/50 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{children}</p>
  )
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}</span>
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/60" />
        ))}
      </div>
    </div>
  )
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      ← {label}
    </Link>
  )
}

"use client"

import { CheckCircle2, Circle, XCircle } from "lucide-react"
import type { BrbyteTimelineStep } from "@/lib/brbyte/observability"
import { cn } from "@/lib/utils"

type BrbyteReferralTimelineProps = {
  steps: BrbyteTimelineStep[]
}

function StepIcon({ state }: { state: BrbyteTimelineStep["state"] }) {
  if (state === "done") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
  }
  if (state === "error") {
    return <XCircle className="h-4 w-4 shrink-0 text-destructive" />
  }
  return <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
}

export function BrbyteReferralTimeline({ steps }: BrbyteReferralTimelineProps) {
  return (
    <ol className="space-y-3 border-t border-border pt-3">
      {steps.map((step, index) => (
        <li key={step.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <StepIcon state={step.state} />
            {index < steps.length - 1 ? (
              <span className="mt-1 h-full w-px flex-1 bg-border" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1 space-y-0.5 pb-1">
            <p
              className={cn(
                "font-medium leading-tight",
                step.state === "done" && "text-foreground",
                step.state === "error" && "text-destructive",
                step.state === "pending" && "text-muted-foreground"
              )}
            >
              {step.label}
            </p>
            {step.entityId ? (
              <p className="text-xs text-muted-foreground break-all">
                {step.id === "reward_reserved"
                  ? "Reward ID"
                  : step.id === "credit_released"
                    ? "Transação"
                    : "ID"}
                : {step.entityId}
              </p>
            ) : null}
            {step.date ? (
              <p className="text-xs text-muted-foreground">
                {new Date(step.date).toLocaleString("pt-BR")}
              </p>
            ) : null}
            {step.hint ? (
              <p className="text-xs text-muted-foreground">{step.hint}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

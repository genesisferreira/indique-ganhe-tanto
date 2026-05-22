import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/cron/auth"
import {
  logCronCommercialSlaError,
  logCronCommercialSlaStart,
  logCronCommercialSlaSuccess,
  runCommercialSlaCron,
} from "@/lib/cron/commercial-sla"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handleCron(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  logCronCommercialSlaStart()

  try {
    const bundle = await runCommercialSlaCron()
    const executedAt = new Date().toISOString()
    const { escalation, redistribution, usedFallback, rpcError } = bundle

    if (rpcError || escalation.ok === false) {
      logCronCommercialSlaError({ rpcError, escalation, redistribution, usedFallback })
      return NextResponse.json(
        {
          ok: false,
          source: "commercial-sla-cron",
          escalation,
          redistribution,
          executedAt,
          usedFallback,
          error: rpcError ?? escalation.message ?? "rpc_failed",
        },
        { status: 500 }
      )
    }

    logCronCommercialSlaSuccess({
      escalation,
      redistribution,
      executedAt,
      usedFallback,
    })

    return NextResponse.json({
      ok: true,
      source: "commercial-sla-cron",
      escalation,
      redistribution,
      executedAt,
      usedFallback,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logCronCommercialSlaError({ message })
    return NextResponse.json(
      {
        ok: false,
        source: "commercial-sla-cron",
        error: message,
        executedAt: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  return handleCron(request)
}

export async function POST(request: Request) {
  return handleCron(request)
}

import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/cron/auth"
import {
  logCronBrbyteSyncStart,
  runBrbyteSyncCron,
} from "@/lib/cron/brbyte-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handleCron(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        source: "brbyte-sync-cron",
        error: "unauthorized",
        executedAt: new Date().toISOString(),
      },
      { status: 401 }
    )
  }

  logCronBrbyteSyncStart()

  try {
    const payload = await runBrbyteSyncCron()
    const status = payload.ok ? 200 : 500
    return NextResponse.json(payload, { status })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json(
      {
        ok: false,
        source: "brbyte-sync-cron",
        error: message,
        executedAt: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

/** Vercel Cron usa GET por padrão. POST permitido para testes manuais. */
export async function GET(request: Request) {
  return handleCron(request)
}

export async function POST(request: Request) {
  return handleCron(request)
}

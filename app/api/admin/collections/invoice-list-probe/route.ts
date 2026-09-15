import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { jsonError } from "@/lib/collections/http"
import { runInvoiceListProbe } from "@/lib/brbyte/invoice-list-probe"
import { COLLECTION_SECTOR_CODE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

/**
 * Probe Admin Master: só POST aciona UM POST de listagem no Controllr
 * (`/invoice_ctl/invoice/list`). GET não chama o ERP. Não é Sync.
 * Não grava casos. Não chama assignment.
 */
export async function GET() {
  return jsonError(405, "Use POST para acionar o probe de listagem.")
}

export async function POST(request: Request) {
  const auth = await authorizeOperationalRequest({
    sectorCode: COLLECTION_SECTOR_CODE,
    action: "sync",
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)

  let formatIndex: unknown
  let timeoutMs: unknown
  try {
    const body = (await request.json()) as Record<string, unknown> | null
    if (body && typeof body === "object") {
      formatIndex = body.format
      timeoutMs = body.timeoutMs
    }
  } catch {
    formatIndex = undefined
    timeoutMs = undefined
  }

  const result = await runInvoiceListProbe({ formatIndex, timeoutMs })
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}

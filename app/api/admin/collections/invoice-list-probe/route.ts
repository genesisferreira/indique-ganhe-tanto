import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { jsonError } from "@/lib/collections/http"
import { runInvoiceListProbe } from "@/lib/brbyte/invoice-list-probe"
import { COLLECTION_SECTOR_CODE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

/**
 * Probe Admin Master: GET dispara UM POST de listagem no Controllr
 * (`/invoice_ctl/invoice/list`). Não é Sync. Não grava casos. Não chama assignment.
 */
export async function GET(request: Request) {
  const auth = await authorizeOperationalRequest({
    sectorCode: COLLECTION_SECTOR_CODE,
    action: "sync",
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)

  const url = new URL(request.url)
  const result = await runInvoiceListProbe({
    formatIndex: url.searchParams.get("format"),
    timeoutMs: url.searchParams.get("timeoutMs"),
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}

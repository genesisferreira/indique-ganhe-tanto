import { NextResponse } from "next/server"
import { authorizeRetentionCustomerRequest } from "@/lib/collections/actor"
import { jsonError } from "@/lib/collections/http"
import { parseOperationalDocument } from "@/lib/operational/document"
import { loadMergedCustomerTimeline } from "@/lib/operational/history.service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const auth = await authorizeRetentionCustomerRequest("read")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const url = new URL(request.url)
  const rawDocument = url.searchParams.get("document") ?? ""
  const clientPk = url.searchParams.get("clientPk") ?? ""
  const parsed = rawDocument ? parseOperationalDocument(rawDocument) : null
  if (rawDocument && parsed && !parsed.ok) {
    return jsonError(400, "Informe um CPF ou CNPJ válido.")
  }
  const timeline = await loadMergedCustomerTimeline({
    documentDigits: parsed && parsed.ok ? parsed.document.digits : null,
    clientPk: clientPk || null,
  })
  return NextResponse.json({
    ok: true,
    items: timeline.items,
    controllrHistoryAvailable: timeline.controllrHistoryAvailable,
    controllrHistoryWriteEnabled: false,
  })
}

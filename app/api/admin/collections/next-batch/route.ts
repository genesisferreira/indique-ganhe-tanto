import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { jsonError } from "@/lib/collections/http"
import { readNextBatchBody } from "@/lib/collections/next-batch"
import { loadNextBatchSummary, runNextBatch } from "@/lib/collections/next-batch.service"
import { COLLECTION_SECTOR_CODE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * Sprint 3.1E-AU — "Carregar próxima leva" (Admin Master).
 * Unidade operacional: contrato distinto (contract_only). Sem runId no body.
 * capacity_full/busy → nenhuma autenticação no ERP e nenhuma invoice/list.
 * Não envia mensagens nem executa contato automático.
 */
async function authorize() {
  const auth = await authorizeOperationalRequest({
    sectorCode: COLLECTION_SECTOR_CODE,
    action: "sync",
  })
  if (!auth.ok) return { ok: false as const, res: jsonError(auth.status, auth.message) }
  if (auth.kind !== "admin_master") {
    return { ok: false as const, res: jsonError(403, "Apenas Admin Master.") }
  }
  return { ok: true as const, profileId: auth.profileId }
}

export async function GET() {
  const auth = await authorize()
  if (!auth.ok) return auth.res
  const loaded = await loadNextBatchSummary()
  if (!loaded.ok) return jsonError(503, loaded.message)
  return NextResponse.json({ ok: true, summary: loaded.summary })
}

export async function POST(request: Request) {
  const auth = await authorize()
  if (!auth.ok) return auth.res
  const body = await request.json().catch(() => null)
  const parsed = readNextBatchBody(body)
  if (!parsed.ok) return jsonError(400, parsed.message)
  const result = await runNextBatch({ actorProfileId: auth.profileId })
  return NextResponse.json(result.body, { status: result.status })
}

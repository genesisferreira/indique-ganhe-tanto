import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { jsonError } from "@/lib/collections/http"
import { syncCollectionsFromControllr } from "@/lib/collections/sync"
import { COLLECTION_SECTOR_CODE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Sync manual admin em lotes retomáveis. NÃO é cron. NÃO altera vercel.json.
 * NÃO escreve no Controllr. NÃO ativa flags BRByte.
 */
export async function POST(request: Request) {
  const auth = await authorizeOperationalRequest({
    sectorCode: COLLECTION_SECTOR_CODE,
    action: "sync",
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)

  let runId: string | null = null
  try {
    const body = (await request.json()) as Record<string, unknown> | null
    if (typeof body?.runId === "string" && body.runId.trim()) {
      runId = body.runId.trim()
    }
  } catch {
    runId = null
  }

  const result = await syncCollectionsFromControllr({
    actorProfileId: auth.profileId,
    runId,
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}

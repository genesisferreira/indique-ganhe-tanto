import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { jsonError } from "@/lib/collections/http"
import { syncCollectionsFromControllr } from "@/lib/collections/sync"
import { COLLECTION_SECTOR_CODE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Sync manual admin. NÃO é cron. NÃO altera vercel.json.
 * NÃO escreve no Controllr. NÃO ativa flags BRByte.
 */
export async function POST() {
  const auth = await authorizeOperationalRequest({
    sectorCode: COLLECTION_SECTOR_CODE,
    action: "sync",
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)

  const result = await syncCollectionsFromControllr({
    actorProfileId: auth.profileId,
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}

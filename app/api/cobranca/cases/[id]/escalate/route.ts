import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { escalateCollectionToRetention } from "@/lib/collections/escalate"
import { jsonError, stripBrowserActor } from "@/lib/collections/http"
import { COLLECTION_SECTOR_CODE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeOperationalRequest({
    sectorCode: COLLECTION_SECTOR_CODE,
    action: "write",
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)

  const body = stripBrowserActor(await request.json().catch(() => null))
  const reason = typeof body.reason === "string" ? body.reason : null
  const { id } = await context.params
  const result = await escalateCollectionToRetention({
    collectionCaseId: id,
    actorProfileId: auth.profileId,
    reason,
  })
  if (!result.ok) return jsonError(400, result.message ?? result.code)
  return NextResponse.json(result)
}

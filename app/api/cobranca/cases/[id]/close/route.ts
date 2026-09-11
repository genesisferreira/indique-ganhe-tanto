import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { updateCollectionStatus } from "@/lib/collections/cases.service"
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

  stripBrowserActor(await request.json().catch(() => null))
  const { id } = await context.params
  const result = await updateCollectionStatus({
    caseId: id,
    actorProfileId: auth.profileId,
    status: "closed",
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({ ok: true })
}

import { NextResponse } from "next/server"
import { authorizeOperationalCaseWrite } from "@/lib/collections/actor"
import { escalateCollectionToRetention } from "@/lib/collections/escalate"
import { jsonError, stripBrowserActor } from "@/lib/collections/http"
import { COLLECTION_SECTOR_CODE, COLLECTION_WORK_TYPE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const auth = await authorizeOperationalCaseWrite({
    sectorCode: COLLECTION_SECTOR_CODE,
    workType: COLLECTION_WORK_TYPE,
    workId: id,
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)

  const body = stripBrowserActor(await request.json().catch(() => null))
  const reason = typeof body.reason === "string" ? body.reason : null
  const result = await escalateCollectionToRetention({
    collectionCaseId: id,
    actorProfileId: auth.profileId,
    reason,
  })
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code, message: result.message ?? result.code },
      { status: 400 }
    )
  }
  return NextResponse.json(result)
}

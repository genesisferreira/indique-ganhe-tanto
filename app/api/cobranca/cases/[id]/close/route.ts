import { NextResponse } from "next/server"
import { authorizeOperationalCaseWrite } from "@/lib/collections/actor"
import { updateCollectionStatus } from "@/lib/collections/cases.service"
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

  stripBrowserActor(await request.json().catch(() => null))
  const result = await updateCollectionStatus({
    caseId: id,
    actorProfileId: auth.profileId,
    employeeId: auth.context?.employeeId ?? auth.employeeId,
    status: "closed",
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({ ok: true })
}

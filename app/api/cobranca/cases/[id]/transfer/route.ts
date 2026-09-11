import { NextResponse } from "next/server"
import { authorizeOperationalCaseWrite } from "@/lib/collections/actor"
import { transferCollectionCase } from "@/lib/collections/cases.service"
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
  const toEmployeeId = String(body.toEmployeeId ?? body.to_employee_id ?? "").trim()
  if (!toEmployeeId) return jsonError(400, "Informe o funcionário de destino.")

  const result = await transferCollectionCase({
    caseId: id,
    toEmployeeId,
    actorProfileId: auth.profileId,
    reason: typeof body.reason === "string" ? body.reason : null,
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({ ok: true, assignmentId: result.assignmentId })
}

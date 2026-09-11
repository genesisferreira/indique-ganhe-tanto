import { NextResponse } from "next/server"
import { authorizeOperationalCaseWrite } from "@/lib/collections/actor"
import { jsonError, stripBrowserActor } from "@/lib/collections/http"
import { transferRetentionCase } from "@/lib/retention/cases.service"
import { RETENTION_SECTOR_CODE, RETENTION_WORK_TYPE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const auth = await authorizeOperationalCaseWrite({
    sectorCode: RETENTION_SECTOR_CODE,
    workType: RETENTION_WORK_TYPE,
    workId: id,
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const body = stripBrowserActor(await request.json().catch(() => null))
  const toEmployeeId = String(body.toEmployeeId ?? body.to_employee_id ?? "").trim()
  if (!toEmployeeId) return jsonError(400, "Informe o funcionário de destino.")
  const result = await transferRetentionCase({
    caseId: id,
    toEmployeeId,
    actorProfileId: auth.profileId,
    reason: typeof body.reason === "string" ? body.reason : null,
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({ ok: true, assignmentId: result.assignmentId })
}

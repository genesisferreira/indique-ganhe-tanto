import { NextResponse } from "next/server"
import { authorizeOperationalCaseWrite } from "@/lib/collections/actor"
import { jsonError, stripBrowserActor } from "@/lib/collections/http"
import { updateRetentionStatus } from "@/lib/retention/cases.service"
import {
  RETENTION_SECTOR_CODE,
  RETENTION_STATUSES,
  RETENTION_WORK_TYPE,
} from "@/types/collections"

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
  const status = String(body.status ?? "")
  if (!(RETENTION_STATUSES as readonly string[]).includes(status)) {
    return jsonError(400, "Status inválido.")
  }
  const result = await updateRetentionStatus({
    caseId: id,
    actorProfileId: auth.profileId,
    status: status as (typeof RETENTION_STATUSES)[number],
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({ ok: true, status: result.status })
}

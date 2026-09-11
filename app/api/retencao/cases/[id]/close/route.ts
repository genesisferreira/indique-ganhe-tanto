import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { jsonError } from "@/lib/collections/http"
import { updateRetentionStatus } from "@/lib/retention/cases.service"
import { RETENTION_SECTOR_CODE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeOperationalRequest({
    sectorCode: RETENTION_SECTOR_CODE,
    action: "write",
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const { id } = await context.params
  const result = await updateRetentionStatus({
    caseId: id,
    actorProfileId: auth.profileId,
    status: "closed",
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({ ok: true })
}

import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { registerCollectionContact } from "@/lib/collections/cases.service"
import { jsonError, readContactPayload } from "@/lib/collections/http"
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

  const payload = readContactPayload(await request.json().catch(() => null))
  if ("error" in payload) return jsonError(400, payload.error)

  const { id } = await context.params
  const result = await registerCollectionContact({
    caseId: id,
    actorProfileId: auth.profileId,
    channel: payload.channel,
    outcome: payload.outcome,
    notes: payload.notes,
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({ ok: true })
}

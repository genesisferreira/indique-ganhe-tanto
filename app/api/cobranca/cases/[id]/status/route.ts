import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { updateCollectionStatus } from "@/lib/collections/cases.service"
import { jsonError, stripBrowserActor } from "@/lib/collections/http"
import { COLLECTION_SECTOR_CODE, COLLECTION_STATUSES } from "@/types/collections"

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
  const status = String(body.status ?? "")
  if (!(COLLECTION_STATUSES as readonly string[]).includes(status)) {
    return jsonError(400, "Status inválido.")
  }
  if (status === "paid" || status === "escalated_retention") {
    return jsonError(400, "Este status não pode ser definido pelo browser.")
  }

  const { id } = await context.params
  const result = await updateCollectionStatus({
    caseId: id,
    actorProfileId: auth.profileId,
    status: status as (typeof COLLECTION_STATUSES)[number],
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({ ok: true, status: result.status })
}

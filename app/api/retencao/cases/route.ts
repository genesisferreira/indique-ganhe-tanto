import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { jsonError, stripBrowserActor } from "@/lib/collections/http"
import {
  createManualRetentionCase,
  listRetentionCases,
  summarizeRetentionDashboard,
} from "@/lib/retention/cases.service"
import { RETENTION_SECTOR_CODE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await authorizeOperationalRequest({
    sectorCode: RETENTION_SECTOR_CODE,
    action: "read",
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const adminAll = auth.kind === "admin_read" || auth.kind === "admin_master"
  const items = await listRetentionCases({
    employeeId: auth.context?.employeeId ?? null,
    adminAll,
  })
  return NextResponse.json({
    ok: true,
    kind: auth.kind,
    dashboard: summarizeRetentionDashboard(items),
    items,
  })
}

export async function POST(request: Request) {
  const auth = await authorizeOperationalRequest({
    sectorCode: RETENTION_SECTOR_CODE,
    action: "write",
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const body = stripBrowserActor(await request.json().catch(() => null))
  const result = await createManualRetentionCase({
    actorProfileId: auth.profileId,
    clientPk: typeof body.clientPk === "string" ? body.clientPk : null,
    contractPk: typeof body.contractPk === "string" ? body.contractPk : null,
    reason: typeof body.reason === "string" ? body.reason : "",
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({ ok: true, id: result.id })
}

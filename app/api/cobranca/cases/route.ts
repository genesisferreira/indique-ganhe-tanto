import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import {
  listCollectionCases,
  summarizeCollectionDashboard,
} from "@/lib/collections/cases.service"
import { jsonError } from "@/lib/collections/http"
import { COLLECTION_SECTOR_CODE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await authorizeOperationalRequest({
    sectorCode: COLLECTION_SECTOR_CODE,
    action: "read",
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)

  const adminAll = auth.kind === "admin_read" || auth.kind === "admin_master"
  const items = await listCollectionCases({
    employeeId: auth.context?.employeeId ?? null,
    adminAll,
  })
  return NextResponse.json({
    ok: true,
    kind: auth.kind,
    dashboard: summarizeCollectionDashboard(items),
    items,
  })
}

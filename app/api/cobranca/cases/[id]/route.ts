import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { getCollectionCaseDetail } from "@/lib/collections/cases.service"
import { jsonError } from "@/lib/collections/http"
import { COLLECTION_SECTOR_CODE } from "@/types/collections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeOperationalRequest({
    sectorCode: COLLECTION_SECTOR_CODE,
    action: "read",
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)

  const { id } = await context.params
  const detail = await getCollectionCaseDetail(id)
  if (!detail.case) return jsonError(404, "Caso não encontrado.")

  if (auth.kind === "member") {
    const mine = auth.context?.employeeId
    if (!mine || detail.assigneeEmployeeId !== mine) {
      return jsonError(403, "Caso não atribuído a este funcionário.")
    }
  }

  let operationalHistory: unknown[] = []
  let controllrHistoryAvailable = false
  if (auth.role !== "admin_financeiro" && detail.case.clientPk) {
    const { loadMergedCustomerTimeline } = await import("@/lib/operational/history.service")
    const timeline = await loadMergedCustomerTimeline({ clientPk: detail.case.clientPk })
    operationalHistory = timeline.items
    controllrHistoryAvailable = timeline.controllrHistoryAvailable
  }

  return NextResponse.json({
    ok: true,
    ...detail,
    operationalHistory,
    controllrHistoryAvailable,
  })
}

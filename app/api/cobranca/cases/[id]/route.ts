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

  return NextResponse.json({ ok: true, ...detail })
}

import { NextResponse } from "next/server"
import { authorizeOperationalCaseWrite } from "@/lib/collections/actor"
import { registerCollectionContact } from "@/lib/collections/cases.service"
import { acquireContractContactLock } from "@/lib/collections/contract-lock.service"
import { jsonError, readContactPayload } from "@/lib/collections/http"
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

  const payload = readContactPayload(await request.json().catch(() => null))
  if ("error" in payload) return jsonError(400, payload.error)

  // Sprint 3.1E-AU: um atendimento ativo por contract_pk (transacional no banco).
  const lock = await acquireContractContactLock({ caseId: id, profileId: auth.profileId })
  if (!lock.allowed) return jsonError(409, lock.message ?? "Contrato em atendimento.")

  const result = await registerCollectionContact({
    caseId: id,
    actorProfileId: auth.profileId,
    employeeId: auth.context?.employeeId ?? auth.employeeId,
    channel: payload.channel,
    outcome: payload.outcome,
    notes: payload.notes,
  })
  if (!result.ok) return jsonError(400, result.message)
  return NextResponse.json({ ok: true })
}

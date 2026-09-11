import "server-only"

import { asString, awaitQuery, getOpsDb } from "@/lib/collections/db"
import { getControllrCustomerHistory } from "@/lib/controllr/customer-history"
import { maskOperationalDocument } from "@/lib/operational/document"
import {
  forceCrmHistorySource,
  mergeOperationalTimeline,
  type AppendOperationalHistoryInput,
  type OperationalHistoryItem,
} from "@/lib/operational/history"

function mapHistoryRow(row: Record<string, unknown>): OperationalHistoryItem {
  return {
    id: String(row.id),
    clientPk: asString(row.client_pk),
    contractPk: asString(row.contract_pk),
    documentMasked: maskOperationalDocument(asString(row.document_reference)),
    customerNameSnapshot: asString(row.customer_name_snapshot),
    sectorCode: String(row.sector_code),
    employeeId: asString(row.employee_id),
    actorProfileId: asString(row.actor_profile_id),
    source: row.source === "controllr" ? "controllr" : "crm",
    externalHistoryId: asString(row.external_history_id),
    eventType: String(row.event_type),
    action: asString(row.action),
    result: asString(row.result),
    notes: asString(row.notes),
    customerRemains: typeof row.customer_remains === "boolean" ? row.customer_remains : null,
    occurredAt: String(row.occurred_at),
  }
}

export async function appendCustomerOperationalHistory(
  input: AppendOperationalHistoryInput
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const db = getOpsDb()
  const { data, error } = await db
    .from("customer_operational_history")
    .insert({
      client_pk: input.clientPk ?? null,
      contract_pk: input.contractPk ?? null,
      document_reference: input.documentReference ?? null,
      customer_name_snapshot: input.customerNameSnapshot ?? null,
      sector_code: input.sectorCode,
      employee_id: input.employeeId ?? null,
      actor_profile_id: input.actorProfileId ?? null,
      source: forceCrmHistorySource(),
      event_type: input.eventType,
      action: input.action ?? null,
      result: input.result ?? null,
      notes: input.notes ?? null,
      customer_remains: input.customerRemains ?? null,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      metadata: input.metadata ?? {},
    })
    .select("id")
    .maybeSingle()

  if (error || !data?.id) {
    return { ok: false, message: error?.message ?? "Não foi possível registrar o histórico." }
  }
  return { ok: true, id: String(data.id) }
}

export async function listCustomerOperationalHistory(input: {
  documentDigits?: string | null
  clientPk?: string | null
  contractPk?: string | null
}): Promise<OperationalHistoryItem[]> {
  const db = getOpsDb()
  let query = db
    .from("customer_operational_history")
    .select(
      "id, client_pk, contract_pk, document_reference, customer_name_snapshot, sector_code, employee_id, actor_profile_id, source, external_history_id, event_type, action, result, notes, customer_remains, occurred_at"
    )
    .order("occurred_at", { ascending: false })
    .limit(200)

  if (input.documentDigits) {
    query = query.eq("document_reference", input.documentDigits)
  } else if (input.clientPk) {
    query = query.eq("client_pk", input.clientPk)
  } else if (input.contractPk) {
    query = query.eq("contract_pk", input.contractPk)
  } else {
    return []
  }

  const { data } = await awaitQuery<Record<string, unknown>>(query)
  return (data ?? []).map((row) => mapHistoryRow(row))
}

export async function loadMergedCustomerTimeline(input: {
  documentDigits?: string | null
  clientPk?: string | null
  contractPk?: string | null
}): Promise<{
  items: OperationalHistoryItem[]
  controllrHistoryAvailable: false
}> {
  const crm = await listCustomerOperationalHistory(input)
  const controllr = await getControllrCustomerHistory({
    clientPk: input.clientPk,
    contractPk: input.contractPk,
    documentDigits: input.documentDigits,
  })
  return {
    items: mergeOperationalTimeline({ crm, controllr: controllr.items }),
    controllrHistoryAvailable: false,
  }
}

import "server-only"

import {
  ensureCollectionAssignment,
  insertCollectionCaseEvent,
} from "@/lib/collections/cases.service"
import { asString, getOpsDb } from "@/lib/collections/db"
import type { DiscoveryCaseRepo } from "@/lib/collections/discovery-persist"
import type { ExistingCollectionCase } from "@/lib/collections/sync-decision"
import type { CollectionCaseStatus } from "@/types/collections"

export function createOpsDiscoveryCaseRepo(): DiscoveryCaseRepo {
  const db = getOpsDb()
  return {
    async findByInvoicePk(invoicePk) {
      const { data } = await db
        .from("collection_cases")
        .select("id, status, invoice_pk")
        .eq("invoice_pk", invoicePk)
        .maybeSingle()
      const id = data?.id ? String(data.id) : null
      if (!id) return null
      return {
        id,
        status: String(data?.status ?? "open") as CollectionCaseStatus,
        invoicePk: asString(data?.invoice_pk) ?? invoicePk,
      } satisfies ExistingCollectionCase
    },
    async insertOpen(writeModel) {
      const inserted = await db
        .from("collection_cases")
        .insert(writeModel)
        .select("id")
        .maybeSingle()
      if (inserted.data?.id) return { id: String(inserted.data.id), inserted: true }
      const invoicePk = String(writeModel.invoice_pk ?? "")
      const again = await db
        .from("collection_cases")
        .select("id")
        .eq("invoice_pk", invoicePk)
        .maybeSingle()
      if (again.data?.id) return { id: String(again.data.id), inserted: false }
      throw new Error("persist_error")
    },
    async updateFinancials(caseId, writeModel) {
      const {
        client_pk,
        contract_pk,
        customer_name,
        customer_document,
        days_overdue,
        overdue_since,
        outstanding_amount,
        erp_snapshot,
      } = writeModel as Record<string, unknown>
      await db
        .from("collection_cases")
        .update({
          client_pk,
          contract_pk,
          customer_name,
          customer_document,
          days_overdue,
          overdue_since,
          outstanding_amount,
          erp_snapshot,
        })
        .eq("id", caseId)
    },
    async recordCreatedEvent(input) {
      await insertCollectionCaseEvent({
        caseId: input.caseId,
        eventType: "created",
        actorProfileId: input.actorProfileId,
        newValue: { invoice_pk: input.invoicePk, status: "open" },
        metadata: { source: "collections_controllr_discovery" },
      })
    },
    async ensureAssignment(input) {
      const assigned = await ensureCollectionAssignment({
        caseId: input.caseId,
        actorProfileId: input.actorProfileId,
      })
      return {
        assignmentId: assigned.assignmentId,
        code: assigned.code,
        newlyAssigned: assigned.code === "assigned",
      }
    },
  }
}

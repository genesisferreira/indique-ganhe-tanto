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
    async persistFencedInvoice(input) {
      const { data, error } = await db.rpc("persist_collection_discovery_invoice", {
        p_run_id: input.lease.runId,
        p_owner: input.lease.owner,
        p_generation: input.lease.generation,
        p_actor_profile_id: input.actorProfileId,
        p_write_model: input.writeModel,
        p_assign: input.assign,
        p_statement_timeout_ms: input.statementTimeoutMs ?? null,
      })
      const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : null
      if (error || payload?.ok !== true) {
        const code = String(payload?.code ?? "persist_error")
        return {
          ok: false,
          code:
            code === "stale_lease" || code === "not_found" || code === "invalid_input"
              ? code
              : "persist_error",
          caseId: null,
          inserted: false,
          newlyAssigned: false,
          assignmentId: null,
          unassigned: false,
        }
      }
      return {
        ok: true,
        code: payload.inserted === true ? "created" : "updated",
        caseId: payload.caseId ? String(payload.caseId) : null,
        inserted: payload.inserted === true,
        newlyAssigned: payload.newlyAssigned === true,
        assignmentId: payload.assignmentId ? String(payload.assignmentId) : null,
        unassigned: payload.unassigned === true,
      }
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

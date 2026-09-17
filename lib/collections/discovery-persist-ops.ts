import "server-only"

import {
  ensureCollectionAssignment,
  insertCollectionCaseEvent,
} from "@/lib/collections/cases.service"
import { asString, getOpsDb } from "@/lib/collections/db"
import type { DiscoveryCaseRepo } from "@/lib/collections/discovery-persist"
import type { ExistingCollectionCase } from "@/lib/collections/sync-decision"
import type { CollectionCaseStatus } from "@/types/collections"

function missingRpc(error: { message?: string } | null | undefined): boolean {
  const message = String(error?.message ?? "")
  return /does not exist|could not find the function|schema cache/i.test(message)
}

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
    async listOpenAfter(input) {
      const { data, error } = await db.rpc("list_open_collection_cases_after", {
        p_run_id: input.lease.runId,
        p_owner: input.lease.owner,
        p_generation: input.lease.generation,
        p_after_invoice_pk: input.afterInvoicePk,
        p_limit: input.limit,
      })
      if (missingRpc(error)) return { ok: false, code: "missing_migration" }
      const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : null
      if (error || payload?.ok !== true) {
        const code = String(payload?.code ?? "invalid_input")
        return {
          ok: false,
          code:
            code === "stale_lease" || code === "not_found" || code === "invalid_input"
              ? code
              : "invalid_input",
        }
      }
      const rows = Array.isArray(payload.cases) ? payload.cases : []
      const cases: ExistingCollectionCase[] = []
      for (const row of rows) {
        if (!row || typeof row !== "object") continue
        const rec = row as Record<string, unknown>
        const id = rec.id ? String(rec.id) : ""
        const invoicePk = asString(rec.invoicePk) ?? asString(rec.invoice_pk)
        if (!id || !invoicePk) continue
        cases.push({
          id,
          status: String(rec.status ?? "open") as CollectionCaseStatus,
          invoicePk,
        })
      }
      return { ok: true, cases }
    },
    async reconcilePaidFenced(input) {
      const { data, error } = await db.rpc("reconcile_collection_case_paid", {
        p_run_id: input.lease.runId,
        p_owner: input.lease.owner,
        p_generation: input.lease.generation,
        p_actor_profile_id: input.actorProfileId,
        p_case_id: input.caseId,
        p_invoice_pk: input.invoicePk,
        p_evidence: input.evidence ?? {},
        p_statement_timeout_ms: input.statementTimeoutMs ?? null,
      })
      if (missingRpc(error)) {
        return {
          ok: false,
          code: "missing_migration",
          caseId: null,
          closed: false,
          alreadyPaid: false,
          eventInserted: false,
        }
      }
      const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : null
      if (error || payload?.ok !== true) {
        const code = String(payload?.code ?? "persist_error")
        return {
          ok: false,
          code:
            code === "stale_lease" ||
            code === "not_found" ||
            code === "invalid_input" ||
            code === "identity_mismatch"
              ? code
              : "persist_error",
          caseId: payload?.caseId ? String(payload.caseId) : null,
          closed: false,
          alreadyPaid: false,
          eventInserted: false,
        }
      }
      return {
        ok: true,
        code:
          payload.code === "already_paid"
            ? "already_paid"
            : payload.code === "skipped_terminal"
              ? "skipped_terminal"
              : "closed",
        caseId: payload.caseId ? String(payload.caseId) : input.caseId,
        closed: payload.closed === true,
        alreadyPaid: payload.alreadyPaid === true,
        eventInserted: payload.eventInserted === true,
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

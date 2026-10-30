import "server-only"

import { getOpsDb } from "@/lib/collections/db"
import {
  parseDurableResult,
  type BatchOperationStore,
  type DurableOpResult,
} from "@/lib/collections/batch-operation"
import { COLLECTION_SECTOR_CODE } from "@/types/collections"

/**
 * Sprint 3.1E-BB — store durável via RPCs (service_role, só backend).
 * Toda decisão de exclusividade/ordem/limite/TTL/stop é tomada no PostgreSQL
 * (SELECT ... FOR UPDATE + advisory lock + índice único parcial). Esta classe
 * não guarda estado: qualquer instância serverless enxerga a mesma operação.
 */
export const BATCH_OPERATION_TTL_SECONDS = 600

async function call(fn: string, args: Record<string, unknown>): Promise<DurableOpResult> {
  const db = getOpsDb()
  const { data, error } = await db.rpc(fn, args)
  if (error) {
    console.warn("[collections:batch-operation]", {
      scope: fn,
      code: typeof error.code === "string" ? error.code : "unknown",
    })
    return { ok: false, code: "store_unavailable", operation: null }
  }
  return parseDurableResult(data)
}

export function createRpcBatchOperationStore(): BatchOperationStore {
  return {
    create: (input) =>
      // 3.1E-BG: nonce idempotente por setor + origem controlada pelo servidor.
      call("create_collection_batch_operation_with_nonce", {
        p_sector: COLLECTION_SECTOR_CODE,
        p_max_segments: input.maxSegments,
        p_configured_capacity: input.configuredCapacity,
        p_available: input.available,
        p_queue_enabled: input.queueEnabled,
        p_created_by: input.createdBy,
        p_client_operation_nonce: input.clientOperationNonce,
        p_initiation_source: input.initiationSource,
        p_ttl_seconds: BATCH_OPERATION_TTL_SECONDS,
        p_now: null,
      }),
    claim: (operationId, segment, clientOperationNonce) =>
      call("claim_collection_batch_segment_with_nonce", {
        p_operation_id: operationId,
        p_segment: segment,
        p_client_operation_nonce: clientOperationNonce,
        p_ttl_seconds: BATCH_OPERATION_TTL_SECONDS,
        p_now: null,
      }),
    complete: (input) =>
      // 3.1E-BD: conclusão + métricas sanitizadas na mesma transação.
      call("complete_collection_batch_segment_with_metrics", {
        p_operation_id: input.operationId,
        p_segment: input.segment,
        p_ok: input.ok,
        p_stop_reason: input.stopReason,
        p_summary: input.summary,
        p_metrics: input.metrics ?? {},
        p_ttl_seconds: BATCH_OPERATION_TTL_SECONDS,
        p_now: null,
      }),
    requestStop: (operationId) =>
      call("request_collection_batch_stop", { p_operation_id: operationId, p_now: null }),
    get: (operationId) =>
      call("get_collection_batch_operation", {
        p_sector: COLLECTION_SECTOR_CODE,
        p_operation_id: operationId,
        p_now: null,
      }),
  }
}

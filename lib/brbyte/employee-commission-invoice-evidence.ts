import "server-only"

import { brbyteAdminLogin, brbyteAdminPostForm } from "@/lib/brbyte/admin-http"
import { getBrbyteOperationalConfig } from "@/lib/brbyte/config"
import {
  EMPLOYEE_EVIDENCE_ATTEMPTS,
  EMPLOYEE_EVIDENCE_CONTRACT_FILTER_PROVEN,
  buildEmployeeEvidenceGuardResponse,
  type EmployeeEvidenceGuardResponse,
  buildEmployeeEvidenceFormFields,
  clampEmployeeEvidenceTimeoutMs,
  parseEmployeeEvidenceContractPk,
  summarizeEmployeeEvidence,
  type EmployeeEvidenceResult,
} from "@/lib/brbyte/employee-commission-invoice-evidence-result"
import { BRBYTE_API_PATHS } from "@/types/brbyte"

const LOG_TAG = "[employee-commission:invoice-evidence]"

/**
 * 3.1F-H1 — UMA listagem invoice/list para UM contrato. Sem retry, sem detalhe,
 * sem persistência, sem Sync, sem claim, sem evento. Não loga contractPk.
 * NÃO executado nesta sprint (exige autorização separada).
 */
export async function runEmployeeCommissionInvoiceEvidence(input: {
  timeoutMs?: unknown
  contractPk?: unknown
}): Promise<
  EmployeeEvidenceResult | EmployeeEvidenceGuardResponse | { ok: false; error: "invalid_contract_pk" }
> {
  // 3.1F-H6: defesa em profundidade — filtro de contrato não comprovado → sem login/ERP.
  if (!EMPLOYEE_EVIDENCE_CONTRACT_FILTER_PROVEN) return buildEmployeeEvidenceGuardResponse()
  const contractPk = parseEmployeeEvidenceContractPk(input.contractPk)
  if (!contractPk) return { ok: false, error: "invalid_contract_pk" }
  const timeoutMs = clampEmployeeEvidenceTimeoutMs(input.timeoutMs)
  const started = Date.now()
  const remaining = () => Math.max(1, timeoutMs - (Date.now() - started))

  const config = getBrbyteOperationalConfig()
  if (!config) {
    return summarizeEmployeeEvidence({ contractPk, timeoutMs, durationMs: 0, httpStatus: null, json: null, transport: "auth_or_config" })
  }
  const login = await brbyteAdminLogin({ ...config, timeoutMs: remaining() })
  if ("error" in login) {
    return summarizeEmployeeEvidence({ contractPk, timeoutMs, durationMs: Date.now() - started, httpStatus: login.httpStatus, json: null, transport: "auth_or_config" })
  }
  const post = await brbyteAdminPostForm(
    { ...config, timeoutMs: remaining() },
    login.cookie,
    BRBYTE_API_PATHS.invoiceList,
    buildEmployeeEvidenceFormFields(contractPk),
    { maxAttempts: EMPLOYEE_EVIDENCE_ATTEMPTS, timeoutMs: remaining() }
  )
  const durationMs = Date.now() - started
  const timedOut = !post.ok && post.status == null && durationMs >= timeoutMs - 50
  const result = summarizeEmployeeEvidence({
    contractPk,
    timeoutMs,
    durationMs,
    httpStatus: post.status ?? null,
    json: post.ok ? post.json : null,
    transport: post.ok ? "ok" : timedOut ? "timeout" : "error",
  })
  console.log(LOG_TAG, {
    classification: result.classification,
    httpStatus: result.httpStatus,
    durationMs: result.durationMs,
    rowCount: result.rowCount,
  })
  return result
}

import { NextResponse } from "next/server"
import { authorizeOperationalRequest } from "@/lib/collections/actor"
import { jsonError } from "@/lib/collections/http"
import { runInvoiceListProbe } from "@/lib/brbyte/invoice-list-probe"
import { runOverdueFirstPageHealthProbe } from "@/lib/brbyte/invoice-list-health-probe"
import { OVERDUE_FIRST_PAGE_HEALTH_MODE } from "@/lib/brbyte/invoice-list-health-probe-result"
import { runClientIdentityHealthProbe } from "@/lib/brbyte/client-identity-probe"
import { CLIENT_IDENTITY_HEALTH_MODE } from "@/lib/brbyte/client-identity-probe-result"
import { COLLECTION_SECTOR_CODE } from "@/types/collections"
import { runEmployeeCommissionInvoiceEvidence } from "@/lib/brbyte/employee-commission-invoice-evidence"
import {
  EMPLOYEE_COMMISSION_INVOICE_EVIDENCE_MODE,
  EMPLOYEE_EVIDENCE_CONTRACT_FILTER_PROVEN,
  EMPLOYEE_EVIDENCE_GUARD_HTTP_STATUS,
  buildEmployeeEvidenceGuardResponse,
} from "@/lib/brbyte/employee-commission-invoice-evidence-result"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
/** Login operacional + listagem até 60s + parse + margem da plataforma. Sync permanece em 120. */
export const maxDuration = 120

/**
 * Probe Admin Master: só POST aciona UM POST de listagem no Controllr
 * (`/invoice_ctl/invoice/list`). GET não chama o ERP. Não é Sync.
 * Não grava casos. Não chama assignment.
 *
 * Modo legado (sem `mode`): formulário DevTools do probe antigo.
 * Modo `client_identity_health`: 1ª página sem cursor + ≤ 2 invoice_info, sanitizado.
 * Modo `overdue_first_page_health`: 1ª página operacional de atrasados (read-only).
 */
export async function GET() {
  return jsonError(405, "Use POST para acionar o probe de listagem.")
}

export async function POST(request: Request) {
  const auth = await authorizeOperationalRequest({
    sectorCode: COLLECTION_SECTOR_CODE,
    action: "sync",
  })
  if (!auth.ok) return jsonError(auth.status, auth.message)

  let body: Record<string, unknown> | null = null
  let bodyParseFailed = false
  try {
    const parsed = (await request.json()) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    } else if (parsed != null) {
      bodyParseFailed = true
    }
  } catch {
    bodyParseFailed = true
    body = null
  }

  if (body && Object.prototype.hasOwnProperty.call(body, "mode")) {
    if (body.mode === EMPLOYEE_COMMISSION_INVOICE_EVIDENCE_MODE) {
      // 3.1F-H1: Admin Master obrigatório; 1 tentativa; contractPk nunca logado/devolvido.
      if (auth.context?.role !== "admin_master") {
        return jsonError(403, "Somente Admin Master.")
      }
      // 3.1F-H6: filtro de contrato não comprovado → 409 antes de login/ERP. Sem log.
      if (!EMPLOYEE_EVIDENCE_CONTRACT_FILTER_PROVEN) {
        return NextResponse.json(buildEmployeeEvidenceGuardResponse(), {
          status: EMPLOYEE_EVIDENCE_GUARD_HTTP_STATUS,
        })
      }
      if (bodyParseFailed) {
        return jsonError(400, "Body JSON inválido.")
      }
      const evidence = await runEmployeeCommissionInvoiceEvidence({
        timeoutMs: body.timeoutMs,
        contractPk: body.contractPk,
      })
      if ("errorClass" in evidence) {
        return NextResponse.json(evidence, { status: EMPLOYEE_EVIDENCE_GUARD_HTTP_STATUS })
      }
      if ("error" in evidence) return jsonError(400, "contractPk inválido.")
      const evidenceStatus = evidence.ok
        ? 200
        : evidence.classification === "AUTH_OR_CONFIG_FAILURE"
          ? 503
          : 502
      return NextResponse.json(evidence, { status: evidenceStatus })
    }
    if (body.mode === CLIENT_IDENTITY_HEALTH_MODE) {
      if (bodyParseFailed) {
        return jsonError(400, "Body JSON inválido.")
      }
      // 3.1E-AS: identidade do cliente, read-only, 1 tentativa, ≤ 2 invoice_info.
      const identity = await runClientIdentityHealthProbe({ timeoutMs: body.timeoutMs })
      const identityStatus = identity.ok
        ? 200
        : identity.classification === "AUTH_OR_CONFIG_FAILURE"
          ? 503
          : 502
      return NextResponse.json(identity, { status: identityStatus })
    }
    if (body.mode !== OVERDUE_FIRST_PAGE_HEALTH_MODE) {
      return jsonError(400, "mode inválido para o probe de listagem.")
    }
    if (bodyParseFailed) {
      return jsonError(400, "Body JSON inválido.")
    }
    const result = await runOverdueFirstPageHealthProbe({
      timeoutMs: body.timeoutMs,
    })
    const status =
      result.ok
        ? 200
        : result.errorClass === "no_resumable_run" ||
            result.errorClass === "multiple_resumable_runs" ||
            result.errorClass === "invalid_run_shape"
          ? 409
          : result.errorClass === "read_failed" ||
              result.errorClass === "missing_controllr_credentials"
            ? 503
            : 502
    return NextResponse.json(result, { status })
  }

  if (bodyParseFailed && body == null) {
    // Contrato legado: JSON ausente/ inválido → timeout default do probe antigo.
  }

  const result = await runInvoiceListProbe({
    timeoutMs: body ? body.timeoutMs : undefined,
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}

import "server-only"

import { brbyteAdminLogin, brbyteAdminPostForm } from "@/lib/brbyte/admin-http"
import { getBrbyteOperationalConfig } from "@/lib/brbyte/config"
import {
  INVOICE_LIST_PROBE_ATTEMPTS,
  clampInvoiceListProbeTimeoutMs,
  parseInvoiceListProbeFormatIndex,
  selectInvoiceListProbeForm,
  summarizeInvoiceListProbeResult,
  type InvoiceListProbeResult,
} from "@/lib/brbyte/invoice-list-probe-result"
import { BRBYTE_API_PATHS } from "@/types/brbyte"

const LOG_TAG = "[collections:invoice-list-probe]"

/**
 * Contrato no CRM: invoice/list é usado só para leitura (check-first-invoice,
 * listContractInvoices, listInvoicesPage). Este probe não grava CRM nem chama
 * RPCs. O ERP não documenta no repositório que o POST é side-effect free.
 */
export async function runInvoiceListProbe(input: {
  formatIndex?: unknown
  timeoutMs?: unknown
}): Promise<InvoiceListProbeResult> {
  const formatIndex = parseInvoiceListProbeFormatIndex(input.formatIndex)
  const timeoutMs = clampInvoiceListProbeTimeoutMs(input.timeoutMs)
  const selected = selectInvoiceListProbeForm(formatIndex)
  const started = Date.now()

  const config = getBrbyteOperationalConfig()
  if (!config) {
    return summarizeInvoiceListProbeResult({
      formatIndex,
      timeoutMs,
      durationMs: Date.now() - started,
      httpStatus: null,
      json: null,
      transportMessage: "Credenciais operacionais do Controllr ausentes.",
    })
  }

  const login = await brbyteAdminLogin({ ...config, timeoutMs })
  if ("error" in login) {
    return summarizeInvoiceListProbeResult({
      formatIndex,
      timeoutMs,
      durationMs: Date.now() - started,
      httpStatus: login.httpStatus,
      json: null,
      transportMessage: login.error,
    })
  }

  const post = await brbyteAdminPostForm(
    { ...config, timeoutMs },
    login.cookie,
    BRBYTE_API_PATHS.invoiceList,
    selected.fields,
    { maxAttempts: INVOICE_LIST_PROBE_ATTEMPTS }
  )

  const result = summarizeInvoiceListProbeResult({
    formatIndex,
    timeoutMs,
    durationMs: Date.now() - started,
    httpStatus: post.status,
    json: post.json,
    transportMessage: post.message,
  })

  console.log(LOG_TAG, {
    formId: result.formId,
    durationMs: result.durationMs,
    httpStatus: result.httpStatus,
    errorClass: result.errorClass,
    shapeValid: result.shapeValid,
    pageCount: result.pageCount,
    reportedTotal: result.reportedTotal,
  })

  return result
}

import "server-only"

import { brbyteAdminPostForm, type ControllrHttpAbortClass } from "@/lib/brbyte/admin-http"
import type { BrbyteCreateInterestConfig } from "@/lib/brbyte/config"
import {
  extractInvoiceInfo,
  isInvoiceApiResponseSuccessful,
  resolveInvoiceApiErrorMessage,
} from "@/lib/brbyte/check-first-invoice-response"
import { BRBYTE_API_PATHS, type BrbyteInvoiceInfo } from "@/types/brbyte"

const LOG_TAG = "[brbyte:invoice-info]"

export async function fetchInvoiceInfo(input: {
  config: BrbyteCreateInterestConfig
  cookie: string
  invoicePk: string
}): Promise<{
  ok: boolean
  info: BrbyteInvoiceInfo | null
  payload: Record<string, unknown> | null
  httpStatus: number | null
  message?: string
  abortClass?: ControllrHttpAbortClass
}> {
  const invoicePk = input.invoicePk.trim()
  if (!invoicePk) {
    return {
      ok: false,
      info: null,
      payload: null,
      httpStatus: null,
      message: "invoice_pk ausente para consulta de detalhes.",
    }
  }

  const lookupForms: Record<string, string>[] = [
    { invoice_pk: invoicePk },
    { "where[invoice_pk]": invoicePk },
    { where: JSON.stringify({ invoice_pk: invoicePk }) },
  ]

  const startedAtMs = Date.now()
  const budgetMs = Math.max(1, input.config.timeoutMs)

  for (const fields of lookupForms) {
    const remainingMs = budgetMs - (Date.now() - startedAtMs)
    if (remainingMs < 1) break
    const result = await brbyteAdminPostForm(
      input.config,
      input.cookie,
      BRBYTE_API_PATHS.invoiceListInfo,
      fields,
      { maxAttempts: 1, timeoutMs: remainingMs }
    )

    if (!result.ok) {
      if (result.abortClass === "timeout" || result.abortClass === "external_abort") {
        return {
          ok: false,
          info: null,
          payload: null,
          httpStatus: result.status,
          message: result.message,
          abortClass: result.abortClass,
        }
      }
      continue
    }

    const payload =
      result.json && typeof result.json === "object"
        ? (result.json as Record<string, unknown>)
        : { raw: result.json }

    if (!isInvoiceApiResponseSuccessful(result.json, result.status)) {
      return {
        ok: false,
        info: null,
        payload,
        httpStatus: result.status,
        message: resolveInvoiceApiErrorMessage(
          result.json,
          "Falha ao consultar detalhes da fatura no Controllr."
        ),
      }
    }

    const info = extractInvoiceInfo(result.json)
    if (!info.invoicePk) {
      info.invoicePk = invoicePk
    }

    console.log(LOG_TAG, {
      invoicePk,
      httpStatus: result.status,
      invoiceMsg: info.invoiceMsg,
      isPaid: info.isPaid,
    })

    return {
      ok: true,
      info,
      payload,
      httpStatus: result.status,
    }
  }

  return {
    ok: false,
    info: null,
    payload: null,
    httpStatus: null,
    message: "Não foi possível consultar detalhes da fatura no Controllr.",
    abortClass: "transport",
  }
}

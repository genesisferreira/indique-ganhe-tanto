import "server-only"

import { brbyteAdminPostForm } from "@/lib/brbyte/admin-http"
import type { BrbyteCreateInterestConfig } from "@/lib/brbyte/config"
import {
  extractInvoiceListRows,
  isInvoiceApiResponseSuccessful,
  resolveInvoiceApiErrorMessage,
} from "@/lib/brbyte/check-first-invoice-response"
import { BRBYTE_API_PATHS } from "@/types/brbyte"

const LOG_TAG = "[brbyte:invoice-list]"

export async function listContractInvoices(input: {
  config: BrbyteCreateInterestConfig
  cookie: string
  contractPk: string
}): Promise<{
  ok: boolean
  rows: ReturnType<typeof extractInvoiceListRows>
  payload: Record<string, unknown> | null
  httpStatus: number | null
  message?: string
}> {
  const contractPk = input.contractPk.trim()
  if (!contractPk) {
    return {
      ok: false,
      rows: [],
      payload: null,
      httpStatus: null,
      message: "contract_pk ausente para consulta de faturas.",
    }
  }

  const lookupForms: Record<string, string>[] = [
    {
      "where[contract_pk]": contractPk,
      "where[invoice_deleted]": "false",
    },
    {
      where: JSON.stringify({
        contract_pk: contractPk,
        invoice_deleted: false,
      }),
    },
    {
      contract_pk: contractPk,
      invoice_deleted: "false",
    },
  ]

  for (const fields of lookupForms) {
    const result = await brbyteAdminPostForm(
      input.config,
      input.cookie,
      BRBYTE_API_PATHS.invoiceList,
      fields
    )

    if (!result.ok) continue

    const payload =
      result.json && typeof result.json === "object"
        ? (result.json as Record<string, unknown>)
        : { raw: result.json }

    if (!isInvoiceApiResponseSuccessful(result.json, result.status)) {
      return {
        ok: false,
        rows: [],
        payload,
        httpStatus: result.status,
        message: resolveInvoiceApiErrorMessage(
          result.json,
          "Falha ao listar faturas no Controllr."
        ),
      }
    }

    const rows = extractInvoiceListRows(result.json).filter(
      (row) => !row.invoiceDeleted
    )

    console.log(LOG_TAG, {
      contractPk,
      httpStatus: result.status,
      count: rows.length,
    })

    return {
      ok: true,
      rows,
      payload,
      httpStatus: result.status,
    }
  }

  return {
    ok: false,
    rows: [],
    payload: null,
    httpStatus: null,
    message: "Não foi possível consultar faturas no Controllr.",
  }
}

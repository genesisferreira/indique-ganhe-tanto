import "server-only"

import { brbyteAdminPostForm } from "@/lib/brbyte/admin-http"
import type { BrbyteCreateInterestConfig } from "@/lib/brbyte/config"
import {
  extractInvoiceListRows,
  extractInvoiceListTotal,
  isInvoiceApiResponseSuccessful,
  resolveInvoiceApiErrorMessage,
} from "@/lib/brbyte/check-first-invoice-response"
import { BRBYTE_API_PATHS } from "@/types/brbyte"
import {
  COLLECTION_INVOICE_LIST_MAX_PAGES,
  COLLECTION_INVOICE_LIST_PAGE_SIZE,
  decideInvoiceListPageAdvance,
  invoiceListPageQueryForms,
} from "@/lib/brbyte/invoice-list-pagination"

const LOG_TAG = "[brbyte:invoice-list]"

export {
  COLLECTION_INVOICE_LIST_MAX_PAGES,
  COLLECTION_INVOICE_LIST_PAGE_SIZE,
} from "@/lib/brbyte/invoice-list-pagination"

export async function listInvoicesPage(input: {
  config: BrbyteCreateInterestConfig
  cookie: string
  start: number
  length?: number
}): Promise<{
  ok: boolean
  rows: ReturnType<typeof extractInvoiceListRows>
  total: number | null
  payload: Record<string, unknown> | null
  httpStatus: number | null
  message?: string
}> {
  const length = input.length ?? COLLECTION_INVOICE_LIST_PAGE_SIZE
  const start = Math.max(0, input.start)

  for (const fields of invoiceListPageQueryForms(start, length)) {
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
        total: null,
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
    const total = extractInvoiceListTotal(result.json, rows.length)

    console.log(LOG_TAG, {
      scope: "page",
      start,
      length,
      httpStatus: result.status,
      count: rows.length,
      total,
    })

    return {
      ok: true,
      rows,
      total,
      payload,
      httpStatus: result.status,
    }
  }

  return {
    ok: false,
    rows: [],
    total: null,
    payload: null,
    httpStatus: null,
    message: "Não foi possível listar faturas globais no Controllr.",
  }
}

export async function listAllOpenInvoices(input: {
  config: BrbyteCreateInterestConfig
  cookie: string
  pageSize?: number
  maxPages?: number
}): Promise<{
  ok: boolean
  incomplete: boolean
  rows: ReturnType<typeof extractInvoiceListRows>
  scannedPages: number
  truncated: boolean
  message?: string
}> {
  const pageSize = input.pageSize ?? COLLECTION_INVOICE_LIST_PAGE_SIZE
  const maxPages = input.maxPages ?? COLLECTION_INVOICE_LIST_MAX_PAGES
  const collected: ReturnType<typeof extractInvoiceListRows> = []
  const seen = new Set<string>()

  for (let page = 0; page < maxPages; page += 1) {
    const start = page * pageSize
    const result = await listInvoicesPage({
      config: input.config,
      cookie: input.cookie,
      start,
      length: pageSize,
    })
    const advance = decideInvoiceListPageAdvance({
      pageIndex: page,
      pageSize,
      maxPages,
      pageOk: result.ok,
      pageInvoicePks: result.rows.map((row) => row.invoicePk),
      seenInvoicePks: seen,
      collectedCount: collected.length,
      reportedTotal: result.total,
    })

    if (advance.reason === "page_error") {
      return {
        ok: false,
        incomplete: collected.length > 0,
        rows: collected,
        scannedPages: page + 1,
        truncated: collected.length > 0,
        message:
          result.message ??
          (page === 0
            ? "Não foi possível listar faturas globais no Controllr."
            : "Paginação da listagem global interrompida por falha de página."),
      }
    }

    const allowed = new Set(advance.uniqueNewPks)
    for (const row of result.rows) {
      const pk = String(row.invoicePk ?? "").trim()
      if (!pk || !allowed.has(pk) || seen.has(pk)) continue
      seen.add(pk)
      collected.push(row)
    }

    if (advance.reason === "repeat") {
      return {
        ok: false,
        incomplete: true,
        rows: collected,
        scannedPages: page + 1,
        truncated: true,
        message:
          "Paginação da listagem global repetiu a mesma página. Varredura interrompida para evitar loop.",
      }
    }
    if (advance.reason === "incomplete") {
      return {
        ok: false,
        incomplete: true,
        rows: collected,
        scannedPages: page + 1,
        truncated: false,
        message:
          "Listagem global incompleta: a página não confirma o fim da lista. Não cobre a base completa.",
      }
    }
    if (advance.reason === "truncated") {
      return {
        ok: false,
        incomplete: true,
        rows: collected,
        scannedPages: page + 1,
        truncated: true,
        message:
          "Varredura truncada no limite de páginas do Controllr. Não cobre a base completa.",
      }
    }
    if (advance.reason === "complete") {
      return {
        ok: true,
        incomplete: false,
        rows: collected,
        scannedPages: page + 1,
        truncated: false,
      }
    }
  }

  return {
    ok: false,
    incomplete: collected.length > 0,
    rows: collected,
    scannedPages: maxPages,
    truncated: collected.length > 0,
    message: "Varredura truncada no limite de páginas do Controllr. Não cobre a base completa.",
  }
}

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

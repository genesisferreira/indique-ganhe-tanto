import "server-only"

import { brbyteAdminLogin } from "@/lib/brbyte/admin-http"
import { getBrbyteOperationalConfig } from "@/lib/brbyte/config"
import { lookupClientInterestByDocument } from "@/lib/brbyte/create-interest-response"
import { asString, awaitQuery, getOpsDb } from "@/lib/collections/db"
import { formatCNPJ, formatCPF } from "@/lib/client/formatters"
import {
  maskOperationalDocument,
  parseOperationalDocument,
  documentsMatch,
  type NormalizedDocument,
} from "@/lib/operational/document"

export type RetentionCustomerSearchResult = {
  found: boolean
  documentMasked: string | null
  customerName: string | null
  clientPk: string | null
  contractPk: string | null
  phone: string | null
  interestStatus: string | null
  sources: string[]
  collectionCases: Array<{
    id: string
    invoicePk: string | null
    daysOverdue: number
    status: string
    outstandingAmount: number | null
  }>
  openAttendanceId: string | null
  cancelledStatusAvailable: false
  controllrHistoryAvailable: false
}

function formattedVariants(doc: NormalizedDocument): string[] {
  const formatted = doc.kind === "cpf" ? formatCPF(doc.digits) : formatCNPJ(doc.digits)
  return [...new Set([doc.digits, formatted])]
}

export async function searchRetentionCustomer(input: {
  rawDocument: string
}): Promise<
  | { ok: true; result: RetentionCustomerSearchResult }
  | { ok: false; status: 400; message: string }
> {
  const parsed = parseOperationalDocument(input.rawDocument)
  if (!parsed.ok) {
    return { ok: false, status: 400, message: "Informe um CPF ou CNPJ válido." }
  }
  const doc = parsed.document
  const db = getOpsDb()
  const sources: string[] = []

  let customerName: string | null = null
  let clientPk: string | null = null
  let contractPk: string | null = null
  let phone: string | null = null
  let interestStatus: string | null = null

  const variants = formattedVariants(doc)
  const referralsRes = await awaitQuery<{
    referred_name: string | null
    referred_document: string | null
    referred_phone?: string | null
    brbyte_client_pk: string | null
    brbyte_contract_pk: string | null
  }>(
    db
      .from("referrals")
      .select("referred_name, referred_document, referred_phone, brbyte_client_pk, brbyte_contract_pk")
      .in("referred_document", variants)
      .limit(20)
  )

  const referralHits = (referralsRes.data ?? []).filter((row) =>
    documentsMatch(row.referred_document, doc.digits)
  )
  if (referralHits.length > 0) {
    sources.push("crm")
    const hit = referralHits[0]!
    customerName = asString(hit.referred_name) ?? customerName
    clientPk = asString(hit.brbyte_client_pk) ?? clientPk
    contractPk = asString(hit.brbyte_contract_pk) ?? contractPk
    phone = asString(hit.referred_phone) ?? phone
  }

  const attendanceRes = await awaitQuery<{
    id: string
    customer_name_snapshot: string | null
    client_pk: string | null
    contract_pk: string | null
    status: string
  }>(
    db
      .from("operational_attendances")
      .select("id, customer_name_snapshot, client_pk, contract_pk, status")
      .eq("sector_code", "retention")
      .eq("document_normalized", doc.digits)
      .order("started_at", { ascending: false })
      .limit(10)
  )
  const attendances = attendanceRes.data ?? []
  if (attendances.length > 0) {
    if (!sources.includes("crm")) sources.push("crm")
    const latest = attendances[0]!
    customerName = customerName ?? asString(latest.customer_name_snapshot)
    clientPk = clientPk ?? asString(latest.client_pk)
    contractPk = contractPk ?? asString(latest.contract_pk)
  }

  const config = getBrbyteOperationalConfig()
  if (config) {
    try {
      const login = await brbyteAdminLogin(config)
      if (!("error" in login)) {
        const interest = await lookupClientInterestByDocument({
          config,
          cookie: login.cookie,
          interestDoc1: doc.digits,
        })
        if (interest?.interestPk || interest?.clientPk) {
          sources.push("controllr_interest")
          clientPk = clientPk ?? interest.clientPk
          interestStatus = interest.interestStatus
        }
      }
    } catch {
      // fail-open: CRM continua
    }
  }

  let collectionCases: RetentionCustomerSearchResult["collectionCases"] = []
  if (clientPk) {
    const casesRes = await awaitQuery<{
      id: string
      invoice_pk: string | null
      days_overdue: number | null
      status: string
      outstanding_amount: number | string | null
    }>(
      db
        .from("collection_cases")
        .select("id, invoice_pk, days_overdue, status, outstanding_amount")
        .eq("client_pk", clientPk)
        .order("updated_at", { ascending: false })
        .limit(20)
    )
    collectionCases = (casesRes.data ?? []).map((row) => ({
      id: String(row.id),
      invoicePk: asString(row.invoice_pk),
      daysOverdue: typeof row.days_overdue === "number" ? row.days_overdue : 0,
      status: String(row.status),
      outstandingAmount:
        typeof row.outstanding_amount === "number"
          ? row.outstanding_amount
          : row.outstanding_amount != null
            ? Number(row.outstanding_amount)
            : null,
    }))
    if (collectionCases.length > 0 && !sources.includes("crm")) sources.push("crm")
  }

  const found = sources.length > 0
  const openAttendance = attendances.find((row) => row.status === "open")

  return {
    ok: true,
    result: {
      found,
      documentMasked: maskOperationalDocument(doc.digits),
      customerName: found ? customerName : null,
      clientPk: found ? clientPk : null,
      contractPk: found ? contractPk : null,
      phone: found ? phone : null,
      interestStatus: found ? interestStatus : null,
      sources: found ? sources : [],
      collectionCases: found ? collectionCases : [],
      openAttendanceId: found ? (openAttendance ? String(openAttendance.id) : null) : null,
      cancelledStatusAvailable: false,
      controllrHistoryAvailable: false,
    },
  }
}

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import {
  INVOICE_LIST_PROBE_TIMEOUT_MAX_MS,
  clampInvoiceListProbeTimeoutMs,
} from "@/lib/brbyte/invoice-list-probe-result"
import {
  OVERDUE_FIRST_PAGE_HEALTH_ATTEMPTS,
  OVERDUE_FIRST_PAGE_HEALTH_MODE,
  OVERDUE_FIRST_PAGE_HEALTH_TIMEOUT_MAX_MS,
  aggregateOverdueFirstPageHealthRows,
  clampOverdueFirstPageHealthTimeoutMs,
  resolveHealthTimeoutPhase,
  summarizeOverdueFirstPageHealthResult,
} from "@/lib/brbyte/invoice-list-health-probe-result"
import { runOverdueFirstPageHealthProbe } from "@/lib/brbyte/invoice-list-health-probe"
import { buildOverdueInvoiceListKeysetFormFields } from "@/lib/brbyte/overdue-invoice-list-query"
import { authorizeOperationalSectorAccess } from "@/lib/auth/sector-membership"

const rootDir = process.cwd()

function read(rel: string) {
  return readFileSync(join(rootDir, rel), "utf8")
}

const probeActor = {
  sectorCode: "collections" as const,
  userId: "u1",
  profileId: "u1",
  profileIsActive: true,
  employeeId: "e1",
  employeeStatus: "active",
  membershipActive: true,
  membershipSectorCode: "collections",
  action: "sync" as const,
}

describe("3.1E-AN overdue first page health probe", () => {
  it("A - somente Admin Master pode executar (action sync)", () => {
    const master = authorizeOperationalSectorAccess({
      ...probeActor,
      role: "admin_master",
    })
    assert.equal(master.ok, true)
    const consulta = authorizeOperationalSectorAccess({
      ...probeActor,
      role: "admin_consulta",
    })
    assert.equal(consulta.ok, false)
    const route = read("app/api/admin/collections/invoice-list-probe/route.ts")
    assert.match(route, /action: "sync"/)
    assert.match(route, /OVERDUE_FIRST_PAGE_HEALTH_MODE/)
  })

  it("B - body/mode inválido rejeitado sem ERP", () => {
    const route = read("app/api/admin/collections/invoice-list-probe/route.ts")
    assert.match(route, /mode inválido/)
    assert.match(route, /OVERDUE_FIRST_PAGE_HEALTH_MODE/)
    const post = route.slice(route.indexOf("export async function POST"))
    assert.match(post, /jsonError\(400/)
    assert.equal(OVERDUE_FIRST_PAGE_HEALTH_MODE, "overdue_first_page_health")
  })

  it("C - timeout clamp do modo antigo permanece igual", () => {
    assert.equal(clampInvoiceListProbeTimeoutMs(60_000), 12_000)
    assert.equal(clampInvoiceListProbeTimeoutMs(100), 3_000)
    assert.equal(INVOICE_LIST_PROBE_TIMEOUT_MAX_MS, 12_000)
  })

  it("D - health aceita até 60000", () => {
    assert.equal(clampOverdueFirstPageHealthTimeoutMs(60_000), 60_000)
    assert.equal(clampOverdueFirstPageHealthTimeoutMs(59_999), 59_999)
    assert.equal(clampOverdueFirstPageHealthTimeoutMs(100), 3_000)
    assert.equal(clampOverdueFirstPageHealthTimeoutMs(90_000), 60_000)
    assert.equal(OVERDUE_FIRST_PAGE_HEALTH_TIMEOUT_MAX_MS, 60_000)
  })

  it("E - uma única tentativa", () => {
    assert.equal(OVERDUE_FIRST_PAGE_HEALTH_ATTEMPTS, 1)
    const runner = read("lib/brbyte/invoice-list-health-probe.ts")
    assert.match(runner, /listOverdueInvoicesPage/)
    assert.equal(runner.includes("maxAttempts: 2"), false)
  })

  it("F - construtor operacional real é usado", () => {
    const fields = buildOverdueInvoiceListKeysetFormFields({
      eligibilityReferenceDateUtc: "2026-10-27",
      afterInvoicePk: null,
      minimumDaysOverdue: 5,
    })
    assert.ok(fields)
    assert.equal(fields!.page, "1")
    assert.equal(fields!.start, "0")
    assert.equal(fields!.limit, "15")
    assert.equal(fields!.sort, "invoice_pk")
    assert.equal(fields!.dir, "ASC")
    const where = JSON.parse(fields!.where) as unknown[]
    assert.ok(Array.isArray(where))
    assert.equal(
      JSON.stringify(where).includes('"field":"invoice_date_due"'),
      true
    )
    const runner = read("lib/brbyte/invoice-list-health-probe.ts")
    assert.match(runner, /listOverdueInvoicesPage/)
    assert.equal(runner.includes("INVOICE_LIST_PROBE_WHERE_FILTERS"), false)
  })

  it("G/H/I - cursor ausente/presente, referenceDate da run, mínimo da config", async () => {
    const calls = { list: 0, login: 0, read: 0, settings: 0 }
    const baseSnapshot = {
      status: "paused" as const,
      phase: "discovery" as const,
      referenceInstant: "2026-10-27T15:00:00.000Z",
      referenceDate: "2026-10-27",
      cursorLastInvoicePk: null as string | null,
      cursorMode: "absent" as const,
      scannedPages: 0,
      scannedInvoices: 0,
      createdCount: 3,
      updatedCount: 0,
      skippedCount: 0,
      assignedCount: 3,
      unassignedCount: 0,
      errorCount: 0,
      reportedTotal: null,
      leaseGeneration: 2,
      leaseOwner: null,
      leaseUntil: null,
      consecutiveNoProgress: 1,
      lastErrorClass: "list_timeout_headers:1",
      updatedAt: "2026-10-27T15:01:00.000Z",
    }

    const absent = await runOverdueFirstPageHealthProbe(
      { timeoutMs: 60_000 },
      {
        loadSettings: async () => {
          calls.settings += 1
          return { minimumDaysOverdue: 5, isEnabled: true }
        },
        readRunSnapshot: async () => {
          calls.read += 1
          return { ok: true, snapshot: baseSnapshot }
        },
        getConfig: () => ({
          enabled: true,
          apiUrl: "https://erp.example",
          apiUser: "u",
          apiPassword: "p",
          defaultLeadPk: "1",
          defaultInterestStatus: "1",
          defaultPlanPk: "1",
          timeoutMs: 60_000,
        }),
        login: async () => {
          calls.login += 1
          return { cookie: "BRBOSCookie=x", httpStatus: 200 }
        },
        listPage: async (input) => {
          calls.list += 1
          assert.equal(input.page, 1)
          assert.equal(input.afterInvoicePk, null)
          assert.equal(input.minimumDaysOverdue, 5)
          assert.equal(input.referenceDate, "2026-10-27")
          return {
            ok: true,
            rows: [
              {
                invoicePk: "10",
                contractPk: "c1",
                invoiceDueDate: "2026-10-20 00:00:00",
                invoiceDate: null,
                invoicePeriod: null,
                invoiceDeleted: false,
                raw: { invoice_pk: 10, invoice_date_due: "2026-10-20 00:00:00", contract_status: 1 },
              },
            ],
            total: 42,
            payload: { success: true, total: 42, results: [{ invoice_pk: 10 }] },
            httpStatus: 200,
            page: 1,
            start: 0,
            limit: 15,
            referenceDate: "2026-10-27",
          }
        },
      }
    )
    assert.equal(absent.ok, true)
    assert.equal(absent.cursorMode, "absent")
    assert.equal(absent.referenceDate, "2026-10-27")
    assert.equal(absent.minimumDaysOverdue, 5)
    assert.equal(absent.cutoff, "2026-10-23")
    assert.equal(absent.attempts, 1)
    assert.equal(calls.list, 1)
    assert.equal(calls.login, 1)

    const present = await runOverdueFirstPageHealthProbe(
      { timeoutMs: 60_000 },
      {
        loadSettings: async () => ({ minimumDaysOverdue: 7, isEnabled: true }),
        readRunSnapshot: async () => ({
          ok: true,
          snapshot: {
            ...baseSnapshot,
            cursorLastInvoicePk: "100",
            cursorMode: "present",
          },
        }),
        getConfig: () => ({
          enabled: true,
          apiUrl: "https://erp.example",
          apiUser: "u",
          apiPassword: "p",
          defaultLeadPk: "1",
          defaultInterestStatus: "1",
          defaultPlanPk: "1",
          timeoutMs: 60_000,
        }),
        login: async () => ({ cookie: "BRBOSCookie=x", httpStatus: 200 }),
        listPage: async (input) => {
          assert.equal(input.afterInvoicePk, "100")
          assert.equal(input.minimumDaysOverdue, 7)
          return {
            ok: true,
            rows: [
              {
                invoicePk: "101",
                contractPk: "c1",
                invoiceDueDate: "2026-10-10 00:00:00",
                invoiceDate: null,
                invoicePeriod: null,
                invoiceDeleted: false,
                raw: {
                  invoice_pk: 101,
                  invoice_date_due: "2026-10-10 00:00:00",
                  contract_status: 5,
                },
              },
            ],
            total: 1,
            payload: { success: true, total: 1, results: [{ invoice_pk: 101 }] },
            httpStatus: 200,
            page: 1,
            start: 0,
            limit: 15,
            referenceDate: "2026-10-27",
          }
        },
      }
    )
    assert.equal(present.cursorMode, "present")
    assert.equal(present.minimumDaysOverdue, 7)
    assert.equal(present.idsGreaterThanCursor, true)
    assert.equal(present.cancelledContractCount, 1)
  })

  it("J/K - invoice_date_due parseado e IDs válidos/únicos/crescentes", () => {
    const agg = aggregateOverdueFirstPageHealthRows({
      shapeValid: true,
      reportedTotal: 3,
      cursorLastInvoicePk: null,
      rows: [
        {
          invoicePk: "1",
          invoiceDueDate: "2026-10-01 00:00:00",
          raw: { contract_status: 1 },
        },
        {
          invoicePk: "2",
          invoiceDueDate: "2026-10-02 00:00:00",
          raw: { contract_status: 4 },
        },
        {
          invoicePk: "bad",
          invoiceDueDate: "not-a-date",
          raw: {},
        },
      ],
    })
    assert.equal(agg.validUniquePkCount, 2)
    assert.equal(agg.strictlyAscending, true)
    assert.equal(agg.parseableDueDateCount, 2)
    assert.equal(agg.invalidDueDateCount, 1)
    assert.equal(agg.blockedContractCount, 1)
    assert.equal(agg.missingContractStatusCount, 1)
  })

  it("L/T - resposta e logs sanitizados sem PII", () => {
    const result = summarizeOverdueFirstPageHealthResult({
      timeoutMs: 60_000,
      referenceDate: "2026-10-27",
      minimumDaysOverdue: 5,
      cursorMode: "absent",
      loginDurationMs: 12,
      listTotalDurationMs: 40,
      totalDurationMs: 60,
      httpStatus: 200,
      shapeValid: true,
      reportedTotal: 1,
      rows: [
        {
          invoicePk: "999",
          invoiceDueDate: "2026-10-01 00:00:00",
          raw: {
            invoice_pk: 999,
            nombreCliente: "Maria Silva",
            numeroIdentificacion: "12345678901",
            password: "secret",
          },
        },
      ],
      cursorLastInvoicePk: null,
    })
    const blob = JSON.stringify(result)
    assert.equal(blob.includes("Maria"), false)
    assert.equal(blob.includes("12345678901"), false)
    assert.equal(blob.includes("999"), false)
    assert.equal(blob.includes("secret"), false)
    assert.equal(blob.includes("password"), false)
    assert.equal(blob.includes("run_id"), false)
    assert.equal("results" in result, false)
    assert.equal(result.validUniquePkCount, 1)
  })

  it("M/N - timeout awaiting_headers e during body", () => {
    assert.equal(
      resolveHealthTimeoutPhase({ aborted: true, httpStatus: null }),
      "awaiting_headers"
    )
    assert.equal(
      resolveHealthTimeoutPhase({
        aborted: true,
        httpStatus: 200,
        bodyReadComplete: false,
      }),
      "during_body"
    )
    const headers = summarizeOverdueFirstPageHealthResult({
      timeoutMs: 60_000,
      referenceDate: "2026-10-27",
      minimumDaysOverdue: 5,
      cursorMode: "absent",
      loginDurationMs: 10,
      listTotalDurationMs: 60_000,
      totalDurationMs: 60_100,
      httpStatus: null,
      aborted: true,
      bodyReadComplete: false,
      shapeValid: false,
    })
    assert.equal(headers.timings.timeoutPhase, "awaiting_headers")
    assert.equal(headers.errorClass, "list_timeout_headers")
    assert.equal(headers.httpStatus, null)
    const body = summarizeOverdueFirstPageHealthResult({
      timeoutMs: 60_000,
      referenceDate: "2026-10-27",
      minimumDaysOverdue: 5,
      cursorMode: "absent",
      loginDurationMs: 10,
      listTotalDurationMs: 60_000,
      totalDurationMs: 60_100,
      httpStatus: 200,
      aborted: true,
      bodyReadComplete: false,
      shapeValid: false,
    })
    assert.equal(body.timings.timeoutPhase, "during_body")
    assert.equal(body.errorClass, "list_timeout_body")
    assert.equal(body.httpStatus, 200)
  })

  it("O/P - HTTP real preservado e resposta inválida", () => {
    const http = summarizeOverdueFirstPageHealthResult({
      timeoutMs: 60_000,
      referenceDate: "2026-10-27",
      minimumDaysOverdue: 5,
      cursorMode: "absent",
      loginDurationMs: 10,
      listTotalDurationMs: 20,
      totalDurationMs: 40,
      httpStatus: 503,
      shapeValid: false,
      transportMessage: "HTTP 503",
    })
    assert.equal(http.httpStatus, 503)
    assert.notEqual(http.httpStatus, 0)
    const invalid = summarizeOverdueFirstPageHealthResult({
      timeoutMs: 60_000,
      referenceDate: "2026-10-27",
      minimumDaysOverdue: 5,
      cursorMode: "absent",
      loginDurationMs: 10,
      listTotalDurationMs: 20,
      totalDurationMs: 40,
      httpStatus: 200,
      shapeValid: false,
    })
    assert.equal(invalid.errorClass, "invalid_list_shape")
    assert.equal(invalid.ok, false)
  })

  it("Q - nenhuma escrita (deps de claim/advance/release não usadas)", async () => {
    const writes = { claim: 0, advance: 0, release: 0 }
    await runOverdueFirstPageHealthProbe(
      { timeoutMs: 60_000 },
      {
        loadSettings: async () => ({ minimumDaysOverdue: 5, isEnabled: true }),
        readRunSnapshot: async () => ({
          ok: true,
          snapshot: {
            status: "paused",
            phase: "discovery",
            referenceInstant: "2026-10-27T15:00:00.000Z",
            referenceDate: "2026-10-27",
            cursorLastInvoicePk: null,
            cursorMode: "absent",
            scannedPages: 0,
            scannedInvoices: 0,
            createdCount: 0,
            updatedCount: 0,
            skippedCount: 0,
            assignedCount: 0,
            unassignedCount: 0,
            errorCount: 0,
            reportedTotal: null,
            leaseGeneration: 2,
            leaseOwner: null,
            leaseUntil: null,
            consecutiveNoProgress: 1,
            lastErrorClass: null,
            updatedAt: "2026-10-27T15:01:00.000Z",
          },
        }),
        getConfig: () => ({
          enabled: true,
          apiUrl: "https://erp.example",
          apiUser: "u",
          apiPassword: "p",
          defaultLeadPk: "1",
          defaultInterestStatus: "1",
          defaultPlanPk: "1",
          timeoutMs: 60_000,
        }),
        login: async () => ({ cookie: "BRBOSCookie=x", httpStatus: 200 }),
        listPage: async () => ({
          ok: true,
          rows: [],
          total: 0,
          payload: { success: true, total: 0, results: [] },
          httpStatus: 200,
          page: 1,
          start: 0,
          limit: 15,
          referenceDate: "2026-10-27",
        }),
      }
    )
    assert.equal(writes.claim, 0)
    assert.equal(writes.advance, 0)
    assert.equal(writes.release, 0)
    const runner = read("lib/brbyte/invoice-list-health-probe.ts")
    assert.equal(runner.includes("claimOrStart"), false)
    assert.equal(runner.includes("createOpsDiscoveryStore"), false)
    assert.equal(runner.includes(".update("), false)
    assert.equal(runner.includes(".insert("), false)
  })

  it("R - nenhuma importação do runner/persistência/reconciliação", () => {
    const files = [
      "lib/brbyte/invoice-list-health-probe.ts",
      "lib/brbyte/invoice-list-health-probe-result.ts",
      "lib/collections/discovery-run-snapshot.ts",
      "app/api/admin/collections/invoice-list-probe/route.ts",
    ]
    for (const rel of files) {
      const src = read(rel)
      assert.equal(src.includes("@/lib/collections/discovery-runner"), false, rel)
      assert.equal(src.includes("@/lib/collections/discovery-persist"), false, rel)
      assert.equal(src.includes("@/lib/collections/reconciliation"), false, rel)
      assert.equal(src.includes("assign_sector_work_item"), false, rel)
      assert.equal(src.includes("runCollectionsSync"), false, rel)
      assert.equal(src.includes("runOverdueDiscoveryBatch"), false, rel)
    }
  })

  it("S - probe antigo não sofre regressão de contrato de timeout", () => {
    assert.equal(clampInvoiceListProbeTimeoutMs(60_000), 12_000)
    const old = read("lib/brbyte/invoice-list-probe-result.ts")
    assert.match(old, /INVOICE_LIST_PROBE_TIMEOUT_MAX_MS = 12_000/)
    assert.match(old, /client_complete_name/)
  })
})

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import {
  CLIENT_IDENTITY_HEALTH_ATTEMPTS,
  CLIENT_IDENTITY_HEALTH_MODE,
  CLIENT_IDENTITY_MAX_DETAIL_REQUESTS,
  analyzeListIdentity,
  clampClientIdentityTimeoutMs,
  type IdentityRowInput,
} from "@/lib/brbyte/client-identity-probe-result"
import { runClientIdentityHealthProbe } from "@/lib/brbyte/client-identity-probe"
import { OVERDUE_FIRST_PAGE_HEALTH_MODE } from "@/lib/brbyte/invoice-list-health-probe-result"
import { authorizeOperationalSectorAccess } from "@/lib/auth/sector-membership"

const rootDir = process.cwd()
const read = (rel: string) => readFileSync(join(rootDir, rel), "utf8")

const PII_NAME = "Fulano PII Teste"
const PII_DOC = "12345678909"
const PII_PHONE = "5511987654321"

function makeRow(invoicePk: number, contractPk: number, extra: Record<string, unknown>) {
  const raw: Record<string, unknown> = {
    invoice_pk: invoicePk,
    contract_pk: contractPk,
    invoice_date_due: "2026-09-01",
    client_complete_name: PII_NAME,
    client_cpf_cnpj: PII_DOC,
    client_phone: PII_PHONE,
    invoice_amount_document: 199.9,
    ...extra,
  }
  return {
    invoicePk: String(invoicePk),
    contractPk: String(contractPk),
    invoiceDueDate: "2026-09-01",
    invoiceDate: null,
    invoicePeriod: null,
    invoiceDeleted: false,
    raw,
  }
}

function fifteen(extraFor: (i: number) => Record<string, unknown>) {
  return Array.from({ length: 15 }, (_, i) =>
    makeRow(900001 + i, 7000 + Math.floor(i / 3), extraFor(i))
  )
}

const config = {
  baseUrl: "https://erp.invalid",
  username: "u",
  password: "secret-pass",
  timeoutMs: 1,
} as never

function harness(rows: ReturnType<typeof makeRow>[], opts: {
  detailRaw?: (invoicePk: string) => Record<string, unknown> | null
  detailTimeout?: boolean
  clock?: number[]
  listTimeout?: boolean
  loginError?: boolean
} = {}) {
  const calls = { login: 0, list: 0, detail: 0, listArgs: [] as unknown[], detailForms: [] as unknown[], detailOpts: [] as unknown[] }
  const logs: unknown[] = []
  let t = 1_000
  const clock = opts.clock ? [...opts.clock] : null
  const deps = {
    now: () => (clock && clock.length ? (clock.shift() as number) : (t += 10)),
    newRequestId: () => "req-test",
    loadSettings: async () => ({ minimumDaysOverdue: 5 }),
    getConfig: () => config,
    login: (async () => {
      calls.login += 1
      return opts.loginError
        ? { error: "bad", httpStatus: 401 }
        : { cookie: "SESSIONCOOKIE=abc" }
    }) as never,
    listPage: (async (args: unknown) => {
      calls.list += 1
      calls.listArgs.push(args)
      if (opts.listTimeout) {
        return { ok: false, rows: [], total: null, payload: null, httpStatus: null, abortClass: "timeout", page: 1, start: 0, limit: 15, referenceDate: "x" }
      }
      return { ok: true, rows, total: 99, payload: { success: true, results: rows.map((r) => r.raw) }, httpStatus: 200, page: 1, start: 0, limit: 15, referenceDate: "x" }
    }) as never,
    postForm: (async (_c: unknown, _k: unknown, _p: unknown, fields: Record<string, string>, o: unknown) => {
      calls.detail += 1
      calls.detailForms.push(fields)
      calls.detailOpts.push(o)
      if (opts.detailTimeout) return { ok: false, status: null, json: null, abortClass: "timeout", message: "t" }
      const raw = opts.detailRaw ? opts.detailRaw(fields.invoice_pk) : null
      return { ok: true, status: 200, json: { success: true, results: raw ? [raw] : [] } }
    }) as never,
    log: (_tag: string, p: Record<string, unknown>) => { logs.push(p) },
  }
  return { deps, calls, logs }
}

function assertSanitized(value: unknown) {
  const blob = JSON.stringify(value)
  for (const forbidden of [PII_NAME, PII_DOC, PII_PHONE, "SESSIONCOOKIE", "secret-pass", "900001", "900002", "7000", "199.9", "client_complete_name", "raw", "firstValue", "sampleValue", "minValue", "maxValue", "hash"]) {
    assert.equal(blob.includes(forbidden), false, `vazou: ${forbidden}`)
  }
  assert.equal(/"\d{4,}"/.test(blob.replace(/"\d{4}-\d\d-\d\d[^"]*"/g, "")), false)
}

describe("3.1E-AS client_identity_health", () => {
  it("Admin Master obrigatório e rota reutilizada com modos preservados", () => {
    const route = read("app/api/admin/collections/invoice-list-probe/route.ts")
    assert.match(route, /action: "sync"/)
    assert.match(route, /CLIENT_IDENTITY_HEALTH_MODE/)
    assert.match(route, /OVERDUE_FIRST_PAGE_HEALTH_MODE/)
    assert.match(route, /runInvoiceListProbe/)
    assert.match(route, /maxDuration = 120/)
    assert.match(route, /runtime = "nodejs"/)
    assert.match(route, /dynamic = "force-dynamic"/)
    assert.match(route, /mode inv/)
    const base = { sectorCode: "collections" as const, userId: "u", profileId: "u", profileIsActive: true, employeeId: "e", employeeStatus: "active", membershipActive: true, membershipSectorCode: "collections", action: "sync" as const }
    assert.equal(authorizeOperationalSectorAccess({ ...base, role: "admin_master" }).ok, true)
    assert.equal(authorizeOperationalSectorAccess({ ...base, role: "admin_consulta" }).ok, false)
    assert.equal(CLIENT_IDENTITY_HEALTH_MODE, "client_identity_health")
    assert.equal(OVERDUE_FIRST_PAGE_HEALTH_MODE, "overdue_first_page_health")
  })

  it("timeout clamp até 60000, uma tentativa, máx 2 detalhes", () => {
    assert.equal(clampClientIdentityTimeoutMs(60_000), 60_000)
    assert.equal(clampClientIdentityTimeoutMs(90_000), 60_000)
    assert.equal(clampClientIdentityTimeoutMs(10), 3_000)
    assert.equal(CLIENT_IDENTITY_HEALTH_ATTEMPTS, 1)
    assert.equal(CLIENT_IDENTITY_MAX_DETAIL_REQUESTS, 2)
  })

  it("campo presente 15/15 na list → PROVEN_IN_LIST e zero detalhes", async () => {
    const rows = fifteen((i) => ({ client_pk: 500 + Math.floor(i / 3) }))
    const h = harness(rows)
    const r = await runClientIdentityHealthProbe({ timeoutMs: 60_000 }, h.deps)
    assert.equal(r.classification, "CLIENT_ID_PROVEN_IN_LIST")
    assert.equal(r.ok, true)
    assert.equal(h.calls.login, 1)
    assert.equal(h.calls.list, 1)
    assert.equal(h.calls.detail, 0)
    assert.equal(r.identity.presentCount, 15)
    assert.equal(r.identity.validCount, 15)
    assert.equal(r.identity.distinctCount, 5)
    assert.deepEqual(r.identity.types, { integer: 15 })
    assert.equal(r.identity.contractConflictCount, 0)
    assert.equal(r.identity.repeatedClientCount, 5)
    const args = h.calls.listArgs[0] as Record<string, unknown>
    assert.equal(args.page, 1)
    assert.equal("afterInvoicePk" in args, false)
    assert.equal(args.minimumDaysOverdue, 5)
    assert.deepEqual(r.query, { page: 1, start: 0, limit: 15, sort: "invoice_pk", dir: "ASC", cursor: "absent" })
    assertSanitized(r)
    assertSanitized(h.logs)
  })

  it("cliente repetido em vários contratos é contado sem conflito", () => {
    const rows: IdentityRowInput[] = [
      { invoicePk: "1", contractPk: "10", raw: { client_pk: 7 } },
      { invoicePk: "2", contractPk: "11", raw: { client_pk: 7 } },
      { invoicePk: "3", contractPk: "10", raw: { client_pk: 7 } },
    ]
    const a = analyzeListIdentity(rows)
    assert.equal(a.proven, true)
    assert.equal(a.clientsWithMultipleContracts, 1)
    assert.equal(a.repeatedClientCount, 1)
  })

  it("mesmo contract_pk com cliente divergente → conflito, não prova", () => {
    const a = analyzeListIdentity([
      { invoicePk: "1", contractPk: "10", raw: { client_pk: 7 } },
      { invoicePk: "2", contractPk: "10", raw: { client_pk: 8 } },
    ])
    assert.equal(a.contractConflictCount, 1)
    assert.equal(a.proven, false)
  })

  it("alias conflitante → aliasConflictCount e não prova", () => {
    const a = analyzeListIdentity([
      { invoicePk: "1", contractPk: "10", raw: { client_pk: 7, id_cliente: "9" } },
    ])
    assert.equal(a.aliasConflictCount, 1)
    assert.equal(a.proven, false)
  })

  it("null / tipo inválido / tipos mistos não provam", () => {
    assert.equal(analyzeListIdentity([
      { invoicePk: "1", contractPk: "10", raw: { client_pk: null } },
    ]).proven, false)
    const inv = analyzeListIdentity([
      { invoicePk: "1", contractPk: "10", raw: { client_pk: "abc" } },
    ])
    assert.equal(inv.primary?.invalidCount, 1)
    assert.equal(inv.proven, false)
    assert.equal(analyzeListIdentity([
      { invoicePk: "1", contractPk: "10", raw: { client_pk: 7 } },
      { invoicePk: "2", contractPk: "11", raw: { client_pk: "8" } },
    ]).proven, false)
  })

  it("campo ausente na list → no máximo 2 detalhes, uma tentativa cada", async () => {
    const rows = fifteen(() => ({}))
    const h = harness(rows, { detailRaw: () => ({ invoice_pk: 1, client_pk: 44 }) })
    const r = await runClientIdentityHealthProbe({ timeoutMs: 60_000 }, h.deps)
    assert.equal(h.calls.detail, 2)
    for (const o of h.calls.detailOpts) assert.equal((o as { maxAttempts: number }).maxAttempts, 1)
    for (const f of h.calls.detailForms) assert.deepEqual(Object.keys(f as object), ["invoice_pk"])
    assert.equal(r.classification, "CLIENT_ID_PROVEN_IN_DETAIL")
    assert.equal(r.detail.requestedCount, 2)
    assert.equal(r.detail.successfulCount, 2)
    assertSanitized(r)
    assertSanitized(h.logs)
  })

  it("ausente em list e detail → NOT_PRESENT", async () => {
    const h = harness(fifteen(() => ({})), { detailRaw: () => ({ invoice_pk: 1 }) })
    const r = await runClientIdentityHealthProbe({ timeoutMs: 60_000 }, h.deps)
    assert.equal(r.classification, "CLIENT_ID_NOT_PRESENT")
    assert.equal(h.calls.detail, 2)
  })

  it("presença parcial na list → PARTIALLY_OBSERVED se detalhe não prova", async () => {
    const h = harness(fifteen((i) => (i < 5 ? { client_pk: 3 } : {})), { detailRaw: () => ({ invoice_pk: 1 }) })
    const r = await runClientIdentityHealthProbe({ timeoutMs: 60_000 }, h.deps)
    assert.equal(r.classification, "CLIENT_ID_PARTIALLY_OBSERVED")
    assert.equal(r.identity.presentCount, 5)
  })

  it("detalhe divergente da list → conflito", async () => {
    const h = harness(fifteen((i) => (i < 2 ? { client_pk: 3 } : {})), { detailRaw: () => ({ client_pk: 4 }) })
    const r = await runClientIdentityHealthProbe({ timeoutMs: 60_000 }, h.deps)
    assert.equal(r.detail.identityConflictCount, 2)
    assert.notEqual(r.classification, "CLIENT_ID_PROVEN_IN_DETAIL")
  })

  it("sem orçamento → detalhe não executado, INCONCLUSIVE", async () => {
    // started=0, settings…; após list, relógio já em 105000ms.
    const clock = [0, 0, 10, 20, 105_000, 105_000, 105_000, 105_000]
    const h = harness(fifteen(() => ({})), { clock })
    const r = await runClientIdentityHealthProbe({ timeoutMs: 60_000 }, h.deps)
    assert.equal(h.calls.detail, 0)
    assert.equal(r.detail.skippedForBudget, true)
    assert.equal(r.classification, "INCONCLUSIVE_TIMEOUT_OR_BUDGET")
  })

  it("timeout no detalhe para no primeiro, sem retry", async () => {
    const h = harness(fifteen(() => ({})), { detailTimeout: true })
    const r = await runClientIdentityHealthProbe({ timeoutMs: 60_000 }, h.deps)
    assert.equal(h.calls.detail, 1)
    assert.equal(r.classification, "INCONCLUSIVE_TIMEOUT_OR_BUDGET")
  })

  it("timeout na list e falha de login sem fallback", async () => {
    const a = harness([], { listTimeout: true })
    const ra = await runClientIdentityHealthProbe({}, a.deps)
    assert.equal(ra.classification, "INCONCLUSIVE_TIMEOUT_OR_BUDGET")
    assert.equal(a.calls.list, 1)
    assert.equal(a.calls.detail, 0)
    const b = harness([], { loginError: true })
    const rb = await runClientIdentityHealthProbe({}, b.deps)
    assert.equal(rb.classification, "AUTH_OR_CONFIG_FAILURE")
    assert.equal(b.calls.list, 0)
  })

  it("sem importações de escrita / run / sync / assignment", () => {
    const runner = read("lib/brbyte/client-identity-probe.ts")
    const pure = read("lib/brbyte/client-identity-probe-result.ts")
    for (const full of [runner, pure]) {
      const src = full.split("\n").filter((l) => /^\s*(import|from)\b|\} from /.test(l)).join("\n") + full.replace(/async/g, "")
      for (const bad of ["discovery-runner", "discovery-run-snapshot", "sync", "persist", "assign", "reconcil", "checkpoint", "getOpsDb", "supabase", ".insert(", ".update(", ".rpc(", "fetchInvoiceInfo", "advance", "release", "claim"]) {
        assert.equal(src.toLowerCase().includes(bad.toLowerCase()), false, `contém ${bad}`)
      }
    }
    assert.match(runner, /maxAttempts: 1/)
    assert.equal(/console\.log\([^)]*cookie/i.test(runner), false)
  })
})

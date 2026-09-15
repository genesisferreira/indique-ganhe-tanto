import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { authorizeOperationalSectorAccess } from "@/lib/auth/sector-membership"

const root = process.cwd()

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8")
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

describe("invoice-list-probe wiring", () => {
  it("GET não executa o probe", () => {
    const route = read("app/api/admin/collections/invoice-list-probe/route.ts")
    const getBlock = route.slice(
      route.indexOf("export async function GET"),
      route.indexOf("export async function POST")
    )
    assert.match(getBlock, /export async function GET/)
    assert.equal(getBlock.includes("runInvoiceListProbe"), false)
    assert.equal(getBlock.includes("brbyteAdminPostForm"), false)
    assert.match(getBlock, /405/)
  })

  it("POST autorizado executa uma única tentativa", () => {
    const route = read("app/api/admin/collections/invoice-list-probe/route.ts")
    const runner = read("lib/brbyte/invoice-list-probe.ts")
    const postBlock = route.slice(route.indexOf("export async function POST"))
    assert.match(postBlock, /export async function POST/)
    assert.match(postBlock, /action: "sync"/)
    assert.match(postBlock, /runInvoiceListProbe/)
    assert.match(route, /POST de listagem no Controllr/)
    assert.equal(/sem chamada externa/i.test(route), false)
    assert.equal(runner.includes(".insert("), false)
    assert.equal(runner.includes(".update("), false)
    assert.equal(runner.includes("assign_sector_work_item"), false)
    assert.equal(runner.includes("listAllOpenInvoices"), false)
    assert.equal(runner.includes("getOpsDb"), false)
    assert.match(runner, /maxAttempts: INVOICE_LIST_PROBE_ATTEMPTS/)
    assert.match(
      read("lib/brbyte/invoice-list-probe-result.ts"),
      /export const INVOICE_LIST_PROBE_ATTEMPTS = 1/
    )
    const result = read("lib/brbyte/invoice-list-probe-result.ts")
    assert.match(result, /limit: String\(INVOICE_LIST_PROBE_PAGE_SIZE\)/)
    assert.match(result, /client_complete_name/)
    assert.equal(runner.includes("listAllOpenInvoices"), false)
    assert.equal(runner.includes("syncCollectionsFromControllr"), false)
  })

  it("form-urlencoded do probe tem where JSON e uma tentativa", () => {
    const result = read("lib/brbyte/invoice-list-probe-result.ts")
    assert.match(result, /"client_status"/)
    assert.match(result, /oper: 5/)
    assert.match(result, /oper: 4/)
    assert.match(result, /oper: 3/)
    assert.match(result, /page: "1"/)
    assert.match(result, /start: "0"/)
    assert.match(result, /dir: "ASC"/)
  })

  it("POST sem Admin Master é bloqueado", () => {
    const route = read("app/api/admin/collections/invoice-list-probe/route.ts")
    assert.match(route, /action: "sync"/)
    const master = authorizeOperationalSectorAccess({
      ...probeActor,
      role: "admin_master",
    })
    assert.equal(master.ok, true)
    const member = authorizeOperationalSectorAccess({
      ...probeActor,
      role: "comercial",
    })
    assert.equal(member.ok, false)
    if (!member.ok) assert.equal(member.status, 403)
    const consulta = authorizeOperationalSectorAccess({
      ...probeActor,
      role: "admin_consulta",
    })
    assert.equal(consulta.ok, false)
  })

  it("resposta sanitizada não inclui fatura nem credencial", () => {
    const result = read("lib/brbyte/invoice-list-probe-result.ts")
    const runner = read("lib/brbyte/invoice-list-probe.ts")
    assert.equal(result.includes("extractInvoiceListRows"), false)
    assert.match(result, /pageCount/)
    assert.match(result, /reportedTotal/)
    assert.equal(/console\.log\([\s\S]*cookie/i.test(runner), false)
    assert.equal(runner.includes("login.cookie"), true)
  })

  it("UI Cobrança não dispara o probe", () => {
    const page = read("app/cobranca/page.tsx")
    assert.equal(page.includes("invoice-list-probe"), false)
  })
})

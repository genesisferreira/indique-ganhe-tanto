import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"

const root = process.cwd()

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8")
}

describe("invoice-list-probe wiring", () => {
  it("rota é GET Admin Master, uma tentativa, sem escrita", () => {
    const route = read("app/api/admin/collections/invoice-list-probe/route.ts")
    const runner = read("lib/brbyte/invoice-list-probe.ts")
    assert.match(route, /export async function GET/)
    assert.equal(/\bexport async function POST\b/.test(route), false)
    assert.match(route, /action: "sync"/)
    assert.match(route, /POST de listagem no Controllr/)
    assert.equal(/sem chamada externa/i.test(route), false)
    assert.match(runner, /maxAttempts: INVOICE_LIST_PROBE_ATTEMPTS/)
    assert.equal(runner.includes(".insert("), false)
    assert.equal(runner.includes(".update("), false)
    assert.equal(runner.includes("assign_sector_work_item"), false)
    assert.equal(runner.includes("listAllOpenInvoices"), false)
    assert.equal(runner.includes("getOpsDb"), false)
    assert.equal(runner.includes("login.cookie"), true)
    assert.equal(/console\.log\([\s\S]*cookie/i.test(runner), false)
  })

  it("UI Cobrança não dispara o probe", () => {
    const page = read("app/cobranca/page.tsx")
    assert.equal(page.includes("invoice-list-probe"), false)
  })
})

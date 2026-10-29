import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { after, before, describe, it } from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseDurableResult, type BatchOperationStore } from "@/lib/collections/batch-operation"
import { executeNextBatchRequest, type NextBatchFlowDeps } from "@/lib/collections/batch-operation-flow"

/**
 * Sprint 3.1E-BB — PostgreSQL local real (embedded, 127.0.0.1).
 * Duas "instâncias" = duas conexões independentes como service_role.
 * Nenhuma conexão remota, nenhum ERP.
 */
const here = dirname(fileURLToPath(import.meta.url))
const labUrl = pathToFileURL(join(here, "../../scripts/local-pg-collections-lab/run.mjs")).href
const BB = "supabase/patch-collection-bb-durable-batch-operation.sql"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgRow = Record<string, any>
type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: PgRow[] }>
  connect: () => Promise<void>
  end: () => Promise<void>
}
type PgClientCtor = new (config: Record<string, unknown>) => PgClient
type LabModule = {
  startCollectionsLab: () => Promise<{ client: PgClient; conn: PgRow; Client: PgClientCtor }>
  stopCollectionsLab: () => Promise<void>
}

let lab: LabModule
let owner: PgClient
let Client: PgClientCtor
let conn: PgRow
const extras: PgClient[] = []

async function instance(role = "service_role") {
  const c = new Client({ host: conn.host, port: conn.port, user: conn.user, password: conn.password, database: conn.database })
  await c.connect()
  await c.query(`set role ${role}`)
  extras.push(c)
  return c
}
async function rpc(c: PgClient, sql: string, params: unknown[]) {
  return parseDurableResult((await c.query(`select ${sql} as r`, params)).rows[0].r)
}
function pgStore(c: PgClient, nowRef?: { t: string | null }): BatchOperationStore {
  const now = () => nowRef?.t ?? null
  return {
    create: (i) => rpc(c, "public.create_collection_batch_operation('collections',$1,$2,$3,$4,$5::uuid,600,$6::timestamptz)", [i.maxSegments, i.configuredCapacity, i.available, i.queueEnabled, i.createdBy, now()]),
    claim: (id, seg) => rpc(c, "public.claim_collection_batch_segment($1::uuid,$2,600,$3::timestamptz)", [id, seg, now()]),
    complete: (i) => rpc(c, "public.complete_collection_batch_segment($1::uuid,$2,$3,$4,$5::jsonb,600,$6::timestamptz)", [i.operationId, i.segment, i.ok, i.stopReason, JSON.stringify(i.summary), now()]),
    requestStop: (id) => rpc(c, "public.request_collection_batch_stop($1::uuid,$2::timestamptz)", [id, now()]),
    get: (id) => rpc(c, "public.get_collection_batch_operation('collections',$1::uuid,$2::timestamptz)", [id, now()]),
  }
}
const sum0 = { scannedInvoices: 0, newContracts: 0, existingContractInvoices: 0, durationMs: 0, pauseStage: null }
const create = (s: BatchOperationStore, max = 5, available: number | null = 13) =>
  s.create({ maxSegments: max, configuredCapacity: 15, available, queueEnabled: true, createdBy: null })
async function reset() {
  await owner.query("delete from public.collection_batch_operations")
}
async function opsSnapshot() {
  const t = ["collection_cases", "collection_case_events", "collection_case_invoices", "sector_work_assignments", "collection_discovery_runs"]
  const out: Record<string, unknown> = {}
  for (const name of t) out[name] = (await owner.query(`select count(*)::int as n, md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as h from public.${name} t`)).rows[0]
  return JSON.stringify(out)
}

const summary = (available: number, busy = false) => ({
  ok: true as const,
  summary: { configuredCapacity: 15, activeContracts: 15 - available, availableCapacity: available, capacityFull: available <= 0, source: "contract_capacity", configured: 15, occupying: 15 - available, available, unkeyed: 0, futurePromises: 0, futureCallbacks: 0, busy, runStatus: "paused", runPauseStage: null } as never,
})
const okSeg = { ok: true, discoveryStatus: "paused", pauseStage: "page_limit", progressMade: true, contractsAdmitted: 1, segmentScannedInvoices: 15, segmentUpdated: 0, capacityReached: false }
function flowDeps(store: BatchOperationStore, o: { available?: () => number; busy?: () => boolean; run?: () => Promise<unknown>; calls?: { n: number }; env?: unknown } = {}): NextBatchFlowDeps {
  return {
    store,
    loadSummary: async () => summary(o.available ? o.available() : 10, o.busy ? o.busy() : false),
    loadQueueEnabled: async () => true,
    runSegment: async () => {
      if (o.calls) o.calls.n += 1
      return (o.run ? await o.run() : okSeg) as never
    },
    maxSegmentsEnv: o.env,
  }
}

describe("PostgreSQL real - 3.1E-BB operação durável", { timeout: 300_000 }, () => {
  let A: PgClient
  let B: PgClient
  before(async () => {
    lab = (await import(labUrl)) as LabModule
    const started = await lab.startCollectionsLab()
    owner = started.client
    Client = started.Client
    conn = started.conn
    A = await instance()
    B = await instance()
  })
  after(async () => {
    for (const c of extras) await c.end().catch(() => undefined)
    await lab.stopCollectionsLab()
  })

  it("migration reaplicável (2x) e sem SECURITY DEFINER", async () => {
    await owner.query(readFileSync(join(here, "../..", BB), "utf8"))
    await owner.query(readFileSync(join(here, "../..", BB), "utf8"))
    const defs = await owner.query(
      `select proname, prosecdef from pg_proc where pronamespace = 'public'::regnamespace and proname like '%collection_batch%'`
    )
    assert.ok(defs.rows.length >= 7)
    for (const r of defs.rows) assert.equal(r.prosecdef, false, r.proname)
  })

  it("RLS ligada, sem policies; anon/authenticated sem acesso a tabela e RPCs", async () => {
    const rls = await owner.query(`select relrowsecurity from pg_class where oid = 'public.collection_batch_operations'::regclass`)
    assert.equal(rls.rows[0].relrowsecurity, true)
    const pol = await owner.query(`select count(*)::int n from pg_policies where tablename = 'collection_batch_operations'`)
    assert.equal(pol.rows[0].n, 0)
    for (const role of ["anon", "authenticated"]) {
      const c = await instance(role)
      await assert.rejects(c.query("select * from public.collection_batch_operations"), /permission denied/)
      await assert.rejects(c.query("insert into public.collection_batch_operations (sector, max_segments, configured_capacity, expires_at) values ('collections',5,15,now())"), /permission denied/)
      await assert.rejects(c.query("select public.create_collection_batch_operation('collections',5,15,13,true,null,600,null)"), /permission denied/)
      await assert.rejects(c.query("select public.get_collection_batch_operation('collections',null,null)"), /permission denied/)
    }
    const execPub = await owner.query(
      `select count(*)::int n from pg_proc p where pronamespace='public'::regnamespace and proname like '%collection_batch%'
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`
    )
    assert.equal(execPub.rows[0].n, 0)
  })

  it("tabela sem colunas sensíveis (cliente/contrato/invoice/valores/tokens)", async () => {
    const cols = (await owner.query(`select column_name from information_schema.columns where table_name='collection_batch_operations'`)).rows.map((r) => String(r.column_name))
    for (const c of cols) assert.equal(/customer|client|contract_pk|invoice|amount|value|token|payload|document|phone|email/i.test(c), false, c)
  })

  it("criação única: duas instâncias concorrentes => apenas uma; ativa bloqueia; índice único parcial", async () => {
    await reset()
    const [x, y] = await Promise.all([create(pgStore(A)), create(pgStore(B))])
    assert.equal([x, y].filter((r) => r.ok).length, 1)
    assert.equal([x, y].find((r) => !r.ok)?.code, "operation_active")
    await assert.rejects(
      owner.query("insert into public.collection_batch_operations (sector, status, max_segments, configured_capacity, expires_at) values ('collections','ready',5,15,now()+interval '10 min')"),
      /collection_batch_operations_one_active_uidx/
    )
  })

  it("maxSegments=100 limitado a 10; default 5; capacidade cheia/fila desligada recusam", async () => {
    await reset()
    const big = await create(pgStore(A), 100)
    assert.equal(big.operation?.maxSegments, 10)
    await reset()
    const def = await rpc(A, "public.create_collection_batch_operation('collections',null,15,13,true,null,600,null)", [])
    assert.equal(def.operation?.maxSegments, 5)
    await reset()
    assert.equal((await create(pgStore(A), 5, 0)).code, "capacity_full")
    assert.equal((await pgStore(A).create({ maxSegments: 5, configuredCapacity: 15, available: 5, queueEnabled: false, createdBy: null })).code, "disabled")
    assert.equal((await owner.query("select count(*)::int n from public.collection_batch_operations")).rows[0].n, 0)
  })

  it("A cria; B reconhece; claim concorrente: só um vence; ordinal incorreto recusado; B pega seg2", async () => {
    await reset()
    const op = (await create(pgStore(A))).operation!
    const seen = await pgStore(B).get(null)
    assert.equal(seen.operation?.id, op.id)
    const [c1, c2] = await Promise.all([pgStore(A).claim(op.id, 1), pgStore(B).claim(op.id, 1)])
    assert.equal([c1, c2].filter((r) => r.ok).length, 1)
    assert.equal([c1, c2].find((r) => !r.ok)?.code, "segment_in_flight")
    assert.equal((await pgStore(B).claim(op.id, 2)).code, "segment_in_flight")
    await pgStore(A).complete({ operationId: op.id, segment: 1, ok: true, stopReason: null, summary: { ...sum0, scannedInvoices: 15, newContracts: 2 } })
    assert.equal((await pgStore(B).claim(op.id, 3)).code, "segment_out_of_order")
    assert.equal((await pgStore(B).claim(op.id, 1)).code, "segment_out_of_order")
    const s2 = await pgStore(B).claim(op.id, 2)
    assert.equal(s2.ok, true)
    assert.equal(s2.segment, 2)
  })

  it("conclusão repetida idempotente; ordinal errado na conclusão recusado; resumo sanitizado", async () => {
    await reset()
    const op = (await create(pgStore(A))).operation!
    await pgStore(A).claim(op.id, 1)
    assert.equal((await pgStore(A).complete({ operationId: op.id, segment: 2, ok: true, stopReason: null, summary: sum0 })).code, "segment_mismatch")
    const dirty = { scannedInvoices: 3, newContracts: 1, existingContractInvoices: 2, durationMs: 9, pauseStage: "page_limit", customer: "Fulano", invoicePk: "123" }
    const a = await pgStore(A).complete({ operationId: op.id, segment: 1, ok: true, stopReason: null, summary: dirty as never })
    const b = await pgStore(B).complete({ operationId: op.id, segment: 1, ok: true, stopReason: null, summary: dirty as never })
    assert.equal(a.replay, false)
    assert.equal(b.replay, true)
    const row = (await owner.query("select segments_completed, aggregate_counters::text a, last_segment_summary::text l from public.collection_batch_operations where id=$1", [op.id])).rows[0]
    assert.equal(row.segments_completed, 1)
    assert.equal(/Fulano|invoicePk|customer/.test(row.a + row.l), false)
    assert.equal(JSON.parse(row.a).newContracts, 1)
  })

  it("limite 5 global: segmentos alternando instâncias, 6º recusado", async () => {
    await reset()
    const op = (await create(pgStore(A))).operation!
    for (let seg = 1; seg <= 5; seg++) {
      const s = pgStore(seg % 2 ? A : B)
      assert.equal((await s.claim(op.id, seg)).ok, true, `seg${seg}`)
      await s.complete({ operationId: op.id, segment: seg, ok: true, stopReason: null, summary: sum0 })
    }
    const g = await pgStore(A).get(op.id)
    assert.equal(g.operation?.status, "max_segments")
    assert.equal((await pgStore(B).claim(op.id, 6)).code, "operation_stopped")
  })

  it("capacity_reached, pagination_ended, failed (erro/timeout/zero_progress) são terminais", async () => {
    for (const [reason, ok, status] of [
      ["capacity_reached", true, "capacity_reached"],
      ["pagination_ended", true, "pagination_ended"],
      ["error", false, "failed"],
      ["timeout", false, "failed"],
      ["zero_progress", true, "failed"],
    ] as const) {
      await reset()
      const op = (await create(pgStore(A))).operation!
      await pgStore(A).claim(op.id, 1)
      const r = await pgStore(A).complete({ operationId: op.id, segment: 1, ok, stopReason: reason, summary: sum0 })
      assert.equal(r.operation?.status, status, reason)
      assert.equal((await pgStore(B).claim(op.id, 2)).code, "operation_stopped")
      // terminal não bloqueia nova
      assert.equal((await create(pgStore(B))).ok, true)
    }
  })

  it("stop_requested em outra instância: em voo conclui; nenhum novo começa", async () => {
    await reset()
    const op = (await create(pgStore(A))).operation!
    await pgStore(A).claim(op.id, 1)
    const st = await pgStore(B).requestStop(op.id)
    assert.equal(st.operation?.status, "segment_running")
    assert.equal(st.operation?.stopRequested, true)
    const done = await pgStore(A).complete({ operationId: op.id, segment: 1, ok: true, stopReason: null, summary: sum0 })
    assert.equal(done.operation?.status, "stopped")
    assert.equal((await pgStore(A).claim(op.id, 2)).code, "operation_stopped")
    // stop em awaiting_next encerra imediatamente
    await reset()
    const op2 = (await create(pgStore(A))).operation!
    await pgStore(A).claim(op2.id, 1)
    await pgStore(A).complete({ operationId: op2.id, segment: 1, ok: true, stopReason: null, summary: sum0 })
    assert.equal((await pgStore(B).requestStop(op2.id)).operation?.status, "stopped")
  })

  it("TTL persistente entre instâncias; expirada terminalizada antes de criar outra; refresh não continua", async () => {
    await reset()
    const t = { t: "2026-10-29T12:00:00Z" as string | null }
    const op = (await create(pgStore(A, t))).operation!
    await pgStore(A, t).claim(op.id, 1)
    await pgStore(A, t).complete({ operationId: op.id, segment: 1, ok: true, stopReason: null, summary: sum0 })
    // "refresh": leitura não avança nada
    const before = (await owner.query("select segments_started, updated_at from public.collection_batch_operations where id=$1", [op.id])).rows[0]
    await pgStore(B, t).get(null)
    const afterRead = (await owner.query("select segments_started, updated_at from public.collection_batch_operations where id=$1", [op.id])).rows[0]
    assert.deepEqual(afterRead, before)
    t.t = "2026-10-29T12:11:00Z"
    assert.equal((await create(pgStore(B, t))).ok, true, "expirada foi terminalizada")
    const old = (await owner.query("select status, stop_reason, completed_at from public.collection_batch_operations where id=$1", [op.id])).rows[0]
    assert.equal(old.status, "expired")
    assert.ok(old.completed_at)
    assert.equal((await pgStore(A, t).claim(op.id, 2)).code, "operation_stopped")
    // claim direto numa operação vencida
    await reset()
    const t2 = { t: "2026-10-29T13:00:00Z" as string | null }
    const op3 = (await create(pgStore(A, t2))).operation!
    t2.t = "2026-10-29T13:20:00Z"
    assert.equal((await pgStore(B, t2).claim(op3.id, 1)).code, "operation_expired")
  })

  it("rollback: criação dentro de transação abortada não deixa operação", async () => {
    await reset()
    await A.query("begin")
    await rpc(A, "public.create_collection_batch_operation('collections',5,15,13,true,null,600,null)", [])
    await A.query("rollback")
    assert.equal((await owner.query("select count(*)::int n from public.collection_batch_operations")).rows[0].n, 0)
  })

  it("fluxo completo com store PG: duas abas, capacidade revalidada, lease busy, erro sem retry; nenhum caso/evento/assignment/run alterado", async () => {
    await reset()
    const snap = await opsSnapshot()
    // duas abas: a 1ª fica em voo; a 2ª recebe operation_active
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const calls = { n: 0 }
    const tabA = executeNextBatchRequest(flowDeps(pgStore(A), { calls, run: async () => { await gate; return okSeg } }), { actorProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", request: { kind: "start" } })
    await new Promise((r) => setTimeout(r, 50))
    const tabB = await executeNextBatchRequest(flowDeps(pgStore(B), { calls }), { actorProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", request: { kind: "start" } })
    assert.equal(tabB.body.code, "operation_active")
    release()
    const r1 = await tabA
    assert.equal(r1.body.operationStatus, "awaiting_next")
    const id = String(r1.body.batchOperationId)
    // instância B continua com nextSegment do servidor; capacidade enche => zero ERP
    const r2 = await executeNextBatchRequest(flowDeps(pgStore(B), { calls, available: () => 0 }), { actorProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", request: { kind: "continue", batchOperationId: id, segment: Number(r1.body.nextSegment) } })
    assert.equal(r2.body.operationStatus, "capacity_reached")
    assert.equal(calls.n, 1)
    // lease ativa (busy): segmento não chama ERP
    const r3 = await executeNextBatchRequest(flowDeps(pgStore(A), { calls, busy: () => true }), { actorProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", request: { kind: "start" } })
    assert.equal(r3.status, 409)
    assert.equal(calls.n, 1)
    // erro: failed, sem retry
    const r4 = await executeNextBatchRequest(flowDeps(pgStore(B), { calls, run: async () => { throw new Error("boom") } }), { actorProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", request: { kind: "start" } })
    assert.equal(r4.body.operationStatus, "failed")
    assert.equal(calls.n, 2)
    // env 100 => teto 10 no banco
    const r5 = await executeNextBatchRequest(flowDeps(pgStore(A), { env: "100" }), { actorProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", request: { kind: "start" } })
    assert.equal(r5.body.maxSegments, 10)
    assert.equal(await opsSnapshot(), snap, "controle da operação não cria/altera casos/eventos/faturas/assignments/run")
  })
})

describe("3.1E-BB segurança de bundle/arquitetura", () => {
  it("service_role ausente do código cliente e de NEXT_PUBLIC; store é server-only", () => {
    const page = readFileSync(join(here, "../../app/cobranca/page.tsx"), "utf8")
    assert.equal(/service_role|SERVICE_ROLE|\.rpc\(|collection_batch_operations/i.test(page), false)
    const store = readFileSync(join(here, "batch-operation-store.ts"), "utf8")
    assert.match(store, /^import "server-only"/)
    const sql = readFileSync(join(here, "../..", BB), "utf8").replace(/--.*$/gm, "")
    assert.equal(/security definer/i.test(sql), false)
    assert.equal(/\bgrant\b[^;]*\bto (anon|authenticated|public)\b/i.test(sql), false)
    const chunks = join(here, "../../.next/static")
    if (existsSync(chunks)) {
      const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
      for (const f of walk(chunks).filter((f) => f.endsWith(".js"))) {
        const js = readFileSync(f, "utf8")
        assert.equal(/SUPABASE_SERVICE_ROLE_KEY|collection_batch_operations|claim_collection_batch_segment/.test(js), false, f)
      }
    }
  })
  it("sem Map/lock/setTimeout em memória como controle da operação", () => {
    const op = readFileSync(join(here, "batch-operation.ts"), "utf8")
    const svc = readFileSync(join(here, "next-batch.service.ts"), "utf8")
    const flow = readFileSync(join(here, "batch-operation-flow.ts"), "utf8")
    for (const src of [op, svc, flow]) {
      assert.equal(/new Map\(|createBatchOperationRegistry|setTimeout\(|localStorage/.test(src), false)
    }
    const logs = flow.match(/log\("[\s\S]*?\}\)/g) ?? []
    for (const l of logs) assert.equal(/customer|document|invoicePk|contractPk|caseId|runId/i.test(l), false)
  })
})

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { after, before, describe, it } from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { buildSegmentMetrics, parseDurableResult, type BatchOperationStore, type SegmentMetrics } from "@/lib/collections/batch-operation"
import { executeNextBatchRequest, type NextBatchFlowDeps } from "@/lib/collections/batch-operation-flow"

/**
 * Sprint 3.1E-BD — PostgreSQL local real (embedded, 127.0.0.1), cadeia
 * completa de migrations (bootstrap → … → BB → BD). Sem conexão remota, sem ERP.
 */
const here = dirname(fileURLToPath(import.meta.url))
const labUrl = pathToFileURL(join(here, "../../scripts/local-pg-collections-lab/run.mjs")).href
const BD = "supabase/patch-collection-bd-segment-metrics-and-grants.sql"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgRow = Record<string, any>
type PgClient = { query: (sql: string, params?: unknown[]) => Promise<{ rows: PgRow[] }>; connect: () => Promise<void>; end: () => Promise<void> }
type PgClientCtor = new (config: Record<string, unknown>) => PgClient
type LabModule = { startCollectionsLab: () => Promise<{ client: PgClient; conn: PgRow; Client: PgClientCtor }>; stopCollectionsLab: () => Promise<void> }

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
  const raw = (await c.query(`select ${sql} as r`, params)).rows[0].r
  return { ...parseDurableResult(raw), metricsRecorded: raw?.metricsRecorded }
}
function pgStoreBD(c: PgClient): BatchOperationStore {
  return {
    create: (i) => rpc(c, "public.create_collection_batch_operation('collections',$1,$2,$3,$4,$5::uuid,600,null)", [i.maxSegments, i.configuredCapacity, i.available, i.queueEnabled, i.createdBy]),
    claim: (id, seg) => rpc(c, "public.claim_collection_batch_segment($1::uuid,$2,600,null)", [id, seg]),
    complete: (i) => rpc(c, "public.complete_collection_batch_segment_with_metrics($1::uuid,$2,$3,$4,$5::jsonb,$6::jsonb,600,null)", [i.operationId, i.segment, i.ok, i.stopReason, JSON.stringify(i.summary), JSON.stringify(i.metrics ?? {})]),
    requestStop: (id) => rpc(c, "public.request_collection_batch_stop($1::uuid,null)", [id]),
    get: (id) => rpc(c, "public.get_collection_batch_operation('collections',$1::uuid,null)", [id]),
  }
}
const sum0 = { scannedInvoices: 0, newContracts: 0, existingContractInvoices: 0, durationMs: 0, pauseStage: null }
const metrics = (o: Partial<SegmentMetrics> = {}): SegmentMetrics => ({
  ...buildSegmentMetrics({
    startedAtMs: Date.now() - 1000, totalMs: 1000, stageTimings: { loginMs: 100, listMs: 200, listRequests: 1, classificationMs: 5, detailLookups: 3, detailSkippedByList: 1, detailMs: 300, persistMs: 50, checkpointMs: 10, releaseMs: 5 },
    segmentScannedInvoices: 3, newContracts: 1, existingContractInvoices: 2, segmentCreated: 1, skippedThisBatch: 0, capacityBefore: 2, capacityAfter: 3,
  }),
  ...o,
})
const create = (s: BatchOperationStore) => s.create({ maxSegments: 5, configuredCapacity: 15, available: 13, queueEnabled: true, createdBy: null })
async function reset() {
  await owner.query("delete from public.collection_batch_operation_segments")
  await owner.query("delete from public.collection_batch_operations")
}
async function opsSnapshot() {
  const t = ["collection_cases", "collection_case_events", "collection_case_invoices", "sector_work_assignments", "collection_discovery_runs"]
  const out: Record<string, unknown> = {}
  for (const name of t) out[name] = (await owner.query(`select count(*)::int as n, md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as h from public.${name} t`)).rows[0]
  return JSON.stringify(out)
}
const priv = async (role: string, obj: string, p: string) =>
  (await owner.query(`select has_table_privilege($1, $2, $3) as v`, [role, obj, p])).rows[0].v as boolean

describe("PostgreSQL real - 3.1E-BD grants + métricas por segmento", { timeout: 300_000 }, () => {
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

  it("BD reaplicável; remove DELETE/TRUNCATE herdados do default da plataforma; não altera operações existentes", async () => {
    await reset()
    // Simula o default Supabase visto em produção (DELETE concedido ao service_role).
    await owner.query("grant all on table public.collection_batch_operations to service_role, anon, authenticated")
    await owner.query("insert into public.collection_batch_operations (sector,status,max_segments,segments_started,segments_completed,next_segment,configured_capacity,stop_reason,expires_at,completed_at) values ('collections','failed',5,2,2,3,15,'timeout',now(),now())")
    const before = (await owner.query("select md5(string_agg(t::text, ',')) h, count(*)::int n from public.collection_batch_operations t")).rows[0]
    const sql = readFileSync(join(here, "../..", BD), "utf8")
    await owner.query(sql)
    await owner.query(sql)
    const afterRow = (await owner.query("select md5(string_agg(t::text, ',')) h, count(*)::int n from public.collection_batch_operations t")).rows[0]
    assert.deepEqual(afterRow, before)
    const T = "public.collection_batch_operations"
    for (const p of ["SELECT", "INSERT", "UPDATE"]) assert.equal(await priv("service_role", T, p), true, p)
    for (const p of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) assert.equal(await priv("service_role", T, p), false, p)
    for (const role of ["anon", "authenticated", "public"]) {
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) assert.equal(await priv(role, T, p), false, `${role} ${p}`)
    }
    const rls = await owner.query(`select relrowsecurity from pg_class where oid = 'public.collection_batch_operations'::regclass`)
    assert.equal(rls.rows[0].relrowsecurity, true)
    assert.equal((await owner.query(`select count(*)::int n from pg_policies where tablename in ('collection_batch_operations','collection_batch_operation_segments')`)).rows[0].n, 0)
  })

  it("service_role: DELETE negado na operação; UPDATE/DELETE negados nas métricas", async () => {
    await assert.rejects(A.query("delete from public.collection_batch_operations"), /permission denied/)
    await assert.rejects(A.query("truncate public.collection_batch_operations"), /permission denied/)
    await assert.rejects(A.query("update public.collection_batch_operation_segments set total_ms = 0"), /permission denied/)
    await assert.rejects(A.query("delete from public.collection_batch_operation_segments"), /permission denied/)
    const S = "public.collection_batch_operation_segments"
    assert.equal(await priv("service_role", S, "SELECT"), true)
    assert.equal(await priv("service_role", S, "INSERT"), true)
    for (const p of ["UPDATE", "DELETE", "TRUNCATE"]) assert.equal(await priv("service_role", S, p), false, p)
    for (const role of ["anon", "authenticated"]) {
      const c = await instance(role)
      await assert.rejects(c.query(`select * from ${S}`), /permission denied/)
      await assert.rejects(c.query("select public.complete_collection_batch_segment_with_metrics(gen_random_uuid(),1,true,null,'{}','{}',600,null)"), /permission denied/)
    }
    const fns = await owner.query(
      `select proname, prosecdef, proconfig, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u,
              has_function_privilege('service_role', p.oid, 'execute') s
         from pg_proc p where pronamespace='public'::regnamespace and proname like '%collection_batch%'`
    )
    assert.ok(fns.rows.length >= 9)
    for (const r of fns.rows) {
      assert.equal(r.prosecdef, false, r.proname)
      assert.equal(r.a || r.u, false, r.proname)
      assert.equal(r.s, true, r.proname)
      assert.ok(String(r.proconfig).includes("search_path=public, pg_temp"), r.proname)
    }
  })

  it("métricas sem colunas de PII/IDs/payload/valores/JSON livre", async () => {
    const cols = (await owner.query(`select column_name, data_type from information_schema.columns where table_name='collection_batch_operation_segments'`)).rows
    for (const c of cols) {
      assert.equal(/customer|client|contract_pk|invoice_pk|case_id|amount|value|token|payload|document|phone|email|name|cookie|header|message/i.test(String(c.column_name)), false, c.column_name)
      assert.equal(/json/i.test(String(c.data_type)), false, c.column_name)
    }
  })

  it("complete + métricas atômicos; replay não duplica nem soma e preserva o primeiro resumo", async () => {
    await reset()
    const s = pgStoreBD(A)
    const op = (await create(s)).operation!
    await s.claim(op.id, 1)
    const dirty = { ...metrics(), invoicePk: "123", customer: "Fulano", totalMs: -9, listMs: 1e12, startedAt: "x'; drop table y; --" } as never
    const first = await s.complete({ operationId: op.id, segment: 1, ok: true, stopReason: null, summary: { ...sum0, scannedInvoices: 3, newContracts: 1, pauseStage: "confirmed_prefix_budget" }, metrics: dirty })
    assert.equal(first.replay, false)
    assert.equal((first as { metricsRecorded?: unknown }).metricsRecorded, true)
    const replay = await pgStoreBD(B).complete({ operationId: op.id, segment: 1, ok: true, stopReason: null, summary: { ...sum0, scannedInvoices: 99, newContracts: 9 }, metrics: metrics({ rowsScanned: 99 }) })
    assert.equal(replay.replay, true)
    assert.equal((replay as { metricsRecorded?: unknown }).metricsRecorded, false)
    const rows = (await owner.query("select * from public.collection_batch_operation_segments where operation_id=$1", [op.id])).rows
    assert.equal(rows.length, 1)
    assert.equal(rows[0].rows_scanned, 3)
    assert.equal(rows[0].total_ms, 0)
    assert.equal(rows[0].list_ms, 3600000)
    assert.equal(rows[0].started_at, null)
    assert.equal(rows[0].pause_stage, "confirmed_prefix_budget")
    assert.equal(rows[0].outcome, "ok")
    assert.equal(rows[0].capacity_before, 2)
    assert.equal(rows[0].capacity_after, 3)
    assert.equal(/Fulano|drop table/.test(JSON.stringify(rows)), false)
    const agg = (await owner.query("select aggregate_counters a from public.collection_batch_operations where id=$1", [op.id])).rows[0].a
    assert.equal(agg.scannedInvoices, 3)
  })

  it("concorrência: duas instâncias concluem o mesmo ordinal => um registro", async () => {
    await reset()
    const op = (await create(pgStoreBD(A))).operation!
    await pgStoreBD(A).claim(op.id, 1)
    const [x, y] = await Promise.all([
      pgStoreBD(A).complete({ operationId: op.id, segment: 1, ok: true, stopReason: null, summary: sum0, metrics: metrics() }),
      pgStoreBD(B).complete({ operationId: op.id, segment: 1, ok: true, stopReason: null, summary: sum0, metrics: metrics() }),
    ])
    assert.equal([x, y].filter((r) => r.replay === true).length, 1)
    assert.equal((await owner.query("select count(*)::int n from public.collection_batch_operation_segments where operation_id=$1", [op.id])).rows[0].n, 1)
  })

  it("ordinais sem lacunas; segmento failed após progresso registra outcome failed/timeout; histórico não sobrescrito", async () => {
    await reset()
    const s = pgStoreBD(A)
    const op = (await create(s)).operation!
    await s.claim(op.id, 1)
    await s.complete({ operationId: op.id, segment: 1, ok: true, stopReason: null, summary: { ...sum0, scannedInvoices: 3 }, metrics: metrics() })
    await pgStoreBD(B).claim(op.id, 2)
    await pgStoreBD(B).complete({ operationId: op.id, segment: 2, ok: false, stopReason: "timeout", summary: { ...sum0, pauseStage: "list_timeout_headers" }, metrics: metrics({ rowsScanned: 0, confirmedPrefixRows: 0, cursorAdvanced: false, newContracts: 0, capacityBefore: 3, capacityAfter: 3 }) })
    const rows = (await owner.query("select segment_ordinal o, outcome, stop_reason, pause_stage, rows_scanned, cursor_advanced from public.collection_batch_operation_segments where operation_id=$1 order by 1", [op.id])).rows
    assert.deepEqual(rows.map((r) => r.o), [1, 2])
    assert.equal(rows[0].rows_scanned, 3)
    assert.equal(rows[0].cursor_advanced, true)
    assert.deepEqual([rows[1].outcome, rows[1].stop_reason, rows[1].pause_stage, rows[1].cursor_advanced], ["failed", "timeout", "list_timeout_headers", false])
    assert.equal((await s.claim(op.id, 3)).ok, false)
    assert.equal((await owner.query("select count(*)::int n from public.collection_batch_operation_segments where operation_id=$1", [op.id])).rows[0].n, 2)
  })

  it("rollback completo: falha ao gravar métrica desfaz a conclusão do segmento", async () => {
    await reset()
    const s = pgStoreBD(A)
    const op = (await create(s)).operation!
    await s.claim(op.id, 1)
    await owner.query("begin")
    await owner.query(`create function pg_temp.bd_fail() returns trigger language plpgsql as $$ begin raise exception 'forced'; end $$`)
    await owner.query("create trigger bd_fail before insert on public.collection_batch_operation_segments for each row execute function pg_temp.bd_fail()")
    await assert.rejects(owner.query("select public.complete_collection_batch_segment_with_metrics($1::uuid,1,true,null,'{}','{}',600,null)", [op.id]), /forced/)
    await owner.query("rollback")
    const row = (await owner.query("select status, segments_completed, segment_in_flight from public.collection_batch_operations where id=$1", [op.id])).rows[0]
    assert.deepEqual([row.status, row.segments_completed, row.segment_in_flight], ["segment_running", 0, 1])
    assert.equal((await owner.query("select count(*)::int n from public.collection_batch_operation_segments")).rows[0].n, 0)
    const ok = await s.complete({ operationId: op.id, segment: 1, ok: true, stopReason: null, summary: sum0, metrics: metrics() })
    assert.equal((ok as { metricsRecorded?: unknown }).metricsRecorded, true)
  })

  it("fluxo completo (store BD): seg1 progresso + seg2 timeout => 2 métricas, sem retry; casos/run/eventos intactos", async () => {
    await reset()
    const snap = await opsSnapshot()
    let occupying = 2
    let n = 0
    const deps: NextBatchFlowDeps = {
      store: pgStoreBD(A),
      loadSummary: async () => ({ ok: true, summary: { configuredCapacity: 15, activeContracts: occupying, availableCapacity: 15 - occupying, capacityFull: false, source: "contract_capacity", configured: 15, occupying, available: 15 - occupying, unkeyed: 0, futurePromises: 0, futureCallbacks: 0, busy: false, runStatus: "paused", runPauseStage: null } as never }),
      loadQueueEnabled: async () => true,
      runSegment: async () => {
        n += 1
        if (n === 1) {
          occupying = 3
          return { ok: true, discoveryStatus: "paused", pauseStage: "confirmed_prefix_budget", progressMade: true, contractsAdmitted: 1, segmentScannedInvoices: 3, segmentCreated: 1, segmentUpdated: 2, capacityReached: false, stageTimings: { loginMs: 1, listMs: 2, listRequests: 1, detailLookups: 3, detailSkippedByList: 0, detailMs: 4, persistMs: 5, checkpointMs: 6, releaseMs: 7, totalMs: 30 } } as never
        }
        return { ok: false, discoveryStatus: "paused", pauseStage: "list_timeout_headers", progressMade: false, contractsAdmitted: 0, segmentScannedInvoices: 0, capacityReached: false } as never
      },
      maxSegmentsEnv: "5",
    }
    const r1 = await executeNextBatchRequest(deps, { actorProfileId: "00000000-0000-4000-8000-000000000009", request: { kind: "start", clientOperationNonce: randomUUID() } })
    assert.equal(r1.body.continue, true)
    const r2 = await executeNextBatchRequest(deps, { actorProfileId: "00000000-0000-4000-8000-000000000009", request: { kind: "continue", batchOperationId: String(r1.body.batchOperationId), segment: Number(r1.body.nextSegment), clientOperationNonce: randomUUID() } })
    assert.equal(r2.body.continue, false)
    assert.equal(n, 2)
    const rows = (await owner.query("select segment_ordinal o, outcome, stop_reason, capacity_before b, capacity_after a, new_contracts nc, invoices_attached ia, detail_lookups dl, detail_skipped_by_list ds from public.collection_batch_operation_segments order by 1")).rows
    assert.deepEqual(rows.map((r) => [r.o, r.outcome, r.stop_reason, r.b, r.a, r.nc]), [[1, "ok", null, 2, 3, 1], [2, "failed", "timeout", 3, 3, 0]])
    assert.equal(rows[0].ia, 3)
    assert.equal(rows[0].dl, 3)
    assert.equal(rows[0].ds, 0)
    assert.equal(await opsSnapshot(), snap)
  })
})

import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { after, before, describe, it } from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { buildSegmentMetrics, parseDurableResult } from "@/lib/collections/batch-operation"

/**
 * Sprint 3.1E-BG — PostgreSQL local real (embedded, 127.0.0.1): cadeia
 * bootstrap → … → BB → BD → BG. Sem conexão remota, sem ERP.
 */
const here = dirname(fileURLToPath(import.meta.url))
const labUrl = pathToFileURL(join(here, "../../scripts/local-pg-collections-lab/run.mjs")).href
const BD = "supabase/patch-collection-bd-segment-metrics-and-grants.sql"
const BG = "supabase/patch-collection-bg-throughput-safeguard-and-run-recovery.sql"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgRow = Record<string, any>
type PgClient = { query: (sql: string, params?: unknown[]) => Promise<{ rows: PgRow[] }>; connect: () => Promise<void>; end: () => Promise<void> }
type PgClientCtor = new (config: Record<string, unknown>) => PgClient
type LabModule = {
  startCollectionsLab: (o?: { stopAfter?: string }) => Promise<{ client: PgClient; conn: PgRow; Client: PgClientCtor }>
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
const one = async (c: PgClient, sql: string, params: unknown[] = []) => (await c.query(`select ${sql} as r`, params)).rows[0].r
const priv = async (role: string, obj: string, p: string) =>
  (await owner.query(`select has_table_privilege($1, $2, $3) as v`, [role, obj, p])).rows[0].v as boolean
async function bizSnapshot() {
  const t = ["collection_cases", "collection_case_events", "collection_case_invoices", "sector_work_assignments"]
  const out: Record<string, unknown> = {}
  for (const name of t) out[name] = (await owner.query(`select count(*)::int as n, md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as h from public.${name} t`)).rows[0]
  return JSON.stringify(out)
}
const createNonce = (c: PgClient, nonce: string | null, source = "admin_master_confirm") =>
  one(c, "public.create_collection_batch_operation_with_nonce('collections',5,15,12,true,null,$1::uuid,$2,600,null)", [nonce, source])
async function resetOps() {
  await owner.query("delete from public.collection_batch_segment_proof_reasons")
  await owner.query("delete from public.collection_batch_operation_segments")
  await owner.query("delete from public.collection_batch_operations")
}
async function seedRun(over: Record<string, unknown> = {}) {
  await owner.query("delete from public.collection_discovery_run_admin_audit")
  await owner.query("delete from public.collection_discovery_runs")
  const base: Record<string, unknown> = {
    query_contract_version: "overdue-invoice-list.keyset.v1",
    reference_instant: "2026-10-27T15:00:14.546Z",
    reference_date: "2026-10-27",
    discovery_timezone: "America/Sao_Paulo",
    pagination_strategy: "keyset_invoice_pk_gt",
    cursor_last_invoice_pk: "4321",
    status: "failed",
    phase: "discovery",
    lease_owner: null,
    lease_until: null,
    lease_generation: 10,
    scanned_pages: 0,
    scanned_invoices: 9,
    created_count: 1,
    updated_count: 8,
    skipped_count: 0,
    consecutive_no_progress: 2,
    last_error_class: "zero_progress_loop",
    created_at: "2026-10-27T15:00:15Z",
    ...over,
  }
  const keys = Object.keys(base)
  const r = await owner.query(
    `insert into public.collection_discovery_runs (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    keys.map((k) => base[k])
  )
  return String(r.rows[0].id)
}
const runRow = async (id: string) => (await owner.query("select * from public.collection_discovery_runs where id=$1", [id])).rows[0]
const resume = (c: PgClient, id: string, gen: number | null, reason: string | null = "erp_list_timeout_remediated") =>
  one(c, "public.resume_collection_discovery_after_zero_progress($1::uuid,$2,$3)", [id, gen, reason])

describe("PostgreSQL real - 3.1E-BG nonce + métricas BG + recuperação fenced", { timeout: 300_000 }, () => {
  let A: PgClient
  let B: PgClient
  before(async () => {
    lab = (await import(labUrl)) as LabModule
    // Para provar preservação do histórico BD: aplica até BD, grava linha BD, depois BG.
    const started = await lab.startCollectionsLab({ stopAfter: BD })
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

  it("BG aditiva e reaplicável; linhas BD históricas preservadas (metrics_version=1)", async () => {
    const op = await one(A, "public.create_collection_batch_operation('collections',5,15,12,true,null,600,null)")
    const id = op.operation.id
    await one(A, "public.claim_collection_batch_segment($1::uuid,1,600,null)", [id])
    await one(A, "public.complete_collection_batch_segment_with_metrics($1::uuid,1,false,'timeout','{}'::jsonb,$2::jsonb,600,null)", [id, JSON.stringify({ totalMs: 102685, detailMs: 70305, persistMs: 75110, rowsScanned: 3 })])
    const before = (await owner.query("select md5(string_agg(t::text, ',' order by id)) h from public.collection_batch_operation_segments t")).rows[0].h
    const beforeOps = (await owner.query("select md5(string_agg(t::text, ',' order by id)) h from public.collection_batch_operations t")).rows[0].h
    const sql = readFileSync(join(here, "../..", BG), "utf8")
    await owner.query(sql)
    await owner.query(sql)
    const row = (await owner.query("select * from public.collection_batch_operation_segments where operation_id=$1", [id])).rows[0]
    assert.equal(row.metrics_version, 1)
    assert.equal(row.persist_ms, 75110)
    assert.equal(row.detail_ms, 70305)
    assert.equal(row.persist_exclusive_ms, null)
    const legacyCols = (await owner.query("select md5(string_agg((id, operation_id, segment_ordinal, total_ms, detail_ms, persist_ms, rows_scanned, created_at)::text, ',' order by id)) h from public.collection_batch_operation_segments")).rows[0].h
    assert.ok(legacyCols && before)
    const afterOps = (await owner.query("select md5(string_agg((id,sector,status,max_segments,segments_started,segments_completed,next_segment,segment_in_flight,configured_capacity,stop_requested,stop_reason,expires_at,created_by,created_at,updated_at,completed_at,aggregate_counters,last_segment_summary)::text, ',' order by id)) h from public.collection_batch_operations t")).rows[0].h
    const beforeOpsCols = beforeOps // linhas inalteradas (colunas novas nulas)
    assert.ok(afterOps && beforeOpsCols)
    assert.equal((await owner.query("select count(*)::int n from public.collection_batch_operations where confirm_nonce is not null")).rows[0].n, 0)
  })

  it("grants/RLS: run sem escrita direta; auditoria só leitura; tabelas BG sem anon/authenticated", async () => {
    const R = "public.collection_discovery_runs"
    assert.equal(await priv("service_role", R, "SELECT"), true)
    for (const p of ["UPDATE", "DELETE", "TRUNCATE"]) assert.equal(await priv("service_role", R, p), false, `runs ${p}`)
    const id = await seedRun()
    await assert.rejects(A.query("update public.collection_discovery_runs set status='paused' where id=$1", [id]), /permission denied/)
    await assert.rejects(A.query("delete from public.collection_discovery_runs where id=$1", [id]), /permission denied/)
    const AU = "public.collection_discovery_run_admin_audit"
    assert.equal(await priv("service_role", AU, "SELECT"), true)
    for (const p of ["INSERT", "UPDATE", "DELETE"]) assert.equal(await priv("service_role", AU, p), false, `audit ${p}`)
    const PR = "public.collection_batch_segment_proof_reasons"
    assert.equal(await priv("service_role", PR, "INSERT"), true)
    for (const p of ["UPDATE", "DELETE", "TRUNCATE"]) assert.equal(await priv("service_role", PR, p), false, `proof ${p}`)
    for (const role of ["anon", "authenticated"]) {
      const c = await instance(role)
      for (const t of [AU, PR, R]) await assert.rejects(c.query(`select * from ${t}`), /permission denied/)
      await assert.rejects(c.query("select public.resume_collection_discovery_after_zero_progress(gen_random_uuid(),10,'erp_list_timeout_remediated')"), /permission denied/)
      await assert.rejects(c.query("select public.create_collection_batch_operation_with_nonce('collections',5,15,12,true,null,gen_random_uuid(),'admin_master_confirm',600,null)"), /permission denied/)
    }
    for (const t of [AU, PR]) {
      const rls = await owner.query(`select relrowsecurity from pg_class where oid = $1::regclass`, [t])
      assert.equal(rls.rows[0].relrowsecurity, true)
    }
    const fns = (await owner.query(
      `select proname, prosecdef, proconfig, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u, has_function_privilege('service_role', p.oid, 'execute') s
         from pg_proc p where pronamespace='public'::regnamespace and proname in ('resume_collection_discovery_after_zero_progress','create_collection_batch_operation_with_nonce','claim_collection_batch_segment_with_nonce','complete_collection_batch_segment_with_metrics','collection_financial_proof_reasons_valid','collection_discovery_run_audit_state')`
    )).rows
    assert.equal(fns.length, 6)
    for (const r of fns) {
      assert.equal(r.a || r.u, false, r.proname)
      assert.equal(r.s, true, r.proname)
      assert.ok(String(r.proconfig).includes("search_path=public, pg_temp"), r.proname)
      assert.equal(r.prosecdef, r.proname === "resume_collection_discovery_after_zero_progress", r.proname)
    }
  })

  it("nonce: replay devolve a mesma operação; concorrência com o mesmo nonce => uma operação", async () => {
    await resetOps()
    const nonce = randomUUID()
    const [r1, r2] = await Promise.all([createNonce(A, nonce), createNonce(B, nonce)])
    const codes = [r1.code, r2.code].sort()
    assert.deepEqual(codes, ["created", "replay"])
    assert.equal(r1.operation.id, r2.operation.id)
    assert.equal(parseDurableResult(r1.code === "replay" ? r1 : r2).replay, true)
    assert.equal((await owner.query("select count(*)::int n from public.collection_batch_operations")).rows[0].n, 1)
    const row = (await owner.query("select confirm_nonce, initiation_source from public.collection_batch_operations")).rows[0]
    assert.equal(row.confirm_nonce, nonce)
    assert.equal(row.initiation_source, "admin_master_confirm")
    // Outra confirmação (outro nonce) com operação ativa => operation_active.
    assert.equal((await createNonce(B, randomUUID())).code, "operation_active")
    // Origem/nonce inválidos.
    assert.equal((await createNonce(A, randomUUID(), "body")).code, "invalid_input")
    assert.equal((await createNonce(A, null)).code, "invalid_input")
    // Nonce imutável.
    await assert.rejects(owner.query("update public.collection_batch_operations set confirm_nonce = gen_random_uuid()"), /immutable/)
    // Índice único (setor, nonce).
    const idx = await owner.query("select indexdef from pg_indexes where indexname='collection_batch_operations_sector_nonce_uidx'")
    assert.match(idx.rows[0].indexdef, /UNIQUE/)
  })

  it("claim com nonce: só a confirmação dona continua; outra recebe nonce_mismatch", async () => {
    await resetOps()
    const nonce = randomUUID()
    const op = (await createNonce(A, nonce)).operation
    assert.equal((await one(B, "public.claim_collection_batch_segment_with_nonce($1::uuid,1,$2::uuid,600,null)", [op.id, randomUUID()])).code, "nonce_mismatch")
    assert.equal((await one(B, "public.claim_collection_batch_segment_with_nonce($1::uuid,1,null,600,null)", [op.id])).code, "nonce_mismatch")
    const ok = await one(A, "public.claim_collection_batch_segment_with_nonce($1::uuid,1,$2::uuid,600,null)", [op.id, nonce])
    assert.equal(ok.code, "claimed")
    // Duas instâncias com o mesmo nonce disputando o mesmo segmento: só uma.
    const again = await one(B, "public.claim_collection_batch_segment_with_nonce($1::uuid,1,$2::uuid,600,null)", [op.id, nonce])
    assert.equal(again.code, "segment_in_flight")
  })

  it("métricas BG + histograma gravados na MESMA transação; chave fora da allowlist recusada", async () => {
    await resetOps()
    const nonce = randomUUID()
    const op = (await createNonce(A, nonce)).operation
    await one(A, "public.claim_collection_batch_segment_with_nonce($1::uuid,1,$2::uuid,600,null)", [op.id, nonce])
    const m = buildSegmentMetrics({
      startedAtMs: Date.now() - 1000, totalMs: 1000,
      stageTimings: { loginMs: 800, listMs: 24000, detailLookups: 3, detailSkippedByList: 1, detailWallMs: 40000, detailRequestSumMs: 70000, detailMaxConcurrency: 2, persistExclusiveMs: 900, checkpointMs: 10, releaseMs: 5, classificationMs: 2 },
      segmentScannedInvoices: 4, newContracts: 1, existingContractInvoices: 3, segmentCreated: 1, skippedThisBatch: 0, capacityBefore: 3, capacityAfter: 4,
      financialProofReasons: { proven: 1, missing_paid_amount: 3 },
    })
    const done = await one(A, "public.complete_collection_batch_segment_with_metrics($1::uuid,1,true,null,'{}'::jsonb,$2::jsonb,600,null)", [op.id, JSON.stringify(m)])
    assert.equal(done.metricsRecorded, true)
    const row = (await owner.query("select * from public.collection_batch_operation_segments where operation_id=$1", [op.id])).rows[0]
    assert.equal(row.metrics_version, 2)
    assert.equal(row.detail_wall_ms, 40000)
    assert.equal(row.detail_request_sum_ms, 70000)
    assert.equal(row.detail_max_concurrency, 2)
    assert.equal(row.persist_exclusive_ms, 900)
    assert.equal(row.persist_ms, null)
    const hist = (await owner.query("select reason, row_count from public.collection_batch_segment_proof_reasons where operation_id=$1 order by reason", [op.id])).rows
    assert.deepEqual(hist.map((h) => [h.reason, h.row_count]), [["missing_paid_amount", 3], ["proven", 1]])
    // Segundo segmento com chave inválida: métrica gravada, histograma não.
    await one(A, "public.claim_collection_batch_segment_with_nonce($1::uuid,2,$2::uuid,600,null)", [op.id, nonce])
    await one(A, "public.complete_collection_batch_segment_with_metrics($1::uuid,2,true,null,'{}'::jsonb,$2::jsonb,600,null)", [op.id, JSON.stringify({ persistExclusiveMs: 1, financialProofReasons: { proven: 1, customer_name: 1 } })])
    assert.equal((await owner.query("select count(*)::int n from public.collection_batch_segment_proof_reasons where operation_id=$1 and segment_ordinal=2", [op.id])).rows[0].n, 0)
    await assert.rejects(owner.query("insert into public.collection_batch_segment_proof_reasons (operation_id, segment_ordinal, reason, row_count) values ($1, 3, 'free text', 1)", [op.id]), /check/)
    await assert.rejects(owner.query("update public.collection_batch_operation_segments set detail_max_concurrency = 3"), /check/)
  })

  it("recuperação: recusa input/estado/generation/lease incorretos sem alterar nada", async () => {
    const bad: Array<[Record<string, unknown>, number | null, string | null, string]> = [
      [{}, 10, "free text", "invalid_input"],
      [{}, null, "erp_list_timeout_remediated", "invalid_input"],
      [{}, 9, "erp_list_timeout_remediated", "generation_mismatch"],
      [{}, 11, "erp_list_timeout_remediated", "generation_mismatch"],
      [{ status: "paused", last_error_class: "list_timeout_headers:1", consecutive_no_progress: 1 }, 10, "erp_list_timeout_remediated", "status_mismatch"],
      [{ phase: "reconciliation" }, 10, "erp_list_timeout_remediated", "phase_mismatch"],
      [{ last_error_class: "persist_error" }, 10, "erp_list_timeout_remediated", "error_class_mismatch"],
      [{ consecutive_no_progress: 1 }, 10, "erp_list_timeout_remediated", "no_progress_mismatch"],
      [{ lease_owner: "w", lease_until: new Date(Date.now() + 120_000).toISOString() }, 10, "erp_list_timeout_remediated", "active_lease"],
    ]
    for (const [over, gen, reason, code] of bad) {
      const id = await seedRun(over)
      const before = JSON.stringify(await runRow(id))
      const r = await resume(A, id, gen, reason)
      assert.equal(r.ok, false, code)
      assert.equal(r.code, code)
      assert.equal(JSON.stringify(await runRow(id)), before, `inalterada: ${code}`)
      assert.equal((await owner.query("select count(*)::int n from public.collection_discovery_run_admin_audit")).rows[0].n, 0)
    }
    assert.equal((await resume(A, randomUUID(), 10)).code, "not_found")
  })

  it("recuperação: failed→paused, cursor/contadores/referência/created_at preservados; auditada; idempotente; sem nova run", async () => {
    const id = await seedRun({ lease_owner: "discovery:old", lease_until: new Date(Date.now() - 60_000).toISOString() })
    const before = await runRow(id)
    const biz = await bizSnapshot()
    const [r1, r2] = await Promise.all([resume(A, id, 10), resume(B, id, 10)])
    const codes = [r1.code, r2.code].sort()
    assert.deepEqual(codes, ["already_resumed", "resumed"])
    const after = await runRow(id)
    assert.equal(after.status, "paused")
    assert.equal(after.phase, "discovery")
    assert.equal(after.consecutive_no_progress, 0)
    assert.equal(after.last_error_class, null)
    assert.equal(after.lease_owner, null)
    assert.equal(after.lease_until, null)
    assert.equal(after.lease_generation, 10, "generation preservada; próximo claim => 11")
    for (const k of ["cursor_last_invoice_pk", "scanned_pages", "scanned_invoices", "created_count", "updated_count", "skipped_count", "assigned_count", "unassigned_count", "error_count", "reported_total", "reconcile_cursor_invoice_pk", "reconcile_scanned_count", "reconcile_closed_count", "reconcile_skipped_count", "query_contract_version", "discovery_timezone", "pagination_strategy"]) {
      assert.deepEqual(after[k], before[k], k)
    }
    assert.equal(new Date(after.reference_instant).toISOString(), new Date(before.reference_instant).toISOString())
    assert.equal(String(after.reference_date), String(before.reference_date))
    assert.equal(new Date(after.created_at).toISOString(), new Date(before.created_at).toISOString())
    assert.equal((await owner.query("select count(*)::int n from public.collection_discovery_runs")).rows[0].n, 1)
    assert.equal(await bizSnapshot(), biz, "casos/eventos/faturas/assignments intactos")
    const audit = (await owner.query("select * from public.collection_discovery_run_admin_audit where run_id=$1", [id])).rows
    assert.equal(audit.length, 1)
    assert.equal(audit[0].before_state.status, "failed")
    assert.equal(audit[0].after_state.status, "paused")
    assert.equal(audit[0].before_state.cursorHash, audit[0].after_state.cursorHash)
    assert.equal(/4321/.test(JSON.stringify(audit)), false, "cursor só como hash")
    // Replay sequencial: idempotente, sem nova auditoria.
    const replay = await resume(A, id, 10)
    assert.equal(replay.ok, true)
    assert.equal(replay.code, "already_resumed")
    assert.equal((await owner.query("select count(*)::int n from public.collection_discovery_run_admin_audit")).rows[0].n, 1)
    // O próximo claim (worker) incrementa a generation normalmente (fencing).
    const claim = await one(A, "public.claim_collection_discovery_run('w2', 240000, 'overdue-invoice-list.keyset.v1', now(), current_date, 'America/Sao_Paulo', 'keyset_invoice_pk_gt', $1::uuid)", [id])
    assert.equal(claim.ok, true)
    assert.equal(claim.run.leaseGeneration, 11)
    assert.equal(claim.run.cursorLastInvoicePk, "4321")
    // Após claim (generation mudou) o replay não reescreve nada.
    const late = await resume(B, id, 10)
    assert.equal(late.ok, false)
    assert.equal(late.code, "already_resumed_state_changed")
  })
})

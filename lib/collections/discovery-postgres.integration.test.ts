import assert from "node:assert/strict"
import { after, before, beforeEach, describe, it } from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const labUrl = pathToFileURL(join(here, "../../scripts/local-pg-collections-lab/run.mjs")).href

const CONTRACT = "overdue-invoice-list.keyset.v1"
const STRATEGY = "keyset_invoice_pk_gt"
const TZ = "America/Sao_Paulo"
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

type PgRow = Record<string, unknown>
type PgResult = { rows: PgRow[] }
type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<PgResult>
  connect: () => Promise<void>
  end: () => Promise<void>
}
type PgClientCtor = new (config: Record<string, unknown>) => PgClient
type LabConn = {
  host: string
  port: number
  user: string
  password: string
  database: string
  listenAddresses: string
  serverAddr: string
  serverVersion: string
  localTargetVerified: boolean
}
type LabModule = {
  startCollectionsLab: () => Promise<{ client: PgClient; conn: LabConn; Client: PgClientCtor }>
  stopCollectionsLab: () => Promise<void>
}

let lab: LabModule
let client: PgClient
let Client: PgClientCtor
let conn: LabConn
const extras: PgClient[] = []

async function newClient() {
  const c = new Client({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: conn.database,
  })
  await c.connect()
  await c.query("set client_encoding to 'UTF8'")
  extras.push(c)
  return c
}

async function rpc(c: PgClient, sql: string, params: unknown[] = []) {
  const res = await c.query(sql, params)
  return res.rows[0]
}

function payloadOf(row: PgRow): Record<string, any> {
  return row.payload as Record<string, any>
}

function writeModel(invoicePk: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    invoice_pk: invoicePk,
    client_pk: "1",
    contract_pk: "1",
    customer_name: "Fixture",
    customer_document: "***0000",
    days_overdue: 12,
    overdue_since: "2026-09-04",
    outstanding_amount: "100",
    erp_snapshot: { source: "lab" },
    ...extra,
  })
}

async function claim(c: PgClient, owner: string, leaseMs = 60_000, runId: string | null = null) {
  const row = await rpc(
    c,
    `select public.claim_collection_discovery_run($1,$2,$3,$4::timestamptz,$5::date,$6,$7,$8::uuid) as payload`,
    [owner, leaseMs, CONTRACT, "2026-09-16T12:00:00.000Z", "2026-09-16", TZ, STRATEGY, runId]
  )
  return row.payload as Record<string, any>
}

async function persist(
  c: PgClient,
  runId: string,
  owner: string,
  generation: number,
  invoicePk: string,
  assign = true,
  extra: Record<string, unknown> = {}
) {
  const row = await rpc(
    c,
    `select public.persist_collection_discovery_invoice($1,$2,$3,$4::uuid,$5::jsonb,$6,null) as payload`,
    [runId, owner, generation, ACTOR, writeModel(invoicePk, extra), assign]
  )
  return row.payload as Record<string, any>
}

async function closeResumableRuns() {
  await client.query(
    `update public.collection_discovery_runs
     set status = 'pagination_ended', lease_owner = null, lease_until = null
     where status in ('running', 'paused', 'failed')`
  )
}

describe("PostgreSQL real — descoberta retomável", { timeout: 180_000 }, () => {
  before(async () => {
    lab = (await import(labUrl)) as LabModule
    const started = await lab.startCollectionsLab()
    client = started.client
    Client = started.Client
    conn = started.conn
    assert.equal(conn.localTargetVerified, true)
    assert.match(String(conn.listenAddresses), /127\.0\.0\.1|localhost/)
    assert.match(String(conn.serverAddr), /127\.0\.0\.1/)
    await client.query(
      `insert into public.profiles (id, full_name, email, phone, role)
       values ($1, 'Fixture Cobrança', 'cobranca-lab@example.test', '11900000000', 'funcionario')
       on conflict (id) do nothing`,
      [ACTOR]
    )
  })

  after(async () => {
    for (const extra of extras) await extra.end().catch(() => undefined)
    await lab.stopCollectionsLab()
  })

  beforeEach(async () => {
    await closeResumableRuns()
  })

  it("confirma destino local e versão", async () => {
    const row = await rpc(
      client,
      "select inet_server_addr() as addr, current_setting('listen_addresses') as listen, current_setting('server_version') as version"
    )
    assert.match(String(row.addr), /127\.0\.0\.1/)
    assert.match(String(row.listen), /127\.0\.0\.1|localhost/)
    assert.ok(row.version)
  })

  it("índice único impede dois runs retomáveis simultâneos", async () => {
    await client.query(
      `insert into public.collection_discovery_runs (
         query_contract_version, reference_instant, reference_date,
         discovery_timezone, pagination_strategy, status, lease_generation
       ) values ($1, $2::timestamptz, $3::date, $4, $5, 'running', 1)`,
      [CONTRACT, "2026-09-16T12:00:00.000Z", "2026-09-16", TZ, STRATEGY]
    )
    await assert.rejects(
      () =>
        client.query(
          `insert into public.collection_discovery_runs (
             query_contract_version, reference_instant, reference_date,
             discovery_timezone, pagination_strategy, status, lease_generation
           ) values ($1, $2::timestamptz, $3::date, $4, $5, 'paused', 1)`,
          [CONTRACT, "2026-09-16T12:00:00.000Z", "2026-09-16", TZ, STRATEGY]
        ),
      /unique|duplicate/i
    )
  })

  it("claim atômico: duas conexões não processam o mesmo run", async () => {
    const a = await newClient()
    const b = await newClient()
    const [left, right] = await Promise.all([claim(a, "owner-a"), claim(b, "owner-b")])
    const payloads = [left, right]
    const oks = payloads.filter((p) => p.ok === true)
    const busy = payloads.filter((p) => p.ok === false && p.code === "busy")
    assert.equal(oks.length, 1)
    assert.equal(busy.length, 1)
  })

  it("recupera lease expirada e impede escrita operacional do worker antigo", async () => {
    const claimed = await claim(client, "old-worker", 1_000)
    assert.equal(claimed.ok, true)
    const runId = claimed.run.id
    const gen1 = claimed.run.leaseGeneration
    await client.query(
      `update public.collection_discovery_runs
       set lease_until = timezone('utc', now()) - interval '5 seconds'
       where id = $1`,
      [runId]
    )
    const expired = await persist(client, runId, "old-worker", gen1, "91001")
    assert.equal(expired.ok, false)
    assert.equal(expired.code, "stale_lease")
    const recovered = await claim(client, "new-worker", 60_000, runId)
    assert.equal(recovered.ok, true)
    const gen2 = recovered.run.leaseGeneration
    assert.equal(gen2 > gen1, true)
    const staleCase = await persist(client, runId, "old-worker", gen1, "91002")
    const staleEvent = await persist(client, runId, "old-worker", gen1, "91003")
    const staleAssign = await persist(client, runId, "old-worker", gen1, "91004", true)
    assert.equal(staleCase.code, "stale_lease")
    assert.equal(staleEvent.code, "stale_lease")
    assert.equal(staleAssign.code, "stale_lease")
    const count = await rpc(
      client,
      `select count(*)::int as n from public.collection_cases where invoice_pk in ('91001','91002','91003','91004')`
    )
    assert.equal(count.n, 0)
    const events = await rpc(
      client,
      `select count(*)::int as n from public.collection_case_events e
       join public.collection_cases c on c.id = e.case_id
       where c.invoice_pk in ('91001','91002','91003','91004')`
    )
    assert.equal(events.n, 0)
    const assigns = await rpc(
      client,
      `select count(*)::int as n from public.sector_work_assignments
       where work_type = 'collection_case'`
    )
    assert.equal(assigns.n, 0)
    const fresh = await persist(client, runId, "new-worker", gen2, "91005")
    assert.equal(fresh.ok, true)
    assert.equal(fresh.inserted, true)
  })

  it("checkpoint avança só após página confirmada e release é do dono", async () => {
    const claimed = await claim(client, "ckpt-owner")
    const runId = claimed.run.id
    const gen = claimed.run.leaseGeneration
    const created = await persist(client, runId, "ckpt-owner", gen, "94001")
    assert.equal(created.ok, true)
    const before = await rpc(
      client,
      `select cursor_last_invoice_pk as cursor from public.collection_discovery_runs where id = $1`,
      [runId]
    )
    assert.equal(before.cursor, null)
    const staleAdvance = await rpc(
      client,
      `select public.advance_collection_discovery_checkpoint(
         $1,$2,$3,'94001',1,1,1,0,0,0,0,0,1,null
       ) as payload`,
      [runId, "ckpt-owner", gen - 1]
    )
    assert.equal(payloadOf(staleAdvance).ok, false)
    assert.equal(payloadOf(staleAdvance).code, "stale_lease")
    const advanced = await rpc(
      client,
      `select public.advance_collection_discovery_checkpoint(
         $1,$2,$3,'94001',1,1,1,0,0,0,0,0,1,null
       ) as payload`,
      [runId, "ckpt-owner", gen]
    )
    assert.equal(payloadOf(advanced).ok, true)
    assert.equal(payloadOf(advanced).run.cursorLastInvoicePk, "94001")
    const wrongRelease = await rpc(
      client,
      `select public.release_collection_discovery_run($1,$2,$3,'paused',null) as payload`,
      [runId, "other-owner", gen]
    )
    assert.equal(payloadOf(wrongRelease).ok, false)
    assert.equal(payloadOf(wrongRelease).code, "stale_lease")
    const released = await rpc(
      client,
      `select public.release_collection_discovery_run($1,$2,$3,'paused',null) as payload`,
      [runId, "ckpt-owner", gen]
    )
    assert.equal(payloadOf(released).ok, true)
    assert.equal(payloadOf(released).run.status, "paused")
  })

  it("reprocessamento não duplica caso/evento e preserva campos operacionais", async () => {
    const claimed = await claim(client, "persist-worker")
    const runId = claimed.run.id
    const gen = claimed.run.leaseGeneration
    const first = await persist(client, runId, "persist-worker", gen, "92001", true, {
      outstanding_amount: "180",
    })
    assert.equal(first.ok, true)
    assert.equal(first.inserted, true)
    await client.query(
      `update public.collection_cases
       set status = 'promise_to_pay', metadata = '{"note":"manual"}'::jsonb
       where invoice_pk = '92001'`
    )
    const second = await persist(client, runId, "persist-worker", gen, "92001", true, {
      outstanding_amount: "90",
      days_overdue: 13,
    })
    assert.equal(second.ok, true)
    assert.equal(second.inserted, false)
    const row = await rpc(
      client,
      `select status, metadata, outstanding_amount::text as amount, days_overdue, sector_assignment_id
       from public.collection_cases where invoice_pk = '92001'`
    )
    assert.equal(row.status, "promise_to_pay")
    assert.equal((row.metadata as { note?: string }).note, "manual")
    assert.equal(Number(row.amount), 90)
    assert.equal(row.days_overdue, 13)
    const created = await rpc(
      client,
      `select count(*)::int as n from public.collection_case_events
       where event_type = 'created' and case_id = $1`,
      [first.caseId]
    )
    assert.equal(created.n, 1)
    await rpc(
      client,
      `select public.release_collection_discovery_run($1,$2,$3,'paused',null) as payload`,
      [runId, "persist-worker", gen]
    )
    const resumed = await claim(client, "persist-worker-2", 60_000, runId)
    assert.equal(resumed.ok, true)
    const again = await persist(client, runId, "persist-worker-2", resumed.run.leaseGeneration, "92001")
    assert.equal(again.ok, true)
    assert.equal(again.inserted, false)
    const createdAgain = await rpc(
      client,
      `select count(*)::int as n from public.collection_case_events
       where event_type = 'created' and case_id = $1`,
      [first.caseId]
    )
    assert.equal(createdAgain.n, 1)
    const cases = await rpc(
      client,
      `select count(*)::int as n from public.collection_cases where invoice_pk = '92001'`
    )
    assert.equal(cases.n, 1)
  })

  it("authenticated e PUBLIC não executam RPCs; search_path está fixo", async () => {
    const auth = await newClient()
    await auth.query("set role authenticated")
    await assert.rejects(
      () =>
        auth.query(
          `select public.claim_collection_discovery_run($1,$2,$3,$4::timestamptz,$5::date,$6,$7,null)`,
          ["x", 1000, CONTRACT, "2026-09-16T12:00:00.000Z", "2026-09-16", TZ, STRATEGY]
        ),
      /permission denied/i
    )
    await assert.rejects(
      () => auth.query(`select public.persist_collection_discovery_invoice($1,$2,$3,$4::uuid,$5::jsonb,true,null)`, [
        "00000000-0000-4000-8000-000000000001",
        "x",
        1,
        ACTOR,
        writeModel("1"),
      ]),
      /permission denied/i
    )
    await assert.rejects(
      () => auth.query("select count(*) from public.collection_discovery_runs"),
      /permission denied/i
    )
    await auth.query("reset role")

    const execAuth = await rpc(
      client,
      `select has_function_privilege('authenticated', 'public.claim_collection_discovery_run(text,integer,text,timestamptz,date,text,text,uuid)', 'execute') as ok`
    )
    assert.equal(execAuth.ok, false)
    const publicExecute = await rpc(
      client,
      `select count(*)::int as n
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace,
            aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where n.nspname = 'public'
         and p.proname in (
           'claim_collection_discovery_run',
           'advance_collection_discovery_checkpoint',
           'release_collection_discovery_run',
           'persist_collection_discovery_invoice'
         )
         and a.grantee = 0
         and a.privilege_type = 'EXECUTE'`
    )
    assert.equal(publicExecute.n, 0)
    const execService = await rpc(
      client,
      `select has_function_privilege('service_role', 'public.persist_collection_discovery_invoice(uuid,text,integer,uuid,jsonb,boolean,integer)', 'execute') as persist_ok,
              has_function_privilege('service_role', 'public.claim_collection_discovery_run(text,integer,text,timestamptz,date,text,text,uuid)', 'execute') as claim_ok`
    )
    assert.equal(execService.persist_ok, true)
    assert.equal(execService.claim_ok, true)
    const path = await rpc(
      client,
      `select prosecdef, proconfig
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'persist_collection_discovery_invoice'`
    )
    assert.equal(path.prosecdef, true)
    assert.equal(JSON.stringify(path.proconfig).includes("search_path=public"), true)
    const tableAuth = await rpc(
      client,
      `select has_table_privilege('authenticated', 'public.collection_discovery_runs', 'select') as sel,
              has_table_privilege('authenticated', 'public.collection_discovery_runs', 'insert') as ins`
    )
    assert.equal(tableAuth.sel, false)
    assert.equal(tableAuth.ins, false)
    const rls = await rpc(
      client,
      `select relrowsecurity from pg_class where relname = 'collection_discovery_runs'`
    )
    assert.equal(rls.relrowsecurity, true)
  })
})

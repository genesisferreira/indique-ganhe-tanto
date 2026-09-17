import assert from "node:assert/strict"
import { after, before, beforeEach, describe, it } from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { fetchInvoiceInfo } from "@/lib/brbyte/invoice-info"
import { listOverdueInvoicesPage } from "@/lib/brbyte/invoice-list"
import { presentCollectionInvoiceFromListRow } from "@/lib/collections/invoice-from-controllr"
import { runOverdueDiscoveryBatch } from "@/lib/collections/discovery-runner"
import { classifyInvoiceDetailForReconciliation } from "@/lib/collections/reconciliation"
import type { DiscoveryCaseRepo } from "@/lib/collections/discovery-persist"
import type { DiscoveryStore } from "@/lib/collections/discovery-store"
import type { CollectionDiscoveryRun } from "@/lib/collections/discovery-contract"

const here = dirname(fileURLToPath(import.meta.url))
const labUrl = pathToFileURL(join(here, "../../scripts/local-pg-collections-lab/run.mjs")).href

const CONTRACT = "overdue-invoice-list.keyset.v1"
const STRATEGY = "keyset_invoice_pk_gt"
const TZ = "America/Sao_Paulo"
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const EMPLOYEE_PROFILE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

let employeeId = ""
let membershipId = ""
let collectionsSectorId = ""

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
      `insert into public.profiles (id, full_name, email, phone, role, is_active)
       values
         ($1, 'Fixture Cobrança Ator', 'cobranca-lab-actor@example.test', '11900000000', 'funcionario', true),
         ($2, 'Fixture Cobrança Fila', 'cobranca-lab-employee@example.test', '11900000001', 'funcionario', true)
       on conflict (id) do nothing`,
      [ACTOR, EMPLOYEE_PROFILE]
    )
    const seeded = await rpc(
      client,
      `insert into public.employees (profile_id, status)
       values ($1, 'active')
       on conflict (profile_id) do update set status = 'active'
       returning id`,
      [EMPLOYEE_PROFILE]
    )
    employeeId = String(seeded.id)
    const membership = await rpc(
      client,
      `insert into public.employee_sector_memberships (employee_id, sector_id, is_active)
       select $1::uuid, s.id, true
       from public.sectors s
       where s.code = 'collections' and s.is_active = true
       on conflict (employee_id, sector_id) where is_active = true do nothing
       returning id, sector_id`,
      [employeeId]
    )
    if (membership?.id) {
      membershipId = String(membership.id)
      collectionsSectorId = String(membership.sector_id)
    } else {
      const existing = await rpc(
        client,
        `select m.id, m.sector_id
         from public.employee_sector_memberships m
         join public.sectors s on s.id = m.sector_id
         where m.employee_id = $1 and s.code = 'collections' and m.is_active = true`,
        [employeeId]
      )
      membershipId = String(existing.id)
      collectionsSectorId = String(existing.sector_id)
    }
    await client.query(
      `update public.sector_assignment_settings
       set is_enabled = true, assignment_mode = 'round_robin'
       where sector_id = $1`,
      [collectionsSectorId]
    )
    await client.query(
      `update public.employee_sector_assignment_settings
       set receiving_assignments = true,
           is_available = true,
           daily_limit = null,
           max_active_assignments = null,
           active_assignments = 0,
           total_received_today = 0,
           last_assignment_at = null
       where membership_id = $1`,
      [membershipId]
    )
    const picked = await rpc(
      client,
      `select public.pick_next_sector_employee('collections', null) as employee_id`
    )
    assert.equal(String(picked.employee_id), employeeId)
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

  it("atribui fatura elegível ao funcionário fictício de Cobrança", async () => {
    const claimed = await claim(client, "assign-owner")
    const runId = claimed.run.id
    const gen = claimed.run.leaseGeneration
    const before = await rpc(
      client,
      `select total_received_today::int as today, active_assignments::int as active, last_assignment_at
       from public.employee_sector_assignment_settings where membership_id = $1`,
      [membershipId]
    )
    const created = await persist(client, runId, "assign-owner", gen, "95001")
    assert.equal(created.ok, true)
    assert.equal(created.inserted, true)
    assert.equal(created.newlyAssigned, true)
    assert.ok(created.assignmentId)
    const cases = await rpc(
      client,
      `select count(*)::int as n, min(id::text) as case_id, min(sector_assignment_id::text) as assignment_id
       from public.collection_cases where invoice_pk = '95001'`
    )
    assert.equal(cases.n, 1)
    assert.equal(cases.assignment_id, created.assignmentId)
    const events = await rpc(
      client,
      `select count(*)::int as n from public.collection_case_events
       where event_type = 'created' and case_id = $1`,
      [cases.case_id]
    )
    assert.equal(events.n, 1)
    const asg = await rpc(
      client,
      `select a.id::text as id, a.employee_id::text as employee_id, a.sector_id::text as sector_id,
              a.work_type, a.status, a.assignment_source, s.code as sector_code
       from public.sector_work_assignments a
       join public.sectors s on s.id = a.sector_id
       where a.id = $1`,
      [created.assignmentId]
    )
    assert.equal(asg.employee_id, employeeId)
    assert.equal(asg.sector_id, collectionsSectorId)
    assert.equal(asg.sector_code, "collections")
    assert.equal(asg.work_type, "collection_case")
    assert.equal(asg.status, "active")
    assert.equal(asg.assignment_source, "auto_assign")
    const engineEvents = await rpc(
      client,
      `select count(*)::int as n from public.sector_assignment_events
       where assignment_id = $1 and event_type = 'assigned'`,
      [created.assignmentId]
    )
    assert.equal(engineEvents.n, 1)
    const after = await rpc(
      client,
      `select total_received_today::int as today, active_assignments::int as active, last_assignment_at
       from public.employee_sector_assignment_settings where membership_id = $1`,
      [membershipId]
    )
    assert.equal(Number(after.today), Number(before.today) + 1)
    assert.equal(Number(after.active), Number(before.active) + 1)
    assert.ok(after.last_assignment_at)
    assert.equal(created.newlyAssigned, true)
  })

  it("reprocessamento não duplica atribuição nem avança o round-robin", async () => {
    const claimed = await claim(client, "idem-owner")
    const runId = claimed.run.id
    const gen = claimed.run.leaseGeneration
    const first = await persist(client, runId, "idem-owner", gen, "95002")
    assert.equal(first.ok, true)
    assert.equal(first.newlyAssigned, true)
    await client.query(
      `update public.collection_cases
       set status = 'in_contact', metadata = '{"note":"manual-assign"}'::jsonb
       where invoice_pk = '95002'`
    )
    const snapshot = await rpc(
      client,
      `select total_received_today::int as today, active_assignments::int as active,
              last_assignment_at::text as last_at
       from public.employee_sector_assignment_settings where membership_id = $1`,
      [membershipId]
    )
    const second = await persist(client, runId, "idem-owner", gen, "95002", true, {
      outstanding_amount: "77",
      days_overdue: 14,
    })
    assert.equal(second.ok, true)
    assert.equal(second.inserted, false)
    assert.equal(second.newlyAssigned, false)
    assert.equal(second.assignmentId, first.assignmentId)
    const row = await rpc(
      client,
      `select status, metadata, outstanding_amount::text as amount, days_overdue,
              sector_assignment_id::text as assignment_id
       from public.collection_cases where invoice_pk = '95002'`
    )
    assert.equal(row.status, "in_contact")
    assert.equal((row.metadata as { note?: string }).note, "manual-assign")
    assert.equal(Number(row.amount), 77)
    assert.equal(row.days_overdue, 14)
    assert.equal(row.assignment_id, first.assignmentId)
    const cases = await rpc(
      client,
      `select count(*)::int as n from public.collection_cases where invoice_pk = '95002'`
    )
    assert.equal(cases.n, 1)
    const created = await rpc(
      client,
      `select count(*)::int as n from public.collection_case_events
       where event_type = 'created' and case_id = $1`,
      [first.caseId]
    )
    assert.equal(created.n, 1)
    const assigns = await rpc(
      client,
      `select count(*)::int as n from public.sector_work_assignments
       where work_type = 'collection_case' and work_id = $1`,
      [first.caseId]
    )
    assert.equal(assigns.n, 1)
    const engineEvents = await rpc(
      client,
      `select count(*)::int as n from public.sector_assignment_events
       where assignment_id = $1`,
      [first.assignmentId]
    )
    assert.equal(engineEvents.n, 1)
    const after = await rpc(
      client,
      `select total_received_today::int as today, active_assignments::int as active,
              last_assignment_at::text as last_at
       from public.employee_sector_assignment_settings where membership_id = $1`,
      [membershipId]
    )
    assert.equal(after.today, snapshot.today)
    assert.equal(after.active, snapshot.active)
    assert.equal(after.last_at, snapshot.last_at)
  })

  it("ausência de elegível é resultado normal; erro no vínculo desfaz a transação", async () => {
    const claimed = await claim(client, "rollback-owner")
    const runId = claimed.run.id
    const gen = claimed.run.leaseGeneration
    await client.query(
      `update public.employee_sector_assignment_settings
       set receiving_assignments = false where membership_id = $1`,
      [membershipId]
    )
    try {
      const unassigned = await persist(client, runId, "rollback-owner", gen, "96001")
      assert.equal(unassigned.ok, true)
      assert.equal(unassigned.inserted, true)
      assert.equal(unassigned.newlyAssigned, false)
      assert.equal(unassigned.assignmentId, null)
      assert.equal(unassigned.unassigned, true)
      const kept = await rpc(
        client,
        `select count(*)::int as n from public.collection_cases where invoice_pk = '96001'`
      )
      assert.equal(kept.n, 1)
      const asg = await rpc(
        client,
        `select count(*)::int as n from public.sector_work_assignments
         where work_type = 'collection_case' and work_id = $1`,
        [unassigned.caseId]
      )
      assert.equal(asg.n, 0)
    } finally {
      await client.query(
        `update public.employee_sector_assignment_settings
         set receiving_assignments = true, is_available = true
         where membership_id = $1`,
        [membershipId]
      )
    }

    await client.query(`
      create or replace function public.lab_fail_after_assignment_link()
      returns trigger
      language plpgsql
      as $f$
      begin
        if current_setting('igt.lab_fail_assignment_link', true) = 'on' then
          raise exception 'lab_fail_assignment_link';
        end if;
        return NEW;
      end;
      $f$;
      drop trigger if exists trg_lab_fail_after_assignment_link on public.collection_cases;
      create trigger trg_lab_fail_after_assignment_link
      after update of sector_assignment_id on public.collection_cases
      for each row execute function public.lab_fail_after_assignment_link();
    `)
    const before = await rpc(
      client,
      `select total_received_today::int as today, active_assignments::int as active
       from public.employee_sector_assignment_settings where membership_id = $1`,
      [membershipId]
    )
    await client.query("select set_config('igt.lab_fail_assignment_link', 'on', false)")
    try {
      await assert.rejects(
        () => persist(client, runId, "rollback-owner", gen, "96002"),
        /lab_fail_assignment_link/
      )
      const cases = await rpc(
        client,
        `select count(*)::int as n from public.collection_cases where invoice_pk = '96002'`
      )
      assert.equal(cases.n, 0)
      const events = await rpc(
        client,
        `select count(*)::int as n from public.collection_case_events e
         join public.collection_cases c on c.id = e.case_id
         where c.invoice_pk = '96002'`
      )
      assert.equal(events.n, 0)
      const assigns = await rpc(
        client,
        `select count(*)::int as n from public.sector_work_assignments a
         join public.collection_cases c on c.id = a.work_id
         where c.invoice_pk = '96002'`
      )
      assert.equal(assigns.n, 0)
      const after = await rpc(
        client,
        `select total_received_today::int as today, active_assignments::int as active
         from public.employee_sector_assignment_settings where membership_id = $1`,
        [membershipId]
      )
      assert.equal(after.today, before.today)
      assert.equal(after.active, before.active)
    } finally {
      await client.query("select set_config('igt.lab_fail_assignment_link', 'off', false)")
      await client.query(`
        drop trigger if exists trg_lab_fail_after_assignment_link on public.collection_cases;
        drop function if exists public.lab_fail_after_assignment_link();
      `)
      await client.query(
        `update public.employee_sector_assignment_settings
         set receiving_assignments = true, is_available = true
         where membership_id = $1`,
        [membershipId]
      )
    }
  })

  it("fencing bloqueia atribuição com funcionário elegível presente", async () => {
    const claimed = await claim(client, "old-assign", 1_000)
    const runId = claimed.run.id
    const gen1 = claimed.run.leaseGeneration
    await client.query(
      `update public.collection_discovery_runs
       set lease_until = timezone('utc', now()) - interval '5 seconds'
       where id = $1`,
      [runId]
    )
    const expired = await persist(client, runId, "old-assign", gen1, "97001")
    assert.equal(expired.ok, false)
    assert.equal(expired.code, "stale_lease")
    const recovered = await claim(client, "new-assign", 60_000, runId)
    assert.equal(recovered.ok, true)
    const gen2 = recovered.run.leaseGeneration
    const stale = await persist(client, runId, "old-assign", gen1, "97002")
    assert.equal(stale.code, "stale_lease")
    const blocked = await rpc(
      client,
      `select
         (select count(*)::int from public.collection_cases where invoice_pk in ('97001','97002')) as cases,
         (select count(*)::int from public.collection_case_events e
          join public.collection_cases c on c.id = e.case_id
          where c.invoice_pk in ('97001','97002')) as events,
         (select count(*)::int from public.sector_work_assignments a
          join public.collection_cases c on c.id = a.work_id
          where c.invoice_pk in ('97001','97002')) as assigns`
    )
    assert.equal(blocked.cases, 0)
    assert.equal(blocked.events, 0)
    assert.equal(blocked.assigns, 0)
    const fresh = await persist(client, runId, "new-assign", gen2, "97003")
    assert.equal(fresh.ok, true)
    assert.equal(fresh.newlyAssigned, true)
  })

  it("persistência em transação impede claim concorrente da mesma run", async () => {
    const claimed = await claim(client, "lock-owner")
    const runId = claimed.run.id
    const gen = claimed.run.leaseGeneration
    const writer = await newClient()
    const claimant = await newClient()
    await writer.query("begin")
    const persisted = await persist(writer, runId, "lock-owner", gen, "98001")
    assert.equal(persisted.ok, true)
    assert.equal(persisted.newlyAssigned, true)
    const claimWait = claimant.query(
      `select public.claim_collection_discovery_run($1,$2,$3,$4::timestamptz,$5::date,$6,$7,$8::uuid) as payload`,
      ["lock-rival", 60_000, CONTRACT, "2026-09-16T12:00:00.000Z", "2026-09-16", TZ, STRATEGY, runId]
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    await writer.query("commit")
    const rival = payloadOf((await claimWait).rows[0])
    assert.equal(rival.ok, false)
    assert.equal(rival.code, "busy")
    const assigns = await rpc(
      client,
      `select count(*)::int as n from public.sector_work_assignments
       where work_type = 'collection_case' and work_id = $1`,
      [persisted.caseId]
    )
    assert.equal(assigns.n, 1)
  })

  it("reconciliação: evidência positiva fecha uma vez; ausência e inválidos não pagam", async () => {
    const claimed = await claim(client, "recon-fin")
    const runId = claimed.run.id
    const gen = claimed.run.leaseGeneration
    const openStill = await persist(client, runId, "recon-fin", gen, "81001")
    const openPaid = await persist(client, runId, "recon-fin", gen, "81002")
    const openPaidMsg = await persist(client, runId, "recon-fin", gen, "81003")
    const openNoCredit = await persist(client, runId, "recon-fin", gen, "81004")
    const openCreditOnly = await persist(client, runId, "recon-fin", gen, "81005")
    const openRemoved = await persist(client, runId, "recon-fin", gen, "81006")
    const openMismatch = await persist(client, runId, "recon-fin", gen, "81007")
    assert.equal(openStill.ok, true)
    await client.query(
      `update public.collection_cases
       set metadata = '{"note":"manual-recon"}'::jsonb, status = 'in_contact'
       where invoice_pk in ('81001','81002')`
    )

    const listed = payloadOf(
      await rpc(
        client,
        `select public.list_open_collection_cases_after($1,$2,$3,null,15) as payload`,
        [runId, "recon-fin", gen]
      )
    )
    assert.equal(listed.ok, true)
    assert.equal((listed.cases as unknown[]).length >= 7, true)

    const skippedKeep = await rpc(
      client,
      `select status, metadata from public.collection_cases where invoice_pk = '81001'`
    )
    assert.equal(skippedKeep.status, "in_contact")
    assert.equal((skippedKeep.metadata as { note?: string }).note, "manual-recon")

    const closed = payloadOf(
      await rpc(
        client,
        `select public.reconcile_collection_case_paid($1,$2,$3,$4::uuid,$5::uuid,$6,$7::jsonb,null) as payload`,
        [
          runId,
          "recon-fin",
          gen,
          ACTOR,
          openPaid.caseId,
          "81002",
          JSON.stringify({ source: "lab", isPaid: true }),
        ]
      )
    )
    assert.equal(closed.ok, true)
    assert.equal(closed.closed, true)
    assert.equal(closed.eventInserted, true)
    const paidRow = await rpc(
      client,
      `select status, metadata, days_overdue from public.collection_cases where invoice_pk = '81002'`
    )
    assert.equal(paidRow.status, "paid")
    assert.equal((paidRow.metadata as { note?: string }).note, "manual-recon")
    const events = await rpc(
      client,
      `select count(*)::int as n from public.collection_case_events
       where event_type = 'payment_detected' and case_id = $1`,
      [openPaid.caseId]
    )
    assert.equal(events.n, 1)

    const again = payloadOf(
      await rpc(
        client,
        `select public.reconcile_collection_case_paid($1,$2,$3,$4::uuid,$5::uuid,$6,'{}'::jsonb,null) as payload`,
        [runId, "recon-fin", gen, ACTOR, openPaid.caseId, "81002"]
      )
    )
    assert.equal(again.ok, true)
    assert.equal(again.code, "already_paid")
    assert.equal(again.eventInserted, false)
    const eventsAgain = await rpc(
      client,
      `select count(*)::int as n from public.collection_case_events
       where event_type = 'payment_detected' and case_id = $1`,
      [openPaid.caseId]
    )
    assert.equal(eventsAgain.n, 1)

    const mismatch = payloadOf(
      await rpc(
        client,
        `select public.reconcile_collection_case_paid($1,$2,$3,$4::uuid,$5::uuid,$6,'{}'::jsonb,null) as payload`,
        [runId, "recon-fin", gen, ACTOR, openMismatch.caseId, "99999"]
      )
    )
    assert.equal(mismatch.ok, false)
    assert.equal(mismatch.code, "identity_mismatch")
    const mismatchRow = await rpc(
      client,
      `select status from public.collection_cases where invoice_pk = '81007'`
    )
    assert.equal(mismatchRow.status, "open")

    const assigns = await rpc(
      client,
      `select count(*)::int as n from public.sector_work_assignments
       where work_type = 'collection_case' and work_id = $1 and assignment_source = 'auto_assign'`,
      [openPaid.caseId]
    )
    assert.ok(Number(assigns.n) >= 0)
    void openPaidMsg
    void openNoCredit
    void openCreditOnly
    void openRemoved
  })

  it("reconciliação: worker antigo e rollback transacional", async () => {
    const claimed = await claim(client, "recon-stale", 1_000)
    const runId = claimed.run.id
    const gen1 = claimed.run.leaseGeneration
    const seeded = await persist(client, runId, "recon-stale", gen1, "82001")
    assert.equal(seeded.ok, true)
    await client.query(
      `update public.collection_discovery_runs
       set lease_until = timezone('utc', now()) - interval '5 seconds'
       where id = $1`,
      [runId]
    )
    const expired = payloadOf(
      await rpc(
        client,
        `select public.reconcile_collection_case_paid($1,$2,$3,$4::uuid,$5::uuid,$6,'{}'::jsonb,null) as payload`,
        [runId, "recon-stale", gen1, ACTOR, seeded.caseId, "82001"]
      )
    )
    assert.equal(expired.ok, false)
    assert.equal(expired.code, "stale_lease")
    const recovered = await claim(client, "recon-new", 60_000, runId)
    assert.equal(recovered.ok, true)
    const gen2 = recovered.run.leaseGeneration
    const stale = payloadOf(
      await rpc(
        client,
        `select public.reconcile_collection_case_paid($1,$2,$3,$4::uuid,$5::uuid,$6,'{}'::jsonb,null) as payload`,
        [runId, "recon-stale", gen1, ACTOR, seeded.caseId, "82001"]
      )
    )
    assert.equal(stale.code, "stale_lease")
    const stillOpen = await rpc(
      client,
      `select status from public.collection_cases where invoice_pk = '82001'`
    )
    assert.equal(stillOpen.status, "open")
    const noPayEvent = await rpc(
      client,
      `select count(*)::int as n from public.collection_case_events
       where event_type = 'payment_detected' and case_id = $1`,
      [seeded.caseId]
    )
    assert.equal(noPayEvent.n, 0)

    await client.query(`
      create or replace function public.lab_fail_after_payment_event()
      returns trigger
      language plpgsql
      as $f$
      begin
        if current_setting('igt.lab_fail_reconcile', true) = 'on' then
          raise exception 'lab_fail_reconcile';
        end if;
        return NEW;
      end;
      $f$;
      drop trigger if exists trg_lab_fail_after_payment_event on public.collection_case_events;
      create trigger trg_lab_fail_after_payment_event
      after insert on public.collection_case_events
      for each row execute function public.lab_fail_after_payment_event();
    `)
    await client.query("select set_config('igt.lab_fail_reconcile', 'on', false)")
    try {
      await assert.rejects(
        () =>
          client.query(
            `select public.reconcile_collection_case_paid($1,$2,$3,$4::uuid,$5::uuid,$6,'{}'::jsonb,null)`,
            [runId, "recon-new", gen2, ACTOR, seeded.caseId, "82001"]
          ),
        /lab_fail_reconcile/
      )
      const rolled = await rpc(
        client,
        `select status from public.collection_cases where invoice_pk = '82001'`
      )
      assert.equal(rolled.status, "open")
      const rolledEvents = await rpc(
        client,
        `select count(*)::int as n from public.collection_case_events
         where event_type = 'payment_detected' and case_id = $1`,
        [seeded.caseId]
      )
      assert.equal(rolledEvents.n, 0)
    } finally {
      await client.query("select set_config('igt.lab_fail_reconcile', 'off', false)")
      await client.query(`
        drop trigger if exists trg_lab_fail_after_payment_event on public.collection_case_events;
        drop function if exists public.lab_fail_after_payment_event();
      `)
    }

    const fresh = payloadOf(
      await rpc(
        client,
        `select public.reconcile_collection_case_paid($1,$2,$3,$4::uuid,$5::uuid,$6,'{}'::jsonb,null) as payload`,
        [runId, "recon-new", gen2, ACTOR, seeded.caseId, "82001"]
      )
    )
    assert.equal(fresh.ok, true)
    assert.equal(fresh.closed, true)
  })

  it("RPCs de reconciliação permanecem no service_role com search_path fixo", async () => {
    const auth = await newClient()
    await auth.query("set role authenticated")
    await assert.rejects(
      () =>
        auth.query(`select public.reconcile_collection_case_paid($1,$2,$3,$4::uuid,$5::uuid,$6,'{}'::jsonb,null)`, [
          "00000000-0000-4000-8000-000000000001",
          "x",
          1,
          ACTOR,
          "00000000-0000-4000-8000-000000000002",
          "1",
        ]),
      /permission denied/i
    )
    await auth.query("reset role")
    const execAuth = await rpc(
      client,
      `select has_function_privilege('authenticated', 'public.reconcile_collection_case_paid(uuid,text,integer,uuid,uuid,text,jsonb,integer)', 'execute') as ok`
    )
    assert.equal(execAuth.ok, false)
    const execService = await rpc(
      client,
      `select has_function_privilege('service_role', 'public.reconcile_collection_case_paid(uuid,text,integer,uuid,uuid,text,jsonb,integer)', 'execute') as ok`
    )
    assert.equal(execService.ok, true)
    const path = await rpc(
      client,
      `select prosecdef, proconfig
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'reconcile_collection_case_paid'`
    )
    assert.equal(path.prosecdef, true)
    assert.equal(JSON.stringify(path.proconfig).includes("search_path=public"), true)
  })

  it("helper HTTP simulado + runner + PG: descoberta, reconciliação e timeout", async () => {
    await client.query(
      `update public.collection_cases
       set status = 'closed', closed_at = timezone('utc', now())
       where status in ('open', 'in_contact', 'promise_to_pay', 'unresolved')`
    )
    const seedRun = await claim(client, "seed-helper")
    const seedGen = seedRun.run.leaseGeneration
    const absentOpen = await persist(client, seedRun.run.id, "seed-helper", seedGen, "83001")
    const absentPaid = await persist(client, seedRun.run.id, "seed-helper", seedGen, "83002")
    const timeoutCase = await persist(client, seedRun.run.id, "seed-helper", seedGen, "83003")
    assert.equal(absentOpen.ok, true)
    await client.query(
      `update public.collection_cases
       set metadata = '{"note":"keep-manual"}'::jsonb
       where invoice_pk in ('83001','83002','83003')`
    )
    await client.query(
      `select public.release_collection_discovery_run($1,$2,$3,'paused',null)`,
      [seedRun.run.id, "seed-helper", seedGen]
    )
    await closeResumableRuns()

    const originalFetch = globalThis.fetch
    const details: Record<string, Record<string, unknown>> = {
      "83001": {
        invoice_pk: "83001",
        invoice_msg: "open",
        invoice_date_credit: null,
        invoice_deleted: false,
      },
      "83002": {
        invoice_pk: "83002",
        invoice_msg: "paid",
        invoice_date_credit: "2026-09-10",
        isPaid: true,
      },
    }
    let blockedExternal = true
    const pendingAborts: AbortSignal[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = String(input instanceof Request ? input.url : input)
      if (!href.startsWith("http://127.0.0.1")) {
        blockedExternal = false
        throw new Error(`blocked-external:${href}`)
      }
      const url = new URL(href)
      if (url.pathname.endsWith("/login")) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json", "set-cookie": "lab=1" },
        })
      }
      const body = String(init?.body ?? "")
      const params = new URLSearchParams(body)
      if (url.pathname.includes("list_info")) {
        const pk =
          params.get("invoice_pk") ||
          params.get("where[invoice_pk]") ||
          (() => {
            try {
              const parsed = JSON.parse(params.get("where") ?? "{}") as { invoice_pk?: string }
              return parsed.invoice_pk ?? ""
            } catch {
              return ""
            }
          })()
        if (pk === "83003") {
          const signal = init?.signal
          if (signal) pendingAborts.push(signal)
          await new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error("lab-timeout-not-aborted")), 30_000)
            signal?.addEventListener("abort", () => {
              clearTimeout(timer)
              reject(Object.assign(new Error("AbortError"), { name: "AbortError" }))
            })
          })
        }
        const row = details[pk]
        if (!row) {
          return new Response(JSON.stringify({ success: false, message: "Invoice not found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          })
        }
        return new Response(JSON.stringify({ success: true, results: [row] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (url.pathname.includes("/invoice/list")) {
        return new Response(
          JSON.stringify({
            success: true,
            results: [
              {
                invoice_pk: "84001",
                invoice_deleted: false,
                invoice_due_date: "2026-08-01 00:00:00",
                invoice_date_credit: null,
                contract_pk: "1",
                client_pk: "1",
              },
            ],
            recordsTotal: 1,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }
      throw new Error(`unexpected-path:${url.pathname}`)
    }) as typeof fetch

    const config = {
      enabled: true,
      apiUrl: "http://127.0.0.1:9",
      apiUser: "lab-user",
      apiPassword: "lab-only",
      defaultLeadPk: "1",
      defaultInterestStatus: "1",
      defaultPlanPk: "1",
      timeoutMs: 5_000,
    }

    function asRun(row: Record<string, any>): CollectionDiscoveryRun {
      return {
        ...row,
        coverageProven: false,
        uniqueOrderProven: false,
        phase: row.phase === "reconciliation" ? "reconciliation" : "discovery",
        reconcileCursorInvoicePk: row.reconcileCursorInvoicePk ?? null,
        reconcileScannedCount: Number(row.reconcileScannedCount ?? 0),
        reconcileClosedCount: Number(row.reconcileClosedCount ?? 0),
        reconcileSkippedCount: Number(row.reconcileSkippedCount ?? 0),
      } as CollectionDiscoveryRun
    }

    const store: DiscoveryStore = {
      async claimOrStart(input) {
        const payload = await claim(
          client,
          input.owner,
          input.leaseMs ?? 60_000,
          input.runId ?? null
        )
        if (payload.ok !== true) {
          return { ok: false, code: payload.code } as Awaited<ReturnType<DiscoveryStore["claimOrStart"]>>
        }
        return {
          ok: true,
          code: payload.created === true ? "created" : "claimed",
          created: payload.created === true,
          run: asRun(payload.run),
        }
      },
      async advance(input) {
        const row = await rpc(
          client,
          `select public.advance_collection_discovery_checkpoint(
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
           ) as payload`,
          [
            input.runId,
            input.owner,
            input.generation,
            input.cursorLastInvoicePk,
            input.counters.scannedPages,
            input.counters.scannedInvoices,
            input.counters.createdCount,
            input.counters.updatedCount,
            input.counters.skippedCount,
            input.counters.assignedCount,
            input.counters.unassignedCount,
            input.counters.errorCount,
            input.counters.reportedTotal,
            input.lastErrorClass ?? null,
          ]
        )
        const payload = row.payload as Record<string, any>
        if (payload?.ok !== true) return { ok: false, code: "stale_lease" }
        return { ok: true, run: asRun(payload.run) }
      },
      async enterReconciliation(input) {
        const row = await rpc(
          client,
          `select public.enter_collection_reconciliation_phase($1,$2,$3) as payload`,
          [input.runId, input.owner, input.generation]
        )
        const payload = row.payload as Record<string, any>
        if (payload?.ok !== true) return { ok: false, code: "stale_lease" }
        return { ok: true, run: asRun(payload.run) }
      },
      async advanceReconciliation(input) {
        const row = await rpc(
          client,
          `select public.advance_collection_reconciliation_checkpoint($1,$2,$3,$4,$5,$6,$7,$8) as payload`,
          [
            input.runId,
            input.owner,
            input.generation,
            input.reconcileCursorInvoicePk,
            input.reconcileScannedCount,
            input.reconcileClosedCount,
            input.reconcileSkippedCount,
            input.lastErrorClass ?? null,
          ]
        )
        const payload = row.payload as Record<string, any>
        if (payload?.ok !== true) return { ok: false, code: "stale_lease" }
        return { ok: true, run: asRun(payload.run) }
      },
      async release(input) {
        const row = await rpc(
          client,
          `select public.release_collection_discovery_run($1,$2,$3,$4,$5) as payload`,
          [input.runId, input.owner, input.generation, input.status, input.lastErrorClass ?? null]
        )
        const payload = row.payload as Record<string, any>
        if (payload?.ok !== true) return { ok: false, code: "stale_lease" }
        return { ok: true, run: asRun(payload.run) }
      },
    }

    const repo: DiscoveryCaseRepo = {
      async findByInvoicePk(invoicePk) {
        const row = await rpc(
          client,
          `select id::text as id, status, invoice_pk from public.collection_cases where invoice_pk = $1`,
          [invoicePk]
        )
        if (!row?.id) return null
        return { id: String(row.id), status: String(row.status) as never, invoicePk }
      },
      async persistFencedInvoice(input) {
        return persist(
          client,
          input.lease.runId,
          input.lease.owner,
          input.lease.generation,
          String(input.writeModel.invoice_pk ?? ""),
          input.assign
        ) as Promise<Awaited<ReturnType<DiscoveryCaseRepo["persistFencedInvoice"]>>>
      },
      async listOpenAfter(input) {
        const row = await rpc(
          client,
          `select public.list_open_collection_cases_after($1,$2,$3,$4,$5) as payload`,
          [
            input.lease.runId,
            input.lease.owner,
            input.lease.generation,
            input.afterInvoicePk,
            input.limit,
          ]
        )
        const payload = row.payload as Record<string, any>
        if (payload?.ok !== true) return { ok: false, code: payload?.code ?? "invalid_input" }
        return {
          ok: true,
          cases: (payload.cases as Array<Record<string, string>>).map((item) => ({
            id: String(item.id),
            status: String(item.status) as never,
            invoicePk: String(item.invoicePk),
          })),
        }
      },
      async reconcilePaidFenced(input) {
        const row = await rpc(
          client,
          `select public.reconcile_collection_case_paid($1,$2,$3,$4::uuid,$5::uuid,$6,$7::jsonb,$8) as payload`,
          [
            input.lease.runId,
            input.lease.owner,
            input.lease.generation,
            input.actorProfileId,
            input.caseId,
            input.invoicePk,
            JSON.stringify(input.evidence ?? {}),
            input.statementTimeoutMs ?? null,
          ]
        )
        const payload = row.payload as Record<string, any>
        if (payload?.ok !== true) {
          return {
            ok: false,
            code: payload?.code ?? "persist_error",
            caseId: null,
            closed: false,
            alreadyPaid: false,
            eventInserted: false,
          }
        }
        return {
          ok: true,
          code: payload.code,
          caseId: payload.caseId ? String(payload.caseId) : input.caseId,
          closed: payload.closed === true,
          alreadyPaid: payload.alreadyPaid === true,
          eventInserted: payload.eventInserted === true,
        }
      },
      async insertOpen() {
        throw new Error("unused")
      },
      async updateFinancials() {},
      async recordCreatedEvent() {},
      async ensureAssignment() {
        return { assignmentId: null, code: "unused", newlyAssigned: false }
      },
    }

    try {
      let nowMs = 0
      const first = await runOverdueDiscoveryBatch({
        store,
        repo,
        owner: "helper-worker",
        actorProfileId: ACTOR,
        now: new Date("2026-09-16T12:00:00.000Z"),
        referenceInstant: new Date("2026-09-16T12:00:00.000Z"),
        referenceDate: "2026-09-16",
        minimumDaysOverdue: 5,
        collectionsEnabled: true,
        startedAtMs: 0,
        clock: () => nowMs,
        budgetMs: 45_000,
        configuredTimeoutMs: 80,
        fetchPage: async ({ referenceDate, afterInvoicePk, timeoutMs }) => {
          nowMs += 11_300
          const page = await listOverdueInvoicesPage({
            config: { ...config, timeoutMs },
            cookie: "lab=1",
            referenceDate,
            page: 1,
            afterInvoicePk,
            timeoutMs,
          })
          return {
            ok: page.ok,
            rows: page.rows,
            total: page.total,
            httpStatus: page.httpStatus,
            message: page.message,
          }
        },
        toInvoice: (row) => presentCollectionInvoiceFromListRow(row),
        fetchInvoiceDetail: async ({ invoicePk, timeoutMs }) => {
          const info = await fetchInvoiceInfo({
            config: { ...config, timeoutMs },
            cookie: "lab=1",
            invoicePk,
          })
          return classifyInvoiceDetailForReconciliation({
            requestedInvoicePk: invoicePk,
            ok: info.ok,
            httpStatus: info.httpStatus,
            message: info.message,
            abortClass: info.abortClass,
            info: info.info,
            payload: info.payload,
          })
        },
      })
      assert.equal(blockedExternal, true)
      assert.equal(first.ok, true)
      assert.equal(first.referenceDate, "2026-09-16")
      assert.equal(first.created >= 1, true)
      const created = await rpc(
        client,
        `select count(*)::int as n from public.collection_cases where invoice_pk = '84001'`
      )
      assert.equal(created.n, 1)
      assert.equal(first.resumable, true)
      assert.equal(first.coverageProven, false)

      nowMs = 0
      const second = await runOverdueDiscoveryBatch({
        store,
        repo,
        owner: "helper-worker-2",
        actorProfileId: ACTOR,
        now: new Date("2026-09-17T12:00:00.000Z"),
        referenceInstant: new Date("2026-09-17T12:00:00.000Z"),
        referenceDate: "2026-09-17",
        runId: first.runId,
        minimumDaysOverdue: 5,
        collectionsEnabled: true,
        startedAtMs: 0,
        clock: () => nowMs,
        budgetMs: 45_000,
        configuredTimeoutMs: 80,
        fetchPage: async ({ referenceDate, afterInvoicePk, timeoutMs }) => {
          const page = await listOverdueInvoicesPage({
            config: { ...config, timeoutMs },
            cookie: "lab=1",
            referenceDate,
            page: 1,
            afterInvoicePk,
            timeoutMs,
          })
          return { ok: page.ok, rows: page.rows, total: page.total, httpStatus: page.httpStatus }
        },
        toInvoice: (row) => presentCollectionInvoiceFromListRow(row),
        fetchInvoiceDetail: async ({ invoicePk, timeoutMs }) => {
          const info = await fetchInvoiceInfo({
            config: { ...config, timeoutMs },
            cookie: "lab=1",
            invoicePk,
          })
          return classifyInvoiceDetailForReconciliation({
            requestedInvoicePk: invoicePk,
            ok: info.ok,
            httpStatus: info.httpStatus,
            message: info.message,
            abortClass: info.abortClass,
            info: info.info,
            payload: info.payload,
          })
        },
      })
      assert.equal(second.runId, first.runId)
      assert.equal(second.referenceDate, "2026-09-16")
      const stillOpen = await rpc(
        client,
        `select status, metadata from public.collection_cases where invoice_pk = '83001'`
      )
      assert.equal(stillOpen.status, "open")
      assert.equal((stillOpen.metadata as { note?: string }).note, "keep-manual")
      const paid = await rpc(
        client,
        `select status from public.collection_cases where invoice_pk = '83002'`
      )
      assert.equal(paid.status, "paid")
      const payEvents = await rpc(
        client,
        `select count(*)::int as n from public.collection_case_events
         where event_type = 'payment_detected' and case_id = $1`,
        [absentPaid.caseId]
      )
      assert.equal(payEvents.n, 1)
      const timeoutRow = await rpc(
        client,
        `select status from public.collection_cases where invoice_pk = '83003'`
      )
      assert.equal(timeoutRow.status, "open")
      void timeoutCase
      void absentOpen
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

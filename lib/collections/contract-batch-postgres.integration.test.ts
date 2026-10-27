import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, before, beforeEach, describe, it } from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgRow = Record<string, any>
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


async function persistContract(
  c: PgClient,
  runId: string,
  owner: string,
  generation: number,
  invoicePk: string,
  contractPk: string | null,
  extra: Record<string, unknown> = {}
) {
  const row = await rpc(
    c,
    `select public.persist_collection_contract_invoice($1,$2,$3,$4::uuid,$5::jsonb,true,null) as payload`,
    [runId, owner, generation, ACTOR, writeModel(invoicePk, { contract_pk: contractPk, client_pk: null, ...extra })]
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

async function freshRun(owner: string) {
  await closeResumableRuns()
  const claimed = await claim(client, owner)
  assert.equal(claimed.ok, true)
  return { runId: String(claimed.run.id), generation: Number(claimed.run.leaseGeneration) }
}

async function count(sql: string, params: unknown[] = []) {
  const row = await rpc(client, sql, params)
  return Number(row.n)
}

function applyFile(rel: string) {
  return client.query(readFileSync(join(here, "../..", rel), "utf8"))
}

describe("PostgreSQL real — 3.1E-AU lote por contrato", { timeout: 240_000 }, () => {
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

  it("AL/AM — upgrade: três casos parciais legados preservados; backfill idempotente; reaplicação segura", async () => {
    const legacy = await client.query(
      `insert into public.collection_cases (contract_pk, invoice_pk, customer_name, days_overdue, overdue_since, status, metadata)
       values ('9001', '900001', 'L1', 12, '2026-09-04', 'open', '{"manual":"a"}'::jsonb),
              ('9002', '900002', 'L2', 20, '2026-08-27', 'in_contact', '{"manual":"b"}'::jsonb),
              (null,   '900003', 'L3', 8,  '2026-09-08', 'open', '{}'::jsonb)
       returning id`
    )
    assert.equal(legacy.rows.length, 3)
    const before = await rpc(client, `select count(*)::int as n from public.collection_cases`)
    await applyFile("supabase/patch-collection-ar-operational-batch.sql")
    await applyFile("supabase/patch-collection-au-contract-batch.sql")
    await applyFile("supabase/patch-collection-ar-operational-batch.sql")
    await applyFile("supabase/patch-collection-au-contract-batch.sql")
    const after = await rpc(client, `select count(*)::int as n from public.collection_cases`)
    assert.equal(after.n, before.n)
    assert.equal(
      await count(`select count(*)::int as n from public.collection_case_invoices where invoice_pk in ('900001','900002','900003')`),
      3
    )
    const noContract = await rpc(
      client,
      `select contract_pk from public.collection_case_invoices where invoice_pk = '900003'`
    )
    assert.equal(noContract.contract_pk, null)
    const report = (await rpc(client, `select public.collection_case_invoice_backfill_report() as r`)).r
    assert.equal(report.contractsWithMultipleActiveCases, 0)
    assert.equal(report.casesWithoutContractPk >= 1, true)
    const kept = await rpc(client, `select status, metadata from public.collection_cases where invoice_pk = '900002'`)
    assert.equal(kept.status, "in_contact")
    assert.equal(kept.metadata.manual, "b")
  })

  it("A/B/C/D/E/AJ/AK/AR — caso por contrato, faturas anexadas, sem novo created/assignment, campos manuais preservados", async () => {
    const { runId, generation } = await freshRun("au-a")
    const a = await persistContract(client, runId, "au-a", generation, "710001", "7100")
    assert.equal(a.code, "case_created")
    const caseId = String(a.caseId)
    await client.query(
      `update public.collection_cases set status = 'in_contact', metadata = '{"note":"manual"}'::jsonb where id = $1`,
      [caseId]
    )
    const asgBefore = await rpc(client, `select sector_assignment_id from public.collection_cases where id = $1`, [caseId])
    const rrBefore = await rpc(
      client,
      `select total_received_today from public.employee_sector_assignment_settings where membership_id = $1`,
      [membershipId]
    )
    const b = await persistContract(client, runId, "au-a", generation, "710002", "7100")
    const c = await persistContract(client, runId, "au-a", generation, "710003", "7100")
    const d = await persistContract(client, runId, "au-a", generation, "710003", "7100")
    assert.equal(b.code, "invoice_attached")
    assert.equal(c.code, "invoice_attached")
    assert.equal(d.code, "invoice_updated")
    assert.equal(String(b.caseId), caseId)
    assert.equal(await count(`select count(*)::int as n from public.collection_case_invoices where case_id = $1`, [caseId]), 3)
    assert.equal(
      await count(`select count(*)::int as n from public.collection_case_events where case_id = $1 and event_type = 'created'`, [caseId]),
      1
    )
    const kept = await rpc(client, `select status, metadata, sector_assignment_id from public.collection_cases where id = $1`, [caseId])
    assert.equal(kept.status, "in_contact")
    assert.equal(kept.metadata.note, "manual")
    assert.equal(String(kept.sector_assignment_id), String(asgBefore.sector_assignment_id))
    const rrAfter = await rpc(
      client,
      `select total_received_today from public.employee_sector_assignment_settings where membership_id = $1`,
      [membershipId]
    )
    assert.equal(rrAfter.total_received_today, rrBefore.total_received_today)
    const e = await persistContract(client, runId, "au-a", generation, "720001", "7200")
    assert.equal(e.code, "case_created")
    assert.notEqual(String(e.caseId), caseId)
  })

  it("legado: fatura nova de contrato com caso legado ativo é anexada ao legado (sem segundo caso)", async () => {
    const { runId, generation } = await freshRun("au-leg")
    const r = await persistContract(client, runId, "au-leg", generation, "900010", "9002")
    assert.equal(r.code, "invoice_attached")
    const legacyId = (await rpc(client, `select id from public.collection_cases where invoice_pk = '900002'`)).id
    assert.equal(String(r.caseId), String(legacyId))
  })

  it("O/P/inconclusivo — cancelado (5) não cria; bloqueado (4) cria; sem contract_pk não cria", async () => {
    const { runId, generation } = await freshRun("au-o")
    const casesBefore = await count(`select count(*)::int as n from public.collection_cases`)
    const x = await persistContract(client, runId, "au-o", generation, "730001", "7300", { contract_status: 5 })
    assert.equal(x.code, "cancelled_contract")
    const y = await persistContract(client, runId, "au-o", generation, "730002", null)
    assert.equal(y.code, "inconclusive")
    assert.equal(await count(`select count(*)::int as n from public.collection_cases`), casesBefore)
    const z = await persistContract(client, runId, "au-o", generation, "740001", "7400", { contract_status: 4 })
    assert.equal(z.code, "case_created")
  })

  it("X — lease antiga recebe stale_lease e não grava", async () => {
    const { runId, generation } = await freshRun("au-x")
    const stale = await persistContract(client, runId, "au-x", generation - 1, "750001", "7500")
    assert.equal(stale.code, "stale_lease")
    assert.equal(await count(`select count(*)::int as n from public.collection_case_invoices where invoice_pk = '750001'`), 0)
  })

  it("concorrência — duas conexões, mesmo contrato novo → um caso ativo", async () => {
    const { runId, generation } = await freshRun("au-cc")
    const c1 = await newClient()
    const c2 = await newClient()
    const [r1, r2] = await Promise.all([
      persistContract(c1, runId, "au-cc", generation, "760001", "7600"),
      persistContract(c2, runId, "au-cc", generation, "760002", "7600"),
    ])
    assert.deepEqual([r1.code, r2.code].sort(), ["case_created", "invoice_attached"])
    assert.equal(
      await count(
        `select count(*)::int as n from public.collection_cases
         where contract_pk = '7600' and status in ('open','in_contact','promise_to_pay','unresolved')`
      ),
      1
    )
    await assert.rejects(
      client.query(
        `insert into public.collection_cases (contract_pk, invoice_pk, status, case_unit) values ('7600', '760099', 'open', 'contract')`
      )
    )
  })

  it("AA/AB/AC/AF — pagamento parcial não fecha; todas pagas fecham; evento por fatura idempotente", async () => {
    const { runId, generation } = await freshRun("au-pay")
    const a = await persistContract(client, runId, "au-pay", generation, "770001", "7700")
    await persistContract(client, runId, "au-pay", generation, "770002", "7700")
    await persistContract(client, runId, "au-pay", generation, "770003", "7700")
    const caseId = String(a.caseId)
    const pay = async (pk: string) =>
      (await rpc(
        client,
        `select public.reconcile_collection_case_paid($1,$2,$3,$4::uuid,$5::uuid,$6,'{}'::jsonb,null) as payload`,
        [runId, "au-pay", generation, ACTOR, caseId, pk]
      )).payload as Record<string, any>
    assert.equal((await pay("770001")).code, "partial_paid")
    assert.equal((await pay("770001")).eventInserted, false)
    assert.equal((await pay("770002")).code, "partial_paid")
    const st = await rpc(client, `select status from public.collection_cases where id = $1`, [caseId])
    assert.equal(st.status, "open")
    assert.equal((await pay("770003")).code, "closed")
    assert.equal(
      await count(
        `select count(*)::int as n from public.collection_case_events where case_id = $1 and event_type = 'payment_detected'`,
        [caseId]
      ),
      3
    )
    const listed = (await rpc(
      client,
      `select public.list_open_collection_cases_after($1,$2,$3,null,15) as payload`,
      [runId, "au-pay", generation]
    )).payload
    assert.equal(listed.ok, true)
    assert.equal(listed.cases.some((r: any) => String(r.id) === caseId), false)
  })

  it("AG/AH/AI — trava por contrato: um vence; expirada recuperável; transferência preserva histórico", async () => {
    const { runId, generation } = await freshRun("au-lock")
    const a = await persistContract(client, runId, "au-lock", generation, "780001", "7800")
    const caseId = String(a.caseId)
    const c1 = await newClient()
    const c2 = await newClient()
    const [l1, l2] = await Promise.all([
      rpc(c1, `select public.acquire_collection_contract_lock($1::uuid,$2::uuid,60) as p`, [caseId, ACTOR]),
      rpc(c2, `select public.acquire_collection_contract_lock($1::uuid,$2::uuid,60) as p`, [caseId, EMPLOYEE_PROFILE]),
    ])
    const codes = [l1.p.code, l2.p.code].sort()
    assert.deepEqual(codes, ["acquired", "locked_by_other"])
    await client.query(
      `update public.collection_contract_contact_locks set expires_at = timezone('utc', now()) - interval '1 minute' where contract_pk = '7800'`
    )
    const loser = l1.p.code === "acquired" ? EMPLOYEE_PROFILE : ACTOR
    const rec = await rpc(client, `select public.acquire_collection_contract_lock($1::uuid,$2::uuid,60) as p`, [caseId, loser])
    assert.equal(rec.p.code, "recovered_expired")
    const tr = await rpc(
      client,
      `select public.transfer_collection_contract_lock($1::uuid,$2::uuid,$3::uuid,false,60) as p`,
      [caseId, loser, loser === ACTOR ? EMPLOYEE_PROFILE : ACTOR]
    )
    assert.equal(tr.p.code, "transferred")
    const history = await rpc(
      client,
      `select array_agg(event_type order by created_at, id) as t from public.collection_contract_lock_events where contract_pk = '7800'`
    )
    assert.deepEqual(history.t.slice(0, 1), ["acquired"])
    assert.equal(history.t.includes("recovered_expired"), true)
    assert.equal(history.t.includes("transferred"), true)
    await assert.rejects(client.query(`delete from public.collection_case_invoices where invoice_pk = '780001'`))
  })

  it("capacidade — conta contratos distintos; promessa futura não ocupa; vencida ocupa", async () => {
    await client.query(`update public.operational_sector_settings set settings = settings || '{"active_contract_capacity": 15}'::jsonb where sector_code = 'collections'`)
    const s1 = (await rpc(client, `select public.collection_contract_capacity_summary(null) as s`)).s
    assert.equal(s1.configured, 15)
    assert.equal(s1.available, Math.max(0, 15 - s1.occupying))
    const target = (await rpc(client, `select id from public.collection_cases where contract_pk = '7200'`)).id
    await client.query(
      `update public.collection_cases set status = 'promise_to_pay', follow_up_due_at = timezone('utc', now()) + interval '2 days' where id = $1`,
      [target]
    )
    const s2 = (await rpc(client, `select public.collection_contract_capacity_summary(null) as s`)).s
    assert.equal(s2.occupying, s1.occupying - 1)
    assert.equal(s2.futurePromises, s1.futurePromises + 1)
    await client.query(
      `update public.collection_cases set follow_up_due_at = timezone('utc', now()) - interval '1 day' where id = $1`,
      [target]
    )
    const s3 = (await rpc(client, `select public.collection_contract_capacity_summary(null) as s`)).s
    assert.equal(s3.occupying, s1.occupying)
  })

  it("RLS/permissões — tabelas e RPCs novas só service_role; security definer + search_path", async () => {
    for (const table of ["collection_case_invoices", "collection_contract_contact_locks", "collection_contract_lock_events"]) {
      const rls = await rpc(client, `select relrowsecurity from pg_class where relname = $1`, [table])
      assert.equal(rls.relrowsecurity, true)
      const auth = await rpc(
        client,
        `select has_table_privilege('authenticated', $1, 'select') as s, has_table_privilege('anon', $1, 'select') as a`,
        [`public.${table}`]
      )
      assert.equal(auth.s, false)
      assert.equal(auth.a, false)
    }
    for (const fn of [
      "persist_collection_contract_invoice",
      "acquire_collection_contract_lock",
      "release_collection_contract_lock",
      "transfer_collection_contract_lock",
      "collection_contract_capacity_summary",
      "collection_case_invoice_backfill_report",
      "reconcile_collection_case_paid",
      "list_open_collection_cases_after",
    ]) {
      const p = await rpc(
        client,
        `select p.oid::regprocedure::text as sig, prosecdef, proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = $1`,
        [fn]
      )
      assert.equal(p.prosecdef, true, fn)
      assert.equal(JSON.stringify(p.proconfig).includes("search_path=public"), true, fn)
      const ex = await rpc(
        client,
        `select has_function_privilege('authenticated', $1, 'execute') as au,
                has_function_privilege('anon', $1, 'execute') as an,
                has_function_privilege('service_role', $1, 'execute') as sr`,
        [p.sig]
      )
      assert.equal(ex.au, false, fn)
      assert.equal(ex.an, false, fn)
      assert.equal(ex.sr, true, fn)
    }
  })
})

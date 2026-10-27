import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, before, describe, it } from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { randomUUID } from "node:crypto"

/**
 * Sprint 3.1E-AW - PostgreSQL local real (embedded, 127.0.0.1).
 * Cadeia: checkpoint -> fenced -> reconciliation -> progress -> supersede -> AR -> AW
 *         -> consolidação fixture -> AU. Nenhuma conexão remota.
 */
const here = dirname(fileURLToPath(import.meta.url))
const labUrl = pathToFileURL(join(here, "../../scripts/local-pg-collections-lab/run.mjs")).href
const REASON = "duplicate_invoice_cases_same_contract"
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab"
const EMP1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
const EMP2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
const CONTRACT = "overdue-invoice-list.keyset.v1"
const STRATEGY = "keyset_invoice_pk_gt"
const TZ = "America/Sao_Paulo"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgRow = Record<string, any>
type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: PgRow[] }>
  connect: () => Promise<void>
  end: () => Promise<void>
}
type PgClientCtor = new (config: Record<string, unknown>) => PgClient
type LabModule = {
  startCollectionsLab: (o?: { stopAfter?: string }) => Promise<{ client: PgClient; conn: PgRow; Client: PgClientCtor }>
  stopCollectionsLab: () => Promise<void>
}

let lab: LabModule
let client: PgClient
let Client: PgClientCtor
let conn: PgRow
const extras: PgClient[] = []
const emp: Record<string, { employeeId: string; membershipId: string }> = {}
let sectorId = ""

async function newClient() {
  const c = new Client({ host: conn.host, port: conn.port, user: conn.user, password: conn.password, database: conn.database })
  await c.connect()
  extras.push(c)
  return c
}
async function one(sql: string, params: unknown[] = [], c: PgClient = client) {
  return (await c.query(sql, params)).rows[0]
}
async function n(sql: string, params: unknown[] = []) {
  return Number((await one(sql, params)).n)
}
function applyFile(rel: string) {
  return client.query(readFileSync(join(here, "../..", rel), "utf8"))
}
const AR = "supabase/patch-collection-ar-operational-batch.sql"
const AW = "supabase/patch-collection-aw-contract-case-consolidation.sql"
const AU = "supabase/patch-collection-au-contract-batch.sql"

async function mkCase(contractPk: string | null, invoicePk: string, createdAt: string, opts: { employee?: "e1" | "e2" | null; status?: string } = {}) {
  const row = await one(
    `insert into public.collection_cases (contract_pk, invoice_pk, customer_name, days_overdue, overdue_since, status, created_at)
     values ($1, $2, 'Fixture', 10, '2026-09-01', $3, $4::timestamptz) returning id`,
    [contractPk, invoicePk, opts.status ?? "open", createdAt]
  )
  const id = String(row.id)
  await client.query(
    `insert into public.collection_case_events (case_id, event_type, new_value, metadata)
     values ($1, 'created', jsonb_build_object('invoice_pk', $2::text), '{"source":"lab"}'::jsonb)`,
    [id, invoicePk]
  )
  const e = opts.employee === undefined ? "e1" : opts.employee
  if (e) {
    const m = emp[e]
    const a = await one(
      `insert into public.sector_work_assignments (sector_id, employee_id, membership_id, work_type, work_id, status, assignment_source)
       values ($1, $2, $3, 'collection_case', $4, 'active', 'auto_assign') returning id`,
      [sectorId, m.employeeId, m.membershipId, id]
    )
    await client.query(
      `update public.employee_sector_assignment_settings set active_assignments = active_assignments + 1 where membership_id = $1`,
      [m.membershipId]
    )
    await client.query(`update public.collection_cases set sector_assignment_id = $2 where id = $1`, [id, a.id])
  }
  await client.query(
    `insert into public.collection_case_invoices (case_id, invoice_pk, contract_pk, payment_status)
     values ($1, $2, $3, 'open') on conflict (invoice_pk) do nothing`,
    [id, invoicePk, contractPk]
  )
  return id
}

async function consolidate(
  canonical: string,
  secondary: string,
  o: { op?: string; mode?: string; actor?: string | null; expC?: string; expS?: string; reason?: string; c?: PgClient } = {}
) {
  const row = await one(
    `select public.consolidate_collection_cases_by_contract($1,$2,$3,$4,$5,$6::uuid,$7::uuid,$8) as r`,
    [canonical, secondary, o.expC ?? "open", o.expS ?? "open", o.reason ?? REASON, o.op ?? randomUUID(), o.actor ?? null, o.mode ?? "auto_oldest"],
    o.c ?? client
  )
  return row.r as Record<string, any>
}

async function runSnapshot() {
  return JSON.stringify((await client.query(`select id, status, lease_generation, cursor_last_invoice_pk, consecutive_no_progress, scanned_pages, scanned_invoices, created_count, updated_count, assigned_count from public.collection_discovery_runs order by id`)).rows)
}
async function rrSnapshot() {
  return JSON.stringify(
    (await client.query(`select membership_id, last_assignment_at, total_received_today from public.employee_sector_assignment_settings order by membership_id`)).rows
  )
}

describe("PostgreSQL real - 3.1E-AW consolidação por contrato", { timeout: 300_000 }, () => {
  let canon = ""
  let second = ""
  let third = ""
  let mainOp = ""

  before(async () => {
    lab = (await import(labUrl)) as LabModule
    const started = await lab.startCollectionsLab({ stopAfter: AW })
    client = started.client
    Client = started.Client
    conn = started.conn
    assert.equal(conn.localTargetVerified, true)
    assert.match(String(conn.serverAddr), /127\.0\.0\.1/)
    assert.equal(await n(`select count(*)::int as n from pg_class where relname = 'collection_contract_contact_locks'`), 0)
    await client.query(
      `insert into public.profiles (id, full_name, email, phone, role, is_active) values
        ($1,'Lab Ator','aw-actor@example.test','11900000010','funcionario',true),
        ($2,'Lab E1','aw-e1@example.test','11900000011','funcionario',true),
        ($3,'Lab E2','aw-e2@example.test','11900000012','funcionario',true)
       on conflict (id) do nothing`,
      [ACTOR, EMP1, EMP2]
    )
    sectorId = String((await one(`select id from public.sectors where code = 'collections'`)).id)
    for (const [k, p] of [["e1", EMP1], ["e2", EMP2]] as const) {
      const e = await one(`insert into public.employees (profile_id, status) values ($1,'active') on conflict (profile_id) do update set status='active' returning id`, [p])
      const m = await one(
        `insert into public.employee_sector_memberships (employee_id, sector_id, is_active) values ($1,$2,true) returning id`,
        [e.id, sectorId]
      )
      emp[k] = { employeeId: String(e.id), membershipId: String(m.id) }
    }
    // run pausada estilo produção (discovery, cursor ausente, counters 0)
    await one(
      `select public.claim_collection_discovery_run('aw-lab',60000,$1,'2026-09-16T12:00:00.000Z'::timestamptz,'2026-09-16'::date,$2,$3,null::uuid) as p`,
      [CONTRACT, TZ, STRATEGY]
    )
    await client.query(`update public.collection_discovery_runs set status='paused', lease_owner=null, lease_until=null`)
  })

  after(async () => {
    for (const e of extras) await e.end().catch(() => undefined)
    await lab.stopCollectionsLab()
  })

  it("AR compatível com duplicata ativa; report classifica duplicate_active_contract; Z: AU aborta sem consolidação", async () => {
    canon = await mkCase("5001", "500001", "2026-09-01T10:00:00Z")
    second = await mkCase("5001", "500002", "2026-09-02T10:00:00Z")
    third = await mkCase("5002", "500003", "2026-09-03T10:00:00Z")
    await applyFile(AR)
    const rep = (await one(`select public.collection_case_invoice_backfill_report() as r`)).r
    assert.equal(rep.duplicateActiveContractGroups, 1)
    assert.equal(rep.duplicateActiveContractCases, 2)
    assert.equal(rep.orphanCase, 0)
    assert.equal(rep.conflictingInvoice, 0)
    assert.equal(rep.unexplainedSkips, 0)
    await assert.rejects(() => applyFile(AU), /AU abortada/)
    await client.query("rollback")
    assert.equal(await n(`select count(*)::int as n from pg_class where relname = 'collection_contract_contact_locks'`), 0)
  })

  it("Q/K/U/M-validation: seleção automática recusa canônico não-mais-antigo, contrato diferente, estado stale, motivo inválido", async () => {
    assert.equal((await consolidate(second, canon)).code, "canonical_not_oldest")
    assert.equal((await consolidate(canon, third)).code, "contract_mismatch")
    assert.equal((await consolidate(canon, second, { expS: "in_contact" })).code, "stale_state")
    assert.equal((await consolidate(canon, second, { reason: "other" })).code, "invalid_reason")
    assert.equal((await consolidate(canon, canon)).code, "same_case")
    assert.equal((await consolidate(canon, second, { mode: "explicit" })).code, "explicit_requires_actor")
  })

  it("active lease bloqueia sem alterar a run", async () => {
    const before = await runSnapshot()
    await client.query(`update public.collection_discovery_runs set status='running', lease_owner='x', lease_until=now()+interval '1 minute'`)
    const r = await consolidate(canon, second)
    await client.query(`update public.collection_discovery_runs set status='paused', lease_owner=null, lease_until=null`)
    assert.equal(r.code, "active_lease")
    assert.equal(await runSnapshot(), before)
  })

  it("AE: falha após mover faturas desfaz tudo", async () => {
    await client.query(`
      create or replace function public.lab_fail_consolidation() returns trigger language plpgsql as $f$
      begin
        if new.metadata ->> 'source' = 'contract_case_consolidation' and current_setting('lab.fail', true) = 'on' then
          raise exception 'lab forced failure';
        end if;
        return new;
      end $f$;
      create trigger lab_fail_consolidation before insert on public.collection_case_events
      for each row execute function public.lab_fail_consolidation();`)
    await client.query(`set lab.fail = 'on'`)
    const r = await consolidate(canon, second)
    await client.query(`reset lab.fail`)
    await client.query(`drop trigger lab_fail_consolidation on public.collection_case_events; drop function public.lab_fail_consolidation()`)
    assert.equal(r.code, "rolled_back")
    assert.equal((await one(`select status from public.collection_cases where id=$1`, [second])).status, "open")
    assert.equal(await n(`select count(*)::int as n from public.collection_case_invoices where case_id=$1`, [second]), 1)
    assert.equal(await n(`select count(*)::int as n from public.sector_work_assignments where work_id=$1 and status='active'`, [second]), 1)
    assert.equal(await n(`select count(*)::int as n from public.collection_case_consolidations`), 0)
  })

  it("A-H: consolida no mais antigo; faturas no canônico; físicos/created/assignments preservados; RR e run intactos", async () => {
    const runBefore = await runSnapshot()
    const rrBefore = await rrSnapshot()
    const casesBefore = await n(`select count(*)::int as n from public.collection_cases`)
    const createdBefore = await n(`select count(*)::int as n from public.collection_case_events where event_type='created'`)
    const asgBefore = await n(`select count(*)::int as n from public.sector_work_assignments where work_type='collection_case'`)
    const activeAsgBefore = await n(`select count(*)::int as n from public.sector_work_assignments where work_type='collection_case' and status='active'`)
    const workloadBefore = Number((await one(`select active_assignments as a from public.employee_sector_assignment_settings where membership_id=$1`, [emp.e1.membershipId])).a)
    mainOp = randomUUID()
    const r = await consolidate(canon, second, { op: mainOp })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.code, "consolidated")
    assert.equal(r.invoicesMoved, 1)
    assert.equal(r.secondaryAssignmentReleased, true)
    assert.equal(await n(`select count(*)::int as n from public.collection_case_invoices where case_id=$1 and invoice_pk in ('500001','500002')`, [canon]), 2)
    assert.equal(await n(`select count(*)::int as n from public.collection_cases`), casesBefore)
    const s = await one(`select * from public.collection_cases where id=$1`, [second])
    assert.equal(s.status, "consolidated")
    assert.equal(s.consolidated_into_case_id, canon)
    assert.equal(s.consolidation_reason, REASON)
    assert.equal(s.consolidation_operation_id, mainOp)
    assert.equal(s.invoice_pk, "500002")
    assert.equal(await n(`select count(*)::int as n from public.collection_case_events where event_type='created'`), createdBefore)
    assert.equal(await n(`select count(*)::int as n from public.collection_case_events where event_type='created' and case_id=$1`, [second]), 1)
    assert.equal(await n(`select count(*)::int as n from public.sector_work_assignments where work_type='collection_case'`), asgBefore)
    assert.equal(await n(`select count(*)::int as n from public.sector_work_assignments where work_type='collection_case' and status='active'`), activeAsgBefore - 1)
    assert.equal(await n(`select count(*)::int as n from public.sector_work_assignments where work_id=$1 and status='active'`, [canon]), 1)
    const rel = await one(`select status, metadata from public.sector_work_assignments where work_id=$1`, [second])
    assert.equal(rel.status, "released")
    assert.equal(rel.metadata.reason, "contract_case_consolidated")
    assert.equal(await rrSnapshot(), rrBefore)
    const workloadAfter = Number((await one(`select active_assignments as a from public.employee_sector_assignment_settings where membership_id=$1`, [emp.e1.membershipId])).a)
    assert.equal(workloadAfter, workloadBefore - 1)
    assert.equal(await runSnapshot(), runBefore)
    assert.equal(await n(`select count(*)::int as n from public.collection_case_events where event_type='payment_detected'`), 0)
  })

  it("I/J/N/O/M/P: idempotência e estados terminais", async () => {
    const again = await consolidate(canon, second, { op: mainOp })
    assert.equal(again.ok, true)
    assert.equal(again.code, "already_consolidated")
    const diffOp = await consolidate(canon, second)
    assert.equal(diffOp.ok, false)
    assert.equal(diffOp.code, "secondary_already_consolidated")
    assert.equal(diffOp.sameCanonical, true)
    assert.equal((await consolidate(third, second, { mode: "explicit", actor: ACTOR, expS: "consolidated" })).code, "contract_mismatch")
    const other = await mkCase("5001", "500004", "2026-09-05T10:00:00Z", { employee: null })
    assert.equal((await consolidate(other, second, { mode: "explicit", actor: ACTOR, expS: "consolidated" })).code, "secondary_consolidated_elsewhere")
    assert.equal((await consolidate(second, other, { mode: "explicit", actor: ACTOR, expC: "consolidated" })).code, "canonical_consolidated")
    assert.equal((await consolidate(canon, second, { op: mainOp, expS: "x" })).code, "already_consolidated")
    // P: ciclo — canônico com consolidados não pode virar secundário
    assert.equal((await consolidate(other, canon, { mode: "explicit", actor: ACTOR })).code, "cycle_refused")
    await assert.rejects(() => client.query(`update public.collection_cases set status='open' where id=$1`, [second]), /terminal|consolidation_shape/)
    await assert.rejects(
      () => client.query(`update public.collection_cases set status='consolidated', consolidated_into_case_id=$2, consolidated_at=now(), consolidation_reason=$3, consolidation_operation_id=gen_random_uuid() where id=$1`, [canon, other, REASON]),
      /ciclo|cadeia/
    )
    // operation_id reutilizada para outro par
    assert.equal((await consolidate(canon, other, { op: mainOp })).code, "operation_id_conflict")
    // 'other' é terceiro caso ativo no 5001 sem assignment: consolidar agora (explicit, tem atividade? não) pelo modo auto
    const r = await consolidate(canon, other)
    assert.equal(r.code, "consolidated")
  })

  it("Q/R/S/L: atividade humana, pagamento, responsáveis diferentes, fatura conflitante", async () => {
    // Q
    const h1 = await mkCase("6001", "600001", "2026-09-01T10:00:00Z")
    const h2 = await mkCase("6001", "600002", "2026-09-02T10:00:00Z")
    await client.query(`insert into public.collection_case_events (case_id, event_type, new_value) values ($1,'contact_attempt','{}'::jsonb)`, [h2])
    assert.equal((await consolidate(h1, h2)).code, "human_activity_requires_explicit_choice")
    assert.equal((await consolidate(h1, h2, { mode: "explicit", actor: ACTOR })).code, "human_activity_on_secondary")
    // R
    const p1 = await mkCase("6002", "600011", "2026-09-01T10:00:00Z")
    const p2 = await mkCase("6002", "600012", "2026-09-02T10:00:00Z")
    await client.query(`insert into public.collection_case_events (case_id, event_type, new_value) values ($1,'payment_detected','{"invoice_pk":"600012"}'::jsonb)`, [p2])
    assert.equal((await consolidate(p1, p2)).code, "financial_conflict_requires_decision")
    assert.equal((await consolidate(p1, p2, { mode: "explicit", actor: ACTOR })).code, "financial_conflict_requires_decision")
    // S: responsáveis diferentes, sem atividade: mantém o canônico, libera o secundário
    const s1 = await mkCase("6003", "600021", "2026-09-01T10:00:00Z", { employee: "e1" })
    const s2 = await mkCase("6003", "600022", "2026-09-02T10:00:00Z", { employee: "e2" })
    const rs = await consolidate(s1, s2)
    assert.equal(rs.code, "consolidated")
    const kept = await one(`select employee_id from public.sector_work_assignments where work_id=$1 and status='active'`, [s1])
    assert.equal(kept.employee_id, emp.e1.employeeId)
    // canônico sem assignment enquanto secundário tem: recusa (não cria assignment)
    const m1 = await mkCase("6004", "600031", "2026-09-01T10:00:00Z", { employee: null })
    const m2 = await mkCase("6004", "600032", "2026-09-02T10:00:00Z")
    assert.equal((await consolidate(m1, m2)).code, "canonical_assignment_missing")
    // L: âncora do secundário vinculada a terceiro caso
    const l1 = await mkCase("6005", "600041", "2026-09-01T10:00:00Z", { employee: null })
    const l2 = await mkCase("6005", "600042", "2026-09-02T10:00:00Z", { employee: null })
    const l3 = await mkCase("6006", "600043", "2026-09-03T10:00:00Z", { employee: null })
    await client.query(`alter table public.collection_case_invoices disable trigger user`)
    await client.query(`update public.collection_case_invoices set case_id=$1 where invoice_pk='600042'`, [l3])
    await client.query(`alter table public.collection_case_invoices enable trigger user`)
    assert.equal((await consolidate(l1, l2)).code, "invoice_conflict")
    assert.equal((await one(`select status from public.collection_cases where id=$1`, [l2])).status, "open")
    // limpeza de fixture para AU: resolve grupos restantes de forma explícita/segura
    await client.query(`update public.collection_case_invoices set case_id=$1 where invoice_pk='600042'`, [l2])
    assert.equal((await consolidate(l1, l2)).code, "consolidated")
    await client.query(`update public.collection_cases set status='closed', closed_at=now() where id in ($1,$2,$3)`, [h2, p2, m2])
  })

  it("T: concorrência — apenas uma operação vence", async () => {
    const a = await mkCase("7001", "700001", "2026-09-01T10:00:00Z")
    const b = await mkCase("7001", "700002", "2026-09-02T10:00:00Z")
    const c1 = await newClient()
    const c2 = await newClient()
    await c1.query("begin")
    const r1 = await consolidate(a, b, { c: c1 })
    const p2 = consolidate(a, b, { c: c2 })
    await new Promise((r) => setTimeout(r, 300))
    await c1.query("commit")
    const r2 = await p2
    assert.equal(r1.code, "consolidated")
    assert.equal(r2.ok, false)
    assert.equal(r2.code, "secondary_already_consolidated")
    assert.equal(await n(`select count(*)::int as n from public.collection_case_consolidations where secondary_case_id=$1`, [b]), 1)
  })

  it("V/W: RLS, permissões e search_path", async () => {
    const p = await one(
      `select p.oid::regprocedure::text as sig, prosecdef, proconfig from pg_proc p
       join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname='consolidate_collection_cases_by_contract'`
    )
    assert.equal(p.prosecdef, true)
    assert.equal(JSON.stringify(p.proconfig).includes("search_path=public"), true)
    const ex = await one(
      `select has_function_privilege('authenticated',$1,'execute') as au, has_function_privilege('anon',$1,'execute') as an,
              has_function_privilege('public',$1,'execute') as pu, has_function_privilege('service_role',$1,'execute') as sr`,
      [p.sig]
    )
    assert.deepEqual([ex.au, ex.an, ex.pu, ex.sr], [false, false, false, true])
    const t = await one(`select relrowsecurity as rls from pg_class where relname='collection_case_consolidations'`)
    assert.equal(t.rls, true)
    const tp = await one(
      `select has_table_privilege('authenticated','public.collection_case_consolidations','select') as au,
              has_table_privilege('anon','public.collection_case_consolidations','select') as an`
    )
    assert.deepEqual([tp.au, tp.an], [false, false])
    await assert.rejects(() => client.query(`delete from public.collection_case_consolidations`), /histórico/)
  })

  it("X: AW reaplicada é segura e não consolida nada", async () => {
    const before = await n(`select count(*)::int as n from public.collection_cases where status='consolidated'`)
    await applyFile(AW)
    await applyFile(AW)
    assert.equal(await n(`select count(*)::int as n from public.collection_cases where status='consolidated'`), before)
    const sql = readFileSync(join(here, "../..", AW), "utf8")
    assert.equal(/\bdelete\s+from\b/i.test(sql), false)
    assert.equal(/\bupdate\s+public\.collection_discovery_runs\b/i.test(sql), false)
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql), false)
  })

  it("Y/AA/AD: AU passa após consolidação; capacidade ignora consolidated; persist anexa ao canônico", async () => {
    const runBefore = await runSnapshot()
    await applyFile(AU)
    const idx = await n(`select count(*)::int as n from pg_indexes where indexname='collection_cases_active_contract_uidx'`)
    assert.equal(idx, 1)
    const rep = (await one(`select public.collection_case_invoice_backfill_report() as r`)).r
    assert.equal(rep.duplicateActiveContractGroups, 0)
    assert.equal(rep.conflictingInvoice, 0)
    assert.equal(rep.orphanCase, 0)
    assert.equal(rep.consolidatedCases >= 1, true)
    const cap = (await one(`select public.collection_contract_capacity_summary(null) as r`)).r
    const activeContracts = await n(
      `select count(distinct contract_pk)::int as n from public.collection_cases where status in ('open','in_contact','promise_to_pay','unresolved')`
    )
    assert.equal(cap.occupying, activeContracts)
    assert.equal(await runSnapshot(), runBefore)
    // persist AU: nova fatura do contrato 5001 vai para o canônico (secundário consolidated ignorado)
    await client.query(`update public.collection_discovery_runs set status='pagination_ended' where status in ('paused','running','failed')`)
    const claimed = (await one(
      `select public.claim_collection_discovery_run('aw-p',60000,$1,'2026-09-16T12:00:00.000Z'::timestamptz,'2026-09-16'::date,$2,$3,null::uuid) as p`,
      [CONTRACT, TZ, STRATEGY]
    )).p
    const wm = JSON.stringify({ invoice_pk: "500009", client_pk: null, contract_pk: "5001", customer_name: "Fixture", customer_document: "***0000",
      days_overdue: 12, overdue_since: "2026-09-04", outstanding_amount: "100", erp_snapshot: { source: "lab" } })
    const pr = (await one(`select public.persist_collection_contract_invoice($1,$2,$3,$4::uuid,$5::jsonb,true,null) as p`,
      [claimed.run.id, "aw-p", claimed.run.leaseGeneration, ACTOR, wm])).p
    assert.equal(pr.ok, true, JSON.stringify(pr))
    assert.equal(String(pr.caseId), canon)
    assert.equal(await n(`select count(*)::int as n from public.collection_case_invoices where case_id=$1`, [canon]), 4)
    assert.equal(await n(`select count(*)::int as n from public.collection_cases where contract_pk='5001' and status in ('open','in_contact','promise_to_pay','unresolved')`), 1)
  })

  it("AC: eventos de ambos os casos acessíveis pela ponte", async () => {
    const r = await n(
      `select count(*)::int as n from public.collection_case_events e
       where e.case_id = $1 or e.case_id in (select id from public.collection_cases where consolidated_into_case_id = $1)`,
      [canon]
    )
    assert.equal(r >= 3, true)
  })
})

/**
 * Arquitetura — Sprint 3.1 Cobrança + Retenção.
 * Teste textual/puro: não conecta em banco e não executa SQL.
 */

import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import {
  OVERDUE_DISCOVERY_BUSINESS_TIMEZONE,
  OVERDUE_INVOICE_LIST_SORT_FIELD,
} from "@/lib/brbyte/overdue-invoice-list-query"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../..")
const PATCH = "supabase/patch-collections-retention-foundation.sql"

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
])

function stripSqlComments(src: string): string {
  return src
    .replace(/--[^\n]*/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
}

function toPosix(p: string): string {
  return p.split("\\").join("/")
}

function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walkFiles(full, out)
    else if (st.isFile() && /\.(ts|tsx|js|jsx)$/.test(name)) out.push(full)
  }
  return out
}

describe("patch collections retention foundation", () => {
  const patch = readFileSync(join(repoRoot, PATCH), "utf8")
  const norm = stripSqlComments(patch).toLowerCase()

  it("tabelas de caso, evento e contato", () => {
    assert.match(norm, /create table if not exists public\.collection_cases/)
    assert.match(norm, /create table if not exists public\.retention_cases/)
    assert.match(norm, /create table if not exists public\.collection_case_events/)
    assert.match(norm, /create table if not exists public\.retention_case_events/)
    assert.match(norm, /create table if not exists public\.operational_case_contact_attempts/)
  })

  it("P) histórico append-only", () => {
    assert.match(norm, /collection_case_events is append-only/)
    assert.match(norm, /retention_case_events is append-only/)
    assert.match(norm, /before update or delete on public\.collection_case_events/)
    assert.match(norm, /before update or delete on public\.retention_case_events/)
  })

  it("unicidade invoice_pk e escalada", () => {
    assert.match(patch, /collection_cases_invoice_pk_uidx/)
    assert.match(norm, /constraint retention_cases_linked_collection_key unique/)
  })

  it("status de negócio fora do motor", () => {
    assert.equal(/alter table public\.sector_work_assignments/.test(norm), false)
    assert.match(norm, /status text not null default 'open'/)
  })

  it("S) Comercial legado intocado", () => {
    assert.equal(/assign_referral_to_next_commercial/.test(norm), false)
    assert.equal(/claim_referral_lead/.test(norm), false)
    assert.equal(/commercial_lead_settings/.test(norm), false)
    assert.equal(/commercial_profile_id/.test(norm), false)
  })

  it("T) financeiro intocado", () => {
    assert.equal(/alter table public\.rewards/.test(norm), false)
    assert.equal(/insert into public\.rewards/.test(norm), false)
    assert.equal(/wallet_transactions/.test(norm), false)
    assert.equal(/mark_first_invoice_paid/.test(norm), false)
  })

  it("U) motor 2.2 não é reescrito", () => {
    assert.equal(/create or replace function public\.assign_sector_work_item/.test(norm), false)
    assert.equal(/create or replace function public\.pick_next_sector_employee/.test(norm), false)
    assert.match(norm, /assign_sector_work_item\(/)
  })

  it("3.1B assign retention antes de mutar Cobrança; falha dá rollback", () => {
    const fnIdx = patch.indexOf("create or replace function public.escalate_collection_to_retention")
    const fn = patch.slice(fnIdx)
    const firstAttemptMarker = "Assign Retention ANTES de mutar Cobrança"
    const firstAttemptIdx = fn.indexOf(firstAttemptMarker)
    assert.ok(firstAttemptIdx > 0)
    const firstAttempt = fn.slice(firstAttemptIdx)
    const assignIdx = firstAttempt.indexOf("assign_sector_work_item")
    const mutateIdx = firstAttempt.indexOf("set status = 'escalated_retention'")
    assert.ok(assignIdx >= 0 && mutateIdx > assignIdx)
    assert.match(fn, /errcode = 'P0002'/)
    assert.match(fn, /no_retention_employee_available/)
    assert.match(fn, /v_assign_code not in \('assigned', 'already_assigned'\)/)
    assert.equal(/'ok', true[\s\S]{0,80}'already_escalated'[\s\S]{0,200}unique_violation/.test(fn), false)
  })

  it("RLS sem write authenticated; RPC só service_role", () => {
    assert.match(norm, /alter table public\.collection_cases enable row level security/)
    assert.match(norm, /revoke insert, update, delete, truncate on table public\.collection_cases from authenticated/)
    assert.match(
      patch,
      /grant execute on function public\.escalate_collection_to_retention\(uuid, uuid, text\) to service_role/i
    )
    assert.equal(
      /grant\s+execute\s+on\s+function\s+public\.escalate_collection_to_retention[\s\S]{0,80}to\s+authenticated/i.test(
        patch
      ),
      false
    )
    assert.equal(/grant .* to anon/i.test(patch), false)
  })

  it("SECURITY DEFINER com search_path", () => {
    assert.match(norm, /security definer/)
    assert.match(norm, /set search_path = public/)
    assert.match(norm, /^\s*begin\s*;/m)
    assert.match(norm, /^\s*commit\s*;/m)
  })

  it("Membership NÃO autoriza /admin", () => {
    assert.match(patch, /Membership NÃO autoriza \/admin/)
  })

  it("não toca Auth users nem cron vercel", () => {
    assert.equal(/auth\.users/.test(norm), false)
    const vercel = readFileSync(join(repoRoot, "vercel.json"), "utf8")
    assert.equal(/collections/.test(vercel), false)
    assert.equal(/cobranca/.test(vercel), false)
    assert.equal(/retencao/.test(vercel), false)
  })

  it("3.1C settings, history append-only, seed 5 dias", () => {
    assert.match(norm, /create table if not exists public\.operational_sector_settings/)
    assert.match(norm, /create table if not exists public\.operational_attendances/)
    assert.match(norm, /create table if not exists public\.customer_operational_history/)
    assert.match(norm, /customer_operational_history is append-only/)
    assert.match(patch, /minimum_days_overdue', 5/)
    assert.match(norm, /include_cancelled_customers', false/)
  })
})

describe("3.1B mutações exigem ownership ativo", () => {
  const mutationRoutes = [
    "app/api/cobranca/cases/[id]/contact/route.ts",
    "app/api/cobranca/cases/[id]/status/route.ts",
    "app/api/cobranca/cases/[id]/escalate/route.ts",
    "app/api/cobranca/cases/[id]/transfer/route.ts",
    "app/api/cobranca/cases/[id]/close/route.ts",
    "app/api/retencao/cases/[id]/contact/route.ts",
    "app/api/retencao/cases/[id]/status/route.ts",
    "app/api/retencao/cases/[id]/transfer/route.ts",
    "app/api/retencao/cases/[id]/close/route.ts",
  ]

  it("POSTs operacionais usam authorizeOperationalCaseWrite", () => {
    for (const rel of mutationRoutes) {
      const src = readFileSync(join(repoRoot, rel), "utf8")
      assert.match(src, /authorizeOperationalCaseWrite/, rel)
      assert.equal(/authorizeOperationalRequest\(/.test(src), false, rel)
    }
  })

  it("escalate.ts não mascara falha com already_escalated", () => {
    const src = readFileSync(join(repoRoot, "lib/collections/escalate.ts"), "utf8")
    assert.equal(src.includes("parsed.ok || isIdempotentEscalation"), false)
    assert.match(src, /ok:\s*parsed\.ok === true/)
  })

  it("UI Cobrança não expõe escalada automática", () => {
    const src = readFileSync(join(repoRoot, "app/cobranca/[id]/page.tsx"), "utf8")
    assert.equal(src.includes("Escalar retenção"), false)
    assert.equal(src.includes("/escalate"), false)
  })

  it("write Controllr history permanece desligado", () => {
    const src = readFileSync(join(repoRoot, "lib/controllr/customer-history.ts"), "utf8")
    assert.match(src, /CONTROLLR_HISTORY_WRITE_ENABLED/)
    assert.equal(src.includes("brbyteAdminPostForm"), false)
  })
})

describe("3.1E-G sync varre a base Controllr", () => {
  it("lista global de faturas e não depende só de 200 referrals", () => {
    const src = readFileSync(join(repoRoot, "lib/collections/sync.ts"), "utf8")
    assert.match(src, /runOverdueDiscoveryBatch/)
    assert.match(src, /listOverdueInvoicesPage/)
    assert.equal(src.includes("listAllOpenInvoices"), false)
    assert.equal(src.includes("listContractInvoices"), false)
    assert.match(src, /minimumDaysOverdue/)
    assert.equal(src.includes(".limit(200)"), false)
    assert.match(src, /coverageProven: false/)
    assert.match(src, /createOpsDiscoveryStore/)
  })

  it("invoice/list pagina sem contract_pk obrigatório", () => {
    const src = readFileSync(join(repoRoot, "lib/brbyte/invoice-list.ts"), "utf8")
    assert.match(src, /export async function listAllOpenInvoices/)
    assert.match(src, /export async function listOverdueInvoices/)
    assert.match(src, /invoiceListPageQueryForms/)
    assert.match(src, /buildOverdueInvoiceListFormFields/)
    assert.match(src, /buildOverdueInvoiceListKeysetFormFields/)
    assert.match(src, /COLLECTION_INVOICE_LIST_MAX_PAGES/)
    assert.match(src, /OVERDUE_INVOICE_LIST_MAX_PAGES/)
    assert.match(src, /decideInvoiceListPageAdvance/)
    assert.match(src, /maxAttempts: OVERDUE_INVOICE_LIST_HTTP_ATTEMPTS/)
  })

  it("desenho em lotes não é runner de sync", () => {
    const src = readFileSync(join(repoRoot, "lib/collections/batch-sync-design.ts"), "utf8")
    assert.equal(src.includes("brbyteAdminPostForm"), false)
    assert.equal(src.includes("assignSectorWorkItem"), false)
    assert.match(src, /COLLECTION_BATCH_LOCK_KEY/)
    const runner = readFileSync(join(repoRoot, "lib/collections/discovery-runner.ts"), "utf8")
    assert.equal(runner.includes("COLLECTION_BATCH_TIME_BUDGET_MS"), false)
  })

  it("varredura parcial não reconcilia casos ausentes da lista", () => {
    const src = readFileSync(join(repoRoot, "lib/collections/sync.ts"), "utf8")
    assert.equal(/existingByInvoice\.values\(/.test(src), false)
    assert.equal(/existingByInvoice\.forEach/.test(src), false)
    assert.match(src, /scannedPages/)
    assert.match(src, /runOverdueDiscoveryBatch/)
    const persist = readFileSync(join(repoRoot, "lib/collections/discovery-persist.ts"), "utf8")
    assert.match(persist, /decision.action === "close_paid"/)
    assert.match(persist, /decision.action === "reopen"/)
    assert.equal(persist.includes("status: \"close_paid\""), false)
  })
})

describe("3.1E-H consulta de atrasados não contamina consumidores financeiros", () => {
  it("listContractInvoices e primeira fatura não usam o filtro de atrasados", () => {
    const invoiceList = readFileSync(join(repoRoot, "lib/brbyte/invoice-list.ts"), "utf8")
    const firstInvoice = readFileSync(
      join(repoRoot, "lib/brbyte/check-first-invoice.service.ts"),
      "utf8"
    )
    const probe = readFileSync(join(repoRoot, "lib/brbyte/invoice-list-probe.ts"), "utf8")
    const probeResult = readFileSync(
      join(repoRoot, "lib/brbyte/invoice-list-probe-result.ts"),
      "utf8"
    )
    const contractFn = invoiceList.slice(invoiceList.indexOf("export async function listContractInvoices"))
    const overdueFn = invoiceList.slice(invoiceList.indexOf("export async function listOverdueInvoicesPage"))
    const pageFn = invoiceList.slice(
      invoiceList.indexOf("export async function listInvoicesPage"),
      invoiceList.indexOf("export async function listAllOpenInvoices")
    )
    assert.match(contractFn, /where\[contract_pk\]/)
    assert.equal(contractFn.includes("invoice_date_credit"), false)
    assert.equal(pageFn.includes("invoice_date_credit"), false)
    assert.equal(pageFn.includes("buildOverdueInvoiceListFormFields"), false)
    assert.match(overdueFn, /buildOverdueInvoiceListFormFields/)
    assert.match(overdueFn, /maxAttempts: OVERDUE_INVOICE_LIST_HTTP_ATTEMPTS/)
    assert.equal(overdueFn.includes("invoiceListPageQueryForms"), false)
    assert.match(firstInvoice, /listContractInvoices/)
    assert.equal(firstInvoice.includes("listOverdueInvoices"), false)
    assert.equal(firstInvoice.includes("listInvoicesPage"), false)
    assert.equal(probe.includes("listOverdueInvoices"), false)
    assert.match(probeResult, /"client_status"/)
    assert.match(probeResult, /2026-09-01 00:00:00/)
    assert.match(probeResult, /client_complete_name/)
    assert.equal(OVERDUE_INVOICE_LIST_SORT_FIELD, "invoice_pk")
    assert.equal(OVERDUE_DISCOVERY_BUSINESS_TIMEZONE, "America/Sao_Paulo")
    assert.equal(overdueFn.includes("freezeInvoiceListReferenceDate"), false)
  })
})

describe("3.1E-K descoberta retomável", () => {
  it("migration de checkpoint restringe acesso ao backend", () => {
    const patch = readFileSync(
      join(repoRoot, "supabase/patch-collection-discovery-checkpoint.sql"),
      "utf8"
    )
    assert.match(patch, /create table if not exists public\.collection_discovery_runs/)
    assert.match(patch, /lease_generation/)
    assert.match(patch, /claim_collection_discovery_run/)
    assert.match(patch, /advance_collection_discovery_checkpoint/)
    assert.match(patch, /stale_lease/)
    assert.match(patch, /revoke all on table public\.collection_discovery_runs from authenticated/)
    assert.match(patch, /grant execute on function public\.claim_collection_discovery_run/)
    assert.match(patch, /to service_role/)
    assert.equal(/grant execute[\s\S]*claim_collection_discovery_run[\s\S]*to authenticated/i.test(patch), false)
    assert.equal(/vercel\.json/.test(patch), false)
  })

  it("rota de sync permanece autorizada e sem cron", () => {
    const route = readFileSync(join(repoRoot, "app/api/admin/collections/sync/route.ts"), "utf8")
    assert.match(route, /maxDuration = 60/)
    assert.match(route, /authorizeOperationalRequest/)
    assert.match(route, /action: "sync"/)
    const vercel = readFileSync(join(repoRoot, "vercel.json"), "utf8")
    assert.equal(/collections/.test(vercel), false)
  })

  it("update financeiro da descoberta não sobrescreve estágio nem atribuição", () => {
    const persistOps = readFileSync(
      join(repoRoot, "lib/collections/discovery-persist-ops.ts"),
      "utf8"
    )
    const updateFn = persistOps.slice(
      persistOps.indexOf("async updateFinancials"),
      persistOps.indexOf("async recordCreatedEvent")
    )
    assert.equal(updateFn.includes("status"), false)
    assert.equal(updateFn.includes("sector_assignment"), false)
    assert.equal(updateFn.includes("metadata"), false)
    assert.match(updateFn, /outstanding_amount/)
  })
})

describe("3.1E-L persistência fenced", () => {
  it("RPC de persistência valida lease na mesma transação", () => {
    const patch = readFileSync(
      join(repoRoot, "supabase/patch-collection-discovery-fenced-persist.sql"),
      "utf8"
    )
    assert.match(patch, /persist_collection_discovery_invoice/)
    assert.match(patch, /for update/)
    assert.match(patch, /stale_lease/)
    assert.match(patch, /collection_case_events_created_once_uidx/)
    assert.match(patch, /grant execute on function public\.persist_collection_discovery_invoice/)
    assert.match(patch, /to service_role/)
    assert.equal(/grant execute[\s\S]*persist_collection_discovery_invoice[\s\S]*to authenticated/i.test(patch), false)
    const persistOps = readFileSync(join(repoRoot, "lib/collections/discovery-persist-ops.ts"), "utf8")
    assert.match(persistOps, /persist_collection_discovery_invoice/)
    const sync = readFileSync(join(repoRoot, "lib/collections/sync.ts"), "utf8")
    assert.match(sync, /startedAtMs/)
    assert.match(sync, /collectionDiscoveryCappedTimeoutMs/)
    const invoiceInfo = readFileSync(join(repoRoot, "lib/brbyte/invoice-info.ts"), "utf8")
    assert.match(invoiceInfo, /timeoutMs: remainingMs/)
    assert.match(invoiceInfo, /maxAttempts: 1/)
    const runner = readFileSync(join(repoRoot, "lib/collections/discovery-runner.ts"), "utf8")
    assert.match(runner, /statementTimeoutMs/)
    assert.match(runner, /COLLECTION_DISCOVERY_PERSIST_RELEASE_MARGIN_MS/)
  })
})

describe("código 3.1 sem service_role no browser", () => {
  it("libs novas não expõem service role", () => {
    const dirs = [
      join(repoRoot, "lib/collections"),
      join(repoRoot, "lib/retention"),
      join(repoRoot, "app/cobranca"),
      join(repoRoot, "app/retencao"),
    ]
    for (const dir of dirs) {
      for (const file of walkFiles(dir)) {
        if (/\.test\.ts$/.test(file)) continue
        const src = readFileSync(file, "utf8")
        assert.equal(src.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"), false)
        assert.equal(src.includes("createBrowserClient"), false)
      }
    }
  })
})

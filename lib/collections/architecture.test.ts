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
import { DISCOVERY_SKIP_REASONS } from "@/lib/collections/skip-reason"

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
    assert.match(route, /maxDuration = 240/ /* 3.1E-BG */)
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
    // 3.1E-AU: persistência por contrato; RPC legada permanece no SQL para rollback.
    assert.match(persistOps, /persist_collection_contract_invoice/)
    assert.equal(/persist_collection_discovery_invoice/.test(persistOps), false)
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

describe("3.1E-Q reconciliação financeira retomável", () => {
  it("patch restringe RPCs ao service_role e não infere pagamento por ausência", () => {
    const patch = readFileSync(
      join(repoRoot, "supabase/patch-collection-discovery-reconciliation.sql"),
      "utf8"
    )
    assert.match(patch, /reconcile_collection_case_paid/)
    assert.match(patch, /advance_collection_reconciliation_checkpoint/)
    assert.match(patch, /collection_case_events_payment_detected_once_uidx/)
    assert.match(patch, /phases_completed/)
    assert.match(patch, /grant execute on function public\.reconcile_collection_case_paid/)
    assert.match(patch, /to service_role/)
    assert.equal(
      /grant execute[\s\S]*reconcile_collection_case_paid[\s\S]*to authenticated/i.test(patch),
      false
    )
    assert.match(patch, /NÃO vira close_paid/)
    const persist = readFileSync(join(repoRoot, "lib/collections/discovery-persist.ts"), "utf8")
    assert.match(persist, /decision.action === "close_paid"/)
    const runner = readFileSync(join(repoRoot, "lib/collections/discovery-runner.ts"), "utf8")
    assert.match(runner, /fetchInvoiceDetail/)
    assert.match(runner, /runReconciliation/)
    const recon = readFileSync(join(repoRoot, "lib/collections/reconciliation.ts"), "utf8")
    assert.match(recon, /inconclusive/)
    assert.match(recon, /inconclusive_removal_indicator/)
    const sync = readFileSync(join(repoRoot, "lib/collections/sync.ts"), "utf8")
    assert.match(sync, /classifyInvoiceDetailForReconciliation/)
    assert.match(sync, /closedPaid: batch.closedPaid/)
    assert.match(sync, /settings.isEnabled === false/)
    assert.match(sync, /discoveryStatus: "disabled"/)
    assert.match(runner, /missing_migration/)
    assert.match(runner, /Não marca conclusão das fases/)
    const page = readFileSync(join(repoRoot, "app/cobranca/page.tsx"), "utf8")
    assert.match(page, /discoveryStatus/)
    assert.match(page, /toast\.message/)
    assert.equal(/toast\.success\(\s*json\.message/.test(page), false)
  })
})

describe("3.1E-O timeout HTTP cobre o corpo", () => {
  it("helper operacional delega deadline único e preserva timeout do runner", () => {
    const adminHttp = readFileSync(join(repoRoot, "lib/brbyte/admin-http.ts"), "utf8")
    const request = readFileSync(join(repoRoot, "lib/brbyte/admin-http-request.ts"), "utf8")
    const invoiceInfo = readFileSync(join(repoRoot, "lib/brbyte/invoice-info.ts"), "utf8")
    const runner = readFileSync(join(repoRoot, "lib/collections/discovery-runner.ts"), "utf8")
    const contract = readFileSync(join(repoRoot, "lib/collections/discovery-contract.ts"), "utf8")
    assert.match(adminHttp, /timeoutMs: options\?\.timeoutMs \?\? config\.timeoutMs/)
    assert.match(adminHttp, /postControllrForm/)
    assert.match(adminHttp, /loginControllr/)
    assert.match(request, /const text = await res\.text\(\)/)
    assert.match(request, /CONTROLLR_HTTP_ABORT_DOES_NOT_CANCEL_SERVER = true/)
    assert.match(request, /CONTROLLR_HTTP_SYNC_PARSE_NOT_PREEMPTIVE = true/)
    assert.match(invoiceInfo, /timeoutMs: remainingMs/)
    assert.match(runner, /collectionDiscoveryCappedTimeoutMs/)
    assert.match(contract, /COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_S = 240/ /* 3.1E-BG */)
    assert.match(contract, /COLLECTION_DISCOVERY_PLATFORM_MARGIN_MS = 20_000/ /* 3.1E-BG */)
    assert.match(contract, /COLLECTION_DISCOVERY_LOGIN_TIMEOUT_MS = 30_000/)
    assert.match(contract, /COLLECTION_DISCOVERY_LIST_TIMEOUT_MS = 70_000/ /* 3.1E-BG */)
    assert.match(contract, /COLLECTION_DISCOVERY_MAX_PAGES_PER_BATCH = 4/)
    assert.match(contract, /COLLECTION_DISCOVERY_LEASE_MS/)
    assert.match(contract, /COLLECTION_DISCOVERY_PAGE_PERSIST_RESERVE_MS = 12_000/ /* 3.1E-BG */)
    assert.match(contract, /COLLECTION_DISCOVERY_MAX_CONSECUTIVE_NO_PROGRESS = 2/)
    assert.equal(contract.includes("COLLECTION_DISCOVERY_TIME_BUDGET_MS = 90"), false)
    assert.equal(contract.includes("COLLECTION_DISCOVERY_ROUTE_MAX_DURATION_S = 60"), false)
  })
})

describe("3.1E-V garantia de progresso", () => {
  it("patch local não expõe PII e não altera assinaturas RPC existentes", () => {
    const patch = readFileSync(
      join(repoRoot, "supabase/patch-collection-discovery-progress-guarantee.sql"),
      "utf8"
    )
    assert.match(patch, /consecutive_no_progress/)
    assert.match(patch, /consecutive_no_progress \+ 1/)
    assert.match(patch, /Desbloqueio humano/)
    assert.match(patch, /zero_progress_loop/)
    assert.match(patch, /grant execute on function public\.release_collection_discovery_run/)
    assert.match(patch, /to service_role/)
    assert.equal(/grant execute[\s\S]*release_collection_discovery_run[\s\S]*to authenticated/i.test(patch), false)
    assert.equal(patch.includes("cookie"), false)
    assert.equal(/password|authorization|bearer|secret/i.test(patch), false)
    const runner = readFileSync(join(repoRoot, "lib/collections/discovery-runner.ts"), "utf8")
    assert.match(runner, /collectionDiscoveryListTimeoutMs/)
    assert.match(runner, /pauseNoProgress/)
    assert.match(runner, /awaitListPageOrTimeout/)
    const route = readFileSync(join(repoRoot, "app/api/admin/collections/sync/route.ts"), "utf8")
    assert.match(route, /maxDuration = 240/ /* 3.1E-BG */)
    const sync = readFileSync(join(repoRoot, "lib/collections/sync.ts"), "utf8")
    assert.match(sync, /COLLECTION_DISCOVERY_LOGIN_TIMEOUT_MS/)
    assert.match(
      sync,
      /COLLECTION_DISCOVERY_LIST_TIMEOUT_MS \+ COLLECTION_DISCOVERY_PAGE_PERSIST_RESERVE_MS/
    )
  })
})

describe("3.1E-AA elegibilidade e observabilidade de skips", () => {
  it("histograma sanitizado, corte de 5 dias e cancelamento não inventado", () => {
    const skip = readFileSync(join(repoRoot, "lib/collections/skip-reason.ts"), "utf8")
    const runner = readFileSync(join(repoRoot, "lib/collections/discovery-runner.ts"), "utf8")
    const sync = readFileSync(join(repoRoot, "lib/collections/sync.ts"), "utf8")
    const query = readFileSync(join(repoRoot, "lib/brbyte/overdue-invoice-list-query.ts"), "utf8")
    const cancelled = readFileSync(join(repoRoot, "lib/operational/cancelled.ts"), "utf8")
    const contract = readFileSync(join(repoRoot, "lib/collections/discovery-contract.ts"), "utf8")
    assert.match(skip, /DISCOVERY_SKIP_REASONS/)
    assert.match(skip, /not_old_enough/)
    assert.match(skip, /paid_without_open_case/)
    assert.match(skip, /inconclusive/)
    assert.equal(
      (DISCOVERY_SKIP_REASONS as readonly string[]).includes("cancelled_client_or_contract"),
      false
    )
    assert.equal(
      (DISCOVERY_SKIP_REASONS as readonly string[]).includes("cancelled_client"),
      false
    )
    assert.equal(
      (DISCOVERY_SKIP_REASONS as readonly string[]).includes("cancelled_contract"),
      true
    )
    assert.match(runner, /incrementDiscoverySkip/)
    assert.match(sync, /skipReasons/)
    assert.match(query, /queryCutoffExclusiveUtc/)
    assert.match(query, /eligibilityReferenceDateUtcFromInstant/)
    assert.match(query, /minimumDaysOverdue - 1/)
    assert.match(query, /invoice_deleted/)
    assert.equal(query.includes("contract_status"), false)
    assert.match(cancelled, /CANCELLED_SCOPE_NOT_PROVEN/)
    assert.match(cancelled, /CONTRACT_CANCELLED_PROVEN/)
    assert.match(cancelled, /CANCELED: 5/)
    assert.match(cancelled, /BLOCKED: 4/)
    assert.match(contract, /overdue-invoice-list.keyset.v1/)
    assert.match(contract, /scannedInvoices = rows_seen/)
    assert.equal(skip.includes("invoice_pk"), true)
    assert.equal(/create table[\s\S]*skip_reasons/i.test(runner), false)
  })
})

describe("3.1E-AH supersede auditável", () => {
  it("RPC fenced, fora do índice resumível, ausente do runner e do Sync", () => {
    const patch = readFileSync(
      join(repoRoot, "supabase/patch-collection-discovery-supersede.sql"),
      "utf8"
    )
    const lab = readFileSync(join(repoRoot, "scripts/local-pg-collections-lab/run.mjs"), "utf8")
    const runner = readFileSync(join(repoRoot, "lib/collections/discovery-runner.ts"), "utf8")
    const sync = readFileSync(join(repoRoot, "lib/collections/sync.ts"), "utf8")
    const route = readFileSync(
      join(repoRoot, "app/api/admin/collections/sync/route.ts"),
      "utf8"
    )
    const store = readFileSync(join(repoRoot, "lib/collections/discovery-store.ts"), "utf8")
    const ops = readFileSync(join(repoRoot, "lib/collections/discovery-store-ops.ts"), "utf8")
    const contract = readFileSync(
      join(repoRoot, "lib/collections/discovery-contract.ts"),
      "utf8"
    )
    const checkpoint = readFileSync(
      join(repoRoot, "lib/collections/discovery-checkpoint.ts"),
      "utf8"
    )
    const internal = readFileSync(
      join(repoRoot, "lib/collections/discovery-supersede-ops.ts"),
      "utf8"
    )
    const page = readFileSync(join(repoRoot, "app/cobranca/page.tsx"), "utf8")

    assert.match(patch, /supersede_collection_discovery_run/)
    assert.match(patch, /status = 'superseded'/)
    assert.match(patch, /pg_advisory_xact_lock\(872145, 31\)/)
    assert.match(patch, /due_date_parser_bug/)
    assert.match(patch, /p_expected_status/)
    assert.match(patch, /p_expected_lease_generation/)
    assert.match(patch, /already_superseded/)
    assert.match(patch, /grant execute on function public\.supersede_collection_discovery_run/)
    assert.match(patch, /to service_role/)
    assert.match(patch, /set search_path = public/)
    assert.match(patch, /where status in \('running', 'paused', 'failed'\)/)
    assert.match(
      patch,
      /status in \('pagination_ended', 'phases_completed', 'superseded'\)/
    )
    assert.equal(/grant execute[\s\S]*supersede_collection_discovery_run[\s\S]*to authenticated/i.test(patch), false)
    assert.equal(patch.includes("insert into public.collection_cases"), false)
    assert.equal(patch.includes("update public.collection_cases"), false)
    assert.equal(patch.includes("delete from public.collection_cases"), false)
    assert.equal(patch.includes("collection_case_events"), false)
    assert.equal(patch.includes("assign_sector_work_item"), false)
    assert.equal(patch.includes("coverage_proven = true"), false)
    assert.equal(patch.includes("unique_order_proven = true"), false)
    assert.equal(patch.includes("cursor_last_invoice_pk = null"), false)
    assert.equal(/scanned_pages\s*=\s*0/.test(patch), false)
    assert.match(lab, /patch-collection-discovery-supersede\.sql/)

    assert.match(contract, /superseded/)
    assert.match(contract, /due_date_parser_bug/)
    assert.match(checkpoint, /run\.status === "superseded"/)
    assert.match(internal, /import "server-only"/)
    assert.match(internal, /supersede_collection_discovery_run/)
    assert.match(internal, /Não é chamada pelo runner/)

    assert.equal(runner.includes("supersede_collection_discovery_run"), false)
    assert.equal(runner.includes('status: "superseded"'), false)
    assert.equal(sync.includes("supersede_collection_discovery_run"), false)
    assert.equal(sync.includes("superseded"), false)
    assert.equal(route.includes("supersede_collection_discovery_run"), false)
    assert.equal(ops.includes("supersede_collection_discovery_run"), false)
    assert.equal(store.includes("supersedeCollectionDiscoveryRun"), false)
    assert.equal(page.includes("supersede_collection_discovery_run"), false)
    assert.equal(page.includes("due_date_parser_bug"), false)
  })
})


describe("3.1E-AN health probe de listagem sancionada", () => {
  it("rota reutilizada, modo health read-only e sem imports de runner/persistência", () => {
    const route = readFileSync(
      join(repoRoot, "app/api/admin/collections/invoice-list-probe/route.ts"),
      "utf8"
    )
    const health = readFileSync(
      join(repoRoot, "lib/brbyte/invoice-list-health-probe.ts"),
      "utf8"
    )
    const healthResult = readFileSync(
      join(repoRoot, "lib/brbyte/invoice-list-health-probe-result.ts"),
      "utf8"
    )
    const snapshot = readFileSync(
      join(repoRoot, "lib/collections/discovery-run-snapshot.ts"),
      "utf8"
    )
    const oldProbe = readFileSync(join(repoRoot, "lib/brbyte/invoice-list-probe.ts"), "utf8")
    const syncRoute = readFileSync(
      join(repoRoot, "app/api/admin/collections/sync/route.ts"),
      "utf8"
    )

    assert.match(route, /overdue_first_page_health|OVERDUE_FIRST_PAGE_HEALTH_MODE/)
    assert.match(route, /maxDuration = 120/)
    assert.match(route, /runOverdueFirstPageHealthProbe/)
    assert.match(route, /runInvoiceListProbe/)
    assert.match(health, /listOverdueInvoicesPage/)
    assert.match(health, /readUniqueResumableDiscoveryRunSnapshot/)
    assert.match(health, /loadCollectionOperationalSettings/)
    assert.match(healthResult, /OVERDUE_FIRST_PAGE_HEALTH_TIMEOUT_MAX_MS = 60_000/)
    assert.match(healthResult, /OVERDUE_FIRST_PAGE_HEALTH_ATTEMPTS = 1/)
    assert.match(snapshot, /readUniqueResumableDiscoveryRunSnapshot/)
    assert.match(snapshot, /\.select\(/)
    assert.equal(snapshot.includes(".update("), false)
    assert.equal(snapshot.includes(".insert("), false)
    assert.equal(snapshot.includes("claim_collection_discovery_run"), false)
    assert.equal(snapshot.includes("advance_collection_discovery_checkpoint"), false)
    assert.equal(snapshot.includes("release_collection_discovery_run"), false)
    assert.equal(health.includes("@/lib/collections/discovery-runner"), false)
    assert.equal(health.includes("@/lib/collections/discovery-persist"), false)
    assert.equal(health.includes("@/lib/collections/reconciliation"), false)
    assert.equal(health.includes("assign_sector_work_item"), false)
    assert.equal(route.includes("@/lib/collections/discovery-runner"), false)
    assert.equal(oldProbe.includes("listOverdueInvoices"), false)
    assert.match(syncRoute, /maxDuration = 240/ /* 3.1E-BG */)
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

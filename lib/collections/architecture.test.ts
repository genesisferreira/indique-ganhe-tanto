/**
 * Arquitetura — Sprint 3.1 Cobrança + Retenção.
 * Teste textual/puro: não conecta em banco e não executa SQL.
 */

import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

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

/**
 * Arquitetura — Sprint 2.2: motor genérico de atribuição por setor.
 * Teste textual/puro: não conecta em banco.
 */

import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../..")
const PATCH = "supabase/patch-generic-sector-assignment-engine.sql"

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

describe("patch generic sector assignment engine", () => {
  const patch = readFileSync(join(repoRoot, PATCH), "utf8")
  const norm = stripSqlComments(patch).toLowerCase()

  it("tabelas esperadas", () => {
    assert.match(norm, /create table if not exists public\.sector_assignment_settings/)
    assert.match(norm, /create table if not exists public\.employee_sector_assignment_settings/)
    assert.match(norm, /create table if not exists public\.sector_work_assignments/)
    assert.match(norm, /create table if not exists public\.sector_assignment_events/)
  })

  it("work_type + work_id polimórfico sem FK impossível", () => {
    assert.match(norm, /work_type text not null/)
    assert.match(norm, /work_id uuid not null/)
    assert.equal(/work_id uuid not null references/.test(norm), false)
  })

  it("unique parcial: uma assignment ativa por setor+work", () => {
    assert.match(patch, /create unique index if not exists sector_work_assignments_active_uidx/)
    assert.match(norm, /\(sector_id, work_type, work_id\)/)
    assert.match(norm, /where status = 'active'/)
  })

  it("2.2B lookup operacional só via membership ativa ou membership_id gravado", () => {
    assert.match(norm, /create or replace function public\.lock_active_sector_assignment_settings/)
    assert.match(norm, /m\.is_active = true/)
    const assignIdx = norm.indexOf("create or replace function public.assign_sector_work_item")
    const assignBody = norm.slice(
      assignIdx,
      norm.indexOf("create or replace function public.transfer_sector_assignment")
    )
    assert.match(assignBody, /lock_active_sector_assignment_settings/)
    assert.equal(/into strict/.test(assignBody), false)

    const transferIdx = norm.indexOf("create or replace function public.transfer_sector_assignment")
    const transferBody = norm.slice(
      transferIdx,
      norm.indexOf("create or replace function public.release_sector_assignment")
    )
    assert.match(transferBody, /lock_active_sector_assignment_settings/)
    assert.match(transferBody, /where membership_id = v_asg\.membership_id/)

    const releaseIdx = norm.indexOf("create or replace function public.release_sector_assignment")
    const releaseBody = norm.slice(
      releaseIdx,
      norm.indexOf("create or replace function public.claim_sector_work_item")
    )
    assert.match(releaseBody, /where membership_id = v_asg\.membership_id/)
    assert.equal(
      /where employee_id = v_asg\.employee_id\s+and sector_id = v_asg\.sector_id/.test(releaseBody),
      false
    )

    const claimIdx = norm.indexOf("create or replace function public.claim_sector_work_item")
    const claimBody = norm.slice(claimIdx)
    assert.match(claimBody, /lock_active_sector_assignment_settings/)
  })

  it("I) unique parcial 2.1: uma membership ativa por employee+sector", () => {
    const foundation = readFileSync(
      join(repoRoot, "supabase/patch-employee-sector-foundation.sql"),
      "utf8"
    )
    assert.match(foundation, /create unique index if not exists employee_sector_memberships_active_uidx/)
    assert.match(foundation, /on public\.employee_sector_memberships \(employee_id, sector_id\)/)
    assert.match(foundation, /where is_active = true/)
  })

  it("R) transfer bloqueia inelegível", () => {
    const transferIdx = norm.indexOf("create or replace function public.transfer_sector_assignment")
    const transferBody = norm.slice(transferIdx)
    assert.match(transferBody, /is_sector_employee_assignment_eligible/)
    assert.match(transferBody, /code', 'not_eligible'/)
  })

  it("T) histórico append-only preservado", () => {
    assert.match(norm, /sector_assignment_events is append-only/)
    assert.match(norm, /before update or delete on public\.sector_assignment_events/)
    assert.equal(/delete from public\.sector_work_assignments/.test(norm), false)
    assert.equal(/delete from public\.sector_assignment_events/.test(norm), false)
  })

  it("U) anon sem acesso", () => {
    for (const table of [
      "sector_assignment_settings",
      "employee_sector_assignment_settings",
      "sector_work_assignments",
      "sector_assignment_events",
    ]) {
      assert.match(norm, new RegExp(`revoke all on table public\\.${table} from anon`))
    }
    assert.equal(/grant .* to anon/i.test(patch), false)
  })

  it("V) authenticated não escreve livremente", () => {
    assert.match(norm, /revoke insert, update, delete, truncate on table public\.sector_work_assignments from authenticated/)
    assert.match(norm, /revoke insert, update, delete, truncate on table public\.sector_assignment_events from authenticated/)
    assert.equal(/create policy[\s\S]{0,200}for insert/i.test(patch), false)
    assert.equal(/create policy[\s\S]{0,200}for update/i.test(patch), false)
    assert.equal(/create policy[\s\S]{0,200}for delete/i.test(patch), false)
    assert.equal(/using\s*\(\s*true\s*\)/i.test(patch), false)
  })

  it("W) membership não concede admin", () => {
    assert.equal(/is_admin_master\(\)[\s\S]{0,40}membership/i.test(norm), false)
    assert.match(patch, /Membership NÃO autoriza/)
  })

  it("X) Comercial legado não foi alterado", () => {
    assert.equal(/create or replace function public\.assign_referral_to_next_commercial/.test(norm), false)
    assert.equal(/create or replace function public\.pick_next_available_commercial/.test(norm), false)
    assert.equal(/create or replace function public\.claim_referral_lead/.test(norm), false)
    assert.equal(/alter table public\.commercial_lead_settings/.test(norm), false)
    assert.equal(/alter table public\.commercial_availability/.test(norm), false)
    assert.equal(/commercial_profile_id/.test(norm), false)
  })

  it("Y) SLA legado não foi alterado", () => {
    assert.equal(/redistribute_overdue_commercial_leads/.test(norm), false)
    assert.equal(/redistribute_single_commercial_lead/.test(norm), false)
    assert.equal(/detect_commercial_sla/.test(norm), false)
  })

  it("Z) financeiro 1.2R-D não foi alterado", () => {
    assert.equal(/mark_first_invoice_paid/.test(norm), false)
    assert.equal(/referral_is_financially_eligible/.test(norm), false)
    assert.equal(/alter table public\.rewards/.test(norm), false)
    assert.equal(/insert into public\.rewards/.test(norm), false)
    assert.equal(/insert into public\.wallet_transactions/.test(norm), false)
  })

  it("AA) assisted referral não foi alterado", () => {
    assert.equal(/commercial_assisted/.test(norm), false)
    assert.equal(/assisted_indicator/.test(norm), false)
  })

  it("AB) BRByte/Controllr não foi alterado", () => {
    assert.equal(/brbyte/.test(norm), false)
    assert.equal(/controllr/.test(norm), false)
    assert.equal(/auth\.users/.test(norm), false)
  })

  it("RLS enabled + SECURITY DEFINER search_path", () => {
    assert.match(norm, /alter table public\.sector_assignment_settings enable row level security/)
    assert.match(norm, /alter table public\.employee_sector_assignment_settings enable row level security/)
    assert.match(norm, /alter table public\.sector_work_assignments enable row level security/)
    assert.match(norm, /alter table public\.sector_assignment_events enable row level security/)
    assert.match(norm, /security definer/)
    assert.match(norm, /set search_path = public/)
    assert.match(norm, /^\s*begin\s*;/m)
    assert.match(norm, /^\s*commit\s*;/m)
  })

  it("concorrência: advisory lock + FOR UPDATE + unique_violation", () => {
    assert.match(norm, /pg_advisory_xact_lock/)
    assert.match(norm, /for update of es/)
    assert.match(norm, /when unique_violation then/)
  })

  it("RPCs internas: sem EXECUTE authenticated/anon/public", () => {
    for (const fn of [
      "assign_sector_work_item",
      "pick_next_sector_employee",
      "transfer_sector_assignment",
      "release_sector_assignment",
      "claim_sector_work_item",
      "is_sector_employee_assignment_eligible",
      "lock_active_sector_assignment_settings",
    ]) {
      assert.match(
        norm,
        new RegExp(`revoke all on function public\\.${fn}[\\s\\S]{0,120}from authenticated`)
      )
      assert.match(
        patch,
        new RegExp(
          `grant execute on function public\\.${fn}[\\s\\S]{0,120}to service_role`,
          "i"
        )
      )
    }
    assert.equal(
      /grant\s+execute\s+on\s+function\s+public\.assign_sector_work_item[\s\S]{0,80}to\s+authenticated/i.test(
        patch
      ),
      false
    )
  })

  it("claim não usa auth.uid como autorização", () => {
    const claimIdx = norm.indexOf("create or replace function public.claim_sector_work_item")
    const claimBody = norm.slice(claimIdx)
    assert.equal(/auth\.uid\(\)/.test(claimBody), false)
    assert.match(claimBody, /p_employee_id/)
  })

  it("código TS novo não usa service_role no browser", () => {
    const files = walkFiles(join(repoRoot, "lib/assignments")).filter(
      (f) => !/\.test\.ts$/.test(f)
    )
    assert.ok(files.length > 0)
    for (const file of files) {
      const src = readFileSync(file, "utf8")
      assert.equal(src.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"), false)
      assert.equal(src.includes("createBrowserClient"), false)
      assert.ok(toPosix(file).includes("lib/assignments/"))
    }
  })
})

/**
 * Arquitetura — Sprint 2.1: fundação employees / sectors / memberships / events.
 * Teste textual/puro: não conecta em banco.
 */

import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { INITIAL_SECTOR_CODES } from "@/types/employee"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../..")
const PATCH = "supabase/patch-employee-sector-foundation.sql"

const FINANCIAL_PATCHES = [
  "supabase/patch-financial-reward-eligibility-hardening.sql",
  "supabase/patch-first-invoice-reward-from-controllr-amount.sql",
  "supabase/patch-mark-first-invoice-notify-indicator.sql",
]
const SLA_PATCHES = [
  "supabase/patch-sla-rpc-service-role-only.sql",
  "supabase/patch-sla-helper-rpc-service-role-only.sql",
]
const COMMERCIAL_TABLES = [
  "supabase/patch-commercial-lead-distribution.sql",
  "supabase/schema.sql",
]

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

describe("patch employee sector foundation", () => {
  const patch = readFileSync(join(repoRoot, PATCH), "utf8")
  const norm = stripSqlComments(patch).toLowerCase()

  it("A) employees 1:1 com profile (unique + FK restrict)", () => {
    assert.match(norm, /constraint employees_profile_id_key unique \(profile_id\)/)
    assert.match(
      norm,
      /profile_id uuid not null references public\.profiles\(id\) on delete restrict/
    )
  })

  it("B) memberships N:N employee × sector", () => {
    assert.match(norm, /create table if not exists public\.employee_sector_memberships/)
    assert.match(norm, /employee_id uuid not null references public\.employees/)
    assert.match(norm, /sector_id uuid not null references public\.sectors/)
  })

  it("C) unique parcial impede dois memberships ativos iguais", () => {
    assert.match(
      patch,
      /create unique index if not exists employee_sector_memberships_active_uidx/
    )
    assert.match(norm, /where is_active = true/)
  })

  it("D) histórico: left_at + is_active false; sem delete de vínculo antigo", () => {
    assert.match(norm, /left_at timestamptz/)
    assert.equal(/\bdelete from public\.employee_sector_memberships\b/.test(norm), false)
  })

  it("E–I) enum employee_status com os 5 estados", () => {
    for (const s of ["active", "paused", "vacation", "away", "dismissed"]) {
      assert.match(patch, new RegExp(`'${s}'`))
    }
  })

  it("J) setores são tabela, não enum de lista", () => {
    assert.match(norm, /create table if not exists public\.sectors/)
    assert.equal(/create type public\.sector/.test(norm), false)
    assert.match(norm, /constraint sectors_code_key unique \(code\)/)
  })

  it("K) os 7 setores iniciais existem no seed", () => {
    for (const code of INITIAL_SECTOR_CODES) {
      assert.match(patch, new RegExp(`'${code}'`))
    }
    assert.match(patch, /Comercial/)
    assert.match(patch, /Cobrança/)
    assert.match(patch, /Retenção/)
    assert.match(patch, /Pós-venda/)
    assert.match(patch, /Upgrade/)
    assert.match(patch, /Técnico/)
    assert.match(patch, /Vendas Externas/)
  })

  it("L) backfill só role comercial + membership commercial", () => {
    assert.match(patch, /p\.role = 'comercial'::public\.user_role/)
    assert.match(patch, /s\.code = 'commercial'/)
    assert.match(norm, /on conflict \(profile_id\) do nothing/)
    assert.equal(/p\.role = 'indicador'/.test(norm), false)
  })

  it("M) não altera commercial_lead_settings destrutivamente", () => {
    assert.equal(/drop table .*commercial_lead_settings/i.test(patch), false)
    assert.equal(/alter table public\.commercial_lead_settings/i.test(patch), false)
  })

  it("N) não altera commercial_availability destrutivamente", () => {
    assert.equal(/drop table .*commercial_availability/i.test(patch), false)
    assert.equal(/alter table public\.commercial_availability/i.test(patch), false)
  })

  it("O) nenhuma alteração em rewards/wallet", () => {
    assert.equal(/\brewards\b/.test(norm.split("comment")[0] ?? norm) && /alter table public\.rewards/.test(norm), false)
    assert.equal(/alter table public\.rewards/i.test(patch), false)
    assert.equal(/alter table public\.wallet_transactions/i.test(patch), false)
    assert.equal(/insert into public\.rewards/i.test(patch), false)
    assert.equal(/insert into public\.wallet_transactions/i.test(patch), false)
  })

  it("P) não altera grants financeiros", () => {
    assert.equal(/mark_first_invoice_paid/i.test(patch), false)
    assert.equal(/mark_first_invoice_paid_from_sync/i.test(patch), false)
  })

  it("Q) não altera helpers/RPC SLA", () => {
    assert.equal(/assign_referral_to_next_commercial/i.test(patch), false)
    assert.equal(/pick_next_available_commercial/i.test(patch), false)
    assert.equal(/detect_commercial_sla/i.test(patch), false)
    assert.equal(/redistribute_overdue_commercial_leads/i.test(patch), false)
  })

  it("R) anon não recebe acesso indevido", () => {
    assert.match(norm, /revoke all on table public\.employees from anon/)
    assert.match(norm, /revoke all on table public\.sectors from anon/)
    assert.match(norm, /revoke all on table public\.employee_sector_memberships from anon/)
    assert.match(norm, /revoke all on table public\.employee_events from anon/)
    assert.equal(/grant .* to anon/i.test(patch), false)
  })

  it("S) authenticated não recebe escrita irrestrita", () => {
    assert.match(norm, /revoke insert, update, delete on table public\.employees from authenticated/)
    assert.match(norm, /revoke insert, update, delete on table public\.sectors from authenticated/)
    assert.match(
      norm,
      /revoke insert, update, delete on table public\.employee_sector_memberships from authenticated/
    )
    assert.equal(/using\s*\(\s*true\s*\)/i.test(patch), false)
    assert.equal(/with check\s*\(\s*true\s*\)/i.test(patch), false)
    assert.equal(/create policy[\s\S]{0,200}for insert/i.test(patch), false)
    assert.equal(/create policy[\s\S]{0,200}for update/i.test(patch), false)
    assert.equal(/create policy[\s\S]{0,200}for delete/i.test(patch), false)
  })

  it("T) patch não introduz service role no client; client continua só anon", () => {
    const clientSrc = readFileSync(join(repoRoot, "lib/supabase/client.ts"), "utf8")
    assert.match(clientSrc, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
    assert.equal(clientSrc.includes("SUPABASE_SERVICE_ROLE_KEY"), false)
    assert.equal(/NEXT_PUBLIC_[A-Z0-9_]*SERVICE_ROLE/.test(clientSrc), false)
    assert.equal(patch.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"), false)
  })

  it("transação + search_path em SECURITY DEFINER + eventos", () => {
    assert.match(norm, /^\s*begin\s*;/m)
    assert.match(norm, /^\s*commit\s*;/m)
    assert.match(norm, /event_type text not null/)
    assert.match(patch, /employee_created/)
    assert.match(patch, /status_changed/)
    assert.match(patch, /sector_added/)
    assert.match(patch, /sector_removed/)
    assert.match(norm, /security definer/)
    assert.match(norm, /set search_path = public/)
    assert.equal(/\bdisable\s+trigger\b/i.test(norm), false)
    assert.equal(/session_replication_role/i.test(norm), false)
  })

  it("patches financeiros e SLA versionados permanecem intactos neste commit relativo", () => {
    for (const rel of [...FINANCIAL_PATCHES, ...SLA_PATCHES, ...COMMERCIAL_TABLES]) {
      const src = readFileSync(join(repoRoot, rel), "utf8")
      assert.ok(src.length > 20, rel)
    }
  })

  it("nenhum TS client importa createServiceRoleClient neste sprint (superfície browser)", () => {
    const files = walkFiles(join(repoRoot, "lib/supabase"))
    const client = files.find((f) => toPosix(f).endsWith("lib/supabase/client.ts"))
    assert.ok(client)
    const src = readFileSync(client!, "utf8")
    assert.equal(src.includes("createServiceRoleClient"), false)
  })
})

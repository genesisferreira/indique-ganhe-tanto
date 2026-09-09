/**
 * Arquitetura — hotfix P1: RPCs SLA só service_role.
 *
 * Garante que o patch restringe EXECUTE e que o app não chama as RPCs
 * a partir do browser / client authenticated.
 */

import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../..")

const PATCH = "supabase/patch-sla-rpc-service-role-only.sql"

const PRIVILEGED_RPCS = [
  "detect_commercial_sla_escalations",
  "redistribute_overdue_commercial_leads",
  "detect_overdue_commercial_leads",
] as const

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
])

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
    if (st.isDirectory()) {
      walkFiles(full, out)
    } else if (st.isFile() && /\.(ts|tsx|js|jsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

function isTestFile(relPosix: string): boolean {
  return (
    /\.test\.(ts|tsx|js|jsx)$/.test(relPosix) ||
    /\.wiring\.test\.(ts|tsx)$/.test(relPosix) ||
    /\/__tests__\//.test(relPosix)
  )
}

function isClientComponent(relPosix: string, src: string): boolean {
  if (src.startsWith("'use client'") || src.startsWith('"use client"')) {
    return true
  }
  // Páginas/componentes típicos de browser (fora de app/api e lib server-only)
  if (relPosix.startsWith("components/") || relPosix.startsWith("app/")) {
    if (relPosix.includes("/api/")) return false
    if (relPosix.endsWith("page.tsx") || relPosix.endsWith("layout.tsx")) {
      return true
    }
  }
  return false
}

describe("SLA RPC grants — service_role only", () => {
  const patchSrc = readFileSync(join(repoRoot, PATCH), "utf8")
  const cronSlaSrc = readFileSync(
    join(repoRoot, "lib/cron/commercial-sla.ts"),
    "utf8"
  )
  const cronRouteSrc = readFileSync(
    join(repoRoot, "app/api/cron/commercial-sla/route.ts"),
    "utf8"
  )

  it("1) patch existe e cobre as 3 RPCs privilegiadas", () => {
    for (const fn of PRIVILEGED_RPCS) {
      assert.match(
        patchSrc,
        new RegExp(
          `revoke all on function public\\.${fn}\\(\\) from authenticated`,
          "i"
        ),
        `deve revogar authenticated de ${fn}`
      )
      assert.match(
        patchSrc,
        new RegExp(
          `grant execute on function public\\.${fn}\\(\\) to service_role`,
          "i"
        ),
        `deve conceder service_role a ${fn}`
      )
    }
  })

  it("2) patch revoga PUBLIC e anon", () => {
    for (const fn of PRIVILEGED_RPCS) {
      assert.match(
        patchSrc,
        new RegExp(
          `revoke all on function public\\.${fn}\\(\\) from public`,
          "i"
        )
      )
      assert.match(
        patchSrc,
        new RegExp(
          `revoke all on function public\\.${fn}\\(\\) from anon`,
          "i"
        )
      )
    }
  })

  it("3) patch NÃO altera corpo das funções (sem CREATE OR REPLACE)", () => {
    assert.equal(
      /create\s+or\s+replace\s+function/i.test(patchSrc),
      false,
      "hotfix deve ser só grants, sem redefinir funções"
    )
  })

  it("4) patches originais ainda documentam SECURITY DEFINER das RPCs", () => {
    const escalation = readFileSync(
      join(repoRoot, "supabase/patch-commercial-sla-escalation.sql"),
      "utf8"
    )
    const redistribution = readFileSync(
      join(repoRoot, "supabase/patch-commercial-sla-redistribution.sql"),
      "utf8"
    )
    assert.match(
      escalation,
      /create or replace function public\.detect_commercial_sla_escalations\(\)[\s\S]*?security definer/i
    )
    assert.match(
      redistribution,
      /create or replace function public\.redistribute_overdue_commercial_leads\(\)[\s\S]*?security definer/i
    )
  })

  it("5) cron comercial-sla usa createServiceRoleClient + CRON_SECRET", () => {
    assert.match(cronSlaSrc, /createServiceRoleClient/)
    assert.match(cronSlaSrc, /detect_commercial_sla_escalations/)
    assert.match(cronSlaSrc, /redistribute_overdue_commercial_leads/)
    assert.match(cronRouteSrc, /isCronAuthorized/)
    assert.equal(
      cronRouteSrc.includes("createServiceRoleClient"),
      false,
      "rota só autoriza; service-role fica no service"
    )
  })

  it("6) nenhuma chamada browser/client às RPCs SLA", () => {
    const files = walkFiles(repoRoot)
    const hits: string[] = []
    for (const full of files) {
      const rel = toPosix(relative(repoRoot, full))
      if (isTestFile(rel)) continue
      if (rel === "lib/cron/commercial-sla.ts") continue
      const src = readFileSync(full, "utf8")
      const mentions = PRIVILEGED_RPCS.some((fn) => src.includes(fn))
      if (!mentions) continue
      if (isClientComponent(rel, src) || rel.startsWith("components/")) {
        hits.push(rel)
      }
      // Client authenticated direto: createBrowserClient / getSupabaseClient + rpc name
      if (
        /getSupabaseClient|createBrowserClient|createClient\(/.test(src) &&
        /\.rpc\(/.test(src) &&
        PRIVILEGED_RPCS.some((fn) => src.includes(fn))
      ) {
        hits.push(`${rel}:authenticated-rpc`)
      }
    }
    assert.deepEqual(hits, [], `RPC SLA não deve aparecer no browser: ${hits}`)
  })
})

/**
 * Arquitetura — hotfix P1: RPCs SLA só service_role.
 *
 * Garante que o patch restringe EXECUTE (quando a função existir),
 * tolera drift (RPC opcional ausente) e que o app não chama as RPCs
 * a partir do browser / client authenticated.
 *
 * Teste textual/puro: não conecta em banco.
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

const AUX_RPCS_OUT_OF_SCOPE = [
  "insert_commercial_sla_overdue_history",
  "log_commercial_sla_debug",
  "notify_commercial_sla_overdue",
  "notify_commercial_sla_redistributed",
  "redistribute_single_commercial_lead",
  "pick_next_available_commercial",
  "log_commercial_redistribution_debug",
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
  if (relPosix.startsWith("components/") || relPosix.startsWith("app/")) {
    if (relPosix.includes("/api/")) return false
    if (relPosix.endsWith("page.tsx") || relPosix.endsWith("layout.tsx")) {
      return true
    }
  }
  return false
}

function existenceCheck(fn: string): string {
  return `to_regprocedure('public.${fn}()')`
}

/** Bloco `if to_regprocedure(...) is not null then ... end if` da RPC. */
function gatedBlock(src: string, fn: string): string {
  const check = existenceCheck(fn)
  const checkIdx = src.indexOf(check)
  assert.ok(checkIdx >= 0, `patch deve verificar existência de ${fn} via ${check}`)

  const ifIdx = src.lastIndexOf("if ", checkIdx)
  assert.ok(ifIdx >= 0 && ifIdx < checkIdx, `${fn}: if deve preceder to_regprocedure`)

  const thenIdx = src.indexOf("then", checkIdx)
  assert.ok(thenIdx > checkIdx, `${fn}: then deve seguir to_regprocedure`)

  const endIfIdx = src.indexOf("end if", thenIdx)
  assert.ok(endIfIdx > thenIdx, `${fn}: end if deve fechar o gate`)

  const betweenIfAndThen = src.slice(ifIdx, thenIdx)
  assert.match(
    betweenIfAndThen,
    /is not null/i,
    `${fn}: gate deve ser to_regprocedure(...) IS NOT NULL`
  )

  return src.slice(ifIdx, endIfIdx)
}

function stripSqlComments(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--")
      return i >= 0 ? line.slice(0, i) : line
    })
    .join("\n")
}

function ungatedRevokeOrGrant(src: string, fn: string): boolean {
  const re = new RegExp(
    `(?:revoke|grant)\\s[^;]*function\\s+public\\.${fn}\\(\\)`,
    "i"
  )
  let from = 0
  const srcNorm = src
  while (from < srcNorm.length) {
    const m = re.exec(srcNorm.slice(from))
    if (!m || m.index == null) return false
    const abs = from + m.index
    const block = gatedBlock(srcNorm, fn)
    const blockStart = srcNorm.indexOf(block)
    const blockEnd = blockStart + block.length
    if (abs < blockStart || abs > blockEnd) return true
    from = abs + m[0].length
  }
  return false
}

describe("SLA RPC grants — service_role only", () => {
  const patchSrc = readFileSync(join(repoRoot, PATCH), "utf8")
  const patchNorm = patchSrc.replace(/\r\n/g, "\n")
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
      assert.ok(
        patchNorm.includes(existenceCheck(fn)),
        `deve mencionar ${fn} via ${existenceCheck(fn)}`
      )
      const block = gatedBlock(patchNorm, fn)
      assert.match(
        block,
        new RegExp(
          `revoke all on function public\\.${fn}\\(\\) from authenticated`,
          "i"
        ),
        `deve revogar authenticated de ${fn} quando existir`
      )
      assert.match(
        block,
        new RegExp(
          `grant execute on function public\\.${fn}\\(\\) to service_role`,
          "i"
        ),
        `deve conceder service_role a ${fn} quando existir`
      )
    }
  })

  it("2) existência é verificada antes do GRANT/REVOKE", () => {
    for (const fn of PRIVILEGED_RPCS) {
      const block = gatedBlock(patchNorm, fn)
      const checkPos = block.indexOf(existenceCheck(fn))
      const firstRevoke = block.search(/revoke\s/i)
      const firstGrant = block.search(/grant\s/i)
      assert.ok(checkPos >= 0, `${fn}: to_regprocedure ausente no bloco`)
      assert.ok(
        firstRevoke > checkPos,
        `${fn}: REVOKE deve vir depois de to_regprocedure`
      )
      assert.ok(
        firstGrant > checkPos,
        `${fn}: GRANT deve vir depois de to_regprocedure`
      )
    }
  })

  it("3) ausência de uma RPC não torna o patch inválido (tudo gated)", () => {
    for (const fn of PRIVILEGED_RPCS) {
      assert.equal(
        ungatedRevokeOrGrant(patchNorm, fn),
        false,
        `${fn}: REVOKE/GRANT fora do if to_regprocedure geraria 42883 se a RPC faltar`
      )
    }
  })

  it("4) PUBLIC é revogado quando função existe", () => {
    for (const fn of PRIVILEGED_RPCS) {
      const block = gatedBlock(patchNorm, fn)
      assert.match(
        block,
        new RegExp(
          `revoke all on function public\\.${fn}\\(\\) from public`,
          "i"
        )
      )
    }
  })

  it("5) anon é revogado quando função existe", () => {
    for (const fn of PRIVILEGED_RPCS) {
      const block = gatedBlock(patchNorm, fn)
      assert.match(
        block,
        new RegExp(`revoke all on function public\\.${fn}\\(\\) from anon`, "i")
      )
    }
  })

  it("6) authenticated é revogado quando função existe", () => {
    for (const fn of PRIVILEGED_RPCS) {
      const block = gatedBlock(patchNorm, fn)
      assert.match(
        block,
        new RegExp(
          `revoke all on function public\\.${fn}\\(\\) from authenticated`,
          "i"
        )
      )
    }
  })

  it("7) service_role recebe EXECUTE quando função existe", () => {
    for (const fn of PRIVILEGED_RPCS) {
      const block = gatedBlock(patchNorm, fn)
      assert.match(
        block,
        new RegExp(
          `grant execute on function public\\.${fn}\\(\\) to service_role`,
          "i"
        )
      )
    }
  })

  it("8) patch não cria funções", () => {
    assert.equal(
      /create\s+(or\s+replace\s+)?function/i.test(patchNorm),
      false,
      "hotfix não deve CREATE FUNCTION"
    )
  })

  it("9) patch não altera function body", () => {
    const code = stripSqlComments(patchNorm)
    assert.equal(/create\s+or\s+replace\s+function/i.test(code), false)
    assert.equal(/\blanguage\s+plpgsql\b/i.test(code), false)
    assert.equal(/\bsecurity\s+definer\b/i.test(code), false)
    assert.equal(/\bset\s+search_path\b/i.test(code), false)
    assert.equal(/\balter\s+function\b/i.test(code), false)
    assert.equal(/\bdrop\s+function\b/i.test(code), false)
  })

  it("10) patch não contém DML", () => {
    assert.equal(/\binsert\s+into\b/i.test(patchNorm), false)
    assert.equal(/\bupdate\s+\w+/i.test(patchNorm), false)
    assert.equal(/\bdelete\s+from\b/i.test(patchNorm), false)
    assert.equal(/\btruncate\b/i.test(patchNorm), false)
  })

  it("11) patch permanece transacional", () => {
    const beginIdx = patchNorm.search(/^\s*begin\s*;/im)
    const commitIdx = patchNorm.search(/^\s*commit\s*;/im)
    assert.ok(beginIdx >= 0, "deve ter BEGIN;")
    assert.ok(commitIdx > beginIdx, "COMMIT; deve vir depois de BEGIN;")
    const doIdx = patchNorm.search(/\bdo\s+\$/i)
    assert.ok(doIdx > beginIdx && doIdx < commitIdx, "DO block dentro da transação")
  })

  it("12) RPCs auxiliares fora de escopo não entram nesta hotfix", () => {
    for (const fn of AUX_RPCS_OUT_OF_SCOPE) {
      assert.equal(
        patchNorm.includes(fn),
        false,
        `${fn} não deve ser alterada nesta hotfix`
      )
    }
  })

  it("13) patches originais ainda documentam SECURITY DEFINER das RPCs", () => {
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

  it("14) cron comercial-sla usa createServiceRoleClient + CRON_SECRET", () => {
    assert.match(cronSlaSrc, /createServiceRoleClient/)
    assert.match(cronSlaSrc, /detect_commercial_sla_escalations/)
    assert.match(cronSlaSrc, /detect_overdue_commercial_leads/)
    assert.match(cronSlaSrc, /redistribute_overdue_commercial_leads/)
    assert.match(cronRouteSrc, /isCronAuthorized/)
    assert.equal(
      cronRouteSrc.includes("createServiceRoleClient"),
      false,
      "rota só autoriza; service-role fica no service"
    )
  })

  it("15) nenhuma chamada browser/client às RPCs SLA", () => {
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

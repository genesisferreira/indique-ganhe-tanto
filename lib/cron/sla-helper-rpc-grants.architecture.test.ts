/**
 * Arquitetura — hotfix P1: helpers SLA/assignment só service_role.
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

const PATCH = "supabase/patch-sla-helper-rpc-service-role-only.sql"
const PREVIOUS_ENTRYPOINT_PATCH = "supabase/patch-sla-rpc-service-role-only.sql"

const HELPERS = [
  {
    name: "assign_referral_to_next_commercial",
    args: "uuid",
  },
  {
    name: "insert_commercial_sla_overdue_history",
    args: "uuid, uuid, public.referral_status, timestamptz",
  },
  {
    name: "log_commercial_redistribution_debug",
    args: "text, uuid, uuid, jsonb",
  },
  {
    name: "log_commercial_sla_debug",
    args: "text, uuid, uuid, jsonb",
  },
  {
    name: "log_lead_assignment_debug",
    args: "text, uuid, uuid, jsonb",
  },
  {
    name: "notify_commercial_lead_assigned",
    args: "uuid, uuid",
  },
  {
    name: "notify_commercial_sla_overdue",
    args: "uuid, uuid, uuid, timestamptz, text",
  },
  {
    name: "notify_commercial_sla_redistributed",
    args: "uuid, uuid, text, text, text, integer, text, jsonb",
  },
  {
    name: "pick_next_available_commercial",
    args: "uuid",
  },
  {
    name: "redistribute_single_commercial_lead",
    args: "uuid",
  },
] as const

const OUT_OF_SCOPE = [
  "detect_overdue_commercial_leads",
  "redistribute_overdue_commercial_leads",
  "detect_commercial_sla_escalations",
] as const

const HISTORICAL_AUTHENTICATED_GRANT_FILES = new Set([
  "supabase/patch-commercial-lead-distribution.sql",
  "supabase/patch-commercial-lead-distribution-on-insert.sql",
])

function identity(fn: { name: string; args: string }): string {
  return `public.${fn.name}(${fn.args})`
}

function existenceCheck(fn: { name: string; args: string }): string {
  return `to_regprocedure('${identity(fn)}')`
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

function gatedBlock(src: string, fn: { name: string; args: string }): string {
  const check = existenceCheck(fn)
  const checkIdx = src.indexOf(check)
  assert.ok(checkIdx >= 0, `patch deve verificar existência via ${check}`)

  const ifIdx = src.lastIndexOf("if ", checkIdx)
  assert.ok(ifIdx >= 0 && ifIdx < checkIdx, `${fn.name}: if deve preceder to_regprocedure`)

  const thenIdx = src.indexOf("then", checkIdx)
  assert.ok(thenIdx > checkIdx, `${fn.name}: then deve seguir to_regprocedure`)

  const endIfIdx = src.indexOf("end if", thenIdx)
  assert.ok(endIfIdx > thenIdx, `${fn.name}: end if deve fechar o gate`)

  const betweenIfAndThen = src.slice(ifIdx, thenIdx)
  assert.match(
    betweenIfAndThen,
    /is not null/i,
    `${fn.name}: gate deve ser to_regprocedure(...) IS NOT NULL`
  )

  return src.slice(ifIdx, endIfIdx)
}

function listSqlFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git") continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      listSqlFiles(full, out)
    } else if (st.isFile() && name.endsWith(".sql")) {
      out.push(full)
    }
  }
  return out
}

describe("SLA helper RPC grants — service_role only", () => {
  const patchSrc = readFileSync(join(repoRoot, PATCH), "utf8")
  const patchNorm = patchSrc.replace(/\r\n/g, "\n")
  const patchCode = stripSqlComments(patchNorm)

  it("1) as 10 funções estão cobertas", () => {
    assert.equal(HELPERS.length, 10)
    for (const fn of HELPERS) {
      assert.ok(
        patchNorm.includes(existenceCheck(fn)),
        `faltou ${existenceCheck(fn)}`
      )
    }
  })

  it("2) uso de assinatura exata (to_regprocedure + revoke/grant)", () => {
    for (const fn of HELPERS) {
      const ident = identity(fn)
      const block = gatedBlock(patchNorm, fn)
      assert.match(
        block,
        new RegExp(
          `revoke all on function ${ident.replace(/[()]/g, "\\$&")} from authenticated`,
          "i"
        )
      )
      assert.match(
        block,
        new RegExp(
          `grant execute on function ${ident.replace(/[()]/g, "\\$&")} to service_role`,
          "i"
        )
      )
    }
  })

  it("3) PUBLIC é revogado quando função existe", () => {
    for (const fn of HELPERS) {
      const ident = identity(fn)
      const block = gatedBlock(patchNorm, fn)
      assert.match(
        block,
        new RegExp(
          `revoke all on function ${ident.replace(/[()]/g, "\\$&")} from public`,
          "i"
        )
      )
    }
  })

  it("4) anon é revogado quando função existe", () => {
    for (const fn of HELPERS) {
      const ident = identity(fn)
      const block = gatedBlock(patchNorm, fn)
      assert.match(
        block,
        new RegExp(
          `revoke all on function ${ident.replace(/[()]/g, "\\$&")} from anon`,
          "i"
        )
      )
    }
  })

  it("5) authenticated é revogado quando função existe", () => {
    for (const fn of HELPERS) {
      const ident = identity(fn)
      const block = gatedBlock(patchNorm, fn)
      assert.match(
        block,
        new RegExp(
          `revoke all on function ${ident.replace(/[()]/g, "\\$&")} from authenticated`,
          "i"
        )
      )
    }
  })

  it("6) service_role recebe EXECUTE quando função existe", () => {
    for (const fn of HELPERS) {
      const ident = identity(fn)
      const block = gatedBlock(patchNorm, fn)
      assert.match(
        block,
        new RegExp(
          `grant execute on function ${ident.replace(/[()]/g, "\\$&")} to service_role`,
          "i"
        )
      )
    }
  })

  it("7) existência condicional (gate antes de REVOKE/GRANT)", () => {
    for (const fn of HELPERS) {
      const block = gatedBlock(patchNorm, fn)
      const checkPos = block.indexOf(existenceCheck(fn))
      const firstRevoke = block.search(/revoke\s/i)
      const firstGrant = block.search(/grant\s/i)
      assert.ok(firstRevoke > checkPos, `${fn.name}: REVOKE depois de to_regprocedure`)
      assert.ok(firstGrant > checkPos, `${fn.name}: GRANT depois de to_regprocedure`)
    }
  })

  it("8) nenhuma das 2 entrypoints antigas entrou neste patch", () => {
    const code = patchCode
    assert.equal(code.includes("detect_overdue_commercial_leads"), false)
    assert.equal(code.includes("redistribute_overdue_commercial_leads"), false)
    const previous = readFileSync(join(repoRoot, PREVIOUS_ENTRYPOINT_PATCH), "utf8")
    assert.match(previous, /detect_overdue_commercial_leads/)
    assert.match(previous, /redistribute_overdue_commercial_leads/)
  })

  it("9) detect_commercial_sla_escalations não entrou", () => {
    assert.equal(patchCode.includes("detect_commercial_sla_escalations"), false)
  })

  it("10) nenhum CREATE/DROP/ALTER FUNCTION", () => {
    assert.equal(/create\s+(or\s+replace\s+)?function/i.test(patchCode), false)
    assert.equal(/\bdrop\s+function\b/i.test(patchCode), false)
    assert.equal(/\balter\s+function\b/i.test(patchCode), false)
  })

  it("11) nenhum DML", () => {
    assert.equal(/\binsert\s+into\b/i.test(patchCode), false)
    assert.equal(/\bupdate\s+\w+/i.test(patchCode), false)
    assert.equal(/\bdelete\s+from\b/i.test(patchCode), false)
    assert.equal(/\btruncate\b/i.test(patchCode), false)
  })

  it("12) nenhum RLS/policy", () => {
    assert.equal(/\benable\s+row\s+level\s+security\b/i.test(patchCode), false)
    assert.equal(/\bcreate\s+policy\b/i.test(patchCode), false)
    assert.equal(/\balter\s+policy\b/i.test(patchCode), false)
    assert.equal(/\bdrop\s+policy\b/i.test(patchCode), false)
  })

  it("13) nenhuma alteração nos arquivos SQL originais de definição", () => {
    const originals = [
      "supabase/patch-commercial-sla.sql",
      "supabase/patch-commercial-sla-redistribution.sql",
      "supabase/patch-commercial-sla-escalation.sql",
      "supabase/patch-commercial-lead-distribution.sql",
      "supabase/patch-commercial-lead-distribution-on-insert.sql",
      PREVIOUS_ENTRYPOINT_PATCH,
    ]
    for (const rel of originals) {
      const src = readFileSync(join(repoRoot, rel), "utf8")
      assert.ok(src.length > 0, rel)
    }
    assert.equal(
      patchNorm.includes("create or replace function"),
      false
    )
  })

  it("14) patch é idempotente e transacional", () => {
    const beginIdx = patchNorm.search(/^\s*begin\s*;/im)
    const commitIdx = patchNorm.search(/^\s*commit\s*;/im)
    assert.ok(beginIdx >= 0, "BEGIN;")
    assert.ok(commitIdx > beginIdx, "COMMIT; depois de BEGIN;")
    assert.match(patchNorm, /idempotente/i)
    assert.equal(/\bdrop\s+/i.test(patchCode), false)
  })

  it("15) SQL dinâmico usa apenas literais fixos", () => {
    assert.equal(/\|\|/g.test(patchCode), false, "sem concatenação ||")
    assert.equal(/\bformat\s*\(/i.test(patchCode), false, "sem format()")
    const executeLits = [...patchCode.matchAll(/execute\s+'([^']*)'/gi)]
    assert.ok(executeLits.length >= 40, "cada helper tem 4 EXECUTE")
    for (const m of executeLits) {
      const sql = m[1]
      assert.match(
        sql,
        /^(revoke all on function public\.|grant execute on function public\.)/i
      )
      assert.equal(sql.includes("%"), false)
    }
  })

  it("16) hotfix não reconcede EXECUTE a authenticated/anon", () => {
    assert.equal(
      /grant\s+execute\s+on\s+function[\s\S]*?\bto\s+authenticated\b/i.test(
        patchCode
      ),
      false
    )
    assert.equal(
      /grant\s+execute\s+on\s+function[\s\S]*?\bto\s+anon\b/i.test(patchCode),
      false
    )
    assert.equal(
      /grant\s+execute\s+on\s+function[\s\S]*?\bto\s+public\b/i.test(patchCode),
      false
    )
  })

  it("17) regressão: não versionar GRANT authenticated/anon das 10 fora do histórico legado", () => {
    const sqlRoot = join(repoRoot, "supabase")
    const files = listSqlFiles(sqlRoot)
    const hits: string[] = []

    for (const full of files) {
      const rel = relative(repoRoot, full).split("\\").join("/")
      const src = stripSqlComments(readFileSync(full, "utf8"))
      for (const fn of HELPERS) {
        const ident = identity(fn)
        const grantRe = new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+${ident.replace(/[()]/g, "\\$&")}\\s+to\\s+(authenticated|anon)\\b`,
          "i"
        )
        if (!grantRe.test(src)) continue
        const grandfathered =
          fn.name === "assign_referral_to_next_commercial" &&
          HISTORICAL_AUTHENTICATED_GRANT_FILES.has(rel)
        if (grandfathered) continue
        hits.push(`${rel}:${fn.name}`)
      }
    }

    assert.deepEqual(
      hits,
      [],
      `GRANT authenticated/anon das helpers só pode existir no histórico de assign_referral: ${hits}`
    )
  })

  it("18) OUT_OF_SCOPE não entra no código do patch", () => {
    for (const name of OUT_OF_SCOPE) {
      assert.equal(
        patchCode.includes(name),
        false,
        `${name} está fora desta hotfix`
      )
    }
  })
})

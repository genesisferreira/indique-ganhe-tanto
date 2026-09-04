import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "../..")

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
])

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
    } else if (st.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) {
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

function toPosix(p: string): string {
  return p.split("\\").join("/")
}

const serverSrc = readFileSync(join(repoRoot, "lib/supabase/server.ts"), "utf8")
const serviceRoleSrc = readFileSync(
  join(repoRoot, "lib/supabase/service-role.ts"),
  "utf8"
)

const hardenedRoutes = [
  "app/api/comercial/assisted-indicators/route.ts",
  "app/api/auth/complete-first-password-change/route.ts",
  "app/api/comercial/assisted-referrals/route.ts",
  "app/api/comercial/indicators/search/route.ts",
] as const

describe("supabase client architecture hardening", () => {
  it("1-3) createAdminClient não existe em código de produção", () => {
    assert.equal(serverSrc.includes("createAdminClient"), false)
    assert.equal(/export\s+async\s+function\s+createAdminClient/.test(serverSrc), false)

    const files = walkFiles(repoRoot)
    const productionHits: string[] = []
    for (const full of files) {
      const rel = toPosix(relative(repoRoot, full))
      if (isTestFile(rel)) continue
      const src = readFileSync(full, "utf8")
      if (src.includes("createAdminClient")) {
        productionHits.push(rel)
      }
    }
    assert.deepEqual(
      productionHits,
      [],
      `createAdminClient reintroduzido em: ${productionHits.join(", ")}`
    )
  })

  it("4-7) createServiceRoleClient privilegiado sem cookies/JWT de usuário", () => {
    assert.match(serviceRoleSrc, /export function createServiceRoleClient/)
    assert.match(serviceRoleSrc, /import "server-only"/)
    assert.match(serviceRoleSrc, /SUPABASE_SERVICE_ROLE_KEY/)
    assert.equal(
      serviceRoleSrc.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"),
      false
    )
    assert.equal(
      /process\.env\.NEXT_PUBLIC_[A-Z0-9_]*SERVICE_ROLE/.test(serviceRoleSrc),
      false
    )
    assert.equal(serviceRoleSrc.includes("cookies("), false)
    assert.equal(serviceRoleSrc.includes("cookieStore"), false)
    assert.equal(serviceRoleSrc.includes("createServerClient"), false)
    assert.equal(serviceRoleSrc.includes("from 'next/headers'"), false)
    assert.equal(serviceRoleSrc.includes('from "next/headers"'), false)
    assert.equal(serviceRoleSrc.includes("Authorization"), false)
    assert.equal(serviceRoleSrc.includes("access_token"), false)
    assert.equal(serviceRoleSrc.includes("persistSession: false"), true)
    assert.equal(serviceRoleSrc.includes("autoRefreshToken: false"), true)
  })

  it("8) createClient de sessão permanece separado (anon + cookies)", () => {
    assert.match(serverSrc, /export async function createClient/)
    assert.match(serverSrc, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
    assert.match(serverSrc, /cookies\(/)
    assert.equal(serverSrc.includes("SUPABASE_SERVICE_ROLE_KEY"), false)
    assert.equal(serverSrc.includes("createAdminClient"), false)
  })

  it("9-12) rotas endurecidas: auth de sessão antes de service role", () => {
    for (const routeRel of hardenedRoutes) {
      const src = readFileSync(join(repoRoot, routeRel), "utf8")
      assert.equal(
        src.includes("createAdminClient"),
        false,
        routeRel
      )
      assert.match(src, /createClient/, routeRel)
      assert.match(src, /createServiceRoleClient/, routeRel)
      assert.match(src, /getUser/, routeRel)

      const createClientIdx = src.indexOf("createClient")
      const getUserIdx = src.search(/\.auth\.getUser|getUser:/)
      const serviceIdx = src.search(
        /createServiceRoleClient\(\)|getPrivileged\(/
      )
      assert.ok(createClientIdx >= 0, `${routeRel}: createClient`)
      assert.ok(getUserIdx >= 0, `${routeRel}: getUser`)
      assert.ok(serviceIdx >= 0, `${routeRel}: service role lazy`)
      assert.ok(
        getUserIdx < serviceIdx || src.includes("getPrivileged"),
        `${routeRel}: auth deve preceder uso privilegiado (lazy ok)`
      )
    }
  })

  it("service-role key não aparece em Client Components / NEXT_PUBLIC", () => {
    const files = walkFiles(repoRoot)
    const bad: string[] = []
    for (const full of files) {
      const rel = toPosix(relative(repoRoot, full))
      if (isTestFile(rel)) continue
      const src = readFileSync(full, "utf8")
      if (/NEXT_PUBLIC_[A-Z0-9_]*SERVICE_ROLE/.test(src)) {
        bad.push(`${rel}: NEXT_PUBLIC service role`)
      }
      const isClient =
        /^\s*["']use client["']/m.test(src) ||
        /\/components\//.test(rel) ||
        (/^app\//.test(rel) && /\.tsx$/.test(rel) && !rel.includes("/api/"))
      if (
        isClient &&
        src.includes("SUPABASE_SERVICE_ROLE_KEY") &&
        !rel.startsWith("lib/supabase/")
      ) {
        bad.push(`${rel}: SERVICE_ROLE em superfície client`)
      }
      if (
        isClient &&
        src.includes("createServiceRoleClient") &&
        !rel.endsWith(".test.ts")
      ) {
        bad.push(`${rel}: createServiceRoleClient em client`)
      }
    }
    assert.deepEqual(bad, [], bad.join("; "))
  })
})

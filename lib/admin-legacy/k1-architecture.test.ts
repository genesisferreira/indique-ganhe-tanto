import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

/** 3.1F-K1: verificações estáticas (fonte) — trends falsos, vazio falso, auth, segurança e a11y. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..")
const read = (p: string) => readFileSync(join(ROOT, p), "utf8")

const TREND_PAGES = [
  "app/admin/page.tsx",
  "app/admin/financeiro/page.tsx",
  "app/admin/relatorios/page.tsx",
  "app/comercial/desempenho/page.tsx",
  "app/indicador/page.tsx",
]
const LOADER_PAGES = ["app/admin/comerciais/page.tsx", "app/admin/indicacoes/page.tsx", "app/admin/funcionarios/page.tsx"]
const K1_CLIENT_FILES = [
  ...LOADER_PAGES,
  "lib/client/guarded-loader.ts",
  "hooks/use-guarded-loader.ts",
  "components/ui/loader-status.tsx",
  "components/ui/stat-card.tsx",
  "components/ui/stat-card-trend.ts",
  "lib/admin-legacy/indicacoes-loader.ts",
  "lib/admin-legacy/employees-outcome.ts",
]
const PLACEHOLDER_RE = /[+]\s?(12|5[.,]2|12[.,]5|15|8[.,]2)\s?%|vs mes anterior/

describe("K1 — percentuais hardcoded", () => {
  for (const p of TREND_PAGES) {
    it(`${p}: nenhum trend literal nem placeholder percentual`, () => {
      const src = read(p)
      assert.doesNotMatch(src, /trend=\{\{/)
      assert.doesNotMatch(src, /trend:\s*\{\s*value:/)
      assert.doesNotMatch(src, /isPositive/)
      assert.doesNotMatch(src, PLACEHOLDER_RE)
      assert.doesNotMatch(src, /trendProps/)
    })
  }
  it("StatCard: trend opcional, sem padrão, sem isPositive, sem parse textual de sinal", () => {
    const src = read("components/ui/stat-card.tsx")
    assert.match(src, /trend\?: StatCardTrend/)
    assert.doesNotMatch(src, /isPositive/)
    assert.doesNotMatch(src, /(?<![\w-])trend\s*=\s*\{/, "nenhuma tendência padrão na desestruturação")
    assert.match(src, /\{trendView && \(/)
    assert.match(src, /sr-only/)
    const helper = read("components/ui/stat-card-trend.ts")
    assert.match(helper, /Math\.sign/)
    assert.doesNotMatch(helper, /startsWith\(["']-|parseFloat|parseInt|Number\(.*text/)
  })
})

describe("K1 — loaders sem vazio falso", () => {
  it("comerciais: sem `?? []` sobre o retorno do loader; usa resultado discriminado + LoaderStatus", () => {
    const src = read("app/admin/comerciais/page.tsx")
    assert.doesNotMatch(src, /remote \?\? \[\]/)
    assert.doesNotMatch(src, /loadAdminComerciaisFromSupabase\(/)
    assert.match(src, /loadAdminComerciaisResultFromSupabase\(\{ signal \}\)/)
    assert.match(src, /<LoaderStatus/)
  })
  it("indicações: erro não zera a lista; sem toast com erro bruto; identidade 1× via orquestrador", () => {
    const src = read("app/admin/indicacoes/page.tsx")
    assert.doesNotMatch(src, /setLista\(\[\]\)/)
    assert.doesNotMatch(src, /remote\.error/)
    assert.doesNotMatch(src, /getAuthProfileBasicsFromSupabase/)
    assert.match(src, /loadAdminIndicacoesBundle\(signal\)/)
  })
  it("funcionários: valida resposta (employeesOutcome) e não depende de `json.items ?? []`", () => {
    const src = read("app/admin/funcionarios/page.tsx")
    assert.doesNotMatch(src, /json\.items \?\? \[\]/)
    assert.match(src, /employeesOutcome\(res\.status, res\.ok, res\.json\)/)
  })
  for (const p of LOADER_PAGES) {
    it(`${p}: usa useGuardedLoader; sem setInterval; sem useEffect de carga manual`, () => {
      const src = read(p)
      assert.match(src, /useGuardedLoader</)
      assert.doesNotMatch(src, /setInterval\(/)
      assert.doesNotMatch(src, /setCarregando|setLoading\(/)
    })
  }
  it("hook: início adiado (StrictMode) e dispose na desmontagem", () => {
    const src = read("hooks/use-guarded-loader.ts")
    assert.match(src, /controller\.start\(\)/)
    assert.match(src, /controller\.dispose\(\)/)
    const core = read("lib/client/guarded-loader.ts")
    assert.match(core, /queueMicrotask/)
    assert.match(core, /finally \{\s*timers\.clear\(timer\)/)
    assert.match(core, /new AbortController\(\)/)
    assert.doesNotMatch(core, /setInterval/)
  })
})

describe("K1 — segurança e auth", () => {
  for (const p of K1_CLIENT_FILES) {
    it(`${p}: sem service_role, getSession, localStorage/sessionStorage`, () => {
      const src = read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      assert.doesNotMatch(src, /service_role|SERVICE_ROLE|createAdminClient|supabase-admin/i)
      assert.doesNotMatch(src, /auth\.getSession\(/)
      assert.doesNotMatch(src, /localStorage|sessionStorage/)
    })
  }
  it("serviço: getUser mantido nos loaders; identidade só reaproveitada no mesmo carregamento", () => {
    const src = read("lib/services/supabase-data.service.ts")
    const fn = src.slice(src.indexOf("async function resolveAdminLoadIdentity"), src.indexOf("export async function loadAdminComerciaisResultFromSupabase"))
    assert.match(fn, /auth\.getUser\(\)/)
    assert.doesNotMatch(fn, /getSession/)
    const ref = src.slice(src.indexOf("export async function loadAdminReferralsFromSupabase("), src.indexOf("const ADMIN_REFERRAL_MUTATION_ROLES"))
    assert.match(ref, /await supabase\.auth\.getUser\(\)/)
    assert.match(ref, /process\.env\.NODE_ENV === "development"\) \{\s*console\.log\("\[admin-indicacoes:session\]"/)
  })
})

describe("K1 — acessibilidade", () => {
  it("busca de funcionários com label explícito associado (htmlFor/id) e type=search", () => {
    const src = read("app/admin/funcionarios/page.tsx")
    assert.match(src, /<Label htmlFor="funcionarios-busca" className="sr-only">/)
    assert.match(src, /id="funcionarios-busca"/)
    assert.match(src, /type="search"/)
    assert.match(src, /aria-label="Filtrar por estado"/)
  })
  it("buscas de comerciais e indicações também rotuladas", () => {
    assert.match(read("app/admin/comerciais/page.tsx"), /htmlFor="comerciais-busca"[\s\S]*id="comerciais-busca"/)
    assert.match(read("app/admin/indicacoes/page.tsx"), /htmlFor="indicacoes-busca"[\s\S]*id="indicacoes-busca"/)
  })
  it("LoaderStatus: loading/empty com role=status + aria-live; erro/timeout com role=alert + botão", () => {
    const src = read("components/ui/loader-status.tsx")
    assert.match(src, /role="status"\s+aria-live="polite"\s+aria-busy="true"/)
    assert.match(src, /role="alert"/)
    assert.match(src, /Tentar novamente/)
    assert.match(src, /type="button"/)
    assert.match(src, /aria-hidden="true"/)
    assert.match(src, /motion-reduce:animate-none/)
  })
  it("botões só-ícone têm nome acessível", () => {
    for (const p of LOADER_PAGES) {
      const src = read(p)
      const blocks = src.split("<Button").slice(1).map((b) => b.slice(0, b.indexOf("</Button>")))
      for (const b of blocks.filter((x) => /size="icon"/.test(x))) {
        assert.match(b, /aria-label=/, `${p}: botão só-ícone sem aria-label`)
      }
    }
  })
})

// 3.1F-K1S — Reprodução LOCAL (lab) de /admin/comerciais e /admin/indicacoes sob latência realista de Auth.
// Next (build local) -> Supabase simulado (READ ONLY + ROLLBACK) -> PostgreSQL de lab. 127.0.0.1 somente.
// A única diferença para run.mjs: o mock responde /auth/v1/user após K1S_AUTH_MS e /rest/v1/* após K1S_REST_MS.
// Com ~24 auth.getUser() concorrentes do app shell (K2) cada um segura o lock de auth (navigator.locks) por um RTT;
// passando de 5 s (lockAcquireTimeout do auth-js), um pedido "rouba" o lock e o detentor recebe
// NavigatorLockAcquireTimeoutError ("…released because another request stole it") de dentro de getUser().
// Saída: estado final por execução, se a consulta principal disparou, avisos de lock e exceções (sem PII).
// Env: K1_APP_DIR, K1_BROWSER, K1_OUT_DIR, K1_LABEL, K1S_AUTH_MS (300), K1S_REST_MS (80), K1S_RUNS (4), K1S_WAIT_MS (25000),
//      K1S_EXPECT=pass|fail (exit 0 somente se o resultado bate com a expectativa).
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { startJ2Lab } from "../j2-lab-chain.mjs"
import { startMockSupabase, labSessionCookie } from "../j2-local-e2e/mock-supabase.mjs"
import { launchK1Browser } from "./cdp.mjs"
import { LAB_USERS, richSnapshot, seedFixture } from "./rich-fixture.mjs"

const APP_DIR = resolve(process.env.K1_APP_DIR || process.cwd())
const OUT = resolve(process.env.K1_OUT_DIR || join(process.cwd(), "k1s-repro-out"))
const BROWSER = process.env.K1_BROWSER || ""
const LABEL = process.env.K1_LABEL || "k1s"
const AUTH_MS = Number(process.env.K1S_AUTH_MS ?? 300)
const REST_MS = Number(process.env.K1S_REST_MS ?? 80)
const RUNS = Number(process.env.K1S_RUNS ?? 4)
const WAIT_MS = Number(process.env.K1S_WAIT_MS ?? 25000)
const EXPECT = process.env.K1S_EXPECT || "pass"
const MOCK_PORT = 54329, APP_PORT = Number(process.env.K1_APP_PORT || 3221)
const APP = `http://127.0.0.1:${APP_PORT}`, MOCK = `127.0.0.1:${MOCK_PORT}`
const ANON = "lab-anon-key-not-a-secret", SERVICE = "lab-service-key-not-a-secret"
const COOKIE = "sb-127-auth-token"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => process.stdout.write(`[k1s] ${m}\n`)
if (!BROWSER) throw new Error("K1_BROWSER required")
mkdirSync(OUT, { recursive: true })

const U = LAB_USERS
const users = Object.fromEntries(Object.entries(U).map(([k, u]) => [u[0], { email: `${k.toLowerCase()}@lab.invalid` }]))
// main: consulta principal vista pelo navegador (CDP) OU pelo mock (consulta feita pelo servidor Next, K1S).
const comerciaisList = (r) => r.path === "/rest/v1/profiles" && /role=eq\.comercial/.test(r.search || "")
const referralsList = (r) => r.path === "/rest/v1/referrals" && r.method === "GET"
const PAGES = {
  "/admin/comerciais": { main: comerciaisList, api: "/api/admin/comerciais" },
  "/admin/indicacoes": { main: referralsList, api: "/api/admin/indicacoes" },
  "/admin/funcionarios": { main: (r) => r.path === "/api/admin/employees", api: "/api/admin/employees" },
}

const lab = await startJ2Lab({ applyJ2: true })
const { c } = lab
let app, mock, browser
const report = { label: LABEL, authMs: AUTH_MS, restMs: REST_MS, runs: RUNS, waitMs: WAIT_MS, appDir: APP_DIR, pages: {}, zeroWrite: null }
let exitCode = 1
try {
  await seedFixture(c, "rich")
  await c.query("grant select on all tables in schema public to service_role")
  const snap0 = await richSnapshot(c)
  mock = await startMockSupabase({ port: MOCK_PORT, client: c, anonKey: ANON, serviceKey: SERVICE, allowOrigin: APP, users })
  app = spawn(process.execPath, [join(APP_DIR, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: APP_DIR,
    env: { ...process.env, NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: `http://${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "ignore", "ignore"],
  })
  for (let i = 0; i < 120; i++) { await sleep(500); if (await fetch(`${APP}/login`).then((r) => r.ok).catch(() => false)) break }
  browser = await launchK1Browser(BROWSER, 9344)
  report.browser = browser.version
  const consoleLog = []
  browser.on((m) => {
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "warning" || m.params.type === "error")) {
      const text = (m.params.args || []).map((a) => (typeof a.value === "string" ? a.value : a.description || "")).join(" ")
      consoleLog.push({ t: Date.now(), type: m.params.type, text: text.slice(0, 220) })
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails
      consoleLog.push({ t: Date.now(), type: "exception", text: String(d?.exception?.description || d?.text || "").split("\n")[0].slice(0, 220) })
    }
  })
  const dom = (expr) => browser.evaluate(expr)
  const stateOf = () => dom(`(() => { const e = document.querySelector('main [data-loader-state]'); return e ? e.getAttribute('data-loader-state') : null })()`)
  const textOf = () => dom(`(document.querySelector('main') || document.body).innerText`)

  // aquece o build sem latência (compilação/caches do Next fora da medição)
  mock.latency.authUserMs = 0; mock.latency.restMs = 0
  await browser.setCookie(COOKIE, labSessionCookie(U.AM[0], "am@lab.invalid"), APP)
  await browser.open(APP + "/admin/comerciais", 1366, 768, 4000)

  mock.latency.authUserMs = AUTH_MS; mock.latency.restMs = REST_MS
  for (const [path, spec] of Object.entries(PAGES)) {
    const runs = []
    for (let i = 0; i < RUNS; i++) {
      await browser.setCookie(COOKIE, labSessionCookie(U.AM[0], "am@lab.invalid"), APP)
      await browser.open("about:blank", 1366, 768, 300)
      browser.requests.splice(0)
      const c0 = consoleLog.length
      const s0 = mock.stats.restLog.length
      const t0 = Date.now()
      await browser.open(APP + path, 1366, 768, 200)
      const timeline = []
      let state = null
      while (Date.now() - t0 < WAIT_MS) {
        state = await stateOf().catch(() => null)
        if (timeline.at(-1)?.s !== state) timeline.push({ ms: Date.now() - t0, s: state })
        await sleep(250)
      }
      const reqs = browser.requests.splice(0).filter((r) => r.method !== "OPTIONS")
      const serverRest = mock.stats.restLog.slice(s0)
      const browserMain = reqs.filter(spec.main).length
      const apiCalls = reqs.filter((r) => r.path === spec.api).length
      // consultas no mock que NÃO vieram do navegador = feitas pelo servidor Next (rotas de API / SSR)
      const browserRestKeys = reqs.filter((r) => r.host === MOCK && r.path.startsWith("/rest/v1/")).length
      const text = await textOf().catch(() => "")
      const logs = consoleLog.slice(c0)
      runs.push({
        run: i + 1,
        finalState: state,
        timeline,
        // navegador (CDP) + servidor Next (no mock, descontando o que o navegador fez direto ao mock)
        mainQueryFired: browserMain + serverRest.filter(spec.main).length - reqs.filter((r) => r.host === MOCK).filter(spec.main).length,
        mainBrowser: browserMain,
        mainOnMock: serverRest.filter(spec.main).length,
        apiRouteCalls: apiCalls,
        restOnMockTotal: serverRest.length,
        restFromBrowser: browserRestKeys,
        authGetUser: reqs.filter((r) => r.host === MOCK && r.path === "/auth/v1/user").length,
        rest: reqs.filter((r) => r.host === MOCK && r.path.startsWith("/rest/v1/")).length,
        lockWarnings: logs.filter((l) => /Lock "|stole|LockManager|navigatorLock/i.test(l.text)).length,
        lockStolenErrors: logs.filter((l) => /stole/i.test(l.text)).length,
        exceptions: logs.filter((l) => l.type === "exception").map((l) => l.text),
        sampleLogs: logs.slice(0, 4).map((l) => `${l.type}: ${l.text}`),
        showsGenericError: /Não foi possível carregar os dados/.test(text),
        showsLoading: /Carregando/.test(text),
        showsEmptyMsg: /Nenhuma indicação|Nenhum comercial/.test(text),
      })
      log(`${path} run ${i + 1}: final=${state} main=${runs.at(-1).mainQueryFired} (browser=${runs.at(-1).mainBrowser} mock=${runs.at(-1).mainOnMock} api=${runs.at(-1).apiRouteCalls}) getUser=${runs.at(-1).authGetUser} lockWarn=${runs.at(-1).lockWarnings} stolen=${runs.at(-1).lockStolenErrors}`)
    }
    report.pages[path] = runs
  }
  mock.latency.authUserMs = 0; mock.latency.restMs = 0
  const snap1 = await richSnapshot(c)
  report.zeroWrite = {
    snapshotEqual: JSON.stringify(snap0.tables) === JSON.stringify(snap1.tables),
    writeAttempts: mock.stats.writeAttempts.length,
    rpc: mock.stats.rpc,
  }
  const okComerciais = report.pages["/admin/comerciais"].every((r) => r.finalState === "success" && r.mainQueryFired >= 1)
  const okIndicacoes = report.pages["/admin/indicacoes"].every((r) => ["success", "empty"].includes(r.finalState) && r.mainQueryFired >= 1)
  const okFuncionarios = report.pages["/admin/funcionarios"].every((r) => r.finalState === "success")
  const zw = report.zeroWrite.snapshotEqual && report.zeroWrite.writeAttempts === 0
  report.verdict = { okComerciais, okIndicacoes, okFuncionarios, zeroWrite: zw, allPass: okComerciais && okIndicacoes && okFuncionarios && zw }
  log(`VERDICT ${JSON.stringify(report.verdict)} expect=${EXPECT}`)
  exitCode = (EXPECT === "pass" ? report.verdict.allPass : !(okComerciais && okIndicacoes)) && zw ? 0 : 1
} finally {
  writeFileSync(join(OUT, `k1s-repro-${LABEL}.json`), JSON.stringify(report, null, 1))
  await browser?.close().catch(() => {})
  try { app?.kill() } catch {}
  await mock?.close().catch(() => {})
  await lab.stop().catch(() => {})
}
process.exit(exitCode)

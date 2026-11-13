// 3.1F-K1 — Validação visual/E2E LOCAL dos loaders legados e dos cards sem tendência falsa.
// Next (build local) -> Supabase simulado (READ ONLY + ROLLBACK) -> PostgreSQL de lab. 127.0.0.1 somente.
// Sem produção, sem ERP, sem Sync, sem dados reais. Estados de loading/erro/timeout/vazio são induzidos
// por interceptação CDP no navegador do lab (nunca no servidor).
// Env: K1_APP_DIR (app construído com NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329), K1_OUT_DIR,
//      K1_BROWSER (Edge/Chrome), K1_LABEL (rótulo do relatório), IGT_PG_LAB_ROOT/IGT_PG_LAB_PORT.
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { startJ2Lab, zeroWriteSnapshot } from "../j2-lab-chain.mjs"
import { startMockSupabase, labSessionCookie } from "../j2-local-e2e/mock-supabase.mjs"
import { AUDIT_JS } from "../j2-local-e2e/cdp.mjs"
import { launchK1Browser } from "./cdp.mjs"
import { FINANCIAL_TABLES, LAB_USERS, RICH_REFERRAL_NAMES, richSnapshot, seedFixture } from "./rich-fixture.mjs"

const APP_DIR = resolve(process.env.K1_APP_DIR || process.cwd())
const OUT = resolve(process.env.K1_OUT_DIR || join(process.cwd(), "k1-visual-out"))
const BROWSER = process.env.K1_BROWSER || ""
const LABEL = process.env.K1_LABEL || "k1"
const ONLY_COUNTS = process.env.K1_ONLY_COUNTS === "1"
// 3.1F-K1B: K1_FIXTURE=rich (padrão; massa sintética representativa) | empty (vazio real, fixture separada).
const FIXTURE = process.env.K1_FIXTURE || "rich"
if (!["rich", "empty"].includes(FIXTURE)) throw new Error("K1_FIXTURE inválido")
const MOCK_PORT = 54329, APP_PORT = Number(process.env.K1_APP_PORT || 3220)
const APP = `http://127.0.0.1:${APP_PORT}`
const MOCK = `127.0.0.1:${MOCK_PORT}`
const ANON = "lab-anon-key-not-a-secret", SERVICE = "lab-service-key-not-a-secret"
const COOKIE = "sb-127-auth-token"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => process.stdout.write(`[k1] ${m}\n`)
mkdirSync(join(OUT, "png"), { recursive: true })

const U = LAB_USERS
const users = Object.fromEntries(Object.entries(U).map(([k, u]) => [u[0], { email: `${k.toLowerCase()}@lab.invalid` }]))
const amCookie = () => labSessionCookie(U.AM[0], "am@lab.invalid")

const extraHashes = async (c) => {
  const h = async (t) => (await c.query(`select count(*)::int n, md5(coalesce(string_agg(x::text,'|' order by x::text),'')) d from public.${t} x`)).rows[0]
  return { memberships: await h("employee_sector_memberships"), plans: await h("plans"), commercial_availability: await h("commercial_availability").catch(() => null) }
}

const results = []
let ok = true
const check = (name, pass, detail) => { results.push([name, pass ? "PASS" : "FAIL " + JSON.stringify(detail ?? null).slice(0, 400)]); if (!pass) ok = false }

const lab = await startJ2Lab({ applyJ2: true })
const { c } = lab
let app, mock, browser
const summary = { label: LABEL, fixture: FIXTURE, screenshots: [], audits: [], counts: {}, abortObserved: [] }
try {
  await seedFixture(c, FIXTURE)
  await c.query("grant select on all tables in schema public to service_role")
  const snap0 = { ...(await zeroWriteSnapshot(c)), ...(await extraHashes(c)) }
  const rich0 = await richSnapshot(c)
  summary.fixtureCounts = Object.fromEntries(Object.entries(rich0.tables).map(([t, v]) => [t, v.n]))
  if (FIXTURE === "rich") {
    const n = (t) => rich0.tables[t].n
    const comerciais = Number((await c.query(`select count(*)::int n from public.profiles where role='comercial'`)).rows[0].n)
    check("fixture rica: comerciais/indicações/funcionários/rewards/wallet/memberships não vazios", comerciais >= 3 && n("referrals") >= 6 && n("employees") >= 4 && n("rewards") >= 2 && n("wallet_transactions") >= 2 && n("employee_sector_memberships") >= 4 && n("collection_cases") >= 1, summary.fixtureCounts)
    check("fixture rica: tabelas financeiras vazias", FINANCIAL_TABLES.every((t) => n(t) === 0), Object.fromEntries(FINANCIAL_TABLES.map((t) => [t, n(t)])))
  }

  mock = await startMockSupabase({ port: MOCK_PORT, client: c, anonKey: ANON, serviceKey: SERVICE, allowOrigin: APP, users })
  app = spawn(process.execPath, [join(APP_DIR, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: APP_DIR,
    env: { ...process.env, NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: `http://${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let appLog = ""
  app.stdout.on("data", (d) => { appLog += d })
  app.stderr.on("data", (d) => { appLog += d })
  for (let i = 0; i < 120; i++) { await sleep(500); if (await fetch(`${APP}/login`).then((r) => r.ok).catch(() => false)) break }
  log("app ready")
  if (!BROWSER) throw new Error("K1_BROWSER required")
  browser = await launchK1Browser(BROWSER)
  summary.browser = browser.version

  const dom = (expr) => browser.evaluate(expr)
  const stateOf = () => dom(`(() => { const e = document.querySelector('main [data-loader-state]'); return e ? e.getAttribute('data-loader-state') : null })()`)
  const mainText = () => dom(`(document.querySelector('main') || document.body).innerText`)
  const waitState = async (want, ms = 20000) => { const t0 = Date.now(); let s = null; while (Date.now() - t0 < ms) { s = await stateOf(); if (want.includes(s)) return s; await sleep(250) } return s }

  // ---------- Contagem de auth.getUser (/auth/v1/user) por carregamento de /admin/indicacoes ----------
  for (const p of ["/admin/indicacoes", "/admin/comerciais", "/admin/funcionarios"]) {
    await browser.intercept([])
    await browser.setCookie(COOKIE, amCookie(), APP)
    await browser.open("about:blank", 1366, 768, 300)
    browser.requests.splice(0)
    await browser.open(APP + p, 1366, 768, 6000)
    const reqs = browser.requests.splice(0)
    const mockReqs = reqs.filter((r) => r.host === MOCK && r.method !== "OPTIONS")
    summary.counts[p] = {
      authGetUser: mockReqs.filter((r) => r.path === "/auth/v1/user").length,
      restRequests: mockReqs.filter((r) => r.path.startsWith("/rest/v1/")).length,
      byTable: mockReqs.filter((r) => r.path.startsWith("/rest/v1/")).reduce((a, r) => ((a[r.path.slice(9)] = (a[r.path.slice(9)] || 0) + 1), a), {}),
      appApi: reqs.filter((r) => r.host === `127.0.0.1:${APP_PORT}` && r.path.startsWith("/api/")).map((r) => r.path),
      totalMock: mockReqs.length,
    }
  }
  if (ONLY_COUNTS) throw Object.assign(new Error("only-counts"), { onlyCounts: true })

  // ---------- Screenshots por estado ----------
  const VPS = [[360, 800], [390, 844], [1366, 768]]
  const shot = async (name, path, { vps = VPS, rules = [], want = null, settle = 1500, waitMs = 20000, assert: a } = {}) => {
    for (const [w, h] of vps) {
      await browser.intercept(rules)
      await browser.setCookie(COOKIE, amCookie(), APP)
      const mark = browser.failures.length
      await browser.open(APP + path, w, h, settle)
      const state = want ? await waitState(want, waitMs) : await stateOf()
      const fails = browser.failures.slice(mark)
      const audit = await dom(AUDIT_JS)
      const text = await mainText()
      const file = `${name}-${w}x${h}.png`
      writeFileSync(join(OUT, "png", file), await browser.screenshot())
      summary.screenshots.push(file)
      summary.audits.push({ name, path, viewport: `${w}x${h}`, state, overflowX: audit.overflowX, unlabeled: audit.unlabeled, buttonsNoName: audit.buttonsNoName, lowContrast: audit.lowContrast.slice(0, 5), forms: audit.forms })
      if (want) check(`${name} ${w}x${h} estado=${want.join("|")}`, want.includes(state), state)
      check(`${name} ${w}x${h} sem overflow horizontal`, !audit.overflowX, audit.scrollWidth)
      check(`${name} ${w}x${h} controles rotulados`, audit.unlabeled.length === 0, audit.unlabeled)
      check(`${name} ${w}x${h} sem placeholder percentual`, !/[+]\s?(12|5[.,]2|12[.,]5|15|8[.,]2)\s?%|vs m[eê]s anterior/.test(text))
      if (a) await a({ w, h, text, state, audit, fails })
    }
    await browser.intercept([])
  }
  const restRule = (pathRe, action, status = 500, body = '{"message":"lab-induced"}') => ({ match: (req) => new URL(req.url).host === MOCK && pathRe.test(new URL(req.url).pathname + new URL(req.url).search), action, status, body, origin: APP })
  const appRule = (pathRe, action, status = 500, body = '{"ok":false}') => ({ match: (req) => new URL(req.url).host === `127.0.0.1:${APP_PORT}` && pathRe.test(new URL(req.url).pathname + new URL(req.url).search), action, status, body })
  const comerciaisList = /\/rest\/v1\/profiles\?.*role=eq\.comercial/
  // 3.1F-K1B: no timeout, o request pendurado deve ser CANCELADO pela página (Network.loadingFailed canceled=true)
  // antes de qualquer liberação pelo harness.
  const abortedByPage = (name, re) => async ({ w, h, fails }) => {
    const hit = fails.filter((x) => re.test(x.path + x.search) && x.canceled)
    summary.abortObserved.push({ name, viewport: `${w}x${h}`, canceled: hit.length, errorText: hit[0]?.errorText ?? null })
    check(`${name} ${w}x${h}: request pendurado cancelado pela página no timeout (AbortController)`, hit.length >= 1, fails.slice(-5))
  }

  if (FIXTURE === "empty") {
    // Vazio REAL: respostas válidas vazias do lab (sem interceptação).
    await shot("k1b-empty-comerciais", "/admin/comerciais", { want: ["empty"], assert: async ({ text }) => check("vazio real: comerciais", /Nenhum comercial/.test(text) && !/Tentar novamente/.test(text)) })
    await shot("k1b-empty-indicacoes", "/admin/indicacoes", { want: ["empty"], assert: async ({ text }) => check("vazio real: indicações", /Nenhuma indicação cadastrada/.test(text) && !/Tentar novamente/.test(text)) })
    await shot("k1b-empty-funcionarios", "/admin/funcionarios", { want: ["empty"], assert: async ({ text }) => check("vazio real: funcionários", /Nenhum funcionário cadastrado/.test(text) && !/Tentar novamente/.test(text)) })
  } else {
  // Comerciais
  await shot("k1-comerciais-success", "/admin/comerciais", { want: ["success"], assert: async ({ text }) => check("comerciais: lista não vazia (fixture rica) visível ao Admin Master", /Lab Comercial Ativo/.test(text) && /Comercial Sintético Dois/.test(text) && /Comercial Sintético Inativo/.test(text)) })
  await shot("k1-comerciais-loading", "/admin/comerciais", { rules: [restRule(comerciaisList, "hang")], want: ["loading"], settle: 1200, waitMs: 3000 })
  await shot("k1-comerciais-error", "/admin/comerciais", { rules: [restRule(comerciaisList, "fulfill", 500)], want: ["error"], assert: async ({ text }) => check("comerciais: erro não exibe 'Nenhum comercial'", !/Nenhum comercial/.test(text) && /Tentar novamente/.test(text)) })
  await shot("k1-comerciais-empty", "/admin/comerciais", { vps: [[360, 800], [1366, 768]], rules: [restRule(comerciaisList, "fulfill", 200, "[]")], want: ["empty"] })
  await shot("k1-comerciais-timeout", "/admin/comerciais", { rules: [restRule(comerciaisList, "hang")], want: ["timeout"], settle: 1000, waitMs: 20000, assert: abortedByPage("comerciais", comerciaisList) })

  // Retry manual: erro -> remove a falha -> clicar "Tentar novamente" (1 clique = 1 nova tentativa)
  await browser.intercept([restRule(comerciaisList, "fulfill", 500)])
  await browser.setCookie(COOKIE, amCookie(), APP)
  await browser.open(APP + "/admin/comerciais", 1366, 768, 1500)
  await waitState(["error"])
  await browser.intercept([])
  browser.requests.splice(0)
  await dom(`(() => { const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Tentar novamente'); b && b.click(); return !!b })()`)
  const afterRetry = await waitState(["success"])
  const retryReqs = browser.requests.splice(0).filter((r) => r.host === MOCK && r.method !== "OPTIONS")
  check("comerciais: retry manual recupera (success)", afterRetry === "success", afterRetry)
  check("comerciais: retry = 1 resolução de identidade", retryReqs.filter((r) => r.path === "/auth/v1/user").length === 1, retryReqs.map((r) => r.path))

  // Funcionários
  await shot("k1-funcionarios-success", "/admin/funcionarios", { want: ["success"], assert: async ({ text }) => check("funcionários: lista não vazia (fixture rica)", /Lab Funcion/.test(text) && /Funcionário Sintético Pausado/.test(text) && /Comercial Sintético Dois/.test(text)) })
  await shot("k1-funcionarios-loading", "/admin/funcionarios", { vps: [[390, 844]], rules: [appRule(/^\/api\/admin\/employees/, "hang")], want: ["loading"], settle: 1200, waitMs: 3000 })
  await shot("k1-funcionarios-error", "/admin/funcionarios", { vps: [[390, 844], [1366, 768]], rules: [appRule(/^\/api\/admin\/employees/, "fulfill", 500)], want: ["error"] })
  await shot("k1-funcionarios-forbidden", "/admin/funcionarios", { vps: [[1366, 768]], rules: [appRule(/^\/api\/admin\/employees/, "fulfill", 403, '{"ok":false,"message":"x"}')], want: ["error"], assert: async ({ text }) => check("funcionários: 403 => mensagem de acesso", /não tem acesso/.test(text)) })
  await shot("k1-funcionarios-malformed", "/admin/funcionarios", { vps: [[1366, 768]], rules: [appRule(/^\/api\/admin\/employees/, "fulfill", 200, "null")], want: ["error"] })
  await shot("k1-funcionarios-empty", "/admin/funcionarios", { vps: [[360, 800], [1366, 768]], rules: [appRule(/^\/api\/admin\/employees/, "fulfill", 200, '{"ok":true,"items":[],"canWrite":false}')], want: ["empty"] })
  await shot("k1-funcionarios-timeout", "/admin/funcionarios", { vps: [[360, 800]], rules: [appRule(/^\/api\/admin\/employees/, "hang")], want: ["timeout"], settle: 1000, waitMs: 20000, assert: abortedByPage("funcionários", /^\/api\/admin\/employees/) })

  // Busca acessível + teclado: label associado e foco via Tab
  await browser.intercept([])
  await browser.setCookie(COOKIE, amCookie(), APP)
  await browser.open(APP + "/admin/funcionarios", 1366, 768, 3000)
  const searchA11y = await dom(`(() => { const i = document.getElementById('funcionarios-busca'); const l = i && document.querySelector('label[for="funcionarios-busca"]'); return { exists: !!i, type: i && i.type, label: l ? l.textContent.trim() : null, labelsApi: i && i.labels ? i.labels.length : 0 } })()`)
  check("funcionários: busca com label acessível", searchA11y.exists && searchA11y.labelsApi === 1 && /Buscar funcionários/.test(searchA11y.label || ""), searchA11y)
  let focused = null
  for (let i = 0; i < 60; i++) { await browser.key("Tab", "Tab", 9); focused = await dom(`document.activeElement && document.activeElement.id`); if (focused === "funcionarios-busca") break }
  check("funcionários: busca alcançável por teclado (Tab)", focused === "funcionarios-busca", focused)
  const focusRing = await dom(`(() => { const e = document.activeElement; const s = getComputedStyle(e); return s.outlineStyle !== 'none' || s.boxShadow !== 'none' })()`)
  check("funcionários: foco visível na busca", focusRing)
  writeFileSync(join(OUT, "png", "k1-funcionarios-busca-foco-1366x768.png"), await browser.screenshot())
  summary.screenshots.push("k1-funcionarios-busca-foco-1366x768.png")

  // Indicações
  await shot("k1-indicacoes-loaded", "/admin/indicacoes", { want: ["success"], assert: async ({ text }) => check("indicações: lista não vazia (fixture rica)", RICH_REFERRAL_NAMES.slice(0, 3).every((n) => text.includes(n))) })
  await shot("k1-indicacoes-error", "/admin/indicacoes", { vps: [[390, 844], [1366, 768]], rules: [restRule(/\/rest\/v1\/referrals\?/, "fulfill", 500)], want: ["error"], assert: async ({ text }) => check("indicações: erro não vira 'Nenhuma indicação'", !/Nenhuma indicação/.test(text)) })
  await shot("k1-indicacoes-timeout", "/admin/indicacoes", { vps: [[1366, 768]], rules: [restRule(/\/rest\/v1\/referrals\?/, "hang")], want: ["timeout"], settle: 1000, waitMs: 20000, assert: abortedByPage("indicações", /\/rest\/v1\/referrals\?/) })

  // Cards sem percentuais falsos
  for (const [name, path] of [["k1-admin-cards", "/admin"], ["k1-admin-financeiro-cards", "/admin/financeiro"]]) {
    await shot(name, path, { settle: 4500, assert: async ({ text, w }) => check(`${path} ${w}: nenhum trend falso`, !/[+]\s?\d+([.,]\d+)?%/.test(text) && !/isPositive/.test(text)) })
  }
  }

  const snap1 = { ...(await zeroWriteSnapshot(c)), ...(await extraHashes(c)) }
  summary.zeroWrite = { before: snap0, after: snap1 }
  check("zero-write: lab inalterado (financeiro, referrals, rewards, wallet, collections, profiles, employees, memberships)", JSON.stringify(snap0) === JSON.stringify(snap1), { snap0, snap1 })
  check("zero-write: simulador sem tentativas de escrita", mock.stats.writeAttempts.length === 0, mock.stats.writeAttempts)
  const rich1 = await richSnapshot(c)
  summary.richSnapshot = { before: rich0, after: rich1 }
  check("zero-write: contagens + digests + updated_at idênticos (fixture)", JSON.stringify(rich0.tables) === JSON.stringify(rich1.tables), Object.keys(rich0.tables).filter((t) => JSON.stringify(rich0.tables[t]) !== JSON.stringify(rich1.tables[t])))
  check("zero-write: pg_stat_user_tables sem INSERT/UPDATE/DELETE durante os GETs", JSON.stringify(rich0.pgWrites) === JSON.stringify(rich1.pgWrites), { before: rich0.pgWrites, after: rich1.pgWrites })
  const rpcNames = Object.keys(mock.stats.rpc)
  check("zero-write: nenhuma RPC executada pelas telas K1 (somente leitura)", rpcNames.every((n) => !/^(create|update|delete|insert|set|assign|approve|reject|pay|sync|release|finalize|register|mark)/i.test(n)), mock.stats.rpc)
  const external = [...browser.hosts].filter((hst) => hst !== MOCK && hst !== `127.0.0.1:${APP_PORT}`)
  check("ERP/Sync: zero requisições a hosts externos (somente 127.0.0.1)", external.length === 0, external)
  summary.mock = { requests: mock.stats.requests, writeAttempts: mock.stats.writeAttempts.length, rpc: mock.stats.rpc, unsupported: [...new Set(mock.stats.unsupported)].slice(0, 10) }
  summary.hosts = [...browser.hosts]
} catch (e) {
  if (!e.onlyCounts) { results.push(["RUN", "FAIL " + e.message]); ok = false }
} finally {
  writeFileSync(join(OUT, `summary-${LABEL}.json`), JSON.stringify({ ok, results, summary }, null, 1))
  try { await browser?.close() } catch {}
  try { app?.kill() } catch {}
  try { await mock?.close?.() } catch {}
  await lab.stop()
}
for (const [n, r] of results) process.stdout.write(`${r.startsWith("PASS") ? "ok  " : "FAIL"} ${n}${r.startsWith("PASS") ? "" : " :: " + r}\n`)
process.stdout.write(`[k1] ${results.filter((r) => r[1] === "PASS").length}/${results.length} PASS; counts=${JSON.stringify(summary.counts)}\n`)
process.exit(ok ? 0 : 1)

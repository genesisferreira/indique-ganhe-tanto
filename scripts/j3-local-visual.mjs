// 3.1F-J3 — Validação visual/E2E LOCAL do cadastro de oportunidade do funcionário, Minhas vendas, painel e
// origem no pipeline admin. Next (build local) -> Supabase simulado (READ ONLY + ROLLBACK) -> PostgreSQL de lab
// com a cadeia real + J3. 127.0.0.1 somente; sem produção, sem ERP, sem Sync, sem dados reais.
// Sucesso/duplicidade do POST são induzidos por interceptação CDP NO NAVEGADOR do lab (o mock recusa escrita;
// o envio real chega à RPC e falha como somente-leitura => estado de erro com dados preservados).
// Env: J3_APP_DIR, J3_OUT_DIR, J3_BROWSER, IGT_PG_LAB_ROOT/IGT_PG_LAB_PORT.
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { startJ2Lab, zeroWriteSnapshot } from "./j2-lab-chain.mjs"
import { startMockSupabase, labSessionCookie } from "./j2-local-e2e/mock-supabase.mjs"
import { AUDIT_JS } from "./j2-local-e2e/cdp.mjs"
import { launchK1Browser } from "./k1-local-visual/cdp.mjs"
import { LAB_USERS, RICH, seedFixture } from "./k1-local-visual/rich-fixture.mjs"

const APP_DIR = resolve(process.env.J3_APP_DIR || process.cwd())
const OUT = resolve(process.env.J3_OUT_DIR || join(process.cwd(), "j3-visual-out"))
const BROWSER = process.env.J3_BROWSER || ""
const MOCK_PORT = 54329, APP_PORT = Number(process.env.J3_APP_PORT || 3221)
const APP = `http://127.0.0.1:${APP_PORT}`, MOCK = `127.0.0.1:${MOCK_PORT}`
const ANON = "lab-anon-key-not-a-secret", SERVICE = "lab-service-key-not-a-secret"
const COOKIE = "sb-127-auth-token"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => process.stdout.write(`[j3v] ${m}\n`)
mkdirSync(join(OUT, "png"), { recursive: true })

const U = LAB_USERS
const users = Object.fromEntries(Object.entries(U).map(([k, u]) => [u[0], { email: `${k.toLowerCase()}@lab.invalid` }]))
users[RICH.FA2] = { email: "fa2@lab.invalid" }
const cookieFor = (k) => (k === "FA2" ? labSessionCookie(RICH.FA2, "fa2@lab.invalid") : labSessionCookie(U[k][0], `${k.toLowerCase()}@lab.invalid`))

const results = []
let ok = true
const check = (name, pass, detail) => { results.push([name, pass ? "PASS" : "FAIL " + JSON.stringify(detail ?? null).slice(0, 400)]); if (!pass) ok = false }

const lab = await startJ2Lab({ applyJ2: true })
const { c, REPO_ROOT } = lab
let app, mock, browser
const summary = { screenshots: [], audits: [] }
try {
  await seedFixture(c, "rich")
  await c.query(readFileSync(join(REPO_ROOT, "supabase/patch-employee-sales-opportunity-3-1f-j3.sql"), "utf8"))
  // FA: Técnico + Vendas Externas (escolha obrigatória). FA2 (pausado, só comercial): sem cadastro.
  const fa = (await c.query(`select id from public.employees where profile_id=$1`, [U.FA[0]])).rows[0].id
  await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id,is_active)
    select $1, s.id, true from public.sectors s where s.code in ('technician','external_sales')`, [fa])
  const sub = async (payload) => {
    await c.query("begin"); await c.query("set local role authenticated")
    await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [U.FA[0]])
    const r = (await c.query(`select public.submit_employee_sales_opportunity($1::jsonb) r`, [JSON.stringify(payload)])).rows[0].r
    await c.query("commit"); return r
  }
  const basePl = { planId: RICH.PLAN1, zipcode: "30140071", street: "Rua Sintética", number: "1", neighborhood: "Centro", city: "Lab", consent: true }
  const s1 = await sub({ ...basePl, idempotencyKey: "j3visualkey000000001", attributionRole: "technician_originator", name: "Cliente Funcionário Um", phone: "11900000001" })
  const s2 = await sub({ ...basePl, idempotencyKey: "j3visualkey000000002", attributionRole: "external_sales_originator", name: "Cliente Funcionário Dois", phone: "11900000002" })
  check("seed: 2 oportunidades de funcionário via RPC", s1.ok && s2.ok, { s1, s2 })
  await c.query(`update public.referrals set pipeline_stage='negociacao', status='em_negociacao' where id=$1`, [s2.opportunityId])
  await c.query("grant select on all tables in schema public to service_role")
  const snap0 = await zeroWriteSnapshot(c)

  mock = await startMockSupabase({ port: MOCK_PORT, client: c, anonKey: ANON, serviceKey: SERVICE, allowOrigin: APP, users })
  app = spawn(process.execPath, [join(APP_DIR, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: APP_DIR,
    env: { ...process.env, NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: `http://${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let appLog = ""
  app.stdout.on("data", (d) => { appLog += d }); app.stderr.on("data", (d) => { appLog += d })
  for (let i = 0; i < 120; i++) { await sleep(500); if (await fetch(`${APP}/login`).then((r) => r.ok).catch(() => false)) break }
  log("app ready")
  if (!BROWSER) throw new Error("J3_BROWSER required")
  browser = await launchK1Browser(BROWSER, 9344)
  const dom = (expr) => browser.evaluate(expr)
  const mainText = () => dom(`(document.querySelector('main') || document.body).innerText`)
  const appRule = (pathRe, status, body, method = "POST") => ({ match: (req) => new URL(req.url).host === `127.0.0.1:${APP_PORT}` && pathRe.test(new URL(req.url).pathname) && (!method || req.method === method), action: "fulfill", status, body })
  const VPS = [[360, 800], [390, 844], [1366, 768]]
  const capture = async (name, w, h) => {
    const audit = await dom(AUDIT_JS)
    const file = `${name}-${w}x${h}.png`
    writeFileSync(join(OUT, "png", file), await browser.screenshot())
    summary.screenshots.push(file)
    summary.audits.push({ name, viewport: `${w}x${h}`, overflowX: audit.overflowX, unlabeled: audit.unlabeled, buttonsNoName: audit.buttonsNoName })
    check(`${name} ${w}x${h} sem overflow horizontal`, !audit.overflowX, audit.scrollWidth)
    check(`${name} ${w}x${h} controles rotulados`, audit.unlabeled.length === 0, audit.unlabeled)
    return audit
  }
  const open = async (who, path, w, h, rules = [], settle = 2500) => {
    await browser.intercept(rules)
    await browser.setCookie(COOKIE, cookieFor(who), APP)
    await browser.open(APP + path, w, h, settle)
  }
  // Preenche inputs controlados do React (somente no lab).
  const fill = (vals) => dom(`(() => {
    const set = (id, v) => { const el = document.getElementById(id); if (!el) return id; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return null }
    const miss = []; for (const [k, v] of Object.entries(${JSON.stringify(vals)})) { const m = set(k, v); if (m) miss.push(m) }
    return miss })()`)
  const click = (sel) => dom(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true })()`)
  const FORM = { "eo-name": "Cliente Visual Sintético", "eo-phone": "(11) 90000-0099", "eo-document": "529.982.247-25", "eo-plan": RICH.PLAN1, "eo-zipcode": "30140-071", "eo-street": "Rua Sintética", "eo-number": "99", "eo-neighborhood": "Centro", "eo-city": "Lab", "eo-observation": "Somente lab" }
  const fillAll = async () => {
    const miss = await fill(FORM)
    await click('input[name="attributionRole"][value="technician_originator"]')
    await click("#eo-consent")
    await sleep(200)
    return miss
  }

  // 1) Formulário vazio (papel duplo => escolha obrigatória)
  for (const [w, h] of VPS) {
    await open("FA", "/funcionario/nova-oportunidade", w, h)
    const t = await mainText()
    check(`form ${w}: campos e escolha de papel visíveis`, /Nome completo/.test(t) && /Telefone \/ WhatsApp/.test(t) && /Você está registrando como/.test(t) && /Técnico/.test(t) && /Vendedor externo/.test(t) && /Plano Sintético 300/.test(await dom(`document.getElementById('eo-plan')?.innerText || ''`)), t.slice(0, 300))
    await capture("j3-form-vazio", w, h)
  }
  // 2) Validação no cliente (sem request)
  await open("FA", "/funcionario/nova-oportunidade", 390, 844)
  browser.requests.splice(0)
  await click('button[type="submit"]'); await sleep(500)
  const posts0 = browser.requests.filter((r) => r.method === "POST" && r.path === "/api/employee/opportunities").length
  check("validação local: nenhum POST com formulário vazio", posts0 === 0, posts0)
  check("validação local: mensagem de campo", /Informe o nome completo/.test(await mainText()))
  await capture("j3-form-validacao", 390, 844)
  // 3) Envio real => mock somente-leitura => 503 fechado, dados preservados
  for (const [w, h] of [[390, 844], [1366, 768]]) {
    await open("FA", "/funcionario/nova-oportunidade", w, h)
    const miss = await fillAll()
    check(`preenchimento ${w}`, miss.length === 0, miss)
    browser.requests.splice(0)
    await click('button[type="submit"]'); await sleep(2500)
    const t = await mainText()
    const kept = await dom(`document.getElementById('eo-name').value + '|' + document.getElementById('eo-phone').value`)
    check(`erro ${w}: mensagem fechada e dados mantidos`, /temporariamente indisponível|Seus dados foram mantidos/.test(t) && kept === "Cliente Visual Sintético|(11) 90000-0099", { kept, t: t.slice(-300) })
    await capture("j3-form-erro-dados-mantidos", w, h)
  }
  // 4) Duplo clique: um único POST
  await open("FA", "/funcionario/nova-oportunidade", 390, 844, [appRule(/^\/api\/employee\/opportunities$/, 201, JSON.stringify({ ok: true, idempotent: false, opportunityId: s1.opportunityId, protocol: "ABCDEF12", attributionRole: "technician_originator", stage: "novo" }))])
  await fillAll()
  browser.requests.splice(0)
  await dom(`(() => { const b = document.querySelector('button[type="submit"]'); b.click(); b.click(); b.click() })()`)
  await sleep(1500)
  const posts = browser.requests.filter((r) => r.method === "POST" && r.path === "/api/employee/opportunities").length
  check("duplo/triplo clique => exatamente 1 POST", posts === 1, posts)
  const t4 = await mainText()
  const cleared = await dom(`document.getElementById('eo-name').value === '' && document.getElementById('eo-phone').value === ''`)
  check("sucesso: protocolo sanitizado e formulário limpo", /Oportunidade registrada/.test(t4) && /ABCDEF12/.test(t4) && cleared && !/Cliente Visual Sintético/.test(t4), t4.slice(0, 300))
  await capture("j3-form-sucesso", 390, 844)
  for (const [w, h] of [[360, 800], [1366, 768]]) {
    await open("FA", "/funcionario/nova-oportunidade", w, h, [appRule(/^\/api\/employee\/opportunities$/, 201, JSON.stringify({ ok: true, idempotent: false, opportunityId: s1.opportunityId, protocol: "ABCDEF12", attributionRole: "technician_originator", stage: "novo" }))])
    await fillAll(); await click('button[type="submit"]'); await sleep(1200)
    await capture("j3-form-sucesso", w, h)
  }
  // 5) Encerrada < 90 dias => aviso + confirmação explícita
  await open("FA", "/funcionario/nova-oportunidade", 390, 844, [appRule(/^\/api\/employee\/opportunities$/, 409, JSON.stringify({ ok: false, code: "duplicate_recent_closed", requiresConfirmation: true, message: "x" }))])
  await fillAll(); await click('button[type="submit"]'); await sleep(1200)
  check("<90d: painel de confirmação", /Registrar mesmo assim/.test(await mainText()))
  await capture("j3-form-confirmar-recente", 390, 844)
  // 6) Duplicidade aberta
  await open("FA", "/funcionario/nova-oportunidade", 1366, 768, [appRule(/^\/api\/employee\/opportunities$/, 409, JSON.stringify({ ok: false, code: "duplicate_open", message: "Já existe um atendimento em aberto para este telefone ou documento. Não é possível duplicar." }))])
  await fillAll(); await click('button[type="submit"]'); await sleep(1200)
  check("duplicidade aberta: bloqueio com dados mantidos", /Já existe um atendimento em aberto/.test(await mainText()) && (await dom(`document.getElementById('eo-name').value`)) === "Cliente Visual Sintético")
  await capture("j3-form-duplicado-aberto", 1366, 768)
  // 7) Sem vínculo elegível / outros perfis
  await open("FA2", "/funcionario/nova-oportunidade", 390, 844)
  const tPz = await mainText()
  check("funcionário pausado/sem vínculo: sem formulário", !/Nome completo/.test(tPz) && /(não está ativo|exclusivo para funcionários)/.test(tPz), tPz.slice(0, 200))
  await capture("j3-form-indisponivel", 390, 844)
  for (const who of ["IN", "CM", "AM"]) {
    await open(who, "/funcionario/nova-oportunidade", 1366, 768)
    const t = await mainText()
    const url = await dom("location.pathname")
    check(`${who}: sem acesso ao formulário`, !/Registrar oportunidade/.test(t) && !(await dom(`!!document.getElementById('eo-name')`)), { url, t: t.slice(0, 160) })
  }
  // 8) Minhas vendas e painel
  for (const [w, h] of VPS) {
    await open("FA", "/funcionario/vendas", w, h)
    const t = await mainText()
    check(`vendas ${w}: próprias, nome mascarado, comissão aguardando regra`, /2 vendas/.test(t) && /Cliente D\./.test(t) && /Aguardando regra financeira/.test(t) && !/Funcionário Dois|11900000002/.test(t), t.slice(0, 400))
    await capture("j3-minhas-vendas", w, h)
  }
  await open("FA", "/funcionario/vendas?role=external_sales_originator&q=cliente", 1366, 768)
  check("vendas: filtro papel+busca", /1 venda/.test(await mainText()))
  await capture("j3-minhas-vendas-filtro", 1366, 768)
  await open("FA", `/funcionario/vendas/${s1.opportunityId}`, 390, 844)
  check("detalhe próprio: etapa Interessado", /Interessado/.test(await mainText()))
  await capture("j3-venda-detalhe", 390, 844)
  for (const [w, h] of [[390, 844], [1366, 768]]) {
    await open("FA", "/funcionario", w, h, [], 3000)
    const t = await mainText()
    check(`painel ${w}: atalho real, comissão não calculada, sem %`, /Nova oportunidade/.test(t) && /Não calculada/.test(t) && !/em breve/i.test(t) && !/\d\s?%/.test(t), t.slice(0, 500))
    await capture("j3-painel", w, h)
  }
  // 9) Pipeline admin: origem e originador
  await open("AM", "/admin/pipeline", 1366, 768, [], 5000)
  const tp = await mainText()
  check("pipeline admin: origem Técnico/Vendedor externo + originador", /Técnico/.test(tp) && /Vendedor externo/.test(tp) && /Lab Funcionário/.test(tp), tp.slice(0, 600))
  // Quadro kanban rola horizontalmente por desenho (colunas fixas): registrar overflow sem reprovar.
  const pa = await dom(AUDIT_JS)
  writeFileSync(join(OUT, "png", "j3-pipeline-admin-origem-1366x768.png"), await browser.screenshot())
  summary.screenshots.push("j3-pipeline-admin-origem-1366x768.png")
  const noBadge = await dom(`(() => { const b = [...document.querySelectorAll('[title^="Origem:"]')]; const n = b.length; b.forEach((e) => (e.style.display = 'none')); const w = document.documentElement.scrollWidth; b.forEach((e) => (e.style.display = '')); return { badges: n, scrollWidthWithoutBadges: w } })()`)
  summary.pipelineOverflowX = { overflowX: pa.overflowX, scrollWidth: pa.scrollWidth, ...noBadge }
  check("pipeline admin: badge de origem não altera a largura do quadro", noBadge.badges >= 2 && noBadge.scrollWidthWithoutBadges === pa.scrollWidth, summary.pipelineOverflowX)
  check("pipeline admin: controles rotulados", pa.unlabeled.length === 0, pa.unlabeled)

  const snap1 = await zeroWriteSnapshot(c)
  check("zero-write durante a navegação (financeiro/referrals/rewards/wallet/employees)", JSON.stringify(snap0) === JSON.stringify(snap1), { snap0, snap1 })
  check("mock: nenhuma escrita HTTP via tabela (somente RPC)", mock.stats.writeAttempts.length === 0, mock.stats.writeAttempts.slice(0, 5))
  summary.mockRpc = mock.stats.rpc
  summary.appLogTail = appLog.split("\n").filter((l) => /employee-opportunity|error/i.test(l)).slice(-8)
} catch (e) {
  results.push(["FATAL", e.stack || e.message]); ok = false
} finally {
  await browser?.close().catch(() => {})
  app?.kill()
  try { await mock?.close?.() } catch {}
  await lab.stop().catch(() => {})
}
for (const r of results) console.log(r.join(" | "))
const pass = results.filter((r) => r[1] === "PASS").length
console.log(`J3_VISUAL=${pass}/${results.length}`)
writeFileSync(join(OUT, "summary.json"), JSON.stringify({ results, ...summary }, null, 2))
process.exit(ok ? 0 : 1)

// 3.1F-J4 — validação visual/E2E LOCAL da configuração em rascunho (regras e remuneração individual) e do
// painel do funcionário. Next (build local) -> Supabase simulado (READ ONLY + ROLLBACK) -> PostgreSQL de lab
// com a cadeia real + J3 + J4. 127.0.0.1 somente; sem produção, sem ERP, sem Sync, sem dados reais.
// Dados de lab semeados pelas RPCs J4 reais (superusuário do lab, papel authenticated + claim). O POST da UI
// é interceptado no navegador do lab (o mock recusa escrita) para validar o payload enviado.
// Env: J4_APP_DIR, J4_OUT_DIR, J4_BROWSER, IGT_PG_LAB_ROOT/IGT_PG_LAB_PORT.
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { startJ2Lab, zeroWriteSnapshot } from "./j2-lab-chain.mjs"
import { startMockSupabase, labSessionCookie } from "./j2-local-e2e/mock-supabase.mjs"
import { AUDIT_JS } from "./j2-local-e2e/cdp.mjs"
import { launchK1Browser } from "./k1-local-visual/cdp.mjs"
import { LAB_USERS, RICH, seedFixture } from "./k1-local-visual/rich-fixture.mjs"

const APP_DIR = resolve(process.env.J4_APP_DIR || process.cwd())
const OUT = resolve(process.env.J4_OUT_DIR || join(process.cwd(), "j4-visual-out"))
const BROWSER = process.env.J4_BROWSER || ""
const MOCK_PORT = 54329, APP_PORT = Number(process.env.J4_APP_PORT || 3221)
const APP = `http://127.0.0.1:${APP_PORT}`, MOCK = `127.0.0.1:${MOCK_PORT}`
const ANON = "lab-anon-key-not-a-secret", SERVICE = "lab-service-key-not-a-secret"
const COOKIE = "sb-127-auth-token"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => process.stdout.write(`[j4v] ${m}\n`)
mkdirSync(join(OUT, "png"), { recursive: true })

const AF = "77777777-0000-4000-8000-0000000000f1", AC = "77777777-0000-4000-8000-0000000000c1"
const U = LAB_USERS
const users = Object.fromEntries(Object.entries(U).map(([k, u]) => [u[0], { email: `${k.toLowerCase()}@lab.invalid` }]))
for (const [id, e] of [[RICH.FA2, "fa2"], [RICH.FA3, "fa3"], [AF, "af"], [AC, "ac"]]) users[id] = { email: `${e}@lab.invalid` }
const IDS = { AM: U.AM[0], FA: U.FA[0], CM: U.CM[0], FA2: RICH.FA2, FA3: RICH.FA3, AF, AC }
const cookieFor = (k) => labSessionCookie(IDS[k], users[IDS[k]].email)

const results = []
let ok = true
const check = (name, pass, detail) => { results.push([name, pass ? "PASS" : "FAIL " + JSON.stringify(detail ?? null).slice(0, 400)]); if (!pass) ok = false }

const lab = await startJ2Lab({ applyJ2: true })
const { c, REPO_ROOT } = lab
let app, mock, browser
const summary = { screenshots: [], audits: [] }
try {
  await seedFixture(c, "rich")
  for (const f of ["supabase/patch-employee-sales-opportunity-3-1f-j3.sql", "supabase/patch-employee-compensation-configuration-3-1f-j4.sql"]) await c.query(readFileSync(join(REPO_ROOT, f), "utf8"))
  await c.query(`insert into public.profiles(id,email,role,is_active,full_name) values ($1,'af@lab.invalid','admin_financeiro',true,'Lab Admin Financeiro'),($2,'ac@lab.invalid','admin_consulta',true,'Lab Admin Consulta') on conflict (id) do nothing`, [AF, AC])
  const emp = async (pid) => (await c.query(`select id from public.employees where profile_id=$1`, [pid])).rows[0]?.id
  const E = { FA: await emp(RICH.FA), FA2: await emp(RICH.FA2), FA3: await emp(RICH.FA3) }
  await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id,is_active) select $1, s.id, true from public.sectors s where s.code='technician'`, [E.FA])
  let seq = 0
  const key = () => `j4visual${String(++seq).padStart(4, "0")}${"z".repeat(12)}`
  const rpc = async (uid, fn, payload) => {
    await c.query("begin"); await c.query("set local role authenticated")
    await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid])
    const r = (await c.query(`select public.${fn}($1::jsonb) r`, [JSON.stringify(payload)])).rows[0].r
    await c.query("commit"); return r
  }
  const today = (await c.query(`select public.comp_cfg_today()::text d`)).rows[0].d
  const plus = async (n) => (await c.query(`select (public.comp_cfg_today() + $1::int)::text d`, [n])).rows[0].d
  const d30 = await plus(30), d31 = await plus(31), d1 = await plus(1)
  const r1 = await rpc(IDS.AM, "admin_save_commission_rule_draft", { idempotencyKey: key(), name: "Comissão Técnico de Rua", attributionRole: "technician_originator", method: "fixed_amount", fixedAmount: "31.50", effectiveFrom: d1, effectiveUntil: d30, reason: "Configuração inicial lab" })
  const r1b = await rpc(IDS.AF, "admin_save_commission_rule_draft", { idempotencyKey: key(), previousRuleId: r1.ruleId, name: "Comissão Técnico de Rua", method: "fixed_amount", fixedAmount: "33.00", effectiveFrom: d1, effectiveUntil: d30, description: "Reajuste de lab", reason: "Reajuste lab" })
  const r2 = await rpc(IDS.AM, "admin_save_commission_rule_draft", { idempotencyKey: key(), name: "Percentual Técnico (incompleto)", attributionRole: "technician_originator", method: "percentage", percentageRate: "0.015000", effectiveFrom: d31, reason: "Estudo de percentual" })
  const r3 = await rpc(IDS.AF, "admin_save_commission_rule_draft", { idempotencyKey: key(), name: "Primeira fatura Vendedor Externo", attributionRole: "external_sales_originator", method: "first_invoice_value", effectiveFrom: d1, reason: "Modelo Indique e Ganhe" })
  const r4 = await rpc(IDS.AM, "admin_save_commission_rule_draft", { idempotencyKey: key(), name: "Vendedor Externo fixo antigo", attributionRole: "external_sales_originator", method: "fixed_amount", fixedAmount: "45.00", effectiveFrom: d31, reason: "Rascunho descartado" })
  const r4a = await rpc(IDS.AM, "admin_archive_commission_rule_draft", { idempotencyKey: key(), ruleId: r4.ruleId, reason: "Não utilizado" })
  const p1 = await rpc(IDS.AM, "admin_save_employee_compensation_draft", { idempotencyKey: key(), employeeId: E.FA, validFrom: today, salaryAmount: "2400.00", showSalary: true, reason: "Contratação lab" })
  const p1b = await rpc(IDS.AF, "admin_save_employee_compensation_draft", { idempotencyKey: key(), employeeId: E.FA, previousProfileId: p1.profileId, validFrom: today, salaryAmount: "2500.00", showSalary: true, mealDailyAmount: "21.75", showMeal: false, transportAmount: "180.00", transportMethod: "monthly_fixed", showTransport: true, notes: "Reajuste anual lab", reason: "Reajuste lab" })
  const p2 = await rpc(IDS.AF, "admin_save_employee_compensation_draft", { idempotencyKey: key(), employeeId: E.FA2, validFrom: today, fuelAmount: "15.40", fuelMethod: "per_worked_day", showFuel: true, reason: "Combustível lab" })
  check("seed: regras e perfis via RPC J4 reais", [r1, r1b, r2, r3, r4, r4a, p1, p1b, p2].every((x) => x.ok === true), [r1, r1b, r2, r3, r4, r4a, p1, p1b, p2].map((x) => x.code))
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
  if (!BROWSER) throw new Error("J4_BROWSER required")

  // ---------- API: autorização (sem navegador) ----------
  const post = (who, path, body) => fetch(APP + path, { method: "POST", headers: { "content-type": "application/json", origin: APP, cookie: `${COOKIE}=${cookieFor(who)}` }, body: JSON.stringify(body), redirect: "manual" })
  const ruleBody = { idempotencyKey: "j4apikey0000000000001", name: "Tentativa", attributionRole: "technician_originator", method: "fixed_amount", fixedAmount: "10.00", effectiveFrom: d31, reason: "Teste API lab" }
  for (const [who, exp] of [["AC", 403], ["FA", 403], ["CM", 403]]) {
    const r = await post(who, "/api/admin/remuneracao/regras", ruleBody)
    check(`API regras ${who} => ${exp}`, r.status === exp, r.status)
  }
  const anonR = await fetch(APP + "/api/admin/remuneracao/regras", { method: "POST", headers: { "content-type": "application/json", origin: APP }, body: JSON.stringify(ruleBody) })
  check("API regras sem sessão => 401", anonR.status === 401, anonR.status)
  const evil = await fetch(APP + "/api/admin/remuneracao/regras", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", cookie: `${COOKIE}=${cookieFor("AM")}` }, body: JSON.stringify(ruleBody) })
  check("API regras origem externa => 403", evil.status === 403, evil.status)
  const unk = await post("AM", "/api/admin/remuneracao/regras", { ...ruleBody, active: true })
  check("API campo desconhecido (active) => 400", unk.status === 400, unk.status)
  const amR = await post("AM", "/api/admin/remuneracao/regras", ruleBody)
  check("API Admin Master passa o guard (mock somente leitura => sem gravação)", ![401, 403].includes(amR.status), amR.status)
  const afR = await post("AF", "/api/admin/remuneracao/funcionarios/arquivar", { idempotencyKey: "j4apikey0000000000002", profileId: p2.profileId, reason: "Teste API lab" })
  check("API Admin Financeiro passa o guard", ![401, 403].includes(afR.status), afR.status)
  const get = await fetch(APP + "/api/admin/remuneracao/regras", { headers: { cookie: `${COOKIE}=${cookieFor("AM")}` } })
  check("API regras: GET não exposto", get.status === 405, get.status)

  browser = await launchK1Browser(BROWSER, 9344)
  const dom = (expr) => browser.evaluate(expr)
  const mainText = () => dom(`(document.querySelector('main') || document.body).innerText`)
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
    // Primeira carga a frio pode ficar em "Carregando…" (mesmo comportamento medido no baseline J3).
    for (let i = 0; i < 20 && /^\s*Carregando/.test(await mainText()); i++) await sleep(500)
  }
  const fill = (vals) => dom(`(() => {
    const set = (id, v) => { const el = document.getElementById(id); if (!el) return id; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return null }
    const miss = []; for (const [k, v] of Object.entries(${JSON.stringify(vals)})) { const m = set(k, v); if (m) miss.push(m) }
    return miss })()`)
  const clickText = (text) => dom(`(() => { const el = [...document.querySelectorAll('button')].find((b) => b.innerText.trim().startsWith(${JSON.stringify(text)}) && !b.disabled); if (!el) return false; el.click(); return true })()`)
  const value = (id) => dom(`document.getElementById(${JSON.stringify(id)})?.value ?? null`)

  // ---------- 1) Regras ----------
  await open("AM", "/admin/remuneracao/regras", 1366, 768, [], 6000) // aquecimento (descartado)
  for (const [w, h] of VPS) {
    await open("AM", "/admin/remuneracao/regras", w, h, [], 3000)
    const t = await mainText()
    check(`regras ${w}: 3 avisos de rascunho`, /Configuração em rascunho/.test(t) && /Nenhuma regra financeira está ativa/.test(t) && /Nenhuma comissão será calculada nesta etapa/.test(t), t.slice(0, 300))
    check(`regras ${w}: versões, incompleto, primeira fatura não ativável, arquivada`, /v2 · Rascunho/.test(t) && /Rascunho incompleto/.test(t) && /Não ativável/.test(t) && /Arquivada/.test(t) && /R\$\s?33,00/.test(t) && /1,5%/.test(t), t.slice(0, 900))
    check(`regras ${w}: Ativar visível e desabilitado com motivo`, /Aguardando validação da integração financeira/.test(t) && (await dom(`[...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Ativar').every((b) => b.disabled) && [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Ativar')`)) === true)
    await capture("j4-regras", w, h)
  }
  await open("AF", "/admin/remuneracao/regras", 1366, 768, [], 3000)
  check("regras: Admin Financeiro acessa", /Nova regra em rascunho/.test(await mainText()))
  await clickText("Histórico (2)"); await sleep(300); await clickText("Comparar versões"); await sleep(400)
  const th = await mainText()
  check("regras: histórico com autor/motivo e comparação de versões", /Criada por Lab Admin Financeiro/.test(th) && /Motivo: Reajuste lab/.test(th) && /Valor fixo/.test(th) && /R\$\s?31,50/.test(th), th.slice(0, 1200))
  await capture("j4-regras-historico-comparacao", 1366, 768)

  // Formulário novo: vazio; sugestão só por clique; payload enviado
  const posted = []
  const captureRule = { match: (req) => { const u = new URL(req.url); if (u.host === `127.0.0.1:${APP_PORT}` && u.pathname === "/api/admin/remuneracao/regras" && req.method === "POST") { posted.push(req.postData || ""); return true } return false }, action: "fulfill", status: 201, body: JSON.stringify({ ok: true, idempotent: false, ruleId: "00000000-0000-4000-8000-000000000999", version: 1, status: "draft" }) }
  for (const [w, h] of VPS) {
    await open("AM", "/admin/remuneracao/regras", w, h, [captureRule], 3000)
    await clickText("Nova regra em rascunho"); await sleep(400)
    check(`regra nova ${w}: campos vazios (sem defaults)`, (await value("cr-name")) === "" && (await value("cr-role")) === "" && (await value("cr-method")) === "" && (await value("cr-from")) === "")
    check(`regra nova ${w}: Vendedor Interno desabilitado`, (await dom(`[...document.querySelectorAll('#cr-role option')].some((o) => /Vendedor Interno/.test(o.textContent) && o.disabled)`)) === true)
    await fill({ "cr-role": "technician_originator" }); await sleep(150); await fill({ "cr-method": "fixed_amount" }); await sleep(300)
    const t = await mainText()
    check(`regra nova ${w}: sugestão R$ 30,00 exibida mas campo vazio; gatilho derivado`, /Sugestão \(não salva\): R\$\s?30,00/.test(t) && (await value("cr-fixed")) === "" && /Quando a primeira fatura válida for gerada/.test(t), t.slice(0, 600))
    await capture("j4-regra-form", w, h)
  }
  await clickText("Usar sugestão"); await sleep(200)
  check("regra nova: sugestão aplicada somente após clique", (await value("cr-fixed")) === "30,00")
  await fill({ "cr-name": "Regra visual lab", "cr-from": d31, "cr-reason": "Teste visual lab" }); await sleep(200)
  browser.requests.splice(0)
  await clickText("Salvar rascunho"); await sleep(1200)
  const body = posted.length ? JSON.parse(posted[posted.length - 1]) : null
  check("regra nova: um POST com contrato fechado (sem active/retroactive/trigger)", body && Object.keys(body).sort().join() === "attributionRole,effectiveFrom,fixedAmount,idempotencyKey,method,name,reason" && body.fixedAmount === "30.00" && /^cc_[0-9a-f]{32}$/.test(body.idempotencyKey), body)
  check("regra nova: confirmação de rascunho salvo sem ativação", /Rascunho salvo \(versão 1\)\. Nenhuma regra foi ativada\./.test(await mainText()))
  // Erro de conflito exibido com mensagem amigável
  await open("AM", "/admin/remuneracao/regras", 390, 844, [{ ...captureRule, status: 409, body: JSON.stringify({ ok: false, code: "overlapping_rule" }) }], 3000)
  await clickText("Nova regra em rascunho"); await sleep(300)
  await fill({ "cr-name": "Regra sobreposta", "cr-role": "technician_originator" }); await sleep(100); await fill({ "cr-method": "fixed_amount" }); await sleep(200)
  await fill({ "cr-fixed": "12,00", "cr-from": d1, "cr-reason": "Teste sobreposição" }); await sleep(150)
  await clickText("Salvar rascunho"); await sleep(1000)
  check("regra: sobreposição exibida ao usuário", /mesmo papel e tipo com vigência sobreposta/.test(await mainText()))
  await capture("j4-regra-erro-sobreposicao", 390, 844)

  // ---------- 2) Remuneração individual ----------
  for (const [w, h] of VPS) {
    await open("AF", `/admin/remuneracao/funcionarios?funcionario=${E.FA}`, w, h, [], 3000)
    const t = await mainText()
    check(`funcionarios ${w}: setor/função/status e componentes`, /Lab Funcionário/.test(t) && /Técnico de Rua/.test(t) && /Ativo/.test(t) && /R\$\s?2\.500,00/.test(t) && /Oculto do funcionário/.test(t) && /Não configurado/.test(t) && /v2 · Rascunho/.test(t), t.slice(0, 900))
    check(`funcionarios ${w}: avisos e Ativar desabilitado`, /Configuração em rascunho/.test(t) && /Aguardando validação da integração financeira/.test(t))
    await capture("j4-funcionarios", w, h)
  }
  await clickText("Histórico (2)"); await sleep(300); await clickText("Comparar versões"); await sleep(300)
  const tf = await mainText()
  check("funcionarios: histórico + comparação (v1 sem transporte, v2 com)", /Motivo: Reajuste lab/.test(tf) && /R\$\s?2\.400,00/.test(tf) && /mensal fixo/.test(tf), tf.slice(0, 1200))
  await capture("j4-funcionarios-historico", 1366, 768)
  await open("AM", "/admin/remuneracao/funcionarios", 390, 844, [], 3000)
  check("funcionarios: sem seleção => estado inicial", /Selecione um funcionário/.test(await mainText()))
  await open("AM", `/admin/remuneracao/funcionarios?funcionario=${E.FA3}`, 390, 844, [], 3000)
  await clickText("Configurar remuneração"); await sleep(300)
  const emptyVals = await dom(`['cc-salary','cc-meal','cc-transport','cc-fuel','cc-from','cc-reason'].map((id) => document.getElementById(id)?.value)`)
  const showDisabled = await dom(`['cc-salary-show','cc-meal-show','cc-transport-show','cc-fuel-show'].every((id) => document.getElementById(id)?.disabled === true && document.getElementById(id)?.checked === false)`)
  check("perfil novo: todos os componentes vazios; exibir desabilitado sem valor", emptyVals.every((v) => v === "") && showDisabled === true, emptyVals)
  check("perfil novo: sugestão R$ 22,00 apenas como texto", /Sugestão \(não salva\): R\$\s?22,00 por dia/.test(await mainText()) && (await value("cc-meal")) === "")
  await capture("j4-perfil-form-vazio", 390, 844)
  for (const [w, h] of [[360, 800], [1366, 768]]) { await open("AM", `/admin/remuneracao/funcionarios?funcionario=${E.FA3}`, w, h, [], 3000); await clickText("Configurar remuneração"); await sleep(300); await capture("j4-perfil-form-vazio", w, h) }

  // ---------- 3) Bloqueios de página ----------
  for (const who of ["AC", "FA"]) {
    await open(who, "/admin/remuneracao/regras", 1366, 768, [], 2500)
    const href = await dom("location.pathname")
    check(`página regras: ${who} não acessa`, href !== "/admin/remuneracao/regras" && !/Nova regra em rascunho/.test(await mainText()), href)
  }

  // ---------- 4) Painel do funcionário ----------
  for (const [w, h] of VPS) {
    await open("FA", "/funcionario/remuneracao", w, h, [], 3000)
    const t = await mainText()
    check(`funcionário ${w}: somente visíveis (salário/passagem), vale oculto ausente`, /Salário/.test(t) && /R\$\s?2\.500,00/.test(t) && /Passagem/.test(t) && /R\$\s?180,00/.test(t) && !/Vale-refeição/.test(t) && !/21,75/.test(t) && !/Gasolina/.test(t), t.slice(0, 800))
    check(`funcionário ${w}: comissão não calculada, total estimado, aviso de não fechada, competência`, /Não calculada/.test(t) && /R\$\s?2\.680,00/.test(t) && /Não constituem folha fechada/.test(t) && /Competência atual: /.test(t) && !/Carteira|Sacar|saque/i.test(t), t.slice(0, 800))
    await capture("j4-funcionario-remuneracao", w, h)
  }
  await open("FA2", "/funcionario/remuneracao", 390, 844, [], 3000)
  const t2 = await mainText()
  check("funcionário B: somente combustível por dia, sem total, sem dados de A", /Gasolina/.test(t2) && /R\$\s?15,40/.test(t2) && /por dia trabalhado/.test(t2) && !/Total estimado/.test(t2) && !/2\.500|180,00|Salário/.test(t2) && /não entram no total estimado/.test(t2), t2.slice(0, 700))
  await capture("j4-funcionario-b", 390, 844)
  await open("FA3", "/funcionario/remuneracao", 390, 844, [], 3000)
  const t3 = await mainText()
  check("funcionário sem configuração: estado vazio amigável, nada como zero", /Nenhuma remuneração configurada para você ainda\./.test(t3) && !/R\$\s?0,00/.test(t3), t3.slice(0, 500))
  await capture("j4-funcionario-vazio", 390, 844)

  const snap1 = await zeroWriteSnapshot(c)
  check("zero-write durante navegação/API (financeiro/referrals/rewards/wallet/employees)", JSON.stringify(snap0) === JSON.stringify(snap1), { snap0, snap1 })
  const fin = (await c.query(`select (select count(*) from public.employee_commission_rules where active or status='active')::int ar, (select count(*) from public.employee_commission_entitlements)::int ent, (select count(*) from public.payroll_competences)::int comp, (select count(*) from public.payroll_competence_lines)::int lines`)).rows[0]
  check("ACTIVE_RULE/ENTITLEMENT/COMPETENCE/LINE = 0", fin.ar === 0 && fin.ent === 0 && fin.comp === 0 && fin.lines === 0, fin)
  check("mock: nenhuma escrita HTTP via tabela (somente RPC)", mock.stats.writeAttempts.length === 0, mock.stats.writeAttempts.slice(0, 5))
  summary.mockRpc = mock.stats.rpc
  summary.appLogTail = appLog.split("\n").filter((l) => /compensation-config|error/i.test(l)).slice(-8)
  const leak = appLog.match(/\b(2400\.00|2500\.00|2\.500,00|2\.400,00|21[.,]75|180[.,]00|15[.,]40|31[.,]50|33[.,]00)\b/)
  check("logs do app sem valores de remuneração", !leak, { match: leak?.[0], tail: summary.appLogTail })
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
console.log(`J4_VISUAL=${pass}/${results.length}`)
writeFileSync(join(OUT, "summary.json"), JSON.stringify({ results, ...summary }, null, 2))
process.exit(ok ? 0 : 1)

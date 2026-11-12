// 3.1F-J2 — E2E LOCAL: Next (build local) -> APIs -> Supabase simulado -> PostgreSQL de lab.
// 127.0.0.1 somente. Sem produção, sem ERP, sem Sync, sem dados reais.
// Env: J2_APP_DIR (app já construído com NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329),
//      J2_OUT_DIR (saída), J2_BROWSER (Edge/Chrome; opcional), IGT_PG_LAB_ROOT/IGT_PG_LAB_PORT.
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { startJ2Lab, zeroWriteSnapshot } from "../j2-lab-chain.mjs"
import { startMockSupabase, labSessionCookie } from "./mock-supabase.mjs"
import { launchBrowser, AUDIT_JS } from "./cdp.mjs"

const APP_DIR = resolve(process.env.J2_APP_DIR || process.cwd())
const OUT = resolve(process.env.J2_OUT_DIR || join(process.cwd(), "j2-e2e-out"))
const BROWSER = process.env.J2_BROWSER || ""
const MOCK_PORT = 54329, APP_PORT = Number(process.env.J2_APP_PORT || 3210)
const APP = `http://127.0.0.1:${APP_PORT}`
const ANON = "lab-anon-key-not-a-secret", SERVICE = "lab-service-key-not-a-secret"
const COOKIE = "sb-127-auth-token"
mkdirSync(join(OUT, "png"), { recursive: true })
const res = []
let ok = true
const log = (m) => process.stdout.write(`[e2e] ${m}\n`)
const t = async (name, fn) => {
  if (process.env.J2_E2E_VERBOSE) log(name)
  try { const v = await fn(); res.push([name, v === true ? "PASS" : "FAIL " + JSON.stringify(v).slice(0, 600)]); if (v !== true) ok = false }
  catch (e) { res.push([name, "FAIL " + e.message]); ok = false }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const U = {
  A: ["66666666-0000-4000-8000-00000000000a", "funcionario", "active", "Lab Funcionário A"],
  P: ["66666666-0000-4000-8000-000000000001", "funcionario", "paused", "Lab Funcionário P"],
  D: ["66666666-0000-4000-8000-000000000002", "funcionario", "dismissed", "Lab Funcionário D"],
  N: ["66666666-0000-4000-8000-000000000003", "funcionario", null, "Lab Sem Vínculo"],
  F: ["66666666-0000-4000-8000-00000000000f", "funcionario", "active", "Lab Demo Funcionária com Nome Bem Comprido Para Teste"],
  AM: ["66666666-0000-4000-8000-000000000010", "admin_master", null, "Lab Admin Master"],
  AF: ["66666666-0000-4000-8000-000000000011", "admin_financeiro", null, "Lab Admin Financeiro"],
  AC: ["66666666-0000-4000-8000-000000000012", "admin_consulta", null, "Lab Admin Consulta"],
  CM: ["66666666-0000-4000-8000-000000000013", "comercial", null, "Lab Comercial"],
  IN: ["66666666-0000-4000-8000-000000000014", "indicador", null, "Lab Indicador"],
}
const users = Object.fromEntries(Object.entries(U).map(([k, u]) => [u[0], { email: `${k.toLowerCase()}@lab.invalid` }]))
const cookieFor = (k) => (k ? `${COOKIE}=${labSessionCookie(U[k][0], `${k.toLowerCase()}@lab.invalid`)}` : "")

const lab = await startJ2Lab({ applyJ2: true })
const { c } = lab
let app, mock, browser
const summary = { screenshots: [], audits: [], httpChecks: 0, loadingPages: {} }
try {
  for (const [k, [id, role, status, name]] of Object.entries(U)) {
    await c.query(`insert into public.profiles(id,email,role,is_active,full_name,must_change_password) values ($1,$2,$3,true,$4,false)`, [id, `${k.toLowerCase()}@lab.invalid`, role, name])
    if (status) await c.query(`insert into public.employees(profile_id,status,dismissed_at) values ($1,$2::public.employee_status,case when $2='dismissed' then now() end)`, [id, status])
  }
  // Fase E2E vazia (como produção): nenhuma linha financeira/atribuição.
  // Lab: simula o grant padrão do Supabase para service_role (somente SELECT; o simulador recusa escrita).
  // Necessário apenas para código legado já existente (contexto operacional); nenhuma rota J2 usa service_role.
  await c.query("grant select on all tables in schema public to service_role")
  const snap0 = await zeroWriteSnapshot(c)
  await t("E2E_financial_tables_empty_before", () => ["commission_rules", "attributions", "entitlements", "compensation_profiles", "worked_days", "competences", "payroll_lines", "finance_audit_events"].every((k) => snap0[k] === 0) || snap0)

  log("lab ready")
  mock = await startMockSupabase({ port: MOCK_PORT, client: c, anonKey: ANON, serviceKey: SERVICE, allowOrigin: APP, users })
  app = spawn(process.execPath, [join(APP_DIR, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
    cwd: APP_DIR,
    env: { ...process.env, NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let appLog = ""
  app.stdout.on("data", (d) => { appLog += d })
  app.stderr.on("data", (d) => { appLog += d })
  for (let i = 0; i < 120; i++) { await sleep(500); if (await fetch(`${APP}/login`).then((r) => r.ok).catch(() => false)) break }

  log("app ready")
  // ---------------- HTTP: APIs ----------------
  const get = (path, who, init = {}) => fetch(APP + path, { redirect: "manual", ...init, headers: { ...(init.headers || {}), ...(who ? { cookie: cookieFor(who) } : {}) } })
  const json = async (r) => r.json().catch(() => null)
  const APIS = ["/api/employee/dashboard", "/api/employee/sales", "/api/employee/sales/00000000-0000-4000-8000-000000000999", "/api/employee/compensation", "/api/employee/compensation/2026-11"]
  for (const p of APIS) {
    const r = await get(p, null)
    await t(`API_401_no_session ${p}`, async () => r.status === 401 && r.headers.get("cache-control")?.includes("no-store") || r.status)
  }
  const dash = await get("/api/employee/dashboard", "A")
  const dashBody = await json(dash)
  await t("API_A_dashboard_200_no_store", () => (dash.status === 200 && dash.headers.get("cache-control")?.includes("no-store") && dash.headers.get("vary")?.includes("Cookie")) || dash.status)
  await t("API_A_dashboard_real_zeros_closed_contract", () => (dashBody?.ok === true && Object.keys(dashBody).sort().join(",") === "data,ok" && dashBody.data.opportunitiesInMonth === 0 && dashBody.data.commissionAccruedInCompetence === "0.00" && dashBody.data.currentCompetence === null && dashBody.data.recent.length === 0 && Object.keys(dashBody.data).length === 10) || dashBody)
  const sales = await json(await get("/api/employee/sales", "A"))
  await t("API_A_sales_empty_paginated", () => (sales?.ok && sales.data.total === 0 && sales.data.items.length === 0 && sales.data.limit === 20 && sales.data.offset === 0) || sales)
  const sales2 = await json(await get("/api/employee/sales?limit=5&page=2&sort=created_asc&stage=novo&status=pendente&commission=none&from=2026-01-01&to=2026-12-31", "A"))
  await t("API_A_sales_filters_and_page", () => (sales2?.ok && sales2.data.limit === 5 && sales2.data.offset === 5 && sales2.data.sort === "created_asc") || sales2)
  const comp = await json(await get("/api/employee/compensation", "A"))
  await t("API_A_compensation_empty_no_profile", () => (comp?.ok && comp.data.profile === null && comp.data.competences.length === 0 && !("salary" in comp.data)) || comp)
  const cmpD = await get("/api/employee/compensation/2026-11", "A")
  await t("API_A_competence_without_record_404", () => cmpD.status === 404 || cmpD.status)
  const det = await get("/api/employee/sales/00000000-0000-4000-8000-000000000999", "A")
  const detBad = await get("/api/employee/sales/not-a-uuid", "A")
  const detBodyA = await json(det), detBodyB = await json(detBad)
  await t("API_A_detail_unknown_404_and_bad_uuid_400", () => (det.status === 404 && detBad.status === 400 && detBodyA?.ok === false && detBodyB?.ok === false) || [det.status, detBad.status])
  // 3.1F-J2B: autenticação/autorização ANTES da validação de path/query.
  const INVALID = ["/api/employee/dashboard?foo=1", "/api/employee/sales?limit=999&sort=x", "/api/employee/sales/not-a-uuid", "/api/employee/compensation?offset=-1", "/api/employee/compensation/2026-11-15"]
  const rpcTotal = () => Object.values(mock.stats.rpc).reduce((a, b) => a + b, 0)
  const rpcBefore = rpcTotal()
  for (const p of INVALID) {
    const anon = await get(p, null)
    const anonBody = await json(anon)
    await t(`API_J2B_anon_invalid_401 ${p}`, () => (anon.status === 401 && anon.headers.get("cache-control")?.includes("no-store") && anon.headers.get("vary")?.includes("Cookie") && !/inválid|desconhecid|permitido|limit|sort|offset|Competência/i.test(String(anonBody?.message))) || [anon.status, anonBody])
    for (const who of ["AC", "AM", "CM", "IN", "N", "D"]) {
      const r = await get(p, who)
      await t(`API_J2B_denied_invalid_403 ${who} ${p}`, () => r.status === 403 || r.status)
    }
    const ok = await get(p, "A")
    await t(`API_J2B_authorized_invalid_400 ${p}`, () => ok.status === 400 || ok.status)
  }
  await t("API_J2B_no_rpc_for_anon_denied_or_invalid", () => rpcTotal() === rpcBefore || [rpcBefore, rpcTotal()])
  for (const [q, label] of [["limit=0", "limit_0"], ["limit=51", "limit_51"], ["sort=referred_phone", "sort"], ["stage=x", "stage"], ["status=x", "status"], ["commission=x", "commission"], ["from=2026-02-30", "date"], ["from=2026-03-01&to=2026-02-01", "range"], ["employee_id=66666666-0000-4000-8000-000000000002", "employee_id"], ["employeeId=x", "employeeId"], ["foo=1", "unknown"], ["offset=99999", "offset"]]) {
    const r = await get(`/api/employee/sales?${q}`, "A")
    await t(`API_query_validation_400 ${label}`, () => r.status === 400 || r.status)
  }
  for (const p of ["/api/employee/dashboard?employee_id=x", "/api/employee/compensation?profile_id=x", "/api/employee/compensation/2026-13", "/api/employee/compensation/2026-11-01"]) {
    const r = await get(p, "A")
    await t(`API_param_rejected_400 ${p}`, () => r.status === 400 || r.status)
  }
  for (const who of ["P"]) {
    const r = await json(await get("/api/employee/dashboard", who))
    await t(`API_${who}_paused_read_only_allowed`, () => (r?.ok && r.data.readOnly === true) || r)
  }
  for (const who of ["D", "N", "AM", "AF", "AC", "CM", "IN"]) for (const p of APIS) {
    const r = await get(p, who)
    await t(`API_403 ${who} ${p}`, async () => (r.status === 403 && r.headers.get("cache-control")?.includes("no-store")) || r.status)
  }
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) for (const p of [...APIS, "/api/admin/remuneracao"]) {
    const r = await get(p, "A", { method: m })
    await t(`API_method_${m}_not_allowed ${p}`, () => r.status === 405 || r.status)
  }
  const adm = async (who) => get("/api/admin/remuneracao", who)
  await t("ADMIN_API_401_no_session", async () => (await adm(null)).status === 401)
  for (const who of ["AC", "CM", "IN", "A", "D"]) await t(`ADMIN_API_403 ${who}`, async () => (await adm(who)).status === 403)
  for (const who of ["AM", "AF"]) await t(`ADMIN_API_200 ${who}`, async () => { const r = await adm(who); const b = await json(r); return (r.status === 200 && b.data.configurationAvailable === false && r.headers.get("cache-control")?.includes("no-store")) || b })

  // ---------------- HTTP: páginas (middleware de produção + guard server-side) ----------------
  const ADMIN_PAGES = ["/admin/remuneracao", "/admin/remuneracao/regras", "/admin/remuneracao/funcionarios", "/admin/remuneracao/dias-trabalhados", "/admin/remuneracao/competencias", "/admin/remuneracao/auditoria"]
  for (const p of ADMIN_PAGES) {
    for (const who of ["AC", "CM", "IN", "A"]) {
      const r = await get(p, who)
      await t(`PAGE_direct_url_denied ${who} ${p}`, () => (r.status >= 300 && r.status < 400 && !String(r.headers.get("location")).includes("/admin/remuneracao")) || [r.status, r.headers.get("location")])
    }
    const anon = await get(p, null)
    await t(`PAGE_anon_to_login ${p}`, () => (anon.status >= 300 && anon.status < 400 && String(anon.headers.get("location")).includes("/login")) || anon.status)
    for (const who of ["AM", "AF"]) {
      const r = await get(p, who)
      const html = await r.text()
      await t(`PAGE_allowed ${who} ${p}`, () => (r.status === 200 && html.includes("Nenhuma configuração criada") && !/<form|<button[^>]*type="submit"|Salvar|Ativar|Calcular|Fechar compet|Registrar pagamento/i.test(html.replace(/<script[\s\S]*?<\/script>/g, ""))) || r.status)
    }
  }
  await t("PAGE_admin_consulta_legacy_admin_still_allowed", async () => (await get("/admin", "AC")).status === 200)
  await t("PAGE_admin_consulta_financeiro_indique_ganhe_unchanged", async () => (await get("/admin/financeiro", "AC")).status === 200)
  for (const p of ["/funcionario", "/funcionario/vendas", "/funcionario/remuneracao"]) {
    const r = await get(p, "A")
    const html = await r.text()
    await t(`PAGE_funcionario_200 ${p}`, () => (r.status === 200 && !/Saldo dispon[ií]vel|Solicitar saque|DADOS SINT/i.test(html)) || r.status)
    const am = await get(p, "AM")
    await t(`PAGE_funcionario_denied_admin ${p}`, () => (am.status >= 300 && am.status < 400) || am.status)
  }
  const nova = await get("/funcionario/nova-oportunidade", "A")
  await t("PAGE_nova_oportunidade_not_functional", async () => { const h = await nova.text(); return (nova.status === 404 || !/<form/i.test(h)) || nova.status })
  summary.httpChecks = res.length

  // ---------------- Navegador: screenshots + auditoria ----------------
  const VIEWPORTS = [[360, 800], [390, 844], [1366, 768]]
  const shot = async (who, path, name, vps = VIEWPORTS, extra = {}) => {
    for (const [w, h] of vps) {
      await browser.setCookie(who ? COOKIE : null, who ? labSessionCookie(U[who][0], `${who.toLowerCase()}@lab.invalid`) : null, APP)
      browser.takeDiag()
      const finalPath = await browser.open(APP + path, w, h, extra.settle ?? 3000)
      const diag = browser.takeDiag().slice(0, 25)
      if (process.env.J2_E2E_DEBUG) log(`${name} ${w} -> ${finalPath}\n  ` + diag.join("\n  "))
      const audit = await browser.evaluate(AUDIT_JS)
      const file = `${name}-${w}x${h}.png`
      writeFileSync(join(OUT, "png", file), await browser.screenshot(true))
      summary.screenshots.push(file)
      summary.audits.push({ ...audit, who, path, finalPath, viewport: `${w}x${h}`, file, diagCount: diag.length })
    }
  }
  if (BROWSER) {
    browser = await launchBrowser(BROWSER)
    summary.browser = browser.version
    await shot("A", "/funcionario", "01-funcionario-inicio-vazio")
    await shot("A", "/funcionario/vendas", "02-minhas-vendas-vazio")
    await shot("A", "/funcionario/vendas/00000000-0000-4000-8000-000000000999", "03-detalhe-venda-nao-encontrada", [[390, 844], [1366, 768]])
    await shot("A", "/funcionario/remuneracao", "04-minha-remuneracao-vazio")
    await shot("A", "/funcionario/remuneracao/2026-11", "05-competencia-inexistente", [[390, 844], [1366, 768]])
    await shot("A", "/funcionario/vendas?stage=x", "06-minhas-vendas-filtro-invalido", [[390, 844]])
    await shot("P", "/funcionario", "07-funcionario-pausado-somente-leitura", [[390, 844]])
    await shot("AM", "/admin/remuneracao", "08-admin-remuneracao-master")
    await shot("AF", "/admin/remuneracao/regras", "09-admin-remuneracao-regras-financeiro", [[390, 844], [1366, 768]])
    await shot("AC", "/admin/remuneracao", "10-admin-consulta-redirecionado", [[1366, 768]])
    await shot("AC", "/admin/funcionarios", "11-admin-consulta-menu-equipe", [[1366, 768]], { settle: 6000 })
    // Teclado: Tab percorre elementos focáveis na página de vendas.
    await browser.setCookie(COOKIE, labSessionCookie(U.A[0], "a@lab.invalid"), APP)
    await browser.open(APP + "/funcionario/vendas", 1366, 768, 3000)
    const focusTrail = []
    for (let i = 0; i < 40; i++) { await browser.pressTab(); focusTrail.push(await browser.evaluate(`(() => { const e = document.activeElement; if (!e) return null; const s = getComputedStyle(e); return { tag: e.tagName, label: (e.getAttribute('aria-label') || e.textContent || e.name || '').trim().slice(0, 30), inMain: !!e.closest('main'), outline: s.outlineStyle !== 'none' && s.outlineWidth !== '0px' || s.boxShadow !== 'none' } })()`)) }
    summary.focusTrail = focusTrail
    const navCheck = async (who, path) => { await browser.setCookie(COOKIE, labSessionCookie(U[who][0], "x@lab.invalid"), APP); await browser.open(APP + path, 1366, 768, 6000); return browser.evaluate(`({ remun: !!document.querySelector('a[href="/admin/remuneracao"]'), fin: [...document.querySelectorAll('a[href="/admin/financeiro"]')].map(a => a.textContent.trim()), vendas: !!document.querySelector('a[href="/funcionario/vendas"]'), remunF: !!document.querySelector('a[href="/funcionario/remuneracao"]'), nova: !!document.querySelector('a[href="/funcionario/nova-oportunidade"]') })`) }
    summary.nav = { AM: await navCheck("AM", "/admin/remuneracao"), AC: await navCheck("AC", "/admin/funcionarios"), A: await navCheck("A", "/funcionario") }
    // Seção K (lab): telas legadas após espera normal.
    for (const p of ["/admin/comerciais", "/admin/indicacoes", "/admin/funcionarios"]) {
      await browser.setCookie(COOKIE, labSessionCookie(U.AM[0], "am@lab.invalid"), APP)
      const t0 = Date.now()
      await browser.open(APP + p, 1366, 768, 1000)
      let loading = true, waited = 0
      while (loading && waited < 15000) { loading = await browser.evaluate(`/Carregando/i.test(document.querySelector('main')?.innerText || '')`); if (loading) { await sleep(500); waited += 500 } }
      summary.loadingPages[p] = { stillLoadingAfterMs: loading ? waited : null, settledMs: loading ? null : Date.now() - t0 }
      writeFileSync(join(OUT, "png", `k-${p.split("/").pop()}-1366x768.png`), await browser.screenshot(false))
    }
  }
  const snap1 = await zeroWriteSnapshot(c)
  await t("ZERO_WRITE_INVARIANT_E2E_empty", () => JSON.stringify(snap0) === JSON.stringify(snap1) || { snap0, snap1 })
  await t("MOCK_no_http_write_attempts", () => mock.stats.writeAttempts.length === 0 || mock.stats.writeAttempts)

  // ---------------- Fase populada (SIMULAÇÃO lab-only para textos longos/valores) ----------------
  if (BROWSER) {
    const F = (await c.query(`select id from public.employees where profile_id=$1`, [U.F[0]])).rows[0].id
    await c.query("set session_replication_role = replica")
    await c.query("alter table public.employee_compensation_profiles drop constraint if exists employee_compensation_profiles_foundation_inactive_chk")
    const plan = (await c.query(`insert into public.plans(name, speed_label, price, reward_amount) values ('Plano Fibra Empresarial Ultra 1 Giga com Wi-Fi 6 e IP Fixo Dedicado','1G',1,0) returning id`)).rows[0].id
    const ids = []
    for (let i = 0; i < 7; i++) {
      const r = (await c.query(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind,pipeline_stage,first_invoice_paid) values ($1,$2,'11900000000',$3,false,'legacy',$4,$5) returning id`, [U.IN[0], `Interessado Sintético Número ${i + 1} Sobrenome Muito Extenso`, plan, ["novo", "negociacao", "agendado", "instalacao", "ativado", "perdido", "contato_realizado"][i], i === 4])).rows[0].id
      ids.push(r)
      await c.query(`insert into public.sales_opportunity_attributions(opportunity_id,employee_id,attribution_role,source) values ($1,$2,$3,'attribution_rpc')`, [r, F, ["technician_originator", "external_sales_originator", "internal_sales_responsible"][i % 3]])
    }
    await c.query(`insert into public.referral_history(referral_id,old_status,new_status) values ($1,'pendente','em_andamento'),($1,'em_andamento','em_negociacao')`, [ids[1]])
    const month = (await c.query(`select date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date::text m`)).rows[0].m
    const prof = (await c.query(`insert into public.employee_compensation_profiles(employee_id,version,valid_from,salary_enabled,salary_amount,meal_enabled,meal_daily_amount,transport_enabled,transport_amount,transport_method,show_salary,show_meal,show_transport,status,idempotency_key) values ($1,1,'2026-01-01',true,9876.54,true,35.5,true,420,'monthly_fixed',false,true,true,'active','labdemoprof000000000001') returning id`, [F])).rows[0].id
    const compId = (await c.query(`insert into public.payroll_competences(employee_id,competence_month,period_start,period_end,status,idempotency_key) values ($1,$2::date,$2::date,public.payroll_competence_period_end($2::date),'draft','labdemocomp000000000001') returning id`, [F, month])).rows[0].id
    await c.query(`insert into public.payroll_competence_lines(competence_id,line_type,compensation_profile_id,description,amount,idempotency_key) values ($1,'transport',$2,'Transporte mensal fixo referente ao deslocamento até os clientes da região',420,'labdemoline000000000001'),($1,'base_salary',$2,'Salario base',9876.54,'labdemoline000000000002')`, [compId, prof])
    await c.query("set session_replication_role = origin")
    const snap2 = await zeroWriteSnapshot(c)
    await shot("F", "/funcionario", "20-funcionario-inicio-com-dados", VIEWPORTS)
    await shot("F", "/funcionario/vendas", "21-minhas-vendas-com-dados", VIEWPORTS)
    await shot("F", `/funcionario/vendas/${ids[1]}`, "22-detalhe-venda-com-dados", [[360, 800], [1366, 768]])
    await shot("F", "/funcionario/remuneracao", "23-minha-remuneracao-com-dados", VIEWPORTS)
    await shot("F", `/funcionario/remuneracao/${month.slice(0, 7)}`, "24-competencia-com-dados", [[360, 800], [1366, 768]])
    const fComp = await json(await get(`/api/employee/compensation/${month.slice(0, 7)}`, "F"))
    await t("E2E_populated_hidden_salary_absent_from_api_json", () => (fComp?.ok && !("salary" in fComp.data.components) && !JSON.stringify(fComp).includes("9876")) || fComp)
    const fProf = await json(await get(`/api/employee/compensation`, "F"))
    await t("E2E_populated_hidden_salary_absent_from_profile_json", () => (fProf?.ok && !("salary" in fProf.data.profile) && fProf.data.profile.transport?.amount === "420.00" && fProf.data.profile.meal?.dailyAmount === "35.50") || fProf)
    const aSales = await json(await get("/api/employee/sales", "A"))
    await t("E2E_A_isolated_from_F", () => (aSales?.ok && aSales.data.total === 0) || aSales)
    const fSales = await json(await get("/api/employee/sales?limit=5", "F"))
    await t("E2E_F_pagination_total_7_page_5", () => (fSales?.ok && fSales.data.total === 7 && fSales.data.items.length === 5) || fSales)
    const snap3 = await zeroWriteSnapshot(c)
    await t("ZERO_WRITE_INVARIANT_E2E_populated_reads", () => JSON.stringify(snap2) === JSON.stringify(snap3) || { snap2, snap3 })
  }
  for (const a of summary.audits) {
    const expectRedirect = a.who === "AC" && a.path.startsWith("/admin/remuneracao")
    // Telas legadas (fora do diff J2) são auditadas apenas como informação (seção K / regressão visual).
    const legacy = !expectRedirect && /^\/admin\/(comerciais|indicacoes|funcionarios)(\/|$)/.test(a.path)
    if (legacy) { summary.legacyAuditInfo = [...(summary.legacyAuditInfo || []), { file: a.file, unlabeled: a.unlabeled, buttonsNoName: a.buttonsNoName, overflowX: a.overflowX, stillLoading: a.stillLoading }]; continue }
    await t(`UI ${a.file}`, () => {
      const problems = []
      if (a.overflowX) problems.push(`overflowX ${a.scrollWidth}>${a.innerWidth}`)
      if (a.unlabeled.length) problems.push(`unlabeled ${a.unlabeled}`)
      if (a.buttonsNoName) problems.push(`buttonsNoName ${a.buttonsNoName}`)
      if (a.lowContrast.length) problems.push(`lowContrast ${JSON.stringify(a.lowContrast.slice(0, 3))}`)
      if (a.hasForbiddenTerms) problems.push("forbiddenTerms")
      if (a.hasWireframeMarker) problems.push("wireframeMarker")
      if (a.stillLoading) problems.push("stillLoading")
      if (a.forms.some((f) => f.method !== "get")) problems.push("non-GET form")
      if (!expectRedirect && a.h1.length === 0) problems.push("no h1")
      if (expectRedirect && a.finalPath.startsWith("/admin/remuneracao")) problems.push("admin_consulta reached remuneracao")
      if (!expectRedirect && a.finalPath.split("?")[0] !== a.path.split("?")[0]) problems.push(`unexpected redirect ${a.finalPath}`)
      if (Number(a.viewport.split("x")[0]) < 1024 && !a.mobileMenuButton && !expectRedirect) problems.push("no mobile menu button")
      if (a.who !== "F" && a.hasDefaultsShown) problems.push("defaults shown")
      return problems.length === 0 || problems
    })
  }
  summary.mockStats = mock.stats
  summary.appLogTail = appLog.split("\n").filter((l) => /error|warn/i.test(l)).slice(-30)
} finally {
  if (browser) await browser.close()
  if (app) { app.kill(); await sleep(800) }
  if (mock) await mock.close()
  await lab.stop()
}
for (const r of res) console.log(r.join(" | "))
const pass = res.filter((r) => r[1] === "PASS").length
console.log(`J2_E2E_TESTS=${pass}/${res.length}`)
console.log(ok ? "J2_E2E=PASS" : "J2_E2E=FAIL")
writeFileSync(join(OUT, "e2e-result.json"), JSON.stringify({ pass, total: res.length, ok, res, summary }, null, 2))
process.exit(ok ? 0 : 1)

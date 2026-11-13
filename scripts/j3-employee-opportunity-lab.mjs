// 3.1F-J3 — oportunidade de venda do funcionário: cadeia real (base → H1 → H1B → I1 → J2 → J3) num
// PostgreSQL local descartável (127.0.0.1). Não usa DATABASE_URL, não conecta em produção, não chama ERP.
// Porta: IGT_PG_LAB_PORT (default 55474); raiz: IGT_PG_LAB_ROOT. Parada somente via lab.stop().
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { startJ2Lab, zeroWriteSnapshot } from "./j2-lab-chain.mjs"

export const J3_PATCH = "supabase/patch-employee-sales-opportunity-3-1f-j3.sql"
export const J3_PREFLIGHT = "supabase/preflight-employee-sales-opportunity-3-1f-j3.sql"
export const J3_VERIFY = "supabase/verify-employee-sales-opportunity-3-1f-j3.sql"

const res = []
let ok = true
const lab = await startJ2Lab({ applyJ2: true })
const { c, conn, Client, REPO_ROOT } = lab
const q = async (sql, p = []) => (await c.query(sql, p)).rows
const one = async (sql, p = []) => (await q(sql, p))[0]
const t = async (name, fn) => {
  try { const v = await fn(); res.push([name, v === true ? "PASS" : "FAIL " + JSON.stringify(v).slice(0, 900)]); if (v !== true) ok = false }
  catch (e) { await c.query("rollback").catch(() => {}); res.push([name, "FAIL " + e.message]); ok = false }
}
// Cliente PostgREST simulado (role + claim). commit=true grava (fluxo real); false => rollback.
const call = async (role, uid, sql, p = [], commit = true, client = c) => {
  await client.query("begin")
  try {
    await client.query(`set local role ${role}`)
    if (uid) await client.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid])
    const r = await client.query(`select ${sql} as r`, p)
    await client.query(commit ? "commit" : "rollback")
    return { ok: true, r: r.rows[0].r }
  } catch (e) { await client.query("rollback").catch(() => {}); return { ok: false, msg: e.message, code: e.code } }
}
const submit = (uid, payload, client = c) => call("authenticated", uid, "public.submit_employee_sales_opportunity($1::jsonb)", [JSON.stringify(payload)], true, client)

const id = (n) => `66666666-0000-4000-8000-${String(n).padStart(12, "0")}`
const P = { T: id(1), X: id(2), D: id(3), N: id(4), PZ: id(5), T2: id(6), AM: id(7), CM: id(8), IND: id(9), AC: id(10), CM2: id(11) }
let seq = 0
const key = () => `j3labkey${String(++seq).padStart(4, "0")}${"x".repeat(12)}`
let PLAN, PLAN_OFF
const base = (over = {}) => ({
  idempotencyKey: key(), planId: PLAN, name: "Maria  da Silva Teste", phone: "(31) 99876-0001", zipcode: "30.140-071",
  street: "Rua Lab", number: "10", neighborhood: "Centro", city: "Belo Horizonte", consent: true, ...over,
})

try {
  // ---------- preflight / apply / reapply / verify ----------
  const catalog = async () => one(`select
    (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','m','p')) rels,
    (select count(*)::int from pg_policies where schemaname='public') policies,
    (select md5(string_agg(policyname||cmd||coalesce(qual,'')||coalesce(with_check,''), '|' order by tablename, policyname)) from pg_policies where schemaname='public') policies_md5,
    (select count(*)::int from pg_trigger t join pg_class k on k.oid=t.tgrelid where k.relnamespace='public'::regnamespace and not t.tgisinternal) triggers,
    (select count(*)::int from information_schema.columns where table_schema='public') cols,
    (select md5(string_agg(conname||pg_get_constraintdef(oid), '|' order by conrelid::regclass::text, conname)) from pg_constraint where connamespace='public'::regnamespace) constraints_md5,
    (select md5(string_agg(p.oid::regprocedure::text || coalesce(p.proacl::text,'') || md5(p.prosrc), '|' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace='public'::regnamespace
       and p.proname not in ('employee_opportunity_normalize_phone','employee_opportunity_eligible_roles','employee_opportunity_form_context','submit_employee_sales_opportunity','list_employee_sales_filtered','list_employee_opportunity_origins','create_employee_sales_opportunity')) other_funcs,
    (select md5(prosrc) from pg_proc where proname='create_employee_sales_opportunity') h1_src`)
  const cat0 = await catalog()
  const preM = Object.fromEntries((await c.query(readFileSync(join(REPO_ROOT, J3_PREFLIGHT), "utf8"))).rows.map((r) => [r.metric, r.value]))
  await t("PREFLIGHT_prereqs_true", () => Object.entries(preM).filter(([k]) => k.startsWith("prereq_")).every(([, v]) => v === "true") || preM)
  await t("PREFLIGHT_no_existing_j3_objects", () => (preM.existing_j3_functions === "0" && preM.existing_j3_index === "false") || preM)
  await t("PREFLIGHT_h1_rpc_executable_before", () => preM.h1_rpc_authenticated_execute === "true" || preM)
  await t("PREFLIGHT_financial_zero", () => Object.entries(preM).filter(([k]) => k.startsWith("count_")).every(([, v]) => v === "0") || preM)
  const sql = readFileSync(join(REPO_ROOT, J3_PATCH), "utf8")
  await t("APPLY_first", async () => { await c.query(sql); return true })
  const acl = () => q(`select oid::regprocedure::text s, proacl::text a, md5(prosrc) m from pg_proc where pronamespace='public'::regnamespace and proname in ('employee_opportunity_normalize_phone','employee_opportunity_eligible_roles','employee_opportunity_form_context','submit_employee_sales_opportunity','list_employee_sales_filtered','list_employee_opportunity_origins','create_employee_sales_opportunity') order by 1`)
  const acl1 = await acl()
  await t("APPLY_reapply_idempotent", async () => { await c.query(sql); return true })
  await t("APPLY_reapply_acl_and_bodies_unchanged", async () => JSON.stringify(await acl()) === JSON.stringify(acl1))
  const cat1 = await catalog()
  await t("ADDITIVE_no_new_or_changed_table_policy_trigger_constraint", () => (cat0.rels === cat1.rels && cat0.policies === cat1.policies && cat0.policies_md5 === cat1.policies_md5 && cat0.triggers === cat1.triggers && cat0.cols === cat1.cols && cat0.constraints_md5 === cat1.constraints_md5) || { cat0, cat1 })
  await t("ADDITIVE_existing_functions_untouched", () => cat0.other_funcs === cat1.other_funcs)
  await t("ADDITIVE_h1_body_untouched", () => cat0.h1_src === cat1.h1_src)
  for (const r of (await c.query(readFileSync(join(REPO_ROOT, J3_VERIFY), "utf8"))).rows) await t(`VERIFY_${r.check_name}`, () => r.ok === true)
  await t("TRANSACTIONAL_begin_commit", () => /^\s*begin;/m.test(sql) && /^\s*commit;\s*$/m.test(sql))
  const sqlNoComments = sql.replace(/--[^\n]*/g, "")
  await t("MIGRATION_no_table_policy_trigger_ddl_no_backfill", () => !/\b(alter|drop)\s+(table|policy|trigger|type|index)\b|\bcreate\s+(table|policy|trigger)\b|\bupdate\s+public\.|\bdelete\s+from\b|\btruncate\b/i.test(sqlNoComments))
  await t("MIGRATION_no_money_defaults", () => !/\b(30|50|22)(\.00)?\b|0\.02|2\s*%/.test(sqlNoComments.replace(/'[^']*'/g, "''").replace(/length\([^)]*\)\s*[<>=]+\s*\d+|in \(\d+, \d+\)|\{\d+,\d+\}|p_limit\s*>\s*\d+|interval|statement_timeout|lock_timeout/g, "")) || "money-like literal")
  await t("NORMALIZE_phone_cases", async () => {
    const r = await one(`select public.employee_opportunity_normalize_phone('+55 (31) 99876-0001') a, public.employee_opportunity_normalize_phone('3132220000') b, public.employee_opportunity_normalize_phone('12') c, public.employee_opportunity_normalize_phone(null) d`)
    return (r.a === "31998760001" && r.b === "3132220000" && r.c === null && r.d === null) || r
  })

  // ---------- fixtures sintéticos ----------
  PLAN = (await one(`insert into public.plans(name,speed_label,price,reward_amount,is_active) values ('Plano Lab 500','500 Mega',99.9,0,true) returning id`)).id
  PLAN_OFF = (await one(`insert into public.plans(name,speed_label,price,reward_amount,is_active) values ('Plano Lab Off','1 Giga',199.9,0,false) returning id`)).id
  await c.query(`insert into public.profiles(id,email,role,is_active,full_name) values
    ($1,'t@lab.invalid','funcionario',true,'Tecnico Lab Um'),($2,'x@lab.invalid','funcionario',true,'Vendedor Lab Externo'),
    ($3,'d@lab.invalid','funcionario',true,'Duplo Lab'),($4,'n@lab.invalid','funcionario',true,'Sem Funcao Lab'),
    ($5,'pz@lab.invalid','funcionario',true,'Pausado Lab'),($6,'t2@lab.invalid','funcionario',true,'Tecnico Lab Dois'),
    ($7,'am@lab.invalid','admin_master',true,'Admin Lab'),($8,'cm@lab.invalid','comercial',true,'Comercial Lab'),
    ($9,'in@lab.invalid','indicador',true,'Indicador Lab'),($10,'ac@lab.invalid','admin_consulta',true,'Consulta Lab'),
    ($11,'cm2@lab.invalid','comercial',true,'Comercial Lab Dois')
    on conflict (id) do nothing`, [P.T, P.X, P.D, P.N, P.PZ, P.T2, P.AM, P.CM, P.IND, P.AC, P.CM2])
  const S = Object.fromEntries((await q(`select code, id from public.sectors`)).map((r) => [r.code, r.id]))
  const E = {}
  for (const [k, st] of [["T", "active"], ["X", "active"], ["D", "active"], ["N", "active"], ["PZ", "paused"], ["T2", "active"]]) {
    E[k] = (await one(`insert into public.employees(profile_id,status) values ($1,$2::public.employee_status)
      on conflict (profile_id) do update set status = excluded.status returning id`, [P[k], st])).id
  }
  const memb = async (k, code) => c.query(`insert into public.employee_sector_memberships(employee_id,sector_id,is_active) values ($1,$2,true)`, [E[k], S[code]])
  await memb("T", "technician"); await memb("X", "external_sales"); await memb("D", "technician"); await memb("D", "external_sales")
  await memb("N", "commercial"); await memb("PZ", "technician"); await memb("T2", "technician")
  const fin0 = await zeroWriteSnapshot(c)
  const money0 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet,
    (select count(*)::int from public.payments) payments, (select count(*)::int from public.employee_commission_entitlements) ent`)

  // ---------- formulário ----------
  const fT = await call("authenticated", P.T, "public.employee_opportunity_form_context()", [], false)
  await t("FORM_technician_single_role_no_choice", () => (fT.ok && fT.r.canCreate === true && JSON.stringify(fT.r.eligibleRoles) === '["technician_originator"]' && fT.r.roleChoiceRequired === false) || fT)
  await t("FORM_only_active_plans", () => (fT.r.plans.length === 1 && fT.r.plans[0].id === PLAN && Object.keys(fT.r.plans[0]).sort().join() === "id,name") || fT.r.plans)
  await t("FORM_closed_keys", () => Object.keys(fT.r).sort().join() === "canCreate,eligibleRoles,employeeStatus,plans,roleChoiceRequired" || Object.keys(fT.r))
  const fD = await call("authenticated", P.D, "public.employee_opportunity_form_context()", [], false)
  await t("FORM_dual_role_choice_required", () => (fD.ok && fD.r.roleChoiceRequired === true && fD.r.eligibleRoles.length === 2) || fD)
  const fN = await call("authenticated", P.N, "public.employee_opportunity_form_context()", [], false)
  await t("FORM_no_eligible_cannot_create", () => (fN.ok && fN.r.canCreate === false && fN.r.eligibleRoles.length === 0) || fN)
  const fPZ = await call("authenticated", P.PZ, "public.employee_opportunity_form_context()", [], false)
  await t("FORM_paused_cannot_create", () => (fPZ.ok && fPZ.r.canCreate === false) || fPZ)
  for (const k of ["AM", "CM", "IND"]) {
    const r = await call("authenticated", P[k], "public.employee_opportunity_form_context()", [], false)
    await t(`FORM_${k}_forbidden`, () => (!r.ok && /employee_portal_forbidden/.test(r.msg)) || r)
  }

  // ---------- técnico / vendedor externo ----------
  const tPayload = base({ document: "529.982.247-25", observation: "Cliente prefere contato à tarde" })
  const r1 = await submit(P.T, tPayload)
  await t("TECHNICIAN_creates_opportunity", () => (r1.ok && r1.r.ok === true && r1.r.idempotent === false && r1.r.attributionRole === "technician_originator" && r1.r.stage === "novo" && /^[0-9A-F]{8}$/.test(r1.r.protocol)) || r1)
  await t("CONTRACT_closed_response_keys", () => Object.keys(r1.r).sort().join() === "attributionRole,idempotent,ok,opportunityId,protocol,stage" || Object.keys(r1.r))
  const row1 = await one(`select * from public.referrals where id=$1`, [r1.r.opportunityId])
  await t("PIPELINE_same_table_stage_novo_employee_origin", () => (row1.pipeline_stage === "novo" && row1.status === "pendente" && row1.origin_kind === "employee" && row1.source === "employee_sales_opportunity") || row1)
  await t("FINANCIAL_reward_ineligible_no_indicator", () => (row1.reward_eligible === false && row1.indicator_profile_id === null && row1.reward_type === null && row1.reward_amount === null) || row1)
  await t("NORMALIZED_phone_doc_cep_name", () => (row1.referred_phone === "31998760001" && row1.referred_document === "52998224725" && row1.referred_zipcode === "30140071" && row1.referred_name === "Maria da Silva Teste" && row1.created_by_profile_id === P.T) || row1)
  const a1 = await one(`select a.*, s.code from public.sales_opportunity_attributions a join public.sectors s on s.id=a.sector_id where opportunity_id=$1`, [r1.r.opportunityId])
  await t("ATTRIBUTION_own_employee_role_sector", () => (a1.employee_id === E.T && a1.attribution_role === "technician_originator" && a1.code === "technician" && a1.attributed_by === P.T && a1.source === "employee_opportunity_rpc") || a1)
  await t("ATTRIBUTION_immutable", async () => { try { await c.query(`update public.sales_opportunity_attributions set attribution_role='external_sales_originator' where id=$1`, [a1.id]); return "updated!" } catch (e) { return /immutable/.test(e.message) || e.message } })
  const audit = await q(`select event_type, metadata from public.financial_security_audit_events where referral_id=$1 order by event_type`, [r1.r.opportunityId])
  await t("AUDIT_sanitized_no_pii", () => (audit.length === 2 && !/Maria|99876|52998|30140|Rua Lab|Centro|tarde/i.test(JSON.stringify(audit))) || audit)
  const r2 = await submit(P.X, base({ phone: "11 98888-0002", name: "Joao Externo Lab" }))
  await t("EXTERNAL_SALES_creates_opportunity", () => (r2.ok && r2.r.ok && r2.r.attributionRole === "external_sales_originator") || r2)

  // ---------- papéis ----------
  const rN = await submit(P.N, base({ phone: "11 97777-0003" }))
  await t("NO_ELIGIBLE_ROLE_403_code", () => (rN.ok && rN.r.code === "no_eligible_role") || rN)
  const rD0 = await submit(P.D, base({ phone: "11 97777-0004" }))
  await t("DUAL_ROLE_must_choose", () => (rD0.ok && rD0.r.code === "role_choice_required") || rD0)
  const rD1 = await submit(P.D, base({ phone: "11 97777-0004", attributionRole: "external_sales_originator" }))
  await t("DUAL_ROLE_chosen_ok", () => (rD1.ok && rD1.r.ok && rD1.r.attributionRole === "external_sales_originator") || rD1)
  for (const role of ["external_sales_originator", "internal_sales_responsible", "admin", "technician_originator ' or 1=1"]) {
    const r = await submit(P.T, base({ phone: "11 97777-0005", attributionRole: role }))
    await t(`INCOMPATIBLE_ROLE_${role.slice(0, 26).replace(/\W+/g, "_")}`, () => (r.ok && r.r.code === "role_not_eligible") || r)
  }
  const rPZ = await submit(P.PZ, base({ phone: "11 97777-0006" }))
  await t("PAUSED_employee_not_active", () => (rPZ.ok && rPZ.r.code === "employee_not_active") || rPZ)
  for (const k of ["AM", "CM", "IND", "AC"]) {
    const r = await submit(P[k], base({ phone: "11 97777-0007" }))
    await t(`NON_EMPLOYEE_${k}_forbidden`, () => (r.ok && r.r.code === "forbidden") || r)
  }
  const an = await call("anon", null, "public.submit_employee_sales_opportunity('{}'::jsonb)")
  await t("ANON_no_execute", () => (!an.ok && an.code === "42501") || an)
  const sr = await call("service_role", null, "public.submit_employee_sales_opportunity('{}'::jsonb)")
  await t("SERVICE_ROLE_no_execute", () => (!sr.ok && sr.code === "42501") || sr)
  const h1 = await call("authenticated", P.T, "public.create_employee_sales_opportunity('abcdefghijklmnop1234','technician_originator',null,null,'a','b')")
  await t("H1_LEGACY_RPC_no_client_execute", () => (!h1.ok && h1.code === "42501") || h1)

  // ---------- contrato / validação ----------
  const bad = [
    ["unknown_field_employeeId", { employeeId: E.X }, "unknown_field"],
    ["unknown_field_profileId", { profileId: P.X }, "unknown_field"],
    ["unknown_field_commission", { commissionAmount: 10 }, "unknown_field"],
    ["unknown_field_reward", { rewardEligible: true }, "unknown_field"],
    ["consent_missing", { consent: false }, "consent_required"],
    ["phone_invalid", { phone: "123" }, "invalid_payload"],
    ["cep_invalid", { zipcode: "123" }, "invalid_payload"],
    ["doc_invalid_len", { document: "123" }, "invalid_payload"],
    ["plan_inactive", { planId: null }, "invalid_payload"],
    ["name_short", { name: "A" }, "invalid_payload"],
    ["key_invalid", { idempotencyKey: "short" }, "invalid_idempotency_key"],
    ["type_number_for_text", { name: 123 }, "invalid_payload"],
  ]
  for (const [n, over, code] of bad) {
    const pl = base({ phone: "11 96666-0008", ...over })
    if (n === "plan_inactive") pl.planId = PLAN_OFF
    const r = await submit(P.T, pl)
    await t(`VALIDATION_${n}`, () => (r.ok && r.r.ok === false && r.r.code === code) || r)
  }

  // ---------- idempotência / concorrência ----------
  const replay = await submit(P.T, tPayload)
  await t("IDEMPOTENT_replay_returns_original", () => (replay.ok && replay.r.ok && replay.r.idempotent === true && replay.r.opportunityId === r1.r.opportunityId) || replay)
  const replayFmt = await submit(P.T, { ...tPayload, phone: "+55 31 99876 0001", document: "52998224725" })
  await t("IDEMPOTENT_replay_normalized_equivalent", () => (replayFmt.ok && replayFmt.r.idempotent === true && replayFmt.r.opportunityId === r1.r.opportunityId) || replayFmt)
  const conflict = await submit(P.T, { ...tPayload, name: "Outro Nome Lab" })
  await t("IDEMPOTENCY_conflict_same_key_different_payload", () => (conflict.ok && conflict.r.code === "idempotency_conflict") || conflict)
  const conflictOther = await submit(P.T2, tPayload)
  await t("IDEMPOTENCY_conflict_same_key_other_employee", () => (conflictOther.ok && conflictOther.r.code === "idempotency_conflict") || conflictOther)
  const cnt = async () => (await one(`select count(*)::int n from public.referrals where origin_kind='employee'`)).n
  const beforeConc = await cnt()
  // duplo clique: duas conexões, mesma chave, chamadas sobrepostas (a 2ª espera o lock da 1ª)
  const c1 = new Client(conn), c2 = new Client(conn)
  await c1.connect(); await c2.connect()
  const dbl = base({ phone: "11 95555-0009", name: "Clique Duplo Lab" })
  await c1.query("begin"); await c1.query("set local role authenticated"); await c1.query(`select set_config('request.jwt.claim.sub',$1,true)`, [P.T])
  const first = await c1.query("select public.submit_employee_sales_opportunity($1::jsonb) r", [JSON.stringify(dbl)])
  const secondP = submit(P.T, dbl, c2)
  await new Promise((r) => setTimeout(r, 400))
  const waiting = (await one(`select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and wait_event='advisory'`)).n
  await c1.query("commit")
  const second = await secondP
  await t("CONCURRENCY_double_click_second_waited_on_lock", () => waiting >= 1 || { waiting })
  await t("CONCURRENCY_double_click_single_row", async () => ((await cnt()) === beforeConc + 1 && first.rows[0].r.ok && second.ok && second.r.idempotent === true && second.r.opportunityId === first.rows[0].r.opportunityId) || { first: first.rows[0].r, second, n: await cnt() })
  // mesmo telefone, chaves diferentes, simultâneos => exatamente uma oportunidade (a outra: duplicate_open)
  const sameA = base({ phone: "11 94444-0010", name: "Simultaneo Lab A" }), sameB = base({ phone: "(11) 94444-0010", name: "Simultaneo Lab B" })
  const [ra, rb] = await Promise.all([submit(P.T, sameA, c1), submit(P.X, sameB, c2)])
  const codes = [ra.r?.ok ? "ok" : ra.r?.code, rb.r?.ok ? "ok" : rb.r?.code].sort().join()
  await t("CONCURRENCY_same_phone_different_keys_one_created", async () => (codes === "duplicate_open,ok" && (await one(`select count(*)::int n from public.referrals where public.employee_opportunity_normalize_phone(referred_phone)='11944440010'`)).n === 1) || { ra, rb })
  await c1.end(); await c2.end()

  // ---------- duplicidade ----------
  const dupOpen = await submit(P.X, base({ phone: "+55 31 99876-0001", name: "Outra Pessoa Lab" }))
  await t("DUPLICATE_open_phone_blocks", () => (dupOpen.ok && dupOpen.r.code === "duplicate_open") || dupOpen)
  const dupDoc = await submit(P.X, base({ phone: "11 93333-0011", document: "52998224725" }))
  await t("DUPLICATE_open_document_blocks", () => (dupDoc.ok && dupDoc.r.code === "duplicate_open") || dupDoc)
  await t("DUPLICATE_response_has_no_other_record_data", () => Object.keys(dupOpen.r).sort().join() === "code,ok" || dupOpen.r)
  // existente de outra origem (indicador/legacy) também conta: mesmo pipeline
  const indRef = (await one(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,origin_kind,reward_eligible) values ($1,'Indicado Lab','31 3222-1111',$2,'indicator',true) returning id`, [P.IND, PLAN])).id
  const dupInd = await submit(P.T, base({ phone: "3132221111" }))
  await t("DUPLICATE_open_from_indicator_origin_blocks", () => (dupInd.ok && dupInd.r.code === "duplicate_open") || dupInd)
  // encerrada há < 90 dias: aviso + confirmação explícita
  await c.query(`update public.referrals set pipeline_stage='perdido', lost_at=now()-interval '10 days', status='recusada' where id=$1`, [indRef])
  const warn = await submit(P.T, base({ phone: "3132221111", name: "Retorno Lab" }))
  await t("RECENT_CLOSED_warns_requires_confirmation", () => (warn.ok && warn.r.code === "duplicate_recent_closed" && warn.r.requiresConfirmation === true) || warn)
  const warnKey = key()
  const confirmed = await submit(P.T, base({ idempotencyKey: warnKey, phone: "3132221111", name: "Retorno Lab", confirmRecentDuplicate: true }))
  await t("RECENT_CLOSED_confirmed_creates", () => (confirmed.ok && confirmed.r.ok && confirmed.r.idempotent === false) || confirmed)
  const confAudit = await one(`select metadata from public.financial_security_audit_events where referral_id=$1 and event_type='employee_opportunity_created'`, [confirmed.r.opportunityId])
  await t("RECENT_CLOSED_confirmation_audited", () => confAudit.metadata.duplicate_warning_confirmed === true || confAudit)
  const oldRef = (await one(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,origin_kind,reward_eligible,pipeline_stage,lost_at,moved_to_stage_at) values ($1,'Antigo Lab','11 92222-0012',$2,'indicator',true,'perdido',now()-interval '120 days',now()-interval '120 days') returning id`, [P.IND, PLAN])).id
  const old = await submit(P.T, base({ phone: "11 92222-0012", name: "Antigo Retorno Lab" }))
  await t("CLOSED_over_90_days_no_warning", () => (old.ok && old.r.ok) || { old, oldRef })

  // ---------- minhas vendas / isolamento ----------
  const lT = await call("authenticated", P.T, "public.list_employee_sales_filtered()", [], false)
  await t("MY_SALES_lists_own_only", async () => { const own = (await q(`select opportunity_id from public.sales_opportunity_attributions where employee_id=$1`, [E.T])).map((r) => r.opportunity_id).sort(); return (lT.ok && JSON.stringify(lT.r.items.map((x) => x.id).sort()) === JSON.stringify(own)) || lT })
  await t("MY_SALES_masked_name_no_phone", () => (lT.r.items.every((x) => !/Silva Teste|99876|52998/.test(JSON.stringify(x))) && lT.r.items.some((x) => x.interested === "Maria T.")) || lT.r.items)
  const lT2 = await call("authenticated", P.T2, "public.list_employee_sales_filtered()", [], false)
  await t("CROSS_EMPLOYEE_list_invisible", () => (lT2.ok && lT2.r.total === 0) || lT2)
  const dOther = await call("authenticated", P.T2, `public.get_employee_sale_detail('${r1.r.opportunityId}'::uuid)`, [], false)
  const dNone = await call("authenticated", P.T2, `public.get_employee_sale_detail('00000000-0000-4000-8000-000000000999'::uuid)`, [], false)
  await t("CROSS_EMPLOYEE_detail_same_404_as_nonexistent", () => (!dOther.ok && !dNone.ok && dOther.msg === dNone.msg && dOther.code === dNone.code && /not_found/.test(dOther.msg)) || { dOther, dNone })
  const dOwn = await call("authenticated", P.T, `public.get_employee_sale_detail('${r1.r.opportunityId}'::uuid)`, [], false)
  await t("MY_SALES_detail_own_ok_stage_novo", () => (dOwn.ok && dOwn.r.stage === "novo" && dOwn.r.role === "technician_originator" && dOwn.r.commissions.length === 0) || dOwn)
  const fRole = await call("authenticated", P.D, "public.list_employee_sales_filtered(p_role => 'technician_originator')", [], false)
  const fRole2 = await call("authenticated", P.D, "public.list_employee_sales_filtered(p_role => 'external_sales_originator')", [], false)
  await t("MY_SALES_filter_role", () => (fRole.r.total === 0 && fRole2.r.total === 1) || { fRole, fRole2 })
  const ref = r1.r.protocol.toLowerCase().slice(0, 6)
  const fRef = await call("authenticated", P.T, `public.list_employee_sales_filtered(p_search => '${ref}')`, [], false)
  await t("MY_SALES_search_reference", () => (fRef.r.total >= 1 && fRef.r.items.some((x) => x.id === r1.r.opportunityId)) || fRef)
  const fMasked = await call("authenticated", P.T, "public.list_employee_sales_filtered(p_search => 'maria')", [], false)
  const fHidden = await call("authenticated", P.T, "public.list_employee_sales_filtered(p_search => 'silva teste')", [], false)
  const fPhone = await call("authenticated", P.T, "public.list_employee_sales_filtered(p_search => '99876')", [], false)
  await t("MY_SALES_search_only_visible_data", () => (fMasked.r.total === 1 && fHidden.r.total === 0 && fPhone.r.total === 0) || { fMasked: fMasked.r?.total, fHidden: fHidden.r?.total, fPhone: fPhone.r?.total })
  const fStage = await call("authenticated", P.T, "public.list_employee_sales_filtered(p_stage => 'perdido')", [], false)
  await t("MY_SALES_filter_stage", () => fStage.r.total === 0 || fStage)
  const fBad = await call("authenticated", P.T, "public.list_employee_sales_filtered(p_role => 'admin')", [], false)
  await t("MY_SALES_invalid_role_param_rejected", () => (!fBad.ok && fBad.code === "22023") || fBad)
  const dash = await call("authenticated", P.T, "public.employee_sales_dashboard_summary()", [], false)
  await t("DASHBOARD_real_counts", () => (dash.ok && dash.r.opportunitiesInMonth >= 4 && dash.r.salesInProgress >= 4 && Number(dash.r.commissionAccruedInCompetence) === 0 && dash.r.commissionsAwaitingEvidence === 0) || dash)
  for (const k of ["AM", "CM", "IND"]) {
    const r = await call("authenticated", P[k], "public.list_employee_sales_filtered()", [], false)
    await t(`MY_SALES_${k}_forbidden`, () => (!r.ok && /employee_portal_forbidden/.test(r.msg)) || r)
  }

  // ---------- admin: origem e originador ----------
  const ids = `array['${r1.r.opportunityId}','${r2.r.opportunityId}','${indRef}']::uuid[]`
  const oAM = await q(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${P.AM}',true);`).then(() => q(`select * from public.list_employee_opportunity_origins(${ids}) order by attribution_role`)).finally(() => c.query("rollback"))
  await t("ADMIN_sees_origin_and_originator", () => (oAM.length === 2 && oAM[0].attribution_role === "external_sales_originator" && oAM[0].originator_name === "Vendedor Lab Externo" && oAM[1].attribution_role === "technician_originator" && oAM[1].originator_name === "Tecnico Lab Um") || oAM)
  await c.query(`update public.referrals set commercial_profile_id=$1 where id=$2`, [P.CM, r1.r.opportunityId])
  const oCM = await q(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${P.CM}',true);`).then(() => q(`select * from public.list_employee_opportunity_origins(${ids})`)).finally(() => c.query("rollback"))
  await t("COMMERCIAL_sees_origin_only_for_own_leads", () => (oCM.length === 1 && oCM[0].opportunity_id === r1.r.opportunityId) || oCM)
  for (const k of ["IND", "T"]) {
    const r = await call("authenticated", P[k], `(select count(*) from public.list_employee_opportunity_origins(${ids}))`, [], false)
    await t(`ORIGINS_${k}_forbidden`, () => (!r.ok && r.code === "42501") || r)
  }
  const oAnon = await call("anon", null, `(select count(*) from public.list_employee_opportunity_origins(${ids}))`, [], false)
  await t("ORIGINS_anon_no_execute", () => (!oAnon.ok && oAnon.code === "42501") || oAnon)

  // ---------- segurança financeira: employee opportunity never creates indicator reward ----------
  const opp = r1.r.opportunityId
  const ens = await call("authenticated", P.AM, `public.ensure_referral_reward('${opp}'::uuid)`)
  await t("NEVER_REWARD_ensure_referral_reward_blocked", () => (ens.ok && ens.r.ok === false && ens.r.code === "not_reward_eligible") || (!ens.ok && /not_reward_eligible/.test(ens.msg)) || ens)
  await c.query(`update public.referrals set commercial_profile_id=$1 where id=$2`, [P.CM, opp])
  const ensCm = await call("authenticated", P.CM, `public.ensure_referral_reward('${opp}'::uuid)`)
  await t("NEVER_REWARD_commercial_ensure_blocked", () => (ensCm.ok && ensCm.r.ok === false) || (!ensCm.ok && /not_reward_eligible|forbidden|permission|42501/.test(ensCm.msg + ensCm.code)) || ensCm)
  const mark = await call("authenticated", P.AM, `public.mark_first_invoice_paid('${opp}'::uuid)`)
  await t("NEVER_REWARD_mark_first_invoice_paid_blocked", () => (mark.ok && mark.r.ok === false && /not_reward_eligible|employee/.test(mark.r.code)) || (!mark.ok && /not_reward_eligible|eleg/.test(mark.msg)) || mark)
  await t("NEVER_REWARD_direct_insert_blocked_by_trigger", async () => { try { await c.query(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type,status) values ($1,$2,1,'pix','pendente')`, [opp, P.IND]); await c.query(`delete from public.rewards where referral_id=$1`, [opp]); return "inserted!" } catch (e) { return /origem funcionário|not_reward_eligible/.test(e.message) || e.message } })
  await t("NEVER_REWARD_cannot_flip_eligibility", async () => { try { await c.query(`update public.referrals set reward_eligible=true, indicator_profile_id=$1 where id=$2`, [P.IND, opp]); const r = await one(`select reward_eligible, indicator_profile_id from public.referrals where id=$1`, [opp]); return (r.reward_eligible === false && r.indicator_profile_id === null) || r } catch (e) { return /employee|reward/.test(e.message) || e.message } })
  // ciclo de vida completo (pipeline até ativado + aprovada + 1ª fatura) sem reward
  await c.query(`update public.referrals set pipeline_stage='ativado', status='aprovada', won_at=now() where id=$1`, [opp])
  const mark2 = await call("authenticated", P.AM, `public.mark_first_invoice_paid('${opp}'::uuid)`)
  await t("NEVER_REWARD_after_won_and_approved", () => (mark2.ok && mark2.r.ok === false && /not_reward_eligible|employee/.test(mark2.r.code)) || (!mark2.ok && /not_reward_eligible|eleg/.test(mark2.msg)) || mark2)
  const money1 = await one(`select (select count(*)::int from public.rewards) rewards, (select count(*)::int from public.wallet_transactions) wallet,
    (select count(*)::int from public.payments) payments, (select count(*)::int from public.employee_commission_entitlements) ent`)
  await t("employee opportunity never creates indicator reward", async () => (money1.rewards === money0.rewards && (await one(`select count(*)::int n from public.rewards r join public.referrals x on x.id=r.referral_id where x.origin_kind='employee'`)).n === 0) || { money0, money1 })
  await t("ZERO_wallet_withdrawal_entitlement", () => (money1.wallet === money0.wallet && money1.payments === money0.payments && money1.ent === 0) || { money0, money1 })
  const fin1 = await zeroWriteSnapshot(c)
  await t("ZERO_commission_rules_entitlements_payroll_finance_audit", () => ["commission_rules", "entitlements", "compensation_profiles", "worked_days", "competences", "payroll_lines", "finance_audit_events"].every((k) => fin1[k] === 0 && fin0[k] === 0) || fin1)
  await t("UNCHANGED_rewards_wallet_collections_employees", () => (fin1.rewards_hash === fin0.rewards_hash && fin1.wallet_hash === fin0.wallet_hash && fin1.collections_hash === fin0.collections_hash && fin1.employees_hash === fin0.employees_hash) || { fin0, fin1 })
  // indicador continua criando indicação normalmente (índice de expressão não exige grant extra)
  const indRow = await c.query("begin").then(async () => { await c.query("set local role authenticated"); await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [P.IND]); try { const r = await c.query(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,origin_kind) values ($1,'Indicado Novo Lab','31 3000-4444',$2,'indicator') returning id`, [P.IND, PLAN]); await c.query("rollback"); return { ok: true, id: r.rows[0].id } } catch (e) { await c.query("rollback"); return { ok: false, msg: e.message, code: e.code } } })
  await t("INDICATOR_flow_insert_still_works", () => indRow.ok || indRow)
  res.push(["INFO_indicator_insert_result", indRow.ok ? "inserted (rolled back)" : `rls ${indRow.code}`])
} catch (e) {
  res.push(["FATAL", e.stack || e.message]); ok = false
} finally {
  await lab.stop().catch(() => {})
}
for (const r of res) console.log(r.join(" | "))
const pass = res.filter((r) => r[1] === "PASS").length, fail = res.filter((r) => r[1].startsWith("FAIL") || r[0] === "FATAL").length
console.log(`J3_LAB=${pass}/${pass + fail}`)
if (process.env.J3_LAB_OUT) writeFileSync(process.env.J3_LAB_OUT, JSON.stringify(res, null, 2))
process.exit(ok && fail === 0 ? 0 : 1)

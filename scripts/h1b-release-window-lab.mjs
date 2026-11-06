// 3.1F-H1b release-window lab (127.0.0.1 only; no remote, no probe, no ERP).
// Permanent version of the H2 supplement + expand -> deploy -> finalize matrix.
//   State 1: old code + old DB      State 2: old code + expand
//   State 3: new code + expand      State 4: new code + finalize
// "old code" = INSERT omitting origin_kind; "new code" = explicit origin_kind.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { startCollectionsLab, stopCollectionsLab, REPO_ROOT } from "./local-pg-collections-lab/run.mjs"

const PRE = [
  "patch-referral-interested-fields", "patch-public-pre-registration", "patch-pre-registration-pj-neutral-network",
  "patch-commercial-assisted-referral-foundation", "patch-assisted-indicator-account-foundation",
  "patch-notifications-referral-events", "patch-notifications-indicator-events", "patch-brbyte-sync-infrastructure",
  "patch-first-invoice-reward-from-controllr-amount", "patch-financial-reward-eligibility-hardening",
].map(f => `supabase/${f}.sql`)
const EXPAND = readFileSync(join(REPO_ROOT, "supabase/patch-employee-origin-and-rewards-hardening-3-1f-h1.sql"), "utf8")
const FINALIZE = readFileSync(join(REPO_ROOT, "supabase/patch-employee-origin-hardening-finalize-3-1f-h1b.sql"), "utf8")
const FINALIZE_BODY = FINALIZE.replace(/^\s*begin;\s*$/m, "").replace(/^\s*commit;\s*$/m, "")
const SEED_N = 249

const out = []; let ok = true
const t = async (name, fn) => { try { const v = await fn(); const pass = v === true; out.push([name, pass ? "PASS" : "FAIL " + JSON.stringify(v)]); if (!pass) ok = false } catch (e) { out.push([name, "FAIL " + e.message]); ok = false } }
const { client: c, conn, Client } = await startCollectionsLab()
const q = async (sql, p = []) => (await c.query(sql, p)).rows
const asUser = async (uid, sql, p = []) => { await c.query("begin"); try { await c.query("set local role authenticated"); await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]); const r = await c.query(sql, p); await c.query("commit"); return r.rows } catch (e) { await c.query("rollback"); throw e } }
const tryUser = async (uid, sql, p = []) => { try { return { ok: true, rows: await asUser(uid, sql, p) } } catch (e) { return { ok: false, err: e.message } } }
const tryOwner = async (sql, p = []) => { try { return { ok: true, rows: await q(sql, p) } } catch (e) { return { ok: false, err: e.message } } }
const ensure = async (rid, uid) => (await asUser(uid, `select public.ensure_referral_reward($1) r`, [rid]))[0].r
const fe = async (rid) => (await q(`select public.referral_is_financially_eligible(r) v from public.referrals r where id=$1`, [rid]))[0].v

try {
  for (const f of PRE) await c.query(readFileSync(join(REPO_ROOT, f), "utf8"))
  await c.query("grant all on all tables in schema public to anon, authenticated; grant all on all functions in schema public to anon, authenticated, public")
  const P = { ind: "44444444-0000-0000-0000-000000000001", com: "44444444-0000-0000-0000-000000000002", adm: "44444444-0000-0000-0000-000000000003", fin: "44444444-0000-0000-0000-000000000004", emp: "44444444-0000-0000-0000-000000000005", ind2: "44444444-0000-0000-0000-000000000006" }
  await q(`insert into public.profiles(id,email,role) values ($1,'i@x','indicador'),($2,'c@x','comercial'),($3,'a@x','admin_master'),($4,'f@x','admin_financeiro'),($5,'e@x','funcionario'),($6,'i2@x','indicador')`, Object.values(P))
  const plan = (await q(`select id from public.plans limit 1`))[0]?.id ?? (await q(`insert into public.plans(name, speed_label, price, reward_amount) values ('p','1M',1,30) returning id`))[0].id
  const sector = (await q(`select id from public.sectors limit 1`))[0].id
  const empId = (await q(`insert into public.employees(profile_id,status) values ($1,'active') returning id`, [P.emp]))[0].id
  await q(`insert into public.employee_sector_memberships(employee_id,sector_id) values ($1,$2)`, [empId, sector])

  // ---------- State 1: old code + old DB (seed 249-equivalent historical referrals) ----------
  await q(`
    insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source,erp_lead_source,reward_type,reward_amount,created_at,updated_at)
    select case when g % 9 in (0,1) then null
                when g % 9 = 2 then $2::uuid when g % 9 = 3 then $3::uuid when g % 9 = 4 then $5::uuid else $1::uuid end,
           'n', '1', $4,
           case when g % 9 in (0,1) then false when g % 9 = 6 then false else true end,
           case when g % 9 = 0 then 'public_pre_registration' when g % 9 = 1 then 'neutral_network_pre_registration' when g % 9 = 7 then 'commercial_assisted_referral' else null end,
           case when g % 9 = 0 then 'Pré-cadastro Web' when g % 9 = 1 then 'Pré-cadastro Rede Neutra' else 'Indique e Ganhe' end,
           'pix', 30,
           now() - (g || ' days')::interval, now() - (g || ' hours')::interval - interval '3 minutes'
    from generate_series(1, ${SEED_N}) g`, [P.ind, P.com, P.adm, plan, P.fin])
  const seedIds = (await q(`select id from public.referrals order by id`)).map(r => r.id)
  // historical rewards: 2 pendente + 6 disponivel on comercial-indicator rows, 1 on admin_master, 2 on indicador
  const comRows = (await q(`select id from public.referrals where indicator_profile_id=$1 and reward_eligible order by id limit 8`, [P.com])).map(r => r.id)
  for (const [i, rid] of comRows.entries()) await q(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type,status) values ($1,$2,30,'pix',$3)`, [rid, P.com, i < 2 ? "pendente" : "disponivel"])
  const admRow = (await q(`select id from public.referrals where indicator_profile_id=$1 and reward_eligible order by id limit 1`, [P.adm]))[0].id
  await q(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type,status) values ($1,$2,30,'pix','disponivel')`, [admRow, P.adm])
  for (const r of await q(`select id from public.referrals where indicator_profile_id=$1 and reward_eligible order by id limit 2`, [P.ind])) await q(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type,status) values ($1,$2,30,'pix','pendente')`, [r.id, P.ind])
  const s1Old = await tryUser(P.com, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_type,reward_amount) values ($1,'n','1',$2,'pix',30) returning id, reward_eligible`, [P.com, plan])
  await t("S1_old_code_old_db_comercial_indicator_insert_eligible", () => (s1Old.ok && s1Old.rows[0].reward_eligible === true) || s1Old)
  const s1Adm = await tryUser(P.adm, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_type,reward_amount) values ($1,'n','1',$2,'pix',30) returning id, reward_eligible`, [P.adm, plan])
  await t("S1_old_code_old_db_admin_master_indicator_insert_eligible", () => (s1Adm.ok && s1Adm.rows[0].reward_eligible === true) || s1Adm)
  const preIds = (await q(`select id from public.referrals order by id`)).map(r => r.id)
  const histCom = s1Old.rows[0].id, histAdm = s1Adm.rows[0].id
  await t("S1_seeded_249_equivalent", () => seedIds.length === SEED_N || seedIds.length)

  // snapshots
  const refSnap = async () => Object.fromEntries((await q(`select id, to_jsonb(r) j from public.referrals r where id = any($1::uuid[])`, [preIds])).map(r => [r.id, r.j]))
  const rewSnap = async (ids) => JSON.stringify((await q(`select to_jsonb(r) j from public.rewards r where id = any($1::uuid[]) order by id`, [ids])).map(r => r.j))
  const tableCounts = async () => { const o = {}; for (const r of await q(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`)) o[r.table_name] = (await q(`select count(*)::int n from public."${r.table_name}"`))[0].n; return o }
  const preRewardIds = (await q(`select id from public.rewards order by id`)).map(r => r.id)
  const R0 = await refSnap(); const W0 = await rewSnap(preRewardIds); const C0 = await tableCounts()
  const eligBefore = Object.fromEntries(await Promise.all(preIds.map(async id => [id, await fe(id).catch(() => null)])))

  // ---------- Expand: atomic rollback ----------
  let expandFailed = false
  try { await c.query(EXPAND.replace(/commit;\s*$/i, "select 1/0;\n")) } catch { expandFailed = true }
  await c.query("rollback").catch(() => {})
  await t("EXPAND_rollback_atomic", async () => expandFailed && (await q(`select count(*)::int n from information_schema.columns where table_name='referrals' and column_name='origin_kind'`))[0].n === 0 && (await q(`select to_regclass('public.sales_opportunity_attributions') x`))[0].x === null && JSON.stringify(await refSnap()) === JSON.stringify(R0))

  // ---------- Expand x2 ----------
  await c.query(EXPAND); await c.query(EXPAND)
  await t("EXPAND_reapplicable", () => true)
  const R1 = await refSnap()
  await t("EXPAND_updated_at_preserved_all_preexisting", () => preIds.every(id => R1[id].updated_at === R0[id].updated_at) || preIds.filter(id => R1[id].updated_at !== R0[id].updated_at).length)
  await t("EXPAND_all_other_columns_identical", () => preIds.every(id => { const a = { ...R1[id] }; delete a.origin_kind; delete a.employee_opportunity_idempotency_key; return JSON.stringify(a) === JSON.stringify(R0[id]) && R1[id].employee_opportunity_idempotency_key === null }))
  await t("EXPAND_existing_rows_read_legacy", () => preIds.every(id => R1[id].origin_kind === "legacy"))
  await t("EXPAND_metadata_default_present", async () => (await q(`select pg_get_expr(d.adbin,d.adrelid) e, a.attnotnull nn from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.referrals'::regclass and a.attname='origin_kind'`)).some(r => /'legacy'/.test(r.e) && r.nn === true))
  await t("EXPAND_updated_at_trigger_still_enabled", async () => (await q(`select tgname, tgenabled from pg_trigger where tgrelid='public.referrals'::regclass and not tgisinternal`)).every(r => r.tgenabled === "O") && (await q(`select count(*)::int n from pg_trigger where tgrelid='public.referrals'::regclass and tgname='trg_referrals_set_updated_at'`))[0].n === 1)
  const C1 = await tableCounts()
  await t("EXPAND_no_event_or_audit_generated", () => Object.keys(C0).every(k => C1[k] === C0[k]) && C1.financial_security_audit_events === 0 && C1.sales_opportunity_attributions === 0 || { C0, C1 })
  await t("EXPAND_existing_rewards_byte_identical", async () => (await rewSnap(preRewardIds)) === W0)
  await t("EXPAND_legacy_eligibility_identical", async () => { for (const id of preIds) if ((await fe(id)) !== eligBefore[id]) return id; return true })
  await t("HIST_comercial_indicator_preserved", async () => (await fe(histCom)) === true && comRows.every(id => R1[id].reward_eligible === true))
  await t("HIST_admin_master_indicator_preserved", async () => (await fe(histAdm)) === true && (await fe(admRow)) === true)
  await t("HIST_existing_reward_idempotent_via_rpc", async () => { const r = await ensure(comRows[0], P.adm); return (r.ok && r.created === false) || r })

  // ---------- State 2: old code + expand ----------
  const old = async (uid, extraCols = "", extraVals = "") => tryUser(uid, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_type,reward_amount${extraCols}) values ($1,'n','1',$2,'pix',30${extraVals}) returning id, origin_kind, reward_eligible`, [uid, plan])
  const o2i = await old(P.ind), o2c = await old(P.com), o2a = await old(P.adm)
  await t("S2_old_code_indicador_insert_ok_legacy", () => (o2i.ok && o2i.rows[0].origin_kind === "legacy" && o2i.rows[0].reward_eligible === true) || o2i)
  await t("S2_old_code_comercial_indicator_legacy_eligible", () => (o2c.ok && o2c.rows[0].origin_kind === "legacy" && o2c.rows[0].reward_eligible === true) || o2c)
  await t("S2_old_code_admin_master_indicator_legacy_eligible", () => (o2a.ok && o2a.rows[0].origin_kind === "legacy" && o2a.rows[0].reward_eligible === true) || o2a)
  await t("S2_old_code_comercial_reward_via_rpc", async () => { const r = await ensure(o2c.rows[0].id, P.adm); return (r.ok && r.created === true) || r })
  const o2web = await tryOwner(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source,erp_lead_source) values (null,'n','1',$1,false,'public_pre_registration','Pré-cadastro Web') returning id, origin_kind`, [plan])
  await t("S2_old_code_web_prereg_ok_and_ineligible", async () => (o2web.ok && o2web.rows[0].origin_kind === "legacy" && (await fe(o2web.rows[0].id)) === false && (await ensure(o2web.rows[0].id, P.adm)).code === "not_reward_eligible") || o2web)
  const o2emp = await old(P.emp)
  await t("S2_old_code_funcionario_as_indicator_blocked", () => (!o2emp.ok && /employee_must/.test(o2emp.err)) || o2emp)
  await t("S2_employee_rpc_exists", async () => (await q(`select to_regprocedure('public.create_employee_sales_opportunity(text,text,uuid,uuid,text,text,text,text)') p`))[0].p !== null)
  const d2 = await tryUser(P.adm, `insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ($1,$2,1,'pix')`, [o2i.rows[0].id, P.ind])
  await t("S2_direct_reward_insert_blocked", () => (!d2.ok && /permission denied|row-level/.test(d2.err)) || d2)
  await t("S2_anon_financial_rpcs_blocked", async () => (await q(`select bool_and(not has_function_privilege('anon',p.oid,'execute')) v from pg_proc p where p.pronamespace='public'::regnamespace and proname in ('ensure_referral_reward','mark_first_invoice_paid','mark_first_invoice_paid_from_sync','create_employee_sales_opportunity')`))[0].v === true)

  // ---------- State 3: new code + expand ----------
  const nw = async (uid, origin, extraCols = "", extraVals = "") => tryUser(uid, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_type,reward_amount,reward_eligible,origin_kind${extraCols}) values ($1,'n','1',$2,'pix',30,true,'${origin}'${extraVals}) returning id, origin_kind, reward_eligible`, [uid, plan])
  const ctxSuite = async (st) => {
    const ci = await nw(P.com, "indicator"), ai = await nw(P.adm, "indicator"), ii = await nw(P.ind, "indicator")
    await t(`${st}_E1_comercial_indicator_allowed`, async () => (ci.ok && ci.rows[0].reward_eligible === true && (await ensure(ci.rows[0].id, P.adm)).created === true) || ci)
    await t(`${st}_E3_admin_master_indicator_allowed`, async () => (ai.ok && ai.rows[0].reward_eligible === true && (await ensure(ai.rows[0].id, P.adm)).created === true) || ai)
    await t(`${st}_indicador_indicator_allowed`, async () => (ii.ok && ii.rows[0].reward_eligible === true && (await ensure(ii.rows[0].id, P.adm)).created === true) || ii)
    const ca = await tryOwner(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source,erp_lead_source,commercial_profile_id,origin_kind) values ($1,'n','1',$2,true,'commercial_assisted_referral','Indique e Ganhe',$3,'assisted_indicator') returning id, reward_eligible`, [P.adm, plan, P.com])
    await t(`${st}_assisted_admin_master_as_indicator_eligible`, async () => (ca.ok && ca.rows[0].reward_eligible === true && (await fe(ca.rows[0].id)) === true) || ca)
    const ce = await nw(P.com, "employee"), ae = await nw(P.adm, "employee"), ie = await nw(P.ind, "employee")
    await t(`${st}_E2_comercial_employee_origin_blocked`, () => (!ce.ok && /employee_opportunity_requires_rpc/.test(ce.err)) || ce)
    await t(`${st}_E4_admin_master_employee_origin_blocked`, () => (!ae.ok && /employee_opportunity_requires_rpc/.test(ae.err)) || ae)
    await t(`${st}_E7_indicador_employee_origin_blocked`, () => (!ie.ok && /employee_opportunity_requires_rpc/.test(ie.err)) || ie)
    // even with the RPC GUC forged, employee origin cannot carry an indicator/eligibility
    const forged = await tryOwner(`select set_config('igt.employee_opportunity_rpc','on',false); insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind) values ('${P.com}','n','1','${plan}',true,'employee')`)
    await c.query(`select set_config('igt.employee_opportunity_rpc','',false)`)
    await t(`${st}_employee_origin_with_comercial_indicator_rejected`, () => (!forged.ok && /employee_origin_cannot_be_reward_eligible|employee_origin_no_reward/.test(forged.err)) || forged)
    const fi = await nw(P.fin, "indicator")
    await t(`${st}_E5_admin_financeiro_not_auto_eligible`, async () => (fi.ok && fi.rows[0].reward_eligible === false && (await ensure(fi.rows[0].id, P.adm)).code === "not_reward_eligible") || fi)
    const ei = await nw(P.emp, "indicator")
    await t(`${st}_E6_funcionario_indicator_blocked`, () => (!ei.ok && /employee_must/.test(ei.err)) || ei)
    const w = await tryOwner(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind) values ($1,'n','1',$2,true,'web_preregistration') returning id, reward_eligible`, [P.com, plan])
    const n = await tryOwner(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind) values ($1,'n','1',$2,true,'neutral_network') returning id, reward_eligible`, [P.adm, plan])
    await t(`${st}_web_neutral_ineligible_regardless_of_role`, async () => (w.ok && n.ok && !w.rows[0].reward_eligible && !n.rows[0].reward_eligible && (await ensure(w.rows[0].id, P.adm)).code === "not_reward_eligible" && (await ensure(n.rows[0].id, P.adm)).code === "not_reward_eligible") || { w, n })
    const key = `emp-${st}-000000000000001`
    const o = (await asUser(P.emp, `select public.create_employee_sales_opportunity($1,'technician_originator',$2,$3,'n','1') r`, [key, sector, plan]))[0].r
    const row = o.ok ? (await q(`select origin_kind, indicator_profile_id, reward_eligible from public.referrals where id=$1`, [o.opportunity_id]))[0] : null
    await t(`${st}_employee_rpc_forced_origin_never_reward`, async () => (o.ok && row.origin_kind === "employee" && row.indicator_profile_id === null && row.reward_eligible === false && (await ensure(o.opportunity_id, P.adm)).code === "not_reward_eligible") || { o, row })
    const sr = await tryOwner(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ($1,$2,1,'pix')`, [o.opportunity_id, P.com])
    await t(`${st}_employee_reward_service_role_blocked`, () => (!sr.ok && /not_reward_eligible/.test(sr.err)) || sr)
    const ine = await nw(P.ind, "indicator"); await q(`update public.referrals set reward_eligible=false where id=$1`, [ine.rows[0].id])
    const sr2 = await tryOwner(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ($1,$2,1,'pix')`, [ine.rows[0].id, P.ind])
    await t(`${st}_reward_eligible_false_reward_blocked`, () => (!sr2.ok && /not_reward_eligible/.test(sr2.err)) || sr2)
    const nul = await tryOwner(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind) values (null,'n','1',$1,true,'indicator') returning id, reward_eligible`, [plan])
    await t(`${st}_indicator_null_forced_ineligible`, async () => (nul.ok && nul.rows[0].reward_eligible === false && (await ensure(nul.rows[0].id, P.adm)).code === "not_reward_eligible") || nul)
    const upd = await tryOwner(`update public.referrals set indicator_profile_id=$2 where id=$1 returning reward_eligible`, [ci.rows[0].id, P.fin])
    await t(`${st}_update_indicator_to_admin_financeiro_loses_eligibility`, () => (upd.ok && upd.rows[0].reward_eligible === false) || upd)
    await q(`update public.referrals set indicator_profile_id=$2 where id=$1`, [ci.rows[0].id, P.com]).catch(() => {})
  }
  await ctxSuite("S3")
  const legacyExplicitS3 = await nw(P.ind, "legacy")
  await t("S3_explicit_legacy_still_tolerated_during_window", () => legacyExplicitS3.ok || legacyExplicitS3)

  // ---------- Finalize: fail-closed (each inside a rolled-back tx) ----------
  const finAbort = async (setup, re) => { await c.query("begin"); try { await c.query(setup); await c.query(FINALIZE_BODY); await c.query("rollback"); return "did not abort" } catch (e) { await c.query("rollback").catch(() => {}); return re.test(e.message) || e.message } }
  await t("FIN_abort_column_missing", () => finAbort(`alter table public.referrals drop column origin_kind cascade`, /origin_kind column missing/))
  await t("FIN_abort_check_missing", () => finAbort(`alter table public.referrals drop constraint referrals_origin_kind_chk`, /referrals_origin_kind_chk missing/))
  await t("FIN_abort_employee_check_missing", () => finAbort(`alter table public.referrals drop constraint referrals_employee_origin_no_reward_chk`, /referrals_employee_origin_no_reward_chk missing/))
  await t("FIN_abort_origin_trigger_disabled", () => finAbort(`alter table public.referrals disable trigger trg_referrals_enforce_origin_kind`, /missing or disabled/))
  await t("FIN_abort_unexpected_default", () => finAbort(`alter table public.referrals alter column origin_kind set default 'indicator'`, /unexpected origin_kind default/))
  await t("FIN_abort_not_null_missing", () => finAbort(`alter table public.referrals alter column origin_kind drop not null`, /not NOT NULL/))
  const emp1 = (await q(`select id from public.referrals where origin_kind='employee' limit 1`))[0].id
  await t("FIN_abort_reward_on_employee_row", () => finAbort(`alter table public.rewards disable trigger trg_rewards_enforce_financial_eligibility; insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ('${emp1}','${P.ind}',1,'pix')`, /rewards point at employee/))
  await t("FIN_abort_invalid_window_guc", () => finAbort(`select set_config('igt.h1b_expand_started_at','not-a-date',true)`, /not a valid timestamptz/))
  await t("FIN_aborts_left_default_in_place", async () => (await q(`select count(*)::int n from pg_attrdef d join pg_attribute a on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.referrals'::regclass and a.attname='origin_kind'`))[0].n === 1)

  // ---------- Finalize x2 ----------
  const allIdsBeforeFin = (await q(`select id from public.referrals`)).map(r => r.id)
  const RB = JSON.stringify((await q(`select to_jsonb(r) j from public.referrals r order by id`)).map(r => r.j))
  const allRewardIds = (await q(`select id from public.rewards`)).map(r => r.id)
  const WB = await rewSnap(allRewardIds); const CB = await tableCounts()
  const notices = []; c.on("notice", n => notices.push(n.message))
  await q(`select set_config('igt.h1b_expand_started_at', (now() - interval '1 hour')::text, false)`)
  await c.query(FINALIZE); await c.query(FINALIZE)
  await t("FIN_reapplicable", () => true)
  await t("FIN_reports_counts_only", () => notices.some(m => /legacy_created_in_release_window=\d+/.test(m)) && notices.some(m => /default_already_removed=true/.test(m)) && notices.every(m => !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(m)) || notices)
  await t("FIN_window_legacy_not_converted", async () => (await q(`select count(*)::int n from public.referrals where id = any($1::uuid[]) and origin_kind='legacy'`, [[o2i.rows[0].id, o2c.rows[0].id, o2a.rows[0].id, o2web.rows[0].id]]))[0].n === 4)
  await t("FIN_updated_at_and_rows_identical", async () => JSON.stringify((await q(`select to_jsonb(r) j from public.referrals r where id = any($1::uuid[]) order by id`, [allIdsBeforeFin])).map(r => r.j)) === RB)
  await t("FIN_rewards_byte_identical", async () => (await rewSnap(allRewardIds)) === WB)
  await t("FIN_no_new_rows_anywhere", async () => { const CA = await tableCounts(); return Object.keys(CB).every(k => CA[k] === CB[k]) || { CB, CA } })
  await t("FIN_default_removed_not_null_check_kept", async () => (await q(`select count(*)::int n from pg_attrdef d join pg_attribute a on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.referrals'::regclass and a.attname='origin_kind'`))[0].n === 0 && (await q(`select attnotnull v from pg_attribute where attrelid='public.referrals'::regclass and attname='origin_kind'`))[0].v === true && (await q(`select count(*)::int n from pg_constraint where conrelid='public.referrals'::regclass and conname in ('referrals_origin_kind_chk','referrals_employee_origin_no_reward_chk') and convalidated`))[0].n === 2)
  const R4 = await refSnap()
  await t("FIN_preexisting_249_still_legacy_same_updated_at", () => preIds.every(id => R4[id].origin_kind === "legacy" && R4[id].updated_at === R0[id].updated_at))
  await t("FIN_legacy_eligibility_identical", async () => { for (const id of preIds) if ((await fe(id)) !== eligBefore[id]) return id; return true })

  // ---------- State 4: new code + finalize ----------
  const o4 = await old(P.ind)
  await t("S4_insert_without_origin_fails", () => (!o4.ok && /origin_kind_required/.test(o4.err)) || o4)
  const o4web = await tryOwner(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source) values (null,'n','1',$1,false,'public_pre_registration')`, [plan])
  await t("S4_old_web_insert_without_origin_fails", () => (!o4web.ok && /origin_kind_required/.test(o4web.err)) || o4web)
  const l4 = await nw(P.ind, "legacy")
  await t("S4_explicit_legacy_rejected", () => (!l4.ok && /origin_kind_legacy_reserved/.test(l4.err)) || l4)
  await ctxSuite("S4")
  await t("S4_existing_rewards_intact", async () => (await rewSnap(preRewardIds)) === W0)

  // ---------- Concurrency: comercial as indicator, parallel reward creation ----------
  const pool = await Promise.all(Array.from({ length: 6 }, async () => { const k = new Client(conn); await k.connect(); return k }))
  try {
    const onUser = async (k, uid, sql, p = []) => { await k.query("begin"); try { await k.query("set local role authenticated"); await k.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]); const r = await k.query(sql, p); await k.query("commit"); return { ok: true, rows: r.rows } } catch (e) { await k.query("rollback").catch(() => {}); return { ok: false, err: e.message } } }
    const cc = (await nw(P.com, "indicator")).rows[0].id
    const rs = await Promise.all(pool.map(k => onUser(k, P.adm, `select public.ensure_referral_reward($1) r`, [cc])))
    await t("CC8_comercial_indicator_concurrent_single_reward", async () => rs.every(x => x.ok && x.rows[0].r.ok) && rs.filter(x => x.rows[0].r.created === true).length === 1 && (await q(`select count(*)::int n from public.rewards where referral_id=$1`, [cc]))[0].n === 1)
    const ins = await Promise.all(pool.map((k, i) => onUser(k, i % 2 ? P.com : P.adm, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind) values ($1,'n','1',$2,true,'indicator') returning reward_eligible`, [i % 2 ? P.com : P.adm, plan])))
    await t("CC9_concurrent_explicit_indicator_inserts_eligible", () => ins.every(x => x.ok && x.rows[0].reward_eligible === true) || ins)
  } finally { await Promise.all(pool.map(k => k.end().catch(() => {}))) }
} finally { await stopCollectionsLab() }
for (const r of out) console.log(r.join(" | "))
const pass = out.filter(r => r[1] === "PASS").length
console.log(`H1B_RELEASE_WINDOW_LAB=${ok ? "PASS" : "FAIL"} (${pass}/${out.length})`)
process.exit(ok ? 0 : 1)
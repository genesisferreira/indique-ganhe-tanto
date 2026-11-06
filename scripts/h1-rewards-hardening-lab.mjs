// 3.1F-H1 local PG validation (127.0.0.1 only). No remote.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { startCollectionsLab, stopCollectionsLab, REPO_ROOT } from "./local-pg-collections-lab/run.mjs"
const extra = [
  "supabase/patch-referral-interested-fields.sql",
  "supabase/patch-public-pre-registration.sql",
  "supabase/patch-pre-registration-pj-neutral-network.sql",
  "supabase/patch-commercial-assisted-referral-foundation.sql",
  "supabase/patch-assisted-indicator-account-foundation.sql",
  "supabase/patch-notifications-referral-events.sql",
  "supabase/patch-notifications-indicator-events.sql",
  "supabase/patch-brbyte-sync-infrastructure.sql",
  "supabase/patch-first-invoice-reward-from-controllr-amount.sql",
  "supabase/patch-financial-reward-eligibility-hardening.sql",
  "supabase/patch-employee-origin-and-rewards-hardening-3-1f-h1.sql",
  "supabase/patch-employee-origin-and-rewards-hardening-3-1f-h1.sql",
  // 3.1F-H1b: este lab valida o estado final (código novo + finalize, reaplicada).
  // A janela expand -> deploy -> finalize é coberta em scripts/h1b-release-window-lab.mjs.
  "supabase/patch-employee-origin-hardening-finalize-3-1f-h1b.sql",
  "supabase/patch-employee-origin-hardening-finalize-3-1f-h1b.sql",
]
const res = []
const preIds = { ind: "22222222-0000-0000-0000-000000000001", r_ok: null, r_no: null }
let preSnap = null
async function seedPreMigration() {
  // 20 strengthened: seeded pre-H1 rows (lab only) must not be reclassified beyond 'legacy'
  await c.query(`insert into public.profiles(id,email,role) values ($1,'pre@x','indicador')`, [preIds.ind])
  const p = (await c.query(`select id from public.plans limit 1`)).rows[0]?.id ?? (await c.query(`insert into public.plans(name, speed_label, price, reward_amount) values ('p','1M',1,30) returning id`)).rows[0].id
  preIds.r_ok = (await c.query(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible) values ($1,'n','1',$2,true) returning id`, [preIds.ind, p])).rows[0].id
  preIds.r_no = (await c.query(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible) values ($1,'n','1',$2,false) returning id`, [preIds.ind, p])).rows[0].id
  preSnap = (await c.query(`select id, indicator_profile_id, reward_eligible, source from public.referrals order by id`)).rows
}let ok = true
const { client: c, conn, Client } = await startCollectionsLab()
try {
  let granted = false
  for (const f of extra) {
    if (f.includes("3-1f-h1") && !granted) { await seedPreMigration();  granted = true; await c.query("grant all on all tables in schema public to anon, authenticated; grant all on all functions in schema public to anon, authenticated, public"); console.log("PRE_H1_SUPABASE_DEFAULT_GRANTS=ALL (mirrors prod drift)") }
    // 3.1F-H1c: finalize exige o GUC com offset explícito (instante registrado antes da expand)
    if (f.includes("3-1f-h1.sql") && !globalThis.__h1bStartedAt) { await new Promise(r => setTimeout(r, 1100)); globalThis.__h1bStartedAt = new Date().toISOString() }
    if (f.includes("finalize")) await c.query(`select set_config('igt.h1b_expand_started_at',$1,false)`, [globalThis.__h1bStartedAt])
    try { await c.query(readFileSync(join(REPO_ROOT, f), "utf8")); res.push(["apply", f, "OK"]) }
    catch (e) { console.log("APPLY_ERR", f, e.message); await c.query("rollback").catch(()=>{}) }
  }
  const t = async (name, fn) => { try { const v = await fn(); res.push([name, v ? "PASS" : "FAIL"]); if (!v) ok = false } catch (e) { res.push([name, "FAIL " + e.message]); ok = false } }
  const denied = async (sql, role, uid) => {
    await c.query("begin"); try { await c.query(`set local role ${role}`); if (uid) await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]); await c.query(sql); await c.query("rollback"); return false }
    catch (e) { await c.query("rollback"); return /permission denied|row-level security|42501|employee_must|requires_rpc/.test(e.message) }
  }
  const asUser = async (uid, sql, p = []) => { await c.query("begin"); try { await c.query("set local role authenticated"); await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]); const r = await c.query(sql, p); await c.query("commit"); return r.rows } catch (e) { await c.query("rollback"); throw e } }
  // fixtures
  const ids = { ind: "11111111-0000-0000-0000-000000000001", ind2: "11111111-0000-0000-0000-000000000002", emp: "11111111-0000-0000-0000-000000000003", adm: "11111111-0000-0000-0000-000000000004", mgr: "11111111-0000-0000-0000-000000000005" }
  await c.query(`insert into public.profiles(id,email,role) values ($1,'a@x','indicador'),($2,'b@x','indicador'),($3,'c@x','funcionario'),($4,'d@x','admin_master'),($5,'e@x','comercial')`, Object.values(ids))
  const plan = (await c.query(`select id from public.plans limit 1`)).rows[0]?.id ?? (await c.query(`insert into public.plans(name, speed_label, price, reward_amount) values ('p','1M',1,30) returning id`)).rows[0]?.id
  res.push(["plan_fixture", plan ? "OK" : "MISSING"])
  const sector = (await c.query(`select id from public.sectors limit 1`)).rows[0].id
  const emp = (await c.query(`insert into public.employees(profile_id,status) values ($1,'active') returning id`, [ids.emp])).rows[0].id
  await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id) values ($1,$2)`, [emp, sector])
  const legacyCount0 = (await c.query(`select count(*)::int n from public.referrals where origin_kind='legacy'`)).rows[0].n
  const insRef = (uid, extra = "") => asUser(uid, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_type,reward_amount,origin_kind${extra ? "," + extra.split("=")[0] : ""}) values ($1,'n','1',$2,'pix',30,'indicator'${extra ? "," + extra.split("=")[1] : ""}) returning id, origin_kind, reward_eligible`, [uid, plan])
  // indicator valid
  const r1 = (await insRef(ids.ind))[0]
  await t("2_indicator_origin_indicator_eligible", () => r1.origin_kind === "indicator" && r1.reward_eligible === true)
  // employee via createReferral crossover
  await t("F1_createReferral_employee_blocked", () => denied(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_type,reward_amount,origin_kind) values ('${ids.emp}','n','1','${plan}','pix',30,'indicator')`, "authenticated", ids.emp))
  await t("5_employee_origin_tampered_payload_blocked", () => denied(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind) values (null,'n','1','${plan}',true,'employee')`, "authenticated", ids.adm))
  await t("F2_assisted_employee_as_indicator_blocked", async () => { try { await c.query(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source,origin_kind) values ($1,'n','1',$2,true,'commercial_assisted_referral','assisted_indicator')`, [ids.emp, plan]); return false } catch (e) { return /employee_must/.test(e.message) } })
  // ensure_referral_reward admin
  const e1 = (await asUser(ids.adm, `select public.ensure_referral_reward($1) r`, [r1.id]))[0].r
  const e1b = (await asUser(ids.adm, `select public.ensure_referral_reward($1) r`, [r1.id]))[0].r
  await t("2b_indicator_reward_created_via_rpc", () => e1.ok && e1.created === true)
  await t("dup_call_no_duplicate_reward", async () => e1b.ok && e1b.created === false && (await c.query(`select count(*)::int n from public.rewards where referral_id=$1`, [r1.id])).rows[0].n === 1)
  await t("2c_indicator_mark_first_invoice_paid_regression", async () => { const r = (await asUser(ids.adm, `select public.mark_first_invoice_paid($1) r`, [r1.id]))[0].r; const r2 = (await asUser(ids.adm, `select public.mark_first_invoice_paid($1) r`, [r1.id]))[0].r; return r.ok === true && r2.ok === true && r2.idempotent === true && (await c.query(`select count(*)::int n from public.wallet_transactions where reward_id=$1`, [e1.reward_id])).rows[0].n === 1 })
  await t("6_authenticated_direct_insert_denied", () => denied(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ('${r1.id}','${ids.ind}',1,'pix')`, "authenticated", ids.adm))
  await t("7_authenticated_direct_update_denied", () => denied(`update public.rewards set amount=999`, "authenticated", ids.adm))
  await t("8_authenticated_direct_delete_denied", () => denied(`delete from public.rewards`, "authenticated", ids.adm))
  await t("9_truncate_denied_authenticated", () => denied(`truncate public.rewards`, "authenticated", ids.adm))
  await t("9b_truncate_denied_anon", () => denied(`truncate public.rewards`, "anon"))
  await t("anon_insert_denied", () => denied(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ('${r1.id}','${ids.ind}',1,'pix')`, "anon"))
  await t("10_anon_cannot_exec_mark_first_invoice_paid", async () => (await c.query(`select has_function_privilege('anon','public.mark_first_invoice_paid(uuid)','execute') v`)).rows[0].v === false)
  await t("10b_public_cannot_exec_mark_first_invoice_paid", async () => (await c.query(`select bool_or(a.grantee=0) v from pg_proc p, aclexplode(p.proacl) a where p.proname='mark_first_invoice_paid'`)).rows[0].v !== true)
  await t("11_sync_rpc_service_role_only", async () => (await c.query(`select bool_and(not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and has_function_privilege('service_role',p.oid,'execute')) v from pg_proc p where proname='mark_first_invoice_paid_from_sync'`)).rows[0].v === true)
  await t("11b_service_role_no_truncate_delete", async () => !(await c.query(`select has_table_privilege('service_role','public.rewards','truncate') v`)).rows[0].v)
  await t("12_select_rls_no_cross_read", async () => (await asUser(ids.ind2, `select count(*)::int n from public.rewards`))[0].n === 0)
  await t("12b_own_reward_select_preserved_admin", async () => (await asUser(ids.adm, `select count(*)::int n from public.rewards`))[0].n === 1)
  // ineligible
  const r3 = (await asUser(ids.ind, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,origin_kind) values ($1,'n','1',$2,false,'indicator') returning id`, [ids.ind, plan]))[0]
  await t("3_reward_eligible_false_blocks", async () => (await asUser(ids.adm, `select public.ensure_referral_reward($1) r`, [r3.id]))[0].r.code === "not_reward_eligible")
  const web = (await c.query(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source,origin_kind) values (null,'n','1',$1,false,'public_pre_registration','web_preregistration') returning id, origin_kind`, [plan])).rows[0]
  await t("4_null_indicator_web_blocks", async () => web.origin_kind === "web_preregistration" && (await asUser(ids.adm, `select public.ensure_referral_reward($1) r`, [web.id]))[0].r.code === "not_reward_eligible")
  const nn = (await c.query(`insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,reward_eligible,source,origin_kind) values (null,'n','1',$1,false,'neutral_network_pre_registration','neutral_network') returning id, origin_kind`, [plan])).rows[0]
  await t("neutral_network_no_reward", async () => nn.origin_kind === "neutral_network" && (await asUser(ids.adm, `select public.ensure_referral_reward($1) r`, [nn.id]))[0].r.code === "not_reward_eligible")
  await t("service_role_insert_web_reward_blocked_by_trigger", async () => { try { await c.query(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ($1,$2,1,'pix')`, [web.id, ids.ind]); return false } catch (e) { return /not_reward_eligible/.test(e.message) } })
  // employee RPC
  const key = "emp-key-0000000000001"
  const call = (k, role = "technician_originator") => asUser(ids.emp, `select public.create_employee_sales_opportunity($1,$2,$3,$4,'n','1') r`, [k, role, sector, plan])
  const o1 = (await call(key))[0].r
  const o2 = (await call(key))[0].r
  await t("E_employee_rpc_creates_opportunity", () => o1.ok === true && o1.idempotent === false)
  await t("14_attribution_idempotent", async () => o2.ok && o2.idempotent === true && o2.opportunity_id === o1.opportunity_id && (await c.query(`select count(*)::int n from public.sales_opportunity_attributions where opportunity_id=$1`, [o1.opportunity_id])).rows[0].n === 1)
  const row = (await c.query(`select origin_kind, indicator_profile_id, reward_eligible from public.referrals where id=$1`, [o1.opportunity_id])).rows[0]
  await t("C_employee_row_invariants", () => row.origin_kind === "employee" && row.indicator_profile_id === null && row.reward_eligible === false)
  await t("1_employee_never_creates_reward_rpc", async () => (await asUser(ids.adm, `select public.ensure_referral_reward($1) r`, [o1.opportunity_id]))[0].r.code === "not_reward_eligible")
  await t("1b_employee_reward_service_role_insert_blocked", async () => { try { await c.query(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ($1,$2,1,'pix')`, [o1.opportunity_id, ids.ind]); return false } catch (e) { return /not_reward_eligible/.test(e.message) } })
  await t("1c_employee_mark_first_invoice_paid_no_reward", async () => { const r = (await asUser(ids.adm, `select public.mark_first_invoice_paid($1) r`, [o1.opportunity_id]))[0].r; return r.ok === false && (await c.query(`select count(*)::int n from public.rewards where referral_id=$1`, [o1.opportunity_id])).rows[0].n === 0 })
  await t("employee_update_to_eligible_neutralized", async () => { await c.query(`update public.referrals set reward_eligible=true, indicator_profile_id=$2 where id=$1`, [o1.opportunity_id, ids.ind]); const r = (await c.query(`select reward_eligible, indicator_profile_id from public.referrals where id=$1`, [o1.opportunity_id])).rows[0]; return r.reward_eligible === false && r.indicator_profile_id === null })
  await t("origin_kind_immutable", async () => { try { await c.query(`update public.referrals set origin_kind='indicator' where id=$1`, [o1.opportunity_id]); return false } catch (e) { return /immutable/.test(e.message) } })
  await t("13_15_attribution_failure_rolls_back_opportunity", async () => {
    const before = (await c.query(`select count(*)::int n from public.referrals`)).rows[0].n
    await c.query(`update public.employees set status='active' where id=$1`, [emp])
    // force attribution failure: temporarily invalid via a role that violates check after referral insert
    await c.query(`alter table public.sales_opportunity_attributions add constraint tmp_fail check (attribution_role <> 'internal_sales_responsible')`)
    let failed = false
    try { await call("emp-key-0000000000002", "internal_sales_responsible") } catch { failed = true }
    await c.query(`alter table public.sales_opportunity_attributions drop constraint tmp_fail`)
    const after = (await c.query(`select count(*)::int n from public.referrals`)).rows[0].n
    return failed && before === after
  })
  await t("non_employee_cannot_call_employee_rpc", async () => (await asUser(ids.ind, `select public.create_employee_sales_opportunity('emp-key-0000000000003','technician_originator',$1,$2,'n','1') r`, [sector, plan]))[0].r.code === "forbidden")
  await t("anon_cannot_call_employee_rpc", async () => !(await c.query(`select has_function_privilege('anon','public.create_employee_sales_opportunity(text,text,uuid,uuid,text,text,text,text)','execute') v`)).rows[0].v)
  await t("manager_no_financial_audit_access", () => denied(`select * from public.financial_security_audit_events`, "authenticated", ids.mgr))
  await t("comercial_not_assigned_cannot_ensure_reward", async () => (await asUser(ids.mgr, `select public.ensure_referral_reward($1) r`, [r1.id]))[0].r.code === "forbidden")
  await t("admin_cannot_update_reward_directly", () => denied(`update public.rewards set status='disponivel'`, "authenticated", ids.adm))
  await t("H1b_post_finalize_insert_without_origin_fails", async () => { try { await asUser(ids.ind, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id) values ($1,'n','1',$2)`, [ids.ind, plan]); return false } catch (e) { return /origin_kind_required|null value/.test(e.message) } })
  await t("H1b_post_finalize_explicit_legacy_rejected", async () => { try { await asUser(ids.ind, `insert into public.referrals(indicator_profile_id,referred_name,referred_phone,plan_id,origin_kind) values ($1,'n','1',$2,'legacy')`, [ids.ind, plan]); return false } catch (e) { return /origin_kind_legacy_reserved/.test(e.message) } })
  await t("H1b_comercial_and_admin_master_indicator_eligible", async () => { const a = (await insRef(ids.mgr))[0]; const b = (await insRef(ids.adm))[0]; return a.origin_kind === "indicator" && a.reward_eligible === true && b.origin_kind === "indicator" && b.reward_eligible === true })
  await t("20_no_existing_reclassified", async () => (await c.query(`select count(*)::int n from public.referrals where origin_kind='legacy'`)).rows[0].n === legacyCount0)
  await t("audit_events_sanitized", async () => (await c.query(`select count(*)::int n from public.financial_security_audit_events where metadata ?| array['name','phone','amount','cpf']`)).rows[0].n === 0 && (await c.query(`select count(*)::int n from public.financial_security_audit_events`)).rows[0].n > 0)
  await t("audit_append_only", async () => { try { await c.query(`delete from public.financial_security_audit_events`); return false } catch { return true } })
  // ---- H1R concurrency & atomicity (local PG only) ----
  const pool = await Promise.all(Array.from({ length: 6 }, async () => { const k = new Client(conn); await k.connect(); return k }))
  const onUser = async (k, uid, sql, p = []) => { await k.query("begin"); try { await k.query("set local role authenticated"); await k.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]); const r = await k.query(sql, p); await k.query("commit"); return { ok: true, rows: r.rows } } catch (e) { await k.query("rollback").catch(() => {}); return { ok: false, err: e.message } } }
  const onOwner = async (k, sql, p = []) => { try { return { ok: true, rows: (await k.query(sql, p)).rows } } catch (e) { return { ok: false, err: e.message } } }
  try {
    const ckey = "emp-key-conc-000000000001"
    const cr = await Promise.all(pool.map(k => onUser(k, ids.emp, `select public.create_employee_sales_opportunity($1,'technician_originator',$2,$3,'n','1') r`, [ckey, sector, plan])))
    const oppIds = new Set(cr.filter(x => x.ok && x.rows[0].r.ok).map(x => x.rows[0].r.opportunity_id))
    await t("CC1_concurrent_same_idempotency_key_single_opportunity", async () => oppIds.size === 1 && (await c.query(`select count(*)::int n from public.referrals where employee_opportunity_idempotency_key=$1`, [ckey])).rows[0].n === 1 && cr.filter(x => x.ok && x.rows[0].r.ok).length >= 1 && cr.every(x => !x.ok || x.rows[0].r.ok))
    const copp = [...oppIds][0]
    await t("CC2_one_attribution_per_role", async () => (await c.query(`select coalesce(max(n),0)::int m from (select count(*) n from public.sales_opportunity_attributions group by opportunity_id, attribution_role) q`)).rows[0].m === 1 && (await c.query(`select count(*)::int n from public.sales_opportunity_attributions where opportunity_id=$1`, [copp])).rows[0].n === 1)
    await t("CC2b_duplicate_role_insert_rejected_by_unique", async () => { const r = await onOwner(c, `insert into public.sales_opportunity_attributions(opportunity_id,employee_id,attribution_role,sector_id,attributed_by,source) select opportunity_id,employee_id,attribution_role,sector_id,attributed_by,source from public.sales_opportunity_attributions where opportunity_id=$1`, [copp]); return !r.ok && /unique|duplicate|23505/.test(r.err) })
    await t("CC3_rollback_on_attribution_failure", async () => res.some(x => x[0] === "13_15_attribution_failure_rolls_back_opportunity" && x[1] === "PASS") && (await c.query(`select count(*)::int n from public.referrals where employee_opportunity_idempotency_key='emp-key-0000000000002'`)).rows[0].n === 0)
    const er = await Promise.all(pool.map((k, i) => i % 2 ? onUser(k, ids.adm, `select public.ensure_referral_reward($1) r`, [copp]) : onOwner(k, `insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ($1,$2,1,'pix')`, [copp, ids.ind])))
    await t("CC4_concurrent_employee_reward_attempts_blocked", async () => er.every(x => x.ok ? x.rows[0].r.code === "not_reward_eligible" : /not_reward_eligible/.test(x.err)) && (await c.query(`select count(*)::int n from public.rewards r join public.referrals f on f.id=r.referral_id where f.origin_kind='employee'`)).rows[0].n === 0)
    const r5 = (await insRef(ids.ind2))[0]
    const lr = await Promise.all(pool.map(k => onUser(k, ids.adm, `select public.ensure_referral_reward($1) r`, [r5.id])))
    const lp = await Promise.all(pool.map(k => onUser(k, ids.adm, `select public.mark_first_invoice_paid($1) r`, [r5.id])))
    await t("CC5_legit_indicator_concurrent_no_duplicate_reward", async () => lr.filter(x => x.ok && x.rows[0].r.ok && x.rows[0].r.created === true).length === 1 && lr.every(x => x.ok && x.rows[0].r.ok) && lp.every(x => x.ok && x.rows[0].r.ok) && (await c.query(`select count(*)::int n from public.rewards where referral_id=$1`, [r5.id])).rows[0].n === 1 && (await c.query(`select count(*)::int n from public.wallet_transactions w join public.rewards r on r.id=w.reward_id where r.referral_id=$1`, [r5.id])).rows[0].n === 1)
    // RPC vs trigger agreement per origin_kind (trigger probe inside rolled-back tx)
    const r6 = (await insRef(ids.ind2))[0]
    const agree = async (rid) => { const rpcElig = await (async () => { await c.query("begin"); try { await c.query("set local role authenticated"); await c.query(`select set_config('request.jwt.claim.sub',$1,true)`, [ids.adm]); const r = (await c.query(`select public.ensure_referral_reward($1) r`, [rid])).rows[0].r; return r.ok === true } finally { await c.query("rollback") } })(); const trgElig = await (async () => { await c.query("begin"); try { await c.query(`insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ($1,$2,1,'pix')`, [rid, ids.ind2]); return true } catch (e) { return /not_reward_eligible/.test(e.message) ? false : null } finally { await c.query("rollback") } })(); return rpcElig === trgElig ? rpcElig : "DISAGREE" }
    const ag = { employee: await agree(copp), web: await agree(web.id), neutral: await agree(nn.id), ineligible: await agree(r3.id), indicator: await agree(r6.id), legacy_ok: await agree(preIds.r_ok), legacy_no: await agree(preIds.r_no) }
    await t("CC6_rpc_and_trigger_agree_on_origin_kind", () => ag.employee === false && ag.web === false && ag.neutral === false && ag.ineligible === false && ag.indicator === true && ag.legacy_ok === true && ag.legacy_no === false)
    const dr = await Promise.all(pool.map(k => onUser(k, ids.adm, `insert into public.rewards(referral_id,indicator_profile_id,amount,reward_type) values ($1,$2,1,'pix')`, [r6.id, ids.ind2])))
    await t("CC7_authenticated_parallel_direct_insert_denied", async () => dr.every(x => !x.ok && /permission denied|row-level security|42501/.test(x.err)) && (await c.query(`select count(*)::int n from public.rewards where referral_id=$1`, [r6.id])).rows[0].n === 0)
    await t("20b_seeded_preexisting_rows_only_marked_legacy", async () => { const now = (await c.query(`select id, indicator_profile_id, reward_eligible, source, origin_kind from public.referrals where id = any($1::uuid[]) order by id`, [preSnap.map(r => r.id)])).rows; return preSnap.length === 2 && now.length === 2 && now.every((r, i) => r.origin_kind === "legacy" && r.reward_eligible === preSnap[i].reward_eligible && r.indicator_profile_id === preSnap[i].indicator_profile_id && r.source === preSnap[i].source) })
  } finally { await Promise.all(pool.map(k => k.end().catch(() => {}))) }} finally {
  await stopCollectionsLab()
}
for (const r of res) console.log(r.join(" | "))
console.log(ok ? "H1_LAB=PASS" : "H1_LAB=FAIL")
process.exit(ok ? 0 : 1)

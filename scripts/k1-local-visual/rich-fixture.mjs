// 3.1F-K1B — fixture SINTÉTICA para o PostgreSQL de lab (127.0.0.1, descartável). Nenhum dado real/PII:
// IDs 88888888-…, nomes "Sintético", e-mails @lab.invalid, telefones 00000000000.
// Escreve SOMENTE no lab local, ANTES do snapshot inicial. Depois disso, tudo é leitura (mock READ ONLY + ROLLBACK).
//
// Fixtures:
//  - "rich":  comerciais, indicadores, funcionários, setores/memberships, planos, indicações em vários status,
//             rewards, wallet_transactions, disponibilidade comercial e 1 caso mínimo de Collections.
//             Tabelas financeiras (comissão/folha/pagamentos) ficam VAZIAS.
//  - "empty": somente o Admin Master — vazio real (resposta válida vazia) em comerciais/indicações/funcionários.

const id = (n) => `88888888-0000-4000-8000-${String(n).padStart(12, "0")}`
export const RICH = {
  AM: "77777777-0000-4000-8000-000000000010",
  CM: "77777777-0000-4000-8000-000000000013",
  FA: "77777777-0000-4000-8000-00000000000a",
  IN: "77777777-0000-4000-8000-000000000014",
  CM2: id(2), CM3: id(3), IN2: id(4), FA2: id(5), FA3: id(6),
  PLAN1: id(101), PLAN2: id(102),
}
export const LAB_USERS = {
  AM: [RICH.AM, "admin_master", null, "Lab Admin Master"],
  CM: [RICH.CM, "comercial", "active", "Lab Comercial Ativo"],
  FA: [RICH.FA, "funcionario", "active", "Lab Funcionário"],
  IN: [RICH.IN, "indicador", null, "Lab Indicador"],
}
const EXTRA = [
  [RICH.CM2, "comercial", "active", "Comercial Sintético Dois", true],
  [RICH.CM3, "comercial", null, "Comercial Sintético Inativo", false],
  [RICH.IN2, "indicador", null, "Indicador Sintético Dois", true],
  [RICH.FA2, "funcionario", "paused", "Funcionário Sintético Pausado", true],
  [RICH.FA3, "funcionario", "vacation", "Funcionário Sintético Férias", true],
]
export const RICH_REFERRAL_NAMES = ["Cliente Sintético 01", "Cliente Sintético 02", "Cliente Sintético 03", "Cliente Sintético 04", "Cliente Sintético 05", "Cliente Sintético 06"]

export async function seedFixture(c, kind) {
  const users = kind === "empty" ? { AM: LAB_USERS.AM } : LAB_USERS
  await c.query("begin")
  try {
    for (const [k, [uid, role, status, name]] of Object.entries(users)) {
      await c.query(`insert into public.profiles(id,email,role,is_active,full_name,must_change_password,phone) values ($1,$2,$3,true,$4,false,'00000000000')`, [uid, `${k.toLowerCase()}@lab.invalid`, role, name])
      if (status) await c.query(`insert into public.employees(profile_id,status) values ($1,$2::public.employee_status)`, [uid, status])
    }
    if (kind === "rich") {
      for (const [uid, role, status, name, active] of EXTRA) {
        await c.query(`insert into public.profiles(id,email,role,is_active,full_name,must_change_password,phone) values ($1,$2,$3,$4,$5,false,'00000000000')`, [uid, `${uid.slice(-4)}@lab.invalid`, role, active, name])
        if (status) await c.query(`insert into public.employees(profile_id,status) values ($1,$2::public.employee_status)`, [uid, status])
      }
      const sectors = (await c.query(`select id, code from public.sectors where is_active order by code limit 2`)).rows
      if (sectors.length < 2) throw new Error("lab sem setores suficientes")
      const emp = async (pid) => (await c.query(`select id from public.employees where profile_id=$1`, [pid])).rows[0].id
      await c.query(`insert into public.employee_sector_memberships(employee_id,sector_id,is_active) values ($1,$2,true),($3,$2,true),($4,$5,true),($6,$5,true)`, [await emp(RICH.CM), sectors[0].id, await emp(RICH.CM2), await emp(RICH.FA), sectors[1].id, await emp(RICH.FA2)])
      await c.query(`insert into public.plans(id,name,speed_label,price,description,reward_amount,is_active,sort_order) values ($1,'Plano Sintético 300','300 Mega',99.90,'fixture',50,true,1),($2,'Plano Sintético 600','600 Mega',129.90,'fixture',80,true,2)`, [RICH.PLAN1, RICH.PLAN2])
      await c.query(`insert into public.commercial_availability(commercial_profile_id,availability_status) values ($1,'disponivel'),($2,'em_pausa')`, [RICH.CM, RICH.CM2])
      const statuses = ["pendente", "em_andamento", "em_negociacao", "aprovada", "paga", "recusada"]
      const refIds = []
      for (let i = 0; i < 6; i++) {
        const rid = id(201 + i)
        refIds.push(rid)
        await c.query(
          `insert into public.referrals(id,indicator_profile_id,referred_name,referred_phone,plan_id,reward_type,reward_amount,status,commercial_profile_id,origin_kind,source,created_at,updated_at)
           values ($1,$2,$3,'00000000000',$4,'pix',$5,$6::public.referral_status,$7,'indicator','fixture', timestamptz '2026-10-01 12:00:00+00' + ($8 || ' hours')::interval, timestamptz '2026-10-01 12:00:00+00' + ($8 || ' hours')::interval)`,
          [rid, i % 2 ? RICH.IN2 : RICH.IN, RICH_REFERRAL_NAMES[i], i % 2 ? RICH.PLAN2 : RICH.PLAN1, i % 2 ? 80 : 50, statuses[i], i < 3 ? RICH.CM : RICH.CM2, String(i)]
        )
      }
      // rewards: indicações aprovada (idx 3) e paga (idx 4)
      const rw1 = (await c.query(`insert into public.rewards(referral_id,indicator_profile_id,reward_type,amount,status) values ($1,$2,'pix',80,'disponivel') returning id`, [refIds[3], RICH.IN2])).rows[0].id
      const rw2 = (await c.query(`insert into public.rewards(referral_id,indicator_profile_id,reward_type,amount,status) values ($1,$2,'pix',50,'pendente') returning id`, [refIds[4], RICH.IN])).rows[0].id
      await c.query(`insert into public.wallet_transactions(indicator_profile_id,reward_id,transaction_type,amount,balance_before,balance_after,description,reference_code) values ($1,$2,'credito',80,0,80,'Crédito sintético (fixture)','LAB-1'),($3,$4,'credito',50,0,50,'Crédito sintético (fixture)','LAB-2')`, [RICH.IN2, rw1, RICH.IN, rw2])
      await c.query(`insert into public.collection_cases(customer_name,days_overdue,status,case_unit,erp_snapshot,metadata) values ('Cliente Sintético Collections',5,'open','invoice','{}'::jsonb,'{"fixture":"k1b"}'::jsonb)`)
    }
    await c.query("commit")
  } catch (e) {
    await c.query("rollback").catch(() => {})
    throw e
  }
}

const TABLES = [
  ["profiles", "updated_at"], ["employees", "updated_at"], ["employee_sector_memberships", "updated_at"], ["sectors", "updated_at"],
  ["plans", "updated_at"], ["referrals", "updated_at"], ["rewards", "updated_at"], ["wallet_transactions", "created_at"],
  ["payments", "updated_at"], ["commercial_availability", "updated_at"], ["notifications", "updated_at"], ["collection_cases", "updated_at"],
  ["employee_commission_rules", null], ["sales_opportunity_attributions", null], ["employee_commission_entitlements", null],
  ["employee_compensation_profiles", null], ["employee_worked_days", null], ["payroll_competences", null],
  ["payroll_competence_lines", null], ["finance_audit_events", null],
]
export const FINANCIAL_TABLES = TABLES.slice(12).map(([t]) => t).concat(["payments"])

/** Snapshot: contagem + digest (md5 do conteúdo ordenado) + max(updated_at) por tabela + contadores de escrita do PG. */
export async function richSnapshot(c) {
  const out = { tables: {} }
  for (const [t, ts] of TABLES) {
    const r = (await c.query(`select count(*)::int n, md5(coalesce(string_agg(x::text,'|' order by x::text),'')) d${ts ? `, max(x.${ts})::text ts` : ""} from public.${t} x`)).rows[0]
    out.tables[t] = { n: r.n, digest: r.d, ...(ts ? { maxTs: r.ts } : {}) }
  }
  try { await c.query("select pg_stat_force_next_flush()") } catch {}
  await c.query("select pg_stat_clear_snapshot()")
  const w = (await c.query(`select coalesce(sum(n_tup_ins),0)::bigint ins, coalesce(sum(n_tup_upd),0)::bigint upd, coalesce(sum(n_tup_del),0)::bigint del from pg_stat_user_tables where schemaname='public'`)).rows[0]
  out.pgWrites = { ins: String(w.ins), upd: String(w.upd), del: String(w.del) }
  return out
}

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { formatUserRoleLabel } from "@/lib/auth/format-user-role-label"
import {
  AUTH_DELETE_CONFIRMATION,
  DEACTIVATE_CONFIRMATION,
  DELETION_AUTHORIZED_ROLES,
  INDICATOR_CONFIRMATION,
  REFERRAL_CONFIRMATION,
  bulkConfirmation,
  canHardDelete,
  isDeletionAuthorizedRole,
  reasonIssue,
  referralBlockers,
  type ReferralGateInput,
} from "./contract"
import { runDeletion } from "./handlers"

const sql = readFileSync("supabase/patch-controlled-deletion-3-1f-j17.sql", "utf8")
const route = readFileSync("app/api/admin/deletions/route.ts", "utf8")
const form = readFileSync("components/admin/controlled-deletion.tsx", "utf8")
const list = readFileSync("app/admin/indicacoes/page.tsx", "utf8")
const detail = readFileSync("app/admin/indicacoes/[id]/page.tsx", "utf8")
const indicators = readFileSync("app/admin/indicadores/page.tsx", "utf8")
const indicatorDetail = readFileSync("app/admin/indicadores/[id]/page.tsx", "utf8")

const clean: ReferralGateInput = {
  rewards: 0, wallet: 0, payments: 0, withdrawals: 0, entitlements: 0, competences: 0,
  financialAttributions: 0, contractOrInvoice: 0, pendingFinancial: 0, financeAudit: 0, sharedDependency: 0,
  externalPayment: false,
  testRecord: true,
}
const reason = "Cadastro sintético inválido e sem histórico financeiro."

describe("3.1F-J17 exclusão controlada", () => {
  it("autoriza somente o administrador master e bloqueia os demais papéis", () => {
    assert.deepEqual([...DELETION_AUTHORIZED_ROLES], ["admin_master"])
    assert.equal(formatUserRoleLabel("admin_master").startsWith("Administrador"), true)
    assert.equal(isDeletionAuthorizedRole("admin_master"), true)
    for (const role of ["admin_consulta", "admin_financeiro", "comercial", "indicador", "funcionario"] as const) {
      assert.equal(isDeletionAuthorizedRole(role), false)
      assert.equal(formatUserRoleLabel(role) === "Administrador", false)
    }
    assert.match(sql, /admin_consulta, admin_financeiro, comercial, indicador, funcionario, tecnico, vendedor_externo, parceiro/)
    assert.match(sql, /v_role is distinct from 'admin_master'/)
    assert.match(sql, /unauthenticated/)
    assert.match(sql, /grant execute on function public.admin_delete_referral/)
    assert.doesNotMatch(sql, /grant execute on function public.admin_delete_referral[\s\S]*to anon/)
  })

  it("bloqueia reward, carteira, pagamento, contrato, auditoria e dependência compartilhada", () => {
    assert.deepEqual(referralBlockers(clean), [])
    assert.equal(canHardDelete(clean, reason), true)
    assert.equal(canHardDelete({ ...clean, testRecord: false }, reason), true)
    assert.equal(canHardDelete({ ...clean, testRecord: false }, "curto"), false)
    assert.deepEqual(referralBlockers({ ...clean, rewards: 1 }), [])
    assert.deepEqual(referralBlockers({ ...clean, externalPayment: true }), ["external_payment"])
    assert.deepEqual(referralBlockers({ ...clean, entitlements: 1, competences: 2, sharedDependency: 1 }), ["entitlement", "competence", "shared_dependency"])
    assert.equal(reasonIssue("12345678901 no motivo"), "digits")
    assert.equal(reasonIssue(reason), "ok")
  })

  it("confirmação, lote misto e replay não apagam financeiro nem o Controllr", () => {
    assert.equal(REFERRAL_CONFIRMATION, "EXCLUIR INDICACAO")
    assert.equal(INDICATOR_CONFIRMATION, "EXCLUIR INDICADOR")
    assert.equal(AUTH_DELETE_CONFIRMATION, "EXCLUIR CONTA DE ACESSO")
    assert.equal(bulkConfirmation(3), "EXCLUIR SELECIONADOS")
    assert.match(sql, /EXCLUIR INDICAÇÃO/)
    assert.match(sql, /EXCLUIR INDICADOR/)
    assert.match(sql, /EXCLUIR CONTA DE ACESSO/)
    assert.match(sql, /bulk_blocked/)
    assert.match(sql, /idempotency_conflict/)
    assert.match(sql, /pg_advisory_xact_lock/)
    assert.match(sql, /on delete restrict/)
    assert.match(sql, /admin_deletion_tombstone_append_only/)
    assert.match(sql, /partner_sha256_hex/)
    assert.doesNotMatch(sql, /delete from public\.rewards|delete from public\.wallet_transactions|delete from public\.payments|delete from public\.finance_audit_events|delete from public\.employee_commission_entitlements|delete from public\.partner_commission_entitlements|delete from public\.payroll_competences/i)
    assert.doesNotMatch(sql, /net\.http|erp\.tantotelecom|delete_interest/i)
    assert.doesNotMatch(route, /controllr|brbyte|deleteUser\([\s\S]{0,40}service/i)
    assert.match(route, /deleteUser/)
    assert.match(route, /isDeletionAuthorizedRole/)
    assert.match(form, /REFERRAL_CONFIRMATION/)
    assert.match(form, /AUTH_DELETE_CONFIRMATION/)
    assert.match(list, /Excluir selecionadas/)
    assert.match(detail, /Excluir indicação/)
    assert.match(indicators, /Excluir indicador/)
    assert.match(indicatorDetail, /Excluir indicador/)
  })

  it("rejeita sessão ausente, motivo curto, confirmação errada e papel de consulta antes da RPC", async () => {
    const req = (body: unknown, origin = "https://crm.tantotelecom.com.br") => ({
      url: "https://crm.tantotelecom.com.br/api/admin/deletions",
      headers: { get: (name: string) => name.toLowerCase() === "origin" ? origin : name.toLowerCase() === "host" ? "crm.tantotelecom.com.br" : null },
      text: async () => JSON.stringify(body),
    })
    const unauth = await runDeletion("delete_referral", { ok: false, status: 401 }, { rpc: async () => ({ data: null, error: null }) }, req({}))
    assert.equal(unauth.body.code, "unauthenticated")
    let called = 0
    const client = { rpc: async () => { called += 1; return { data: { ok: true }, error: null } } }
    const short = await runDeletion("delete_referral", { ok: true }, client, req({
      referralId: "11111111-1111-4111-8111-111111111111",
      reason: "curto",
      confirmation: REFERRAL_CONFIRMATION,
      idempotencyKey: "idempotency-key-j17-ok",
    }))
    assert.equal(short.body.code, "reason_invalid")
    const wrong = await runDeletion("delete_referral", { ok: true }, client, req({
      referralId: "11111111-1111-4111-8111-111111111111",
      reason,
      confirmation: "APAGAR",
      idempotencyKey: "idempotency-key-j17-ok",
    }))
    assert.equal(wrong.body.code, "confirmation_mismatch")
    const auth = await runDeletion("commit_indicator", { ok: true }, client, req({
      indicatorId: "11111111-1111-4111-8111-111111111111",
      reason,
      confirmation: DEACTIVATE_CONFIRMATION,
      idempotencyKey: "idempotency-key-j17-ok",
      mode: "deactivate",
      authConfirmation: AUTH_DELETE_CONFIRMATION,
    }))
    assert.equal(auth.body.code, "auth_confirmation_mismatch")
    assert.equal(called, 0)
    assert.equal(isDeletionAuthorizedRole("admin_consulta"), false)
  })
})

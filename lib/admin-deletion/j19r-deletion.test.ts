import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { deletionFailureMessage, REAL_REASON_MIN } from "./contract"
import { runDeletion } from "./handlers"

const sql = readFileSync("supabase/patch-deletion-channel-parity-3-1f-j19r.sql", "utf8")
const form = readFileSync("components/admin/controlled-deletion.tsx", "utf8")
const list = readFileSync("app/admin/indicacoes/page.tsx", "utf8")
const direct = readFileSync("app/admin/captacoes/page.tsx", "utf8")

describe("3.1F-J19R paridade da exclusão", () => {
  it("mostra a causa específica e não a frase genérica de dado financeiro", () => {
    assert.equal(deletionFailureMessage("reason_too_short").includes(String(REAL_REASON_MIN)), true)
    assert.equal(deletionFailureMessage("external_payment").includes("vínculo financeiro"), true)
    assert.equal(deletionFailureMessage("financial_dependency").includes("dependência"), true)
    assert.equal(deletionFailureMessage("stale_preview").includes("prévia"), true)
    assert.equal(deletionFailureMessage("forbidden").includes("papel"), true)
    assert.equal(deletionFailureMessage("delete_failed", "12345678-aaaa-bbbb-cccc-ddddeeee").includes("12345678"), true)
    assert.equal(deletionFailureMessage("bulk_blocked").includes("Nenhum dado financeiro foi apagado"), false)
    assert.match(form, /deletionFailureMessage/)
    assert.doesNotMatch(form, /Nenhum dado financeiro foi apagado/)
  })

  it("a prévia e a execução compartilham o piso do motivo e a revisão", () => {
    assert.match(sql, /admin_deletion_reason_min/)
    assert.match(sql, /admin_deletion_revision/)
    assert.match(sql, /reason_too_short/)
    assert.match(sql, /stale_preview/)
    assert.match(sql, /grant execute on function public.admin_bulk_delete_referrals\(uuid\[\], text, text, text, text, text\) to authenticated/)
    assert.doesNotMatch(sql, /to anon/)
    assert.doesNotMatch(sql, /net\.http|erp\.tantotelecom|delete from public\.employee_commission_entitlements|delete from public\.partner_commission_entitlements/i)
    assert.match(list, /previousPage - 1/)
    assert.match(direct, /forcedChannel="direct"/)
  })

  it("repassa a revisão da prévia e rejeita revisão inválida antes da RPC", async () => {
    const req = (body: unknown) => ({
      url: "https://crm.tantotelecom.com.br/api/admin/deletions",
      headers: { get: (name: string) => name.toLowerCase() === "origin" ? "https://crm.tantotelecom.com.br" : name.toLowerCase() === "host" ? "crm.tantotelecom.com.br" : null },
      text: async () => JSON.stringify(body),
    })
    let args: Record<string, unknown> | undefined
    const client = { rpc: async (_fn: string, received?: Record<string, unknown>) => { args = received; return { data: { ok: true }, error: null } } }
    const reason = "Motivo detalhado para exclusao manual de registro real sem pagamento."
    const ok = await runDeletion("delete_bulk", { ok: true }, client, req({
      referralIds: ["11111111-1111-4111-8111-111111111111"],
      reason,
      confirmation: "EXCLUIR SELECIONADOS",
      idempotencyKey: "idempotency-key-j19r",
      revision: "a".repeat(32),
    }))
    assert.equal(ok.status, 200)
    assert.equal(args?.p_revision, "a".repeat(32))
    const stale = await runDeletion("delete_referral", { ok: true }, client, req({
      referralId: "11111111-1111-4111-8111-111111111111",
      reason,
      confirmation: "EXCLUIR INDICACAO",
      idempotencyKey: "idempotency-key-j19r",
      revision: "curta",
    }))
    assert.equal(stale.body.code, "stale_preview")
  })
})

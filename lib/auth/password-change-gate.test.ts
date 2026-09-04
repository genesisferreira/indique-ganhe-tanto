import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  assertPasswordChangeCompleted,
  currentUserPasswordChangeCompleted,
  isIndicatorClientOperationAllowed,
  isPasswordChangeRequired,
  PASSWORD_CHANGE_REQUIRED_CODE,
  PASSWORD_CHANGE_REQUIRED_MESSAGE,
  type IndicatorClientOperation,
} from "./password-change-gate"
import {
  isAllowedDuringMustChangePassword,
  resolvePostAuthPath,
} from "./auth-audit"

describe("password-change-gate", () => {
  it("1) /primeiro-acesso permitido com flag true", () => {
    assert.equal(isAllowedDuringMustChangePassword("/primeiro-acesso"), true)
    assert.equal(
      isIndicatorClientOperationAllowed({
        mustChangePassword: true,
        operation: "primeiro_acesso_page",
      }),
      true
    )
  })

  it("2) complete-first-password-change permitido", () => {
    assert.equal(
      isAllowedDuringMustChangePassword(
        "/api/auth/complete-first-password-change"
      ),
      true
    )
    assert.equal(
      isIndicatorClientOperationAllowed({
        mustChangePassword: true,
        operation: "complete_first_password_change",
      }),
      true
    )
  })

  it("3) logout permitido", () => {
    assert.equal(isAllowedDuringMustChangePassword("/auth/logout"), true)
    assert.equal(
      isIndicatorClientOperationAllowed({
        mustChangePassword: true,
        operation: "logout",
      }),
      true
    )
  })

  it("4) dashboard bloqueado", () => {
    assert.equal(isAllowedDuringMustChangePassword("/indicador"), false)
    assert.equal(
      resolvePostAuthPath({
        role: "indicador",
        mustChangePassword: true,
      }),
      "/primeiro-acesso"
    )
    assert.equal(
      isIndicatorClientOperationAllowed({
        mustChangePassword: true,
        operation: "dashboard_page",
      }),
      false
    )
  })

  it("5) API create-interest 403", () => {
    const gate = assertPasswordChangeCompleted({
      must_change_password: true,
    })
    assert.ok(gate)
    assert.equal(gate!.status, 403)
    assert.equal(gate!.code, PASSWORD_CHANGE_REQUIRED_CODE)
    assert.equal(gate!.message, PASSWORD_CHANGE_REQUIRED_MESSAGE)
    assert.equal(
      isIndicatorClientOperationAllowed({
        mustChangePassword: true,
        operation: "create_interest_api",
      }),
      false
    )
  })

  it("6-10) operações sensíveis negadas com flag true", () => {
    const denied: IndicatorClientOperation[] = [
      "profiles_update_own",
      "pix_keys_mutate",
      "referrals_insert",
      "referrals_select_own",
      "rewards_select_own",
      "wallet_select_own",
      "payments_select_own",
      "request_pix_withdrawal",
      "create_interest_api",
    ]
    for (const operation of denied) {
      assert.equal(
        isIndicatorClientOperationAllowed({
          mustChangePassword: true,
          operation,
        }),
        false,
        operation
      )
    }
    // leitura mínima do próprio profile para o gate
    assert.equal(
      isIndicatorClientOperationAllowed({
        mustChangePassword: true,
        operation: "profiles_select_own",
      }),
      true
    )
  })

  it("11-13) flag false preserva comportamento normal", () => {
    assert.equal(assertPasswordChangeCompleted({ must_change_password: false }), null)
    assert.equal(assertPasswordChangeCompleted({ mustChangePassword: false }), null)
    assert.equal(assertPasswordChangeCompleted(null), null)
    assert.equal(isPasswordChangeRequired({ must_change_password: false }), false)
    assert.equal(currentUserPasswordChangeCompleted(false), true)
    assert.equal(currentUserPasswordChangeCompleted(true), false)
    assert.equal(currentUserPasswordChangeCompleted(null), true)

    const ops: IndicatorClientOperation[] = [
      "referrals_insert",
      "pix_keys_mutate",
      "request_pix_withdrawal",
      "create_interest_api",
      "wallet_select_own",
      "dashboard_page",
    ]
    for (const operation of ops) {
      assert.equal(
        isIndicatorClientOperationAllowed({
          mustChangePassword: false,
          operation,
        }),
        true,
        operation
      )
    }
  })

  it("14) helper não bloqueia perfil sem flag (admin/commercial path)", () => {
    // APIs comerciais não usam este assert; ausência da flag = permitido.
    assert.equal(
      assertPasswordChangeCompleted({
        must_change_password: undefined,
      }),
      null
    )
  })
})

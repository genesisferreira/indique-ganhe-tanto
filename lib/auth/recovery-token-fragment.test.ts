import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  isPlausibleRecoveryTokenHash,
  parseRecoveryConfirmBody,
  parseRecoveryFragment,
} from "./recovery-token-fragment"

const VALID_HASH = "a".repeat(32)

describe("recovery token fragment", () => {
  it("A) fragmento válido extrai token_hash recovery e next", () => {
    const parsed = parseRecoveryFragment(
      `#token_hash=${VALID_HASH}&type=recovery&next=/atualizar-senha`
    )
    assert.equal(parsed.ok, true)
    if (parsed.ok) {
      assert.equal(parsed.tokenHash, VALID_HASH)
      assert.equal(parsed.type, "recovery")
      assert.equal(parsed.next, "/atualizar-senha")
    }
  })

  it("B) fragmento sem token falha", () => {
    assert.equal(parseRecoveryFragment("").ok, false)
    assert.equal(parseRecoveryFragment("#type=recovery").ok, false)
    assert.equal(parseRecoveryFragment("#token_hash=&type=recovery").ok, false)
  })

  it("C) type diferente de recovery é rejeitado", () => {
    assert.equal(
      parseRecoveryFragment(
        `#token_hash=${VALID_HASH}&type=email&next=/atualizar-senha`
      ).ok,
      false
    )
    assert.equal(
      parseRecoveryFragment(
        `#token_hash=${VALID_HASH}&type=magiclink&next=/atualizar-senha`
      ).ok,
      false
    )
  })

  it("D) next permitido é /atualizar-senha", () => {
    const parsed = parseRecoveryFragment(
      `#token_hash=${VALID_HASH}&type=recovery&next=/atualizar-senha`
    )
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.next, "/atualizar-senha")
  })

  it("D2) next ausente usa /atualizar-senha", () => {
    const parsed = parseRecoveryFragment(
      `#token_hash=${VALID_HASH}&type=recovery`
    )
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.next, "/atualizar-senha")
  })

  it("E) next externo é bloqueado e forçado à allowlist", () => {
    const parsed = parseRecoveryFragment(
      `#token_hash=${VALID_HASH}&type=recovery&next=https://evil.example`
    )
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.next, "/atualizar-senha")
    const slash = parseRecoveryFragment(
      `#token_hash=${VALID_HASH}&type=recovery&next=//evil.example`
    )
    assert.equal(slash.ok, true)
    if (slash.ok) assert.equal(slash.next, "/atualizar-senha")
    const js = parseRecoveryFragment(
      `#token_hash=${VALID_HASH}&type=recovery&next=javascript:alert(1)`
    )
    assert.equal(js.ok, true)
    if (js.ok) assert.equal(js.next, "/atualizar-senha")
  })

  it("token curto ou com path não é plausível", () => {
    assert.equal(isPlausibleRecoveryTokenHash("short"), false)
    assert.equal(isPlausibleRecoveryTokenHash("https://x/" + VALID_HASH), false)
    assert.equal(isPlausibleRecoveryTokenHash(VALID_HASH), true)
  })

  it("body POST válido e inválido", () => {
    assert.equal(
      parseRecoveryConfirmBody({
        token_hash: VALID_HASH,
        type: "recovery",
        next: "/atualizar-senha",
      }).ok,
      true
    )
    assert.equal(parseRecoveryConfirmBody(null).ok, false)
    assert.equal(parseRecoveryConfirmBody("x").ok, false)
    assert.equal(
      parseRecoveryConfirmBody({
        token_hash: VALID_HASH,
        type: "email",
      }).ok,
      false
    )
  })
})

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Session, User, UserIdentity } from "@supabase/supabase-js"
import {
  buildIndicatorSignupUserMetadata,
  buildSignupEmailRedirectTo,
  classifyIndicatorSignupResult,
  getIndicatorSignupMetadataKeys,
  isIndicatorPixKeyType,
  isSignupExistingAccountHint,
} from "./indicator-signup"

function mockIdentity(userId: string, id = "id-1"): UserIdentity {
  return { id, identity_id: id, user_id: userId, provider: "email" }
}

function mockUser(id: string, identities: User["identities"]): User {
  return {
    id,
    identities,
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "",
  } as User
}

function mockSession(userId: string): Session {
  return {
    access_token: "token",
    refresh_token: "refresh",
    expires_in: 3600,
    token_type: "bearer",
    user: mockUser(userId, [mockIdentity(userId)]),
  } as Session
}

describe("indicator signup helpers", () => {
  it("buildSignupEmailRedirectTo usa origin sem barra final", () => {
    assert.equal(
      buildSignupEmailRedirectTo("https://crm.tantotelecom.com.br"),
      "https://crm.tantotelecom.com.br/login"
    )
    assert.equal(
      buildSignupEmailRedirectTo("http://localhost:3000/"),
      "http://localhost:3000/login"
    )
  })

  it("metadata inclui full_name, phone e Pix sem profile_id", () => {
    const metadata = buildIndicatorSignupUserMetadata({
      fullName: "Maria Silva",
      phone: "11999999999",
      pixKeyType: "cpf",
      pixKeyValue: "12345678901",
    })
    assert.equal(metadata.full_name, "Maria Silva")
    assert.equal(metadata.phone, "11999999999")
    assert.equal(metadata.pix_key_type, "cpf")
    assert.equal(metadata.pix_key_value, "12345678901")
    const keys = getIndicatorSignupMetadataKeys(metadata)
    assert.ok(keys.includes("full_name"))
    assert.ok(keys.includes("pix_key_value"))
    assert.equal(keys.includes("profile_id"), false)
  })

  it("valida tipos Pix suportados", () => {
    assert.equal(isIndicatorPixKeyType("cpf"), true)
    assert.equal(isIndicatorPixKeyType("invalid"), false)
  })

  it("session null é sucesso aguardando confirmação", () => {
    const user = mockUser("user-new", [mockIdentity("user-new", "i1")])
    assert.equal(classifyIndicatorSignupResult(user, null), "awaiting_email_confirmation")
  })

  it("session com mesmo id permite fluxo autenticado", () => {
    const user = mockUser("user-1", [mockIdentity("user-1", "i1")])
    const session = mockSession("user-1")
    assert.equal(classifyIndicatorSignupResult(user, session), "authenticated_ready")
  })

  it("identities vazias indicam e-mail já cadastrado", () => {
    const user = mockUser("user-x", [])
    assert.equal(isSignupExistingAccountHint(user), true)
    assert.equal(classifyIndicatorSignupResult(user, null), "existing_account_hint")
  })

  it("ids divergentes indicam sessão inconsistente", () => {
    const user = mockUser("user-new", [mockIdentity("user-new", "i1")])
    const session = mockSession("user-old")
    assert.equal(classifyIndicatorSignupResult(user, session), "session_mismatch")
  })
})

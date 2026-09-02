import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Session, User, UserIdentity } from "@supabase/supabase-js"
import {
  buildIndicatorSignupUserMetadata,
  classifyIndicatorSignupResult,
} from "./indicator-signup"
import {
  INDICATOR_PIX_ALEATORIA_TEST_UUID,
} from "./pix-key-validation"
import {
  classifySignupPixMetadata,
  resolveSignupPixTriggerDecision,
} from "./signup-pix-metadata"

const VALID_CPF = "529.982.247-25"
const VALID_CNPJ = "11.222.333/0001-81"
const VALID_EMAIL = "indicador@example.com"
const VALID_PHONE = "(11) 98765-4321"
const VALID_ALEATORIA = INDICATOR_PIX_ALEATORIA_TEST_UUID
const NEW_USER = "user-new-1"
const OTHER_USER = "user-other-1"

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

describe("signup pix metadata (trigger policy)", () => {
  it("metadata Pix totalmente ausente → profile-only", () => {
    assert.equal(classifySignupPixMetadata(null, null), "absent")
    assert.equal(
      resolveSignupPixTriggerDecision({
        pixKeyType: null,
        pixKeyValue: null,
        newUserId: NEW_USER,
        existingPixKeys: [],
      }).action,
      "profile_only"
    )
  })

  it("apenas type → falha invalid_pix_metadata", () => {
    assert.equal(classifySignupPixMetadata("cpf", null), "partial")
    const decision = resolveSignupPixTriggerDecision({
      pixKeyType: "cpf",
      pixKeyValue: null,
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.deepEqual(decision, { action: "reject", reason: "invalid_pix_metadata" })
  })

  it("apenas value → falha invalid_pix_metadata", () => {
    assert.equal(classifySignupPixMetadata(null, VALID_CPF), "partial")
    const decision = resolveSignupPixTriggerDecision({
      pixKeyType: null,
      pixKeyValue: VALID_CPF,
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.deepEqual(decision, { action: "reject", reason: "invalid_pix_metadata" })
  })

  it("tipo desconhecido → falha", () => {
    const decision = resolveSignupPixTriggerDecision({
      pixKeyType: "bitcoin",
      pixKeyValue: "qualquer",
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.deepEqual(decision, { action: "reject", reason: "invalid_pix_key_type" })
  })

  it("CPF inválido → falha", () => {
    const decision = resolveSignupPixTriggerDecision({
      pixKeyType: "cpf",
      pixKeyValue: "111.111.111-11",
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.deepEqual(decision, { action: "reject", reason: "invalid_pix_key_value" })
  })

  it("CNPJ inválido → falha", () => {
    const decision = resolveSignupPixTriggerDecision({
      pixKeyType: "cnpj",
      pixKeyValue: "11.111.111/1111-11",
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.deepEqual(decision, { action: "reject", reason: "invalid_pix_key_value" })
  })

  it("email inválido → falha", () => {
    const decision = resolveSignupPixTriggerDecision({
      pixKeyType: "email",
      pixKeyValue: "invalido",
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.deepEqual(decision, { action: "reject", reason: "invalid_pix_key_value" })
  })

  it("telefone inválido → falha", () => {
    const decision = resolveSignupPixTriggerDecision({
      pixKeyType: "telefone",
      pixKeyValue: "123",
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.deepEqual(decision, { action: "reject", reason: "invalid_pix_key_value" })
  })

  it("aleatória inválida → falha", () => {
    const decision = resolveSignupPixTriggerDecision({
      pixKeyType: "aleatoria",
      pixKeyValue: "abc123def456",
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.deepEqual(decision, { action: "reject", reason: "invalid_pix_key_value" })
  })

  it("Pix válida por tipo → insert_pix com valor normalizado", () => {
    const cpf = resolveSignupPixTriggerDecision({
      pixKeyType: "cpf",
      pixKeyValue: VALID_CPF,
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.equal(cpf.action, "insert_pix")
    if (cpf.action === "insert_pix") {
      assert.equal(cpf.normalizedValue, "52998224725")
    }

    const cnpj = resolveSignupPixTriggerDecision({
      pixKeyType: "cnpj",
      pixKeyValue: VALID_CNPJ,
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.equal(cnpj.action, "insert_pix")

    const email = resolveSignupPixTriggerDecision({
      pixKeyType: "email",
      pixKeyValue: VALID_EMAIL,
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.equal(email.action, "insert_pix")
    if (email.action === "insert_pix") {
      assert.equal(email.normalizedValue, VALID_EMAIL)
    }

    const phone = resolveSignupPixTriggerDecision({
      pixKeyType: "telefone",
      pixKeyValue: VALID_PHONE,
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.equal(phone.action, "insert_pix")
    if (phone.action === "insert_pix") {
      assert.equal(phone.normalizedValue, "11987654321")
    }

    const aleatoria = resolveSignupPixTriggerDecision({
      pixKeyType: "aleatoria",
      pixKeyValue: VALID_ALEATORIA,
      newUserId: NEW_USER,
      existingPixKeys: [],
    })
    assert.equal(aleatoria.action, "insert_pix")
  })

  it("Pix duplicada de outro profile → falha e não transfere", () => {
    const decision = resolveSignupPixTriggerDecision({
      pixKeyType: "cpf",
      pixKeyValue: VALID_CPF,
      newUserId: NEW_USER,
      existingPixKeys: [{ profile_id: OTHER_USER, key_value: "52998224725", is_primary: true }],
    })
    assert.deepEqual(decision, { action: "reject", reason: "pix_key_already_registered" })
  })

  it("Pix primária já existente com valor diferente → falha sem substituir", () => {
    const decision = resolveSignupPixTriggerDecision({
      pixKeyType: "cpf",
      pixKeyValue: VALID_CPF,
      newUserId: NEW_USER,
      existingPixKeys: [{ profile_id: NEW_USER, key_value: "00000000000", is_primary: true }],
    })
    assert.deepEqual(decision, { action: "reject", reason: "pix_primary_already_exists" })
  })

  it("mesma chave no mesmo profile → skip idempotente", () => {
    const decision = resolveSignupPixTriggerDecision({
      pixKeyType: "cpf",
      pixKeyValue: VALID_CPF,
      newUserId: NEW_USER,
      existingPixKeys: [{ profile_id: NEW_USER, key_value: "52998224725", is_primary: true }],
    })
    assert.deepEqual(decision, { action: "skip_pix", reason: "same_profile_same_key" })
  })
})

describe("indicator signup UX (session)", () => {
  it("session=null continua sucesso aguardando confirmação", () => {
    const user = mockUser(NEW_USER, [mockIdentity(NEW_USER, "i1")])
    assert.equal(classifyIndicatorSignupResult(user, null), "awaiting_email_confirmation")
  })

  it("sessão residual (id divergente) continua detectada", () => {
    const user = mockUser(NEW_USER, [mockIdentity(NEW_USER, "i1")])
    const session = mockSession(OTHER_USER)
    assert.equal(classifyIndicatorSignupResult(user, session), "session_mismatch")
  })

  it("metadata de cadastro inclui Pix para o trigger", () => {
    const metadata = buildIndicatorSignupUserMetadata({
      fullName: "Maria",
      phone: "11999999999",
      pixKeyType: "cpf",
      pixKeyValue: VALID_CPF,
    })
    assert.ok(metadata.pix_key_type)
    assert.ok(metadata.pix_key_value)
  })
})

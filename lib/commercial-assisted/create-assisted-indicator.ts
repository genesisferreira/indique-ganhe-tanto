import { isValidCPF, isValidPhoneBR } from "@/lib/client/formatters"
import {
  INDICATOR_PIX_EMAIL_RE,
  validateIndicatorPixKeyForSignup,
} from "@/lib/auth/pix-key-validation"
import { isIndicatorPixKeyType } from "@/lib/auth/indicator-signup"
import {
  normalizeReferralDocument,
  normalizeReferralPhone,
} from "@/lib/referral-field-normalize"
import type { TipoChavePix } from "@/types/profile"
import {
  COMMERCIAL_ASSISTED_INDICATOR_AUDIT_EVENT,
} from "./constants"
import {
  normalizeAssistedIdempotencyKey,
  isUniqueViolationError,
} from "./idempotency"
import { maskCpfForDisplay, maskPhoneForDisplay } from "./mask"
import { authorizeCommercialIndicatorSearch } from "./search-auth"
import { generateAssistedTemporaryPassword } from "./temporary-password"

export type AssistedIndicatorClientPayload = {
  idempotencyKey?: unknown
  idempotency_key?: unknown
  fullName?: unknown
  full_name?: unknown
  cpf?: unknown
  phone?: unknown
  email?: unknown
  pixKeyType?: unknown
  pix_key_type?: unknown
  pixKeyValue?: unknown
  pix_key_value?: unknown
  // Privileged — ignored if sent by browser:
  role?: unknown
  is_active?: unknown
  must_change_password?: unknown
  email_confirm?: unknown
  profile_id?: unknown
}

export type AssistedIndicatorValidated = {
  idempotencyKey: string
  fullName: string
  cpf: string
  phone: string
  email: string
  pixKeyType: TipoChavePix
  pixKeyValue: string
}

export type AssistedIndicatorCreationRow = {
  id: string
  idempotency_key: string
  actor_profile_id: string | null
  indicator_profile_id: string | null
  auth_user_id: string | null
  status: "pending" | "created" | "failed"
}

export type AssistedIndicatorProfileRow = {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  cpf: string | null
  role: string
  is_active: boolean | null
  must_change_password: boolean | null
}

export type CreationUpdateResult =
  | { ok: true }
  | { ok: false; message: string }

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

export function validateAssistedIndicatorClientPayload(
  body: AssistedIndicatorClientPayload
):
  | { ok: true; data: AssistedIndicatorValidated }
  | { ok: false; message: string } {
  const idempotencyKey = normalizeAssistedIdempotencyKey(
    body.idempotencyKey ?? body.idempotency_key
  )
  if (!idempotencyKey) {
    return {
      ok: false,
      message: "Chave de idempotência inválida. Recarregue e tente novamente.",
    }
  }

  const fullName = asString(body.fullName ?? body.full_name).trim()
  if (fullName.length < 3) {
    return { ok: false, message: "Informe o nome completo do indicador." }
  }

  const cpf = normalizeReferralDocument(asString(body.cpf))
  if (!cpf || cpf.length !== 11 || !isValidCPF(cpf)) {
    return { ok: false, message: "Informe um CPF válido." }
  }

  const phone = normalizeReferralPhone(asString(body.phone))
  if (!phone || !isValidPhoneBR(phone)) {
    return { ok: false, message: "Informe um telefone válido com DDD." }
  }

  const email = asString(body.email).trim().toLowerCase()
  if (!email || !INDICATOR_PIX_EMAIL_RE.test(email)) {
    return { ok: false, message: "Informe um e-mail válido." }
  }

  const pixTypeRaw = asString(body.pixKeyType ?? body.pix_key_type).trim()
  const pixValueRaw = asString(body.pixKeyValue ?? body.pix_key_value)
  if (!isIndicatorPixKeyType(pixTypeRaw)) {
    return { ok: false, message: "Tipo de chave Pix inválido." }
  }
  const pix = validateIndicatorPixKeyForSignup(pixTypeRaw, pixValueRaw)
  if (!pix.ok) {
    return { ok: false, message: "Informe uma chave Pix válida." }
  }

  return {
    ok: true,
    data: {
      idempotencyKey,
      fullName,
      cpf,
      phone,
      email,
      pixKeyType: pix.keyType,
      pixKeyValue: pix.normalizedValue,
    },
  }
}

export function buildAssistedIndicatorAuthMetadata(
  data: AssistedIndicatorValidated
): {
  full_name: string
  phone: string
  pix_key_type: string
  pix_key_value: string
} {
  return {
    full_name: data.fullName,
    phone: data.phone,
    pix_key_type: data.pixKeyType,
    pix_key_value: data.pixKeyValue,
  }
}

export function buildAssistedIndicatorAuditMetadata(input: {
  actorProfileId: string
  indicatorProfileId: string
  idempotencyKey: string
}): Record<string, unknown> {
  return {
    event: COMMERCIAL_ASSISTED_INDICATOR_AUDIT_EVENT,
    actor_profile_id: input.actorProfileId,
    indicator_profile_id: input.indicatorProfileId,
    idempotency_key: input.idempotencyKey,
  }
}

export function assertNoSecretsInAuditMetadata(
  metadata: Record<string, unknown>,
  secrets: string[]
): boolean {
  const blob = JSON.stringify(metadata).toLowerCase()
  for (const secret of secrets) {
    const s = secret.trim().toLowerCase()
    if (s.length >= 4 && blob.includes(s)) return false
  }
  return true
}

export type CreateAssistedIndicatorDeps = {
  getUser: () => Promise<{ id: string } | null>
  getActorProfile: (userId: string) => Promise<{
    id: string
    role: string
    is_active: boolean | null
  } | null>
  findCreationByKey: (
    key: string
  ) => Promise<AssistedIndicatorCreationRow | null>
  insertCreationPending: (input: {
    idempotencyKey: string
    actorProfileId: string
  }) => Promise<
    | { id: string }
    | { error: string; uniqueViolation?: boolean }
  >
  /** Updates críticos devem retornar ok/erro — nunca silenciosos. */
  updateCreation: (input: {
    id: string
    status?: "pending" | "created" | "failed"
    indicatorProfileId?: string | null
    authUserId?: string | null
  }) => Promise<CreationUpdateResult>
  findProfileByEmail: (
    email: string
  ) => Promise<AssistedIndicatorProfileRow | null>
  findProfileByCpf: (cpf: string) => Promise<AssistedIndicatorProfileRow | null>
  findPixOwnerProfileId: (normalizedPix: string) => Promise<string | null>
  findProfileById: (
    id: string
  ) => Promise<AssistedIndicatorProfileRow | null>
  createAuthUser: (input: {
    email: string
    password: string
    metadata: ReturnType<typeof buildAssistedIndicatorAuthMetadata>
  }) => Promise<
    | { ok: true; userId: string }
    | { ok: false; code: "email_exists" | "create_failed"; message?: string }
  >
  /** Só pode receber o userId criado nesta operação (ou ownership auth_user_id). */
  deleteAuthUser: (userId: string) => Promise<{ ok: boolean }>
  updateProfileAfterCreate: (input: {
    profileId: string
    cpf: string
  }) => Promise<{ ok: true } | { ok: false; message: string }>
  insertAudit: (input: {
    actorProfileId: string
    entityId: string
    metadata: Record<string, unknown>
  }) => Promise<void>
  generateTemporaryPassword?: () => string
  waitForProfile?: (userId: string) => Promise<AssistedIndicatorProfileRow | null>
}

export type CreateAssistedIndicatorResult =
  | {
      ok: true
      replayed: false
      indicator: {
        id: string
        fullName: string
        email: string
        phoneMasked: string | null
        documentMasked: string | null
      }
      login: string
      temporaryPassword: string
      mustChangePassword: true
      passwordAlreadyIssued: false
    }
  | {
      ok: true
      replayed: true
      indicator: {
        id: string
        fullName: string
        email: string
        phoneMasked: string | null
        documentMasked: string | null
      }
      login: string
      temporaryPassword: null
      mustChangePassword: boolean
      passwordAlreadyIssued: true
    }
  | { ok: false; status: number; message: string }

function mapIndicatorPublic(profile: AssistedIndicatorProfileRow) {
  return {
    id: profile.id,
    fullName: profile.full_name?.trim() || "Indicador",
    email: profile.email,
    phoneMasked: maskPhoneForDisplay(profile.phone),
    documentMasked: maskCpfForDisplay(profile.cpf),
  }
}

async function resolveReplay(
  deps: CreateAssistedIndicatorDeps,
  creation: AssistedIndicatorCreationRow
): Promise<CreateAssistedIndicatorResult> {
  const profileId =
    creation.indicator_profile_id ?? creation.auth_user_id
  if (!profileId) {
    return {
      ok: false,
      status: 409,
      message:
        "Operação em andamento ou incompleta. Aguarde e tente novamente com a mesma chave.",
    }
  }
  const profile = await deps.findProfileById(profileId)
  if (!profile) {
    return {
      ok: false,
      status: 409,
      message:
        "Indicador já processado, mas o perfil não foi encontrado. Contate o suporte.",
    }
  }
  return {
    ok: true,
    replayed: true,
    indicator: mapIndicatorPublic(profile),
    login: profile.email,
    temporaryPassword: null,
    mustChangePassword: profile.must_change_password === true,
    passwordAlreadyIssued: true,
  }
}

/**
 * Recovery: pending + auth_user_id → reconcilia SEM createUser e SEM nova senha.
 */
export async function recoverPendingOwnedCreation(
  deps: CreateAssistedIndicatorDeps,
  creation: AssistedIndicatorCreationRow,
  data: AssistedIndicatorValidated,
  actorProfileId: string
): Promise<CreateAssistedIndicatorResult> {
  const ownedUserId = creation.auth_user_id
  if (!ownedUserId) {
    return {
      ok: false,
      status: 500,
      message: "Estado de ownership inválido.",
    }
  }

  const wait =
    deps.waitForProfile ??
    (async (id: string) => deps.findProfileById(id))
  let profile = await wait(ownedUserId)

  if (!profile) {
    await deps.deleteAuthUser(ownedUserId)
    await deps.updateCreation({ id: creation.id, status: "failed" })
    return {
      ok: false,
      status: 500,
      message:
        "Conta Auth desta operação sem perfil. Operação compensada. Inicie uma nova criação.",
    }
  }

  if (profile.role !== "indicador" || profile.is_active === false) {
    await deps.deleteAuthUser(ownedUserId)
    await deps.updateCreation({ id: creation.id, status: "failed" })
    return {
      ok: false,
      status: 500,
      message: "Perfil desta operação inválido. Operação compensada.",
    }
  }

  const updated = await deps.updateProfileAfterCreate({
    profileId: ownedUserId,
    cpf: data.cpf,
  })
  if (!updated.ok) {
    // Não apaga conta alheia: ownership é auth_user_id desta op.
    // CPF conflict: compensar somente o user desta operação.
    await deps.deleteAuthUser(ownedUserId)
    await deps.updateCreation({ id: creation.id, status: "failed" })
    return {
      ok: false,
      status: 500,
      message: updated.message || "Não foi possível finalizar o cadastro do CPF.",
    }
  }

  profile = (await deps.findProfileById(ownedUserId)) ?? profile

  const finalized = await deps.updateCreation({
    id: creation.id,
    status: "created",
    indicatorProfileId: ownedUserId,
    authUserId: ownedUserId,
  })
  if (!finalized.ok) {
    return {
      ok: false,
      status: 500,
      message:
        "Não foi possível confirmar a criação. Tente novamente com a mesma chave.",
    }
  }

  try {
    const auditMeta = buildAssistedIndicatorAuditMetadata({
      actorProfileId,
      indicatorProfileId: ownedUserId,
      idempotencyKey: data.idempotencyKey,
    })
    if (
      assertNoSecretsInAuditMetadata(auditMeta, [
        data.cpf,
        data.pixKeyValue,
        data.phone,
        data.email,
      ])
    ) {
      await deps.insertAudit({
        actorProfileId,
        entityId: ownedUserId,
        metadata: auditMeta,
      })
    }
  } catch {
    // best-effort
  }

  return {
    ok: true,
    replayed: true,
    indicator: mapIndicatorPublic({
      ...profile,
      cpf: data.cpf,
      must_change_password: true,
    }),
    login: profile.email || data.email,
    temporaryPassword: null,
    mustChangePassword: true,
    passwordAlreadyIssued: true,
  }
}

async function dispatchExistingCreation(
  deps: CreateAssistedIndicatorDeps,
  existingOp: AssistedIndicatorCreationRow,
  data: AssistedIndicatorValidated,
  actorProfileId: string
): Promise<CreateAssistedIndicatorResult | { continueWithId: string }> {
  if (existingOp.status === "created") {
    return resolveReplay(deps, existingOp)
  }

  if (existingOp.status === "failed") {
    return {
      ok: false,
      status: 409,
      message:
        "Esta tentativa de criação falhou. Inicie uma nova criação (nova chave).",
    }
  }

  // pending
  if (existingOp.auth_user_id) {
    return recoverPendingOwnedCreation(
      deps,
      existingOp,
      data,
      actorProfileId
    )
  }

  if (existingOp.indicator_profile_id) {
    return resolveReplay(deps, existingOp)
  }

  return { continueWithId: existingOp.id }
}

export async function createAssistedIndicator(
  deps: CreateAssistedIndicatorDeps,
  body: AssistedIndicatorClientPayload
): Promise<CreateAssistedIndicatorResult> {
  const user = await deps.getUser()
  if (!user) {
    return {
      ok: false,
      status: 401,
      message: "Sessão não encontrada. Faça login novamente.",
    }
  }

  const actor = await deps.getActorProfile(user.id)
  const auth = authorizeCommercialIndicatorSearch({
    userId: user.id,
    profile: actor,
  })
  if (!auth.ok) {
    return { ok: false, status: auth.status, message: auth.message }
  }

  const validated = validateAssistedIndicatorClientPayload(body)
  if (!validated.ok) {
    return { ok: false, status: 400, message: validated.message }
  }
  const data = validated.data

  const existingOp = await deps.findCreationByKey(data.idempotencyKey)
  if (existingOp) {
    const dispatched = await dispatchExistingCreation(
      deps,
      existingOp,
      data,
      auth.profileId
    )
    if (!("continueWithId" in dispatched)) {
      return dispatched
    }
  }

  // Ambíguo: pending sem ownership + e-mail já existe → NÃO adotar / NÃO deletar.
  const emailOwner = await deps.findProfileByEmail(data.email)
  if (emailOwner) {
    return {
      ok: false,
      status: 409,
      message:
        "Já existe um cadastro com este e-mail. Procure o indicador existente.",
    }
  }

  const cpfOwner = await deps.findProfileByCpf(data.cpf)
  if (cpfOwner) {
    return {
      ok: false,
      status: 409,
      message:
        "Já existe um cadastro com este CPF. Procure o indicador existente.",
    }
  }

  const pixOwner = await deps.findPixOwnerProfileId(data.pixKeyValue)
  if (pixOwner) {
    return {
      ok: false,
      status: 409,
      message:
        "Esta chave Pix já está cadastrada em outro indicador. Use outra chave ou localize o cadastro existente.",
    }
  }

  let creationId = existingOp?.id ?? null
  if (!creationId) {
    const inserted = await deps.insertCreationPending({
      idempotencyKey: data.idempotencyKey,
      actorProfileId: auth.profileId,
    })
    if ("error" in inserted) {
      if (
        inserted.uniqueViolation ||
        isUniqueViolationError({ message: inserted.error })
      ) {
        const raced = await deps.findCreationByKey(data.idempotencyKey)
        if (raced) {
          const dispatched = await dispatchExistingCreation(
            deps,
            raced,
            data,
            auth.profileId
          )
          if (!("continueWithId" in dispatched)) {
            return dispatched
          }
          creationId = dispatched.continueWithId
        }
      }
      if (!creationId) {
        return {
          ok: false,
          status: 500,
          message: "Não foi possível iniciar a criação. Tente novamente.",
        }
      }
    } else {
      creationId = inserted.id
    }
  }

  const temporaryPassword =
    deps.generateTemporaryPassword?.() ?? generateAssistedTemporaryPassword()
  const metadata = buildAssistedIndicatorAuthMetadata(data)

  const created = await deps.createAuthUser({
    email: data.email,
    password: temporaryPassword,
    metadata,
  })

  if (!created.ok) {
    await deps.updateCreation({ id: creationId, status: "failed" })
    if (created.code === "email_exists") {
      return {
        ok: false,
        status: 409,
        message:
          "Já existe um cadastro com este e-mail. Procure o indicador existente.",
      }
    }
    return {
      ok: false,
      status: 500,
      message: "Não foi possível criar o acesso do indicador. Tente novamente.",
    }
  }

  const createdUserId = created.userId

  // CRÍTICO: persistir ownership ANTES das etapas pós-create.
  const ownership = await deps.updateCreation({
    id: creationId,
    status: "pending",
    authUserId: createdUserId,
  })
  if (!ownership.ok) {
    await deps.deleteAuthUser(createdUserId)
    await deps.updateCreation({ id: creationId, status: "failed" })
    return {
      ok: false,
      status: 500,
      message:
        "Não foi possível registrar a criação. Operação compensada. Tente novamente.",
    }
  }

  const wait =
    deps.waitForProfile ??
    (async (id: string) => deps.findProfileById(id))
  let profile = await wait(createdUserId)

  if (!profile) {
    await deps.deleteAuthUser(createdUserId)
    await deps.updateCreation({ id: creationId, status: "failed" })
    return {
      ok: false,
      status: 500,
      message:
        "Conta Auth criada sem perfil. Operação compensada. Tente novamente.",
    }
  }

  if (profile.role !== "indicador" || profile.is_active === false) {
    await deps.deleteAuthUser(createdUserId)
    await deps.updateCreation({ id: creationId, status: "failed" })
    return {
      ok: false,
      status: 500,
      message: "Perfil criado com estado inválido. Operação compensada.",
    }
  }

  const updated = await deps.updateProfileAfterCreate({
    profileId: createdUserId,
    cpf: data.cpf,
  })
  if (!updated.ok) {
    await deps.deleteAuthUser(createdUserId)
    await deps.updateCreation({ id: creationId, status: "failed" })
    return {
      ok: false,
      status: 500,
      message: updated.message || "Não foi possível finalizar o cadastro do CPF.",
    }
  }

  profile = (await deps.findProfileById(createdUserId)) ?? profile

  const finalized = await deps.updateCreation({
    id: creationId,
    status: "created",
    indicatorProfileId: createdUserId,
    authUserId: createdUserId,
  })
  if (!finalized.ok) {
    // Conta existe e ownership está gravado — NÃO falso sucesso.
    // Retry com a mesma key reconcilia via auth_user_id (sem senha).
    return {
      ok: false,
      status: 500,
      message:
        "Conta criada, mas a confirmação falhou. Tente novamente com a mesma chave.",
    }
  }

  const auditMeta = buildAssistedIndicatorAuditMetadata({
    actorProfileId: auth.profileId,
    indicatorProfileId: createdUserId,
    idempotencyKey: data.idempotencyKey,
  })
  if (
    assertNoSecretsInAuditMetadata(auditMeta, [
      temporaryPassword,
      data.cpf,
      data.pixKeyValue,
      data.phone,
      data.email,
    ])
  ) {
    try {
      await deps.insertAudit({
        actorProfileId: auth.profileId,
        entityId: createdUserId,
        metadata: auditMeta,
      })
    } catch {
      // best-effort
    }
  }

  return {
    ok: true,
    replayed: false,
    indicator: mapIndicatorPublic({
      ...profile,
      cpf: data.cpf,
      must_change_password: true,
    }),
    login: data.email,
    temporaryPassword,
    mustChangePassword: true,
    passwordAlreadyIssued: false,
  }
}

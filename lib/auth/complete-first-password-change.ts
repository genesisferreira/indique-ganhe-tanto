export type FirstPasswordChangeProfile = {
  id: string
  must_change_password: boolean | null
}

export type CompleteFirstPasswordChangeDeps = {
  getUser: () => Promise<{ id: string } | null>
  /** Criado somente após autenticação bem-sucedida. */
  getPrivilegedDb: () => {
    findProfileById: (
      id: string
    ) => Promise<{
      data: FirstPasswordChangeProfile | null
      error: { code?: string; message?: string } | null
    }>
    clearMustChangePassword: (
      id: string
    ) => Promise<{
      data: FirstPasswordChangeProfile | null
      error: { code?: string; message?: string } | null
    }>
  }
  logError?: (input: {
    stage: string
    operation: string
    error: { code?: string; message?: string } | null | undefined
    userIdPrefix?: string
  }) => void
}

export type CompleteFirstPasswordChangeResult =
  | {
      ok: true
      status: 200
      alreadyCleared: boolean
      message: string
    }
  | {
      ok: false
      status: 401 | 404 | 500
      message: string
    }

function userIdPrefix(id: string): string {
  return id.length >= 8 ? id.slice(0, 8) : id
}

/**
 * Limpa must_change_password somente para o auth user autenticado pela sessão.
 * Não recebe senha; não altera Auth. Não aceita userId do body.
 */
export async function completeFirstPasswordChange(
  deps: CompleteFirstPasswordChangeDeps
): Promise<CompleteFirstPasswordChangeResult> {
  const user = await deps.getUser()
  if (!user) {
    return {
      ok: false,
      status: 401,
      message: "Sessão não encontrada. Faça login novamente.",
    }
  }

  const authenticatedUserId = user.id
  const log = deps.logError
  const db = deps.getPrivilegedDb()

  const { data: profile, error: profileError } = await db.findProfileById(
    authenticatedUserId
  )

  if (profileError || !profile) {
    log?.({
      stage: "profile_lookup",
      operation: "select",
      error: profileError ?? { message: "profile_not_found" },
      userIdPrefix: userIdPrefix(authenticatedUserId),
    })
    return {
      ok: false,
      status: 404,
      message: "Perfil não encontrado.",
    }
  }

  if (profile.id !== authenticatedUserId) {
    log?.({
      stage: "profile_lookup",
      operation: "identity_mismatch",
      error: { message: "profile_id_mismatch" },
      userIdPrefix: userIdPrefix(authenticatedUserId),
    })
    return {
      ok: false,
      status: 500,
      message: "Não foi possível concluir a troca de senha.",
    }
  }

  if (profile.must_change_password !== true) {
    return {
      ok: true,
      status: 200,
      alreadyCleared: true,
      message: "Nenhuma troca obrigatória pendente.",
    }
  }

  const { data: updated, error: updateError } = await db.clearMustChangePassword(
    authenticatedUserId
  )

  if (updateError || !updated) {
    log?.({
      stage: "clear_must_change_password",
      operation: "update",
      error: updateError ?? { message: "update_failed_no_row" },
      userIdPrefix: userIdPrefix(authenticatedUserId),
    })
    return {
      ok: false,
      status: 500,
      message: "Não foi possível concluir a troca de senha.",
    }
  }

  if (
    updated.id !== authenticatedUserId ||
    updated.must_change_password !== false
  ) {
    log?.({
      stage: "confirm_flag_cleared",
      operation: "verify",
      error: { message: "flag_not_cleared" },
      userIdPrefix: userIdPrefix(authenticatedUserId),
    })
    return {
      ok: false,
      status: 500,
      message: "Não foi possível confirmar a limpeza da flag.",
    }
  }

  return {
    ok: true,
    status: 200,
    alreadyCleared: false,
    message: "Senha atualizada. Acesso liberado.",
  }
}

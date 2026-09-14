type CreateUserError = { message?: string; code?: string } | null

type CreateUserResult = {
  data: { user: { id: string } | null } | null
  error: CreateUserError
}

export type PrivilegedAuthAdminClient = {
  auth: {
    admin: {
      createUser: (attrs: {
        email: string
        password: string
        email_confirm: boolean
        user_metadata: Record<string, unknown>
      }) => Promise<CreateUserResult>
    }
  }
}

export type CreateConfirmedAuthUserInput = {
  email: string
  password: string
  userMetadata: Record<string, unknown>
}

export type CreateConfirmedAuthUserResult =
  | { ok: true; userId: string }
  | { ok: false; code: "email_exists" | "create_failed"; message?: string }

function isEmailExistsMessage(message: string): boolean {
  const msg = message.toLowerCase()
  return (
    msg.includes("already") ||
    msg.includes("registered") ||
    msg.includes("exists")
  )
}

/**
 * Contrato compartilhado do onboarding assistido (Indicador e Funcionário):
 * admin.createUser com senha provisória + e-mail já confirmado.
 */
export async function createConfirmedAuthUserWithPassword(
  client: PrivilegedAuthAdminClient,
  input: CreateConfirmedAuthUserInput
): Promise<CreateConfirmedAuthUserResult> {
  const { data, error } = await client.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: input.userMetadata,
  })
  if (error || !data?.user?.id) {
    if (isEmailExistsMessage(error?.message ?? "")) {
      return { ok: false, code: "email_exists", message: error?.message }
    }
    return { ok: false, code: "create_failed", message: error?.message }
  }
  return { ok: true, userId: data.user.id }
}

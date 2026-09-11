/**
 * Lifecycle de conta Auth (desligamento).
 * Nunca deleta auth.users. Chamar somente em rotas/serviços server-side.
 */

export const AUTH_DISABLE_BAN_DURATION = "876000h"

export type AuthLoginDisableResult = {
  ok: boolean
  deleted: false
  banned: boolean
  sessionsRevoked: boolean
  limitation: string | null
}

type PrivilegedAuthAdmin = {
  auth: {
    admin: {
      updateUserById: (
        id: string,
        attrs: { ban_duration?: string }
      ) => Promise<{ error: { message?: string } | null }>
      signOut?: (
        id: string,
        scope?: "global" | "local" | "others"
      ) => Promise<{ error: { message?: string } | null }>
    }
  }
}

export async function disableAuthUserLogin(
  admin: PrivilegedAuthAdmin,
  userId: string
): Promise<AuthLoginDisableResult> {
  const id = userId.trim()
  if (!id) {
    return {
      ok: false,
      deleted: false,
      banned: false,
      sessionsRevoked: false,
      limitation: "userId ausente",
    }
  }

  const { error: banError } = await admin.auth.admin.updateUserById(id, {
    ban_duration: AUTH_DISABLE_BAN_DURATION,
  })

  let sessionsRevoked = false
  if (typeof admin.auth.admin.signOut === "function") {
    const { error: signOutError } = await admin.auth.admin.signOut(id, "global")
    sessionsRevoked = !signOutError
  }

  const banned = !banError
  return {
    ok: banned,
    deleted: false,
    banned,
    sessionsRevoked,
    limitation: banned
      ? sessionsRevoked
        ? null
        : "JWT já emitido pode valer até expirar se signOut global não estiver disponível."
      : banError?.message ?? "ban_duration não aplicado",
  }
}

export async function enableAuthUserLogin(
  admin: PrivilegedAuthAdmin,
  userId: string
): Promise<{ ok: boolean }> {
  const id = userId.trim()
  if (!id) return { ok: false }
  const { error } = await admin.auth.admin.updateUserById(id, {
    ban_duration: "none",
  })
  return { ok: !error }
}

export function shouldInactivateProfileOnEmployeeStatus(status: string): boolean {
  return status === "dismissed"
}

import {
  buildPasswordRecoveryFailurePath,
  sanitizePasswordRecoveryNextPath,
} from "@/lib/auth/password-reset"

export type PasswordRecoveryCallbackResult = {
  path: string
  ok: boolean
}

export async function resolvePasswordRecoveryCallback(input: {
  code: string | null
  nextRaw: string | null
  exchangeCodeForSession: (
    code: string
  ) => Promise<{ error: { message?: string } | null }>
}): Promise<PasswordRecoveryCallbackResult> {
  const next = sanitizePasswordRecoveryNextPath(input.nextRaw)
  const failure = buildPasswordRecoveryFailurePath()
  const code = input.code?.trim() ?? ""
  if (!code) {
    return { path: failure, ok: false }
  }

  const { error } = await input.exchangeCodeForSession(code)
  if (error) {
    return { path: failure, ok: false }
  }
  return { path: next, ok: true }
}

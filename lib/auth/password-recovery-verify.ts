import {
  buildPasswordRecoveryFailurePath,
  PASSWORD_UPDATE_PATH,
} from "@/lib/auth/password-reset"
import type { ParsedRecoveryTokenResult } from "@/lib/auth/recovery-token-fragment"

export type PasswordRecoveryVerifyResult = {
  ok: boolean
  path: string
}

export async function resolvePasswordRecoveryVerifyOtp(input: {
  parsed: ParsedRecoveryTokenResult
  verifyOtp: (args: {
    token_hash: string
    type: "recovery"
  }) => Promise<{ error: { message?: string } | null }>
}): Promise<PasswordRecoveryVerifyResult> {
  const failure = buildPasswordRecoveryFailurePath()
  if (!input.parsed.ok) {
    return { ok: false, path: failure }
  }

  const { error } = await input.verifyOtp({
    token_hash: input.parsed.tokenHash,
    type: "recovery",
  })
  if (error) {
    return { ok: false, path: failure }
  }
  return { ok: true, path: PASSWORD_UPDATE_PATH }
}

import { NextResponse } from "next/server"
import {
  attachAuthCookiesToResponse,
  type AuthCookieToSet,
} from "@/lib/auth/auth-route-cookies"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { resolvePasswordRecoveryVerifyOtp } from "@/lib/auth/password-recovery-verify"
import { parseRecoveryConfirmBody } from "@/lib/auth/recovery-token-fragment"

export type RecoveryConfirmJsonBody = {
  ok: boolean
}

function jsonRecoveryConfirm(
  ok: boolean,
  status: number,
  cookiesToSet: AuthCookieToSet[] = []
): NextResponse {
  const response = applyNoStoreHeaders(
    NextResponse.json({ ok } satisfies RecoveryConfirmJsonBody, { status })
  )
  if (ok) {
    attachAuthCookiesToResponse(response, cookiesToSet)
  }
  return response
}

export async function executeRecoveryConfirm(input: {
  body: unknown
  cookiesToSet: AuthCookieToSet[]
  verifyOtp: (args: {
    token_hash: string
    type: "recovery"
  }) => Promise<{ error: { message?: string } | null }>
}): Promise<NextResponse> {
  const parsed = parseRecoveryConfirmBody(input.body)
  if (!parsed.ok) {
    return jsonRecoveryConfirm(false, 400)
  }

  const result = await resolvePasswordRecoveryVerifyOtp({
    parsed,
    verifyOtp: input.verifyOtp,
  })

  if (!result.ok) {
    return jsonRecoveryConfirm(false, 200)
  }

  return jsonRecoveryConfirm(true, 200, input.cookiesToSet)
}

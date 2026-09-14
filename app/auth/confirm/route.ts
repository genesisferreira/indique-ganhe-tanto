import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"
import {
  attachAuthCookiesToResponse,
  collectAuthCookiesFromSetAll,
  type AuthCookieToSet,
} from "@/lib/auth/auth-route-cookies"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { resolvePasswordRecoveryVerifyOtp } from "@/lib/auth/password-recovery-verify"
import { parseRecoveryConfirmBody } from "@/lib/auth/recovery-token-fragment"
import { applyDevSupabaseTlsWorkaround } from "@/lib/supabase/dev-tls"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function redirectTo(request: NextRequest, path: string) {
  return applyNoStoreHeaders(
    NextResponse.redirect(new URL(path, request.url), 303)
  )
}

export async function POST(request: NextRequest) {
  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const parsed = parseRecoveryConfirmBody(body)
  const cookiesToSet: AuthCookieToSet[] = []

  const result = await resolvePasswordRecoveryVerifyOtp({
    parsed,
    verifyOtp: async ({ token_hash }) => {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ""
      if (!supabaseUrl || !anonKey) {
        return { error: { message: "unavailable" } }
      }

      applyDevSupabaseTlsWorkaround()
      const supabase = createServerClient(supabaseUrl, anonKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(incoming) {
            incoming.forEach(({ name, value }) => {
              request.cookies.set(name, value)
            })
            collectAuthCookiesFromSetAll(
              cookiesToSet,
              incoming as AuthCookieToSet[]
            )
          },
        },
      })

      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type: "recovery",
      })
      return { error: error ? { message: "verify_failed" } : null }
    },
  })

  const response = redirectTo(request, result.path)
  if (result.ok) {
    attachAuthCookiesToResponse(response, cookiesToSet)
  }
  return response
}

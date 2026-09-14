import { createServerClient } from "@supabase/ssr"
import { type NextRequest } from "next/server"
import {
  collectAuthCookiesFromSetAll,
  type AuthCookieToSet,
} from "@/lib/auth/auth-route-cookies"
import { executeRecoveryConfirm } from "@/lib/auth/password-recovery-confirm"
import { applyDevSupabaseTlsWorkaround } from "@/lib/supabase/dev-tls"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    body = null
  }

  const cookiesToSet: AuthCookieToSet[] = []

  return executeRecoveryConfirm({
    body,
    cookiesToSet,
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
          setAll(incoming, _headers) {
            incoming.forEach(({ name, value }) => {
              request.cookies.set(name, value)
            })
            collectAuthCookiesFromSetAll(cookiesToSet, incoming)
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
}

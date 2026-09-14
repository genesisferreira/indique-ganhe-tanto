import { NextResponse } from "next/server"
import { resolvePasswordRecoveryCallback } from "@/lib/auth/password-recovery-callback"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const result = await resolvePasswordRecoveryCallback({
    code: searchParams.get("code"),
    nextRaw: searchParams.get("next"),
    exchangeCodeForSession: async (code) => {
      const supabase = await createClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      return { error: error ? { message: "exchange_failed" } : null }
    },
  })

  return NextResponse.redirect(`${origin}${result.path}`)
}

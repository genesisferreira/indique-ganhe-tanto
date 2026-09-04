import { NextResponse } from "next/server"
import { completeFirstPasswordChange } from "@/lib/auth/complete-first-password-change"
import { logFirstPasswordChangeDbError } from "@/lib/auth/password-change-db-log"
import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Limpa must_change_password somente para o auth.uid() da sessão.
 * Deve ser chamado DEPOIS de supabase.auth.updateUser({ password }) com sucesso.
 *
 * Auth: createClient() + getUser() (sessão real).
 * Privilegiado: createServiceRoleClient() sem cookies, só após autenticação,
 * sempre bound a user.id da sessão.
 */
export async function POST() {
  // A) Sessão — NUNCA service role para identidade.
  const supabase = await createClient()

  // B) Privilegiado — lazy, só após getUser OK.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let privileged: any = null
  function getPrivileged() {
    if (!privileged) {
      privileged = createServiceRoleClient()
    }
    return privileged
  }

  const result = await completeFirstPasswordChange({
    getUser: async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()
      if (error || !user) return null
      return { id: user.id }
    },
    getPrivilegedDb: () => {
      const db = getPrivileged()
      return {
        findProfileById: async (id: string) => {
          const { data, error } = await db
            .from("profiles")
            .select("id, must_change_password")
            .eq("id", id)
            .maybeSingle()
          const row = data as {
            id?: string
            must_change_password?: boolean | null
          } | null
          return {
            data: row?.id
              ? {
                  id: String(row.id),
                  must_change_password: row.must_change_password ?? null,
                }
              : null,
            error: error
              ? {
                  message: error.message,
                  code: (error as { code?: string }).code,
                }
              : null,
          }
        },
        clearMustChangePassword: async (id: string) => {
          const { data, error } = await db
            .from("profiles")
            .update({ must_change_password: false })
            .eq("id", id)
            .eq("must_change_password", true)
            .select("id, must_change_password")
            .maybeSingle()
          const row = data as {
            id?: string
            must_change_password?: boolean | null
          } | null
          return {
            data: row?.id
              ? {
                  id: String(row.id),
                  must_change_password: row.must_change_password ?? null,
                }
              : null,
            error: error
              ? {
                  message: error.message,
                  code: (error as { code?: string }).code,
                }
              : null,
          }
        },
      }
    },
    logError: logFirstPasswordChangeDbError,
  })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.message },
      { status: result.status }
    )
  }

  return NextResponse.json({
    ok: true,
    alreadyCleared: result.alreadyCleared,
    message: result.message,
  })
}

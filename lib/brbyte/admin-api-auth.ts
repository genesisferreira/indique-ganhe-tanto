import "server-only"

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { createClient, createClientFromRequest } from "@/lib/supabase/server"
import type { UserRole } from "@/types/user"

export const BRBYTE_ADMIN_MUTATION_ROLES = new Set<UserRole>([
  "admin_master",
  "admin_financeiro",
])

export const BRBYTE_ADMIN_READ_ROLES = new Set<UserRole>([
  "admin_master",
  "admin_financeiro",
  "admin_consulta",
])

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

function isSupabaseNetworkError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    return true
  }
  if (typeof error === "object" && error !== null) {
    const message =
      "message" in error ? String((error as { message?: unknown }).message) : ""
    if (/fetch failed|unable to verify|UNABLE_TO_VERIFY|ETIMEDOUT|ECONNREFUSED/i.test(message)) {
      return true
    }
    const cause =
      "cause" in error ? (error as { cause?: unknown }).cause : undefined
    if (cause instanceof Error) {
      return /fetch failed|unable to verify|UNABLE_TO_VERIFY/i.test(cause.message)
    }
  }
  return false
}

async function resolveAuthenticatedUser(
  supabase: SupabaseClient
): Promise<{ user: User | null; authError: unknown }> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (user && !authError) {
    return { user, authError: null }
  }

  if (isDev() && (authError ? isSupabaseNetworkError(authError) : !user)) {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (session?.user) {
      if (authError && isSupabaseNetworkError(authError)) {
        console.warn(
          "[brbyte-admin-auth:dev] getUser falhou (rede/TLS); usando sessão dos cookies"
        )
      }
      return { user: session.user, authError: sessionError }
    }
  }

  return { user: null, authError: authError ?? null }
}

export async function getAuthorizedBrbyteAdmin(options?: {
  requireMutation?: boolean
  request?: NextRequest
}): Promise<
  { userId: string; role: UserRole } | { error: NextResponse }
> {
  const supabase = options?.request
    ? createClientFromRequest(options.request)
    : await createClient()

  const { user, authError } = await resolveAuthenticatedUser(supabase)

  if (authError || !user) {
    if (isDev()) {
      console.warn("[brbyte-admin-auth] unauthorized", {
        hasUser: Boolean(user),
        authError:
          authError instanceof Error
            ? authError.message
            : authError
              ? String(authError)
              : null,
        cookieCount: options?.request?.cookies.getAll().length ?? null,
      })
    }
    return {
      error: NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      ),
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  const role = ((profile as { role?: string } | null)?.role ??
    null) as UserRole | null

  const allowed = options?.requireMutation
    ? role && BRBYTE_ADMIN_MUTATION_ROLES.has(role)
    : role && BRBYTE_ADMIN_READ_ROLES.has(role)

  if (profileError || !allowed || !role) {
    if (isDev()) {
      console.warn("[brbyte-admin-auth] forbidden", {
        userId: user.id,
        role,
        profileError: profileError?.message ?? null,
        requireMutation: Boolean(options?.requireMutation),
      })
    }
    return {
      error: NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      ),
    }
  }

  return { userId: user.id, role }
}

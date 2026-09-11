import "server-only"

import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import {
  authorizeEmployeeAdminAccess,
  type EmployeeAdminAction,
} from "@/lib/employees/admin-policy"
import type { UserRole } from "@/types/user"

export async function authorizeEmployeeAdminRequest(action: EmployeeAdminAction) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) {
    return {
      ok: false as const,
      status: 401 as const,
      message: "Sessão não encontrada. Faça login novamente.",
    }
  }

  const db = createServiceRoleClient() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{
            data: { id?: string; role?: string; is_active?: boolean } | null
          }>
        }
      }
    }
  }
  const { data: profile } = await db
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.id) {
    return { ok: false as const, status: 403 as const, message: "Perfil não autorizado." }
  }
  if (profile.is_active === false) {
    return { ok: false as const, status: 403 as const, message: "Perfil inativo." }
  }

  const auth = authorizeEmployeeAdminAccess({
    userId: user.id,
    profileId: String(profile.id),
    role: profile.role as UserRole,
    action,
  })
  if (!auth.ok) return auth
  return auth
}

import "server-only"

import { createClient } from "@/lib/supabase/server"
import { canAccessAdminRemuneracao } from "@/lib/admin-remuneracao/policy"
import type { UserRole } from "@/types/user"

export type AdminRemuneracaoAuth =
  | { ok: true; role: UserRole }
  | { ok: false; status: 401 | 403 }

/**
 * Guard server-side de /admin/remuneracao/* e /api/admin/remuneracao/*.
 * Usa a sessão do usuário (RLS de profiles permite ler o próprio perfil);
 * não usa service role. Não confia em menu/cliente.
 */
export async function authorizeAdminRemuneracao(): Promise<AdminRemuneracaoAuth> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return { ok: false, status: 401 }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle()
  const row = profile as { role?: string | null; is_active?: boolean | null } | null
  if (!row?.role || row.is_active === false) return { ok: false, status: 403 }
  if (!canAccessAdminRemuneracao(row.role)) return { ok: false, status: 403 }
  return { ok: true, role: row.role as UserRole }
}

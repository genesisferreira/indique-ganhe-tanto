/**
 * 3.1F-K1 — Carregamento lógico de /admin/indicacoes.
 *
 * Antes (b905589): cada carregamento chamava auth.getUser() 3× (indicações, comerciais, perfil)
 * e relia `profiles` 3×; cada evento realtime repetia tudo. Agora a identidade é resolvida
 * UMA vez (getAuthProfileBasicsFromSupabase → auth.getUser(), validado no servidor Auth) e
 * repassada às consultas do mesmo carregamento. Sem getSession, sem cache global, sem localStorage.
 * RLS continua sendo a fronteira de autorização.
 */
import {
  dataOutcome,
  errorOutcome,
  type LoadOutcome,
  type LoaderErrorClass,
} from "@/lib/client/guarded-loader"
import {
  ADMIN_PORTAL_READ_ROLES,
  getAuthProfileBasicsFromSupabase,
  loadAdminComerciaisResultFromSupabase,
  loadAdminReferralsFromSupabase,
  type AdminLoadIdentity,
} from "@/lib/services/supabase-data.service"
import type { Comercial, Indicacao } from "@/types"
import type { UserRole } from "@/types/user"

export type AdminIndicacoesBundle = {
  lista: Indicacao[]
  comerciais: Comercial[]
  /** false => lista de comerciais indisponível (não confundir com "nenhum comercial"). */
  comerciaisDisponiveis: boolean
  role: UserRole
}

export type AdminIndicacoesDeps = {
  getBasics: typeof getAuthProfileBasicsFromSupabase
  loadReferrals: typeof loadAdminReferralsFromSupabase
  loadComerciais: typeof loadAdminComerciaisResultFromSupabase
}

const defaultDeps: AdminIndicacoesDeps = {
  getBasics: getAuthProfileBasicsFromSupabase,
  loadReferrals: loadAdminReferralsFromSupabase,
  loadComerciais: loadAdminComerciaisResultFromSupabase,
}

function mapReferralErrorClass(errorClass: string | undefined): LoaderErrorClass {
  if (errorClass === "unauthenticated") return "unauthenticated"
  if (errorClass === "forbidden") return "forbidden"
  if (errorClass === "query_failed") return "server_error"
  return "unexpected"
}

export async function loadAdminIndicacoesBundle(
  signal?: AbortSignal,
  deps: AdminIndicacoesDeps = defaultDeps
): Promise<LoadOutcome<AdminIndicacoesBundle>> {
  const basics = await deps.getBasics()
  if (!basics) return errorOutcome("unauthenticated")
  if (basics.isActive === false || !ADMIN_PORTAL_READ_ROLES.has(basics.role)) return errorOutcome("forbidden")
  if (signal?.aborted) return errorOutcome("unexpected")

  const identity: AdminLoadIdentity = { userId: basics.id, role: basics.role }
  const [referrals, comerciais] = await Promise.all([
    deps.loadReferrals({ identity }),
    deps.loadComerciais({ identity, signal }),
  ])

  if (!referrals.ok) return errorOutcome(mapReferralErrorClass(referrals.errorClass))
  if (!Array.isArray(referrals.data)) return errorOutcome("invalid_response")

  const bundle: AdminIndicacoesBundle = {
    lista: [...referrals.data],
    comerciais: comerciais.ok ? [...comerciais.data] : [],
    comerciaisDisponiveis: comerciais.ok,
    role: basics.role,
  }
  return dataOutcome(bundle, bundle.lista.length === 0)
}

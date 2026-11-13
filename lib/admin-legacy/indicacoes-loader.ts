/**
 * 3.1F-K1 — Carregamento lógico de /admin/indicacoes.
 *
 * Antes (b905589): cada carregamento chamava auth.getUser() 3× (indicações, comerciais, perfil)
 * e relia `profiles` 3×; cada evento realtime repetia tudo. Agora a identidade é resolvida
 * UMA vez (getAuthProfileBasicsFromSupabase → auth.getUser(), validado no servidor Auth) e
 * repassada às consultas do mesmo carregamento. Sem getSession, sem cache global, sem localStorage.
 * RLS continua sendo a fronteira de autorização.
 *
 * 3.1F-K1B: o MESMO `signal` do carregamento chega a todas as consultas REST (perfil, indicações,
 * planos, perfis relacionados, comerciais, disponibilidade, estatísticas). `auth.getUser()` não aceita
 * signal (auth-js); após um abort nada mais é consultado e o resultado é descartado pelo loader.
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

/**
 * 3.1F-K1S: a lista de comerciais (somente para o menu "Atribuir Comercial") é OPCIONAL e nunca bloqueia a
 * lista principal: falha => `comerciaisDisponiveis=false`; se ainda não terminou `OPTIONAL_COMERCIAIS_GRACE_MS`
 * após as indicações chegarem, a página é entregue sem ela (mesmo signal do carregamento: timeout/desmontagem
 * continuam cancelando tudo; no servidor, o `request.signal`).
 */
export const OPTIONAL_COMERCIAIS_GRACE_MS = 3_000

type BundleTimers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void }
const realTimers: BundleTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

type ComerciaisResult = Awaited<ReturnType<AdminIndicacoesDeps["loadComerciais"]>>

function settleWithin<T>(promise: Promise<T>, ms: number, timers: BundleTimers): Promise<T | null> {
  return new Promise((resolve) => {
    const handle = timers.set(() => resolve(null), ms)
    void promise.then((value) => {
      timers.clear(handle)
      resolve(value)
    })
  })
}

export async function loadAdminIndicacoesBundle(
  signal?: AbortSignal,
  deps: AdminIndicacoesDeps = defaultDeps,
  options: { optionalGraceMs?: number; timers?: BundleTimers } = {}
): Promise<LoadOutcome<AdminIndicacoesBundle>> {
  const basics = await deps.getBasics({ signal })
  // Cancelado: o controlador decide (timeout => estado timeout; desmontagem/retry => descartado).
  if (signal?.aborted) return errorOutcome("unexpected")
  if (!basics) return errorOutcome("unauthenticated")
  if (basics.isActive === false || !ADMIN_PORTAL_READ_ROLES.has(basics.role)) return errorOutcome("forbidden")

  const identity: AdminLoadIdentity = { userId: basics.id, role: basics.role }
  const referralsPromise = deps.loadReferrals({ identity, signal })
  const comerciaisPromise: Promise<ComerciaisResult> = deps.loadComerciais({ identity, signal }).catch((): ComerciaisResult => ({ ok: false, errorClass: "unexpected" }))
  const referrals = await referralsPromise
  if (signal?.aborted) return errorOutcome("unexpected")

  if (!referrals.ok) return errorOutcome(mapReferralErrorClass(referrals.errorClass))
  if (!Array.isArray(referrals.data)) return errorOutcome("invalid_response")

  const comerciais = await settleWithin(
    comerciaisPromise,
    options.optionalGraceMs ?? OPTIONAL_COMERCIAIS_GRACE_MS,
    options.timers ?? realTimers
  )
  if (signal?.aborted) return errorOutcome("unexpected")

  const bundle: AdminIndicacoesBundle = {
    lista: [...referrals.data],
    comerciais: comerciais?.ok ? [...comerciais.data] : [],
    comerciaisDisponiveis: comerciais?.ok === true,
    role: basics.role,
  }
  return dataOutcome(bundle, bundle.lista.length === 0)
}

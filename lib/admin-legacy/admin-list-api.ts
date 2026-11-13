import "server-only"

/**
 * 3.1F-K1S — leituras de /admin/comerciais e /admin/indicacoes no SERVIDOR.
 *
 * Causa raiz (provada no lab, ver docs/k1-legacy-loaders.md §K1S): no navegador, toda chamada do
 * supabase-js (auth.getUser e o getSession interno de cada consulta REST) passa pelo lock de auth
 * (navigator.locks, `lock:<storageKey>`, acquireTimeout 5 s). O app shell (K2) dispara ~24–36 getUser
 * concorrentes, cada um segurando o lock por um RTT do Auth; acima de 5 s um pedido "rouba" o lock e o
 * detentor recebe NavigatorLockAcquireTimeoutError. A consulta da página era a vítima: comerciais
 * terminava em erro sem disparar a lista; indicações em erro/timeout.
 *
 * Correção mínima: as páginas buscam via rota de API (como /admin/funcionarios, que funciona em
 * produção). Aqui os MESMOS loaders/services rodam com o cliente de servidor da sessão do próprio usuário
 * (cookies; getUser validado no Auth; RLS inalterada; sem service_role). Sem lock do navegador.
 * O `signal` é o `request.signal` (cliente cancelou => consultas canceladas).
 */
import type { LoadOutcome, LoaderErrorClass } from "@/lib/client/guarded-loader"
import { loadComerciaisPageOutcome } from "@/lib/admin-legacy/page-loaders"
import { loadAdminIndicacoesBundle, type AdminIndicacoesBundle } from "@/lib/admin-legacy/indicacoes-loader"
import {
  getAuthProfileBasicsFromSupabase,
  loadAdminComerciaisResultFromSupabase,
  loadAdminReferralsFromSupabase,
  type AdminReadClient,
} from "@/lib/services/supabase-data.service"
import type { Comercial } from "@/types"

/** Status HTTP por classe de erro (o cliente reclassifica pelo status; corpo sem detalhes técnicos). */
export const LOADER_ERROR_HTTP_STATUS: Record<LoaderErrorClass, number> = {
  unauthenticated: 401,
  forbidden: 403,
  server_error: 502,
  invalid_response: 502,
  network: 502,
  unexpected: 500,
}

export type AdminListHttp = { status: number; body: Record<string, unknown> }

function toHttp<T>(outcome: LoadOutcome<T>, key: string): AdminListHttp {
  if (outcome.kind === "error") {
    return { status: LOADER_ERROR_HTTP_STATUS[outcome.errorClass], body: { ok: false, errorClass: outcome.errorClass } }
  }
  return { status: 200, body: { ok: true, [key]: outcome.data } }
}

export async function adminComerciaisHttp(client: AdminReadClient, signal: AbortSignal): Promise<AdminListHttp> {
  const outcome: LoadOutcome<Comercial[]> = await loadComerciaisPageOutcome(signal, (opts = {}) =>
    loadAdminComerciaisResultFromSupabase({ ...opts, client })
  )
  return toHttp(outcome, "items")
}

export async function adminIndicacoesHttp(client: AdminReadClient, signal: AbortSignal): Promise<AdminListHttp> {
  const outcome: LoadOutcome<AdminIndicacoesBundle> = await loadAdminIndicacoesBundle(signal, {
    getBasics: (opts = {}) => getAuthProfileBasicsFromSupabase({ ...opts, client }),
    loadReferrals: (opts = {}) => loadAdminReferralsFromSupabase({ ...opts, client }),
    loadComerciais: (opts = {}) => loadAdminComerciaisResultFromSupabase({ ...opts, client }),
  })
  return toHttp(outcome, "bundle")
}

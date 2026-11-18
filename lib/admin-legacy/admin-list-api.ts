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
  ADMIN_PORTAL_READ_ROLES,
  loadAdminReferralsFromSupabase,
  type AdminReadClient,
} from "@/lib/services/supabase-data.service"
import { referralPageQuery, pageWindow } from "@/lib/admin-lists/referral-page"
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

export async function adminIndicacoesPageHttp(client: AdminReadClient, url: URL, signal: AbortSignal): Promise<AdminListHttp> {
  const basics = await getAuthProfileBasicsFromSupabase({ client, signal })
  if (!basics) return { status: 401, body: { ok: false, errorClass: "unauthenticated" } }
  if (!ADMIN_PORTAL_READ_ROLES.has(basics.role)) return { status: 403, body: { ok: false, errorClass: "forbidden" } }
  const query = referralPageQuery(url.searchParams)
  const db = client as unknown as {
    from: (table: string) => {
      select: (columns: string, options?: { count?: "exact" }) => ReferralQuery
    }
  }
  let request = db.from("referrals").select("id, referred_name, referred_phone, status, origin_kind, source, created_at, indicator_profile_id, commercial_profile_id, plan_id, plans(name)", { count: "exact" })
  if (query.from) request = request.gte("created_at", query.from)
  if (query.to) request = request.lt("created_at", query.to)
  if (query.status) request = request.eq("status", query.status)
  if (query.origin) request = request.eq("origin_kind", query.origin)
  if (query.indicatorId) request = request.eq("indicator_profile_id", query.indicatorId)
  if (query.commercialId) request = request.eq("commercial_profile_id", query.commercialId)
  if (query.planId) request = request.eq("plan_id", query.planId)
  if (query.search) {
    const safe = query.search.replace(/[^0-9A-Za-zÀ-ÿ ]/g, "").slice(0, 80)
    if (safe.length >= 2) request = request.or(`referred_name.ilike.%${safe}%,referred_phone.ilike.%${safe}%,referred_document.ilike.%${safe}%`)
  }
  const start = (query.page - 1) * query.pageSize
  const { data, error, count } = await request.order("created_at", { ascending: false }).order("id", { ascending: false }).range(start, start + query.pageSize - 1)
  if (error || signal.aborted) return { status: 502, body: { ok: false, errorClass: "server_error" } }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const profileIds = [...new Set(rows.flatMap((row) => [row.indicator_profile_id, row.commercial_profile_id].filter((id): id is string => typeof id === "string")))]
  const names = new Map<string, string>()
  if (profileIds.length > 0) {
    const profiles = await client.from("profiles").select("id, full_name").in("id", profileIds)
    for (const profile of (profiles.data ?? []) as Array<{ id: string; full_name: string }>) names.set(profile.id, profile.full_name)
  }
  const comerciais = await loadAdminComerciaisResultFromSupabase({ client, signal })
  const total = count ?? 0
  const window = pageWindow(total, query.page, query.pageSize)
  return {
    status: 200,
    body: {
      ok: true,
      role: basics.role,
      comerciais: comerciais.ok ? comerciais.data : [],
      comerciaisDisponiveis: comerciais.ok,
      page: {
        label: query.label,
        total,
        page: query.page,
        pageSize: query.pageSize,
        from: window.from,
        to: window.to,
        pages: window.pages,
        items: rows.map((row) => ({
          id: row.id,
          nomeIndicado: row.referred_name,
          telefoneIndicado: row.referred_phone,
          status: row.status,
          source: row.source,
          createdAt: row.created_at,
          indicadorId: row.indicator_profile_id,
          comercialId: row.commercial_profile_id,
          indicador: row.indicator_profile_id ? { nome: names.get(String(row.indicator_profile_id)) ?? "—" } : null,
          comercial: row.commercial_profile_id ? { nome: names.get(String(row.commercial_profile_id)) ?? "—" } : null,
          plano: row.plans && typeof row.plans === "object" ? { nome: (row.plans as { name?: string }).name ?? "Não informado" } : null,
        })),
      },
    },
  }
}

type ReferralQuery = {
  gte: (column: string, value: string) => ReferralQuery
  lt: (column: string, value: string) => ReferralQuery
  eq: (column: string, value: string) => ReferralQuery
  or: (filters: string) => ReferralQuery
  order: (column: string, options: { ascending: boolean }) => ReferralQuery
  range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message?: string } | null; count: number | null }>
}

export async function adminIndicacoesHttp(client: AdminReadClient, signal: AbortSignal): Promise<AdminListHttp> {
  const outcome: LoadOutcome<AdminIndicacoesBundle> = await loadAdminIndicacoesBundle(signal, {
    getBasics: (opts = {}) => getAuthProfileBasicsFromSupabase({ ...opts, client }),
    loadReferrals: (opts = {}) => loadAdminReferralsFromSupabase({ ...opts, client }),
    loadComerciais: (opts = {}) => loadAdminComerciaisResultFromSupabase({ ...opts, client }),
  })
  return toHttp(outcome, "bundle")
}

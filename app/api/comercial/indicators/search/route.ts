import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import {
  COMMERCIAL_INDICATOR_SEARCH_AUDIT_ENTITY,
  COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS,
} from "@/lib/commercial-assisted/constants"
import {
  buildIndicatorSearchOrFilter,
  runCommercialIndicatorSearch,
  type NormalizedSearchFilters,
} from "@/lib/commercial-assisted/indicator-search.service"
import type { IndicatorSearchDbRow } from "@/lib/commercial-assisted/search-result"
import { createAdminClient, createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/comercial/indicators/search?q=...
 *
 * Busca server-side de indicadores para cadastro assistido.
 * Não lista todos os profiles; exige query mínima + role comercial/admin_master.
 * Usa service role apenas após autenticação/autorização (RLS não permite dump).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")

  const supabase = await createClient()
  const admin = await createAdminClient()

  const result = await runCommercialIndicatorSearch(
    {
      getUser: async () => {
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser()
        if (error || !user) return null
        return { id: user.id }
      },
      getActorProfile: async (userId) => {
        const { data } = await supabase
          .from("profiles")
          .select("id, role, is_active")
          .eq("id", userId)
          .maybeSingle()
        if (!data) return null
        const row = data as {
          id: string
          role: string
          is_active: boolean | null
        }
        return {
          id: row.id,
          role: row.role,
          is_active: row.is_active,
        }
      },
      searchIndicatorRows: async (filters: NormalizedSearchFilters) => {
        const orFilter = buildIndicatorSearchOrFilter(filters)
        if (!orFilter) return []

        const { data, error } = await admin
          .from("profiles")
          .select("id, full_name, phone, email, cpf, is_active, role")
          .eq("role", "indicador")
          .eq("is_active", true)
          .or(orFilter)
          .limit(filters.limit ?? COMMERCIAL_INDICATOR_SEARCH_MAX_RESULTS)

        if (error) {
          console.error("[commercial-indicator-search]", {
            step: "query",
            message: error.message,
          })
          throw new Error("search_failed")
        }

        return (data ?? []) as IndicatorSearchDbRow[]
      },
      insertSearchAudit: async ({ actorProfileId, metadata }) => {
        // Insert com sessão do ator (RLS: actor_profile_id = auth.uid()).
        // action enum existente: 'create' — evento semântico em entity_name/metadata.
        const db = supabase as unknown as {
          from: (table: string) => {
            insert: (values: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
          }
        }
        const { error } = await db.from("audit_logs").insert({
          actor_profile_id: actorProfileId,
          target_profile_id: null,
          entity_name: COMMERCIAL_INDICATOR_SEARCH_AUDIT_ENTITY,
          entity_id: null,
          action: "create",
          old_data: null,
          new_data: null,
          metadata,
        })
        if (error) {
          console.error("[commercial-indicator-search]", {
            step: "audit",
            message: error.message,
          })
        }
      },
    },
    q
  )

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.message },
      { status: result.status }
    )
  }

  return NextResponse.json({
    ok: true,
    results: result.results,
    query_type: result.query_type,
  })
}

import { getSupabaseClient } from "@/lib/supabase/client"
import type { ComercialDisponibilidade } from "@/types/profile"

export type ComercialLeadSettings = {
  id: string
  commercialProfileId: string
  isAvailable: boolean
  receivingLeads: boolean
  dailyLimit: number
  activeLeads: number
  totalReceivedToday: number
  lastLeadReceivedAt: Date | null
}

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

export function devLogLeadAssignment(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[lead-assignment]", ...args)
}

export function devLogCommercialAvailability(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[commercial-availability]", ...args)
}

export function devLogCommercialRealtime(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[commercial-realtime]", ...args)
}

function disponibilidadeFromSettings(
  isAvailable: boolean,
  receivingLeads: boolean
): ComercialDisponibilidade {
  if (!isAvailable) return "offline"
  if (!receivingLeads) return "em_pausa"
  return "disponivel"
}

function settingsFromDisponibilidade(
  status: ComercialDisponibilidade
): { isAvailable: boolean; receivingLeads: boolean } {
  if (status === "offline") {
    return { isAvailable: false, receivingLeads: false }
  }
  if (status === "em_pausa") {
    return { isAvailable: true, receivingLeads: false }
  }
  return { isAvailable: true, receivingLeads: true }
}

export async function loadComercialLeadSettingsFromSupabase(): Promise<ComercialLeadSettings | null> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) return null

    const { data, error } = await db
      .from("commercial_lead_settings")
      .select(
        "id, commercial_profile_id, is_available, receiving_leads, daily_limit, active_leads, total_received_today, last_lead_received_at"
      )
      .eq("commercial_profile_id", user.id)
      .maybeSingle()

    if (error) {
      devLogCommercialAvailability("load erro", error.message)
      return null
    }
    if (!data) {
      devLogCommercialAvailability("load vazio — sem settings", { userId: user.id })
      return null
    }

    const row = data as {
      id: string
      commercial_profile_id: string
      is_available: boolean
      receiving_leads: boolean
      daily_limit: number
      active_leads: number
      total_received_today: number
      last_lead_received_at: string | null
    }

    const settings: ComercialLeadSettings = {
      id: row.id,
      commercialProfileId: row.commercial_profile_id,
      isAvailable: row.is_available,
      receivingLeads: row.receiving_leads,
      dailyLimit: row.daily_limit,
      activeLeads: row.active_leads,
      totalReceivedToday: row.total_received_today,
      lastLeadReceivedAt: row.last_lead_received_at
        ? new Date(row.last_lead_received_at)
        : null,
    }

    devLogCommercialAvailability("load ok", settings)
    return settings
  } catch (e) {
    devLogCommercialAvailability("exceção", e instanceof Error ? e.message : String(e))
    return null
  }
}

export function mapDisponibilidadeToSettings(
  status: ComercialDisponibilidade
): { isAvailable: boolean; receivingLeads: boolean } {
  return settingsFromDisponibilidade(status)
}

export function mapSettingsToDisponibilidade(
  isAvailable: boolean,
  receivingLeads: boolean
): ComercialDisponibilidade {
  return disponibilidadeFromSettings(isAvailable, receivingLeads)
}

export async function saveComercialLeadSettingsFromSupabase(input: {
  isAvailable: boolean
  receivingLeads: boolean
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    devLogCommercialAvailability("save:start", input)

    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser()
    if (authErr || !user) {
      return { ok: false, message: "Sessão inválida." }
    }

    const { data: profile, error: profileErr } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()

    if (profileErr || (profile as { role?: string } | null)?.role !== "comercial") {
      return { ok: false, message: "Apenas comerciais podem alterar disponibilidade." }
    }

    const nowIso = new Date().toISOString()
    const { error: upsertErr } = await db.from("commercial_lead_settings").upsert(
      {
        commercial_profile_id: user.id,
        is_available: input.isAvailable,
        receiving_leads: input.receivingLeads,
        updated_at: nowIso,
      },
      { onConflict: "commercial_profile_id" }
    )

    if (upsertErr) {
      devLogCommercialAvailability("save:error", upsertErr.message)
      return { ok: false, message: upsertErr.message || "Não foi possível salvar." }
    }

    const status = disponibilidadeFromSettings(input.isAvailable, input.receivingLeads)
    void db.from("commercial_availability").insert({
      commercial_profile_id: user.id,
      availability_status: status,
      reason: "Atualização pelo painel comercial",
    })

    devLogCommercialAvailability("save:success", { userId: user.id, status })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    devLogCommercialAvailability("save:exception", msg)
    return { ok: false, message: msg }
  }
}

export async function saveComercialAvailabilityStatusFromSupabase(
  status: ComercialDisponibilidade
): Promise<{ ok: true } | { ok: false; message: string }> {
  const mapped = settingsFromDisponibilidade(status)
  return saveComercialLeadSettingsFromSupabase(mapped)
}

export async function setComercialReceivingLeadsFromSupabase(
  receiving: boolean
): Promise<{ ok: true } | { ok: false; message: string }> {
  const current = await loadComercialLeadSettingsFromSupabase()
  return saveComercialLeadSettingsFromSupabase({
    isAvailable: current?.isAvailable ?? true,
    receivingLeads: receiving,
  })
}

import {
  NOTIFICATIONS_SELECT,
  buildNotificationInsertRow,
  buildNotificationMarkReadUpdate,
  mapNotificationRowFromDb,
  NOTIFICATIONS_DB,
  type NotificationInsertInput,
} from "@/lib/notifications-db-map"
import { getSupabaseClient } from "@/lib/supabase/client"
import type { NotificationItem, NotificationToastPayload } from "@/types/notification"
import type { UserRole } from "@/types/user"

export const NOTIFICATION_RECENT_LIMIT = 30

function isDev(): boolean {
  return process.env.NODE_ENV === "development"
}

function logError(...args: unknown[]): void {
  if (!isDev()) return
  console.warn("[notification:error]", ...args)
}

async function getAuthProfileIdAndRole(): Promise<{
  userId: string | null
  role: UserRole | null
}> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) return { userId: null, role: null }

    const { data: profile } = await db
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle()
    return {
      userId: user.id,
      role: (profile as { role?: UserRole } | null)?.role ?? null,
    }
  } catch (e) {
    logError("auth", e instanceof Error ? e.message : String(e))
    return { userId: null, role: null }
  }
}

async function queryRecentRows(
  limit: number
): Promise<{ rows: Record<string, unknown>[] | null; role: UserRole | null }> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const { userId, role } = await getAuthProfileIdAndRole()
    if (!userId) return { rows: null, role: null }

    const { data, error } = await db
      .from("notifications")
      .select(NOTIFICATIONS_SELECT)
      .eq(NOTIFICATIONS_DB.profileId, userId)
      .order(NOTIFICATIONS_DB.createdAt, { ascending: false })
      .limit(limit)

    if (error) {
      logError("loadRecent", error.message)
      return { rows: null, role }
    }

    return { rows: (data ?? []) as Record<string, unknown>[], role }
  } catch (e) {
    logError("loadRecent exceção", e instanceof Error ? e.message : String(e))
    return { rows: null, role: null }
  }
}

export async function loadUnreadNotificationsCount(): Promise<number> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const { userId } = await getAuthProfileIdAndRole()
    if (!userId) return 0

    const { count, error } = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq(NOTIFICATIONS_DB.profileId, userId)
      .eq(NOTIFICATIONS_DB.isRead, false)

    if (error) {
      logError("count", error.message)
      return 0
    }
    return count ?? 0
  } catch (e) {
    logError("count exceção", e instanceof Error ? e.message : String(e))
    return 0
  }
}

export async function loadRecentNotifications(
  limit = NOTIFICATION_RECENT_LIMIT
): Promise<NotificationItem[]> {
  const { rows, role } = await queryRecentRows(limit)
  if (!rows) return []
  return rows.map((row) => mapNotificationRowFromDb(row, role))
}

export async function markNotificationAsRead(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const { userId } = await getAuthProfileIdAndRole()
    if (!userId) {
      return { ok: false, message: "Sessão inválida. Faça login novamente." }
    }

    const { data: updated, error } = await db
      .from("notifications")
      .update(buildNotificationMarkReadUpdate())
      .eq("id", id)
      .eq(NOTIFICATIONS_DB.profileId, userId)
      .select(`id, ${NOTIFICATIONS_DB.isRead}, ${NOTIFICATIONS_DB.readAt}`)

    if (error) {
      logError("markAsRead", error.message)
      return { ok: false, message: error.message || "Não foi possível marcar como lida." }
    }
    if (!updated?.length) {
      return { ok: false, message: "Notificação não encontrada ou sem permissão." }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError("markAsRead exceção", msg)
    return { ok: false, message: msg }
  }
}

export async function markAllNotificationsAsRead(): Promise<
  { ok: true; updated: number } | { ok: false; message: string }
> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const { userId } = await getAuthProfileIdAndRole()
    if (!userId) {
      return { ok: false, message: "Sessão inválida. Faça login novamente." }
    }

    const { data: updatedRows, error } = await db
      .from("notifications")
      .update(buildNotificationMarkReadUpdate())
      .eq(NOTIFICATIONS_DB.profileId, userId)
      .eq(NOTIFICATIONS_DB.isRead, false)
      .select("id")

    if (error) {
      logError("markAllAsRead", error.message)
      return { ok: false, message: error.message || "Falha ao marcar todas como lidas." }
    }
    return { ok: true, updated: updatedRows?.length ?? 0 }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError("markAllAsRead exceção", msg)
    return { ok: false, message: msg }
  }
}

export type CreateNotificationForProfileInput = {
  profileId: string
  notificationType: string
  title: string
  message: string
  data?: Record<string, unknown>
  actionUrl?: string | null
}

const ADMIN_NOTIFICATION_ROLES = [
  "admin_master",
  "admin_financeiro",
  "admin_consulta",
] as const

const LOG_NEW_REFERRAL_START = "[notification:new-referral-admins:start]"
const LOG_NEW_REFERRAL_RPC = "[notification:new-referral-admins:rpc-result]"
const LOG_NEW_REFERRAL_ERROR = "[notification:new-referral-admins:error]"

function logSkip(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[notification:skip]", ...args)
}

function logCreate(...args: unknown[]): void {
  if (!isDev()) return
  console.log("[notification:create]", ...args)
}

function logNewReferralStart(...args: unknown[]): void {
  if (!isDev()) return
  console.log(LOG_NEW_REFERRAL_START, ...args)
}

function logNewReferralRpc(...args: unknown[]): void {
  if (!isDev()) return
  console.log(LOG_NEW_REFERRAL_RPC, ...args)
}

function logNewReferralError(...args: unknown[]): void {
  if (!isDev()) return
  console.warn(LOG_NEW_REFERRAL_ERROR, ...args)
}

/**
 * Insere notificação para um perfil. Nunca lança — falhas só logam em dev.
 */
export async function createNotificationForProfileFromSupabase(
  input: CreateNotificationForProfileInput
): Promise<void> {
  const profileId = input.profileId?.trim()
  if (!profileId) {
    logSkip("profileId ausente")
    return
  }

  try {
    const result = await createNotificationFromSupabase({
      profile_id: profileId,
      title: input.title,
      message: input.message,
      notificationType: input.notificationType,
      metadata: input.data ?? {},
      actionUrl: input.actionUrl ?? null,
    })

    if (!result.ok) {
      logError("create falhou", {
        profileId,
        notificationType: input.notificationType,
        message: result.message,
      })
      return
    }

    logCreate({
      profileId,
      notificationType: input.notificationType,
      title: input.title,
      referral_id: input.data?.referral_id ?? null,
      actionUrl: input.actionUrl ?? null,
    })
  } catch (e) {
    logError("create exceção", {
      profileId,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

/**
 * Notifica todos os admins ativos sobre nova indicação.
 * Usa RPC security definer (indicador não passa RLS de INSERT para outros perfis).
 */
export async function notifyAdminsOfNewReferralFromSupabase(params: {
  referralId: string
}): Promise<void> {
  const referralId = params.referralId?.trim()
  if (!referralId) {
    logNewReferralError("referralId ausente")
    logSkip("referralId ausente para admins")
    return
  }

  const expectedPayload = {
    notification_type: "indicacao",
    data: { action: "referral_created", referral_id: referralId },
    action_url: `/admin/indicacoes/${referralId}`,
  }

  logNewReferralStart({ referralId, expectedPayload })

  try {
    const supabase = getSupabaseClient()
    const dbRpc = supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{
        data: unknown
        error: {
          message: string
          code?: string
          details?: string
          hint?: string
        } | null
      }>
    }

    const { data: rpcData, error: rpcError } = await dbRpc.rpc(
      "notify_admins_new_referral",
      { p_referral_id: referralId }
    )

    logNewReferralRpc({
      referralId,
      ok: !rpcError,
      data: rpcData ?? null,
      error: rpcError
        ? {
            message: rpcError.message,
            code: rpcError.code ?? null,
            details: rpcError.details ?? null,
            hint: rpcError.hint ?? null,
          }
        : null,
    })

    if (!rpcError) {
      logCreate({
        via: "rpc",
        referral_id: referralId,
        ...expectedPayload,
      })
      return
    }

    const rpcCode = rpcError.code ?? ""
    const rpcMissing =
      rpcCode === "42883" ||
      rpcCode === "PGRST202" ||
      /could not find the function/i.test(rpcError.message) ||
      /notify_admins_new_referral/i.test(rpcError.message)

    if (!rpcMissing) {
      logNewReferralError("RPC rejeitou (função existe, mas falhou)", {
        referralId,
        code: rpcCode,
        message: rpcError.message,
      })
      logError("notifyAdmins RPC falhou", {
        referralId,
        message: rpcError.message,
        code: rpcCode,
      })
      return
    }

    logNewReferralError(
      "RPC notify_admins_new_referral ausente no banco — aplicar supabase/patch-notifications-referral-events.sql"
    )
    logSkip("RPC ausente; tentando fallback direto (indicador: RLS costuma bloquear)")

    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }

    const { data: admins, error: adminsQueryError } = await db
      .from("profiles")
      .select("id")
      .in("role", [...ADMIN_NOTIFICATION_ROLES])
      .eq("is_active", true)

    if (adminsQueryError) {
      logNewReferralError("fallback: query profiles bloqueada (RLS)", {
        message: adminsQueryError.message,
        code: adminsQueryError.code ?? null,
      })
      logError("notifyAdmins query falhou", adminsQueryError.message)
      return
    }

    if (!admins?.length) {
      logNewReferralError(
        "fallback: 0 admins visíveis (RLS do indicador não lista perfis admin)"
      )
      logSkip("nenhum admin ativo para notificar")
      return
    }

    logNewReferralStart({
      referralId,
      fallback: true,
      adminCount: admins.length,
      note: "insert direto provavelmente falhará RLS para profile_id != auth.uid()",
    })

    const actionUrl = expectedPayload.action_url
    const payload = {
      notificationType: expectedPayload.notification_type,
      title: "Nova indicação recebida",
      message: "Uma nova indicação foi cadastrada no sistema.",
      data: expectedPayload.data,
      actionUrl,
    }

    await Promise.all(
      (admins as { id: string }[]).map((admin) =>
        createNotificationForProfileFromSupabase({
          profileId: admin.id,
          ...payload,
        })
      )
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logNewReferralError("exceção", { referralId, message: msg })
    logError("notifyAdmins exceção", msg)
  }
}

const LOG_INDICADOR_NOTIFICATION = "[indicador:notification]"
const LOG_INDICATOR_TRIGGER = "[indicator:trigger]"
const LOG_INDICATOR_INSERT = "[indicator:notification-insert]"
const LOG_INDICATOR_REWARD_TRIGGER = "[indicator:reward-trigger]"
const LOG_INDICATOR_SQL_TRIGGER = "[indicator:sql-trigger]"

function logIndicadorNotification(...args: unknown[]): void {
  if (!isDev()) return
  console.log(LOG_INDICADOR_NOTIFICATION, ...args)
}

function logIndicadorNotificationError(...args: unknown[]): void {
  console.warn(LOG_INDICADOR_NOTIFICATION, ...args)
}

function logIndicatorSqlTrigger(...args: unknown[]): void {
  console.warn(LOG_INDICATOR_SQL_TRIGGER, ...args)
}

async function callIndicatorNotificationRpc(
  fn: "notify_indicator_referral_progress" | "notify_indicator_reward_released",
  referralId: string
): Promise<boolean> {
  const supabase = getSupabaseClient()
  const dbRpc = supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{
      data: unknown
      error: { message: string; code?: string } | null
    }>
  }

  const { data, error } = await dbRpc.rpc(fn, { p_referral_id: referralId })

  const rpcMissing =
    Boolean(error) &&
    (error?.code === "PGRST202" ||
      error?.code === "42883" ||
      /could not find the function/i.test(error?.message ?? "") ||
      new RegExp(fn, "i").test(error?.message ?? ""))

  if (isDev()) {
    console.log(LOG_INDICATOR_TRIGGER, {
      fn,
      referralId,
      ok: !error,
      data: data ?? null,
    })
  }

  logIndicadorNotification("rpc", {
    fn,
    referralId,
    ok: !error,
    data: data ?? null,
    error: error
      ? { message: error.message, code: error.code ?? null }
      : null,
  })

  if (rpcMissing) {
    logIndicatorSqlTrigger(
      `RPC ${fn} ausente — aplicar supabase/patch-notifications-indicator-events.sql`,
      { referralId, code: error?.code ?? null }
    )
  } else if (error) {
    logIndicatorSqlTrigger(`RPC ${fn} falhou`, {
      referralId,
      message: error.message,
      code: error.code ?? null,
    })
  } else if (fn === "notify_indicator_reward_released") {
    if (isDev()) {
      console.log(LOG_INDICATOR_REWARD_TRIGGER, { referralId, ok: true })
    }
  }

  return !error
}

/**
 * Notifica indicador que o lead avançou no funil (RPC security definer).
 */
export async function notifyIndicatorReferralProgressFromSupabase(
  referralId: string
): Promise<void> {
  const id = referralId?.trim()
  if (!id) {
    logIndicadorNotificationError("referralId ausente")
    return
  }

  try {
    const ok = await callIndicatorNotificationRpc(
      "notify_indicator_referral_progress",
      id
    )
    if (ok) {
      if (isDev()) {
        console.log(LOG_INDICATOR_INSERT, {
          action: "referral_progress",
          referralId: id,
          via: "rpc",
        })
      }
      logCreate({
        via: "rpc",
        audience: "indicador",
        action: "referral_progress",
        referral_id: id,
        actionUrl: `/indicador/indicacoes/${id}`,
      })
      return
    }

    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const { data: refRow } = await db
      .from("referrals")
      .select("indicator_profile_id")
      .eq("id", id)
      .maybeSingle()
    const profileId = (refRow as { indicator_profile_id?: string } | null)
      ?.indicator_profile_id

    if (!profileId) {
      logIndicadorNotificationError("indicator_profile_id não encontrado", { id })
      return
    }

    logIndicadorNotification("fallback insert direto (admin/comercial pode falhar RLS)")
    await createNotificationForProfileFromSupabase({
      profileId,
      notificationType: "indicacao",
      title: "Sua indicação avançou",
      message: "O lead indicado por você avançou no funil comercial.",
      data: { action: "referral_progress", referral_id: id },
      actionUrl: `/indicador/indicacoes/${id}`,
    })
  } catch (e) {
    logIndicadorNotificationError("exceção", e instanceof Error ? e.message : String(e))
  }
}

/**
 * Notifica indicador que a recompensa foi liberada (RPC security definer).
 */
export async function notifyIndicatorRewardReleasedFromSupabase(
  referralId: string
): Promise<void> {
  const id = referralId?.trim()
  if (!id) {
    logIndicadorNotificationError("referralId ausente")
    return
  }

  try {
    if (isDev()) {
      console.log("[indicador:reward-release]", { referralId: id, step: "notify" })
    }

    const ok = await callIndicatorNotificationRpc(
      "notify_indicator_reward_released",
      id
    )
    if (ok) {
      if (isDev()) {
        console.log(LOG_INDICATOR_INSERT, {
          action: "reward_released",
          referralId: id,
          via: "rpc",
        })
      }
      logCreate({
        via: "rpc",
        audience: "indicador",
        action: "reward_released",
        referral_id: id,
        actionUrl: "/indicador/carteira",
      })
      return
    }

    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const { data: refRow } = await db
      .from("referrals")
      .select("indicator_profile_id")
      .eq("id", id)
      .maybeSingle()
    const profileId = (refRow as { indicator_profile_id?: string } | null)
      ?.indicator_profile_id

    if (!profileId) {
      logIndicadorNotificationError("indicator_profile_id não encontrado", { id })
      return
    }

    await createNotificationForProfileFromSupabase({
      profileId,
      notificationType: "recompensa",
      title: "Recompensa liberada",
      message: "Sua recompensa já está disponível.",
      data: { action: "reward_released", referral_id: id },
      actionUrl: "/indicador/carteira",
    })
  } catch (e) {
    logIndicadorNotificationError("exceção", e instanceof Error ? e.message : String(e))
  }
}

export async function createNotificationFromSupabase(
  payload: NotificationInsertInput
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const supabase = getSupabaseClient()
    const db = supabase as unknown as {
      from: (t: string) => ReturnType<typeof supabase.from>
    }
    const row = buildNotificationInsertRow(payload)
    const { error } = await db.from("notifications").insert(row)
    if (error) {
      logError("create", error.message)
      return { ok: false, message: error.message }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logError("create exceção", msg)
    return { ok: false, message: msg }
  }
}

export function createRealtimeToastPayload(item: NotificationItem): NotificationToastPayload {
  return {
    id: item.id,
    title: item.title,
    message: item.message,
    actionUrl: item.actionUrl,
  }
}

export function mapRealtimePayloadToNotificationItem(
  raw: Record<string, unknown>,
  role: UserRole | null = null
): NotificationItem | null {
  if (raw.id == null) return null
  if (isDev()) {
    console.log("[notification:realtime]", {
      id: raw.id,
      notification_type: raw.notification_type,
      is_read: raw.is_read,
    })
  }
  return mapNotificationRowFromDb(raw, role)
}

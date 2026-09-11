import "server-only"

import { getOpsDb } from "@/lib/collections/db"
import {
  COLLECTION_SETTINGS_DEFAULTS,
  collectionSettingsToRow,
  parseCollectionSettingsJson,
  type CollectionOperationalSettings,
} from "@/lib/operational/settings"

export async function loadCollectionOperationalSettings(): Promise<CollectionOperationalSettings> {
  const db = getOpsDb()
  const { data } = await db
    .from("operational_sector_settings")
    .select("is_enabled, settings")
    .eq("sector_code", "collections")
    .maybeSingle()

  if (!data) return COLLECTION_SETTINGS_DEFAULTS
  const raw =
    data.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
      ? (data.settings as Record<string, unknown>)
      : {}
  return parseCollectionSettingsJson(raw, data.is_enabled !== false)
}

export async function saveCollectionOperationalSettings(input: {
  settings: CollectionOperationalSettings
  actorProfileId: string
}): Promise<CollectionOperationalSettings> {
  const db = getOpsDb()
  const { data: current } = await db
    .from("operational_sector_settings")
    .select("id, is_enabled, settings")
    .eq("sector_code", "collections")
    .maybeSingle()

  const row = collectionSettingsToRow(input.settings)
  const now = new Date().toISOString()

  if (current?.id) {
    await db
      .from("operational_sector_settings")
      .update({
        is_enabled: row.is_enabled,
        settings: row.settings,
        updated_by_profile_id: input.actorProfileId,
        updated_at: now,
      })
      .eq("id", current.id)
  } else {
    await db.from("operational_sector_settings").insert({
      sector_code: "collections",
      is_enabled: row.is_enabled,
      settings: row.settings,
      updated_by_profile_id: input.actorProfileId,
    })
  }

  await db.from("operational_settings_events").insert({
    sector_code: "collections",
    actor_profile_id: input.actorProfileId,
    old_value: current
      ? { is_enabled: current.is_enabled, settings: current.settings }
      : null,
    new_value: { is_enabled: row.is_enabled, settings: row.settings },
  })

  return input.settings
}

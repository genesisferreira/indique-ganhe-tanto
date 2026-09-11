import { NextResponse } from "next/server"
import { authorizeOperationalAdminSettingsRequest } from "@/lib/collections/actor"
import { jsonError, stripBrowserActor } from "@/lib/collections/http"
import {
  loadCollectionOperationalSettings,
  saveCollectionOperationalSettings,
} from "@/lib/operational/settings.service"
import { validateCollectionSettingsPatch } from "@/lib/operational/settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await authorizeOperationalAdminSettingsRequest("read")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const settings = await loadCollectionOperationalSettings()
  return NextResponse.json({
    ok: true,
    canWrite: auth.canWrite,
    settings,
    cancelledFilterOperational: false,
    cancelledIntegrationNote:
      "O Controllr neste repositório não expõe status/data/motivo de cancelamento. A opção fica salva, mas o filtro não opera até a integração ser confirmada.",
  })
}

export async function PUT(request: Request) {
  const auth = await authorizeOperationalAdminSettingsRequest("write")
  if (!auth.ok) return jsonError(auth.status, auth.message)
  const body = stripBrowserActor(await request.json().catch(() => null))
  const current = await loadCollectionOperationalSettings()
  const parsed = validateCollectionSettingsPatch(
    {
      isEnabled: body.isEnabled ?? body.is_enabled,
      minimumDaysOverdue: body.minimumDaysOverdue ?? body.minimum_days_overdue,
      includeCancelledCustomers:
        body.includeCancelledCustomers ?? body.include_cancelled_customers,
    },
    current
  )
  if (!parsed.ok) return jsonError(400, parsed.message)
  const settings = await saveCollectionOperationalSettings({
    settings: parsed.settings,
    actorProfileId: auth.profileId,
  })
  return NextResponse.json({ ok: true, settings, cancelledFilterOperational: false })
}

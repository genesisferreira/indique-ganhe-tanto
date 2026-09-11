import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { jsonError } from "@/lib/collections/http"
import { listMyActiveSectorCodes } from "@/lib/employees/admin.service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.id) return jsonError(401, "Sessão não encontrada. Faça login novamente.")
  const codes = await listMyActiveSectorCodes(user.id)
  return NextResponse.json({ ok: true, sectorCodes: codes })
}

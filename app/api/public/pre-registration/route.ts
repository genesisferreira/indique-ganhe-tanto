import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import { isPublicPreRegistrationEnabled } from "@/lib/public-pre-registration/config"
import { checkPublicPreRegistrationRateLimit } from "@/lib/public-pre-registration/rate-limit"
import { submitPublicPreRegistration } from "@/lib/public-pre-registration/service"
import { parsePublicPreRegistrationPayload } from "@/lib/public-pre-registration/validate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY_BYTES = 16_384

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown"
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}

function jsonNoStore(body: unknown, status = 200): NextResponse {
  return applyNoStoreHeaders(NextResponse.json(body, { status }))
}

export async function POST(request: NextRequest) {
  if (!isPublicPreRegistrationEnabled()) {
    return jsonNoStore({ ok: false, error: "unavailable" }, 404)
  }

  const ip = getClientIp(request)
  const rate = checkPublicPreRegistrationRateLimit(ip)
  if (!rate.allowed) {
    return jsonNoStore(
      {
        ok: false,
        message: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      },
      429
    )
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (contentLength > MAX_BODY_BYTES) {
    return jsonNoStore({ ok: false, message: "Payload muito grande." }, 413)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonNoStore({ ok: false, message: "Dados inválidos." }, 400)
  }

  const parsed = parsePublicPreRegistrationPayload(body)
  if (!parsed.ok) {
    return jsonNoStore({ ok: false, message: parsed.message }, 400)
  }

  const result = await submitPublicPreRegistration(parsed.data, {
    sourcePage: "/pre-cadastro",
  })

  if (!result.ok) {
    return jsonNoStore({ ok: false, message: result.message }, 400)
  }

  return jsonNoStore({
    ok: true,
    message: result.message,
  })
}

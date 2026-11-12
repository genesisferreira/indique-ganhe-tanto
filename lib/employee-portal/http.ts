import { NextResponse } from "next/server"
import { applyNoStoreHeaders } from "@/lib/auth/cache-control"
import {
  PORTAL_ERROR_MESSAGE,
  PORTAL_ERROR_STATUS,
  type PortalErrorKind,
} from "@/lib/employee-portal/contracts"

/** Resposta financeira sensível: nunca cacheável (no-store, Vary: Cookie). */
export function employeeJson(body: unknown, status = 200): NextResponse {
  return applyNoStoreHeaders(NextResponse.json(body, { status }))
}

export function employeeError(kind: PortalErrorKind): NextResponse {
  return employeeJson({ ok: false, message: PORTAL_ERROR_MESSAGE[kind] }, PORTAL_ERROR_STATUS[kind])
}

export function employeeBadRequest(message: string): NextResponse {
  return employeeJson({ ok: false, message }, 400)
}

import { NextResponse } from "next/server"

export const PRIVATE_NO_STORE_CACHE =
  "no-store, no-cache, must-revalidate, proxy-revalidate"

/** Impede cache de páginas autenticadas e respostas sensíveis. */
export function applyNoStoreHeaders(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", PRIVATE_NO_STORE_CACHE)
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Expires", "0")
  response.headers.set("Vary", "Cookie")
  return response
}

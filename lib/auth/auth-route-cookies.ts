export type AuthCookieToSet = {
  name: string
  value: string
  options?: {
    domain?: string
    expires?: Date
    httpOnly?: boolean
    maxAge?: number
    path?: string
    sameSite?: "lax" | "strict" | "none"
    secure?: boolean
  }
}

export type CookieWritableResponse = {
  cookies: {
    set: (
      name: string,
      value: string,
      options?: AuthCookieToSet["options"]
    ) => unknown
  }
}

/** Copia cookies do @supabase/ssr para o NextResponse devolvido pelo Route Handler. */
export function attachAuthCookiesToResponse<T extends CookieWritableResponse>(
  response: T,
  cookiesToSet: AuthCookieToSet[]
): T {
  for (const { name, value, options } of cookiesToSet) {
    if (!name) continue
    response.cookies.set(name, value, options)
  }
  return response
}

export function collectAuthCookiesFromSetAll(
  jar: AuthCookieToSet[],
  cookiesToSet: AuthCookieToSet[]
): void {
  for (const cookie of cookiesToSet) {
    jar.push(cookie)
  }
}

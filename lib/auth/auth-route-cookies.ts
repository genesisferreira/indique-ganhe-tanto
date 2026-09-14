import type { CookieOptions } from "@supabase/ssr"

export type AuthCookieToSet = {
  name: string
  value: string
  options: CookieOptions
}

export type CookieWritableResponse = {
  cookies: {
    set: (name: string, value: string, options?: CookieOptions) => unknown
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

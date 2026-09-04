import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import type { Database } from '@/types/database'
import { applyDevSupabaseTlsWorkaround } from '@/lib/supabase/dev-tls'

function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ''
  return { url, anonKey }
}

function createServerClientWithCookies(
  getAll: () => ReturnType<Awaited<ReturnType<typeof cookies>>['getAll']>,
  setAll: (cookiesToSet: {
    name: string
    value: string
    options?: Parameters<Awaited<ReturnType<typeof cookies>>['set']>[2]
  }[]) => void
) {
  applyDevSupabaseTlsWorkaround()
  const { url, anonKey } = getSupabasePublicEnv()

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll,
      setAll,
    },
  })
}

/**
 * Session / RLS-aware Supabase client (anon key + cookies).
 * Use for auth.getUser() and intentional user-scoped DB access.
 * Never use for privileged bypass of RLS.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClientWithCookies(
    () => cookieStore.getAll(),
    (cookiesToSet) => {
      try {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        )
      } catch {
        // Server Component / Route Handler read-only: middleware renova sessão.
      }
    }
  )
}

/** Route Handlers: lê cookies diretamente da request (padrão logout/middleware). */
export function createClientFromRequest(request: NextRequest) {
  return createServerClientWithCookies(
    () => request.cookies.getAll(),
    () => {
      // Auth read-only nestas rotas; refresh fica a cargo do middleware em produção.
    }
  )
}

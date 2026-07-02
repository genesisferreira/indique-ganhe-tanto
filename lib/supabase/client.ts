import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

function getPublicSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ''
  return { url, anonKey }
}

function logSupabaseAuthDebugOnce() {
  if (process.env.NODE_ENV !== 'development') return
  const g = globalThis as typeof globalThis & { __supabaseAuthDebugLogged?: boolean }
  if (g.__supabaseAuthDebugLogged) return
  g.__supabaseAuthDebugLogged = true

  const { url, anonKey } = getPublicSupabaseEnv()
  let host: string | null = null
  try {
    host = url ? new URL(url).host : null
  } catch {
    host = '(URL inválida)'
  }

  console.info('[Supabase Auth] diagnóstico (sem expor a chave completa)', {
    urlDefinida: Boolean(url),
    host,
    anonKeyPrimeiros10: anonKey ? `${anonKey.slice(0, 10)}…` : '(ausente — reinicie o dev server após editar .env.local)',
  })

  if (url) {
    const base = url.replace(/\/$/, '')
    console.info('[Supabase Auth] no Network, o cadastro deve disparar POST para:', `${base}/auth/v1/signup`)
  }
}

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null
let envSignature = ''

export function resetSupabaseBrowserClient(): void {
  browserClient = null
  envSignature = ''
}

export function getSupabaseClient() {
  const { url, anonKey } = getPublicSupabaseEnv()
  logSupabaseAuthDebugOnce()

  if (!url || !anonKey) {
    throw new Error(
      'Supabase: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY em .env.local e reinicie o servidor (pnpm dev).'
    )
  }

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') {
      console.warn('[Supabase Auth] a URL do projeto deve usar https://')
    }
    if (!parsed.hostname.endsWith('.supabase.co')) {
      console.warn(
        '[Supabase Auth] host inesperado; confira no dashboard se a URL é https://<ref>.supabase.co'
      )
    }
  } catch {
    throw new Error('Supabase: NEXT_PUBLIC_SUPABASE_URL não é uma URL válida.')
  }

  const nextSig = `${url}|${anonKey}`
  if (!browserClient || envSignature !== nextSig) {
    browserClient = createBrowserClient<Database>(url, anonKey, {
      // Evita o singleton global do @supabase/ssr com credenciais antigas durante o dev
      isSingleton: false,
    })
    envSignature = nextSig
  }

  return browserClient
}

/** Mensagem amigável quando o browser não consegue completar o fetch (rede, URL, extensão, etc.) */
export function getSupabaseAuthNetworkHint(err: unknown): string | null {
  if (!(err instanceof Error)) return null
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return 'Não foi possível conectar ao Supabase (falha de rede). Verifique NEXT_PUBLIC_SUPABASE_URL, reinicie o pnpm dev e inspecione o POST para .../auth/v1/signup na aba Network.'
  }
  return null
}

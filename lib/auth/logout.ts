"use client"

import { getSupabaseClient, resetSupabaseBrowserClient } from "@/lib/supabase/client"

const SUPABASE_STORAGE_PREFIXES = ["sb-", "supabase.auth"]

/** Remove chaves de sessão Supabase do localStorage (complemento ao signOut). */
export function clearSupabaseLocalStorage(): void {
  if (typeof window === "undefined") return

  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i)
    if (
      key &&
      SUPABASE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      localStorage.removeItem(key)
    }
  }
}

/** Encerra sessão Supabase no browser e limpa caches locais relacionados. */
export async function performClientLogout(): Promise<{ error: Error | null }> {
  try {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signOut({ scope: "global" })
    clearSupabaseLocalStorage()
    resetSupabaseBrowserClient()
    return { error: error ? new Error(error.message) : null }
  } catch (err) {
    clearSupabaseLocalStorage()
    resetSupabaseBrowserClient()
    return {
      error: err instanceof Error ? err : new Error(String(err)),
    }
  }
}

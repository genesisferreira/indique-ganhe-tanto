import "server-only"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { applyDevSupabaseTlsWorkaround } from "@/lib/supabase/dev-tls"

/**
 * Privileged server-only Supabase client (service-role key).
 *
 * - No user cookies / session inheritance
 * - Does not authenticate or authorize the actor by itself
 * - Caller MUST authenticate + authorize (session getUser / role) before use
 * - Never import from Client Components
 */
export function createServiceRoleClient() {
  applyDevSupabaseTlsWorkaround()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ""

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase service role: defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente do servidor."
    )
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

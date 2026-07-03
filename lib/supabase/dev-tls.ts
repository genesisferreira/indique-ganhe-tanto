import "server-only"

let applied = false

/**
 * Em dev/local, alguns ambientes Windows (proxy/antivírus) quebram TLS do Node
 * para *.supabase.co enquanto o browser continua funcionando.
 * Aplica workaround apenas no servidor e somente em development.
 */
export function applyDevSupabaseTlsWorkaround(): void {
  if (process.env.NODE_ENV !== "development" || applied) return
  applied = true
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
}

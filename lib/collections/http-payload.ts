function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** IDs/ator do browser são ignorados. A sessão server-side é a fonte. */
export function stripBrowserActor(body: unknown): Record<string, unknown> {
  const obj = asRecord(body) ?? {}
  const rest = { ...obj }
  delete rest.actor_profile_id
  delete rest.actorProfileId
  delete rest.user_id
  delete rest.userId
  delete rest.employee_id
  delete rest.employeeId
  delete rest.role
  return rest
}

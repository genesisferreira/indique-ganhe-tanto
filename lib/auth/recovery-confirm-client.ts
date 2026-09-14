import {
  PASSWORD_UPDATE_PATH,
  RECOVERY_VERIFY_PATH,
} from "@/lib/auth/password-reset"

export const RECOVERY_CONFIRM_PROTOCOL_FAILURE_BODY =
  "Não foi possível confirmar a recuperação. Solicite um novo link se o problema continuar."

export type RecoveryConfirmClientResult =
  | { kind: "success" }
  | { kind: "invalid_or_expired" }
  | { kind: "protocol_failure" }

export function createRecoveryConfirmSingleFlight() {
  let inFlight = false
  return async function runExclusive<T>(
    fn: () => Promise<T>
  ): Promise<T | "skipped"> {
    if (inFlight) return "skipped"
    inFlight = true
    try {
      return await fn()
    } finally {
      inFlight = false
    }
  }
}

export async function submitRecoveryConfirmation(input: {
  tokenHash: string
  fetchImpl: typeof fetch
}): Promise<RecoveryConfirmClientResult> {
  let response: Response
  try {
    response = await input.fetchImpl(RECOVERY_VERIFY_PATH, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token_hash: input.tokenHash,
        type: "recovery",
        next: PASSWORD_UPDATE_PATH,
      }),
    })
  } catch {
    return { kind: "protocol_failure" }
  }

  if (!response.ok) {
    return { kind: "protocol_failure" }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { kind: "protocol_failure" }
  }

  if (
    payload === null ||
    typeof payload !== "object" ||
    !("ok" in payload) ||
    typeof (payload as { ok: unknown }).ok !== "boolean"
  ) {
    return { kind: "protocol_failure" }
  }

  if ((payload as { ok: boolean }).ok === true) {
    return { kind: "success" }
  }
  return { kind: "invalid_or_expired" }
}

export function recoverySuccessDestination(): string {
  return PASSWORD_UPDATE_PATH
}

import { NextResponse } from "next/server"
import { stripBrowserActor } from "@/lib/collections/http-payload"
import {
  CONTACT_CHANNELS,
  CONTACT_OUTCOMES,
  type ContactChannel,
  type ContactOutcome,
} from "@/types/collections"

export { stripBrowserActor }

export function jsonError(status: number, message: string) {
  return NextResponse.json({ ok: false, message }, { status })
}

export function readContactPayload(body: unknown): {
  channel: ContactChannel
  outcome: ContactOutcome
  notes: string | null
} | { error: string } {
  const rest = stripBrowserActor(body)
  const channel = String(rest.channel ?? "")
  const outcome = String(rest.outcome ?? "")
  if (!(CONTACT_CHANNELS as readonly string[]).includes(channel)) {
    return { error: "Canal inválido." }
  }
  if (!(CONTACT_OUTCOMES as readonly string[]).includes(outcome)) {
    return { error: "Resultado inválido." }
  }
  const notes = typeof rest.notes === "string" ? rest.notes : null
  return {
    channel: channel as ContactChannel,
    outcome: outcome as ContactOutcome,
    notes,
  }
}

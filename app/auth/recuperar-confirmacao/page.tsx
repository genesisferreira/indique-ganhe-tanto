"use client"

import { useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { TantoBrand } from "@/components/branding/tanto-brand"
import {
  RECOVERY_CONFIRMATION_PATH,
  RECOVERY_INVALID_LINK_TITLE,
  RECOVERY_VERIFY_PATH,
} from "@/lib/auth/password-reset"
import { parseRecoveryFragment } from "@/lib/auth/recovery-token-fragment"

type View = "loading" | "ready" | "invalid" | "failed"

const INVALID_LINK_BODY = "Solicite um novo link para redefinir sua senha."
const POST_FAILED_BODY =
  "Este link não é mais válido. Solicite um novo link."

export default function RecuperarConfirmacaoPage() {
  const [view, setView] = useState<View>("loading")
  const [busy, setBusy] = useState(false)
  const tokenHashRef = useRef<string | null>(null)
  const submitLockRef = useRef(false)

  useLayoutEffect(() => {
    const parsed = parseRecoveryFragment(window.location.hash)
    window.history.replaceState(null, "", RECOVERY_CONFIRMATION_PATH)
    if (!parsed.ok) {
      setView("invalid")
      return
    }
    tokenHashRef.current = parsed.tokenHash
    setView("ready")
  }, [])

  async function handleContinue() {
    if (submitLockRef.current || busy) return
    const tokenHash = tokenHashRef.current
    if (!tokenHash) {
      setView("invalid")
      return
    }
    submitLockRef.current = true
    setBusy(true)
    try {
      const response = await fetch(RECOVERY_VERIFY_PATH, {
        method: "POST",
        credentials: "same-origin",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_hash: tokenHash,
          type: "recovery",
          next: "/atualizar-senha",
        }),
      })
      const location = response.headers.get("Location")
      if (location) {
        window.location.assign(location)
        return
      }
      setView("failed")
    } catch {
      setView("failed")
    }
    submitLockRef.current = false
    setBusy(false)
  }

  if (view === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <p className="text-sm text-muted-foreground">Preparando a recuperação…</p>
      </div>
    )
  }

  if (view === "invalid" || view === "failed") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center gap-3">
            <TantoBrand variant="symbol" size="lg" className="w-12 h-12" priority />
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {RECOVERY_INVALID_LINK_TITLE}
              </h1>
              <p className="text-sm text-muted-foreground mt-2">
                {view === "failed" ? POST_FAILED_BODY : INVALID_LINK_BODY}
              </p>
            </div>
          </div>
          <Button asChild className="w-full">
            <Link href="/recuperar-senha">Solicitar novo link</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-3">
          <TantoBrand variant="symbol" size="lg" className="w-12 h-12" priority />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Redefinir sua senha</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Para continuar a recuperação da sua conta, confirme abaixo.
            </p>
          </div>
        </div>
        <Button
          type="button"
          className="w-full"
          disabled={busy}
          onClick={() => void handleContinue()}
        >
          {busy ? "Continuando..." : "Continuar recuperação"}
        </Button>
      </div>
    </div>
  )
}

"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSupabaseClient } from "@/lib/supabase/client"
import { performClientLogout } from "@/lib/auth/logout"
import {
  RECOVERY_INVALID_LINK_BODY,
  RECOVERY_INVALID_LINK_TITLE,
  detectRecoveryUrlError,
  gatePasswordUpdateForm,
  passwordsMatchForUpdate,
} from "@/lib/auth/password-reset"

type View = "loading" | "blocked" | "ready" | "success"

export default function AtualizarSenhaPage() {
  const [view, setView] = useState<View>("loading")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const urlError = detectRecoveryUrlError({
      search: window.location.search,
      hash: window.location.hash,
    })

    if (urlError) {
      setView("blocked")
      return
    }

    const supabase = getSupabaseClient()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (
        session?.user?.id &&
        (event === "PASSWORD_RECOVERY" ||
          event === "SIGNED_IN" ||
          event === "INITIAL_SESSION")
      ) {
        setView("ready")
      }
    })

    void (async () => {
      const { data } = await supabase.auth.getUser()
      if (cancelled) return
      const gate = gatePasswordUpdateForm({
        urlError: null,
        hasAuthenticatedUser: Boolean(data.user?.id),
      })
      setView((current) => {
        if (current === "ready" || current === "success") return current
        return gate.showForm ? "ready" : "blocked"
      })
    })()

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    const match = passwordsMatchForUpdate(password, confirm)
    if (!match.ok) {
      setError(match.message)
      return
    }
    setBusy(true)
    try {
      const supabase = getSupabaseClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setView("blocked")
        return
      }
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError("Não foi possível atualizar a senha. Solicite um novo link.")
        return
      }
      const res = await fetch("/api/auth/complete-first-password-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean } | null
      if (!res.ok || !json?.ok) {
        setError(
          "Senha atualizada no acesso, mas não foi possível liberar o primeiro acesso. Entre e conclua /primeiro-acesso se solicitado."
        )
        return
      }
      await performClientLogout()
      setView("success")
    } catch {
      setError("Não foi possível atualizar a senha. Tente novamente.")
    } finally {
      setBusy(false)
    }
  }

  if (view === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <p className="text-sm text-muted-foreground">Verificando o link de recuperação…</p>
      </div>
    )
  }

  if (view === "blocked") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{RECOVERY_INVALID_LINK_TITLE}</h1>
            <p className="text-sm text-muted-foreground mt-2">{RECOVERY_INVALID_LINK_BODY}</p>
          </div>
          <Button asChild className="w-full">
            <Link href="/recuperar-senha">Solicitar novo link</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (view === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Senha atualizada</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Entre com o e-mail e a nova senha para continuar.
            </p>
          </div>
          <Button asChild className="w-full">
            <Link href="/login">Ir para o login</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Nova senha</h1>
          <p className="text-sm text-muted-foreground">Defina uma senha para acessar sua conta.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirmar senha</Label>
          <Input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
          />
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Salvando..." : "Salvar senha"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Voltar ao login
          </Link>
        </p>
      </form>
    </div>
  )
}

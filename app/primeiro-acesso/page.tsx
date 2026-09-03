"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { TantoBrand } from "@/components/branding/tanto-brand"
import { useAuth } from "@/components/auth/auth-provider"
import { getDashboardHomeForRole } from "@/lib/auth/auth-audit"
import { performClientLogout } from "@/lib/auth/logout"
import { getSupabaseClient } from "@/lib/supabase/client"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import type { UserRole } from "@/types/user"

export default function PrimeiroAcessoPage() {
  const router = useRouter()
  const auth = useAuth()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!auth.ready) return
      if (!auth.profile) {
        router.replace("/login?redirect=%2Fprimeiro-acesso")
        return
      }
      const basics = await getAuthProfileBasicsFromSupabase()
      if (cancelled) return
      if (!basics?.mustChangePassword) {
        router.replace(getDashboardHomeForRole(basics?.role ?? auth.profile.role))
        return
      }
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [auth.ready, auth.profile, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (password.length < 8) {
      setError("A nova senha deve ter pelo menos 8 caracteres.")
      return
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.")
      return
    }

    setSubmitting(true)
    try {
      const supabase = getSupabaseClient()
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      })
      if (updateError) {
        setError(updateError.message || "Não foi possível atualizar a senha.")
        return
      }

      const res = await fetch("/api/auth/complete-first-password-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const json = (await res.json()) as { ok?: boolean; message?: string }
      if (!res.ok || !json.ok) {
        setError(
          json.message ||
            "Senha atualizada no Auth, mas não foi possível liberar o acesso. Tente novamente."
        )
        return
      }

      await auth.refreshProfile()
      const basics = await getAuthProfileBasicsFromSupabase()
      const role = (basics?.role ?? auth.profile?.role ?? null) as UserRole | null
      toast.success("Senha definida com sucesso.")
      router.replace(role ? getDashboardHomeForRole(role) : "/indicador")
      router.refresh()
    } catch {
      setError("Erro temporário. Tente novamente.")
    } finally {
      setSubmitting(false)
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Carregando…
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-8">
        <div className="flex items-center gap-3">
          <TantoBrand variant="symbol" size="lg" className="w-12 h-12" priority />
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Crie sua nova senha
            </h1>
            <p className="text-sm text-muted-foreground">
              Por segurança, defina uma senha pessoal antes de acessar o portal.
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">Nova senha</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirmar nova senha</Label>
            <Input
              id="confirm-password"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              "Definir senha e continuar"
            )}
          </Button>
        </form>

        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground underline"
          onClick={() => {
            void (async () => {
              await performClientLogout()
              await auth.refreshProfile()
              router.replace("/login")
            })()
          }}
        >
          Sair
        </button>
      </div>
    </div>
  )
}

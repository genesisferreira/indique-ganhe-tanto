"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSupabaseClient } from "@/lib/supabase/client"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import { getDashboardHomeForRole } from "@/lib/auth/auth-audit"

export default function AtualizarSenhaPage() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.")
      return
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.")
      return
    }
    setBusy(true)
    try {
      const supabase = getSupabaseClient()
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError("Não foi possível atualizar a senha. Solicite um novo link.")
        return
      }
      const basics = await getAuthProfileBasicsFromSupabase()
      router.replace(basics?.role ? getDashboardHomeForRole(basics.role) : "/login")
    } catch {
      setError("Não foi possível atualizar a senha. Tente novamente.")
    } finally {
      setBusy(false)
    }
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

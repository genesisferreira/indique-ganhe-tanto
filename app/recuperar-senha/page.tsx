"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeft, Mail } from "lucide-react"
import { TantoBrand } from "@/components/branding/tanto-brand"
import { getSupabaseClient } from "@/lib/supabase/client"
import {
  buildPasswordRecoveryRedirectTo,
  normalizeRecoveryEmail,
  passwordResetPublicMessage,
} from "@/lib/auth/password-reset"

export default function RecuperarSenhaPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const form = e.currentTarget as HTMLFormElement
    const email = normalizeRecoveryEmail(String(new FormData(form).get("email") ?? ""))
    setIsLoading(true)
    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: buildPasswordRecoveryRedirectTo(window.location.origin),
      })
      if (error) {
        // Mantém resposta pública neutra; não enumera conta.
      }
    } catch {
      // Resposta sempre neutra — não revelar existência do e-mail.
    } finally {
      setIsLoading(false)
      setSubmitted(true)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar ao login
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <TantoBrand variant="symbol" size="lg" className="w-12 h-12" priority />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Recuperar senha</h1>
            <p className="text-sm text-muted-foreground">
              Enviaremos um link se o e-mail estiver cadastrado.
            </p>
          </div>
        </div>

        {!submitted ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="seu@email.com"
                required
                autoComplete="email"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Enviando..." : "Enviar link de recuperação"}
            </Button>
          </form>
        ) : (
          <div className="text-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-success/10 mx-auto mb-6">
              <Mail className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Verifique seu e-mail</h2>
            <p className="text-muted-foreground mb-6">{passwordResetPublicMessage()}</p>
            <Button variant="outline" asChild className="w-full">
              <Link href="/login">Voltar ao login</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Zap, ArrowLeft, Mail, CheckCircle2 } from "lucide-react"

export default function RecuperarSenhaPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    setIsLoading(false)
    setSubmitted(true)
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
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary">
            <Zap className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Recuperar Senha
            </h1>
            <p className="text-sm text-muted-foreground">
              Enviaremos um link para seu e-mail
            </p>
          </div>
        </div>

        {!submitted ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                required
              />
              <p className="text-xs text-muted-foreground">
                Digite o e-mail cadastrado na sua conta
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Enviando..." : "Enviar Link de Recuperação"}
            </Button>
          </form>
        ) : (
          <div className="text-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-success/10 mx-auto mb-6">
              <Mail className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">
              E-mail Enviado!
            </h2>
            <p className="text-muted-foreground mb-6">
              Verifique sua caixa de entrada e siga as instruções para redefinir
              sua senha.
            </p>
            <div className="space-y-3">
              <Button variant="outline" asChild className="w-full">
                <Link href="/login">Voltar ao Login</Link>
              </Button>
              <button
                onClick={() => setSubmitted(false)}
                className="text-sm text-primary hover:underline"
              >
                Não recebeu? Enviar novamente
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 p-4 rounded-xl bg-card border border-border">
          <h3 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            Dicas de segurança
          </h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>- Use uma senha com pelo menos 8 caracteres</li>
            <li>- Combine letras, números e caracteres especiais</li>
            <li>- Não compartilhe sua senha com ninguém</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

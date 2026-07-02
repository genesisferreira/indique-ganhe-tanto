"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Zap, Eye, EyeOff, ArrowLeft } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/components/auth/auth-provider"
import { getDashboardHomeForRole } from "@/lib/auth/auth-audit"
import {
  getDemoCredentials,
  getDemoDashboardPath,
  type DemoDashboardRole,
} from "@/lib/auth/demo-login"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { performClientLogout } from "@/lib/auth/logout"
import { getSupabaseAuthNetworkHint, getSupabaseClient } from "@/lib/supabase/client"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services/supabase-data.service"
import type { UserRole } from "@/types/user"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const auth = useAuth()
  const [showPassword, setShowPassword] = useState(false)
  const [loginType, setLoginType] = useState<"email" | "telefone">("email")
  const [isLoading, setIsLoading] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  const redirectParam = searchParams.get("redirect")

  const resolvePostLoginPath = (role: UserRole | null): string => {
    if (
      redirectParam &&
      redirectParam.startsWith("/") &&
      !redirectParam.startsWith("//")
    ) {
      return redirectParam
    }
    return role ? getDashboardHomeForRole(role) : "/indicador"
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    if (loginType !== "email") {
      setError("Login por telefone ainda não está disponível.")
      setIsLoading(false)
      return
    }

    try {
      await performClientLogout()

      const supabase = getSupabaseClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError(signInError.message || "Não foi possível fazer login.")
        return
      }

      await auth.refreshProfile()
      const basics = await getAuthProfileBasicsFromSupabase()
      const role = (basics?.role ?? null) as UserRole | null
      router.replace(resolvePostLoginPath(role))
      router.refresh()
    } catch (err) {
      if (process.env.NODE_ENV === "development" && err instanceof Error) {
        console.error("[login] auth:", err.name, err.message)
      }
      const hint = getSupabaseAuthNetworkHint(err)
      setError(hint ?? "Erro inesperado ao autenticar. Tente novamente.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleDemoAccess = async (role: DemoDashboardRole) => {
    setIsLoading(true)
    setError("")

    try {
      await performClientLogout()
      await auth.refreshProfile()

      if (isDataProviderMock()) {
        router.replace(getDemoDashboardPath(role))
        router.refresh()
        return
      }

      const credentials = getDemoCredentials(role)
      if (!credentials) {
        toast.error(
          "Demonstração não configurada. Defina NEXT_PUBLIC_DEMO_* no ambiente ou use login com e-mail e senha."
        )
        return
      }

      const supabase = getSupabaseClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      })

      if (signInError) {
        toast.error(signInError.message || "Não foi possível entrar na demonstração.")
        return
      }

      await auth.refreshProfile()
      const basics = await getAuthProfileBasicsFromSupabase()
      const profileRole = basics?.role ?? null

      if (profileRole && profileRole !== credentials.expectedRole) {
        if (
          role === "admin" &&
          (profileRole === "admin_consulta" ||
            profileRole === "admin_financeiro" ||
            profileRole === "admin_master")
        ) {
          // ok — qualquer perfil admin
        } else if (profileRole !== credentials.expectedRole) {
          toast.error("A conta de demonstração não corresponde ao perfil esperado.")
          await performClientLogout()
          await auth.refreshProfile()
          return
        }
      }

      router.replace(getDemoDashboardPath(role))
      router.refresh()
    } catch (err) {
      const hint = getSupabaseAuthNetworkHint(err)
      toast.error(hint ?? "Erro ao acessar demonstração.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-background">
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar ao início
          </Link>

          <div className="flex items-center gap-3 mb-8">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary">
              <Zap className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Entrar</h1>
              <p className="text-sm text-muted-foreground">
                Acesse sua conta Indique e Ganhe
              </p>
            </div>
          </div>

          <Tabs
            value={loginType}
            onValueChange={(v) => setLoginType(v as "email" | "telefone")}
            className="mb-6"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="email">E-mail</TabsTrigger>
              <TabsTrigger value="telefone">Telefone</TabsTrigger>
            </TabsList>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <TabsContent value="email" className="mt-0">
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </TabsContent>

              <TabsContent value="telefone" className="mt-0">
                <div className="space-y-2">
                  <Label htmlFor="telefone">Telefone</Label>
                  <Input
                    id="telefone"
                    type="tel"
                    placeholder="(11) 99999-9999"
                    required
                  />
                </div>
              </TabsContent>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Senha</Label>
                  <Link
                    href="/recuperar-senha"
                    className="text-sm text-primary hover:underline"
                  >
                    Esqueceu a senha?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Digite sua senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Entrando..." : "Entrar"}
              </Button>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </form>
          </Tabs>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Não tem uma conta?{" "}
              <Link href="/cadastro" className="text-primary hover:underline">
                Cadastre-se
              </Link>
            </p>
          </div>

          <div className="mt-8 p-4 rounded-xl bg-card border border-border">
            <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">
              Links de demonstração
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLoading}
                onClick={() => {
                  void handleDemoAccess("indicador")
                }}
              >
                Indicador
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLoading}
                onClick={() => {
                  void handleDemoAccess("comercial")
                }}
              >
                Comercial
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLoading}
                onClick={() => {
                  void handleDemoAccess("admin")
                }}
              >
                Admin
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex lg:flex-1 relative bg-primary/5 items-center justify-center p-12">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent" />
        <div className="relative max-w-md text-center">
          <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-primary mx-auto mb-8">
            <Zap className="w-10 h-10 text-primary-foreground" />
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Bem-vindo de volta!
          </h2>
          <p className="text-muted-foreground">
            Continue acompanhando suas indicações e ganhos no programa Indique e
            Ganhe da Tanto Telecom.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
          Carregando…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}

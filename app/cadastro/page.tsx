"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Eye, EyeOff, ArrowLeft, CheckCircle2 } from "lucide-react"
import { TantoBrand } from "@/components/branding/tanto-brand"
import {
  buildIndicatorSignupUserMetadata,
  buildSignupEmailRedirectTo,
  classifyIndicatorSignupResult,
  SIGNUP_EXISTING_ACCOUNT_MESSAGE,
  SIGNUP_SESSION_MISMATCH_MESSAGE,
} from "@/lib/auth/indicator-signup"
import { performClientLogout } from "@/lib/auth/logout"
import { getSupabaseAuthNetworkHint, getSupabaseClient } from "@/lib/supabase/client"

const pixTypes = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "telefone", label: "Telefone" },
  { value: "aleatoria", label: "Chave Aleatória" },
]

export default function CadastroPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [step, setStep] = useState(1)
  const [nome, setNome] = useState("")
  const [email, setEmail] = useState("")
  const [telefone, setTelefone] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [tipoPix, setTipoPix] = useState("")
  const [chavePix, setChavePix] = useState("")
  const [error, setError] = useState("")
  const [awaitingEmailConfirmation, setAwaitingEmailConfirmation] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (step === 1) {
      if (password.length < 8) {
        setError("A senha deve ter no mínimo 8 caracteres.")
        return
      }
      if (password !== confirmPassword) {
        setError("As senhas não conferem.")
        return
      }
      setError("")
      setStep(2)
      return
    }

    if (!tipoPix || !chavePix) {
      setError("Informe o tipo e a chave PIX para continuar.")
      return
    }

    setIsLoading(true)
    setError("")
    setAwaitingEmailConfirmation(false)

    try {
      await performClientLogout()

      const supabase = getSupabaseClient()
      const signupMetadata = buildIndicatorSignupUserMetadata({
        fullName: nome,
        phone: telefone,
        pixKeyType: tipoPix,
        pixKeyValue: chavePix,
      })

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: signupMetadata,
          emailRedirectTo: buildSignupEmailRedirectTo(window.location.origin),
        },
      })

      if (signUpError) {
        setError(signUpError.message || "Não foi possível criar a conta.")
        return
      }

      const newUser = signUpData.user
      if (!newUser?.id) {
        setError("Conta criada, mas não foi possível obter o usuário autenticado.")
        return
      }

      const outcome = classifyIndicatorSignupResult(newUser, signUpData.session)

      if (outcome === "existing_account_hint") {
        setError(SIGNUP_EXISTING_ACCOUNT_MESSAGE)
        return
      }

      if (outcome === "session_mismatch") {
        await performClientLogout()
        setError(SIGNUP_SESSION_MISMATCH_MESSAGE)
        return
      }

      if (outcome === "awaiting_email_confirmation") {
        setAwaitingEmailConfirmation(true)
        return
      }

      if (outcome === "authenticated_ready") {
        if (signUpData.session) {
          await supabase.auth.setSession({
            access_token: signUpData.session.access_token,
            refresh_token: signUpData.session.refresh_token,
          })
        }

        router.push("/indicador")
      }
    } catch (err) {
      if (process.env.NODE_ENV === "development" && err instanceof Error) {
        console.error("[cadastro] auth:", err.name, err.message)
      }
      const hint = getSupabaseAuthNetworkHint(err)
      setError(hint ?? "Erro inesperado ao criar conta. Tente novamente.")
    } finally {
      setIsLoading(false)
    }
  }

  if (awaitingEmailConfirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mx-auto">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Cadastro realizado!</h1>
            <p className="text-muted-foreground">
              Enviamos um e-mail de confirmação para você. Clique no link recebido
              para ativar sua conta.
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
    <div className="min-h-screen flex bg-background">
      {/* Left Side - Form */}
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
            <TantoBrand variant="symbol" size="lg" className="w-12 h-12" priority />
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Criar Conta
              </h1>
              <p className="text-sm text-muted-foreground">
                Cadastre-se como indicador
              </p>
            </div>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center gap-4 mb-8">
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= 1
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {step > 1 ? <CheckCircle2 className="w-5 h-5" /> : "1"}
              </div>
              <span className="text-sm font-medium text-foreground">
                Dados Pessoais
              </span>
            </div>
            <div className="flex-1 h-px bg-border" />
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= 2
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                2
              </div>
              <span className="text-sm font-medium text-foreground">
                Chave Pix
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {step === 1 && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="nome">Nome Completo</Label>
                  <Input
                    id="nome"
                    type="text"
                    placeholder="Seu nome completo"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    required
                  />
                </div>

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

                <div className="space-y-2">
                  <Label htmlFor="telefone">Telefone</Label>
                  <Input
                    id="telefone"
                    type="tel"
                    placeholder="(11) 99999-9999"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Mínimo 8 caracteres"
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

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirmar Senha</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirme sua senha"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <Button type="submit" className="w-full">
                  Continuar
                </Button>
              </>
            )}

            {step === 2 && (
              <>
                <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 mb-6">
                  <p className="text-sm text-foreground">
                    <strong>Importante:</strong> A chave Pix é obrigatória para
                    receber suas recompensas. Você poderá alterá-la depois no
                    seu perfil.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tipoPix">Tipo de Chave Pix</Label>
                  <Select value={tipoPix} onValueChange={setTipoPix}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {pixTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="chavePix">Chave Pix</Label>
                  <Input
                    id="chavePix"
                    type="text"
                    placeholder="Digite sua chave Pix"
                    value={chavePix}
                    onChange={(e) => setChavePix(e.target.value)}
                    required
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(1)}
                    className="flex-1"
                  >
                    Voltar
                  </Button>
                  <Button type="submit" className="flex-1" disabled={isLoading}>
                    {isLoading ? "Criando conta..." : "Criar Conta"}
                  </Button>
                </div>
              </>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Já tem uma conta?{" "}
              <Link href="/login" className="text-primary hover:underline">
                Entrar
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* Right Side - Decorative */}
      <div className="hidden lg:flex lg:flex-1 relative bg-primary/5 items-center justify-center p-12">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent" />
        <div className="relative max-w-md text-center">
          <div className="flex items-center justify-center mx-auto mb-8">
            <TantoBrand variant="symbol" size="xl" className="w-20 h-20" />
          </div>
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Comece a ganhar hoje!
          </h2>
          <p className="text-muted-foreground mb-8">
            Cadastre-se gratuitamente e comece a indicar. A cada indicação
            convertida, você recebe recompensas.
          </p>
          <div className="space-y-3 text-left">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card/50 border border-border">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              <span className="text-sm text-foreground">Cadastro gratuito</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card/50 border border-border">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              <span className="text-sm text-foreground">
                Indicações ilimitadas
              </span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-card/50 border border-border">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              <span className="text-sm text-foreground">
                Pagamento via Pix ou desconto
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

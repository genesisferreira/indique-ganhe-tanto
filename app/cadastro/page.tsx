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
import { Zap, Eye, EyeOff, ArrowLeft, CheckCircle2 } from "lucide-react"
import { getSupabaseClient } from "@/lib/supabase/client"

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

    try {
      const supabase = getSupabaseClient()

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signUpError) {
        setError(signUpError.message || "Não foi possível criar a conta.")
        return
      }

      const userId = signUpData.user?.id
      if (!userId) {
        setError("Conta criada, mas não foi possível obter o usuário autenticado.")
        return
      }

      const db = supabase as any

      const { error: profileError } = await db.from("profiles").upsert(
        {
          id: userId,
          full_name: nome,
          email,
          phone: telefone,
          role: "indicador",
          is_active: true,
        },
        { onConflict: "id" }
      )

      if (profileError) {
        setError(profileError.message || "Conta criada, mas houve erro ao salvar perfil.")
        return
      }

      if (tipoPix && chavePix) {
        const { error: pixError } = await db.from("pix_keys").upsert(
          {
            profile_id: userId,
            key_type: tipoPix,
            key_value: chavePix,
            is_primary: true,
          },
          { onConflict: "key_value" }
        )

        if (pixError) {
          setError(pixError.message || "Conta criada, mas houve erro ao salvar chave PIX.")
          return
        }
      }

      router.push("/indicador")
    } catch {
      setError("Erro inesperado ao criar conta. Tente novamente.")
    } finally {
      setIsLoading(false)
    }
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
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary">
              <Zap className="w-7 h-7 text-primary-foreground" />
            </div>
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
          <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-primary mx-auto mb-8">
            <Zap className="w-10 h-10 text-primary-foreground" />
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

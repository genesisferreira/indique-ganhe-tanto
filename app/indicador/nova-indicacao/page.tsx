"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/ui/page-header"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { planos as mockPlanosFallback } from "@/lib/services/mock-data.service"
import {
  fetchActivePlansForIndicador,
  insertIndicadorReferral,
} from "@/lib/services/supabase-data.service"
import type { Plano } from "@/types/plan"
import { CheckCircle2, Wallet, Receipt, Info } from "lucide-react"

export default function NovaIndicacaoPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [planos, setPlanos] = useState<Plano[]>(() =>
    isDataProviderMock() ? mockPlanosFallback : []
  )
  const [selectedPlano, setSelectedPlano] = useState<string>("")
  const [tipoRecompensa, setTipoRecompensa] = useState<"pix" | "desconto">("pix")
  const [nome, setNome] = useState("")
  const [telefone, setTelefone] = useState("")
  const [email, setEmail] = useState("")

  useEffect(() => {
    if (isDataProviderMock()) return
    void (async () => {
      const remote = await fetchActivePlansForIndicador()
      if (remote !== null) {
        setPlanos(remote)
        setSelectedPlano("")
        if (process.env.NODE_ENV === "development") {
          console.log("[supabase-query:debug]", {
            query: "fetchActivePlansForIndicador",
            count: remote.length,
          })
        }
        return
      }
      if (process.env.NODE_ENV === "development") {
        console.warn("[flow-check:debug]", {
          flow: "nova-indicacao-planos",
          ok: false,
          note: "Supabase retornou erro — lista de planos vazia",
        })
      }
    })()
  }, [])

  const planoSelecionado = planos.find((p) => p.id === selectedPlano)
  const valorRecompensaExibido =
    planoSelecionado?.valorRecompensa ?? planoSelecionado?.preco ?? 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!planoSelecionado) return

    setIsLoading(true)
    const rewardTypeDb =
      tipoRecompensa === "pix" ? "pix" : "desconto_fatura"
    const rewardAmount =
      planoSelecionado.valorRecompensa ?? planoSelecionado.preco

    const result = await insertIndicadorReferral({
      referred_name: nome,
      referred_phone: telefone,
      referred_email: email.trim() || null,
      referred_address: null,
      plan_id: planoSelecionado.id,
      reward_type: rewardTypeDb,
      reward_amount: rewardAmount,
    })

    setIsLoading(false)

    if (result.ok) {
      toast.success("Indicação cadastrada com sucesso!")
      router.push("/indicador/indicacoes")
      return
    }

    toast.error(result.message)
  }

  return (
    <div>
      <PageHeader
        title="Nova Indicação"
        description="Cadastre uma nova indicação e ganhe recompensas"
      />

      <form onSubmit={handleSubmit} className="max-w-2xl">
        <div className="rounded-xl border bg-card p-6 space-y-6">
          <h2 className="text-lg font-semibold text-foreground">
            Dados do Indicado
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nome">Nome Completo *</Label>
              <Input
                id="nome"
                type="text"
                placeholder="Nome do indicado"
                required
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone *</Label>
              <Input
                id="telefone"
                type="tel"
                placeholder="(11) 99999-9999"
                required
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="email">E-mail (opcional)</Label>
              <Input
                id="email"
                type="email"
                placeholder="email@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 space-y-6 mt-6">
          <h2 className="text-lg font-semibold text-foreground">
            Plano de Interesse
          </h2>

          <div className="space-y-2">
            <Label htmlFor="plano">Selecione o Plano *</Label>
            <Select value={selectedPlano} onValueChange={setSelectedPlano} required>
              <SelectTrigger>
                <SelectValue placeholder="Escolha um plano" />
              </SelectTrigger>
              <SelectContent>
                {planos.filter((p) => p.ativo).map((plano) => (
                  <SelectItem key={plano.id} value={plano.id}>
                    {plano.nome} - {plano.velocidade} - R${" "}
                    {plano.preco.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}
                    /mês
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {planoSelecionado && (
            <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">
                    Sua recompensa será de R${" "}
                    {valorRecompensaExibido.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Você receberá o valor da primeira mensalidade do plano
                    escolhido após o indicado pagar a primeira fatura.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card p-6 space-y-6 mt-6">
          <h2 className="text-lg font-semibold text-foreground">
            Tipo de Recompensa
          </h2>

          <RadioGroup
            value={tipoRecompensa}
            onValueChange={(v) => setTipoRecompensa(v as "pix" | "desconto")}
            className="grid gap-4 sm:grid-cols-2"
          >
            <Label
              htmlFor="pix"
              className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                tipoRecompensa === "pix"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <RadioGroupItem value="pix" id="pix" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Wallet className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">Via Pix</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Receba o valor diretamente na sua chave Pix cadastrada. Saque
                  mínimo de R$ 100,00.
                </p>
              </div>
            </Label>

            <Label
              htmlFor="desconto"
              className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                tipoRecompensa === "desconto"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <RadioGroupItem value="desconto" id="desconto" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Receipt className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">
                    Desconto na Fatura
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  O valor será creditado como desconto na sua próxima fatura da
                  Tanto Telecom.
                </p>
              </div>
            </Label>
          </RadioGroup>
        </div>

        <div className="flex items-center gap-4 mt-8">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={isLoading || !selectedPlano}>
            {isLoading ? (
              "Cadastrando..."
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Cadastrar Indicação
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}

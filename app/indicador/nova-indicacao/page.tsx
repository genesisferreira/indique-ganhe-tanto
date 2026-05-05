"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
import { planos } from "@/lib/services/mock-data.service"
import { CheckCircle2, Wallet, Receipt, Info } from "lucide-react"

export default function NovaIndicacaoPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [selectedPlano, setSelectedPlano] = useState<string>("")
  const [tipoRecompensa, setTipoRecompensa] = useState<"pix" | "desconto">("pix")

  const planoSelecionado = planos.find((p) => p.id === selectedPlano)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    router.push("/indicador/indicacoes")
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
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="telefone">Telefone *</Label>
              <Input
                id="telefone"
                type="tel"
                placeholder="(11) 99999-9999"
                required
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="email">E-mail (opcional)</Label>
              <Input
                id="email"
                type="email"
                placeholder="email@exemplo.com"
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
                    {planoSelecionado.preco.toLocaleString("pt-BR", {
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

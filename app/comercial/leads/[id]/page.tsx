"use client"

import { use, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { leads, historicos } from "@/lib/mock-data"
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  Zap,
  Calendar,
  Clock,
  MessageSquare,
  Send,
} from "lucide-react"
import type { LeadStatus } from "@/types"

const statusOptions = [
  { value: "novo", label: "Novo" },
  { value: "em_atendimento", label: "Em Atendimento" },
  { value: "em_negociacao", label: "Em Negociação" },
  { value: "vendido", label: "Vendido" },
  { value: "perdido", label: "Perdido" },
]

export default function DetalheLeadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const lead = leads.find((l) => l.id === id)
  const [novaObservacao, setNovaObservacao] = useState("")
  const [status, setStatus] = useState<LeadStatus>(lead?.status || "novo")

  if (!lead || !lead.indicacao) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground mb-4">Lead não encontrado</p>
        <Button asChild>
          <Link href="/comercial/leads">Voltar</Link>
        </Button>
      </div>
    )
  }

  const leadHistorico = historicos.filter((h) => h.leadId === lead.id)
  const indicacao = lead.indicacao
  const plano = indicacao.plano
  const indicador = indicacao.indicador

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/comercial/leads"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para leads
        </Link>
      </div>

      <PageHeader
        title={indicacao.nomeIndicado}
        description={`Lead #${lead.id}`}
      >
        <StatusBadge status={lead.status} />
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contact Info */}
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Informações de Contato
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Nome</p>
                  <p className="font-medium text-foreground">
                    {indicacao.nomeIndicado}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Phone className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Telefone</p>
                  <a
                    href={`tel:${indicacao.telefoneIndicado}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {indicacao.telefoneIndicado}
                  </a>
                </div>
              </div>
              {indicacao.emailIndicado && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">E-mail</p>
                    <a
                      href={`mailto:${indicacao.emailIndicado}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {indicacao.emailIndicado}
                    </a>
                  </div>
                </div>
              )}
              {plano && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Plano de Interesse
                    </p>
                    <p className="font-medium text-foreground">
                      {plano.nome} - R${" "}
                      {plano.preco.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}
                      /mês
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="flex gap-3 mt-6 pt-6 border-t border-border">
              <Button className="flex-1">
                <Phone className="w-4 h-4 mr-2" />
                Ligar
              </Button>
              <Button variant="outline" className="flex-1">
                <MessageSquare className="w-4 h-4 mr-2" />
                WhatsApp
              </Button>
            </div>
          </div>

          {/* Add Observation */}
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Adicionar Observação
            </h2>
            <div className="space-y-4">
              <Textarea
                placeholder="Digite uma observação sobre o atendimento..."
                value={novaObservacao}
                onChange={(e) => setNovaObservacao(e.target.value)}
                rows={3}
              />
              <div className="flex items-center gap-4">
                <div className="flex-1 flex items-center gap-2">
                  <Label className="text-sm text-muted-foreground">
                    Agendar retorno:
                  </Label>
                  <Input type="datetime-local" className="w-auto" />
                </div>
                <Button disabled={!novaObservacao.trim()}>
                  <Send className="w-4 h-4 mr-2" />
                  Salvar
                </Button>
              </div>
            </div>
          </div>

          {/* History */}
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Histórico de Atendimento
            </h2>
            {leadHistorico.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                Nenhum registro de atendimento
              </p>
            ) : (
              <div className="space-y-4">
                {leadHistorico.map((hist) => (
                  <div
                    key={hist.id}
                    className="flex gap-4 p-4 rounded-lg bg-muted/30"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold shrink-0">
                      {hist.comercial?.nome.charAt(0) || "?"}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-foreground">
                          {hist.acao}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {hist.createdAt.toLocaleDateString("pt-BR")} às{" "}
                          {hist.createdAt.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {hist.descricao}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status */}
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Atualizar Status
            </h2>
            <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="w-full mt-4">Salvar Status</Button>
          </div>

          {/* Indicador */}
          {indicador && (
            <div className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">
                Indicado por
              </h2>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                  {indicador.nome.charAt(0)}
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    {indicador.nome}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {indicador.telefone}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Timing */}
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Datas
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  <span>Criado em</span>
                </div>
                <span className="text-foreground">
                  {lead.createdAt.toLocaleDateString("pt-BR")}
                </span>
              </div>
              {lead.primeiroContato && (
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span>1 Contato</span>
                  </div>
                  <span className="text-foreground">
                    {lead.primeiroContato.toLocaleDateString("pt-BR")}
                  </span>
                </div>
              )}
              {lead.retornoAgendado && (
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-warning">
                    <Clock className="w-4 h-4" />
                    <span>Retorno</span>
                  </div>
                  <span className="text-warning font-medium">
                    {lead.retornoAgendado.toLocaleDateString("pt-BR")}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

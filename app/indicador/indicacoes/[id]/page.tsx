"use client"

import { use, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { indicacoes } from "@/lib/services/mock-data.service"
import { loadIndicadorReferralDetailFromSupabase } from "@/lib/services/supabase-data.service"
import type { Indicacao } from "@/types/referral"
import {
  ArrowLeft,
  User,
  Phone,
  Mail,
  Zap,
  Calendar,
  Wallet,
  Receipt,
  CheckCircle2,
  Clock,
} from "lucide-react"

function statusEmFluxo(s: Indicacao["status"]) {
  return (
    s === "em_andamento" ||
    s === "em_atendimento" ||
    s === "em_negociacao"
  )
}

export default function DetalheIndicacaoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

  const mockIndicacao = useMemo(
    () => indicacoes.find((i) => i.id === id),
    [id]
  )

  const [indicacao, setIndicacao] = useState<Indicacao | undefined>(
    () => mockIndicacao
  )
  const [ready, setReady] = useState(() => Boolean(mockIndicacao))

  useEffect(() => {
    setIndicacao(mockIndicacao)
    setReady(Boolean(mockIndicacao))
  }, [id, mockIndicacao])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await loadIndicadorReferralDetailFromSupabase(id)
      if (cancelled) return
      if (r.kind === "ok") setIndicacao(r.indicacao)
      else if (r.kind === "not-found") setIndicacao(undefined)
      else setIndicacao(mockIndicacao)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [id, mockIndicacao])

  if (!ready && !indicacao) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    )
  }

  if (!indicacao) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground mb-4">Indicação não encontrada</p>
        <Button asChild>
          <Link href="/indicador/indicacoes">Voltar</Link>
        </Button>
      </div>
    )
  }

  const timeline = [
    {
      title: "Indicação Cadastrada",
      date: indicacao.createdAt,
      completed: true,
      icon: CheckCircle2,
    },
    {
      title: "Lead Atribuído",
      date: indicacao.comercialId ? indicacao.createdAt : null,
      completed: !!indicacao.comercialId,
      icon: User,
    },
    {
      title: "Em Negociação",
      date: statusEmFluxo(indicacao.status) ? indicacao.updatedAt : null,
      completed:
        statusEmFluxo(indicacao.status) ||
        indicacao.status === "aprovada" ||
        indicacao.status === "paga",
      icon: Clock,
    },
    {
      title: "Venda Realizada",
      date: indicacao.dataAprovacao || null,
      completed:
        indicacao.status === "aprovada" || indicacao.status === "paga",
      icon: CheckCircle2,
    },
    {
      title: "Recompensa Liberada",
      date: indicacao.status === "paga" ? indicacao.updatedAt : null,
      completed: indicacao.status === "paga",
      icon: Wallet,
    },
  ]

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/indicador/indicacoes"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para indicações
        </Link>
      </div>

      <PageHeader
        title={indicacao.nomeIndicado}
        description={`Indicação #${indicacao.id}`}
      >
        <StatusBadge status={indicacao.status} />
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Dados do Indicado */}
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Dados do Indicado
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
                  <p className="font-medium text-foreground">
                    {indicacao.telefoneIndicado}
                  </p>
                </div>
              </div>
              {indicacao.emailIndicado && (
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Mail className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">E-mail</p>
                    <p className="font-medium text-foreground">
                      {indicacao.emailIndicado}
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Data da Indicação
                  </p>
                  <p className="font-medium text-foreground">
                    {indicacao.createdAt.toLocaleDateString("pt-BR")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {indicacao.observacoes ? (
            <div className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Observações
              </h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {indicacao.observacoes}
              </p>
            </div>
          ) : null}

          {/* Plano */}
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Plano de Interesse
            </h2>
            <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/30">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">
                  {indicacao.plano?.nome || "Plano"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {indicacao.plano?.velocidade || "-"} -{" "}
                  {indicacao.plano?.descricao || "-"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-primary">
                  R${" "}
                  {(indicacao.plano?.preco || 0).toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}
                </p>
                <p className="text-xs text-muted-foreground">/mês</p>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Histórico
            </h2>
            <div className="space-y-4">
              {timeline.map((item, index) => (
                <div key={index} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        item.completed
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <item.icon className="w-4 h-4" />
                    </div>
                    {index < timeline.length - 1 && (
                      <div
                        className={`w-0.5 flex-1 mt-2 ${
                          item.completed ? "bg-primary" : "bg-muted"
                        }`}
                      />
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <p
                      className={`font-medium ${
                        item.completed
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {item.title}
                    </p>
                    {item.date && (
                      <p className="text-sm text-muted-foreground">
                        {item.date.toLocaleDateString("pt-BR")} às{" "}
                        {item.date.toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Recompensa */}
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Recompensa
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Valor</span>
                <span className="text-2xl font-bold text-primary">
                  R${" "}
                  {indicacao.valorRecompensa.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tipo</span>
                <div className="flex items-center gap-2">
                  {indicacao.tipoRecompensa === "pix" ? (
                    <>
                      <Wallet className="w-4 h-4 text-primary" />
                      <span className="font-medium text-foreground">Pix</span>
                    </>
                  ) : (
                    <>
                      <Receipt className="w-4 h-4 text-primary" />
                      <span className="font-medium text-foreground">
                        Desconto
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <StatusBadge status={indicacao.status} />
              </div>
            </div>
            {indicacao.status === "pendente" && (
              <p className="mt-4 p-3 rounded-lg bg-warning/10 text-warning text-sm">
                Aguardando atribuição a um vendedor.
              </p>
            )}
            {statusEmFluxo(indicacao.status) && (
              <p className="mt-4 p-3 rounded-lg bg-info/10 text-info text-sm">
                Vendedor em contato com o indicado.
              </p>
            )}
            {indicacao.status === "aprovada" && (
              <p className="mt-4 p-3 rounded-lg bg-success/10 text-success text-sm">
                Venda realizada! Aguardando primeira fatura.
              </p>
            )}
          </div>

          {/* Vendedor */}
          {indicacao.comercial && (
            <div className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">
                Vendedor Responsável
              </h2>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                  {indicacao.comercial.nome.charAt(0)}
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    {indicacao.comercial.nome}
                  </p>
                  <p className="text-sm text-muted-foreground">Comercial</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

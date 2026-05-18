"use client"

import { use, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
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
import {
  emitReferralDataMutated,
  subscribeReferralDataMutated,
} from "@/lib/client/referral-data-sync"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  REALTIME_TABLES_COMERCIAL,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { leads, historicos } from "@/lib/services/mock-data.service"
import {
  canConfirmFirstInvoice,
  ensureRewardForReferralFromSupabase,
  getAuthProfileBasicsFromSupabase,
  loadComercialLeadDetailsFromSupabase,
  markFirstInvoiceAsPaidFromSupabase,
  updateComercialLeadStatus,
  type ComercialLeadUpdateStatus,
} from "@/lib/services/supabase-data.service"
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
import type { Lead, LeadStatus, Historico } from "@/types"
import type { UserRole } from "@/types/user"

const statusOptions = [
  { value: "em_atendimento", label: "Em Atendimento" },
  { value: "aguardando_instalacao", label: "Aguardando Instalação" },
  { value: "vendido", label: "Vendido" },
  { value: "recusado", label: "Recusado" },
  { value: "sem_viabilidade", label: "Sem Viabilidade" },
]

function mapLeadStatusToUpdateStatus(
  leadStatus: LeadStatus
): ComercialLeadUpdateStatus {
  switch (leadStatus) {
    case "em_atendimento":
      return "em_atendimento"
    case "em_negociacao":
      return "aguardando_instalacao"
    case "vendido":
      return "vendido"
    case "perdido":
      return "sem_viabilidade"
    default:
      return "em_atendimento"
  }
}

export default function DetalheLeadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const mockLead = useMemo(
    () => (isDataProviderMock() ? leads.find((l) => l.id === id) : undefined),
    [id]
  )
  const [lead, setLead] = useState<Lead | undefined>(undefined)
  const [novaObservacao, setNovaObservacao] = useState("")
  const [status, setStatus] = useState<ComercialLeadUpdateStatus>("em_atendimento")
  const [isSaving, setIsSaving] = useState(false)
  const [isConfirmingFirstInvoice, setIsConfirmingFirstInvoice] = useState(false)
  const [authRole, setAuthRole] = useState<UserRole | null>(null)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [leadHistorico, setLeadHistorico] = useState<Historico[]>([])
  const [pageLoading, setPageLoading] = useState(() => !isDataProviderMock())

  const podeEditarStatusComercial = authRole === "comercial"

  const reloadLeadData = useCallback(async () => {
    const remote = await loadComercialLeadDetailsFromSupabase(id)
    if (remote.kind !== "ok") return false

    setLead(structuredClone(remote.lead))
    setStatus(mapLeadStatusToUpdateStatus(remote.lead.status))
    setLeadHistorico([...remote.historico])
    return true
  }, [id])

  const refreshAfterMutation = useCallback(async () => {
    const ok = await reloadLeadData()
    emitReferralDataMutated()
    router.refresh()
    return ok
  }, [reloadLeadData, router])

  useEffect(() => {
    return subscribeReferralDataMutated(() => {
      void reloadLeadData()
    })
  }, [reloadLeadData])

  useRealtimeReload(
    () => {
      void reloadLeadData()
    },
    REALTIME_TABLES_COMERCIAL,
    { enabled: !isDataProviderMock() }
  )

  const patchLeadFirstInvoicePaid = useCallback(() => {
    setLead((prev) => {
      if (!prev?.indicacao) return prev
      const now = new Date()
      return {
        ...prev,
        indicacao: {
          ...prev.indicacao,
          primeiraFaturaPaga: true,
          dataPrimeiraFaturaPaga: now,
          status: "paga",
          updatedAt: now,
        },
      }
    })
  }, [])

  const handleConfirmFirstInvoice = async () => {
    if (!lead || isConfirmingFirstInvoice) return
    setIsConfirmingFirstInvoice(true)
    const ensureReward = await ensureRewardForReferralFromSupabase(lead.indicacaoId, {
      actorProfileId: authUserId,
    })
    if (!ensureReward.ok) {
      toast.error(ensureReward.message)
      setIsConfirmingFirstInvoice(false)
      return
    }
    const result = await markFirstInvoiceAsPaidFromSupabase(lead.indicacaoId)
    if (!result.ok) {
      toast.error(result.message)
      setIsConfirmingFirstInvoice(false)
      return
    }
    patchLeadFirstInvoicePaid()
    try {
      const reloadOk = await refreshAfterMutation()
      if (!reloadOk) {
        toast.error("Operação concluída, mas não foi possível atualizar a visualização.")
        return
      }
      toast.success("Primeira mensalidade confirmada e recompensa liberada.")
    } finally {
      setIsConfirmingFirstInvoice(false)
    }
  }

  const handleSaveLeadUpdate = async () => {
    if (!lead) return
    if (isSaving) return

    setIsSaving(true)
    const result = await updateComercialLeadStatus(lead.id, status, novaObservacao)
    if (!result.ok) {
      toast.error(result.message)
      setIsSaving(false)
      return
    }

    const leadStatusMap: Partial<Record<ComercialLeadUpdateStatus, LeadStatus>> = {
      em_atendimento: "em_atendimento",
      aguardando_instalacao: "em_negociacao",
      vendido: "vendido",
      recusado: "perdido",
      sem_viabilidade: "perdido",
    }
    const nextLeadStatus = leadStatusMap[status]
    if (nextLeadStatus) {
      setLead((prev) =>
        prev
          ? {
              ...prev,
              status: nextLeadStatus,
              updatedAt: new Date(),
            }
          : prev
      )
    }

    const reloadOk = await refreshAfterMutation()
    if (!reloadOk) {
      toast.error("Status salvo, mas não foi possível atualizar a visualização.")
      setIsSaving(false)
      return
    }

    setNovaObservacao("")
    toast.success("Lead atualizado com sucesso!")
    setIsSaving(false)
  }

  useEffect(() => {
    if (isDataProviderMock()) {
      setLead(mockLead)
      setStatus(mapLeadStatusToUpdateStatus(mockLead?.status || "novo"))
      setLeadHistorico(historicos.filter((h) => h.leadId === id))
      setPageLoading(false)
      return
    }
    setPageLoading(true)
    setLead(undefined)
    setLeadHistorico([])
    void (async () => {
      const ok = await reloadLeadData()
      if (!ok) setLead(undefined)
      setPageLoading(false)
      if (process.env.NODE_ENV === "development") {
        console.log("[flow-check:debug]", {
          flow: "comercial-lead-detail",
          id,
          result: ok ? "ok" : "error",
        })
      }
    })()
  }, [id, mockLead, reloadLeadData])

  useEffect(() => {
    void (async () => {
      const basics = await getAuthProfileBasicsFromSupabase()
      setAuthRole(basics?.role ?? null)
      setAuthUserId(basics?.id ?? null)
      if (process.env.NODE_ENV === "development") {
        console.log("[permission-check:debug]", {
          page: "/comercial/leads/[id]",
          role: basics?.role ?? null,
          authUserId: basics?.id ?? null,
          podeEditarStatusComercial: basics?.role === "comercial",
        })
      }
    })()
  }, [])

  if (pageLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    )
  }

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

  const indicacao = lead.indicacao
  const plano = indicacao.plano
  const indicador = indicacao.indicador

  const commercialProfileId =
    lead.comercialId ?? indicacao.comercialId ?? null

  const canConfirmFirstInvoiceAction = canConfirmFirstInvoice({
    role: authRole,
    authUserId,
    commercialProfileId,
  })

  const aptoConfirmarPrimeiraMensalidade =
    Boolean(lead.indicacaoId) && !indicacao.primeiraFaturaPaga

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
                <Button
                  disabled={!novaObservacao.trim() || isSaving}
                  onClick={() => {
                    void handleSaveLeadUpdate()
                  }}
                >
                  <Send className="w-4 h-4 mr-2" />
                  {isSaving ? "Salvando..." : "Salvar"}
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
          {/* Status — apenas comercial atribuído pode alterar fluxo comercial */}
          {podeEditarStatusComercial && (
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Atualizar Status
            </h2>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as ComercialLeadUpdateStatus)}
            >
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
            <Button
              className="w-full mt-4"
              disabled={isSaving}
              onClick={() => {
                void handleSaveLeadUpdate()
              }}
            >
              {isSaving ? "Salvando..." : "Salvar Status"}
            </Button>
          </div>
          )}

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

          {/* Primeira mensalidade */}
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Primeira mensalidade
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              {indicacao.primeiraFaturaPaga && indicacao.dataPrimeiraFaturaPaga
                ? `Paga em ${indicacao.dataPrimeiraFaturaPaga.toLocaleDateString("pt-BR")}`
                : indicacao.primeiraFaturaPaga
                  ? "Paga (data não registrada)"
                  : "Pendente"}
            </p>
            {canConfirmFirstInvoiceAction && aptoConfirmarPrimeiraMensalidade ? (
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={isConfirmingFirstInvoice}
                  onClick={() => {
                    void handleConfirmFirstInvoice()
                  }}
                >
                  {isConfirmingFirstInvoice
                    ? "Confirmando..."
                    : "Primeira mensalidade paga"}
                </Button>
              ) : null}
          </div>

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

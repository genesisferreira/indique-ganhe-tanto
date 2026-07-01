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
  LOST_REASON_OPTIONS,
  isComercialLeadRejectStatus,
} from "@/lib/referral-lost-reasons"
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
import { ReferralInterestedFields } from "@/components/referral/referral-interested-fields"
import { getReferralContractTypeLabel } from "@/lib/referral-contract-type"
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
  const [lostReason, setLostReason] = useState("")
  const [lostNotes, setLostNotes] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [isConfirmingFirstInvoice, setIsConfirmingFirstInvoice] = useState(false)
  const [authRole, setAuthRole] = useState<UserRole | null>(null)
  const [authUserId, setAuthUserId] = useState<string | null>(null)
  const [leadHistorico, setLeadHistorico] = useState<Historico[]>([])
  const [pageLoading, setPageLoading] = useState(() => !isDataProviderMock())
  const [loadKind, setLoadKind] = useState<
    "ok" | "not-found" | "unauthorized" | "error" | null
  >(null)
  const [loadMessage, setLoadMessage] = useState<string>("")

  const podeEditarStatusComercial = authRole === "comercial"

  const reloadLeadData = useCallback(async () => {
    const remote = await loadComercialLeadDetailsFromSupabase(id)
    if (remote.kind === "ok") {
      setLoadKind("ok")
      setLoadMessage("")
      setLead(structuredClone(remote.lead))
      setStatus(mapLeadStatusToUpdateStatus(remote.lead.status))
      setLeadHistorico([...remote.historico])
      return true
    }

    setLead(undefined)
    setLeadHistorico([])
    setLoadKind(remote.kind)
    setLoadMessage(
      remote.kind === "error"
        ? remote.message
        : remote.kind === "unauthorized"
          ? remote.message
          : remote.kind === "not-found"
            ? remote.message ?? "Lead não encontrado."
            : ""
    )

    if (remote.kind === "error") {
      console.error("[commercial-lead-detail:error]", remote)
      toast.error(remote.message)
    } else if (remote.kind === "unauthorized") {
      console.error("[commercial-lead-detail:error]", remote)
      toast.error(remote.message)
    }

    return false
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
    const result = await updateComercialLeadStatus(lead.id, status, {
      note: novaObservacao,
      lostReason: isComercialLeadRejectStatus(status) ? lostReason : undefined,
      lostNotes: isComercialLeadRejectStatus(status) ? lostNotes : undefined,
    })
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

  if (loadKind === "unauthorized") {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-muted-foreground text-center max-w-md">
          {loadMessage || "Lead não autorizado para este comercial."}
        </p>
        <Button asChild>
          <Link href="/comercial/leads">Voltar para leads</Link>
        </Button>
      </div>
    )
  }

  if (loadKind === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-muted-foreground text-center max-w-md">
          {loadMessage || "Não foi possível carregar o lead."}
        </p>
        <Button asChild>
          <Link href="/comercial/leads">Voltar para leads</Link>
        </Button>
      </div>
    )
  }

  if (!lead || !lead.indicacao || loadKind === "not-found") {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-muted-foreground text-center max-w-md">
          {loadMessage || "Lead não encontrado"}
        </p>
        <Button asChild>
          <Link href="/comercial/leads">Voltar</Link>
        </Button>
      </div>
    )
  }

  const indicacao = lead.indicacao
  const plano = indicacao.plano
  const indicador = indicacao.indicador
  const indicadorNome =
    indicador?.nome?.trim() || "Indicador não identificado"
  const exigeMotivoRecusa = isComercialLeadRejectStatus(status)
  const podeSalvarStatus =
    !isSaving && (!exigeMotivoRecusa || Boolean(lostReason.trim()))

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
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {getReferralContractTypeLabel(indicacao.tipoContratacao, {
                        legacyFallback: indicacao.tipoContratacao
                          ? "tanto_vantagens"
                          : "nao_informado",
                      })}
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

          <ReferralInterestedFields indicacao={indicacao} />

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
              onValueChange={(v) => {
                const next = v as ComercialLeadUpdateStatus
                setStatus(next)
                if (!isComercialLeadRejectStatus(next)) {
                  setLostReason("")
                  setLostNotes("")
                }
              }}
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
            {exigeMotivoRecusa ? (
              <div className="mt-4 space-y-3">
                <div className="space-y-2">
                  <Label>Motivo da recusa / perda *</Label>
                  <Select value={lostReason || undefined} onValueChange={setLostReason}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o motivo" />
                    </SelectTrigger>
                    <SelectContent>
                      {LOST_REASON_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Observação (opcional)</Label>
                  <Textarea
                    placeholder="Detalhes adicionais sobre a recusa..."
                    value={lostNotes}
                    onChange={(e) => setLostNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            ) : null}
            <Button
              className="w-full mt-4"
              disabled={!podeSalvarStatus}
              onClick={() => {
                void handleSaveLeadUpdate()
              }}
            >
              {isSaving ? "Salvando..." : "Salvar Status"}
            </Button>
          </div>
          )}

          {/* Indicador */}
          <div className="rounded-xl border bg-card p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Indicado por
            </h2>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                {indicadorNome.charAt(0)}
              </div>
              <div>
                <p className="font-medium text-foreground">{indicadorNome}</p>
                <p className="text-sm text-muted-foreground">
                  {indicador?.telefone?.trim() || "—"}
                </p>
                {indicador?.email ? (
                  <p className="text-xs text-muted-foreground">{indicador.email}</p>
                ) : null}
              </div>
            </div>
          </div>

          {(lead.status === "perdido" || indicacao.status === "recusada") &&
          (indicacao.motivoRecusa || indicacao.observacoesRecusa) ? (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-6">
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Motivo da recusa
              </h2>
              {indicacao.motivoRecusa ? (
                <p className="text-sm text-foreground">{indicacao.motivoRecusa}</p>
              ) : null}
              {indicacao.observacoesRecusa ? (
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                  {indicacao.observacoesRecusa}
                </p>
              ) : null}
            </div>
          ) : null}

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

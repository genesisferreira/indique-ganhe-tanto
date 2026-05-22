"use client"

import { use, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  LOST_REASON_OPTIONS,
  isIndicacaoRejectedStatus,
} from "@/lib/referral-lost-reasons"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { indicacoes, comerciais } from "@/lib/services/mock-data.service"
import {
  assignReferralToCommercialFromSupabase,
  canConfirmFirstInvoice,
  getAuthProfileBasicsFromSupabase,
  loadAdminComerciaisFromSupabase,
  loadAdminReferralDetailFromSupabase,
  ensureRewardForReferralFromSupabase,
  markFirstInvoiceAsPaidFromSupabase,
  updateAdminReferralStatusFromSupabase,
} from "@/lib/services"
import type { Historico } from "@/types/lead"
import type { Comercial } from "@/types/profile"
import type { Indicacao, IndicacaoStatus } from "@/types/referral"
import type { UserRole } from "@/types/user"
import {
  emitReferralDataMutated,
  subscribeReferralDataMutated,
} from "@/lib/client/referral-data-sync"
import {
  REALTIME_TABLES_ADMIN,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { ArrowLeft, Calendar, Mail, Phone, User } from "lucide-react"

const STATUS_OPTIONS: IndicacaoStatus[] = [
  "pendente",
  "em_atendimento",
  "em_negociacao",
  "em_andamento",
  "aprovada",
  "recusada",
]

export default function AdminIndicacaoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()

  const mockIndicacao = useMemo(
    () => (isDataProviderMock() ? indicacoes.find((i) => i.id === id) : undefined),
    [id]
  )

  const [indicacao, setIndicacao] = useState<Indicacao | undefined>(undefined)
  const [historico, setHistorico] = useState<Historico[]>([])
  const [ready, setReady] = useState(false)
  const [role, setRole] = useState<UserRole | null>(null)
  const [comerciaisLista, setComerciaisLista] = useState<Comercial[]>([])
  const [selectedComercialId, setSelectedComercialId] = useState<string>("")
  const [selectedStatus, setSelectedStatus] = useState<IndicacaoStatus | "">("")
  const [lostReason, setLostReason] = useState("")
  const [lostNotes, setLostNotes] = useState("")
  const [savingAssign, setSavingAssign] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [isConfirmingFirstInvoice, setIsConfirmingFirstInvoice] = useState(false)
  const [authUserId, setAuthUserId] = useState<string | null>(null)

  const canMutate = role === "admin_master" || role === "admin_financeiro"

  const reloadReferral = useCallback(async (): Promise<boolean> => {
    if (isDataProviderMock()) {
      setIndicacao(mockIndicacao)
      setHistorico([])
      setReady(true)
      return true
    }
    const [detail, basics] = await Promise.all([
      loadAdminReferralDetailFromSupabase(id),
      getAuthProfileBasicsFromSupabase(),
    ])
    const r = basics?.role ?? null
    setRole(r)
    setAuthUserId(basics?.id ?? null)
    const mut = r === "admin_master" || r === "admin_financeiro"
    const comRemoto = mut ? await loadAdminComerciaisFromSupabase() : null

    if (detail.kind === "ok") {
      setIndicacao(structuredClone(detail.indicacao))
      setHistorico([...detail.historico])
      if (comRemoto) setComerciaisLista([...comRemoto])
      setReady(true)
      return true
    }

    setIndicacao(undefined)
    setHistorico([])
    if (comRemoto) setComerciaisLista([...comRemoto])
    setReady(true)
    return false
  }, [id, mockIndicacao])

  useEffect(() => {
    if (isDataProviderMock()) {
      void reloadReferral()
      return
    }
    setReady(false)
    void reloadReferral()
  }, [reloadReferral])

  const refreshAfterMutation = useCallback(async () => {
    const ok = await reloadReferral()
    emitReferralDataMutated()
    router.refresh()
    return ok
  }, [reloadReferral, router])

  const patchIndicacaoFirstInvoicePaid = useCallback(() => {
    setIndicacao((prev) => {
      if (!prev) return prev
      const now = new Date()
      return {
        ...prev,
        primeiraFaturaPaga: true,
        dataPrimeiraFaturaPaga: now,
        status: "paga",
        updatedAt: now,
      }
    })
  }, [])

  useEffect(() => {
    return subscribeReferralDataMutated(() => {
      void reloadReferral()
    })
  }, [reloadReferral])

  useRealtimeReload(
    () => {
      void reloadReferral()
    },
    REALTIME_TABLES_ADMIN,
    { enabled: !isDataProviderMock() }
  )

  const handleAssign = async () => {
    if (!selectedComercialId || !indicacao) return
    setSavingAssign(true)
    const comercial = comerciaisLista.find((c) => c.id === selectedComercialId)
    try {
      setIndicacao((prev) =>
        prev
          ? {
              ...prev,
              comercialId: selectedComercialId,
              comercial: comercial ?? prev.comercial,
              updatedAt: new Date(),
            }
          : prev
      )
      const r = await assignReferralToCommercialFromSupabase(
        indicacao.id,
        selectedComercialId
      )
      if (r.ok) {
        toast.success("Comercial atribuído.")
        setSelectedComercialId("")
        await refreshAfterMutation()
      } else {
        toast.error(r.message)
        await reloadReferral()
      }
    } finally {
      setSavingAssign(false)
    }
  }

  const handleConfirmFirstInvoice = async () => {
    if (!indicacao || isConfirmingFirstInvoice || isDataProviderMock()) return
    console.log("[admin:first-invoice] click")
    setIsConfirmingFirstInvoice(true)
    const ensureReward = await ensureRewardForReferralFromSupabase(indicacao.id, {
      actorProfileId: authUserId,
    })
    if (!ensureReward.ok) {
      toast.error(ensureReward.message)
      setIsConfirmingFirstInvoice(false)
      return
    }
    const result = await markFirstInvoiceAsPaidFromSupabase(indicacao.id)
    console.log("[admin:first-invoice] result", result)
    if (!result.ok) {
      toast.error(result.message)
      setIsConfirmingFirstInvoice(false)
      return
    }
    patchIndicacaoFirstInvoicePaid()
    try {
      console.log("[admin:first-invoice] refreshing")
      const reloadOk = await refreshAfterMutation()
      console.log("[admin:first-invoice] done", { reloadOk })
      if (!reloadOk) {
        toast.error(
          "Operação concluída, mas não foi possível atualizar a visualização."
        )
        return
      }
      toast.success("Primeira mensalidade confirmada e recompensa liberada.")
    } finally {
      setIsConfirmingFirstInvoice(false)
    }
  }

  const handleStatus = async () => {
    if (!selectedStatus || !indicacao) return
    if (selectedStatus === "recusada" && !lostReason.trim()) {
      toast.error("Selecione o motivo da recusa.")
      return
    }
    setSavingStatus(true)
    const novoStatus = selectedStatus
    try {
      setIndicacao((prev) =>
        prev
          ? { ...prev, status: novoStatus, updatedAt: new Date() }
          : prev
      )
      const r = await updateAdminReferralStatusFromSupabase(indicacao.id, novoStatus, {
        lostReason: novoStatus === "recusada" ? lostReason : undefined,
        lostNotes: novoStatus === "recusada" ? lostNotes : undefined,
      })
      if (r.ok) {
        toast.success("Status atualizado.")
        setSelectedStatus("")
        setLostReason("")
        setLostNotes("")
        await refreshAfterMutation()
      } else {
        toast.error(r.message)
        await reloadReferral()
      }
    } finally {
      setSavingStatus(false)
    }
  }

  if (!ready && !indicacao) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground">Carregando…</p>
      </div>
    )
  }

  if (!indicacao) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground mb-4">Indicação não encontrada</p>
        <Button asChild variant="outline">
          <Link href="/admin/indicacoes">Voltar</Link>
        </Button>
      </div>
    )
  }

  const comerciaisDisponiveis = isDataProviderMock()
    ? comerciais.filter((c) => c.disponibilidade === "disponivel")
    : comerciaisLista.filter((c) => c.disponibilidade === "disponivel" && c.ativo !== false)

  const canConfirmFirstInvoiceAction = canConfirmFirstInvoice({
    role,
    authUserId,
    commercialProfileId: indicacao.comercialId ?? null,
  })

  const showFirstInvoiceButton =
    !isDataProviderMock() &&
    canConfirmFirstInvoiceAction &&
    !indicacao.primeiraFaturaPaga

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/indicacoes">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Link>
        </Button>
      </div>

      <PageHeader
        title={indicacao.nomeIndicado}
        description={`Indicação #${indicacao.id.slice(0, 8)}…`}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Indicado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span>{indicacao.nomeIndicado}</span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{indicacao.telefoneIndicado}</span>
            </div>
            {indicacao.emailIndicado ? (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{indicacao.emailIndicado}</span>
              </div>
            ) : null}
            {indicacao.enderecoIndicado ? (
              <p className="text-muted-foreground">{indicacao.enderecoIndicado}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Funil</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground">Status</p>
              <StatusBadge status={indicacao.status} />
            </div>
            <div>
              <p className="text-muted-foreground">Plano</p>
              <p>{indicacao.plano?.nome ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Indicador</p>
              <p>{indicacao.indicador?.nome ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Comercial</p>
              <p>{indicacao.comercial?.nome ?? "Não atribuído"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Primeira mensalidade paga</p>
              <p>{indicacao.primeiraFaturaPaga ? "Sim" : "Não"}</p>
            </div>
            {showFirstInvoiceButton ? (
              <Button
                type="button"
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
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Criada em {indicacao.createdAt.toLocaleString("pt-BR")}</span>
            </div>
            <p className="text-muted-foreground">
              Atualizada em {indicacao.updatedAt.toLocaleString("pt-BR")}
            </p>
            {indicacao.dataAprovacao ? (
              <p className="text-muted-foreground">
                Aprovada em {indicacao.dataAprovacao.toLocaleString("pt-BR")}
              </p>
            ) : null}
            {indicacao.dataRecusa ? (
              <p className="text-muted-foreground">
                Recusada em {indicacao.dataRecusa.toLocaleString("pt-BR")}
              </p>
            ) : null}
            {isIndicacaoRejectedStatus(indicacao.status) &&
            (indicacao.motivoRecusa || indicacao.observacoesRecusa) ? (
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 space-y-1">
                <p className="text-sm font-medium text-foreground">Motivo da recusa</p>
                {indicacao.motivoRecusa ? (
                  <p className="text-sm">{indicacao.motivoRecusa}</p>
                ) : null}
                {indicacao.observacoesRecusa ? (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {indicacao.observacoesRecusa}
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {role === "admin_consulta" ? (
        <p className="text-sm text-muted-foreground">Perfil somente leitura (admin consulta).</p>
      ) : null}

      {canMutate && !isDataProviderMock() ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Atribuir comercial</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Select
                  value={selectedComercialId || undefined}
                  onValueChange={setSelectedComercialId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o comercial" />
                  </SelectTrigger>
                  <SelectContent>
                    {comerciaisDisponiveis.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={!selectedComercialId || savingAssign}
                onClick={() => void handleAssign()}
              >
                {savingAssign ? "Salvando…" : "Atribuir"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Alterar status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Select
                  value={selectedStatus || undefined}
                  onValueChange={(v) => {
                    const next = v as IndicacaoStatus
                    setSelectedStatus(next)
                    if (next !== "recusada") {
                      setLostReason("")
                      setLostNotes("")
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Novo status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedStatus === "recusada" ? (
                  <div className="space-y-3 pt-2">
                    <div className="space-y-2">
                      <Label>Motivo da recusa *</Label>
                      <Select
                        value={lostReason || undefined}
                        onValueChange={setLostReason}
                      >
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
                        value={lostNotes}
                        onChange={(e) => setLostNotes(e.target.value)}
                        rows={2}
                        placeholder="Detalhes adicionais..."
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              <Button
                disabled={
                  !selectedStatus ||
                  savingStatus ||
                  (selectedStatus === "recusada" && !lostReason.trim())
                }
                onClick={() => void handleStatus()}
              >
                {savingStatus ? "Salvando…" : "Aplicar"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico (referral_history)</CardTitle>
        </CardHeader>
        <CardContent>
          {historico.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {historico.map((h) => (
                <li key={h.id} className="border-b border-border/60 pb-3 last:border-0">
                  <p className="font-medium">{h.acao}</p>
                  <p className="text-muted-foreground">{h.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.createdAt.toLocaleString("pt-BR")}
                    {h.comercial?.nome ? ` · ${h.comercial.nome}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

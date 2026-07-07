"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { getAuthProfileBasicsFromSupabase } from "@/lib/services"
import {
  BRBYTE_DASHBOARD_STATUS_ORDER,
  BRBYTE_LEGACY_STATUS_ORDER,
} from "@/lib/brbyte/observability"
import type { BrbyteSyncStatus } from "@/types/referral"
import type { UserRole } from "@/types/user"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PlugZap,
  RefreshCw,
  Stethoscope,
} from "lucide-react"

type DashboardPayload = {
  flags: {
    createInterestEnabled: boolean
    syncEnabled: boolean
    autoMarkPaidEnabled: boolean
    apiUrlConfigured: boolean
    apiUrlHost: string | null
    isDemoEnvironment: boolean
  }
  lastSyncRun: {
    id: string
    status: string
    phase: string | null
    phaseLabel: string
    referralId: string | null
    startedAt: string
    finishedAt: string | null
    durationMs: number | null
    errorsCount: number
  } | null
  lastActivity: {
    referralId: string | null
    phase: string | null
    phaseLabel: string
    httpStatus: number | null
    message: string | null
    endpoint: string | null
    createdAt: string
    isError: boolean
  } | null
  lastCreateInterest: {
    referralId: string
    createdAt: string
    httpStatus: number | null
    message: string | null
  } | null
  lastError: {
    referralId: string | null
    phase: string | null
    phaseLabel: string
    httpStatus: number | null
    message: string | null
    endpoint: string | null
    createdAt: string
    isError: boolean
  } | null
  today: {
    attempts: number
    successes: number
    errors: number
  }
  referralsByStatus: Record<BrbyteSyncStatus, number>
  firstInvoicePipeline: {
    awaitingContract: number
    contractLocated: number
    firstInvoiceLocated: number
    firstInvoicePaid: number
    rewardReleased: number
  }
}

type DashboardApiResponse = {
  ok?: boolean
  error?: string
  dashboard?: DashboardPayload | null
}

function buildEmptyDashboard(): DashboardPayload {
  return {
    flags: {
      createInterestEnabled: false,
      syncEnabled: false,
      autoMarkPaidEnabled: false,
      apiUrlConfigured: false,
      apiUrlHost: null,
      isDemoEnvironment: false,
    },
    lastSyncRun: null,
    lastActivity: null,
    lastCreateInterest: null,
    lastError: null,
    today: {
      attempts: 0,
      successes: 0,
      errors: 0,
    },
    referralsByStatus: {
      pending: 0,
      created: 0,
      converted: 0,
      waiting_conversion: 0,
      waiting_contract: 0,
      waiting_invoice: 0,
      synced: 0,
      paid_confirmed: 0,
      completed: 0,
      error: 0,
      retry: 0,
    },
    firstInvoicePipeline: {
      awaitingContract: 0,
      contractLocated: 0,
      firstInvoiceLocated: 0,
      firstInvoicePaid: 0,
      rewardReleased: 0,
    },
  }
}

function FlagRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={enabled ? "default" : "secondary"}>
        {enabled ? "Ativo" : "Desativado"}
      </Badge>
    </div>
  )
}

export default function AdminBrbyteIntegracaoPage() {
  const [role, setRole] = useState<UserRole | null>(null)
  const [dashboard, setDashboard] = useState<DashboardPayload>(buildEmptyDashboard)
  const [loading, setLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [dashboardStatus, setDashboardStatus] = useState<number | null>(null)
  const [testingHealth, setTestingHealth] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [healthResult, setHealthResult] = useState<{
    ok: boolean
    message: string
    httpStatus: number | null
    executedAt: string
  } | null>(null)

  const canMutate = role === "admin_master" || role === "admin_financeiro"

  const loadDashboard = useCallback(async () => {
    console.log("[brbyte-dashboard:client] load:start")
    if (isDataProviderMock()) {
      console.log("[brbyte-dashboard:client] mock-mode")
      setLoading(false)
      return
    }
    setLoading(true)
    setDashboardError(null)
    try {
      const [basicsResult, dashResult] = await Promise.allSettled([
        getAuthProfileBasicsFromSupabase(),
        fetch("/api/admin/brbyte/dashboard", { cache: "no-store" }),
      ])

      if (basicsResult.status === "fulfilled") {
        setRole(basicsResult.value?.role ?? null)
      } else {
        console.error("[brbyte-dashboard:client] load:profile-error", {
          message:
            basicsResult.reason instanceof Error
              ? basicsResult.reason.message
              : String(basicsResult.reason),
        })
        setRole(null)
      }

      if (dashResult.status !== "fulfilled") {
        throw dashResult.reason
      }

      const dashRes = dashResult.value
      setDashboardStatus(dashRes.status)

      const data = (await dashRes.json()) as DashboardApiResponse
      console.log("[brbyte-dashboard:client] load:response", {
        status: dashRes.status,
        ok: dashRes.ok,
        payload: data,
      })

      if (data.dashboard) {
        setDashboard(data.dashboard)
      } else {
        setDashboard(buildEmptyDashboard())
      }

      if (!dashRes.ok || data.ok === false) {
        setDashboardError(
          data.error ??
            "Não foi possível carregar o painel BRByte agora. Exibindo dados básicos."
        )
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erro inesperado ao carregar dashboard."
      console.error("[brbyte-dashboard:client] load:error", { message, error })
      setDashboard(buildEmptyDashboard())
      setDashboardError(
        `${message} Exibindo painel com informações básicas enquanto a API não responde.`
      )
      setDashboardStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    console.log("[brbyte-dashboard:client] render", {
      loading,
      dashboardStatus,
      dashboardError,
      hasDashboard: Boolean(dashboard),
      canMutate,
    })
  }, [loading, dashboardStatus, dashboardError, dashboard, canMutate])

  const handleTestConnection = async () => {
    setTestingHealth(true)
    try {
      const res = await fetch("/api/admin/brbyte/health", { cache: "no-store" })
      const data = (await res.json()) as {
        ok?: boolean
        message?: string
        httpStatus?: number | null
        executedAt?: string
      }
      setHealthResult({
        ok: Boolean(data.ok),
        message: data.message ?? "Sem resposta.",
        httpStatus: data.httpStatus ?? null,
        executedAt: data.executedAt ?? new Date().toISOString(),
      })
      if (data.ok) toast.success(data.message ?? "Conexão OK")
      else toast.error(data.message ?? "Falha na conexão")
    } catch {
      toast.error("Erro ao testar conexão com Controllr.")
    } finally {
      setTestingHealth(false)
    }
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      const res = await fetch("/api/admin/brbyte/sync", { method: "POST" })
      const data = (await res.json()) as {
        ok?: boolean
        skipped?: boolean
        message?: string
        error?: string
      }
      if (data.skipped || res.status === 409) {
        toast.message(
          data.message ??
            "Sincronização automática desativada. Ative BRBYTE_SYNC_ENABLED para executar."
        )
        await loadDashboard()
        return
      }
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? data.message ?? "Falha na sincronização.")
        return
      }
      toast.success(data.message ?? "Sincronização executada com sucesso.")
      await loadDashboard()
    } catch {
      toast.error("Erro ao executar sincronização.")
    } finally {
      setSyncing(false)
    }
  }

  if (isDataProviderMock()) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="BRByte / Controllr"
          description="Painel de integração indisponível no modo mock."
        />
      </div>
    )
  }

  const flags = dashboard.flags
  const hasAnyHistory =
    Boolean(dashboard.lastSyncRun) ||
    Boolean(dashboard.lastActivity) ||
    Boolean(dashboard.lastCreateInterest) ||
    Boolean(dashboard.lastError)
  const showEmptyMessage = !loading && !hasAnyHistory && !dashboardError

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="BRByte / Controllr"
          description="Observabilidade e controle da integração ERP"
        />
        <Badge variant={flags.isDemoEnvironment ? "secondary" : "outline"}>
          {flags.isDemoEnvironment ? "Ambiente DEMO" : "Ambiente Produção"}
        </Badge>
      </div>

      {loading ? (
        <p className="text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando painel…
        </p>
      ) : null}

      {dashboardError ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="pt-6 text-sm">
            <p className="font-medium text-foreground">Falha ao carregar o dashboard</p>
            <p className="text-muted-foreground mt-1">{dashboardError}</p>
            {dashboardStatus !== null ? (
              <p className="text-muted-foreground mt-1">Resposta da API: HTTP {dashboardStatus}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {showEmptyMessage ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Nenhum evento BRByte foi registrado ainda. Mesmo assim, o painel abaixo
            permanece disponível para testes de conexão e acompanhamento das flags.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Ambiente</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Badge variant={flags.isDemoEnvironment ? "secondary" : "outline"}>
              {flags.isDemoEnvironment ? "Ambiente DEMO" : "Ambiente Produção"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">URL configurada</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {flags.apiUrlConfigured ? (
              <span>{flags.apiUrlHost ?? "Configurada"}</span>
            ) : (
              <span className="text-muted-foreground">
                BRBYTE_API_URL ainda não foi configurada.
              </span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Tentativas hoje</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {dashboard.today.attempts}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status da conexão</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {healthResult ? (
              <span>{healthResult.ok ? "Conectado" : "Falha no teste"}</span>
            ) : (
              <span className="text-muted-foreground">Conexão ainda não testada.</span>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PlugZap className="h-4 w-4" />
              Feature Flags
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FlagRow
              label="BRBYTE_CREATE_INTEREST_ENABLED"
              enabled={flags.createInterestEnabled}
            />
            <FlagRow
              label="BRBYTE_SYNC_ENABLED"
              enabled={flags.syncEnabled}
            />
            <FlagRow
              label="BRBYTE_AUTO_MARK_PAID_ENABLED"
              enabled={flags.autoMarkPaidEnabled}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Último Sync
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {dashboard.lastSyncRun ? (
              <div>
                <p className="font-medium">Último sync run</p>
                <p className="text-muted-foreground">
                  {dashboard.lastSyncRun.status} ·{" "}
                  {new Date(dashboard.lastSyncRun.startedAt).toLocaleString("pt-BR")}
                </p>
                <p className="text-muted-foreground">
                  Fase: {dashboard.lastSyncRun.phaseLabel}
                  {dashboard.lastSyncRun.referralId ? (
                    <>
                      {" "}
                      · referral{" "}
                      <Link
                        href={`/admin/indicacoes/${dashboard.lastSyncRun.referralId}`}
                        className="text-primary hover:underline"
                      >
                        {dashboard.lastSyncRun.referralId.slice(0, 8)}…
                      </Link>
                    </>
                  ) : null}
                </p>
                {dashboard.lastSyncRun.errorsCount > 0 ? (
                  <p className="text-destructive text-xs mt-1">
                    {dashboard.lastSyncRun.errorsCount} erro(s) nesta execução
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-muted-foreground">
                Nenhuma execução registrada ainda.
              </p>
            )}

            {dashboard.lastActivity ? (
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium">Última atividade</p>
                <p className="text-muted-foreground text-xs mt-1">
                  {new Date(dashboard.lastActivity.createdAt).toLocaleString("pt-BR")}
                  {dashboard.lastActivity.httpStatus !== null
                    ? ` · HTTP ${dashboard.lastActivity.httpStatus}`
                    : ""}
                </p>
                <p className="mt-1">{dashboard.lastActivity.phaseLabel}</p>
                {dashboard.lastActivity.message ? (
                  <p className="text-muted-foreground mt-1">
                    {dashboard.lastActivity.message}
                  </p>
                ) : null}
                {dashboard.lastActivity.referralId ? (
                  <p className="text-xs mt-1">
                    referral{" "}
                    <Link
                      href={`/admin/indicacoes/${dashboard.lastActivity.referralId}`}
                      className="text-primary hover:underline"
                    >
                      {dashboard.lastActivity.referralId.slice(0, 8)}…
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : null}

            {dashboard.lastCreateInterest ? (
              <div>
                <p className="font-medium">Última criação de interessado</p>
                <p className="text-muted-foreground">
                  {new Date(dashboard.lastCreateInterest.createdAt).toLocaleString(
                    "pt-BR"
                  )}{" "}
                  · referral{" "}
                  <Link
                    href={`/admin/indicacoes/${dashboard.lastCreateInterest.referralId}`}
                    className="text-primary hover:underline"
                  >
                    {dashboard.lastCreateInterest.referralId.slice(0, 8)}…
                  </Link>
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Ainda não houve criação manual de interessado.
              </p>
            )}
            {dashboard.lastError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="font-medium flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Último erro relevante
                </p>
                <p className="text-muted-foreground mt-1">
                  {new Date(dashboard.lastError.createdAt).toLocaleString("pt-BR")}
                  {" · "}
                  {dashboard.lastError.phaseLabel}
                </p>
                <p className="mt-1">{dashboard.lastError.message ?? "—"}</p>
                {dashboard.lastError.endpoint ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    {dashboard.lastError.endpoint}
                    {dashboard.lastError.httpStatus
                      ? ` · HTTP ${dashboard.lastError.httpStatus}`
                      : ""}
                  </p>
                ) : null}
                {dashboard.lastError.referralId ? (
                  <p className="text-xs mt-1">
                    referral{" "}
                    <Link
                      href={`/admin/indicacoes/${dashboard.lastError.referralId}`}
                      className="text-primary hover:underline"
                    >
                      {dashboard.lastError.referralId.slice(0, 8)}…
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-muted-foreground">Nenhum erro recente relevante.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Primeira mensalidade</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Aguardando contrato</p>
              <p className="text-2xl font-bold">
                {dashboard.firstInvoicePipeline.awaitingContract}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Contrato localizado</p>
              <p className="text-2xl font-bold">
                {dashboard.firstInvoicePipeline.contractLocated}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">
                Primeira fatura localizada
              </p>
              <p className="text-2xl font-bold">
                {dashboard.firstInvoicePipeline.firstInvoiceLocated}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Primeira fatura paga</p>
              <p className="text-2xl font-bold text-emerald-600">
                {dashboard.firstInvoicePipeline.firstInvoicePaid}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Recompensa liberada</p>
              <p className="text-2xl font-bold text-emerald-600">
                {dashboard.firstInvoicePipeline.rewardReleased}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Totais</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Tentativas</p>
              <p className="text-2xl font-bold">{dashboard.today.attempts}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Sucessos</p>
              <p className="text-2xl font-bold text-emerald-600">
                {dashboard.today.successes}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Erros</p>
              <p className="text-2xl font-bold text-destructive">
                {dashboard.today.errors}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ações</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="secondary"
              disabled={testingHealth || !canMutate}
              onClick={() => {
                void handleTestConnection()
              }}
            >
              {testingHealth ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Stethoscope className="mr-2 h-4 w-4" />
              )}
              Testar conexão
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={syncing || !canMutate}
              onClick={() => {
                void handleSyncNow()
              }}
            >
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Sincronizar agora
            </Button>
            <Button type="button" variant="ghost" onClick={() => void loadDashboard()}>
              Atualizar painel
            </Button>
            {!canMutate ? (
              <p className="w-full text-sm text-muted-foreground">
                Teste de conexão e sincronização manual exigem perfil
                `admin_master` ou `admin_financeiro`.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Indicações por status BRByte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {BRBYTE_DASHBOARD_STATUS_ORDER.map(({ key, label }) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span>{label}</span>
                <span className="font-semibold">
                  {dashboard.referralsByStatus[key]}
                </span>
              </div>
            ))}
          </div>
          {BRBYTE_LEGACY_STATUS_ORDER.some(
            ({ key }) => dashboard.referralsByStatus[key] > 0
          ) ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 border-t border-border pt-4">
              {BRBYTE_LEGACY_STATUS_ORDER.filter(
                ({ key }) => dashboard.referralsByStatus[key] > 0
              ).map(({ key, label }) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground"
                >
                  <span>{label}</span>
                  <span className="font-semibold">
                    {dashboard.referralsByStatus[key]}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {healthResult ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {healthResult.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              )}
              Resultado do teste de conexão
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>{healthResult.message}</p>
            {healthResult.httpStatus !== null ? (
              <p className="text-muted-foreground">HTTP {healthResult.httpStatus}</p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              {new Date(healthResult.executedAt).toLocaleString("pt-BR")}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

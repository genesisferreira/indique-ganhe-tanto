"use client"

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable } from "@/components/ui/data-table"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import {
  REALTIME_TABLES_ADMIN,
  useRealtimeReload,
} from "@/hooks/use-supabase-realtime"
import { pagamentos } from "@/lib/services/mock-data.service"
import {
  approvePixWithdrawalFromSupabase,
  completePixWithdrawalFromSupabase,
  getAuthProfileRoleFromSupabase,
  loadAdminPixWithdrawalsFromSupabase,
  loadPaymentAuditTrailFromSupabase,
  rejectPixWithdrawalFromSupabase,
} from "@/lib/services/supabase-data.service"
import type { AuditoriaPagamentoItem, Pagamento, PagamentoStatus } from "@/types"
import type { UserRole } from "@/types/user"
import {
  Search,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Upload,
  ScrollText,
  Loader2,
  FileImage,
} from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"
import Link from "next/link"
import { cn } from "@/lib/utils"
import {
  uploadPixWithdrawalReceipt,
  validateReceiptFileBeforeUpload,
} from "@/lib/supabase/upload-payment-receipt"

const RECEIPT_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp"

export default function AdminPagamentosPendentesPage() {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [role, setRole] = useState<UserRole | null>(null)
  const [pendentes, setPendentes] = useState<Pagamento[]>([])
  const [aprovados, setAprovados] = useState<Pagamento[]>([])
  const [fonteRemota, setFonteRemota] = useState(false)

  const [dialogApprove, setDialogApprove] = useState(false)
  const [dialogReject, setDialogReject] = useState(false)
  const [dialogComplete, setDialogComplete] = useState(false)
  const [dialogAudit, setDialogAudit] = useState(false)
  const [selected, setSelected] = useState<Pagamento | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [uploadCompleting, setUploadCompleting] = useState(false)
  const receiptInputRef = useRef<HTMLInputElement>(null)
  const actionInFlightRef = useRef(false)
  const [auditRows, setAuditRows] = useState<AuditoriaPagamentoItem[] | null>(null)
  const [loadingAudit, setLoadingAudit] = useState(false)

  const podeAgir =
    role === "admin_financeiro" || role === "admin_master"

  const recarregar = useCallback(async () => {
    if (isDataProviderMock()) {
      const mockPix = pagamentos.filter((x) => x.kind === "pix_withdrawal")
      setPendentes(mockPix.filter((x) => x.status === "pendente"))
      setAprovados(mockPix.filter((x) => x.status === "aprovado"))
      setFonteRemota(false)
      return
    }

    const p = await loadAdminPixWithdrawalsFromSupabase("pendente")
    const a = await loadAdminPixWithdrawalsFromSupabase("aprovado")

    setPendentes(p ?? [])
    setAprovados(a ?? [])
    setFonteRemota(true)
    if (process.env.NODE_ENV === "development") {
      console.log("[supabase-query:debug]", {
        query: "pagamentos-pendentes",
        pendentes: p?.length ?? 0,
        aprovados: a?.length ?? 0,
      })
    }
  }, [])

  useEffect(() => {
    void getAuthProfileRoleFromSupabase().then((r) => {
      setRole(r)
      if (process.env.NODE_ENV === "development") {
        console.log("[permission-check:debug]", {
          page: "/admin/pagamentos-pendentes",
          role: r,
          podeAgirFinanceiro: r === "admin_financeiro" || r === "admin_master",
        })
      }
      if (
        !isDataProviderMock() &&
        r === "admin_consulta"
      ) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[permission-check:debug]", {
            page: "/admin/pagamentos-pendentes",
            action: "redirect_sem_permissao",
            role: r,
          })
        }
        router.replace("/admin")
      }
    })
  }, [router])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  useRealtimeReload(recarregar, REALTIME_TABLES_ADMIN, {
    enabled: !isDataProviderMock(),
  })

  useEffect(() => {
    if (dialogComplete) {
      setReceiptFile(null)
      setFileInputKey((k) => k + 1)
    }
  }, [dialogComplete, selected?.id])

  const filtrar = (lista: Pagamento[]) =>
    lista.filter((pagamento) => {
      const nome =
        pagamento.indicador?.nome?.toLowerCase() ??
        pagamento.indicacao?.nomeIndicado?.toLowerCase() ??
        ""
      return nome.includes(search.toLowerCase())
    })

  const pendentesFiltrados = filtrar(pendentes)
  const aprovadosFiltrados = filtrar(aprovados)

  const totalPendente = pendentes.reduce((acc, p) => acc + p.valor, 0)
  const totalAprovadoValor = aprovados.reduce((acc, p) => acc + p.valor, 0)

  const abrirAuditoria = async (p: Pagamento) => {
    setSelected(p)
    setDialogAudit(true)
    setLoadingAudit(true)
    setAuditRows(null)
    const rows = await loadPaymentAuditTrailFromSupabase(p.id)
    setAuditRows(rows ?? [])
    setLoadingAudit(false)
  }

  const handleApprove = async () => {
    if (!selected || !podeAgir || actionInFlightRef.current) return
    actionInFlightRef.current = true
    try {
    const r = await approvePixWithdrawalFromSupabase(selected.id)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success("Saque aprovado. Agora registre o comprovante ao concluir o Pix.")
    setDialogApprove(false)
    setSelected(null)
    await recarregar()
    } finally {
      actionInFlightRef.current = false
    }
  }

  const handleReject = async () => {
    if (!selected || !podeAgir || actionInFlightRef.current) return
    actionInFlightRef.current = true
    try {
    const r = await rejectPixWithdrawalFromSupabase(selected.id, rejectReason)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success("Saque rejeitado.")
    setDialogReject(false)
    setSelected(null)
    setRejectReason("")
    await recarregar()
    } finally {
      actionInFlightRef.current = false
    }
  }

  const aplicarArquivo = (file: File | undefined) => {
    if (!file) {
      setReceiptFile(null)
      return
    }
    const v = validateReceiptFileBeforeUpload(file)
    if (!v.ok) {
      toast.error(v.message)
      setReceiptFile(null)
      setFileInputKey((k) => k + 1)
      return
    }
    setReceiptFile(file)
  }

  const onInputArquivo = (e: ChangeEvent<HTMLInputElement>) => {
    aplicarArquivo(e.target.files?.[0])
  }

  const onDropZona = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const f = e.dataTransfer.files?.[0]
    aplicarArquivo(f)
  }

  const handleComplete = async () => {
    if (!selected || !podeAgir || actionInFlightRef.current || uploadCompleting) return
    if (!receiptFile) {
      toast.error("Selecione um arquivo de comprovante.")
      return
    }
    const pre = validateReceiptFileBeforeUpload(receiptFile)
    if (!pre.ok) {
      toast.error(pre.message)
      return
    }

    actionInFlightRef.current = true
    setUploadCompleting(true)
    try {
    const upload = await uploadPixWithdrawalReceipt(selected.id, receiptFile)
    if (!upload.ok) {
      toast.error(upload.message)
      return
    }

    const r = await completePixWithdrawalFromSupabase(selected.id, upload.receiptPath)
    if (!r.ok) {
      toast.error(r.message)
      return
    }
    toast.success("Comprovante enviado e saque concluído. Carteira debitada.")
    setDialogComplete(false)
    setSelected(null)
    setReceiptFile(null)
    await recarregar()
    } finally {
      setUploadCompleting(false)
      actionInFlightRef.current = false
    }
  }

  const colunasPendente = [
    {
      key: "indicador",
      header: "Indicador",
      cell: (p: Pagamento) => (
        <div>
          <p className="font-medium">{p.indicador?.nome ?? "—"}</p>
          <p className="text-sm text-muted-foreground">{p.indicador?.email ?? ""}</p>
        </div>
      ),
    },
    {
      key: "pix",
      header: "Chave Pix (solicitação)",
      cell: (p: Pagamento) => (
        <span className="text-sm text-muted-foreground">
          {p.pixChaveSnapshot ?? "—"}
        </span>
      ),
    },
    {
      key: "valor",
      header: "Valor",
      cell: (p: Pagamento) => (
        <span className="font-semibold text-success">
          R$ {p.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (p: Pagamento) => (
        <StatusBadge status={p.status as PagamentoStatus} />
      ),
    },
    {
      key: "acoes",
      header: "Ações",
      cell: (p: Pagamento) => (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-success"
            disabled={!podeAgir}
            onClick={() => {
              setSelected(p)
              setDialogApprove(true)
            }}
          >
            <CheckCircle className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            disabled={!podeAgir}
            onClick={() => {
              setSelected(p)
              setRejectReason("")
              setDialogReject(true)
            }}
          >
            <XCircle className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void abrirAuditoria(p)}>
            <ScrollText className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  const colunasAprovado = [
    ...colunasPendente.slice(0, 4),
    {
      key: "acoes",
      header: "Ações",
      cell: (p: Pagamento) => (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="default"
            size="sm"
            disabled={!podeAgir}
            onClick={() => {
              setSelected(p)
              setDialogComplete(true)
            }}
          >
            <Upload className="h-4 w-4 mr-1" />
            Concluir + comprovante
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void abrirAuditoria(p)}>
            <ScrollText className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Saques Pix"
        description="Solicitações pendentes, aprovadas aguardando comprovante e auditoria"
      >
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/upload-comprovante">
              <Upload className="mr-2 h-4 w-4" />
              Upload comprovante
            </Link>
          </Button>
        </div>
      </PageHeader>

      {!podeAgir && role != null && (
        <p className="text-sm text-muted-foreground rounded-lg border border-border bg-muted/30 px-4 py-3">
          Seu perfil ({role}) pode visualizar a fila. Aprovação, rejeição e conclusão com
          débito na carteira são permitidas apenas para admin financeiro ou admin master.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Fonte dos dados: {fonteRemota ? "Supabase" : "mock local"}. RPCs:{" "}
        <code className="rounded bg-muted px-1">supabase/pix-withdrawal-flow.sql</code> —
        comprovantes:{" "}
        <code className="rounded bg-muted px-1">supabase/storage-payment-receipts.sql</code>
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Pendentes de análise"
          value={`R$ ${totalPendente.toLocaleString("pt-BR")}`}
          subtitle={`${pendentes.length} solicitações`}
          icon={Clock}
          variant="warning"
        />
        <StatCard
          title="Aprovados (aguardando Pix)"
          value={`R$ ${totalAprovadoValor.toLocaleString("pt-BR")}`}
          subtitle={`${aprovados.length} registros`}
          icon={CheckCircle}
          variant="primary"
        />
        <StatCard
          title="Fila total"
          value={pendentes.length + aprovados.length}
          subtitle="Saques Pix abertos"
          icon={AlertTriangle}
          variant="destructive"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Pendentes de aprovação</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por indicador..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 sm:w-[280px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {pendentesFiltrados.length > 0 ? (
            <DataTable
              data={pendentesFiltrados}
              columns={colunasPendente}
              emptyMessage="Nenhum saque pendente"
            />
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">
              Nenhum saque pendente nesta lista.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Aprovados — registrar comprovante e debitar</CardTitle>
        </CardHeader>
        <CardContent>
          {aprovadosFiltrados.length > 0 ? (
            <DataTable
              data={aprovadosFiltrados}
              columns={colunasAprovado}
              emptyMessage="Nenhum saque aprovado aguardando conclusão"
            />
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">
              Nenhum saque aprovado aguardando comprovante.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogApprove} onOpenChange={setDialogApprove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar saque Pix</DialogTitle>
            <DialogDescription>
              O indicador continua com o saldo na carteira até você concluir o envio do Pix e
              registrar o comprovante (débito automático nessa etapa).
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <p className="text-sm">
              Valor:{" "}
              <strong>
                R${" "}
                {selected.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </strong>
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogApprove(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleApprove()}>Confirmar aprovação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogReject} onOpenChange={setDialogReject}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar saque Pix</DialogTitle>
            <DialogDescription>
              O indicador verá o motivo em Meus pagamentos. Não há débito na carteira.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-rejeicao">Motivo</Label>
            <Textarea
              id="motivo-rejeicao"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Descreva o motivo da rejeição"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogReject(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void handleReject()}>
              Confirmar rejeição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogComplete}
        onOpenChange={(open) => {
          if (!open && uploadCompleting) {
            toast.info("Aguarde o envio do comprovante terminar.")
            return
          }
          setDialogComplete(open)
        }}
      >
        <DialogContent className="border-amber-500/20 bg-zinc-950 text-zinc-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-amber-100">
              Concluir saque e debitar carteira
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              Envie o comprovante do Pix (PDF ou imagem). O arquivo vai para o bucket{" "}
              <span className="font-mono text-amber-200/90">payment-receipts</span> em{" "}
              <span className="font-mono text-amber-200/90">pix-withdrawals/</span>; em seguida
              o sistema registra o débito na carteira do indicador.
            </DialogDescription>
          </DialogHeader>

          <input
            key={fileInputKey}
            ref={receiptInputRef}
            type="file"
            accept={RECEIPT_ACCEPT}
            className="sr-only"
            onChange={onInputArquivo}
          />

          <div className="space-y-3">
            <Label className="text-zinc-300">Comprovante</Label>
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  receiptInputRef.current?.click()
                }
              }}
              onClick={() => receiptInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDrop={onDropZona}
              className={cn(
                "cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                "border-amber-500/35 bg-zinc-900/80 hover:border-amber-400/55 hover:bg-zinc-900",
                receiptFile && "border-amber-400/60 bg-amber-950/20"
              )}
            >
              <FileImage className="mx-auto h-10 w-10 text-amber-400/80 mb-2" />
              <p className="text-sm font-medium text-amber-100/95">
                Arraste o arquivo aqui ou clique para escolher
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                PDF, PNG, JPG ou WEBP · máx. 10 MB
              </p>
            </div>

            {receiptFile && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm">
                <Upload className="h-4 w-4 shrink-0 text-amber-400" />
                <span className="truncate text-zinc-200" title={receiptFile.name}>
                  {receiptFile.name}
                </span>
                <span className="ml-auto shrink-0 text-zinc-500 tabular-nums">
                  {(receiptFile.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              className="border-zinc-600 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              disabled={uploadCompleting}
              onClick={() => setDialogComplete(false)}
            >
              Cancelar
            </Button>
            <Button
              className="bg-amber-500 text-zinc-950 hover:bg-amber-400 font-semibold shadow-md shadow-amber-500/20"
              disabled={uploadCompleting || !receiptFile || !podeAgir}
              onClick={() => void handleComplete()}
            >
              {uploadCompleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando…
                </>
              ) : (
                "Enviar comprovante e concluir"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogAudit} onOpenChange={setDialogAudit}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Auditoria do pagamento</DialogTitle>
            <DialogDescription>
              Registros em <code className="text-xs">audit_logs</code> para este ID.
            </DialogDescription>
          </DialogHeader>
          {loadingAudit && (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          )}
          {!loadingAudit && auditRows && auditRows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum evento encontrado (mock ou RPCs ainda não aplicados).
            </p>
          )}
          {!loadingAudit &&
            auditRows?.map((row) => (
              <div
                key={row.id}
                className="rounded-lg border border-border p-3 text-sm space-y-1"
              >
                <p className="font-medium">
                  {row.acao} · {row.createdAt.toLocaleString("pt-BR")}
                </p>
                {row.dadosAnteriores && (
                  <pre className="text-xs bg-muted/50 p-2 rounded overflow-x-auto">
                    {JSON.stringify(row.dadosAnteriores, null, 2)}
                  </pre>
                )}
                {row.dadosNovos && (
                  <pre className="text-xs bg-muted/50 p-2 rounded overflow-x-auto">
                    {JSON.stringify(row.dadosNovos, null, 2)}
                  </pre>
                )}
              </div>
            ))}
        </DialogContent>
      </Dialog>
    </div>
  )
}

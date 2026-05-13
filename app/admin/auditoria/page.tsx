"use client"

import type { ElementType } from "react"
import { useState } from "react"
import { isDataProviderMock } from "@/lib/auth/env-data-provider"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Download, Shield, UserCheck, DollarSign, FileText, Settings, Eye, AlertTriangle, Activity } from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"

interface AuditLog {
  id: string
  userId: string
  userName: string
  userRole: string
  action: string
  module: string
  description: string
  ipAddress: string
  timestamp: Date
  severity: "info" | "warning" | "critical"
}

const mockAuditLogs: AuditLog[] = [
  {
    id: "1",
    userId: "admin-1",
    userName: "Carlos Silva",
    userRole: "Super Admin",
    action: "PAGAMENTO_APROVADO",
    module: "Pagamentos",
    description: "Aprovou pagamento #12345 no valor de R$ 150,00 para Maria Silva",
    ipAddress: "192.168.1.100",
    timestamp: new Date("2024-01-15T14:30:00"),
    severity: "info",
  },
  {
    id: "2",
    userId: "admin-2",
    userName: "Ana Paula Santos",
    userRole: "Admin",
    action: "INDICADOR_BLOQUEADO",
    module: "Indicadores",
    description: "Bloqueou indicador Joao Pereira por atividade suspeita",
    ipAddress: "192.168.1.105",
    timestamp: new Date("2024-01-15T13:45:00"),
    severity: "warning",
  },
  {
    id: "3",
    userId: "admin-1",
    userName: "Carlos Silva",
    userRole: "Super Admin",
    action: "CONFIGURACAO_ALTERADA",
    module: "Configuracoes",
    description: "Alterou valor de recompensa do plano Turbo 500 de R$ 50 para R$ 75",
    ipAddress: "192.168.1.100",
    timestamp: new Date("2024-01-15T11:20:00"),
    severity: "critical",
  },
  {
    id: "4",
    userId: "admin-3",
    userName: "Roberto Ferreira",
    userRole: "Moderador",
    action: "INDICACAO_ATRIBUIDA",
    module: "Indicacoes",
    description: "Atribuiu indicacao #67890 ao comercial Pedro Henrique",
    ipAddress: "192.168.1.110",
    timestamp: new Date("2024-01-15T10:15:00"),
    severity: "info",
  },
  {
    id: "5",
    userId: "admin-2",
    userName: "Ana Paula Santos",
    userRole: "Admin",
    action: "PAGAMENTO_REJEITADO",
    module: "Pagamentos",
    description: "Rejeitou pagamento #12346 - Documentacao invalida",
    ipAddress: "192.168.1.105",
    timestamp: new Date("2024-01-14T16:50:00"),
    severity: "warning",
  },
  {
    id: "6",
    userId: "admin-1",
    userName: "Carlos Silva",
    userRole: "Super Admin",
    action: "USUARIO_CRIADO",
    module: "Usuarios",
    description: "Criou novo administrador: Fernanda Lima",
    ipAddress: "192.168.1.100",
    timestamp: new Date("2024-01-14T15:30:00"),
    severity: "info",
  },
  {
    id: "7",
    userId: "admin-1",
    userName: "Carlos Silva",
    userRole: "Super Admin",
    action: "PERMISSAO_ALTERADA",
    module: "Seguranca",
    description: "Alterou permissoes do usuario Roberto Ferreira para Moderador",
    ipAddress: "192.168.1.100",
    timestamp: new Date("2024-01-14T14:00:00"),
    severity: "critical",
  },
  {
    id: "8",
    userId: "admin-2",
    userName: "Ana Paula Santos",
    userRole: "Admin",
    action: "RELATORIO_EXPORTADO",
    module: "Relatorios",
    description: "Exportou relatorio de pagamentos - Janeiro 2024",
    ipAddress: "192.168.1.105",
    timestamp: new Date("2024-01-14T11:00:00"),
    severity: "info",
  },
]

const severityConfig = {
  info: { label: "Info", className: "bg-blue-500/10 text-blue-500 border-blue-500/30" },
  warning: { label: "Alerta", className: "bg-warning/10 text-warning border-warning/30" },
  critical: { label: "Critico", className: "bg-destructive/10 text-destructive border-destructive/30" },
}

const moduleIcons: Record<string, ElementType> = {
  Pagamentos: DollarSign,
  Indicadores: UserCheck,
  Configuracoes: Settings,
  Indicacoes: FileText,
  Usuarios: UserCheck,
  Seguranca: Shield,
  Relatorios: FileText,
}

export default function AdminAuditoriaPage() {
  const [search, setSearch] = useState("")
  const [moduleFilter, setModuleFilter] = useState<string>("todos")
  const [severityFilter, setSeverityFilter] = useState<string>("todos")
  const [auditLogs] = useState<AuditLog[]>(() =>
    isDataProviderMock() ? mockAuditLogs : []
  )

  const filteredLogs = auditLogs.filter((log) => {
    const matchesSearch = log.userName.toLowerCase().includes(search.toLowerCase()) ||
                         log.description.toLowerCase().includes(search.toLowerCase()) ||
                         log.action.toLowerCase().includes(search.toLowerCase())
    const matchesModule = moduleFilter === "todos" || log.module === moduleFilter
    const matchesSeverity = severityFilter === "todos" || log.severity === severityFilter
    return matchesSearch && matchesModule && matchesSeverity
  })

  const totalLogs = auditLogs.length
  const criticalLogs = auditLogs.filter((l) => l.severity === "critical").length
  const warningLogs = auditLogs.filter((l) => l.severity === "warning").length

  const columns = [
    {
      key: "timestamp",
      header: "Data/Hora",
      cell: (log: AuditLog) => (
        <div className="text-sm">
          <p>{log.timestamp.toLocaleDateString("pt-BR")}</p>
          <p className="text-muted-foreground">{log.timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      ),
    },
    {
      key: "user",
      header: "Usuario",
      cell: (log: AuditLog) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <span className="text-xs font-semibold text-primary">
              {log.userName.split(" ").map(n => n[0]).join("").slice(0, 2)}
            </span>
          </div>
          <div>
            <p className="font-medium text-sm">{log.userName}</p>
            <p className="text-xs text-muted-foreground">{log.userRole}</p>
          </div>
        </div>
      ),
    },
    {
      key: "module",
      header: "Modulo",
      cell: (log: AuditLog) => {
        const Icon = moduleIcons[log.module] || FileText
        return (
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{log.module}</span>
          </div>
        )
      },
    },
    {
      key: "action",
      header: "Acao",
      cell: (log: AuditLog) => (
        <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{log.action}</span>
      ),
    },
    {
      key: "description",
      header: "Descricao",
      cell: (log: AuditLog) => (
        <p className="text-sm max-w-[300px] truncate" title={log.description}>
          {log.description}
        </p>
      ),
    },
    {
      key: "severity",
      header: "Severidade",
      cell: (log: AuditLog) => {
        const config = severityConfig[log.severity]
        return (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${config.className}`}>
            {config.label}
          </span>
        )
      },
    },
    {
      key: "ip",
      header: "IP",
      cell: (log: AuditLog) => (
        <span className="font-mono text-xs text-muted-foreground">{log.ipAddress}</span>
      ),
    },
    {
      key: "acoes",
      header: "Acoes",
      cell: () => (
        <Button variant="ghost" size="icon" title="Ver Detalhes">
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoria"
        description="Historico completo de acoes realizadas no sistema"
      >
        <Button variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Exportar Logs
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Total de Registros"
          value={totalLogs}
          icon={Activity}
        />
        <StatCard
          title="Acoes Criticas"
          value={criticalLogs}
          subtitle="Requer atencao"
          icon={AlertTriangle}
          variant="destructive"
        />
        <StatCard
          title="Alertas"
          value={warningLogs}
          icon={Shield}
          variant="warning"
        />
        <StatCard
          title="Usuarios Ativos"
          value={new Set(mockAuditLogs.map(l => l.userId)).size}
          subtitle="Ultimas 24h"
          icon={UserCheck}
          variant="success"
        />
      </div>

      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Logs de Auditoria</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 sm:w-[200px]"
                />
              </div>
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="Modulo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos Modulos</SelectItem>
                  <SelectItem value="Pagamentos">Pagamentos</SelectItem>
                  <SelectItem value="Indicadores">Indicadores</SelectItem>
                  <SelectItem value="Indicacoes">Indicacoes</SelectItem>
                  <SelectItem value="Configuracoes">Configuracoes</SelectItem>
                  <SelectItem value="Usuarios">Usuarios</SelectItem>
                  <SelectItem value="Seguranca">Seguranca</SelectItem>
                  <SelectItem value="Relatorios">Relatorios</SelectItem>
                </SelectContent>
              </Select>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <SelectValue placeholder="Severidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Alerta</SelectItem>
                  <SelectItem value="critical">Critico</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredLogs.length > 0 ? (
            <DataTable
              data={filteredLogs}
              columns={columns}
              emptyMessage="Nenhum log encontrado"
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Shield className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold">Nenhum log encontrado</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Ajuste os filtros para ver mais resultados
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

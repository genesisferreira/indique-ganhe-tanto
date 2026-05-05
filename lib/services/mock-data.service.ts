import type {
  Admin,
  Comercial,
  DashboardAdmin,
  DashboardComercial,
  DashboardIndicador,
  Historico,
  Indicacao,
  Indicador,
  Lead,
  Pagamento,
  Plano,
} from "@/types"
import {
  admins as mockAdmins,
  comerciais as mockComerciais,
  currentAdmin as mockCurrentAdmin,
  currentComercial as mockCurrentComercial,
  currentIndicador as mockCurrentIndicador,
  indicadores as mockIndicadores,
} from "@/lib/mock/users"
import { planos as mockPlanos } from "@/lib/mock/plans"
import { indicacoes as mockIndicacoes } from "@/lib/mock/referrals"
import { pagamentos as mockPagamentos } from "@/lib/mock/payments"
import { historicos as mockHistoricos, leads as mockLeads } from "@/lib/mock/leads"
import {
  dashboardAdmin as mockDashboardAdmin,
  dashboardComercial as mockDashboardComercial,
  dashboardIndicador as mockDashboardIndicador,
} from "@/lib/mock/dashboards"

type DateLike = string | Date | undefined | null

function toDate(value: DateLike): Date | undefined {
  if (!value) return undefined
  if (value instanceof Date) return value
  return new Date(value)
}

function clonePlano(plano: Plano): Plano {
  return {
    ...plano,
    createdAt: toDate(plano.createdAt),
    updatedAt: toDate(plano.updatedAt),
  }
}

function cloneIndicador(indicador: Indicador): Indicador {
  return {
    ...indicador,
    createdAt: toDate(indicador.createdAt) as Date,
    updatedAt: toDate(indicador.updatedAt),
  }
}

function cloneComercial(comercial: Comercial): Comercial {
  return {
    ...comercial,
    createdAt: toDate(comercial.createdAt) as Date,
    updatedAt: toDate(comercial.updatedAt),
  }
}

function cloneAdmin(admin: Admin): Admin {
  return {
    ...admin,
    createdAt: toDate(admin.createdAt) as Date,
    updatedAt: toDate(admin.updatedAt),
  }
}

function buildIndicacoes(
  indicacoesRaw: Indicacao[],
  indicadoresMap: Map<string, Indicador>,
  comerciaisMap: Map<string, Comercial>,
  planosMap: Map<string, Plano>
): Indicacao[] {
  return indicacoesRaw.map((indicacao) => ({
    ...indicacao,
    indicador: indicadoresMap.get(indicacao.indicadorId),
    comercial: indicacao.comercialId ? comerciaisMap.get(indicacao.comercialId) : undefined,
    plano: planosMap.get(indicacao.planoId),
    dataAprovacao: toDate(indicacao.dataAprovacao),
    dataRecusa: toDate(indicacao.dataRecusa),
    createdAt: toDate(indicacao.createdAt) as Date,
    updatedAt: toDate(indicacao.updatedAt) as Date,
  }))
}

function buildPagamentos(
  pagamentosRaw: Pagamento[],
  indicadoresMap: Map<string, Indicador>,
  indicacoesMap: Map<string, Indicacao>
): Pagamento[] {
  return pagamentosRaw.map((pagamento) => ({
    ...pagamento,
    indicador: indicadoresMap.get(pagamento.indicadorId),
    indicacao: indicacoesMap.get(pagamento.indicacaoId),
    dataVencimento: toDate(pagamento.dataVencimento) as Date,
    dataPagamento: toDate(pagamento.dataPagamento),
    createdAt: toDate(pagamento.createdAt) as Date,
    updatedAt: toDate(pagamento.updatedAt),
  }))
}

function buildLeads(
  leadsRaw: Lead[],
  indicacoesMap: Map<string, Indicacao>,
  comerciaisMap: Map<string, Comercial>
): Lead[] {
  return leadsRaw.map((lead) => ({
    ...lead,
    indicacao: indicacoesMap.get(lead.indicacaoId),
    comercial: comerciaisMap.get(lead.comercialId),
    primeiroContato: toDate(lead.primeiroContato),
    ultimoContato: toDate(lead.ultimoContato),
    retornoAgendado: toDate(lead.retornoAgendado),
    createdAt: toDate(lead.createdAt) as Date,
    updatedAt: toDate(lead.updatedAt) as Date,
  }))
}

function buildHistoricos(
  historicosRaw: Historico[],
  comerciaisMap: Map<string, Comercial>
): Historico[] {
  return historicosRaw.map((historico) => ({
    ...historico,
    comercial: comerciaisMap.get(historico.comercialId),
    createdAt: toDate(historico.createdAt) as Date,
  }))
}

export interface MockDataSnapshot {
  planos: Plano[]
  indicadores: Indicador[]
  comerciais: Comercial[]
  admins: Admin[]
  indicacoes: Indicacao[]
  pagamentos: Pagamento[]
  leads: Lead[]
  historicos: Historico[]
  dashboardIndicador: DashboardIndicador
  dashboardComercial: DashboardComercial
  dashboardAdmin: DashboardAdmin
  currentIndicador: Indicador
  currentComercial: Comercial
  currentAdmin: Admin
}

function createSnapshot(): MockDataSnapshot {
  const planos = mockPlanos.map(clonePlano)
  const indicadores = mockIndicadores.map(cloneIndicador)
  const comerciais = mockComerciais.map(cloneComercial)
  const admins = mockAdmins.map(cloneAdmin)

  const planosMap = new Map(planos.map((item) => [item.id, item]))
  const indicadoresMap = new Map(indicadores.map((item) => [item.id, item]))
  const comerciaisMap = new Map(comerciais.map((item) => [item.id, item]))

  const indicacoes = buildIndicacoes(mockIndicacoes, indicadoresMap, comerciaisMap, planosMap)
  const indicacoesMap = new Map(indicacoes.map((item) => [item.id, item]))

  const pagamentos = buildPagamentos(mockPagamentos, indicadoresMap, indicacoesMap)
  const leads = buildLeads(mockLeads, indicacoesMap, comerciaisMap)
  const historicos = buildHistoricos(mockHistoricos, comerciaisMap)

  return {
    planos,
    indicadores,
    comerciais,
    admins,
    indicacoes,
    pagamentos,
    leads,
    historicos,
    dashboardIndicador: { ...mockDashboardIndicador },
    dashboardComercial: { ...mockDashboardComercial },
    dashboardAdmin: { ...mockDashboardAdmin },
    currentIndicador: indicadoresMap.get(mockCurrentIndicador.id) ?? indicadores[0],
    currentComercial: comerciaisMap.get(mockCurrentComercial.id) ?? comerciais[0],
    currentAdmin: admins.find((item) => item.id === mockCurrentAdmin.id) ?? admins[0],
  }
}

export const mockDataService = {
  getSnapshot(): MockDataSnapshot {
    return createSnapshot()
  },
}

const snapshot = createSnapshot()

export const planos = snapshot.planos
export const indicadores = snapshot.indicadores
export const comerciais = snapshot.comerciais
export const admins = snapshot.admins
export const indicacoes = snapshot.indicacoes
export const pagamentos = snapshot.pagamentos
export const leads = snapshot.leads
export const historicos = snapshot.historicos
export const dashboardIndicador = snapshot.dashboardIndicador
export const dashboardComercial = snapshot.dashboardComercial
export const dashboardAdmin = snapshot.dashboardAdmin
export const currentIndicador = snapshot.currentIndicador
export const currentComercial = snapshot.currentComercial
export const currentAdmin = snapshot.currentAdmin

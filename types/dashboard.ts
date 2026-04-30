import type { Indicador, Comercial } from './profile'

export interface DashboardIndicador {
  totalIndicacoes: number
  emAndamento: number
  aprovadas: number
  recusadas: number
  totalRecebido: number
  totalAReceber: number
  saldoDisponivel: number
  saldoEmDesconto: number
}

export interface DashboardComercial {
  leadsNovos: number
  leadsEmAtendimento: number
  leadsSemContato: number
  leadsEmNegociacao: number
  vendasRealizadas: number
  leadsPerdidos: number
  tempoMedioPrimeiroContato: string
  metaMensal?: number
  progressoMeta?: number
}

export interface DashboardAdmin {
  totalIndicacoes: number
  novasIndicacoes: number
  leadsSemContato: number
  leadsRedistribuidos: number
  indicacoesAprovadas: number
  recompensasPendentes: number
  totalPago: number
  totalAPagar: number
  conversaoPorIndicacao: number
  rankingIndicadores: RankingIndicador[]
  rankingComerciais: RankingComercial[]
}

export interface RankingIndicador {
  indicador: Indicador
  indicacoes: number
  aprovadas: number
  taxaConversao: number
}

export interface RankingComercial {
  comercial: Comercial
  vendas: number
  tempoMedio: string
  taxaConversao: number
}

export interface GraficoData {
  labels: string[]
  datasets: {
    label: string
    data: number[]
    backgroundColor?: string
    borderColor?: string
  }[]
}

export interface RelatorioFilters {
  periodo: 'hoje' | 'semana' | 'mes' | 'trimestre' | 'ano' | 'personalizado'
  dataInicio?: Date
  dataFim?: Date
  indicadorId?: string
  comercialId?: string
  planoId?: string
}

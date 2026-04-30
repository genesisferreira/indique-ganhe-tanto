import type { DashboardIndicador, DashboardComercial, DashboardAdmin } from '@/types'
import { indicadores, comerciais } from './users'

export const dashboardIndicador: DashboardIndicador = {
  totalIndicacoes: 25,
  emAndamento: 3,
  aprovadas: 18,
  recusadas: 4,
  totalRecebido: 1798.20,
  totalAReceber: 329.70,
  saldoDisponivel: 299.70,
  saldoEmDesconto: 99.90,
}

export const dashboardComercial: DashboardComercial = {
  leadsNovos: 5,
  leadsEmAtendimento: 8,
  leadsSemContato: 2,
  leadsEmNegociacao: 4,
  vendasRealizadas: 87,
  leadsPerdidos: 12,
  tempoMedioPrimeiroContato: '8 min',
  metaMensal: 100,
  progressoMeta: 87,
}

export const dashboardAdmin: DashboardAdmin = {
  totalIndicacoes: 157,
  novasIndicacoes: 12,
  leadsSemContato: 3,
  leadsRedistribuidos: 2,
  indicacoesAprovadas: 126,
  recompensasPendentes: 15,
  totalPago: 12590.30,
  totalAPagar: 2345.60,
  conversaoPorIndicacao: 80.25,
  rankingIndicadores: [
    { indicador: indicadores[4], indicacoes: 67, aprovadas: 58, taxaConversao: 86.57 },
    { indicador: indicadores[1], indicacoes: 42, aprovadas: 35, taxaConversao: 83.33 },
    { indicador: indicadores[0], indicacoes: 25, aprovadas: 18, taxaConversao: 72.00 },
    { indicador: indicadores[2], indicacoes: 15, aprovadas: 10, taxaConversao: 66.67 },
    { indicador: indicadores[3], indicacoes: 8, aprovadas: 5, taxaConversao: 62.50 },
  ],
  rankingComerciais: [
    { comercial: comerciais[1], vendas: 112, tempoMedio: '5 min', taxaConversao: 89.60 },
    { comercial: comerciais[3], vendas: 94, tempoMedio: '7 min', taxaConversao: 85.45 },
    { comercial: comerciais[0], vendas: 87, tempoMedio: '8 min', taxaConversao: 79.09 },
    { comercial: comerciais[2], vendas: 65, tempoMedio: '12 min', taxaConversao: 72.22 },
  ],
}

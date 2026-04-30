import type { RecompensaTipo } from './referral'

export interface Recompensa {
  id: string
  indicacaoId: string
  indicadorId: string
  tipo: RecompensaTipo
  valor: number
  status: 'pendente' | 'disponivel' | 'solicitado' | 'pago'
  dataDisponivel?: Date
  dataSolicitacao?: Date
  dataPagamento?: Date
  createdAt: Date
  updatedAt: Date
}

export interface RecompensaConfig {
  id: string
  planoId: string
  valorPix: number
  valorDesconto: number
  diasCarencia: number // Dias após primeira fatura para liberar
  ativo: boolean
}

export interface RecompensaSummary {
  totalGanho: number
  totalDisponivel: number
  totalPendente: number
  totalEmDesconto: number
}

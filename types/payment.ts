import type { Indicador } from './profile'
import type { Indicacao, RecompensaTipo } from './referral'

export type PagamentoStatus = 'pendente' | 'aprovado' | 'pago' | 'cancelado'

export interface Pagamento {
  id: string
  indicadorId: string
  indicador?: Indicador
  indicacaoId: string
  indicacao?: Indicacao
  valor: number
  tipo: RecompensaTipo
  status: PagamentoStatus
  dataVencimento: Date
  dataPagamento?: Date
  comprovanteUrl?: string
  observacoes?: string
  aprovadoPor?: string
  createdAt: Date
  updatedAt?: Date
}

export interface PagamentoCreateData {
  indicadorId: string
  indicacaoId: string
  valor: number
  tipo: RecompensaTipo
}

export interface PagamentoFilters {
  status?: PagamentoStatus | 'todos'
  indicadorId?: string
  tipo?: RecompensaTipo
  dataInicio?: Date
  dataFim?: Date
}

export interface SolicitacaoSaque {
  id: string
  indicadorId: string
  valor: number
  chavePix: string
  tipoChavePix: string
  status: 'pendente' | 'aprovado' | 'pago' | 'rejeitado'
  motivoRejeicao?: string
  createdAt: Date
  updatedAt: Date
}

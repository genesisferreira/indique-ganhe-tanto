import type { Indicador, Comercial } from './profile'
import type { Plano } from './plan'

export type IndicacaoStatus = 'pendente' | 'em_andamento' | 'em_atendimento' | 'em_negociacao' | 'aprovada' | 'recusada' | 'paga'

export type RecompensaTipo = 'pix' | 'desconto_fatura'

export interface Indicacao {
  id: string
  indicadorId: string
  indicador?: Indicador
  nomeIndicado: string
  telefoneIndicado: string
  emailIndicado?: string
  enderecoIndicado?: string
  planoId: string
  plano?: Plano
  tipoRecompensa: RecompensaTipo
  valorRecompensa: number
  status: IndicacaoStatus
  comercialId?: string
  comercial?: Comercial
  observacoes?: string
  primeiraFaturaPaga?: boolean
  dataAprovacao?: Date
  dataRecusa?: Date
  motivoRecusa?: string
  createdAt: Date
  updatedAt: Date
}

export interface IndicacaoCreateData {
  nomeIndicado: string
  telefoneIndicado: string
  emailIndicado?: string
  enderecoIndicado?: string
  planoId: string
  tipoRecompensa: RecompensaTipo
  observacoes?: string
}

export interface IndicacaoUpdateData {
  id: string
  status?: IndicacaoStatus
  comercialId?: string
  observacoes?: string
  primeiraFaturaPaga?: boolean
  motivoRecusa?: string
}

export interface IndicacaoFilters {
  status?: IndicacaoStatus | 'todas'
  indicadorId?: string
  comercialId?: string
  planoId?: string
  dataInicio?: Date
  dataFim?: Date
  search?: string
}
